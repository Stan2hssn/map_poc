# Glossaire

> **En une phrase :** chaque mot technique de la documentation, expliqué en deux lignes, avec le chapitre où il sert vraiment.

Les mots sont rangés par ordre alphabétique. Si une définition ne suffit pas, suis le lien : le chapitre indiqué raconte le mot en situation.

Retour au [sommaire](./README.md).

---

### abonnement

Au lieu de demander sans arrêt « il s'est passé quelque chose ? », un morceau de l'interface dit une fois « préviens-moi », et la carte le prévient quand ça arrive (un clic sur un lieu, par exemple).
Voir [L'application autour de la carte](./interface.md).

### API

Une adresse internet à laquelle un programme pose une question et reçoit une réponse, comme un guichet. La carte interroge ainsi l'IGN pour les altitudes, le plan et les noms de lieux.
Voir [Les données](./3d/donnees.md) et [Les lieux](./lieux.md).

### atlas

Une grande planche où l'on range une fois pour toutes plein de petits dessins (des lettres, des formes d'arbres, d'avions). On découpe la bonne case au moment de dessiner, au lieu de charger mille petites images.
Voir [Les lieux](./lieux.md).

### boucle de rendu

Le cycle qui se répète à chaque image : mesurer le temps écoulé, lire la souris, mettre la scène à jour, dessiner. À 120 images par seconde, un tour dure environ 8 millièmes de seconde.
Voir [Les bases](./00-les-bases.md) et [Le moteur](./moteur.md).

### branche

Une version parallèle du projet. On travaille sur l'une (*develop*), on vérifie sur une autre (*staging*), le public voit la dernière (*prod*).
Voir [L'application autour de la carte](./interface.md).

### bruit

Une image de valeurs tirées au hasard, mais qui changent doucement d'un pixel à l'autre. Sert à faire trembler un trait ou varier une teinte sans que ça ait l'air mécanique.
Voir [Le dessin à l'encre](./dessin.md).

### cache

Une réserve en mémoire des choses déjà téléchargées (ici, des tuiles), pour ne pas les redemander quand on revient au même endroit.
Voir [Les données](./3d/donnees.md).

### caméra

L'œil virtuel qui regarde la scène : une position, une direction et un angle de vision. Sur cette carte, elle ne voyage presque pas ; c'est la carte qui glisse sous elle.
Voir [Les bases](./00-les-bases.md) et [La navigation](./navigation.md).

### canvas

Une zone rectangulaire de la page web dans laquelle la carte graphique peint une image, pixel par pixel, plusieurs dizaines de fois par seconde. Toute la carte 3D vit dedans.
Voir [L'application autour de la carte](./interface.md).

### carte graphique

La puce de l'ordinateur spécialisée dans le dessin. Elle a des milliers de petits ouvriers qui font tous la même opération en même temps, chacun sur sa case. On l'appelle aussi GPU.
Voir [Les bases](./00-les-bases.md).

### carte vectorielle

Une carte décrite par des formes (lignes, surfaces) avec des étiquettes (« route départementale », « bois »), au lieu d'une image faite de pixels. On peut la redessiner à n'importe quelle échelle.
Voir [Les véhicules](./3d/vehicules.md) et [Les données](./3d/donnees.md).

### champ de distance signé

Une façon de ranger une lettre dans une image : chaque pixel ne dit pas « allumé / éteint » mais « à quelle distance du bord suis-je ». Résultat : des lettres nettes même agrandies. En anglais, SDF.
Voir [Les lieux](./lieux.md).

### composant

Une brique d'interface réutilisable : un bouton, un bandeau, un panneau. La page est un assemblage de composants.
Voir [L'application autour de la carte](./interface.md).

### contrat

Une liste écrite de ce qui doit être présent dans la scène. Au démarrage, le moteur vérifie que chaque élément de la liste est bien monté.
Voir [Le moteur](./moteur.md).

### CPU

Le processeur principal de l'ordinateur. Très habile, mais il traite les tâches à peu près une par une. Le contraire de la carte graphique.
Voir [Les bases](./00-les-bases.md).

### demi-flottant

Un nombre à virgule rangé sur 2 octets au lieu de 4. Deux fois moins lourd, un peu moins précis. Les altitudes sont stockées ainsi pour faire tenir plus de tuiles en mémoire.
Voir [Les données](./3d/donnees.md).

### éclairage de Lambert

La règle la plus simple pour éclairer une surface : plus elle fait face au soleil, plus elle est claire ; de profil, elle s'assombrit. Les nuages s'en servent pour placer leurs hachures.
Voir [Le ciel](./3d/ciel.md).

### exagération du relief

On soulève les montagnes plus haut que la réalité, exprès. Sans ça, vu de loin, le relief paraîtrait plat. L'exagération grandit quand on dézoome, mais moins vite que le dézoom.
Voir [Le terrain](./3d/terrain.md).

### extrusion

Pousser un contour plat vers le haut pour lui donner de l'épaisseur, comme une pâte qui sort d'une poche à douille. C'est ainsi qu'un plan de maison devient un volume.
Voir [Les bâtiments](./3d/batiments.md).

### face arrière

Chaque triangle a un recto et un verso, reconnus à l'ordre de ses trois coins. Par défaut, la carte graphique ne dessine pas le verso : un panneau mal orienté devient invisible.
Voir [Le ciel](./3d/ciel.md).

### générateur pseudo-aléatoire

Une petite formule qui produit une suite de nombres qui ont l'air quelconques, mais qui redonne toujours la même suite si on part du même nombre (la *graine*). Les voitures et les nuages restent ainsi à la même place d'une visite à l'autre.
Voir [Les véhicules](./3d/vehicules.md) et [Le ciel](./3d/ciel.md).

### GPU

Abréviation anglaise de *graphics processing unit* : la [carte graphique](#carte-graphique).

### HTML

Le langage des pages web : du vrai texte, des vrais boutons, que le navigateur sait afficher, lire à voix haute et rendre cliquables. Il est posé par-dessus la carte comme un calque transparent.
Voir [L'application autour de la carte](./interface.md).

### image clé

Dans une animation, un moment où l'on fixe une valeur (« à 1,5 s, l'opacité vaut 1 »). Entre deux images clés, l'ordinateur calcule tout seul les valeurs intermédiaires.
Voir [L'application autour de la carte](./interface.md).

### instanciation

Dessiner mille fois la même forme en ne la décrivant qu'une fois, comme un tampon encreur : un seul tampon, mille empreintes, chacune à sa place. Sert pour les murs, les arbres, les voitures, les avions.
Voir [Les bâtiments](./3d/batiments.md) et [La végétation](./3d/vegetation.md).

### JSON

Un fichier texte qui range des valeurs par nom (`"épaisseur du trait": 1.2`). Les réglages de la carte sont enregistrés dans un fichier de ce type.
Voir [L'application autour de la carte](./interface.md).

### lancer de rayon

Tirer une ligne droite imaginaire, comme un pointeur laser, depuis l'œil vers la scène, et regarder ce qu'elle touche. Sert à savoir quel point de la carte est sous la souris.
Voir [Les lieux](./lieux.md).

### latitude

La position nord-sud sur la Terre, en degrés : de -90° au pôle sud à +90° au pôle nord. La vue de départ est à 44,121° de latitude, dans les Cévennes.
Voir [Les bases](./00-les-bases.md).

### longitude

La position est-ouest sur la Terre, en degrés : de -180° à +180°. La vue de départ est à 3,581° de longitude.
Voir [Les bases](./00-les-bases.md).

### maillage

Un ensemble de points reliés en triangles, comme un filet. C'est la façon dont la 3D décrit toute surface : le sol, un toit, un arbre.
Voir [Les bases](./00-les-bases.md) et [Le terrain](./3d/terrain.md).

### masque

Une forme qui dit où dessiner et où ne rien dessiner, comme un pochoir. Sur cette carte, c'est une ellipse posée au sol autour du point visé : au-delà, la carte s'efface dans le papier.
Voir [Le terrain](./3d/terrain.md).

### moteur

Le code qui fait tourner la scène (démarrer, mettre à jour, dessiner, arrêter) sans rien savoir de ce qu'elle montre. Il vient d'un modèle commun à plusieurs projets.
Voir [Le moteur](./moteur.md).

### mosaïque

Le jeu de tuiles posées côte à côte qui couvre ce qu'on regarde. Il y en a deux superposées : une fine pour le centre de la vue, une grossière pour les alentours.
Voir [Le terrain](./3d/terrain.md).

### niveau de détail

Avoir plusieurs versions d'un même objet, fine de près et grossière de loin, pour ne pas gaspiller de calcul sur ce qu'on voit à peine. Le terrain de cette carte l'obtient sans rien gérer, grâce à sa grille collée à l'écran.
Voir [La carte en 3D](./3d/README.md).

### niveau de zoom

Le numéro d'échelle d'une tuile. Au niveau 0, le monde tient en 2 tuiles ; chaque niveau coupe chaque tuile en 4. Plus le niveau monte, plus chaque pixel couvre une petite surface.
Voir [Les bases](./00-les-bases.md) et [Les données](./3d/donnees.md).

### node

Un élément de la scène (la caméra, le terrain, les avions...) avec son cycle de vie : il naît, se met à jour à chaque image, puis disparaît proprement.
Voir [Le moteur](./moteur.md).

### normale

Une flèche perpendiculaire à une surface, qui dit vers où elle « regarde ». En la comparant à la direction du soleil, on sait si un versant est clair ou sombre.
Voir [Le terrain](./3d/terrain.md) et [Le dessin à l'encre](./dessin.md).

### ombre portée

L'ombre qu'un objet jette sur un autre : une montagne sur la vallée d'à côté. Pour la calculer, l'ordinateur regarde la scène depuis le soleil et note ce que le soleil touche en premier.
Voir [Le dessin à l'encre](./dessin.md).

### panneau de réglages

Une petite fenêtre de curseurs qui règle le rendu en direct (exagération du relief, épaisseur du trait, couleur du papier...). Ses valeurs sont enregistrées dans un fichier et appliquées même panneau fermé.
Voir [Le moteur](./moteur.md) et [L'application autour de la carte](./interface.md).

### panneau face caméra

Une simple image plate (deux triangles) qui se tourne toujours vers l'œil, comme un décor de théâtre en carton. Les avions et les nuages sont dessinés ainsi.
Voir [Le ciel](./3d/ciel.md).

### parallaxe

L'effet qui fait que les objets proches semblent bouger plus vite que les lointains quand on se déplace. C'était aussi le nom d'une ancienne technique du projet : peindre l'illusion des bâtiments sur un sol resté plat.
Voir [Les bâtiments](./3d/batiments.md) et [La carte en 3D](./3d/README.md).

### passe

Un passage complet de dessin sur toute l'image. On en enchaîne plusieurs, chacune par-dessus ou à partir de la précédente : la scène, puis l'encre, puis l'interface.
Voir [Le dessin à l'encre](./dessin.md).

### passe d'encre

La dernière passe, qui reprend l'image de la scène et la redessine entièrement en traits d'encre sur papier.
Voir [Le dessin à l'encre](./dessin.md).

### perspective

Un objet deux fois plus loin paraît deux fois plus petit. C'est ce qui donne la sensation de profondeur sur un écran plat.
Voir [Les bases](./00-les-bases.md).

### pixel

Une case de l'écran, d'une seule couleur. Un écran Full HD en a 1920 × 1080 = 2 073 600. Une image n'est qu'un tableau de pixels.
Voir [Les bases](./00-les-bases.md).

### POC

*Proof of concept* : un prototype qui sert à prouver qu'une idée marche, pas un produit fini. On y prend souvent le chemin le plus court, quitte à refaire proprement plus tard.
Voir [La navigation](./navigation.md) et [Les lieux](./lieux.md).

### polygone

Une forme fermée faite de segments, comme un contour tracé au crayon : le contour d'une forêt, d'une commune, d'un bâtiment.
Voir [La végétation](./3d/vegetation.md) et [Les lieux](./lieux.md).

### polyligne

Une ligne brisée faite de segments droits mis bout à bout, comme le tracé d'une route.
Voir [Les véhicules](./3d/vehicules.md).

### post-traitement

Retravailler une image après l'avoir fabriquée, comme un filtre photo, mais en beaucoup plus malin. Le rendu à l'encre de la carte est un post-traitement.
Voir [Le dessin à l'encre](./dessin.md).

### processeur

La puce généraliste de l'ordinateur, voir [CPU](#cpu).

### profondeur

Pour chaque pixel, la distance entre la caméra et ce qu'il montre (ce bout de sol est-il à 40 m ou à 60 m ?). Le dessin s'en sert pour savoir où tracer les contours.
Voir [Le dessin à l'encre](./dessin.md).

### projection

Le calcul qui fait passer un point 3D sur l'écran plat : on trace une ligne de ce point jusqu'à l'œil et on regarde où elle traverse l'écran.
Voir [Les bases](./00-les-bases.md).

### rastérisation

L'étape où la carte graphique regarde, pour chaque triangle posé sur l'écran, quelles cases il recouvre. On ne l'écrit pas : la carte graphique le fait toute seule.
Voir [Les bases](./00-les-bases.md).

### rendu

L'action de fabriquer une image à partir de la scène. « Rendre la scène », c'est la dessiner.
Voir [Les bases](./00-les-bases.md).

### rendu hors écran

Dessiner dans une image cachée, gardée en mémoire et jamais affichée telle quelle, pour la retravailler ensuite. La passe d'encre lit une image de ce genre.
Voir [Le dessin à l'encre](./dessin.md).

### scène

L'ensemble des objets 3D que la caméra peut voir : le relief, les bâtiments, les arbres, les avions, les nuages.
Voir [Les bases](./00-les-bases.md) et [Le moteur](./moteur.md).

### segment

Un bout de ligne droite entre deux points. Une route est une suite de segments.
Voir [Les véhicules](./3d/vehicules.md).

### shader

Un petit programme qui tourne sur la carte graphique, une fois pour chaque point ou chaque pixel, tous en même temps. C'est lui qui soulève le relief et qui dessine l'encre.
Voir [Les bases](./00-les-bases.md).

### shader de pixel

Le shader qui tourne une fois par case de l'écran recouverte par un triangle et choisit sa couleur. C'est là que naissent les hachures et le papier.
Voir [Les bases](./00-les-bases.md).

### shader de sommet

Le shader qui tourne une fois par sommet et dit où il tombe sur l'écran. Il peut le déplacer en chemin, par exemple le soulever d'une altitude lue dans une texture.
Voir [Les bases](./00-les-bases.md) et [Le terrain](./3d/terrain.md).

### sommet

Un point d'une forme 3D, défini par trois nombres (gauche-droite, avant-arrière, haut-bas). Trois sommets reliés font un triangle. En anglais, *vertex*.
Voir [Les bases](./00-les-bases.md) et [Le terrain](./3d/terrain.md).

### sondage

Demander régulièrement « où en es-tu ? » plutôt qu'attendre d'être prévenu. L'interface interroge ainsi la carte toutes les 150 à 400 millièmes de seconde pour la jauge de chargement et les bandeaux.
Voir [L'application autour de la carte](./interface.md).

### test automatique

Un petit programme qui pose une question au code et vérifie la réponse (« un degré de latitude vaut-il bien 111,195 km ? »). On les lance tous d'un coup pour vérifier qu'on n'a rien cassé.
Voir [Le moteur](./moteur.md).

### texture

Une image envoyée à la carte graphique. On peut la coller sur une surface (un papier, une feuille d'arbre) ou la lire comme un tableau de nombres (une grille d'altitudes).
Voir [Les bases](./00-les-bases.md).

### three.js

Une bibliothèque, c'est-à-dire une boîte à outils de code déjà écrit qu'on réutilise, pour faire de la 3D dans un navigateur. Toute la carte est construite dessus.
Voir [Les bases](./00-les-bases.md).

### timeline

Une partition : pour chaque valeur animée, à quel moment elle vaut quoi. L'entrée sur la carte est une timeline de 3 secondes.
Voir [L'application autour de la carte](./interface.md).

### triangle

La brique de base de toute forme 3D. Trois points sont toujours à plat, comme un tabouret à trois pieds qui ne boite jamais : c'est pour ça qu'on découpe tout en triangles.
Voir [Les bases](./00-les-bases.md).

### triangulation

Découper une surface (une grille de points, le contour d'un toit) en triangles qui la recouvrent sans trou ni chevauchement.
Voir [Le terrain](./3d/terrain.md) et [Les bâtiments](./3d/batiments.md).

### TSL

Une façon d'écrire des shaders en JavaScript, proposée par three.js, qui les traduit ensuite dans la langue de la carte graphique.
Voir [Les bases](./00-les-bases.md).

### tuile

Un carré de carte de 256 × 256 pixels, découpé selon une grille fixe du monde. On ne télécharge que les tuiles qu'on regarde, comme on poserait seulement les carreaux visibles d'un carrelage.
Voir [Les bases](./00-les-bases.md) et [Les données](./3d/donnees.md).

### tuile vectorielle

Une tuile qui contient des formes décrites (« une route passe par ces 12 points ») au lieu de pixels. C'est une recette plutôt qu'une photo.
Voir [Les données](./3d/donnees.md).

### unité

La règle graduée de la scène 3D. Combien de mètres vaut une unité dépend du zoom : la zone de détail mesure toujours 100 unités de large.
Voir [Les bases](./00-les-bases.md) et [Le terrain](./3d/terrain.md).

### univers

Une scène complète : une collection d'éléments, une caméra et une manière de dessiner. Un projet peut en avoir plusieurs, comme des décors entre deux actes ; la carte n'en a qu'un.
Voir [Le moteur](./moteur.md).

### voie

Pour les véhicules, un morceau de route continu, entièrement contenu dans une tuile. Une route coupée par le bord d'une tuile donne deux voies.
Voir [Les véhicules](./3d/vehicules.md).

### WebGL2

L'ancienne façon de parler à la carte graphique depuis un navigateur, disponible presque partout. La carte s'en sert quand WebGPU n'est pas disponible.
Voir [Le moteur](./moteur.md).

### WebGPU

La façon récente de parler à la carte graphique depuis un navigateur, plus rapide et plus souple que WebGL2.
Voir [Les bases](./00-les-bases.md) et [Le moteur](./moteur.md).

### worker

Un aide qui travaille en parallèle, dans les coulisses du navigateur, sans toucher à l'écran : un second cuisinier dans l'arrière-cuisine. Il prépare le plan (bâtiments, arbres, routes) pendant que l'image continue de tourner.
Voir [Les données](./3d/donnees.md).
