import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Effect } from "postprocessing";
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from "postprocessing";
import type { Camera, Scene, Texture, WebGLRenderer } from "three";
import { Color, Vector2 } from "three";
import { FinalEffect } from "../effects/index.ts";
import type { BlendMode, PostFxConfig } from "../types.ts";

function toBlendFunction(mode: BlendMode): BlendFunction {
  switch (mode) {
    case "normal":
      return BlendFunction.NORMAL;
    case "add":
      return BlendFunction.ADD;
    case "multiply":
      return BlendFunction.MULTIPLY;
    case "screen":
    default:
      return BlendFunction.SCREEN;
  }
}

export class PostProcessingPass implements IPass {
  private readonly _config: PostFxConfig;

  private _composer: EffectComposer | null = null;
  private _renderPass: RenderPass | null = null;
  private _effectPass: EffectPass | null = null;
  private _finalEffect: FinalEffect | null = null;

  private _renderer: WebGLRenderer | null = null;
  private _scene: Scene | null = null;
  private _camera: Camera | null = null;

  private _width = 1;
  private _height = 1;
  private readonly _viewportSize = new Vector2();
  private _grainTexture: Texture | null = null;

  constructor(config: PostFxConfig) {
    this._config = config;
  }

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }

  onMounted(): void { }

  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }

  onUnmounted(): void {
    this._disposeComposer();
  }

  render(frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGLRenderer | undefined;
    const scene = ctx.scene as Scene | undefined;
    const camera = ctx.camera as Camera | undefined;

    if (!renderer || !scene || !camera) return;

    if (!this._config.enabled) {
      renderer.render(scene, camera);
      return;
    }

    renderer.getSize(this._viewportSize);
    if (
      this._viewportSize.x > 0 &&
      this._viewportSize.y > 0 &&
      (this._viewportSize.x !== this._width || this._viewportSize.y !== this._height)
    ) {
      this.resize(this._viewportSize.x, this._viewportSize.y);
    }

    this._ensureComposer(renderer, scene, camera);

    if (!this._composer) {
      renderer.render(scene, camera);
      return;
    }

    try {
      this._composer.render(frame.deltaTime / 1000);
    } catch (error) {
      console.error(
        "[PostProcessingPass] Composer render failed, fallback to direct render:",
        error
      );
      this._disposeComposer();
      renderer.render(scene, camera);
    }
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this._width = width;
    this._height = height;
    this._composer?.setSize(width, height, false);
  }

  dispose(): void {
    this._disposeComposer();
  }

  get finalEffect(): FinalEffect | null {
    return this._finalEffect;
  }

  get config(): PostFxConfig {
    return this._config;
  }

  setGrainTexture(texture: Texture | null): void {
    this._grainTexture = texture;
    this._finalEffect?.setNoiseTexture(texture);
  }

  private _ensureComposer(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    const changed =
      this._renderer !== renderer || this._scene !== scene || this._camera !== camera;

    if (!this._composer || changed) {
      this._buildComposer(renderer, scene, camera);
    }
  }

  private _buildComposer(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    this._disposeComposer();

    const effects = this._buildEffects();
    if (effects.length === 0) {
      this._renderer = renderer;
      this._scene = scene;
      this._camera = camera;
      return;
    }

    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;

    this._composer = new EffectComposer(renderer);

    this._renderPass = new RenderPass(scene, camera);
    this._effectPass = new EffectPass(camera, ...effects);
    this._effectPass.renderToScreen = true;

    this._composer.addPass(this._renderPass);
    this._composer.addPass(this._effectPass);
    this._composer.setSize(this._width, this._height);
  }

  private _buildEffects(): Effect[] {
    const effects: Effect[] = [];

    if (this._config.bloom.enabled) {
      effects.push(
        new BloomEffect({
          intensity: this._config.bloom.intensity,
          luminanceThreshold: this._config.bloom.threshold,
          mipmapBlur: true,
          radius: this._config.bloom.radius,
        })
      );
    }

    if (this._config.final.enabled) {
      this._finalEffect = new FinalEffect({
        noise: this._config.final.noise,
        grainScale: this._config.final.grainScale,
        vignetteCenter: new Vector2(
          this._config.final.vignetteCenter.x,
          this._config.final.vignetteCenter.y
        ),
        vignetteRadius: this._config.final.vignetteRadius,
        vignetteStrength: this._config.final.vignetteStrength,
        vignettePower: this._config.final.vignettePower,
        vignetteColor: new Color(
          this._config.final.vignetteColor.r,
          this._config.final.vignetteColor.g,
          this._config.final.vignetteColor.b
        ),
        blendFunction: toBlendFunction(this._config.final.blend),
        noiseTexture: this._grainTexture,
        customUniforms: this._config.final.customUniforms,
      });
      effects.push(this._finalEffect);
    }

    return effects;
  }

  private _disposeComposer(): void {
    this._effectPass?.dispose?.();
    this._renderPass?.dispose?.();
    this._composer?.dispose?.();

    this._effectPass = null;
    this._renderPass = null;
    this._finalEffect = null;
    this._composer = null;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
  }
}
