import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createLabelMaterial, labelSettings, pixelScale } from "@graphics/materials/Label.material.ts";
import { GROUND_FADE } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds } from "@graphics/terrain/GeoProjection.ts";
import { PlaceIndex, type Place } from "@graphics/places/PlaceIndex.ts";
import { createSdfFont, textWidth, type Glyph, type SdfFont } from "@graphics/text/SdfFont.ts";
import { MAP_FOCUS, type MapFocusId } from "@graphics/config/focus.config.ts";
import { fetchAreas } from "@graphics/places/AdminAreas.ts";
import { AreaMaskHelper } from "@graphics/places/AreaMask.helper.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { FrenchCommunesHelper } from "./FrenchCommunes.helper.ts";
import { fetchCommuneRings, fetchWorldCities } from "@graphics/places/PlaceSources.ts";
import {
  BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
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
/** Ecart minimal entre deux points a l'ecran, en px. */
const GAP = { x: 120, y: 70 };
/** Longueur des lignes : etages alternes de gauche a droite, pour que deux textes voisins ne se couvrent pas. */
const LINE_PX = 90;
const TIER_PX = 64;
const TIERS = 3;
const EASE = 0.2;
/** Vitesse de l'apparition et de la sortie des etiquettes (part par seconde). */
const FADE_PER_S = 3.2;
/** Vitesse a laquelle le rouge gagne le territoire survole, et le quitte. */
const HOVER_PER_S = 2.2;
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
  /** Plan invisible a la taille du nom : seule cible du raycast. */
  proxy: Mesh;
  quads: number;
  place: Place | null;
  /** Part survolee, lissee : elle teinte le texte et allonge son filet. */
  hover: number;
}

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
}

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
  /** Contour du lieu survole, donne au sol pour qu'il le marque (`terrainSettings.hoverArea`). */
  private readonly _mask = new AreaMaskHelper();
  private _focus: MapFocusId = "communes";
  /** Rien ne bouge plus dans les etiquettes : l'univers peut alors sauter des images (voir `settled`). */
  private _settled = false;
  private _aiming = false;
  /** Pas d'interpolation du survol de l'image courante, borne comme les autres (voir `_breathe`). */
  private _hoverStep = 0.2;
  /** Part apparue des etiquettes, et sa cible : le changement de niveau les fait sortir puis revenir. */
  private readonly _fade = { value: 1, target: 1 };
  /** Niveau demande pendant que les etiquettes s'effacent ; applique une fois qu'elles ont disparu. */
  private _wanted: MapFocusId | null = null;

  constructor(canvas: HTMLElement, terrain: TerrainNode, camera: () => Camera, onSelect: (place: Place) => void) {
    // L'objet du noeud reste vide : les etiquettes vivent dans leur propre scene, posee sur l'image finie.
    super(NODE_ID.LABELS, "Labels", new Group());
    this._scene = new Scene();
    this._canvas = canvas;
    this._terrain = terrain;
    this._camera = camera;
    this._onSelect = onSelect;
    // Posee ici, avant la premiere image : un materiau deja compile garderait la texture d'attente.
    terrainSettings.hoverArea.value = this._mask.texture;
  }

  /**
   * Niveau nomme par la carte. Les etiquettes sortent d'abord, le niveau ne change qu'une fois la page nette,
   * et les nouvelles reviennent : on ne voit jamais deux jeux de noms se croiser.
   */
  setFocus(focus: MapFocusId): void {
    if (focus === this._focus || focus === this._wanted) return;
    this._wanted = focus;
    this._fade.target = 0;
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
    this._markHovered(null);
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
    for (let i = 0; i < MAX_LABELS; i++) this._rigs.push(this._rig(material));
    this._canvas.addEventListener("pointermove", this._onMove);
    this._canvas.addEventListener("pointerdown", this._onClick);
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
    if (selection !== this._selection && now - this._selectedAt > RESELECT_MS) {
      this._selection = selection;
      this._selectedAt = now;
      this._select();
    }
    this._layout();
  }

  /**
   * Apparition, sortie et montee du rouge : tout ce qui avance tout seul d'une image a l'autre. Le niveau
   * demande n'est applique qu'une fois les etiquettes sorties.
   */
  private _breathe(dt: number): void {
    const capped = Math.min(dt, MAX_STEP_MS);
    const step = (value: number, target: number, perSecond: number) => {
      const k = Math.min(1, (capped / 1000) * perSecond);
      return Math.abs(target - value) < SETTLED ? target : value + (target - value) * k;
    };
    this._fade.value = step(this._fade.value, this._fade.target, FADE_PER_S);
    if (this._wanted && this._fade.value <= SETTLED) {
      this._applyFocus(this._wanted);
      this._wanted = null;
      this._fade.target = 1;
    }
    labelSettings.reveal.value = this._fade.value * this._intro;
    const wanted = this._marked ? 1 : 0;
    this._hoverReveal = step(this._hoverReveal, wanted, HOVER_PER_S);
    terrainSettings.hoverReveal.value = this._hoverReveal;
    this._hoverStep = Math.min(1, (capped / 1000) * LABEL_HOVER_PER_S);
  }

  override dispose(): void {
    this._release();
    this._mask.dispose();
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
    geometry.setAttribute("glyph", glyphs);
    geometry.setAttribute("screen", screen);
    geometry.setAttribute("tint", tints);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    const proxy = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
    // Jamais dessine, mais le raycast ne regarde pas la visibilite : c'est la zone du nom.
    proxy.visible = false;
    const group = new Group();
    group.add(mesh, proxy);
    group.visible = false;
    this._scene.add(group);
    return { group, mesh, geometry, glyphs, screen, tints, proxy, quads: 0, place: null, hover: 0 };
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
    this._labels.clear();
    this._selection = "";
  }

  private readonly _onMove = (event: PointerEvent): void => {
    const rect = this._canvas.getBoundingClientRect();
    this._pointer.x = event.clientX - rect.left;
    this._pointer.y = event.clientY - rect.top;
  };

  private readonly _onClick = (): void => {
    if (this._hovered) this._onSelect(this._hovered);
  };

  private _select(): void {
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

    for (const place of [...this._labels.keys()]) if (!picked.includes(place)) this._labels.delete(place);
    picked.forEach((place) => {
      if (!this._labels.has(place)) this._labels.set(place, { place, tier: 0, length: null, box: null });
    });
    const byX = picked.map((place, i) => ({ place, x: taken[i]!.x })).sort((a, b) => a.x - b.x);
    byX.forEach(({ place }, i) => (this._labels.get(place)!.tier = i % TIERS));
    this._order = picked;
  }

  /** Villes retenues, dans l'ordre : c'est lui qui numerote les etiquettes. */
  private _order: Place[] = [];

  private _layout(): void {
    const font = this._font!;
    const camera = this._camera() as PerspectiveCamera;
    const perspective = pixelScale(this._canvas.clientHeight, camera.fov ?? 50);
    camera.getWorldDirection(this._forward);
    let moving = false;
    let index = 0;

    for (const place of this._order) {
      const label = this._labels.get(place);
      const ground = label ? this._ground(place) : null;
      const rig = this._rigs[index];
      if (!label || !ground || !rig) continue;
      index++;
      const scene = this._terrain.sceneOf(place.lon, place.lat);
      this._anchor.set(scene.x, this._terrain.heightAt(scene.x, scene.z), scene.z);
      const target = LINE_PX + label.tier * TIER_PX;
      label.length = label.length === null ? target : label.length + (target - label.length) * EASE;
      if (Math.abs(target - label.length) > 0.5) moving = true;
      // La marge haute garde les etages : sans le decalage, deux noms voisins plaques en haut retombent sur
      // la meme ligne et se superposent.
      const floor = TOP_MARGIN_PX + label.tier * TIER_PX;
      const top = Math.max(floor, ground.y - label.length) - ground.y;

      // Le groupe porte le point ancre, l'orientation de la camera et l'echelle pixel vers scene : dans son
      // repere, une unite vaut un pixel d'ecran. La profondeur de vue, pas la distance : c'est par elle que
      // la perspective divise.
      const depth = Math.abs(this._anchor.clone().sub(camera.position).dot(this._forward));
      rig.group.position.copy(this._anchor);
      rig.group.quaternion.copy(camera.quaternion);
      rig.group.scale.setScalar(perspective * Math.max(depth, 1e-4));
      rig.group.visible = true;
      rig.place = place;
      rig.quads = 0;

      const name = place.name.toUpperCase();
      const width = textWidth(font, name) * TYPE.name;
      // Le survol allonge le filet et souleve le nom : l'etiquette repond avant meme que le sol ne rougisse.
      const lift = rig.hover * TYPE.rule * 0.5;
      this._quad(rig, font.solid, -TYPE.line / 2, top - lift, TYPE.line, -top + lift);
      this._quad(rig, font.disc, -TYPE.dot / 2, -TYPE.dot / 2, TYPE.dot, TYPE.dot);
      this._quad(rig, font.solid, 0, top + TYPE.rule - lift, width * (0.62 + rig.hover * 0.38), 1);
      const drawn = this._text(rig, font, name, 0, top - lift, TYPE.name);

      // Le plan de visee prend la boite du nom, serree sur la hauteur de capitale : la case d'un glyphe
      // deborde en haut (marge du champ de distance) et en bas (hampes).
      const boxTop = top - lift - font.cap * TYPE.name;
      const boxHeight = font.cap * TYPE.name + TYPE.rule;
      rig.proxy.position.set(drawn.left + drawn.width / 2, -(boxTop + boxHeight / 2), 0);
      rig.proxy.scale.set(Math.max(drawn.width, 1), boxHeight, 1);
      label.box = { x: ground.x + drawn.left, y: ground.y + boxTop, width: drawn.width, height: boxHeight };

      for (const attribute of [rig.glyphs, rig.screen, rig.tints]) attribute.needsUpdate = true;
      rig.geometry.instanceCount = rig.quads;
    }
    for (let i = index; i < this._rigs.length; i++) {
      this._rigs[i]!.group.visible = false;
      this._rigs[i]!.place = null;
    }

    const hovered = this._pick(camera);
    this._aiming = this._aim(hovered);
    const changed = hovered !== this._hovered;
    this._hovered = hovered;
    this._canvas.style.cursor = hovered ? "pointer" : "";
    this._markHovered(hovered);
    // Tant qu'une valeur avance, l'univers doit redessiner : sinon la zone de survol continuerait de bouger
    // sous un texte fige sur la derniere image, et l'on ne pourrait plus attraper les noms.
    let hovering = false;
    for (const rig of this._rigs) {
      const wanted = rig.place && rig.place === hovered ? 1 : 0;
      if (Math.abs(wanted - rig.hover) > SETTLED) hovering = true;
      rig.hover += (wanted - rig.hover) * this._hoverStep;
    }
    this._settled =
      !moving &&
      !changed &&
      !hovering &&
      this._wanted === null &&
      Math.abs(this._fade.target - this._fade.value) < SETTLED &&
      Math.abs((this._marked ? 1 : 0) - this._hoverReveal) < SETTLED;
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
    const proxies = this._rigs.filter((rig) => rig.group.visible).map((rig) => rig.proxy);
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
  private _text(rig: Rig, font: SdfFont, text: string, x: number, y: number, size: number): Box {
    let pen = x;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const char of text) {
      const glyph = font.glyphs.get(char);
      if (!glyph) continue;
      const left = pen + glyph.left * size;
      const top = y + glyph.top * size;
      this._quad(rig, glyph, left, top, glyph.width * size, glyph.height * size);
      box.left = Math.min(box.left, left);
      box.top = Math.min(box.top, top);
      box.right = Math.max(box.right, left + glyph.width * size);
      box.bottom = Math.max(box.bottom, top + glyph.height * size);
      pen += glyph.advance * size;
    }
    if (box.left === Infinity) return { left: 0, top: 0, width: 0, height: 0 };
    return { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
  }

  private _quad(rig: Rig, glyph: Glyph, x: number, y: number, width: number, height: number): void {
    if (rig.quads >= MAX_QUADS) return;
    const i = rig.quads++;
    rig.glyphs.array.set([glyph.u, glyph.v, glyph.du, glyph.dv], i * 4);
    rig.screen.array.set([x, y, width, height], i * 4);
    (rig.tints.array as Float32Array)[i] = rig.hover;
  }

  /**
   * Lieu tenu sous la souris : son contour est rasterise et donne au sol, qui marque ses pixels pour que la
   * passe d'encre les colorie. Une commune n'a que son code : son contour est demande au premier survol,
   * puis garde sur le lieu.
   */
  private _markHovered(place: Place | null): void {
    if (place === this._marked) return;
    // Le contour ne s'efface qu'une fois le rouge retire : sinon il disparait d'un coup au lieu de refluer.
    if (!place) {
      this._marked = null;
      return;
    }
    this._marked = place;
    this._draw(place.rings);
    if (!place || place.rings || !place.code) return;
    const abort = this._abort;
    fetchCommuneRings(place.code, abort!.signal)
      .then((rings) => {
        place.rings = rings;
        // Entre-temps la souris a pu partir ailleurs : ne dessiner que si ce lieu est toujours tenu.
        if (this._marked === place) this._draw(rings);
      })
      .catch((error: unknown) => {
        if (!abort?.signal.aborted) console.warn("[Labels] contour indisponible", error);
      });
  }

  private _draw(rings: Place["rings"]): void {
    this._mask.set(rings);
    terrainSettings.hoverBounds.value.copy(this._mask.bounds);
  }

  /** Dernier lieu donne au masque : il ne se redessine que lorsque le survol change. */
  private _marked: Place | null = null;
  /** Part rouge du territoire survole, et part dessinee voulue par l'intro. */
  private _hoverReveal = 0;
  private _intro = 1;

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
