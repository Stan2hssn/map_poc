import {
  attribute,
  cameraViewMatrix,
  color,
  directionToColor,
  float,
  length,
  mix,
  mrt,
  normalGeometry,
  normalView,
  normalize,
  output,
  positionGeometry,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { footing, inBlock, maskOf, tileUv, toScene } from "./Buildings.material.ts";
import { terrainSettings } from "./Terrain.material.ts";

const s = terrainSettings;

/** Un vehicule (m) : longueur, hauteur, largeur ; decalage a droite de l'axe de sa voie ; teinte. */
interface Vehicle {
  size: readonly [number, number, number];
  lane: number;
  color: number;
}

/**
 * Voiture grossie comme un symbole de carte (x 2) : a l'echelle, elle ne ferait que 2 a 4 px a la vue la plus
 * proche. Conduite a droite.
 */
export const CAR: Vehicle = { size: [8.8, 3, 3.6], lane: 3.2, color: 0x2b3144 };
/** Peniche grossie comme les voitures (x 1,75) : a l'echelle, on ne la voyait pas ; a droite du milieu du fleuve. */
export const BOAT: Vehicle = { size: [56, 5, 11], lane: 18, color: 0x3a4054 };

/**
 * Vehicules : une boite par instance (`vehicle` : u, v dans la tuile et direction de marche en (u, v), de longueur
 * sa taille), posee sur le relief, dans sa voie. Places chaque image par `Traffic` ; au-dela de la portee du dessin,
 * ils s'effacent.
 */
export function createVehicleMaterial({ size: dimensions, lane, color: tint }: Vehicle): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  const vehicle = attribute("vehicle", "vec4");
  const center = inBlock(vehicle.xy);
  // Direction dans la scene (x a l'est, z au sud), et sa droite.
  const along = normalize(vehicle.zw.mul(tileUv.zw).mul(s.blockSize));
  const right = vec2(along.y.negate(), along.x);
  // Taille : 1, moins aux bouts de sa voie (voir `Traffic.write`).
  const size = length(vehicle.zw);
  const units = s.buildingUnits;
  const local = positionGeometry.mul(vec3(...dimensions)).mul(units).mul(size);
  const flat = along.mul(local.x).add(right.mul(local.z.add(float(lane).mul(units))));
  const lift = local.y.add(units.mul(dimensions[1] / 2));
  material.positionNode = toScene(center, footing(center).add(lift)).add(vec3(flat.x, 0, flat.y));
  const normal = vec3(
    along.x.mul(normalGeometry.x).add(right.x.mul(normalGeometry.z)),
    normalGeometry.y,
    along.y.mul(normalGeometry.x).add(right.y.mul(normalGeometry.z))
  );
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz);
  material.colorNode = color(tint);
  const shown = mix(float(1), vertexStage(maskOf(vehicle)), s.pen);
  material.outputNode = vec4(mix(vec3(s.pen), output.rgb, shown), output.a);
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown) });
  return material;
}
