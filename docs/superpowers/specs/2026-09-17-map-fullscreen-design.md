# Carte plein écran — conception

Branche `feat/map-fullscreen`, partie de `feat/terrain-gard` (bloc de relief, relevés flottants).

## Intention

La carte couvre tout l'écran, la caméra bouge comme dans le boilerplate (parallaxe à la souris), et la navigation se rapproche de [Chartogne-Taillet](https://chartogne-taillet.com). D'après l'[étude de cas d'Immersive Garden](https://medium.com/@hello_11138/chartogne-taillet-experience-site-case-study-53431d5f75f7) :
- carte plein écran, sol qui s'efface vers les bords ;
- exploration au glisser ;
- survol qui met une parcelle en évidence ;
- clic sur un nom qui lance un zoom animé.

Le site lui-même n'a pas été ouvert au-delà de sa page de certification d'âge.

## Choix

- **Sol** (`terrain/GroundGeometry.ts`) :
  - grille unique trois fois plus large que la zone de détail (`groundSpan`), en uv du bloc (−1 à 2) ;
  - 1024 × 1024 segments, resserrés au centre (pente 1/3, même densité qu'avant au centre, relâchés vers les bords).
- **Altitudes** : le détail couvre la zone centrale, l'aperçu tout le sol (marge de 1 largeur). Le niveau de l'aperçu suit le centre de la vue ; la périphérie se complète depuis les parents.
- **Fondu** (`groundFade`) :
  - le sol s'éteint entre 70 et 145 unités du centre, et au-delà du monde en vue mondiale ;
  - appliqué sur la couleur finale, au carré (sinon le passage en sRGB l'atténue beaucoup) ;
  - les lignes et points drapés s'effacent de même.
  - `scene.fogNode` n'a rien donné avec un facteur fondé sur `positionWorld` ; non creusé.
- **Caméra** (`MapCamera.node.ts`) :
  - fixe, nord en haut, inclinaison 50°, focale 32° ;
  - la zone de détail remplit la largeur de l'écran ;
  - parallaxe comme le boilerplate : décalage jusqu'à 6 % (x) et 3,5 % (y) de la distance, lissé sur 350 ms ;
  - plus de rotation ; la caméra orbitale de debug (Shift+C) reste.
- **Glisser** : le point saisi suit le pointeur. Au relâcher, la vitesse des 90 dernières ms lance le terrain, qui freine sur 380 ms. Molette et pincement zooment, comme avant.
- **Villes** (`Labels.node.ts`) :
  - jusqu'à 7 par vue, dans la partie nette du sol (70 unités) ;
  - lignes de 90 à 218 px sur trois étages alternés ;
  - le nom est cliquable et lance un vol vers la ville, en divisant la largeur par 4, sans descendre sous 8 km ;
  - au survol, le point grossit et la ligne s'éclaire.
- **Relevés** : graticule drapée et croisements sur tout le sol, coordonnées sur les bords nord et ouest de la zone de détail.
- **Ombres** : le cadre du soleil couvre ±150 unités.
- **Metal** : `smoothstep` ne tolère pas des bornes inversées (résultat indéfini). Toutes les formes « décroissantes » passent par `oneMinus`.

## Mesures

Canvas 1564 × 1726, WebGPU, boucle arrêtée :
- image au repos : 4,2 ms ;
- vols vers la France et le monde : pics de 22 et 15 ms ;
- parallaxe, lancer, clic sur une ville et raccourcis vérifiés.

## Limites

- **Vue mondiale** : le monde est une bande 2:1 au milieu du noir, pas un sol qui remplit l'écran.
- **Éléments pas encore faits** : la parcelle survolée n'est pas teintée sur le relief (seule l'étiquette réagit), et il n'y a ni curseur personnalisé ni mini-carte.
- **`terrain/BlockGeometry.ts`** : plus utilisé sur cette branche, conservé en attendant une décision.

## Grille projetée (2026-09-18)

Le sol n'est plus une grille posée au sol et cadrée par la caméra. C'est une **grille de l'écran** (`terrain/GroundGeometry.ts`, coordonnées 0 à 1 avec marges : 30 % sous l'écran pour le relief qui se soulève, 4 % sur les côtés pour la parallaxe).

- Le shader projette chaque sommet sur le sol depuis la caméra principale : un rayon par sommet, arrêté à 320 unités.
- Les matrices de cette caméra passent en uniforms, pour que la passe d'ombre projette la même grille.
- Toutes les subdivisions servent l'image : 1024 × 1024 sommets pour environ 1560 × 1730 pixels. C'est le terrain qui défile et zoome dessous.
- La transformation « uv de la zone de détail → scène », dont se servent les relevés, est portée par un groupe à part (`TerrainNode.block`) ; le maillage n'a plus de transformation.

## Texture de données (2026-09-18)

Comme Chartogne-Taillet (routes, champs et ombres rangés dans les canaux de textures), mais depuis des données réelles.

- **Source** : PLAN IGN en tuiles vectorielles (`data.geopf.fr/tms/1.0.0/PLAN.IGN`, Web Mercator, z0 à z18, CORS ouvert). Couches `bati_surf` (avec hauteur et nature : église, mairie…), `ocs_vegetation_surf`, `hydro_surf` et `hydro_reseau`, `routier_route`, `routier_chemin` et `routier_surf`.
- **Décodage** : `terrain/VectorTile.ts`, sans dépendance. Il ne lit que le protobuf utile.
- **Dessin** (`terrain/Landcover.ts`, `terrain/Landcover.worker.ts`, dans un Web Worker) :
  - une image 2048 × 2048 en lon/lat, alignée sur le relief, couvrant 2,5 fois la zone de détail ;
  - R bâti, G végétation, B eau (additionnés sur fond noir, pour que l'anticrénelage reste une valeur), A routes, à leur largeur réelle selon leur classe ;
  - deux niveaux : l'ensemble, puis deux niveaux plus fins au centre (le PLAN IGN ne garde tout le bâti qu'à partir du z14-15) ;
  - les tuiles décodées sont gardées, et une image partielle part toutes les 200 ms pendant le chargement.
- **Rendu** (`drawLandcover` dans `Terrain.material.ts`), façon carte imprimée :
  - végétation hachurée en diagonale, eau en traits horizontaux ;
  - routes en réserve de papier, bâti en aplat d'encre bleue cerné plus foncé ;
  - bords nets à toute échelle grâce à `fwidth` ;
  - hachures accrochées au sol, fondues entre deux échelles comme la brume ;
  - réglage `donnees`.
- **Brume** : coupée sur les vues plates (relief < 80 m), sinon elle voilait toute la ville.
- **Mesures** (Paris à 5 km, 1564 × 1730) : image au repos 4,8 ms ; pendant un glisser, 95e centile 8 ms, pic 11,6 ms à l'arrivée d'une image. Repli WebGL2 identique.
- **Limites** :
  - une lisière reste visible au loin, entre le niveau fin et le niveau d'ensemble ;
  - pas d'attribution IGN à l'écran (Licence Ouverte Etalab 2.0 : à ajouter) ;
  - une tuile en erreur n'est pas retentée.

## Élévations : bâti en relief (2026-09-18)

Le bâti du PLAN IGN (`bati_surf`, hauteur renseignée pour 92 % des bâtiments à Paris, médiane 18 m) se lève sous 8 km de largeur de vue, entier sous 5 km. Rendu en argile (`CLAY`), creux au pied des murs, ombres douces. Deux techniques, au choix dans le panneau (`?debug`, dossier « Elevations »), mesurées au même endroit.

- **Parallaxe** (par défaut) : dans le shader du sol, sans un sommet de plus.
  - Le worker dessine les hauteurs (m, R8, 2048², sur la zone fine) et une carte des sommets par cellule de 16 texels, étendue aux cellules voisines (`peakMap`).
  - Le rayon qui touche le sol est remonté à la hauteur du plus haut bâtiment, puis redescendu : d'abord une cellule par pas jusqu'à la première qui peut l'arrêter, puis un texel par pas (48 au plus).
  - Mur ou toit selon que la hauteur a monté plus vite que le rayon n'est descendu ; normale des murs par la pente des hauteurs.
  - Ombres marchées vers le soleil, jusqu'au sommet des cellules voisines (celles des tours isolées s'arrêtent là).
