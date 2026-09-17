import { DataTexture, HalfFloatType, RedFormat, Vector2 } from "three";
import {
  cameraViewMatrix,
  color,
  float,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionWorld,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node, type TextureNode } from "three/webgpu";

/** Ecart des echantillons de pente, en texels : au-dela de 1, le modele est adouci. */
const NORMAL_SPREAD = 1.5;
/** Rayons de l'assombrissement des creux, en texels. */
const OCCLUSION_RADII = [3, 12];
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const);

export const terrainSettings = {
  heights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  /** uv du bloc (0..1) vers uv de la mosaique. */
  uvOffset: uniform(new Vector2()),
  uvScale: uniform(new Vector2(1, 1)),
  /** Altitude (m) posee sur le haut du socle, et unites de scene par metre. */
  floor: uniform(0),
  heightScale: uniform(0.001),
  baseDepth: uniform(3),
  blockSize: uniform(100),
  /** Un texel de la mosaique, en uv du bloc. */
  texel: uniform(new Vector2(1e-3, 1e-3)),
  occlusion: uniform(1.5),
};

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const s = terrainSettings;
  const heightAt = (blockUv: Node, vertex = false) => {
    const sample = s.heights.sample(s.uvOffset.add(blockUv.mul(s.uvScale))) as TextureNode;
    return (vertex ? sample.level(float(0)) : sample).r.sub(s.floor).mul(s.heightScale);
  };

  const uv = positionGeometry.xz;
  // 0 sur le dessus, 1 sur les parois et le fond ; `base` vaut 1 au bas du bloc.
  const wall = normalGeometry.y.oneMinus().min(1);
  const base = positionGeometry.y.negate();

  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  material.positionNode = vec3(positionGeometry.x, mix(heightAt(uv, true), s.baseDepth.negate(), base), positionGeometry.z);

  const height = heightAt(uv);
  const step = s.texel.mul(NORMAL_SPREAD);
  const du = vec2(step.x, 0);
  const dv = vec2(0, step.y);
  const dx = heightAt(uv.add(du)).sub(heightAt(uv.sub(du))).div(step.x.mul(s.blockSize).mul(2));
  const dz = heightAt(uv.add(dv)).sub(heightAt(uv.sub(dv))).div(step.y.mul(s.blockSize).mul(2));
  const worldNormal = mix(vec3(dx.negate(), 1, dz.negate()), normalGeometry, wall);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);

  // Creux : pente moyenne vers le haut autour du point, sur deux rayons.
  let concavity: Node = float(0);
  for (const radius of OCCLUSION_RADII) {
    const offset = s.texel.mul(radius);
    let sum: Node = float(0);
    for (const [cx, cy] of RING) sum = sum.add(heightAt(uv.add(vec2(cx, cy).mul(offset))));
    concavity = concavity.add(sum.div(RING.length).sub(height).div(offset.x.mul(s.blockSize)));
  }
  const occlusion = float(1).sub(concavity.mul(s.occlusion).clamp(0, 0.85));

  material.colorNode = mix(color(0xe4e4e4).mul(occlusion), color(0x202020), wall);
  // Parois lisibles meme a l'ombre : gris en haut, noir au pied, sans les stries des cretes voisines.
  const depth = positionWorld.y.negate().div(s.baseDepth).clamp(0, 1);
  material.emissiveNode = mix(color(0x3a3a3a), color(0x000000), depth.pow(0.6)).mul(wall);
  // @ts-expect-error les types annoncent () => Node, three passe l'ombre en argument
  material.receivedShadowNode = (shadow: Node) => mix(shadow, float(1), wall);

  return material;
}
