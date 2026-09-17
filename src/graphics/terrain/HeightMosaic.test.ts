import assert from "node:assert/strict";
import { test } from "node:test";
import { tileBounds } from "./GeoProjection.ts";
import { fetchMosaic, mosaicHeightAt, mosaicUvTransform, type HeightMosaic } from "./HeightMosaic.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const provider = {
  fetchTile: async (_z: number, x: number, y: number) => new Float32Array(256 * 256).fill(x * 10 + y),
};

test("assemble les tuiles, nord en haut", async () => {
  const nw = tileBounds(9, 521, 129);
  const se = tileBounds(9, 522, 130);
  const inner = { west: nw.west + 0.01, north: nw.north - 0.01, east: se.east - 0.01, south: se.south + 0.01 };
  const m = await fetchMosaic(provider, 9, inner, new AbortController().signal);
  assert.equal(m.width, 512);
  assert.equal(m.height, 512);
  assert.equal(m.data[0], 5339);
  assert.equal(m.data[256], 5349);
  assert.equal(m.data[256 * 512], 5340);
  assert.equal(m.data[512 * 512 - 1], 5350);
  assert.deepEqual(m.bounds, { west: nw.west, north: nw.north, east: se.east, south: se.south });
});

test("altitude bilineaire au centre des pixels", () => {
  const m: HeightMosaic = {
    data: Float32Array.from([0, 10, 20, 30]),
    width: 2,
    height: 2,
    bounds: { west: 0, east: 2, north: 2, south: 0 },
  };
  close(mosaicHeightAt(m, 0.5, 1.5), 0);
  close(mosaicHeightAt(m, 1.5, 1.5), 10);
  close(mosaicHeightAt(m, 1, 1), 15);
  close(mosaicHeightAt(m, 0.5, 0.5), 20);
  close(mosaicHeightAt(m, -5, 99), 0);
});

test("uv du bloc vers uv de la mosaique", () => {
  const mosaic = { west: 0, east: 4, south: 0, north: 4 };
  const block = { west: 1, east: 2, south: 2, north: 3 };
  const { offset, scale } = mosaicUvTransform(block, mosaic);
  assert.deepEqual(offset, [0.25, 0.25]);
  assert.deepEqual(scale, [0.25, 0.25]);
});
