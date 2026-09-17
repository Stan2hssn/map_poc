import { DataTexture, DoubleSide, RedFormat, Vector2, type Texture } from "three";
import { attribute, cameraViewMatrix, float, normalize, positionLocal, positionWorld, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";

const METERS_TO_KM = 0.001;
const TEXEL_UV = 1 / 256;

/** Partages par toutes les tuiles : un seul programme GPU pour toutes. */
export const terrainSettings = {
  exaggeration: uniform(2),
  mask: texture(new DataTexture(new Uint8Array([255]), 1, 1, RedFormat)),
  maskOrigin: uniform(new Vector2()),
  maskSize: uniform(new Vector2(1, 1)),
};

export function createTerrainMaterial(heights: Texture, texelKm: Vector2, skirtDepthKm: number): MeshStandardNodeMaterial {
  const texel = uniform(texelKm);
  const skirtDepth = uniform(skirtDepthKm);
  const scale = terrainSettings.exaggeration.mul(METERS_TO_KM);
  const heightAt = (offset: Node) => texture(heights, uv().add(offset)).r.mul(scale);

  const material = new MeshStandardNodeMaterial({ color: 0xf1efea, roughness: 1, metalness: 0, side: DoubleSide });

  const height = texture(heights, uv()).level(float(0)).r.mul(scale);
  material.positionNode = positionLocal.add(vec3(0, height.sub(attribute("skirt", "float").mul(skirtDepth)), 0));

  // Differences centrales : normale monde de y = f(x, z), puis repere vue.
  const dx = heightAt(vec2(TEXEL_UV, 0)).sub(heightAt(vec2(-TEXEL_UV, 0))).div(texel.x.mul(2));
  const dz = heightAt(vec2(0, TEXEL_UV)).sub(heightAt(vec2(0, -TEXEL_UV))).div(texel.y.mul(2));
  const normalWorld = vec3(dx.negate(), 1, dz.negate());
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalWorld, 0)).xyz);

  const maskUv = positionWorld.xz.sub(terrainSettings.maskOrigin).div(terrainSettings.maskSize);
  material.opacityNode = terrainSettings.mask.sample(maskUv).r;
  material.alphaTest = 0.5;

  return material;
}
