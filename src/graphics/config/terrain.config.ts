import type { GeoBounds } from "@graphics/terrain/GeoProjection.ts";

export const TERRAIN_CONFIG = {
  departement: "30",
  /** Emprise du Gard (contour ADMIN EXPRESS, EPSG:4326). */
  bounds: { west: 3.2624, south: 43.4603, east: 4.8456, north: 44.4597 } satisfies GeoBounds,
  rootZoom: 9,
  maxZoom: 13,
  /** Subdivise sous ce rapport distance / taille de tuile, fusionne au-dessus de `merge`. */
  split: 1.5,
  merge: 3,
  maxVisible: 300,
  segments: 32,
  maskSize: 1024,
} as const;
