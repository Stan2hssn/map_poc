import { ShaderStore } from "./ShaderStore.ts";
import type { ShaderKeysTree, ShaderManifest } from "./types.ts";

function buildShaderKeys(
  manifest: ShaderManifest,
  prefix = ""
): Record<string, unknown> {
  const keys: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(manifest)) {
    const path = prefix ? `${prefix}.${name}` : name;
    keys[name] = typeof value === "string" ? path : buildShaderKeys(value, path);
  }

  return keys;
}

export function defineShaders<const T extends ShaderManifest>(manifest: T): T {
  return manifest;
}

export function createShaderKeys<const T extends ShaderManifest>(
  manifest: T
): ShaderKeysTree<T> {
  return buildShaderKeys(manifest) as ShaderKeysTree<T>;
}

export function createShaderStore<const T extends ShaderManifest>(
  manifest: T
): ShaderStore<T> {
  return new ShaderStore(manifest);
}

export { ShaderStore };
export type { ShaderKeysTree, ShaderManifest, ShaderPath, ShaderSource } from "./types.ts";
