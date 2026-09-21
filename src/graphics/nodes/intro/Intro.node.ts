import { Object3DNodeBase } from "@_core/nodes/object3d/Object3DNode.base.ts";
import { createLabelMaterial, pixelScale } from "@graphics/materials/Label.material.ts";
import { NODE_ID } from "@graphics/nodes/Node.id.ts";
import { createSdfFont, type SdfFont } from "@graphics/text/SdfFont.ts";
import {
  BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Scene,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from "three";
import { uniform } from "three/tsl";
import { mapUncovered, pageTransition } from "@graphics/postprocessing/effects/PageTransition.ts";
import type { MeshBasicNodeMaterial } from "three/webgpu";

/** Distance des plans devant la camera (unites de scene) : quelconque, l'echelle la compense. */
const DEPTH = 40;
/** Textes de l'intro poses en HTML (mise en page, lecture d'ecran), et le cercle du curseur (`MapCursor`). */
const TEXTS = "[data-intro-text]";
const RING = "[data-cursor-ring]";
/** Mot pose au-dessus du cercle : son corps (px), son interlettrage (em) et son ecart au cercle ouvert (px). */
const WORD = { text: "ENTRER", size: 11, spacing: 0.34, gap: 16, font: '"Manrope", system-ui, sans-serif', weight: 600 };
/** Rayon du cercle ouvert (px) : le mot s'y pose, et ne bouge plus quand le cercle se referme au depart. */
const READY_RADIUS = 44;
/** Le mot est la avant que l'experience puisse partir, mais a peine. */
const WORD_ALPHA = { waiting: 0.4, ready: 1 };
const ALPHA_PER_S = 4;
const MAX_STEP_MS = 40;
const QUAD = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);

/** Un texte de l'intro : son maillage, et le point d'ecriture a l'ecran (px), garde quand son HTML s'en va. */
interface Line {
  element: HTMLElement | null;
  mesh: Mesh;
  at: Vector2;
}

/**
 * Textes de l'intro dessines dans le rendu : le titre, et le mot pose au-dessus du cercle du curseur. Leur
 * mise en page reste en HTML (alignement DOM vers WebGL, comme dans les projets de reference) ; le rendu les
 * ecrit a la meme place, avec la meme police, pour que le masque de composition qui decouvre la carte les
 * efface sur son passage, net, avec la page (`mapUncovered`).
 *
 * Le fond de l'intro n'est pas ici : c'est la page que la passe d'encre pose sur la carte, hachuree sur les
 * bords avec les hachures memes de la carte.
 */
export class IntroNode extends Object3DNodeBase {
  private readonly _canvas: HTMLElement;
  private readonly _camera: () => Camera;
  private readonly _scene = new Scene();
  private readonly _lines: Line[] = [];
  private _word: Line | null = null;
  /** Part dessinee du mot : la sienne, pas celle des noms de la carte. */
  private readonly _wordAlpha = uniform(WORD_ALPHA.waiting);
  private readonly _forward = new Vector3();
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();
  private readonly _lastRing = new Vector2(-1, -1);
  private _ready = false;
  private _settled = false;
  private _built = false;

  constructor(canvas: HTMLElement, camera: () => Camera) {
    super(NODE_ID.INTRO, "Intro", new Group());
    this._canvas = canvas;
    this._camera = camera;
  }

  /** La scene de l'intro, posee sur l'image finie (`OverlayPass`). */
  get scene(): Scene {
    return this._scene;
  }

  /** Vrai quand plus rien ne bouge : la carte ouverte, ou le cercle et le mot immobiles. */
  get settled(): boolean {
    return this._settled;
  }

  /** Les textes sont graves (polices chargees, atlas construits) : la page d'entree est complete. */
  get built(): boolean {
    return this._built;
  }

  /** L'experience peut partir : le mot prend toute son encre. */
  set ready(value: boolean) {
    this._ready = value;
  }

  override onMounted(): void {
    super.onMounted();
    void this._build();
  }

  override update(_time: number, dt: number): void {
    const opened = pageTransition.progress.value;
    this._scene.visible = opened < 1;
    if (!this._scene.visible) {
      this._settled = true;
      return;
    }
    const alpha = this._ready ? WORD_ALPHA.ready : WORD_ALPHA.waiting;
    const k = Math.min(1, (Math.min(dt, MAX_STEP_MS) / 1000) * ALPHA_PER_S);
    this._wordAlpha.value = Math.abs(alpha - this._wordAlpha.value) < 0.005 ? alpha : this._wordAlpha.value + (alpha - this._wordAlpha.value) * k;

    const camera = this._camera() as PerspectiveCamera;
    const { clientWidth: width, clientHeight: height } = this._canvas;
    camera.getWorldDirection(this._forward);
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const unit = pixelScale(height, camera.fov ?? 50) * DEPTH;
    const place = (line: Line) => {
      line.mesh.position
        .copy(camera.position)
        .addScaledVector(this._forward, DEPTH)
        .addScaledVector(this._right, (line.at.x - width / 2) * unit)
        .addScaledVector(this._up, -(line.at.y - height / 2) * unit);
      line.mesh.quaternion.copy(camera.quaternion);
      line.mesh.scale.setScalar(unit);
    };

    for (const line of this._lines) {
      // Le HTML de l'intro s'en va au depart : le texte garde sa derniere place, le masque l'efface la.
      if (line.element?.isConnected) this._anchor(line);
      place(line);
    }

    const word = this._word;
    const ring = document.querySelector<HTMLElement>(RING)?.getBoundingClientRect();
    let moved = false;
    if (word && ring && opened === 0) {
      const x = ring.left + ring.width / 2;
      const y = ring.top + ring.height / 2;
      moved = this._lastRing.x !== x || this._lastRing.y !== y;
      this._lastRing.set(x, y);
      // Le mot se pose sur le cercle ouvert, centre : il ne suit pas le cercle qui se referme au depart.
      word.at.set(x - word.mesh.userData.width / 2, y - READY_RADIUS - WORD.gap);
    }
    if (word) {
      word.mesh.visible = !!ring;
      place(word);
    }
    this._settled = opened === 0 && !moved && Math.abs(alpha - this._wordAlpha.value) < 0.005;
  }

