import assert from "node:assert/strict";
import { test } from "node:test";
import { scatterTrees, TREE_STRIDE } from "./Trees.ts";
import { GEOMETRY, vectorLayer } from "./VectorTile.ts";

const E = 4096;
const TILE = { x: 16597, y: 11274 };
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
const layers = (entries: Record<string, { type: number; geometry: number[][]; properties?: Record<string, string> }[]>) =>
  new Map(Object.entries(entries).map(([name, features]) => [name, vectorLayer(E, features)]));
const points = (trees: Uint16Array) =>
  Array.from({ length: trees.length / TREE_STRIDE }, (_, i) => ({
    x: (trees[i * TREE_STRIDE]! / 65535) * E,
    crownM: trees[i * TREE_STRIDE + 2]! / 100,
    kind: trees[i * TREE_STRIDE + 3]!,
  }));
/** Arbres des bois : les buissons semes ailleurs ont un houppier bien plus petit. */
const woodTrees = (trees: Uint16Array) => points(trees).filter((tree) => tree.crownM > 2.4);

test("arbres : dans le bois seulement, hors des batiments, coniferes reconnus", () => {
  const wood = { type: GEOMETRY.polygon, geometry: [square(1000, 1000, 2000, 2000)], properties: { symbo: "ZONE_FORET_FERMEE_CONI" } };
  const house = { type: GEOMETRY.polygon, geometry: [square(1000, 1000, 1500, 2000)] };
  const trees = woodTrees(scatterTrees(layers({ ocs_vegetation_surf: [wood], bati_surf: [house] }), 15, TILE));
  assert.ok(trees.length > 20);
  for (const { x, kind } of trees) {
    assert.ok(x >= 1500 && x <= 2000);
    assert.equal(kind, 1);
  }
  // Memes arbres a chaque fois.
  assert.deepEqual(
    scatterTrees(layers({ ocs_vegetation_surf: [wood] }), 15, TILE),
    scatterTrees(layers({ ocs_vegetation_surf: [wood] }), 15, TILE),
  );
});

test("arbres : pas d'alignements le long des rues, buissons a l'ecart", () => {
  const boulevard = { type: GEOMETRY.line, geometry: [[500, 2000, 3500, 2000]], properties: { symbo: "REGIONALE_2" } };
  const scattered = scatterTrees(layers({ routier_route: [boulevard] }), 15, TILE);
  // Aucun arbre de bois (il n'y a pas de bois), et aucun buisson sur la chaussee.
  assert.equal(woodTrees(scattered).length, 0);
  // Rien sur la chaussee : le long du trace (x de 500 a 3500), a moins d'une dizaine de metres.
  const onRoad = Array.from({ length: scattered.length / TREE_STRIDE }, (_, i) => ({
    x: (scattered[i * TREE_STRIDE]! / 65535) * E,
    v: scattered[i * TREE_STRIDE + 1]! / 65535,
  })).filter(({ x, v }) => x > 500 && x < 3500 && Math.abs(v - 2000 / E) < 0.012);
  assert.equal(onRoad.length, 0);
});
