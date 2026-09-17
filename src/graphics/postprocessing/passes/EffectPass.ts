import type { PassContext } from "@_core/pipeline/Pass.interface.ts";
import type { FrameTiming } from "@_core/types/Frame.type.ts";
import { NoToneMapping, SRGBColorSpace, Texture, Vector2, type RenderTarget } from "three";
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
    const ctx: EffectContext = { uv: uv(), inputBuffer: this._input, resolution: this._resolution };
    const color = this._effects.reduce<Node>((current, effect) => effect.color(current, ctx), this._input);

    this._toScreen = this.renderToScreen;
    this._material.fragmentNode = this._toScreen ? renderOutput(color, NoToneMapping, SRGBColorSpace) : color;
    this._material.needsUpdate = true;
  }
}
