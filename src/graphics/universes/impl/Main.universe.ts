import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { MapCameraNode } from "@graphics/nodes/cameras/MapCamera.node.ts";
import { LabelsNode } from "@graphics/nodes/labels/Labels.node.ts";
import { SurveyNode } from "@graphics/nodes/survey/Survey.node.ts";
import { LightsNode } from "@graphics/nodes/lights/Lights.node.ts";
import { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { EffectComposer, EffectPass, RenderPass } from "@graphics/postprocessing/index.ts";
import { IgnElevationProvider } from "@graphics/terrain/IgnElevationProvider.ts";
import type IMapNavigator from "@graphics/universes/MapNavigator.interface.ts";
import type { MapView } from "@graphics/universes/MapNavigator.interface.ts";
import { Color, Scene, type Camera } from "three";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

const BACKGROUND = 0x000000;

export class MainUniverse extends UniverseBase<UniverseId> implements IMapNavigator {
  private readonly _cameraNode: MapCameraNode;
  private readonly _lights = new LightsNode();
  private readonly _terrain: TerrainNode;
  private readonly _labels: LabelsNode;
  private readonly _survey: SurveyNode;
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

    super(
      UNIVERSE_ID.MAIN,
      scene,
      cameraNode.camera,
      new NodeGraph(scene),
      new EffectComposer([new RenderPass(), new EffectPass()]),
      device.assets.preloadGroup.bind(device.assets),
      device.debug
    );

    this._cameraNode = cameraNode;
    this._terrain = terrain;
    terrain.projectFrom = () => cameraNode.camera;
    // Un nom de ville clique : vol vers elle, en rapprochant la vue (sans descendre sous 8 km).
    this._labels = new LabelsNode(device.renderer.domElement, terrain, () => this.camera as Camera, ({ lon, lat }) =>
      terrain.flyTo({ lon, lat, extentKm: Math.min(terrain.extentKm, Math.max(8, terrain.extentKm / 4)) })
    );
    this._survey = new SurveyNode(terrain, device.renderer.domElement, () => this.camera as Camera);
    cameraNode.isActive = () => this.camera === cameraNode.camera;

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [NODE_ID.CAMERA_MAIN, NODE_ID.LIGHTS, NODE_ID.TERRAIN, NODE_ID.SURVEY, NODE_ID.LABELS],
    });
  }

  flyTo(view: MapView): void {
    this._terrain.flyTo(view);
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([this._cameraNode, this._lights, this._terrain, this._survey, this._labels]);
      this._nodesRegistered = true;
    }
    await Promise.resolve(super.beforeMount());
  }

  protected override getAssetPreloadGroups(): string[] {
    return ["universe:main"];
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
    ] as const;

    const terrain = this._terrain;
    const segmentOptions = Object.fromEntries(TERRAIN_CONFIG.segmentOptions.map((n) => [`${n} x ${n}`, n]));

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
          debug.bind(target, lights.settings, key, options, `lights.${key}`).on("change", () => lights.apply())
        ),
      ];
      lights.apply();
      terrain.applySettings();
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };

    declare(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.UNIVERSE_MAIN, mount: declare });
  }
}
