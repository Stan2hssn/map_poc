import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDegrees, graticuleStep, graticuleValues } from "./Graticule.ts";

test("pas : au plus N meridiens sur l'emprise", () => {
  assert.equal(graticuleStep({ west: 3.3, east: 3.85, south: 44, north: 44.3 }, 6), 10 / 60);
  assert.equal(graticuleStep({ west: -5, east: 10, south: 41, north: 51 }, 6), 5);
  assert.equal(graticuleStep({ west: -180, east: 180, south: -90, north: 90 }, 6), 45);
});

test("valeurs multiples du pas dans l'intervalle", () => {
  assert.deepEqual(graticuleValues(-5.2, 10.1, 5), [-5, 0, 5, 10]);
  assert.deepEqual(graticuleValues(0.1, 0.9, 1), []);
});

test("format selon le pas", () => {
  assert.equal(formatDegrees(3, 1, "E", "W"), "3°E");
  assert.equal(formatDegrees(-3.5, 0.5, "E", "W"), "3°30′W");
  assert.equal(formatDegrees(44.1, 1 / 60, "N", "S"), "44°06′N");
  assert.equal(formatDegrees(44.1042, 15 / 3600, "N", "S"), "44°06′15″N");
});
