import { createAssetKeys, defineAssets } from "@_core/assets/index.ts";

export const ASSET_MANIFEST = defineAssets({
  // `group: "boot"` -> loaded before first universe mount.
  // `group: "universe:main"` -> loaded in MainUniverse.beforeMount().
  // `lazy: true` -> skipped by preloadGroup() unless includeLazy = true.
  ui: {
    logo: {
      src: "/vite.svg",
      type: "texture",
      group: "ui",
      lazy: true,
    },
  },
} as const);

export const ASSET_KEYS = createAssetKeys(ASSET_MANIFEST);

export type AppAssetManifest = typeof ASSET_MANIFEST;
