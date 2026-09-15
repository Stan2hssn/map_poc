import { NoToneMapping, SRGBColorSpace, type Texture } from "three";
import { renderOutput, texture } from "three/tsl";
import { NodeMaterial, type TextureNode } from "three/webgpu";

export class CopyMaterial extends NodeMaterial {
  private _input: TextureNode | null = null;
  private _toScreen: boolean | null = null;

  constructor() {
    super();
    this.depthTest = false;
    this.depthWrite = false;
  }

  update(input: Texture, toScreen: boolean): void {
    if (this._input) this._input.value = input;
    else this._input = texture(input);

    if (toScreen === this._toScreen) return;
    this._toScreen = toScreen;
    this.fragmentNode = toScreen ? renderOutput(this._input, NoToneMapping, SRGBColorSpace) : this._input;
    this.needsUpdate = true;
  }
}
