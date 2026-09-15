import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import { PipelineBase } from "@_core/pipeline/Pipeline.base.ts";
import type { Renderer } from "@_core/systems/Renderer.type.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { HalfFloatType, Vector2, WebGLRenderTarget, type TextureDataType } from "three";
import type { Pass } from "./passes/Pass.ts";

interface EffectComposerOptions {
  frameBufferType?: TextureDataType;
  multisampling?: number;
}

/**
 * Pipeline de post-traitement, d'apres l'EffectComposer de pmndrs.
 *
 * - `render` : les passes de scene ecrivent `inputBuffer`.
 * - `postRender` : chaque passe lit l'entree, ecrit la sortie, puis les deux s'echangent.
 * - La derniere passe rend a l'ecran.
 */
export class EffectComposer extends PipelineBase {
  readonly inputBuffer: WebGLRenderTarget;
  readonly outputBuffer: WebGLRenderTarget;
  private readonly _chain: Pass[];
  private readonly _size = new Vector2();

  // `WebGLRenderTarget` sert aussi a WebGPURenderer, qui accepte tout `RenderTarget`.
  constructor(passes: Pass[], { frameBufferType = HalfFloatType, multisampling = 0 }: EffectComposerOptions = {}) {
    super(passes);
    this._chain = passes;
    this.inputBuffer = new WebGLRenderTarget(1, 1, { type: frameBufferType, samples: multisampling });
    this.outputBuffer = this.inputBuffer.clone();

    const last = passes.at(-1);
    if (last) last.renderToScreen = true;
  }

  override prepare(frame: FrameTiming, ctx: PassContext): void {
    const { x, y } = (ctx.renderer as Renderer).getDrawingBufferSize(this._size);
    if (x !== this.inputBuffer.width || y !== this.inputBuffer.height) {
      this.inputBuffer.setSize(x, y);
      this.outputBuffer.setSize(x, y);
      for (const pass of this._chain) pass.setSize(x, y);
    }
    super.prepare(frame, ctx);
  }

  override render(frame: FrameTiming, ctx: PassContext): void {
    ctx.inputBuffer = this.inputBuffer;
    for (const pass of this._chain) {
      if (pass.enabled) pass.render(frame, ctx);
    }
  }

  override postRender(frame: FrameTiming, ctx: PassContext): void {
    let input = this.inputBuffer;
    let output = this.outputBuffer;

    for (const pass of this._chain) {
      if (!pass.enabled || !pass.postRender) continue;
      ctx.inputBuffer = input;
      ctx.outputBuffer = output;
      pass.postRender(frame, ctx);
      if (pass.needsSwap) [input, output] = [output, input];
    }
  }

  override dispose(): void {
    this.inputBuffer.dispose();
    this.outputBuffer.dispose();
    super.dispose();
  }
}
