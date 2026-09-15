import { DEVICE_CONFIG } from "@graphics/device/device.config.ts";
import {
  FINAL_CORRECTION_PRESET,
  POSTFX_PRESETS,
  PostProcessingPass,
} from "@graphics/postprocessing/index.ts";
import {
  NoToneMapping,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from "three";
import type { PassContext } from "../pipeline/Pass.interface.ts";
import type { FrameTiming } from "../types/Frame.type.ts";
import type { Renderer } from "./Renderer.type.ts";
import type { UniverseBase } from "../universes/Universe.base.ts";

export default class Output {
  private readonly _renderer: Renderer;
  private readonly _viewportSize = new Vector2();
  private readonly _activeUniverses = new Set<UniverseBase<string>>();
  private readonly _lifecycleToken = new WeakMap<UniverseBase<string>, number>();
  private readonly _postFxPass: PostProcessingPass;
  private readonly _finalCorrectionPass: PostProcessingPass;
  private _postFxEnabled = true;
  private _finalCorrectionEnabled = true;

  constructor(renderer: Renderer) {
    this._renderer = renderer;
    // three remet ses compteurs a zero a CHAQUE appel de render(). L'
    // EffectComposer en fait plusieurs par image, si bien qu'un lecteur
    // exterieur — la sonde, un panneau de stats — ne verrait que la derniere
    // passe : un triangle plein ecran, donc « 1 draw call ». On prend la main
    // sur la remise a zero pour que les compteurs couvrent l'image entiere.
    this._renderer.info.autoReset = false;
    this._postFxPass = new PostProcessingPass(POSTFX_PRESETS.medium);
    // Le preset est au projet : sa forme suit le `PostFxConfig` de SA chaine de
    // post-traitement, que le core ne connait pas.
    this._finalCorrectionPass = new PostProcessingPass(FINAL_CORRECTION_PRESET);
  }

  get renderer(): Renderer {
    return this._renderer;
  }

  get postFxPass(): PostProcessingPass {
    return this._postFxPass;
  }

  isPostFxEnabled(): boolean {
    return this._postFxEnabled;
  }

  getActiveUniverses(): UniverseBase<string>[] {
    return Array.from(this._activeUniverses);
  }

  setPostFxEnabled(enabled: boolean): void {
    this._postFxEnabled = enabled;
  }

  setFinalCorrectionEnabled(enabled: boolean): void {
    this._finalCorrectionEnabled = enabled;
  }

  setPostFxGrainTexture(texture: Texture | null): void {
    this._postFxPass.setGrainTexture(texture);
  }

  private _bumpToken(u: UniverseBase<string>): number {
    const next = (this._lifecycleToken.get(u) ?? 0) + 1;
    this._lifecycleToken.set(u, next);
    return next;
  }

  async activateUniverse(u: UniverseBase<string>): Promise<void> {
    if (this._activeUniverses.has(u)) return;

    const token = this._bumpToken(u);
    u.active = true;
    this._activeUniverses.add(u);
    if (u.mounted) return;

    try {
      await Promise.resolve(u.beforeMount());
    } catch (error) {
      console.error("[Output] beforeMount failed:", error);
      if (this._lifecycleToken.get(u) !== token) return;
      this._activeUniverses.delete(u);
      u.active = false;
      return;
    }

    if (!u.active) return;
    if (!this._activeUniverses.has(u)) return;
    if (this._lifecycleToken.get(u) !== token) return;
    u.onMounted();
    u.markMounted();
  }

  async deactivateUniverse(u: UniverseBase<string>): Promise<void> {
    if (!this._activeUniverses.has(u)) return;

    const token = this._bumpToken(u);
    this._activeUniverses.delete(u);
    u.active = false;
    if (!u.mounted) return;

    try {
      await Promise.resolve(u.beforeUnmount());
    } catch (error) {
      console.error("[Output] beforeUnmount failed:", error);
      return;
    }

    if (u.active) return;
    if (this._activeUniverses.has(u)) return;
    if (this._lifecycleToken.get(u) !== token) return;
    u.onUnmounted();
    u.markUnmounted();
  }

  update(time: number, dt: number): void {
    for (const u of this._activeUniverses) {
      if (u.mounted) u.update(time, dt);
    }
  }

  render(frame: FrameTiming): void {
    const activeMounted = Array.from(this._activeUniverses).filter((u) => u.mounted);
    if (activeMounted.length === 0) return;
    // Pendant de `autoReset = false` : une seule remise a zero par image, ici,
    // avant que la moindre passe ne dessine — hors ecran compris.
    this._renderer.info.reset();

    // Hors ecran d'abord, et pour TOUS les univers montes : le post-traitement
    // et la correction finale rendent la scene sans passer par le pipeline de
    // l'univers. Une texture calculee dans `render` n'y serait donc jamais a
    // jour — elle ne serait meme jamais calculee.
    for (const u of activeMounted) {
      u.getPipeline().prepare?.(frame, {
        scene: u.scene,
        camera: u.camera,
        renderer: this._renderer,
      });
    }

    // Apres `prepare` : une passe hors ecran deplace viewport et scissor.
    this._prepareRendererState();
    this._renderer.clear(true, true, true);

    if (this._postFxEnabled) {
      const primary = activeMounted.at(-1);
      if (!primary) return;
      const ctx: PassContext = {
        scene: primary.scene,
        camera: primary.camera,
        renderer: this._renderer,
      };
      this._postFxPass.render(frame, ctx);
      return;
    }

    if (this._finalCorrectionEnabled) {
      const primary = activeMounted.at(-1);
      if (!primary) return;
      const ctx: PassContext = {
        scene: primary.scene,
        camera: primary.camera,
        renderer: this._renderer,
      };
      this._finalCorrectionPass.render(frame, ctx);
      return;
    }

    for (const u of this._activeUniverses) {
      if (!u.mounted) continue;
      const ctx: PassContext = {
        scene: u.scene,
        camera: u.camera,
        renderer: this._renderer,
      };
      u.getPipeline().render(frame, ctx);
    }
  }

  private _prepareRendererState(): void {
    this._renderer.outputColorSpace = SRGBColorSpace;
    this._renderer.toneMapping = NoToneMapping;
    // Relue a chaque image : un projet dont le tone mapping vit dans sa chaine
    // de post-traitement peut la regler en direct (voir `DeviceConfig`).
    this._renderer.toneMappingExposure = DEVICE_CONFIG.renderer?.toneMappingExposure ?? 1;

    this._renderer.getSize(this._viewportSize);
    const width = this._viewportSize.x;
    const height = this._viewportSize.y;
    if (width <= 0 || height <= 0) return;

    this._renderer.setScissorTest(false);
    this._renderer.setViewport(0, 0, width, height);
    this._renderer.setScissor(0, 0, width, height);
  }

  resize(width: number, height: number): void {
    this._postFxPass.resize(width, height);
    this._finalCorrectionPass.resize(width, height);
    for (const u of this._activeUniverses) {
      if (u.mounted) u.resize(width, height);
    }
  }

  dispose(): void {
    this._postFxPass.dispose();
    this._finalCorrectionPass.dispose();
  }
}
