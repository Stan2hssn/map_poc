import { defineShaders } from "@_core/shaders/index.ts";

export const SHADER_MANIFEST = defineShaders({} as const);

export type AppShaderManifest = typeof SHADER_MANIFEST;
