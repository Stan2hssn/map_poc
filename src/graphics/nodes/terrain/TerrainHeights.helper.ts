import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import { containsBounds, expandBounds, tileBounds, tilesCovering, type GeoBounds } from "@graphics/terrain/GeoProjection.ts";
import {
  composeMosaic,
  mosaicRange,
  mosaicSample,
  mosaicUvTransform,
  type HeightMosaic,
} from "@graphics/terrain/HeightMosaic.ts";
import { TileCache } from "@graphics/terrain/TileCache.ts";
import { DataTexture, HalfFloatType, LinearFilter, MathUtils, RedFormat, UnsignedByteType, type TextureDataType } from "three";
import type { TextureNode } from "three/webgpu";

const C = TERRAIN_CONFIG;
// Pendant un chargement ou un vol, une mosaique est recomposee au plus a ce rythme.
const RECOMPOSE_MS = 150;
// Tuiles de l'apercu completees depuis leur parent, gardees pour les recompositions (~130 Ko chacune).
const MAX_FILLS = 128;

/** Ce que le bloc montre, ou montrera a la fin d'un vol. */
export interface HeightsView {
  bounds: GeoBounds;
  level: number;
  center: { lon: number; lat: number };
}

interface Layer {
  mosaic: HeightMosaic;
  level: number;
  loads: number;
  composedAt: number;
}

/**
 * Altitudes du bloc en deux couches : le detail, avec ses trous, et un apercu toujours complet,
 * au niveau le plus fin deja charge (trois niveaux sous le detail au mieux). Le shader passe de
 * l'un a l'autre selon le masque du detail : ce qui manque est approche, jamais plat.
 */
export class TerrainHeightsHelper {
  /** Incremente a chaque recomposition. */
  version = 0;
  private readonly _cache: TileCache;
  private readonly _fills = new Map<string, Uint16Array>();
  private _detail: Layer | null = null;
  private _coarse: Layer | null = null;
  private _loads = 0;
  private _requested = "";

  constructor(provider: IElevationProvider) {
    this._cache = new TileCache(provider, C.cacheTiles, () => this._loads++);
  }

  get ready(): boolean {
    return !!this._detail && !!this._coarse;
  }

  /** Vrai quand l'apercu du niveau `level` est charge sur `bounds`. */
  coarseLoaded(bounds: GeoBounds, level: number): boolean {
    const z = coarseLevel(level);
    return tilesCovering(z, bounds).every(({ x, y }) => this._cache.get(z, x, y));
  }

  get pendingCount(): number {
    return this._cache.pendingCount;
  }

  /**
   * Demande les tuiles, recompose ce qui doit l'etre. En vol, les tuiles de `destination`
   * passent en premier et le detail est recompose moins souvent.
   */
  update(view: HeightsView, destination: HeightsView | null = null): void {
    const { bounds, level } = view;
    const moving = !!destination;
    this._request(destination ? [...requests(destination, true), ...requests(view, false)] : requests(view, true));
    const area = expandBounds(bounds, 0.5);
    const coarse = this._loadedLevel(coarseLevel(level), area);
    if (this._due(this._coarse, coarse, bounds, false, true)) {
      this._coarse = this._compose(coarse, area, this._fills);
      upload(terrainSettings.coarseHeights, this._coarse.mosaic.data, this._coarse.mosaic, HalfFloatType);
      for (const key of this._fills.keys()) {
        if (this._fills.size <= MAX_FILLS) break;
        this._fills.delete(key);
      }
    }
    if (this._due(this._detail, level, bounds, moving)) {
      this._detail = this._compose(level, expandBounds(bounds, 0.05));
      const { mosaic } = this._detail;
      upload(terrainSettings.heights, mosaic.data, mosaic, HalfFloatType);
      upload(terrainSettings.valid, mosaic.valid!, mosaic, UnsignedByteType);
    }
    this._syncUniforms(bounds);
  }

  /** Altitude (m), du detail vers l'apercu selon la part de donnees, comme le shader. */
  heightAt(lon: number, lat: number): number {
    if (!this._detail || !this._coarse) return 0;
    const detail = mosaicSample(this._detail.mosaic, lon, lat);
    const coarse = mosaicSample(this._coarse.mosaic, lon, lat);
    return MathUtils.lerp(coarse.height, detail.height, detail.weight);
  }

  range(bounds: GeoBounds): { min: number; max: number } | null {
    if (!this._detail || !this._coarse) return null;
    return mosaicRange(this._detail.mosaic, bounds) ?? mosaicRange(this._coarse.mosaic, bounds);
  }

  dispose(): void {
    this._cache.dispose();
    for (const node of [terrainSettings.heights, terrainSettings.valid, terrainSettings.coarseHeights]) node.value.dispose();
  }

