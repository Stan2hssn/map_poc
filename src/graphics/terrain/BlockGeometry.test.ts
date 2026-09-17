import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockGeometry } from "./BlockGeometry.ts";

test("sommets : dessus, quatre parois, fond", () => {
  const g = createBlockGeometry(4);
  assert.equal(g.getAttribute("position").count, 25 + 4 * 10 + 4);
  assert.equal(g.index!.count, 6 * 16 + 4 * 6 * 4 + 6);
});

test("index 32 bits au-dela de 65535 sommets", () => {
  assert.ok(createBlockGeometry(256).index!.array instanceof Uint32Array);
});

test("chaque triangle regarde vers l'exterieur", () => {
  const g = createBlockGeometry(3);
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const index = g.index!.array;
  const at = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [at(index[t]!), at(index[t + 1]!), at(index[t + 2]!)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const face = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const i = index[t]!;
    const dot = face[0]! * n.getX(i) + face[1]! * n.getY(i) + face[2]! * n.getZ(i);
    assert.ok(dot > 0, `triangle ${t / 3} tourne vers l'interieur`);
  }
});

test("le fond est a y = -1, le reste a y = 0", () => {
  const g = createBlockGeometry(2);
  const p = g.getAttribute("position");
  const ys = new Set<number>();
  for (let i = 0; i < p.count; i++) ys.add(p.getY(i));
  assert.deepEqual([...ys].sort(), [-1, 0]);
});
