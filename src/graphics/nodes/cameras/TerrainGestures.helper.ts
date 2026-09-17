import { MathUtils, Plane, Raycaster, Vector2, Vector3, type Camera } from "three";

export interface TerrainGestureHandlers {
  /** Deplacement du centre, en unites de scene. */
  pan(dx: number, dz: number): void;
  /** Facteur applique a la largeur couverte, autour du point (x, z) de la scene. */
  zoom(factor: number, x: number, z: number): void;
  /** Vitesse au relacher d'un glisser, en unites de scene par ms. */
  fling(vx: number, vz: number): void;
}

const MAX_STEP = 20;
const WHEEL_SPEED = 0.0015;
/** La vitesse de lancer est mesuree sur les derniers mouvements ; un arret plus long l'annule. */
const FLING_WINDOW_MS = 90;

/**
 * Gestes sur le terrain, la camera ne bouge pas :
 * glisser (clic gauche, un doigt) le deplace, molette et pincement changent sa largeur.
 * Le point du sol vise reste sous le pointeur.
 */
export class TerrainGesturesHelper {
  enabled = true;
  private readonly _element: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _handlers: TerrainGestureHandlers;
  private readonly _plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _hit = new Vector3();
  private readonly _last = new Vector3();
  private readonly _pointers = new Map<number, { x: number; y: number }>();
  private _dragging = false;
  private _pinch = 0;
  private _moves: { dx: number; dz: number; t: number }[] = [];

  constructor(element: HTMLElement, camera: () => Camera, handlers: TerrainGestureHandlers) {
    this._element = element;
    this._camera = camera;
    this._handlers = handlers;
    element.addEventListener("pointerdown", this._down);
    element.addEventListener("pointermove", this._move);
    element.addEventListener("pointerup", this._up);
    element.addEventListener("pointercancel", this._up);
    element.addEventListener("wheel", this._wheel, { passive: false });
  }

  dispose(): void {
    this._element.removeEventListener("pointerdown", this._down);
    this._element.removeEventListener("pointermove", this._move);
    this._element.removeEventListener("pointerup", this._up);
    this._element.removeEventListener("pointercancel", this._up);
    this._element.removeEventListener("wheel", this._wheel);
  }

  private _ground(clientX: number, clientY: number): Vector3 | null {
    const rect = this._element.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this._camera());
    return this._raycaster.ray.intersectPlane(this._plane, this._hit);
  }

  private _midpoint(): { x: number; y: number; distance: number } {
    const [a, b] = [...this._pointers.values()];
    return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
  }

  private readonly _down = (event: PointerEvent): void => {
    this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this._dragging = false;
    this._pinch = 0;
    if (!this.enabled) return;
    if (this._pointers.size === 2) this._pinch = this._midpoint().distance;
    if (this._pointers.size !== 1 || event.button !== 0) return;
    const hit = this._ground(event.clientX, event.clientY);
    this._dragging = !!hit;
    this._moves = [];
    if (hit) this._last.copy(hit);
  };

  private readonly _move = (event: PointerEvent): void => {
    if (!this._pointers.has(event.pointerId)) return;
    this._pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.enabled) return;

    if (this._pinch > 0 && this._pointers.size === 2) {
      const { x, y, distance } = this._midpoint();
      const pivot = this._ground(x, y);
      if (pivot && distance > 0) this._handlers.zoom(this._pinch / distance, pivot.x, pivot.z);
      this._pinch = distance;
      return;
    }

    if (!this._dragging) return;
    const hit = this._ground(event.clientX, event.clientY);
    if (!hit) return;
    // Rayon rasant : un petit geste viserait tres loin.
    const dx = MathUtils.clamp(this._last.x - hit.x, -MAX_STEP, MAX_STEP);
    const dz = MathUtils.clamp(this._last.z - hit.z, -MAX_STEP, MAX_STEP);
    this._last.copy(hit);
    this._handlers.pan(dx, dz);
    const t = performance.now();
    this._moves.push({ dx, dz, t });
    while (this._moves[0]!.t < t - FLING_WINDOW_MS) this._moves.shift();
  };

  private readonly _up = (event: PointerEvent): void => {
    this._pointers.delete(event.pointerId);
    if (this._dragging) this._fling();
    this._dragging = false;
    this._pinch = 0;
  };

  private _fling(): void {
    const now = performance.now();
    const recent = this._moves.filter((m) => m.t >= now - FLING_WINDOW_MS);
    if (recent.length < 2) return;
    const elapsed = Math.max(now - recent[0]!.t, 16);
    const dx = recent.reduce((sum, m) => sum + m.dx, 0);
    const dz = recent.reduce((sum, m) => sum + m.dz, 0);
    this._handlers.fling(dx / elapsed, dz / elapsed);
  }

  private readonly _wheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    const pivot = this._ground(event.clientX, event.clientY);
    if (!pivot) return;
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    this._handlers.zoom(Math.exp(event.deltaY * lines * WHEEL_SPEED), pivot.x, pivot.z);
  };
}
