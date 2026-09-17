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
