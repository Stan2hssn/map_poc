# Findings

## Retours utilisateur (2026-09-19, soir)
- Reference de composition : vue Paris, ile de la Cite ; bati propre (contours, ombres hachurees), eau hachuree,
  beaucoup de papier autour, masque centre, fondu vers les bords de l'ecran.
- Image actuelle : trop dense et sombre ; un carre de tuile sans volumes (empreintes a plat), un carre blanc (texture
  manquante) ; sans la passe dessin, zone sans batiments et carres gris.
- Veut : masque comme CT ; moins d'arbres (parcs seulement), moins de voitures ; voitures qui ne disparaissent pas,
  ponts ; texture journal seamless en fond avec echelle au panneau ; nuages plutot que journal en haut ; bateaux,
  avions ; particules = petites ellipses vides ; transitions d'echelle douces ; "decalage en haut" jamais corrige.
- Debug : chaque changement s'enregistre (ecrit debug.values.json) -> tests penibles ; veut enregistrer au bouton.

## Chartogne-Taillet (captures dans scratchpad/ct)
- Masque : `paintingMask.jpg` (512x256), rectangle blanc flou aux bords irreguliers sur noir, lu en espace ecran :
  `texture2D(uMask, gl_FragCoord.xy / uResolution).r - 0.3` comme attenuation (materiau du terrain peint).
- Vignette de la passe finale : `distance(vUv, 0.5) * strength + offset`, sinus ; en prod strength = 0 (eteinte).
- Papier de la passe finale en espace ecran : `vUv * resolution / uPaperSize`.
- Nuages : 5 bandes courbes (rayon 15, hauteur 8, largeur 2 rad) a y = 2 autour de la scene, alphaMap `clouds.jpg`
  (2048x512, nuages dessines en hachures horizontales), rotation tres lente (2e-5), dessinees comme traits (canal G).
- Particules : un `drawArrays POINTS` de 20000 (P9) ; particules du terrain masquees par `paintingMask`.

## Code
- Debug : `DebugValueStore.write` planifie l'ecriture 400 ms apres (`_schedule`) ; "Save Settings" = `flush`.
- Texture journal : `assets-source/Images/Diffuse/newspaper-...-284245367.webp`, 800x800 RGB (assets-source non commite).
- Poussiere du releve (`Survey.node.ts`, `_createDust`) : sprites additifs -> dans le MRT ils ecrivent des normales,
  l'encre en trace les carres (gros carres qui volent).
- PLAN IGN : `routier_route_sup` (routes sur ouvrage = ponts) non dessinee ; `niveau` n0 ; vegetation `symbo`
  ZONE_BOISEE / ZONE_FORET_* ; routes `sens_circu`.

## Retours utilisateur (2026-09-19, nuit) — 3 images : avant (Paris dense, traits gras), nuages CT, apres
- Particules nulles : veut celles de CT, mais en contour comme le shader.
- Pas d'avion 3D qui traverse la France, pas de pont 3D, pas de noms de routes, pas de bateaux visibles.
- Enorme lag en arrivant sur Paris ; le site lag plus qu'avant.
- On voit la fin de la 3D (far de la camera ?).
- Nuages tres mauvais : ref = image CT (hachures horizontales fines formant des cumulus, gris tres clair).
- Diminuer le masque quand l'echelle est trop petite, sinon on ne voit rien.
- Qualite globale en recul : avant = traits gras, bati tres encre, ombres hachurees ; apres = traits fins, pale, brume.

## Particules CT (app.257ecce9.js, setParticles)
- 20000 points dans un cube de +-2 unites autour de la camera (`points.position = camera.position`) ; dans le
  shader `(position + vent - cameraPosition) mod 4 - 2` : poussiere fixe dans l'air, le cube suit la camera.
- Vent : 5e-5 u/ms le long de (sin 1, cos 1) ; turbulence verticale 0,02 a 0,001 rad/ms.
- Taille : `min(0 + 2,5 * vitesse camera, 10) * pixelRatio` : INVISIBLES au repos, apparaissent quand la camera
  bouge ; attenuees par la distance (0 a 2 u) et a moins de 0,3 u ; taille aleatoire par point.
