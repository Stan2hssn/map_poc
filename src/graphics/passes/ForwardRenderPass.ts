import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, RenderTarget, Scene, WebGLRenderer, WebGLRenderTarget } from "three";

/** Rend la scene dans `target`, ou a l'ecran si `null`. */
export class ForwardRenderPass implements IPass {
  private readonly _target: RenderTarget | null;

  constructor(target: RenderTarget | null = null) {
    this._target = target;
  }

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void {}
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void {}

  render(_frame: FrameTiming, ctx: PassContext): void {
    // Cast WebGL valable pour les deux backends : chacun recoit sa propre classe de cible.
    const renderer = ctx.renderer as WebGLRenderer;
    renderer.setRenderTarget(this._target as WebGLRenderTarget | null);
    renderer.render(ctx.scene as Scene, ctx.camera as Camera);
  }

  resize(): void {}
  dispose(): void {}
}
