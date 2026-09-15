import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { ColorManagement, HalfFloatType, NoToneMapping, SRGBColorSpace, Vector2 } from "three";
import { renderOutput, texture } from "three/tsl";
import { NodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer } from "three/webgpu";

/** Scene rendue dans `target`, puis copiee a l'ecran en sRGB au `postRender`. */
export class OutputPass implements IPass {
  readonly target = new RenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  private readonly _size = new Vector2();
  private readonly _material = new NodeMaterial();
  private readonly _quad = new QuadMesh(this._material);

  constructor() {
    this._material.fragmentNode = renderOutput(texture(this.target.texture), NoToneMapping, SRGBColorSpace);
  }

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void {}
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void {}

  // Avant `render` : la cible doit avoir la taille du canvas quand la scene y est dessinee.
  prepare(_frame: FrameTiming, ctx: PassContext): void {
    const { x, y } = (ctx.renderer as WebGPURenderer).getDrawingBufferSize(this._size);
    if (x !== this.target.width || y !== this.target.height) this.target.setSize(x, y);
  }

  render(): void {}

  postRender(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGPURenderer;
    const colorSpace = renderer.outputColorSpace;
    // La conversion sRGB est dans le material : le renderer ne doit pas la refaire.
    renderer.outputColorSpace = ColorManagement.workingColorSpace;
    renderer.setRenderTarget(null);
    this._quad.render(renderer);
    renderer.outputColorSpace = colorSpace;
  }

  resize(): void {}

  dispose(): void {
    this.target.dispose();
    this._material.dispose();
  }
}
