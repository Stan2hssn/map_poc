import { DataUtils } from "three";
import { EARTH_RADIUS_KM, tileBounds, tilesCovering, type GeoBounds } from "./GeoProjection.ts";
import { HALF_NAN, halfToFloat } from "./HalfFloat.ts";
import type { CachedTile } from "./TileCache.ts";

const TILE = 256;
/** Taille d'un texel au niveau 0, en km (sens nord-sud). */
const TEXEL_KM_Z0 = (180 / TILE) * (Math.PI / 180) * EARTH_RADIUS_KM;
const FULL = new Uint8Array(TILE * TILE).fill(255);
const NO_HEIGHTS = new Uint16Array(TILE * TILE);
const NO_DATA = new Uint8Array(TILE * TILE);

/**
 * Altitudes en demi-flottant d'une grille lon/lat reguliere, ligne 0 au nord.
 * Une mosaique a trous porte `valid` (255 = donnee) ; ses trous valent 0.
 */
export interface HeightMosaic {
  data: Uint16Array;
  valid: Uint8Array | null;
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

/** Premier niveau parent charge ; `scale` = 2^(ecart de niveaux). */
function ancestor(source: TileSource, z: number, x: number, y: number) {
  for (let k = 1; k < z; k++) {
    const tile = source.get(z - k, x >> k, y >> k);
    if (tile?.data) return { z: z - k, data: tile.data, scale: 2 ** k, ox: x - ((x >> k) << k), oy: y - ((y >> k) << k) };
  }
  return null;
}

/** Tuile completee : ses propres valeurs, sinon le parent agrandi (bilineaire), sinon 0. */
function fill(own: Uint16Array | null, parent: ReturnType<typeof ancestor>): Uint16Array {
  const out = new Uint16Array(TILE * TILE);
  const p = parent?.data;
  for (let row = 0; row < TILE; row++) {
    const v = parent ? (parent.oy * TILE + row + 0.5) / parent.scale - 0.5 : 0;
    const r0 = clamp(Math.floor(v), 0, TILE - 1) * TILE;
    const r1 = Math.min(r0 + TILE, TILE * TILE - TILE);
    const fv = clamp(v - Math.floor(v), 0, 1);
    for (let col = 0; col < TILE; col++) {
      const i = row * TILE + col;
      const value = own ? own[i]! : HALF_NAN;
      if (value !== HALF_NAN) {
        out[i] = value;
        continue;
      }
      if (!parent || !p) continue;
      const u = (parent.ox * TILE + col + 0.5) / parent.scale - 0.5;
      const c0 = clamp(Math.floor(u), 0, TILE - 1);
      const c1 = Math.min(c0 + 1, TILE - 1);
      const fu = clamp(u - Math.floor(u), 0, 1);
      const a = p[r0 + c0]!;
      const b = p[r0 + c1]!;
      const c = p[r1 + c0]!;
      const d = p[r1 + c1]!;
      if (a === HALF_NAN || b === HALF_NAN || c === HALF_NAN || d === HALF_NAN) continue;
      const top = halfToFloat(a) * (1 - fu) + halfToFloat(b) * fu;
      const bottom = halfToFloat(c) * (1 - fu) + halfToFloat(d) * fu;
      out[i] = DataUtils.toHalfFloat(top * (1 - fv) + bottom * fv);
    }
  }
  return out;
}

/** Trous ramenes a 0, avec leur masque. */
function split(data: Uint16Array): [Uint16Array, Uint8Array] {
  const heights = new Uint16Array(data.length);
  const valid = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (data[i] === HALF_NAN) continue;
    heights[i] = data[i]!;
    valid[i] = 255;
  }
  return [heights, valid];
}

/**
 * Tuiles du niveau `z` couvrant `bounds`, assemblees en une grille.
 * Avec `fills`, ce qui manque (en chargement, sans source, trous) est pris dans le premier
 * parent charge, sinon 0, et la tuile completee y est gardee pour les recompositions.
 * Sans `fills`, ce qui manque reste un trou, marque dans `valid`.
 */
