# Relief du Gard en direct — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** afficher le relief du Gard chargé en direct depuis l'IGN, en 3D (déplacement GPU TSL), navigable au glisser.

**Architecture:** modules purs testés sous `src/graphics/terrain/` (projection, fournisseur WMTS, masque, arbre de tuiles, géométrie), rendu dans des nodes du pipeline (`Terrain`, `Lights`, `MapCamera`) et un matériau TSL. Spec : `docs/superpowers/specs/2026-09-17-relief-gard-design.md`.

**Tech Stack:** three r181 (`WebGPURenderer`, TSL, `MapControls`), Nuxt 4, Node 24 (`node --test`, types retirés nativement). Aucune dépendance ajoutée.

**Règles :** code concis, typage limité aux frontières, commentaires d'une ligne (voir `src/_core/README.md` § Style de code). Les modules testés n'importent aucun alias (`@_core`, `@graphics`) ni `three/webgpu`.

**Écart assumé avec la spec :** pas de cache LRU de textures. Une tuile fusionnée libère sa texture ; la recharger passe par le cache HTTP (21 jours), quasi instantané.

---

### Task 1: Script de test et projection

**Files:**
- Modify: `package.json` (scripts)
- Create: `src/graphics/terrain/GeoProjection.ts`
- Test: `src/graphics/terrain/GeoProjection.test.ts`

- [ ] **Step 1: Ajouter le script de test**

Dans `package.json`, après `"typecheck": "nuxt typecheck",` :

```json
    "test": "node --test \"src/**/*.test.ts\"",
```

- [ ] **Step 2: Écrire le test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GeoProjection, tileBounds, tilesCovering } from "./GeoProjection.ts";

const GARD = { west: 3.2624, south: 43.4603, east: 4.8456, north: 44.4597 };
const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("un degre de latitude vaut 111,195 km vers le nord (z negatif)", () => {
  const p = new GeoProjection(4, 44);
  close(p.x(4), 0);
  close(p.z(45), -111.195);
});

test("un degre de longitude est reduit par cos(lat0)", () => {
  const p = new GeoProjection(4, 44);
  close(p.x(5), 111.195 * Math.cos((44 * Math.PI) / 180));
});

test("aller-retour lon/lat", () => {
  const p = new GeoProjection(4.05, 43.96);
  close(p.lon(p.x(3.7)), 3.7, 1e-9);
  close(p.lat(p.z(44.2)), 44.2, 1e-9);
});

test("rect : nord en haut (minZ)", () => {
  const r = new GeoProjection(4, 44).rect({ west: 3, south: 43, east: 5, north: 45 });
  assert.ok(r.minX < 0 && r.maxX > 0 && r.minZ < 0 && r.maxZ > 0);
});

test("emprise d'une tuile WGS84G", () => {
  const b = tileBounds(9, 522, 130);
  close(b.west, 3.515625, 1e-9);
  close(b.north, 44.296875, 1e-9);
  close(b.east - b.west, 0.3515625, 1e-9);
  close(b.north - b.south, 0.3515625, 1e-9);
});

