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
