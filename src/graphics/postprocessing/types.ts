export type PostFxQuality = "off" | "low" | "medium" | "high";

export type BlendMode = "normal" | "add" | "screen" | "multiply";

export interface VignetteCenter {
  x: number;
  y: number;
}

export interface VignetteColor {
  r: number;
  g: number;
  b: number;
}

export interface FinalFxConfig {
  enabled: boolean;
  noise: number;
  grainScale: number;
  blend: BlendMode;
  vignetteCenter: VignetteCenter;
  vignetteRadius: number;
  vignetteStrength: number;
  vignettePower: number;
  vignetteColor: VignetteColor;
  customUniforms?: Record<string, number>;
}

export interface BloomFxConfig {
  enabled: boolean;
  intensity: number;
  threshold: number;
  radius: number;
}

export interface PostFxConfig {
  enabled: boolean;
  final: FinalFxConfig;
  bloom: BloomFxConfig;
}
