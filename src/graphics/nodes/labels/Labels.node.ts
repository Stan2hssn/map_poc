import { NodeBase } from "@_core/nodes/Node.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { GROUND_FADE } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { expandBounds } from "@graphics/terrain/GeoProjection.ts";
import { PlaceIndex, type Place } from "@graphics/places/PlaceIndex.ts";
import { fetchFrenchCommunes, fetchWorldCities } from "@graphics/places/PlaceSources.ts";
import { Vector3, type Camera } from "three";

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
const TOP_MARGIN_PX = 48;
const RESELECT_MS = 250;
const FADE_MS = 400;

interface Label {
  place: Place;
  root: HTMLElement;
  line: HTMLElement;
  dot: HTMLElement;
  index: HTMLElement;
  tier: number;
  /** Longueur de la ligne a l'ecran, lissee. */
  length: number | null;
  leaving: boolean;
}

/**
 * Villes les plus peuplees de la vue, en etiquettes : point au sol, ligne pointillee
 * verticale, numero et nom. Calque DOM au-dessus du canvas, place a chaque image.
 */
export class LabelsNode extends NodeBase {
  private readonly _canvas: HTMLElement;
  private readonly _terrain: TerrainNode;
  private readonly _camera: () => Camera;
  private readonly _onSelect: (place: Place) => void;
  private readonly _places = new PlaceIndex();
  private readonly _labels = new Map<Place, Label>();
  private readonly _point = new Vector3();
  private _layer: HTMLElement | null = null;
  private _abort: AbortController | null = null;
  private _selection = "";
  private _selectedAt = -Infinity;

  constructor(canvas: HTMLElement, terrain: TerrainNode, camera: () => Camera, onSelect: (place: Place) => void) {
    super(NODE_ID.LABELS, "Labels");
    this._canvas = canvas;
    this._terrain = terrain;
    this._camera = camera;
    this._onSelect = onSelect;
  }

  override onMounted(): void {
    super.onMounted();
    this._layer = document.createElement("div");
    this._layer.className = "map-labels";
    this._canvas.parentElement?.append(this._layer);
    this._load();
  }

  override onUnmounted(): void {
    this._release();
    super.onUnmounted();
  }

  override update(): void {
    if (!this._layer) return;
    const selection = `${this._terrain.viewVersion}:${this._places.version}`;
    const now = performance.now();
    if (selection !== this._selection && now - this._selectedAt > RESELECT_MS) {
      this._selection = selection;
      this._selectedAt = now;
      this._select();
    }
    this._layout();
  }

  override dispose(): void {
    this._release();
    super.dispose();
  }

  // Villes du monde (agglomerations) et communes francaises : une ville presente des deux cotes garde sa plus grande population.
  private _load(): void {
    const abort = new AbortController();
    this._abort = abort;
    const warn = (error: unknown) => {
      if (!abort.signal.aborted) console.warn("[Labels] lieux indisponibles", error);
    };
    fetchWorldCities(abort.signal)
      .then((places) => this._places.add(places))
      .catch(warn);
    fetchFrenchCommunes(abort.signal)
      .then((places) => this._places.add(places))
      .catch(warn);
  }

  private _release(): void {
    this._abort?.abort();
    this._abort = null;
    this._layer?.remove();
    this._layer = null;
    this._labels.clear();
    this._selection = "";
  }

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

    for (const label of this._labels.values()) {
      if (!picked.includes(label.place)) this._leave(label);
    }
    picked.forEach((place, rank) => {
      const existing = this._labels.get(place);
      const label = existing ?? this._enter(place);
      label.leaving = false;
      label.index.textContent = String(rank + 1).padStart(2, "0");
      if (existing) label.root.classList.add("is-visible");
    });
    const byX = picked.map((place, i) => ({ place, x: taken[i]!.x })).sort((a, b) => a.x - b.x);
    byX.forEach(({ place }, i) => (this._labels.get(place)!.tier = i % TIERS));
  }

  private _layout(): void {
    for (const label of this._labels.values()) {
      const ground = this._ground(label.place);
      label.root.hidden = !ground;
      if (!ground) continue;
      const target = LINE_PX + label.tier * TIER_PX;
      label.length = label.length === null ? target : label.length + (target - label.length) * EASE;
      const y = Math.max(TOP_MARGIN_PX, ground.y - label.length);
      const length = ground.y - y;
      label.root.style.transform = `translate3d(${ground.x}px, ${y}px, 0)`;
      label.line.style.height = `${length}px`;
      label.dot.style.transform = `translateY(${length}px)`;
    }
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

  private _enter(place: Place): Label {
    const root = document.createElement("div");
    root.className = "map-label";
    root.innerHTML =
      '<span class="map-label__line"></span><span class="map-label__dot"></span>' +
      '<span class="map-label__text"><span class="map-label__index"></span><span class="map-label__name"></span></span>';
    root.querySelector(".map-label__name")!.textContent = place.name;
    root.querySelector(".map-label__text")!.addEventListener("click", () => this._onSelect(place));
    this._layer!.append(root);
    const label: Label = {
      place,
      root,
      line: root.querySelector(".map-label__line")!,
      dot: root.querySelector(".map-label__dot")!,
      index: root.querySelector(".map-label__index")!,
      tier: 0,
      length: null,
      leaving: false,
    };
    this._labels.set(place, label);
    // Style calcule a opacite nulle avant la classe, sinon le fondu d'entree est saute.
    void root.offsetWidth;
    root.classList.add("is-visible");
    return label;
  }

  private _leave(label: Label): void {
    if (label.leaving) return;
    label.leaving = true;
    label.root.classList.remove("is-visible");
    setTimeout(() => {
      if (!label.leaving) return;
      label.root.remove();
      this._labels.delete(label.place);
    }, FADE_MS);
  }
}
