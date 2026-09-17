import { NodeBase } from "@_core/nodes/Node.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { PlaceIndex, type Place } from "@graphics/places/PlaceIndex.ts";
import { fetchFrenchCommunes, fetchWorldCities } from "@graphics/places/PlaceSources.ts";
import { Vector3, type Camera } from "three";

const MAX_LABELS = 5;
/** Ecart minimal entre deux points a l'ecran, en px. */
const GAP = { x: 120, y: 70 };
/** Les textes se posent au-dessus du bloc, sur des etages alternes de gauche a droite. */
const SKY_GAP_PX = 80;
const TIER_PX = 72;
const TIERS = 3;
const EASE = 0.2;
/** Bord du bloc ou aucune ville n'est retenue, en fraction de sa largeur. */
const INSET = 0.04;
const TOP_MARGIN_PX = 64;
const RESELECT_MS = 250;
const FADE_MS = 400;

interface Label {
  place: Place;
  root: HTMLElement;
  line: HTMLElement;
  dot: HTMLElement;
  index: HTMLElement;
  tier: number;
  /** Haut de la ligne a l'ecran, lisse. */
  top: number | null;
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
  private readonly _places = new PlaceIndex();
  private readonly _labels = new Map<Place, Label>();
  private readonly _point = new Vector3();
  private _layer: HTMLElement | null = null;
  private _abort: AbortController | null = null;
  private _selection = "";
  private _selectedAt = -Infinity;

  constructor(canvas: HTMLElement, terrain: TerrainNode, camera: () => Camera) {
    super(NODE_ID.LABELS, "Labels");
    this._canvas = canvas;
    this._terrain = terrain;
    this._camera = camera;
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
    const b = this._terrain.bounds;
    const dx = (b.east - b.west) * INSET;
    const dy = (b.north - b.south) * INSET;
    const inner = { west: b.west + dx, east: b.east - dx, south: b.south + dy, north: b.north - dy };
    const taken: { x: number; y: number }[] = [];
    const picked = this._places.pick(inner, MAX_LABELS, (place) => {
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
    const sky = this._skyline();
    for (const label of this._labels.values()) {
      const ground = this._ground(label.place);
      label.root.hidden = !ground;
      if (!ground) continue;
      const target = sky - SKY_GAP_PX - label.tier * TIER_PX;
      label.top = label.top === null ? target : label.top + (target - label.top) * EASE;
      const y = Math.max(TOP_MARGIN_PX, Math.min(label.top, ground.y));
      const length = ground.y - y;
      label.root.style.transform = `translate3d(${ground.x}px, ${y}px, 0)`;
      label.line.style.height = `${length}px`;
      label.dot.style.transform = `translateY(${length}px)`;
    }
  }

  /** Haut du bloc a l'ecran : le plus haut de ses coins, au sommet du relief. */
  private _skyline(): number {
    const { minX, maxX, minZ, maxZ, top } = this._terrain.blockTop;
    const camera = this._camera();
    let sky = Infinity;
    for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]] as const) {
      sky = Math.min(sky, this._project(this._point.set(x, top, z), camera).y);
    }
    return sky;
  }

  /** Point au sol a l'ecran, null hors du bloc ou de l'ecran. */
  private _ground(place: Place): { x: number; y: number } | null {
    const scene = this._terrain.toScene(place.lon, place.lat);
    if (!scene) return null;
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
    this._layer!.append(root);
    const label: Label = {
      place,
      root,
      line: root.querySelector(".map-label__line")!,
      dot: root.querySelector(".map-label__dot")!,
      index: root.querySelector(".map-label__index")!,
      tier: 0,
      top: null,
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
