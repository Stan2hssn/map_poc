import type IElevationProvider from "./ElevationProvider.interface.ts";
import { intersectsBounds, tileBounds } from "./GeoProjection.ts";

const TILE_BYTES = 256 * 256 * 4;
const NO_DATA = -1000;
const RETRY_DELAYS_MS = [300, 900];
/** Metropole et Corse : seule zone ou HIGHRES est tente. */
const FRANCE = { west: -5.5, east: 10, south: 41, north: 51.2 };

export const IGN_LAYERS = {
  /** RGE ALTI, France, jusqu'a ~5 m. */
  highres: { id: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", minZoom: 6, maxZoom: 14 },
  /** SRTM, monde de 56 S a 61 N, jusqu'a ~76 m. */
  srtm3: { id: "ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3", minZoom: 1, maxZoom: 10 },
} as const;

export function ignTileUrl(layer: string, z: number, x: number, y: number): string {
  const params = new URLSearchParams({
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: layer,
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
export function markNoData(data: Float32Array): Float32Array {
  for (let i = 0; i < data.length; i++) {
    if (data[i] < NO_DATA) data[i] = NaN;
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

const inRange = (layer: { minZoom: number; maxZoom: number }, z: number) => z >= layer.minZoom && z <= layer.maxZoom;

/** HIGHRES en France, trous et reste du monde en SRTM3. File limitee, annulation, nouvelles tentatives. */
export class IgnElevationProvider implements IElevationProvider {
  private readonly _fetch: typeof fetch;
  private readonly _maxConcurrent: number;
  private readonly _waiting: (() => void)[] = [];
  private _running = 0;

  constructor(fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args), maxConcurrent = 6) {
    this._fetch = fetchImpl;
    this._maxConcurrent = maxConcurrent;
  }

  async fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array | null> {
    const { highres, srtm3 } = IGN_LAYERS;
    let data: Float32Array | null = null;
    if (inRange(highres, z) && intersectsBounds(tileBounds(z, x, y), FRANCE)) {
      data = await this._layer(highres.id, z, x, y, signal);
      // Hors de France, HIGHRES renvoie aussi des aplats a 0 (Luxembourg) : traites comme des trous.
      data?.forEach((v, i) => v === 0 && (data![i] = NaN));
    }
    if (inRange(srtm3, z) && (!data || data.some(Number.isNaN))) {
      const fill = await this._layer(srtm3.id, z, x, y, signal);
      if (!data) return fill;
      if (fill) data.forEach((v, i) => Number.isNaN(v) && (data![i] = fill[i]));
    }
    return data;
  }

  private async _layer(layer: string, z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array | null> {
    await this._acquire(signal);
    try {
      return await this._download(ignTileUrl(layer, z, x, y), signal);
    } finally {
      this._release();
    }
  }

  private async _download(url: string, signal: AbortSignal): Promise<Float32Array | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this._fetch(url, { signal });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== TILE_BYTES) throw new Error(`taille ${buffer.byteLength}`);
        return markNoData(new Float32Array(buffer));
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
