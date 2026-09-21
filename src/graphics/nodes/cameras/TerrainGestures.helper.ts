import { MathUtils, Plane, Raycaster, Vector2, Vector3, type Camera } from "three";

export interface TerrainGestureHandlers {
  /** Deplacement du centre, en unites de scene. */
  pan(dx: number, dz: number): void;
  /** Facteur applique a la largeur couverte, autour du point (x, z) de la scene. */
  zoom(factor: number, x: number, z: number): void;
  /** Vitesse au relacher d'un glisser, en unites de scene par ms. */
  fling(vx: number, vz: number): void;
}

/** Rotation de la vue au glisser, comme chez Chartogne-Taillet quand on est pres du sol. */
export interface TurnHandlers {
  /** Part du geste qui fait tourner autour de `pivot` plutot que glisser (0 : tout deplace le terrain). */
  share(): number;
  /** Point regarde, au sol (unites de scene) : la vue tourne autour de lui. */
  readonly pivot: { readonly x: number; readonly z: number };
  /** Tourne la camera de `radians` autour de `pivot` (le terrain semble tourner en sens inverse). */
  turn(radians: number): void;
}

const MAX_STEP = 20;
const WHEEL_SPEED = 0.0015;
/** La vitesse de lancer est mesuree sur les derniers mouvements ; un arret plus long l'annule. */
const FLING_WINDOW_MS = 90;
/** Pres du point regarde, l'angle saisi n'a plus de sens : la rotation s'efface sous ce rayon (unites de scene). */
const TURN_RADIUS = 10;
/** Rotation au plus par evenement (radians) : un rayon rasant viserait tres loin. */
const MAX_TURN = 0.3;

/**
 * Gestes sur le terrain, la camera ne bouge pas :
 * glisser (clic gauche, un doigt) le deplace, molette et pincement changent sa largeur.
 * Le point du sol saisi reste sous le pointeur : de pres, en tournant autour du point regarde (`turn`) autant que
 * possible, sinon en glissant.
 */
export class TerrainGesturesHelper {
  enabled = true;
  private readonly _element: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _handlers: TerrainGestureHandlers;
  private readonly _turn: TurnHandlers | null;
  private readonly _plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _hit = new Vector3();
  private readonly _from = new Vector3();
  private _last = { x: 0, y: 0 };
  private readonly _pointers = new Map<number, { x: number; y: number }>();
  private _dragging = false;
  private _pinch = 0;
  private _moves: { dx: number; dz: number; t: number }[] = [];

  constructor(element: HTMLElement, camera: () => Camera, handlers: TerrainGestureHandlers, turn: TurnHandlers | null = null) {
    this._element = element;
    this._camera = camera;
    this._handlers = handlers;
    this._turn = turn;
    element.addEventListener("pointerdown", this._down);
    element.addEventListener("pointermove", this._move);
    element.addEventListener("pointerup", this._up);
    element.addEventListener("pointercancel", this._up);
    element.addEventListener("lostpointercapture", this._up);
    element.addEventListener("wheel", this._wheel, { passive: false });
    window.addEventListener("blur", this._reset);
  }

  dispose(): void {
    this._element.removeEventListener("pointerdown", this._down);
    this._element.removeEventListener("pointermove", this._move);
    this._element.removeEventListener("pointerup", this._up);
    this._element.removeEventListener("pointercancel", this._up);
    this._element.removeEventListener("lostpointercapture", this._up);
    this._element.removeEventListener("wheel", this._wheel);
    window.removeEventListener("blur", this._reset);
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
    // Capture : le relachement arrive ici meme au-dessus du panneau, de l'interface ou hors de la fenetre.
    // Sans elle, le geste restait ouvert et la carte suivait la souris a son retour.
    try {
      this._element.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur deja relache : rien a capturer.
    }
    if (!this.enabled) return;
    if (this._pointers.size === 2) this._pinch = this._midpoint().distance;
    if (this._pointers.size !== 1 || event.button !== 0) return;
    this._dragging = !!this._ground(event.clientX, event.clientY);
    this._moves = [];
    this._last = { x: event.clientX, y: event.clientY };
  };

  private readonly _move = (event: PointerEvent): void => {
    if (!this._pointers.has(event.pointerId)) return;
    // Filet de securite : une souris qui bouge sans bouton enfonce a forcement ete relachee ailleurs.
    if (event.pointerType === "mouse" && event.buttons === 0) return this._up(event);
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
    const last = this._last;
    this._last = { x: event.clientX, y: event.clientY };
    // Les deux points lus avec la camera du moment : la vue qui tourne ne se lit pas comme un deplacement.
    const grabbed = this._ground(last.x, last.y);
    if (!grabbed) return;
    this._from.copy(grabbed);
    const hit = this._ground(event.clientX, event.clientY);
    if (!hit) return;
    const pivot = this._turn?.pivot ?? { x: 0, z: 0 };
    const [px, pz] = [this._from.x - pivot.x, this._from.z - pivot.z];
    const [qx, qz] = [hit.x - pivot.x, hit.z - pivot.z];
    // Angle dont le point saisi a tourne autour du point regarde : devant lui ou derriere, il suit le pointeur.
    let angle = 0;
    if (this._turn) {
      const full = Math.atan2(px * qz - pz * qx, px * qx + pz * qz);
      const near = MathUtils.smoothstep(Math.min(Math.hypot(px, pz), Math.hypot(qx, qz)), TURN_RADIUS, TURN_RADIUS * 2);
      angle = MathUtils.clamp(full * this._turn.share() * near, -MAX_TURN, MAX_TURN);
      if (angle !== 0) this._turn.turn(-angle);
    }
    // Le reste glisse : ce que la rotation n'a pas amene sous le pointeur. Rayon rasant : un petit geste viserait tres loin.
    const [cos, sin] = [Math.cos(-angle), Math.sin(-angle)];
    const dx = MathUtils.clamp(px - (qx * cos - qz * sin), -MAX_STEP, MAX_STEP);
    const dz = MathUtils.clamp(pz - (qx * sin + qz * cos), -MAX_STEP, MAX_STEP);
    this._handlers.pan(dx, dz);
    const t = performance.now();
    this._moves.push({ dx, dz, t });
    while (this._moves[0]!.t < t - FLING_WINDOW_MS) this._moves.shift();
  };

  private readonly _up = (event: PointerEvent): void => {
    if (!this._pointers.delete(event.pointerId)) return;
    if (this._dragging) this._fling();
    this._dragging = false;
    this._pinch = 0;
  };

  /** Fenetre quittee (changement d'onglet, alerte) : aucun geste ne survit, et rien ne part en glissade. */
  private readonly _reset = (): void => {
    this._pointers.clear();
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
