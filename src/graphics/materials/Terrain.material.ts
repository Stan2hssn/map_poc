import { DataTexture, HalfFloatType, RedFormat, Vector2 } from "three";
import { cameraViewMatrix, color, float, mix, normalGeometry, normalize, positionGeometry, texture, uniform, vec2, vec3, vec4 } from "three/tsl";
import { MeshStandardNodeMaterial, type Node, type TextureNode } from "three/webgpu";

const METERS_TO_KM = 0.001;

export const terrainSettings = {
  exaggeration: uniform(4),
  baseDepth: uniform(4),
  heights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
  /** Carre du bloc (0..1) vers les uv de la mosaique. */
  uvOffset: uniform(new Vector2()),
  uvScale: uniform(new Vector2(1, 1)),
  texelUv: uniform(new Vector2(1, 1)),
  texelKm: uniform(new Vector2(1, 1)),
};

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const s = terrainSettings;
  const scale = s.exaggeration.mul(METERS_TO_KM);
  const mosaicUv = s.uvOffset.add(positionGeometry.xz.mul(s.uvScale));
  const heightAt = (offset: Node) => s.heights.sample(mosaicUv.add(offset)).r.mul(scale);
  // 0 sur le dessus, 1 sur les parois et le fond (normales de la geometrie).
  const wall = normalGeometry.y.oneMinus().min(1);
  // 1 au bas des parois et au fond.
  const base = positionGeometry.y.negate();

  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });

  // Lecture en phase vertex : niveau de mip explicite.
  const height = (s.heights.sample(mosaicUv) as TextureNode).level(float(0)).r.mul(scale);
  material.positionNode = vec3(positionGeometry.x, mix(height, s.baseDepth.negate(), base), positionGeometry.z);

  // Dessus : differences centrales dans la mosaique ; parois : normale de la geometrie.
  const du = vec2(s.texelUv.x, 0);
  const dv = vec2(0, s.texelUv.y);
  const dx = heightAt(du).sub(heightAt(du.negate())).div(s.texelKm.x.mul(2));
  const dz = heightAt(dv).sub(heightAt(dv.negate())).div(s.texelKm.y.mul(2));
  const worldNormal = mix(vec3(dx.negate(), 1, dz.negate()), normalGeometry, wall);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  material.colorNode = mix(color(0xe8e8e8), color(0x3a3a3a), wall);

  return material;
}
