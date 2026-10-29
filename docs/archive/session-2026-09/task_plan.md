# Plan : composition de reference, masque Chartogne-Taillet, POC allege

## Objectif
Retrouver la composition de l'image de reference (vue Paris : bati dessine propre, beaucoup de papier, masque
centre) avec les acquis recents (volumes, chargement, arbres, voitures), corriger les bugs remontes, et tenir 120 i/s.

## Phases

### Phase 1 : Outils de travail — complete
- [x] 1.1 Panneau de debug : ne plus enregistrer tout seul, seulement sur "Save Settings" (`_core/debug/DebugValues.ts`)

### Phase 2 : Masque facon Chartogne-Taillet — complete (refait)
- [x] 2.1 ERREUR corrigee : un masque ecran suit la camera ; l'utilisateur le veut SUR LA CARTE. Ellipse au sol,
      centree exactement sur la cible de la camera (origine de la scene), axes = rotation de la vue sans parallaxe
      ni roulis (`MapCameraNode.lookAxis`) ; reglages `mask.radiusX/Y`, `softness`, `jitter` de l'utilisateur
- [x] 2.2 Le masque n'efface que la couleur (pas de hauteur) ; bruit du bord accroche a la carte, sans derive
- [x] 2.3 Decalage en haut : le centre etait le point ou le regard touche le sol (bouge avec souris et plancher
      de la camera) -> maintenant la cible. Verifie : cible a (0,500 ; 0,500) au repos, (0,494 ; 0,505) souris au coin

### Phase 3 : Fond papier, journal, nuages — complete
- [x] 3.1 Texture journal seamless (assets-source/Images/Diffuse) en fond, accrochee au sol (inclinaison prise en
      compte), echelle reglable au panneau
- [x] 3.2 Nuages hachures a l'horizon (bandes courbes lentes, facon CT) a la place du journal en haut

### Phase 4 : Bugs de rendu — complete
- [x] 4.1 Trous : tuiles de bati en file derriere l'image du sol -> file priorisee (bati, fin, ensemble ; centre d'abord)
- [x] 4.2 Texture qui bouge : hauteurs liees au masque (suivait la souris) + tremble fixe a l'ecran -> retires / accroche a la carte
- [x] 4.3 Particules : 36 petites ellipses vides a l'encre ; points de graticule decoupes net
- [x] 4.4 Image du sol en fondu 1 s

