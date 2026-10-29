# La documentation d'Archives

> **En une phrase :** une série de petits cours pour comprendre, sans être développeur, comment une carte de France en relief est dessinée à l'encre dans un navigateur, et pourquoi on l'a construite ainsi.

Chaque chapitre suit le même plan : l'idée expliquée simplement, comment ça marche en gros (avec de vrais chiffres), pourquoi ce choix, ce qu'on aurait pu faire autrement, les limites actuelles, puis où le trouver dans le code. Un chapitre se lit en 5 à 10 minutes.

Les mots techniques sont expliqués à leur première apparition et rassemblés dans le [glossaire](./glossaire.md).

## Parcours de lecture conseillé

Lis dans l'ordre si tu découvres le projet. Chaque chapitre renvoie aux autres quand un sujet est traité ailleurs.

### 1. Les bases

- [Les bases : comment un navigateur dessine de la 3D](./00-les-bases.md) : pixels, carte graphique, triangles, caméra, shaders, textures, tuiles. Le vocabulaire de tout le reste.

### 2. La carte en 3D

- [Vue d'ensemble](./3d/README.md) : l'astuce principale (une grille collée à l'écran, la carte qui glisse dessous) et la chaîne complète en une page. Porte d'entrée des chapitres suivants.
- [D'où viennent les données](./3d/donnees.md) : l'IGN et les services publics interrogés en direct, les tuiles, la mémoire.
- [Construire le terrain](./3d/terrain.md) : d'une image d'altitudes à des points, puis à un relief en triangles.
- [Construire les bâtiments](./3d/batiments.md) : du contour au sol au volume, et les variantes (à plat, volumes).
- [La végétation](./3d/vegetation.md) : semer des arbres dans les zones de bois.
- [Les voitures et les bateaux](./3d/vehicules.md) : des véhicules qui ne sont qu'une distance parcourue sur un tracé.
- [Le ciel](./3d/ciel.md) : avions et nuages.

### 3. Le dessin

- [De la 3D au dessin à l'encre](./dessin.md) : contours, hachures, papier, et le mode nuit.

### 4. Ce qu'on fait avec la carte

- [Se déplacer](./navigation.md) : glisser, zoomer, voler, sans que la caméra voyage.
- [Les noms et les lieux](./lieux.md) : choisir les noms à afficher, les écrire, colorier un territoire au survol.

### 5. Autour de la carte

- [L'application autour de la carte](./interface.md) : la page web posée par-dessus, l'écran d'entrée, le panneau de réglages, la mise en ligne.
- [Comment le code est organisé](./moteur.md) : le moteur, les éléments de la scène, les tests.

### À garder sous la main

- [Glossaire](./glossaire.md) : tous les mots techniques, avec le chapitre où ils servent.

## Les autres documents

- [Cadrage technique](./cadrage-technique.md) : la note écrite avant le projet, pour la suite. Elle pose le périmètre des données temps réel (collecte côté serveur, légalité de la récupération des données). Elle décrit ce qui reste à construire, pas ce qui existe.
- [`archive/`](./archive/) : les anciens documents de conception et les plans de travail des sessions passées (relief, carte plein écran, audit). Gardés pour l'historique ; ils ne décrivent plus forcément le code actuel.
- [Règles du moteur partagé](../src/_core/README.md) : la référence technique du moteur commun à plusieurs projets, pour les développeurs.
