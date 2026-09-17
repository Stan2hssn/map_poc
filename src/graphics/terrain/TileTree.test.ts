import assert from "node:assert/strict";
import { test } from "node:test";
import { GeoProjection } from "./GeoProjection.ts";
import type { Tile } from "./Tile.ts";
import { TileTree, type TileHandlers } from "./TileTree.ts";

const GARD = { west: 3.2624, south: 43.4603, east: 4.8456, north: 44.4597 };
const OPTIONS = { rootZoom: 9, maxZoom: 13, split: 1.5, merge: 3, maxVisible: 300 };
const projection = new GeoProjection(4.054, 43.96);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(overrides: Partial<TileHandlers> = {}, options = OPTIONS) {
  const loads = new Map<string, { resolve: (h: Float32Array) => void; reject: (e: unknown) => void }>();
  const visible = new Set<string>();
  const released: string[] = [];
  const handlers: TileHandlers = {
    accept: () => true,
    load: (tile) => new Promise((resolve, reject) => loads.set(tile.key, { resolve, reject })),
    loaded: () => undefined,
    setVisible: (tile, on) => (on ? visible.add(tile.key) : visible.delete(tile.key)),
    release: (tile) => released.push(tile.key),
    ...overrides,
  };
  const tree = new TileTree(GARD, projection, options, handlers);
  const resolve = async (key: string, value = 0) => {
    loads.get(key)!.resolve(new Float32Array(256 * 256).fill(value));
    await tick();
  };
  return { tree, loads, visible, released, resolve };
}

const far = { x: 0, y: 5000, z: 0 };
const above = (tile: Tile) => ({ x: (tile.rect.minX + tile.rect.maxX) / 2, y: 1, z: (tile.rect.minZ + tile.rect.maxZ) / 2 });

test("les racines ne s'affichent qu'une fois chargees", async () => {
  const { tree, visible, resolve } = setup();
  assert.equal(tree.roots.length, 20);
  tree.update(far);
  assert.equal(visible.size, 0);
  for (const root of tree.roots) await resolve(root.key);
  tree.update(far);
  assert.equal(visible.size, 20);
  assert.equal(tree.visibleCount, 20);
});

test("subdivision : le parent reste affiche jusqu'a ce que ses 4 enfants soient prets", async () => {
  const { tree, visible, resolve } = setup();
  const root = tree.roots[7]!;
  for (const r of tree.roots) await resolve(r.key);
  tree.update(above(root));
  assert.equal(root.children?.length, 4);
  assert.ok(visible.has(root.key));
  for (const child of root.children!.slice(0, 3)) await resolve(child.key);
  tree.update(above(root));
  assert.ok(visible.has(root.key));
  await resolve(root.children![3]!.key);
  tree.update(above(root));
  assert.ok(!visible.has(root.key));
  assert.ok(root.children!.every((c) => visible.has(c.key) || c.children));
});

test("fusion : enfants liberes et annules, parent reaffiche", async () => {
  const { tree, visible, released, resolve } = setup();
  const root = tree.roots[7]!;
  for (const r of tree.roots) await resolve(r.key);
  tree.update(above(root));
  const children = root.children!;
  tree.update(far);
  assert.equal(root.children, null);
  assert.ok(children.every((c) => c.controller.signal.aborted && released.includes(c.key)));
  assert.ok(visible.has(root.key));
});

test("un enfant en echec laisse le parent affiche", async () => {
  const { tree, visible, loads, resolve } = setup();
  const root = tree.roots[7]!;
  for (const r of tree.roots) await resolve(r.key);
  tree.update(above(root));
  const [a, b, c, d] = root.children!;
  for (const child of [a!, b!, c!]) await resolve(child.key);
  loads.get(d!.key)!.reject(new Error("503"));
  await tick();
  tree.update(above(root));
  assert.ok(visible.has(root.key));
  assert.ok(root.children!.every((child) => !visible.has(child.key)));
});

test("budget de tuiles affichees", async () => {
  const { tree, resolve } = setup({}, { ...OPTIONS, maxVisible: 20 });
  for (const r of tree.roots) await resolve(r.key);
  tree.update(far);
  tree.update(above(tree.roots[7]!));
  assert.equal(tree.roots[7]!.children, null);
});

test("tuiles refusees jamais creees", () => {
  const { tree } = setup({ accept: (tile) => tile.x % 2 === 0 });
  assert.ok(tree.roots.length > 0);
  assert.ok(tree.roots.every((t) => t.x % 2 === 0));
});

test("altitude lue sur la tuile prete la plus fine", async () => {
  const { tree, resolve } = setup();
  const root = tree.roots[7]!;
  for (const r of tree.roots) await resolve(r.key, 100);
  const point = above(root);
  assert.equal(tree.heightAt(point.x, point.z), 100);
  tree.update(point);
  for (const child of root.children!) await resolve(child.key, 200);
  assert.equal(tree.heightAt(point.x, point.z), 200);
  assert.equal(tree.heightAt(99999, 99999), 0);
});
