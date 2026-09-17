import { NodeBase } from "@_core/nodes/Node.base.ts";
import type Input from "@_core/systems/Input.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector2, Vector3 } from "three";
import { TerrainGesturesHelper, type TerrainGestureHandlers } from "./TerrainGestures.helper.ts";

const FOV = 32;
/** Vue inclinee, nord en haut de l'ecran. */
const POLAR = MathUtils.degToRad(50);
const GROUND_CLEARANCE = 0.5;
/** La largeur de la zone de detail occupe l'ecran, un peu au-dela. */
const FIT = 0.95;
/** Parallaxe comme dans le boilerplate : decalage maximal (fraction de la distance) et temps de reponse. */
const PARALLAX = { x: 0.06, y: 0.035 };
const PARALLAX_EASE_MS = 350;

/**
 * Camera fixe au-dessus de la carte, qui suit doucement la souris.
 * Glisser, molette et pincement agissent sur le terrain (`gestures`), pas sur la camera.
 */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  private readonly _element: HTMLElement;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _gestures: TerrainGestureHandlers;
  private readonly _width: number;
  private readonly _target = new Vector3();
  private readonly _parallax = new Vector2();
  private readonly _mouse = new Vector2();
  private _distance = 1;
  private _drag: TerrainGesturesHelper | null = null;

  constructor(
    input: Input,
    element: HTMLElement,
    bounds: SceneRect,
    heightAt: (x: number, z: number) => number,
    gestures: TerrainGestureHandlers
  ) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera", input);
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.5, 2000);
    this._element = element;
    this._heightAt = heightAt;
    this._gestures = gestures;
    this._width = bounds.maxX - bounds.minX;
    this._target.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this._fit();
    this._place();
  }

  override onMounted(): void {
    super.onMounted();
    this._drag = new TerrainGesturesHelper(this._element, () => this.camera, this._gestures);
  }

  override onUnmounted(): void {
    this._release();
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    if (!this._drag) return;
    this._drag.enabled = this.isActive();
    if (!this._drag.enabled) return;
    const mouse = this._input?.mouse;
    if (mouse) this._parallax.lerp(this._mouse.set(mouse.nx, mouse.ny), 1 - Math.exp(-dt / PARALLAX_EASE_MS));
    this._place();
  }

  override resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._fit();
  }

  override dispose(): void {
    this._release();
    super.dispose();
  }

  /** Distance a laquelle la zone de detail remplit la largeur de l'ecran. */
  private _fit(): void {
    const halfFov = Math.atan(Math.tan(MathUtils.degToRad(FOV) / 2) * this.camera.aspect);
    this._distance = (this._width / 2 / Math.tan(halfFov)) * FIT;
  }

  private _place(): void {
    const d = this._distance;
    const { camera } = this;
    camera.position.set(
      this._target.x + this._parallax.x * PARALLAX.x * d,
      this._target.y + Math.cos(POLAR) * d + this._parallax.y * PARALLAX.y * d,
      this._target.z + Math.sin(POLAR) * d
    );
    const floor = this._heightAt(camera.position.x, camera.position.z) + GROUND_CLEARANCE;
    camera.position.y = Math.max(camera.position.y, floor);
    camera.lookAt(this._target);
  }

  private _release(): void {
    this._drag?.dispose();
    this._drag = null;
  }
}
