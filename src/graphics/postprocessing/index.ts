export { FINAL_CORRECTION_PRESET, POSTFX_PRESETS } from "./config/postfx.presets.ts";
// Doit suivre `DEVICE_CONFIG.renderer.backend` : `./webgl/` ou `./webgpu/`.
export { PostProcessingPass } from "./webgpu/PostProcessingPass.ts";
export type { BlendMode, BloomFxConfig, FinalFxConfig, PostFxConfig, PostFxQuality } from "./types.ts";
