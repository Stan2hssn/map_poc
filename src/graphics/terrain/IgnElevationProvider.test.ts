import assert from "node:assert/strict";
import { test } from "node:test";
import { IGN_LAYERS, IgnElevationProvider, ignTileUrl, markNoData } from "./IgnElevationProvider.ts";

const CELLS = 256 * 256;

type Reply = (url: string) => Response | Promise<Response>;

function fakeFetch(reply?: Reply) {
  const pending: { url: string; resolve: (r: Response) => void }[] = [];
  const urls: string[] = [];
  const fetchImpl = ((url: string) => {
    urls.push(url);
    if (reply) return Promise.resolve(reply(url));
    return new Promise<Response>((resolve) => pending.push({ url, resolve }));
  }) as unknown as typeof fetch;
  return { fetchImpl, pending, urls };
}

const tileOf = (value: number) => new Response(new Float32Array(CELLS).fill(value).buffer);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const signal = () => new AbortController().signal;
// Tuiles du Gard (dans la zone HIGHRES) et de l'Himalaya (hors France).
const GARD = { z: 11, x: 2088, y: 522 };
const EVEREST = { z: 10, x: 1518, y: 352 };

test("les valeurs sans donnee deviennent NaN", () => {
  const data = markNoData(Float32Array.from([-99999, 5, -1001, 0]));
  assert.ok(Number.isNaN(data[0]!) && Number.isNaN(data[2]!));
  assert.deepEqual([data[1], data[3]], [5, 0]);
});

test("URL WMTS BIL", () => {
  const url = new URL(ignTileUrl(IGN_LAYERS.highres.id, 11, 2088, 522));
  assert.equal(url.searchParams.get("LAYER"), "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES");
  assert.equal(url.searchParams.get("TILEMATRIXSET"), "WGS84G");
  assert.equal(url.searchParams.get("TILEMATRIX"), "11");
  assert.equal(url.searchParams.get("TILECOL"), "2088");
  assert.equal(url.searchParams.get("TILEROW"), "522");
  assert.equal(url.searchParams.get("FORMAT"), "image/x-bil;bits=32");
});

test("France : HIGHRES seul quand la tuile est pleine", async () => {
  const { fetchImpl, urls } = fakeFetch(() => tileOf(700));
  const data = await new IgnElevationProvider(fetchImpl).fetchTile(GARD.z, GARD.x, GARD.y, signal());
  assert.equal(data![0], 700);
  assert.equal(urls.length, 1);
  assert.ok(urls[0]!.includes("HIGHRES"));
});

test("les trous HIGHRES sont combles par SRTM3", async () => {
  const { fetchImpl } = fakeFetch((url) => {
    if (!url.includes("HIGHRES")) return tileOf(300);
    const data = new Float32Array(CELLS).fill(700);
    data[5] = -99999;
    return new Response(data.buffer);
  });
  const data = await new IgnElevationProvider(fetchImpl).fetchTile(10, 1044, 261, signal());
  assert.equal(data![0], 700);
  assert.equal(data![5], 300);
});

test("hors de France : SRTM3 directement", async () => {
  const { fetchImpl, urls } = fakeFetch(() => tileOf(8000));
  const data = await new IgnElevationProvider(fetchImpl).fetchTile(EVEREST.z, EVEREST.x, EVEREST.y, signal());
  assert.equal(data![0], 8000);
  assert.equal(urls.length, 1);
  assert.ok(urls[0]!.includes("SRTM3"));
});

test("aucune source a ce niveau : null, sans requete", async () => {
  const { fetchImpl, urls } = fakeFetch(() => tileOf(1));
  assert.equal(await new IgnElevationProvider(fetchImpl).fetchTile(12, 6074, 1411, signal()), null);
  assert.equal(urls.length, 0);
});

test("404 : null, sans nouvelle tentative", { timeout: 2000 }, async () => {
  const { fetchImpl, urls } = fakeFetch(() => new Response("", { status: 404 }));
  assert.equal(await new IgnElevationProvider(fetchImpl).fetchTile(EVEREST.z, EVEREST.x, EVEREST.y, signal()), null);
  assert.equal(urls.length, 1);
});

test("au plus N requetes simultanees", async () => {
  const { fetchImpl, pending } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 2);
  const results = [1, 2, 3].map((i) => provider.fetchTile(EVEREST.z, EVEREST.x + i, EVEREST.y, signal()));
  await tick();
  assert.equal(pending.length, 2);
  pending[0]!.resolve(tileOf(1));
  await results[0];
  await tick();
  assert.equal(pending.length, 3);
  pending[1]!.resolve(tileOf(2));
  pending[2]!.resolve(tileOf(3));
  const data = await Promise.all(results);
  assert.equal(data[2]![0], 3);
});

test("une requete en attente annulee n'est jamais lancee", async () => {
  const { fetchImpl, pending } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 1);
  const first = provider.fetchTile(EVEREST.z, EVEREST.x, EVEREST.y, signal());
  const controller = new AbortController();
  const second = provider.fetchTile(EVEREST.z, EVEREST.x + 1, EVEREST.y, controller.signal);
  controller.abort();
  await assert.rejects(second);
  await tick();
  pending[0]!.resolve(tileOf(1));
  await first;
  await tick();
  assert.equal(pending.length, 1);
});

test("nouvelle tentative apres une erreur serveur", async () => {
  const { fetchImpl, pending } = fakeFetch();
  const provider = new IgnElevationProvider(fetchImpl, 1);
  const result = provider.fetchTile(EVEREST.z, EVEREST.x, EVEREST.y, signal());
  await tick();
  pending[0]!.resolve(new Response("", { status: 503 }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(pending.length, 2);
  pending[1]!.resolve(tileOf(5));
  assert.equal((await result)![0], 5);
});
