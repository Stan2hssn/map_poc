import type { FrameTiming } from "../types/Frame.type.ts";

export interface PassContext {
  scene: unknown;
  camera: unknown;
  [key: string]: unknown;
}

export default interface IPass {
  beforeMount(): Promise<void>;
  onMounted(): void;
  beforeUnmount(): Promise<void>;
  onUnmounted(): void;

  /**
   * Travail GPU hors ecran : precalculs, simulations. Appele a chaque image pour
   * chaque univers monte, AVANT tout rendu. Doit rendre la main avec la cible
   * de rendu par defaut active.
   */
  prepare?(frame: FrameTiming, ctx: PassContext): void;
  render(frame: FrameTiming, ctx: PassContext): void;
  /** Apres `render` de toutes les passes : composition vers l'ecran (post-traitement). */
  postRender?(frame: FrameTiming, ctx: PassContext): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
