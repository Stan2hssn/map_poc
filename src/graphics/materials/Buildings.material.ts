import { HEIGHT_RANGE_M } from "@graphics/terrain/Buildings.ts";
import { Vector4 } from "three";
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  color,
  directionToColor,
  float,
  Fn,
  mix,
  mrt,
  normalView,
  normalize,
  length,
  output,
  positionGeometry,
  positionWorld,
  select,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import {
  buildingSurface,
  CLAY,
  drawnMask,
  FLAT_BUILDING,
  geoAt,
  pencilReveal,
  revealNoise,
  terrainHeight,
  terrainSettings,
} from "./Terrain.material.ts";

const s = terrainSettings;
/** Murs prolonges sous leur pied (fraction de leur hauteur) : sur une pente, pas de jour sous le batiment. */
const FOOTING = 0.5;
/** A l'apparition d'une tuile, part de sa montee sur laquelle les departs des batiments s'echelonnent (bruit). */
const STAGGER = 0.5;

/** Place de la tuile dessinee dans le bloc : origine et taille en uv du bloc (partagee par arbres et voitures). */
export const tileUv = uniform(new Vector4()).onObjectUpdate(({ object }) => object?.userData.tileUv as Vector4);
/** Apparition de la tuile, de 0 a 1 (`BuildingsNode`). */
export const appear = uniform(1).onObjectUpdate(({ object }) => object?.userData.appear as number);
/** Arrivee de ses hauteurs dans la texture du sol, de 0 a 1 : l'ombrage passe des faces du volume a la texture. */
const raster = uniform(0).onObjectUpdate(({ object }) => object?.userData.raster as number);

export const inBlock = (point: Node) => tileUv.xy.add(point.mul(tileUv.zw));
export const toScene = (uv: Node, y: Node) => vec3(uv.x.sub(0.5).mul(s.blockSize.x), y, uv.y.sub(0.5).mul(s.blockSize.y));
/** Zone dessinee au centre du batiment : hors d'elle, il redescend au sol et s'efface, comme le reste du dessin. */
export const maskOf = (building: Node) => drawnMask(toScene(inBlock(building.xy), float(0)).xz);
/** Avancee (0 a 1) de l'apparition d'un batiment : chacun part a son tour, selon un bruit accroche a la carte. */
export const arrival = (building: Node) => {
  const late = revealNoise(geoAt(toScene(inBlock(building.xy), float(0)).xz)).mul(STAGGER);
  return appear
    .sub(late)
    .div(1 - STAGGER)
    .clamp(0, 1);
};
/**
 * Relief sous le sommet `point` du bloc, sans le lissage de l'apercu : sous chaque sommet plutot qu'au centre du
 * batiment, les deux parts d'un batiment coupe au bord d'une tuile (sans mur entre elles) se rejoignent sans marche.
 */
export const footing = (point: Node) => terrainHeight(point, true, false);
/** Distances (unites de scene) entre lesquelles la simplification du lointain monte. */
const SIMPLIFY_FROM = 80;
const SIMPLIFY_TO = 240;
/**
 * Part montee d'un batiment : nulle hors de la zone dessinee (il se replie sur le sol, comme le dessin s'y arrete)
 * et nulle au loin pour les petits (le dessin respire, et il y a moins a dessiner). La simplification est rendue par
 * tuile : tous ses batiments partagent le meme seuil, qui ne saute donc pas d'un batiment a l'autre.
 */
export const kept = (building: Node) => {
  const center = toScene(tileUv.xy.add(tileUv.zw.mul(0.5)), float(0));
  const far = smoothstep(SIMPLIFY_FROM, SIMPLIFY_TO, length(center.sub(cameraPosition)));
  // Le masque ne s'applique qu'au dessin : la carte de nuit (`pen` a 0) garde ses volumes partout.
  return step(s.simplify.mul(far), building.z.mul(HEIGHT_RANGE_M)).mul(mix(float(1), maskOf(building), s.pen));
};

