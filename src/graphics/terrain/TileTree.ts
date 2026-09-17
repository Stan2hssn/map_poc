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
