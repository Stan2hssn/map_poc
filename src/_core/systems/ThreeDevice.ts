import {
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer
} from "three";
import { OrbitCameraHelper } from "../../graphics/adapters/helpers/OrbitCamera.helper.ts";
import { DOMInputAdapter } from "../../graphics/adapters/systems/DOMInputAdapter.ts";
import {
  ASSET_MANIFEST,
  type AppAssetManifest,
} from "../../graphics/assets/assets.manifest.ts";
import { DEBUG_CONFIG } from "../../graphics/debug/debug.config.ts";
import { FOLDER_ID, TAB_ID } from "../../graphics/debug/Debug.id.ts";
import { DEVICE_CONFIG } from "../../graphics/device/device.config.ts";
import type { UniverseId } from "../../graphics/universes/Universe.id.ts";
import { UNIVERSE_MANIFEST } from "../../graphics/universes/universes.manifest.ts";
import type { AssetStore } from "../assets/AssetStore.ts";
import { createAssetStore } from "../assets/index.ts";
import type { ShaderStore } from "../shaders/index.ts";
import { isDebugRequested, isStatsRequested } from "../debug/DebugFlags.ts";
import { debug, type DebugManager } from "../debug/index.ts";
import { UniverseRegistry } from "../registries/UniverseRegistry/UniverseRegistry.ts";
import { StatsManager } from "../stats/index.ts";
import type { UniverseBase } from "../universes/Universe.base.ts";
import type Input from "./Input.ts";
import type { Renderer, RendererParameters } from "./Renderer.type.ts";
import Runtime from "./Runtime.ts";
import State from "./State.ts";
import {
  SHADER_MANIFEST,
  type AppShaderManifest,
} from "../../graphics/shaders/shaders.manifest.ts";
import { createShaderStore } from "../shaders/index.ts";

export interface IThreeDeviceSlice {
  renderer: Renderer;
  assets: AssetStore<AppAssetManifest>;
  shaders: ShaderStore<AppShaderManifest>;
  debug: DebugManager;
  input: Input;
  stats: StatsManager;
}

/**
 * ThreeDevice - Creates the renderer (WebGL or WebGPU), Runtime from _core,
 * registers manifest, activates initial universes.
 *
 * Identique dans tous les projets : ce qui est propre a l'un d'eux passe par
 * `DEVICE_CONFIG` (`src/graphics/device/device.config.ts`).
 */
export default class ThreeDevice implements IThreeDeviceSlice {
  private readonly _canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly assets: AssetStore<AppAssetManifest>;
  readonly shaders: ShaderStore<AppShaderManifest>;
  readonly debug: DebugManager;
  readonly stats: StatsManager;
  private readonly _state: State;
  private readonly _registry: UniverseRegistry<UniverseId>;
  private readonly _runtime: Runtime<UniverseId>;
  private readonly _inputAdapter: DOMInputAdapter;
  private readonly _orbitCameraHelper: OrbitCameraHelper;
  private _debugUnsubscribeStats: (() => void) | null = null;
  private _projectDebugUnsubscribers: (() => void)[] = [];
  private readonly _onViewportChange = (): void => {
    this.resize(this._canvas.clientWidth, this._canvas.clientHeight);
  };
  private _eventsBound = false;
  private _disposed = false;

  constructor(canvas: HTMLCanvasElement, renderer: Renderer) {
    this._canvas = canvas;
    this.renderer = renderer;
    this.renderer.outputColorSpace = SRGBColorSpace;

    const rendererConfig = DEVICE_CONFIG.renderer ?? {};
    const shadowMap = rendererConfig.shadowMap ?? PCFSoftShadowMap;
    if (shadowMap !== false) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = shadowMap;
    }
    const maxPixelRatio = rendererConfig.maxPixelRatio ?? 2;
    const coarsePointer = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
    this.renderer.setPixelRatio(
      Math.min(
        globalThis.window?.devicePixelRatio ?? 1,
        coarsePointer ? (rendererConfig.maxPixelRatioCoarse ?? maxPixelRatio) : maxPixelRatio
      )
    );
    this.assets = createAssetStore(ASSET_MANIFEST);
    this.shaders = createShaderStore(SHADER_MANIFEST);
    this.debug = debug;
    this.stats = new StatsManager(this.renderer);

    this._state = new State();
    this._registry = new UniverseRegistry<UniverseId>();

    for (const { id, ctor, isDefault } of UNIVERSE_MANIFEST) {
      this._registry.define(id, () => new ctor(this), isDefault);
    }

