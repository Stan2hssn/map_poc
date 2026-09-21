import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { containsBounds, expandBounds, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import { mosaicUvTransform } from "@graphics/terrain/HeightMosaic.ts";
import { PEAK_CELL, SUMMIT_CELL } from "@graphics/terrain/Buildings.ts";
import { fineZoom, landcoverZoom } from "@graphics/terrain/Landcover.ts";
import type { BuildingsRequest, BuildingsTile, LandcoverImage, LandcoverRequest, TileRef } from "@graphics/terrain/Landcover.worker.ts";
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoColorSpace, RedFormat, Texture, UnsignedByteType } from "three";

/** Image de 2048 px sur 2,5 fois la zone de detail : elle couvre ce que montre l'ecran. */
const SIZE = 2048;
const AREA = 0.75;
/** Zone ou le bati est complet : la zone de detail et un peu plus. Nouvelle image des que la vue en sort. */
const FOCUS = 0.35;
// Une demande part au plus a ce rythme ; en mouvement, plus rarement : chaque image redessinee puis envoyee au
// GPU (2 x 2048 px et leurs mipmaps) fait sauter des images, c'etait la cause des a-coups au zoom.
const REQUEST_MS = 200;
const MOVING_REQUEST_MS = 600;
/** Une nouvelle image se fond dans la precedente en ce temps (ms). */
const REVEAL_MS = 1000;

/**
 * Texture de donnees du sol (bati, vegetation, eau, routes), dessinee par un worker
 * a partir du PLAN IGN et recadree sur la vue. Le meme worker fournit les hauteurs du bati
 * (parallaxe) et ses volumes par tuile (extrusion).
 */
export class LandcoverHelper {
  /** Volumes d'une tuile demandee par `requestBuildings`. */
  onBuildings: ((tile: BuildingsTile) => void) | null = null;
  /** Nouvelles hauteurs du bati : tuiles (`z/x/y`) qu'elles contiennent. */
  onHeights: ((tiles: ReadonlySet<string>) => void) | null = null;
  /** Derniere image : temps de dessin dans le worker (ms), et delai depuis sa demande jusqu'a l'image complete (ms). */
  readonly stats = { renderMs: 0, loadMs: 0 };
  private readonly _worker = new Worker(new URL("../../terrain/Landcover.worker.ts", import.meta.url), { type: "module" });
  private _requested: { focus: GeoBounds; zoom: number; heights: boolean; sun: string } | null = null;
  private _requestedAt = -Infinity;
  private _id = 0;
  private _shown = 0;
  private _image: GeoBounds | null = null;
  private _previous: GeoBounds | null = null;
  private _shownAt = -Infinity;
  private _heights: GeoBounds | null = null;
  /** L'image affichee est l'image complete de la derniere demande, et celle-ci couvre la vue voulue. */
  private _complete = false;
  private _upToDate = false;

  constructor() {
    this._worker.onmessage = ({ data }: MessageEvent<LandcoverImage | BuildingsTile>) => this._receive(data);
  }

  /** Vrai quand le plan de la vue demandee est arrive en entier et fini d'apparaitre. */
  get complete(): boolean {
    return this._complete && this._upToDate && terrainSettings.landcoverReveal.value >= 1;
  }

  /** Niveau ou le PLAN IGN a tout le bati, pour la vue `bounds` (celui de ses images). */
  fineZoomOf(bounds: GeoBounds): number {
    return fineZoom(landcoverZoom(worldClamp(expandBounds(bounds, AREA)), SIZE));
  }

  /**
   * `bounds` : la vue affichee ; `target` : celle a charger (l'arrivee d'un vol, sans les vues traversees).
   * `heights` : dessiner aussi les hauteurs du bati. `moving` : la vue bouge ; l'image courante suffit tant
   * qu'elle la couvre avec au plus un niveau de retard, l'image exacte viendra a l'arret.
   */
  update(bounds: GeoBounds, heights: boolean, target: GeoBounds = bounds, moving = false): void {
    const area = worldClamp(expandBounds(target, AREA));
    const zoom = landcoverZoom(area, SIZE);
    const r = this._requested;
    const s = terrainSettings;
    // Soleil deplace (panneau) : l'ombre du bati est a refaire.
    const sun = s.sun.value.toArray() as [number, number, number];
    const sunKey = heights ? sun.map((v) => v.toFixed(3)).join() : "";
    const close = !!r && (moving ? Math.abs(r.zoom - zoom) <= 1 : r.zoom === zoom);
    const done = r && close && r.heights === heights && r.sun === sunKey && containsBounds(r.focus, target);
    // Sans cela, l'image complete d'une vue quittee (celle d'avant un saut) passerait pour celle de la vue.
    this._upToDate = !!done;
    const now = performance.now();
    if (!done && now - this._requestedAt > (moving ? MOVING_REQUEST_MS : REQUEST_MS)) {
      const focus = expandBounds(target, FOCUS);
      this._requested = { focus, zoom, heights, sun: sunKey };
      this._requestedAt = now;
      this._complete = false;
      this._upToDate = true;
      const request: LandcoverRequest = { kind: "landcover", id: ++this._id, bounds: area, focus, width: SIZE, height: SIZE, heights, sun };
      this._worker.postMessage(request);
    }
    if (this._image) {
      const { offset, scale } = mosaicUvTransform(bounds, this._image);
      s.landcoverOffset.value.set(...offset);
      s.landcoverScale.value.set(...scale);
    }
    if (this._previous) {
      const { offset, scale } = mosaicUvTransform(bounds, this._previous);
      s.landcoverPreviousOffset.value.set(...offset);
      s.landcoverPreviousScale.value.set(...scale);
    }
    s.landcoverReveal.value = Math.min(1, (now - this._shownAt) / REVEAL_MS);
    if (this._heights) {
      const { offset, scale } = mosaicUvTransform(bounds, this._heights);
      s.buildingOffset.value.set(...offset);
      s.buildingScale.value.set(...scale);
    }
  }

