import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createLabelMaterial, pixelScale } from "@graphics/materials/Label.material.ts";
import { GROUND_FADE } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds } from "@graphics/terrain/GeoProjection.ts";
import { PlaceIndex, type Place } from "@graphics/places/PlaceIndex.ts";
import { createSdfFont, textWidth, type Glyph, type SdfFont } from "@graphics/text/SdfFont.ts";
import { MAP_FOCUS, type MapFocusId } from "@graphics/config/focus.config.ts";
import { fetchAreas } from "@graphics/places/AdminAreas.ts";
import { AreaAccentsHelper } from "@graphics/places/AreaAccents.helper.ts";
import { distanceToRingsKm, ringsBounds, ringsContain } from "@graphics/places/Rings.ts";
import { FrenchCommunesHelper } from "./FrenchCommunes.helper.ts";
import { fetchCommuneAt, fetchCommuneRings, fetchWorldCities } from "@graphics/places/PlaceSources.ts";
import {
  BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Camera,
  type Material,
  type PerspectiveCamera,
} from "three";

const MAX_LABELS = 7;
/** Attelages : les etiquettes retenues, et autant qui sortent pendant que les suivantes entrent. */
const RIGS = MAX_LABELS * 2;
/** Ecart minimal entre deux points a l'ecran, en px. */
const GAP = { x: 120, y: 70 };
/** Longueur des lignes : etages alternes de gauche a droite, pour que deux textes voisins ne se couvrent pas. */
const LINE_PX = 90;
const TIER_PX = 64;
const TIERS = 3;
const ALL_TIERS = Array.from({ length: TIERS }, (_, i) => i);
/** Marge autour d'un nom (px) que ne doit pas toucher un autre nom. */
const NAME_PAD = 6;
const EASE = 0.2;
/**
 * Entree et sortie d'une etiquette (ms) : le point se pose, la hampe pousse depuis lui et le nom arrive en
 * haut ; a la sortie, tout redescend. Les entrees se suivent de `STAGGER_MS`, les sorties de moins.
 */
const MOTION = { enterMs: 460, exitMs: 220, staggerMs: 60, exitStaggerMs: 22 };
/**
 * Pas d'accent sur le territoire ou l'on se trouve, ni sur celui dont le bord passe a moins de cette part de la
 * largeur de vue du point vise : on y est deja, le colorier ne dirait rien.
 */
const NEAR_SHARE = 0.06;
/** On n'est « dans » un territoire que si la vue n'est pas plus large que ce multiple de son etendue. */
const HERE_SPAN = 3;
/** Repos du pointeur (ms) avant de demander la commune qu'il survole : pas une requete par pixel parcouru. */
const COMMUNE_LOOKUP_MS = 140;
/** Vitesse de la reponse de l'etiquette elle-meme au survol : plus vive que le rouge du territoire. */
const LABEL_HOVER_PER_S = 7;
/** En deca, une valeur qui converge est consideree arrivee. */
const SETTLED = 0.01;
/** Marge autour d'un nom ou la carte cesse de suivre la souris, en pixels : de quoi finir le geste. */
const AIM_PX = 28;
/**
 * Pas de temps maximal pris en compte par les animations (ms). Rasteriser un contour bloque l'image ; sans
 * cette borne, le `dt` qui suit avale toute la transition d'un coup et le rouge parait instantane.
 */
const MAX_STEP_MS = 40;
/** Les villes retenues restent dans la partie nette du sol. */
const REACH = GROUND_FADE.near;
/** Les noms restent sous l'en-tete de l'interface (`MapChrome`), qui occupe le haut de la page. */
const TOP_MARGIN_PX = 104;
const RESELECT_MS = 250;
/**
 * Mise en page (px) : corps du nom, filet sous le nom, epaisseur de la hampe et diametre du point.
 * Nom seul, sans numero de classement : celui-ci vit desormais dans le rail des regards de l'interface.
 */
const TYPE = { name: 15, rule: 7, line: 1, dot: 9 };
/** Quadrilateres reserves par etiquette : son trait, son point, son filet et une trentaine de caracteres. */
const MAX_QUADS = 40;
/** Police des etiquettes : celle de la page (voir `--font-map`), et sa graisse. */
const FONT = '"Manrope", system-ui, sans-serif';
const WEIGHT = 600;


