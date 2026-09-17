import assert from "node:assert/strict";
import { test } from "node:test";
import { createTileGeometry } from "./TileGeometry.ts";

test("grille unitaire et jupe", () => {
  const geometry = createTileGeometry(4);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const skirt = geometry.getAttribute("skirt");
  assert.equal(position.count, 25 + 16);
  assert.deepEqual([uv.getX(4), uv.getY(4)], [1, 0]);
  assert.deepEqual([uv.getX(20), uv.getY(20)], [0, 1]);
  assert.equal([...(skirt.array as Float32Array)].filter((s) => s === 1).length, 16);
  assert.ok([...geometry.index!.array].every((i) => i < position.count));
});

test("premier triangle tourne vers le haut", () => {
  const geometry = createTileGeometry(4);
  const p = geometry.getAttribute("position");
  const [a, b, c] = [...geometry.index!.array].slice(0, 3);
  const ab = [p.getX(b!) - p.getX(a!), p.getZ(b!) - p.getZ(a!)];
  const ac = [p.getX(c!) - p.getX(a!), p.getZ(c!) - p.getZ(a!)];
  // Composante y du produit vectoriel (ab x ac) avec y = 0 : ab.z * ac.x - ab.x * ac.z.
  assert.ok(ab[1]! * ac[0]! - ab[0]! * ac[1]! > 0);
});
