# Audit + Plan refactor _core

## A) Réellement utilisé aujourd’hui

| Fichier / symbole | Usage |
|-------------------|--------|
| **main.ts** | `ThreeDevice`, `device.init()`, `device.start()`, `device.dispose()` (beforeunload). Pas d’appel à `registerUniverses()` → aucun univers enregistré. |
| **ThreeDevice** | Crée renderer, state, input, output, raf, universeRegistry. Donne l’adapter et le registry à Output. N’instancie aucun Universe. |
| **Output** | `setDevice`, `setUniverseRegistry`, `update(dt)`, `render(frame)`, `dispose()`. Boucle sur `registry.getActive()` (vide). |
| **RAF** | `input.update`, `output.update`, `output.render` dans le tick. |
| **Input** | `update(time, dt)` no-op. |
| **State** | viewport, `setViewport` utilisé par l’adapter. |
| **UniverseRegistry** | `register`, `get`, `getAll`, `getActive`, `dispose`. Aucun `register()` appelé au boot. |
| **Universe** (base) | Utilisé par `MainUniverse` (graphics). Lifecycle mount appelé dans `Output.update()` quand `!u.mounted` → mélange avec la boucle frame. |
| **graphics/universes/Universe.id.ts** | `UNIVERSE_ID`, `UniverseId` utilisés par _core et Main.universe. |
| **graphics/universes/Main.universe.ts** | Classe `MainUniverse` jamais instanciée (aucun import ne fait `new MainUniverse`). |
| **_core/pipeline/types.ts** | `IGraphicsDevice`, `Viewport`, `FrameTiming` utilisés par Output/ThreeDevice. Le reste (Pipeline, PipelinePass, PassContext riche, WorldSnapshot) uniquement par postprocessing. |

## B) Futur / placeholder / non utilisé

| Élément | Statut |
|--------|--------|
| **Runtime** | Non importé dans main. Couche optionnelle pour activer un univers par id. |
| **Common.ts** | Réexporte `WorldSnapshot` ; aucun consommateur dans _core. |
| **registerUniverses()** | Mentionné en commentaire dans main, jamais appelé ; aucun univers enregistré au boot. |
| **Pass.base.ts, Pass.type.ts, PassContext.type.ts, RenderTarget.type.ts** | Chaîne “Pass” utilisée uniquement par postprocessing (PipelinePass, PassContext). |
| **lifecycle/ ILifecycle** | Utilisé seulement par Pass.type (IPass). Lié pipeline/pass. |
| **pipeline/types** (Pipeline, PipelinePass, PipelineConfig, PassContext complet, WorldSnapshot) | Utilisés uniquement par postprocessing. |
| **Node** (_core index) | Placeholder, non utilisé. |
| **universeMap** (UniverseRegistry) | Getter debug, pas une API publique. |

## C) Mélanges pipeline actuel / futur

1. **Output.update()** déclenche le lifecycle de mount (beforeMount/mount/afterMount) dans la boucle update quand `!u.mounted`. Souhait : lifecycle **uniquement** sur changement d’activation, pas dans update/render.
2. **Universe** porte à la fois un lifecycle “activation” (mount/unmount) et un “frame” (update/render). Les noms à aligner : beforeMount → onMounted, beforeUnmount → onUnmount ; déclencher seulement à l’activation/désactivation.
3. **_core/pipeline** contient (1) le strict nécessaire device/viewport/timing pour Output et (2) Pipeline, PipelinePass, PassContext, etc. pour postprocessing/futur.
4. **Universe.ts** contient des TODO “forward lifecycle to pipelines/nodes” (futur).
5. **UniverseId** vit dans graphics/ alors que le registry est dans _core → déplacer IDs dans _core (const + type).

---

## Flow actuel (mini map)

```
main
  → new ThreeDevice({ canvas })
  → device.init()  (viewport, raf.init)
  → device.start() (raf.start)

ThreeDevice ctor:
  renderer, state, input, output, universeRegistry (vide), raf(input, output)
  output.setDevice(adapter), output.setUniverseRegistry(registry)
  resize listener

raf._tick:
  input.update(time, dt)
  output.update(dt)   → getActive() = [] → rien
  output.render(frame) → getActive() = [] → rien

Dispose: beforeunload → device.dispose() → registry.dispose(), output.dispose(), raf.dispose(), renderer.dispose()
```

Aucun univers n’est enregistré : `Main.universe.ts` n’est importé nulle part, personne ne fait `new MainUniverse(device)`.

---

## Plan de modifications (fichier par fichier)

### Step 1: Remove unused

- Supprimer les `console.log` (ThreeDevice, UniverseRegistry, Main.universe).
- Retirer le getter `universeMap` de UniverseRegistry (ou le garder en privé/debug uniquement).
- Corriger **dispose()** dans ThreeDevice : les `removeEventListener` utilisent de nouvelles fonctions donc ne retirent pas les vrais listeners → stocker les références des handlers pour pouvoir les retirer.
- **Common.ts** : supprimer si plus aucun import _core ne l’utilise ; sinon laisser un réexport minimal (WorldSnapshot reste dans pipeline/types pour postprocessing).
- **Runtime** : garder en optionnel, ne pas l’utiliser dans main pour l’instant.

