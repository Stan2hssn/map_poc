import type IPass from "@_core/pipeline/Pass.interface.ts";
import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import type { Camera, Scene, Texture } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import { PostProcessing, type Node, type WebGPURenderer } from "three/webgpu";
import type { PostFxConfig } from "../types.ts";
import { finalEffect } from "./FinalEffect.ts";

/** Meme contrat que `webgl/PostProcessingPass`, en TSL. */
export class PostProcessingPass implements IPass {
  readonly config: PostFxConfig;
  private _postProcessing: PostProcessing | null = null;
  private _nodes: Node[] = [];
  private _scene: unknown = null;
  private _camera: unknown = null;
  private _grain: Texture | null = null;

  constructor(config: PostFxConfig) {
    this.config = config;
  }

  beforeMount(): Promise<void> {
    return Promise.resolve();
  }
  onMounted(): void {}
  beforeUnmount(): Promise<void> {
    return Promise.resolve();
  }
  onUnmounted(): void {
    this.dispose();
  }

  render(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGPURenderer;
    const scene = ctx.scene as Scene;
    const camera = ctx.camera as Camera;

    if (!this.config.enabled) return renderer.render(scene, camera);
    if (scene !== this._scene || camera !== this._camera) this._build(renderer, scene, camera);
    this._postProcessing?.render();
  }

  // Les PassNode suivent la taille du renderer.
  resize(_width: number, _height: number): void {}

  setGrainTexture(texture: Texture | null): void {
    this._grain = texture;
    this.dispose();
  }

  dispose(): void {
    this._postProcessing?.dispose();
    for (const node of this._nodes) node.dispose();
    this._postProcessing = null;
    this._nodes = [];
    this._scene = null;
    this._camera = null;
  }

  private _build(renderer: WebGPURenderer, scene: Scene, camera: Camera): void {
    this.dispose();
    const { bloom: bloomFx, final } = this.config;

    const scenePass = pass(scene, camera);
    let output: Node = scenePass.getTextureNode();
    this._nodes.push(scenePass);

    if (bloomFx.enabled) {
      const bloomPass = bloom(output, bloomFx.intensity, bloomFx.radius, bloomFx.threshold);
      this._nodes.push(bloomPass);
      output = output.add(bloomPass);
    }
    if (final.enabled) output = finalEffect(output, final, this._grain);

    this._postProcessing = new PostProcessing(renderer, output);
    this._scene = scene;
    this._camera = camera;
  }
}
