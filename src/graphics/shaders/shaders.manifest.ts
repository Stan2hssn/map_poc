import { createShaderKeys, createShaderStore, defineShaders } from "@_core/shaders/index.ts";

export const SHADER_MANIFEST = defineShaders({} as const);

export const SHADER_KEYS = createShaderKeys(SHADER_MANIFEST);
export const SHADERS = createShaderStore(SHADER_MANIFEST);

export type AppShaderManifest = typeof SHADER_MANIFEST;
