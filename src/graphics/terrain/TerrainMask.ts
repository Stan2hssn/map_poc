import type { GeoProjection, SceneRect } from "./GeoProjection.ts";

/** Anneau [lon, lat]. Un polygone = anneau exterieur puis trous. */
export type Ring = [number, number][];

export interface MaskGrid {
  data: Uint8Array;
  width: number;
  height: number;
  rect: SceneRect;
}

export async function fetchIgnContour(codeInsee: string): Promise<Ring[][]> {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "ADMINEXPRESS-COG-CARTO.LATEST:departement",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    PROPERTYNAME: "code_insee,geometrie",
    CQL_FILTER: `code_insee='${codeInsee}'`,
  });
  const response = await fetch(`https://data.geopf.fr/wfs/ows?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const geometry = (await response.json()).features?.[0]?.geometry;
  if (!geometry) throw new Error(`departement ${codeInsee} introuvable`);
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

/** Rasterisation pair-impair au centre de chaque pixel ; 255 dedans, ligne 0 au nord. */
export function rasterizeMask(polygons: Ring[][], projection: GeoProjection, rect: SceneRect, maxSize: number): MaskGrid {
  const spanX = rect.maxX - rect.minX;
  const spanZ = rect.maxZ - rect.minZ;
  const scale = maxSize / Math.max(spanX, spanZ);
  const width = Math.max(1, Math.round(spanX * scale));
  const height = Math.max(1, Math.round(spanZ * scale));
  const data = new Uint8Array(width * height);

  const rings = polygons.flat().map((ring) =>
    ring.map(([lon, lat]) => [
      ((projection.x(lon) - rect.minX) / spanX) * width,
      ((projection.z(lat) - rect.minZ) / spanZ) * height,
    ])
  );

  const crossings: number[] = [];
  for (let row = 0; row < height; row++) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      data.fill(255, row * width + from, row * width + to + 1);
    }
  }
  return { data, width, height, rect };
}

/** Vrai si un pixel du masque tombe dans le rectangle. */
export function maskCovers({ data, width, height, rect }: MaskGrid, r: SceneRect): boolean {
  const col = (x: number) => ((x - rect.minX) / (rect.maxX - rect.minX)) * width;
  const row = (z: number) => ((z - rect.minZ) / (rect.maxZ - rect.minZ)) * height;
  const c0 = Math.max(0, Math.floor(col(r.minX)));
  const c1 = Math.min(width - 1, Math.max(c0, Math.ceil(col(r.maxX)) - 1));
  const r0 = Math.max(0, Math.floor(row(r.minZ)));
  const r1 = Math.min(height - 1, Math.max(r0, Math.ceil(row(r.maxZ)) - 1));
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      if (data[y * width + x]) return true;
    }
  }
  return false;
}
