export type ShaderSource = string;

export type ShaderManifest = {
  [key: string]: ShaderSource | ShaderManifest;
};

export type ShaderPath<TManifest extends ShaderManifest, Prefix extends string = ""> = {
  [K in keyof TManifest & string]: TManifest[K] extends string
    ? `${Prefix}${K}`
    : TManifest[K] extends ShaderManifest
      ? ShaderPath<TManifest[K], `${Prefix}${K}.`>
      : never;
}[keyof TManifest & string];

export type ShaderKeysTree<TManifest extends ShaderManifest, Prefix extends string = ""> = {
  [K in keyof TManifest & string]: TManifest[K] extends string
    ? `${Prefix}${K}`
    : TManifest[K] extends ShaderManifest
      ? ShaderKeysTree<TManifest[K], `${Prefix}${K}.`>
      : never;
};
