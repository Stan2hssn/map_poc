# Progress

## Session 2026-09-19 (soir)
- Lu les retours et 3 captures (actuelle, sans dessin, reference).
- Etudie CT : masque ecran `paintingMask`, nuages en bandes, vignette eteinte.
- Plan cree (task_plan.md).
- Phase 1 faite : `DebugValueStore` n'ecrit plus seul ; seul "Save Settings" enregistre.
- Phase 2 codee : `screenMask` (rectangle arrondi ecran, fondu, bord bruite fixe a l'ecran), `drawnReach` (portee au sol) ;
  masque applique dans `InkEffect` ; batiments/arbres/voitures ne changent plus de hauteur avec le masque ; grille et
  tuiles cadrees par masque + portee. Nouveaux chemins de reglages `screenMask.*` (les anciens `mask.*` ignores).
- Phase 3 codee : papier (fibres, taches) a l'ecran ; journal = texture fournie (`public/assets/Images/Paper/newspaper.webp`,
  manifest `paper.newsprint`) a plat sur le sol, echelle au panneau ; nuages hachures generes, sur un cylindre (rayon 90).
- Typecheck OK.
- Verifie en image (Paris 3 km, 1600x940) : masque ecran centre et fondu ; bande du haut remplacee par des nuages.
- Bug trouve : textures d'attente 1x1 en bord fixe -> l'echantillonneur gardait ce mode : papier en trainees au-dela
  de 1024 px (probablement la "bande" et la "texture qui bouge" depuis longtemps), nuages en traits continus. Corrige
  (attente avec le meme mode de repetition), papier redessine sans raccord.
- Banc : `__tick` force le rendu (le repos saute des images, la toile etait vide) ; `__crop` rend juste avant de lire.
- File de telechargement priorisee : 49/49 tuiles de bati presentes a la fin du vol (2,2 s) au lieu de 14 manquantes apres 7 s.
- Camera immobile : ne bougent que nuages, voitures, particules (diff de deux images a 2 s).
- Tremble du trait accroche a la carte (option `anchorAt` de `InkEffect`).
- Arbres parcs/bois seulement, voitures /2-3 avec fondu, ponts, peniches, avions, particules en ellipses vides.
- GPU 7,8 a 10 ms (3200x1880, Paris 2,5 km, machine partagee). 69 tests, typecheck OK.
- Retour utilisateur : masque ecran = "masque sur la camera", refuse. Refait au sol, centre sur la cible (origine),
  axes de la vue sans parallaxe/roulis ; verifie au repos et souris au coin.

## Session 2026-09-19 (nuit)
- Retours : particules, avions/ponts/noms/bateaux absents, lag a Paris, fin de la 3D, nuages, masque en vue large,
  recul de qualite (image 1 avant / image 3 apres).
- Question posee : masque -> "vue large : zone plus grande".
- Banc recopie (scratchpad de cette session) ; HEAD monte en worktree (scratchpad/before, port 7831, config
  `map-before` temporaire dans .claude/launch.json, a retirer).
- Mesures Paris 3 km (3200x1880) : GPU 10 ms (HEAD 8,5) ; sans encre -1, sans murs -1, sans toits -0,5, arbres et
  voitures ~0 ; le sol fait ~7 ms. Vol vers Paris : une image de 228 ms (5 pipelines compilees), 1,4 s quand 3
  onglets WebGPU se partageaient le GPU.
