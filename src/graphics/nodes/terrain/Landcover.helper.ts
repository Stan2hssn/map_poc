import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { containsBounds, expandBounds, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import { mosaicUvTransform } from "@graphics/terrain/HeightMosaic.ts";
import { PEAK_CELL } from "@graphics/terrain/Buildings.ts";
import { fineZoom, landcoverZoom } from "@graphics/terrain/Landcover.ts";
import type { BuildingsRequest, BuildingsTile, LandcoverImage, LandcoverRequest, TileRef } from "@graphics/terrain/Landcover.worker.ts";
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RedFormat, RGBAFormat, UnsignedByteType, type PixelFormat } from "three";

/** Image de 2048 px sur 2,5 fois la zone de detail : elle couvre ce que montre l'ecran. */
const SIZE = 2048;
const AREA = 0.75;
/** Zone ou le bati est complet : la zone de detail et un peu plus. Nouvelle image des que la vue en sort. */
const FOCUS = 0.35;
// Pendant un glisser, une demande part au plus a ce rythme.
const REQUEST_MS = 200;

/**
 * Texture de donnees du sol (bati, vegetation, eau, routes), dessinee par un worker
 * a partir du PLAN IGN et recadree sur la vue. Le meme worker fournit les hauteurs du bati
 * (parallaxe) et ses volumes par tuile (extrusion).
 */
export class LandcoverHelper {
  /** Volumes d'une tuile demandee par `requestBuildings`. */
  onBuildings: ((tile: BuildingsTile) => void) | null = null;
  /** Derniere image : temps de dessin dans le worker (ms), et delai depuis sa demande jusqu'a l'image complete (ms). */
  readonly stats = { renderMs: 0, loadMs: 0 };
  private readonly _worker = new Worker(new URL("../../terrain/Landcover.worker.ts", import.meta.url), { type: "module" });
  private _requested: { focus: GeoBounds; zoom: number; heights: boolean } | null = null;
  private _requestedAt = -Infinity;
  private _id = 0;
  private _shown = 0;
  private _zoom = 0;
  private _image: GeoBounds | null = null;
  private _heights: GeoBounds | null = null;

  constructor() {
    this._worker.onmessage = ({ data }: MessageEvent<LandcoverImage | BuildingsTile>) => this._receive(data);
  }

  /** Niveau ou le PLAN IGN a tout le bati, pour la vue courante. */
  get fineZoom(): number {
    return fineZoom(this._zoom);
  }

  /**
   * `bounds` : la vue affichee ; `target` : celle a charger (l'arrivee d'un vol, sans les vues traversees).
   * `heights` : dessiner aussi les hauteurs du bati.
   */
  update(bounds: GeoBounds, heights: boolean, target: GeoBounds = bounds): void {
    const area = worldClamp(expandBounds(target, AREA));
    const zoom = landcoverZoom(area, SIZE);
    this._zoom = zoom;
    const r = this._requested;
    const done = r && r.zoom === zoom && r.heights === heights && containsBounds(r.focus, target);
    const now = performance.now();
    if (!done && now - this._requestedAt > REQUEST_MS) {
      const focus = expandBounds(target, FOCUS);
      this._requested = { focus, zoom, heights };
      this._requestedAt = now;
      const request: LandcoverRequest = { kind: "landcover", id: ++this._id, bounds: area, focus, width: SIZE, height: SIZE, heights };
      this._worker.postMessage(request);
    }
    const s = terrainSettings;
    if (this._image) {
      const { offset, scale } = mosaicUvTransform(bounds, this._image);
      s.landcoverOffset.value.set(...offset);
      s.landcoverScale.value.set(...scale);
    }
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
    terrainSettings.landcover.value.dispose();
    terrainSettings.buildingHeights.value.dispose();
    terrainSettings.buildingPeaks.value.dispose();
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
    if (message.complete && message.id === this._id) this.stats.loadMs = performance.now() - this._requestedAt;
    const s = terrainSettings;
    swap(s.landcover, mipmapped(message.data, message.width, message.height, RGBAFormat));
    this._image = message.bounds;
    if (!message.buildingHeights || !message.buildingPeaks) return;
    swap(s.buildingHeights, mipmapped(message.buildingHeights, message.width, message.height, RedFormat));
    const peaks = new DataTexture(message.buildingPeaks, Math.ceil(message.width / PEAK_CELL), Math.ceil(message.height / PEAK_CELL), RedFormat);
    peaks.minFilter = peaks.magFilter = NearestFilter;
    peaks.needsUpdate = true;
    swap(s.buildingPeaks, peaks);
    s.buildingSize.value.set(message.width, message.height);
    s.buildingMax.value = message.buildingMax;
    this._heights = message.focus;
  }
}

function mipmapped(data: Uint8Array, width: number, height: number, format: PixelFormat): DataTexture {
  const texture = new DataTexture(data, width, height, format, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function swap(node: { value: unknown }, next: DataTexture): void {
  const current = node.value as DataTexture;
  node.value = next;
  current.dispose();
}

const worldClamp = (b: GeoBounds): GeoBounds => ({
  west: Math.max(-180, b.west),
  east: Math.min(180, b.east),
  south: Math.max(-85, b.south),
  north: Math.min(85, b.north),
});
