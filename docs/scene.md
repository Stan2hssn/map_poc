# Scène : étiquettes, lieux, caméra, ciel, timeline

Tout ce qui vit au-dessus du relief : les lieux (sources réseau, index, contours), leurs noms dessinés en SDF, le survol qui colorie un territoire sur le sol, la caméra et les gestes, le ciel (nuages, avions), les relevés, l'intro et le panneau d'archives. Le passage de l'intro est rythmé par une timeline dont les pistes JSON se règlent dans SONDE. Les noms, l'intro et le panneau ont chacun leur scène, posée sur l'image finie par un `OverlayPass` : la passe d'encre ne les hachure pas.

```
PlaceSources / AdminAreas / FrenchCommunesHelper -> PlaceIndex (+ Rings)
  -> Labels3DNode (sélection, étages, rigs) -> SdfFont (DistanceField) -> Label.material -> OverlayPass
  -> survol : rayon -> lieu contenant -> AreaAccentsHelper -> AreaMaskHelper (SDF 256²) -> Terrain.material (hover*)
gestes -> TerrainGesturesHelper -> TerrainNode (vue) ; MapCameraNode cadre (inclinaison, yaw, roulis, parallaxe)
timeline.tracks.json -> IntroTheatre (Theatre + ease) -> pageTransition, --intro-*, Labels3DNode.intro
```

## Lieux

