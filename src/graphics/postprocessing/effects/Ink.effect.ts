import { Color, DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import {
  abs,
  colorToDirection,
  dot,
  float,
  fwidth,
  length,
  luminance,
  max,
  mix,
  perspectiveDepthToViewZ,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type IEffect from "./Effect.interface.ts";
import type { EffectContext } from "./Effect.interface.ts";

const NOISE_SIZE = 256;
/** Taille (px) des ondulations du trait et des taches d'encre. */
const WOBBLE_PX = 40;
const BLOT_PX = 90;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Bruit blanc RGBA en tuile : agrandi et filtre, il ondule ; lu au pixel, c'est un grain. */
function createNoise(): DataTexture {
  let seed = 11;
  const data = Uint8Array.from({ length: NOISE_SIZE * NOISE_SIZE * 4 }, () => (seed = (seed * 16807) % 2147483647) % 256);
  const noise = new DataTexture(data, NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  return noise;
}

/**
 * L'image devient encre sur papier, facon presse et dessin a la plume : contours aux sauts de
 * profondeur et d'orientation, tons en hachures ou en trame de points a 45 degres, encre pleine dans
 * les noirs (hachures deja dessinees), trait qui tremble, encre qui bave par taches, grain de photocopie.
 * Lit normales et profondeur de la scene : `EffectComposer` avec `normalDepth`, en tete de sa passe.
 */
export class InkEffect implements IEffect {
  /** 0 : image telle quelle, 1 : dessin. */
  readonly amount = uniform(1);
  readonly paper = uniform(new Color(0xf1ece0));
  readonly ink = uniform(new Color(0x1d2a4d));
  /** Tons (luminance percue, 0 a 1 et plus au soleil) : papier au-dessus de `light`, encre pleine sous `dark`. */
  readonly light = uniform(0.8);
  readonly dark = uniform(0.08);
  /** Pas de la trame ou des hachures (px), et part des hachures (0 : trame de points, 1 : plume). */
  readonly screen = uniform(5);
  readonly hatching = uniform(1);
  /** Contours : ecart de lecture (px), saut de profondeur relatif, ecart d'orientation (1 - cos). */
  readonly line = uniform(1);
  readonly depthEdge = uniform(0.01);
  readonly normalEdge = uniform(0.2);
  /** Tremble du trait (px), grain du papier et de l'encre, bavure par taches. */
  readonly wobble = uniform(1.5);
  readonly grain = uniform(0.5);
  readonly bleed = uniform(0.4);
  private readonly _noise = texture(createNoise());

  color(input: Node, { uv, inputBuffer, resolution, normalBuffer, depthBuffer, cameraNear, cameraFar }: EffectContext): Node {
    const pixel = uv.mul(resolution);
    const noise = (cellPx: number) => this._noise.sample(pixel.div(cellPx * NOISE_SIZE));

    const shake = noise(WOBBLE_PX).xy.sub(0.5).mul(this.wobble.mul(2));
    const at = uv.add(shake.div(resolution));
    const depth = depthBuffer.sample(at).r;
    // Fond (rien de dessine) : papier.
    const scene = step(depth, 0.9999);

    const viewZ = (p: Node) => perspectiveDepthToViewZ(depthBuffer.sample(p).r, cameraNear, cameraFar);
    const normalAt = (p: Node) => colorToDirection(normalBuffer.sample(p).xyz);
    const z = viewZ(at);
    const normal = normalAt(at);
    const offset = vec2(this.line).div(resolution);
    let edge: Node = float(0);
    for (const [x, y] of NEIGHBORS) {
      const p = at.add(offset.mul(vec2(x, y)));
      const jump = abs(viewZ(p).sub(z)).div(abs(z));
      const turn = float(1).sub(dot(normalAt(p), normal));
      edge = max(edge, max(smoothstep(this.depthEdge, this.depthEdge.mul(2), jump), smoothstep(this.normalEdge, this.normalEdge.mul(2), turn)));
    }

    // Ton percu : en lineaire, les ombres tomberaient toutes en aplat.
    const tone = luminance(inputBuffer.sample(at).rgb).max(0).pow(1 / 2.2);
    const density = smoothstep(this.dark, this.light, tone).oneMinus().mul(scene);
    const grain = noise(1).r;
    const rough = noise(3).g;
    // Trame a 45 degres : un point par cellule, d'aire proportionnelle a la densite, bords ronges.
    const turned = vec2(pixel.x.add(pixel.y), pixel.y.sub(pixel.x)).mul(Math.SQRT1_2).div(this.screen);
    const cell = length(turned.fract().sub(0.5));
    const radius = density.sqrt().mul(0.75).add(rough.sub(0.5).mul(this.grain.mul(0.3)));
    const aa = fwidth(cell);
    const dots = smoothstep(radius.sub(aa), radius.add(aa), cell).oneMinus();
    // Plume : traits a 45 degres qui s'epaississent avec l'ombre, croises dans les noirs, un peu tremblants.
    const tremble = noise(WOBBLE_PX).z.sub(0.5).mul(0.6);
    const stroke = (coord: Node, width: Node) => {
      const distance = abs(coord.add(tremble).fract().sub(0.5));
      const soft = fwidth(coord);
      return smoothstep(width.sub(soft), width.add(soft), distance).oneMinus();
    };
    const hatches = max(
      stroke(turned.x, density.mul(0.45)),
      stroke(turned.y, density.sub(0.55).max(0).mul(0.9)).mul(step(0.55, density))
    );
    // Pas de voile de traits fins sur les clairs.
    const pattern = mix(dots, hatches.mul(smoothstep(0.08, 0.2, density)), this.hatching);
    const solid = smoothstep(this.dark, this.dark.mul(2), tone).oneMinus().mul(scene);
    const blot = smoothstep(0.55, 1, noise(BLOT_PX).b).mul(this.bleed).mul(density);
    const inked = max(max(pattern, solid), max(edge.mul(scene), blot)).clamp(0, 1);

    const paper = this.paper.mul(float(1).sub(grain.mul(this.grain).mul(0.12)));
    const ink = mix(this.ink, this.ink.mul(1.6), rough.mul(this.grain));
    // Photocopie : l'encre n'est jamais tout a fait pleine.
    const drawn = mix(paper, ink, inked.mul(float(1).sub(grain.mul(this.grain).mul(0.25))));
    return vec4(mix(input.rgb, drawn, this.amount), input.a);
  }
}