  /** `filled` : la couche complete ses tuiles depuis leurs parents, qu'une arrivee peut ameliorer. */
  private _due(layer: Layer | null, level: number, bounds: GeoBounds, moving: boolean, filled = false): boolean {
    if (!layer) return true;
    const elapsed = performance.now() - layer.composedAt > RECOMPOSE_MS;
    const stale = layer.level !== level || !containsBounds(layer.mosaic.bounds, bounds);
    // En vol, la vue sort de la mosaique a chaque image : le bord est etire un instant.
    if (stale) return !moving || elapsed;
    return (filled || !layer.mosaic.complete) && layer.loads !== this._loads && elapsed;
  }

  /** Niveau le plus fin, au plus `target`, dont toutes les tuiles de `area` sont arrivees. */
  private _loadedLevel(target: number, area: GeoBounds): number {
    for (let z = target; z > 1; z--) {
      if (tilesCovering(z, area).every(({ x, y }) => this._cache.get(z, x, y))) return z;
    }
    return 1;
  }

  private _compose(level: number, area: GeoBounds, fills?: Map<string, Uint16Array>): Layer {
    const mosaic = composeMosaic(this._cache, level, area, fills);
    this.version++;
    return { mosaic, level, loads: this._loads, composedAt: performance.now() };
  }

  private _request(groups: TileGroup[]): void {
    const key = groups.map(({ z, tiles }) => `${z}:${tiles[0]!.x},${tiles[0]!.y}:${tiles.at(-1)!.x},${tiles.at(-1)!.y}`).join("|");
    if (key === this._requested) return;
    this._requested = key;
    this._cache.request(groups.flatMap(({ z, tiles }) => tiles.map(({ x, y }) => ({ z, x, y }))));
  }

  private _syncUniforms(bounds: GeoBounds): void {
    const s = terrainSettings;
    if (this._detail) {
      const m = this._detail.mosaic;
      const { offset, scale } = mosaicUvTransform(bounds, m.bounds);
      s.uvOffset.value.set(...offset);
      s.uvScale.value.set(...scale);
      s.texel.value.set(1 / m.width / scale[0], 1 / m.height / scale[1]);
    }
    if (this._coarse) {
      const m = this._coarse.mosaic;
      const { offset, scale } = mosaicUvTransform(bounds, m.bounds);
      s.coarseOffset.value.set(...offset);
      s.coarseScale.value.set(...scale);
      s.coarseSize.value.set(m.width, m.height);
    }
  }
}

const coarseLevel = (level: number) => Math.max(1, level - C.coarse.levels);

interface TileGroup {
  z: number;
  tiles: { x: number; y: number }[];
}

/**
 * Tuiles d'une vue par groupes : quelques niveaux tres bas (l'apercu n'est jamais vide) et
 * le niveau juste sous l'apercu (ses tuiles sans donnee s'y completent), l'apercu large,
 * puis le detail ; chaque groupe du plus proche au plus loin.
 */
function requests({ bounds, level, center }: HeightsView, detail: boolean): TileGroup[] {
  const coarse = coarseLevel(level);
  const wide = expandBounds(bounds, C.coarse.margin);
  const pyramid = [...new Set([1, coarse - 6, coarse - 3, coarse - 1])].filter((z) => z >= 1 && z < coarse);
  const areas: [number, GeoBounds][] = [...pyramid.map((z): [number, GeoBounds] => [z, wide]), [coarse, wide]];
  if (detail) areas.push([level, expandBounds(bounds, C.margin)]);

  const cos = Math.cos(MathUtils.degToRad(center.lat));
  const distance = (z: number, { x, y }: { x: number; y: number }) => {
    const b = tileBounds(z, x, y);
    return Math.hypot(((b.west + b.east) / 2 - center.lon) * cos, (b.north + b.south) / 2 - center.lat);
  };
  return areas.map(([z, area]) => ({ z, tiles: tilesCovering(z, area).sort((a, b) => distance(z, a) - distance(z, b)) }));
}

/** Remplace l'image de la texture, ou la texture si la taille change. */
function upload(node: TextureNode, data: Uint16Array | Uint8Array, size: HeightMosaic, type: TextureDataType): void {
  const current = node.value as DataTexture;
  if (current.image.width === size.width && current.image.height === size.height) {
    current.image.data = data;
    current.needsUpdate = true;
    return;
  }
  const next = new DataTexture(data, size.width, size.height, RedFormat, type);
  next.minFilter = LinearFilter;
  next.magFilter = LinearFilter;
  next.needsUpdate = true;
  node.value = next;
  current.dispose();
}
