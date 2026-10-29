# Architecture et moteur

Le moteur sépare trois couches : `src/_core/` (orchestration générique, copie du template `three-pipeline-boilerplate`), `src/graphics/` (tout ce qui est propre à la carte : univers, nodes, matériaux TSL, post-traitement, réglages) et `app/` (Nuxt : page, chrome HTML, publication du device). Une image suit ce trajet :

```
ThreeStage.client.vue -> ThreeDevice.create -> Runtime (Input, Output, RAF)
RAF._tick -> Input.update -> Output.update -> Universe.update -> NodeGraph.update (nodes montés)
          -> Output.render -> EffectComposer.prepare -> render -> postRender -> canvas
```

`src/_core/README.md` reste la référence fine du template ; ce document décrit ce que map en utilise réellement.

## Couches et dépendances

### Découpage _core / graphics / app — [`src/_core/README.md`](../src/_core/README.md)
- **Comment** : `_core` ne contient aucun réglage de map. Ce qui varie passe par `graphics/` : manifestes (`UNIVERSE_MANIFEST`, `ASSET_MANIFEST`, `SHADER_MANIFEST`), `DEVICE_CONFIG`, `DEBUG_CONFIG`, ids (`Node.id.ts`, `Universe.id.ts`, `Debug.id.ts`). Du `_core`, `app/` n'importe que `ThreeDevice` (en dynamique, le reste en `import type`) et `DebugFlags` ; de `graphics/`, des configurations (`views.config.ts`, `focus.config.ts`), `MapNavigator.interface.ts` et la timeline de l'intro (`sonde.config.ts`). Alias de `nuxt.config.ts` : `@` -> `src`, `@_core`, `@graphics`, `@postprocessing`, `@universes`, `@adapters` ; `~` -> `app` reste celui de Nuxt.
- **Pourquoi** : le même `_core` sert à plusieurs projets et doit rester identique octet pour octet ; un besoin de map se résout dans `graphics/`.
- **Sources** : inversion de contrôle par objet de configuration.
- **Limites** : dépendance inverse. Le `_core` importe `graphics/` par chemins fixes : neuf modules dans `ThreeDevice.ts`, plus `device.config.ts` dans `Output.ts`, `debug.config.ts` dans `DebugFlags.ts`, et `Node.id.ts` dans `Universe.base.ts` et `UniverseContract.type.ts`. Un projet sans ces fichiers ne compile pas.

## Démarrage

### Montage du canvas — [`app/components/ThreeStage.client.vue`](../app/components/ThreeStage.client.vue)
- **Comment** : au `onMounted`, attend un `nextTick` (la ref vaut encore null dans un composant `.client`), puis `import('@_core/systems/ThreeDevice.ts')` et `Device.create(canvas, { antialias: false, alpha: false, powerPreference: 'high-performance', trackTimestamp })`. `trackTimestamp` n'est vrai que sous `?debug` ou `?stats`. Le device est publié par `useThreeStage().publish` avant l'événement `ready`, puis un `ResizeObserver` observe le canvas. Un échec de création affiche un message de repli à la place du canvas.
- **Pourquoi** : l'import dynamique sort three et Tweakpane du chunk d'entrée. Le `ResizeObserver` capte le passage d'une boîte nulle à une boîte réelle, que l'événement `resize` de la fenêtre ne signale pas. L'antialias est confié au composer : la dernière passe est un triangle plein écran.
- **Sources** : [MDN ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver) ; composants client de Nuxt (`.client.vue`).
- **Limites** : voir « Défauts du _core » pour la double source de redimensionnement.

### Point de rendez-vous — [`app/composables/useThreeStage.ts`](../app/composables/useThreeStage.ts)
- **Comment** : une référence de module (`current`) avec `publish` et `read`. SONDE (`app/sonde.config.ts`, adaptateur `@sonde/core/three-pipeline`) relit le device à chaque appel.
- **Pourquoi** : un renderer n'est pas sérialisable, donc pas de `useState` Nuxt. Le contrat SONDE est structurel : `renderer` et `runtime.output.getActiveUniverses`, plus `runtime.raf.setRate`, facultatif, pour le sélecteur de vitesse.
- **Limites** : un seul device par page.

