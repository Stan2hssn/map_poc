export const TERRAIN_CONFIG = {
  /** Depart : mont Aigoual. */
  center: { lon: 3.581, lat: 44.121 },
  /** Couverture du SRTM, source hors de France. */
  centerBounds: { west: -179, east: 179, south: -56, north: 60 },
  /** Largeur couverte par le bloc, reglee a la molette. */
  extentKm: 40,
  minExtentKm: 2,
  /** Temps de reponse (ms) de la vue aux gestes : elle rattrape la vue visee, comme la camera de Chartogne-Taillet (~250 ms). */
  easeMs: 250,
  /**
   * Vue la plus large : au-dela, la zone dessinee sortirait des donnees de relief (couverture SRTM, voir
   * `centerBounds`) et on verrait ou la carte s'arrete.
   */
  maxExtentKm: 12000,
  /** Largeur a laquelle l'exageration s'applique telle quelle (voir `TerrainNode.heightScale`). */
  referenceExtentKm: 40,
  maxZoom: 14,
  /** Taille de la zone de detail dans la scene ; le sol s'etend sur `groundSpan` fois cette taille. */
  blockSize: 100,
  groundSpan: 3,
  /** Plafond du relief affiche : les massifs ne deviennent pas des aiguilles. */
  maxRelief: 25,
  /**
   * Subdivisions de la grille de l'ecran. Au-dela de ~256, les triangles tombent sous quelques pixels :
   * le GPU ombre par blocs de 2 x 2, et le shader du sol (parallaxe) tourne 2 a 4 fois par pixel.
   */
  segments: 256,
  segmentOptions: [256, 512, 1024, 1536],
  /** Tuiles d'altitude gardees (256 Ko chacune) : de quoi revenir en arriere sans tout recharger. */
  cacheTiles: 320,
  /** Prechargement autour du bloc (fraction de sa largeur, de chaque cote) : niveau affiche, puis apercu plus large. */
  margin: 0.25,
  coarse: { levels: 3, margin: 1 },
  /**
   * Zone dessinee, a la Chartogne-Taillet : ellipse posee sur la carte, centree sur le point que vise la camera
   * (unites de scene), largeur en travers de la vue et profondeur le long ; elle suit ce point et la rotation de la
   * vue, pas les petits mouvements de la camera (souris, roulis). Bord fondu sur `softness` du rayon, rendu
   * irregulier par un bruit accroche a la carte, d'amplitude `jitter`. En vue large, elle s'agrandit jusqu'a
   * `widen.scale` fois (de `fromKm` a `toKm` de largeur de vue, en echelle logarithmique) : a l'echelle d'une
   * region ou du pays, une petite zone ne laisserait rien voir. Jamais au-dela de `reach` (unites de scene) :
   * le sol s'arrete un peu plus loin, et on ne doit pas voir ou il s'arrete.
   */
  mask: { radius: [95, 95], softness: 0.6, jitter: 0.12, widen: { fromKm: 4, toKm: 600, scale: 3 }, reach: 95 },
} as const;
