import { MathUtils, Plane, Raycaster, Vector2, Vector3, type Camera } from "three";

const MAX_STEP_KM = 20;

/**
 * Glisser au clic gauche ou a un doigt : le point du sol saisi reste sous le pointeur.
 * Rend le deplacement du centre en km (x vers l'est, z vers le sud).
 */
export class TerrainDragHelper {
  enabled = true;
  private readonly _element: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _onMove: (dxKm: number, dzKm: number) => void;
  private readonly _plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _hit = new Vector3();
  private readonly _last = new Vector3();
  private readonly _pointers = new Set<number>();
  private _dragging = false;

  constructor(element: HTMLElement, camera: () => Camera, onMove: (dxKm: number, dzKm: number) => void) {
    this._element = element;
    this._camera = camera;
    this._onMove = onMove;
    element.addEventListener("pointerdown", this._down);
    element.addEventListener("pointermove", this._move);
    element.addEventListener("pointerup", this._up);
    element.addEventListener("pointercancel", this._up);
  }

  dispose(): void {
    this._element.removeEventListener("pointerdown", this._down);
    this._element.removeEventListener("pointermove", this._move);
    this._element.removeEventListener("pointerup", this._up);
    this._element.removeEventListener("pointercancel", this._up);
  }

  private _ground(event: PointerEvent): Vector3 | null {
    const rect = this._element.getBoundingClientRect();
    this._ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this._camera());
    return this._raycaster.ray.intersectPlane(this._plane, this._hit);
  }

  private readonly _down = (event: PointerEvent): void => {
    this._pointers.add(event.pointerId);
    // Un second doigt rend la main aux controles de camera (rotation, zoom).
    const hit = this.enabled && event.button === 0 && this._pointers.size === 1 ? this._ground(event) : null;
    this._dragging = !!hit;
    if (hit) this._last.copy(hit);
  };

  private readonly _move = (event: PointerEvent): void => {
    if (!this._dragging || !this.enabled) return;
    const hit = this._ground(event);
    if (!hit) return;
    // Rayon rasant : un petit geste viserait des centaines de km.
    const dx = MathUtils.clamp(this._last.x - hit.x, -MAX_STEP_KM, MAX_STEP_KM);
    const dz = MathUtils.clamp(this._last.z - hit.z, -MAX_STEP_KM, MAX_STEP_KM);
    this._last.copy(hit);
    this._onMove(dx, dz);
  };

  private readonly _up = (event: PointerEvent): void => {
    this._pointers.delete(event.pointerId);
    this._dragging = false;
  };
}
