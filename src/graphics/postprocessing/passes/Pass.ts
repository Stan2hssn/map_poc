import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { Renderer } from "@_core/systems/Renderer.type.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import {
  BufferGeometry,
  ColorManagement,
  Float32BufferAttribute,
  Mesh,
  OrthographicCamera,
  type Material,
  type WebGLRenderTarget,
} from "three";

// Un triangle plutot qu'un quad : pas de diagonale, dont les pixels seraient traites deux fois.
// Coordonnees de `QuadMesh` (three) : uv lues en TSL, recalculees depuis `position` en GLSL.
const fullscreenGeometry = new BufferGeometry();
fullscreenGeometry.setAttribute("position", new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
fullscreenGeometry.setAttribute("uv", new Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
const fullscreenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Passe de `EffectComposer`. Voir `EffectComposer` pour l'ordre et les buffers. */
export abstract class Pass implements IPass {
  enabled = true;
  /** Pose par `EffectComposer` sur la derniere passe. */
  renderToScreen = false;
  /** Echanger entree et sortie apres `postRender`. */
  needsSwap = true;
  /** Triangle plein ecran, a doter d'un materiau. */
  protected readonly fullscreen = new Mesh(fullscreenGeometry);

  postRender?(frame: FrameTiming, ctx: PassContext): void;

  constructor() {
    this.fullscreen.frustumCulled = false;
  }

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void {}
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void {}

  render(_frame: FrameTiming, _ctx: PassContext): void {}

  /** Taille du canvas en pixels reels, appelee par `EffectComposer` quand elle change. */
  setSize(_width: number, _height: number): void {}

  resize(): void {}

  dispose(): void {
    (this.fullscreen.material as Material).dispose();
  }

  protected renderFullscreen(ctx: PassContext): void {
    const renderer = ctx.renderer as Renderer;
    const toScreen = this.renderToScreen;
    renderer.setRenderTarget(toScreen ? null : (ctx.outputBuffer as WebGLRenderTarget));

    // WebGPU : l'encodage sRGB est dans le materiau, sinon three le refait dans une passe interne.
    const colorSpace = renderer.outputColorSpace;
    if (toScreen && "isWebGPURenderer" in renderer) renderer.outputColorSpace = ColorManagement.workingColorSpace;
    renderer.render(this.fullscreen, fullscreenCamera);
    renderer.outputColorSpace = colorSpace;
  }
}
