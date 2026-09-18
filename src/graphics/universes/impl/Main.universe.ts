import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { RenderStatsHelper } from "@graphics/debug/RenderStats.helper.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { BuildingsNode } from "@graphics/nodes/buildings/Buildings.node.ts";
import { MapCameraNode } from "@graphics/nodes/cameras/MapCamera.node.ts";
import { LabelsNode } from "@graphics/nodes/labels/Labels.node.ts";
import { SurveyNode } from "@graphics/nodes/survey/Survey.node.ts";
import { LightsNode } from "@graphics/nodes/lights/Lights.node.ts";
import { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { EffectComposer, EffectPass, InkEffect, RenderPass } from "@graphics/postprocessing/index.ts";
import { IgnElevationProvider } from "@graphics/terrain/IgnElevationProvider.ts";
import type IMapNavigator from "@graphics/universes/MapNavigator.interface.ts";
import type { MapView } from "@graphics/universes/MapNavigator.interface.ts";
import { Color, Scene, type Camera } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

const BACKGROUND = 0x000000;

export class MainUniverse extends UniverseBase<UniverseId> implements IMapNavigator {
  private readonly _cameraNode: MapCameraNode;
  private readonly _lights = new LightsNode();
  private readonly _terrain: TerrainNode;
  private readonly _labels: LabelsNode;
  private readonly _survey: SurveyNode;
  private readonly _buildings: BuildingsNode;
  private readonly _renderStats: RenderStatsHelper;
  private readonly _ink: InkEffect;
  private _nodesRegistered = false;

  constructor(device: IThreeDeviceSlice) {
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);

    const terrain = new TerrainNode(new IgnElevationProvider());
    const cameraNode = new MapCameraNode(
      device.input,
      device.renderer.domElement,
      terrain.rect,
      (x, z) => terrain.heightAt(x, z),
      {
        pan: (dx, dz) => terrain.moveBy(dx, dz),
        zoom: (factor, x, z) => terrain.zoomAt(factor, x, z),
        fling: (vx, vz) => terrain.fling(vx, vz),
      }
    );

    const ink = new InkEffect();
    super(
      UNIVERSE_ID.MAIN,
      scene,
      cameraNode.camera,
      new NodeGraph(scene),
      new EffectComposer([new RenderPass(), new EffectPass([ink])], { normalDepth: true }),
      device.assets.preloadGroup.bind(device.assets),
      device.debug
    );

    this._ink = ink;
    this._cameraNode = cameraNode;
    this._terrain = terrain;
    terrain.projectFrom = () => cameraNode.camera;
    // Un nom de ville clique : vol vers elle, en rapprochant la vue (sans descendre sous 8 km).
    this._labels = new LabelsNode(device.renderer.domElement, terrain, () => this.camera as Camera, ({ lon, lat }) =>
      terrain.flyTo({ lon, lat, extentKm: Math.min(terrain.extentKm, Math.max(8, terrain.extentKm / 4)) })
    );
    this._survey = new SurveyNode(terrain, device.renderer.domElement, () => this.camera as Camera);
    this._buildings = new BuildingsNode(terrain);
    // map tourne sur WebGPURenderer (WebGPU ou son repli WebGL2).
    this._renderStats = new RenderStatsHelper(device.renderer as WebGPURenderer);
    cameraNode.isActive = () => this.camera === cameraNode.camera;

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [NODE_ID.CAMERA_MAIN, NODE_ID.LIGHTS, NODE_ID.TERRAIN, NODE_ID.BUILDINGS, NODE_ID.SURVEY, NODE_ID.LABELS],
    });
  }

  flyTo(view: MapView): void {
    this._terrain.flyTo(view);
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([this._cameraNode, this._lights, this._terrain, this._buildings, this._survey, this._labels]);
      this._nodesRegistered = true;
    }
    await Promise.resolve(super.beforeMount());
  }

  protected override getAssetPreloadGroups(): string[] {
    return ["universe:main"];
  }

  override update(time: number, dt: number): void {
    super.update(time, dt);
    this._renderStats.update(dt);
  }

  override onMounted(): void {
    super.onMounted();
    void this.applyContract(NODE_ID.CONTRACT_BASE);
    this._settings();
  }

  /** Declare une fois : application toujours, panneau seulement avec `?debug`. */
  private _settings(): void {
    const debug = this._debug;
    if (!debug) return;
    const lights = this._lights;
    const sunControls = [
      ["azimuth", { label: "soleil azimut", min: 0, max: 360, step: 1 }],
      ["elevation", { label: "soleil elevation", min: 5, max: 90, step: 1 }],
      ["intensity", { label: "soleil intensite", min: 0, max: 10, step: 0.1 }],
      ["ambient", { label: "ambiance", min: 0, max: 3, step: 0.05 }],
      ["bounce", { label: "rebond", min: 0, max: 1, step: 0.01 }],
    ] as const;

    const terrain = this._terrain;
    const segmentOptions = Object.fromEntries(TERRAIN_CONFIG.segmentOptions.map((n) => [`${n} x ${n}`, n]));
    const applySun = () => {
      lights.apply();
      lights.directionTo(terrainSettings.sun.value);
    };

    const declare = (target: DebugTarget | null) => {
      const bindings = [
        debug.bind(
          target,
          terrain.settings,
          "exaggeration",
          { label: "exageration", min: 0.5, max: 12, step: 0.1 },
          "terrain.exaggeration"
        ),
        debug.bind(
          target,
          terrainSettings.occlusion as unknown as Record<string, unknown>,
          "value",
          { label: "creux", min: 0, max: 5, step: 0.05 },
          "terrain.occlusion"
        ),
        debug.bind(
          target,
          terrainSettings.mist as unknown as Record<string, unknown>,
          "value",
          { label: "brume", min: 0, max: 1, step: 0.01 },
          "terrain.mist"
        ),
        debug.bind(
          target,
          terrainSettings.landcoverStrength as unknown as Record<string, unknown>,
          "value",
          { label: "donnees", min: 0, max: 1, step: 0.01 },
          "terrain.landcover"
        ),
        debug
          .bind(target, terrain.settings, "segments", { label: "subdivisions", options: segmentOptions }, "terrain.segments")
          .on("change", () => terrain.applySettings()),
        ...sunControls.map(([key, options]) =>
          debug.bind(target, lights.settings, key, options, `lights.${key}`).on("change", applySun)
        ),
      ];
      applySun();
      terrain.applySettings();
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };

    declare(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.UNIVERSE_MAIN, mount: declare });

    const buildings = this._buildings;
    const asRecord = (value: object) => value as unknown as Record<string, unknown>;
    const maskControls = [
      [asRecord(terrainSettings.maskRadius.value), "x", { label: "masque largeur", min: 10, max: 200, step: 1 }, "mask.radiusX"],
      [asRecord(terrainSettings.maskRadius.value), "y", { label: "masque profondeur", min: 10, max: 200, step: 1 }, "mask.radiusY"],
      [asRecord(terrainSettings.maskCenter.value), "y", { label: "masque centre", min: -80, max: 40, step: 1 }, "mask.centerY"],
      [asRecord(terrainSettings.maskSoftness), "value", { label: "masque fondu", min: 0.02, max: 1, step: 0.01 }, "mask.softness"],
      [asRecord(terrainSettings.maskJitter), "value", { label: "masque bord", min: 0, max: 0.6, step: 0.01 }, "mask.jitter"],
    ] as const;
    const declareBuildings = (target: DebugTarget | null) => {
      const bindings = [
        debug.bind(
          target,
          buildings.settings,
          "technique",
          { label: "technique", options: { aucune: "none", parallaxe: "parallax", extrusion: "extrusion" } },
          "buildings.technique"
        ),
        debug.bind(target, buildings.settings, "height", { label: "hauteur", min: 0.5, max: 4, step: 0.1 }, "buildings.height"),
        ...maskControls.map(([object, key, options, path]) => debug.bind(target, object, key, options, path)),
        ...(target ? this._monitors(target) : []),
      ];
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };
    declareBuildings(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.BUILDINGS, mount: declareBuildings });

    const ink = this._ink;
    const inkControls = [
      ["amount", { label: "dessin", min: 0, max: 1, step: 1 }],
      ["light", { label: "ton papier", min: 0.1, max: 2, step: 0.01 }],
      ["dark", { label: "ton encre", min: 0, max: 0.5, step: 0.005 }],
      ["screen", { label: "trame (px)", min: 2, max: 16, step: 0.5 }],
      ["hatching", { label: "points / plume", min: 0, max: 1, step: 0.01 }],
      ["line", { label: "trait (px)", min: 0.5, max: 4, step: 0.1 }],
      ["depthEdge", { label: "contour profondeur", min: 0.001, max: 0.1, step: 0.001 }],
      ["normalEdge", { label: "contour arete", min: 0.02, max: 1, step: 0.01 }],
      ["wobble", { label: "tremble (px)", min: 0, max: 6, step: 0.1 }],
      ["grain", { label: "grain", min: 0, max: 1, step: 0.01 }],
      ["bleed", { label: "bavure", min: 0, max: 1, step: 0.01 }],
    ] as const;
    const applyInk = () => {
      const paper = ink.amount.value > 0.5;
      terrainSettings.pen.value = paper ? 1 : 0;
      document.documentElement.dataset.mapTheme = paper ? "paper" : "night";
    };
    const declareInk = (target: DebugTarget | null) => {
      const bindings = [
        ...inkControls.map(([key, options]) =>
          debug.bind(target, asRecord(ink[key]), "value", options, `ink.${key}`).on("change", applyInk)
        ),
        debug.bind(target, asRecord(ink.paper), "value", { label: "papier", color: { type: "float" } }, "ink.paper"),
        debug.bind(target, asRecord(ink.ink), "value", { label: "encre", color: { type: "float" } }, "ink.ink"),
      ];
      applyInk();
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };
    declareInk(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.INK, mount: declareInk });
  }

  /** Mesures en lecture seule : cadence, GPU, dessin, et ce que coute le bati. */
  private _monitors(target: DebugTarget): { dispose(): void }[] {
    const frame = this._renderStats.values;
    const buildings = this._buildings.stats;
    const terrain = this._terrain.settings;
    const readout = {
      get fps() {
        return frame.fps;
      },
      get image() {
        return frame.frameMs;
      },
      get gpu() {
        return frame.gpuMs;
      },
      get dessins() {
        return frame.drawCalls;
      },
      get triangles() {
        return frame.triangles;
      },
      get sol() {
        return (terrain.segments + 1) ** 2;
      },
      get bati() {
        return buildings.vertices;
      },
      get batiments() {
        return buildings.buildings;
      },
      get tuiles() {
        return buildings.tiles;
      },
      get memoire() {
        return buildings.memoryMb;
      },
    };
    const count = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} k` : v.toFixed(0));
    const ms = (v: number) => `${v.toFixed(2)} ms`;
    const monitor = (key: keyof typeof readout, label: string, format: (v: number) => string) =>
      target.addBinding(readout, key, { readonly: true, label, format });
    return [
      monitor("fps", "fps", (v) => v.toFixed(0)),
      monitor("image", "image", ms),
      monitor("gpu", "gpu", (v) => (v ? ms(v) : "-")),
      target.addBinding(readout, "gpu", { readonly: true, label: "gpu (graphe)", view: "graph", min: 0, max: 16 }),
      monitor("dessins", "appels de dessin", count),
      monitor("triangles", "triangles", count),
      monitor("sol", "sommets sol", count),
      monitor("bati", "sommets bati", count),
      monitor("batiments", "batiments", count),
      monitor("tuiles", "tuiles", count),
      monitor("memoire", "memoire bati", (v) => `${v.toFixed(1)} Mo`),
    ];
  }
}
