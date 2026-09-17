import { DataTexture, HalfFloatType, RedFormat, Vector2 } from "three";
import {
  cameraViewMatrix,
  color,
  float,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node, type TextureNode } from "three/webgpu";

const METERS_TO_KM = 0.001;

/** Une mosaique d'altitudes et son placement sous le bloc (uv du bloc vers uv de la texture). */
function heightLayer() {
  return {
    heights: texture(new DataTexture(new Uint16Array(1), 1, 1, RedFormat, HalfFloatType)),
    uvOffset: uniform(new Vector2(-1, -1)),
    uvScale: uniform(new Vector2(0, 0)),
  };
}

export type HeightLayerUniforms = ReturnType<typeof heightLayer>;

export const terrainSettings = {
  exaggeration: uniform(4),
  baseDepth: uniform(4),
  sizeKm: uniform(1),
  coarse: heightLayer(),
  fine: heightLayer(),
  /** Pas des differences finies, en uv du bloc. */
  normalStep: uniform(new Vector2(1e-3, 1e-3)),
};

export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const s = terrainSettings;
  const scale = s.exaggeration.mul(METERS_TO_KM);

  // Detail la ou il est charge, apercu ailleurs.
  const heightAt = (blockUv: Node, vertex = false) => {
    const read = (layer: HeightLayerUniforms, layerUv: Node) => {
      const sample = layer.heights.sample(layerUv) as TextureNode;
      return (vertex ? sample.level(float(0)) : sample).r;
    };
    const fineUv = s.fine.uvOffset.add(blockUv.mul(s.fine.uvScale));
    const coarseUv = s.coarse.uvOffset.add(blockUv.mul(s.coarse.uvScale));
    const inside = step(0, fineUv.x).mul(step(fineUv.x, 1)).mul(step(0, fineUv.y)).mul(step(fineUv.y, 1));
    return mix(read(s.coarse, coarseUv), read(s.fine, fineUv), inside).mul(scale);
  };

  const blockUv = positionGeometry.xz;
  // 0 sur le dessus, 1 sur les parois et le fond ; `base` vaut 1 au bas du bloc.
  const wall = normalGeometry.y.oneMinus().min(1);
  const base = positionGeometry.y.negate();

  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  material.positionNode = vec3(positionGeometry.x, mix(heightAt(blockUv, true), s.baseDepth.negate(), base), positionGeometry.z);

  const du = vec2(s.normalStep.x, 0);
  const dv = vec2(0, s.normalStep.y);
  const stepKm = s.normalStep.mul(s.sizeKm).mul(2);
  const dx = heightAt(blockUv.add(du)).sub(heightAt(blockUv.sub(du))).div(stepKm.x);
  const dz = heightAt(blockUv.add(dv)).sub(heightAt(blockUv.sub(dv))).div(stepKm.y);
  const worldNormal = mix(vec3(dx.negate(), 1, dz.negate()), normalGeometry, wall);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  material.colorNode = mix(color(0xe8e8e8), color(0x3a3a3a), wall);

  return material;
}
