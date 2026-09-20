import { NodeBase } from "@_core/nodes/Node.base.ts";
import type Input from "@_core/systems/Input.ts";
import { TERRAIN_CONFIG } from "@graphics/config/terrain.config.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import type { SceneRect } from "@graphics/terrain/GeoProjection.ts";
import { MathUtils, PerspectiveCamera, Vector2, Vector3 } from "three";
import { TerrainGesturesHelper, type TerrainGestureHandlers } from "./TerrainGestures.helper.ts";

const FOV = 32;
const GROUND_CLEARANCE = 0.5;
/** La largeur de la zone de detail occupe l'ecran, un peu au-dela. */
const FIT = 0.95;
/**
 * Parallaxe a la souris : la camera se deplace dans son plan, de ces fractions de sa distance, et sa cible a peine
 * (`PARALLAX_AIM` de ce deplacement) ; la vue tourne donc autour du point regarde. Temps de reponse (ms).
 */
const PARALLAX = { x: 0.06, y: 0.035 };
const PARALLAX_AIM = 0.1;
const PARALLAX_EASE_MS = 250;
const SHIFT = new Vector3();
const AIM = new Vector3();
/**
 * Pres du sol, le glisser horizontal fait tourner la vue plutot que de la deplacer (Chartogne-Taillet bascule a
 * 0,8) : de rien a tout entre ces `zoom` (1 a la plus petite largeur de vue).
 */
const TURN_ZOOM = { from: 0.72, to: 0.86 };
/** Loin du sol, la vue se remet nord en haut en ce temps (ms), d'autant plus vite qu'on s'eloigne. */
const REALIGN_MS = 500;
/** Temps de reponse du roulis (ms). */
const ROLL_EASE_MS = 120;

/** Ce que la camera lit de la vue : largeur, lissage (ms) et vitesse du centre (unites de scene par seconde). */
export interface MapCameraView {
  readonly extentKm: number;
  readonly settings: { readonly ease: number };
  readonly velocity: { readonly x: number; readonly z: number };
}

/**
 * Camera au-dessus de la carte, a la Chartogne-Taillet : son inclinaison suit la largeur de la vue (oblique de pres,
 * elle se redresse vite en s'eloignant, courbe cubique) ; de pres, le glisser horizontal la fait tourner autour du
 * point vise, et de loin elle se remet nord en haut. Elle penche dans le mouvement, comme la camera de l'arbre du
 * projet grass (inspire d'aten7) : roulis selon la vitesse de rotation, le deplacement lateral et la souris.
 * Glisser, molette et pincement agissent sur le terrain (`gestures`) ; la camera tourne doucement avec la souris.
 */
export class MapCameraNode extends NodeBase {
  readonly camera: PerspectiveCamera;
  /**
   * Inclinaison depuis la verticale (degres) a la plus petite et a la plus grande largeur de vue ; roulis maximal
   * (radians), par radian par seconde de rotation, par largeur de vue par seconde de deplacement lateral, et par
   * demi-ecran par seconde de la souris.
   */
  readonly settings = { tiltNear: 52, tiltFar: 25, rollMax: 0.12, rollPerTurn: -0.05, rollPerPan: -0.08, rollPerMouse: -0.02 };
  /** Faux pendant que la camera orbitale de debug (Shift+C) a la main. */
  isActive: () => boolean = () => true;
  /**
   * Tenir la parallaxe : la carte cesse de suivre la souris. Pose quand le pointeur vise un nom, sinon
   * l'etiquette se deplace pendant qu'on l'approche et devient impossible a attraper.
   */
  holdParallax: () => boolean = () => false;
  private readonly _element: HTMLElement;
  private readonly _heightAt: (x: number, z: number) => number;
  private readonly _view: MapCameraView;
  private readonly _gestures: TerrainGestureHandlers;
  private readonly _width: number;
  private readonly _target = new Vector3();
  private readonly _parallax = new Vector2();
  private readonly _mouse = new Vector2();
  private _distance = 1;
  /** Rotation autour de la verticale du point vise (radians) : visee par les gestes, et affichee. */
  private _yawGoal = 0;
  private _yaw = 0;
  private _roll = 0;
  private _drag: TerrainGesturesHelper | null = null;

  constructor(
    input: Input,
    element: HTMLElement,
    bounds: SceneRect,
    heightAt: (x: number, z: number) => number,
    view: MapCameraView,
    gestures: TerrainGestureHandlers
  ) {
    super(NODE_ID.CAMERA_MAIN, "Map Camera", input);
    const aspect =
      globalThis.window && globalThis.window.innerHeight > 0 ? globalThis.window.innerWidth / globalThis.window.innerHeight : 16 / 9;
    this.camera = new PerspectiveCamera(FOV, aspect, 0.5, 2000);
    this._element = element;
    this._heightAt = heightAt;
    this._view = view;
    this._gestures = gestures;
    this._width = bounds.maxX - bounds.minX;
    this._target.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this._fit();
    this._place();
  }

