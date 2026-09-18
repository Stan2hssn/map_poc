import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { containsBounds, expandBounds, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import { mosaicUvTransform } from "@graphics/terrain/HeightMosaic.ts";
import { landcoverZoom } from "@graphics/terrain/Landcover.ts";
import type { LandcoverImage, LandcoverRequest } from "@graphics/terrain/Landcover.worker.ts";
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from "three";

/** Image de 2048 px sur 2,5 fois la zone de detail : elle couvre ce que montre l'ecran. */
const SIZE = 2048;
const AREA = 0.75;
/** Zone ou le bati est complet : la zone de detail et un peu plus. Nouvelle image des que la vue en sort. */
const FOCUS = 0.35;
// Pendant un glisser, une demande part au plus a ce rythme.
const REQUEST_MS = 200;

/**
 * Texture de donnees du sol (bati, vegetation, eau, routes), dessinee par un worker
 * a partir du PLAN IGN et recadree sur la vue.
 */
export class LandcoverHelper {
  private readonly _worker = new Worker(new URL("../../terrain/Landcover.worker.ts", import.meta.url), { type: "module" });
  private _requested: { focus: GeoBounds; zoom: number } | null = null;
  private _requestedAt = -Infinity;
  private _id = 0;
  private _shown = 0;
  private _image: GeoBounds | null = null;

  constructor() {
    this._worker.onmessage = ({ data }: MessageEvent<LandcoverImage>) => this._receive(data);
  }

  update(bounds: GeoBounds): void {
    const area = worldClamp(expandBounds(bounds, AREA));
    const zoom = landcoverZoom(area, SIZE);
    const done = this._requested && this._requested.zoom === zoom && containsBounds(this._requested.focus, bounds);
    const now = performance.now();
    if (!done && now - this._requestedAt > REQUEST_MS) {
      const focus = expandBounds(bounds, FOCUS);
      this._requested = { focus, zoom };
      this._requestedAt = now;
      const request: LandcoverRequest = { id: ++this._id, bounds: area, focus, width: SIZE, height: SIZE };
      this._worker.postMessage(request);
    }
    if (!this._image) return;
    const { offset, scale } = mosaicUvTransform(bounds, this._image);
    terrainSettings.landcoverOffset.value.set(...offset);
    terrainSettings.landcoverScale.value.set(...scale);
  }

  dispose(): void {
    this._worker.terminate();
    terrainSettings.landcover.value.dispose();
  }

  private _receive(image: LandcoverImage): void {
    // Une image partielle d'une demande plus ancienne vaut mieux que rien, jamais l'inverse.
    if (image.id < this._shown) return;
    this._shown = image.id;
    const current = terrainSettings.landcover.value as DataTexture;
    const next = new DataTexture(image.data, image.width, image.height, RGBAFormat, UnsignedByteType);
    next.magFilter = LinearFilter;
    next.minFilter = LinearMipmapLinearFilter;
    next.generateMipmaps = true;
    next.needsUpdate = true;
    terrainSettings.landcover.value = next;
    current.dispose();
    this._image = image.bounds;
  }
}

const worldClamp = (b: GeoBounds): GeoBounds => ({
  west: Math.max(-180, b.west),
  east: Math.min(180, b.east),
  south: Math.max(-85, b.south),
  north: Math.min(85, b.north),
});
