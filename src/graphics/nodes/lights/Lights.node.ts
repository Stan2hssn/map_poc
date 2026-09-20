import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { DirectionalLight, Group, HemisphereLight, MathUtils, type Vector3 } from "three";

const SUN_DISTANCE = 400;
const SHADOW_EXTENT = 150;
/**
 * Calque des objets rendus dans la passe d'ombre, et d'eux seuls : le sol y a une grille a part, plus grossiere
 * que celle de l'image (voir `TerrainNode`).
 */
export const SHADOW_CASTERS_LAYER = 1;
/** Relief (m, du plus bas au plus haut de la vue) sous lequel ses ombres s'effacent, puis ne sont plus rendues. */
const FLAT_RELIEF_M: readonly [number, number] = [40, 120];

/**
 * Soleil rasant avec ombres portees sur le bloc, ciel, et rebond du sol : lumiere douce qui laisse
 * les faces a l'ombre lisibles (hachurees plutot que noires a l'encre).
 */
export class LightsNode extends Object3DNodeBase {
  readonly settings = { azimuth: 117, elevation: 22, intensity: 4, ambient: 0.2, bounce: 0.35 };
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
    shadow.camera.layers.set(SHADOW_CASTERS_LAYER);
    group.add(this._sun, this._sun.target, this._sky);
    this.apply();
  }

  /** Direction du soleil (vers lui), normee, dans `target`. */
  directionTo(target: Vector3): Vector3 {
    return target.copy(this._sun.position).normalize();
  }

  /**
   * Ombres du relief selon son amplitude (m) : sur une vue plate (une ville), elles ne dessinent rien et leur passe
   * coutait 3 a 6 ms par image ; elle n'est plus rendue. Le bati a ses ombres dans la texture de hauteurs.
   */
  relief(meters: number): void {
    const { shadow } = this._sun;
    shadow.intensity = MathUtils.smoothstep(meters, FLAT_RELIEF_M[0], FLAT_RELIEF_M[1]);
    shadow.autoUpdate = shadow.intensity > 0;
  }

  /** Azimut en degres depuis le nord, dans le sens horaire. */
  apply(): void {
    const az = MathUtils.degToRad(this.settings.azimuth);
    const el = MathUtils.degToRad(this.settings.elevation);
    this._sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(SUN_DISTANCE);
    this._sun.intensity = this.settings.intensity;
    this._sky.intensity = this.settings.ambient;
    this._sky.groundColor.setScalar(this.settings.bounce);
  }

  override dispose(): void {
    this._sun.shadow.dispose();
    super.dispose();
  }
}
