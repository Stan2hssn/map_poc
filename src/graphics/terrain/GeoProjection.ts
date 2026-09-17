export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

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

/** Projection plate locale en km : x vers l'est, z vers le sud. Ecart < 1 % sur un departement. */
export class GeoProjection {
  readonly lon0: number;
  readonly lat0: number;
  private readonly _kx: number;
  private readonly _kz = EARTH_RADIUS_KM * RAD;

  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this._kx = EARTH_RADIUS_KM * RAD * Math.cos(lat0 * RAD);
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

  /** Carre de `sizeKm` de cote centre sur l'origine. */
  squareBounds(sizeKm: number): GeoBounds {
    const half = sizeKm / 2;
    return { west: this.lon(-half), east: this.lon(half), north: this.lat(-half), south: this.lat(half) };
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

export function tilesCovering(z: number, b: GeoBounds): { x: number; y: number }[] {
  const span = tileSpan(z);
  const tiles: { x: number; y: number }[] = [];
  for (let y = Math.floor((90 - b.north) / span); y <= Math.floor((90 - b.south) / span); y++) {
    for (let x = Math.floor((b.west + 180) / span); x <= Math.floor((b.east + 180) / span); x++) {
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
