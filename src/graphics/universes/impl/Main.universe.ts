import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { terrainSettings } from "@graphics/materials/Terrain.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { MapCameraNode } from "@graphics/nodes/cameras/MapCamera.node.ts";
import { LightsNode } from "@graphics/nodes/lights/Lights.node.ts";
import { TerrainNode } from "@graphics/nodes/terrain/Terrain.node.ts";
import { EffectComposer, EffectPass, RenderPass } from "@graphics/postprocessing/index.ts";
import { IgnElevationProvider } from "@graphics/terrain/IgnElevationProvider.ts";
import { Color, Scene } from "three";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

const BACKGROUND = 0xdcd9d4;

export class MainUniverse extends UniverseBase<UniverseId> {
  private readonly _cameraNode: MapCameraNode;
  private readonly _lights = new LightsNode();
  private readonly _terrain: TerrainNode;
  private _nodesRegistered = false;

  constructor(device: IThreeDeviceSlice) {
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);

    // La camera n'est lue par le terrain qu'apres le montage.
    const cameraRef: { node: MapCameraNode | null } = { node: null };
    const terrain = new TerrainNode(new IgnElevationProvider(), () => cameraRef.node!.camera);
    const cameraNode = new MapCameraNode(device.renderer.domElement, terrain.rect, (x, z) => terrain.heightAt(x, z));
    cameraRef.node = cameraNode;

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
    cameraNode.isActive = () => this.camera === cameraNode.camera;

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [NODE_ID.CAMERA_MAIN, NODE_ID.LIGHTS, NODE_ID.TERRAIN],
    });
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([this._cameraNode, this._lights, this._terrain]);
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

    const declare = (target: DebugTarget | null) => {
      const bindings = [
        debug.bind(
          target,
          terrainSettings.exaggeration as unknown as Record<string, unknown>,
          "value",
          { label: "exageration", min: 0.5, max: 6, step: 0.1 },
          "terrain.exaggeration"
        ),
        ...sunControls.map(([key, options]) =>
          debug.bind(target, lights.settings, key, options, `lights.${key}`).on("change", () => lights.apply())
        ),
      ];
      lights.apply();
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };

    declare(null);
    this.debugSubscribe({ tabId: TAB_ID.UNIVERSE, folderId: FOLDER_ID.UNIVERSE_MAIN, mount: declare });
  }
}