### Phase 5 : Contenu du POC — complete (5.5 propose, non fait)
- [x] 5.1 Arbres : seulement dans les parcs / bois (15 m, 1500 par tuile) ; plus d'alignements
- [x] 5.2 Voitures : densites /2 a /3, rapetissent aux bouts de voie, roulent aussi sur les ponts
- [x] 5.3 Ponts dessines (routier_route_sup, routier_chemin_sup) par-dessus l'eau
- [x] 5.4 Peniches (lignes de noms des fleuves sur l'eau), 3 avions au plus
- [ ] 5.5 (option) noms des grandes rues, comme les refs

### Phase 6 : Chargement plus leger — complete (reponse a donner)
- [x] 6.1 Repondre : textures de plan moins detaillees ? (bati deja en volumes) ; mesurer et alleger ce qui peut l'etre

### Phase 7 : Verification et livraison — complete
- [x] 7.1 69 tests, typecheck, captures (Paris 2,5 et 3 km)
- [x] 7.2 Spec et memoire a jour

## Session nuit (2026-09-19) : retours sur la passe precedente

### Phase 8 : Qualite du trait (priorite) — complete
- [x] 8.1 Retrouver l'image "avant" (traits gras et rugueux, murs et ombres portees hachures, pas de brume) :
      comparer HEAD / actuel / image 1 a vue identique, isoler chaque changement responsable
      -> lumiere et papier enregistres (remis avec accord), plan imprime sur le relief eclaire (plus efface par
         le soleil), traits de l'eau et bords des routes renforces

### Phase 9 : Fluidite — complete
- [x] 9.1 Gel a l'arrivee sur Paris : 5 shaders compiles d'un coup (228 ms, 1,4 s GPU charge) -> precompiler
- [x] 9.2 "Lag plus qu'avant" : ombre du relief coupee sur vue plate + grille d'ombre 192 ; ancienne image du plan lue
      seulement pendant son fondu (mesures GPU trop bruitees pour chiffrer le gain ; 512 subdivisions = +3,7 ms)

### Phase 10 : Cadre — complete
- [x] 10.1 "Fin de la 3D" : nuages posés derrière le bord lointain, qui ferment la vue visible (bord du sol / grille calee sur le masque / far)
- [x] 10.2 Masque : zone dessinee plus grande en vue large (France, Monde) — confirme par l'utilisateur
- [x] 10.3 Nuages facon CT (image 2) : hachures horizontales fines en cumulus, gris clair, bas sur l'horizon

### Phase 11 : Vie de la carte — complete
- [x] 11.1 Particules = poussiere de CT (cube autour de la camera, vent, visibles en mouvement) en contours
- [x] 11.2 Avions 3D qui traversent la France (visibles a toutes les echelles)
- [x] 11.3 Bateaux (x1,75, 3 par km : 15 a Paris) visibles
- [x] 11.4 Ponts en 3D
- [x] 11.5 Noms des grandes routes (lettres cernees sur bandeau de papier ; a affiner)

### Phase 12 : Verification — complete
- [x] 12.1 Tests, typecheck, captures avant/apres, memoire

## Session 2026-09-20 : retours sur la passe nuit

### Phase 13 : Respirer — complete
- [x] 13.1 Moins de traits, plus simple : alleger la densite (arbres, pointilles, petits batiments au loin)
- [x] 13.2 Trous : endroits sans bati ni vegetation (chercher la cause, combler par du couvert dessine)

### Phase 14 : Ciel et air — complete
- [x] 14.1 Nuages : vrais nuages places dans le monde (plus de bande repetee sur un cylindre)
- [x] 14.2 Particules : cube autour de la camera, visibles au repos, glissent a l'inverse du deplacement,
      bouclent au bord, plus petites au loin
- [x] 14.3 Avions : moins nombreux ; masque applique aux avions et aux bateaux

### Phase 15 : Maillage selon l'echelle — 15.1 faite, 15.2 non mesuree
- [x] 15.1 Subdivisions du sol selon le relief et l'echelle (plus en montagne / France, moins en ville plate)
- [ ] 15.2 Moins d'appels de dessin (fusion par tuile) si la mesure le justifie

### Phase 16 : Panneau de debug — complete
- [x] 16.1 Retirer ce qui ne sert plus, ajouter les nouveaux reglages (densite des avions, nuages, particules...)
- [x] 16.2 Ranger en onglets pour qu'il reste court

## Session 2026-09-20 (suite) : retours sur les avions, les bords et la vie

### Phase 17 : Echelle et bords — complete
- [x] 17.1 Avions : ils grossissent avec le dezoom (taille en unites de scene) -> les tenir a l'echelle de la carte
      et les effacer en vue large
- [x] 17.2 Ne plus voir la fin de la carte : la zone dessinee elargie depasse le sol (+-150 unites) en vue large

### Phase 18 : Zones vides — complete
- [x] 18.1 Grandes zones sans rien (capture) : chercher pourquoi (plafond d'arbres par tuile ?) et densifier le couvert

### Phase 19 : Mouvement — complete
- [x] 19.1 Eau : petites vagues dessinees, traits animes
- [x] 19.2 Arbres : un peu de vent

## Decisions
| Decision | Pourquoi |
|---|---|
| Masque AU SOL, centre sur la cible de la camera | Demande explicite (repetee) : sur le point vise de la carte, pas sur la camera. Le masque ecran (essaye) suivait la camera : refuse |
| Planning a la racine du projet, jamais commite | Skill planning-with-files ; fichiers de travail |
| Le masque ne change plus la hauteur du bati | Il suivait la souris (parallaxe) : les batiments montaient/descendaient sans cesse au bord, les aretes bougeaient ("texture qui bouge") |
| Papier a l'ecran, journal au sol | CT pose son papier a l'ecran ; le journal fourni est "pour le fond", a plat, en perspective, efface vers l'horizon |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| Rendu tout blanc a la capture | 1 | Le repos saute des images ; le banc force le rendu |
| Masque mis a l'ecran (suit la camera) | 1 | Mauvaise lecture de "au centre de l'ecran" : refait au sol sur la cible |
| Nuages en traits continus, papier en trainees | 1 | Textures d'attente en bord fixe ; meme mode de repetition des l'attente |
| `clouds` declare deux fois (InkStyle) | 1 | Renomme ; le HMR avait casse la page, rechargement complet |

## Session 2026-09-20 (soir) : eau gravee, globe, intro, UI 3D

### Phase 12 : Eau gravee — fait
- [x] 12.1 Animation des vagues retiree (refusee) : l'ondulation est dans le dessin, plus dans le temps
- [x] 12.2 Champ de distance a la rive = pile de mips du canal eau (`openWaterAt`), lu en pixels (divise par sa
      propre pente) : meme ecart de trait a toute echelle, traits qui suivent la rive et s'espacent vers le large
- [x] 12.3 Mer eclaircie par le large (`SEA_NEAR` / `SEA_FAR`) : l'aplat gris uniforme se faisait hachurer en entier
- [x] 12.4 Trame du large tres lache, epaisseur ramenee a l'echelle (une largeur est une fraction de l'ecart)

### Phase 13 : Niveau de detail du crayon — fait
- [x] 13.1 `inkSettings.detail` (0 epure, 1 tout dessine, defaut 0,7), onglet Encre
- [x] 13.2 Agit sur : puissance de la densite des tons moyens, seuils de contour, hachures de vegetation

### Phase 14 : Globe et navigation infinie — a faire
- [ ] 14.1 Courber le sol avec le dezoom (courbure terrestre reelle : invisible en ville, franche au monde)
- [ ] 14.2 Appliquer la meme courbure a `toScene` (bati, arbres, voitures) et cote CPU (etiquettes, graticule)
- [ ] 14.3 Navigation infinie : longitude qui boucle, latitude plus bornee au centre en vue large

### Phase 15 : Animation d'intro — a faire
- [ ] 15.1 Page vide (papier jauni), annotation qui suit la souris en douceur : "click to draw the map"
- [ ] 15.2 Au clic : la carte se dessine en expansion, arrivee au-dessus de la France, puis l'UI se dessine

### Phase 16 : UI dans le rendu 3D — a faire
- [ ] 16.1 Etiquettes de villes dessinees dans la passe 3D (aujourd'hui du DOM par-dessus, `Labels.node.ts`)
- [ ] 16.2 Survol : la ville se dessine en rouge (demande un picking, absent aujourd'hui)

## Session 2026-09-20 (nuit) : "retrouver le rendu du deploiement, en volumes"

### Phase 17 : Comparer deploiement (parallaxe) et local (volumes) — fait
- [x] 17.1 Le deploiement en ligne = commit `de6dd38` (HEAD) ; tout le travail des dernieres sessions n'est pas
      commite. Arbre de travail HEAD monte a part (port 7831) pour comparer a vue et reglages identiques
- [x] 17.2 Meme vue (Paris 3 km, 2048 x 1536), encre couverte (part de pixels sous 128) :
      HEAD/parallaxe 29,4 % | actuel/volumes 18,2 % | actuel/parallaxe 19,0 %
      -> la technique ne fait que 0,8 point ; les 11 autres viennent d'ailleurs
- [x] 17.3 Reglages du panneau (`debug.values.json`) remis a ceux de la reference, sur le code actuel :
      volumes 31,0 % | parallaxe 33,0 % (reference 29,4 %) -> le rendu de reference revient en volumes
- [x] 17.4 Cout GPU a cette vue, 3 tours entrelaces : volumes 6,1 ms | parallaxe 16,2 ms (2,7 x)

### Phase 18 : Remettre le rendu de reference — fait
- [x] 18.1 `debug.values.json` remis aux valeurs de la reference (copie de l'ancien fichier dans le bloc-notes de
      session, `debug.values.avant-reference.json`) : masque 95 x 95 / fondu 0,6 / bord 0,12 ; ton papier 0,8,
      ton encre 0,08 ; tremble 1,5, grain 0,5 ; contour arete 0,2, contour profondeur 0,01, trait 1 ;
      trame 5, hachures croisees 0,55, profondeur 0,6 ; relief x1, subdivisions 256
- [x] 18.2 Verifie a l'image : 30,9 % d'encre contre 29,4 % a la reference, meme vue

### Phase 19 : Parallaxe retiree du code — fait
- [x] 19.1 `Terrain.material.ts` : `parallaxHit`, `buildingsOn`, uniformes `parallax` et `inkDirect`, encre directe
      dans le shader du sol, et le dessin a plat efface sous les volumes. `marchEntry` / `fineMarch` / `fineSteps`
      restent : ce sont eux qui donnent aux volumes leurs contours et leurs ombres (`buildingSurface`)
- [x] 19.2 `BuildingTechnique` : `none` ou `extrusion` ; choix "parallaxe" retire du panneau
- [x] 19.3 `InkStyle.onePass` retire ; l'effet plein ecran est le seul chemin de dessin
- [x] 19.4 Groupe de reglages `parallax.*` renomme `shading.*` (valeurs sauvegardees migrees)
- [x] 19.5 Verifie : 69 tests, `tsc -b`, capture Paris 3 km, GPU 5,5 ms median (parallaxe : 16,2 ms)

## Session 2026-09-20 (nuit, suite) : eau dessinee et maillage des cotes

### Phase 20 bis : L'eau, en simple (demande du 2026-09-20 au soir) — fait
- [x] 20b.1 Des droites a 45 degres, ecart constant, accrochees a la carte
- [x] 20b.2 Elles s'effacent progressivement en s'enfoncant dans l'eau (pleines au bord, rien au milieu)
- [x] 20b.3 Ni tremble ni animation : le sinus, le bruit et les reglages `waterWobble` / `waterSpeed` sont retires
- [x] 20b.4 Reglages : trait, serrage, epaisseur, effacement vers le centre, ton de la mer

### Phase 20 : L'eau comme sur une carte dessinee — remplacee par la 20 bis
- [x] 20.1 La mer n'est plus un aplat gris hachure a 45 degres : c'est du papier (`seaTone`) parcouru de traits
      paralleles a l'encre la plus sombre (un trait a demi teinte se ferait hachurer au lieu de rester un trait)
- [x] 20.2 Plus loin du rivage, moins de traits : deux anneaux autour du point donnent la distance a la terre, et
      a chaque palier un trait sur deux disparait, les autres ne bougent pas (`waterReach`)
- [x] 20.3 Traits tremblants : bruit accroche a la carte + houle en sinus, tous deux avances par `clock`
      (`waterWobble`, `waterSpeed`) ; verifie : 27 327 pixels changent en une seconde d'horloge
- [x] 20.4 L'image se redessine a la cadence de veille tant que `waterSpeed` > 0 (comme les voitures)
- [x] 20.5 Reglages : onglet Dessin > Eau (trait, serrage, epaisseur, espacement au large, tremble, vitesse, ton)
- [x] 20.6 Cout : le motif n'est calcule que sur l'eau, et les anneaux larges seulement pres d'elle
      (Paris 3 km : 9,7 ms sans ces deux gardes, 6,2 ms avec, contre 5,5 ms avant l'eau ; bord de mer 2,8 ms)

### Phase 21 : Maillage des cotes — diagnostic fait, suite a decider
- [x] 21.1 MESURE : l'escalier du trait de cote ne vient pas du maillage. A vue identique, 256 et 1024
      subdivisions donnent exactement le meme escalier (captures `W1-seg256` / `W1-seg1024`). Il venait du seuil
      `smoothstep(0, 1, altitude)` : sur un relief interpole, la bande 0-1 m tient dans un centieme de texel, et
      le bord suivait donc les cotes des texels
- [x] 21.2 Corrige : la terre est moyennee sur un anneau (`shoreAt`), le bord passe de l'eau a la terre sur une
      largeur constante ; les ilots d'un seul texel disparaissent aussi
- [ ] 21.3 Reste a trancher : densifier vraiment la grille la ou le relief varie (montagne). A mesurer 256/512
      sur une crete avant d'ecrire quoi que ce soit

## Session 2026-09-20 (nuit) : lot repris du message non traite

### Phase 22 : Relief, eau, subdivisions — fait
- [x] 22.1 Relief : exageration remise a 2,5 (defaut du code ; elle etait tombee a 1 avec les valeurs de
      reference) et plafond de subdivisions a 1024. Marseille se reconnait a ses collines
- [x] 22.2 Eau : les lignes restent, mais ondulent (bruit accroche a la carte, `waterWave`), s'espacent par
      paliers quand l'eau s'enfonce, et tremblent pres de la rive (`waterSurf`, trait plus gras ou plus maigre,
      comme un crayon) pour dire vagues et courants. Aucune animation dans le temps
- [x] 22.3 Subdivisions selon le relief : la grille mesure le creux moyen du relief en vue (grille de 16 x 16
      altitudes, difference seconde) et choisit 256, 512 ou 1024, avec un plancher de 512 des qu'une cote
      traverse la vue. Reglage "subdivisions selon le relief" pour le couper
- [x] 22.4 Niveau de detail du crayon : il existe deja (onglet Dessin > "niveau de detail", `inkSettings.detail`)

### Phase 23 : Globe, intro, UI dans le rendu
- [ ] 23.1 Vue monde en globe plutot qu'en planisphere, dezoom infini
- [x] 23.2 Animation d'intro : la page nait blanche (papier uni, sans journal, sans nuages, sans releves),
      l'annotation "click to draw the map" suit la souris en douceur ; au clic la zone dessinee s'ouvre depuis
      le point vise en 3 s pendant le vol vers la France, puis l'interface se dessine (fondu de 900 ms)
- [ ] 23.3 UI dessinee dans le rendu 3D (etiquettes de villes), survol en rouge

### Phase 24 : Retours sur l'intro et l'UI 3D
- [x] 24.1 La page d'avant le clic garde sa texture de fond (journal, nuages de la feuille) et quelques
      hachures (`IDLE_TONE` dans `Ink.effect`)
- [x] 24.2 Majuscule : "Click to draw the map"
- [x] 24.3 Moins de poussiere en altitude (densite 0,5 -> 0,2)
- [x] 24.4 Le texte apparait a l'entree de la souris dans la page, pas au chargement
- [x] 24.5 UI dans le rendu 3D : atlas de champs de distance construit depuis la police de la page
      (`text/DistanceField.ts` + `text/SdfFont.ts`, 3 tests), materiau de glyphes instancies
      (`materials/Label.material.ts`) et noeud (`nodes/labels/Labels3D.node.ts`), poses sur l'image finie par
      `OverlayPass`. Les etiquettes DOM sont remplacees. L'invisibilite venait du `side: FrontSide` par defaut :
      le panneau face camera inverse le sens des triangles (voir progress.md)
- [x] 24.6 Survol d une ville en rouge : verifie a l ecran, curseur en main, le clic vole vers la ville

## Session 2026-09-20 (suite) : focus par niveau, survol par contour

### Phase 25 : le survol colorie un contour administratif, pas le bati
Le bati etait le mauvais primitif : le PLAN IGN ne le sert qu'a partir du z14-15, donc rien ne rougissait aux
echelles ou l'on survole justement les noms. Et il ne dit rien des departements ni des regions.
- [x] 25.1 Source des contours : `france-geojson` (96 departements, 556 Ko ; 13 regions, 220 Ko), avec
      geometrie. `geo.api.gouv.fr` ne sert ni `centre` ni `contour` a ces niveaux (verifie : champs ignores)
- [x] 25.2 Masque : le contour survole est rasterise dans une texture calee sur son cadre en degres
      (`AreaMask.helper.ts`), le sol l'echantillonne par `lonLat` et marque le pixel (`BUILT_BAND` devient
      la marque du survol), l'encre teinte comme avant. Bord net : c'est une limite administrative
- [x] 25.3 Les volumes ne portent plus la marque : a ce zoom le survol ne sert a rien (retour arriere)

### Phase 26 : onglets de focus
- [x] 26.1 Trois niveaux : communes, departements, regions. L'onglet change les points d'interet affiches
- [x] 26.2 `IMapNavigator.setFocus`, composant `MapFocus.client.vue` a cote des raccourcis de vue
- [x] 26.3 Les noms de departements et de regions viennent de la meme source que les contours

### A verifier / en attente
- [ ] L'eau : l'utilisateur la trouve moins bonne. Mesure faite : les sept reglages sont ceux enregistres et
      les lignes sont bien rendues (capture Marseille). Attendre qu'il precise ce qui cloche
- [x] Contours des communes : charges au survol par code INSEE. Piege : la ville retenue venait de Natural Earth
      (population d'agglomeration) et n'avait pas de code ; `PlaceIndex.add` fusionne desormais code et contour

### Phase 27 : interface dans le rendu — complete
- [x] 27.1 Etiquettes : une seule transformation pour le dessin et la zone cliquable, raycast sur un plan
      invisible. Survol anime (accent, filet, soulevement)
- [x] 27.2 Panneau d'archives : rideau WebGL cale sur le rectangle DOM, retrait par taches
- [x] 27.3 Intro : cercle au curseur, mot au-dessus, hachures sur les bords, retrait en encre depuis le centre
- [ ] 27.4 Ecrans 05 (presidentielle) et 06 (mobile), non commences

## Session 2026-09-21 (suite) : retours sur l'intro, le panneau, le survol

### Phase 28 : douze retours (capture 1 : double effet a l'intro ; capture 2 : revelation organique voulue)
- [x] 28.1 Fond de l'intro : les memes hachures que la carte (les miennes sont trop espacees)
- [x] 28.2 Le pointeur systeme reste visible tout le long
- [x] 28.3 Cercle curseur pour toute l'experience : petit par defaut, plus petit au grab, un peu plus grand au survol
- [x] 28.4 Le titre a disparu de l'intro (a retrouver)
- [x] 28.5 Transition : un seul effet, celui de la carte (le masque qui s'ouvre), forme organique depuis le centre
- [x] 28.6 Accent du territoire au survol de la carte elle-meme, sauf si on est dedans ou tout pres
- [x] 28.7 Plusieurs accents simultanes : chaque territoire quitte garde sa sortie
- [x] 28.8 Etiquettes : entree reellement animee au changement de regard, plus courte, en hauteur et en opacite
- [x] 28.9 Panneau : pas de fondu d'opacite, il s'ecrit avec un bord d'encre (papier qui se consume a l'envers)
- [x] 28.10 Panneau : la sortie aussi
- [x] 28.11 Grab : relache hors canvas (panneau, CSS, hors fenetre) sinon la carte suit la souris au retour
- [x] 28.12 Avions dans l'espace de la carte : ils grossissent au dezoom

Phase 28 : complete (commits 04e1e9b..fcd8659, non pousses). Verifie a l'ecran : intro (titre, mot, hachures de la
carte, ouverture unique), entree des etiquettes, survol du sol (departements ; communes via l'API), panneau (ecriture,
effacement par pas manuels : volet masque = rAF gele). A revoir par l'utilisateur : ton des hachures (0,52), largeur
du bord d'encre du panneau, rayons du cercle (12 / 17 / 8 px).

### Phase 29 : retours sur la phase 28 — complete (1f1ebfb..0da2eed, non pousses)
- [x] 29.1 Carte survolable sous l'intro : noms et survol bloques tant que la carte n'est pas decouverte
- [x] 29.2 Cercle trace a la main (SVG, 3 etats alternes a 7 i/s)
- [x] 29.3 Plus de dezoom : la carte est posee sur la France sous la page (`jumpTo`) ; `ready` partait avant
      `publish`, `holdIntro` n'etait jamais appele
- [x] 29.4 Masque de la carte fige (`drawnReveal` et `inkSettings.reveal` supprimes) ; masque de composition a
      l'ecran (`PageTransition.ts`, spirale de coups de pinceau, bord franc) qui fait seul le passage
- [x] 29.5 Interface qui entre bloc par bloc apres le passage
- [x] 29.6 Nom du territoire survole affiche (et teinte), prioritaire sur les etages
- [x] 29.7 Texte du panneau : 300 ms par bloc (interpretation : c'etait le texte, pas la feuille)

### Phase 30 : controles SONDE, eau, polices, cercle, sortie du panneau
- [x] 30.1 Theatre `intro` pour la timeline de SONDE (contrat structurel, pistes dans `timeline.tracks.json`,
      route `/__sonde/timeline`) : progres du passage, parametres du masque, entree de l'interface, entree des noms
- [x] 30.2 Bords de la page dessines comme l'eau de la carte (`penWater`, refactor pur de `seaLines`)
- [x] 30.3 SDF : lissage d'un pixel (`fwidth`) au lieu d'une bande fixe
- [x] 30.4 Cercle : ferme, legere ondulation, sans alternance
- [x] 30.5 Panneau : le texte part avant la feuille
Phase 30 : complete (6b31a9a..abb5e37, non pousses). Timeline verifiee dans SONDE (theatre charge, tete de lecture
qui rejoue le passage), bords en eau compares a la mer en vue France, fermeture du panneau par captures.

### Phase 31 : fond de maquette, rotation, chargement — complete (60d2937..522ca26, non pousses)
- [x] 31.1 Fond de l'intro compose comme `01-entree.html` (masse d'encre = la carte, lavis sur le titre)
- [x] 31.2 Texte du panneau : opacite seule
- [x] 31.3 Rotation du masque (`passage.rotation`)
- [x] 31.4 Bornes du front robustes aux reglages (decalage negatif, grosses taches laissaient la page au centre :
      cause probable de « pas de carte une fois sur deux »)
- [x] 31.5 Entree gatee sur le chargement reel (jauge en %), plan d'une vue quittee ignore, gestes fermes sous la page,
      ciel rendu des l'attente
- [ ] A mesurer par l'utilisateur : saccades restantes (profilage impossible ici, volet masque = rAF gele)

### Phase 32 : curseur grab, loader, optimisation (en cours)
- [x] 32.1 Feuille de chargement (8c7c8aa), curseur grab (eb93c51), pousse
- [x] 32.2 Bruit peint (`noise.png` -> `NoiseMap.ts`) a la place de `mx_noise_float` / `mx_fractal_noise_float`
- [x] 32.3 Page d'entree et masque sous branche uniforme : plus rien apres l'intro (85f3d3e, non pousse)
- [ ] 32.4 Audit d'optimisation (ChatGPT, lance par l'utilisateur) : a integrer
- [ ] Note : le loader se leve a ~1,6 s cache chaud ; l'utilisateur le juge mal cale -> cout GPU apres levee a mesurer
