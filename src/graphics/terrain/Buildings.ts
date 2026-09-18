import { Earcut } from "three/src/extras/Earcut.js";
import { tileTracer, type Canvas, type Pen, type TileXY } from "./Landcover.ts";
import { GEOMETRY, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

/**
 * Bati du PLAN IGN (couche `bati_surf`) : hauteurs pour la parallaxe, volumes pour l'extrusion.
 * Hauteur manquante (8 % a Paris) : un immeuble bas.
 */
export const DEFAULT_HEIGHT_M = 9;
/** Plage des hauteurs codees sur 16 bits dans la geometrie. */
export const HEIGHT_RANGE_M = 512;
/** Cote (texels) des cellules de la carte des sommets. */
export const PEAK_CELL = 16;

export interface BuildingMesh {
  /** Toits : (u, v) de chaque sommet dans la tuile ; unorm16. */
  roofPoints: Uint16Array;
  /** Par sommet, son batiment : centre (u, v), hauteur / `HEIGHT_RANGE_M`, 0 ; unorm16. */
  roofBuildings: Uint16Array;
  roofIndex: Uint32Array;
  /** Murs : une arete par instance (u0, v0, u1, v1), orientee pour faire face a l'exterieur ; unorm16. */
  wallEdges: Uint16Array;
  wallBuildings: Uint16Array;
  buildings: number;
}

export function buildingHeight(feature: VectorFeature): number {
  const h = Number(feature.properties.hauteur);
  return Number.isFinite(h) && h > 0 ? Math.min(h, HEIGHT_RANGE_M) : DEFAULT_HEIGHT_M;
}

/** Aire signee (formule de l'arpenteur, coordonnees de tuile) d'un anneau ouvert. */
function ringArea(ring: number[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    area += ring[i]! * ring[j + 1]! - ring[j]! * ring[i + 1]!;
  }
  return area;
}

/**
 * Anneau ferme (dernier point = premier) decoupe au carre [0, size] de la tuile, rendu ouvert.
 * Les points poses sur un bord y sont exactement : les aretes de coupure se reconnaissent.
 */
export function clipRing(ring: number[], size: number): number[] {
  let points = ring.slice(0, -2);
  for (const [axis, limit, keepAbove] of [
    [0, 0, true],
    [0, size, false],
    [1, 0, true],
    [1, size, false],
  ] as const) {
    const inside = (i: number) => (keepAbove ? points[i + axis]! >= limit : points[i + axis]! <= limit);
    const out: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const j = (i + 2) % points.length;
      if (inside(i)) out.push(points[i]!, points[i + 1]!);
      if (inside(i) !== inside(j)) {
        const t = (limit - points[i + axis]!) / (points[j + axis]! - points[i + axis]!);
        const x = points[i]! + (points[j]! - points[i]!) * t;
        const y = points[i + 1]! + (points[j + 1]! - points[i + 1]!) * t;
        out.push(axis === 0 ? limit : x, axis === 1 ? limit : y);
      }
    }
    points = out;
  }
  return points;
}

const onBorder = (ax: number, ay: number, bx: number, by: number, size: number) =>
  (ax === bx && (ax <= 0 || ax >= size)) || (ay === by && (ay <= 0 || ay >= size));

/** Polygones d'une entite : un anneau exterieur (signe du premier anneau) suivi de ses cours. */
function polygons(feature: VectorFeature): number[][][] {
  const out: number[][][] = [];
  const outer = Math.sign(ringArea(feature.geometry[0] ?? []));
  for (const ring of feature.geometry) {
    if (Math.sign(ringArea(ring)) === outer || !out.length) out.push([ring]);
    else out.at(-1)!.push(ring);
  }
  return out;
}

const unorm = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 65535);

/**
 * Volumes d'une tuile : toits triangules (cours comprises), murs sur les vraies aretes seulement
 * (les coupures de tuile n'en ont pas). Coordonnees (u, v) lineaires en longitude et latitude dans la tuile.
 */
