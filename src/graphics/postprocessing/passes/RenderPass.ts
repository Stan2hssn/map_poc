import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { Renderer } from "@_core/systems/Renderer.type.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, Scene, WebGLRenderTarget } from "three";
import { Pass } from "./Pass.ts";

/** Scene et camera de l'univers, rendues dans le buffer d'entree (ou a l'ecran si seule). */
export class RenderPass extends Pass {
  override render(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as Renderer;
    renderer.setRenderTarget(this.renderToScreen ? null : (ctx.inputBuffer as WebGLRenderTarget));
    renderer.render(ctx.scene as Scene, ctx.camera as Camera);
  }
}
