import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { DirectionalLight, Group, HemisphereLight, MathUtils } from "three";

/** Soleil d'ombrage cartographique (nord-ouest) et ambiance douce. */
export class LightsNode extends Object3DNodeBase {
  readonly settings = { azimuth: 315, elevation: 45, intensity: 3 };
  private readonly _sun = new DirectionalLight(0xffffff);
  private readonly _sky = new HemisphereLight(0xffffff, 0xb9b2a6, 0.6);

  constructor() {
    const group = new Group();
    super(NODE_ID.LIGHTS, "Lights", group);
    group.add(this._sun, this._sun.target, this._sky);
    this.apply();
  }

  apply(): void {
    const az = MathUtils.degToRad(this.settings.azimuth);
    const el = MathUtils.degToRad(this.settings.elevation);
    this._sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(100);
    this._sun.intensity = this.settings.intensity;
  }
}
