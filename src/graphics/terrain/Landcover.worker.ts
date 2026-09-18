import type { GeoBounds } from "./GeoProjection.ts";
import { drawLandcoverTile, landcoverUrl, landcoverZoom, mercatorTiles, packLandcover, tilePointToLonLat, type TileXY } from "./Landcover.ts";
import { decodeVectorTile, type VectorLayer } from "./VectorTile.ts";

export interface LandcoverRequest {
  id: number;
  bounds: GeoBounds;
  /** Zone ou le bati complet est dessine, par-dessus le niveau d'ensemble. */
  focus: GeoBounds;
  width: number;
  height: number;
}

export interface LandcoverImage extends LandcoverRequest {
  data: Uint8Array;
  complete: boolean;
}

const MAX_TILES = 300;
/** Au centre, deux niveaux plus fins : le PLAN IGN ne garde tout le bati qu'a partir du 14-15. */
const FOCUS_LEVELS = 2;
const MAX_ZOOM = 16;
const MAX_CONCURRENT = 6;
// Pendant le chargement, une image partielle part au plus a ce rythme.
const PARTIAL_MS = 200;

const scope = self as unknown as {
  onmessage: (event: MessageEvent<LandcoverRequest>) => void;
  postMessage(message: LandcoverImage, transfer: Transferable[]): void;
};

/** Tuiles decodees (null : vide ou hors couverture), les plus anciennes oubliees. */
const tiles = new Map<string, Map<string, VectorLayer> | null>();
const loading = new Map<string, Promise<void>>();
const waiting: (() => void)[] = [];
let running = 0;
let latest: LandcoverRequest | null = null;

scope.onmessage = ({ data }) => {
  latest = data;
  void compose(data);
};

interface Level {
  z: number;
  tiles: TileXY[];
}

async function compose(request: LandcoverRequest): Promise<void> {
  const z = landcoverZoom(request.bounds, request.width);
  const fine = Math.min(MAX_ZOOM, z + FOCUS_LEVELS);
  const levels: Level[] = [{ z, tiles: mercatorTiles(z, request.bounds) }];
  if (fine > z) levels.push({ z: fine, tiles: mercatorTiles(fine, request.focus) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const partial = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      render(request, levels, false);
    }, PARTIAL_MS);
  };
  await Promise.all(levels.flatMap(({ z, tiles }) => tiles.map((tile) => load(z, tile, request).then(partial))));
  clearTimeout(timer);
  render(request, levels, true);
}

function load(z: number, tile: TileXY, request: LandcoverRequest): Promise<void> {
  const key = `${z}/${tile.x}/${tile.y}`;
  if (tiles.has(key)) return Promise.resolve();
  const pending = loading.get(key);
  if (pending) return pending;
  const promise = slot()
    .then(async () => {
      // Une demande plus recente a remplace celle-ci : inutile de telecharger.
      if (latest !== request) return;
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
  loading.set(key, promise);
  return promise;
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
      const layers = tiles.get(`${z}/${tile.x}/${tile.y}`);
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
  scope.postMessage({ ...request, data, complete }, [data.buffer]);
}
