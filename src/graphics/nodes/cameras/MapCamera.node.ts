import { NodeBase } from "@_core/nodes/Node.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { TerrainGesturesHelper, type TerrainGestureHandlers } from "./TerrainGestures.helper.ts";

// Focale longue : vue presque isometrique, comme la reference.
const FOV = 20;
// Vue de depart en diagonale, comme un bloc pose sur une table.
const START_AZIMUTH = MathUtils.degToRad(45);
const START_POLAR = MathUtils.degToRad(57);
const MAX_POLAR = MathUtils.degToRad(80);
const GROUND_CLEARANCE_KM = 0.1;
// Le bloc occupe environ 80 % du plus petit cote de l'ecran.
const FIT_MARGIN = 1.2;

/**
 * Camera fixee sur le bloc : clic droit ou deux doigts pour tourner.
 * Glisser, molette et pincement agissent sur le terrain (`gestures`), pas sur la camera.
 */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  private readonly _element: HTMLElement;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _gestures: TerrainGestureHandlers;
  private readonly _halfDiagonal: number;
  private readonly _center = new Vector3();
  private _controls: MapControls | null = null;
  private _drag: TerrainGesturesHelper | null = null;

  constructor(
    element: HTMLElement,
    bounds: SceneRect,
    heightAt: (x: number, z: number) => number,
    gestures: TerrainGestureHandlers
  ) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera");
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.01, 5000);
    this._element = element;
    this._heightAt = heightAt;
    this._gestures = gestures;

    this._halfDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    this._center.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this.camera.position.setFromSphericalCoords(1, START_POLAR, START_AZIMUTH).add(this._center);
    this.camera.lookAt(this._center);
    this._fit();
  }

  override onMounted(): void {
    super.onMounted();
    const controls = new MapControls(this.camera, this._element);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.maxPolarAngle = MAX_POLAR;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.copy(this._center);
    controls.update();
    this._controls = controls;
    this._drag = new TerrainGesturesHelper(this._element, () => this.camera, this._gestures);
  }

  override onUnmounted(): void {
    this._release();
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    const controls = this._controls;
    if (!controls || !this._drag) return;
    controls.enabled = this._drag.enabled = this.isActive();
    if (!controls.enabled) return;
    controls.update(dt / 1000);

    const floor = this._heightAt(this.camera.position.x, this.camera.position.z) + GROUND_CLEARANCE_KM;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    const near = Math.max(this.camera.position.distanceTo(controls.target) / 1000, 0.01);
    if (Math.abs(near - this.camera.near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
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

  /** Recule la camera, dans sa direction actuelle, pour que le bloc tienne a l'ecran. */
  private _fit(): void {
    const halfFov = Math.atan(Math.tan(MathUtils.degToRad(FOV) / 2) * Math.min(1, this.camera.aspect));
    const target = this._controls?.target ?? this._center;
    this.camera.position.sub(target).setLength((this._halfDiagonal / Math.tan(halfFov)) * FIT_MARGIN).add(target);
  }

  private _release(): void {
    this._controls?.dispose();
    this._drag?.dispose();
    this._controls = null;
    this._drag = null;
  }
}
