# Occupation du sol, bâti, arbres, trafic

Ce sous-système dessine ce qui couvre le relief : surfaces (bâti, végétation, eau), routes et noms de voies, volumes du bâti, arbres et véhicules. Toutes les données viennent des tuiles vectorielles PLAN IGN, téléchargées et décodées par un seul worker, qui sert deux consommateurs : l'image du sol (texture de données) et les volumes par tuile.

```
PLAN IGN .pbf -> worker (file priorisée, decodeVectorTile, cache)
  -> image du sol : rasterisation par tuile -> assemblage 2 niveaux -> ImageBitmap -> LandcoverHelper -> Terrain.material
  -> hauteurs du bâti : rouge = mètres -> maxima + ombre cuite -> DataTexture R8 -> buildingSurface
  -> volumes par tuile : toits, murs, ponts, arbres, voies -> BuildingsNode -> Buildings / Trees / Traffic.material
```

## Tuiles vectorielles

### Grille Web Mercator et choix du zoom — [`src/graphics/terrain/Landcover.ts`](../src/graphics/terrain/Landcover.ts)
- **Comment** : `landcoverZoom` prend le zoom dont une tuile dessinée à 512 px (`TILE_PX`) égale la résolution voulue (m/px de l'emprise à sa latitude centrale, `metersPerPixel`), borné à 16 (`MAX_ZOOM`). `fineZoom` = z + 2, plafonné à 15. `mercatorTiles` liste les tuiles d'un rectangle (formules slippy map), triées du centre vers les bords ; `tileKey`, `tileBounds`, `tilePointToLonLat` et `latitudeV` passent des coordonnées de tuile à lon/lat et à un v linéaire en latitude.
- **Pourquoi** : le relief, l'image du sol et les volumes vivent dans une grille lon/lat ; reprojeter chaque point de tuile évite une texture Mercator déformée. Le niveau fin s'arrête à 15 : le PLAN IGN n'a tout le bâti qu'à partir de 14-15.
- **Sources** : [Slippy map tilenames (OSM)](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) ; flux TMS vectoriel PLAN IGN de la Géoplateforme (`https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf`, cf. `landcoverUrl`).
- **Limites** : Terre sphérique (6 378 137 m), cos(lat) pris au centre de l'emprise ; tri des tuiles par distance en indices de tuile, pas en mètres.

### Décodage MVT — [`src/graphics/terrain/VectorTile.ts`](../src/graphics/terrain/VectorTile.ts)
- **Comment** : lecteur protobuf minimal de Mapbox Vector Tile 2.1 : couches, type, attributs, géométrie (commandes MoveTo/LineTo/ClosePath) en entiers de tuile. Les coordonnées d'une couche tiennent dans un seul `Int16Array` ; chaque entité y pointe par `start`/`ends`. Seules les couches et attributs de `LANDCOVER_LAYERS` sont décodés (11 couches : `bati_surf`, `ocs_vegetation_surf`, `hydro_*`, `routier_*`, `toponyme_*`).
- **Pourquoi** : pas de dépendance, et un tableau par couche plutôt qu'un par anneau : moins d'objets, mesure mémoire simple.
- **Sources** : [Mapbox Vector Tile specification](https://github.com/mapbox/vector-tile-spec) ; [Protocol Buffers, encodage](https://protobuf.dev/programming-guides/encoding/).
- **Limites** : coordonnées en 16 bits signés ; aucune validation au-delà du strict nécessaire.

### Worker : file de téléchargement et cache des tuiles — [`src/graphics/terrain/Landcover.worker.ts`](../src/graphics/terrain/Landcover.worker.ts)
- **Comment** : `load` dédoublonne par `z/x/y` et ne télécharge que si un demandeur la veut encore (`wanted`). `slot` : 16 requêtes simultanées (`MAX_CONCURRENT`), file triée par priorité (`PRIORITY` : volumes 0, niveau fin 1000, ensemble 2000, plus le rang du centre vers les bords) ; une demande plus pressée fait avancer une tuile déjà en file. Cache des tuiles décodées borné à 96 Mo estimés (coordonnées + 120 o par entité), évincé dans l'ordre d'insertion. 204 ou erreur : tuile vide.
- **Pourquoi** : décodage et dessin hors du thread principal (cible 120 fps). Le serveur est en HTTP/2 : 16 requêtes en parallèle plutôt que 6. Sans priorités, les tuiles de bâti attendent derrière la centaine de tuiles de l'image du sol.
- **Sources** : [Web Workers API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) ; [Transferable objects (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).
- **Limites** : estimation mémoire approximative ; une erreur réseau marque la tuile vide pour la session (pas de retry) ; pas d'annulation des `fetch` partis ; insertion triée en O(n).

## Image du sol

### Rasterisation en texture de données — [`src/graphics/terrain/Landcover.ts`](../src/graphics/terrain/Landcover.ts) (`drawLandcoverTile`)
- **Comment** : deux toiles par tuile. `areas` en composition `lighter` : végétation `#00ff00`, eau `#0000ff` (plus `hydro_reseau` en trait de 18 m), bâti `#ff0000`. `roads` en blanc : `routier_surf` remplies, puis routes avec largeur par classe `symbo` (26 / 18 / 13 / 9 / 6 m), chemins 3 m, puis routes et chemins sur ouvrage par-dessus l'eau. Remplissage `nonzero` (cours intérieures), trait au moins 0,5 px.
- **Pourquoi** : une texture de masques par canal, pas une image en couleur : le shader du sol (`Terrain.material.ts`) décide du style (encre, hachures, papier). Canvas 2D fournit antialiasing et trous sans triangulation GPU.
- **Sources** : [`globalCompositeOperation` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation) ; [`fill()` et règle nonzero (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fill).
- **Limites** : 8 bits par canal, pas de classe fine ; largeurs de route arbitraires par regex sur `symbo` ; l'addition sature quand deux classes se recouvrent.

### Noms le long des voies — [`src/graphics/terrain/Landcover.ts`](../src/graphics/terrain/Landcover.ts) (`drawNames`, `joinLines`, `pointAt`)
- **Comment** : les tronçons d'un même nom (`toponyme_routier_odonyme_lin`, `toponyme_hydro_lin`) sont recollés bout à bout. Lettres en mètres (55 m grands axes, 38 m rues, 90 m fleuves en italique), écrites si elles font au moins 6 px (au plus 22). Chaque lettre est placée par abscisse curviligne et tournée selon la tangente, toujours de gauche à droite ; texte en rouge (canal bâti), halo de 1,5 × la taille tracé sur la toile `roads`. Un nom est écrit par la tuile qui contient le milieu de sa partie dans la tuile.
- **Pourquoi** : typographie de plan gravé, dans la même texture que le reste : même rendu à l'encre, aucun coût par image.
- **Sources** : technique « text on path » (placement de labels le long d'une ligne, comme `symbol-placement: line` de Mapbox GL) ; pas de source précise.
- **Limites** : rues de moins de 700 m (hors grands axes) et types filtrés (impasses, allées, passages...) jamais nommés ; pas de détection de collision ; lettres déformées dans les virages serrés.

### Composition à deux niveaux et cache de rasters — [`src/graphics/terrain/Landcover.worker.ts`](../src/graphics/terrain/Landcover.worker.ts) (`compose`, `rasterOf`, `assemble`)
- **Comment** : niveau d'ensemble z sur l'emprise (fond noir opaque), niveau fin sur la zone focus (transparent hors de ses tuiles). Chaque tuile est peinte une fois dans sa propre `OffscreenCanvas`, à sa taille écran avec 2 px de bord de chaque côté (`RASTER_MARGIN`), gardée en cache (160 Mo) et reprise tant que sa taille varie de moins de 15 % (`isReusable`, `fits`). Images partielles au plus toutes les 300 ms ; `assemble` superpose le fin sur l'ensemble et part en `transferToImageBitmap`. Une requête plus récente (`latest`) abandonne les anciennes.
- **Pourquoi** : un pan ou un retour en arrière ne redessine que les tuiles nouvelles. Toiles en mémoire (`willReadFrequently`) : un canvas accéléré partageait le GPU avec la carte et faisait sauter des images.
- **Sources** : [OffscreenCanvas (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) ; [`transferToImageBitmap` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap).
- **Limites** : la reprise à ±15 % floute légèrement ; deux toiles 2048² par niveau plus l'assemblage restent en mémoire.

### Pilotage du worker et textures du sol — [`src/graphics/nodes/terrain/Landcover.helper.ts`](../src/graphics/nodes/terrain/Landcover.helper.ts)
- **Comment** : `update` demande une image 2048² sur la cible élargie de 0,75 de chaque côté (×2,5, bornée au monde), zone focus élargie de 0,35 (×1,7). Nouvelle requête si zoom (±1 toléré en mouvement), hauteurs, soleil ou focus changent, au plus toutes les 200 ms (600 ms en mouvement). Chaque image, recadre les UV (`mosaicUvTransform`) de l'image courante, de la précédente et des hauteurs, et avance le fondu `landcoverReveal` (1 s). `show` permute deux textures courante/précédente : à taille égale, la plus ancienne reçoit la nouvelle image sans réallocation ; `refill` fait de même pour les `DataTexture` R8.
- **Pourquoi** : chaque upload 2048² + mipmaps faisait des à-coups au zoom ; cadence bornée et textures recyclées. Le fondu évite le pop entre deux images.
- **Sources** : [three.js `DataTexture`](https://threejs.org/docs/pages/DataTexture.html) ; [`Worker()` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker).
- **Limites** : une seule requête utile en vol ; les messages d'un id plus ancien que le dernier montré sont ignorés ; `dispose` libère des textures partagées avec le matériau du sol.

## Bâti

### Hauteurs, hiérarchie de maxima et ombre cuite — [`src/graphics/terrain/Buildings.ts`](../src/graphics/terrain/Buildings.ts) (`drawBuildingHeights`, `cellMaxima`, `spreadPeaks`, `sunShadow`)
- **Comment** : sur la zone focus, `drawBuildingHeights` peint la hauteur (m, 0-255) en rouge ; le worker (`post`) la relit (`getImageData`) au plus toutes les 600 ms. `cellMaxima` 16 texels puis `spreadPeaks` (portée 1) donnent `buildingPeaks` ; ces cellules réduites à 64 texels puis `spreadPeaks` (portée 2) donnent `buildingSummits`. `sunShadow` : un seul balayage depuis le côté du soleil, `S(p) = max(h(q), S(q)) − pas × rise`, q interpolé entre deux texels de la ligne précédente, portée 24 texels (`SHADOW_REACH`). Sortie : hauteur sous laquelle un point est à l'ombre.
- **Pourquoi** : la marche de rayons (`buildingSurface`) saute le vide grâce aux maxima et ne part pas de 255 m ; l'ombre lue en une fois remplace une marche vers le soleil par pixel. O(N) pour 2048² en quelques dizaines de ms.
- **Sources** : Tevs, Ihrke, Seidel, « Maximum Mipmaps for Fast, Accurate, and Scalable Dynamic Height Field Rendering », I3D 2008 ; Timonen, Westerholm, « Scalable Height Field Self-Shadowing », Eurographics 2010 ; [`getImageData` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData).
- **Limites** : hauteurs quantifiées au mètre et plafonnées à 255 m ; ombres légèrement élargies par l'interpolation ; une direction de soleil par cuisson (recalcul si elle bouge de 0,001).

### Extrusion : découpe, toits, murs instanciés — [`src/graphics/terrain/Buildings.ts`](../src/graphics/terrain/Buildings.ts) (`buildTileMesh`)
- **Comment** : `polygons` regroupe les anneaux MVT (un anneau du signe du premier ouvre un polygone, les autres sont ses cours). `clipRing` : Sutherland-Hodgman sur le carré de la tuile ; les points de coupure tombent exactement sur le bord, ce qui évite les murs sur les coupures. Toits triangulés par Earcut (cours comprises) ; murs : une instance (u0, v0, u1, v1) par arête réelle, extérieur à gauche. Attributs unorm16 : point (u, v) et bâtiment (centre u, v ; haut et bas / 512 m). Hauteur absente : 9 m.
- **Pourquoi** : géométrie compacte posée en shader sur le relief : bouger la vue ne reconstruit rien. Un quad partagé par mur plutôt que des murs explicites. Earcut est fourni par three.
- **Sources** : [Earcut](https://github.com/mapbox/earcut) ; Sutherland, Hodgman, « Reentrant Polygon Clipping », CACM 1974 ; formule de l'aire (shoelace).
- **Limites** : toits plats ; les deux moitiés d'un bâtiment coupé ont des centres différents ; quantification 512 / 65 535 ≈ 8 mm.

### Ponts en volume — [`src/graphics/terrain/Buildings.ts`](../src/graphics/terrain/Buildings.ts) (`bridgeDecks`)
- **Comment** : chaque segment de `routier_route_sup` / `routier_chemin_sup` devient un quadrilatère de la largeur de la route (`roadWidth`, 4 m pour un chemin), prolongé d'une demi-largeur aux bouts, injecté dans `buildTileMesh` comme volume de 4,5 à 7 m.
- **Pourquoi** : le PLAN IGN n'a que des lignes « sur ouvrage », pas de géométrie de pont ; un tablier suffit à lire le franchissement.
- **Sources** : modèle de données PLAN IGN (couches `*_sup`) ; pas de source externe.
- **Limites** : hauteur fixe ; recouvrements aux coudes ; ni piles ni rampes.

### Tuiles de volumes, arbres et véhicules — [`src/graphics/nodes/buildings/Buildings.node.ts`](../src/graphics/nodes/buildings/Buildings.node.ts)
- **Comment** : `grow = 1 − smoothstep(5 km, 8 km, largeur de vue)` règle `buildingGrow` / `buildingUnits`. Tuiles voulues : `mercatorTiles` au zoom fin sur la vue (ou la destination d'un vol) + 25 % ; requête au worker si la signature change. Au plus 2 tuiles montées par image ; chaque couche de tuile est un `Mesh` placé par son uniform `tileUv`, visible si voulue et dans l'ellipse du masque (`_inMask`), triée du plus proche au plus loin (`renderOrder`). Apparition 1,4 s, passage à l'ombrage de la texture 0,7 s. Densités par `instanceCount`, sans reconstruire. Cache 400 tuiles, évincées par dernière utilisation. `_warmUp` rend un exemplaire vide de chaque matériau 30 images pour compiler les shaders.
- **Pourquoi** : positions entièrement en shader (`frustumCulled` et `matrixAutoUpdate` coupés) ; tri avant-arrière pour l'early-z, le shader argile marche dans la texture de hauteurs ; le préchauffage évite des gels à l'arrivée sur une ville.
- **Sources** : [three.js `InstancedBufferGeometry`](https://threejs.org/docs/pages/InstancedBufferGeometry.html) ; [TSL (wiki three.js)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
- **Limites** : un `Mesh` par couche et par tuile (centaines de draw calls en ville) ; pas de frustum culling ; `memoryMb` ignore les buffers véhicules ; `_trim` trie tout le cache dès qu'il dépasse 400 tuiles.

### Matériau argile — [`src/graphics/materials/Buildings.material.ts`](../src/graphics/materials/Buildings.material.ts)
- **Comment** : `inBlock` (u, v de tuile vers uv du bloc via `tileUv`), `toScene`, `footing` (relief sous chaque sommet). Toits à base + hauteur × `buildingUnits` × `riseOf(arrival)` (`1 − (1 − t)³`, départs décalés par un bruit accroché à la carte, `STAGGER` 0,5) ; murs prolongés de 50 % sous le pied. `kept` replie un bâtiment hors de la zone dessinée (à l'encre seulement) ou, au-delà de 80-240 unités, s'il est plus bas que `simplify` (seuil commun par tuile). Éclairage par `buildingSurface` (voir ci-dessous), couleur révélée au crayon (`pencilReveal`), normale MRT d'alpha négatif : pas de contour de profondeur dans l'encre.
- **Pourquoi** : mêmes normales, ombres et creux que la parallaxe : l'encre trouve les mêmes contours. Le repli au loin réduit le coût sans pop bâtiment par bâtiment.
- **Sources** : [TSL (wiki three.js)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
- **Limites** : shader coûteux (marche par fragment) ; toits légèrement non plans sur forte pente (`footing` par sommet) ; `@ts-expect-error` sur `receivedShadowNode` (typage three).

### Extrusion et parallaxe : comparaison — [`src/graphics/materials/Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts) (`buildingSurface`, `marchEntry`, `fineMarch`)
- **Comment** : la parallaxe marche un rayon dans la texture de hauteurs : départ au sommet des environs (`buildingSummits`), pas grossiers par cellule de 16 texels tant que `buildingPeaks` ne peut pas arrêter le rayon, pas fins jusqu'au premier toit traversé, 3 dichotomies, normale tirée de la pente des hauteurs, ombre lue dans `buildingShade`, creux au pied par 4 lectures en croix. En extrusion, le volume ne fait que couvrir les pixels : `buildingSurface` reprend la même marche un pas au-dessus du volume, sur 4 pas (`SURFACE_STEPS`), et garde les faces du volume tant que la texture n'a pas ce bâtiment. Au panneau, `bati` : `aucun` (`none`, carte à plat, `grow` = 0) ou `volumes` (`extrusion`).
- **Pourquoi** : la parallaxe donne le rendu de référence mais coûte par pixel de sol ; l'extrusion retrouve la même image (même texture lue) pour environ 2,7 fois moins de GPU (mesure du commit `6876015`), l'écart d'aspect venant des valeurs du panneau, pas de la technique.
- **Sources** : Policarpo, Oliveira, Comba, « Real-Time Relief Mapping on Arbitrary Polygonal Surfaces », I3D 2005 (marche linéaire + recherche binaire) ; Tevs et al., I3D 2008 (maxima hiérarchiques).
- **Limites** : texture et volume diffèrent de moins d'un pas, au-delà le volume retombe sur ses faces ; bornes de boucle fixes (48 pas grossiers, 96 fins, `MAX_COARSE_STEPS` / `MAX_FINE_STEPS`) ; la marche parallaxe ne sert qu'à l'ombrage des volumes, pas au sol seul.

## Arbres

### Placement — [`src/graphics/terrain/Trees.ts`](../src/graphics/terrain/Trees.ts) (`scatterTrees`)
- **Comment** : dans chaque polygone de `ocs_vegetation_surf`, grille de 15 m, une graine par cellule décalée dans [0,1 ; 0,9] par un hash entier déterministe (graine `x·7919 + y`, n° de cellule), gardée si dans le polygone et hors bâti (index de polygones par cellule). Au-delà de 2 400 arbres, un premier passage compte et le pas est multiplié par √(n / 2400). Conifère si `symbo` contient `CONI`, rayon 2,5-4,5 m. Buissons : grille de 38 m, rayon 1,1-2,3 m, dans les cases libres d'une grille d'occupation 128² (bâti, eau, bois, routes dilatées de 9 m). Sortie unorm16 (u, v, rayon cm, forme).
- **Pourquoi** : le PLAN IGN n'a pas d'arbres individuels. Grille bousculée : répartition régulière sans motif, déterministe et sans état, moins coûteuse qu'un Poisson-disk. Pas d'alignements de rue : la carte reste un dessin.
- **Sources** : Cook, « Stochastic Sampling in Computer Graphics », ACM TOG 1986 ; constantes du finaliseur MurmurHash3 (`0x85ebca6b`, `0xc2b2ae35`).
- **Limites** : densité uniforme (ni lisière ni clairière) ; graine par tuile sujette à collisions ; un polygone coupé au bord de tuile ne sème pas au-delà.

### Houppiers — [`src/graphics/materials/Trees.material.ts`](../src/graphics/materials/Trees.material.ts)
- **Comment** : un icosaèdre de 12 sommets par instance, mis à l'échelle (feuillu 1 × 0,85 × 1, conifère 0,6 × 2 × 0,6), soulevé de 1,7 ou 2,3 rayons, qui pousse à l'apparition. Vent : balancement de 22 % du rayon, phase selon la position, amplitude × uniform `wind`. Normales de sphère ; masqué hors zone dessinée ; MRT d'alpha positif (l'encre suit leurs sauts de profondeur).
- **Pourquoi** : l'encre ne trace que silhouette et hachures ; les normales sphériques cachent les facettes. Animation 100 % GPU.
- **Sources** : [TSL (wiki three.js)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
- **Limites** : ni tronc ; une teinte par forme, pas par arbre ; même vitesse et même amplitude relative de balancement pour tous.

## Trafic

### Extraction des voies — [`src/graphics/terrain/Traffic.ts`](../src/graphics/terrain/Traffic.ts) (`roadLanes`, `boatLanes`)
- **Comment** : lignes de `routier_route(_sup)` dont `symbo` est `AUTOROU` / `REGIONALE` / `LOCALE` : 30 / 13 / 10 m/s et 15 / 10 / 4 voitures par km ; `sens_circu` donne le sens (direct, inverse, double). Chaque segment est coupé au carré de la tuile par Liang-Barsky ; une sortie ferme la voie. Bateaux : la ligne du nom du cours d'eau (`toponyme_hydro_lin`), gardée si son milieu tombe sur `hydro_surf` ; 4 m/s, 3 par km.
- **Pourquoi** : le PLAN IGN n'a pas l'axe des grands cours d'eau, mais la ligne de nom le suit. Liang-Barsky donne directement les paramètres d'entrée et de sortie.
- **Sources** : Liang, Barsky, « A New Concept and Method for Line Clipping », ACM TOG 1984.
- **Limites** : pas de trafic sur `PRINCIPALE` ni `NON_CLASSEE` ; longueurs mesurées en (u, v) × largeur de tuile ; une voiture ne passe jamais d'une tuile à l'autre.

### Animation et rendu des véhicules — [`src/graphics/terrain/Traffic.ts`](../src/graphics/terrain/Traffic.ts) (`Traffic`), [`src/graphics/materials/Traffic.material.ts`](../src/graphics/materials/Traffic.material.ts)
- **Comment** : véhicules répartis au hasard sur leur voie (Park-Miller 16807, graine par tuile), vitesse ±25 %, sens alterné sur double sens. `step(dt)` avance modulo la longueur, segment courant cherché depuis le précédent ; `write` pose (u, v) et la direction (du, dv), dont la longueur code la taille, réduite à 0 sur les 20 m de chaque bout (`FADE_M`). Le shader pose une boîte orientée : voiture 8,8 × 3 × 3,6 m décalée de 3,2 m à droite, péniche 56 × 5 × 11 m décalée de 18 m.
- **Pourquoi** : quelques milliers de véhicules : une boucle CPU dans un `InstancedBufferAttribute` dynamique suffit, sans compute shader. Volumes grossis (×2, ×1,75) comme des symboles de carte, sinon 2 à 4 px.
- **Sources** : Park, Miller, « Random Number Generators: Good Ones Are Hard to Find », CACM 1988.
- **Limites** : upload du buffer entier chaque image par tuile visible ; la voiture rapetisse et réapparaît au début de sa voie ; aucune interaction entre véhicules ; pas de tangage sur pente ; `dt` plafonné à 100 ms.

## Réglages

- **Panneau (valeurs dans [`src/graphics/config/debug.values.json`](../src/graphics/config/debug.values.json))** : `buildings.technique` (`none` / `extrusion`), `buildings.height` ; `life.trees`, `life.cars`, `life.boats`, `life.wind` ; `terrain.landcover` (force du plan), `terrain.simplify` (hauteur effacée au loin) ; `shading.*` (marche dans les hauteurs : `fineSteps`, `stepTexels`, `coarseSteps`, `shadowSoftness`, `lodBias`, `contact`) ; `mask.*` (ellipse dessinée, qui borne aussi les volumes à l'encre ; en mode nuit, `ink.amount` ≤ 0,5 donc `pen` à 0, les volumes restent partout).
- **Config** : [`src/graphics/config/buildings.config.ts`](../src/graphics/config/buildings.config.ts) (`maxExtentKm` 8, `fullExtentKm` 5, `margin` 0,25, `cacheTiles` 400).
- **Constantes de code** : tailles et cadences de l'image du sol dans `Landcover.helper.ts` (`SIZE`, `AREA`, `FOCUS`, `REQUEST_MS`, `REVEAL_MS`) ; caches et file dans `Landcover.worker.ts` (`MAX_TILE_BYTES`, `MAX_RASTER_BYTES`, `MAX_CONCURRENT`, `PRIORITY`) ; largeurs et noms dans `Landcover.ts` (`ROAD_WIDTH_M`, `NAMES`) ; densités dans `Trees.ts` et `Traffic.ts`.
