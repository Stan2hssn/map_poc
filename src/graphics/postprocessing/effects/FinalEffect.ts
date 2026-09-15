import type { BlendFunction } from "postprocessing";
import { Effect } from "postprocessing";
import type { Texture } from "three";
import { Color, Uniform, Vector2 } from "three";
import { SHADER_KEYS, SHADERS } from "@graphics/shaders/index.ts";

export interface FinalEffectOptions {
  blendFunction: BlendFunction;
  noise: number;
  grainScale: number;
  vignetteCenter: Vector2;
  vignetteRadius: number;
  vignetteStrength: number;
  vignettePower: number;
  vignetteColor: Color;
  noiseTexture?: Texture | null;
  customUniforms?: Record<string, number>;
}

export class FinalEffect extends Effect {
  constructor(options: FinalEffectOptions) {
    const noiseTexture = options.noiseTexture ?? null;
    const fragmentShader = SHADERS.require(SHADER_KEYS.postfx.finalFragment);

    super("FinalEffect", fragmentShader, {
      blendFunction: options.blendFunction,
      uniforms: new Map<string, Uniform<unknown>>([
        ["uTime", new Uniform(0)],
        // New uniforms expected by postProcess-style shader
        ["tGrain", new Uniform(noiseTexture)],
        ["uNoiseStrength", new Uniform(options.noise)],
        ["uGrainScale", new Uniform(options.grainScale)],
        ["uResolution", new Uniform(new Vector2(1, 1))],
        ["uVignetteCenter", new Uniform(options.vignetteCenter.clone())],
        ["uVignetteRadius", new Uniform(options.vignetteRadius)],
        ["uVignetteStrength", new Uniform(options.vignetteStrength)],
        ["uVignettePower", new Uniform(options.vignettePower)],
        ["uVignetteColor", new Uniform(options.vignetteColor.clone())],

        // Compatibility uniforms for legacy shader variant
        ["uNoise", new Uniform(options.noise)],
        ["uNoiseMap", new Uniform(noiseTexture)],
        ["uUseNoiseMap", new Uniform(noiseTexture ? 1 : 0)],
        ["uVignetteOffset", new Uniform(0.8 - options.vignetteRadius)],
        ["uVignetteDarkness", new Uniform(options.vignetteStrength)],
      ]),
    });

    if (options.customUniforms) {
      for (const [key, value] of Object.entries(options.customUniforms)) {
        this.uniforms.set(key, new Uniform(value));
      }
    }
  }

  update(
    _renderer: unknown,
    _inputBuffer: unknown,
    deltaTime: number
  ): void {
    const time = this.uniforms.get("uTime") as Uniform<number> | undefined;
    if (!time) return;
    time.value += deltaTime;
  }

  setSize(width: number, height: number): void {
    const res = this.uniforms.get("uResolution") as Uniform<Vector2> | undefined;
    res?.value.set(width, height);
  }

  setNoiseTexture(texture: Texture | null): void {
    const tGrain = this.uniforms.get("tGrain") as Uniform<Texture | null> | undefined;
    if (tGrain) tGrain.value = texture;

    const noiseMap = this.uniforms.get("uNoiseMap") as Uniform<Texture | null> | undefined;
    const useNoiseMap = this.uniforms.get("uUseNoiseMap") as Uniform<number> | undefined;
    if (noiseMap) noiseMap.value = texture;
    if (useNoiseMap) useNoiseMap.value = texture ? 1 : 0;
  }
}