### Sources réseau — [`src/graphics/places/PlaceSources.ts`](../src/graphics/places/PlaceSources.ts)
- **Comment** : `fetch` + `AbortSignal`. Villes du monde : Natural Earth `ne_10m_populated_places_simple` (v5.1.2, via jsDelivr, population `pop_max`), filtrées sur `FRA` par `Labels3DNode`. geo.api.gouv.fr : département d'un point, communes d'un département (centre, population, code INSEE), contour d'une commune et commune sous un point. Les GeoJSON `Polygon`/`MultiPolygon` passent par `ringsOfGeometry` (anneaux extérieurs).
- **Pourquoi** : le contour d'une commune n'est demandé qu'au survol ; servi avec la liste, un département passerait de dizaines de Ko à plusieurs Mo.
- **Sources** : [Natural Earth](https://www.naturalearthdata.com) ; [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) ; [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif).
- **Limites** : trous des polygones ignorés. Deux services tiers, sans cache ni repli hors ligne.

### Départements et régions — [`src/graphics/places/AdminAreas.ts`](../src/graphics/places/AdminAreas.ts)
- **Comment** : un GeoJSON simplifié par niveau (france-geojson, branche `master` via jsDelivr). La « population » est remplacée par l'aire (formule du lacet, degrés carrés × 1e6) pour classer ; centre = moyenne des sommets du plus grand anneau.
- **Pourquoi** : geo.api.gouv.fr ne sert ni centre ni contour à ces niveaux ; un seul fichier sert aux noms et au survol.
- **Sources** : [france-geojson](https://github.com/gregoiredavid/france-geojson) ; formule du lacet (shoelace formula).
- **Limites** : aire biaisée en latitude (sans effet sur un classement). Barycentre de sommets : peut tomber hors d'un territoire concave. DOM-TOM absents. Branche non figée.

### Communes à la demande — [`src/graphics/nodes/labels/FrenchCommunes.helper.ts`](../src/graphics/nodes/labels/FrenchCommunes.helper.ts)
- **Comment** : sous 250 km de largeur de vue, 3 × 3 sondes réparties sur la vue, chacune mémorisée sur une grille de 0,05° ; chaque sonde demande le département du point, puis toutes ses communes, une seule fois par code.
- **Pourquoi** : la France entière pèse ~3,9 Mo de JSON, un département 10 à 100 Ko : on ne paie que ce qui est vu.
- **Sources** : [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif).
- **Limites** : sondes et départements jamais oubliés. Un département coincé entre deux sondes peut manquer. Pas de nouvel essai après une erreur réseau.

### Index des lieux — [`src/graphics/places/PlaceIndex.ts`](../src/graphics/places/PlaceIndex.ts)
- **Comment** : tableau trié par population décroissante. `add` : clé de nom normalisée (NFD sans diacritiques, lettres seules) ; un homonyme à moins de 0,25° est fusionné, le plus peuplé gagne et hérite du code INSEE et du contour. `pick` parcourt l'emprise et s'arrête sous 0,5 % de la population du premier retenu. `search` : préfixe puis sous-chaîne. `containing` : cadre en `WeakMap` puis `ringsContain`. `version` s'incrémente à chaque ajout.
- **Pourquoi** : Natural Earth (agglomérations) et geo.api (communes) nomment les mêmes villes avec des populations différentes ; la fusion garde un seul point et le code qui mène au contour.
- **Sources** : [String.prototype.normalize](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize) (MDN).
- **Limites** : `add` retrie tout, `containing` est linéaire : prévu pour quelques milliers de lieux. Deux communes homonymes à moins de ~25 km fusionnent à tort.

### Anneaux (contours) — [`src/graphics/places/Rings.ts`](../src/graphics/places/Rings.ts)
- **Comment** : seul lieu du type `Ring` et de `KM_PER_DEGREE` (111,32). `ringsOfGeometry` : anneaux extérieurs d'un `Polygon`/`MultiPolygon`. `ringsContain` : lancer de rayon pair-impair. `distanceToRingsKm` : plate carrée locale (kx = 111,32 × cos lat), distance point-segment minimale. `ringsBounds` : cadre.
- **Pourquoi** : simple et suffisant à l'échelle d'un territoire, sans dépendance de type turf.js.
- **Sources** : [PNPOLY, W. R. Franklin](https://wrfranklin.org/Research/Short_Notes/pnpoly.html).
- **Limites** : pas de géodésie, erreur croissante sur de grandes étendues. Point exactement sur le bord indéterminé. Pas de trous.

## Texte en SDF

### Champ de distance — [`src/graphics/text/DistanceField.ts`](../src/graphics/text/DistanceField.ts)
- **Comment** : transformée de distance euclidienne exacte de Felzenszwalb-Huttenlocher, en deux passes 1D (lignes puis colonnes) par enveloppe inférieure de paraboles, O(n). Deux transformées (dedans, dehors), signe = dehors − dedans, encodé sur un octet : 128 sur le bord, ±127 à `spread` pixels. Le masque d'entrée est seuillé à 127.
- **Pourquoi** : exacte, linéaire, en JS pur, sans fichier pré-généré (contre msdfgen hors ligne, ou 8SSEDT/chamfer moins précis). Le shader cherche toujours 0,5, quelle que soit l'échelle.
- **Sources** : [P. Felzenszwalb, D. Huttenlocher, *Distance Transforms of Sampled Functions*](https://cs.brown.edu/people/pfelzens/dt/) ; C. Green (Valve), *Improved Alpha-Tested Magnification for Vector Textures and Special Effects*, SIGGRAPH 2007.
- **Limites** : monocanal, coins arrondis à fort grossissement (une MSDF les garderait). L'antialiasing du canvas est perdu au seuillage. Calcul synchrone sur le thread principal.

### Atlas de police — [`src/graphics/text/SdfFont.ts`](../src/graphics/text/SdfFont.ts)
- **Comment** : canvas 2D, chaque caractère du jeu fixe rendu à 48 px dans une case de 48 + 2 × 8 px, plus une case carré plein (filets) et une case disque (point au sol). Mesures par `measureText` (avance, hauteur du H = capitale). Canal rouge -> `signedDistanceField(spread = 8)` -> `DataTexture` `RedFormat`. Cache par (graisse, famille, taille du jeu).
- **Pourquoi** : la même police que le DOM (Manrope) sans pipeline msdf-bmfont ni fichier à livrer ; un seul matériau dessine texte, filets et points.
- **Sources** : [TextMetrics](https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics) (MDN) ; [msdfgen](https://github.com/Chlumsky/msdfgen), alternative écartée.
- **Limites** : ni crénage ni ligatures. Caractère absent sauté au dessin, compté comme une espace par `textWidth`. La police doit être chargée avant la construction, sinon l'atlas grave la police de repli.

### Matériau des étiquettes — [`src/graphics/materials/Label.material.ts`](../src/graphics/materials/Label.material.ts)
- **Comment** : un quad instancié par caractère ou trait ; attributs `glyph` (uv dans l'atlas), `screen` (coin et taille en px), `tint` (part de survol), `fade`. Bord : `smoothstep` autour de 0,5 sur `fwidth(distance) × 0,7`. `DoubleSide` (l'axe y de l'écran inverse les triangles), sans test de profondeur. `pixelScale(hauteur, fov)` = `2 tan(fov/2) / hauteur` : unités de scène par pixel et par unité de profondeur.
- **Pourquoi** : une bande d'adoucissement mesurée à l'écran garde le trait net à toutes les tailles ; une bande fixe en unités du champ flouterait les grands corps et crénelerait les petits.
- **Sources** : [three.js InstancedBufferGeometry](https://threejs.org/docs/#api/en/core/InstancedBufferGeometry) ; Green 2007.
- **Limites** : couleurs d'encre et d'accent en dur (`LinearSRGBColorSpace`, octets écrits tels quels sur le canvas).

## Étiquettes et survol

### Sélection et mise en page — [`src/graphics/nodes/labels/Labels3D.node.ts`](../src/graphics/nodes/labels/Labels3D.node.ts)
- **Comment** : 14 rigs pré-alloués (7 noms visibles + 7 qui sortent), chacun un groupe posé sur le point ancré, orienté comme la caméra, mis à l'échelle `pixelScale × profondeur` (1 unité = 1 px). Re-sélection au plus toutes les 250 ms : `PlaceIndex.pick` dans la vue, filtre de distance (`GROUND_FADE.near`), écart écran minimal 120 × 70 px, puis attribution gloutonne d'un des 3 étages sans chevauchement des boîtes de noms. Entrée 460 ms / sortie 220 ms décalées par nom, pas borné à 40 ms, `easeOut` cubique. Le niveau (`focus.config`) choisit les communes ou `fetchAreas`.
- **Pourquoi** : le texte dans le rendu partage masque et caméra avec la carte ; une scène à part évite l'encre. Dessin et zone cliquable partagent une seule transformation.
- **Sources** : [three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster) ; placement d'étiquettes glouton par priorité, approche classique de la cartographie.
- **Limites** : glouton, sans optimisation globale ; 7 noms au plus. Classe volumineuse (rendu, survol, requêtes).

### Survol d'un territoire — [`src/graphics/nodes/labels/Labels3D.node.ts`](../src/graphics/nodes/labels/Labels3D.node.ts)
- **Comment** : rayon pointeur -> plan y = 0 -> second plan à l'altitude trouvée -> `geoOf`. Départements/régions : `PlaceIndex.containing`. Communes : contour connu, sinon `fetchCommuneAt` après 140 ms de repos ; les communes sans étiquette sont gardées dans `_strays`. « Déjà dedans » (`_isHere`) : pas d'accent si le centre de vue est dans le territoire ou à moins de 6 % de la largeur de vue de son bord, pour une vue d'au plus 3 fois son étendue. Survol d'un nom : raycast sur un plan invisible à la taille du nom ; à 28 px d'un nom, la parallaxe se fige (`aiming`).
- **Pourquoi** : le délai évite une requête par pixel ; la règle « déjà dedans » évite de colorier tout l'écran à l'échelle d'une ville.
- **Sources** : [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif) ; PNPOLY.
- **Limites** : une seule correction d'altitude, approximative sur relief marqué. Rien hors de France. Pas de survol du sol pendant un vol.

### Masque de zone — [`src/graphics/places/AreaMask.helper.ts`](../src/graphics/places/AreaMask.helper.ts)
- **Comment** : cadre lon/lat (`ringsBounds`) + 6 % de marge ; contour rempli sur un canvas 256², alpha -> `signedDistanceField(spread 24)` -> `CanvasTexture` (nord en haut). `bounds` = (ouest, nord, étendue lon, étendue lat négative), lu par le sol pour échantillonner en lon/lat.
- **Pourquoi** : un champ plutôt qu'un aplat : le sol en tire un trait de périmètre de largeur constante à l'écran (par dérivée), à toute échelle.
- **Sources** : Green 2007 ; Felzenszwalb-Huttenlocher.
- **Limites** : 256² étiré sur le cadre (pixels non carrés, détail perdu sur un grand territoire allongé). Rastérisation et SDF synchrones à chaque nouveau territoire.

### Accents — [`src/graphics/places/AreaAccents.helper.ts`](../src/graphics/places/AreaAccents.helper.ts)
- **Comment** : `HOVER_SLOTS` (3) places, chacune avec son `AreaMaskHelper`. `hold(key)` vise 1 pour la place qui tient le territoire, sinon prend la plus refluée. Approche `min(1, ms × 2,2/s)` vers la cible, écrite dans `terrainSettings.hoverReveals` / `hoverBounds`. Textures liées dès le constructeur.
- **Pourquoi** : plusieurs places laissent refluer l'ancien territoire pendant que le nouveau entre. Un matériau compilé garderait la texture d'attente : d'où la liaison avant la première compilation.
- **Sources** : —
- **Limites** : au-delà de 3 territoires simultanés, une transition est coupée.

## Caméra et navigation

### Caméra carte — [`src/graphics/nodes/cameras/MapCamera.node.ts`](../src/graphics/nodes/cameras/MapCamera.node.ts)
- **Comment** : FOV 32°, distance telle que la zone de détail remplisse 95 % de la largeur. zoom = 1 − log(extent/min) / log(max/min). Inclinaison `lerp(tiltNear, tiltFar, 1 − zoom³)`. Yaw lissé en `1 − e^(−dt/ease)` ; de loin (zoom < 0,72-0,86) il revient au nord (500 ms). Roulis = somme bornée des vitesses de rotation, de déplacement latéral et de souris, lissée à 120 ms. Parallaxe souris dans le plan caméra (6 % × 3,5 % de la distance, visée décalée de 10 %), figée quand un nom est visé. Plancher à 0,5 au-dessus du relief.
- **Pourquoi** : la carte bouge (le terrain), la caméra ne fait que cadrer. Lissages en `dt` : indépendants de la cadence.
- **Sources** : lissage exponentiel indépendant de la cadence ; référence visuelle Chartogne-Taillet.
- **Limites** : pas de collision avec le relief hors du point caméra. Échelle de zoom fixée par `TERRAIN_CONFIG`.

### Gestes — [`src/graphics/nodes/cameras/TerrainGestures.helper.ts`](../src/graphics/nodes/cameras/TerrainGestures.helper.ts)
- **Comment** : Pointer Events + `setPointerCapture`. Glisser : positions projetées sur y = 0 ; de près (zoom 0,72 à 0,86), l'angle du point saisi autour du point visé part en rotation (bornée à 0,3 rad, nulle à moins de 10 unités de lui), le reste en translation (pas borné à 20). Lancer : vitesse moyenne sur les 90 dernières ms. Molette : zoom `exp(deltaY × 0,0015)` autour du point visé ; pincement : rapport des écarts.
- **Pourquoi** : le point saisi reste sous le doigt. La capture ferme le geste même relâché hors du canvas.
- **Sources** : [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) ; [Element.setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) (MDN).
- **Limites** : plan y = 0 et non le relief, léger glissement en montagne. Pas de rotation à deux doigts ; pincement sans lancer.

### Vues et focus — [`src/graphics/config/views.config.ts`](../src/graphics/config/views.config.ts), [`focus.config.ts`](../src/graphics/config/focus.config.ts)
- **Comment** : `MAP_VIEWS` (Paris 30 km, France 1150 km, Monde = `maxExtentKm`) et `CITY_EXTENT_KM` (3 km), lus par `MapChrome` et `Main.universe` (`flyTo`, `goToPlace` qui cadre un contour ou la ville). `MAP_FOCUS` : communes, départements, régions ; `Labels3DNode.setFocus` fait sortir les noms avant de changer de jeu.
- **Pourquoi** : un manifest explicite plutôt que des valeurs dispersées dans les composants. Les clés de focus servent aussi d'`AreaLevel`.
- **Sources** : vol de van Wijk et Nuij (2003), voir [terrain.md](terrain.md).
- **Limites** : un niveau ajouté à `MAP_FOCUS` doit l'être aussi dans `FILES` d'`AdminAreas.ts` (le compilateur le signale à l'appel de `fetchAreas`).

## Ciel et relevés

### Nuages — [`src/graphics/nodes/sky/Clouds.node.ts`](../src/graphics/nodes/sky/Clouds.node.ts)
- **Comment** : `InstancedMesh` de 12 plans tournés vers la caméra autour de y, une case de la texture de nuages par instance. Couronne de ±45° devant la caméra (PRNG Park-Miller), 12,5 à 17° sous l'horizon ; ils suivent zoom et translation de la carte, le vent, et sont reposés ailleurs en sortant. `alphaTest` 0,45.
- **Pourquoi** : des nuages peints plutôt que volumétriques, cohérents avec l'encre et quasi gratuits.
- **Sources** : générateur de Park et Miller (« minimal standard », 1988) ; [three.js InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh).
- **Limites** : vers l'avant seulement, un demi-tour rapide les fait réapparaître d'un coup. Bords nets, pas de transparence douce.

### Avions — [`src/graphics/nodes/sky/Planes.node.ts`](../src/graphics/nodes/sky/Planes.node.ts)
- **Comment** : 4 boîtes fusionnées (`mergeGeometries`), 4 instances : attente de 2 à 9 s puis traversée droite (~26 s) du cercle de la zone dessinée. Taille et vitesse rapportées à 12 km de largeur de vue (bornées), effacés entre 25 et 70 km. Ombre : même géométrie aplatie, projetée selon le soleil jusqu'au relief. `drawnMask` efface hors zone.
- **Pourquoi** : indice d'échelle et de vie à faible coût ; `lively` empêche l'univers de baisser la cadence.
- **Sources** : [BufferGeometryUtils](https://threejs.org/docs/#examples/en/utils/BufferGeometryUtils).
- **Limites** : ombre sans shadow map ni occlusion du relief. `Math.random`, non déterministe.

### Relevés — [`src/graphics/nodes/survey/Survey.node.ts`](../src/graphics/nodes/survey/Survey.node.ts)
- **Comment** : pas de graticule `graticuleStep` (6 lignes au plus), lignes échantillonnées 360 fois en uv du bloc, hauteur lue dans le shader + 0,15. Croisements en points instanciés, anneau sur le plus central. Poussière : 6000 grains entièrement GPU, position = `mod(graine + dérive + vent − caméra, boîte)` autour de la caméra (demi-côté 24). Coordonnées nord/ouest en HTML, `translate3d`.
- **Pourquoi** : zéro coût CPU par grain. Lignes en uv : elles suivent le relief sans reconstruction quand l'exagération change.
- **Sources** : enroulement modulo d'un champ de particules autour de la caméra (technique courante).
- **Limites** : reconstruction à chaque `viewVersion`. Textes HTML repositionnés à chaque image. Graticule en degrés seulement.

## Calques d'interface

### Intro — [`src/graphics/nodes/intro/Intro.node.ts`](../src/graphics/nodes/intro/Intro.node.ts)
- **Comment** : attend `document.fonts.load` des polices calculées, un atlas par police, un mesh de quads par texte (interlettrage CSS appliqué), plus « ENTRER » sur l'anneau du curseur. Chaque image : point d'écriture lu dans le DOM, plan à 40 unités devant la caméra à l'échelle `pixelScale × 40`. `erase = mapUncovered()` : le masque de composition qui découvre la carte efface aussi le texte.
- **Pourquoi** : mise en page et accessibilité restent en HTML ; l'effacement par le masque de la page est impossible en DOM.
- **Sources** : [FontFaceSet.load](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load) (MDN).
- **Limites** : une ligne par élément. Lit le DOM à chaque image (`getBoundingClientRect`).

### Panneau d'archives — [`src/graphics/nodes/panel/Panel.node.ts`](../src/graphics/nodes/panel/Panel.node.ts)
- **Comment** : plan calé sur le rectangle `[data-fonds]`. Progression à l'horloge (écriture 900 ms, effacement 620 ms). Shader : ordre = `mix(bruit peint, 1 − uv.y, 0,35)`, écrit = `step(front − ordre)`, bord d'encre de 1,6 px (`fwidth`) + lavis léger, filet gauche de 1 px. Le texte HTML suit par `--fonds-reveal`.
- **Pourquoi** : un seuil sur un bruit plutôt qu'un fondu reste dans la grammaire du dessin. Temps à l'horloge : pendant un vol, les images lourdes rallongeaient une animation à pas bornés.
- **Sources** : dissolution par seuil de bruit (« dissolve shader ») ; `fwidth` pour une largeur constante en pixels.
- **Limites** : lit le DOM à chaque image. Papier et encre en dur, non branchés sur `inkSettings`.

## Timeline

### Courbes — [`src/graphics/timeline/ease.ts`](../src/graphics/timeline/ease.ts)
- **Comment** : `hold`, `linear`, cubiques `easeIn/Out/InOut`, `bezier` (cubic-bezier CSS, x inversé par Newton en 6 itérations). `hold` rend 0 : la valeur tient jusqu'à la clé suivante. `EASE_NAMES` et `sampleEase` sont passés au panneau par `app/sonde.config.ts`.
- **Pourquoi** : mêmes noms et sémantique que le sélecteur de SONDE.
- **Sources** : [CSS Easing Functions Level 1](https://www.w3.org/TR/css-easing-1/) ; [bezier-easing](https://github.com/gre/bezier-easing).
- **Limites** : Newton sans repli par dichotomie ; sûr pour les courbes monotones, seules permises par le panneau.

### Théâtre — [`src/graphics/timeline/Theatre.ts`](../src/graphics/timeline/Theatre.ts)
- **Comment** : pistes objet -> propriété -> clés `{t, v, e, cp}` ; des liaisons `get/set` relient chaque piste à un scalaire de la scène. `advance(dt)` est appelé par la boucle de l'univers (pas de rAF interne), `apply()` échantillonne : maintien hors bornes, interpolation par l'ease de la clé de départ. API d'édition (`putKeyframe`, `moveKeyframe`, `setEase`, `removeKeyframe`), `snapshot`/`restore` pour annuler, pistes vides semées pour poser la première clé. `markersMap()` et `snapshot().markers` rendent `{}` (contrat `TimelineTheatre` de SONDE, redéclaré dans `Timeline.type.ts`).
- **Pourquoi** : la courbe vit dans des données réglées à la main, le nœud n'expose qu'un scalaire : l'intro se règle sans toucher au code.
- **Sources** : modèle des éditeurs de keyframes type [Theatre.js](https://www.theatrejs.com).
- **Limites** : scalaires seulement. Recherche linéaire du segment. Durée fixée à la construction.

### Intro et pistes — [`src/graphics/timeline/IntroTheatre.ts`](../src/graphics/timeline/IntroTheatre.ts), [`timeline.tracks.json`](../src/graphics/config/timeline.tracks.json)
- **Comment** : clone (`structuredClone`) l'objet `intro` du JSON dans un théâtre de 3 s. Liaisons fournies par `Main.universe` : `passage.*` -> uniforms de `pageTransition`, `interface.*` -> variables CSS `--intro-entete/rail/pied`, `noms.entree` -> `Labels3DNode.intro`. `import.meta.hot.accept` arrête le HMR du JSON, que SONDE réécrit à chaque enregistrement.
- **Pourquoi** : des pistes versionnées, réglées dans SONDE, inlinées par Vite au build (pas de fetch en prod).
- **Sources** : [Vite HMR API](https://vite.dev/guide/api-hmr).
- **Limites** : pistes rechargées seulement au redémarrage de la scène. Une clé du JSON sans liaison est ignorée sans avertissement.

## Réglages

- [`debug.values.json`](../src/graphics/config/debug.values.json) (clé `tweakpane`, appliquée par `DebugManager.bind` au démarrage, même sans panneau ; c'est le rendu de référence). Chemins liés au panneau pour cette partie : `camera.*` (inclinaison, roulis ; `camera.ease` = lissage de la vue), `life.planes/clouds/dust/dustSize`, `ink.hoverInk/hoverRim/hoverWash` (accent du survol), `ink.cloudLines`, `mask.*` (ellipse de la zone dessinée). Un chemin absent du JSON garde la valeur du code ; une clé sans liaison est ignorée sans avertissement.
- [`views.config.ts`](../src/graphics/config/views.config.ts) et [`focus.config.ts`](../src/graphics/config/focus.config.ts) : raccourcis de navigation et niveaux nommés.
- [`timeline.tracks.json`](../src/graphics/config/timeline.tracks.json) : rythme de l'intro, édité dans le panneau Timeline de SONDE (`?debug`).
- Constantes de module (en tête de chaque fichier) : nombre de noms, écarts, durées d'entrée, sondes de communes, nombre de nuages et d'avions, poussière.
