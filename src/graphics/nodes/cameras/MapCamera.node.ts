import { NodeBase } from "@_core/nodes/Node.base.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

const FOV = 35;
// Vue de depart en diagonale, comme un bloc pose sur une table.
const START_AZIMUTH = MathUtils.degToRad(45);
const START_POLAR = MathUtils.degToRad(55);
const MAX_POLAR = MathUtils.degToRad(80);
const GROUND_CLEARANCE_KM = 0.1;
const TARGET_FOLLOW = 0.2;

/** Glisser pour se deplacer, clic droit ou deux doigts pour tourner, molette ou pincement pour zoomer. */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  private readonly _element: HTMLElement;
  private readonly _bounds: SceneRect;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _startDistance: number;
  private readonly _start = new Vector3();
  private readonly _shift = new Vector3();
  private _controls: MapControls | null = null;

  constructor(element: HTMLElement, bounds: SceneRect, heightAt: (x: number, z: number) => number) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera");
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.01, 1000);
    this._element = element;
    this._bounds = bounds;
    this._heightAt = heightAt;

    const halfDiagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    this._startDistance = (halfDiagonal / Math.tan(MathUtils.degToRad(FOV) / 2)) * 1.05;
    this._start.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    const offset = new Vector3().setFromSphericalCoords(this._startDistance, START_POLAR, START_AZIMUTH);
    this.camera.position.copy(this._start).add(offset);
    this.camera.lookAt(this._start);
  }

  override onMounted(): void {
    super.onMounted();
    const controls = new MapControls(this.camera, this._element);
    controls.maxPolarAngle = MAX_POLAR;
    controls.zoomToCursor = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.5;
    controls.maxDistance = this._startDistance * 2;
    controls.target.copy(this._start);
    controls.update();
    this._controls = controls;
  }

  override onUnmounted(): void {
    this._controls?.dispose();
    this._controls = null;
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    const controls = this._controls;
    if (!controls) return;
    controls.enabled = this.isActive();
    if (!controls.enabled) return;

    // Cible dans le departement et posee sur le relief ; la camera suit le meme decalage.
    const { target } = controls;
    const b = this._bounds;
    const x = MathUtils.clamp(target.x, b.minX, b.maxX);
    const z = MathUtils.clamp(target.z, b.minZ, b.maxZ);
    const dy = (this._heightAt(x, z) - target.y) * TARGET_FOLLOW;
    this._shift.set(x - target.x, dy, z - target.z);
    target.add(this._shift);
    this.camera.position.add(this._shift);
    controls.update(dt / 1000);

    const floor = this._heightAt(this.camera.position.x, this.camera.position.z) + GROUND_CLEARANCE_KM;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    const near = Math.max(this.camera.position.distanceTo(target) / 1000, 0.01);
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
    this._controls?.dispose();
    super.dispose();
  }
}