  /**
   * Direction du regard au sol (x a l'est, z au sud), unitaire, dans `into` : celle de la rotation de la vue, sans
   * la parallaxe de la souris ni le roulis. La cible, elle, reste l'origine de la scene.
   */
  lookAxis(into: Vector2): Vector2 {
    return into.set(Math.sin(this._yaw), -Math.cos(this._yaw));
  }

  override onMounted(): void {
    super.onMounted();
    this._drag = new TerrainGesturesHelper(this._element, () => this.camera, this._gestures, {
      share: () => MathUtils.smoothstep(this._zoom(), TURN_ZOOM.from, TURN_ZOOM.to),
      pivot: this._target,
      turn: (radians) => (this._yawGoal += radians),
    });
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
    const before = this._parallax.x;
    if (mouse && !this.holdParallax()) this._parallax.lerp(this._mouse.set(mouse.nx, mouse.ny), 1 - Math.exp(-dt / PARALLAX_EASE_MS));
    this._turn(dt, dt > 0 ? ((this._parallax.x - before) * 1000) / dt : 0);
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

  /** 1 a la plus petite largeur de vue, 0 a la plus grande (echelle logarithmique). */
  private _zoom(): number {
    const { minExtentKm, maxExtentKm } = TERRAIN_CONFIG;
    return 1 - MathUtils.clamp(Math.log(this._view.extentKm / minExtentKm) / Math.log(maxExtentKm / minExtentKm), 0, 1);
  }

  /** Inclinaison (radians depuis la verticale). */
  private _polar(): number {
    return MathUtils.degToRad(MathUtils.lerp(this.settings.tiltNear, this.settings.tiltFar, 1 - this._zoom() ** 3));
  }

  /** Rotation affichee vers la visee, retour au nord de loin, et roulis qui en decoule ; `mouse` : vitesse de la parallaxe. */
  private _turn(dt: number, mouse: number): void {
    // Au plus court vers le nord : la visee reste dans un demi-tour, l'affichee suit le meme tour.
    const turns = Math.round(this._yawGoal / (2 * Math.PI)) * 2 * Math.PI;
    this._yawGoal -= turns;
    this._yaw -= turns;
    const far = 1 - MathUtils.smoothstep(this._zoom(), TURN_ZOOM.from, TURN_ZOOM.to);
    if (far > 0) this._yawGoal *= Math.exp((-dt * far) / REALIGN_MS);
    const before = this._yaw;
    this._yaw += (this._yawGoal - this._yaw) * (1 - Math.exp(-dt / Math.max(this._view.settings.ease, 1)));
    const turning = dt > 0 ? ((this._yaw - before) * 1000) / dt : 0;
    // Deplacement lateral : vitesse du centre le long de la droite de l'ecran, en largeurs de vue par seconde.
    const { x, z } = this._view.velocity;
    const lateral = (x * Math.cos(this._yaw) + z * Math.sin(this._yaw)) / this._width;
    const s = this.settings;
    const lean = MathUtils.clamp(turning * s.rollPerTurn + lateral * s.rollPerPan + mouse * s.rollPerMouse, -s.rollMax, s.rollMax);
    this._roll += (lean - this._roll) * (1 - Math.exp(-dt / ROLL_EASE_MS));
  }

  private _place(): void {
    const d = this._distance;
    const polar = this._polar();
    const reach = Math.sin(polar) * d;
    const { camera } = this;
    camera.position.set(
      this._target.x - Math.sin(this._yaw) * reach,
      this._target.y + Math.cos(polar) * d,
      this._target.z + Math.cos(this._yaw) * reach
    );
    camera.lookAt(this._target);
    SHIFT.set(this._parallax.x * PARALLAX.x * d, this._parallax.y * PARALLAX.y * d, 0).applyQuaternion(camera.quaternion);
    camera.position.add(SHIFT);
    camera.lookAt(AIM.copy(this._target).addScaledVector(SHIFT, PARALLAX_AIM));
    const floor = this._heightAt(camera.position.x, camera.position.z) + GROUND_CLEARANCE;
    camera.position.y = Math.max(camera.position.y, floor);
    // Apres le cadrage : `lookAt` remet la camera d'aplomb.
    camera.rotateZ(this._roll);
  }

  private _release(): void {
    this._drag?.dispose();
    this._drag = null;
  }
}
