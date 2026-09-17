import { DataTexture, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType, Vector2 } from "three";
import {
  cameraViewMatrix,
  color,
  float,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionWorld,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node, type TextureNode } from "three/webgpu";

/** Ecart des echantillons de pente, en texels : au-dela de 1, le modele est adouci. */
const NORMAL_SPREAD = 1.5;
/** Assombrissement des creux : anneau proche lu dans le detail, anneau large dans l'apercu (rayons en texels du detail). */
const NEAR_RING = { radius: 3, samples: 4 };
const FAR_RING = { radius: 12, samples: 8 };
/** Mer (altitude <= 0) : teinte, et decroche sous la cote en unites de scene. */
const SEA_COLOR = 0x5c5c5c;
const SEA_DROP = 0.3;
/** Cellules de bruit sur une repetition de la texture de brume. */
const NOISE_CELLS = 8;
const ring = (samples: number) =>
  Array.from({ length: samples }, (_, i) => [Math.cos((i * 2 * Math.PI) / samples), Math.sin((i * 2 * Math.PI) / samples)] as const);

/**
 * Bruit fractal periodique calcule une fois : la brume le lit en deux echantillons
 * au lieu d'evaluer du bruit a chaque pixel (~3 ms par image).
 */
function createNoiseTexture(size = 256): DataTexture {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const values = new Float32Array(size * size);
  for (let octave = 0; octave < 3; octave++) {
    const n = NOISE_CELLS << octave;
    const lattice = Float32Array.from({ length: n * n }, random);
    const at = (x: number, y: number) => lattice[(y % n) * n + (x % n)]!;
    for (let y = 0; y < size; y++) {
      const y0 = Math.floor((y / size) * n);
      const ty = smooth((y / size) * n - y0);
      for (let x = 0; x < size; x++) {
        const x0 = Math.floor((x / size) * n);
        const tx = smooth((x / size) * n - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        values[y * size + x] += (top + (bottom - top) * ty) / 2 ** octave;
      }
    }
  }
  // Moyenne 0,5 et ecart type 0,16, comme le bruit de Perlin qu'il remplace.
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  const data = Uint8Array.from(values, (v) => Math.round(Math.min(1, Math.max(0, 0.5 + ((v - mean) / deviation) * 0.16)) * 255));
  const noise = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  return noise;
}

export const terrainSettings = {
  /** Detail : altitudes (0 dans les trous) et part de donnees par texel. */
  heights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  valid: texture(new DataTexture(new Uint8Array(1), 1, 1, RedFormat, UnsignedByteType)),
  /** Apercu complet, pris la ou le detail manque. */
  coarseHeights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  /** uv du bloc (0..1) vers uv de chaque mosaique. */
  uvOffset: uniform(new Vector2()),
  uvScale: uniform(new Vector2(1, 1)),
  coarseOffset: uniform(new Vector2()),
  coarseScale: uniform(new Vector2(1, 1)),
  /** Taille de l'apercu en texels. */
  coarseSize: uniform(new Vector2(1, 1)),
  /** Altitude (m) posee sur le haut du socle, relief affiche (m), et unites de scene par metre. */
  floor: uniform(0),
  relief: uniform(1000),
  heightScale: uniform(0.001),
  baseDepth: uniform(3),
  /** Taille du bloc dans la scene : largeur, profondeur. */
  blockSize: uniform(new Vector2(100, 100)),
  /** Un texel de la mosaique, en uv du bloc. */
  texel: uniform(new Vector2(1e-3, 1e-3)),
  occlusion: uniform(1.5),
  /** Emprise en degres : coin nord-ouest, etendue (latitude vers le sud), cosinus de la latitude centrale. */
  geoOrigin: uniform(new Vector2()),
  geoSize: uniform(new Vector2(1, -1)),
  geoCos: uniform(1),
  /** Brume : densite, et deux echelles de bruit fondues pendant le zoom pour qu'elle reste accrochee au sol. */
  mist: uniform(0.55),
  mistNoise: texture(createNoiseTexture()),
  /** Decalage lent du bruit de brume. */
  mistDrift: uniform(new Vector2()),
  mistScales: uniform(new Vector2(1, 0.5)),
  mistBlend: uniform(0),
};

const s = terrainSettings;
const read = (map: TextureNode, uv: Node) => (map.sample(uv) as TextureNode).level(float(0)).r;
// Hors de la mosaique du detail (en vol, elle suit avec retard), seul l'apercu compte.
const inside = (uv: Node) => step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));

// L'apercu est tres agrandi : une B-spline en 4 lectures bilineaires evite les facettes.
function smoothRead(map: TextureNode, uv: Node, size: Node): Node {
  const p = uv.mul(size).sub(0.5);
  const i = p.floor();
  const f = p.sub(i);
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f.oneMinus().pow(3).div(6);
  const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
  const w3 = f3.div(6);
  const g0 = w0.add(w1);
  const g1 = g0.oneMinus();
  const h0 = i.sub(0.5).add(w1.div(g0)).div(size);
  const h1 = i.add(1.5).add(w3.div(g1.max(1e-4))).div(size);
  const row = (y: Node) => read(map, vec2(h0.x, y)).mul(g0.x).add(read(map, vec2(h1.x, y)).mul(g1.x));
  return row(h0.y).mul(g0.y).add(row(h1.y).mul(g1.y));
}

