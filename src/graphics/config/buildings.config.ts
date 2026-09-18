export const BUILDINGS_CONFIG = {
  /** Largeur de vue (km) sous laquelle le bati se leve, et ou il est entier : au-dela, un immeuble fait moins de 2 px. */
  maxExtentKm: 8,
  fullExtentKm: 5,
  /** Tuiles de volumes autour de la vue (fraction de sa largeur, de chaque cote) : couvre le trapeze visible. */
  margin: 0.25,
  /** Tuiles de volumes gardees en memoire. */
  cacheTiles: 400,
} as const;
