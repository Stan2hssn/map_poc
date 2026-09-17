import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanElevation, IgnElevationProvider, ignTileUrl } from "./IgnElevationProvider.ts";

const TILE_BYTES = 256 * 256 * 4;

function fakeFetch() {
  const pending: { url: string; resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  const fetchImpl = ((url: string) =>
    new Promise<Response>((resolve, reject) => pending.push({ url, resolve, reject }))) as unknown as typeof fetch;
  const ok = () => new Response(new Float32Array(TILE_BYTES / 4).fill(12).buffer);
  return { fetchImpl, pending, ok };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("les valeurs sans donnee deviennent 0", () => {
  const data = cleanElevation(Float32Array.from([-99999, 5, -1001, 0]));
  assert.deepEqual([...data], [0, 5, 0, 0]);
});

test("URL WMTS BIL de la couche HIGHRES", () => {
  const url = new URL(ignTileUrl(11, 2088, 522));
  assert.equal(url.searchParams.get("LAYER"), "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES");
  assert.equal(url.searchParams.get("TILEMATRIXSET"), "WGS84G");
  assert.equal(url.searchParams.get("TILEMATRIX"), "11");
  assert.equal(url.searchParams.get("TILECOL"), "2088");
  assert.equal(url.searchParams.get("TILEROW"), "522");
  assert.equal(url.searchParams.get("FORMAT"), "image/x-bil;bits=32");
});

test("au plus N requetes simultanees", async () => {
  const { fetchImpl, pending, ok } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 2);
  const results = [1, 2, 3].map((i) => provider.fetchTile(9, i, 0, new AbortController().signal));
  await tick();
  assert.equal(pending.length, 2);
  pending[0]!.resolve(ok());
  await results[0];
  await tick();
  assert.equal(pending.length, 3);
  pending[1]!.resolve(ok());
  pending[2]!.resolve(ok());
  const data = await Promise.all(results);
  assert.equal(data[2]!.length, 256 * 256);
  assert.equal(data[2]![0], 12);
});

test("une requete en attente annulee n'est jamais lancee", async () => {
  const { fetchImpl, pending, ok } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 1);
  const first = provider.fetchTile(9, 1, 0, new AbortController().signal);
  const controller = new AbortController();
  const second = provider.fetchTile(9, 2, 0, controller.signal);
  controller.abort();
  await assert.rejects(second);
  await tick();
  pending[0]!.resolve(ok());
  await first;
  await tick();
  assert.equal(pending.length, 1);
});

test("nouvelle tentative apres un echec", async () => {
  const { fetchImpl, pending, ok } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 1);
  const result = provider.fetchTile(9, 1, 0, new AbortController().signal);
  await tick();
  pending[0]!.resolve(new Response("", { status: 503 }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(pending.length, 2);
  pending[1]!.resolve(ok());
  assert.equal((await result).length, 256 * 256);
});
