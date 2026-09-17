import { NodeBase } from "@_core/nodes/Node.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { TerrainDragHelper } from "./TerrainDrag.helper.ts";

const FOV = 35;
// Vue de depart en diagonale, comme un bloc pose sur une table.
const START_AZIMUTH = MathUtils.degToRad(45);
const START_POLAR = MathUtils.degToRad(55);
const MAX_POLAR = MathUtils.degToRad(80);
const GROUND_CLEARANCE_KM = 0.1;

/**
 * Camera fixee sur le bloc : clic droit ou deux doigts pour tourner, molette ou pincement pour zoomer.
 * Le glisser ne bouge pas la camera, il deplace le terrain (`onDrag`).
 */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  private readonly _element: HTMLElement;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _onDrag: (dxKm: number, dzKm: number) => void;
  private readonly _startDistance: number;
  private readonly _center = new Vector3();
  private _controls: MapControls | null = null;
  private _drag: TerrainDragHelper | null = null;

  constructor(
    element: HTMLElement,
    bounds: SceneRect,
    heightAt: (x: number, z: number) => number,
    onDrag: (dxKm: number, dzKm: number) => void
  ) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera");
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.01, 1000);
    this._element = element;
    this._heightAt = heightAt;
    this._onDrag = onDrag;

    const halfDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    this._startDistance = (halfDiagonal / Math.tan(MathUtils.degToRad(FOV) / 2)) * 1.05;
    this._center.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    const offset = new Vector3().setFromSphericalCoords(this._startDistance, START_POLAR, START_AZIMUTH);
    this.camera.position.copy(this._center).add(offset);
    this.camera.lookAt(this._center);
  }

  override onMounted(): void {
    super.onMounted();
    const controls = new MapControls(this.camera, this._element);
    controls.enablePan = false;
    controls.maxPolarAngle = MAX_POLAR;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 2;
    controls.maxDistance = this._startDistance * 2;
    controls.target.copy(this._center);
    controls.update();
    this._controls = controls;
    this._drag = new TerrainDragHelper(this._element, () => this.camera, this._onDrag);
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
  }

  override dispose(): void {
    this._release();
    super.dispose();
  }

  private _release(): void {
    this._controls?.dispose();
    this._drag?.dispose();
    this._controls = null;
    this._drag = null;
  }
}
