import type { VideoTexture } from "three";

// `binary` rend un ArrayBuffer brut, pour les formats maison qu'aucun loader
// three ne couvre (geometrie precalculee, champs de donnees).
export type AssetType = "texture" | "gltf" | "json" | "audio" | "video" | "binary";

export interface VideoAssetOptions {
  autoplay?: boolean;
  attachToDom?: boolean;
  crossOrigin?: string;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  preload?: "none" | "metadata" | "auto";
}

export interface AssetEntry {
  src: string;
  type: AssetType;
  group?: string;
  lazy?: boolean;
  postProcess?: (resource: unknown) => void;
  video?: VideoAssetOptions;
}

export type AssetManifest = {
  [key: string]: AssetEntry | AssetManifest;
};

export interface LoadedVideoAsset {
  element: HTMLVideoElement;
  texture: VideoTexture;
}

export type AssetPath<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends AssetEntry
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? AssetPath<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type AssetKeysTree<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends AssetEntry
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? AssetKeysTree<T[K], `${Prefix}${K}.`>
      : never;
};
