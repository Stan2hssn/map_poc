import type IElevationProvider from "./ElevationProvider.interface.ts";
import { encodeHalf } from "./HalfFloat.ts";

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** `data` en demi-flottant ; `null` : aucune source a ce niveau. `holes` : texels NaN. */
export interface CachedTile {
  data: Uint16Array | null;
  holes: boolean;
}

const keyOf = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** Tuiles gardees en memoire (les plus anciennes oubliees) et chargements en cours. */
export class TileCache {
  private readonly _provider: IElevationProvider;
  private readonly _capacity: number;
  private readonly _onLoad: () => void;
  private readonly _tiles = new Map<string, CachedTile>();
  private readonly _pending = new Map<string, AbortController>();

  constructor(provider: IElevationProvider, capacity: number, onLoad: () => void) {
    this._provider = provider;
    this._capacity = capacity;
    this._onLoad = onLoad;
  }

  get pendingCount(): number {
    return this._pending.size;
  }

  get(z: number, x: number, y: number): CachedTile | undefined {
    const key = keyOf(z, x, y);
    const tile = this._tiles.get(key);
    if (tile) {
      this._tiles.delete(key);
      this._tiles.set(key, tile);
    }
    return tile;
  }

  /** Lance ce qui manque, dans l'ordre donne ; abandonne ce qui n'est plus demande. */
  request(ids: TileId[]): void {
    const wanted = new Set(ids.map(({ z, x, y }) => keyOf(z, x, y)));
    for (const [key, controller] of this._pending) {
      if (wanted.has(key)) continue;
      controller.abort();
      this._pending.delete(key);
    }
    for (const { z, x, y } of ids) {
      const key = keyOf(z, x, y);
      if (!this._tiles.has(key) && !this._pending.has(key)) this._load(z, x, y, key);
    }
  }

  dispose(): void {
    for (const controller of this._pending.values()) controller.abort();
    this._pending.clear();
    this._tiles.clear();
  }

  private _load(z: number, x: number, y: number, key: string): void {
    const controller = new AbortController();
    this._pending.set(key, controller);
    const done = (data: Float32Array | null) => {
      if (controller.signal.aborted) return;
      this._pending.delete(key);
      this._tiles.set(key, data ? encodeHalf(data) : { data: null, holes: false });
      for (const oldest of this._tiles.keys()) {
        if (this._tiles.size <= this._capacity) break;
        this._tiles.delete(oldest);
      }
      this._onLoad();
    };
    // Erreur reseau : la tuile est notee vide, le niveau parent la remplace.
    this._provider.fetchTile(z, x, y, controller.signal).then(done, () => done(null));
  }
}
