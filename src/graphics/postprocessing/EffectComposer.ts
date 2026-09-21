import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import { PipelineBase } from "@_core/pipeline/Pipeline.base.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { DepthTexture, HalfFloatType, RenderTarget, Vector2, type Camera, type Scene, type TextureDataType } from "three";
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
 * - La derniere passe active rend a l'ecran.
 * - `normalDepth` : `inputBuffer` porte deux textures (`output`, `normal`) et une profondeur ; les passes
 *   les retrouvent dans `ctx.sceneBuffer`, meme apres les echanges.
 * - `sceneScale` : la scene (le plus cher) se rend a cette fraction de la taille, les effets a pleine taille.
 */
export class EffectComposer extends PipelineBase {
  readonly inputBuffer: RenderTarget;
  readonly outputBuffer: RenderTarget;
  /** Fraction de la taille a laquelle la scene se rend (0 a 1). */
  sceneScale = 1;
  /** Image sautee : l'ecran garde la precedente (rien n'a bouge). */
  paused = false;
  private readonly _chain: PassBase[];
  private readonly _size = new Vector2();
  /** Second tampon a pleine taille, pour les echanges entre effets : la scene peut etre plus petite. */
  private _spare: RenderTarget | null = null;

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

  }

  override prepare(frame: FrameTiming, ctx: PassContext): void {
    if (this.paused) return;
    // La derniere passe active rend a l'ecran : une passe coupee n'en ajoute pas une de copie. Les calques
    // (`overlay`) viennent se poser dessus ensuite, ils ne sont donc pas candidats.
    const last = this._chain.findLast((pass) => pass.enabled && !pass.overlay);
    for (const pass of this._chain) pass.renderToScreen = pass === last;
    const { x, y } = (ctx.renderer as WebGPURenderer).getDrawingBufferSize(this._size);
    const [sx, sy] = [Math.max(1, Math.round(x * this.sceneScale)), Math.max(1, Math.round(y * this.sceneScale))];
    if (sx !== this.inputBuffer.width || sy !== this.inputBuffer.height) this.inputBuffer.setSize(sx, sy);
    if (x !== this.outputBuffer.width || y !== this.outputBuffer.height) {
      this.outputBuffer.setSize(x, y);
      this._spare?.setSize(x, y);
      for (const pass of this._chain) pass.setSize(x, y);
    }
    super.prepare(frame, ctx);
  }

  /**
   * Prepare les pipelines de toute la chaine sans rien dessiner (voir `PassBase.compile`). Les passes posent
   * leur etat l'une apres l'autre, puis toutes les compilations sont attendues ensemble.
   */
  compile(renderer: WebGPURenderer, scene: Scene, camera: Camera): Promise<void> {
    const pending = this._chain.filter((pass) => pass.enabled).map((pass) => pass.compile(renderer, scene, camera, this.inputBuffer));
    return Promise.all(pending).then(() => undefined);
  }

  override render(frame: FrameTiming, ctx: PassContext): void {
    if (this.paused) return;
    ctx.inputBuffer = this.inputBuffer;
    for (const pass of this._chain) {
      if (pass.enabled) pass.render(frame, ctx);
    }
  }

  override postRender(frame: FrameTiming, ctx: PassContext): void {
    if (this.paused) return;
    let input = this.inputBuffer;
    let output = this.outputBuffer;
    ctx.sceneBuffer = this.inputBuffer;

    for (const pass of this._chain) {
      if (!pass.enabled || !pass.postRender) continue;
      ctx.inputBuffer = input;
      ctx.outputBuffer = output;
      pass.postRender(frame, ctx);
      if (!pass.needsSwap) continue;
      // Apres la scene, les effets s'echangent deux tampons a pleine taille.
      const next = input === this.inputBuffer ? this._spareBuffer() : input;
      [input, output] = [output, next];
    }
  }

  private _spareBuffer(): RenderTarget {
    this._spare ??= new RenderTarget(this.outputBuffer.width, this.outputBuffer.height, {
      type: this.outputBuffer.texture.type,
      samples: this.outputBuffer.samples,
    });
    return this._spare;
  }

  override dispose(): void {
    this.inputBuffer.dispose();
    this.outputBuffer.dispose();
    this._spare?.dispose();
    super.dispose();
  }
}
