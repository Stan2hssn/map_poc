import assert from "node:assert/strict";
import { test } from "node:test";
import { GeoProjection } from "./GeoProjection.ts";
import { maskCovers, rasterizeMask, type Ring } from "./TerrainMask.ts";

const projection = new GeoProjection(0, 0);
const rect = projection.rect({ west: 0, south: -1, east: 1, north: 0 });
// Carre couvrant la moitie ouest de l'emprise.
const westHalf: Ring = [[0, 0], [0.5, 0], [0.5, -1], [0, -1], [0, 0]];

test("rasterise l'interieur au centre des pixels", () => {
  const mask = rasterizeMask([[westHalf]], projection, rect, 10);
  assert.equal(mask.width, 10);
  assert.equal(mask.height, 10);
  const row = [...mask.data.subarray(50, 60)];
  assert.deepEqual(row, [255, 255, 255, 255, 255, 0, 0, 0, 0, 0]);
});

test("un trou (pair-impair) reste vide", () => {
  const outer: Ring = [[0, 0], [1, 0], [1, -1], [0, -1], [0, 0]];
  const hole: Ring = [[0.4, -0.4], [0.6, -0.4], [0.6, -0.6], [0.4, -0.6], [0.4, -0.4]];
  const mask = rasterizeMask([[outer, hole]], projection, rect, 10);
  assert.equal(mask.data[5 * 10 + 5], 0);
  assert.equal(mask.data[1 * 10 + 1], 255);
});

test("couverture d'un rectangle", () => {
  const mask = rasterizeMask([[westHalf]], projection, rect, 10);
  const east = projection.rect({ west: 0.6, south: -1, east: 1, north: 0 });
  const west = projection.rect({ west: 0.1, south: -0.5, east: 0.2, north: -0.4 });
  assert.equal(maskCovers(mask, east), false);
  assert.equal(maskCovers(mask, west), true);
});
