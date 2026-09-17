import assert from "node:assert/strict";
import { test } from "node:test";
import { createGroundGeometry, warp } from "./GroundGeometry.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("resserre au centre, bords et symetrie conserves", () => {
  close(warp(0), 0);
  close(warp(1), 1);
  close(warp(-1), -1);
  close(warp(-0.4), -warp(0.4));
  close(warp(1e-4) / 1e-4, 1 / 3, 1e-6);
});

test("grille en uv du bloc, du centre vers les bords", () => {
  const g = createGroundGeometry(4, 3);
  const p = g.getAttribute("position");
  assert.equal(p.count, 25);
  assert.equal(g.index!.count, 6 * 16);
  close(p.getX(0), -1);
  close(p.getX(4), 2);
  close(p.getX(2), 0.5);
  close(p.getZ(24), 2);
  assert.ok(g.index!.array instanceof Uint32Array);
});

test("chaque triangle regarde vers le haut", () => {
  const g = createGroundGeometry(3, 3);
  const p = g.getAttribute("position");
  const index = g.index!.array;
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i]!, index[i + 1]!, index[i + 2]!];
    const ux = p.getX(b) - p.getX(a);
    const uz = p.getZ(b) - p.getZ(a);
    const vx = p.getX(c) - p.getX(a);
    const vz = p.getZ(c) - p.getZ(a);
    assert.ok(uz * vx - ux * vz > 0, `triangle ${i / 3}`);
  }
});
