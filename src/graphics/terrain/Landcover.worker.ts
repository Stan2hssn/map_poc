import { buildTileMesh, drawBuildingHeights, peakMap, type BuildingMesh } from "./Buildings.ts";
import type { GeoBounds } from "./GeoProjection.ts";
import { drawLandcoverTile, fineZoom, landcoverUrl, landcoverZoom, mercatorTiles, packLandcover, tilePointToLonLat, type TileXY } from "./Landcover.ts";
import { decodeVectorTile, type VectorLayer } from "./VectorTile.ts";

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
const MAX_CONCURRENT = 6;
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

async function compose(request: LandcoverRequest): Promise<void> {
  const z = landcoverZoom(request.bounds, request.width);
  const fine = fineZoom(z);
  const levels: Level[] = [{ z, tiles: mercatorTiles(z, request.bounds) }];
  if (fine > z) levels.push({ z: fine, tiles: mercatorTiles(fine, request.focus) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const partial = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      render(request, levels, false);
    }, PARTIAL_MS);
  };
  // Une demande plus recente a remplace celle-ci : inutile de telecharger pour elle.
  const current = () => latest === request;
  await Promise.all(levels.flatMap(({ z, tiles }) => tiles.map((tile) => load(z, tile, current).then(partial))));
  clearTimeout(timer);
  render(request, levels, true);
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
  const mesh = buildTileMesh(layer ?? { extent: 4096, features: [] }, tile.z, tile);
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
      const layers = response.ok && response.status !== 204 ? decodeVectorTile(await response.arrayBuffer()) : null;
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

function render(request: LandcoverRequest, levels: Level[], complete: boolean): void {
  if (latest !== request) return;
  const { width, height, bounds } = request;
  const areas = new OffscreenCanvas(width, height).getContext("2d")!;
  const roads = new OffscreenCanvas(width, height).getContext("2d")!;
  // Fond opaque : la couverture partielle des bords reste une valeur (anticrenelage), pas un alpha.
  const clear = (x: number, y: number, w: number, h: number) => {
    for (const pen of [areas, roads]) {
      pen.globalCompositeOperation = "source-over";
      pen.fillStyle = "#000000";
      pen.fillRect(x, y, w, h);
    }
  };
  clear(0, 0, width, height);
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  levels.forEach(({ z, tiles: wanted }, level) => {
    for (const tile of wanted) {
      const layers = tiles.get(keyOf(z, tile));
      if (!layers) continue;
      // Une tuile fine remplace le niveau d'ensemble sous elle.
      if (level > 0) {
        const [west, north] = tilePointToLonLat(z, tile, 0, 0, 1);
        const [east, south] = tilePointToLonLat(z, tile, 1, 1, 1);
        clear((west - bounds.west) * sx, (bounds.north - north) * sy, (east - west) * sx, (north - south) * sy);
      }
      drawLandcoverTile(areas, roads, layers, z, tile, request);
    }
  });
  const data = packLandcover(areas.getImageData(0, 0, width, height).data, roads.getImageData(0, 0, width, height).data);
  const transfer: Transferable[] = [data.buffer];

  let buildingHeights: Uint8Array | null = null;
  let buildingPeaks: Uint8Array | null = null;
  let buildingMax = 0;
  if (request.heights) {
    const pen = new OffscreenCanvas(width, height).getContext("2d")!;
    pen.fillStyle = "#000000";
    pen.fillRect(0, 0, width, height);
    const { z, tiles: wanted } = levels.at(-1)!;
    const canvas = { bounds: request.focus, width, height };
    for (const tile of wanted) {
      const layers = tiles.get(keyOf(z, tile));
      if (layers) buildingMax = Math.max(buildingMax, drawBuildingHeights(pen, layers, z, tile, canvas));
    }
    const rgba = pen.getImageData(0, 0, width, height).data;
    buildingHeights = new Uint8Array(width * height);
    for (let i = 0; i < buildingHeights.length; i++) buildingHeights[i] = rgba[i * 4]!;
    buildingPeaks = peakMap(buildingHeights, width, height);
    transfer.push(buildingHeights.buffer, buildingPeaks.buffer);
  }
  scope.postMessage({ ...request, data, buildingHeights, buildingPeaks, buildingMax, complete }, transfer);
}
