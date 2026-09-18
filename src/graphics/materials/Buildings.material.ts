import { HEIGHT_RANGE_M } from "@graphics/terrain/Buildings.ts";
import { Vector4 } from "three";
import {
  attribute,
  cameraViewMatrix,
  color,
  float,
  luminance,
  mix,
  normalize,
  output,
  positionGeometry,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { CLAY, drawnMask, penLines, terrainHeight, terrainSettings } from "./Terrain.material.ts";

const s = terrainSettings;
/** Murs prolonges sous leur pied (fraction de leur hauteur) : sur une pente, pas de jour sous le batiment. */
const FOOTING = 0.5;
/** Pied des murs assombri jusqu'a cette hauteur (m). */
const SHADE_M = 10;
/** Hachures des murs a l'ombre : tons (luminance) ou elles apparaissent et ou elles sont les plus epaisses ; plus serrees que celles du sol. */
const HATCH_TONE = { start: 1.2, full: 0.2 };
const HATCH_DENSITY = 5;

/** Place de la tuile dessinee dans le bloc : origine et taille en uv du bloc. */
const tileUv = uniform(new Vector4()).onObjectUpdate(({ object }) => object?.userData.tileUv as Vector4);

const inBlock = (point: Node) => tileUv.xy.add(point.mul(tileUv.zw));
const toScene = (uv: Node, y: Node) => vec3(uv.x.sub(0.5).mul(s.blockSize.x), y, uv.y.sub(0.5).mul(s.blockSize.y));
/** Hauteur (m) d'un batiment, abaissee hors de la zone dessinee : il se leve en y entrant. */
const buildingMeters = (building: Node) => {
  const center = inBlock(building.xy);
  return building.z.mul(HEIGHT_RANGE_M).mul(drawnMask(toScene(center, float(0)).xz));
};
const viewNormal = (normal: Node) => normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz);

function clay(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
}

/** Toits : sommets (u, v) de la tuile a la hauteur du batiment, pose sur le relief en son centre. */
export function createRoofMaterial(): MeshStandardNodeMaterial {
  const material = clay();
  const building = attribute("building", "vec4");
  const base = terrainHeight(inBlock(building.xy));
  material.positionNode = toScene(inBlock(attribute("point", "vec2")), base.add(buildingMeters(building).mul(s.buildingUnits)));
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
  const meters = buildingMeters(building);
  const above = mix(meters.mul(-FOOTING), meters, corner.y);
  const base = terrainHeight(inBlock(building.xy));
  material.positionNode = toScene(inBlock(mix(edge.xy, edge.zw, corner.x)), base.add(above.mul(s.buildingUnits)));
  const direction = edge.zw.sub(edge.xy).mul(tileUv.zw).mul(s.blockSize);
  material.normalNode = viewNormal(vertexStage(normalize(vec3(direction.y.negate(), 0, direction.x))));
  material.colorNode = color(CLAY).mul(mix(0.55, 1, smoothstep(0, SHADE_M, vertexStage(above))));

  // A l'encre : hachures verticales accrochees au mur, d'autant plus epaisses qu'il est a l'ombre.
  const run = edge.zw.sub(edge.xy).mul(tileUv.zw).mul(s.geoSize).mul(vec2(s.geoCos, 1)).length();
  const along = vertexStage(corner.x.mul(run).mul(HATCH_DENSITY));
  const shade = smoothstep(HATCH_TONE.full, HATCH_TONE.start, luminance(output.rgb)).oneMinus();
  const ink = penLines(along, shade.mul(0.45)).mul(smoothstep(0.05, 0.2, shade)).mul(s.pen);
  material.outputNode = vec4(mix(output.rgb, vec3(0), ink), output.a);
  return material;
}
