import { latitudeV, tileMeters, type TileXY } from "./Landcover.ts";
import { GEOMETRY, partsOf, surfaceContains, surfaceOf, type VectorFeature, type VectorLayer } from "./VectorTile.ts";

/**
 * Circulation d'une tuile : routes (voitures) et rivieres (bateaux) du PLAN IGN decoupees a la tuile, en voies
 * (polylignes en (u, v), v lineaire en latitude comme le bati), parcourues en boucle.
 */
export interface TileRoads {
  /** (u, v) de chaque point. */
  points: Float32Array;
  /** Par voie (`LANE_STRIDE`) : premier point, nombre de points, vitesse (m/s), sens, voitures. */
  lanes: Float32Array;
  /** Largeur de la tuile (m) : de l'ecart en (u, v) a la distance. */
  meters: number;
}

export const LANE_STRIDE = 5;
/** Sens de circulation : dans le sens du trace, a l'inverse, ou les deux. */
const DIRECTION: Record<string, number> = {
  "Sens direct": 1,
  "Sens inverse": -1,
};
/** Par classe de route : vitesse (m/s) et voitures par km ; les voies restreintes et non revetues n'en ont pas. */
const TRAFFIC: [RegExp, number, number][] = [
  [/^AUTOROU/, 30, 15],
  [/^REGIONALE/, 13, 10],
  [/^LOCALE/, 10, 4],
];
/** Routes et ponts (routes sur ouvrage) parcourus. */
const ROAD_LAYERS = ["routier_route", "routier_route_sup"];
/**
 * Bateaux : le PLAN IGN n'a pas l'axe des grands cours d'eau, mais la ligne de leur nom le suit ; gardee si elle
 * passe sur l'eau (fleuve large), pas le long d'un ruisseau. Vitesse (m/s) et bateaux par km.
 */
const BOATS = { layer: "toponyme_hydro_lin", speed: 4, perKm: 3 };
/** Au bout de sa voie, une voiture rapetit puis reparait au debut sur cette distance (m) : ni saut ni coupure. */
const FADE_M = 20;

