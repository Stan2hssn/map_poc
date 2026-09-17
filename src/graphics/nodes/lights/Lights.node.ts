import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { DirectionalLight, Group, HemisphereLight, MathUtils } from "three";

const SUN_DISTANCE = 300;
const SHADOW_EXTENT = 80;

/** Soleil rasant avec ombres portees sur le bloc, et une ambiance tres faible. */
export class LightsNode extends Object3DNodeBase {
  readonly settings = { azimuth: 240, elevation: 35, intensity: 3.5 };
  private readonly _sun = new DirectionalLight(0xffffff);
  private readonly _sky = new HemisphereLight(0xffffff, 0x000000, 0.6);

  constructor() {
    const group = new Group();
    super(NODE_ID.LIGHTS, "Lights", group);
    const { shadow } = this._sun;
    this._sun.castShadow = true;
    shadow.mapSize.set(4096, 4096);
    shadow.camera.left = shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.right = shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.near = 1;
    shadow.camera.far = SUN_DISTANCE * 2;
    shadow.bias = -0.0005;
    shadow.normalBias = 0.05;
    group.add(this._sun, this._sun.target, this._sky);
    this.apply();
  }

  /** Azimut en degres depuis le nord, dans le sens horaire. */
  apply(): void {
    const az = MathUtils.degToRad(this.settings.azimuth);
    const el = MathUtils.degToRad(this.settings.elevation);
    this._sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(SUN_DISTANCE);
    this._sun.intensity = this.settings.intensity;
  }

  override dispose(): void {
    this._sun.shadow.dispose();
    super.dispose();
  }
}