### Step 2: Isolate pipeline code out of _core

- **_core/pipeline** : garder uniquement ce dont Output/device ont besoin dans un fichier dédié : **IGraphicsDevice**, **Viewport**, **FrameTiming** (ex. `_core/pipeline/core.types.ts` ou garder `types.ts` en le scindant).
- Ne pas exporter depuis `_core/index` : Pipeline, PipelinePass, PassContext (complet), WorldSnapshot, PipelineConfig. Les laisser dans `_core/pipeline/types.ts` pour que postprocessing continue d’importer depuis `@_core/pipeline/types.js`, mais ne pas les mettre dans le “coeur” public de _core.
- Ajouter un court commentaire en tête de `_core/pipeline/types.ts` : types “core” (device, viewport, timing) vs types “pipeline/pass” (pour graphics/postprocessing).
- **Pass.base**, **Pass.type**, **PassContext.type**, **RenderTarget.type** : laisser dans _core pour ne pas casser postprocessing ; commentaire indiquant “Used by graphics/postprocessing; not part of core loop”.
- **lifecycle/** : idem, garder pour Pass.type ; commentaire “Used by pipeline/Pass layer (graphics)”.

### Step 3: Lazy universe registry

- **UniverseId** : déplacer dans _core → `_core/universes/UniverseId.ts` (UNIVERSE_ID const + type). `graphics/universes/Universe.id.ts` réexporte depuis _core.
- **UniverseRegistry** : “définitions + instances”.
  - Définitions : `Map<UniverseId, (device: IUniverseDevice) => Universe>` enregistrées via `defineUniverse(id, factory)`.
  - Instances : créées à la demande quand Output active un id (`getOrCreateInstance(id)`).
  - Module **definitions** : `_core/universes/definitions.ts` avec `defineUniverse(id, factory)` et `getDefinitions()` (liste/map). Les fichiers universe font `defineUniverse(UNIVERSE_ID.MAIN, (device) => new MainUniverse(device))` au top-level.
  - **UniverseRegistry** reçoit les définitions (option constructeur ou `loadDefinitions()`), garde `_device`, `_instances`; `setDevice(device)`; `getOrCreateInstance(id)` crée l’instance si besoin et la met en cache.
- **Bootstrap** : main (ou un module bootstrap) fait un `import.meta.glob` des `*.universe.ts` (eager) pour déclencher les `defineUniverse`, puis `new ThreeDevice({ canvas, universeDefinitions: getUniverseDefinitions() })` (ou équivalent).
- **ThreeDevice** : reçoit les définitions et les passe au UniverseRegistry. Plus de `registerUniverses()` qui instancie directement.

### Step 4: Output lifecycle + boucle frame

- **Lifecycle uniquement sur changement d’activation.**
  - Output expose `activate(id)` et `deactivate(id)` (et éventuellement `setActiveIds(ids)` selon le design).
  - **activate(id)** : `instance = registry.getOrCreateInstance(id)` (registry a besoin de device → `setDevice(device)` appelé depuis ThreeDevice); désactiver l’ancien actif (beforeUnmount, onUnmount, mark unmounted); définir le nouvel actif; beforeMount, onMounted, mark mounted.
  - **deactivate(id)** : beforeUnmount, onUnmount, mark unmounted.
  - **update(dt)** et **render(frame)** : ne font **jamais** beforeMount/onMounted/beforeUnmount/onUnmount. Ils itèrent uniquement sur les univers actifs **et** montés, et appellent seulement beforeUpdate/update/afterUpdate et beforeRender/render/afterRender.
- **Universe** : renommer hooks pour coller au spec : beforeMount, **onMounted** (au lieu de afterMount), beforeUnmount, **onUnmount** (au lieu de afterUnmount). Garder update/render comme aujourd’hui.
- **main** : après création du device, appeler `output.activate(UNIVERSE_ID.MAIN)` (ou le premier id défini) pour démarrer un univers. Optionnel : utiliser Runtime pour ça.

### Step 5: Final cleanup

- Nettoyer tous les console.log restants.
- Vérifier que _core n’exporte que le nécessaire (device, state, input, output, raf, registry, Universe, UniverseId, defineUniverse, types “core” pipeline).
- S’assurer qu’aucune logique “pipeline manager / passes / postprocessing” ne pilote le coeur _core.

---

## Résumé des étapes

1. **Step 1** : remove unused (logs, universeMap public, fix dispose listeners).
2. **Step 2** : isolate pipeline (commentaires, _core index n’exporte pas Pass/Pipeline/WorldSnapshot comme “core”).
3. **Step 3** : lazy universe (UniverseId dans _core, definitions + getOrCreateInstance, defineUniverse dans les fichiers universe, glob dans main/bootstrap).
4. **Step 4** : Output lifecycle uniquement sur activation; update/render sans mount/unmount.
5. **Step 5** : final cleanup et vérifications.