- **Extrusion** : volumes par tuile z15-16, construits une fois dans le worker (`buildTileMesh`).
  - Toits triangulés (Earcut de three, cours comprises), murs en quadrilatères instanciés, un par arête, orientés vers l'extérieur ; les arêtes de coupure de tuile n'ont pas de mur.
  - Attributs en entiers 16 bits normalisés : 8 Mo pour 21 000 bâtiments, 50 Mo pour 110 000.
  - Placés par un uniform par tuile, assis sur le relief affiché (lu dans le shader), jamais reconstruits au mouvement. Ombres par la carte d'ombres.
- **Panneau** : technique, hauteur, fps, temps GPU (timestamps, activés par `?debug` ou `?stats`), appels de dessin, triangles, sommets du sol et du bâti, bâtiments, tuiles, mémoire.
- **Mesures** (Paris, image 2800 × 1720, temps GPU médian par image) :

| Vue | Aucune | Parallaxe | Extrusion |
|---|---|---|---|
| 2 km | 8,0 ms | 24,5 ms | 6,7 ms (1,0 M sommets, 291 dessins) |
| 5 km | 8,3 ms | 22 ms | 12,3 ms (5,1 M sommets, 447 dessins) |

  Avant le saut par cellules, la parallaxe coûtait 46 ms : 255 m à descendre partout pour quelques tours.
  L'extrusion coûte moins que rien à 2 km : les toits cachent le shader du sol, plus lourd qu'eux.
