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
    const top = h[r0 * TILE_SIZE + c0] * (1 - fu) + h[r0 * TILE_SIZE + c1] * fu;
    const bottom = h[r1 * TILE_SIZE + c0] * (1 - fu) + h[r1 * TILE_SIZE + c1] * fu;
    return top * (1 - fv) + bottom * fv;
  }
}