    this._runtime = new Runtime<UniverseId>(
      this.renderer,
      this._registry,
      this._state
    );
    this._orbitCameraHelper = new OrbitCameraHelper(
      this.renderer.domElement,
      this._getActiveUniverse,
      {
        dampingFactor: 0.08,
      }
    );
    this._inputAdapter = new DOMInputAdapter();
    this._runtime.raf.setStats(this.stats);
  }

  /**
   * L'adaptateur d'entree, pour ce qui doit lui parler depuis un geste : iOS
   * n'accorde le capteur d'inclinaison qu'a un appel issu d'un clic, et un appel
   * relaye par le moteur est juge trop loin du geste.
   */
  get inputAdapter(): DOMInputAdapter {
    return this._inputAdapter;
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  get runtime(): Runtime<UniverseId> {
    return this._runtime;
  }

  get state(): State {
    return this._state;
  }

  get input(): Input {
    return this._runtime.input;
  }

  static async create(
    canvas: HTMLCanvasElement,
    config?: RendererParameters
  ): Promise<ThreeDevice> {
    const device = new ThreeDevice(canvas, await ThreeDevice._createRenderer(canvas, config));
    await device.init();
    return device;
  }

  // Import dynamique : un projet WebGL n'embarque pas `three/webgpu`.
  private static async _createRenderer(
    canvas: HTMLCanvasElement,
    config?: RendererParameters
  ): Promise<Renderer> {
    if (DEVICE_CONFIG.renderer?.backend !== "webgpu") {
      return new WebGLRenderer({ canvas, ...config });
    }
    const { WebGPURenderer } = await import("three/webgpu");
    const renderer = new WebGPURenderer({ canvas, ...config });
    await renderer.init();
    return renderer;
  }

  async init(): Promise<void> {
    this._state.setViewport(this._canvas.clientWidth, this._canvas.clientHeight);
    this.renderer.setSize(this._canvas.clientWidth, this._canvas.clientHeight, false);
    await this.assets.preloadGroup("boot");

    DEVICE_CONFIG.onBoot?.(this);

    this._runtime.init();
    // TOUJOURS, panneau ou non : les valeurs enregistrees sont la configuration
    // de la scene. Les charger seulement avec `?debug` donnerait deux scenes
    // differentes selon l'URL.
    if (DEVICE_CONFIG.debugPersistence) this.debug.setPersistence(DEVICE_CONFIG.debugPersistence);
    // Le PANNEAU, lui, reste sur demande. Non initialise, les abonnements
    // s'enregistrent sans effet et reviennent intacts des que l'URL le demande.
    if (isDebugRequested()) this.debug.init(DEBUG_CONFIG);
    if (isStatsRequested()) void this.stats.setBasicEnabled(true);
    this._inputAdapter.attach(this._canvas, this._runtime.input);
    this._orbitCameraHelper.bindInput(this._runtime.input);
    this._bindDebugControls();
    this._projectDebugUnsubscribers = DEVICE_CONFIG.bindDebug?.(this) ?? [];

    const defaultId = this._registry.getDefaultId();
    if (defaultId) await this._runtime.activateUniverse(defaultId);
    this._runtime.resize(this._canvas.clientWidth, this._canvas.clientHeight);

    this._handleEvents();

    this.start();
  }

  private _handleEvents(): void {
    if (this._eventsBound) return;
    globalThis.addEventListener("resize", this._onViewportChange, true);
    globalThis.addEventListener("orientationchange", this._onViewportChange, true);
    this._eventsBound = true;
  }

  private _bindDebugControls(): void {
    this._debugUnsubscribeStats?.();
    this._debugUnsubscribeStats = this.debug.subscribe({
      ownerId: "three-device-stats",
      tabId: TAB_ID.RENDER,
      folderId: FOLDER_ID.STATS,
      mount: (target) => {
        const params = {
          basic: this.stats.basicEnabled,
          perf: this.stats.perfEnabled,
        };

        const basicBinding = target.addBinding(params, "basic", { label: "Stats GL" });
        basicBinding.on("change", async (event: { value: boolean; }) => {
          await this.stats.setBasicEnabled(event.value);
          params.basic = this.stats.basicEnabled;
          basicBinding.refresh();
        });

        const perfBinding = target.addBinding(params, "perf", { label: "Three Perf" });
        perfBinding.on("change", async (event: { value: boolean; }) => {
          await this.stats.setPerfEnabled(event.value);
          params.perf = this.stats.perfEnabled;
          perfBinding.refresh();
        });

        void this.stats.setBasicEnabled(params.basic).then(() => {
          params.basic = this.stats.basicEnabled;
          basicBinding.refresh();
        });
        void this.stats.setPerfEnabled(params.perf).then(() => {
          params.perf = this.stats.perfEnabled;
          perfBinding.refresh();
        });

        return () => {
          basicBinding.dispose();
          perfBinding.dispose();
        };
      },
    });

  }

  start(): void {
    this._runtime.start();
  }

  stop(): void {
    this._runtime.stop();
  }

  setDebugEnabled(enabled: boolean): void {
    this.debug.setVisible(enabled);
  }

  toggleDebug(): void {
    this.debug.toggle();
  }

  async setStatsEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.stats.enable();
      return;
    }
    this.stats.disable();
  }

  async toggleStats(): Promise<boolean> {
    return this.stats.toggle();
  }

  async setBasicStatsEnabled(enabled: boolean): Promise<void> {
    await this.stats.setBasicEnabled(enabled);
  }

  async setPerfStatsEnabled(enabled: boolean): Promise<void> {
    await this.stats.setPerfEnabled(enabled);
  }

  toggleOrbitCamera(): boolean {
    return this._orbitCameraHelper.toggle();
  }

  resize(width: number, height: number): void {
    this._state.setViewport(width, height);
    this.renderer.setSize(width, height, false);
    this._orbitCameraHelper.resize(width, height);
    this._runtime.resize(width, height);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (this._eventsBound) {
      globalThis.removeEventListener("resize", this._onViewportChange, true);
      globalThis.removeEventListener(
        "orientationchange",
        this._onViewportChange,
        true
      );
      this._eventsBound = false;
    }

    this._runtime.dispose();
    this._inputAdapter.dispose();
    this._debugUnsubscribeStats?.();
    this._debugUnsubscribeStats = null;
    for (const unsubscribe of this._projectDebugUnsubscribers) unsubscribe();
    this._projectDebugUnsubscribers = [];
    this.debug.dispose();
    this._orbitCameraHelper.dispose();
    this.stats.dispose();
    this.assets.disposeAll();
    this.renderer.dispose();
  }

  private readonly _getActiveUniverse = (): UniverseBase<UniverseId> | null => {
    const active = this._runtime.output.getActiveUniverses();
    return (active.at(-1) as UniverseBase<UniverseId> | undefined) ?? null;
  };
}
