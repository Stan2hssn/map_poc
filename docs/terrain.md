# Terrain et relief

Le sol de la carte est un relief réel, chargé en direct depuis la Géoplateforme IGN et affiché par une grille d'écran que le shader projette sur le sol puis soulève. `TerrainNode` tient la vue (centre lon/lat, largeur en km), choisit le niveau de tuiles, et pousse au GPU deux mosaïques d'altitudes : un détail à trous et un aperçu toujours complet.

```
gestes / flyTo -> TerrainNode (vue) -> GeoProjection (emprise, niveau)
  -> TerrainHeightsHelper (requêtes) -> TileCache -> IgnElevationProvider (WMTS BIL)
  -> HeightMosaic (détail + aperçu, R16F) -> Terrain.material (grille d'écran projetée, déplacement)
  -> masque elliptique ; à côté : Graticule (Survey), FlightPath (vols)
```

## Vue et navigation

### État de vue et lissage — [`src/graphics/nodes/terrain/Terrain.node.ts`](../src/graphics/nodes/terrain/Terrain.node.ts)
- **Comment** : les gestes (`moveBy`, `zoomAt`, `fling`) modifient une vue visée `_goal` ; la vue affichée la rattrape par lissage exponentiel `k = 1 - e^(-dt/τ)`, τ = `settings.ease` (250 ms), le zoom lissé en log. Glisse après lancer : vitesse × `e^(-dt/380)`. `zoomAt` garde fixe le point sous le curseur. `_viewOf` borne le centre (`clampCenter` dans la couverture SRTM, resserrée de la demi-hauteur de la zone dessinée), calcule l'emprise et le niveau.
- **Pourquoi** : lissage indépendant du framerate, qui suit le geste sans à-coups (référence de mouvement : Chartogne-Taillet). Borner la visée comme la vue affichée évite une cible inatteignable.
- **Sources** : lissage exponentiel indépendant du framerate (« frame rate independent damping », Rory Driscoll, 2016).
- **Limites** : vitesse mesurée en lon/lat × cos(lat), approximation locale. La profondeur de la vue n'est plafonnée (`_depth`, vers le 2:1 de la plate carrée) qu'au-delà d'une demi-circonférence méridienne (~20 000 km), hors de portée avec `maxExtentKm` à 12 000 km.

