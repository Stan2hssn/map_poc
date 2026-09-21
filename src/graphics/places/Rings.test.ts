import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ring } from "./AdminAreas.ts";
import { distanceToRingsKm, ringsBounds, ringsContain } from "./Rings.ts";

// Carre d'un degre, et un second anneau a l'ecart (une ile).
const SQUARE: Ring = [
  [2, 45],
  [3, 45],
  [3, 46],
  [2, 46],
];
const ISLAND: Ring = [
  [5, 45],
  [5.2, 45],
  [5.2, 45.2],
];

test("un point est dans le territoire s'il est dans l'un de ses anneaux", () => {
  assert.equal(ringsContain([SQUARE, ISLAND], 2.5, 45.5), true);
  assert.equal(ringsContain([SQUARE, ISLAND], 5.15, 45.05), true);
  assert.equal(ringsContain([SQUARE, ISLAND], 4, 45.5), false);
});

test("la distance au territoire est celle de son bord le plus proche", () => {
  // Un dixieme de degre a l'est du bord : ~7,8 km a 45,5 degres de latitude.
  const km = distanceToRingsKm([SQUARE], 3.1, 45.5);
  assert.ok(Math.abs(km - 0.1 * 111.32 * Math.cos((45.5 * Math.PI) / 180)) < 0.01);
  // Dedans aussi, la distance est celle du bord : ~11 km sous le bord nord.
  assert.ok(Math.abs(distanceToRingsKm([SQUARE], 2.5, 45.9) - 11.132) < 0.01);
});

test("le cadre enveloppe tous les anneaux", () => {
  assert.deepEqual(ringsBounds([SQUARE, ISLAND]), { west: 2, east: 5.2, south: 45, north: 46 });
});
