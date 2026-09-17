import { DataUtils } from "three";
import { EARTH_RADIUS_KM, tileBounds, tilesCovering, type GeoBounds } from "./GeoProjection.ts";
import { halfToFloat, isHalfNaN } from "./HalfFloat.ts";
import type { CachedTile } from "./TileCache.ts";

const TILE = 256;
/** Taille d'un texel au niveau 0, en km (sens nord-sud). */
const TEXEL_KM_Z0 = (180 / TILE) * (Math.PI / 180) * EARTH_RADIUS_KM;

/** Altitudes en demi-flottant d'une grille lon/lat reguliere, ligne 0 au nord. */
export interface HeightMosaic {
  data: Uint16Array;
  width: number;
  height: number;
  bounds: GeoBounds;
  /** Faux tant qu'une tuile du niveau demande est en chargement. */
  complete: boolean;
}

export interface TileSource {
  get(z: number, x: number, y: number): CachedTile | undefined;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Niveau dont le texel est le plus proche de l'ecart entre sommets du bloc. */
export function levelFor(extentKm: number, segments: number, maxZoom: number): number {
  return clamp(Math.round(Math.log2(TEXEL_KM_Z0 / (extentKm / segments))), 1, maxZoom);
}

/** Lecture bilineaire (texels centres) d'une grille demi-flottante ; NaN compte pour 0. */
function bilinear(data: Uint16Array, width: number, height: number, u: number, v: number): number {
  const c0 = clamp(Math.floor(u), 0, width - 1);
  const r0 = clamp(Math.floor(v), 0, height - 1);
  const c1 = Math.min(c0 + 1, width - 1);
  const r1 = Math.min(r0 + 1, height - 1);
  const fu = clamp(u - c0, 0, 1);
  const fv = clamp(v - r0, 0, 1);
  const at = (r: number, c: number) => {
    const h = halfToFloat(data[r * width + c]);
    return Number.isNaN(h) ? 0 : h;
  };
  return (at(r0, c0) * (1 - fu) + at(r0, c1) * fu) * (1 - fv) + (at(r1, c0) * (1 - fu) + at(r1, c1) * fu) * fv;
}

/** Premier niveau parent charge ; `scale` = 2^(ecart de niveaux). */
function ancestor(source: TileSource, z: number, x: number, y: number) {
  for (let k = 1; k < z; k++) {
    const tile = source.get(z - k, x >> k, y >> k);
    if (tile?.data) return { data: tile.data, scale: 2 ** k, ox: x - ((x >> k) << k), oy: y - ((y >> k) << k) };
  }
  return null;
}

/**
 * Tuiles du niveau `z` couvrant `bounds`, assemblees en une grille. Ce qui manque
 * (en chargement, sans source, trous) est pris dans le premier parent charge, sinon 0.
 */
export function composeMosaic(source: TileSource, z: number, bounds: GeoBounds): HeightMosaic {
  const tiles = tilesCovering(z, bounds);
  const first = tiles[0]!;
  const last = tiles.at(-1)!;
  const width = (last.x - first.x + 1) * TILE;
  const height = (last.y - first.y + 1) * TILE;
  const data = new Uint16Array(width * height);
  let complete = true;

  for (const { x, y } of tiles) {
    const tile = source.get(z, x, y);
    if (!tile) complete = false;
    const origin = (y - first.y) * TILE * width + (x - first.x) * TILE;

    if (tile?.data && !tile.holes) {
      for (let row = 0; row < TILE; row++) {
        data.set(tile.data.subarray(row * TILE, (row + 1) * TILE), origin + row * width);
      }
      continue;
    }

    const parent = ancestor(source, z, x, y);
    for (let row = 0; row < TILE; row++) {
      for (let col = 0; col < TILE; col++) {
        const own = tile?.data?.[row * TILE + col];
        let value = own ?? 0;
        if (own === undefined || isHalfNaN(own)) {
          value = 0;
          if (parent) {
            const u = (parent.ox * TILE + col + 0.5) / parent.scale - 0.5;
            const v = (parent.oy * TILE + row + 0.5) / parent.scale - 0.5;
            value = DataUtils.toHalfFloat(bilinear(parent.data, TILE, TILE, u, v));
          }
        }
        data[origin + row * width + col] = value;
      }
    }
  }

  const nw = tileBounds(z, first.x, first.y);
  const se = tileBounds(z, last.x, last.y);
  return { data, width, height, bounds: { west: nw.west, north: nw.north, east: se.east, south: se.south }, complete };
}

/** Altitude (m) bilineaire, pixels centres comme dans la texture ; 0 sans donnee. */
export function mosaicHeightAt({ data, width, height, bounds }: HeightMosaic, lon: number, lat: number): number {
  const u = ((lon - bounds.west) / (bounds.east - bounds.west)) * width - 0.5;
  const v = ((bounds.north - lat) / (bounds.north - bounds.south)) * height - 0.5;
  return bilinear(data, width, height, u, v);
}

/** Altitudes min et max (m) dans `bounds`, sur environ 256 x 256 echantillons. */
export function mosaicRange({ data, width, height, bounds: m }: HeightMosaic, bounds: GeoBounds): { min: number; max: number } {
  const c0 = clamp(Math.floor(((bounds.west - m.west) / (m.east - m.west)) * width), 0, width - 1);
  const c1 = clamp(Math.ceil(((bounds.east - m.west) / (m.east - m.west)) * width), c0 + 1, width);
  const r0 = clamp(Math.floor(((m.north - bounds.north) / (m.north - m.south)) * height), 0, height - 1);
  const r1 = clamp(Math.ceil(((m.north - bounds.south) / (m.north - m.south)) * height), r0 + 1, height);
  const step = Math.max(1, Math.floor(Math.max(c1 - c0, r1 - r0) / 256));
  let min = Infinity;
  let max = -Infinity;
  for (let r = r0; r < r1; r += step) {
    for (let c = c0; c < c1; c += step) {
      const h = halfToFloat(data[r * width + c]!);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return { min, max };
}

/** Passage des uv du bloc (0..1, nord en haut) aux uv de la mosaique. */
export function mosaicUvTransform(block: GeoBounds, mosaic: GeoBounds): { offset: [number, number]; scale: [number, number] } {
  const spanLon = mosaic.east - mosaic.west;
  const spanLat = mosaic.north - mosaic.south;
  return {
    offset: [(block.west - mosaic.west) / spanLon, (mosaic.north - block.north) / spanLat],
    scale: [(block.east - block.west) / spanLon, (block.north - block.south) / spanLat],
  };
}