- **Limites de la parallaxe** : coût proportionnel aux pixels (écrans denses), arêtes en escalier au texel, ombres courtes, pas d'objet par bâtiment. Repli WebGL2 identique pour les deux techniques.

## Masque de dessin (2026-09-18)

Comme Chartogne-Taillet, la carte n'est dessinée qu'autour de la vue : une ellipse en unités de scène (`TERRAIN_CONFIG.mask`), au bord fondu, irrégulier (bruit) et qui respire lentement (`drawnMask`). Dedans, l'encre du PLAN IGN et le bâti ; dehors, le relief nu. Les bâtiments se lèvent en y entrant (hauteur × masque, parallaxe comprise).

Il sert aussi la performance : tuiles de volumes hors masque non dessinées, parallaxe sautée. À Paris à 5 km (2800 × 1720) : extrusion 110 → 57 tuiles, 5,1 → 3,1 M sommets, surcoût 4 → 1,2 ms ; parallaxe, surcoût 14 → 5,3 ms. Réglages `masque *` dans le panneau.

## Dessin à l'encre (2026-09-18)

D'après `refs/` (plume, trame, encre qui bave) et la direction artistique du README (papier, bleu d'encre, trames, photocopie). Une passe plein écran, pas un dessin par bâtiment : `InkEffect` (`postprocessing/effects/Ink.effect.ts`).

- **Entrées** : l'image argile, et normales et profondeur de la scène (`EffectComposer` avec `normalDepth`, normales écrites par `mrt` dans la même passe).
- **Contours** : sauts de profondeur (silhouettes) et d'orientation (arêtes), sans doubler les hachures du sol.
- **Tons** (luminance perçue) : papier dans les clairs, hachures à 45° croisées dans les noirs (ou trame de points, réglage `points / plume`), encre pleine sous `ton encre`.
- **Main et impression** : trait qui tremble, encre qui bave par taches, grain du papier, encre jamais tout à fait pleine.
- **Hachures des murs** : verticales, accrochées aux murs (`penLines`, deux échelles fondues au zoom), d'autant plus épaisses que le mur est à l'ombre.
- **Lumière douce** : ciel (`ambiance`) et rebond du sol (`rebond`), pour que les faces à l'ombre restent hachurées plutôt que noires.
- **Papier** : le sol s'efface vers le blanc au lieu du noir ; étiquettes et coordonnées passent à l'encre (`data-map-theme="paper"`). Réglage `dessin` : 0 pour revenir à la carte de nuit.
- **Coût** : ~2 ms GPU en 2800 × 1720, un dessin plein écran.

## Parallaxe en une passe, papier et masque sous la caméra (2026-09-18)

