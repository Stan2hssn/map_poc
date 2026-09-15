import type { ShaderManifest, ShaderPath } from "./types.ts";

function flattenManifest(
  manifest: ShaderManifest,
  prefix = "",
  out = new Map<string, string>()
): Map<string, string> {
  for (const [name, value] of Object.entries(manifest)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") {
      out.set(key, value);
      continue;
    }
    flattenManifest(value, key, out);
  }
  return out;
}

export class ShaderStore<TManifest extends ShaderManifest> {
  private readonly _entries: Map<string, string>;

  constructor(manifest: TManifest) {
    this._entries = flattenManifest(manifest);
  }

  has(key: ShaderPath<TManifest>): boolean {
    return this._entries.has(key);
  }

  get(key: ShaderPath<TManifest>): string | undefined {
    return this._entries.get(key);
  }

  require(key: ShaderPath<TManifest>): string {
    const source = this._entries.get(key);
    if (!source) {
      throw new Error(`Unknown shader key "${key}"`);
    }
    return source;
  }
}
