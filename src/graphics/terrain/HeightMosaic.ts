import type IElevationProvider from "./ElevationProvider.interface.ts";
import { tileBounds, tilesCovering, type GeoBounds } from "./GeoProjection.ts";

const TILE = 256;

/** Altitudes (m) d'une grille lon/lat reguliere, ligne 0 au nord. */
export interface HeightMosaic {
  data: Float32Array;
  width: number;
  height: number;
  bounds: GeoBounds;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Tuiles du niveau `z` couvrant `bounds`, assemblees en une seule grille. */
export async function fetchMosaic(
  provider: IElevationProvider,
  z: number,
  bounds: GeoBounds,
  signal: AbortSignal
): Promise<HeightMosaic> {
  const tiles = tilesCovering(z, bounds);
  const first = tiles[0]!;
  const last = tiles.at(-1)!;
  const width = (last.x - first.x + 1) * TILE;
  const height = (last.y - first.y + 1) * TILE;
  const data = new Float32Array(width * height);

  await Promise.all(
    tiles.map(async ({ x, y }) => {
      const tile = await provider.fetchTile(z, x, y, signal);
      const left = (x - first.x) * TILE;
      for (let row = 0; row < TILE; row++) {
        data.set(tile.subarray(row * TILE, (row + 1) * TILE), ((y - first.y) * TILE + row) * width + left);
      }
    })
  );

  const nw = tileBounds(z, first.x, first.y);
  const se = tileBounds(z, last.x, last.y);
  return { data, width, height, bounds: { west: nw.west, north: nw.north, east: se.east, south: se.south } };
}

/** Altitude (m) bilineaire, pixels centres comme dans la texture. */
export function mosaicHeightAt({ data, width, height, bounds }: HeightMosaic, lon: number, lat: number): number {
  const u = ((lon - bounds.west) / (bounds.east - bounds.west)) * width - 0.5;
  const v = ((bounds.north - lat) / (bounds.north - bounds.south)) * height - 0.5;
  const c0 = clamp(Math.floor(u), 0, width - 1);
  const r0 = clamp(Math.floor(v), 0, height - 1);
  const c1 = Math.min(c0 + 1, width - 1);
  const r1 = Math.min(r0 + 1, height - 1);
  const fu = clamp(u - c0, 0, 1);
  const fv = clamp(v - r0, 0, 1);
  const top = data[r0 * width + c0] * (1 - fu) + data[r0 * width + c1] * fu;
  const bottom = data[r1 * width + c0] * (1 - fu) + data[r1 * width + c1] * fu;
  return top * (1 - fv) + bottom * fv;
}
