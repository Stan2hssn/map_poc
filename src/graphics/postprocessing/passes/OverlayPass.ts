import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { ColorManagement, type Camera, type Scene } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { PassBase } from "./Pass.base.ts";

/**
 * Une scene dessinee par-dessus l'image finie, a l'ecran, sans l'effacer : c'est la place de l'interface.
 * L'encre remplace toute l'image qu'elle traite, un texte rendu avec le terrain y serait pris pour un relief
 * et hachure. Posee apres la derniere passe (`overlay`), elle n'occupe donc aucun tampon de plus.
 */
export class OverlayPass extends PassBase {
  override readonly overlay = true;
  override needsSwap = false;
  private readonly _scene: () => Scene | null;

  constructor(scene: () => Scene | null) {
    super();
    this._scene = scene;
  }

  override compile(renderer: WebGPURenderer, _scene: Scene, camera: Camera): Promise<void> {
    const scene = this._scene();
    if (!scene) return Promise.resolve();
    return this._inCanvasState(renderer, () => renderer.compileAsync(scene, camera));
  }

  override postRender(_frame: FrameTiming, ctx: PassContext): void {
    const scene = this._scene();
    if (!scene) return;
    const renderer = ctx.renderer as WebGPURenderer;
    this._inCanvasState(renderer, () => renderer.render(scene, ctx.camera as Camera));
  }

  /** Le reglage du rendu sur le canvas, le temps de `draw`, puis celui d'avant. */
  private _inCanvasState<T>(renderer: WebGPURenderer, draw: () => T): T {
    // Sans couper les sorties multiples, le pipeline serait construit pour les deux textures de la scene alors
    // que ce materiau n'en ecrit qu'une, et rien ne s'afficherait.
    const mrt = renderer.getMRT();
    const clear = renderer.autoClear;
    // Sans ce reglage, three rend dans une cible intermediaire pour y encoder le sRGB, puis la recopie sur le
    // canvas : la recopie effacerait l'image deja posee par l'encre. Le materiau encode donc lui-meme (`INK`).
    const colorSpace = renderer.outputColorSpace;
    renderer.setMRT(null);
    renderer.autoClear = false;
    renderer.outputColorSpace = ColorManagement.workingColorSpace;
    renderer.setRenderTarget(null);
    const result = draw();
    renderer.outputColorSpace = colorSpace;
    renderer.autoClear = clear;
    renderer.setMRT(mrt);
    return result;
  }
}
