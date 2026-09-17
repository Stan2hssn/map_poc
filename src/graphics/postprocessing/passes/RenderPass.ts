import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, RenderTarget, Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { PassBase } from "./Pass.base.ts";

/** Scene et camera de l'univers, rendues dans le buffer d'entree (ou a l'ecran si seule). */
export class RenderPass extends PassBase {
  override render(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGPURenderer;
    renderer.setRenderTarget(this.renderToScreen ? null : (ctx.inputBuffer as RenderTarget));
    renderer.render(ctx.scene as Scene, ctx.camera as Camera);
  }
}
