import {
  abs,
  colorToDirection,
  dot,
  float,
  getViewPosition,
  luminance,
  max,
  mix,
  perspectiveDepthToViewZ,
  smoothstep,
  step,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type IEffect from "./Effect.interface.ts";
import type { EffectContext } from "./Effect.interface.ts";
import { inkCoverage, inkNoise, inkOnPaper, inkSettings as k, paperAt, WOBBLE_PX, type InkAnchor } from "./InkStyle.ts";

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * L'image devient encre sur papier (voir `InkStyle`) : contours aux sauts de profondeur et d'orientation,
 * tons en hachures ou en trame, plus fins au loin. Pour les images sans surface connue (volumes extrudes) ;
 * la parallaxe se dessine dans le shader du sol, sans cette passe.
 * Lit normales et profondeur de la scene : `EffectComposer` avec `normalDepth`, en tete de sa passe.
 * L'alpha des normales dit ce qui est dessine (1) ou efface dans le papier (0) : le journal apparait la.
 * `anchorAt` accroche papier et journal a la scene (position `xz` d'un pixel) ; sans lui, a l'ecran.
 */
export class InkEffect implements IEffect {
  /** Distance a la camera (unites de scene) ou le trait s'eclaircit. */
  readonly near = uniform(60);
  readonly far = uniform(220);
  private readonly _anchorAt: ((xz: Node) => InkAnchor) | null;

  constructor(anchorAt: ((xz: Node) => InkAnchor) | null = null) {
    this._anchorAt = anchorAt;
  }

  color(input: Node, ctx: EffectContext): Node {
    const { uv, inputBuffer, resolution, normalBuffer, depthBuffer, cameraNear, cameraFar } = ctx;
    const pixel = uv.mul(resolution);
    const shake = inkNoise(pixel, WOBBLE_PX).xy.sub(0.5).mul(k.wobble.mul(2));
    const at = uv.add(shake.div(resolution));
    // Fond (rien de dessine) : papier.
    const scene = step(depthBuffer.sample(at).r, 0.9999);

    const viewZ = (p: Node) => perspectiveDepthToViewZ(depthBuffer.sample(p).r, cameraNear, cameraFar);
    const normalAt = (p: Node) => colorToDirection(normalBuffer.sample(p).xyz);
    const z = viewZ(at);
    const normal = normalAt(at);
    const offset = vec2(k.line).div(resolution);
    let edge: Node = float(0);
    for (const [x, y] of NEIGHBORS) {
      const p = at.add(offset.mul(vec2(x, y)));
      const jump = abs(viewZ(p).sub(z)).div(abs(z));
      const turn = float(1).sub(dot(normalAt(p), normal));
      edge = max(edge, max(smoothstep(k.depthEdge, k.depthEdge.mul(2), jump), smoothstep(k.normalEdge, k.normalEdge.mul(2), turn)));
    }

    const distance = smoothstep(this.near, this.far, z.negate()).mul(scene).add(scene.oneMinus());
    // Ton percu : en lineaire, les ombres tomberaient toutes en aplat.
    const tone = luminance(inputBuffer.sample(at).rgb).max(0).pow(1 / 2.2);
    // Hachures posees a l'ecran ; papier et journal accroches a la scene si possible.
    const screen = { at: pixel };
    const sheet = this._anchorAt ? this._anchorAt(this._worldAt(at, ctx).xz) : screen;
    const shown = normalBuffer.sample(at).a.mul(scene);
    // Hors de la zone dessinee, les contours s'effacent avec le reste.
    const coverage = max(inkCoverage(tone, screen, { far: distance }).mul(scene), edge.mul(shown));
    const erased = shown.oneMinus();
    const drawn = inkOnPaper(coverage, sheet, paperAt(sheet, erased));
    return vec4(mix(input.rgb, drawn, k.amount), input.a);
  }

  /** Position dans la scene du pixel `at`, depuis la profondeur. */
  private _worldAt(at: Node, { depthBuffer, cameraProjectionInverse, cameraWorld }: EffectContext): Node {
    const view = getViewPosition(at, depthBuffer.sample(at).r, cameraProjectionInverse);
    return cameraWorld.mul(vec4(view, 1)).xyz;
  }
}