/** Attelage d'une etiquette : tout ce qui la dessine et la rend attrapable. */
interface Rig {
  group: Group;
  mesh: Mesh;
  geometry: InstancedBufferGeometry;
  glyphs: InstancedBufferAttribute;
  screen: InstancedBufferAttribute;
  tints: InstancedBufferAttribute;
  fades: InstancedBufferAttribute;
  /** Plan invisible a la taille du nom : seule cible du raycast. */
  proxy: Mesh;
  quads: number;
  /** Lieu attrapable par ce plan ; null pour une etiquette qui sort. */
  place: Place | null;
}

/** Boite d'un nom a l'ecran (px), pour que deux noms ne se couvrent pas. */
interface NameBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: NameBox, b: NameBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Boite en pixels, en decalage depuis le point ancre de l'etiquette. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Label {
  place: Place;
  tier: number;
  /** Longueur de la ligne a l'ecran, lissee. */
  length: number | null;
  /** Boite du texte a l'ecran (px), pour le survol. */
  box: { x: number; y: number; width: number; height: number } | null;
  /** Part apparue, lineaire (0 a 1), sa cible, et l'attente avant de s'y mettre (ms). */
  shown: number;
  wanted: 0 | 1;
  delay: number;
  /** Part survolee, lissee : elle teinte le texte et allonge son filet. */
  hover: number;
}

/** Sortie cubique : la hampe part vite et se pose. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Villes les plus peuplees de la vue : point au sol, ligne verticale, numero et nom, dessines a l'ecran autour
 * d'un point ancre dans le terrain (`createLabelMaterial`). La ville survolee passe au rouge, un clic vole
 * jusqu'a elle.
 *
 * Dessine dans sa propre scene (`scene`), posee sur l'image finie par `OverlayPass` : la passe d'encre remplace
 * toute l'image qu'elle traite, un texte rendu avec le terrain y serait pris pour un relief et hachure.
 */
export class Labels3DNode extends Object3DNodeBase {
  private readonly _canvas: HTMLElement;
  private readonly _terrain: TerrainNode;
  private readonly _camera: () => Camera;
  private readonly _onSelect: (place: Place) => void;
  private readonly _places = new PlaceIndex();
  private _communes: FrenchCommunesHelper | null = null;
  private readonly _labels = new Map<Place, Label>();
  private readonly _point = new Vector3();
  private _abort: AbortController | null = null;
  private _selection = "";
  private _selectedAt = -Infinity;
  private _font: SdfFont | null = null;
  /** Scene a part : l'interface est posee sur l'image finie, pas dessinee avec le terrain. */
  private readonly _scene: Scene;
  /** Un attelage par etiquette : son groupe face a la camera, ses quadrilateres et son plan de visee. */
  private readonly _rigs: Rig[] = [];
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _anchor = new Vector3();
  private readonly _forward = new Vector3();
  /** Souris a l'ecran (px), et lieu survole. */
  private readonly _pointer = { x: -1, y: -1 };
  private _hovered: Place | null = null;
  /** Territoires accentues sur le sol, chacun a son rythme (`AreaAccentsHelper`). */
  private readonly _accents = new AreaAccentsHelper();
  /** Territoire que le pointeur designe, nom ou sol, avant la regle du « deja dedans ». */
  private _target: Place | null = null;
  /** Sol sous le pointeur : plan de visee, point touche, et la commune qu'on y a trouvee. */
  private readonly _groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly _groundHit = new Vector3();
  private _communeAt: { place: Place | null; pending: AbortController | null; timer: number; lon: number; lat: number } = {
    place: null,
    pending: null,
    timer: 0,
    lon: 0,
    lat: 0,
  };
  /** Un bouton est enfonce sur la carte : on la deplace, on ne designe rien. */
  private _pressed = false;
  private _focus: MapFocusId = "communes";
  /** Rien ne bouge plus dans les etiquettes : l'univers peut alors sauter des images (voir `settled`). */
  private _settled = false;
  private _aiming = false;
  /** Pas d'interpolation du survol de l'image courante, borne comme les autres (voir `_breathe`). */
  private _hoverStep = 0.2;
  /** Niveau demande pendant que les etiquettes sortent ; applique une fois qu'elles sont toutes parties. */
  private _wanted: MapFocusId | null = null;

