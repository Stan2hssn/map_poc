import { Earcut } from "three/src/extras/Earcut.js";
import { latitudeV, roadWidth, tileMeters, tileTracer, type Canvas, type Pen, type TileXY } from "./Landcover.ts";
import { GEOMETRY, partsOf, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

/**
 * Bati du PLAN IGN (couche `bati_surf`) : hauteurs pour la parallaxe, volumes pour l'extrusion.
 * Hauteur manquante (8 % a Paris) : un immeuble bas.
 */
export const DEFAULT_HEIGHT_M = 9;
/** Plage des hauteurs codees sur 16 bits dans la geometrie. */
export const HEIGHT_RANGE_M = 512;
/** Cote (texels) des cellules de la carte des sommets, et de celle des sommets des environs (d'ou partir). */
export const PEAK_CELL = 16;
export const SUMMIT_CELL = 64;
/** Tablier des ponts (m) : dessous et dessus, au-dessus du sol ou de l'eau. */
const DECK_M = { base: 4.5, top: 7 } as const;
/** Largeur des chemins sur ouvrage (m). */
const FOOTBRIDGE_M = 4;

/** Tablier d'un pont : quadrilatere (coordonnees de la tuile), dessous et dessus (m). */
export interface Deck {
  ring: number[];
  base: number;
  top: number;
}

/**
 * Ponts en volume : chaque troncon d'une route ou d'un chemin sur ouvrage (`routier_route_sup`,
 * `routier_chemin_sup`) devient un tablier de sa largeur, pose au-dessus du sol ou de l'eau.
 */
export function bridgeDecks(layers: Map<string, VectorLayer>, z: number, tile: TileXY): Deck[] {
  const decks: Deck[] = [];
  for (const [name, width] of [
    ["routier_route_sup", (f: VectorFeature) => roadWidth(f, 6)],
    ["routier_chemin_sup", () => FOOTBRIDGE_M],
  ] as const) {
    const layer = layers.get(name);
    if (!layer) continue;
    const unitsPerM = layer.extent / tileMeters(z, tile);
    for (const feature of layer.features) {
      if (feature.type !== GEOMETRY.line) continue;
      const half = (width(feature) * unitsPerM) / 2;
      for (const line of partsOf(layer, feature)) {
        for (let i = 2; i < line.length; i += 2) {
          const [ax, ay, bx, by] = [line[i - 2]!, line[i - 1]!, line[i]!, line[i + 1]!];
          const length = Math.hypot(bx - ax, by - ay);
          if (length < 1e-6) continue;
          // Prolonge d'une demi-largeur : les troncons se recouvrent aux coudes, sans jour.
          const [dx, dy] = [((bx - ax) / length) * half, ((by - ay) / length) * half];
          const [nx, ny] = [-dy, dx];
          const [a0, a1, b0, b1] = [ax - dx, ay - dy, bx + dx, by + dy];
          decks.push({
            ring: [a0 + nx, a1 + ny, b0 + nx, b1 + ny, b0 - nx, b1 - ny, a0 - nx, a1 - ny],
            base: DECK_M.base,
            top: DECK_M.top,
          });
        }
      }
    }
  }
  return decks;
}

export interface BuildingMesh {
  /** Toits : (u, v) de chaque sommet dans la tuile ; unorm16. */
  roofPoints: Uint16Array;
  /** Par sommet, son batiment : centre (u, v), hauteur du dessus et du dessous (0 : au sol) / `HEIGHT_RANGE_M` ; unorm16. */
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
function polygons(rings: number[][]): number[][][] {
  const out: number[][][] = [];
  const outer = Math.sign(ringArea(rings[0] ?? []));
  for (const ring of rings) {
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
export function buildTileMesh(layer: VectorLayer, z: number, tile: TileXY, decks: readonly Deck[] = []): BuildingMesh {
  const size = layer.extent;
  const v = latitudeV(z, tile, size);

  const roofPoints: number[] = [];
  const roofBuildings: number[] = [];
  const roofIndex: number[] = [];
  const wallEdges: number[] = [];
  const wallBuildings: number[] = [];
  let buildings = 0;

  // Un volume : anneaux (exterieur puis cours), hauteur du dessus, et du dessous (0 : pose au sol).
  const add = (rings: number[][], top: number, base: number) => {
    const h = unorm(top / HEIGHT_RANGE_M);
    const clipped = rings.map((ring) => clipRing(ring, size));
    const outer = clipped[0];
    if (!outer || outer.length < 6) return;
    const kept = clipped.filter((ring) => ring.length >= 6);
    buildings++;

    let cu = 0;
    let cv = 0;
    for (let i = 0; i < outer.length; i += 2) {
      cu += outer[i]! / size;
      cv += v(outer[i + 1]!);
    }
    const building = [unorm(cu / (outer.length / 2)), unorm(cv / (outer.length / 2)), h, unorm(base / HEIGHT_RANGE_M)];

    const flat = kept.flat();
    const holes: number[] = [];
    let count = 0;
    for (const ring of kept) {
      if (count) holes.push(count);
      count += ring.length / 2;
    }
    const first = roofPoints.length / 2;
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
      if (cross < 0) roofIndex.push(first + a, first + b, first + c);
      else roofIndex.push(first + a, first + c, first + b);
    }

    kept.forEach((ring, index) => {
      // Face avant d'un mur (a, b) : (-dz, dx), a gauche de l'arete ; l'exterieur d'un anneau d'aire positive est a droite.
      const flip = ringArea(ring) > 0 !== index > 0;
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length;
        const [ax, ay, bx, by] = [ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!];
        if (onBorder(ax, ay, bx, by, size) || (ax === bx && ay === by)) continue;
        const edge = [unorm(ax / size), unorm(v(ay)), unorm(bx / size), unorm(v(by))];
        wallEdges.push(...(flip ? [edge[2]!, edge[3]!, edge[0]!, edge[1]!] : edge));
        wallBuildings.push(...building);
      }
    });
  };
  for (const feature of layer.features) {
    if (feature.type !== GEOMETRY.polygon) continue;
    for (const rings of polygons(partsOf(layer, feature))) add(rings, buildingHeight(feature), 0);
  }
  for (const deck of decks) add([deck.ring], deck.top, deck.base);

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
    trace(pen, layer, feature);
    pen.fill("nonzero");
  }
  return max;
}

/**
 * Sommets : plus grande hauteur par cellule de `cell` texels, etendue a `reach` cellules alentour.
 * Un rayon qui avance d'une cellule a la fois n'en saute ainsi aucune ; la parallaxe ne descend
 * finement que la ou un batiment peut l'arreter.
 */
export function peakMap(heights: Uint8Array, width: number, height: number, cell = PEAK_CELL, reach = 1): Uint8Array {
  return spreadPeaks(cellMaxima(heights, width, height, cell), Math.ceil(width / cell), Math.ceil(height / cell), reach);
}

/** Plus grande valeur par cellule de `cell` texels : les maximums d'une grille servent de texels a la suivante. */
export function cellMaxima(values: Uint8Array, width: number, height: number, cell: number): Uint8Array {
  const w = Math.ceil(width / cell);
  const cells = new Uint8Array(w * Math.ceil(height / cell));
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * w;
    for (let x = 0; x < width; x++) {
      const i = row + Math.floor(x / cell);
      cells[i] = Math.max(cells[i]!, values[y * width + x]!);
    }
  }
  return cells;
}

