/** Anneau de contour : une suite de points (longitude, latitude). */
export type Ring = [number, number][];

/** km par degre de latitude. */
export const KM_PER_DEGREE = 111.32;

export interface RingGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
}

/** Anneaux exterieurs d'un Polygon ou MultiPolygon GeoJSON : les trous sont ignores, un aplat de survol n'en a pas besoin. */
export function ringsOfGeometry(geometry: RingGeometry | undefined): Ring[] {
  if (!geometry) return [];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : (geometry.coordinates as number[][][][]);
  return polygons.flatMap((polygon) => (polygon[0] ? [polygon[0] as Ring] : []));
}

/** Le point (lon, lat) est-il dans l'un des anneaux ? Pair-impair : un contour non ferme se lit comme ferme. */
export function ringsContain(rings: Ring[], lon: number, lat: number): boolean {
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

/**
 * Distance (km) du point au bord le plus proche des anneaux, en plate carree a l'echelle du point : juste a
 * l'echelle d'un territoire, ce qui suffit a dire si l'on en est tout pres.
 */
export function distanceToRingsKm(rings: Ring[], lon: number, lat: number): number {
  const kx = KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j]![0] - lon) * kx;
      const ay = (ring[j]![1] - lat) * KM_PER_DEGREE;
      const bx = (ring[i]![0] - lon) * kx;
      const by = (ring[i]![1] - lat) * KM_PER_DEGREE;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / Math.max(dx * dx + dy * dy, 1e-12)));
      best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
    }
  }
  return best;
}

/** Cadre en degres des anneaux : un premier tri, avant le test du contour. */
export function ringsBounds(rings: Ring[]): { west: number; east: number; south: number; north: number } {
  const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      b.west = Math.min(b.west, lon);
      b.east = Math.max(b.east, lon);
      b.south = Math.min(b.south, lat);
      b.north = Math.max(b.north, lat);
    }
  return b;
}
