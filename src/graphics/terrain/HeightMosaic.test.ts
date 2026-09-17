import assert from "node:assert/strict";
import { test } from "node:test";
import { tileBounds } from "./GeoProjection.ts";
import { encodeHalf, halfToFloat } from "./HalfFloat.ts";
import { composeMosaic, levelFor, mosaicHeightAt, mosaicRange, mosaicUvTransform, type HeightMosaic } from "./HeightMosaic.ts";
import type { CachedTile } from "./TileCache.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const filled = (value: number) => encodeHalf(new Float32Array(256 * 256).fill(value));

function source(tiles: Record<string, CachedTile>) {
  return { get: (z: number, x: number, y: number) => tiles[`${z}/${x}/${y}`] };
}

const nw = tileBounds(9, 521, 129);
const se = tileBounds(9, 522, 130);
const inner = { west: nw.west + 0.01, north: nw.north - 0.01, east: se.east - 0.01, south: se.south + 0.01 };
const all = {
  "9/521/129": filled(10),
  "9/522/129": filled(20),
  "9/521/130": filled(30),
  "9/522/130": filled(40),
};

test("assemble les tuiles, nord en haut", () => {
  const m = composeMosaic(source(all), 9, inner);
  assert.equal(m.width, 512);
  assert.equal(m.height, 512);
  assert.equal(m.complete, true);
  assert.deepEqual([0, 256, 256 * 512, 512 * 512 - 1].map((i) => halfToFloat(m.data[i]!)), [10, 20, 30, 40]);
  assert.deepEqual(m.bounds, { west: nw.west, north: nw.north, east: se.east, south: se.south });
});

test("tuile absente : agrandie depuis le parent, mosaique incomplete", () => {
  const { "9/522/130": _, ...partial } = all;
  const m = composeMosaic(source({ ...partial, "8/261/65": filled(99) }), 9, inner);
  assert.equal(m.complete, false);
  assert.equal(halfToFloat(m.data[512 * 512 - 1]!), 99);
});

test("tuile sans source a ce niveau : parent, mosaique complete", () => {
  const m = composeMosaic(source({ ...all, "9/522/130": { data: null, holes: false }, "8/261/65": filled(7) }), 9, inner);
  assert.equal(m.complete, true);
  assert.equal(halfToFloat(m.data[512 * 512 - 1]!), 7);
});

test("trous d'une tuile combles par le parent, sinon 0", () => {
  const raw = new Float32Array(256 * 256).fill(10);
  raw[0] = NaN;
  raw[1] = NaN;
  const m1 = composeMosaic(source({ ...all, "9/521/129": encodeHalf(raw), "8/260/64": filled(5) }), 9, inner);
  assert.equal(halfToFloat(m1.data[0]!), 5);
  assert.equal(halfToFloat(m1.data[2]!), 10);
  const m2 = composeMosaic(source({ ...all, "9/521/129": encodeHalf(raw) }), 9, inner);
  assert.equal(halfToFloat(m2.data[0]!), 0);
});

test("altitude bilineaire au centre des pixels", () => {
  const m: HeightMosaic = {
    data: encodeHalf(Float32Array.from([0, 10, 20, 30])).data!,
    width: 2,
    height: 2,
    bounds: { west: 0, east: 2, north: 2, south: 0 },
    complete: true,
  };
  close(mosaicHeightAt(m, 0.5, 1.5), 0);
  close(mosaicHeightAt(m, 1.5, 1.5), 10);
  close(mosaicHeightAt(m, 1, 1), 15);
  close(mosaicHeightAt(m, 0.5, 0.5), 20);
  close(mosaicHeightAt(m, -5, 99), 0);
});

test("uv du bloc vers uv de la mosaique", () => {
  const { offset, scale } = mosaicUvTransform({ west: 1, east: 2, south: 2, north: 3 }, { west: 0, east: 4, south: 0, north: 4 });
  assert.deepEqual(offset, [0.25, 0.25]);
  assert.deepEqual(scale, [0.25, 0.25]);
});

test("niveau : texel proche de l'ecart entre sommets", () => {
  assert.equal(levelFor(40, 1024, 14), 11);
  assert.equal(levelFor(2, 1024, 14), 14);
  assert.equal(levelFor(2000, 1024, 14), 5);
  assert.equal(levelFor(40, 1024, 10), 10);
});

test("altitudes min et max dans une emprise", () => {
  const m = composeMosaic(source(all), 9, inner);
  assert.deepEqual(mosaicRange(m, inner), { min: 10, max: 40 });
  const north = tileBounds(9, 521, 129);
  assert.deepEqual(mosaicRange(m, { ...north, east: north.east - 0.01, south: north.south + 0.01 }), { min: 10, max: 10 });
});
