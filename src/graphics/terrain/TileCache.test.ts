import assert from "node:assert/strict";
import { test } from "node:test";
import { halfToFloat, HALF_NAN } from "./HalfFloat.ts";
import { TileCache } from "./TileCache.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeProvider() {
  const calls: { key: string; signal: AbortSignal; resolve: (d: Float32Array | null) => void }[] = [];
  const provider = {
    fetchTile: (z: number, x: number, y: number, signal: AbortSignal) =>
      new Promise<Float32Array | null>((resolve) => calls.push({ key: `${z}/${x}/${y}`, signal, resolve })),
  };
  return { provider, calls };
}

const tile = (value: number) => new Float32Array(256 * 256).fill(value);

test("charge dans l'ordre, sans doublon", () => {
  const { provider, calls } = fakeProvider();
  const cache = new TileCache(provider, 10, () => undefined);
  cache.request([{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }]);
  cache.request([{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }]);
  assert.deepEqual(calls.map((c) => c.key), ["5/1/1", "5/2/1"]);
});

test("abandonne ce qui n'est plus demande", () => {
  const { provider, calls } = fakeProvider();
  const cache = new TileCache(provider, 10, () => undefined);
  cache.request([{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }]);
  cache.request([{ z: 5, x: 2, y: 1 }]);
  assert.equal(calls[0]!.signal.aborted, true);
  assert.equal(calls[1]!.signal.aborted, false);
});

test("stocke en demi-flottant, NaN signale", async () => {
  const { provider, calls } = fakeProvider();
  let loaded = 0;
  const cache = new TileCache(provider, 10, () => loaded++);
  cache.request([{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }]);
  const withHole = tile(1234);
  withHole[3] = NaN;
  calls[0]!.resolve(withHole);
  calls[1]!.resolve(null);
  await tick();
  assert.equal(loaded, 2);
  const a = cache.get(5, 1, 1)!;
  assert.equal(halfToFloat(a.data![0]!), 1234);
  assert.equal(a.data![3], HALF_NAN);
  assert.equal(a.holes, true);
  assert.deepEqual(cache.get(5, 2, 1), { data: null, holes: false });
});

test("oublie les tuiles les plus anciennes au-dela de la capacite", async () => {
  const { provider, calls } = fakeProvider();
  const cache = new TileCache(provider, 2, () => undefined);
  cache.request([{ z: 5, x: 1, y: 1 }, { z: 5, x: 2, y: 1 }]);
  calls[0]!.resolve(tile(1));
  calls[1]!.resolve(tile(2));
  await tick();
  cache.get(5, 1, 1);
  cache.request([{ z: 5, x: 3, y: 1 }]);
  calls[2]!.resolve(tile(3));
  await tick();
  assert.ok(cache.get(5, 1, 1));
  assert.equal(cache.get(5, 2, 1), undefined);
  assert.ok(cache.get(5, 3, 1));
});
