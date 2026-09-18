import { TimestampQuery } from "three";
import type { WebGPURenderer } from "three/webgpu";

// Lissage des mesures (ms) : lisibles dans le panneau sans masquer un pic durable.
const SMOOTH_MS = 400;

/**
 * Mesures d'image pour le panneau de debug : cadence, temps GPU (avec `trackTimestamp`),
 * appels de dessin et triangles de toutes les passes (ombres comprises).
 */
export class RenderStatsHelper {
  readonly values = { fps: 0, frameMs: 0, gpuMs: 0, drawCalls: 0, triangles: 0 };
  private readonly _renderer: WebGPURenderer;
  /** `trackTimestamp` a la creation du renderer (et GPU qui le permet). */
  private readonly _timed: boolean;

  constructor(renderer: WebGPURenderer) {
    this._renderer = renderer;
    this._timed = (renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true;
  }

  /** Une fois par image, avant le rendu : compte la precedente. */
  update(dt: number): void {
    const v = this.values;
    const k = 1 - Math.exp(-dt / SMOOTH_MS);
    v.frameMs += (dt - v.frameMs) * k;
    v.fps = 1000 / Math.max(v.frameMs, 1e-3);
    // `Output` remet les compteurs a zero au debut du rendu : ils valent encore l'image precedente.
    v.drawCalls = this._renderer.info.render.drawCalls;
    v.triangles = this._renderer.info.render.triangles;

    if (!this._timed) return;
    // Hors de `setAnimationLoop`, rien n'avance `info.frame` : three regrouperait toutes les images en une.
    this._renderer.info.frame++;
    void this._renderer.resolveTimestampsAsync(TimestampQuery.RENDER).then((ms) => {
      if (ms) v.gpuMs += (ms - v.gpuMs) * k;
    });
  }
}
