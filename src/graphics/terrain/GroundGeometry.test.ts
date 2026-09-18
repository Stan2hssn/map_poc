import assert from "node:assert/strict";
import { test } from "node:test";
import { createGroundGeometry, SCREEN_MARGIN } from "./GroundGeometry.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("grille de l'ecran, marges comprises", () => {
  const g = createGroundGeometry(4);
  const p = g.getAttribute("position");
  assert.equal(p.count, 25);
  assert.equal(g.index!.count, 6 * 16);
  close(p.getX(0), -SCREEN_MARGIN.side);
  close(p.getX(4), 1 + SCREEN_MARGIN.side);
  close(p.getZ(0), -SCREEN_MARGIN.bottom);
  close(p.getZ(24), 1 + SCREEN_MARGIN.top);
  assert.ok(g.index!.array instanceof Uint32Array);
});

test("triangles dans le sens direct a l'ecran", () => {
  const g = createGroundGeometry(3);
  const p = g.getAttribute("position");
  const index = g.index!.array;
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i]!, index[i + 1]!, index[i + 2]!];
    const cross = (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a));
    assert.ok(cross > 0, `triangle ${i / 3}`);
  }
});
