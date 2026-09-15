# Carte interactive de France — WebGL/WebGPU temps réel
 
> 🚧 **Statut : Work In Progress / exploration.** Ce document sert de note de cadrage pour poser le périmètre, l'architecture cible et les inconnues avant de coder quoi que ce soit.
 
## Pitch
 
Une carte interactive de la France entière, dans l'esprit visuel du site [Chartogne-Taillet par Immersive Garden](https://immersive-g.com/cases/chartogne-taillet) (rendu WebGL stylisé façon "dessiné à la main"), mais :
 
- à l'échelle du pays entier (pas un seul domaine viticole) ;
- avec des données **temps réel** superposées (façon [liveuamap](https://liveuamap.com)), récupérées par scraping/agrégation plutôt que pré-chargées en dur ;
- optimisée pour rester utilisable sur des devices modestes et des connexions faibles.
## Pourquoi ce README existe
 
Ce projet croise trois problèmes de nature différente, qu'il faut traiter séparément pour ne pas se planter dans l'architecture dès le départ :
 
1. **Le rendu / style visuel** — reproduire une esthétique stylisée en WebGL/WebGPU.
2. **L'échelle géographique** — passer d'un domaine de quelques hectares à ~550 000 km².
3. **Les données temps réel** — afficher du contenu qui change en continu, collecté depuis des sources externes.
Le détail de chacun est ci-dessous, avec les choix d'architecture qui en découlent.
 
## Architecture cible
 
### 1. Couche carte de base — procédural, pas de textures bakées
 
Le site Chartogne-Taillet obtient son rendu "dessiné à la main" via un pipeline multi-passes (opacité / hachures / profondeur, compositées avec détection de contours + bruit de Perlin) appliqué à des **textures pré-cuites sur un domaine restreint**, modélisé à la main à partir d'imagerie satellite.
 
Ce n'est pas transposable tel quel à l'échelle nationale : le poids de textures bakées sur toute la France serait ingérable, et le travail de modélisation manuelle représenterait des années-homme.
 
**Choix retenu pour ce projet :** un style **procédural par shader**, appliqué en temps réel à des **tuiles vectorielles** (type MapLibre GL / Mapbox GL avec un pass de shader custom simulant l'effet crayon/aquarelle), plutôt que des textures bitmap pré-générées. Sources de données géographiques envisagées : IGN (Géoportail / BD TOPO) ou OpenStreetMap.
 
Avantages : poids par ordre de grandeur inférieur aux textures bakées, chargement par tuile/LOD selon la zone visible (comme Google Earth), et compatible nativement avec du contenu qui change.
 
### 2. Couche données temps réel — pipeline serveur, pas de scraping client
 
Liveuamap ne scrape pas côté navigateur : un backend agrège des flux (presse, réseaux sociaux, remontées terrain), dédoublonne, géocode, et sert le résultat via une API/CDN mise en cache.
 
**Choix retenu :** même logique ici. Le scraping/agrégation se fait **côté serveur**, de façon asynchrone (jobs planifiés), avec :
 
- une étape de collecte (scraping ou API quand disponible),
- une étape de normalisation/géocodage/déduplication,
- un stockage intermédiaire,
- une couche API/CDN qui sert des données déjà traitées et mises en cache aux clients.
Le rendu WebGL/WebGPU consomme ces données comme un **overlay** (points, heatmap, polygones) au-dessus de la carte de base — il ne génère jamais de texture "à la volée" à partir du scraping.
 
⚠️ **Point de vigilance à traiter tôt dans le projet, pas en fin de course :** légalité du scraping des sources visées (conditions d'utilisation, `robots.txt`, RGPD si données personnelles). À clarifier source par source avant d'industrialiser la collecte.
 
### 3. Couche performance / compatibilité
 
- **WebGPU en priorité, fallback WebGL2 systématique** — le support WebGPU n'est pas encore universel (Safari, Android bas de gamme), donc les deux pipelines de rendu doivent être maintenus en parallèle.
- **Chargement progressif** : fond animé affiché immédiatement, détail chargé de façon asynchrone (comme sur Chartogne-Taillet).
- **LOD géographique** : ne charger en détail que la zone visible/zoomée.
- **Scaling de qualité dynamique** : mesure du framerate en continu, dégradation automatique des effets sur device ancien.
- **UI légère** : éviter de reproduire le choix "100% UI en WebGL" de Chartogne-Taillet tant que ce n'est pas justifié par un besoin de perf réel — ça complexifie l'accessibilité et le dev pour un gain qui n'est pertinent que sur leur cas très spécifique.
## Stack envisagée (à valider)
 
| Brique | Piste |
|---|---|
| Rendu | Three.js ou WebGPU natif, avec fallback WebGL2 |
| Tuiles carte | MapLibre GL (open-source, pas de vendor lock-in) |
| Données géo | IGN Géoportail / OpenStreetMap |
| Scraping/agrégation | Jobs planifiés côté serveur (à définir : langage/orchestrateur) |
| Cache/CDN | À définir selon fréquence de rafraîchissement des données |
 
## Roadmap proposée
 
1. **Prototype de style** sur une petite région (1-2 départements) pour valider le rendu procédural avant d'investir sur l'échelle nationale.
2. **Pipeline de données** construit en parallèle, indépendamment du rendu (le rendu ne doit jamais dépendre du scraping brut).
3. **Intégration overlay temps réel** sur le prototype de style validé.
4. **Passage à l'échelle nationale** (tuiles, LOD, cache).
5. **Optimisation bande passante / bas de gamme** en continu, pas en fin de projet.
## Questions ouvertes
 
- Quelles sources de données temps réel exactement ? (détermine la légalité et l'architecture de collecte)
- Quel niveau de fidélité visuelle est acceptable en dégradé ("dessiné main" complet vs. stylisation procédurale plus simple) ?
- Fréquence de rafraîchissement des données attendue (seconde ? minute ? heure ?) — ça change complètement le dimensionnement du pipeline serveur.
- Budget bande passante cible par session (à chiffrer pour piloter les choix de compression/LOD).
## Références
 
- [Chartogne-Taillet — étude de cas, Immersive Garden](https://medium.com/@hello_11138/chartogne-taillet-experience-site-case-study-53431d5f75f7)
- [Chartogne Taillet — Immersive Garden](https://immersive-g.com/cases/chartogne-taillet)
- [LiveUAMap — Bellingcat Toolkit](https://bellingcat.gitbook.io/toolkit/more/all-tools/liveuamap)