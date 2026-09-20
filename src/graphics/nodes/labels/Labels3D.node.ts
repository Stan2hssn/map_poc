import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createLabelMaterial, labelViewport } from "@graphics/materials/Label.material.ts";
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
  Scene,
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
/** Quadrilateres reserves : sept etiquettes, leur trait, leur point et une trentaine de caracteres. */
const MAX_QUADS = MAX_LABELS * 36;
/** Police des etiquettes : celle de la page (voir `--font-map`), et sa graisse. */
const FONT = '"Manrope", system-ui, sans-serif';
const WEIGHT = 600;


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
  private readonly _mesh: Mesh;
  /** Scene a part : l'interface est posee sur l'image finie, pas dessinee avec le terrain. */
  private readonly _scene: Scene;
  private readonly _glyphs = new InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
  private readonly _screen = new InstancedBufferAttribute(new Float32Array(MAX_QUADS * 4), 4);
  private readonly _anchors = new InstancedBufferAttribute(new Float32Array(MAX_QUADS * 3), 3);
  private _quads = 0;
  /** Souris a l'ecran (px), et lieu survole. */
  private readonly _pointer = { x: -1, y: -1 };
  private _hovered: Place | null = null;
  /** Contour du lieu survole, donne au sol pour qu'il le marque (`terrainSettings.hoverArea`). */
  private readonly _mask = new AreaMaskHelper();
  private _focus: MapFocusId = "communes";

  constructor(canvas: HTMLElement, terrain: TerrainNode, camera: () => Camera, onSelect: (place: Place) => void) {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new Mesh(geometry, undefined);
    mesh.frustumCulled = false;
    // L'objet du noeud reste vide : les etiquettes vivent dans leur propre scene, rendue a part (`draw`).
    super(NODE_ID.LABELS, "Labels", new Group());
    this._mesh = mesh;
    this._scene = new Scene();
    this._scene.add(mesh);
    geometry.setAttribute("glyph", this._glyphs);
    geometry.setAttribute("screen", this._screen);
    geometry.setAttribute("anchor", this._anchors);
    this._canvas = canvas;
    this._terrain = terrain;
    this._camera = camera;
    this._onSelect = onSelect;
    // Posee ici, avant la premiere image : un materiau deja compile garderait la texture d'attente.
    terrainSettings.hoverArea.value = this._mask.texture;
  }

  /** Niveau nomme par la carte. Changer de niveau vide les lieux et recharge la source qui convient. */
  setFocus(focus: MapFocusId): void {
    if (focus === this._focus) return;
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
    this._mesh.material = createLabelMaterial(this._font.texture);
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

  override update(): void {
    if (!this._font) return;
    // Pas pendant un vol : il traverserait des departements pour rien.
    if (!this._terrain.flying) this._communes?.update(this._terrain.bounds, this._terrain.extentKm);
    const selection = `${this._terrain.viewVersion}:${this._places.version}`;
    const now = performance.now();
    if (selection !== this._selection && now - this._selectedAt > RESELECT_MS) {
      this._selection = selection;
      this._selectedAt = now;
      this._select();
    }
    labelViewport(this._canvas.clientWidth, this._canvas.clientHeight, (this._camera() as PerspectiveCamera).fov ?? 50);
    this._layout();
  }

  override dispose(): void {
    this._release();
    this._mask.dispose();
    (this._mesh.material as Material | undefined)?.dispose();
    this._mesh.geometry.dispose();
    super.dispose();
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
    this._quads = 0;
    let hovered: Place | null = null;
    for (const place of this._order) {
      const label = this._labels.get(place);
      const ground = label ? this._ground(place) : null;
      if (!label || !ground) continue;
      const scene = this._terrain.sceneOf(place.lon, place.lat);
      // Point ancre des quadrilateres a venir : `_quad` le lit, il n'est pas recopie par instance.
      this._point.set(scene.x, this._terrain.heightAt(scene.x, scene.z), scene.z);
      const target = LINE_PX + label.tier * TIER_PX;
      label.length = label.length === null ? target : label.length + (target - label.length) * EASE;
      const top = Math.max(TOP_MARGIN_PX, ground.y - label.length) - ground.y;

      // Trait du point vers le texte, et point pose au sol.
      this._quad(font.solid, -TYPE.line / 2, top, TYPE.line, -top);
      this._quad(font.disc, -TYPE.dot / 2, -TYPE.dot / 2, TYPE.dot, TYPE.dot);

      const name = place.name.toUpperCase();
      const width = textWidth(font, name) * TYPE.name;
      // Filet sous le nom, comme sur les maquettes.
      this._quad(font.solid, 0, top + TYPE.rule, width * 0.62, 1);
      // La boite cliquable est tiree des quadrilateres effectivement ecrits, pas recalculee a cote : c'est le
      // seul moyen qu'elle ne puisse pas deriver du texte, quelles que soient les metriques de la police.
      const drawn = this._text(font, name, 0, top, TYPE.name);
      // Serree sur le dessin : la case d'un glyphe deborde en haut (marge du champ) et en bas (hampes).
      const box = {
        x: ground.x + drawn.left,
        y: ground.y + top - font.cap * TYPE.name,
        width: drawn.width,
        height: font.cap * TYPE.name + TYPE.rule,
      };
      label.box = box;
      const over =
        this._pointer.x >= box.x && this._pointer.x <= box.x + box.width && this._pointer.y >= box.y && this._pointer.y <= box.y + box.height;
      if (over) hovered = place;
    }
    this._hovered = hovered;
    this._canvas.style.cursor = hovered ? "pointer" : "";
    this._markHovered(hovered);
    for (const attribute of [this._glyphs, this._screen, this._anchors]) attribute.needsUpdate = true;
    (this._mesh.geometry as InstancedBufferGeometry).instanceCount = this._quads;
  }

  /**
   * Suite de caracteres a partir du point d'ecriture (x, y) : chacun avance du sien. Rend la boite des
   * quadrilateres poses, en decalage depuis le point ancre — de quoi en faire une zone cliquable exacte.
   */
  private _text(font: SdfFont, text: string, x: number, y: number, size: number): Box {
    let pen = x;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const char of text) {
      const glyph = font.glyphs.get(char);
      if (!glyph) continue;
      const left = pen + glyph.left * size;
      const top = y + glyph.top * size;
      this._quad(glyph, left, top, glyph.width * size, glyph.height * size);
      box.left = Math.min(box.left, left);
      box.top = Math.min(box.top, top);
      box.right = Math.max(box.right, left + glyph.width * size);
      box.bottom = Math.max(box.bottom, top + glyph.height * size);
      pen += glyph.advance * size;
    }
    if (box.left === Infinity) return { left: 0, top: 0, width: 0, height: 0 };
    return { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
  }

  private _quad(glyph: Glyph, x: number, y: number, width: number, height: number): void {
    if (this._quads >= MAX_QUADS) return;
    const i = this._quads++;
    this._glyphs.array.set([glyph.u, glyph.v, glyph.du, glyph.dv], i * 4);
    this._screen.array.set([x, y, width, height], i * 4);
    this._anchors.array.set([this._point.x, this._point.y, this._point.z], i * 3);
  }

  /**
   * Lieu tenu sous la souris : son contour est rasterise et donne au sol, qui marque ses pixels pour que la
   * passe d'encre les colorie. Une commune n'a que son code : son contour est demande au premier survol,
   * puis garde sur le lieu.
   */
  private _markHovered(place: Place | null): void {
    if (place === this._marked) return;
    this._marked = place;
    this._draw(place?.rings);
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
