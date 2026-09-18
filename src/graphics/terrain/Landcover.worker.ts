import { buildTileMesh, drawBuildingHeights, peakMap, type BuildingMesh } from "./Buildings.ts";
import type { GeoBounds } from "./GeoProjection.ts";
import {
  drawLandcoverTile,
  fineZoom,
  LANDCOVER_LAYERS,
  landcoverUrl,
  landcoverZoom,
  mercatorTiles,
  packLandcover,
  tilePointToLonLat,
  type TileXY,
} from "./Landcover.ts";
import { decodeVectorTile, vectorLayer, type VectorLayer } from "./VectorTile.ts";

export interface LandcoverRequest {
  kind: "landcover";
  id: number;
  bounds: GeoBounds;
  /** Zone ou le bati complet est dessine, par-dessus le niveau d'ensemble. */
  focus: GeoBounds;
  width: number;
  height: number;
  /** Dessiner aussi les hauteurs du bati sur `focus`, a la meme taille. */
  heights: boolean;
}

export interface LandcoverImage extends LandcoverRequest {
  data: Uint8Array;
  /** Hauteurs du bati (m) sur `focus` et leurs sommets par cellule (`peakMap`), ou null si non demandees. */
  buildingHeights: Uint8Array | null;
  buildingPeaks: Uint8Array | null;
  buildingMax: number;
  complete: boolean;
  /** Temps de dessin cumule de cette image dans le worker (ms). */
  renderMs: number;
}

export interface TileRef extends TileXY {
  z: number;
}

/** Tuiles dont les volumes manquent ; remplace la demande precedente. */
export interface BuildingsRequest {
  kind: "buildings";
  tiles: TileRef[];
}

export interface BuildingsTile extends TileRef, BuildingMesh {
  kind: "buildings";
}

const MAX_TILES = 300;
// data.geopf.fr sert en HTTP/2 : a 16 requetes a la fois, une vue arrive 2,5 a 3 fois plus vite qu'a 6.
const MAX_CONCURRENT = 16;
// Pendant le chargement, une image partielle part au plus a ce rythme.
const PARTIAL_MS = 200;

const scope = self as unknown as {
  onmessage: (event: MessageEvent<LandcoverRequest | BuildingsRequest>) => void;
  postMessage(message: LandcoverImage | BuildingsTile, transfer: Transferable[]): void;
};

/** Tuiles decodees (null : vide ou hors couverture), les plus anciennes oubliees. */
const tiles = new Map<string, Map<string, VectorLayer> | null>();
/** Chargements en cours, et qui les attend encore. */
const loading = new Map<string, { promise: Promise<void>; wanted: (() => boolean)[] }>();
const waiting: (() => void)[] = [];
let running = 0;
let latest: LandcoverRequest | null = null;
let buildingsWanted = new Set<string>();

const keyOf = (z: number, tile: TileXY) => `${z}/${tile.x}/${tile.y}`;

scope.onmessage = ({ data }) => {
  if (data.kind === "buildings") {
    buildingsWanted = new Set(data.tiles.map((t) => keyOf(t.z, t)));
    for (const tile of data.tiles) void sendBuildings(tile);
    return;
  }
  latest = data;
  void compose(data);
};

interface Level {
  z: number;
  tiles: TileXY[];
}

type Pen2D = OffscreenCanvasRenderingContext2D;

/** Surfaces (bati, vegetation, eau) et routes d'un niveau, dessinees tuile par tuile. */
interface Pens {
  areas: Pen2D;
  roads: Pen2D;
}

/**
 * Image en cours : chaque tuile est dessinee une fois, a son arrivee, sur la toile de son niveau.
 * Le niveau d'ensemble a un fond noir opaque ; le niveau fin est transparent hors de ses tuiles, et
 * le recouvre a l'assemblage. Plus besoin de tout redessiner a chaque image partielle.
 */
interface Composition {
  request: LandcoverRequest;
  coarse: Pens;
  fine: Pens;
  heights: Pen2D | null;
  buildingMax: number;
  drawMs: number;
}

function pens(width: number, height: number, opaque: boolean): Pens {
  const make = () => {
    const pen = new OffscreenCanvas(width, height).getContext("2d")!;
    if (opaque) {
      pen.fillStyle = "#000000";
      pen.fillRect(0, 0, width, height);
    }
    return pen;
  };
  return { areas: make(), roads: make() };
}

async function compose(request: LandcoverRequest): Promise<void> {
  const { width, height } = request;
  const z = landcoverZoom(request.bounds, width);
  const fine = fineZoom(z);
  const levels: Level[] = [{ z, tiles: mercatorTiles(z, request.bounds) }];
  if (fine > z) levels.push({ z: fine, tiles: mercatorTiles(fine, request.focus) });
  const composition: Composition = {
    request,
    coarse: pens(width, height, true),
    fine: pens(width, height, false),
    heights: request.heights ? pens(width, height, true).areas : null,
    buildingMax: 0,
    drawMs: 0,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const partial = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      post(composition, false);
    }, PARTIAL_MS);
  };
  // Une demande plus recente a remplace celle-ci : inutile de telecharger ni de dessiner pour elle.
  const current = () => latest === request;
  await Promise.all(
    levels.flatMap(({ z, tiles }, level) =>
      tiles.map((tile) =>
        load(z, tile, current).then(() => {
          draw(composition, z, tile, level > 0, level === levels.length - 1);
          partial();
        })
      )
    )
  );
  clearTimeout(timer);
  post(composition, true);
}