- **Masque** : un disque centré sous la caméra (son pied au sol), comme dans Chartogne-Taillet : tout le premier plan est dessiné, la carte s'efface vers le lointain au lieu de cadrer la vue. Réglages `masque largeur / profondeur / recul / fondu / bord`.
- **Parallaxe dessinée dans la passe du sol** : quand la technique est la parallaxe, l'encre (`InkStyle`) est appliquée dans le shader du sol lui-même. Contours par dérivées (`fwidth` de l'impact, de la hauteur touchée et de la normale), sans tampons de normales ni de profondeur ; l'effet plein écran est coupé et la scène rend directement à l'écran (une passe, plus la carte d'ombres). Les volumes extrudés gardent l'effet plein écran.
- **Tramages** : hachures croisées ou trame de points sur le sol et les toits, traits verticaux accrochés aux murs, pointillé sur la végétation, traits ondulés sur l'eau ; au loin, traits plus fins et plus clairs (réglage `profondeur`).
- **Papier** : fibres et taches dessinées une fois, et une page de journal vue par transparence là où la carte s'efface (réglages `fibres du papier`, `journal`). Fond de scène couleur papier.
- **Réglages de parallaxe** (dossier « Parallaxe ») : pas par cellule, pas par texel, pas vers le soleil (0 : sans ombres), pénombre, mip, creux au pied. Et `resolution` (pixels rendus par pixel CSS).
- **Mesures** (Paris à 5 km, 1400 × 860 CSS, temps GPU médian) :

| Parallaxe dessinée | Densité 2 | 1,5 | 1 |
|---|---|---|---|
| réglages par défaut | 13,4 ms | 8,7 ms | 5,0 ms |

  En densité 2 : sans ombres du bâti 9,6 ms, réglage léger (12 / 24 / 6 pas, mip 0,5) 11,5 ms, minimal 8,9 ms. L'encre dans le shader ne coûte presque rien (13 ms en carte de nuit) : c'est la marche du rayon, par pixel, qui domine.

## Chargement et mémoire (2026-09-18)

- Tuiles vectorielles : 16 requêtes simultanées (HTTP/2), niveau fin plafonné au z15, dessin incrémental dans le worker, couches et attributs utiles seulement, coordonnées en `Int16Array` par couche (3,5 → 1,45 Mo par tuile décodée).
- Vols : données demandées pour l'arrivée seulement.
- Communes : par département, là où regarde la vue (au lieu de 3,9 Mo pour la France entière).
- Cache d'altitude : 320 tuiles.
- Mesure à froid (ville à 3 km) : données complètes 1,3 à 1,8 s après l'arrivée, contre ~5 s.

## Motifs accrochés à la carte, parallaxe plus légère (2026-09-18)

- **Sans couture** : hachures, trame, pointillé, papier, journal et bord du masque sont posés en coordonnées géographiques, pas à l'écran : ils glissent avec la carte. Deux échelles (celles de la brume) se fondent pendant le zoom. Pour la précision des flottants, le shader ne voit que l'écart à une origine recalée d'une période entière (`INK_PERIOD`, 16 384 pseudo-pixels), calculée en double précision côté CPU ; tous les motifs ont une période qui la divise, le recalage est invisible.
- **Masque** centré là où regarde la caméra (au sol), rayon 130.
- **Parallaxe** :
  - départ à hauteur du plus haut sommet des environs (carte de sommets par cellules de 64 texels, étendue de 2 cellules) au lieu du plus haut bâtiment de la zone ;
  - pas fins de 2 texels du niveau de mip lu (réglage `texels par pas`), position de l'impact affinée par 3 dichotomies ;
  - grille du sol à 256 subdivisions par défaut : au-delà, les triangles tombent sous quelques pixels et le shader du sol tourne 2 à 4 fois par pixel (blocs de 2 × 2). À 2,5 km, densité 2 : 1024 → 75 ms, 512 → 54 ms, 256 → 38 ms ; puis 30 ms avec les sommets des environs et le pas de 2 texels.
- **Qualité dynamique** (comme Chartogne-Taillet) : sous 45 images/s pendant deux fenêtres de 1,5 s, la densité de pixels baisse de 0,25 (jusqu'à 1) ; le niveau est retenu (`localStorage`). Réglage `qualite auto`.

## Retour au rendu de référence (2026-09-18)

- **Effet plein écran par défaut**, y compris pour la parallaxe : c'était le rendu de la capture de référence (contours lus dans les normales et la profondeur, tons en hachures fines). La passe unique reste une option (`une passe (parallaxe)`).
- **Masque, papier et journal dans l'effet plein écran** : le sol écrit dans l'alpha des normales sa part dessinée (`mrtNode`) ; l'effet y efface contours et hachures, et y fait apparaître le journal. Papier et journal sont accrochés à la carte : la position de chaque pixel est retrouvée depuis la profondeur, puis passée à la même ancre que le shader du sol (`inkAnchorAt`).
- **Lumière de la capture de référence** par défaut : soleil à 117° et 22° de haut, intensité 4, ambiance 0,2 ; exagération 1. Masque : rayon 95, fondu 0,6, bord 0,12.
