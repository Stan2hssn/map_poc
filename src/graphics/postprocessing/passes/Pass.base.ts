import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { ColorManagement, type Camera, type Material, type RenderTarget, type Scene } from "three";
import { QuadMesh, type WebGPURenderer } from "three/webgpu";

/** Passe de `EffectComposer`. Voir `EffectComposer` pour l'ordre et les buffers. */
export abstract class PassBase implements IPass {
  enabled = true;
  /** Pose par `EffectComposer` sur la derniere passe. */
  renderToScreen = false;
  /** Echanger entree et sortie apres `postRender`. */
  needsSwap = true;
  /** Passe posee sur l'image deja a l'ecran : elle ne prend pas le `renderToScreen` de la chaine. */
  readonly overlay: boolean = false;
  /** Triangle plein ecran (pas de quad : sa diagonale ferait traiter des pixels deux fois). */
  protected readonly fullscreen = new QuadMesh();

  postRender?(frame: FrameTiming, ctx: PassContext): void;

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void {}
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void {}

  render(_frame: FrameTiming, _ctx: PassContext): void {}

  /**
   * Prepare les pipelines de ce que la passe dessine, sans rien dessiner. WebGPU les compile sinon au premier
   * rendu : un gros shader (le sol) y bloque l'image, ou manque, le temps de sa compilation.
   */
  compile(_renderer: WebGPURenderer, _scene: Scene, _camera: Camera, _input: RenderTarget): Promise<void> {
    return Promise.resolve();
  }

  /** Taille du canvas en pixels reels, appelee par `EffectComposer` quand elle change. */
  setSize(_width: number, _height: number): void {}

  resize(): void {}

  dispose(): void {
    (this.fullscreen.material as Material | null)?.dispose();
  }

  protected renderFullscreen(ctx: PassContext): void {
    const renderer = ctx.renderer as WebGPURenderer;
    renderer.setRenderTarget(this.renderToScreen ? null : (ctx.outputBuffer as RenderTarget));

    // L'encodage sRGB est dans le materiau : sans ce reglage, three le refait dans une passe interne.
    const colorSpace = renderer.outputColorSpace;
    if (this.renderToScreen) renderer.outputColorSpace = ColorManagement.workingColorSpace;
    this.fullscreen.render(renderer);
    renderer.outputColorSpace = colorSpace;
  }
}
