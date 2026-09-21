import { Vector2 } from "three";
import {
  abs,
  colorToDirection,
  dot,
  float,
  getViewPosition,
  length,
  luminance,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  smoothstep,
  step,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { HOVER_BAND } from "@graphics/materials/Terrain.material.ts";
import { mapUncovered } from "./PageTransition.ts";
import type IEffect from "./Effect.interface.ts";
import type { EffectContext } from "./Effect.interface.ts";
import {
  CLOUDS_WORLD,
  inkCoverage,
  inkNoise,
  inkOnPaper,
  inkSettings as k,
  newsprintAt,
  paperAt,
  WOBBLE_PX,
  type InkAnchor,
} from "./InkStyle.ts";

/** Au-dela (unites de scene), un rayon qui rase l'horizon s'arrete : pas d'infini dans les coordonnees. */
const SHEET_REACH = 1e4;
/** Page d'avant la carte : le ton qu'on prete au papier pour qu'il porte quelques hachures (1 : papier nu). */
const IDLE_TONE = 0.72;
/** Ses bords : la part de l'ecran que gagnent les hachures depuis la gauche et la droite, et leur ton. */
const INTRO_SIDES = { reach: 0.28, tone: 0.52 } as const;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface InkOptions {
  /**
   * Ancre du tremble du trait au point `xz` de la scene : il suit la carte, et les aretes ne glissent plus a travers
   * un bruit fixe a l'ecran quand la camera bouge (elle bouge presque toujours, avec la souris). Sans elle, a l'ecran.
   */
  anchorAt?: (xz: Node) => InkAnchor;
}

/**
 * L'image devient encre sur papier (voir `InkStyle`) : contours aux sauts de profondeur et d'orientation,
 * tons en hachures ou en trame, plus fins au loin. Rendu par defaut, parallaxe ou volumes extrudes ; en option,
 * la parallaxe se dessine dans le shader du sol, sans cette passe.
 * Lit normales et profondeur de la scene : `EffectComposer` avec `normalDepth`, en tete de sa passe.
 * L'alpha des normales dit ce qui est dessine (1) ou efface dans le papier (0), masque de la carte compris ;
 * negatif sur les volumes extrudes, qui n'ont alors que des contours d'arete (comme le bati en parallaxe).
 * Papier pose a l'ecran ; journal a plat sur le sol (en perspective) ; nuages sur un cylindre autour de la scene.
 */
export class InkEffect implements IEffect {
  /** Distance a la camera (unites de scene) ou le trait s'eclaircit. */
  readonly near = uniform(60);
  readonly far = uniform(220);
  /** Journal : distances au point vise (unites de scene) ou il s'efface vers l'horizon. */
  readonly newsprintReach = uniform(new Vector2(160, 420));
  private readonly _anchorAt: ((xz: Node) => InkAnchor) | null;

  constructor({ anchorAt }: InkOptions = {}) {
    this._anchorAt = anchorAt ?? null;
  }

  color(input: Node, ctx: EffectContext): Node {
    const { uv, inputBuffer, resolution, normalBuffer, depthBuffer, cameraNear, cameraFar } = ctx;
    const pixel = uv.mul(resolution);
    // Tremble lu sur la carte (au sol vise pour le fond) : il se deplace avec elle.
    const { ground } = this._ray(uv, ctx);
    const still = step(depthBuffer.sample(uv).r, 0.9999);
    const trembleAt = this._anchorAt ? this._anchorAt(mix(ground, this._worldAt(uv, ctx).xz, still)).at : pixel;
    const shake = inkNoise(trembleAt, WOBBLE_PX).xy.sub(0.5).mul(k.wobble.mul(2));
    const at = uv.add(shake.div(resolution));
    // Fond (rien de dessine) : papier.
    const scene = step(depthBuffer.sample(at).r, 0.9999);

    const viewZ = (p: Node) => perspectiveDepthToViewZ(depthBuffer.sample(p).r, cameraNear, cameraFar);
    const z = viewZ(at);
    const center = normalBuffer.sample(at);
    const normal = colorToDirection(center.xyz);
    // L'alpha porte la part dessinee, puis une fois `HOVER_BAND` dans le lieu tenu sous la souris et deux fois
    // sur son perimetre. Dedans, le trait passe a l'encre du survol ; sur le perimetre, il devient un trait
    // plein, qui delimite le lieu meme la ou la carte ne dessine rien.
    const hovered = step(HOVER_BAND * 0.75, abs(center.a));
    const rim = step(HOVER_BAND * 1.75, abs(center.a));
    const drawnPart = abs(center.a).sub(hovered.add(rim).mul(HOVER_BAND));
    const offset = vec2(k.line).div(resolution);
    // Peu de detail : le seuil monte, les cassures faibles (tuiles, pentes douces) ne font plus de trait ; les
    // silhouettes franches passent toujours.
    const keen = mix(float(3), float(1), k.detail);
    const depthEdge = k.depthEdge.mul(keen);
    const normalEdge = k.normalEdge.mul(keen);
    let edge: Node = float(0);
    for (const [x, y] of NEIGHBORS) {
      const p = at.add(offset.mul(vec2(x, y)));
      const side = normalBuffer.sample(p);
      // Volumes (alpha negatif) : pas de saut de profondeur, comme en parallaxe ou le bati garde celle du sol.
      const solid = step(0, center.a).mul(step(0, side.a));
      const jump = abs(viewZ(p).sub(z)).div(abs(z)).mul(solid);
      const turn = float(1).sub(dot(colorToDirection(side.xyz), normal));
      edge = max(edge, max(smoothstep(depthEdge, depthEdge.mul(2), jump), smoothstep(normalEdge, normalEdge.mul(2), turn)));
    }

    const distance = smoothstep(this.near, this.far, z.negate()).mul(scene).add(scene.oneMinus());
    // Ton percu : en lineaire, les ombres tomberaient toutes en aplat.
    const tone = luminance(inputBuffer.sample(at).rgb)
      .max(0)
      .pow(1 / 2.2);
    const shown = drawnPart.mul(scene);
    // Hachures posees a l'ecran ; hors de la zone dessinee, les contours s'effacent avec le reste.
    const screen = { at: pixel };
    const drawing = max(inkCoverage(tone, screen, { far: distance }).mul(scene), edge.mul(shown));

    const { ground: sheetGround } = this._ray(at, ctx);

    // Papier de la feuille a l'ecran ; journal a plat sur le sol sous la carte, qui s'efface vers l'horizon.
    const sheet = mix(sheetGround, this._worldAt(at, ctx).xz, shown);
    const near = smoothstep(this.newsprintReach.x, this.newsprintReach.y, length(sheet)).oneMinus();
    const paper = paperAt(screen).mul(newsprintAt(sheet, near));
    const marked = max(drawing, rim.mul(k.hoverRim));
    const map = inkOnPaper(marked, screen, paper, hovered);
    // Page d'entree, posee sur la carte deja dessinee : la meme feuille, ses nuages portant quelques hachures,
    // et sur ses bords les hachures memes de la carte, qui l'annoncent. Le masque de composition la retire
    // pour decouvrir la carte (`mapUncovered`) ; le masque de la carte, lui, ne bouge pas.
    const sides = smoothstep(0, INTRO_SIDES.reach, min(uv.x, uv.x.oneMinus())).oneMinus();
    const idle = luminance(paper).max(0).pow(1 / 2.2).mul(mix(float(IDLE_TONE), float(INTRO_SIDES.tone), sides));
    const page = inkOnPaper(inkCoverage(idle, screen, { far: sides.oneMinus() }), screen, paper);
    return vec4(mix(input.rgb, mix(page, map, mapUncovered()), k.amount), input.a);
  }

  /** Rayon du pixel `at` depuis la camera, et le point du sol (y = 0) qu'il vise, replie au-dessus de l'horizon. */
  private _ray(at: Node, ctx: EffectContext): { ground: Node; ray: Node; eye: Node } {
    const eye = ctx.cameraWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const far = ctx.cameraWorld.mul(vec4(getViewPosition(at, float(1), ctx.cameraProjectionInverse), 1)).xyz;
    const ray = normalize(far.sub(eye));
    const ground = eye.add(ray.mul(eye.y.div(abs(ray.y).max(1e-4)).min(SHEET_REACH))).xz;
    return { ground, ray, eye };
  }

  /** Position dans la scene du pixel `at`, depuis la profondeur. */
  private _worldAt(at: Node, { depthBuffer, cameraProjectionInverse, cameraWorld }: EffectContext): Node {
    const view = getViewPosition(at, depthBuffer.sample(at).r, cameraProjectionInverse);
    return cameraWorld.mul(vec4(view, 1)).xyz;
  }
}