/** Montee a l'apparition : rapide puis douce. */
export const riseOf = (progress: Node) => float(1).sub(progress.oneMinus().pow(3));

/**
 * Argile eclairee comme la parallaxe l'eclairerait : memes normales, ombres et creux, lus dans la texture de
 * hauteurs du sol (`buildingSurface`) ; la passe d'encre y trouve donc les memes contours. `base` : pied dans la
 * scene ; `facing` : normale de la face du volume ; `building` : son attribut. A l'apparition, le batiment part de
 * son dessin a plat sur le sol, monte, et se dessine au crayon par taches ; hors de la zone dessinee, il s'efface.
 */
function clay(base: Node, facing: Node, building: Node): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const arrived = vertexStage(arrival(building));
  const geo = geoAt(positionWorld.xz);
  const surface = buildingSurface(positionWorld, vertexStage(base), riseOf(arrived), vertexStage(facing), pencilReveal(geo, raster));
  const drawing = pencilReveal(geo, arrived);
  const light = surface.light.toVar();
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(surface.normal, 0)).xyz);
  // @ts-expect-error @types/three type ce rappel sans parametre ; three lui passe l'ombre recue.
  material.receivedShadowNode = Fn(([shadow]: [Node]) => shadow.mul(light));
  material.colorNode = mix(FLAT_BUILDING, color(CLAY).mul(surface.shade), drawing);
  const shown = mix(float(1), vertexStage(maskOf(building)), s.pen);
  // Sortie explicite, comme le sol : sans elle, rendu a l'ecran sans MRT (carte de nuit), le shader n'a plus de sortie.
  material.outputNode = vec4(mix(vec3(s.pen), output.rgb, shown), output.a);
  // Part dessinee, negative : l'encre n'y cherche pas de saut de profondeur (voir `InkEffect`).
  material.mrtNode = mrt({ normal: vec4(directionToColor(normalView), shown.mul(drawing).negate()) });
  return material;
}

/** Toits : sommets (u, v) de la tuile a la hauteur du batiment, pose sur le relief. */
export function createRoofMaterial(): MeshStandardNodeMaterial {
  const building = attribute("building", "vec4");
  const point = inBlock(attribute("point", "vec2"));
  const base = footing(point);
  const material = clay(base, vec3(0, 1, 0), building);
  const meters = building.z.mul(HEIGHT_RANGE_M).mul(riseOf(arrival(building)));
  // Ecarte au loin : le toit se replie sur le centre du batiment, ses triangles n'ont plus de surface.
  const shown = vertexStage(kept(building));
  material.positionNode = toScene(mix(inBlock(building.xy), point, shown), base.add(meters.mul(s.buildingUnits).mul(shown)));
  return material;
}

/** Murs : un quadrilatere par arete (`position` : le long de l'arete, en haut), face a l'exterieur. */
export function createWallMaterial(): MeshStandardNodeMaterial {
  const corner = positionGeometry.xy;
  const edge = attribute("edge", "vec4");
  const building = attribute("building", "vec4");
  const rise = riseOf(arrival(building));
  const meters = building.z.mul(HEIGHT_RANGE_M).mul(rise);
  // Pose au sol : le mur descend sous son pied ; tablier de pont : il part de son dessous.
  const bottom = select(building.w.greaterThan(0), building.w.mul(HEIGHT_RANGE_M).mul(rise), meters.mul(-FOOTING));
  const above = mix(bottom, meters, corner.y);
  const point = inBlock(mix(edge.xy, edge.zw, corner.x));
  const base = footing(point);
  // Exterieur a gauche de l'arete (voir `buildTileMesh`) : (-dz, dx) dans la scene.
  const along = edge.zw.sub(edge.xy).mul(tileUv.zw).mul(s.blockSize);
  const material = clay(base, normalize(vec3(along.y.negate(), 0, along.x)), building);
  const shown = vertexStage(kept(building));
  material.positionNode = toScene(mix(inBlock(building.xy), point, shown), base.add(above.mul(s.buildingUnits).mul(shown)));
  return material;
}
