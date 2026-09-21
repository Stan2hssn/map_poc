import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { pixelScale } from "@graphics/materials/Label.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { Color, Group, LinearSRGBColorSpace, Mesh, PlaneGeometry, Scene, Vector2, Vector3, type Camera, type PerspectiveCamera } from "three";
import { clamp, float, fwidth, mix, mx_fractal_noise_float, positionGeometry, smoothstep, step, uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/** Element que la feuille suit : c'est le panneau lui-meme qui donne son cadre, et son etat (`data-state`). */
const SELECTOR = "[data-fonds]";
/** Variable posee sur l'element : son texte s'ecrit a mesure que la feuille gagne. */
const REVEAL_VAR = "--fonds-reveal";
/** Distance du plan devant la camera (unites de scene) : quelconque, l'echelle la compense. */
const DEPTH = 40;
/**
 * Durees de l'ecriture de la feuille et de sa disparition (ms), comptees a l'horloge : le panneau s'ouvre
 * pendant le vol vers le lieu, dont les images sont lourdes ; en pas bornes, la feuille y mettait trois fois
 * plus de temps.
 */
const WRITE_MS = 900;
const ERASE_MS = 620;
/** Taille des taches par lesquelles la feuille s'ecrit (px), et part du haut vers le bas dans leur ordre. */
const CELL_PX = 150;
const DOWNWARD = 0.35;
/**
 * Bord d'encre du front : un trait franc d'une largeur fixe a l'ecran (px), puis un lavis leger qui se retire
 * vers le papier (en part du bruit). Plus large, le lavis faisait des gouttes plutot qu'un bord.
 */
const EDGE = { corePx: 1.6, wash: 0.028, washInk: 0.28 };
/** Papier et encre de la feuille, pris tels quels : le calque ecrit directement sur le canvas (`OverlayPass`). */
const PAPER = new Color().setHex(0xf1ece0, LinearSRGBColorSpace);
const INK = new Color().setHex(0x1d2a4d, LinearSRGBColorSpace);
/** Opacite de la feuille, et du filet qui la separe de la carte a gauche. */
const SHEET_ALPHA = 0.97;
const BORDER = { px: 1, ink: 0.3 };

/**
 * Feuille du panneau d'archives, calee sur son rectangle DOM : le panneau garde son texte en HTML (lisible,
 * selectionnable, dispose en CSS) et n'a pas de fond ; c'est ce plan WebGL qui le porte. Il s'ecrit comme un
 * papier qui se consumerait a l'envers : par taches, un bord d'encre en tete du front ; a la fermeture, il se
 * consume pour de bon. Le texte suit la meme valeur (`--fonds-reveal`) : il s'ecrit derriere le front.
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
  private readonly _front = uniform(0);
  /** Taille de la feuille en pixels : les taches et le filet se comptent a l'ecran, pas en part du plan. */
  private readonly _size = uniform(new Vector2(1, 1));
  /** Part ecrite, lineaire (0 a 1), l'element suivi, et le mouvement en cours : sa cible, d'ou et quand. */
  private _value = 0;
  private _element: HTMLElement | null = null;
  private _motion = { target: 0, from: 0, since: 0 };

  constructor(canvas: HTMLElement, camera: () => Camera) {
    super(NODE_ID.PANEL, "Panel", new Group());
    this._canvas = canvas;
    this._camera = camera;
    this._mesh = new Mesh(new PlaneGeometry(1, 1), this._material());
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._scene.add(this._mesh);
  }

  /** La scene de la feuille, posee sur l'image finie (`OverlayPass`). */
  get scene(): Scene {
    return this._scene;
  }

  /** Vrai quand la feuille ne bouge plus : l'univers peut alors sauter des images. */
  get settled(): boolean {
    return this._value === this._target();
  }

  override update(): void {
    this._element = document.querySelector<HTMLElement>(SELECTOR);
    const target = this._target();
    const motion = this._motion;
    if (target !== motion.target) this._motion = { target, from: this._value, since: performance.now() };
    const span = (target ? WRITE_MS : ERASE_MS) * Math.abs(target - this._motion.from);
    const t = span > 0 ? Math.min(1, (performance.now() - this._motion.since) / span) : 1;
    this._value = this._motion.from + (target - this._motion.from) * t;
    // Lente aux bords, vive au milieu : la feuille s'amorce, s'ecrit, puis se pose.
    const eased = this._value * this._value * (3 - 2 * this._value);
    this._front.value = eased;
    this._element?.style.setProperty(REVEAL_VAR, eased.toFixed(3));

    this._mesh.visible = this._value > 0 && this._element !== null;
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
    this._size.value.set(rect.width, rect.height);
  }

  override dispose(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as MeshBasicNodeMaterial).dispose();
    super.dispose();
  }

  /** Ecrite tant que le panneau est la et ne se ferme pas. */
  private _target(): number {
    return this._element && this._element.dataset.state !== "leave" ? 1 : 0;
  }

  /**
   * La feuille : un seuil sur un bruit, jamais un fondu, pour rester dans la grammaire du dessin. Le bruit se
   * compte en pixels et penche du haut vers le bas, comme une page qu'on ecrit. En tete du front, un bord
   * d'encre : un trait franc, puis un lavis qui se retire vers le papier.
   */
  private _material(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const uv = positionGeometry.xy.add(0.5);
    const px = uv.mul(this._size);
    const noise = mx_fractal_noise_float(px.div(CELL_PX), 3, 2, 0.5).mul(0.5).add(0.5);
    const order = clamp(mix(noise, uv.y.oneMinus(), DOWNWARD), 0, 1);
    // Le front part d'avant le premier point et finit apres le dernier, bord d'encre compris.
    const front = mix(float(-EDGE.wash), float(1 + EDGE.wash), this._front);
    const behind = front.sub(order);
    const written = step(0, behind);
    // Le trait se mesure en pixels : la derivee du bruit dit ce que vaut un pixel a cet endroit du front.
    const core = smoothstep(0, fwidth(order).mul(EDGE.corePx), behind).oneMinus();
    const ink = core.max(smoothstep(0, EDGE.wash, behind).oneMinus().mul(EDGE.washInk));
    const paper = vec3(PAPER.r, PAPER.g, PAPER.b);
    const inked = vec3(INK.r, INK.g, INK.b);
    // Filet de gauche : il separe la feuille de la carte, comme la bordure du panneau le faisait en CSS.
    const border = step(px.x, float(BORDER.px)).mul(BORDER.ink);
    material.colorNode = mix(mix(paper, inked, border), inked, ink);
    material.opacityNode = written.mul(mix(float(SHEET_ALPHA), float(1), ink.max(border)));
    return material;
  }
}