function coarseAt(blockUv: Node, smooth: boolean): Node {
  const uv = s.coarseOffset.add(blockUv.mul(s.coarseScale));
  return smooth ? smoothRead(s.coarseHeights, uv, s.coarseSize) : read(s.coarseHeights, uv);
}

/**
 * Altitude (m) au point `blockUv` du bloc, a lire dans le vertex shader. `detailed` a faux : apercu brut, moins cher.
 * Le filtrage melange altitudes et zeros des trous : divise par la part de donnees, il redonne la moyenne des texels valides.
 */
export function terrainMeters(blockUv: Node, detailed = true): Node {
  const coarse = coarseAt(blockUv, detailed);
  if (!detailed) return coarse;
  const uv = s.uvOffset.add(blockUv.mul(s.uvScale));
  const weight = read(s.valid, uv).mul(inside(uv));
  return mix(coarse, read(s.heights, uv).div(weight.max(1e-3)), weight);
}

/** Hauteur dans la scene au point `blockUv` du bloc (vertex shader). */
export function terrainHeight(blockUv: Node, detailed = true): Node {
  return terrainMeters(blockUv, detailed).sub(s.floor).mul(s.heightScale);
}

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const uv = positionGeometry.xz;
  // 0 sur le dessus, 1 sur les parois et le fond ; `base` vaut 1 au bas du bloc.
  const wall = normalGeometry.y.oneMinus().min(1);
  const base = positionGeometry.y.negate();

  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const meters = terrainMeters(uv);
  const height = meters.sub(s.floor).mul(s.heightScale);
  const sea = float(1).sub(smoothstep(0, 1, meters));
  material.positionNode = vec3(positionGeometry.x, mix(height.sub(sea.mul(SEA_DROP)), s.baseDepth.negate(), base), positionGeometry.z);

  // Pente et creux par sommet : moins nombreux que les pixels, et absents de la passe d'ombre.
  const spread = s.texel.mul(NORMAL_SPREAD);
  const du = vec2(spread.x, 0);
  const dv = vec2(0, spread.y);
  const dx = terrainHeight(uv.add(du)).sub(terrainHeight(uv.sub(du))).div(spread.x.mul(s.blockSize.x).mul(2));
  const dz = terrainHeight(uv.add(dv)).sub(terrainHeight(uv.sub(dv))).div(spread.y.mul(s.blockSize.y).mul(2));
  const topNormal = vertexStage(vec3(dx.negate(), 1, dz.negate()));
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(mix(topNormal, normalGeometry, wall), 0)).xyz);

  // Creux : pente moyenne vers le haut autour du point, sur deux rayons.
  let concavity: Node = float(0);
  for (const { radius, samples } of [NEAR_RING, FAR_RING]) {
    const offset = s.texel.mul(radius);
    let sum: Node = float(0);
    for (const [cx, cy] of ring(samples)) sum = sum.add(terrainHeight(uv.add(vec2(cx, cy).mul(offset)), radius === NEAR_RING.radius));
    concavity = concavity.add(sum.div(samples).sub(height).div(offset.x.mul(s.blockSize.x)));
  }
  const occlusion = vertexStage(float(1).sub(concavity.mul(s.occlusion).clamp(0, 0.85)));

  // Brume : nappes de bruit dans la moitie basse du relief, qui derivent lentement.
  const low = vertexStage(meters.sub(s.floor).div(s.relief.max(1)));
  const geo = s.geoOrigin.add(uv.mul(s.geoSize)).mul(vec2(s.geoCos, 1));
  const noiseAt = (scale: Node) => s.mistNoise.sample(geo.mul(scale).div(NOISE_CELLS).add(s.mistDrift)).r;
  const clouds = mix(noiseAt(s.mistScales.x), noiseAt(s.mistScales.y), s.mistBlend);
  const seaTint = vertexStage(sea);
  const mist = smoothstep(0.45, 0.8, clouds)
    .mul(smoothstep(0.55, 0, low))
    .mul(seaTint.mul(-0.7).add(1))
    .mul(s.mist)
    .mul(wall.oneMinus());

  const ground = mix(color(0xe4e4e4).mul(occlusion), color(SEA_COLOR), seaTint);
  material.colorNode = mix(mix(ground, color(0xf4f4f4), mist), color(0x202020), wall);
  // Parois lisibles meme a l'ombre : gris en haut, noir au pied. La brume eclaire aussi les versants a l'ombre.
  const depth = positionWorld.y.negate().div(s.baseDepth).clamp(0, 1);
  material.emissiveNode = mix(color(0x3a3a3a), color(0x000000), depth.pow(0.6)).mul(wall).add(vec3(mist.mul(0.25)));
  // @ts-expect-error les types annoncent () => Node, three passe l'ombre en argument
  material.receivedShadowNode = (shadow: Node) => mix(shadow, float(1), wall);

  return material;
}