  constructor(canvas: HTMLElement, terrain: TerrainNode, camera: () => Camera, onSelect: (place: Place) => void) {
    // L'objet du noeud reste vide : les etiquettes vivent dans leur propre scene, posee sur l'image finie.
    super(NODE_ID.LABELS, "Labels", new Group());
    this._scene = new Scene();
    this._canvas = canvas;
    this._terrain = terrain;
    this._camera = camera;
    this._onSelect = onSelect;
  }

  /**
   * Niveau nomme par la carte. Les etiquettes sortent d'abord, le niveau ne change qu'une fois la page nette,
   * et les nouvelles reviennent : on ne voit jamais deux jeux de noms se croiser.
   */
  setFocus(focus: MapFocusId): void {
    if (focus === this._wanted || (focus === this._focus && this._wanted === null)) return;
    this._wanted = focus;
    // Elles sortent l'une apres l'autre, de gauche a droite comme on lit.
    [...this._labels.values()].forEach((label, i) => this._leave(label, i * MOTION.exitStaggerMs));
  }

  /** Vrai quand plus rien ne bouge : ni apparition, ni longueur de hampe, ni survol en cours. */
  get settled(): boolean {
    return this._settled;
  }

  /** Le pointeur approche un nom : la carte doit cesser de suivre la souris, sinon le nom lui echappe. */
  get aiming(): boolean {
    return this._aiming;
  }

  private _applyFocus(focus: MapFocusId): void {
    this._focus = focus;
    this._hovered = null;
    this._order = [];
    this._labels.clear();
    this._places.clear();
    this._target = null;
    this._communeAt.place = null;
    this._accents.hold(null);
    this._abort?.abort();
    this._load();
  }

  get focus(): MapFocusId {
    return this._focus;
  }

  override onMounted(): void {
    super.onMounted();
    this._font = createSdfFont(FONT, WEIGHT);
    const material = createLabelMaterial(this._font.texture);
    for (let i = 0; i < RIGS; i++) this._rigs.push(this._rig(material));
    this._canvas.addEventListener("pointermove", this._onMove);
    this._canvas.addEventListener("pointerdown", this._onClick);
    this._canvas.addEventListener("pointerup", this._onRelease);
    this._canvas.addEventListener("pointerleave", this._onLeave);
    this._load();
  }

  override onUnmounted(): void {
    this._release();
    super.onUnmounted();
  }

  /** Lieux du niveau courant dont le nom approche `query`. */
  search(query: string, limit: number): Place[] {
    return this._places.search(query, limit);
  }

  /** Lieu connu portant ce nom, avec son contour s'il en a un. */
  find(name: string): Place | null {
    return this._places.search(name, 1)[0] ?? null;
  }

  /** La scene des etiquettes, a poser sur l'image finie (`OverlayPass`) ; null tant que la police se prepare. */
  get scene(): Scene | null {
    return this._font ? this._scene : null;
  }

  override update(_time: number, dt: number): void {
    if (!this._font) return;
    this._breathe(dt);
    // Pas pendant un vol : il traverserait des departements pour rien.
    if (!this._terrain.flying) this._communes?.update(this._terrain.bounds, this._terrain.extentKm);
    const selection = `${this._terrain.viewVersion}:${this._places.version}`;
    const now = performance.now();
    if (this._intro < 1) {
      // Sous la page d'entree : ni noms ni survol. Ils entrent une fois la carte entierement decouverte.
      for (const label of this._labels.values()) this._leave(label, 0);
      this._selection = "";
    } else if (selection !== this._selection && now - this._selectedAt > RESELECT_MS) {
      this._selection = selection;
      this._selectedAt = now;
      this._select();
    }
    this._layout();
  }

  /**
   * Entrees, sorties et montee du rouge : tout ce qui avance tout seul d'une image a l'autre. Le niveau
   * demande n'est applique qu'une fois toutes les etiquettes sorties.
   */
  private _breathe(dt: number): void {
    const capped = Math.min(dt, MAX_STEP_MS);
    for (const label of [...this._labels.values()]) {
      if (label.delay > 0) {
        label.delay -= capped;
        continue;
      }
      const span = label.wanted ? MOTION.enterMs : MOTION.exitMs;
      label.shown = clamp01(label.shown + ((label.wanted ? 1 : -1) * capped) / span);
      if (!label.wanted && label.shown === 0) this._labels.delete(label.place);
    }
    if (this._wanted && this._labels.size === 0) {
      this._applyFocus(this._wanted);
      this._wanted = null;
    }
    this._accents.step(capped);
    this._hoverStep = Math.min(1, (capped / 1000) * LABEL_HOVER_PER_S);
  }