- Dessinees au canal G (trait d'encre), carres pleins. CT a aussi des oiseaux (BirdBufferGeometry).

## Recul de qualite : causes mesurees (Paris 2,5-3 km, meme vue)
- Lumiere enregistree (intensite 1, ambiance 0,7, rebond 0, 33 deg) : murs et sol du meme gris, plus d'ombres portees
  hachurees. Remis 4 / 0,2 / 0,35 / 22 (accord utilisateur) -> murs sombres, ombres hachurees reviennent.
- Papier enregistre fibres 2 / bavure 1 : grosses taches grises = "brume" partout. Remis 0,6 / 0,25 (accord).
- Le journal (0,26) ne pese presque rien (texture moyenne 0,8 lineaire, p5 0,66).
- HEAD en volumes aux memes reglages : aplats sombres ; HEAD en parallaxe : traits rugueux proches de l'image 1
  mais GPU 47 ms. Le rendu actuel des volumes lit deja les normales rugueuses de la texture de hauteurs.

## Nuit : cadre, nuages, particules, avions
- Camera a 70 deg (tiltNear utilisateur) : bord lointain de la zone dessinee a 16 % du haut de l'ecran, horizon
  au-dessus de l'ecran. Les anciens nuages (cylindre r 153, bande 2-26) tombaient sur le bord haut : 3 bandes.
- Nuages : rideau face a la vue a 1,25 x profondeur de la zone (glisse quand la vue tourne), bande -2..22,
  texture 4096x512 dessinee en unites de scene (400 x 24). Leur force enregistree par l'utilisateur : 0,2.
- Avions : a 30 unites de haut (hauteur de la camera 35) et a 120 du centre, ils etaient hors de l'ecran.
- Bateaux : 3 a Paris 3 km, 32 m de long (~1 unite) : invisibles.
- Ref typo (refs/type.webp) : capitales espacees fines, "PRINT ATELIER", encre qui bave.
- `__map` (global de dev) expose deja terrainSettings et inkSettings.

## Retours utilisateur (2026-09-20)
- Mieux, mais veut MOINS de traits, plus simple, "on respire plus".
- Nuages : un cylindre avec un motif equidistant = "cheap" ; les veut places comme chez Chartogne-Taillet.
- Noms de rues : abandonnes, garder les noms d'eau.
- Particules : visibles aussi au repos ; cube autour de la camera, glissent a l'inverse du deplacement, bouclent,
  plus petites au loin.
- Encore des endroits sans bati ni vegetation.
- Moins d'avions ; le masque doit aussi effacer avions et bateaux.
- Maillage : adapter les subdivisions a l'echelle et au relief (LOD, retopologie, fusion de maillages).
- Panneau : retirer l'inutile, ajouter densite des avions etc., ranger en onglets.

## Audit WebGPU Inspector (capture 2026-09-28, `Frame_Stats.html`)

Budget 8,20 ms (ecran 120 Hz). **GPU 15,79 ms (193 %)**, CPU 2,60 ms (32 %) -> **GPU bound**, ~63 fps.

| Mesure | Valeur | Lecture |
|---|---|---|
| Passes de rendu | 49 (50 attaches couleur, 5 profondeur) | la chaine n'en demande que 6 (ombre, scene, encre, 3 calques) |
| Appels d'API | 1 547 | dont 148 dessins, 296 bind groups, 367 vertex buffers, 586 uniformes, 1 315 textures, 1 056 samplers |
| Ecritures | 260 `writeBuffer` (15,9 Ko), 4 `writeTexture` | 4 textures montees dans CETTE image = arrivee d'une image de plan |
| Geometrie | 335 242 instances, 1,22 M sommets, 402 682 triangles, 7 920 lignes | |
| Timings par passe | 1,704 ms sur 11 passes, valeurs repetees (0,197 / 0,131 / 0,066) | quantifiees par le navigateur : **inexploitables**, seul le 15,79 ms compte |

### Les 43 passes en trop
4 `writeTexture` dans l'image + `generateMipmaps = true` (`Landcover.helper` l. 175, 198) : chaque niveau de
mipmap est une passe de rendu. 4 textures de 1024 -> ~40 passes. C'est une image d'arrivee de plan, donc un
a-coup, pas le regime permanent — mais il se reproduit a chaque zoom/deplacement.

### Suspects du 15,79 ms (a mesurer un par un, timestamps du projet)
1. Ombre : carte 4096x4096, `autoUpdate` des que le relief est marque -> une passe profondeur pleine a chaque image.
2. Passe d'encre : plein ecran a DPR 2, 8 lectures de profondeur/normales par pixel, hachures, papier, journal.
3. Sol : jusqu'a 1024 subdivisions (valeur enregistree), 1,22 M sommets dans la capture.
4. Vie : 335 k instances (bati, arbres, voitures, bateaux, avions, nuages, poussiere).
5. Depuis la feuille de chargement : ciel + releves rendus DES l'attente (pour compiler) -> ils coutent sous la page.