test("le Gard tient dans 20 tuiles de niveau 9", () => {
  const tiles = tilesCovering(9, GARD);
  assert.equal(tiles.length, 20);
  assert.deepEqual(tiles[0], { x: 521, y: 129 });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `pnpm test`
Expected: FAIL, `Cannot find module .../GeoProjection.ts`

- [ ] **Step 4: Implémenter**

```ts
export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface SceneRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Projection plate locale en km : x vers l'est, z vers le sud. Ecart < 1 % sur un departement. */
export class GeoProjection {
  readonly lon0: number;
  readonly lat0: number;
  private readonly _kx: number;
  private readonly _kz = EARTH_RADIUS_KM * RAD;

  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this._kx = EARTH_RADIUS_KM * RAD * Math.cos(lat0 * RAD);
  }

  x(lon: number): number {
    return (lon - this.lon0) * this._kx;
  }

  z(lat: number): number {
    return (this.lat0 - lat) * this._kz;
  }

  lon(x: number): number {
    return this.lon0 + x / this._kx;
  }

  lat(z: number): number {
    return this.lat0 - z / this._kz;
  }

  rect(b: GeoBounds): SceneRect {
    return { minX: this.x(b.west), maxX: this.x(b.east), minZ: this.z(b.north), maxZ: this.z(b.south) };
  }
}

/** Grille WGS84G de l'IGN : origine (-180, 90), 2^(z+1) colonnes, 2^z lignes. */
export function tileSpan(z: number): number {
  return 180 / 2 ** z;
}

export function tileBounds(z: number, x: number, y: number): GeoBounds {
  const span = tileSpan(z);
  const west = -180 + x * span;
  const north = 90 - y * span;
  return { west, east: west + span, north, south: north - span };
}

export function tilesCovering(z: number, b: GeoBounds): { x: number; y: number }[] {
  const span = tileSpan(z);
  const tiles: { x: number; y: number }[] = [];
  for (let y = Math.floor((90 - b.north) / span); y <= Math.floor((90 - b.south) / span); y++) {
    for (let x = Math.floor((b.west + 180) / span); x <= Math.floor((b.east + 180) / span); x++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}
```

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm test`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add package.json src/graphics/terrain/GeoProjection.ts src/graphics/terrain/GeoProjection.test.ts
git commit -m "feat(terrain): projection locale et grille WGS84G"
```

---

### Task 2: Fournisseur d'altitude IGN

**Files:**
- Create: `src/graphics/terrain/ElevationProvider.interface.ts`
- Create: `src/graphics/terrain/IgnElevationProvider.ts`
- Test: `src/graphics/terrain/IgnElevationProvider.test.ts`

- [ ] **Step 1: Écrire le test**

```ts
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm test`
Expected: FAIL, `Cannot find module .../IgnElevationProvider.ts`

- [ ] **Step 3: Implémenter le contrat**

`src/graphics/terrain/ElevationProvider.interface.ts` :

```ts
export default interface IElevationProvider {
  /** 256 x 256 altitudes en metres, ligne 0 au nord ; 0 sans donnee. */
  fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array>;
}
```

- [ ] **Step 4: Implémenter le fournisseur**

`src/graphics/terrain/IgnElevationProvider.ts` :

```ts
import type IElevationProvider from "./ElevationProvider.interface.ts";

const TILE_BYTES = 256 * 256 * 4;
const NO_DATA = -1000;
const RETRY_DELAYS_MS = [300, 900];

export function ignTileUrl(z: number, x: number, y: number): string {
  const params = new URLSearchParams({
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES",
    STYLE: "normal",
    TILEMATRIXSET: "WGS84G",
    TILEMATRIX: String(z),
    TILEROW: String(y),
    TILECOL: String(x),
    FORMAT: "image/x-bil;bits=32",
  });
  return `https://data.geopf.fr/wmts?${params}`;
}

/** Mer et hors couverture : l'IGN renvoie -99999. */
export function cleanElevation(data: Float32Array): Float32Array {
  for (let i = 0; i < data.length; i++) {
    if (data[i] < NO_DATA) data[i] = 0;
  }
  return data;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Tuiles WMTS de l'IGN : file limitee, annulation, deux nouvelles tentatives. */
export class IgnElevationProvider implements IElevationProvider {
  private readonly _fetch: typeof fetch;
  private readonly _maxConcurrent: number;
  private readonly _waiting: (() => void)[] = [];
  private _running = 0;

  constructor(fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args), maxConcurrent = 6) {
    this._fetch = fetchImpl;
    this._maxConcurrent = maxConcurrent;
  }

  async fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array> {
    await this._acquire(signal);
    try {
      return await this._download(ignTileUrl(z, x, y), signal);
    } finally {
      this._release();
    }
  }

  private async _download(url: string, signal: AbortSignal): Promise<Float32Array> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this._fetch(url, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== TILE_BYTES) throw new Error(`taille ${buffer.byteLength}`);
        return cleanElevation(new Float32Array(buffer));
      } catch (error) {
        if (signal.aborted || attempt >= RETRY_DELAYS_MS.length) throw error;
        await wait(RETRY_DELAYS_MS[attempt], signal);
      }
    }
  }

  private _acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this._running < this._maxConcurrent) {
      this._running++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancel);
        this._running++;
        resolve();
      };
      const cancel = () => {
        this._waiting.splice(this._waiting.indexOf(start), 1);
        reject(signal.reason);
      };
      this._waiting.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  private _release(): void {
    this._running--;
    this._waiting.shift()?.();
  }
}
```

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm test`
Expected: PASS, 11 tests

- [ ] **Step 6: Commit**

```bash
git add src/graphics/terrain/ElevationProvider.interface.ts src/graphics/terrain/IgnElevationProvider.ts src/graphics/terrain/IgnElevationProvider.test.ts
git commit -m "feat(terrain): tuiles d'altitude IGN en direct"
```

---

### Task 3: Configuration et masque du département

**Files:**
- Create: `src/graphics/config/terrain.config.ts`
- Create: `src/graphics/terrain/TerrainMask.ts`
- Test: `src/graphics/terrain/TerrainMask.test.ts`

- [ ] **Step 1: Écrire le test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GeoProjection } from "./GeoProjection.ts";
import { maskCovers, rasterizeMask, type Ring } from "./TerrainMask.ts";

const projection = new GeoProjection(0, 0);
const rect = projection.rect({ west: 0, south: -1, east: 1, north: 0 });
// Carre couvrant la moitie ouest de l'emprise.
const westHalf: Ring = [[0, 0], [0.5, 0], [0.5, -1], [0, -1], [0, 0]];

test("rasterise l'interieur au centre des pixels", () => {
  const mask = rasterizeMask([[westHalf]], projection, rect, 10);
  assert.equal(mask.width, 10);
  assert.equal(mask.height, 10);
  const row = [...mask.data.subarray(50, 60)];
  assert.deepEqual(row, [255, 255, 255, 255, 255, 0, 0, 0, 0, 0]);
});

test("un trou (pair-impair) reste vide", () => {
  const outer: Ring = [[0, 0], [1, 0], [1, -1], [0, -1], [0, 0]];
  const hole: Ring = [[0.4, -0.4], [0.6, -0.4], [0.6, -0.6], [0.4, -0.6], [0.4, -0.4]];
  const mask = rasterizeMask([[outer, hole]], projection, rect, 10);
  assert.equal(mask.data[5 * 10 + 5], 0);
  assert.equal(mask.data[1 * 10 + 1], 255);
});