  /** L'etiquette sort, apres `delay` ms ; elle reste dessinee le temps de redescendre. */
  private _leave(label: Label, delay: number): void {
    if (!label.wanted) return;
    label.wanted = 0;
    label.delay = delay;
  }

  override dispose(): void {
    this._release();
    this._accents.dispose();
    for (const rig of this._rigs) {
      rig.geometry.dispose();
      rig.proxy.geometry.dispose();
      (rig.proxy.material as Material).dispose();
    }
    (this._rigs[0]?.mesh.material as Material | undefined)?.dispose();
    super.dispose();
  }

  /**
   * Attelage d'une etiquette : un groupe pose sur le point ancre et tourne vers la camera, ses quadrilateres
   * en pixels, et un plan invisible a la taille du nom — seule cible du raycast. Texte et zone cliquable
   * partagent donc la meme transformation.
   */
  private _rig(material: Material): Rig {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const glyphs = new InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    const screen = new InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
    const tints = new InstancedBufferAttribute(new Float32Array(MAX_QUADS), 1);
    const fades = new InstancedBufferAttribute(new Float32Array(MAX_QUADS), 1);
    geometry.setAttribute("glyph", glyphs);
    geometry.setAttribute("screen", screen);
    geometry.setAttribute("tint", tints);
    geometry.setAttribute("fade", fades);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    const proxy = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
    // Jamais dessine, mais le raycast ne regarde pas la visibilite : c'est la zone du nom.
    proxy.visible = false;
    const group = new Group();
    group.add(mesh, proxy);
    group.visible = false;
    this._scene.add(group);
    return { group, mesh, geometry, glyphs, screen, tints, fades, proxy, quads: 0, place: null };
  }

  /**
   * Communes : villes du monde (agglomerations) puis communes francaises la ou regarde la vue, une ville
   * presente des deux cotes gardant sa plus grande population. Departements et regions : un seul fichier,
   * contours compris, qui sert aussi a colorier le survol.
   */
  private _load(): void {
    const abort = new AbortController();
    this._abort = abort;
    this._selection = "";
    if (this._focus !== "communes") {
      fetchAreas(this._focus, abort.signal)
        .then((places) => this._places.add(places))
        .catch((error: unknown) => {
          if (!abort.signal.aborted) console.warn(`[Labels] ${MAP_FOCUS[this._focus].label} indisponibles`, error);
        });
      this._communes = null;
      return;
    }
    fetchWorldCities(abort.signal)
      // La carte ne parle que de la France : une ville etrangere n'a pas de fonds a ouvrir.
      .then((places) => this._places.add(places.filter((place) => place.country === "FRA")))
      .catch((error: unknown) => {
        if (!abort.signal.aborted) console.warn("[Labels] lieux indisponibles", error);
      });
    this._communes = new FrenchCommunesHelper(abort.signal, (places) => this._places.add(places));
  }

  private _release(): void {
    this._abort?.abort();
    this._abort = null;
    this._communes = null;
    this._canvas.removeEventListener("pointermove", this._onMove);
    this._canvas.removeEventListener("pointerdown", this._onClick);
    this._canvas.removeEventListener("pointerup", this._onRelease);
    this._canvas.removeEventListener("pointerleave", this._onLeave);
    this._communeAt.pending?.abort();
    clearTimeout(this._communeAt.timer);
    this._labels.clear();
    this._selection = "";
  }

  private readonly _onMove = (event: PointerEvent): void => {
    const rect = this._canvas.getBoundingClientRect();
    this._pointer.x = event.clientX - rect.left;
    this._pointer.y = event.clientY - rect.top;
    this._pressed = event.buttons !== 0;
  };

  private readonly _onClick = (): void => {
    this._pressed = !this._hovered;
    if (this._hovered) this._onSelect(this._hovered);
  };

  private readonly _onRelease = (): void => {
    this._pressed = false;
  };

  /** Le pointeur passe sur l'interface ou quitte la page : il ne designe plus rien sur la carte. */
  private readonly _onLeave = (): void => {
    this._pointer.x = this._pointer.y = -1;
  };

