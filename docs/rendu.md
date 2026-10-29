# Rendu encre et papier

La carte est une scène three.js éclairée (WebGPU, TSL) qu'une passe plein écran redessine en gravure : contours, hachures ou trame, papier et journal. Le sol imprime lui-même son plan (eau, bois, routes, bâti) et transmet à l'encre, dans l'alpha d'une seconde sortie (MRT), ce qui doit être dessiné et le lieu survolé. La page d'entrée est composée par la même passe, puis retirée par un masque à l'écran. Grille, altitudes et masque elliptique : voir [`terrain.md`](terrain.md).

```
Lights (soleil, ciel, ombres) -> Terrain.material (relief, creux, brume, plan imprimé, eau, survol)
  + Buildings.material (volumes, buildingSurface) -> RenderPass (MRT : output, normal + part dessinée en alpha, profondeur)
  -> EffectPass [InkEffect] (tremble ancré, contours, tons -> InkStyle, papier x journal, survol, pageOver)
  -> renderOutput sRGB à l'écran -> OverlayPass x3 (noms, panneau, intro)
```

## Éclairage

### Soleil, ciel et ombres du relief — [`src/graphics/nodes/lights/Lights.node.ts`](../src/graphics/nodes/lights/Lights.node.ts)
- **Comment** : `DirectionalLight` placée par azimut et élévation (117°, 22°, intensité 4) à 400 unités ; shadow map 4096², frustum ±150, bias −0,0005, normalBias 0,05, caméra d'ombre limitée au calque `SHADOW_CASTERS_LAYER` (le sol y a une grille plus grossière). `HemisphereLight` blanche (`ambient` 0,2), `groundColor` = `bounce` (0,35). `relief(m)` : intensité d'ombre = smoothstep(40, 120 m), `autoUpdate` coupé quand elle est nulle.
- **Pourquoi** : un soleil bas fait lire le relief ; l'ombre douce reste hachurable au lieu de tomber en aplat noir. Sur une vue plate (une ville), la passe d'ombre coûtait 3 à 6 ms sans rien dessiner ; le bâti a ses ombres cuites dans sa texture de hauteurs.
- **Sources** : [DirectionalLightShadow](https://threejs.org/docs/pages/DirectionalLightShadow.html), [HemisphereLight](https://threejs.org/docs/pages/HemisphereLight.html).
- **Limites** : frustum fixe, une seule cascade : ombres coupées au-delà de ±150 unités et aliasing au loin. Les valeurs effectives sont celles de `debug.values.json` (`lights.*`).

## Shading du sol

### Relief éclairé : normales, creux, mer — [`src/graphics/materials/Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts) (`createTerrainMaterial`)
- **Comment** : par sommet (`vertexStage`) : pente par différences centrales à ±1,5 texel (`NORMAL_SPREAD`) ; creux = hauteur moyenne de deux anneaux (3 texels / 4 points dans le détail, 12 texels / 8 points dans l'aperçu) moins la hauteur locale, × `occlusion` (1,5), borné à 0,85. Couleur `RELIEF` (0xe4e4e4) × creux ; la mer passe à `seaTone` (0,97, presque papier) et descend de `SEA_DROP` (0,3 unité). `MeshStandardNodeMaterial`, rugosité 0,85.
- **Pourquoi** : évalué par sommet, bien moins d'invocations que par pixel, et absent de la passe d'ombre. L'anneau de hauteurs tient lieu de SSAO sans passe plein écran.
- **Sources** : obscurance / occlusion ambiante par échantillonnage de champ de hauteurs (technique classique, sans papier unique).
- **Limites** : normale et creux interpolés entre sommets : un petit relief entre deux sommets disparaît. Le bâti n'assombrit le sol que par `contactShade`.

### Bruit de brume et brume — `createNoiseTexture`, dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : texture R8 256², 3 octaves de value noise périodique (8, 16, 32 cellules, poids 1, ½, ¼, lattice LCG a = 16807, interpolation smoothstep), ramenée à moyenne 0,5 et écart-type 0,16. Lue à deux échelles fondues pendant le zoom (`twoScales` : `mistScales`, `mistBlend`, recalculés par `TerrainNode` à chaque octave de largeur de vue). Brume = smoothstep(0,45 ; 0,8 ; bruit) × moitié basse du relief × (1 − 0,7 mer) × `mist` × smoothstep(80, 600 m, relief) ; elle blanchit la couleur (0xf4f4f4), ajoute un émissif de 0,25 × brume et éclaircit le plan imprimé.
- **Pourquoi** : deux lectures au lieu d'un bruit calculé par pixel (environ 3 ms par image). Périodique, donc sans couture une fois ancrée aux coordonnées géographiques. Pas de brume sur une ville plate : pas de creux où se loger.
- **Sources** : value noise fractal ; générateur « minimal standard » de Park et Miller (1988).
- **Limites** : la grille du value noise se voit à fort grossissement. Le même bruit sert au bord du masque, à `pencilReveal`, aux traits d'eau et à l'arrivée du rouge du survol : le changer les modifie tous.

### Plan imprimé et traits de plume — `landcoverAt`, `drawLandcover`, `penLines` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : texture RGBA de données (R bâti, G végétation, B eau) et texture des routes, produites par [`Landcover.helper.ts`](../src/graphics/nodes/terrain/Landcover.helper.ts). Aplats = smoothstep(0,5 ± fwidth), contours = |v − 0,5| < 1,5 fwidth. Tant que `landcoverReveal` < 1 (branche uniforme), l'image précédente est lue et fondue dans la nouvelle. Composition : végétation teintée (0xcfd5e2 × 0,35) et hachurée à 45° en coordonnées géo (`penLines` : 30 traits par cellule de brume, largeur 0,12 du pas, × `inkSettings.detail` × 0,45), eau, routes en réserve de papier (0,85) cernées d'encre sombre, bâti à plat `FLAT_INK` (0,42) cerné. Le résultat multiplie `output.rgb` (borné à 1) après l'éclairage, × `landcoverStrength` × masque dessiné.
- **Pourquoi** : bords nets à toute échelle depuis une texture basse résolution, par seuil à 0,5 comme un champ de distance. Imprimé et non éclairé : un soleil fort ne l'efface pas. Hachures de végétation accrochées au sol, et les premières à tomber quand `detail` baisse.
- **Sources** : Chris Green, « Improved Alpha-Tested Magnification for Vector Textures and Special Effects », SIGGRAPH 2007 (seuil à 0,5 d'une texture filtrée) ; antialiasing analytique par `fwidth`.
- **Limites** : les données rasterisées ne sont pas un vrai SDF : coins arrondis, éléments de moins d'un texel perdus. Le canal G n'a pas de contour.

### Eau à la plume — `shoreAt`, `seaLines`, `penWater` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : part de terre = mix(lecture locale ; moyenne d'un anneau de 6 points à 2 texels ; 0,8) dans l'aperçu : transition de largeur constante. Profondeur (0 au rivage, 2 au large) par deux anneaux de 4 points à 0,35 × et 1 × `waterReach` (0,22 du bloc), lus seulement si terre < 0,99. Traits à 45° (`x + y` en géo, `waterLines` = 30 par cellule) ondulés par le bruit (`waterWave`), qui tremblent et changent d'épaisseur près de la rive (`waterSurf`) ; à chaque palier de profondeur un trait sur deux disparaît (coordonnée × 2^−n). Encre la plus sombre (`INK_DARK`), trait de côte par bande sur la part de terre.
- **Pourquoi** : sans le lissage par anneau, le trait de côte suit en escalier les texels du relief, et une grille plus fine n'y change rien. La mer est du papier, ses traits la disent ; diviser par puissances de 2 garde fixes les traits restants. Un trait plein évite que l'encre le re-hachure comme un gris.
- **Sources** : convention cartographique des lignes d'eau gravées (water lining).
- **Limites** : profondeur approchée par 8 points, pas une bathymétrie. Le lissage (`pixel` = fwidth en géo) se calcule hors de la branche `If`, où les dérivées ne sont pas valides. Lit l'aperçu, pas le détail.

### Bâti : ombres cuites et marche dans les hauteurs — `buildingSurface`, `sunLight`, `contactShade` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts), [`Buildings.material.ts`](../src/graphics/materials/Buildings.material.ts)
- **Comment** : technique `buildings.technique` (`"none"` | `"extrusion"`, [`Buildings.node.ts`](../src/graphics/nodes/buildings/Buildings.node.ts)). Le sol lit l'ombre du bâti cuite par le worker (`buildingShade`, hauteur sous laquelle un point est à l'ombre), bord adouci sur `shadowSoftness` × 25 m, et un creux de contact en 4 lectures en croix. Les volumes extrudés (`clay`) ne fournissent que la couverture : `buildingSurface` part du sommet local (`buildingSummits`), descend par cellules de pics (`marchEntry`, `PEAK_CELL`), reprend la marche fine un pas au-dessus du volume pour 4 pas (`SURFACE_STEPS`), affine par 3 dichotomies ; normale, soleil et creux viennent de la même texture. Mip choisi par `fwidth`.
- **Pourquoi** : contours rugueux, grain des murs, ombres et creux cohérents avec le sol, sans passe d'ombre pour le bâti. Partir du sommet des environs évite de marcher depuis 255 m dans une ville de 20 m.
- **Sources** : Steep Parallax Mapping (McGuire et McGuire, 2005) ; Relief Mapping, recherche linéaire puis binaire (Policarpo, Oliveira, Comba, 2005) ; Maximum Mipmaps (Tevs, Ihrke, Seidel, 2008).
- **Limites** : bornes fixes (48 pas grossiers, 96 fins) : arêtes fines manquées en vue rasante. Hauteurs 8 bits × 255 m, quantifiées au mètre. Coût par pixel couvert réglé par `shading.*`.

### Apparition au crayon — `pencilReveal`, `revealNoise` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : seuil lissé (±0,05) du bruit de brume ancré en géo (5 cellules par cellule de brume) contre `progress × 1,3 − 0,15`. Utilisé par les volumes extrudés ([`Buildings.material.ts`](../src/graphics/materials/Buildings.material.ts)) : passage du bâti à plat (`FLAT_BUILDING`) à l'argile pendant la montée, puis part de la texture de hauteurs prise en compte.
- **Pourquoi** : les éléments arrivent tache par tache, bord franc, jamais en fondu (référence : Chartogne-Taillet).
- **Sources** : dissolve par seuil sur bruit.
- **Limites** : bruit fondu entre deux échelles pendant le zoom : les taches glissent légèrement.

### Survol et contrat de l'alpha MRT — `HOVER_BAND`, `HOVER_SLOTS` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : 3 places (le lieu survolé et deux qui refluent), chacune avec le champ de distance de son contour (0,5 sur la limite, `AreaMaskHelper`), son cadre géo et sa part révélée. Dedans = step(0,5 ; champ) × step(grain, part) ; périmètre = |champ − 0,5| < 1,1 × fwidth, coupé sur l'eau. `normal.a = part dessinée + HOVER_BAND (2) × (dedans + périmètre)` ; les volumes et les nuages écrivent leur part en négatif. À l'encre (`pen` = 1), le sol s'efface vers le papier hors du masque ; de nuit (`pen` = 0), le masque ne joue pas et le sol s'efface vers le noir aux bords.
- **Pourquoi** : aucun tampon de plus, l'information voyage dans la sortie déjà rendue pour les normales. Trait de périmètre de largeur constante à l'écran grâce à la dérivée du champ ; rouge qui arrive par taches grâce au seuil sur bruit.
- **Sources** : [`mrt()` (TSL)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) ; champs de distance 2D + `fwidth`.
- **Limites** : encodage fragile : la part dessinée doit rester dans 0..1 et le signe porte les volumes. Chaque place coûte une lecture de texture par pixel du sol. Un matériau sans `mrtNode` écrit alpha = 1 (« dessiné »).

## Chaîne de post-traitement

### EffectComposer — [`src/graphics/postprocessing/EffectComposer.ts`](../src/graphics/postprocessing/EffectComposer.ts)
- **Comment** : chaîne de `Main.universe.ts` : `RenderPass`, `EffectPass([InkEffect])`, trois `OverlayPass`, `normalDepth: true` (cible d'entrée à 2 textures `output`/`normal` + `DepthTexture`, HalfFloat, sans MSAA). `prepare` élit la dernière passe active non-overlay pour `renderToScreen` et dimensionne l'entrée à `sceneScale` × canvas (0,6 à 1 par pas de 0,1, `DynamicQualityHelper`), sortie et tampon de rechange à pleine taille. `compile` précompile les passes actives en parallèle ; `paused` saute l'image (rendu à la demande, 15 ou 30 i/s au repos).
- **Pourquoi** : pmndrs/postprocessing est WebGL ; sa conception (render, échange, dernière passe à l'écran) est reprise en TSL pour `WebGPURenderer`. Seule la scène, le plus cher, baisse de résolution : l'encre reste nette.
- **Sources** : [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing).
- **Limites** : dépend du `_core` (`PipelineBase`, `IPass`, `PassContext`, `FrameTiming`). De nuit, l'`EffectPass` est coupée et la `RenderPass` rend directement à l'écran, sans MRT.

### Passes — [`Pass.base.ts`](../src/graphics/postprocessing/passes/Pass.base.ts), [`RenderPass.ts`](../src/graphics/postprocessing/passes/RenderPass.ts), [`EffectPass.ts`](../src/graphics/postprocessing/passes/EffectPass.ts)
- **Comment** : `PassBase` dessine un triangle plein écran (`QuadMesh`) et, à l'écran, force `outputColorSpace` = working le temps du rendu. `RenderPass` active `mrt({ output, normal: vec4(directionToColor(normalView), 1) })` si la cible a deux textures, et compile avec la même cible et le même MRT que le rendu. `EffectPass` réduit les `IEffect.color` en un seul graphe ; textures et uniforms caméra sont réassignés à chaque image, le fragment n'est reconstruit que si `renderToScreen` change (ajout de `renderOutput` sRGB).
- **Pourquoi** : sans forcer l'espace de sortie, three ajoute une passe de conversion. Un pipeline compilé pour une autre cible ne resservirait pas : gel au premier rendu. Tous les réglages sont des uniforms : rien ne recompile en jouant du panneau.
- **Sources** : triangle plein écran (optimisation classique, évite la diagonale d'un quad) ; [renderOutput, mrt (TSL)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language).
- **Limites** : le contrat sRGB (seule la dernière passe encode) n'est pas vérifié par le typage. Dans une `EffectPass`, un effet qui lit des voisins doit être en tête. Changer `renderToScreen` recompile l'encre, shader lourd.

## Encre

### Trait qui tremble, ancré à la carte — [`src/graphics/postprocessing/effects/Ink.effect.ts`](../src/graphics/postprocessing/effects/Ink.effect.ts), `inkAnchorAt` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : pour chaque pixel, point de la scène (depuis la profondeur) ou, pour le fond, point du sol y = 0 visé (`_ray`, borné à 10⁴ unités). `inkAnchorAt` le convertit en pseudo-pixels accrochés à la carte : écart au coin de la vue, recalé sur une origine calculée en double précision par `TerrainNode` (`inkOrigin`, multiple de `INK_PERIOD` = 16384). Bruit blanc filtré en cellules de 32 px (`WOBBLE_PX`) à ce point, décalage de l'uv de ±`wobble` px (1,5).
- **Pourquoi** : la caméra bouge presque toujours (parallaxe à la souris) ; un bruit fixé à l'écran ferait nager les arêtes. Le shader ne manipule que de petits écarts, sans perte de précision en float32.
- **Sources** : —
- **Limites** : seul le tremble est ancré (échelle proche de la brume, `inkScale.x`). Hachures, trame et papier restent posés à l'écran et glissent sur la carte quand elle bouge (effet « shower door »).

### Contours — [`Ink.effect.ts`](../src/graphics/postprocessing/effects/Ink.effect.ts)
- **Comment** : 4 voisins à `line` px (1) ; saut de profondeur relatif |Δz|/|z| et écart d'orientation 1 − n·n', chacun en smoothstep(seuil, 2 × seuil) (`depthEdge` 0,01, `normalEdge` 0,2), seuils × mix(3, 1, `detail`). Le saut de profondeur est ignoré si l'un des deux pixels a un alpha négatif (volumes, nuages) : ils n'ont que des contours d'arête. Contours × part dessinée.
- **Pourquoi** : discontinuités du G-buffer : robustes, sans géométrie de silhouette. Un `detail` bas efface les cassures faibles (tuiles, pentes douces) et garde les silhouettes franches.
- **Sources** : Saito et Takahashi, « Comprehensible Rendering of 3-D Shapes », SIGGRAPH 1990 ; Decaudin, « Cartoon-looking rendering of 3D-scenes », 1996.
- **Limites** : 4 voisins : épaisseur de 1 à 2 px, crénelage sur les diagonales. Le seuil relatif manque les petits sauts au loin. Une dizaine de lectures profondeur/normales par pixel.

### Tons en hachures ou en trame — `inkCoverage` dans [`src/graphics/postprocessing/effects/InkStyle.ts`](../src/graphics/postprocessing/effects/InkStyle.ts)
- **Comment** : ton = luminance^(1/2,2). Densité = (1 − smoothstep(`dark`, `light`, ton))^mix(2,6 ; 1 ; `detail`) × (1 − 0,45 × `depth` × lointain), le lointain étant smoothstep(`near`, `far`) sur la distance caméra. Hachures à 45° au pas `screen` × √2 (5 px) ajusté pour diviser `INK_PERIOD`, épaisseur 0,45 × densité, croisées au-delà de `cross` (0,55) ; ou trame de points de rayon 0,75 × √densité ; mélange par `hatching`. Bavures par bruit de 64 px (`bleed`), aplat sous `dark`.
- **Pourquoi** : rendu de gravure ou de photocopie, entièrement procédural et réglable par uniform, sans atlas de tons. Le ton perçu évite que toutes les ombres tombent en aplat ; l'exposant creuse les gris moyens sans toucher aux noirs.
- **Sources** : hachure tonale et trame AM ; Praun, Hoppe, Webb, Finkelstein, « Real-Time Hatching », SIGGRAPH 2001 (alternative par textures de tons, non retenue).
- **Limites** : motifs à l'écran (voir ci-dessus). Pas d'orientation des hachures selon la pente : tout est à 45°.

### Papier, journal et encre posée — `paperAt`, `newsprintAt`, `inkOnPaper` dans [`InkStyle.ts`](../src/graphics/postprocessing/effects/InkStyle.ts)
- **Comment** : papier = `paper` × (fibres et taches d'une texture 1024² × `fibers`, − grain fin × `grain`). La texture est dessinée en `OffscreenCanvas` au `requestIdleCallback` (délai max 3 s) : 6000 fibres en courbes quadratiques (canal R), 90 taches radiales (canal B), redessinées sur les 9 voisins pour raccorder ; texture d'attente neutre de même répétition. Journal (`newspaper.webp`) à plat sur le sol sous la zone dessinée, `newsprintScale` répétitions par largeur de bloc, effacé entre 160 et 420 unités du point visé. `inkOnPaper` : encre inégale (`ink` à 1,6 × `ink` selon le grain), couverture réduite jusqu'à 25 % par le grain ; dans le lieu survolé, encre `hoverInk` et lavis `hoverWash`, plus le trait de périmètre (`hoverRim`). Sortie finale = mix(image, dessin, `amount`).
- **Pourquoi** : la génération différée n'allonge pas le premier rendu. Le journal en perspective ancre la feuille au sol ; l'effacer vers l'horizon évite qu'il file en traits.
- **Sources** : [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas), [requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback) (MDN).
- **Limites** : environ 100 ms de CPU pour papier et nuages à la première accalmie. Le papier est à l'écran, le journal au sol : ils glissent l'un sur l'autre en mouvement.

### Nuages dessinés — `createClouds` dans [`InkStyle.ts`](../src/graphics/postprocessing/effects/InkStyle.ts), posés par [`Clouds.node.ts`](../src/graphics/nodes/sky/Clouds.node.ts)
- **Comment** : bande 4096 × 512 couvrant 400 × 24 unités (`CLOUDS_WORLD`), 4 cumulus côte à côte (`CLOUDS_COUNT`). Chaque nuage : bosses circulaires en deux rangées, éclairage de Lambert (soleil en haut à gauche) et dessous assombri ; traits horizontaux ondulés tous les 0,32 unité, plus épais et continus dans l'ombre, rompus dans la lumière, sans contour. Les matériaux reçoivent la texture par `onCloudsDrawn`.
- **Pourquoi** : nuages à la Chartogne-Taillet, dessinés en unités de la bande pour que les bosses restent rondes sur le cylindre du ciel. Une file d'attente plutôt qu'une texture d'attente : un échantillonneur créé avec elle ne reprendrait pas la vraie.
- **Sources** : réflexion diffuse de Lambert.
- **Limites** : forme figée au démarrage (graine fixe). Absents tant que le navigateur n'a pas eu de temps libre.

### Trois bruits — [`src/graphics/materials/NoiseMap.ts`](../src/graphics/materials/NoiseMap.ts), `whiteNoise` dans [`InkStyle.ts`](../src/graphics/postprocessing/effects/InkStyle.ts), `mistNoise` dans [`Terrain.material.ts`](../src/graphics/materials/Terrain.material.ts)
- **Comment** : bruit blanc RGBA 256² (LCG, filtrage linéaire) pour le tremble, le grain et les bavures de l'encre ; value noise de brume pour le sol ; bruit peint `noise.webp` (512², gris, raccord continu) pour la transition de page et la feuille du panneau, recentré dans [−1, 1] par `noiseAt` (moyenne mesurée 0,38). Le bruit peint part d'un texel gris 1 × 1, la vraie texture est posée au montage de l'univers.
- **Pourquoi** : une lecture de texture au lieu d'un Perlin calculé plein écran. La texture posée avant la première image évite qu'un matériau compilé garde celle d'attente.
- **Sources** : bruit précalculé en texture.
- **Limites** : `MEAN` est mesuré sur l'image : changer `noise.webp` oblige à le remesurer. Répétition visible aux grandes échelles.

## Transition de page — [`src/graphics/postprocessing/effects/PageTransition.ts`](../src/graphics/postprocessing/effects/PageTransition.ts)
- **Comment** : `pageOver(map, paper, pixel)`, appelé par l'encre sous une branche `If(progress < 1)` : la page d'entrée = feuille portant quelques hachures (ton `IDLE_TONE` 0,72), masse d'encre à gauche (la carte vue par un dégradé radial, opacité 0,66) et lavis de papier sur la colonne de texte, dégradés repris de la maquette `01-entree.html`. `mapUncovered` la retire : ordre de bascule = rayon × `radius` + bras de spirale (`arms`, `twist`, `rotation`) × `armDelay` + fibres et taches du bruit peint ; front entre des bornes valables pour tout réglage, lissé sur fwidth(ordre) plafonné à 0,002. Mêmes uniforms pour l'intro, dont les noms sont effacés par le même masque ([`Intro.node.ts`](../src/graphics/nodes/intro/Intro.node.ts)).
- **Pourquoi** : coups de pinceau qui tournent depuis le centre (référence : summer-afternoon), bord franc. Masque de composition à l'écran, jamais le masque de la carte, qui ne s'anime pas. Une fois la carte découverte, la branche uniforme ne coûte plus rien.
- **Sources** : transition par seuil sur une carte d'ordre (gradient wipe) ; [radial-gradient](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/gradient/radial-gradient) (MDN) pour les dégradés reproduits.
- **Limites** : évalué sur tout l'écran pendant la transition. Les bornes sont prudentes : au début et à la fin, une part de la durée ne fait basculer aucun pixel.

## Interface par-dessus l'encre — [`src/graphics/postprocessing/passes/OverlayPass.ts`](../src/graphics/postprocessing/passes/OverlayPass.ts), [`Label.material.ts`](../src/graphics/materials/Label.material.ts)
- **Comment** : noms, panneau et intro rendus sur le canvas après l'encre, `autoClear` coupé, MRT coupé, `outputColorSpace` = working, puis état restauré. `overlay` les exclut de l'élection `renderToScreen`, `needsSwap` faux. Les couleurs des étiquettes sont données en `LinearSRGBColorSpace` : octets sRGB écrits tels quels.
- **Pourquoi** : rendu avec le terrain, un texte serait hachuré comme un relief. Sans couper le MRT, le pipeline attendrait deux sorties et rien ne s'afficherait ; sans l'espace working, la recopie sRGB de three effacerait l'image de l'encre.
- **Sources** : [Renderer](https://threejs.org/docs/pages/Renderer.html) (`autoClear`, `setMRT`, `outputColorSpace`).
- **Limites** : chaque matériau d'overlay doit fournir lui-même des octets sRGB. Pas de profondeur partagée avec la scène.

## Assets texture — [`src/graphics/assets/assets.manifest.ts`](../src/graphics/assets/assets.manifest.ts)
- **Comment** : deux entrées du groupe `universe:main`, préchargé avant le montage : `noise.paint` (`Diffuse/noise.webp`, Repeat, `NoColorSpace`) et `paper.newsprint` (`Paper/newspaper.webp`, Repeat, `SRGBColorSpace`, anisotropie 8). Posées dans `noiseMap` et `newsprintMap` au montage de `MainUniverse`. Le journal sert aussi de fond CSS à [`app/pages/index.vue`](../app/pages/index.vue). Papier, nuages, bruit blanc et bruit de brume sont générés en code.
- **Pourquoi** : manifest explicite plutôt que glob ; espace de couleur fixé à la source (le bruit est une donnée, le journal une image).
- **Sources** : [Texture](https://threejs.org/docs/pages/Texture.html) (`colorSpace`, `anisotropy`).
- **Limites** : les webp sont produits au prebuild depuis `assets-source/`. `public/assets/Images/PostFX/*` et le second journal de `Diffuse/` ne sont référencés par aucun code.

## Réglages

| Réglage | Où | Effet |
|---|---|---|
| `ink.*` : `amount` (1 : encre, 0 : nuit), `detail`, `light` / `dark` (0,8 / 0,08), `screen` (5 px), `hatching`, `cross`, `depth`, `line`, `depthEdge`, `normalEdge`, `wobble`, `grain`, `bleed`, `fibers` (0,65), `newsprint` (0,5), `newsprintScale` (3,8), `near` / `far` (29 / 215), couleurs `paper`, `ink`, `hoverInk`, `hoverWash`, `hoverRim`, `cloudLines` | [`src/graphics/config/debug.values.json`](../src/graphics/config/debug.values.json), liés dans [`Main.universe.ts`](../src/graphics/universes/impl/Main.universe.ts) (onglet encre) | écrasent les défauts de `inkSettings` et d'`InkEffect` : c'est le rendu effectif |
| `lights.*` (azimut 117, élévation 22, intensité 4, ambiance 0,2, rebond 0,35) | idem | soleil et ciel |
| `shading.*` : `fineSteps` (78), `stepTexels` (0,5), `coarseSteps` (8), `contact` (0,14), `lodBias` (0), `shadowSoftness` | idem | coût et qualité de la marche du bâti |
| `water.*` (`seaTone`, `waterInk`, `waterWidth`, `waterLines`, `waterReach`, `waterWave`, `waterSurf`), `terrain.occlusion`, `terrain.mist`, `terrain.landcover`, `buildings.technique` (`none` / `extrusion`) | idem | sol, eau, plan, bâti |
| `render.auto` (panneau seulement : `resolution`, rapport de pixels) | idem, [`DynamicQuality.helper.ts`](../src/graphics/device/DynamicQuality.helper.ts) | `sceneScale` adaptatif (0,6 à 1) |
| `intro.passage.*` (`progres`, `bras`, `torsion`, `rotation`, `rayon`, `decalage`, `fibres`, `fibre`, `taches`, `echelle`) | timeline SONDE (théâtre `intro`), branchée dans `Main.universe.ts` | forme et progression de la transition de page |
| Constantes (`HATCHES_PER_CELL`, `HOVER_BAND`, `MAX_*_STEPS`, `INK_PERIOD`, tailles des textures générées, `PAGE`) | dans `Terrain.material.ts`, `InkStyle.ts`, `PageTransition.ts` | non exposées au panneau |