test("couverture d'un rectangle", () => {
  const mask = rasterizeMask([[westHalf]], projection, rect, 10);
  const east = projection.rect({ west: 0.6, south: -1, east: 1, north: 0 });
  const west = projection.rect({ west: 0.1, south: -0.5, east: 0.2, north: -0.4 });
  assert.equal(maskCovers(mask, east), false);
  assert.equal(maskCovers(mask, west), true);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm test`
Expected: FAIL, `Cannot find module .../TerrainMask.ts`

- [ ] **Step 3: Implémenter la configuration**

`src/graphics/config/terrain.config.ts` :

```ts
import type { GeoBounds } from "@graphics/terrain/GeoProjection.ts";

export const TERRAIN_CONFIG = {
  departement: "30",
  /** Emprise du Gard (contour ADMIN EXPRESS, EPSG:4326). */
  bounds: { west: 3.2624, south: 43.4603, east: 4.8456, north: 44.4597 } satisfies GeoBounds,
  rootZoom: 9,
  maxZoom: 13,
  /** Subdivise sous ce rapport distance / taille de tuile, fusionne au-dessus de `merge`. */
  split: 1.5,
  merge: 3,
  maxVisible: 300,
  segments: 32,
  maskSize: 1024,
} as const;
```

- [ ] **Step 4: Implémenter le masque**

`src/graphics/terrain/TerrainMask.ts` :

```ts
import type { GeoProjection, SceneRect } from "./GeoProjection.ts";

/** Anneau [lon, lat]. Un polygone = anneau exterieur puis trous. */
export type Ring = [number, number][];

export interface MaskGrid {
  data: Uint8Array;
  width: number;
  height: number;
  rect: SceneRect;
}

export async function fetchIgnContour(codeInsee: string): Promise<Ring[][]> {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "ADMINEXPRESS-COG-CARTO.LATEST:departement",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    PROPERTYNAME: "code_insee,geometrie",
    CQL_FILTER: `code_insee='${codeInsee}'`,
  });
  const response = await fetch(`https://data.geopf.fr/wfs/ows?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const geometry = (await response.json()).features?.[0]?.geometry;
  if (!geometry) throw new Error(`departement ${codeInsee} introuvable`);
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

/** Rastérisation pair-impair au centre de chaque pixel ; 255 dedans, ligne 0 au nord. */
export function rasterizeMask(polygons: Ring[][], projection: GeoProjection, rect: SceneRect, maxSize: number): MaskGrid {
  const spanX = rect.maxX - rect.minX;
  const spanZ = rect.maxZ - rect.minZ;
  const scale = maxSize / Math.max(spanX, spanZ);
  const width = Math.max(1, Math.round(spanX * scale));
  const height = Math.max(1, Math.round(spanZ * scale));
  const data = new Uint8Array(width * height);

  const rings = polygons.flat().map((ring) =>
    ring.map(([lon, lat]) => [
      ((projection.x(lon) - rect.minX) / spanX) * width,
      ((projection.z(lat) - rect.minZ) / spanZ) * height,
    ])
  );

  const crossings: number[] = [];
  for (let row = 0; row < height; row++) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      data.fill(255, row * width + from, row * width + to + 1);
    }
  }
  return { data, width, height, rect };
}

/** Vrai si un pixel du masque tombe dans le rectangle. */
export function maskCovers({ data, width, height, rect }: MaskGrid, r: SceneRect): boolean {
  const col = (x: number) => ((x - rect.minX) / (rect.maxX - rect.minX)) * width;
  const row = (z: number) => ((z - rect.minZ) / (rect.maxZ - rect.minZ)) * height;
  const c0 = Math.max(0, Math.floor(col(r.minX)));
  const c1 = Math.min(width - 1, Math.max(c0, Math.ceil(col(r.maxX)) - 1));
  const r0 = Math.max(0, Math.floor(row(r.minZ)));
  const r1 = Math.min(height - 1, Math.max(r0, Math.ceil(row(r.maxZ)) - 1));
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      if (data[y * width + x]) return true;
    }
  }
  return false;
}
```

`data.fill` avec `from > to` ne remplit rien, ce qui couvre le cas d'un segment plus étroit qu'un pixel.

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm test`
Expected: PASS, 14 tests

- [ ] **Step 6: Commit**

```bash
git add src/graphics/config/terrain.config.ts src/graphics/terrain/TerrainMask.ts src/graphics/terrain/TerrainMask.test.ts
git commit -m "feat(terrain): contour du departement et masque"
```

---

### Task 4: Tuile et arbre de tuiles

**Files:**
- Create: `src/graphics/terrain/Tile.ts`
- Create: `src/graphics/terrain/TileTree.ts`
- Test: `src/graphics/terrain/TileTree.test.ts`

- [ ] **Step 1: Écrire le test**

```ts
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm test`
Expected: FAIL, `Cannot find module .../Tile.ts`

- [ ] **Step 3: Implémenter la tuile**

`src/graphics/terrain/Tile.ts` :

```ts
import type { SceneRect } from "./GeoProjection.ts";

export const TILE_SIZE = 256;

export type TileState = "loading" | "ready" | "error";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class Tile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly rect: SceneRect;
  readonly controller = new AbortController();
  state: TileState = "loading";
  heights: Float32Array | null = null;
  children: Tile[] | null = null;
  visible = false;

  constructor(z: number, x: number, y: number, rect: SceneRect) {
    this.z = z;
    this.x = x;
    this.y = y;
    this.rect = rect;
  }

  get key(): string {
    return `${this.z}/${this.x}/${this.y}`;
  }

  get size(): number {
    return Math.max(this.rect.maxX - this.rect.minX, this.rect.maxZ - this.rect.minZ);
  }

  contains(x: number, z: number): boolean {
    const r = this.rect;
    return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  }

  /** Altitude (m) bilineaire, texels centres comme dans la texture. */
  heightAt(x: number, z: number): number {
    const h = this.heights!;
    const r = this.rect;
    const u = ((x - r.minX) / (r.maxX - r.minX)) * TILE_SIZE - 0.5;
    const v = ((z - r.minZ) / (r.maxZ - r.minZ)) * TILE_SIZE - 0.5;
    const c0 = clamp(Math.floor(u), 0, TILE_SIZE - 1);
    const r0 = clamp(Math.floor(v), 0, TILE_SIZE - 1);
    const c1 = Math.min(c0 + 1, TILE_SIZE - 1);
    const r1 = Math.min(r0 + 1, TILE_SIZE - 1);
    const fu = clamp(u - c0, 0, 1);
    const fv = clamp(v - r0, 0, 1);
    const top = h[r0 * TILE_SIZE + c0]! * (1 - fu) + h[r0 * TILE_SIZE + c1]! * fu;
    const bottom = h[r1 * TILE_SIZE + c0]! * (1 - fu) + h[r1 * TILE_SIZE + c1]! * fu;
    return top * (1 - fv) + bottom * fv;
  }
}
```

- [ ] **Step 4: Implémenter l'arbre**

`src/graphics/terrain/TileTree.ts` :

```ts
import { tileBounds, tilesCovering, type GeoBounds, type GeoProjection } from "./GeoProjection.ts";
import { Tile } from "./Tile.ts";

export interface TileTreeOptions {
  rootZoom: number;
  maxZoom: number;
  split: number;
  merge: number;
  maxVisible: number;
}

export interface TileHandlers {
  accept(tile: Tile): boolean;
  load(tile: Tile): Promise<Float32Array>;
  /** Une tuile vient d'aboutir (prete ou en echec) : l'arbre attend une mise a jour. */
  loaded(): void;
  setVisible(tile: Tile, visible: boolean): void;
  release(tile: Tile): void;
}

/**
 * Arbre de tuiles a la maniere de geo-three (mode radial). Une tuile parente
 * reste affichee tant que ses enfants ne sont pas tous prets.
 */
export class TileTree {
  readonly roots: Tile[];
  private readonly _projection: GeoProjection;
  private readonly _options: TileTreeOptions;
  private readonly _handlers: TileHandlers;
  private _visible = 0;

  constructor(bounds: GeoBounds, projection: GeoProjection, options: TileTreeOptions, handlers: TileHandlers) {
    this._projection = projection;
    this._options = options;
    this._handlers = handlers;
    this.roots = this._createAll(
      tilesCovering(options.rootZoom, bounds).map(({ x, y }): [number, number, number] => [options.rootZoom, x, y])
    );
  }

  get visibleCount(): number {
    return this._visible;
  }

  /** Position de la camera en km. */
  update(camera: { x: number; y: number; z: number }): void {
    for (const root of this.roots) this._update(root, camera);
  }

  /** Altitude (m) sur la tuile prete la plus fine ; 0 hors emprise. */
  heightAt(x: number, z: number): number {
    let best: Tile | undefined;
    let level: Tile[] | null = this.roots;
    while (level) {
      const tile: Tile | undefined = level.find((t) => t.contains(x, z));
      if (!tile) break;
      if (tile.state === "ready") best = tile;
      level = tile.children;
    }
    return best ? best.heightAt(x, z) : 0;
  }

  dispose(): void {
    for (const root of this.roots) this._release(root);
  }

  private _createAll(ids: [number, number, number][]): Tile[] {
    const tiles: Tile[] = [];
    for (const [z, x, y] of ids) {
      const tile = new Tile(z, x, y, this._projection.rect(tileBounds(z, x, y)));
      if (!this._handlers.accept(tile)) continue;
      this._load(tile);
      tiles.push(tile);
    }
    return tiles;
  }

  private _load(tile: Tile): void {
    const settle = (state: "ready" | "error", heights: Float32Array | null) => {
      if (tile.controller.signal.aborted) return;
      tile.state = state;
      tile.heights = heights;
      this._handlers.loaded();
    };
    this._handlers.load(tile).then(
      (heights) => settle("ready", heights),
      () => settle("error", null)
    );
  }

  private _update(tile: Tile, camera: { x: number; y: number; z: number }): void {
    const cx = (tile.rect.minX + tile.rect.maxX) / 2;
    const cz = (tile.rect.minZ + tile.rect.maxZ) / 2;
    const ratio = Math.hypot(camera.x - cx, camera.y, camera.z - cz) / tile.size;
    const o = this._options;

    if (tile.children && ratio > o.merge) {
      this._merge(tile);
    } else if (tile.children) {
      for (const child of tile.children) this._update(child, camera);
    } else if (ratio < o.split && tile.state === "ready" && tile.z < o.maxZoom && this._visible < o.maxVisible) {
      const z = tile.z + 1;
      const x = tile.x * 2;
      const y = tile.y * 2;
      tile.children = this._createAll([[z, x, y], [z, x + 1, y], [z, x, y + 1], [z, x + 1, y + 1]]);
    }

    const childrenReady = !!tile.children?.length && tile.children.every((c) => c.state === "ready");
    this._setVisible(tile, tile.state === "ready" && !childrenReady);
    if (tile.children && !childrenReady) {
      for (const child of tile.children) this._hide(child);
    }
  }

  private _merge(tile: Tile): void {
    for (const child of tile.children!) this._release(child);
    tile.children = null;
  }

  private _hide(tile: Tile): void {
    this._setVisible(tile, false);
    for (const child of tile.children ?? []) this._hide(child);
  }

  private _release(tile: Tile): void {
    for (const child of tile.children ?? []) this._release(child);
    tile.children = null;
    tile.controller.abort();
    this._setVisible(tile, false);
    this._handlers.release(tile);
    tile.heights = null;
  }

  private _setVisible(tile: Tile, visible: boolean): void {
    if (tile.visible === visible) return;
    tile.visible = visible;
    this._visible += visible ? 1 : -1;
    this._handlers.setVisible(tile, visible);
  }
}
```

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm test`
Expected: PASS, 21 tests

- [ ] **Step 6: Commit**

```bash
git add src/graphics/terrain/Tile.ts src/graphics/terrain/TileTree.ts src/graphics/terrain/TileTree.test.ts
git commit -m "feat(terrain): arbre de tuiles avec niveaux de detail"
```

---

### Task 5: Géométrie de tuile

**Files:**
- Create: `src/graphics/terrain/TileGeometry.ts`
- Test: `src/graphics/terrain/TileGeometry.test.ts`

- [ ] **Step 1: Écrire le test**

```ts
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
  // Composante y du produit vectoriel (ab x ac) avec y = 0 : az*bx - ax*bz.
  assert.ok(ab[1]! * ac[0]! - ab[0]! * ac[1]! > 0);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm test`
Expected: FAIL, `Cannot find module .../TileGeometry.ts`

- [ ] **Step 3: Implémenter**

```ts
import { Box3, BufferGeometry, Float32BufferAttribute, Sphere, Vector3 } from "three";

/**
 * Grille unitaire (x vers l'est, z vers le sud, uv = (x, z)) bordee d'une jupe :
 * copie des bords marquee `skirt`, que le shader descend pour cacher les fissures entre niveaux.
 */
export function createTileGeometry(segments: number): BufferGeometry {
  const n = segments + 1;
  const at = (col: number, row: number) => row * n + col;
  const positions: number[] = [];
  const uvs: number[] = [];
  const skirt: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      positions.push(col / segments, 0, row / segments);
      uvs.push(col / segments, row / segments);
      skirt.push(0);
    }
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = at(col, row);
      const b = at(col + 1, row);
      const c = at(col, row + 1);
      const d = at(col + 1, row + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const border: number[] = [];
  for (let col = 0; col < segments; col++) border.push(at(col, 0));
  for (let row = 0; row < segments; row++) border.push(at(segments, row));
  for (let col = segments; col > 0; col--) border.push(at(col, segments));
  for (let row = segments; row > 0; row--) border.push(at(0, row));

  border.forEach((vertex, i) => {
    positions.push(positions[vertex * 3]!, 0, positions[vertex * 3 + 2]!);
    uvs.push(uvs[vertex * 2]!, uvs[vertex * 2 + 1]!);
    skirt.push(1);
    const next = border[(i + 1) % border.length]!;
    const low = n * n + i;
    const lowNext = n * n + ((i + 1) % border.length);
    indices.push(vertex, next, low, next, lowNext, low);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("skirt", new Float32BufferAttribute(skirt, 1));
  geometry.setIndex(indices);
  // Deplacement fait dans le shader : bornes elargies (-2 a 5 km) pour le culling.
  geometry.boundingBox = new Box3(new Vector3(0, -2, 0), new Vector3(1, 5, 1));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return geometry;
}
```

Orientation : pour `a=(0,0)`, `c=(0,1)`, `b=(1,0)` en (x, z), `(c − a) × (b − a)` a pour composante y `1·1 − 0·0 = 1` : la face regarde vers +y. Le matériau est `DoubleSide` de toute façon, pour les jupes.

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm test`
Expected: PASS, 23 tests

- [ ] **Step 5: Commit**

```bash
git add src/graphics/terrain/TileGeometry.ts src/graphics/terrain/TileGeometry.test.ts
git commit -m "feat(terrain): geometrie de tuile avec jupe"
```

---

### Task 6: Matériau TSL

**Files:**
- Create: `src/graphics/materials/Terrain.material.ts`

- [ ] **Step 1: Implémenter**

```ts
import { DataTexture, DoubleSide, RedFormat, Vector2, type Texture } from "three";
import { attribute, cameraViewMatrix, float, normalize, positionLocal, positionWorld, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";

const METERS_TO_KM = 0.001;
const TEXEL_UV = 1 / 256;

/** Partages par toutes les tuiles : un seul programme GPU pour toutes. */
export const terrainSettings = {
  exaggeration: uniform(2),
  mask: texture(new DataTexture(new Uint8Array([255]), 1, 1, RedFormat)),
  maskOrigin: uniform(new Vector2()),
  maskSize: uniform(new Vector2(1, 1)),
};

export function createTerrainMaterial(heights: Texture, texelKm: Vector2, skirtDepthKm: number): MeshStandardNodeMaterial {
  const texel = uniform(texelKm);
  const skirtDepth = uniform(skirtDepthKm);
  const scale = terrainSettings.exaggeration.mul(METERS_TO_KM);
  const heightAt = (offset: Node) => texture(heights, uv().add(offset)).r.mul(scale);

  const material = new MeshStandardNodeMaterial({ color: 0xf1efea, roughness: 1, metalness: 0, side: DoubleSide });

  const height = texture(heights, uv()).level(float(0)).r.mul(scale);
  material.positionNode = positionLocal.add(vec3(0, height.sub(attribute("skirt", "float").mul(skirtDepth)), 0));

  // Differences centrales : normale monde de y = f(x, z), puis repere vue.
  const dx = heightAt(vec2(TEXEL_UV, 0)).sub(heightAt(vec2(-TEXEL_UV, 0))).div(texel.x.mul(2));
  const dz = heightAt(vec2(0, TEXEL_UV)).sub(heightAt(vec2(0, -TEXEL_UV))).div(texel.y.mul(2));
  const normalWorld = vec3(dx.negate(), 1, dz.negate());
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalWorld, 0)).xyz);

  const maskUv = positionWorld.xz.sub(terrainSettings.maskOrigin).div(terrainSettings.maskSize);
  material.opacityNode = terrainSettings.mask.sample(maskUv).r;
  material.alphaTest = 0.5;

  return material;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/graphics/materials/Terrain.material.ts
