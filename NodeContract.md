README — Nodes, Contracts, Passes (V2)
Objectif

Rendre l’architecture lisible, optimisable et contrôlable :

Universe = “mon monde” (state + contrats + orchestration de transitions)

NodeGraph = possède et gère tous les Nodes (entités du monde)

Pipeline = “recette de rendu” = liste ordonnée de Passes

Pass = étape de rendu (forward render, postFX, debug, shadow, RTT…)

✅ On garde ton principe : le lifecycle ne se déclenche qu’à l’activation/désactivation, jamais “au fil du render”.

Concepts
1) Node (monde)

Un Node représente une entité du monde (souvent un Object3D : Mesh/Camera/InstancedMesh, etc.) :

lifecycle : beforeMount → onMounted → beforeUnmount → onUnmounted

frame : update(dt) (logique/anim/state)

optionnel : resize(w,h), dispose()

Important : un Node ne “render” pas.
En Three.js, ce n’est pas un mesh qui rend : c’est un renderer qui rend scene + camera.

➡️ Donc render() sort du Node.

2) NodeGraph (owner des nodes)

Une classe dédiée possède les nodes et gère :

add(node) / remove(node)

mounting/unmounting (add/remove à la scène, si node graphique)

update(dt) qui itère sur les nodes actifs

resize(w,h) / dispose()

éventuellement lookup par id/tag

Universe ne “possède” pas techniquement les nodes si tu veux : c’est le NodeGraph qui les possède.

3) Universe (contrats + transitions)

L’Universe ne rend pas. Il orchestre le monde via des Contracts (= variants).

Un Contract décrit :

quels nodes sont “actifs/visibles”

comment on transitionne A → B (entrée/sortie)

Exemple :

Contract_1 : objet 1 visible

Contract_2 : objet 2 visible
Transition : scale out → swap → scale in

➡️ universe.applyContract(nextId) orchestre :

exit du contract courant

swap des nodes (actifs/visibles)

enter du prochain contract

Le pipeline ne change pas pendant cette transition.

4) Pipeline (recette de rendu)

Un Pipeline = liste ordonnée de Passes.

Rôle :

activer/désactiver ses passes (lifecycle)

exécuter passes.render() dans l’ordre à chaque frame

gérer resize() / dispose()

“sait” rendre un Universe (ou plutôt un RenderState exposé par Universe/Graph)

5) Pass (étape de rendu)

Un Pass est une unité de rendu, très explicite et profilable :

lifecycle : beforeMount / onMounted / beforeUnmount / onUnmounted

frame : render(frame, ctx)

optionnel : resize, dispose

ctx contient :

renderer (ou GraphicsDevice)

accès au monde : scene, camera, targets, etc.

Boucle RAF (Runtime)

La RAF devient ultra lisible :

Input.update(t)

Universe.update(dt) (qui peut appeler NodeGraph.update(dt) + gérer transitions)

Pipeline.render(frame, universe) (passes)

Pseudo-flow :

Input.update(t)
Universe.update(dt)
  ├─ NodeGraph.update(dt)
  └─ Contract transitions if any
Output.render(frame)
  └─ Pipeline.render(frame, ctx(universe))
       ├─ Pass 1
       ├─ Pass 2
       └─ Pass 3

Règles d’or (pour éviter 80% des bugs)

beforeMount/beforeUnmount doivent être awaitables (Promise.all)

Le lifecycle ne se déclenche qu’à l’activation/désactivation

Les Nodes ne dépendent pas de WebGLRenderer (core agnostic)

Un Pipeline ne possède pas les Nodes : il exécute des Passes qui consomment un état de monde

Contracts = “quel contenu est actif” ; Pipelines = “comment on produit l’image”

Exemple concret : “bouton swap Object3D”

Contrats :

Object1Contract : nodeA visible, nodeB hidden

Object2Contract : nodeA hidden, nodeB visible

Transition :

exit : scale down node sortant

swap : toggle visibility / attach/detach scene

enter : scale up node entrant

Mapping avec tes fichiers actuels

Tu as actuellement :

INode contient render(frame, renderer) → à retirer

PipelineBase possède _nodes → à remplacer par _passes

UniverseBase contient scene/camera → ok (ou peut déléguer au graph)