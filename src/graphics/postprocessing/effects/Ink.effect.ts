import { abs, colorToDirection, dot, float, luminance, max, mix, perspectiveDepthToViewZ, smoothstep, step, uniform, vec2, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import type IEffect from "./Effect.interface.ts";
import type { EffectContext } from "./Effect.interface.ts";
import { inkCoverage, inkNoise, inkOnPaper, inkSettings as k, paperAt, WOBBLE_PX } from "./InkStyle.ts";

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
 */
export class InkEffect implements IEffect {
  /** Distance a la camera (unites de scene) ou le trait s'affine ; le journal apparait au-dela, jusqu'a 1,2 fois `far`. */
  readonly near = uniform(60);
  readonly far = uniform(220);

  color(input: Node, { uv, inputBuffer, resolution, normalBuffer, depthBuffer, cameraNear, cameraFar }: EffectContext): Node {
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
    // Volumes extrudes : pas de surface connue par pixel, motifs poses a l'ecran.
    const anchor = { at: pixel };
    const coverage = max(inkCoverage(tone, anchor, { far: distance }).mul(scene), edge.mul(scene));
    const beyond = smoothstep(this.far.mul(0.7), this.far.mul(1.2), z.negate()).mul(scene).add(scene.oneMinus());
    const drawn = inkOnPaper(coverage, anchor, paperAt(anchor, beyond));
    return vec4(mix(input.rgb, drawn, k.amount), input.a);
  }
}