git commit -m "feat(terrain): materiau TSL a deplacement et normales par pixel"
```

---

### Task 7: Node du terrain

**Files:**
- Modify: `src/graphics/nodes/Node.id.ts`
- Create: `src/graphics/nodes/terrain/Terrain.node.ts`

- [ ] **Step 1: Ids**

Dans `NODE_ID`, remplacer `CUBE: "cube",` par :

```ts
  TERRAIN: "terrain",
  LIGHTS: "lights",
```

- [ ] **Step 2: Implémenter le node**

```ts
import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { createTerrainMaterial, terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type IElevationProvider from "@graphics/terrain/ElevationProvider.interface.ts";
import { GeoProjection, type SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { fetchIgnContour, maskCovers, rasterizeMask, type MaskGrid } from "@graphics/terrain/TerrainMask.ts";
import { TILE_SIZE, type Tile } from "@graphics/terrain/Tile.ts";
import { createTileGeometry } from "@graphics/terrain/TileGeometry.ts";
import { TileTree } from "@graphics/terrain/TileTree.ts";
import { DataTexture, DataUtils, Group, HalfFloatType, LinearFilter, Mesh, RedFormat, Vector2, Vector3, type Camera } from "three";
import type { MeshStandardNodeMaterial } from "three/webgpu";

const geometry = createTileGeometry(TERRAIN_CONFIG.segments);
const SKIRT_RATIO = 0.05;

function toHalfFloat(data: Float32Array): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = DataUtils.toHalfFloat(data[i]);
  return out;
}

function linearTexture(texture: DataTexture): DataTexture {
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  // Lignes de largeur quelconque (masque R8) : sans cela, le repli WebGL2 les decale.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Relief du departement : tuiles IGN chargees et affinees selon la camera. */
export class TerrainNode extends Object3DNodeBase {
  readonly projection: GeoProjection;
  readonly rect: SceneRect;
  private readonly _group: Group;
  private readonly _provider: IElevationProvider;
  private readonly _camera: () => Camera;
  private readonly _meshes = new Map<Tile, Mesh>();
  private readonly _cameraPosition = new Vector3();
  private readonly _lastCamera = new Vector3(Infinity, 0, 0);
  private _tree: TileTree | null = null;
  private _maskTexture: DataTexture | null = null;
  private _dirty = true;

  constructor(provider: IElevationProvider, camera: () => Camera) {
    const group = new Group();
    super(NODE_ID.TERRAIN, "Terrain", group);
    const { west, east, south, north } = TERRAIN_CONFIG.bounds;
    this.projection = new GeoProjection((west + east) / 2, (south + north) / 2);
    this.rect = this.projection.rect(TERRAIN_CONFIG.bounds);
    this._group = group;
    this._provider = provider;
    this._camera = camera;
  }

  get tileCount(): number {
    return this._tree?.visibleCount ?? 0;
  }

  /** Altitude affichee (km, exageration comprise). */
  heightAt(x: number, z: number): number {
    return ((this._tree?.heightAt(x, z) ?? 0) * terrainSettings.exaggeration.value) / 1000;
  }

  override async beforeMount(): Promise<void> {
    if (this._tree) return;
    const mask = await this._loadMask();
    const { minX, minZ, maxX, maxZ } = this.rect;
    this._maskTexture = linearTexture(new DataTexture(mask.data, mask.width, mask.height, RedFormat));
    terrainSettings.mask.value = this._maskTexture;
    terrainSettings.maskOrigin.value.set(minX, minZ);
    terrainSettings.maskSize.value.set(maxX - minX, maxZ - minZ);

    this._tree = new TileTree(TERRAIN_CONFIG.bounds, this.projection, TERRAIN_CONFIG, {
      accept: (tile) => maskCovers(mask, tile.rect),
      load: (tile) => this._provider.fetchTile(tile.z, tile.x, tile.y, tile.controller.signal),
      loaded: () => {
        this._dirty = true;
      },
      setVisible: (tile, visible) => {
        if (visible) this._meshFor(tile).visible = true;
        else if (this._meshes.has(tile)) this._meshes.get(tile)!.visible = false;
      },
      release: (tile) => this._disposeMesh(tile),
    });
  }

  // Recalcul seulement quand la camera bouge ou qu'une tuile aboutit.
  override update(): void {
    if (!this._tree) return;
    this._camera().getWorldPosition(this._cameraPosition);
    if (!this._dirty && this._cameraPosition.distanceToSquared(this._lastCamera) < 1e-8) return;
    this._dirty = false;
    this._lastCamera.copy(this._cameraPosition);
    this._tree.update(this._cameraPosition);
  }

  override dispose(): void {
    this._tree?.dispose();
    this._maskTexture?.dispose();
    super.dispose();
  }

  private async _loadMask(): Promise<MaskGrid> {
    try {
      const contour = await fetchIgnContour(TERRAIN_CONFIG.departement);
      return rasterizeMask(contour, this.projection, this.rect, TERRAIN_CONFIG.maskSize);
    } catch (error) {
      console.warn("[Terrain] contour indisponible, rectangle complet", error);
      return { data: new Uint8Array([255]), width: 1, height: 1, rect: this.rect };
    }
  }

  private _meshFor(tile: Tile): Mesh {
    const existing = this._meshes.get(tile);
    if (existing) return existing;

    const { minX, minZ, maxX, maxZ } = tile.rect;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const heights = linearTexture(new DataTexture(toHalfFloat(tile.heights!), TILE_SIZE, TILE_SIZE, RedFormat, HalfFloatType));
    const material = createTerrainMaterial(heights, new Vector2(width / TILE_SIZE, depth / TILE_SIZE), tile.size * SKIRT_RATIO);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(minX, 0, minZ);
    mesh.scale.set(width, 1, depth);
    mesh.userData.heights = heights;
    this._group.add(mesh);
    this._meshes.set(tile, mesh);
    return mesh;
  }

  private _disposeMesh(tile: Tile): void {
    const mesh = this._meshes.get(tile);
    if (!mesh) return;
    this._group.remove(mesh);
    (mesh.material as MeshStandardNodeMaterial).dispose();
    (mesh.userData.heights as DataTexture).dispose();
    this._meshes.delete(tile);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: erreurs seulement dans `Main.universe.ts` et `Cube.node.ts` (`NODE_ID.CUBE` retiré), corrigées en Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/graphics/nodes/Node.id.ts src/graphics/nodes/terrain/Terrain.node.ts
git commit -m "feat(terrain): node du relief"
```

---

### Task 8: Lumières

**Files:**
- Create: `src/graphics/nodes/lights/Lights.node.ts`

- [ ] **Step 1: Implémenter**

```ts
import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { DirectionalLight, Group, HemisphereLight, MathUtils } from "three";

/** Soleil d'ombrage cartographique (nord-ouest) et ambiance douce. */
export class LightsNode extends Object3DNodeBase {
  readonly settings = { azimuth: 315, elevation: 45, intensity: 3 };
  private readonly _sun = new DirectionalLight(0xffffff);
  private readonly _sky = new HemisphereLight(0xffffff, 0xb9b2a6, 0.6);

  constructor() {
    const group = new Group();
    super(NODE_ID.LIGHTS, "Lights", group);
    group.add(this._sun, this._sun.target, this._sky);
    this.apply();
  }

  apply(): void {
    const az = MathUtils.degToRad(this.settings.azimuth);
    const el = MathUtils.degToRad(this.settings.elevation);
    this._sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(100);
    this._sun.intensity = this.settings.intensity;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/graphics/nodes/lights/Lights.node.ts
git commit -m "feat(terrain): lumieres d'ombrage"
```

---

### Task 9: Caméra de carte

**Files:**
- Create: `src/graphics/nodes/cameras/MapCamera.node.ts`

- [ ] **Step 1: Implémenter**

```ts
import { NodeBase } from "@_core/nodes/Node.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

const FOV = 35;
const TILT = MathUtils.degToRad(50);
const GROUND_CLEARANCE_KM = 0.1;
const TARGET_FOLLOW = 0.2;

/** Vue inclinee nord en haut : glisser pour se deplacer, molette ou pincement pour zoomer. */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  private readonly _element: HTMLElement;
  private readonly _bounds: SceneRect;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _startDistance: number;
  private readonly _start = new Vector3();
  private readonly _shift = new Vector3();
  private _controls: MapControls | null = null;

  constructor(element: HTMLElement, bounds: SceneRect, heightAt: (x: number, z: number) => number) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera");
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.01, 1000);
    this._element = element;
    this._bounds = bounds;
    this._heightAt = heightAt;

    const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    this._startDistance = (half / Math.tan(MathUtils.degToRad(FOV) / 2)) * 1.1;
    this._start.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this.camera.position.copy(this._start).add(new Vector3(0, Math.cos(TILT), Math.sin(TILT)).multiplyScalar(this._startDistance));
    this.camera.lookAt(this._start);
  }

  override onMounted(): void {
    super.onMounted();
    const controls = new MapControls(this.camera, this._element);
    controls.enableRotate = false;
    controls.zoomToCursor = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.5;
    controls.maxDistance = this._startDistance * 1.2;
    controls.target.copy(this._start);
    controls.update();
    this._controls = controls;
  }

  override onUnmounted(): void {
    this._controls?.dispose();
    this._controls = null;
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    const controls = this._controls;
    if (!controls) return;
    controls.enabled = this.isActive();
    if (!controls.enabled) return;

    // Cible dans le departement et posee sur le relief ; la camera suit le meme decalage.
    const { target } = controls;
    const b = this._bounds;
    const x = MathUtils.clamp(target.x, b.minX, b.maxX);
    const z = MathUtils.clamp(target.z, b.minZ, b.maxZ);
    const dy = (this._heightAt(x, z) - target.y) * TARGET_FOLLOW;
    this._shift.set(x - target.x, dy, z - target.z);
    target.add(this._shift);
    this.camera.position.add(this._shift);
    controls.update(dt / 1000);

    const floor = this._heightAt(this.camera.position.x, this.camera.position.z) + GROUND_CLEARANCE_KM;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    const near = Math.max(this.camera.position.distanceTo(target) / 1000, 0.01);
    if (Math.abs(near - this.camera.near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  override resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  override dispose(): void {
    this._controls?.dispose();
    super.dispose();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/graphics/nodes/cameras/MapCamera.node.ts
git commit -m "feat(terrain): camera de carte au glisser"
```

---

### Task 10: Univers, réglages, nettoyage

**Files:**
- Modify: `src/graphics/universes/impl/Main.universe.ts`
- Delete: `src/graphics/nodes/cube/Cube.node.ts`, `src/graphics/nodes/cameras/MainCamera.node.ts` (remplacés, validé dans la conception)

- [ ] **Step 1: Réécrire l'univers**

```ts
import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { MapCameraNode } from "@graphics/nodes/cameras/MapCamera.node.ts";
import { LightsNode } from "@graphics/nodes/lights/Lights.node.ts";
import { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { EffectComposer, EffectPass, RenderPass } from "@graphics/postprocessing/index.ts";
import { IgnElevationProvider } from "@graphics/terrain/IgnElevationProvider.ts";
import { Color, Scene } from "three";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

const BACKGROUND = 0xdcd9d4;

export class MainUniverse extends UniverseBase<UniverseId> {
  private readonly _cameraNode: MapCameraNode;
  private readonly _lights = new LightsNode();
  private readonly _terrain: TerrainNode;
  private _nodesRegistered = false;

  constructor(device: IThreeDeviceSlice) {
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);

    // La camera est lue par le terrain apres le montage seulement.
    const cameraRef: { node: MapCameraNode | null } = { node: null };
    const terrain = new TerrainNode(new IgnElevationProvider(), () => cameraRef.node!.camera);
    const cameraNode = new MapCameraNode(device.renderer.domElement, terrain.rect, (x, z) => terrain.heightAt(x, z));
    cameraRef.node = cameraNode;

    super(
      UNIVERSE_ID.MAIN,
      scene,
      cameraNode.camera,
      new NodeGraph(scene),
      new EffectComposer([new RenderPass(), new EffectPass()]),
      device.assets.preloadGroup.bind(device.assets),
      device.debug
    );

    this._cameraNode = cameraNode;
    this._terrain = terrain;
    cameraNode.isActive = () => this.camera === cameraNode.camera;

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [NODE_ID.CAMERA_MAIN, NODE_ID.LIGHTS, NODE_ID.TERRAIN],
    });
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([this._cameraNode, this._lights, this._terrain]);
      this._nodesRegistered = true;
    }
    await Promise.resolve(super.beforeMount());
  }

  protected override getAssetPreloadGroups(): string[] {
    return ["universe:main"];
  }

  override onMounted(): void {
    super.onMounted();
    void this.applyContract(NODE_ID.CONTRACT_BASE);
    this._settings();
  }

  /** Declare une fois : application toujours, panneau seulement avec `?debug`. */
  private _settings(): void {
    const debug = this._debug;
    if (!debug) return;
    const lights = this._lights;

    const declare = (target: DebugTarget | null) => {
      const exaggeration = debug.bind(
        target,
        terrainSettings.exaggeration as unknown as Record<string, unknown>,
        "value",
        { label: "exageration", min: 0.5, max: 6, step: 0.1 },
        "terrain.exaggeration"
      );
      const sun = (
        [
          ["azimuth", { label: "soleil azimut", min: 0, max: 360, step: 1 }],
          ["elevation", { label: "soleil elevation", min: 5, max: 90, step: 1 }],
          ["intensity", { label: "soleil intensite", min: 0, max: 10, step: 0.1 }],
        ] as const
      ).map(([key, options]) =>
        debug.bind(target, lights.settings, key, options, `lights.${key}`).on("change", () => lights.apply())
      );
      lights.apply();
      return () => {
        exaggeration.dispose();
        for (const binding of sun) binding.dispose();
      };
    };

    declare(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.UNIVERSE_MAIN, mount: declare });
  }
}
```

- [ ] **Step 2: Supprimer les nodes remplacés**

```bash
git rm src/graphics/nodes/cube/Cube.node.ts src/graphics/nodes/cameras/MainCamera.node.ts
```

- [ ] **Step 3: Typecheck et tests**

Run: `pnpm typecheck && pnpm test`
Expected: aucune erreur, 23 tests PASS. Si `debug.bind(..., lights.settings, key, ...)` refuse le type, caster `lights.settings as unknown as Record<string, unknown>`.

- [ ] **Step 4: Commit**

```bash
git add -A src/graphics
git commit -m "feat(terrain): univers du relief du Gard, reglages persistants"
```

---

### Task 11: Vérification navigateur

- [ ] **Step 1: Lancer** le serveur (`preview_start` config `map`), recharger la page.
- [ ] **Step 2: Rendu** : capture. Attendu : relief blanc du Gard découpé, fond `#dcd9d4`, aucune erreur console.
- [ ] **Step 3: Programme partagé** : dans la console, compter les pipelines de rendu après chargement (`__stage.renderer._pipelines.caches.size` ou équivalent). Attendu : nombre constant quand le nombre de tuiles augmente. Sinon, passer à un atlas (nouvelle tâche).
- [ ] **Step 4: Niveaux de détail** : zoomer par script (`controls` via le node caméra) sur les Cévennes. Attendu : tuiles de niveau > 9, `tileCount` ≤ 300, requêtes WMTS ≤ 6 en parallèle, parent affiché pendant le chargement.
- [ ] **Step 5: Navigation** : glisser, zoom, bornes (cible dans le Gard, caméra au-dessus du relief).
- [ ] **Step 6: Coût** : temps d'image au rendu manuel (méthode du benchmark post-traitement).
- [ ] **Step 7: Repli WebGL2** : `forceWebGL: true` temporaire dans `ThreeStage`, capture, puis retrait.
- [ ] **Step 8: Build** : `pnpm build`, exit 0.

---

### Task 12: Clôture

- [ ] **Step 1:** Reporter dans la spec les écarts constatés (LRU retiré, réglages ajustés à l'œil).
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers
git commit -m "docs(terrain): ecarts d'implementation"
```
