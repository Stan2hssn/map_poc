export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
export const KM_PER_DEGREE = EARTH_RADIUS_KM * RAD;
/** Largeur du monde a l'equateur, et hauteur pole a pole. */
export const WORLD_WIDTH_KM = 360 * KM_PER_DEGREE;
export const WORLD_HEIGHT_KM = 180 * KM_PER_DEGREE;

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface SceneRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Projection plate carree en km, echelle juste au centre : x vers l'est, z vers le sud. */
export class GeoProjection {
  readonly lon0: number;
  readonly lat0: number;
  private readonly _kx: number;
  private readonly _kz = KM_PER_DEGREE;

  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this._kx = KM_PER_DEGREE * Math.cos(lat0 * RAD);
  }

  x(lon: number): number {
    return (lon - this.lon0) * this._kx;
  }

  z(lat: number): number {
    return (this.lat0 - lat) * this._kz;
  }

  lon(x: number): number {
    return this.lon0 + x / this._kx;
  }

  lat(z: number): number {
    return this.lat0 - z / this._kz;
  }

  /** Rectangle centre sur l'origine, borne au monde. */
  bounds(widthKm: number, heightKm = widthKm): GeoBounds {
    const w = widthKm / 2;
    const h = heightKm / 2;
    return {
      west: Math.max(-180, this.lon(-w)),
      east: Math.min(180, this.lon(w)),
      north: Math.min(90, this.lat(-h)),
      south: Math.max(-90, this.lat(h)),
    };
  }

  rect(b: GeoBounds): SceneRect {
    return { minX: this.x(b.west), maxX: this.x(b.east), minZ: this.z(b.north), maxZ: this.z(b.south) };
  }
}

/** Grille WGS84G de l'IGN : origine (-180, 90), 2^(z+1) colonnes, 2^z lignes. */
export function tileSpan(z: number): number {
  return 180 / 2 ** z;
}

export function tileBounds(z: number, x: number, y: number): GeoBounds {
  const span = tileSpan(z);
  const west = -180 + x * span;
  const north = 90 - y * span;
  return { west, east: west + span, north, south: north - span };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Centre ramene pour que le rectangle reste dans `limits` et dans le monde. */
export function clampCenter(lon: number, lat: number, widthKm: number, heightKm: number, limits: GeoBounds) {
  const halfLat = heightKm / 2 / KM_PER_DEGREE;
  const clampedLat = clamp(lat, Math.max(limits.south, halfLat - 90), Math.min(limits.north, 90 - halfLat));
  const halfLon = widthKm / 2 / (KM_PER_DEGREE * Math.cos(clampedLat * RAD));
  const clampedLon = halfLon >= 180 ? 0 : clamp(lon, Math.max(limits.west, halfLon - 180), Math.min(limits.east, 180 - halfLon));
  return { lon: clampedLon, lat: clampedLat };
}

export function tilesCovering(z: number, b: GeoBounds): { x: number; y: number }[] {
  const span = tileSpan(z);
  const tiles: { x: number; y: number }[] = [];
  const row = (lat: number) => clamp(Math.floor((90 - lat) / span), 0, 2 ** z - 1);
  const col = (lon: number) => clamp(Math.floor((lon + 180) / span), 0, 2 ** (z + 1) - 1);
  for (let y = row(b.north); y <= row(b.south); y++) {
    for (let x = col(b.west); x <= col(b.east); x++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Emprise elargie de `fraction` de sa taille de chaque cote. */
export function expandBounds(b: GeoBounds, fraction: number): GeoBounds {
  const dx = (b.east - b.west) * fraction;
  const dy = (b.north - b.south) * fraction;
  return { west: b.west - dx, east: b.east + dx, south: b.south - dy, north: b.north + dy };
}

export function containsBounds(outer: GeoBounds, inner: GeoBounds): boolean {
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}

export function containsPoint(b: GeoBounds, lon: number, lat: number): boolean {
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

export function intersectsBounds(a: GeoBounds, b: GeoBounds): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}