/** Segment (a, b) garde dans le carre [0, size] (Liang-Barsky) : parametres d'entree et de sortie, ou null. */
function clipSegment(ax: number, ay: number, bx: number, by: number, size: number): [number, number] | null {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [
    [-dx, ax],
    [dx, size - ax],
    [-dy, ay],
    [dy, size - ay],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

interface LaneKind {
  speed: number;
  perKm: number;
  direction: number;
}

export function roadLanes(layers: Map<string, VectorLayer>, z: number, tile: TileXY): TileRoads {
  return lanesOf(layers, z, tile, ROAD_LAYERS, (feature) => {
    const kind = TRAFFIC.find(([pattern]) => pattern.test(String(feature.properties.symbo ?? "")));
    return kind ? { speed: kind[1], perKm: kind[2], direction: DIRECTION[String(feature.properties.sens_circu)] ?? 0 } : null;
  });
}

export function boatLanes(layers: Map<string, VectorLayer>, z: number, tile: TileXY): TileRoads {
  const water = layers.get("hydro_surf");
  const surfaces = (water?.features ?? []).filter((f) => f.type === GEOMETRY.polygon).map((f) => surfaceOf(water!, f));
  // Milieu du segment du milieu : sur l'eau, ou non.
  const onWater = (line: number[]) => {
    const k = Math.floor((line.length / 2 - 1) / 2) * 2;
    const [x, y] = [(line[k]! + line[k + 2]!) / 2, (line[k + 1]! + line[k + 3]!) / 2];
    return surfaces.some((surface) => surfaceContains(surface, x, y));
  };
  return lanesOf(layers, z, tile, [BOATS.layer], (feature, layer) =>
    partsOf(layer, feature).some(onWater) ? { speed: BOATS.speed, perKm: BOATS.perKm, direction: 0 } : null
  );
}

/** Voies des lignes de `names`, du genre que `kindOf` leur donne (null : aucune), coupees au bord de la tuile. */
function lanesOf(
  layers: Map<string, VectorLayer>,
  z: number,
  tile: TileXY,
  names: string[],
  kindOf: (feature: VectorFeature, layer: VectorLayer) => LaneKind | null
): TileRoads {
  const extent = names.map((name) => layers.get(name)?.extent).find(Boolean) ?? 4096;
  const v = latitudeV(z, tile, extent);
  const meters = tileMeters(z, tile);
  const points: number[] = [];
  const lanes: number[] = [];
  const close = (start: number, speed: number, direction: number, perKm: number) => {
    const count = points.length / 2 - start;
    if (count < 2) {
      points.length = start * 2;
      return;
    }
    let length = 0;
    for (let i = start + 1; i < start + count; i++)
      length += Math.hypot(points[2 * i]! - points[2 * i - 2]!, points[2 * i + 1]! - points[2 * i - 1]!);
    lanes.push(start, count, speed, direction, Math.floor(((length * meters) / 1000) * perKm));
  };
  for (const layer of names.map((name) => layers.get(name))) {
    for (const feature of layer?.features ?? []) {
      if (feature.type !== GEOMETRY.line) continue;
      const kind = kindOf(feature, layer!);
      if (!kind) continue;
      const { speed, perKm, direction } = kind;
      for (const line of partsOf(layer!, feature)) {
        let start = -1;
        for (let i = 2; i < line.length; i += 2) {
          const [ax, ay, bx, by] = [line[i - 2]!, line[i - 1]!, line[i]!, line[i + 1]!];
          const kept = clipSegment(ax, ay, bx, by, extent);
          const add = (t: number) => points.push((ax + (bx - ax) * t) / extent, v(ay + (by - ay) * t));
          if (!kept) {
            if (start >= 0) close(start, speed, direction, perKm);
            start = -1;
            continue;
          }
          if (start < 0) {
            start = points.length / 2;
            add(kept[0]);
          }
          add(kept[1]);
          // Sortie de la tuile au milieu du segment : la voie s'arrete la.
          if (kept[1] < 1) {
            close(start, speed, direction, perKm);
            start = -1;
          }
        }
        if (start >= 0) close(start, speed, direction, perKm);
      }
    }
  }
  return {
    points: Float32Array.from(points),
    lanes: Float32Array.from(lanes),
    meters,
  };
}

/**
 * Voitures d'une tuile, en boucle sur leurs voies : `step` les avance, `write` pose pour chacune (u, v) et sa
 * direction (du, dv) dans un tableau d'instances. Deux sens sur les routes a double sens.
 */
export class Traffic {
  readonly count: number;
  private readonly _points: Float32Array;
  /** Distance (m) de chaque point depuis le debut de sa voie. */
  private readonly _along: Float32Array;
  private readonly _lane: Uint32Array;
  private readonly _distance: Float32Array;
  /** Vitesse signee (m/s) : negative a contresens du trace. */
  private readonly _speed: Float32Array;
  /** Segment courant de chaque voiture : la recherche repart de lui. */
  private readonly _segment: Uint32Array;
  private readonly _lanes: Float32Array;

  constructor({ points, lanes, meters }: TileRoads, seed = 1) {
    this._points = points;
    this._lanes = lanes;
    this._along = new Float32Array(points.length / 2);
    let cars = 0;
    for (let l = 0; l < lanes.length; l += LANE_STRIDE) {
      const [start, count] = [lanes[l]!, lanes[l + 1]!];
      for (let i = start + 1; i < start + count; i++) {
        this._along[i] =
          this._along[i - 1]! + Math.hypot(points[2 * i]! - points[2 * i - 2]!, points[2 * i + 1]! - points[2 * i - 1]!) * meters;
      }
      cars += lanes[l + 4]!;
    }
    this.count = cars;
    this._lane = new Uint32Array(cars);
    this._distance = new Float32Array(cars);
    this._speed = new Float32Array(cars);
    this._segment = new Uint32Array(cars);
    let random = seed;
    const next = () => (random = (random * 16807) % 2147483647) / 2147483647;
    let car = 0;
    for (let l = 0; l < lanes.length; l += LANE_STRIDE) {
      const [start, count, speed, direction, n] = [lanes[l]!, lanes[l + 1]!, lanes[l + 2]!, lanes[l + 3]!, lanes[l + 4]!];
      const length = this._along[start + count - 1]!;
      for (let k = 0; k < n; k++, car++) {
        this._lane[car] = l;
        this._distance[car] = next() * length;
        const way = direction || (k % 2 ? 1 : -1);
        this._speed[car] = way * speed * (0.75 + 0.5 * next());
        this._segment[car] = start;
      }
    }
  }

  /** Avance de `dt` secondes. */
  step(dt: number): void {
    for (let car = 0; car < this.count; car++) {
      const l = this._lane[car]!;
      const [start, count] = [this._lanes[l]!, this._lanes[l + 1]!];
      const length = this._along[start + count - 1]!;
      let d = this._distance[car]! + this._speed[car]! * dt;
      d -= Math.floor(d / length) * length;
      this._distance[car] = d;
      let s = this._segment[car]!;
      while (s > start && this._along[s]! > d) s--;
      while (s < start + count - 2 && this._along[s + 1]! < d) s++;
      this._segment[car] = s;
    }
  }

  /**
   * (u, v, du, dv) de chaque voiture dans `into` : direction en (u, v) dans son sens de marche, de longueur sa
   * taille (1, moins aux bouts de sa voie).
   */
  write(into: Float32Array): void {
    const p = this._points;
    for (let car = 0; car < this.count; car++) {
      const s = this._segment[car]!;
      const [a, b] = [this._along[s]!, this._along[s + 1]!];
      const d = this._distance[car]!;
      const t = b > a ? (d - a) / (b - a) : 0;
      const l = this._lane[car]!;
      const length = this._along[this._lanes[l]! + this._lanes[l + 1]! - 1]!;
      const size = Math.min(1, d / FADE_M, (length - d) / FADE_M);
      const [du, dv] = [p[2 * s + 2]! - p[2 * s]!, p[2 * s + 3]! - p[2 * s + 1]!];
      const norm = ((Math.hypot(du, dv) || 1) * Math.sign(this._speed[car]!)) / Math.max(size, 1e-3);
      const i = car * 4;
      into[i] = p[2 * s]! + du * t;
      into[i + 1] = p[2 * s + 1]! + dv * t;
      into[i + 2] = du / norm;
      into[i + 3] = dv / norm;
    }
  }
}
