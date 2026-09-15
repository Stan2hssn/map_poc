import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, Scene, WebGLRenderer } from "three";

export class ForwardRenderPass implements IPass {
  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void { }
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void { }

  render(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGLRenderer;
    const scene = ctx.scene as Scene;
    const camera = ctx.camera as Camera;
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  resize(_width: number, _height: number): void {
    //
  }
  dispose(): void {
    //
  }
}
