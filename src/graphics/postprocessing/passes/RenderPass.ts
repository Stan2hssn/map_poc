import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, RenderTarget, Scene } from "three";
import { directionToColor, mrt, normalView, output, vec4 } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { PassBase } from "./Pass.base.ts";

/**
 * Scene et camera de l'univers, rendues dans le buffer d'entree (ou a l'ecran si seule).
 * Buffer a deux textures (`EffectComposer` avec `normalDepth`) : la seconde recoit les normales, et en
 * alpha ce qu'un materiau veut transmettre aux effets (1 par defaut ; voir `NodeMaterial.mrtNode`).
 */
export class RenderPass extends PassBase {
  private readonly _normals = mrt({ output, normal: vec4(directionToColor(normalView), 1) });

  override render(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGPURenderer;
    const target = this.renderToScreen ? null : (ctx.inputBuffer as RenderTarget);
    renderer.setRenderTarget(target);
    renderer.setMRT(target && target.textures.length > 1 ? this._normals : null);
    renderer.render(ctx.scene as Scene, ctx.camera as Camera);
    renderer.setMRT(null);
  }
}
