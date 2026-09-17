import { DataTexture, HalfFloatType, RedFormat, UnsignedByteType, Vector2 } from "three";
import {
  cameraViewMatrix,
  color,
  float,
  mix,
  mx_fractal_noise_float,
  normalGeometry,
  normalize,
  positionGeometry,
  positionWorld,
  smoothstep,
  texture,
  time,
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
const ring = (samples: number) =>
  Array.from({ length: samples }, (_, i) => [Math.cos((i * 2 * Math.PI) / samples), Math.sin((i * 2 * Math.PI) / samples)] as const);

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
  mistScales: uniform(new Vector2(1, 0.5)),
  mistBlend: uniform(0),
};

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const s = terrainSettings;
  const read = (map: TextureNode, uv: Node) => (map.sample(uv) as TextureNode).level(float(0)).r;
  const coarseAt = (blockUv: Node) => read(s.coarseHeights, s.coarseOffset.add(blockUv.mul(s.coarseScale)));
  // Le filtrage melange altitudes et zeros des trous : divise par la part de donnees, il redonne la moyenne des texels valides.
  const metersAt = (blockUv: Node, detailed = true) => {
    const coarse = coarseAt(blockUv);
    if (!detailed) return coarse;
    const uv = s.uvOffset.add(blockUv.mul(s.uvScale));
    const weight = read(s.valid, uv);
    return mix(coarse, read(s.heights, uv).div(weight.max(1e-3)), weight);
  };
  const heightAt = (blockUv: Node, detailed = true) => metersAt(blockUv, detailed).sub(s.floor).mul(s.heightScale);

  const uv = positionGeometry.xz;
  // 0 sur le dessus, 1 sur les parois et le fond ; `base` vaut 1 au bas du bloc.
  const wall = normalGeometry.y.oneMinus().min(1);
  const base = positionGeometry.y.negate();

  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const meters = metersAt(uv);
  const height = meters.sub(s.floor).mul(s.heightScale);
  const sea = float(1).sub(smoothstep(0, 1, meters));
  material.positionNode = vec3(positionGeometry.x, mix(height.sub(sea.mul(SEA_DROP)), s.baseDepth.negate(), base), positionGeometry.z);

  // Pente et creux par sommet : moins nombreux que les pixels, et absents de la passe d'ombre.
  const step = s.texel.mul(NORMAL_SPREAD);
  const du = vec2(step.x, 0);
  const dv = vec2(0, step.y);
  const dx = heightAt(uv.add(du)).sub(heightAt(uv.sub(du))).div(step.x.mul(s.blockSize.x).mul(2));
  const dz = heightAt(uv.add(dv)).sub(heightAt(uv.sub(dv))).div(step.y.mul(s.blockSize.y).mul(2));
  const topNormal = vertexStage(vec3(dx.negate(), 1, dz.negate()));
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(mix(topNormal, normalGeometry, wall), 0)).xyz);

  // Creux : pente moyenne vers le haut autour du point, sur deux rayons.
  let concavity: Node = float(0);
  for (const { radius, samples } of [NEAR_RING, FAR_RING]) {
    const offset = s.texel.mul(radius);
    let sum: Node = float(0);
    for (const [cx, cy] of ring(samples)) sum = sum.add(heightAt(uv.add(vec2(cx, cy).mul(offset)), radius === NEAR_RING.radius));
    concavity = concavity.add(sum.div(samples).sub(height).div(offset.x.mul(s.blockSize.x)));
  }
  const occlusion = vertexStage(float(1).sub(concavity.mul(s.occlusion).clamp(0, 0.85)));

  // Brume : nappes de bruit dans la moitie basse du relief, qui derivent lentement.
  const low = vertexStage(meters.sub(s.floor).div(s.relief.max(1)));
  const geo = s.geoOrigin.add(uv.mul(s.geoSize)).mul(vec2(s.geoCos, 1));
  const noiseAt = (scale: Node) => mx_fractal_noise_float(vec3(geo.mul(scale), time.mul(0.02)), 3, 2, 0.5).mul(0.5).add(0.5);
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