  override dispose(): void {
    for (const line of [...this._lines, this._word]) {
      line?.mesh.geometry.dispose();
      (line?.mesh.material as MeshBasicNodeMaterial | undefined)?.dispose();
    }
    super.dispose();
  }

  /** Construit les textes une fois leurs polices chargees : sinon l'atlas serait grave dans la police de repli. */
  private async _build(): Promise<void> {
    const elements = [...document.querySelectorAll<HTMLElement>(TEXTS)];
    const styles = elements.map((element) => getComputedStyle(element));
    await Promise.all([...styles.map((style) => `${style.fontWeight} 48px ${style.fontFamily}`), `${WORD.weight} 48px ${WORD.font}`].map((font) => document.fonts.load(font)));

    elements.forEach((element, i) => {
      const style = styles[i]!;
      const size = parseFloat(style.fontSize);
      const spacing = parseFloat(style.letterSpacing) || 0;
      const raw = element.textContent?.trim() ?? "";
      const text = style.textTransform === "uppercase" ? raw.toUpperCase() : raw;
      // L'encre du texte vient de sa couleur CSS : seule son opacite compte, l'encre est celle des noms.
      const alpha = Number(style.color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(",")[3] ?? 1);
      const font = createSdfFont(style.fontFamily, parseInt(style.fontWeight, 10) || 400);
      const line: Line = { element, mesh: this._mesh(font, text, size, spacing, 0, uniform(alpha)), at: new Vector2() };
      this._anchor(line);
      this._lines.push(line);
    });

    const font = createSdfFont(WORD.font, WORD.weight);
    this._word = { element: null, mesh: this._mesh(font, WORD.text, WORD.size, WORD.size * WORD.spacing, 1, this._wordAlpha), at: new Vector2(-1e4, -1e4) };
    for (const line of [...this._lines, this._word]) this._scene.add(line.mesh);
    this._built = true;
  }

  /**
   * Point d'ecriture d'un texte d'apres son element : bord gauche de son contenu, ligne de base posee pour que
   * les capitales soient centrees dans sa boite (le texte est en capitales, sa boite a une hauteur de ligne de 1).
   */
  private _anchor(line: Line): void {
    const element = line.element!;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const size = parseFloat(style.fontSize);
    const cap = (line.mesh.userData.cap as number) * size;
    const canvas = this._canvas.getBoundingClientRect();
    line.at.set(rect.left + parseFloat(style.paddingLeft) - canvas.left, rect.top + rect.height / 2 + cap / 2 - canvas.top);
  }

  /** Un texte en quadrilateres de l'atlas, dans le repere en pixels de son point d'ecriture. */
  private _mesh(font: SdfFont, text: string, size: number, spacing: number, tint: number, alpha: ReturnType<typeof uniform<number>>): Mesh {
    const letters = [...text].filter((char) => font.glyphs.has(char));
    const glyphs = new Float32Array(letters.length * 4);
    const screen = new Float32Array(letters.length * 4);
    let pen = 0;
    letters.forEach((char, i) => {
      const glyph = font.glyphs.get(char)!;
      glyphs.set([glyph.u, glyph.v, glyph.du, glyph.dv], i * 4);
      screen.set([pen + glyph.left * size, glyph.top * size, glyph.width * size, glyph.height * size], i * 4);
      pen += glyph.advance * size + spacing;
    });
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(QUAD, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("glyph", new InstancedBufferAttribute(glyphs, 4));
    geometry.setAttribute("screen", new InstancedBufferAttribute(screen, 4));
    geometry.setAttribute("tint", new InstancedBufferAttribute(new Float32Array(letters.length).fill(tint), 1));
    geometry.setAttribute("fade", new InstancedBufferAttribute(new Float32Array(letters.length).fill(1), 1));
    geometry.instanceCount = letters.length;
    const mesh = new Mesh(geometry, createLabelMaterial(font.texture, { reveal: alpha, erase: mapUncovered() }));
    mesh.frustumCulled = false;
    // Largeur sans l'interlettrage final, comme la boite que le navigateur centre ; hauteur des capitales.
    mesh.userData = { width: pen - spacing, cap: font.cap };
    return mesh;
  }
}
