import { createAssetKeys, defineAssets } from "@_core/assets/index.ts";
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

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
  noise: {
    /** Bruit peint, lu par le masque de l'intro et la feuille du panneau (`noiseMap`). */
    paint: {
      src: "/assets/Images/Diffuse/noise.webp",
      type: "texture",
      group: "universe:main",
      postProcess: (resource: unknown) => {
        const texture = resource as Texture;
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.colorSpace = NoColorSpace;
      },
    },
  },
  paper: {
    /** Journal sans raccord, sous la carte (`newsprintAt`). */
    newsprint: {
      src: "/assets/Images/Paper/newspaper.webp",
      type: "texture",
      group: "universe:main",
      postProcess: (resource: unknown) => {
        const texture = resource as Texture;
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 8;
      },
    },
  },
} as const);

export const ASSET_KEYS = createAssetKeys(ASSET_MANIFEST);

export type AppAssetManifest = typeof ASSET_MANIFEST;
