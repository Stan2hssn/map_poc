import { WORLD_WIDTH_KM } from "@graphics/terrain/GeoProjection.ts";

export const TERRAIN_CONFIG = {
  /** Depart : mont Aigoual. */
  center: { lon: 3.581, lat: 44.121 },
  /** Couverture du SRTM, source hors de France. */
  centerBounds: { west: -179, east: 179, south: -56, north: 60 },
  /** Largeur couverte par le bloc, reglee a la molette. */
  extentKm: 40,
  minExtentKm: 2,
  maxExtentKm: WORLD_WIDTH_KM,
  /** Largeur a laquelle l'exageration s'applique telle quelle (voir `TerrainNode.heightScale`). */
  referenceExtentKm: 40,
  maxZoom: 14,
  /** Taille de la zone de detail dans la scene ; le sol s'etend sur `groundSpan` fois cette taille. */
  blockSize: 100,
  groundSpan: 3,
  /** Plafond du relief affiche : les massifs ne deviennent pas des aiguilles. */
  maxRelief: 25,
  segments: 1024,
  segmentOptions: [256, 512, 1024, 1536],
  /** Tuiles d'altitude gardees (256 Ko chacune) : de quoi revenir en arriere sans tout recharger. */
  cacheTiles: 320,
  /** Prechargement autour du bloc (fraction de sa largeur, de chaque cote) : niveau affiche, puis apercu plus large. */
  margin: 0.25,
  coarse: { levels: 3, margin: 1 },
  /**
   * Zone dessinee, a la Chartogne-Taillet : disque centre sous la camera (unites de scene), decale de
   * `shift` vers la vue ; tout le premier plan est dessine et la carte s'efface vers le lointain.
   * Bord fondu sur `softness` du rayon, rendu irregulier par un bruit d'amplitude `jitter`.
   */
  mask: { radius: [190, 190], shift: 0, softness: 0.45, jitter: 0.12 },
} as const;
