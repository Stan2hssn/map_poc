import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import { PipelineBase } from "@_core/pipeline/Pipeline.base.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { HalfFloatType, RenderTarget, Vector2, type TextureDataType } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { PassBase } from "./passes/Pass.base.ts";

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
  readonly inputBuffer: RenderTarget;
  readonly outputBuffer: RenderTarget;
  private readonly _chain: PassBase[];
  private readonly _size = new Vector2();

  constructor(passes: PassBase[], { frameBufferType = HalfFloatType, multisampling = 0 }: EffectComposerOptions = {}) {
    super(passes);
    this._chain = passes;
    this.inputBuffer = new RenderTarget(1, 1, { type: frameBufferType, samples: multisampling });
    this.outputBuffer = this.inputBuffer.clone();

    const last = passes.at(-1);
    if (last) last.renderToScreen = true;
  }

  override prepare(frame: FrameTiming, ctx: PassContext): void {
    const { x, y } = (ctx.renderer as WebGPURenderer).getDrawingBufferSize(this._size);
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
