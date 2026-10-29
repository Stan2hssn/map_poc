# Interface, orchestration et build

Nuxt 4 sert une page unique ; tout le rendu vit dans des composants `.client`. Le moteur (`src/`) et l'interface Vue (`app/`) ne se parlent que par une interface sans dépendance three (`IMapNavigator`), lue par sondage. Les réglages et la timeline sont des JSON versionnés, écrits en dev par le pont SONDE et importés statiquement en prod.

```
ThreeStage (canvas, device) -> useThreeStage -> Runtime _core -> universes.manifest -> MainUniverse
MainUniverse -> nodes + EffectComposer -> canvas
index.vue / MapChrome / MapArchives -> useMapNavigator -> IMapNavigator (MainUniverse)
debug.values.json / timeline.tracks.json <- pont SONDE (dev) ; -> import statique (prod)
```

## Montage du moteur

### Canvas et device — [`app/components/ThreeStage.client.vue`](../app/components/ThreeStage.client.vue)
- **Comment** : attend un `nextTick` (ref nulle au `onMounted` d'un `.client`), importe dynamiquement `ThreeDevice`, crée le renderer (`antialias: false`, `powerPreference: 'high-performance'`, `trackTimestamp` si `?debug`/`?stats`), publie le device dans `useThreeStage` avant d'émettre `ready`, suit le canvas par `ResizeObserver` en ignorant les boîtes 0x0, libère tout au démontage.
- **Pourquoi** : WebGPU n'existe pas côté serveur ; l'import dynamique garde three et tweakpane hors du chunk d'entrée ; `resize` de window ne part pas quand le canvas passe de 0 à une taille réelle. Pas d'antialiasing sur le canvas : la dernière passe du composer est un triangle plein écran (son option `multisampling` reste à 0).
- **Sources** : [ResizeObserver (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) ; [composants client (Nuxt)](https://nuxt.com/docs/4.x/directory-structure/app/components).
- **Limites** : en cas d'échec, seul un `<p>` de repli s'affiche (aucun évènement émis) ; aucune reprise après perte du device GPU.

### Registre du device — [`app/composables/useThreeStage.ts`](../app/composables/useThreeStage.ts)
- **Comment** : variable de module `current` avec `publish()` / `read()` ; `read()` est relu à chaque appel car le device meurt et renaît aux changements de route. C'est aussi le point d'accès de SONDE (`stage` dans `sonde.config.ts`).
- **Pourquoi** : un renderer n'est pas sérialisable ; `useState` le ferait transiter par le payload SSR.
- **Sources** : [useState (Nuxt)](https://nuxt.com/docs/4.x/api/composables/use-state).
- **Limites** : état global de module, partagé entre requêtes côté serveur (sans effet ici : seul le client publie).

### Manifeste d'univers — [`src/graphics/universes/universes.manifest.ts`](../src/graphics/universes/universes.manifest.ts)
- **Comment** : tableau explicite `{ id, ctor, isDefault }` lu par le Runtime du `_core` ; une seule entrée, `UNIVERSE_ID.MAIN` -> `MainUniverse` (`Universe.id.ts`).
- **Pourquoi** : manifeste explicite plutôt qu'auto-enregistrement (règle du projet).
- **Sources** : architecture interne, [`src/_core/README.md`](../src/_core/README.md).
- **Limites** : un seul univers.

## Orchestration de la carte

### Construction de la scène — [`src/graphics/universes/impl/Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts)
- **Comment** : construit la scène, `MapCameraNode` et `TerrainNode` (relief IGN en direct), puis les nodes lumières, bâti, avions, nuages, relevés, noms 3D, panneau et intro ; tous activés par le contrat `NODE_ID.CONTRACT_BASE` (10 nodes). Pipeline : `RenderPass` (MRT normales + profondeur) -> `EffectPass(InkEffect)` -> trois `OverlayPass` (noms, panneau, intro) dessinés après l'encre.
- **Pourquoi** : un univers = un monde et son contrat de nodes (architecture `_core`). Les overlays passent après l'encre pour ne pas être hachurés ; la feuille du panneau recouvre les noms.
- **Sources** : [three.js WebGPURenderer / TSL](https://threejs.org/docs/) ; principe des passes inspiré de [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing).
- **Limites** : fichier d'environ 630 lignes, dont près de la moitié déclare le panneau.

### Contrat Vue -> scène — [`src/graphics/universes/MapNavigator.interface.ts`](../src/graphics/universes/MapNavigator.interface.ts), [`app/composables/useMapNavigator.ts`](../app/composables/useMapNavigator.ts)
- **Comment** : `IMapNavigator` (`flyTo`, `setFocus`, `readout`, `onPlaceSelected`, `searchPlaces`, `goToPlace`, `holdIntro`, `loadState`, `setIntroReady`, `drawMap`), types `SelectedPlace` / `MapView` en lon/lat/km. `useMapNavigator()` cherche, parmi les univers actifs du runtime, le premier qui passe la garde `isMapNavigator`, relu à chaque appel.
- **Pourquoi** : les composants n'importent pas three ; unités géographiques plutôt que coordonnées de scène.
- **Sources** : —
- **Limites** : garde par présence de `flyTo` seulement ; Vue lit par sondage (`setInterval`), seul `onPlaceSelected` est un abonnement.

### Chargement et précompilation — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts)
- **Comment** : `loadState()` = progression du terrain x0,8 + (noms chargés, textes de l'intro gravés) x0,1 + pipelines compilés x0,1. Dès que le terrain est prêt et avant l'intro, `composer.compile()` précompile les pipelines ; `ready` exige les trois.
- **Pourquoi** : les textures de la vue changent le shader du sol ; sans précompilation, la première image de la carte compilait et saccadait pendant le passage.
- **Sources** : [`WebGPURenderer.compileAsync` (three.js)](https://threejs.org/docs/pages/WebGPURenderer.html).
- **Limites** : pondérations arbitraires ; un échec de compilation est seulement journalisé et marque tout de même `_compiled`.

### Intro : verrou des gestes et théâtre — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts), [`src/graphics/timeline/IntroTheatre.ts`](../src/graphics/timeline/IntroTheatre.ts)
- **Comment** : `holdIntro()` saute sur `MAP_VIEWS.france` (`jumpTo`, sans vol), ferme les gestes (objet `gestures.open` lu par les callbacks pan/zoom/fling de la caméra) et remet le théâtre à 0. `drawMap()` ouvre les gestes et joue le théâtre ; `flyTo()` le déclenche s'il n'a pas eu lieu. Le théâtre (pistes de `timeline.tracks.json`) pilote les uniforms de `pageTransition`, les variables CSS `--intro-*` et l'entrée des noms.
- **Pourquoi** : un geste sous la page d'entrée déplacerait la carte sans qu'on le voie ; une même timeline pour DOM et GPU garantit un seul geste coordonné, réglable dans SONDE.
- **Sources** : pistes keyframées (`@sonde/core`).
- **Limites** : le théâtre avance au `dt` réel sans borne : une image lourde fait sauter des étapes plutôt que ralentir.

### Rendu à la demande — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts), [`src/graphics/device/DynamicQuality.helper.ts`](../src/graphics/device/DynamicQuality.helper.ts)
- **Comment** : à chaque `update`, compare la `matrixWorld` caméra à celle du dernier rendu (tolérance `1e-5` par coefficient) et lit `settled` des nodes terrain, bâti, noms, panneau, intro, l'état du théâtre et `landcoverReveal`. Immobile : `composer.paused` sauf une image toutes les 1000/15 ms, ou 1000/30 ms si véhicules, avions ou vent vivent seuls. `DynamicQualityHelper` n'est nourri qu'en mouvement et ajuste `composer.sceneScale` par pas de 0,1 jusqu'à 0,6.
- **Pourquoi** : objectif 120 fps sans faire chauffer le GPU sur une image fixe ; juger la cadence au repos fausserait la mesure (images sautées).
- **Sources** : [Rendering on demand (three.js manual)](https://threejs.org/manual/#en/rendering-on-demand).
- **Limites** : un node qui oublie de repasser `settled=false` fige l'image ; un node qui reste non stabilisé empêche toute veille.

### Vol vers un lieu — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts) (`goToPlace`, `extentOfRings`)
- **Comment** : cherche le contour du lieu dans `Labels3DNode` ; bbox lon/lat convertie en km (111,32 km/degré, longitude x cos de la latitude moyenne), plus grand côté x1,25, borné en bas à `CITY_EXTENT_KM`. Sans contour : échelle ville, sans reculer si la vue est déjà plus serrée.
- **Pourquoi** : un territoire entier doit tenir dans la vue ; l'approximation équirectangulaire suffit à l'échelle d'un département.
- **Sources** : approximation équirectangulaire locale.
- **Limites** : imprécise aux hautes latitudes et à cheval sur l'antiméridien.

### Variantes et mode nuit — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts) (`_settings`, `applyInk`)
- **Comment** : `ink.amount` (« dessin », 0 ou 1) active la passe d'encre ; à 0, `applyInk` coupe le trait du sol (`terrainSettings.pen`), remet le fond noir et pose `data-map-theme="night"` (sinon `paper`), lu par `labels.css`. Le bâti se choisit au select « bati » (`buildings.technique` : « aucun » `none` | « volumes » `extrusion`) ; la caméra fige la parallaxe du sol pendant qu'on vise un nom (`holdParallax`).
- **Pourquoi** : les variantes restent comparables en direct au panneau ; le thème DOM suit le rendu sans état dupliqué côté Vue.
- **Sources** : —
- **Limites** : le seuil 0,5 fait d'`amount` un interrupteur ; `main.css` garde des couleurs du thème nuit.

### Panneau de réglages — [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts), [`src/graphics/debug/debug.values.ts`](../src/graphics/debug/debug.values.ts)
- **Comment** : chaque réglage = `debug.bind(target, objet, clé, options, chemin)`. `folder()` monte d'abord avec `target=null` (applique la valeur du JSON sans UI), puis s'abonne au panneau, monté seulement avec `?debug`. Les chemins (`terrain.*`, `mask.*`, `buildings.*`, `life.*`, `camera.*`, `lights.*`, `ink.*`, `shading.*`, `water.*`, `render.*`) sont les clés de la section `tweakpane` de `debug.values.json`.
- **Pourquoi** : les valeurs du panneau font le rendu en production : le JSON est inliné au build, sans requête.
- **Sources** : [Tweakpane](https://tweakpane.github.io/docs/).
- **Limites** : chemins non vérifiés : une clé renommée laisse une valeur orpheline sans avertissement ; seul `inkSettings.clouds` est renommé à la main (`ink.cloudLines`). La résolution (`pixelRatio`) n'a pas de chemin et n'est pas enregistrée.

## Interface Vue

### Page d'entrée et voile — [`app/pages/index.vue`](../app/pages/index.vue)
- **Comment** : sur `ready` de `ThreeStage`, `holdIntro()` puis sondage de `loadState()` toutes les 150 ms (progression monotone). Prêt : `setIntroReady(true)`, le voile se lève 150 ms plus tard et se démonte sur `transitionend`. Au `pointerdown` : `data-map-intro="drawn"`, `drawMap()`, montage de `MapChrome` et `MapArchives`. Les textes restent dans le DOM mais transparents : `IntroNode` les redessine en WebGL à leur place.
- **Pourquoi** : entrer pendant l'arrivée des tuiles saccaderait le passage ; dessiner les textes dans le rendu permet au masque de composition de les effacer avec la page.
- **Sources** : —
- **Limites** : sondage plutôt qu'évènement ; démarrage au pointeur seul (pas de clavier) ; liens de pied de page factices.

### Chrome : fil, recherche, rail, échelle, frise — [`app/components/MapChrome.client.vue`](../app/components/MapChrome.client.vue)
- **Comment** : lit `readout()` toutes les 200 ms ; échelle « ronde » la plus proche de 148 px ; coordonnées en degrés-minutes. Géocodage inverse `geo.api.gouv.fr/communes?lat&lon` après 500 ms de repos et 0,02° de déplacement ; le fil n'affiche un niveau que sous une largeur de vue (région 600, département 150, ville 25 km). Recherche locale via `searchPlaces` ; rail -> `setFocus` ; frise : deux clics bornent une période.
- **Pourquoi** : anti-rebond et seuil limitent les appels API ; les seuils km font dire au fil où l'on regarde.
- **Sources** : [API Géo, communes](https://geo.api.gouv.fr/decoupage-administratif/communes) ; « nice numbers » pour barres d'échelle (Heckbert, Graphics Gems, 1990).
- **Limites** : échelle calculée sur `innerWidth` (fausse en perspective inclinée) ; frise décorative (la période n'agit sur rien) ; hors France le fil s'arrête à France.

### Panneau « fonds » d'un territoire — [`app/components/MapArchives.client.vue`](../app/components/MapArchives.client.vue)
- **Comment** : s'abonne à `onPlaceSelected` ; la feuille est un plan WebGL (`PanelNode`) calé sur `[data-fonds]`, qui écrit `--fonds-reveal`. Chaque bloc apparaît quand ce front dépasse son seuil `--at` (`clamp(... * 1000)` = marche), animé par transition. Fermeture : texte 200 ms, feuille 700 ms, démontage. Changement de lieu : `--swap` rejoue l'écriture sans refaire la feuille. Se ferme si le lieu sort de la vue (distance > 1,2 x largeur), sauf en vol.
- **Pourquoi** : le DOM garde texte, accessibilité et clic ; le WebGL donne la feuille d'encre qui se consume. `data-fonds-open` fait se ranger le chrome.
- **Sources** : —
- **Limites** : contenu factice (échantillon, compteurs, code de fonds) ; onglets sans effet.

### Curseur dessiné — [`app/components/MapCursor.client.vue`](../app/components/MapCursor.client.vue)
- **Comment** : cercle SVG de 96 points dont le rayon ondule par trois harmoniques entières (k = 3, 5, 7, amplitude < 1 %) pour se refermer exactement ; suit le pointeur par lissage exponentiel `1 - exp(-dt/55 ms)` dans une boucle rAF ; rayon selon l'état (chargement 30, prêt 44, carte 12, survol 17, saisie 8). Survol : `closest(CLICKABLE)` ou `cursor: pointer` posé par le canvas sur les noms.
- **Pourquoi** : en HTML au-dessus de tout (dans le rendu il passerait sous panneau et chrome) ; `IntroNode` lit sa position (`[data-cursor-ring]`) pour poser le mot d'entrée.
- **Sources** : lissage exponentiel indépendant de la cadence ; série de Fourier pour courbe fermée.
- **Limites** : `getComputedStyle` à chaque frame ; masqué au toucher (`pointer: coarse`) ; rAF permanent même immobile.

### CSS et tokens — [`app/assets/css/chrome.css`](../app/assets/css/chrome.css), [`labels.css`](../app/assets/css/labels.css), [`main.css`](../app/assets/css/main.css)
- **Comment** : tokens en triplets RGB (`--ui-ink`, `--ui-paper`) pour `rgb(var() / alpha)` ; halo papier en `text-shadow` multiple ; opacité et translation des blocs pilotées par `--intro-entete/rail/pied` (écrites par le théâtre) ; `data-fonds-open` décale chrome et relevés ; `data-map-theme` bascule les noms entre nuit et papier.
- **Pourquoi** : une seule source de rythme (timeline) pour DOM et GPU ; le halo garde le texte lisible sur les hachures denses.
- **Sources** : [CSS custom properties (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties).
- **Limites** : tokens répartis sur trois fichiers.

## Intégration SONDE — [`app/sonde.config.ts`](../app/sonde.config.ts), [`nuxt.config.ts`](../nuxt.config.ts)
- **Comment** : module Nuxt `@sonde/core/nuxt`, inactif hors dev. `routes` désigne les fichiers que le serveur de dev réécrit : `timeline.tracks.json` et `debug.values.json`. `sonde.config.ts` retourne `threePipeline` (lecteur `useThreeStage`, théâtres `[INTRO_THEATRE]`, courbes d'ease, version three) seulement si `?debug`. Les modules lecteurs (`IntroTheatre.ts`, `debug.values.ts`) font `import.meta.hot.accept` pour ne pas recréer la scène à chaque sauvegarde. Les devtools Nuxt sont coupés.
- **Pourquoi** : réglages et timelines édités en direct puis versionnés comme JSON, relus statiquement en prod. La liste des théâtres est statique car le panneau la demande avant le montage de l'univers.
- **Sources** : `@sonde/core` (dépôt `github:SONDE-DEVTOOLS/sonde`).
- **Limites** : dépendance git sans tag ni commit figé ; liste des théâtres tenue à deux endroits (`sonde.config.ts`, `getTheatreIds`).

## Assets et build — [`scripts/`](../scripts/), [`nuxt.config.ts`](../nuxt.config.ts)
- **Comment** : `prebuild` lance `convert-assets-for-prod.sh`, qui appelle `convert-images-to-webp.mjs` : `assets-source/Images/**` (png, jpg, jpeg, webp) -> WebP qualité 85 (`WEBP_QUALITY`) via sharp vers `public/assets/images`, cibles plus récentes sautées (mtime). `build` = `nuxt build` (SSR, Vite) ; `postbuild` supprime `.output/public/assets-source` s'il existe. Tests : `node --test` sur `src/**/*.test.ts` (types effacés nativement par Node). Alias `@`, `@_core`, `@graphics`... déclarés dans `nuxt.config.ts`, `src/` ajouté au typecheck.
- **Pourquoi** : sources lourdes hors dépôt, seuls les WebP servis ; `node --test` évite une dépendance de test ; préconnexion à `data.geopf.fr` et `geo.api.gouv.fr` pendant le démarrage du moteur.
- **Sources** : [sharp, sortie WebP](https://sharp.pixelplumbing.com/api-output/) ; [Node.js test runner](https://nodejs.org/api/test.html).
- **Limites** : `assets-source` est gitignoré, la conversion est un no-op en CI ; destination `images` en minuscule alors que la page lit `/assets/Images/...` (casse sensible selon l'hébergeur) ; `WEBM_CRF` et `CLEANUP_ORIGINALS` des scripts npm ne sont lus par aucun script ; pas de compression GPU (KTX2) des textures.

## Réglages
- [`src/graphics/config/debug.values.json`](../src/graphics/config/debug.values.json), section `tweakpane` : tout ce que montre le panneau `?debug` (relief, masque, vie, caméra, encre dont `ink.amount` pour le mode nuit, `buildings.technique`, `render.auto`). Écrit par le pont SONDE en dev.
- [`src/graphics/config/timeline.tracks.json`](../src/graphics/config/timeline.tracks.json) : pistes du théâtre `intro` (masque de composition, `--intro-*`, entrée des noms), réglées dans SONDE.
- [`src/graphics/config/views.config.ts`](../src/graphics/config/views.config.ts) : vue France de l'intro (`MAP_VIEWS.france`, 1150 km de large) et `CITY_EXTENT_KM` (3 km).
- Constantes de cadence dans `Main.universe.ts` (`IDLE_FPS` 15, `LIVELY_FPS` 30) et de l'UI en tête de chaque composant (`READ_MS`, `LOOKUP_MS`, `CRUMB_KM`, `RADIUS`...).
- Drapeaux d'URL : `?debug` (panneau, SONDE, horodatage GPU), `?stats` (horodatage GPU).
