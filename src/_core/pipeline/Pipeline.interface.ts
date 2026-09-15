import type { FrameTiming } from "../types/Frame.type.ts";
import type { PassContext } from "./Pass.interface.ts";

export default interface IPipeline {
  beforeMount(): void | Promise<void>;
  onMounted(): void;
  beforeUnmount(): void | Promise<void>;
  onUnmounted(): void;

  /** Voir `IPass.prepare`. Appele par `Output` avant tout rendu. */
  prepare?(frame: FrameTiming, ctx: PassContext): void;
  render(frame: FrameTiming, ctx: PassContext): void;
  /** Voir `IPass.postRender`. */
  postRender?(frame: FrameTiming, ctx: PassContext): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
