import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import { PipelineBase } from "@_core/pipeline/Pipeline.base.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { DepthTexture, HalfFloatType, RenderTarget, Vector2, type TextureDataType } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { PassBase } from "./passes/Pass.base.ts";

interface EffectComposerOptions {
  frameBufferType?: TextureDataType;
  multisampling?: number;
  /** La scene ecrit aussi ses normales (vue) et sa profondeur, lisibles par les effets (`EffectContext`). */
  normalDepth?: boolean;
}

/**
 * Pipeline de post-traitement, d'apres l'EffectComposer de pmndrs.
 *
 * - `render` : les passes de scene ecrivent `inputBuffer`.
 * - `postRender` : chaque passe lit l'entree, ecrit la sortie, puis les deux s'echangent.
 * - La derniere passe rend a l'ecran.
 * - `normalDepth` : `inputBuffer` porte deux textures (`output`, `normal`) et une profondeur ; les passes
 *   les retrouvent dans `ctx.sceneBuffer`, meme apres les echanges.
 */
export class EffectComposer extends PipelineBase {
  readonly inputBuffer: RenderTarget;
  readonly outputBuffer: RenderTarget;
  private readonly _chain: PassBase[];
  private readonly _size = new Vector2();

  constructor(passes: PassBase[], { frameBufferType = HalfFloatType, multisampling = 0, normalDepth = false }: EffectComposerOptions = {}) {
    super(passes);
    this._chain = passes;
    const options = { type: frameBufferType, samples: multisampling };
    this.outputBuffer = new RenderTarget(1, 1, options);
    this.inputBuffer = new RenderTarget(1, 1, { ...options, count: normalDepth ? 2 : 1 });
    if (normalDepth) {
      // `mrt` range ses sorties par nom de texture.
      this.inputBuffer.textures[0]!.name = "output";
      this.inputBuffer.textures[1]!.name = "normal";
      this.inputBuffer.depthTexture = new DepthTexture(1, 1);
    }

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
    ctx.sceneBuffer = this.inputBuffer;

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
