import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { createLabelMaterial, pixelScale } from "@graphics/materials/Label.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createSdfFont, textWidth, type SdfFont } from "@graphics/text/SdfFont.ts";
import {
  BufferAttribute,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearSRGBColorSpace,
  Mesh,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from "three";
import { float, length, max, min, mix, mx_fractal_noise_float, positionGeometry, smoothstep, step, uniform, vec2, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/** Distance des plans devant la camera (unites de scene) : quelconque, l'echelle la compense. */
const DEPTH = 40;
/** Mot pose au-dessus du curseur, et son corps en pixels. */
const WORD = "ENTRER";
const WORD_PX = 13;
/** Rayon du cercle (px) au repos, puis quand l'experience peut commencer. */
const RADIUS = { idle: 34, ready: 52 };
/** Vitesses : le cercle suit la souris, le rayon s'ajuste. */
const FOLLOW_PER_S = 9;
const RADIUS_PER_S = 5;
const MAX_STEP_MS = 40;
/**
 * Duree du retrait du rideau (ms), comptee a l'horloge et non en pas cumules : les premieres images de la
 * carte sont lourdes, et un pas borne y ferait patiner la transition pendant plusieurs secondes.
 */
const REVEAL_MS = 2200;
/** Hachures du fond : leur pas en pixels, et la part de l'ecran qu'elles gagnent depuis les bords. */
const HATCH_PX = 9;
const HATCH_REACH = 0.34;
/** Papier et encre, pris tels quels : le calque ecrit directement sur le canvas (voir `OverlayPass`). */
const PAPER = new Color().setHex(0xf4f0e6, LinearSRGBColorSpace);
const INK = new Color().setHex(0x1d2a4d, LinearSRGBColorSpace);
const FONT = '"Manrope", system-ui, sans-serif';

/**
 * Intro dessinee dans le rendu : un fond de papier hachure sur les cotes, un cercle trace autour du curseur
 * et le mot a poser au-dessus. Au depart de l'experience, tout se retire en une seule fois, par taches, depuis
 * le centre — c'est pour cela que rien de tout cela n'est en HTML : le calque DOM ne saurait pas disparaitre
 * comme de l'encre qui se resorbe.
 *
 * Le fondu reprend la revelation radiale bruitee des projets de reference : la distance au centre pese 0,65,
 * le bruit 0,35, et le balayage depasse 1 pour que les coins finissent aussi.
 */
export class IntroNode extends Object3DNodeBase {
  private readonly _canvas: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _scene = new Scene();
  private readonly _veil: Mesh;
  private readonly _ring: Mesh;
  private readonly _word: Mesh;
  private readonly _cursor = new Group();
  private readonly _reveal = uniform(0);
  /** Part dessinee du mot : la sienne, pas celle des noms de la carte. */
  private readonly _inked = uniform(0);
  private readonly _aspect = uniform(1);
  /** Taille de l'ecran en pixels : les hachures sont un pas d'ecran, pas une fraction du plan. */
  private readonly _size = uniform(new Vector2(1, 1));
  private readonly _forward = new Vector3();
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();
  private readonly _pointer = new Vector2(-1, -1);
  private readonly _at = new Vector2(-1, -1);
  /** Part retiree du rideau, sa cible, et le rayon voulu du cercle. */
  private _value = 0;
  private _target = 0;
  /** Depart du retrait en cours : d'ou il part, et quand. */
  private _from = 0;
  private _since = 0;
  private _radius = RADIUS.idle;
  private _ready = false;
  private _font: SdfFont | null = null;

  constructor(canvas: HTMLElement, camera: () => Camera) {
    super(NODE_ID.INTRO, "Intro", new Group());
    this._canvas = canvas;
    this._camera = camera;
    this._veil = new Mesh(new PlaneGeometry(1, 1), this._veilMaterial());
    this._ring = new Mesh(new PlaneGeometry(1, 1), this._ringMaterial());
    this._word = new Mesh(new InstancedBufferGeometry(), undefined);
    for (const mesh of [this._veil, this._ring, this._word]) mesh.frustumCulled = false;
    // Meme profondeur, profondeur desactivee : sans ordre explicite, le curseur peut passer sous le rideau.
    this._veil.renderOrder = 0;
    this._ring.renderOrder = 1;
    this._word.renderOrder = 2;
    this._cursor.add(this._ring, this._word);
    this._scene.add(this._veil, this._cursor);
  }

  /** La scene de l'intro, posee sur l'image finie (`OverlayPass`). */
  get scene(): Scene {
    return this._scene;
  }

  /** Vrai quand plus rien ne bouge : ni le rideau, ni le cercle qui suit la souris. */
  get settled(): boolean {
    // Une fois retiree, l'intro ne bouge plus rien : sans cela le cercle, qui n'est plus mis a jour, tiendrait
    // l'univers eveille pour toujours.
    if (this._value >= 1) return true;
    return Math.abs(this._target - this._value) < 0.005 && this._at.distanceTo(this._pointer) < 0.5;
  }


  /** L'experience peut partir : le cercle s'ouvre pour le dire. */
  set ready(value: boolean) {
    this._ready = value;
  }

  /** 0 : l'intro couvre la page. 1 : elle s'est retiree et la carte est nue. */
  set target(value: number) {
    if (value === this._target) return;
    this._target = value;
    this._from = this._value;
    this._since = performance.now();
  }

  override onMounted(): void {
    super.onMounted();
    this._font = createSdfFont(FONT, 600);
    this._word.material = createLabelMaterial(this._font.texture, this._inked);
    this._writeWord(this._font);
    this._canvas.addEventListener("pointermove", this._onMove);
  }

  override onUnmounted(): void {
    this._canvas.removeEventListener("pointermove", this._onMove);
    super.onUnmounted();
  }

  override update(_time: number, dt: number): void {
    const ease = (value: number, target: number, perSecond: number) =>
      value + (target - value) * Math.min(1, (Math.min(dt, MAX_STEP_MS) / 1000) * perSecond);
    const elapsed = Math.min(1, (performance.now() - this._since) / REVEAL_MS);
    // Sortie cubique, comme la revelation des projets de reference : vive au depart, posee a l'arrivee.
    this._value = this._from + (this._target - this._from) * (1 - (1 - elapsed) ** 3);
    this._reveal.value = this._value;
    // Le mot s'efface avant le rideau : la page se vide du centre, il ne doit pas rester seul.
    this._inked.value = Math.max(0, 1 - this._value * 2.4);
    this._scene.visible = this._value < 1;
    if (!this._scene.visible) return;

    const camera = this._camera() as PerspectiveCamera;
    const { clientWidth: width, clientHeight: height } = this._canvas;
    camera.getWorldDirection(this._forward);
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const unit = pixelScale(height, camera.fov ?? 50) * DEPTH;
    this._size.value.set(width, height);
    this._aspect.value = width / Math.max(1, height);

    // Le rideau couvre l'ecran entier, pose a plat devant la camera.
    this._veil.position.copy(camera.position).addScaledVector(this._forward, DEPTH);
    this._veil.quaternion.copy(camera.quaternion);
    this._veil.scale.set(width * unit, height * unit, 1);

    // Le cercle suit la souris sans y coller : il la rattrape.
    if (this._pointer.x < 0) this._pointer.set(width / 2, height / 2);
    this._at.lerp(this._pointer, Math.min(1, (Math.min(dt, MAX_STEP_MS) / 1000) * FOLLOW_PER_S));
    this._radius = ease(this._radius, this._ready ? RADIUS.ready : RADIUS.idle, RADIUS_PER_S);
    this._cursor.position
      .copy(camera.position)
      .addScaledVector(this._forward, DEPTH - 1)
      .addScaledVector(this._right, (this._at.x - width / 2) * unit)
      .addScaledVector(this._up, -(this._at.y - height / 2) * unit);
    this._cursor.quaternion.copy(camera.quaternion);
    this._cursor.scale.setScalar(pixelScale(height, camera.fov ?? 50) * (DEPTH - 1));
    this._ring.scale.setScalar(this._radius * 2.6);
  }

  override dispose(): void {
    for (const mesh of [this._veil, this._ring, this._word]) {
      mesh.geometry.dispose();
      (mesh.material as { dispose?: () => void } | undefined)?.dispose?.();
    }
    super.dispose();
  }

  private readonly _onMove = (event: PointerEvent): void => {
    const rect = this._canvas.getBoundingClientRect();
    this._pointer.set(event.clientX - rect.left, event.clientY - rect.top);
  };

  /**
   * Fond de l'intro : du papier, hachure sur les deux bords pour repondre a la carte, qui se retire par
   * taches depuis le centre.
   */
  private _veilMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const uv = positionGeometry.xy.add(0.5);
    // Hachures a 45 degres au pas de l'ecran, qui gagnent depuis les bords gauche et droit.
    const px = uv.mul(this._size);
    const lines = step(0.55, px.x.add(px.y).div(HATCH_PX).fract());
    // Croissant, jamais decroissant : un `smoothstep` aux bornes inversees n'est pas defini en WGSL.
    const edge = smoothstep(0, HATCH_REACH, min(uv.x, float(1).sub(uv.x))).oneMinus();
    material.colorNode = mix(vec3(PAPER.r, PAPER.g, PAPER.b), vec3(INK.r, INK.g, INK.b), lines.mul(edge).mul(0.22));

    // Revelation radiale bruitee : le centre part en premier, le bruit deforme le front.
    const centered = uv.sub(0.5).mul(vec2(this._aspect, 1));
    const radial = length(centered).div(length(vec2(this._aspect, 1).mul(0.5)));
    const noise = mx_fractal_noise_float(uv.mul(6), 3, 2, 0.5).mul(0.5).add(0.5);
    const noisy = radial.mul(0.65).add(noise.mul(0.35));
    material.opacityNode = step(this._reveal.mul(1.35), noisy);
    return material;
  }

  /** Cercle trace autour du curseur : un trait, pas un aplat, avec un bord legerement irregulier. */
  private _ringMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const uv = positionGeometry.xy;
    const wobble = mx_fractal_noise_float(uv.mul(7), 2, 2, 0.5).mul(0.012);
    const d = length(uv).add(wobble);
    const band = float(0.014);
    material.colorNode = vec3(INK.r, INK.g, INK.b);
    // Le trait s'efface avec le rideau, un peu avant lui : la page se vide du centre.
    material.opacityNode = smoothstep(0, band, d.sub(0.38).abs()).oneMinus().mul(max(float(0), float(1).sub(this._reveal.mul(2.4))));
    return material;
  }

  /** Le mot au-dessus du cercle, en quadrilateres de l'atlas, dans le repere en pixels du curseur. */
  private _writeWord(font: SdfFont): void {
    const geometry = this._word.geometry as InstancedBufferGeometry;
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const letters = [...WORD].filter((char) => font.glyphs.has(char));
    const glyphs = new Float32Array(letters.length * 4);
    const screen = new Float32Array(letters.length * 4);
    const tints = new Float32Array(letters.length);
    let pen = (-textWidth(font, WORD) * WORD_PX) / 2;
    letters.forEach((char, i) => {
      const glyph = font.glyphs.get(char)!;
      glyphs.set([glyph.u, glyph.v, glyph.du, glyph.dv], i * 4);
      screen.set(
        [pen + glyph.left * WORD_PX, -RADIUS.ready - 18 + glyph.top * WORD_PX, glyph.width * WORD_PX, glyph.height * WORD_PX],
        i * 4,
      );
      pen += glyph.advance * WORD_PX;
    });
    geometry.setAttribute("glyph", new InstancedBufferAttribute(glyphs, 4));
    geometry.setAttribute("screen", new InstancedBufferAttribute(screen, 4));
    geometry.setAttribute("tint", new InstancedBufferAttribute(tints, 1));
    geometry.instanceCount = letters.length;
  }
}