  private _select(): void {
    // Un changement de niveau est en cours : les etiquettes sortent, rien ne doit en faire revenir.
    if (this._wanted) return;
    const area = expandBounds(this._terrain.bounds, (TERRAIN_CONFIG.groundSpan - 1) / 2);
    const taken: { x: number; y: number }[] = [];
    const picked = this._places.pick(area, MAX_LABELS, (place) => {
      const scene = this._terrain.sceneOf(place.lon, place.lat);
      if (Math.hypot(scene.x, scene.z) > REACH) return false;
      const at = this._ground(place);
      if (!at || taken.some((t) => Math.abs(t.x - at.x) < GAP.x && Math.abs(t.y - at.y) < GAP.y)) return false;
      taken.push(at);
      return true;
    });

    const candidates = picked.map((place, i) => ({ place, ...taken[i]! }));
    // Le territoire accentue montre toujours son nom, et en premier : c'est lui qu'on regarde.
    const held = this._accents.held as Place | null;
    if (held && !picked.includes(held)) {
      const at = this._ground(held);
      if (at) candidates.unshift({ place: held, ...at });
    }

    // Etages : du plus peuple au moins peuple, chaque nom prend le premier etage ou il ne couvre aucun nom deja
    // pose, le sien d'abord (une hampe qui change d'etage s'allonge en douceur). Sans place, il n'est pas montre.
    const names: NameBox[] = [];
    const tiers = new Map<Place, number>();
    candidates.forEach(({ place, x, y }) => {
      const current = this._labels.get(place)?.tier;
      const order = current === undefined ? ALL_TIERS : [current, ...ALL_TIERS.filter((t) => t !== current)];
      for (const tier of order) {
        const box = this._nameBox(place, x, y, tier);
        if (names.some((other) => overlaps(box, other))) continue;
        names.push(box);
        tiers.set(place, tier);
        return;
      }
    });
    const shown = candidates.filter(({ place }) => tiers.has(place));

    for (const label of this._labels.values()) if (!tiers.has(label.place)) this._leave(label, 0);
    // Les nouvelles entrent l'une apres l'autre, de gauche a droite ; une etiquette qui sortait revient d'ou
    // elle en est.
    let entering = 0;
    const byX = [...shown].sort((a, b) => a.x - b.x);
    for (const { place } of byX) {
      const tier = tiers.get(place)!;
      const label = this._labels.get(place);
      if (!label) {
        this._labels.set(place, { place, tier, length: null, box: null, shown: 0, wanted: 1, delay: entering++ * MOTION.staggerMs, hover: 0 });
        continue;
      }
      label.wanted = 1;
      label.delay = 0;
      label.tier = tier;
    }
    this._order = shown.map(({ place }) => place);
  }

  /** Boite du nom d'un lieu a l'ecran (px) s'il montait a cet etage, avec une marge de lecture. */
  private _nameBox(place: Place, x: number, y: number, tier: number): NameBox {
    const font = this._font!;
    const width = textWidth(font, place.name.toUpperCase()) * TYPE.name;
    const top = Math.max(TOP_MARGIN_PX + tier * TIER_PX, y - (LINE_PX + tier * TIER_PX));
    return { left: x - NAME_PAD, right: x + width + NAME_PAD, top: top - font.cap * TYPE.name - NAME_PAD, bottom: top + TYPE.rule + NAME_PAD };
  }

  /** Lieux retenus, dans l'ordre du plus peuple : ceux qui sortent sont dessines apres eux. */
  private _order: Place[] = [];

