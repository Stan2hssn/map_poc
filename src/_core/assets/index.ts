import { AssetStore } from "./AssetStore.ts";
import type { AssetEntry, AssetKeysTree, AssetManifest } from "./types.ts";

function isAssetEntry(value: unknown): value is AssetEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AssetEntry>;
  return typeof candidate.src === "string" && typeof candidate.type === "string";
}

function buildAssetKeys(
  manifest: AssetManifest,
  prefix = ""
): Record<string, unknown> {
  const keys: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(manifest)) {
    const path = prefix ? `${prefix}.${name}` : name;
    keys[name] = isAssetEntry(value) ? path : buildAssetKeys(value, path);
  }

  return keys;
}

export function defineAssets<const T extends AssetManifest>(manifest: T): T {
  return manifest;
}

export function createAssetKeys<const T extends AssetManifest>(
  manifest: T
): AssetKeysTree<T> {
  return buildAssetKeys(manifest) as AssetKeysTree<T>;
}

export function createAssetStore<const T extends AssetManifest>(
  manifest: T
): AssetStore<T> {
  return new AssetStore(manifest);
}

export { AssetStore };
export type {
  AssetEntry,
  AssetKeysTree,
  AssetManifest,
  AssetPath,
  AssetType,
  LoadedVideoAsset,
  VideoAssetOptions,
} from "./types.ts";
