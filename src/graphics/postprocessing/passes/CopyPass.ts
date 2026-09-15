import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { WebGLRenderTarget } from "three";
import { CopyMaterial } from "../materials/index.ts";
import { Pass } from "./Pass.ts";

/** Copie le buffer d'entree vers la sortie, ou vers l'ecran en sRGB. */
export class CopyPass extends Pass {
  private readonly _material = new CopyMaterial();

  constructor() {
    super();
    this.fullscreen.material = this._material;
  }

  override postRender(_frame: FrameTiming, ctx: PassContext): void {
    this._material.update((ctx.inputBuffer as WebGLRenderTarget).texture, this.renderToScreen);
    this.renderFullscreen(ctx);
  }
}
