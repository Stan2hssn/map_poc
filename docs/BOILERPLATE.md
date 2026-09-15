📘 README — Architecture Core / Graphics (Option 2 – Générique)
🚀 Demarrage

Le template tourne sur Nuxt 4. Le moteur 3D vit dans `src/`, hors du `srcDir`
Nuxt : une nouvelle version du template s'y recopie sans rebaser un import.
La couche Vue (`app/`) ne fait que monter un canvas et publier le device.

```bash
pnpm install
pnpm dev
```

| Chemin | Role |
| --- | --- |
| `src/_core/` | Moteur generique, sans Three.js ni Vue |
| `src/graphics/` | Implementation Three.js : univers, nodes, passes, postfx |
| `app/` | Couche Nuxt : `ThreeStage.client.vue` monte le canvas, `useThreeStage` le publie |
| `nuxt.config.ts` | Alias `@`, `@_core`, `@graphics`, plugin GLSL, inclusion de `src/` au typecheck |

Le canvas est monte cote client uniquement (`.client.vue`) : WebGL n'existe pas
au rendu serveur. La page reste servie par le serveur, seul le canvas attend
l'hydratation.

🎯 Objectif

Construire une architecture stable, lisible et évolutive pour des applications 3D temps réel (Three.js aujourd’hui, autre backend demain), en séparant strictement :

_core/ → moteur générique, immuable, framework-agnostic

graphics/ → implémentation concrète (Three.js, univers, scènes, rendu)

Le _core ne doit pas être modifié lors du développement des features visuelles ou métier.
Toute évolution spécifique passe par graphics/.

🧠 Principes Fondamentaux
1. _core est une librairie, pas l’app

Aucun import Three.js

Aucun rendu concret

Aucune connaissance des univers concrets

Aucun pipeline / postprocessing

Seulement :

orchestration

lifecycle

timing

état

registry générique

👉 _core doit pouvoir être publié comme package indépendant.

2. graphics est l’adaptateur applicatif

Implémente le rendu réel (Three.js)

Définit les univers concrets (scènes, caméras, meshes)

Fournit un manifest explicite des univers disponibles

Crée le device graphique (renderer, canvas, etc.)

👉 graphics peut changer librement sans impacter _core.

3. Identifiants génériques (Option 2)

Le _core ne connaît pas les IDs concrets des univers.

Il est générique :

Id extends string


Les IDs réels sont définis dans graphics via const + type.

🔁 Cycle de Vie (Lifecycle)

Le lifecycle n’est PAS lié au render.

Il est déclenché uniquement lors d’un changement d’état d’activation.

Contrat exact
INACTIVE → ACTIVE
  beforeMount()
  onMounted()

ACTIVE → INACTIVE
  beforeUnmount()
  onUnmount()

Règles strictes

❌ Aucun lifecycle dans update() ou render()

❌ Aucun lifecycle par frame

✅ update() et render() ne sont appelés que si l’univers est actif ET monté

Ce même contrat sera propagé plus tard :

Universe → Pipeline → Node


(pour animations, transitions, hot-swap, etc.)

🧩 Responsabilités par couche
_core/
Runtime

L’OS de l’app.

Possède :

State

Input

Output

RAF

UniverseRegistry<Id>

Orchestre :

activation / désactivation des univers

boucle principale via RAF

API clé :

setActiveUniverses(ids: Id[])
activateUniverse(id: Id)
deactivateUniverse(id: Id)

UniverseBase<Id>

Classe abstraite générique.

Contient :

id: Id

mounted: boolean

active: boolean

Expose les hooks :

beforeMount()
onMounted()
beforeUnmount()
onUnmount()
update(dt)
render(frame)
dispose()


Aucune dépendance graphique.

UniverseRegistry<Id>

Registry lazy.

Stocke :

les définitions (id → ctor)

les instances (id → instance)

Responsabilité :

define(id, ctor)

getOrCreate(id)

❌ Ne gère PAS le lifecycle

❌ Ne gère PAS update/render

Output

Pilote le cycle des univers, pas le rendu concret.

Déclenche le lifecycle lors des activations

Appelle update() et render() sur les univers actifs

Ne connaît pas Three.js

RAF

Horloge pure.

À chaque tick :

input.update(time, dt)
output.update(dt)
output.render({ time, dt })

graphics/
ThreeDevice

Bootstrap spécifique à Three.js.

Crée :

canvas

WebGLRenderer

Instancie le _core Runtime

Injecte les univers depuis le manifest

Active les univers initiaux

UniverseId

Définition applicative.

export const UNIVERSE_ID = {
  MAIN: "MAIN",
  DEBUG: "DEBUG",
} as const;

export type UniverseId =
  typeof UNIVERSE_ID[keyof typeof UNIVERSE_ID];

Universes

Implémentations concrètes.

Étendent UniverseBase<UniverseId>

Possèdent :

scene

camera

logique métier

render() appelle :

renderer.render(scene, camera)

universes.manifest.ts (Option B)

Manifest explicite et lisible.

export const UNIVERSE_MANIFEST = [
  { id: UNIVERSE_ID.MAIN, ctor: MainUniverse },
]


Aucune magie, aucune auto-registration.

📂 Arborescence cible
src/
├─ _core/
│  ├─ systems/
│  │  ├─ Runtime.ts
│  │  ├─ RAF.ts
│  │  ├─ Output.ts
│  │  ├─ Input.ts
│  │  └─ State.ts
│  ├─ universe/
│  │  ├─ Universe.base.ts
│  │  └─ UniverseRegistry.ts
│  └─ types/
│     └─ Frame.type.ts
│
├─ graphics/
│  ├─ ThreeDevice.ts
│  ├─ universes/
│  │  ├─ Universe.id.ts
│  │  ├─ universes.manifest.ts
│  │  └─ impl/
│  │     └─ Main.universe.ts
│
└─ shims.d.ts

✅ Bénéfices

_core stable, testable, portable

graphics libre, itératif

Aucun mélange pipeline / futur pipeline

Lifecycle clair et déterministe

Lazy loading propre des univers

Architecture prête pour :

multi-univers

transitions animées

hot-swap

multi-backend (WebGPU, Canvas, etc.)