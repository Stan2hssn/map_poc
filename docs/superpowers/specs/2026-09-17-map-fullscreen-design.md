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

## Volumes au rendu de la parallaxe (2026-09-19)

- **Même dessin, par construction** : les volumes extrudés ne servent qu'à couvrir les pixels. Impact, normale, soleil et creux sont ceux de la parallaxe, lus dans la même texture de hauteurs (`buildingSurface`) : même marche grossière (`marchEntry`), même marche fine (`fineMarch`), reprise un pas au-dessus du volume pour 4 pas au lieu de descendre depuis le sommet. Les contours rugueux viennent des pentes de cette texture (vérifié : sans contours d'arête, ils disparaissent), ils sont donc les mêmes.
- **Pas de saut de profondeur sur les volumes** : ils écrivent leur part dessinée en négatif dans l'alpha des normales, l'encre n'y cherche que les arêtes (la parallaxe garde la profondeur du sol).
- **Ombres du bâti lues dans la texture** pour les deux techniques : les volumes ne passent plus dans la carte d'ombres.
- **Coût** (2048 × 1536, Paris à 2 km) : sans bâti 4,8 ms, parallaxe 14,8 ms, volumes 8,3 ms. À 5 km : parallaxe 14,9 ms, volumes 13,2 ms (sommets plus nombreux).
- **Écart restant** : de très près, le grain des murs diffère (points de la parallaxe, légères traînées verticales des volumes).

## Chargement : ce qui a changé et ce qui reste (2026-09-19)

