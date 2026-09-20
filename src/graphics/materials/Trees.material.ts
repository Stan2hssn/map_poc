import {
  attribute,
  cameraViewMatrix,
  color,
  directionToColor,
  float,
  mix,
  mrt,
  normalView,
  normalize,
  output,
  positionGeometry,
  select,
  sin,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { arrival, footing, inBlock, maskOf, riseOf, toScene } from "./Buildings.material.ts";
import { terrainSettings } from "./Terrain.material.ts";

const s = terrainSettings;
/** Rayon du houppier code en cm sur 16 bits normalises. */
const CROWN_RANGE_M = 655.35;
/** Feuillu : houppier rond pose haut ; conifere : fuseau etroit, plus sombre. */
const BROADLEAF = { shape: [1, 0.85, 1], lift: 1.7, color: 0x8f977f } as const;
const CONIFER = { shape: [0.6, 2, 0.6], lift: 2.3, color: 0x6c7463 } as const;
/** Vent : balancement du houppier, en rayons, et sa vitesse (rad/s). */
const WIND = { sway: 0.22, speed: 1.1 } as const;

/**
 * Arbres : un houppier par instance (`tree` : u, v dans la tuile, rayon, forme), pose sur le relief ; normales de
 * sphere, sans facettes : l'encre n'en trace que la silhouette et les hachures de l'ombre. A l'apparition de la
 * tuile, ils poussent chacun a leur tour ; hors de la zone dessinee, ils s'effacent.
 */
export function createTreeMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const tree = attribute("tree", "vec4");
  const conifer = tree.w.greaterThan(0);
  const shape = select(conifer, vec3(...CONIFER.shape), vec3(...BROADLEAF.shape));
  const grow = riseOf(arrival(tree));
  const radius = tree.z.mul(CROWN_RANGE_M).mul(s.buildingUnits).mul(grow);
  const center = inBlock(tree.xy);
  const lift = select(conifer, float(CONIFER.lift), float(BROADLEAF.lift)).mul(radius);
  // Vent : chaque houppier se balance a son rythme, d'autant plus qu'il est grand.
  const phase = s.clock.mul(WIND.speed).add(tree.x.add(tree.y).mul(40));
  const sway = vec3(sin(phase), 0, sin(phase.mul(0.7).add(1.7))).mul(radius.mul(WIND.sway).mul(s.wind));
  material.positionNode = toScene(center, footing(center).add(lift)).add(positionGeometry.mul(shape).mul(radius)).add(sway);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(vertexStage(normalize(positionGeometry.div(shape))), 0)).xyz);
  material.colorNode = select(conifer, color(CONIFER.color), color(BROADLEAF.color));
  const shown = mix(float(1), vertexStage(maskOf(tree)), s.pen);
  material.outputNode = vec4(mix(vec3(s.pen), output.rgb, shown), output.a);
  // Part dessinee positive : l'encre suit leurs sauts de profondeur, donc leur silhouette.
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown) });
  return material;
}
