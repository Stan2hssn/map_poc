# `_core` — référence du moteur

Ce document décrit le fonctionnement **réel** du `_core`, tel que le code l'implémente. Il fait foi sur les autres documents : `README.md` (racine), `NodeContract.md` et `docs/AUDIT_AND_PLAN.md` sont en partie obsolètes (voir [Documents existants](#documents-existants)).

## Règle de portage

Le `_core` est partagé par tous les projets issus de ce template. **Un projet ne le modifie pas pour ses besoins propres** : ce qui est spécifique va dans `src/graphics/`.

Quand une modification du `_core` est inévitable (un manque du moteur, pas un besoin du projet) :

1. vérifier d'abord qu'aucune solution côté `graphics/` ne suffit — le plus souvent, un crochet de [`DeviceConfig`](#ce-quun-projet-fournit-au-core) suffit — et le dire ;
2. faire la modification **dans ce template d'abord**, puis la recopier telle quelle dans chaque projet (voir [Projets alignés](#projets-alignés)) ;
3. l'inscrire au [Journal des modifications](#journal-des-modifications) : quoi, pourquoi, fichiers, projet d'origine.

Le `_core` d'un projet doit rester **identique octet pour octet** à celui du template. Pour synchroniser un projet :

```bash
rsync -a --delete --exclude .DS_Store ~/Dev/Templates/three-pipeline-boilerplate/src/_core/ src/_core/
diff -rq -x .DS_Store ~/Dev/Templates/three-pipeline-boilerplate/src/_core src/_core
```

Un changement du `_core` qui ne vit que dans un projet est perdu pour les suivants.

## Style de code

S'applique au `_core` comme à `graphics/` et `app/`.

- **Simple, concis, structuré.** Le code le plus court qui reste lisible gagne.
- **Typer ce qui sert** : signatures exportées et frontières entre modules. Le reste est inféré. Pas d'interface, de générique ni de surcharge sans deuxième usage réel. Si le typage est plus long que le code qu'il décrit, il est de trop : un `as` ponctuel vaut mieux qu'un échafaudage de types.
- **Commentaires, même règle** : une ligne, pour un *pourquoi* non évident. Ni paraphrase, ni historique (« avant, … ») — l'historique vit dans les commits et le journal ci-dessous.

```ts
// Non : 12 lignes de types et de récit pour 3 lignes utiles.
/**
 * Contrat structurel du renderer attendu ici. On ne l'importe pas de three
 * parce que, historiquement, le type a changé entre deux versions et que...
 */
interface RendererLike { setSize(w: number, h: number, u?: boolean): void }
type ResizeTarget<T extends RendererLike = RendererLike> = { renderer: T };
function resize<T extends RendererLike>(t: ResizeTarget<T>, w: number, h: number): void {
  t.renderer.setSize(w, h, false);
}

// Oui.
// `false` : la taille CSS appartient au canvas, pas au renderer.
const resize = (renderer: Renderer, w: number, h: number) => renderer.setSize(w, h, false);
```

## Carte des modules

| Dossier | Rôle | Exporté par `index.ts` |
|---|---|---|
| `systems/` | Orchestration : `ThreeDevice` (bootstrap), `Runtime`, `RAF`, `Input`, `Output`, `State` ; `DeviceConfig.type.ts`, le contrat d'extension du projet ; `Renderer.type.ts`, l'union WebGL / WebGPU | `Input`, `Output`, `RAF`, `Runtime`, `State`, `Viewport`, `Renderer`, `RendererBackend`, `RendererParameters` — **pas** `ThreeDevice` ni `DeviceConfig` (chemin profond) |
| `universes/` | `UniverseBase` : scène, caméra, graphe de nodes, pipeline, contrats | `UniverseBase`, `IUniverseContract` |
| `registries/` | `UniverseRegistry` : fabriques d'univers paresseuses (`define`, `getOrCreate`, `getDefaultId`) | `UniverseRegistry` |
| `nodes/` | `NodeBase`, `Object3DNodeBase`, `InteractiveObject3DNodeBase`, `GroupNodeBase`, `NodeGroupBase`, `NodeGraph` | tous, avec leurs interfaces |
| `pipeline/` | `IPass`, `IPipeline`, `PipelineBase`, `PassContext` | tous |
| `interaction/` | `InteractionManager` : raycast différé, survol, clic, capture pendant le drag | `InteractionManager` |
| `assets/` | Manifeste typé, `AssetStore` (chargement, cache, groupes) | **rien** — importer `@_core/assets/index.ts` |
| `shaders/` | `defineShaders`, `createShaderKeys`, `createShaderStore`, `ShaderStore` | tous |
| `debug/` | `DebugManager` (Tweakpane, onglets, abonnements, instantanés, bindings persistants), `DebugValues` (arbre de réglages enregistrés), `DebugFlags` (`?debug`, `?stats`, drapeaux d'URL retenus en session) | `debug`, `DebugManager`, `DebugValueStore`, `applyValue`, `isStorable`, `serialize`, types — **pas** `DebugFlags`, importé par son chemin pour rester léger |
| `stats/` | `StatsManager` (stats-gl, three-perf, chargés à la demande) | `StatsManager` |
| `helpers/event/` | Constantes d'événements souris et clavier | `EventMouse`, `EventKeyboard` |
| `types/` | `FrameTiming { time, deltaTime }`, en millisecondes | `FrameTiming` |
| `lifecycle/` | `ILifecycle` : noms qui ne correspondent plus au contrat réel, quasi mort | — |

Dans les faits, `graphics/` importe par chemins profonds (`@_core/nodes/...`) plutôt que par le barrel.

## Démarrage

1. `app/pages/index.vue` monte `<ThreeStage>`. Au `nextTick`, le composant importe dynamiquement `ThreeDevice` et appelle `ThreeDevice.create(canvas, config)`.
2. `create` construit le renderer selon `DEVICE_CONFIG.renderer.backend` (voir [WebGL et WebGPU](#webgl-et-webgpu)), puis le constructeur de `ThreeDevice` :
   - règle le renderer (sRGB, carte d'ombres et plafonds de pixel ratio lus dans `DEVICE_CONFIG.renderer`), crée l'`AssetStore` du `ASSET_MANIFEST`, le `ShaderStore`, le `StatsManager` et le `State` ;
   - déclare chaque entrée de `UNIVERSE_MANIFEST` dans le registre, sans l'instancier ;
   - crée le `Runtime`, qui crée `Input`, `Output` (avec ses deux `PostProcessingPass`) et `RAF`.
3. `init()` :
   1. taille et viewport ;
   2. `await preloadGroup("boot")`, texture de grain, puis `DEVICE_CONFIG.onBoot(device)` ;
   3. `runtime.init()` ;
   4. `debug.setPersistence(DEVICE_CONFIG.debugPersistence)` **toujours** — les réglages enregistrés sont la configuration de la scène ;
   5. `debug.init(DEBUG_CONFIG)` **seulement si** `?debug` ; stats de base si `?stats` ;
   6. entrées DOM, panneau des stats, puis `DEVICE_CONFIG.bindDebug(device)` ;
   7. `await runtime.activateUniverse(registry.getDefaultId())` ;
   8. `start()`.
4. Le composant publie le device (`useThreeStage().publish`) et appelle `device.dispose()` au démontage.

## Ce qu'un projet fournit au core

Le `_core` importe du code projet par des chemins fixes. Pour qu'un même `_core` compile partout, **chaque projet fournit ces modules avec ces exports** :

| Module (`src/graphics/…`) | Exports attendus | Utilisé par |
|---|---|---|
| `device/device.config.ts` | `DEVICE_CONFIG: DeviceConfig` | `ThreeDevice`, `Output` |
| `debug/debug.config.ts` | `DEBUG_CONFIG` (avec `sessionPrefix`) | `ThreeDevice`, `DebugFlags` — doit rester **léger** : il est lu avant le chargement de three |
| `debug/Debug.id.ts` | `TAB_ID.RENDER`, `FOLDER_ID.STATS` | panneau des stats de `ThreeDevice` |
| `postprocessing/index.ts` | `POSTFX_PRESETS.medium`, `FINAL_CORRECTION_PRESET`, `PostProcessingPass` (`render`, `resize`, `dispose`, `setGrainTexture`), **du même backend que le renderer** | `Output`, `ThreeDevice` |
| `assets/assets.manifest.ts` | `ASSET_MANIFEST`, `ASSET_KEYS.postfx.grainTexture`, `AppAssetManifest` | `ThreeDevice` |
| `shaders/shaders.manifest.ts` | `SHADER_MANIFEST`, `AppShaderManifest` | `ThreeDevice` |
| `universes/universes.manifest.ts`, `universes/Universe.id.ts` | `UNIVERSE_MANIFEST`, `UniverseId` | `ThreeDevice` |
| `adapters/systems/DOMInputAdapter.ts` | `DOMInputAdapter` (`attach`, `dispose`) | `ThreeDevice` |
| `adapters/helpers/OrbitCamera.helper.ts` | `OrbitCameraHelper` (`bindInput`, `resize`, `toggle`, `dispose`) | `ThreeDevice` |
| `nodes/Node.id.ts` | `NodeId` | `UniverseBase`, contrats |

### `DeviceConfig`

Tout ce qui est propre à un projet et touche au device passe par `DEVICE_CONFIG` (type : `systems/DeviceConfig.type.ts`) plutôt que par une modification de `ThreeDevice` ou d'`Output`.

| Champ | Défaut | Exemple d'usage |
|---|---|---|
| `renderer.backend` | `"webgl"` | map : `"webgpu"` |
| `renderer.maxPixelRatio` | `2` | — |
| `renderer.maxPixelRatioCoarse` | `maxPixelRatio` | grass, book : `1.5` en tactile |
| `renderer.shadowMap` | `PCFSoftShadowMap` | `false` pour couper |
| `renderer.toneMappingExposure` | `1`, relue à chaque image | grass, book : getter sur `SCENE_CONFIG` |
| `debugPersistence` | aucune | lacoste : `debug.values.json` relu, écrit par la route de la sonde |
| `onBoot(device)` | — | lacoste : LUT du compositing posées sur `device.postFxPass` |
| `bindDebug(device)` | — | lacoste : inclinaison ; grass, book : inclinaison, PostFX, Godrays. Rend les désabonnements. |

## WebGL et WebGPU

| `renderer.backend` | Renderer | Matériaux | Post-traitement (`graphics/postprocessing/`) |
|---|---|---|---|
| `"webgl"` (défaut) | `WebGLRenderer` | GLSL, `ShaderMaterial` | `webgl/` : lib `postprocessing` |
| `"webgpu"` | `WebGPURenderer`, repli WebGL2 automatique si WebGPU manque | TSL, node materials | `webgpu/` : `PostProcessing` de three |

Changer de backend = deux lignes : `DEVICE_CONFIG.renderer.backend` et l'export de `postprocessing/index.ts`.

- `three/webgpu` est importé dynamiquement : un projet WebGL ne l'embarque pas.
- `device.renderer` est typé `Renderer` (union). Une API propre à un backend passe par un cast : `device.renderer as WebGLRenderer`.
- Le code GLSL (`ShaderMaterial`, `final.frag`) ne tourne pas sous `WebGPURenderer`, même en repli WebGL2. Les matériaux standards (`MeshStandardMaterial`…) marchent sur les deux.
- three-perf est WebGL seulement ; stats-gl gère les deux.
- Le seuil de `BloomNode` ne réagit pas pareil selon que `WebGPURenderer` tourne en WebGPU ou en repli WebGL2 (bloom bien plus faible en WebGL2 à `threshold` égal, three r181). Calibrer les presets sur les deux.
- Tester le repli : `forceWebGL: true` dans la config passée à `ThreeDevice.create`.

## Boucle par image

`RAF._tick` enchaîne, à chaque image :

```
Input.update           remet deltaX, deltaY et wheel a 0
Output.update          pour chaque univers actif ET monte :
  Universe.update        InteractionManager.update(camera), puis NodeGraph.update (nodes montes)
Output.render
  1. prepare           pipeline.prepare?.(frame, ctx) pour CHAQUE univers monte
  2. etat du renderer  sRGB, NoToneMapping, exposition 1, viewport et scissor pleins, clear
  3. un seul chemin parmi :
     - postFx actif (defaut)            -> PostProcessingPass sur l'univers primaire
     - sinon correction finale (defaut) -> PostProcessingPass de correction
     - sinon                            -> pipeline.render(frame, ctx) de chaque univers monte
```

L'univers primaire est le dernier activé (`activeMounted.at(-1)`). `ctx` vaut `{ scene, camera, renderer }`.

**Conséquence majeure** : postFx et correction finale sont actifs par défaut, et rien n'appelle `setPostFxEnabled(false)`. **`pipeline.render` — donc `ForwardRenderPass` — ne tourne jamais dans la configuration par défaut.** Tout travail qui doit s'exécuter à chaque image indépendamment du chemin de sortie va dans `prepare`, jamais dans `render`.

## Pipeline et passes

Un pipeline est une liste ordonnée de passes. `PipelineBase` délègue chaque méthode à ses passes, dans l'ordre (`before*` en parallèle via `Promise.all`).

| Méthode de `IPass` | Quand |
|---|---|
| `beforeMount` / `onMounted` / `beforeUnmount` / `onUnmounted` | Cycle de vie de l'univers |
| `prepare?(frame, ctx)` | À chaque image, **avant tout rendu à l'écran**, quel que soit le chemin de sortie |
| `render(frame, ctx)` | À chaque image, **seulement** si postFx et correction finale sont coupés |
| `resize`, `dispose` | Redimensionnement, destruction |

### Travail GPU hors écran (`prepare`)

Précalculs de textures, simulations, ping-pong : tout ce qui dessine dans une `WebGLRenderTarget` avant l'image. Contrat :

- la passe **rend la main avec la cible par défaut active** (`renderer.setRenderTarget(null)` ou la cible trouvée en entrant) ;
- elle peut déplacer viewport et scissor : `Output` les remet à plat juste après ;
- elle garde les appels de rendu : les nodes décrivent le travail (cible, scène, caméra, drapeau « à redessiner ») et la passe l'exécute. `renderer.render()` n'a rien à faire dans un node.

```ts
export class OffscreenPass implements IPass {
  private readonly _travaux = new Set<OffscreenJob>();
  ajouter(t: OffscreenJob): void { this._travaux.add(t); }
  retirer(t: OffscreenJob): void { this._travaux.delete(t); }

  prepare(_frame: FrameTiming, ctx: PassContext): void {
    const renderer = ctx.renderer as WebGLRenderer;
    const cible = renderer.getRenderTarget();
    for (const t of this._travaux) {
      if (!t.enAttente) continue;
      renderer.setRenderTarget(t.cible);
      renderer.render(t.scene, t.camera);
      t.termine();
    }
    renderer.setRenderTarget(cible);
  }
  render(): void {}
  // lifecycle, resize, dispose : vides
}

// Dans l'univers : la passe hors ecran en tete du pipeline.
const horsEcran = new OffscreenPass();
const pipeline = new PipelineBase([horsEcran, new ForwardRenderPass()]);
```

Implémentation complète, avec restauration de la couleur de fond et effacement à `(0, 0, 0, 0)` pour les données : `lacoste/src/graphics/passes/OffscreenPass.ts`.

## Cycle de vie

### Univers (`Output.activateUniverse` / `deactivateUniverse`)

- **Activation** : un jeton par univers (WeakMap) invalide les activations concurrentes. `active = true`, `await beforeMount()`, puis, si l'univers est toujours actif et le jeton inchangé, `onMounted()` et `markMounted()`. Si `beforeMount` jette, l'univers est retiré.
- **Désactivation** : symétrique. Si `beforeUnmount` jette, l'univers reste `mounted` mais inactif.
- **`UniverseBase.beforeMount`** : précharge les groupes de `getAssetPreloadGroups()`, **puis** en parallèle `nodeGroup.register` + `beforeMount`, `pipeline.beforeMount` et `graph.beforeMount?.()`.
- **`UniverseBase.onMounted`** : pipeline, graphe, groupes de nodes, `onDebugMount`.
- **`UniverseBase.onUnmounted`** : purge des abonnements debug, `onDebugUnmount`, groupes, pipeline, graphe.

### Nodes et `NodeGraph`

- `NodeGraph.mount(node)` : `await beforeMount`, `scene.add` si c'est un `Object3DNodeBase`, `onMounted` (non attendu : animation d'entrée possible), puis les observateurs.
- `NodeGraph.unmount(node)` : `await beforeUnmount` (animation de sortie), `scene.remove`, `onUnmounted`, observateurs.
- `NodeGraph.update` ne met à jour que les nodes montés ; `resize` et `dispose` touchent **tous** les nodes. Il n'existe pas de `remove`.
- `NodeBase` pose `mounted` dans `onMounted` / `onUnmounted` : toute surcharge doit appeler `super`. Les abonnements `inputSubscribe` sont nettoyés au démontage.

### Contrats

Le seul mécanisme d'activation de nodes du `_core`.

- `registerContract({ id, activeNodeIds })`, puis `applyContract(id)`.
- `applyContract` calcule le diff avec le contrat courant : `await unmountMany(sortants)`, puis `await mountMany(entrants)`. Un contrat déjà courant ne fait rien.
- Pendant une transition, seule la **dernière** demande est gardée ; elle est rejouée à la fin.
- Usage type : `applyContract` dans `onMounted` de l'univers.

## Assets

- `defineAssets` type un arbre d'entrées `{ src, type, group?, lazy?, postProcess? }`. Types : `texture | gltf | json | audio | video | binary` (`ArrayBuffer`).
- `createAssetKeys` en tire des clés pointées typées (`ASSET_KEYS.scene.main`).
- `AssetStore.load(clé)` : cache, puis promesse en vol dédupliquée, puis loader, puis `postProcess`, puis mise en cache.
  - `get` rend `undefined` si non chargé ; `require` jette sans charger ; `has` signifie « chargé ».
- `preloadGroup(groupe, { includeLazy })` : les entrées `lazy` sont exclues par défaut. Un node qui en a besoin les demande lui-même avec `load`.
- `dispose*` libère textures, vidéos et glTF (pas le JSON ni l'audio). Draco se charge depuis `/draco/`.
- Aucun espace colorimétrique n'est posé par défaut : c'est le rôle de `postProcess`.

## Debug, stats, shaders

- **`DebugManager`** : `init(config)` une seule fois. Les abonnements `subscribe({ ownerId, tabId, folderId?, mount(target) → cleanup? })` faits avant `init` sont montés à l'init. `registerSnapshot` alimente le bouton « Copy All Config ».
- **Bindings persistants** : `debug.bind(target | null, object, key, options, path?)` repose la valeur enregistrée sous `path` avant de créer le contrôle, et y renvoie chaque modification (écriture groupée à 400 ms, bouton « Save Settings » pour forcer). Avec `target = null`, la valeur s'applique et le contrôle rendu est inerte : on déclare les réglages **une fois** et on les consomme deux — une passe d'application au démarrage, un panneau quand il est demandé. `getSavedValue` / `setSavedValue` pour les réglages pilotés par du code.
- **Drapeaux d'URL** (`debug/DebugFlags.ts`) : `readUrlFlag(name)`, `isDebugRequested()`, `isStatsRequested()`. `?name` ouvre, `?name=0` referme, retenu dans `sessionStorage` sous `<sessionPrefix>:<name>`. Importer par le chemin du fichier, pas par le barrel (qui charge Tweakpane).
- **`StatsManager`** : stats de base **éteintes par défaut** ; chargé à la demande, allumé par `?stats` ou depuis le panneau debug de `ThreeDevice`.
- **`ShaderStore`** : `has` / `get` / `require` sur des chaînes GLSL issues d'imports `?raw`.

## Pièges connus

- **Deltas d'entrée** : `Input.update` remet `deltaX`, `deltaY` et `wheel` à 0 **avant** `Universe.update`. Lus en polling dans `update`, ils valent toujours 0 ; il faut s'abonner aux événements.
- **`pipeline.render` court-circuité** par défaut (voir [Boucle par image](#boucle-par-image)).
- **Démonter un univers ne démonte pas ses nodes** : `NodeGraph` n'a pas de méthodes de cycle de vie, et les appels `(graph as any).beforeMount?.()` de `UniverseBase` ne font rien. `_currentContractId` n'est pas remis à `null`.
- **`InteractionManager`** n'existe que si `input` est passé au constructeur de `UniverseBase`.
- **Le `_core` dépend de `graphics/`** : c'est une dette, pas un modèle. La liste exacte est dans [Ce qu'un projet fournit au core](#ce-quun-projet-fournit-au-core) ; un projet qui renomme ces fichiers casse le `_core`.

## Journal des modifications

| Date | Modification | Fichiers | Origine | Pourquoi |
|---|---|---|---|---|
| 2026-09-15 | Backend `webgpu` optionnel : `DEVICE_CONFIG.renderer.backend`, type `Renderer` (union), renderer créé dans `ThreeDevice.create`, `PostProcessingPass` importé par `postprocessing/index.ts`, stats-gl sur WebGPU. Section « Style de code ». | `systems/Renderer.type.ts`, `systems/ThreeDevice.ts`, `systems/Output.ts`, `systems/Runtime.ts`, `systems/DeviceConfig.type.ts`, `stats/StatsManager.ts`, `index.ts` | map | WebGPU prioritaire avec repli WebGL2 pour map, sans casser les projets WebGL. **Au sync** : cast `as WebGLRenderer` là où un projet lit une API WebGL via `device.renderer` (grass, book : `capabilities.maxSamples`). |
| 2026-09-15 | Étape `prepare?(frame, ctx)` sur `IPass` et `IPipeline`, implémentée par `PipelineBase`, appelée par `Output.render` pour chaque univers monté avant tout rendu à l'écran. Viewport et scissor remis à plat après. | `pipeline/*`, `systems/Output.ts` | lacoste `2ba6a32` | `Output` rend par postFx ou correction finale sans passer par le pipeline de l'univers : une passe hors écran (texture précalculée, simulation) n'y tournait jamais. |
| 2026-09-15 | Type d'asset `binary` (`ArrayBuffer`). | `assets/types.ts`, `assets/AssetStore.ts` | lacoste | Formats maison qu'aucun loader three ne couvre. |
| 2026-09-15 | Retrait de `nodes/helpers/Helper3DNode.interface.ts` et `universes/contrats/Contract.base.ts` (et `graphics/universes/contracts/NodeSwapContract.ts` du template). | — | grass `48cbca8` | Jamais importés. |
| 2026-09-15 | Bindings persistants (`DebugValues.ts`, `DebugManager.bind`, `setPersistence`, `getSavedValue`, `setSavedValue`, « Save Settings »), exports `DebugBinding` / `DebugTarget`. | `debug/*` | lacoste `c7cd7cb`, `59ae60b` | Réglages perdus au rechargement ; ils sont la configuration de la scène et doivent s'appliquer sans panneau. API renommée en anglais au portage. |
| 2026-09-15 | Drapeaux d'URL `?debug` / `?stats` retenus en session, préfixe dans `DEBUG_CONFIG.sessionPrefix` ; panneau initialisé seulement sur demande ; stats de base éteintes par défaut. | `debug/DebugFlags.ts`, `debug/types.ts`, `stats/StatsManager.ts`, `systems/ThreeDevice.ts` | grass `6d946ce`, `a1ec660`, `2a97b08` ; lacoste | Outils disponibles sur un déploiement et sur mobile sans les montrer aux visiteurs. Préfixes auparavant en dur (`lacoste:`, `grass:`, `book:`). |
| 2026-09-15 | `DeviceConfig` (`DEVICE_CONFIG` fourni par le projet) : options du renderer, persistance, `onBoot`, `bindDebug`. `FINAL_CORRECTION_PRESET` fourni par le post-traitement du projet. Getter `inputAdapter`, `Output.isPostFxEnabled()`. | `systems/DeviceConfig.type.ts`, `systems/ThreeDevice.ts`, `systems/Output.ts` | alignement lacoste, grass, book | Chaque projet avait mis son code dans `ThreeDevice` et `Output` (panneaux PostFX/Godrays, inclinaison, LUT, preset, exposition) : les `_core` ne pouvaient plus être partagés. |
| 2026-09-15 | Compteurs `renderer.info` remis à zéro une fois par image, avant `prepare` ; carte d'ombres `PCFSoftShadowMap` par défaut. | `systems/Output.ts`, `systems/ThreeDevice.ts` | lacoste ; grass `dffaf38` | L'EffectComposer n'affichait que la dernière passe (« 1 draw call ») ; sans carte d'ombres, `castShadow` est inerte sans avertissement. |

## Projets alignés

État au 2026-09-15 : backend WebGPU porté dans map seulement. lacoste, grass et book sont sur le `_core` précédent (WebGL, compatible) et restent à synchroniser.

| Projet | Dépôt et branche | Commit d'alignement | Ce qui est sorti du `_core` vers le projet |
|---|---|---|---|
| lacoste | `Dev/PP/RD/lacoste`, `feat/sol-timeline` | `47af303` | LUT du compositing (`onBoot`), panneau d'inclinaison (`graphics/device/TiltDebug.helper.ts`), `Timeline.contract.ts` (`graphics/devtools/`) |
| grass | `Dev/PP/RD/grass`, `chore/core-alignement` | `b12c78d` | Panneaux PostFX, Godrays et inclinaison (`graphics/device/*Debug.helper.ts`), preset de correction, exposition, plafond tactile, `TiltWitness` (`graphics/debug/`), `Timeline.contract.ts` |
| book | `Dev/PP/RD/book` (dépôt créé le 2026-09-15, sans remote), `chore/core-alignement` | `e21a0f3` | Comme grass |
| map | `Dev/PV/Projects/map` (sans remote), `feat/core-webgpu` | — | Backend `webgpu`, post-traitement `webgpu/` |

Côté projet, une seule chose varie encore sans être du `_core` : grass et book enregistrent leurs réglages par un `_saveDebug` maison dans leur univers, là où lacoste passe par `DEVICE_CONFIG.debugPersistence`. Les migrer est optionnel.

## Documents existants

- `README.md` (racine) : démarrage Nuxt à jour. Principes core / graphics **en partie obsolètes** :
  - place `ThreeDevice` dans `graphics/` et dit le core sans Three.js ni postprocessing ;
  - cite `onUnmount` et `Universe.render`, qui n'existent pas ;
  - ignore nodes, contrats, assets, shaders, debug, stats et `prepare`.
- `NodeContract.md` : note de conception Node / NodeGraph / Contract / Pipeline, proche du code mais rédigée comme un plan. Elle cite `remove(node)`, qui n'existe pas, et ignore le court-circuit du pipeline par le postFx.
- `docs/AUDIT_AND_PLAN.md` : **obsolète**, cite des fichiers supprimés (`pipeline/types.ts`, `Pass.base.ts`, `defineUniverse`…).
