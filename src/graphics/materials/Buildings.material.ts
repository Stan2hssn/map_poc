import { HEIGHT_RANGE_M } from "@graphics/terrain/Buildings.ts";
import { Vector4 } from "three";
import { attribute, cameraViewMatrix, color, mix, normalize, positionGeometry, smoothstep, uniform, vec3, vec4, vertexStage } from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { CLAY, terrainHeight, terrainSettings } from "./Terrain.material.ts";

const s = terrainSettings;
/** Murs prolonges sous leur pied (fraction de leur hauteur) : sur une pente, pas de jour sous le batiment. */
const FOOTING = 0.5;
/** Pied des murs assombri jusqu'a cette hauteur (m). */
const SHADE_M = 10;

/** Place de la tuile dessinee dans le bloc : origine et taille en uv du bloc. */
const tileUv = uniform(new Vector4()).onObjectUpdate(({ object }) => object?.userData.tileUv as Vector4);

const inBlock = (point: Node) => tileUv.xy.add(point.mul(tileUv.zw));
const toScene = (uv: Node, y: Node) => vec3(uv.x.sub(0.5).mul(s.blockSize.x), y, uv.y.sub(0.5).mul(s.blockSize.y));
const viewNormal = (normal: Node) => normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz);

function clay(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
}

/** Toits : sommets (u, v) de la tuile a la hauteur du batiment, pose sur le relief en son centre. */
export function createRoofMaterial(): MeshStandardNodeMaterial {
  const material = clay();
  const building = attribute("building", "vec4");
  const base = terrainHeight(inBlock(building.xy));
  material.positionNode = toScene(inBlock(attribute("point", "vec2")), base.add(building.z.mul(HEIGHT_RANGE_M).mul(s.buildingUnits)));
  material.normalNode = viewNormal(vec3(0, 1, 0));
  material.colorNode = color(CLAY);
  return material;
}

/** Murs : un quadrilatere par arete (`position` : le long de l'arete, en haut), face a l'exterieur. */
export function createWallMaterial(): MeshStandardNodeMaterial {
  const material = clay();
  const corner = positionGeometry.xy;
  const edge = attribute("edge", "vec4");
  const building = attribute("building", "vec4");
  const meters = building.z.mul(HEIGHT_RANGE_M);
  const above = mix(meters.mul(-FOOTING), meters, corner.y);
  const base = terrainHeight(inBlock(building.xy));
  material.positionNode = toScene(inBlock(mix(edge.xy, edge.zw, corner.x)), base.add(above.mul(s.buildingUnits)));
  const along = edge.zw.sub(edge.xy).mul(tileUv.zw).mul(s.blockSize);
  material.normalNode = viewNormal(vertexStage(normalize(vec3(along.y.negate(), 0, along.x))));
  material.colorNode = color(CLAY).mul(mix(0.55, 1, smoothstep(0, SHADE_M, vertexStage(above))));
  return material;
}