  private _layout(): void {
    const font = this._font!;
    const camera = this._camera() as PerspectiveCamera;
    const perspective = pixelScale(this._canvas.clientHeight, camera.fov ?? 50);
    camera.getWorldDirection(this._forward);
    let moving = false;
    let index = 0;

    // Celles qui restent d'abord, dans l'ordre du choix ; celles qui sortent ensuite, le temps de redescendre.
    const labels = [...this._labels.values()].sort((a, b) => b.wanted - a.wanted);
    for (const label of labels) {
      const { place } = label;
      const ground = this._ground(place);
      const rig = this._rigs[index];
      if (!ground || !rig) continue;
      index++;
      const scene = this._terrain.sceneOf(place.lon, place.lat);
      this._anchor.set(scene.x, this._terrain.heightAt(scene.x, scene.z), scene.z);
      const target = LINE_PX + label.tier * TIER_PX;
      label.length = label.length === null ? target : label.length + (target - label.length) * EASE;
      if (Math.abs(target - label.length) > 0.5 || label.shown !== label.wanted || label.delay > 0) moving = true;
      // Entree : le point se pose, la hampe pousse depuis lui en portant le nom, qui s'encre en arrivant.
      const grown = easeOut(label.shown);
      const dot = clamp01(label.shown / 0.25);
      const named = clamp01((label.shown - 0.35) / 0.65);
      // La marge haute garde les etages : sans le decalage, deux noms voisins plaques en haut retombent sur
      // la meme ligne et se superposent.
      const floor = TOP_MARGIN_PX + label.tier * TIER_PX;
      const top = (Math.max(floor, ground.y - label.length) - ground.y) * grown;

      // Le groupe porte le point ancre, l'orientation de la camera et l'echelle pixel vers scene : dans son
      // repere, une unite vaut un pixel d'ecran. La profondeur de vue, pas la distance : c'est par elle que
      // la perspective divise.
      const depth = Math.abs(this._anchor.clone().sub(camera.position).dot(this._forward));
      rig.group.position.copy(this._anchor);
      rig.group.quaternion.copy(camera.quaternion);
      rig.group.scale.setScalar(perspective * Math.max(depth, 1e-4));
      rig.group.visible = true;
      // Seule une etiquette arrivee s'attrape : une qui sort ou n'a pas encore son nom ne retient pas la souris.
      rig.place = label.wanted && named > 0.5 ? place : null;
      rig.quads = 0;

      const name = place.name.toUpperCase();
      const width = textWidth(font, name) * TYPE.name;
      // Le survol allonge le filet et souleve le nom : l'etiquette repond avant meme que le sol ne rougisse.
      const hover = label.hover;
      const lift = hover * TYPE.rule * 0.5;
      this._quad(rig, font.solid, -TYPE.line / 2, top - lift, TYPE.line, -top + lift, dot, hover);
      this._quad(rig, font.disc, -TYPE.dot / 2, -TYPE.dot / 2, TYPE.dot, TYPE.dot, dot, hover);
      this._quad(rig, font.solid, 0, top + TYPE.rule - lift, width * (0.62 + hover * 0.38), 1, named, hover);
      const drawn = this._text(rig, font, name, 0, top - lift, TYPE.name, named, hover);

      // Le plan de visee prend la boite du nom, serree sur la hauteur de capitale : la case d'un glyphe
      // deborde en haut (marge du champ de distance) et en bas (hampes).
      const boxTop = top - lift - font.cap * TYPE.name;
      const boxHeight = font.cap * TYPE.name + TYPE.rule;
      rig.proxy.position.set(drawn.left + drawn.width / 2, -(boxTop + boxHeight / 2), 0);
      rig.proxy.scale.set(Math.max(drawn.width, 1), boxHeight, 1);
      label.box = rig.place ? { x: ground.x + drawn.left, y: ground.y + boxTop, width: drawn.width, height: boxHeight } : null;

      for (const attribute of [rig.glyphs, rig.screen, rig.tints, rig.fades]) attribute.needsUpdate = true;
      rig.geometry.instanceCount = rig.quads;
    }
    for (let i = index; i < this._rigs.length; i++) {
      this._rigs[i]!.group.visible = false;
      this._rigs[i]!.place = null;
    }

    // Un geste en cours deplace la carte : il ne designe rien. Sous la page d'entree non plus.
    const hovered = this._pressed || this._intro < 1 ? null : this._pick(camera);
    this._aiming = this._aim(hovered);
    const changed = hovered !== this._hovered;
    this._hovered = hovered;
    this._canvas.style.cursor = hovered ? "pointer" : "";
    // L'accent vient du nom survole, sinon du sol sous le pointeur — sauf pres d'un nom, ou il attend le nom.
    this._designate(hovered ?? (this._aiming || this._pressed || this._intro < 1 ? null : this._groundPlace(camera)));
    // Tant qu'une valeur avance, l'univers doit redessiner : sinon la zone de survol continuerait de bouger
    // sous un texte fige sur la derniere image, et l'on ne pourrait plus attraper les noms.
    let hovering = false;
    // Le nom se teinte aussi quand c'est son territoire qu'on survole sur la carte.
    const accented = this._accents.held;
    for (const label of this._labels.values()) {
      const wanted = label.place === hovered || label.place === accented ? 1 : 0;
      if (Math.abs(wanted - label.hover) > SETTLED) hovering = true;
      label.hover += (wanted - label.hover) * this._hoverStep;
    }
    this._settled = !moving && !changed && !hovering && this._wanted === null && this._accents.settled;
  }

