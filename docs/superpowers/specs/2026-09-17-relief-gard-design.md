# Relief du Gard en direct — conception

Premier jalon de la carte : le relief du Gard, sans effet, chargé en direct depuis l'IGN, affiché en 3D (déplacement GPU) et navigable au glisser. Références visuelles : affiche « 30 - Gard, carte d'élévation » (relief plâtre blanc), bloc de terrain, globe en relief. Référence technique : geo-three (arbre de tuiles, niveaux de détail, fournisseurs), réécrit en TSL.

## Périmètre

| Dans le jalon | Hors jalon |
|---|---|
| Gard seul, découpé selon sa limite administrative | Autres départements, France entière, globe |
| Relief IGN niveau 9 à 13 (~150 m → ~10 m) | Niveau 14, LiDAR HD |
| Déplacement GPU TSL, normales par pixel | Effets, ombres portées, étiquettes |
| Glisser + zoom, vue fixe nord en haut | Rotation, vol libre |
| Chargement progressif avec niveaux de détail | Web Worker, recouvrement des tuiles (cassure d'ombrage aux bords) |

## 1. Données en direct

Rien n'est préparé ni versionné. Aucune dépendance ajoutée.

- **Relief** : WMTS Géoplateforme `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`, `image/x-bil;bits=32`, grille `WGS84G`. Tuile = 256 × 256 float32 little-endian, valeur < −1000 = pas de donnée. Mesuré : 120–210 ms par tuile, transfert `deflate`, `Cache-Control: private, max-age=1814400`, CORS `*`.
- **Contour** : WFS Géoplateforme `ADMINEXPRESS-COG-CARTO.LATEST:departement`, `code_insee='30'`, GeoJSON EPSG:4326 (MultiPolygon, ~6 700 points), chargé une fois.
- **Fournisseur** : `ElevationProvider.fetchTile(z, x, y, signal) → Float32Array`. Implémentation IGN : 6 requêtes simultanées au plus, annulation par `AbortController`, cache navigateur.
- **Repère de scène** : équirectangulaire local centré sur le Gard, 1 unité = 1 km, x vers l'est, z vers le sud, y vers le haut. `x = Δlon · cos(lat₀) · R`, `z = −Δlat · R`, R = 6371,0088 km. Erreur < 1 % sur le Gard.

Grille WGS84G : origine (−180°, 90°), 2^(z+1) colonnes × 2^z lignes, tuile de 180° / 2^z.

## 2. Arbre de tuiles

```
src/graphics/terrain/
  GeoProjection.ts                lat/lon ↔ scène, index et emprise de tuile
  ElevationProvider.interface.ts  contrat du fournisseur
  IgnElevationProvider.ts         WMTS BIL, file, annulation
  TileTree.ts                     subdivision, fusion, heightAt
  Tile.ts                         état, texture d'altitude, mesh
  TerrainMask.ts                  contour → texture de masque
src/graphics/nodes/terrain/Terrain.node.ts
```

- Racines : tuiles niveau 9 intersectant l'emprise du Gard et dont le masque n'est pas vide.
- Subdivision si `distance(caméra, centre) / taille < seuilBas`, fusion si `> seuilHaut` (radial, geo-three). Niveau max 13.
- Une tuile parente reste visible tant que ses 4 enfants ne sont pas prêts. La fusion annule les requêtes en cours.
- Recalcul sur mouvement de caméra ou tuile prête, dans `update()` du node.
- Tuile prête : float32 → texture `HalfFloatType` `RedFormat` filtrée linéairement ; pas de donnée → 0. Géométrie partagée 32 × 32 segments + jupes.
- Budgets : 300 tuiles affichées, cache LRU de 256 textures.
- Masque : contour rastérisé une fois (≤ 1024 px sur la plus grande dimension), lu par position monde.
- Risque à vérifier tôt : un matériau par tuile doit réutiliser le même programme GPU. Sinon, atlas.

## 3. Rendu

- `materials/Terrain.material.ts` : `MeshStandardNodeMaterial`.
  - `positionNode` : altitude (m → km) × exagération ; jupes descendues.
  - Normales par différences centrales dans la texture (pas en km, cos(lat) en x), passées en repère vue.
  - `#f1efea`, `roughness` 1, `metalness` 0. Fragments hors masque (< 0,5) écartés.
  - Exagération : uniform partagé, 2 par défaut.
- `nodes/lights/Lights.node.ts` : soleil azimut 315°, élévation 45° ; `HemisphereLight` douce. Pas d'ombres.
- Fond `#dcd9d4`. Post-traitement : `EffectPass` vide.
- Réglages debug enregistrés : exagération, azimut, élévation, intensité.

## 4. Navigation

- `nodes/cameras/MapCamera.node.ts` : `PerspectiveCamera` 35°, near = max(distance / 1000, 0,01 km), far 1000 km.
- `MapControls` : glisser = déplacement, molette/pincement = zoom vers le curseur, rotation coupée, inclinaison 50°, nord en haut, amortissement.
- Bornes : cible dans le rectangle du Gard ; distance 0,5–200 km ; cible posée sur le relief ; caméra ≥ relief + 0,1 km. Altitudes via `TileTree.heightAt(x, z)`.
- Départ : Gard entier cadré. Mouvement → recalcul des niveaux de détail. Caméra orbitale de debug (Shift+C) : contrôles suspendus pendant son usage.

## 5. Erreurs, tests, vérification

- Tuile en échec : 2 nouvelles tentatives espacées, puis état `error` ; le parent reste affiché, pas de trou.
- Contour indisponible : pas de masque (rectangle complet), avertissement console.
- Aucun réseau : seules les tuiles en cache s'affichent.
- WebGPU absent : repli WebGL2 de `WebGPURenderer`.
- Tests `node --test` (Node 24, types retirés nativement) sur les modules purs : projection et index de tuile, règles de l'arbre, rastérisation du masque, décodage (pas de donnée). Ces modules n'importent pas d'alias.
- Vérification navigateur : relief visible et masqué, requêtes réseau limitées, nombre de tuiles sous budget, navigation bornée, temps d'image mesuré.
