import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { pixelScale } from "@graphics/materials/Label.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { Color, Group, LinearSRGBColorSpace, Mesh, PlaneGeometry, Scene, Vector3, type Camera, type PerspectiveCamera } from "three";
import { float, mx_fractal_noise_float, positionGeometry, smoothstep, step, uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/** Element que le rideau suit : c'est le panneau lui-meme qui donne son cadre. */
const SELECTOR = "[data-fonds]";
/** Variable posee sur l'element : son contenu apparait derriere le rideau qui se retire. */
const REVEAL_VAR = "--fonds-reveal";
/** Distance du plan devant la camera (unites de scene) : quelconque, l'echelle la compense. */
const DEPTH = 40;
/** Vitesse d'ouverture et de fermeture du rideau (part par seconde). */
const PER_S = 1.9;
/** Pas de temps maximal (ms) : une image bloquee ne doit pas avaler la transition. */
const MAX_STEP_MS = 40;
/** Finesse des taches par lesquelles le rideau se retire : le plan est unitaire, il en faut beaucoup. */
const GRAIN = 16;
/** Papier du rideau, pris tel quel : le calque ecrit directement sur le canvas (voir `OverlayPass`). */
const PAPER = new Color().setHex(0xf1ece0, LinearSRGBColorSpace);

/**
 * Rideau du panneau d'archives, cale sur son rectangle DOM : le panneau garde son texte en HTML (lisible,
 * selectionnable, dispose en CSS) et c'est un plan WebGL pose exactement dessus qui fait son entree et sa
 * sortie, en se retirant par taches.
 *
 * Alignement DOM vers WebGL, comme dans les projets de reference : le plan est place devant la camera a une
 * profondeur quelconque, mis a l'echelle `pixelScale(hauteur, fov) * profondeur` — dans son repere, une unite
 * vaut un pixel d'ecran — puis pose au centre du rectangle, ramene au centre de l'ecran.
 */
export class PanelNode extends Object3DNodeBase {
  private readonly _canvas: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _scene = new Scene();
  private readonly _mesh: Mesh;
  private readonly _forward = new Vector3();
  /** Axes de la camera, reutilises : rien ne doit s'allouer a chaque image. */
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();
  private readonly _reveal = uniform(0);
  /** Part ouverte du rideau, et l'element qu'il suit. */
  private _value = 0;
  private _element: HTMLElement | null = null;

  constructor(canvas: HTMLElement, camera: () => Camera) {
    super(NODE_ID.PANEL, "Panel", new Group());
    this._canvas = canvas;
    this._camera = camera;
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    material.colorNode = vec3(PAPER.r, PAPER.g, PAPER.b);
    // Le rideau se retire par taches : un seuil sur un bruit, jamais un fondu uniforme, pour rester dans la
    // grammaire du dessin. Un liseré adouci suit le front, sinon le bord scintille.
    const noise = mx_fractal_noise_float(positionGeometry.mul(GRAIN), 3, 2, 0.5).mul(0.5).add(0.5);
    const front = this._reveal;
    material.opacityNode = step(front, noise).mul(smoothstep(float(1), float(0.9), front));
    this._mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._scene.add(this._mesh);
  }

  /** La scene du rideau, posee sur l'image finie (`OverlayPass`). */
  get scene(): Scene {
    return this._scene;
  }

  /** Vrai quand le rideau ne bouge plus : l'univers peut alors sauter des images. */
  get settled(): boolean {
    const target = this._element ? 1 : 0;
    return Math.abs(target - this._value) < 0.01;
  }

  override update(_time: number, dt: number): void {
    this._element = document.querySelector<HTMLElement>(SELECTOR);
    const target = this._element ? 1 : 0;
    const k = Math.min(1, (Math.min(dt, MAX_STEP_MS) / 1000) * PER_S);
    this._value = Math.abs(target - this._value) < 0.01 ? target : this._value + (target - this._value) * k;
    this._reveal.value = this._value;
    // Le contenu du panneau apparait derriere le rideau qui se retire : une seule valeur pilote les deux.
    this._element?.style.setProperty(REVEAL_VAR, this._value.toFixed(3));

    this._mesh.visible = this._value < 1 && this._element !== null;
    if (!this._mesh.visible || !this._element) return;

    const camera = this._camera() as PerspectiveCamera;
    camera.getWorldDirection(this._forward);
    const unit = pixelScale(this._canvas.clientHeight, camera.fov ?? 50) * DEPTH;
    const rect = this._element.getBoundingClientRect();
    const { clientWidth: width, clientHeight: height } = this._canvas;
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this._mesh.position
      .copy(camera.position)
      .addScaledVector(this._forward, DEPTH)
      .addScaledVector(this._right, (rect.left + rect.width / 2 - width / 2) * unit)
      .addScaledVector(this._up, -(rect.top + rect.height / 2 - height / 2) * unit);
    this._mesh.quaternion.copy(camera.quaternion);
    this._mesh.scale.set(rect.width * unit, rect.height * unit, 1);
  }

  override dispose(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as { dispose: () => void }).dispose();
    super.dispose();
  }
}
