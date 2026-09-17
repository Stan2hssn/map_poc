export const TERRAIN_CONFIG = {
  /** Centre de depart : le Gard. */
  center: { lon: 4.054, lat: 43.96 },
  /** Le centre reste en France metropolitaine. */
  centerBounds: { west: -5.2, east: 9.6, south: 41.3, north: 51.1 },
  sizeKm: 130,
  /**
   * Deux couches d'altitudes : un apercu large (niveau 7, ~600 m), rechargé rarement,
   * et le detail autour du bloc (niveau 10, ~76 m). `margin` : marge chargee de chaque cote,
   * en fraction de la taille du bloc.
   */
  coarse: { zoom: 7, margin: 1.5 },
  fine: { zoom: 10, margin: 0.1 },
  segments: 1024,
  segmentOptions: [256, 512, 1024, 1536],
  baseDepthKm: 4,
} as const;
