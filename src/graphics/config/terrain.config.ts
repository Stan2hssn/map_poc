export const TERRAIN_CONFIG = {
  /** Centre du Gard. */
  center: { lon: 4.054, lat: 43.96 },
  sizeKm: 130,
  /** Niveaux IGN charges l'un apres l'autre : apercu rapide, puis detail (~76 m au niveau 10). */
  zooms: [8, 10],
  segments: 1024,
  segmentOptions: [256, 512, 1024, 1536],
  baseDepthKm: 4,
} as const;
