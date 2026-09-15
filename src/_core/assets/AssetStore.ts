import { AudioLoader, SRGBColorSpace, TextureLoader, VideoTexture } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  AssetEntry,
  AssetManifest,
  AssetPath,
  LoadedVideoAsset,
  VideoAssetOptions,
} from "./types.ts";

function isAssetEntry(value: unknown): value is AssetEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AssetEntry>;
  return typeof candidate.src === "string" && typeof candidate.type === "string";
}

function flattenManifest(
  manifest: AssetManifest,
  prefix = "",
  out = new Map<string, AssetEntry>()
): Map<string, AssetEntry> {
  for (const [name, value] of Object.entries(manifest)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isAssetEntry(value)) {
      out.set(key, value);
      continue;
    }
    flattenManifest(value, key, out);
  }
  return out;
}

function disposeVideoAsset(resource: LoadedVideoAsset): void {
  resource.texture.dispose();
  resource.element.pause();
  resource.element.removeAttribute("src");
  resource.element.load();
  if (resource.element.parentElement) {
    resource.element.remove();
  }
}

function disposeGltf(resource: GLTF): void {
  resource.scene.traverse((node) => {
    const candidate = node as {
      geometry?: { dispose?: () => void; };
      material?: unknown;
    };

    candidate.geometry?.dispose?.();

    if (Array.isArray(candidate.material)) {
      for (const material of candidate.material) {
        (material as { dispose?: () => void; })?.dispose?.();
      }
      return;
    }

    (candidate.material as { dispose?: () => void; } | undefined)?.dispose?.();
  });
}

export class AssetStore<TManifest extends AssetManifest> {
  private readonly _entries: Map<string, AssetEntry>;
  private readonly _cache = new Map<string, unknown>();
  private readonly _inflight = new Map<string, Promise<unknown>>();
  private readonly _textureLoader = new TextureLoader();
  private readonly _gltfLoader: GLTFLoader;
  private readonly _dracoLoader: DRACOLoader;
  private readonly _audioLoader = new AudioLoader();

  constructor(manifest: TManifest, dracoPath = "/draco/") {
    this._entries = flattenManifest(manifest);

    // Configure Draco loader for compressed GLTF models
    this._dracoLoader = new DRACOLoader();
    this._dracoLoader.setDecoderPath(dracoPath);
    this._dracoLoader.setDecoderConfig({ type: "js" });

    this._gltfLoader = new GLTFLoader();
    this._gltfLoader.setDRACOLoader(this._dracoLoader);
  }

  has(key: AssetPath<TManifest>): boolean {
    return this._cache.has(key);
  }

  get<T = unknown>(key: AssetPath<TManifest>): T | undefined {
    return this._cache.get(key) as T | undefined;
  }

  require<T = unknown>(key: AssetPath<TManifest>): T {
    const resource = this.get<T>(key);
    if (resource === undefined) {
      throw new Error(`Asset "${key}" is not loaded`);
    }
    return resource;
  }

  async load<T = unknown>(key: AssetPath<TManifest>): Promise<T> {
    if (this._cache.has(key)) {
      return this._cache.get(key) as T;
    }

    const existing = this._inflight.get(key);
    if (existing) {
      return (await existing) as T;
    }

    const entry = this._entries.get(key);
    if (!entry) {
      throw new Error(`Unknown asset key "${key}"`);
    }

    const task = (async () => {
      const resource = await this._loadEntry(entry);
      entry.postProcess?.(resource);
      this._cache.set(key, resource);
      return resource;
    })()
      .catch((error) => {
        throw new Error(`Failed to load "${key}" from "${entry.src}": ${String(error)}`);
      })
      .finally(() => {
        this._inflight.delete(key);
      });

    this._inflight.set(key, task);
    return (await task) as T;
  }

