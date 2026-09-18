import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTileMesh, clipRing, DEFAULT_HEIGHT_M, HEIGHT_RANGE_M, PEAK_CELL, peakMap } from "./Buildings.ts";
import { GEOMETRY, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

const E = 4096;
const TILE = { x: 16597, y: 11274 };
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
// Anneau inverse : une cour.
const hole = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x0, y1, x1, y1, x1, y0, x0, y0];
const layer = (...features: Partial<VectorFeature>[]): VectorLayer => ({
  extent: E,
  features: features.map((f) => ({ type: GEOMETRY.polygon, properties: {}, geometry: [], ...f })),
});
const at = (a: Uint16Array, i: number, n: number) => Array.from(a.subarray(i * n, i * n + n), (v) => v / 65535);

/** Normale sortante de chaque mur, (-dv, du) dans (u, v), et milieu de l'arete. */
const walls = (edges: Uint16Array) =>
  Array.from({ length: edges.length / 4 }, (_, i) => {
    const [u0, v0, u1, v1] = at(edges, i, 4) as [number, number, number, number];
    return { normal: [-(v1 - v0), u1 - u0], middle: [(u0 + u1) / 2, (v0 + v1) / 2] };
  });

test("decoupe : les points hors de la tuile sont ramenes exactement sur le bord", () => {
  const inside = clipRing(square(100, 100, 200, 200), E);
  assert.deepEqual(inside, square(100, 100, 200, 200).slice(0, -2));
  const cut = clipRing(square(4000, 100, 4200, 200), E);
  assert.ok(cut.every((v, i) => (i % 2 === 0 ? v <= E : true)));
  assert.equal(cut.filter((v, i) => i % 2 === 0 && v === E).length, 2);
});

test("un batiment : toits vers le haut, murs vers l'exterieur, hauteur codee", () => {
  const mesh = buildTileMesh(layer({ geometry: [square(1000, 1000, 1400, 1300)], properties: { hauteur: 18 } }), 15, TILE);
  assert.equal(mesh.buildings, 1);
  assert.equal(mesh.roofPoints.length / 2, 4);
  assert.equal(mesh.roofIndex.length, 6);
  for (let t = 0; t < mesh.roofIndex.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => at(mesh.roofPoints, mesh.roofIndex[t + k]!, 2)) as [number, number][];
    // Vu d'en haut, v vers le sud : sens negatif dans (u, v).
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0);
  }
  const [cu, cv, h] = at(mesh.roofBuildings, 0, 4) as [number, number, number];
  assert.ok(Math.abs(h * HEIGHT_RANGE_M - 18) < 0.01);
  const list = walls(mesh.wallEdges);
  assert.equal(list.length, 4);
  for (const { normal, middle } of list) assert.ok(normal[0]! * (middle[0]! - cu) + normal[1]! * (middle[1]! - cv) > 0);
});

test("coupure de tuile : pas de mur sur le bord", () => {
  const mesh = buildTileMesh(layer({ geometry: [square(4000, 1000, 4300, 1300)] }), 15, TILE);
  assert.equal(walls(mesh.wallEdges).length, 3);
  assert.ok(Math.abs(at(mesh.roofBuildings, 0, 4)[2]! * HEIGHT_RANGE_M - DEFAULT_HEIGHT_M) < 0.01);
});

test("cour : toit troue, murs de la cour tournes vers elle", () => {
  const mesh = buildTileMesh(layer({ geometry: [square(1000, 1000, 1600, 1600), hole(1200, 1200, 1400, 1400)] }), 15, TILE);
  assert.equal(mesh.buildings, 1);
  // Anneau de 4 sommets troue par un carre : 8 triangles.
  assert.equal(mesh.roofIndex.length / 3, 8);
  const list = walls(mesh.wallEdges);
  assert.equal(list.length, 8);
  // Les murs de la cour (apres ceux du contour) regardent son centre : la normale s'oppose a l'ecart au centre.
  const courtyard = list.slice(4);
  const cu = (1200 + 1400) / 2 / E;
  const cv = courtyard.reduce((sum, w) => sum + w.middle[1]!, 0) / 4;
  for (const { normal, middle } of courtyard) assert.ok(normal[0]! * (middle[0]! - cu) + normal[1]! * (middle[1]! - cv) < 0);
});

test("sommets : maximum par cellule, etendu aux voisines", () => {
  const size = PEAK_CELL * 4;
  const heights = new Uint8Array(size * size);
  heights[(PEAK_CELL + 3) * size + PEAK_CELL + 5] = 40;
  const peaks = peakMap(heights, size, size);
  const at = (x: number, y: number) => peaks[y * 4 + x];
  assert.equal(at(1, 1), 40);
  assert.equal(at(0, 0), 40);
  assert.equal(at(2, 2), 40);
  assert.equal(at(3, 3), 0);
  assert.equal(at(3, 1), 0);
});