### Renderer et backend — [`src/_core/systems/ThreeDevice.ts`](../src/_core/systems/ThreeDevice.ts)
- **Comment** : `_createRenderer` lit `DEVICE_CONFIG.renderer.backend` (map : `"webgpu"`), importe `three/webgpu` en dynamique, construit `WebGPURenderer` et attend `renderer.init()`. Sans WebGPU, three bascule seul sur son backend WebGL2. Le constructeur pose `outputColorSpace = SRGBColorSpace`, active la carte d'ombres (PCFSoft par défaut), plafonne le pixel ratio à `min(devicePixelRatio, 2)` (plafond distinct si `(pointer: coarse)`), crée `AssetStore`, `ShaderStore`, `StatsManager`, `State`, déclare les univers du manifeste et crée `Runtime`, `OrbitCameraHelper` et `DOMInputAdapter`.
- **Pourquoi** : un projet WebGL n'embarque pas `three/webgpu`. Le pointeur grossier est le seul signal fiable d'un téléphone. Tout est en TSL, donc compatible avec les deux backends de `WebGPURenderer`.
- **Sources** : [three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) ; [MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) ; [MDN @media pointer](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer).
- **Limites** : les ombres sont actives tant que `shadowMap: false` n'est pas fixé. Map ne règle aucun plafond de pixel ratio : valeurs par défaut.

### Séquence d'initialisation — [`ThreeDevice.init`](../src/_core/systems/ThreeDevice.ts)
- **Comment** : taille du renderer -> `preloadGroup("boot")` -> `DEVICE_CONFIG.onBoot` -> `runtime.init` -> `debug.setPersistence` (toujours) -> `debug.init(DEBUG_CONFIG)` si `?debug` -> stats-gl si `?stats` -> branchement de `DOMInputAdapter` et de la caméra orbitale -> contrôles « Mesures » -> `DEVICE_CONFIG.bindDebug` -> activation de l'univers par défaut (`MAIN`) -> `runtime.resize` -> écoute de `resize`/`orientationchange` sur la fenêtre -> `start`.
- **Pourquoi** : la persistance est chargée avant tout univers, panneau ouvert ou non : les valeurs enregistrées sont la configuration de la scène. Le premier rendu n'a lieu qu'après le montage de l'univers.
- **Limites** : dans map, le groupe `boot` est vide et ni `onBoot` ni `bindDebug` ne sont fournis.

### Configuration du device — [`src/graphics/device/device.config.ts`](../src/graphics/device/device.config.ts)
- **Comment** : `DEVICE_CONFIG = { renderer: { backend: "webgpu" }, debugPersistence: DEBUG_PERSISTENCE }`. Le type (`DeviceConfig.type.ts`) prévoit aussi `maxPixelRatio`, `maxPixelRatioCoarse`, `shadowMap`, `toneMappingExposure`, `onBoot` et `bindDebug`.
- **Pourquoi** : seul point d'extension du device, pour ne pas toucher `ThreeDevice` ni `Output`.
- **Limites** : `toneMappingExposure` est relu à chaque image mais reste sans effet sous `NoToneMapping`.

## Orchestration et boucle

### Runtime et registre d'univers — [`src/_core/systems/Runtime.ts`](../src/_core/systems/Runtime.ts), [`UniverseRegistry.ts`](../src/_core/registries/UniverseRegistry/UniverseRegistry.ts)
- **Comment** : `Runtime` possède `Input`, `Output` et `RAF`, et délègue `init`, `start`, `stop`, `resize` et `activateUniverse`. Le registre stocke des fabriques `() => new ctor(device)` ; `getOrCreate` instancie à la première activation, `getDefaultId` rend l'univers marqué `isDefault` (sinon le premier).
- **Pourquoi** : un univers coûteux (terrain, workers) n'est construit que s'il est activé.
- **Sources** : registre et fabrique paresseuse (Fowler, *Patterns of Enterprise Application Architecture*).
- **Limites** : map n'a qu'un univers et n'appelle que `activateUniverse`.