  /** Volumes des tuiles qui manquent ; remplace la demande precedente. */
  requestBuildings(tiles: TileRef[]): void {
    const request: BuildingsRequest = { kind: "buildings", tiles };
    this._worker.postMessage(request);
  }

  dispose(): void {
    this._worker.terminate();
    const s = terrainSettings;
    for (const node of [s.landcover, s.landcoverRoads, s.landcoverPrevious, s.landcoverRoadsPrevious]) {
      const texture = node.value;
      if (texture.image instanceof ImageBitmap) texture.image.close();
      texture.dispose();
    }
    terrainSettings.buildingHeights.value.dispose();
    terrainSettings.buildingPeaks.value.dispose();
    terrainSettings.buildingSummits.value.dispose();
    terrainSettings.buildingShade.value.dispose();
  }

  private _receive(message: LandcoverImage | BuildingsTile): void {
    if (message.kind === "buildings") {
      this.onBuildings?.(message);
      return;
    }
    // Une image partielle d'une demande plus ancienne vaut mieux que rien, jamais l'inverse.
    if (message.id < this._shown) return;
    this._shown = message.id;
    this.stats.renderMs = message.renderMs;
    this._complete = message.complete && message.id === this._id;
    if (this._complete) this.stats.loadMs = performance.now() - this._requestedAt;
    const s = terrainSettings;
    show(s.landcover, s.landcoverPrevious, message.areas);
    show(s.landcoverRoads, s.landcoverRoadsPrevious, message.roads);
    this._previous = this._image;
    this._image = message.bounds;
    this._shownAt = performance.now();
    if (!message.buildingHeights || !message.buildingPeaks || !message.buildingSummits || !message.buildingShade) return;
    const { width, height } = message;
    refill(s.buildingHeights, message.buildingHeights, width, height, true);
    refill(s.buildingPeaks, message.buildingPeaks, Math.ceil(width / PEAK_CELL), Math.ceil(height / PEAK_CELL), false);
    refill(s.buildingSummits, message.buildingSummits, Math.ceil(width / SUMMIT_CELL), Math.ceil(height / SUMMIT_CELL), false);
    refill(s.buildingShade, message.buildingShade, width, height, true);
    s.buildingSize.value.set(message.width, message.height);
    s.buildingMax.value = message.buildingMax;
    this._heights = message.focus;
    this.onHeights?.(new Set(message.heightTiles));
  }
}

/**
 * Image du worker dans `current` ; l'image affichee jusque-la passe dans `previous`, sur laquelle la nouvelle se
 * dessine. Deux textures qui echangent leur role : a taille egale, la plus ancienne recoit la nouvelle image
 * (copie sur le GPU, sans nouvelle allocation).
 */
function show(current: { value: Texture }, previous: { value: Texture }, image: ImageBitmap): void {
  const shown = current.value;
  const spare = previous.value;
  const old = spare.image as unknown;
  let next = spare;
  if (old instanceof ImageBitmap && old.width === image.width && old.height === image.height) {
    spare.image = image;
    spare.needsUpdate = true;
  } else {
    next = new Texture(image);
    // Ligne 0 au nord, comme les autres mosaiques ; donnees, pas couleurs.
    next.flipY = false;
    next.colorSpace = NoColorSpace;
    next.magFilter = LinearFilter;
    next.minFilter = LinearMipmapLinearFilter;
    next.generateMipmaps = true;
    next.needsUpdate = true;
    spare.dispose();
  }
  if (old instanceof ImageBitmap) old.close();
  previous.value = shown;
  current.value = next;
}

/**
 * Nouvelles valeurs dans la texture de `node` : la meme texture si la taille ne change pas (pas de nouvelle
 * allocation sur le GPU a chaque image). `smooth` : filtree et mip-mappee (hauteurs), sinon lue telle quelle (sommets).
 */
function refill(node: { value: Texture }, data: Uint8Array, width: number, height: number, smooth: boolean): void {
  const current = node.value as DataTexture;
  if (current.image.width === width && current.image.height === height) {
    current.image.data = data;
    current.needsUpdate = true;
    return;
  }
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.magFilter = smooth ? LinearFilter : NearestFilter;
  texture.minFilter = smooth ? LinearMipmapLinearFilter : NearestFilter;
  texture.generateMipmaps = smooth;
  texture.needsUpdate = true;
  node.value = texture;
  current.dispose();
}

const worldClamp = (b: GeoBounds): GeoBounds => ({
  west: Math.max(-180, b.west),
  east: Math.min(180, b.east),
  south: Math.max(-85, b.south),
  north: Math.min(85, b.north),
});