export function buildTileMesh(layer: VectorLayer, z: number, tile: TileXY): BuildingMesh {
  const size = layer.extent;
  const n = 2 ** z;
  const latAt = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + y / size)) / n))) * (180 / Math.PI);
  const north = latAt(0);
  const south = latAt(size);
  const v = (y: number) => (north - latAt(y)) / (north - south);

  const roofPoints: number[] = [];
  const roofBuildings: number[] = [];
  const roofIndex: number[] = [];
  const wallEdges: number[] = [];
  const wallBuildings: number[] = [];
  let buildings = 0;

  for (const feature of layer.features) {
    if (feature.type !== GEOMETRY.polygon) continue;
    const h = unorm(buildingHeight(feature) / HEIGHT_RANGE_M);
    for (const rings of polygons(feature)) {
      const clipped = rings.map((ring) => clipRing(ring, size));
      const outer = clipped[0];
      if (!outer || outer.length < 6) continue;
      const kept = clipped.filter((ring) => ring.length >= 6);
      buildings++;

      let cu = 0;
      let cv = 0;
      for (let i = 0; i < outer.length; i += 2) {
        cu += outer[i]! / size;
        cv += v(outer[i + 1]!);
      }
      const building = [unorm(cu / (outer.length / 2)), unorm(cv / (outer.length / 2)), h, 0];

      const flat = kept.flat();
      const holes: number[] = [];
      let count = 0;
      for (const ring of kept) {
        if (count) holes.push(count);
        count += ring.length / 2;
      }
      const base = roofPoints.length / 2;
      for (let i = 0; i < flat.length; i += 2) {
        roofPoints.push(unorm(flat[i]! / size), unorm(v(flat[i + 1]!)));
        roofBuildings.push(...building);
      }
      const triangles = Earcut.triangulate(flat, holes, 2);
      for (let t = 0; t < triangles.length; t += 3) {
        const [a, b, c] = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
        const cross =
          (flat[2 * b]! - flat[2 * a]!) * (flat[2 * c + 1]! - flat[2 * a + 1]!) -
          (flat[2 * b + 1]! - flat[2 * a + 1]!) * (flat[2 * c]! - flat[2 * a]!);
        // Vu d'en haut (v vers le sud), un toit tourne dans le sens negatif de (u, v).
        if (cross < 0) roofIndex.push(base + a, base + b, base + c);
        else roofIndex.push(base + a, base + c, base + b);
      }

      kept.forEach((ring, index) => {
        // Face avant d'un mur (a, b) : (-dz, dx), a gauche de l'arete ; l'exterieur d'un anneau d'aire positive est a droite.
        const flip = ringArea(ring) > 0 !== (index > 0);
        for (let i = 0; i < ring.length; i += 2) {
          const j = (i + 2) % ring.length;
          const [ax, ay, bx, by] = [ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!];
          if (onBorder(ax, ay, bx, by, size) || (ax === bx && ay === by)) continue;
          const edge = [unorm(ax / size), unorm(v(ay)), unorm(bx / size), unorm(v(by))];
          wallEdges.push(...(flip ? [edge[2]!, edge[3]!, edge[0]!, edge[1]!] : edge));
          wallBuildings.push(...building);
        }
      });
    }
  }

  return {
    roofPoints: Uint16Array.from(roofPoints),
    roofBuildings: Uint16Array.from(roofBuildings),
    roofIndex: Uint32Array.from(roofIndex),
    wallEdges: Uint16Array.from(wallEdges),
    wallBuildings: Uint16Array.from(wallBuildings),
    buildings,
  };
}

/**
 * Hauteurs du bati (m, jusqu'a 255) dans le rouge de `pen`, pour la parallaxe.
 * Rend la plus grande hauteur dessinee.
 */
export function drawBuildingHeights(pen: Pen, layers: Map<string, VectorLayer>, z: number, tile: TileXY, canvas: Canvas): number {
  const layer = layers.get("bati_surf");
  if (!layer) return 0;
  const trace = tileTracer(z, tile, canvas);
  pen.globalCompositeOperation = "source-over";
  let max = 0;
  for (const feature of layer.features) {
    if (feature.type !== GEOMETRY.polygon) continue;
    const h = Math.min(255, Math.max(1, Math.round(buildingHeight(feature))));
    max = Math.max(max, h);
    pen.fillStyle = `rgb(${h},0,0)`;
    trace(pen, feature, layer.extent);
    pen.fill("nonzero");
  }
  return max;
}

/**
 * Sommets : plus grande hauteur par cellule de `PEAK_CELL` texels, etendue aux cellules voisines.
 * Un rayon qui avance d'une cellule a la fois n'en saute ainsi aucune ; la parallaxe ne descend
 * finement que la ou un batiment peut l'arreter.
 */
export function peakMap(heights: Uint8Array, width: number, height: number): Uint8Array {
  const w = Math.ceil(width / PEAK_CELL);
  const h = Math.ceil(height / PEAK_CELL);
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / PEAK_CELL) * w;
    for (let x = 0; x < width; x++) {
      const i = row + Math.floor(x / PEAK_CELL);
      cells[i] = Math.max(cells[i]!, heights[y * width + x]!);
    }
  }
  const peaks = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let peak = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx >= 0 && cy >= 0 && cx < w && cy < h) peak = Math.max(peak, cells[cy * w + cx]!);
        }
      }
      peaks[y * w + x] = peak;
    }
  }
  return peaks;
}