### Boucle et cadence du temps de scène — [`src/_core/systems/RAF.ts`](../src/_core/systems/RAF.ts)
- **Comment** : `_tick` sur `requestAnimationFrame`. `dt = (performance.now() - last) * rate`, `time += dt` (en ms), puis `input.update` -> `stats.begin` -> `output.update(time, dt)` -> `output.render({ time, deltaTime })` -> `stats.end/update`. `setRate(r)` accepte tout réel fini ≥ 0 (sinon 1) ; `setRate(0)` fige le temps sans arrêter le rendu.
- **Pourquoi** : le temps naît en un seul point, donc ralentir ici garde synchrones shaders, timeline, bruit et caméra. C'est ce qu'utilise le sélecteur de vitesse de SONDE. `time` est accumulé, et non lu sur l'horloge, pour rester cohérent avec `dt` quand `rate ≠ 1`.
- **Sources** : [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) ; [Glenn Fiedler, « Fix Your Timestep! »](https://gafferongames.com/post/fix_your_timestep/).
- **Limites** : pas de pas fixe ni de plafond sur `dt`. Au retour d'un onglet masqué, les nodes reçoivent un très grand `dt`. La boucle n'est pas `setAnimationLoop` de three (voir Mesures).

### Entrées — [`src/_core/systems/Input.ts`](../src/_core/systems/Input.ts), [`src/graphics/adapters/systems/DOMInputAdapter.ts`](../src/graphics/adapters/systems/DOMInputAdapter.ts)
- **Comment** : `Input` garde l'état souris (`x`, `y`, `nx`, `ny` en NDC, deltas, boutons, molette) et expose un bus typé `subscribe`/`emit`. L'adaptateur écoute `mousemove`/`mousedown`/`mouseup`/`wheel` (passif) sur le canvas et `keydown`/`keyup` sur la fenêtre en capture. `_syncMouseFromEvent` calcule `nx = x/w·2-1`, `ny = -(y/h)·2+1` et chaque `mousemove` réel émet un `emitMouseMove`. `Input.update` remet deltas et molette à zéro à chaque image.
- **Pourquoi** : le `_core` ne touche pas au DOM. Les NDC sont ce qu'attend `Raycaster.setFromCamera`. `MapCameraNode` lit `mouse.nx/ny` pour la parallaxe, et `OrbitCameraHelper` s'abonne à `keydown`.
- **Sources** : [three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html) ; [MDN MouseEvent.clientX](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/clientX).
- **Limites** : souris seulement, pas de `pointer`/`touch` : les gestes de la carte ont leurs propres écouteurs `pointer*` dans `TerrainGesturesHelper`, créé par `MapCameraNode`. `clientX/clientY` ne sont pas corrigés de l'offset du canvas (sans effet ici : le canvas est plein écran). Deltas remis à zéro avant `update`, donc illisibles en polling.

## Cycle de vie

### Univers et contrats — [`src/_core/universes/Universe.base.ts`](../src/_core/universes/Universe.base.ts), [`Output.ts`](../src/_core/systems/Output.ts)
- **Comment** : `Output.activateUniverse` incrémente un jeton par univers (`WeakMap`), attend `beforeMount` (préchargement des groupes de `getAssetPreloadGroups()`, ici `universe:main`, puis `pipeline.beforeMount`), vérifie l'état actif, l'appartenance et le jeton, puis appelle `onMounted` et `markMounted`. `MainUniverse.onMounted` appelle `applyContract(CONTRACT_BASE)`. Un contrat vaut `{ id, activeNodeIds }`. `applyContract` diffère les ensembles précédent et suivant, attend `unmountMany(sortants)` puis `mountMany(entrants)`. Pendant une transition, seule la dernière demande est mise en file, puis rejouée.
- **Pourquoi** : le jeton invalide une activation obsolète (activer puis désactiver vite ne monte pas de fantôme). Les contrats sont des données ; l'animation vit dans les hooks des nodes (`beforeUnmount` attendu = sortie animée). Le cycle de vie n'est jamais déclenché depuis la boucle rAF.
- **Sources** : diff d'ensembles, même principe que la réconciliation de listes à clés des frameworks UI.
- **Limites** : un seul contrat dans map (`contract:base`, dix nodes). Voir « Défauts du _core » pour les casts `as any` et le démontage incomplet.

### Graphe de nodes — [`src/_core/nodes/NodeGraph.ts`](../src/_core/nodes/NodeGraph.ts)
- **Comment** : `Map` id -> node et `Set` des montés. `mount` : `await beforeMount` -> `scene.add(getObject3D())` si le node expose `getObject3D` (duck typing) -> `onMounted` (non attendu) -> observateurs. `unmount` est symétrique. `update` ne touche que les montés ; `resize` et `dispose` touchent tous les nodes. Dans map : neuf nodes `Object3DNodeBase`, et `MapCameraNode` en `NodeBase`, enregistrés par `MainUniverse.beforeMount` (`graph.addMany`).
- **Pourquoi** : un node décrit un état et ne rend jamais ; seul le pipeline appelle le renderer.
- **Sources** : [three.js Object3D](https://threejs.org/docs/pages/Object3D.html) ; patron scene graph.
- **Limites** : pas de `remove(node)`. `resize` atteint aussi les nodes non montés.

## Rendu

### Rendu par image — [`src/_core/systems/Output.ts`](../src/_core/systems/Output.ts), [`src/_core/pipeline/Pipeline.base.ts`](../src/_core/pipeline/Pipeline.base.ts)
- **Comment** : `Output.render` remet `renderer.info` à zéro une fois (`autoReset = false`), appelle `prepare` de chaque pipeline, rétablit l'état du renderer (sRGB, `NoToneMapping`, viewport et scissor pleins, sans clear), puis `render` et `postRender`. `PipelineBase` délègue chaque méthode à ses `IPass`, dans l'ordre de la liste, avec les `before*` en `Promise.all`.
- **Pourquoi** : pas de clear du canvas. En WebGPU, ce clear passait par une cible interne et une recopie, et coûtait 64 % de l'image (journal du `_core/README.md`, 2026-09-15). Chaque passe vide sa cible. Le reset manuel fait cumuler les compteurs sur toutes les passes.
- **Sources** : [three.js Info](https://threejs.org/docs/pages/Info.html) (`renderer.info`, `autoReset`).
- **Limites** : `PassContext` est faiblement typé (`unknown` et index signature), donc chaque passe caste. L'ordre des passes est manuel.

### Chaîne de post-traitement — [`src/graphics/postprocessing/EffectComposer.ts`](../src/graphics/postprocessing/EffectComposer.ts)
- **Comment** : `EffectComposer extends PipelineBase`. Chaîne de map : `RenderPass` -> `EffectPass([InkEffect])` -> trois `OverlayPass` (noms, panneau, intro). `inputBuffer` est en `HalfFloat`, MRT `output` + `normal` + profondeur (`normalDepth: true`). La scène se rend à `sceneScale` de la taille, les effets échangent deux tampons à pleine taille, et la dernière passe active non overlay rend à l'écran. `paused` saute l'image entière. Détail dans [`src/graphics/postprocessing/README.md`](../src/graphics/postprocessing/README.md).
- **Pourquoi** : le post-traitement vit dans le pipeline de l'univers, pas dans le `_core`, qui reste sans dépendance de post-FX. Une passe coupée n'ajoute pas de copie.
- **Sources** : [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) ; [three.js TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
- **Limites** : la chaîne est figée dans le constructeur de `MainUniverse`.

### Rendu à la demande et précompilation — [`src/graphics/universes/impl/Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts)
- **Comment** : `MainUniverse.update` compare la matrice caméra à celle de la dernière image rendue (tolérance `1e-5`) et lit l'état `settled` de terrain, bâti, noms, panneau, intro et timeline, et la fin de la révélation de la couverture du sol (`landcoverReveal`). Image fixe : rendu à 15 i/s, ou 30 i/s si avions, bâti vivant ou vent. Sinon, rendu à chaque image. `composer.paused` porte la décision. Une fois le terrain chargé, `composer.compile` précompile les pipelines avant l'intro.
- **Pourquoi** : une image fixe ne doit pas faire chauffer le GPU. La précompilation évite la saccade au premier changement de shader du sol.
- **Limites** : un oubli dans la liste des `settled` donne une animation qui se fige à 15 i/s.

## Assets

### Manifeste et store — [`src/_core/assets/AssetStore.ts`](../src/_core/assets/AssetStore.ts), [`src/graphics/assets/assets.manifest.ts`](../src/graphics/assets/assets.manifest.ts)
- **Comment** : le manifeste (arbre) est aplati en clés pointées (`paper.newsprint`) ; `createAssetKeys` produit l'arbre de chaînes typé. `load` : cache -> promesse en vol dédupliquée -> loader par type -> `postProcess` -> cache. `preloadGroup` charge un groupe sauf les entrées `lazy`. Map déclare deux textures du groupe `universe:main` : `noise.paint` (`NoColorSpace`, répétée) et `paper.newsprint` (sRGB, répétée, anisotropie 8), posées sur `noiseMap` et `newsprintMap` après `beforeMount`.
- **Pourquoi** : manifeste explicite plutôt que glob : typé, un seul lieu de déclaration. `postProcess` fixe l'espace colorimétrique par asset (couleur en sRGB, bruit linéaire).
- **Sources** : [three.js TextureLoader](https://threejs.org/docs/pages/TextureLoader.html) ; [TypeScript template literal types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html).
- **Limites** : pas de progression, de retry ni d'annulation. Les données géographiques (relief IGN, couverture, bâti) ne passent pas par ce store.

## Debug et mesures

### Drapeaux d'URL — [`src/_core/debug/DebugFlags.ts`](../src/_core/debug/DebugFlags.ts)
- **Comment** : `?debug` et `?stats` posent `"1"` dans `sessionStorage` sous `map:<nom>` (préfixe `DEBUG_CONFIG.sessionPrefix`) ; `?debug=0` ou `false` efface. `isDebugRequested()` ouvre le panneau et monte SONDE ; `isStatsRequested()` allume stats-gl. Les deux activent `trackTimestamp`.
- **Pourquoi** : `sessionStorage` pour que le drapeau meure avec l'onglet ; le préfixe isole les projets servis sur le même localhost. Le module ne dépend que de `debug.config.ts`, donc il s'importe avant three. Il est disponible en production pour régler depuis un téléphone.
- **Sources** : [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) ; [MDN URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams).
- **Limites** : tout visiteur peut ouvrir le panneau (choix assumé).

### Panneau et réglages persistants — [`src/_core/debug/DebugManager.ts`](../src/_core/debug/DebugManager.ts), [`DebugValues.ts`](../src/_core/debug/DebugValues.ts), [`src/graphics/debug/debug.values.ts`](../src/graphics/debug/debug.values.ts)
- **Comment** : `debug.bind(target | null, objet, clé, options, chemin)` repose la valeur enregistrée sous le chemin pointé (`terrain.exaggeration`) avant de créer le contrôle. Avec `target = null`, il applique sans panneau et rend un binding inerte. `MainUniverse._settings` déclare chaque dossier une fois, l'exécute avec `null` puis l'abonne au panneau. `debug.values.ts` importe statiquement `src/graphics/config/debug.values.json` (clé `tweakpane`) et n'exporte que `DEBUG_PERSISTENCE`. Seul « Save Settings » écrit : `flush` -> `POST /__sonde/debug` (dev uniquement), route du module `@sonde/core/nuxt` configurée dans `nuxt.config.ts`. Onglets Carte / Dessin / Rendu et dossiers dans [`debug.config.ts`](../src/graphics/debug/debug.config.ts).
- **Pourquoi** : déclarer un réglage une fois et le consommer deux fois, pour que `?debug` ne donne jamais une autre scène. L'import statique, inliné au build, évite une requête impossible en production. `import.meta.hot.accept` sur le JSON évite que chaque sauvegarde recrée la scène par HMR.
- **Sources** : [Tweakpane](https://tweakpane.github.io/docs/) ; [Vite HMR API](https://vite.dev/guide/api-hmr) ; [MDN structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone).
- **Limites** : une clé peut ne survivre que dans le JSON après la disparition de son binding (réglage fantôme). Les curseurs ne valent que pour la session sans Save. Le singleton `debug` est global au module.

### Mesures d'image — [`src/graphics/debug/RenderStats.helper.ts`](../src/graphics/debug/RenderStats.helper.ts), [`src/_core/stats/StatsManager.ts`](../src/_core/stats/StatsManager.ts)
- **Comment** : `RenderStatsHelper.update(dt)` lisse ms et fps par `k = 1 - exp(-dt / 400 ms)`, lit draw calls et triangles dans `renderer.info` (image précédente, grâce au reset d'`Output`). Si `backend.trackTimestamp` est actif, il avance `info.frame` à la main puis lit `resolveTimestampsAsync(TimestampQuery.RENDER)`. `StatsManager` charge stats-gl en dynamique (renderer WebGPU passé tel quel) et préfixe ses `performance.mark` par `stats-gl-`.
- **Pourquoi** : un lissage en `exp(-dt/τ)` garde la même constante de temps à 60 et 120 Hz. Hors de `setAnimationLoop`, rien n'avance `info.frame`, et three regrouperait les requêtes de timestamp. Le timestamp GPU a un coût, d'où sa restriction à `?debug`/`?stats`.
- **Sources** : [WebGPU, timestamp-query](https://www.w3.org/TR/webgpu/#timestamp) ; [stats-gl](https://github.com/RenaudRohlinger/stats-gl).
- **Limites** : temps GPU asynchrone, avec une image de retard ou plus. Il manque si l'adaptateur n'expose pas `timestamp-query`. `trackTimestamp` est lu par un cast sur un champ interne de three. Recouvre en partie l'onglet Rendu de SONDE.

### Qualité dynamique — [`src/graphics/device/DynamicQuality.helper.ts`](../src/graphics/device/DynamicQuality.helper.ts)
- **Comment** : appelé par `MainUniverse.update` seulement quand l'image bouge. Pendant 3 s, le helper collecte les `dt`. La période d'affichage est le décile le plus rapide, aligné sur la fréquence la plus proche parmi 60, 75, 90, 100, 120, 144, 165 et 240 Hz. Il juge ensuite par fenêtres de 1 s. Moyenne > période × 1,12 deux fois de suite : échelle −0,1 (min 0,6). Moyenne < période × 1,03 six fois de suite : essai à +0,1. Un essai raté bloque la remontée 20 s. Les images > 250 ms et l'onglet masqué sont ignorés. L'échelle est retenue dans `localStorage` (`map:scene-scale`) et appliquée à `composer.sceneScale`. « qualite auto » (`render.auto`) pilote `enabled`.
- **Pourquoi** : tenir 60 ou 120 Hz (priorité du POC) en ne réduisant que la passe la plus chère, la scène. Encre, trames et papier restent à pleine résolution. On mesure la période réelle au lieu de supposer 60 Hz. L'hystérésis et le blocage après échec évitent l'oscillation.
- **Sources** : dynamic resolution scaling (technique de moteurs de jeu) ; [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
- **Limites** : la mesure porte sur l'intervalle entre rAF, pas sur le temps GPU. Seule la résolution de scène est réglée. Une valeur retenue peut être trop basse après un changement d'écran. `LEGACY_KEY` ne sert qu'à purger une ancienne clé.

### Caméra orbitale de debug — [`src/graphics/adapters/helpers/OrbitCamera.helper.ts`](../src/graphics/adapters/helpers/OrbitCamera.helper.ts)
- **Comment** : Shift+C sur le bus `Input` remplace la caméra de l'univers actif par une `PerspectiveCamera` (fov 80, near 0,1, far 100). Elle est pilotée par `OrbitControls` (damping 0,08), initialisée à la pose de la caméra source, cible 4 unités devant. Sa boucle rAF propre tourne tant qu'elle est active. Un second Shift+C restaure la caméra d'origine ; `MapCameraNode` se met en pause via `isActive`.
- **Pourquoi** : inspecter la scène hors de la caméra contrainte de la carte sans toucher à `MapCameraNode`.
- **Sources** : [three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html).
- **Limites** : disponible aussi en production. `far = 100` peut couper le terrain. Sa boucle échappe à `RAF`, donc à `setRate`. L'aspect initial est lu sur la fenêtre, puis corrigé au premier `resize`.

## Modules du _core non utilisés par map

Présents pour le template, sans appelant dans map. Ne pas les supprimer ici (règle de portage) :

- `interaction/InteractionManager.ts` : `MainUniverse` ne passe pas `input` à `UniverseBase`, l'interaction vaut `null`. Son raycast CPU ignorerait de toute façon le relief déplacé en TSL ; le survol passe par les contours administratifs.
- `nodes/group/` (`GroupNodeBase`, `NodeGroupBase`) et `nodes/interactive/` (`InteractiveObject3DNodeBase`) : aucun `registerNodeGroup`, aucun node interactif.
- `shaders/` : `SHADER_MANIFEST` est vide (tout est en TSL), le `ShaderStore` est créé pour rien.
- `systems/State.ts` : viewport écrit à chaque resize, jamais lu.
- `lifecycle/ILifecycle.type.ts` : noms qui ne correspondent pas au contrat réel de `INode`.
- `Input` : `smoothMouse`, `mouseMoved` et `setSmoothMousePosition` n'ont pas de source (l'adaptateur ne les écrit pas). Seul l'`InteractionManager` les lirait.
- `AssetStore` : loaders glTF/Draco, JSON, binaire, audio, vidéo ; groupe `boot` et drapeau `lazy` inutilisés.
- `DeviceConfig` : `onBoot`, `bindDebug`, `maxPixelRatio*`, `shadowMap`, `toneMappingExposure` non fixés.
- `Runtime.setActiveUniverses`, `Runtime.deactivateUniverse`. Côté `ThreeDevice` : `setDebugEnabled`, `toggleDebug`, `setStatsEnabled`, `toggleStats`, `setBasicStatsEnabled`, `setPerfStatsEnabled`, `toggleOrbitCamera`, getters `inputAdapter` et `state`.
- `StatsManager` : three-perf (refusé en WebGPU). `DebugManager` : `registerSnapshot`, `getSavedValue`, `setSavedValue`.

## Défauts du _core à remonter au template

À corriger dans `three-pipeline-boilerplate` puis resynchroniser, jamais dans `src/_core/` de map :

- **Casts `as any` no-op dans `Universe.base.ts`** : `_graph` est typé `NodeGraph`, pourtant `update`, `resize`, `dispose`, `mountMany` et `unmountMany` passent par `(this._graph as any)`. `beforeMount?.()`, `onMounted?.()`, `beforeUnmount?.()` et `onUnmounted?.()` visent des méthodes absentes de `NodeGraph` et ne font rien. `_currentContractId` est public, et des commentaires paraphrasent le code (`// no-op`, `// queue while transitioning`, bandeaux).
- **Démontage incomplet d'un univers** : `onUnmounted` ne démonte pas les nodes et ne remet pas `_currentContractId` à `null`. Un univers réactivé verrait son `applyContract` ignoré (même id). Sans effet dans map (univers jamais désactivé).
- **Double source de resize** : `ThreeDevice` écoute `resize` et `orientationchange` sur la fenêtre, et `ThreeStage` observe le canvas. Un changement de fenêtre déclenche donc deux `device.resize` complets (renderer, univers, composer). Au boot, `init` redimensionne aussi avant la première notification du `ResizeObserver`. L'écouteur de fenêtre ne filtre pas les boîtes nulles, contrairement à `ThreeStage`.
- **Dépendance inverse vers `graphics/`** : chemins codés en dur, relatifs ou par l'alias `@graphics` (voir « Couches et dépendances »).
- **`Output`** : exposition relue de `DEVICE_CONFIG` sous `NoToneMapping` (sans effet). `dispose()` est vide. Si `beforeUnmount` jette, l'univers reste monté mais inactif.
- **`Runtime.dispose`** désactive les univers en `void`, sans attendre.
- **`RAF`** : aucun plafond sur `dt`.
- **`DebugFlags`** : `sessionStorage` sans `try/catch`, donc une exception au démarrage si le stockage est bloqué.
- **`DebugManager`** : « Copy All Config » copie toujours `{}` (aucun `registerSnapshot`) ; brancher sur `this._values.snapshot()` ou retirer.
- **`ThreeDevice`** : le contrôle « Three Perf » (dossier Mesures) s'affiche en WebGPU alors qu'il ne fait qu'avertir.
- **`StatsManager`** : patch des méthodes internes de stats-gl par `as any`.
- **`AssetStore`** : `DRACOLoader` instancié même sans glTF ; erreurs converties en `String`, ce qui perd la pile.
- **`NodeGraph`** : `resize` envoyé aux nodes non montés ; pas de `remove`.
- **`Node.interface.ts`** : `extends ILifecycle` est inutile.
- **Commentaires périmés** : le getter `inputAdapter` (`ThreeDevice.ts`) parle d'un capteur d'inclinaison iOS sans consommateur. `DeviceRendererConfig.backend` renvoie à `graphics/postprocessing/webgpu`, qui n'existe pas. En-têtes paraphrases dans `RAF.ts`, `Runtime.ts`, `Frame.type.ts`, `State.ts` ; JSDoc-récit de `_rate` (une ligne suffit).
- **`src/_core/README.md`** : « écriture groupée à 400 ms » est faux (seul Save écrit). Les renvois à `NodeContract.md` et `docs/AUDIT_AND_PLAN.md` pointent vers des fichiers déplacés dans `docs/archive/`.
- **`PassContext`** faiblement typé (`unknown` et index signature).

## Réglages

| Quoi | Où |
|---|---|
| Backend, pixel ratio, ombres, exposition, hooks | [`src/graphics/device/device.config.ts`](../src/graphics/device/device.config.ts) |
| Valeurs du panneau (terrain, encre, bâti, caméra, rendu…) = rendu de la scène | [`src/graphics/config/debug.values.json`](../src/graphics/config/debug.values.json), clé `tweakpane`, écrit par « Save Settings » sous `?debug` en dev |
| Onglets, dossiers, préfixe de session | [`src/graphics/debug/debug.config.ts`](../src/graphics/debug/debug.config.ts) |
| Assets et groupes de préchargement | [`src/graphics/assets/assets.manifest.ts`](../src/graphics/assets/assets.manifest.ts) |
| Univers déclarés, univers par défaut | [`src/graphics/universes/universes.manifest.ts`](../src/graphics/universes/universes.manifest.ts) |
| Contrats et chaîne de passes | [`src/graphics/universes/impl/Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts) |
| Seuils de qualité dynamique | constantes de [`DynamicQuality.helper.ts`](../src/graphics/device/DynamicQuality.helper.ts) ; échelle retenue dans `localStorage["map:scene-scale"]` |
| Cadence du temps de scène | `runtime.raf.setRate`, piloté par SONDE sous `?debug` |
| Routes d'écriture de dev (debug, timeline) | `sonde.routes` dans [`nuxt.config.ts`](../nuxt.config.ts) |