function draw(c: Composition, z: number, tile: TileXY, fine: boolean, heights: boolean): void {
  const layers = tiles.get(keyOf(z, tile));
  if (latest !== c.request || !layers) return;
  const started = performance.now();
  const { bounds, width, height, focus } = c.request;
  const pens = fine ? c.fine : c.coarse;
  if (fine) {
    // Fond opaque sur la tuile (pixels entiers, sans bord adouci) : elle recouvrira le niveau d'ensemble.
    const [west, north] = tilePointToLonLat(z, tile, 0, 0, 1);
    const [east, south] = tilePointToLonLat(z, tile, 1, 1, 1);
    const sx = width / (bounds.east - bounds.west);
    const sy = height / (bounds.north - bounds.south);
    const x0 = Math.floor((west - bounds.west) * sx);
    const y0 = Math.floor((bounds.north - north) * sy);
    const x1 = Math.ceil((east - bounds.west) * sx);
    const y1 = Math.ceil((bounds.north - south) * sy);
    for (const pen of [pens.areas, pens.roads]) {
      pen.globalCompositeOperation = "source-over";
      pen.fillStyle = "#000000";
      pen.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  drawLandcoverTile(pens.areas, pens.roads, layers, z, tile, c.request);
  if (heights && c.heights) {
    c.buildingMax = Math.max(c.buildingMax, drawBuildingHeights(c.heights, layers, z, tile, { bounds: focus, width, height }));
  }
  c.drawMs += performance.now() - started;
}

let assembly: Pen2D | null = null;

/** Niveau fin par-dessus le niveau d'ensemble, lus en pixels. */
function assemble(coarse: Pen2D, fine: Pen2D, width: number, height: number): Uint8ClampedArray {
  if (!assembly || assembly.canvas.width !== width || assembly.canvas.height !== height) {
    assembly = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  }
  assembly.globalCompositeOperation = "source-over";
  assembly.drawImage(coarse.canvas, 0, 0);
  assembly.drawImage(fine.canvas, 0, 0);
  return assembly.getImageData(0, 0, width, height).data;
}

function post(c: Composition, complete: boolean): void {
  if (latest !== c.request) return;
  const started = performance.now();
  const { width, height } = c.request;
  const areas = assemble(c.coarse.areas, c.fine.areas, width, height);
  const data = packLandcover(areas, assemble(c.coarse.roads, c.fine.roads, width, height));
  const transfer: Transferable[] = [data.buffer];

  let buildingHeights: Uint8Array | null = null;
  let buildingPeaks: Uint8Array | null = null;
  if (c.heights) {
    const rgba = c.heights.getImageData(0, 0, width, height).data;
    buildingHeights = new Uint8Array(width * height);
    for (let i = 0; i < buildingHeights.length; i++) buildingHeights[i] = rgba[i * 4]!;
    buildingPeaks = peakMap(buildingHeights, width, height);
    transfer.push(buildingHeights.buffer, buildingPeaks.buffer);
  }
  const renderMs = c.drawMs + performance.now() - started;
  scope.postMessage({ ...c.request, data, buildingHeights, buildingPeaks, buildingMax: c.buildingMax, complete, renderMs }, transfer);
}

async function sendBuildings(tile: TileRef): Promise<void> {
  const key = keyOf(tile.z, tile);
  const wanted = () => buildingsWanted.has(key);
  await load(tile.z, tile, wanted);
  if (!wanted()) return;
  const layers = tiles.get(key);
  // Passee pendant qu'aucune demande ne la voulait : elle l'est de nouveau.
  if (layers === undefined) return sendBuildings(tile);
  buildingsWanted.delete(key);
  const layer = layers?.get("bati_surf");
  const mesh = buildTileMesh(layer ?? vectorLayer(4096, []), tile.z, tile);
  const message: BuildingsTile = { kind: "buildings", z: tile.z, x: tile.x, y: tile.y, ...mesh };
  scope.postMessage(message, [mesh.roofPoints.buffer, mesh.roofBuildings.buffer, mesh.roofIndex.buffer, mesh.wallEdges.buffer, mesh.wallBuildings.buffer]);
}

function load(z: number, tile: TileXY, wanted: () => boolean): Promise<void> {
  const key = keyOf(z, tile);
  if (tiles.has(key)) return Promise.resolve();
  const pending = loading.get(key);
  if (pending) {
    pending.wanted.push(wanted);
    return pending.promise;
  }
  const entry = { promise: Promise.resolve(), wanted: [wanted] };
  entry.promise = slot()
    .then(async () => {
      if (!entry.wanted.some((w) => w())) return;
      const response = await fetch(landcoverUrl(z, tile.x, tile.y));
      const layers = response.ok && response.status !== 204 ? decodeVectorTile(await response.arrayBuffer(), LANDCOVER_LAYERS) : null;
      tiles.set(key, layers);
      for (const old of tiles.keys()) {
        if (tiles.size <= MAX_TILES) break;
        tiles.delete(old);
      }
    })
    .catch(() => {
      tiles.set(key, null);
    })
    .finally(() => {
      loading.delete(key);
      running--;
      waiting.shift()?.();
    });
  loading.set(key, entry);
  return entry.promise;
}

function slot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => (running++, resolve())));
}