  /**
   * Nom vise par le pointeur : un raycast sur les plans invisibles des etiquettes. C'est la seule facon que
   * la zone cliquable ne puisse pas s'ecarter du dessin — les deux sortent de la meme transformation.
   */
  private _pick(camera: Camera): Place | null {
    const { clientWidth: width, clientHeight: height } = this._canvas;
    if (this._pointer.x < 0 || this._pointer.y < 0) return null;
    this._scene.updateMatrixWorld(true);
    this._ndc.set((this._pointer.x / width) * 2 - 1, -(this._pointer.y / height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, camera);
    const proxies = this._rigs.filter((rig) => rig.group.visible && rig.place).map((rig) => rig.proxy);
    const hit = this._raycaster.intersectObjects(proxies, false)[0];
    return this._rigs.find((rig) => rig.proxy === hit?.object)?.place ?? null;
  }

  /** Le pointeur approche un nom : plus large que la zone cliquable, pour que la carte se fige avant. */
  private _aim(hovered: Place | null): boolean {
    if (hovered) return true;
    for (const rig of this._rigs) {
      const box = rig.place ? this._labels.get(rig.place)?.box : null;
      if (!box) continue;
      if (
        this._pointer.x >= box.x - AIM_PX &&
        this._pointer.x <= box.x + box.width + AIM_PX &&
        this._pointer.y >= box.y - AIM_PX &&
        this._pointer.y <= box.y + box.height + AIM_PX
      )
        return true;
    }
    return false;
  }

  /**
   * Suite de caracteres a partir du point d'ecriture (x, y) : chacun avance du sien. Rend la boite des
   * quadrilateres poses, en decalage depuis le point ancre — de quoi en faire une zone cliquable exacte.
   */
  private _text(rig: Rig, font: SdfFont, text: string, x: number, y: number, size: number, fade: number, tint: number): Box {
    let pen = x;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const char of text) {
      const glyph = font.glyphs.get(char);
      if (!glyph) continue;
      const left = pen + glyph.left * size;
      const top = y + glyph.top * size;
      this._quad(rig, glyph, left, top, glyph.width * size, glyph.height * size, fade, tint);
      box.left = Math.min(box.left, left);
      box.top = Math.min(box.top, top);
      box.right = Math.max(box.right, left + glyph.width * size);
      box.bottom = Math.max(box.bottom, top + glyph.height * size);
      pen += glyph.advance * size;
    }
    if (box.left === Infinity) return { left: 0, top: 0, width: 0, height: 0 };
    return { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
  }

  private _quad(rig: Rig, glyph: Glyph, x: number, y: number, width: number, height: number, fade: number, tint: number): void {
    if (rig.quads >= MAX_QUADS) return;
    const i = rig.quads++;
    rig.glyphs.array.set([glyph.u, glyph.v, glyph.du, glyph.dv], i * 4);
    rig.screen.array.set([x, y, width, height], i * 4);
    (rig.tints.array as Float32Array)[i] = tint;
    (rig.fades.array as Float32Array)[i] = fade;
  }

  /**
   * Territoire designe par le pointeur : son contour va au sol, qui le marque pour que la passe d'encre le
   * colorie (`AreaAccentsHelper`). Pas d'accent sur le territoire ou l'on se trouve deja. Une commune n'a que
   * son code : son contour est demande au premier survol, puis garde sur le lieu.
   */
  private _designate(place: Place | null): void {
    const held = this._accents.held;
    this._accents.hold(place && !this._isHere(place) ? place : null, place?.rings);
    // Le nom du territoire accentue doit paraitre (ou repartir) tout de suite, sans attendre que la vue bouge.
    if (this._accents.held !== held) {
      this._selection = "";
      this._selectedAt = -Infinity;
    }
    if (place === this._target) return;
    this._target = place;
    if (!place || place.rings || !place.code) return;
    const abort = this._abort;
    fetchCommuneRings(place.code, abort!.signal)
      .then((rings) => {
        place.rings = rings;
        this._accents.draw(place, rings);
      })
      .catch((error: unknown) => {
        if (!abort?.signal.aborted) console.warn("[Labels] contour indisponible", error);
      });
  }

  /**
   * On est deja dans ce territoire : le point vise y est (ou tout pres de son bord) et la vue n'est pas bien
   * plus large que lui. En vue France, on n'est « dans » aucun departement ; a l'echelle d'une ville, on est
   * dans sa commune et la colorier ne dirait rien.
   */
  private _isHere(place: Place): boolean {
    const rings = place.rings;
    if (!rings?.length) return false;
    const { lon, lat } = this._terrain.center;
    const b = ringsBounds(rings);
    const spanKm = Math.max((b.east - b.west) * 111.32 * Math.cos((lat * Math.PI) / 180), (b.north - b.south) * 111.32);
    if (this._terrain.extentKm > spanKm * HERE_SPAN) return false;
    return ringsContain(rings, lon, lat) || distanceToRingsKm(rings, lon, lat) < this._terrain.extentKm * NEAR_SHARE;
  }

  /** Territoire du niveau courant sous le pointeur, sur le sol. */
  private _groundPlace(camera: Camera): Place | null {
    if (this._pointer.x < 0 || this._terrain.flying) return null;
    const at = this._groundAt(camera);
    if (!at) return null;
    if (this._focus !== "communes") return this._places.containing(at.lon, at.lat);
    return this._communeUnder(at.lon, at.lat);
  }

  /** Point geographique sous le pointeur : le plan du sol, puis corrige de l'altitude qu'on y trouve. */
  private _groundAt(camera: Camera): { lon: number; lat: number } | null {
    const { clientWidth: width, clientHeight: height } = this._canvas;
    this._ndc.set((this._pointer.x / width) * 2 - 1, -(this._pointer.y / height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, camera);
    this._groundPlane.constant = 0;
    if (!this._raycaster.ray.intersectPlane(this._groundPlane, this._groundHit)) return null;
    this._groundPlane.constant = -this._terrain.heightAt(this._groundHit.x, this._groundHit.z);
    if (!this._raycaster.ray.intersectPlane(this._groundPlane, this._groundHit)) return null;
    return this._terrain.geoOf(this._groundHit.x, this._groundHit.z);
  }

  /**
   * Commune sous le point : celle deja trouvee si le point y est encore, une commune dont on connait le contour,
   * sinon on la demande une fois le pointeur au repos. En attendant, rien n'est designe : le rouge reflue.
   */
  private _communeUnder(lon: number, lat: number): Place | null {
    const at = this._communeAt;
    if (at.place?.rings && ringsContain(at.place.rings, lon, lat)) return at.place;
    const known = this._places.containing(lon, lat);
    if (known) return (at.place = known);
    if (at.pending || Math.hypot(lon - at.lon, lat - at.lat) < 1e-5) return null;
    at.lon = lon;
    at.lat = lat;
    clearTimeout(at.timer);
    at.timer = window.setTimeout(() => {
      const abort = new AbortController();
      at.pending = abort;
      fetchCommuneAt(lon, lat, abort.signal)
        .then((found) => {
          if (!found || this._focus !== "communes") return;
          // La meme que son etiquette si elle en a une : les deux partagent alors un accent.
          const place = (found.code && this._places.withCode(found.code)) || this._strays.get(found.code!) || found;
          place.rings ??= found.rings;
          if (place === found) this._strays.set(found.code!, found);
          at.place = place;
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) console.warn("[Labels] commune introuvable", error);
        })
        .finally(() => (at.pending = null));
    }, COMMUNE_LOOKUP_MS);
    return null;
  }

  /** Communes trouvees sous le pointeur sans etiquette : gardees, pour qu'un retour reprenne le meme accent. */
  private readonly _strays = new Map<string, Place>();

  /** Part decouverte de la carte sous la page d'entree : les noms attendent qu'elle le soit entierement. */
  private _intro = 0;

  /** Part dessinee voulue par l'intro : les noms arrivent apres le trait. */
  set intro(value: number) {
    this._intro = value;
  }

  /** Point au sol a l'ecran, null hors de l'ecran. */
  private _ground(place: Place): { x: number; y: number } | null {
    const scene = this._terrain.sceneOf(place.lon, place.lat);
    const at = this._project(this._point.set(scene.x, this._terrain.heightAt(scene.x, scene.z), scene.z), this._camera());
    const { clientWidth: width, clientHeight: height } = this._canvas;
    return at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height ? at : null;
  }

  private _project(point: Vector3, camera: Camera): { x: number; y: number } {
    point.project(camera);
    return { x: ((point.x + 1) / 2) * this._canvas.clientWidth, y: ((1 - point.y) / 2) * this._canvas.clientHeight };
  }
}
