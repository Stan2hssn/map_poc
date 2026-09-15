import { createAssetKeys, defineAssets } from "@_core/assets/index.ts";
import { NoColorSpace, RepeatWrapping } from "three";
import type { Texture } from "three";

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
  postfx: {
    grainTexture: {
      src: "/assets/Images/PostFX/grainTexture.webp",
      type: "texture",
      group: "boot",
      postProcess: (resource) => {
        const texture = resource as Texture;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.colorSpace = NoColorSpace;
        texture.needsUpdate = true;
      },
    },
  },
} as const);

export const ASSET_KEYS = createAssetKeys(ASSET_MANIFEST);

export type AppAssetManifest = typeof ASSET_MANIFEST;