- **Images du worker sans relecture** : surfaces et routes partent en `ImageBitmap` (`transferToImageBitmap`), copiées sur le GPU par three (`copyExternalImageToTexture`) dans la même texture tant que la taille ne change pas. Routes dans une seconde texture (l'alpha prémultiplié d'un canvas ne peut pas les porter). Composition sans hauteurs : 430 → 255 ms.
- **Hauteurs du bâti** relues au plus toutes les 600 ms pendant le chargement, et à la fin ; sommets des environs tirés des sommets par cellule (une passe pleine résolution de moins). Une toile `willReadFrequently` les dessine 10 fois plus lentement (rastérisation logicielle) : écartée.
- **Tuiles du centre vers les bords**, dans chaque niveau.
- **Cache des tuiles décodées plafonné en octets** (~96 Mo), au lieu de 300 tuiles (jusqu'à ~435 Mo).
- **Démarrage** : `preconnect` vers data.geopf.fr et geo.api.gouv.fr ; données du sol demandées dès `beforeMount`, en parallèle du relief.
- **Écarté** : ne charger que le disque dessiné. Une demande reste valable tant que la vue ne bouge pas de plus de 35 % de sa largeur, donc le disque utile, marge comprise, couvre presque toute la zone.
- **Pistes suivantes** :
  - proxy Nitro qui retire les couches inutiles et compresse en brotli (÷2,5 mesuré ; demande un hébergement avec fonctions serveur) ;
  - pyramide de maximums pour la parallaxe ([Tevs et al. 2008](https://dl.acm.org/doi/10.1145/1342250.1342279)) ;
  - emplacements fixes par tuile dans un tableau de textures (texture virtuelle, [Barrett](https://silverspaceship.com/src/svt/)), pour ne dessiner que les tuiles entrantes.

## Caméra à la Chartogne-Taillet (2026-09-19)

Relevé dans leur code (three r122, caméra maison, un seul RAF qui fait aussi avancer GSAP, delta plafonné à 60 ms) :
- **Lissage** : leur pose rattrape la cible de `0,004 × delta` par image (~250 ms). Ici, les gestes déplacent une vue visée, la vue affichée la rattrape (`ease`, 250 ms par défaut, réglable).
- **Inclinaison selon le zoom** : chez eux de −27° (près) à −90° (vue du dessus), en courbe cubique. Ici, de 52° depuis la verticale (2 km, le rendu validé) à 25° (monde), même courbe, réglable (`inclinaison de pres`, `de loin`).
- **Parallaxe souris** : la caméra glisse dans son propre plan sans tourner, réponse de 250 ms.
- **Rotation au glisser, de près** : chez eux, au-delà d'un zoom de 0,8, le glisser horizontal tourne la vue au lieu de la décaler (2,25 rad pour une largeur d'écran d'au moins 600 px). Ici, la part horizontale du glisser qui tourne passe de 0 à 1 entre des zooms de 0,72 et 0,86 (~20 km et ~10 km de large) ; la vue tourne autour du point visé, le reste du glisser déplace toujours le terrain sous le pointeur. Les deux points du glisser sont lus avec la caméra du moment : la rotation ne se lit pas comme un déplacement.
- **Retour au nord de loin** : hors de cette plage, la rotation revient à 0 (au plus court), en ~500 ms divisés par la part hors rotation.
- **Roulis**, repris de la caméra de l'arbre du projet grass (inspirée d'aten7) : la caméra penche selon la vitesse de rotation (−0,05 rad par rad/s) et le déplacement latéral du centre (−0,08 rad par largeur de vue par seconde), borné à 0,12 rad, réponse de 120 ms. Appliqué après le cadrage (`lookAt` remet la caméra d'aplomb). Réglages dans le panneau.
- **Non repris** : visite automatique des parcelles après 6,5 s d'inactivité, arc de hauteur des vols (le zoom arrière à mi-vol en tient lieu).

## Navigation, vols et apparitions (2026-09-19, suite)

- **Parallaxe souris** : la caméra se déplace dans son plan, sa cible à peine (10 % du déplacement) ; la vue tourne autour du point regardé. Roulis léger selon la vitesse de la souris (`roulis / souris`).
- **Glisser qui tourne** : le point saisi suit le pointeur en tournant autour du point regardé (angle dont il a tourné autour de lui), le reste glisse. Devant ou derrière ce point, le sens est donc toujours le bon. Sous 10 unités de lui, l'angle n'a plus de sens : le geste glisse.
- **Masque dans les axes du regard** : largeur en travers, profondeur le long, recul vers la caméra le long du regard. Avant, ces trois réglages suivaient les axes nord/est et partaient de côté dès que la vue tournait.
- **Vols de van Wijk et Nuij** (`FlightPath.ts`, le `flyTo` de Mapbox) : dézoom juste suffisant, ρ = 0,8 au lieu de 1,42 (Marseille → Paris culmine vers 210 km de large au lieu de la France entière), départ et arrivée au carré, 0,9 à 3,2 s. Un clic sur une ville y vole directement, à 3 km de large.
- **Chargement pendant un vol** : maillages demandés pour l'arrivée, montrés selon la vue affichée ; sol chargé autour de l'arrivée à la largeur du moment (plus de carré isolé à la descente).
- **Apparitions** : une nouvelle image du sol se dessine par taches sur la précédente (700 ms, deux textures qui échangent leur rôle) ; chaque tuile de bâti monte et se dessine au crayon en 1,4 s, bâtiments échelonnés par un bruit accroché à la carte (l'ombrage suit la hauteur courante).
- **À-coups** : côté processeur, aucune image au-delà de 20 ms pendant un vol et son chargement. Restent quelques images de 40 à 60 ms, côté GPU (textures 2048² et leurs mipmaps, maillages) : textures des hauteurs réutilisées, 2 tuiles de maillages au plus par image, images partielles toutes les 300 ms.
- **Monuments** : l'IGN décrit la tour Eiffel par trois emprises pleines emboîtées (62, 116 et 286 m) ; à Matignon, le grand vide est le parc, et le bâtiment public n'a pas de hauteur (9 m par défaut).

## Cadence : 120 images/s (2026-09-19, suite)

Mesures en 2984 × 1858 (la résolution de l'écran de référence), GPU d'un Mac ; l'horloge du GPU varie avec la chauffe (mesures bimodales, minimum sur plusieurs tours).
- **Travail inutile retiré** :
  - l'encre « une passe » de la parallaxe n'est plus calculée quand elle ne sert pas (branche uniforme) : le sol sans bâti passe de 7,7 à ~5,2 ms ;
  - la grille du sol ne couvre plus que le rectangle de l'écran où se projette la zone dessinée (`screenRect`) : hors de lui, rien n'est calculé, et ses sommets s'y concentrent ;
  - les tuiles de bâti sont gardées selon l'ellipse tournée du masque, plus son plus grand rayon ;
  - le pied des bâtiments lit l'altitude sans le lissage B-spline (3 lectures par sommet au lieu de 6) ;
  - le sol est dessiné après le bâti (le test de profondeur écarte le sol caché), le bâti du plus proche au plus loin.
- **Ombres du bâti cuites** (`sunShadow`) : un balayage de la carte des hauteurs depuis le côté du soleil, dans le worker, donne la hauteur sous laquelle un point est à l'ombre ; une lecture au lieu de 10 pas par pixel (sol et bâti). Portée limitée comme l'ancienne marche. Complet : ~10,7 → ~8,1 ms.
- **Dessin du worker en mémoire** : un canvas accéléré partage le GPU avec le rendu ; ses gros lots de polygones faisaient sauter des images à chaque redessin (mesuré : 25 images de plus de 10 ms en 5 s de zoom, même sans envoyer les images au rendu ; aucune sans redessin). En mémoire (`willReadFrequently`), une composition prend ~740 ms au lieu de ~400 ms, hors du thread principal, et le zoom tient 120 images/s (99e centile 10,3 ms au lieu de 42).
- **En mouvement**, l'image du sol courante suffit tant qu'elle couvre la vue avec au plus un niveau de retard ; demandes toutes les 600 ms au plus, l'image exacte vient à l'arrêt.
- **Au repos**, la scène ne se rend plus qu'à 15 images/s (seule la brume dérive) : l'ordinateur ne chauffe pas pour une image fixe.
- **Qualité automatique** : elle tient la fréquence de l'écran (mesurée, alignée sur 60/90/120/144 Hz…) en rendant la scène à une échelle plus petite (jusqu'à 0,6), l'encre et le papier restant à pleine résolution ; elle remonte à l'essai quand la cadence est à l'aise. L'ancienne version baissait la densité de pixels sous 45 images/s et la retenait pour toujours : effacée.
- **Masque** : toujours centré là où regarde la caméra (le « recul » est retiré).

## Correctifs, arbres, routes et voitures (2026-09-19, suite)

- **Mer** : altitudes plafonnées à 0 (shader, relief, plancher). Le fond marin fixait le plancher de la vue : la caméra « plongeait » sous la mer.
- **Bande en haut de l'écran** : le fond (ciel, et hors du rectangle de la grille du sol) lisait le papier au plan lointain de la caméra, étiré en traits verticaux. Le papier y est pris au sol visé par le rayon (replié au-dessus de l'horizon), puis posé à l'écran là où, accroché à la carte, il s'étirerait (plus de 2,5 pseudo-pixels par pixel).
- **Lignes blanches en grille** : jointures des tuiles de bâti. Chaque part d'un bâtiment coupé était posée à l'altitude de son propre centre, sans mur à la coupure : on voyait le sol à travers. Pied lu sous chaque sommet. Les lignes flottantes du relevé sont retirées.
- **Masque** : le bâti hors de la zone dessinée s'efface comme le sol (il gardait ses hachures de ton).
- **Contours dès l'apparition** : les volumes lisaient normales et ombres dans la texture de hauteurs, qui arrive ~1 s après eux ; sans elle, rien à contourer, puis tout d'un coup. Tant qu'une tuile n'est pas dans la texture, ses faces sont celles du volume ; puis l'ombrage de la texture se dessine au crayon (700 ms). Un bâtiment part de son dessin à plat (même teinte que l'empreinte au sol, qui tient lieu de bâti tant que les volumes manquent).
- **Composition du worker** : chaque tuile dessinée est gardée (160 Mo au plus, reprise si sa taille à l'écran change de moins de 15 %, 2 px de bord qui recouvrent les voisines) ; un déplacement ou un retour ne redessine que les tuiles nouvelles. Le balayage des ombres traite une ligne contiguë à la fois : ~33 ms au lieu de plusieurs centaines pour 2048². Mesuré sur un processeur partagé, composition d'une vue déjà vue : 4,6 s → 1 s (même rapport attendu à pleine vitesse : ~740 → ~150 ms).
- **Arbres** (`Trees.ts`) : le PLAN IGN n'a pas d'arbres un par un. Semés dans ses zones de végétation sur une grille bousculée (10 m, conifères reconnus), alignés des deux côtés des axes régionaux (boulevards, avenues) tous les 11 m ; jamais sur un bâtiment ; 3 000 + 1 500 au plus par tuile (les bois s'éclaircissent au-delà). Houppier en icosaèdre à normales de sphère : l'encre n'en trace que la silhouette et l'ombre. Ils poussent à l'apparition de la tuile.
- **Routes** : cernées d'un trait sur le sol.
- **Voitures** (`Traffic.ts`) : sur les routes classées (vitesse et densité par classe, sens uniques du PLAN IGN), en boucle sur leurs voies, à droite de l'axe ; grossies ×2 comme un symbole (à l'échelle : 2 à 4 px). Avancées côté processeur (~0,2 ms par image pour ~1 300 voitures), placées par le shader. Quand seules elles bougent, la scène se rend à 30 images/s.
- **Coût** : arbres et voitures dans le bruit de mesure du GPU (~26 000 arbres au Luxembourg, ~45 000 au bois de Boulogne à 8 ms l'image).

## Composition de référence : masque, papier, ciel (2026-09-19, soir)

- **Masque sur la carte, centré sur le point visé** : ellipse posée au sol autour de la cible de la caméra (l'origine de la scène, autour de laquelle elle orbite), dans les axes de la rotation de la vue, sans la parallaxe de la souris ni le roulis : il suit le point visé et la rotation, pas les petits mouvements de la caméra. Le « décalage en haut » venait de son centre, pris là où le regard touche le sol : ce point bouge avec la souris et la remontée de la caméra au ras du relief. (Un masque en espace écran, comme la texture peinte de CT, a été essayé puis écarté : il suit la caméra.)
- **Aucune géométrie ne dépend du masque** : son centre bougeait avec la souris ; les bâtiments montaient et descendaient sans cesse à son bord, les arêtes bougeaient. Le masque n'efface plus que la couleur, et son bord (bruit accroché à la carte) ne dérive plus.
- **Tremblé du trait accroché à la carte** : un bruit fixé à l'écran faisait « bouillonner » les arêtes à chaque mouvement de caméra.
- **Papier** posé à l'écran (fibres et taches, texture redessinée sans raccord) ; **journal** : la texture fournie (`public/assets/Images/Paper/newspaper.webp`), à plat sur le sol en perspective, échelle au panneau, effacée vers l'horizon. **Nuages** hachurés (générés) sur un cylindre autour du point visé, derrière la carte, qui tournent lentement (les bandes de CT).
- **Bug de longue date** : les textures d'attente 1×1 étaient en bord fixe et l'échantillonneur gardait ce mode ; le papier filait en traînées au-delà de 1024 px, les nuages en traits continus.
- **Trous** : les tuiles de bâti attendaient derrière la centaine de tuiles de l'image du sol (file dans l'ordre d'arrivée). File priorisée : bâti, puis niveau fin, puis ensemble, du centre vers les bords.
- **Contenu** : arbres seulement dans les parcs et bois (15 m, 1 500 par tuile au plus) ; voitures divisées par 2 à 3, qui rapetissent aux bouts de leur voie au lieu de sauter, et passent les ponts (routes sur ouvrage, désormais dessinées sur l'eau) ; péniches sur les grands fleuves (lignes des noms de cours d'eau qui passent sur l'eau) ; 3 avions au plus ; poussière = 36 petites ellipses vides ; points de graticule découpés net (leurs carrés passaient dans l'encre).
- **Transitions** : une nouvelle image du sol se fond dans la précédente (1 s) au lieu de se dessiner par taches.
- **Panneau** : les réglages ne s'enregistrent plus seuls ; seul « Save Settings » écrit le fichier.

## Ciel, vie de la carte et lisibilité (2026-09-20)

- **Où passait la qualité du trait.** Deux réglages enregistrés dans le panneau expliquaient l'essentiel du rendu
  délavé : la lumière (intensité 1, ambiance 0,7, rebond 0) aplatissait murs et ombres portées ; le papier
  (fibres 2, bavure 1) posait de grosses taches grises sur toute la feuille. Remis aux valeurs d'origine, avec
  l'accord de l'auteur. Le journal (0,26) ne pèse presque rien.
- **Plan imprimé, pas éclairé.** Eau, bois, routes et empreintes du bâti sont désormais multipliés sur le relief
  déjà éclairé (relief ramené sous le blanc), au lieu d'être une couleur qu'un soleil fort blanchit jusqu'à
  l'effacer. Traits de l'eau et bords des routes renforcés en conséquence.
- **Masque plus large en vue large.** L'ellipse dessinée grandit jusqu'à trois fois entre 4 km et 600 km de
  largeur de vue (échelle logarithmique) : à l'échelle d'une région ou du pays, une petite zone ne laissait rien
  voir. Le grand format garde les réglages de largeur, profondeur, fondu et bord de l'auteur.
- **Nuages.** Rideau face à la vue, posé juste derrière le bord lointain de la zone dessinée (1,25 fois sa
  profondeur), qui glisse quand la vue tourne : un cylindre vu d'en haut dessinait un anneau. Cumulus à base plate
  faits de traits horizontaux, plus gras et continus dans l'ombre, rompus dans la lumière ; texture 4096 x 512
  dessinée en unités de scène.
- **Poussière.** Celle de Chartogne-Taillet : des grains fixes dans la scène, répartis dans un cube qui suit la
  caméra, portés par un vent lent ; invisibles au repos, ils grossissent avec la vitesse de la vue et s'effacent au
  loin et tout près. Ici en petits cercles vides.
- **Avions.** Trois au plus, au-dessus du plus haut relief de la vue, traversant la zone dessinée en 26 s à toutes
  les échelles ; leur ombre glisse sur le sol. Ils suivent la carte quand elle glisse ou change d'échelle.
- **Ponts en volume.** Les routes et chemins sur ouvrage deviennent des tabliers (4,5 à 7 m) posés au-dessus du sol
  ou de l'eau : le quatrième canal de l'attribut `building` porte le dessous du volume.
- **Noms des voies.** Grands axes, longues rues et cours d'eau écrits le long de leur tracé dans la texture de
  données, en capitales espacées, sur un bandeau de papier qui efface le bâti dessous. Tronçons de même nom
  recollés avant l'écriture (le PLAN IGN les coupe à chaque carrefour).
- **Fluidité.** Les cinq matériaux du bâti sont compilés au démarrage sur des exemplaires vides : l'arrivée sur une
  ville ne fige plus l'image (avant : cinq compilations d'un coup, 0,2 à 1,4 s). Les ombres du relief s'effacent et
  leur passe n'est plus rendue sous 40 à 120 m de relief (une ville est plate), et leur grille est limitée à 192
  subdivisions. L'ancienne image du plan n'est relue que pendant son fondu.

## Respirer : nuages poses, poussiere, maillage a l'echelle (2026-09-20)

- **Nuages.** Plus de bande repetee sur un cylindre : chacun est un tableau dessine (une case de la texture des
  nuages) pose devant la camera, dans la couronne autour du point vise, a quelques degres sous l'horizon — donc
  dans la bande de ciel qu'on voit au-dessus de la carte. Ils suivent la carte, derivent au vent et repartent
  ailleurs en sortant de la vue. Leur texture arrive apres les materiaux qui la lisent : le ciel s'abonne
  (`onCloudsDrawn`) plutot que de lire une texture d'attente, dont l'echantillonneur ne reprenait pas la vraie.
- **Poussiere.** Visible au repos : les grains sont fixes dans la scene, repartis dans un cube qui suit la camera,
  donc ils defilent a l'inverse du deplacement et reparaissent de l'autre cote. Plus petits au loin, effaces tout
  pres. Densite et taille au panneau.
- **Simplification au loin.** Par tuile, les batiments sous une hauteur qui monte avec la distance se replient sur
  leur centre : le dessin respire, et il y a moins a dessiner. Reglage `simplifier au loin (m)`.
- **Maillage selon le relief.** Les subdivisions du sol descendent a la moitie du plafond sur une vue plate (une
  ville) et y remontent en montagne (60 a 900 m de relief), seulement quand la vue est posee.
- **Buissons.** Une touffe tous les 70 m la ou il n'y a ni bati, ni eau, ni bois, ni route : les emprises sans
  donnees ne restent plus des pages blanches.
- **Avions et bateaux** s'effacent avec le masque, comme le reste de la carte ; les avions sont moins nombreux.
- **Panneau.** Trois onglets : Carte (vue, vie, camera et soleil), Dessin (encre, papier, ombrage du bati), Rendu
  (mesures, resolution). Les reglages qui ne servaient plus (passe unique de la parallaxe, pointille de la
  vegetation, traits d'eau, rayon des nuages) ont ete retires ; arbres, voitures, bateaux, avions, nuages et
  poussiere ont leur densite.

## Echelle, bords et mouvement (2026-09-20, suite)

- **Avions a l'echelle.** Leur taille est en unites de scene : a l'echelle d'un pays, un avion couvrait une region.
  Ils s'effacent maintenant entre 25 et 70 km de largeur de vue.
- **On ne voit plus ou la carte s'arrete.** Trois verrous : la zone dessinee elargie est bornee au sol (95 unites,
  le sol s'arretant a 150) ; le bord du monde se fond sur une part de la vue au lieu d'etre coupe net ; la vue la
  plus large est ramenee a 12 000 km et son centre se resserre pour que la zone dessinee reste dans la couverture
  du relief (SRTM, -56 a 60 degres). Le raccourci "Monde" ouvre cette vue.
- **Buissons.** Semes tous les 38 m sur une grille d'occupation de la tuile (bati, eau, bois, abords des routes a
  9 m) : une passe sur les donnees au lieu d'un test par graine, 20 ms par tuile de ville, 30 a 90 touffes.
- **Mouvement.** L'eau ondule : ses traits derivent et ondulent (deux houles, reglage `vagues`). Les houppiers se
  balancent, chacun a son rythme, d'autant plus qu'ils sont grands (reglage `vent`). Tant que l'un des deux est
  actif, l'image est consideree vivante (30 i/s au repos plutot que 15).