export function composeMosaic(
  source: TileSource,
  z: number,
  bounds: GeoBounds,
  fills?: Map<string, Uint16Array>
): HeightMosaic {
  const tiles = tilesCovering(z, bounds);
  const first = tiles[0]!;
  const last = tiles.at(-1)!;
  const width = (last.x - first.x + 1) * TILE;
  const height = (last.y - first.y + 1) * TILE;
  const data = new Uint16Array(width * height);
  const valid = fills ? null : new Uint8Array(width * height);
  let complete = true;

  for (const { x, y } of tiles) {
    const tile = source.get(z, x, y);
    if (!tile) complete = false;
    let heights: Uint16Array = NO_HEIGHTS;
    let mask: Uint8Array = NO_DATA;
    if (tile?.data && !tile.holes) {
      heights = tile.data;
      mask = FULL;
    } else if (fills) {
      const parent = ancestor(source, z, x, y);
      const key = `${z}/${x}/${y}/${parent?.z ?? 0}/${tile?.data ? 1 : 0}`;
      heights = fills.get(key) ?? fill(tile?.data ?? null, parent);
      fills.delete(key);
      fills.set(key, heights);
    } else if (tile?.data) {
      [heights, mask] = split(tile.data);
    }

    const origin = (y - first.y) * TILE * width + (x - first.x) * TILE;
    for (let row = 0; row < TILE; row++) {
      data.set(heights.subarray(row * TILE, (row + 1) * TILE), origin + row * width);
      valid?.set(mask.subarray(row * TILE, (row + 1) * TILE), origin + row * width);
    }
  }

  const nw = tileBounds(z, first.x, first.y);
  const se = tileBounds(z, last.x, last.y);
  const box = { west: nw.west, north: nw.north, east: se.east, south: se.south };
  return { data, valid, width, height, bounds: box, complete };
}

/**
 * Lecture bilineaire (pixels centres, comme la texture) : altitude moyenne des texels
 * valides, et leur part du poids (0 a 1).
 */
export function mosaicSample(m: HeightMosaic, lon: number, lat: number): { height: number; weight: number } {
  const { data, valid, width, height, bounds } = m;
  const u = ((lon - bounds.west) / (bounds.east - bounds.west)) * width - 0.5;
  const v = ((bounds.north - lat) / (bounds.north - bounds.south)) * height - 0.5;
  const c0 = clamp(Math.floor(u), 0, width - 1);
  const r0 = clamp(Math.floor(v), 0, height - 1);
  const c1 = Math.min(c0 + 1, width - 1);
  const r1 = Math.min(r0 + 1, height - 1);
  const fu = clamp(u - c0, 0, 1);
  const fv = clamp(v - r0, 0, 1);
  let sum = 0;
  let weight = 0;
  const add = (i: number, w: number) => {
    if (valid && !valid[i]) return;
    sum += halfToFloat(data[i]!) * w;
    weight += w;
  };
  add(r0 * width + c0, (1 - fu) * (1 - fv));
  add(r0 * width + c1, fu * (1 - fv));
  add(r1 * width + c0, (1 - fu) * fv);
  add(r1 * width + c1, fu * fv);
  return { height: weight > 0 ? sum / weight : 0, weight };
}

/** Altitudes min et max (m) des texels valides dans `bounds`, sur environ 256 x 256 echantillons. */
export function mosaicRange(m: HeightMosaic, bounds: GeoBounds): { min: number; max: number } | null {
  const { data, valid, width, height, bounds: b } = m;
  const c0 = clamp(Math.floor(((bounds.west - b.west) / (b.east - b.west)) * width), 0, width - 1);
  const c1 = clamp(Math.ceil(((bounds.east - b.west) / (b.east - b.west)) * width), c0 + 1, width);
  const r0 = clamp(Math.floor(((b.north - bounds.north) / (b.north - b.south)) * height), 0, height - 1);
  const r1 = clamp(Math.ceil(((b.north - bounds.south) / (b.north - b.south)) * height), r0 + 1, height);
  const step = Math.max(1, Math.floor(Math.max(c1 - c0, r1 - r0) / 256));
  let min = Infinity;
  let max = -Infinity;
  for (let r = r0; r < r1; r += step) {
    for (let c = c0; c < c1; c += step) {
      const i = r * width + c;
      if (valid && !valid[i]) continue;
      const h = halfToFloat(data[i]!);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return min <= max ? { min, max } : null;
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