### Projection locale et grille WGS84G — [`src/graphics/terrain/GeoProjection.ts`](../src/graphics/terrain/GeoProjection.ts)
- **Comment** : plate carrée en km centrée sur (lon0, lat0) : `x = Δlon·R·cos(lat0)·π/180` vers l'est, `z = -Δlat·R·π/180` vers le sud, R = 6371,0088 km ; inverses exacts. `bounds()` donne un rectangle centré borné au monde. Grille IGN WGS84G : origine (-180°, 90°), tuile de 180/2^z degrés, 2^(z+1) colonnes × 2^z lignes ; `tilesCovering` liste les tuiles d'une emprise. Une unité de scène vaut `extentKm / blockSize` km (`blockSize` = 100).
- **Pourquoi** : sur 2 à quelques centaines de km, l'échelle juste au centre suffit (erreur < 1 % sur le Gard). Les uv restent linéaires en lon/lat, donc les tuiles WGS84G se plaquent sans reprojection, en CPU comme en shader ; Web Mercator ne correspond pas à la grille des altitudes IGN.
- **Sources** : [projection équirectangulaire](https://en.wikipedia.org/wiki/Equirectangular_projection) ; [OGC WMTS](https://www.ogc.org/standards/wmts/) (TileMatrixSet) ; [GetCapabilities du WMTS Géoplateforme](https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities).
- **Limites** : cos(lat0) fixe, d'où une distorsion est-ouest croissante loin du centre, forte en vue monde (12 000 km). Sphère, pas ellipsoïde. Pas d'antiméridien : bornes coupées à ±180°, centre forcé à lon 0 si la demi-largeur dépasse 180°.

## Altitudes

### Choix du niveau — [`src/graphics/terrain/HeightMosaic.ts`](../src/graphics/terrain/HeightMosaic.ts) (`levelFor`)
- **Comment** : `z = round(log2(texel_z0 / (extentKm / segments)))`, borné à 1..14, pour qu'un texel corresponde à peu près à un intervalle de grille. L'aperçu est 3 niveaux plus bas (`coarse.levels`).
- **Pourquoi** : charger plus fin que la grille ne se verrait pas ; plus grossier ferait des facettes.
- **Sources** : pyramide de tuiles (LOD par niveaux), technique classique des globes virtuels.
- **Limites** : la référence est la grille de la zone de détail, pas la densité réelle à l'écran de la grille projetée.

### Requêtes et priorité — [`src/graphics/nodes/terrain/TerrainHeights.helper.ts`](../src/graphics/nodes/terrain/TerrainHeights.helper.ts)
- **Comment** : `requests()` empile des groupes : une pyramide basse (niveaux 1, aperçu-6, aperçu-3, aperçu-1) et l'aperçu sur l'emprise élargie de 100 % de chaque côté, puis le détail élargi de 25 %. Chaque groupe est trié du centre vers le bord ; en vol, les tuiles de l'arrivée passent devant. Une clé (`groupsKey`) évite de relancer une requête identique.
- **Pourquoi** : quelques tuiles basses garantissent un aperçu immédiat même après un long vol ; le tri centre-bord remplit d'abord ce qu'on regarde.
- **Sources** : chargement progressif grossier vers fin (coarse-to-fine) des moteurs de terrain tuilés.
- **Limites** : la clé ne retient que la première et la dernière tuile de chaque groupe, suffisant pour des emprises rectangulaires triées.

### Fournisseur IGN — [`src/graphics/terrain/IgnElevationProvider.ts`](../src/graphics/terrain/IgnElevationProvider.ts)
- **Comment** : WMTS GetTile sur `data.geopf.fr/wmts`, `FORMAT=image/x-bil;bits=32`, `TILEMATRIXSET=WGS84G` : 256 × 256 float32 bruts (262 144 octets, taille vérifiée), valeurs < -1000 (no-data -99999) en NaN. Si la tuile touche la France (rectangle approximatif) et z ∈ 6..14 : couche `HIGHRES` (RGE ALTI), ses 0 traités comme trous ; puis complément texel à texel par `SRTM3` (z 1..10). 404 = pas de donnée. File de 6 requêtes, timeout 10 s par tentative (`AbortSignal.any`), deux nouvelles tentatives à 300 et 900 ms. Le contrat `IElevationProvider` ([interface](../src/graphics/terrain/ElevationProvider.interface.ts)) est injecté dans `TerrainNode` par `Main.universe.ts`.
- **Pourquoi** : le BIL float32 donne les altitudes exactes sans décodage d'image (contrairement aux PNG terrain-RGB) ; service gratuit, sans clé, CORS ouvert. Le timeout libère une place quand une réponse IGN reste pendante. HIGHRES renvoie hors de France des aplats à 0 (Luxembourg), d'où leur remplacement par SRTM3.
- **Sources** : couches `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` et `.SRTM3` (GetCapabilities ci-dessus) ; RGE ALTI (IGN, MNT 1 à 5 m) ; SRTM (NASA, 3″ d'arc, ~90 m) ; [`AbortSignal.any`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static). Mesuré au premier jalon : 120 à 210 ms par tuile, `Cache-Control: private, max-age=1814400` (21 jours).
- **Limites** : un vrai 0 m en France (littoral, polders) passe en SRTM. Le rectangle France inclut Belgique, Suisse et Luxembourg (requêtes HIGHRES inutiles). Hors de France, rien au-delà du niveau 10 (~76 m par texel). Cache HTTP laissé au navigateur.

### Demi-flottants — [`src/graphics/terrain/HalfFloat.ts`](../src/graphics/terrain/HalfFloat.ts)
- **Comment** : `encodeHalf` convertit en uint16 par `DataUtils.toHalfFloat`, les trous en `0x7e00` (NaN) ; `halfToFloat` lit une table de 65 536 entrées précalculée.
- **Pourquoi** : mémoire divisée par deux (128 Ko par tuile), texture R16F filtrable en linéaire partout (R32F filtrable demande `float32-filterable` en WebGPU). La table évite la conversion dans les boucles CPU.
- **Sources** : [half-precision floating-point](https://en.wikipedia.org/wiki/Half-precision_floating-point_format) ; three.js `DataUtils`.
- **Limites** : pas de 0,5 m entre 512 et 1024 m, 1 m jusqu'à 2048 m, 2 m jusqu'à 4096 m, 4 m au-delà : marches possibles en haute montagne aux plus petites largeurs. Maximum 65 504.

### Cache de tuiles — [`src/graphics/terrain/TileCache.ts`](../src/graphics/terrain/TileCache.ts)
- **Comment** : LRU sur une `Map` (ordre d'insertion) : `get` réinsère la clé, l'éviction retire les premières au-delà de 320 tuiles (~40 Mo). `request(ids)` annule par `AbortController` tout chargement qui n'est plus demandé, puis lance ce qui manque dans l'ordre reçu. Une erreur réseau est notée tuile vide (`data: null`) : le parent la remplace.
- **Pourquoi** : LRU en O(1) sans liste chaînée. Annuler ce qui sort de la vue réserve les 6 places à la vue courante pendant les glissés et les vols.
- **Sources** : [`Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) (itération dans l'ordre d'insertion).
- **Limites** : une erreur passagère reste « vide » jusqu'à l'éviction. Capacité comptée en tuiles, pas en octets (256 Ko téléchargés en float32, 128 Ko en cache).

### Mosaïques détail et aperçu — [`src/graphics/terrain/HeightMosaic.ts`](../src/graphics/terrain/HeightMosaic.ts), [`TerrainHeights.helper.ts`](../src/graphics/nodes/terrain/TerrainHeights.helper.ts)
- **Comment** : `composeMosaic` colle les tuiles d'un niveau en une grille Uint16, ligne par ligne. Détail : emprise de la vue + 5 %, trous à 0 et masque `valid` (R8, 255 = donnée). Aperçu : tout le sol (emprise × 3, `groundSpan`), au niveau le plus fin entièrement chargé sur la vue + 25 % ; chaque texel manquant est interpolé en bilinéaire (pixels centrés) depuis le premier ancêtre chargé, et la tuile comblée gardée dans `_fills` (128 au plus, ~16 Mo). `_due` recompose si la couche est périmée (niveau, emprise) ou si des tuiles sont arrivées, au plus toutes les 150 ms en vol ou en chargement. `upload` remplace les données de la `DataTexture`, ou la texture si la taille change ; `mosaicUvTransform` donne les uniforms d'offset et d'échelle.
- **Pourquoi** : une texture par couche, pas une par tuile : un seul échantillonnage, aucune couture. Le comblement par l'ancêtre évite tout relief plat pendant le chargement (pas de pop). Le shader divise la hauteur filtrée par la validité filtrée, ce qui redonne la moyenne des texels valides ; le CPU n'a plus qu'à recopier des tuiles (pics de vol passés de 870 ms à moins de 80 ms au jalon du 2026-09-17).
- **Sources** : repli sur le niveau parent des moteurs de terrain tuilés ; [three.js `DataTexture`](https://threejs.org/docs/pages/DataTexture.html) (`RedFormat`, `HalfFloatType`).
- **Limites** : composition et envoi synchrones sur le thread principal, avec une nouvelle `Uint16Array` à chaque fois. Texture réallouée à chaque changement de taille. Un ancêtre très éloigné donne un aperçu en facettes (atténué par la B-spline du shader).

### Lecture des altitudes — [`src/graphics/materials/Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts) (`terrainMeters`), CPU dans `TerrainHeights.helper.ts`
- **Comment** : shader : `mix(aperçu, heights / max(valid, 1e-3), valid)`, ramené à 0 en mer. L'aperçu, très agrandi, est lu en B-spline cubique par 4 lectures bilinéaires (`smoothRead`) ; `detailed`/`smooth` à faux réduisent le coût pour les lectures secondaires. CPU : `heightAt` et `mosaicSample` refont la fonte détail/aperçu en bilinéaire pondéré par les seuls texels valides (caméra, labels, avions). `mosaicRange` donne min et max sur ~256 × 256 échantillons.
- **Pourquoi** : même règle de fonte des deux côtés, pour que ce qui est posé sur le sol tombe sur le relief affiché. Mer à 0 : sinon le fond marin fixerait le plancher et la caméra y plongerait.
- **Sources** : filtrage cubique par lectures bilinéaires (Sigg et Hadwiger, « Fast Third-Order Texture Filtering », GPU Gems 2, 2005).
- **Limites** : le CPU lit l'aperçu en bilinéaire, le shader en B-spline : léger écart là où seul l'aperçu couvre. `mosaicRange` sous-échantillonne, un pic étroit peut échapper au max.

### Échelle du relief — [`src/graphics/nodes/terrain/Terrain.node.ts`](../src/graphics/nodes/terrain/Terrain.node.ts) (`heightScale`, `_easeRange`)
- **Comment** : `heightScale = 0,001 / kmPerUnit · exagération · √(extentKm / 40)`, plafonné à `maxRelief / relief` (25 unités). Plancher (altitude min sous la vue) et relief (max - min) lissés en 150 ms ; la hauteur affichée vaut `(h - plancher) · heightScale`.
- **Pourquoi** : la racine empêche les grandes vues de s'aplatir et les petites de se hérisser ; le plancher garde le même socle à l'Aigoual comme à l'Everest. Au-delà de ×4 sur 130 km, les versants tournent en rideaux (mesuré au premier jalon).
- **Sources** : —
- **Limites** : le plafond varie avec le relief en vue : une même montagne change de hauteur selon ce qui l'entoure.

## Maillage du sol

### Grille d'écran projetée — [`src/graphics/terrain/GroundGeometry.ts`](../src/graphics/terrain/GroundGeometry.ts), `groundFromScreen` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : grille (segments + 1)² dont x, z sont des coordonnées d'écran 0..1, marges comprises (4 % sur les côtés pour la parallaxe, 30 % en bas pour le relief qui monte, 2 % en haut) ; index Uint32 dans le sens direct à l'écran, normale +Y factice. Le vertex shader lance pour chaque sommet un rayon depuis la caméra (`viewProjectionInverse`, `viewWorld`) jusqu'au plan y = 0, borné à `groundReach` (320 unités), puis le soulève de l'altitude lue. Pente et creux sont calculés par sommet. Mesh sans frustum culling, dessiné après le bâti (`renderOrder`) pour que le test de profondeur écarte le sol caché.
- **Pourquoi** : toutes les subdivisions tombent dans l'image, à densité uniforme à l'écran : LOD sans quadtree ni coutures, c'est le terrain qui défile dessous.
- **Sources** : Claes Johanson, « Real-time water rendering – introducing the projected grid concept », mémoire de master, Lund University, 2004.
- **Limites** : les sommets glissent sur le terrain quand la caméra bouge, le relief fin « nage » si la grille est lâche. Sous quelques pixels par triangle, l'ombrage par quads 2 × 2 multiplie le coût du shader du sol. Le relief qui dépasse les marges n'est pas couvert.

### Subdivisions adaptatives — [`Terrain.node.ts`](../src/graphics/nodes/terrain/Terrain.node.ts) (`_wantedSegments`, `applySettings`)
- **Comment** : grille 16 × 16 d'altitudes CPU sur la zone de détail, différence seconde moyenne `|∂²h|` (unités de scène) mappée en log entre 0,3 (plat) et 2,5 (accidenté) vers 256, 512 ou 1024 segments ; 1024 au moins dès que terre et mer sont en vue. Plafonné par `settings.segments`. Recalculé seulement quand la vue ou les mosaïques changent (plus de mille lectures), et appliqué seulement quand tout est posé (`settled`).
- **Pourquoi** : en montagne la grille compte (Alpes à 30 km : 256 → 512 change 9 % des pixels pour 23,7 → 48,9 ms GPU, mesure du 2026-09-20) ; sur un plateau elle ne change rien. Le trait de côte se dessine sur les sommets, d'où le plancher côtier.
- **Sources** : Laplacien discret (différence seconde).
- **Limites** : changement seulement à l'arrêt, d'où un saut possible à l'arrivée.

### Cadrage de la grille et ombres — [`Terrain.node.ts`](../src/graphics/nodes/terrain/Terrain.node.ts) (`_fitGrid`, `_caster`)
- **Comment** : au rendu à l'encre (`pen ≥ 0,5`), l'ellipse du masque (48 points, élargie de `jitter / 2`, au sol et au sommet du relief) est projetée à l'écran ; la grille ne couvre que ce rectangle (`screenRect`) + 3 %, toute la largeur et le bas si l'ellipse passe derrière la caméra. Sinon la grille couvre tout l'écran. Les ombres portées viennent d'une seconde grille de 192 segments au plus, rendue seulement sur `SHADOW_CASTERS_LAYER`.
- **Pourquoi** : hors de la zone dessinée, le sol est effacé en papier : inutile de le calculer, et les sommets se concentrent sur ce qui se voit. Une grille d'ombre lâche suffit à un relief lissé.
- **Sources** : —
- **Limites** : le rectangle englobe l'ellipse, ses coins restent calculés pour rien.

## Masque elliptique — [`src/graphics/materials/Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts) (`drawnMask`), uniforms dans `Terrain.node.ts`
- **Comment** : ellipse posée au sol, centrée sur le point visé, dans les axes de la vue (`maskAxis`, sans parallaxe ni roulis) ; distance normalisée par `maskRadius · maskScale`, bord fondu sur `softness` (0,6) et rendu irrégulier par le bruit de brume accroché aux coordonnées géographiques, d'amplitude `jitter` (0,12). `maskScale` grandit en log de ×1 à ×3 entre 4 et 600 km de largeur, plafonné pour que le plus grand rayon ne dépasse pas `reach` (95 unités). Lisible au vertex shader.
- **Pourquoi** : composition de carte dessinée à la Chartogne-Taillet ; sur la carte et non à l'écran, pour que la zone reste attachée au terrain. L'élargissement garde quelque chose à voir à l'échelle d'une région ; la borne cache la fin du sol (fondu `GROUND_FADE` de 95 à 150 unités).
- **Sources** : —
- **Limites** : rayons initiaux du code (95/95) écrasés par `debug.values.json` (70/95) : le rendu se lit dans le JSON.

## Graticule — [`src/graphics/terrain/Graticule.ts`](../src/graphics/terrain/Graticule.ts), utilisé par [`Survey.node.ts`](../src/graphics/nodes/survey/Survey.node.ts)
- **Comment** : `graticuleStep` prend le plus petit pas sexagésimal rond (15″, 30″, 1′, 2′, 5′, 10′, 15′, 30′, 1° … 45°) donnant au plus `max` méridiens (6 dans Survey) ; `graticuleValues` énumère les multiples entiers du pas ; `formatDegrees` arrondit à la seconde et écrit `d°`, `d°mm′` ou `d°mm′ss″` selon le pas. Le shader de Survey drape les lignes avec `terrainHeight`.
- **Pourquoi** : pas ronds comme sur les cartes topographiques, nombre de lignes borné à toute échelle.
- **Sources** : conventions de quadrillage géographique des cartes topographiques.
- **Limites** : le pas est choisi sur la seule étendue en longitude et sert aussi aux latitudes. `i·step` peut porter une erreur flottante (sans effet après l'arrondi à la seconde).

## Vols — [`src/graphics/terrain/FlightPath.ts`](../src/graphics/terrain/FlightPath.ts), `flyTo` et `_fly` dans `Terrain.node.ts`
- **Comment** : solution fermée de van Wijk et Nuij : `r_i = ln(√(b_i² + 1) - b_i)`, longueur `S = (r1 - r0)/ρ`, largeur `w(s) = w0·cosh(r0)/cosh(r0 + ρs)`, part parcourue `u(s)` ; sur place, zoom seul `w = w0·e^(±ρs)`. ρ = 0,8. Durée `400 + 230·S` ms bornée à 0,9–3,2 s, `s` parcouru en `power2.inOut`. Pendant le vol, les tuiles et le plan de l'arrivée sont demandés en priorité.
- **Pourquoi** : chemin optimal dans l'espace (u, w) à vitesse perçue constante, celui du `flyTo` de Mapbox ; ρ plus petit que 1,42 aplatit le vol (Marseille-Paris culmine vers 200 km de large au lieu de la France entière).
- **Sources** : J. J. van Wijk et W. A. A. Nuij, « Smooth and efficient zooming and panning », IEEE InfoVis 2003 ; [Mapbox GL JS `flyTo`](https://docs.mapbox.com/mapbox-gl-js/api/map/#map#flyto).
- **Limites** : centre interpolé linéairement en lon/lat, pas sur un grand cercle. Le `power2.inOut` casse un peu la vitesse constante aux extrémités (choix assumé). Largeur bornée ensuite à 2–12 000 km.

## Réglages

| Réglage | Où | Effet |
|---|---|---|
| Vue initiale, bornes du centre, 2–12 000 km, `easeMs`, `maxZoom`, `blockSize`, `groundSpan`, `maxRelief`, `cacheTiles`, marges, `coarse.levels`, masque (`softness`, `jitter`, `widen`, `reach`) | [`src/graphics/config/terrain.config.ts`](../src/graphics/config/terrain.config.ts) | valeurs de départ et constantes |
| `terrain.exaggeration` (2,5), `terrain.segments` (1024, options 256 à 1536), `terrain.adaptive` (vrai), `mask.radiusX` / `mask.radiusY` (70 / 95), `mask.softness` (0,6), `mask.jitter` (0,12) | [`src/graphics/config/debug.values.json`](../src/graphics/config/debug.values.json), liés au panneau dans [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts) | écrasent la config : c'est le rendu effectif |
| Vol (`FLIGHT`), rugosité (`ROUGHNESS`), cadrage (`GRID_FIT`), grille d'ombre (`CASTER_SEGMENTS`), glisse (`GLIDE_MS`), lissage du relief (`RANGE_EASE_MS`) | constantes en tête de `Terrain.node.ts` | non exposés au panneau |
| `RECOMPOSE_MS` (150), `MAX_FILLS` (128) | `TerrainHeights.helper.ts` | rythme de recomposition, mémoire de l'aperçu |
| File (6), timeout (10 s), nouvelles tentatives, rectangle France | `IgnElevationProvider.ts` | réseau |