/** Chaque cellule prend le maximum de ses voisines a `reach` cellules. */
export function spreadPeaks(cells: Uint8Array, w: number, h: number, reach: number): Uint8Array {
  const peaks = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let peak = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
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

/**
 * Ombre du bati : a chaque texel, la hauteur (m) sous laquelle un point est a l'ombre des batiments vers le
 * soleil ; les shaders n'ont plus qu'a la lire, au lieu de marcher vers le soleil a chaque pixel (comme les
 * ombres cuites de Chartogne-Taillet). `toSun` : direction du soleil en texels (x vers l'est, y vers le sud),
 * `rise` : metres gagnes par le rayon par metre parcouru, `meters` : taille d'un texel (x, y), `reach` : portee
 * de l'ombre en texels (au-dela, elle s'arrete, comme celle de la parallaxe que l'on a validee).
 * Un seul balayage, depuis le cote du soleil : un texel reprend l'ombre de son voisin vers le soleil,
 * `S(p) = max(h(q), S(q)) - pas x rise`, le voisin `q` lu entre deux texels de la ligne deja faite ; la distance a
 * l'obstacle suit le meme chemin. Le voisin est au meme ecart pour toute la ligne : poids constants, et la ligne
 * precedente gardee a part, bordee de zeros (2048 x 2048 texels en quelques dizaines de ms).
 */
export function sunShadow(
  heights: Uint8Array,
  width: number,
  height: number,
  toSun: readonly [number, number],
  rise: number,
  meters: readonly [number, number],
  reach = Infinity,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const [dx, dy] = toSun;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const major = alongX ? dx : dy;
  // Soleil au zenith : aucune ombre portee.
  if (Math.abs(major) < 1e-9) return out;
  const dir = Math.sign(major);
  const minor = (alongX ? dy : dx) / Math.abs(major);
  const [stepX, stepY] = alongX ? [dir, minor] : [minor, dir];
  const drop = Math.hypot(stepX * meters[0], stepY * meters[1]) * rise;
  const step = Math.hypot(stepX, stepY);
  const [lines, span] = alongX ? [width, height] : [height, width];
  // Texel `cross` de la ligne `line` : les lignes suivent le soleil, en colonnes si elles vont d'est en ouest.
  const [lineStride, crossStride] = alongX ? [1, width] : [width, 1];
  const shift = Math.floor(minor);
  const f = minor - shift;
  // Ligne precedente : plus haut du batiment et de l'ombre qui le couvre, et distance (texels) a l'obstacle ;
  // un texel de zeros de chaque cote (`|minor|` <= 1).
  let top = new Float32Array(span + 3);
  let away = new Float32Array(span + 3);
  let nextTop = new Float32Array(span + 3);
  let nextAway = new Float32Array(span + 3);
  const first = dir > 0 ? lines - 1 : 0;
  for (let cross = 0; cross < span; cross++) top[cross + 1] = heights[first * lineStride + cross * crossStride]!;
  for (let i = 1; i < lines; i++) {
    const line = dir > 0 ? lines - 1 - i : i;
    for (let cross = 0; cross < span; cross++) {
      const low = cross + shift + 1;
      const value = top[low]! * (1 - f) + top[low + 1]! * f - drop;
      const distance = away[low]! * (1 - f) + away[low + 1]! * f + step;
      const texel = line * lineStride + cross * crossStride;
      const own = heights[texel]!;
      let shade = 0;
      if (value > 0 && distance <= reach) {
        shade = value;
        out[texel] = Math.min(255, Math.ceil(value));
      }
      // Le batiment lui-meme (a distance nulle), ou l'ombre qui le couvre deja.
      nextTop[cross + 1] = Math.max(own, shade);
      nextAway[cross + 1] = own >= shade ? 0 : distance;
    }
    [top, nextTop] = [nextTop, top];
    [away, nextAway] = [nextAway, away];
  }
  return out;
}