- 3 onglets WebGPU ouverts : le 3e ne demarrait plus (GPU sature) ; en garder un seul.
- Echauffement des 5 materiaux du bati au demarrage : 0 pipeline compilee a l'arrivee (avant 5, 228 ms a 1,4 s).
- Ombres du relief : intensite 0 et plus de passe sous 40-120 m de relief (Paris 3 km : 34 m) ; grille d'ombre 192.
- Masque x1 a 4 km, x3 a 600 km (log) ; 40 km : x1,8, la vue de depart est entiere.
- Plan (eau, routes, bois) imprime apres l'eclairage (relief ramene sous 1) : visible quel que soit le soleil.
- Seuils d'encre de l'utilisateur (clair 0,53, sombre 0,17) : les gris moyens du plan ne s'encrent pas a 30 km.
- Nuages refaits (rideau face a la vue, cumulus hachures), poussiere facon CT (cube autour de la camera, visible
  en mouvement, cercles vides), avions au-dessus du relief avec ombre portee, bateaux x1,75 et 3/km, ponts en
  tabliers, noms des voies dans la texture (bandeau de papier + lettres a l'encre).
- Verifie : 69 tests, typecheck, vol vers Paris sans compilation (0 pipeline), image la plus longue 91 ms
  (mise a niveau du relief au depart du vol). GPU tres bruite sur la machine (8,7 a 17 ms au meme endroit).
- Nettoye : worktree HEAD supprime, .claude/launch.json remis.

## Session 2026-09-20
- Nuages : nouveau noeud (tableaux dessines poses devant la camera, sous l'horizon) ; l'ancienne bande sur cylindre
  et son code dans la passe d'encre sont retires. Piege retrouve : la texture des nuages arrive apres la
  compilation du materiau -> abonnement `onCloudsDrawn` (une texture d'attente ne se remplace pas dans un sampler).
- Poussiere visible au repos, densite et taille reglables ; avions moins nombreux et effaces par le masque.
- Buissons la ou il n'y a rien ; arbres 0,7 et voitures 0,8 par defaut ; simplification des petits batiments au loin.
- Subdivisions du sol : 256 sur Paris (plafond 512 de l'utilisateur), remontent avec le relief.
- Panneau range en 3 onglets ; reglages morts retires, densites ajoutees.
- Verifie : 69 tests, typecheck, vol vers Paris 0 pipeline compilee, image la plus longue 59 ms.
- Avions effaces entre 25 et 70 km de vue (leur taille est en unites de scene).
- Bords : zone dessinee bornee au sol, fondu au bord du monde, vue la plus large a 12 000 km avec centre resserre
  (la couverture du relief s'arrete a -56 / 60 degres) ; verifie a la vue monde, plus aucune coupure.
- Buissons : grille d'occupation (bati, eau, bois, routes a 9 m), 38 m d'ecart, 20 ms par tuile.
- Eau qui ondule et derive, houppiers qui se balancent ; l'image reste vivante tant que vagues ou vent > 0.
- 69 tests, typecheck.

## Session 2026-09-20 (soir)
- Eau : l'animation temporelle est retiree (refusee). Les traits suivent maintenant la rive — ce sont les lignes de
  niveau d'un champ de distance obtenu par une pile de mips du canal eau — et s'espacent vers le large. Le champ est
  lu en pixels (divise par sa propre pente) pour que l'ecart du trait ne depende pas de l'echelle. La mer s'eclaircit
  avec le large : l'aplat gris uniforme se faisait hachurer en entier par la passe d'encre et pesait plus que la terre.
- Niveau de detail du crayon : `inkSettings.detail`, defaut 0,7 (onglet Encre). Creuse les gris moyens, monte les
  seuils de contour, allege les hachures de vegetation. Les noirs ne bougent pas.
- 69 tests, typecheck. Captures : 95-mer (cote), 97-paris-defaut (detail 0,7).
- Reste du lot (globe, intro, UI 3D) : non commence, voir task_plan phases 14 a 16.

## Session 2026-09-20 (soir, suite) : retour sur le trait
- Deux causes au "ce n'est pas mon rendu" :
  1. Mes captures etaient reduites de 2048 a 1200 px avant envoi : le trait fin se melangeait en gris. Je capture
     desormais a la taille du canvas, ou en recadrage 1:1.
  2. J'avais reellement alourdi l'eau (encre 0,3 -> 0,75) et eclairci la mer partout, et mis `detail` a 0,7 par
     defaut, ce qui creusait les gris moyens de toute l'image.
- Remis aux valeurs de l'image de reference : encre de l'eau 0,3, aplat 0,55, mer 0x5c5c5c, `detail` a 1.
- Garde par-dessus, sans toucher au reference : les traits qui suivent la rive pres du bord, l'ondulation fixe du
  trait, et l'eclaircissement de la mer au grand large seulement (`SEA_OPEN`, a partir de 0,72 de large).
- 69 tests, typecheck. Captures 1:1 : 102-cote, 103-seine.

## Session 2026-09-20 (soir, correction)
- Eau : tout mon travail du jour est retire. Le code des traits d'eau est de nouveau identique a HEAD
  (`penLines(geo.y)`, aplat 0,55, encre 0,3, mer 0x5c5c5c). Les rectangles dans la mer venaient de moi : le ton du
  large se lisait dans le canal eau du PLAN IGN, qui s'arrete aux frontieres -> dalles claires/sombres.
- REGRESSION corrigee : `kept()` (simplification au loin, ajoutee cette session) avait REMPLACE le masque dans la
  position des batiments. Le masque ne baissait donc plus leur elevation. `kept` combine desormais les deux, et le
  masque ne s'applique qu'au dessin (`pen`), pour que la carte de nuit garde ses volumes.
- OUTILLAGE : `tsc --noEmit` ne verifiait RIEN (le tsconfig racine a `"files": []` + project references). Il a
  valide deux fois du code non parsable. La bonne commande est `tsc -b --noEmit` (verifie : sort 2 sur une erreur).
- 69 tests, `tsc -b` OK, module servi en 200.

## Session 2026-09-20 (nuit) : deploiement contre volumes
- Le deploiement Vercel = commit `de6dd38` : rien de ce qui a ete fait depuis n'est commite. Compare avec un
  arbre de travail HEAD monte sur le port 7831, meme harnais, meme vue, meme taille de canvas.
- Mesure (part de pixels encres, Paris 3 km) : HEAD/parallaxe 29,4 % ; actuel/volumes 18,2 % ; actuel/parallaxe
  19,0 %. La technique pese 0,8 point. Avec les reglages de la reference remis sur le code actuel : volumes
  31,0 %, parallaxe 33,0 %. Le rendu de reference revient donc en volumes.
- GPU a cette vue (3 tours entrelaces, mediane) : volumes 6,1 ms contre parallaxe 16,2 ms.
- Ecarts de reglages responsables (sauvegardes dans `debug.values.json`, contre les defauts du code, qui sont
  ceux de la reference) : masque 57 x 103 au lieu de 95 x 95 et bord 0,6 au lieu de 0,12 (le dessin n'occupe plus
  qu'un ilot au milieu de la page), ton papier 0,53 au lieu de 0,8 et ton encre 0,17 au lieu de 0,08 (les gris
  moyens passent au papier), tremble 0 et grain 0 au lieu de 1,5 et 0,5 (trait mecanique), contour arete 0,37 au
  lieu de 0,2 (les batiments perdent leur cerne), relief x2 au lieu de x1.
- Captures : `REF-head-full` (deploiement), `NOW-ext-full` (actuel), `MATCH-ext-full` (actuel + reglages de la
  reference), `CMP-par-vs-ext-zoom` (meme dessin dans les deux techniques).
- Reglages remis a ceux de la reference dans `debug.values.json` (ancien fichier garde dans le bloc-notes de
  session : `debug.values.avant-reference.json`). Resultat mesure : 30,9 % d'encre contre 29,4 % a la reference.
- Parallaxe retiree du code sur demande : `parallaxHit`, `buildingsOn`, uniformes `parallax` et `inkDirect`,
  encre directe dans le shader du sol, choix "parallaxe" du panneau, `inkSettings.onePass`. La marche dans la
  texture de hauteurs reste (elle sert aux volumes) ; le groupe de reglages `parallax.*` devient `shading.*`.
- Apres retrait : 69 tests, `tsc -b` propre, GPU 5,5 ms median a Paris 3 km (210 appels de dessin, 48 tuiles).

## Session 2026-09-20 (nuit, suite) : eau dessinee, trait de cote
- L'eau est redessinee comme sur une carte : papier (`seaTone`) et traits paralleles a l'encre la plus sombre.
  Un trait a demi teinte etait hachure a 45 degres par la passe d'encre au lieu de rester un trait.
- Espacement selon la distance au rivage : deux anneaux echantillonnent la terre autour du point ; a chaque
  palier un trait sur deux disparait et les autres ne bougent pas. Reglages : onglet Dessin > Eau.
- Tremble anime : bruit accroche a la carte + houle en sinus, avances par `terrainSettings.clock`. Mesure :
  27 327 pixels sur 630 000 changent en une seconde d'horloge, et l'image se redessine a la cadence de veille
  tant que la vitesse n'est pas nulle.
- TRAIT DE COTE : l'escalier ne venait pas du maillage. A vue identique, 256 et 1024 subdivisions donnent le
  meme escalier (`W1-seg256` / `W1-seg512`). Cause : `smoothstep(0, 1, altitude)` sur un relief interpole, ou la
  bande 0-1 m tient dans un centieme de texel ; le bord suivait donc les cotes des texels. Remplace par une
  moyenne de la terre sur un anneau (`shoreAt`) : bord de largeur constante, et plus d'ilots d'un seul texel.
- MAILLAGE EN MONTAGNE (Alpes, 30 km) : la, la grille compte vraiment. 256 -> 512 change 9 % des pixels, mais
  coute 23,7 -> 48,9 ms. C'est le cas ou une grille adaptative (dense sur les cretes, lache sur les aplats)
  vaudrait le coup ; a faire, pas commence.
- Cout de l'eau : le motif n'est calcule que sur l'eau et les anneaux larges seulement pres d'elle. Paris 3 km :
  5,5 ms avant, 9,7 ms sans ces deux gardes, 6,2 ms avec. Bord de mer (Marseille 20 km) : 2,8 ms.
- 69 tests, `tsc -b` propre.

## Session 2026-09-20 (nuit, correction de l'eau)
- Demande simplifiee : des droites a 45 degres, ecart constant, qui s'effacent petit a petit vers le milieu de
  l'eau. Les paliers (un trait sur deux), la houle en sinus et le bruit anime sont retires ; `waterWobble` et
  `waterSpeed` disparaissent du panneau et de `terrainSettings`, et l'eau ne rend plus l'image "vivante".
- Restent : trait, serrage, epaisseur, effacement vers le centre (deux anneaux de distance a la terre), ton de la mer.
- 69 tests, `tsc -b` propre.

## Session 2026-09-20 (nuit) : relief, eau ondulee, subdivisions selon le relief
- Relief : l'exageration etait tombee a 1 en remettant les valeurs de reference ; remise a 2,5 (le defaut du
  code). Marseille se reconnait a ses collines et ses calanques, les Alpes ont leurs vallees.
- Eau : les lignes a 45 degres restent, mais ondulent (bruit accroche a la carte, `waterWave`), s'espacent par
  paliers en s'enfoncant (un trait sur deux disparait, les autres ne bougent pas) et tremblent pres de la rive
  (`waterSurf` : trait plus gras ou plus maigre, comme un crayon). Aucune animation dans le temps.
- Subdivisions selon le relief : mesure du creux moyen sur une grille de 16 x 16 altitudes (difference seconde,
  unites de scene), calibree sur des vues reelles — Paris 3 km 0,16 ; Aix 20 km 0,90 ; Marseille 20 km 0,85 ;
  Alpes 30 km 6,67. Seuils : 0,3 (plat) et 2,5 (accidente), paliers 256/512/1024, plancher 1024 des qu'une cote
  traverse la vue. La mesure n'est refaite que si la vue ou le relief a change.
- Resultat : Paris 256 (5,2 ms), Aix 512 (10,2 ms), Marseille 1024 (9,8 ms), Alpes 1024 (9,6 ms).
- Reste du lot : globe (vue monde), animation d'intro, UI dessinee dans le rendu 3D avec survol en rouge.
- 69 tests, `tsc -b` propre.

## Session 2026-09-20 (nuit) : animation d'intro
- La page nait blanche : `_intro.reveal` part a 0 dans l'univers, pas a l'appel de la page — sinon la carte
  paraissait le temps d'une image avant que `holdIntro` n'arrive.
- A 0, la zone dessinee est vide (`terrainSettings.drawnReveal` divise le rayon du masque), le journal et les
  nuages de la feuille s'effacent (`inkSettings.reveal`), et nuages, avions et releves sont caches.
- `click to draw the map` : annotation en position fixe, posee au curseur par un suivi amorti (120 ms), au
  milieu de la page tant que la souris n'a pas bouge.
- Au clic : `drawMap(MAP_VIEWS.france)` ouvre la zone en 3 s (lissage en S) et lance le vol ; l'interface
  (etiquettes, releves, raccourcis) apparait ensuite en fondu (CSS, `data-map-intro`).
- Toute navigation (`flyTo`) ouvre aussi l'intro : le harnais de capture n'est pas bloque sur une page blanche.
- Verifie a l'ecran : page blanche + annotation, puis carte de France dessinee avec ses etiquettes.
- 69 tests, `tsc -b` propre.

## Session 2026-09-20 (nuit) : retours intro, debut de l'UI 3D
- Avant le clic : la page garde son journal et ses nuages de feuille, plus quelques hachures tirees du ton du
  papier (`IDLE_TONE`). Majuscule a "Click". Poussiere 0,5 -> 0,2. Le texte parait a l'entree de la souris.
- UI 3D (MSDF) : construit un atlas de champs de distance signes depuis la police de la page — transformee de
  distance exacte de Felzenszwalb (`text/DistanceField.ts`, 3 tests), atlas et metriques (`text/SdfFont.ts`),
  materiau de glyphes instancies places a l'ecran autour d'un point ancre (`materials/Label.material.ts`),
  noeud avec survol et clic (`nodes/labels/Labels3D.node.ts`).
- PIEGE trouve : `context.font = "48px 600 Manrope"` n'est pas une police valide — le canvas retombait sur ses
  10 px par defaut et les avances etaient dix fois trop courtes. La graisse precede la taille.
- BLOQUE : les quadrilateres sont bien places (verifie en sortant la matiere en rouge : le trait d'une etiquette
  apparait au bon endroit) mais la passe d'encre les efface. La sentinelle (alpha -2 dans les normales) n'arrive
  pas jusqu'a l'effet : aucun pixel ne passe le test, meme en le sortant en magenta. A reprendre par une passe
  dediee apres l'encre, plutot qu'une sentinelle.
- Les etiquettes affichees restent donc celles du DOM ; le travail 3D est garde a cote, non branche.
- 72 tests, `tsc -b` propre.

## Session 2026-09-20 (nuit) : UI 3D, deuxieme tentative
- Passe dediee apres l'encre : essayee en passe de rendu (`OverlayPass`, ecartee) puis en effet qui pose une
  image (`OverlayEffect`) rendue a part par le noeud dans sa propre scene et sa propre cible.
- Deux erreurs WebGPU trouvees et corrigees en route :
  1. `mrt({ normal })` seul, hors passe a sorties multiples : le shader n'a plus aucune sortie
     ("structures must have at least one member"). Le materiau des etiquettes n'en a plus besoin.
  2. Rendu dans une cible simple pendant que le renderer a encore ses sorties multiples : le pipeline attend
     deux cibles pour un shader qui n'en ecrit qu'une. `setMRT(null)` autour du rendu.
- Malgre cela la cible des etiquettes reste vide (alpha 0 partout), avec trois variantes de materiau :
  `vertexNode` en espace de clip, `NodeMaterial` nu avec `fragmentNode`, et panneau face camera par
  `positionNode`. Les 75 quadrilateres sont bien construits (attributs verifies) mais rien ne s'ecrit.
- Les etiquettes DOM sont donc remises en place ; le chemin 3D est garde a cote, non branche.
- A reprendre : verifier le rendu de la scene des etiquettes avec un materiau trivial (un carre plein, sans
  attributs d'instance) pour separer le materiau de la geometrie instanciee, puis remonter.
- 72 tests, `tsc -b` propre.

## Session 2026-09-20 : UI 3D branchee (resolu)
- Cause de l'invisibilite des etiquettes : `MeshBasicNodeMaterial` est en `side: FrontSide` par defaut, et le
  panneau face camera inverse le sens des triangles (y de l'ecran vers le bas, y de la scene vers le haut).
  Tous les quadrilateres etaient dos a la camera. Une ligne : `side: DoubleSide`.
- Methode qui a paye : sonder dans la page avec la **vraie** instance de three (celle de Vite, sinon les deux
  copies ne partagent pas leurs caches et le shader sort vide), puis monter l'expression terme par terme.
  P0 quad fixe 784 px, P1 anchor 784, P2 screen 504, P3 unit 400, P4 complet 0 -> la negation de y.
- Deuxieme piege, apres coup : rendre une seconde fois sur le canvas effacait la carte. Ce n'est pas un
  effacement (la couleur de fond rouge ne sortait pas) mais la recopie interne que three fait depuis
  `_frameBufferTarget` quand `outputColorSpace` differe de l'espace de travail. Corrige comme le fait deja
  `PassBase.renderFullscreen`, et les couleurs du materiau sont prises sans conversion.
- Architecture retenue : `OverlayPass` (passe posee apres l'encre, rend a l'ecran sans l'effacer). Zero tampon
  de plus, contre une cible plein ecran pour la variante `OverlayEffect`. `PassBase.overlay` empeche la passe
  de prendre le `renderToScreen` de la chaine.
- Le noeud n'appelle plus `renderer.render` (regle d'architecture) : il expose `scene`, la passe rend.
- Verifie a l'ecran : noms en 3D avec trait et point, "01 Paris" **rouge au survol**, curseur en main, le clic
  vole vers la ville. Apparition liee a l'intro (`labelSettings.reveal`), rien avant le clic.
- 72 tests, `tsc -b` propre.
- Code mort a supprimer (en attente d'accord) : `nodes/labels/Labels.node.ts`, `effects/Overlay.effect.ts`,
  et la partie `.map-label*` de `app/assets/css/labels.css`.

## Session 2026-09-20 : le rouge du survol passe sur la ville, pas sur le texte
- Correction demandee : au survol d'un nom, c'est la ville au sol qui doit rougir. Le texte reste a l'encre
  (attribut `tint` retire du materiau des etiquettes).
- Chemin choisi, sans tampon supplementaire : le sol marque son bati dans l'alpha des normales au-dela de
  `BUILT_BAND` (2). Le signe reste lisible (volumes en negatif), l'encre retranche la marque avant de s'en
  servir. Les volumes extrudes la portent aussi (`Buildings.material.ts`).
- L'encre teinte son trait vers `inkSettings.hoverInk` : contour donne par le bati lui-meme, fondu donne par
  le cercle autour de `inkSettings.hover` (x, z de la scene, rayon) — aucun bord net ne coupe les rues.
- Rayon mesure sur la carte (12 km au sol) entre le point et un point a l'est : constant quel que soit le zoom.
- Piege de verification : le noeud remet `hover.z = -1` a chaque image, donc tout reglage pose a la console est
  efface aussitot. Et bouger la souris deplace la camera, donc l'etiquette fuit sous le curseur : il faut
  converger (boucle de `pointermove` sur le centre de la boite recalcule).
- Verifie a l'ecran sur Boulogne-Billancourt : les ilots batis passent au rouge dans un rayon de 12 km.
- LIMITE : en vue France / monde, le PLAN IGN ne sert aucun bati (il ne le garde qu'a partir du z14-15), donc
  rien ne rougit. Mesure : 0 pixel marque a ce zoom, 47 041 en vue Paris. A trancher avec l'utilisateur.
- 72 tests, `tsc -b` propre.

## Session 2026-09-20 : focus par niveau, survol par contour administratif
- Le bati etait le mauvais primitif (mesure : 0 pixel de bati en vue France, 47 041 en vue Paris). Remplace par
  le contour administratif, qui existe a toutes les echelles et couvre departements et regions.
- Sources : `france-geojson` pour les departements (96, 556 Ko) et les regions (13, 220 Ko), contours compris ;
  `geo.api.gouv.fr/communes/{code}?fields=contour` au survol pour une commune (servir tous les contours d'un
  departement le ferait passer de quelques dizaines de Ko a plusieurs Mo).
  A noter : `geo.api.gouv.fr` accepte `fields=centre,contour` sur `/departements` et `/regions` et **ignore**
  ces champs sans rien dire — d'ou le detour par une autre source.
- Masque : le contour est rasterise dans une texture 512 calee sur son cadre en degres (`AreaMask.helper.ts`),
  le sol l'echantillonne par `lonLat` et marque ses pixels au-dela de `HOVER_BAND` ; l'encre teinte le trait et
  pose un lavis (`hoverWash` 0,12) — sans lui un departement plat n'a presque pas de trait a colorer.
  La texture est posee dans le constructeur du noeud, avant la premiere image (piege de liaison connu).
- Onglets : `MAP_FOCUS` (communes / departements / regions), `IMapNavigator.setFocus`, `MapFocus.client.vue`
  en haut de page. Changer d'onglet vide les lieux et recharge la source du niveau.
- Piege trouve : le "Paris" retenu venait de Natural Earth (population d'agglomeration plus grande que la
  population municipale) et n'avait donc pas de code INSEE. `PlaceIndex.add` fusionne maintenant code et
  contour entre les deux sources, celle qui perd laisse ce qu'elle sait.
- Verifie a l'ecran : Nouvelle-Aquitaine, Gironde et Paris (75056) colories a leur forme exacte ; les trois
  onglets chargent et se relaient sans erreur console.
- Reglages ajoutes au panneau (Dessin > Survol) : encre du survol, lavis du survol.
- 72 tests, `tsc -b` propre.

## Session 2026-09-20 : perimetre, alignement, et chrome des maquettes
- Trois defauts du survol corriges :
  1. Contour a l'envers : `CanvasTexture` a `flipY` a vrai par defaut, donc la premiere ligne du canvas (le
     nord) etait lue en bas. `flipY = false`.
  2. Perimetre invisible : 3 texels d'un masque de 512 sur l'emprise d'un departement font 0,7 px a l'ecran en
     vue France. Le trait vient maintenant d'un champ de distance (`signedDistanceField`, deja ecrit pour le
     texte) dont la derivee donne la valeur d'un pixel : largeur constante a toutes les echelles. Eteint sur
     l'eau, ou le trait de cote dit deja la limite.
  3. Boite cliquable decalee du texte : le panneau se dimensionnait sur la distance euclidienne a la camera
     alors que la perspective divise par la profondeur de vue. Mesure apres correction : 100 px demandes,
     100 px obtenus sur quatre etiquettes (avant, l'ecart croissait avec l'angle au regard).
- Chrome des maquettes (`export 3`) integre : `MapChrome.client.vue` + `chrome.css`. En-tete Bodoni, fil
  d'Ariane France / Region / Departement / Ville pilotant le focus, recherche, rail des quatre regards,
  releves (echelle ronde calculee, coordonnees en degres-minutes, boussole), frise, attribution IGN.
  `MapFocus` et `MapShortcuts` retires : les maquettes ne les portent pas.
- Etiquettes : nom seul en capitales avec son filet, sans numero de classement (celui-ci vit dans le rail).
- Inertes faute de donnees : trois regards sur quatre, la recherche, la frise, la mention Methode.
- Le rendu n'est pas touche.
- Trois commits pousses sur `feat/map-elevations`. 72 tests, `tsc -b` propre.

## Session 2026-09-20 : code mort retire, ecrans 01 et 04 integres
- Supprimes apres verification qu'ils ne sont plus importes : `nodes/labels/Labels.node.ts` (etiquettes DOM),
  `postprocessing/effects/Overlay.effect.ts` (jamais commite), et les regles `.map-label*` de `labels.css`.
  `.map-survey*` reste : `SurveyNode` s'en sert.
- Ecran 01 (entree) : page silencieuse de la maquette. La masse d'encre est le rendu lui-meme au repos, fondu
  par le meme lavis. L'invitation « Entrer » n'apparait qu'une fois la scene prete, et le filet de chargement
  dit l'etat reel (en chargement / pret) plutot qu'un pourcentage invente.
- Ecran 04 (territoire) : `MapArchives.client.vue`, ouvert au clic sur un nom via
  `IMapNavigator.onPlaceSelected`. Cote, nom en Bodoni, trois chiffres, onglets, entrees avec leurs quatre
  marqueurs de statut, pied. Le fil d'Ariane se complete du territoire, la legende rejoint les releves.
- Accents remis dans toute la copie affichee : la convention sans accents vaut pour le code, pas pour le texte
  lu. Le jeu de caracteres du SDF porte deja les majuscules accentuees.
- Non fait : le decalage de la carte a l'ouverture du panneau (il faudrait toucher au cadrage du rendu), et
  les ecrans 05 (presidentielle) et 06 (mobile).
- Sans source : les entrees du fonds et ses trois chiffres sont ceux de la maquette.
- 72 tests, `tsc -b` propre. Cinq commits pousses sur `feat/map-elevations`.

## Session 2026-09-20 : passe de recettage carte
- Le masque n'avait pas bouge : valeurs enregistrees intactes (95/95/0,6/0,12) et code jamais touche. Ce qui
  manquait, c'est le VOILE des maquettes (degrade de papier haut et bas) sous lequel le chrome se lit. Remis.
- Pied refait en une seule rangee : trois blocs en absolu se chevauchaient des que la fenetre retrecissait.
  Ordre d'abandon : legende (<1500), frise (<1150), rail (<900).
- Etiquettes cliquables : la boite venait d'un calcul parallele au dessin. Elle est maintenant tiree des
  quadrilateres ecrits, serree sur la hauteur de capitale mesuree dans la police (`SdfFont.cap`). Verifie en
  survolant le texte : `_hovered` repond, curseur en main, le clic ouvre le fonds.
  Methode de diagnostic qui a paye : poser des reperes DOM en direct (rAF) sur `_ground` puis sur la boite.
  Les cercles sur `_ground` tombaient pile sur les points au sol, ce qui a innocente la projection et pointe
  la mise en page du texte.
- Rail = commutateur de niveau, accent sur le niveau affiche. Fil d'Ariane = position relevee sur la carte
  (`geo.api.gouv.fr/communes?lat&lon&fields=nom,departement,region`, un appel), complete par paliers de zoom.
- Recherche branchee (`PlaceIndex.search`), frise dont on choisit la periode, vol qui cadre un territoire sur
  son contour (`extentOfRings`), panneau qui se range quand le territoire quitte la vue, entree en coulissant
  derriere un rideau de lignes, chiffres comptes. Villes hors France retirees, mention Methode retiree.
- Techniques lues pour la suite : transition LV-origin (revelation radiale bruitee, `radial*0.65 + noise*0.35`,
  balayage `progress*1.35`, double smoothstep pour le palier blanc) et alignement DOM/WebGL de PFGOB25
  (camera a `z = (H/tan(fov/2))*0.5` pour 1 unite = 1 px, plan unitaire mis a l'echelle du rect).
- RESTE : toute la refonte d'intro (cercle au curseur, UI d'intro en WebGL, transition encre depuis le centre,
  hachures sur les cotes) et l'animation de survol des etiquettes (accent en transition bruitee).
- 72 tests, `tsc -b` propre. Six commits pousses.

## Session 2026-09-20 : la vraie cause des noms inattrapables
- DEUX causes, aucune dans les metriques du texte (ou j'ai perdu beaucoup de temps) :
  1. Au repos, `Main.universe` met `composer.paused` pour ne pas chauffer, MAIS les noeuds continuent de
     tourner. La boite de survol avancait donc sous un texte fige sur la derniere image rendue. Corrige par
     `Labels3DNode.settled`, ajoute au test `still` a cote de `terrain.settled` et `buildings.settled`.
  2. La parallaxe suit la souris : le nom se deplace pendant qu'on l'approche. `MapCameraNode.holdParallax`
     tient la carte des que le pointeur entre dans une marge de 28 px autour d'un nom.
  Lecon : quand une zone cliquable "ne tombe pas sur le dessin", verifier d'abord que le dessin et le calcul
  sont de la MEME image. Les reperes DOM en direct ne le disent pas, puisqu'ils suivent le calcul.
- Rouge du survol en transition bruitee : `terrainSettings.hoverReveal` monte de 0 a 1 et un seuil sur le bruit
  accroche a la carte (`hoverGrain`) decide de l'ordre des pixels. Seuil, pas fondu : le trait reste franc.
- Changement de niveau : les etiquettes sortent (`_fade`), le niveau n'est applique qu'une fois la page nette,
  les nouvelles reviennent. Plus de croisement de deux jeux de noms.
- PFGOB25 n'a AUCUNE dependance de texte 3D (verifie package.json, lockfile, grep) : ni troika, ni mesh-ui,
  ni bmfont. Ce qui existe, c'est l'alignement DOM -> WebGL de `Project.js` et un `getCaretCoordinates.js`
  vendorise mais orphelin.
- RESTE : panneau d'archives en three-dom-alignment avec fondu bruite, animation de l'etiquette au survol,
  et toute la refonte d'intro.
- 72 tests, `tsc -b` propre. Sept commits pousses.

## Session 2026-09-20 : refonte des etiquettes, une seule transformation
- BUG MAJEUR trouve grace a la capture de l'utilisateur : `override update(dt)` alors que la signature est
  `update(time, dt)`. Le noeud recevait le temps ecoule a la place du pas, le facteur d'interpolation saturait
  a 1 des la premiere image, et TOUTES mes transitions se terminaient instantanement. D'ou "rien n'est anime".
  A verifier systematiquement en surchargeant une methode du boilerplate.
- Deuxieme cause d'instantaneite : rasteriser un contour bloque l'image, le `dt` suivant vaut des centaines de
  ms et avale la transition. Pas borne a 40 ms (`MAX_STEP_MS`).
- REFONTE : le panneau face camera passe du shader au CPU. Chaque etiquette a son `Group` (position = point
  ancre, quaternion = camera, echelle = `pixelScale(hauteur, fov) * profondeur de vue`), ses quadrilateres en
  pixels dans ce repere, et un `PlaneGeometry` invisible a la taille du nom comme cible de raycast.
  Le dessin et la zone visee sortent de la meme matrice : ils ne peuvent plus diverger.
  Verifie : le proxy se projette au pixel pres sur la boite annoncee (337, 474 dans les deux cas).
  Motif repris de road-to-amsterdam (`heart/index.js` : proxy invisible, seule cible du raycaster).
- Survol de l'etiquette : accent sur le texte, filet allonge, leger soulevement, plus vif que le rouge du sol.
- Marge haute qui ecrasait les etages corrigee (Saone-et-Loire par-dessus Cote-d'Or).
- road-to-amsterdam utilise `three-msdf-text-utils@1.1.7` (atlas MSDF bmfont) mais SANS billboard et avec une
  interaction 100 % DOM. PFGOB25 n'a aucune dependance texte. Notre atlas SDF maison reste le bon choix.
- RESTE : panneau d'archives en three-dom-alignment avec fondu bruite, et toute la refonte d'intro.
- 72 tests, `tsc -b` propre. Neuf commits pousses.

## Session 2026-09-21 : panneau et intro dans le rendu
- PANNEAU : le texte reste en HTML (lisible, selectionnable, dispose en CSS) et un plan WebGL cale sur son
  `getBoundingClientRect()` fait l'entree et la sortie, en se retirant par taches (seuil sur un bruit fractal).
  Alignement DOM -> WebGL : plan devant la camera, echelle `pixelScale(hauteur, fov) * profondeur`, pose au
  centre du rectangle ramene au centre de l'ecran. Le noeud ecrit `--fonds-reveal` sur l'element : une seule
  valeur pilote le rideau et le fond du panneau.
- INTRO : texte central et bouton retires. Cercle trace autour du curseur (il le rattrape, il n'y colle pas),
  mot pose au-dessus, fond de papier hachure sur les deux bords. Tout dans le rendu, pour que le depart
  retire l'ensemble d'un seul geste : revelation radiale bruitee (`radial*0.65 + noise*0.35`, balayage x1,35),
  reprise des projets de reference. Verifie a mi-course : la carte apparait par une tache d'encre depuis le
  centre, hachures encore en place sur les bords.
- Deux pieges rencontres :
  1. Le mot de l'intro partageait `labelSettings.reveal` avec les noms de la carte, qui vaut 0 pendant l'intro.
     `createLabelMaterial` prend desormais son uniforme d'apparition en parametre.
  2. Meme profondeur + profondeur desactivee : sans `renderOrder`, le curseur passait sous le rideau.
  3. Le retrait du rideau doit se compter A L'HORLOGE : les premieres images de la carte sont lourdes et le
     pas borne (`MAX_STEP_MS`, qui protege les autres transitions) y faisait patiner la transition.
  4. `settled` doit rendre vrai une fois l'intro partie, sinon le cercle — qui n'est plus mis a jour — tient
     l'univers eveille pour toujours.
- Atlas SDF mis en cache : en batir un coute une cinquantaine de millisecondes, l'intro et les noms partagent.
- 72 tests, `tsc -b` propre. Onze commits pousses.

## Session 2026-09-21 (suite) : douze retours

- Grab : capture du pointeur au premier appui + souris sans bouton = fin du geste + blur de la fenetre.
- Avions : taille, altitude, vitesse suivent la largeur de vue (ref 12 km), bornees a x2.
- Intro : plus de rideau. Feuille = passe d'encre ; hachures des bords par `inkCoverage` (ton 0,52, 28 % de l'ecran).
  Titre et mot en WebGL cales sur le DOM, effaces par `pageErased` (masque de la carte, puis taches `pencilReveal`
  en fin d'ouverture). Cercle du curseur en HTML (`MapCursor`), pointeur systeme visible.
- Etiquettes : entree/sortie par etiquette (460/220 ms, cascade 60/22 ms), hampe qui pousse ; etages sans collision.
- Accents : 3 places (`HOVER_SLOTS`), `AreaAccentsHelper` ; accent aussi au survol du sol (`PlaceIndex.containing`,
  `fetchCommuneAt`) ; regle « deja dedans » (`_isHere`, vue <= 3x le territoire).
- Panneau : feuille WebGL sans fond DOM, bord d'encre (trait `fwidth`), texte gate par `--fonds-reveal`, demontage
  apres effacement, horloge murale ; chrome et releve se retirent a gauche (`data-fonds-open`).
- Pieges : volet du navigateur masque -> `visibilityState: hidden`, rAF gele, captures perimees (verifier par pas
  manuels `node.update()`) ; panneau referme en plein vol par la regle « hors de vue » (`readout().flying`).
- Tests : 75/75, `tsc -b` propre.