  async preloadGroup(
    group: string,
    options: { includeLazy?: boolean; } = {}
  ): Promise<void> {
    const includeLazy = options.includeLazy ?? false;
    const keys: AssetPath<TManifest>[] = [];

    for (const [key, entry] of this._entries.entries()) {
      if (entry.group !== group) continue;
      if (!includeLazy && entry.lazy) continue;
      keys.push(key as AssetPath<TManifest>);
    }

    await Promise.all(keys.map((key) => this.load(key)));
  }

  dispose(key: AssetPath<TManifest>): void {
    const entry = this._entries.get(key);
    const resource = this._cache.get(key);
    if (!entry || resource === undefined) return;

    this._disposeEntry(entry, resource);
    this._cache.delete(key);
  }

  disposeGroup(group: string): void {
    for (const [key, entry] of this._entries.entries()) {
      if (entry.group !== group) continue;
      this.dispose(key as AssetPath<TManifest>);
    }
  }

  disposeAll(): void {
    for (const key of Array.from(this._cache.keys())) {
      this.dispose(key as AssetPath<TManifest>);
    }
    this._dracoLoader.dispose();
  }

  private async _loadEntry(entry: AssetEntry): Promise<unknown> {
    switch (entry.type) {
      case "texture":
        return this._loadTexture(entry.src);
      case "gltf":
        return this._loadGltf(entry.src);
      case "json":
        return this._loadJson(entry.src);
      case "binary":
        return this._loadBinary(entry.src);
      case "audio":
        return this._loadAudio(entry.src);
      case "video":
        return this._loadVideo(entry.src, entry.video);
      default:
        throw new Error(`Unsupported asset type "${entry.type}"`);
    }
  }

  private _disposeEntry(entry: AssetEntry, resource: unknown): void {
    if (entry.type === "texture") {
      (resource as { dispose?: () => void; }).dispose?.();
      return;
    }

    if (entry.type === "video") {
      disposeVideoAsset(resource as LoadedVideoAsset);
      return;
    }

    if (entry.type === "gltf") {
      disposeGltf(resource as GLTF);
    }
  }

  private async _loadBinary(src: string): Promise<ArrayBuffer> {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  private _loadTexture(src: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this._textureLoader.load(src, resolve, undefined, reject);
    });
  }

  private _loadGltf(src: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this._gltfLoader.load(src, resolve, undefined, reject);
    });
  }

  private async _loadJson(src: string): Promise<unknown> {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private _loadAudio(src: string): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      this._audioLoader.load(src, resolve, undefined, reject);
    });
  }

  private _loadVideo(src: string, options?: VideoAssetOptions): Promise<LoadedVideoAsset> {
    const config = options ?? {};
    const shouldAttach = config.attachToDom ?? false;
    const preload = config.preload ?? "metadata";

    const video = document.createElement("video");
    video.src = src;
    video.preload = preload;
    video.crossOrigin = config.crossOrigin ?? "anonymous";
    video.loop = config.loop ?? false;
    video.muted = config.muted ?? true;
    video.playsInline = config.playsInline ?? true;

    if (shouldAttach) {
      video.style.position = "fixed";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.left = "-10000px";
      video.style.top = "-10000px";
      video.style.opacity = "0";
      document.body.appendChild(video);
    }

    const finalize = async (): Promise<LoadedVideoAsset> => {
      const texture = new VideoTexture(video);
      texture.colorSpace = SRGBColorSpace;

      if (config.autoplay) {
        try {
          await video.play();
        } catch {
          // Autoplay can be blocked by browser policy; keep resource usable.
        }
      }

      return { element: video, texture };
    };

    if (preload === "none") {
      return finalize();
    }

    const readyEvent = preload === "metadata" ? "loadedmetadata" : "loadeddata";

    return new Promise((resolve, reject) => {
      const onReady = async () => {
        cleanup();
        resolve(await finalize());
      };

      const onError = () => {
        cleanup();
        if (video.parentElement) {
          video.remove();
        }
        reject(new Error("Video element emitted an error"));
      };

      const cleanup = () => {
        video.removeEventListener(readyEvent, onReady);
        video.removeEventListener("error", onError);
      };

      video.addEventListener(readyEvent, onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    });
  }
}
