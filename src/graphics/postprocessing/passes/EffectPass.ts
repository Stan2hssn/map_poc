import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { DepthTexture, NoToneMapping, SRGBColorSpace, Texture, Vector2, type PerspectiveCamera, type RenderTarget } from "three";
import { renderOutput, texture, uniform, uv } from "three/tsl";
import { NodeMaterial, type Node } from "three/webgpu";
import type IEffect from "../effects/Effect.interface.ts";
import type { EffectContext } from "../effects/Effect.interface.ts";
import { PassBase } from "./Pass.base.ts";

/** Enchaine ses effets dans un seul materiau. Sans effet : copie de l'entree. */
export class EffectPass extends PassBase {
  private readonly _effects: IEffect[];
  private readonly _material = new NodeMaterial();
  private readonly _input = texture(new Texture());
  private readonly _resolution = uniform(new Vector2());
  private readonly _normal = texture(new Texture());
  private readonly _depth = texture(new DepthTexture(1, 1));
  private readonly _near = uniform(0.1);
  private readonly _far = uniform(1000);
  private _toScreen: boolean | null = null;

  constructor(effects: IEffect[] = []) {
    super();
    this._effects = effects;
    this._material.depthTest = false;
    this._material.depthWrite = false;
    this.fullscreen.material = this._material;
  }

  override postRender(frame: FrameTiming, ctx: PassContext): void {
    this._input.value = (ctx.inputBuffer as RenderTarget).texture;
    const scene = ctx.sceneBuffer as RenderTarget | undefined;
    if (scene?.depthTexture) {
      this._normal.value = scene.textures[1] ?? this._normal.value;
      this._depth.value = scene.depthTexture;
    }
    const camera = ctx.camera as PerspectiveCamera;
    this._near.value = camera.near;
    this._far.value = camera.far;
    if (this._toScreen !== this.renderToScreen) this._build();
    for (const effect of this._effects) effect.update?.(frame);
    this.renderFullscreen(ctx);
  }

  override setSize(width: number, height: number): void {
    this._resolution.value.set(width, height);
    for (const effect of this._effects) effect.setSize?.(width, height);
  }

  override dispose(): void {
    for (const effect of this._effects) effect.dispose?.();
    super.dispose();
  }

  // L'encodage sRGB n'a lieu qu'a l'ecran : entre deux passes, la couleur reste lineaire.
  private _build(): void {
    const ctx: EffectContext = {
      uv: uv(),
      inputBuffer: this._input,
      resolution: this._resolution,
      normalBuffer: this._normal,
      depthBuffer: this._depth,
      cameraNear: this._near,
      cameraFar: this._far,
    };
    const color = this._effects.reduce<Node>((current, effect) => effect.color(current, ctx), this._input);

    this._toScreen = this.renderToScreen;
    this._material.fragmentNode = this._toScreen ? renderOutput(color, NoToneMapping, SRGBColorSpace) : color;
    this._material.needsUpdate = true;
  }
}
