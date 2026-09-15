import type { IThreeDeviceSlice } from "@/_core/systems/ThreeDevice.ts";
import type { DebugTarget } from "@_core/debug/index.ts";
import { NodeGraph } from "@_core/nodes/NodeGraph.ts";
import { PipelineBase } from "@_core/pipeline/Pipeline.base.ts";
import { UniverseBase } from "@_core/universes/Universe.base.ts";
import { FOLDER_ID, TAB_ID } from "@graphics/debug/Debug.id.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { MainCameraInputNode } from "@graphics/nodes/cameras/MainCamera.node.ts";
import { CubeNode } from "@graphics/nodes/cube/Cube.node.ts";
import { ForwardRenderPass } from "@graphics/passes/ForwardRenderPass.ts";
import { OutputPass } from "@graphics/postprocessing/index.ts";
import { Scene } from "three";
import type { UniverseId } from "../Universe.id.ts";
import { UNIVERSE_ID } from "../Universe.id.ts";

export class MainUniverse extends UniverseBase<UniverseId> {
  private readonly _cameraNode: MainCameraInputNode;
  private readonly _cubeNode: CubeNode;
  private _nodesRegistered = false;

  constructor(device: IThreeDeviceSlice) {
    const scene = new Scene();
    const cameraNode = new MainCameraInputNode(device.input);

    const graph = new NodeGraph(scene);
    const output = new OutputPass();
    const pipeline = new PipelineBase([new ForwardRenderPass(output.target), output]);

    super(
      UNIVERSE_ID.MAIN,
      scene,
      cameraNode.camera,
      graph,
      pipeline,
      device.assets.preloadGroup.bind(device.assets),
      device.debug
    );

    this._cameraNode = cameraNode;
    this._cubeNode = new CubeNode();

    this.registerContract({
      id: NODE_ID.CONTRACT_BASE,
      activeNodeIds: [NODE_ID.CAMERA_MAIN, NODE_ID.CUBE],
    });
  }

  override async beforeMount(): Promise<void> {
    if (!this._nodesRegistered) {
      this.graph.addMany([this._cameraNode, this._cubeNode]);
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
    this._cubeSettings();
  }

  /**
   * Declare une fois, consomme deux fois : la passe d'application tourne
   * TOUJOURS (les valeurs enregistrees sont la configuration de la scene, avec
   * ou sans `?debug`), le panneau seulement quand l'URL le demande.
   */
  private _cubeSettings(): void {
    const debug = this._debug;
    if (!debug) return;

    const declare = (target: DebugTarget | null) => {
      const spin = this._cubeNode.spin as unknown as Record<string, unknown>;
      const bindings = (["x", "y"] as const).map((axis) =>
        debug.bind(
          target,
          spin,
          axis,
          { label: `spin ${axis} (rad/s)`, min: -3, max: 3, step: 0.01 },
          `cube.spin.${axis}`
        )
      );
      return () => {
        for (const binding of bindings) binding.dispose();
      };
    };

    declare(null);
    this.debugSubscribe({
      tabId: TAB_ID.UNIVERSE,
      folderId: FOLDER_ID.UNIVERSE_MAIN,
      mount: declare,
    });
  }
}
