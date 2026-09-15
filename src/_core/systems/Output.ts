import { DEVICE_CONFIG } from "@graphics/device/device.config.ts";
import { NoToneMapping, SRGBColorSpace, Vector2 } from "three";
import type { PassContext } from "../pipeline/Pass.interface.ts";
import type { FrameTiming } from "../types/Frame.type.ts";
import type { UniverseBase } from "../universes/Universe.base.ts";
import type { Renderer } from "./Renderer.type.ts";

export default class Output {
  private readonly _renderer: Renderer;
  private readonly _viewportSize = new Vector2();
  private readonly _activeUniverses = new Set<UniverseBase<string>>();
  private readonly _lifecycleToken = new WeakMap<UniverseBase<string>, number>();

  constructor(renderer: Renderer) {
    this._renderer = renderer;
    // Une remise a zero par image (dans `render`) : sinon les compteurs ne
    // montrent que le dernier appel de rendu, un quad plein ecran.
    this._renderer.info.autoReset = false;
  }

  get renderer(): Renderer {
    return this._renderer;
  }

  getActiveUniverses(): UniverseBase<string>[] {
    return Array.from(this._activeUniverses);
  }

  private _bumpToken(u: UniverseBase<string>): number {
    const next = (this._lifecycleToken.get(u) ?? 0) + 1;
    this._lifecycleToken.set(u, next);
    return next;
  }

  async activateUniverse(u: UniverseBase<string>): Promise<void> {
    if (this._activeUniverses.has(u)) return;

    const token = this._bumpToken(u);
    u.active = true;
    this._activeUniverses.add(u);
    if (u.mounted) return;

    try {
      await Promise.resolve(u.beforeMount());
    } catch (error) {
      console.error("[Output] beforeMount failed:", error);
      if (this._lifecycleToken.get(u) !== token) return;
      this._activeUniverses.delete(u);
      u.active = false;
      return;
    }

    if (!u.active) return;
    if (!this._activeUniverses.has(u)) return;
    if (this._lifecycleToken.get(u) !== token) return;
    u.onMounted();
    u.markMounted();
  }

  async deactivateUniverse(u: UniverseBase<string>): Promise<void> {
    if (!this._activeUniverses.has(u)) return;

    const token = this._bumpToken(u);
    this._activeUniverses.delete(u);
    u.active = false;
    if (!u.mounted) return;

    try {
      await Promise.resolve(u.beforeUnmount());
    } catch (error) {
      console.error("[Output] beforeUnmount failed:", error);
      return;
    }

    if (u.active) return;
    if (this._activeUniverses.has(u)) return;
    if (this._lifecycleToken.get(u) !== token) return;
    u.onUnmounted();
    u.markUnmounted();
  }

  update(time: number, dt: number): void {
    for (const u of this._activeUniverses) {
      if (u.mounted) u.update(time, dt);
    }
  }

  render(frame: FrameTiming): void {
    const mounted = Array.from(this._activeUniverses).filter((u) => u.mounted);
    if (mounted.length === 0) return;
    this._renderer.info.reset();

    const jobs = mounted.map((u) => {
      const ctx: PassContext = { scene: u.scene, camera: u.camera, renderer: this._renderer };
      return { pipeline: u.getPipeline(), ctx };
    });

    for (const { pipeline, ctx } of jobs) pipeline.prepare?.(frame, ctx);

    // Apres `prepare` : une passe hors ecran deplace viewport et scissor.
    this._prepareRendererState();
    this._renderer.clear(true, true, true);

    for (const { pipeline, ctx } of jobs) {
      pipeline.render(frame, ctx);
      pipeline.postRender?.(frame, ctx);
    }
  }

  private _prepareRendererState(): void {
    this._renderer.outputColorSpace = SRGBColorSpace;
    this._renderer.toneMapping = NoToneMapping;
    this._renderer.toneMappingExposure = DEVICE_CONFIG.renderer?.toneMappingExposure ?? 1;

    this._renderer.getSize(this._viewportSize);
    const width = this._viewportSize.x;
    const height = this._viewportSize.y;
    if (width <= 0 || height <= 0) return;

    this._renderer.setScissorTest(false);
    this._renderer.setViewport(0, 0, width, height);
    this._renderer.setScissor(0, 0, width, height);
  }

  resize(width: number, height: number): void {
    for (const u of this._activeUniverses) {
      if (u.mounted) u.resize(width, height);
    }
  }

  dispose(): void {}
}
