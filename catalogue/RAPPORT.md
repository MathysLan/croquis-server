# Croquis — rapport du catalogue

Fichier : `catalogue/mots-v1.js` · généré par `node tools/valider-catalogue.mjs`. **Proposition, pas encore branchée** (le serveur joue sur `mots.js`).

- Entrées : **318** — facile **102**, moyen **107**, difficile **109**
- Alias : **12** sur 12 entrées
- Taille du fichier : 5.8 Ko
- Erreurs : **0** · avertissements à relire : **19**

## Couverture (parties simulées par le moteur, 30 graines par taille)

| joueurs | manches | tours | mots proposés / partie | par niveau | répétitions | trios bancals |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 3 | 6 | 18 | 6 | 0 | 0 |
| 3 | 3 | 9 | 27 | 9 | 0 | 0 |
| 4 | 2 | 8 | 24 | 8 | 0 | 0 |
| 5 | 2 | 10 | 30 | 10 | 0 | 0 |
| 6 | 1 | 6 | 18 | 6 | 0 | 0 |
| 7 | 1 | 7 | 21 | 7 | 0 | 0 |
| 8 | 1 | 8 | 24 | 8 | 0 | 0 |
| 9 | 1 | 9 | 27 | 9 | 0 | 0 |
| 10 | 1 | 10 | 30 | 10 | 0 | 0 |
| 11 | 1 | 11 | 33 | 11 | 0 | 0 |
| 12 | 1 | 12 | 36 | 12 | 0 | 0 |
| 13 | 1 | 13 | 39 | 13 | 0 | 0 |
| 14 | 1 | 14 | 42 | 14 | 0 | 0 |
| 15 | 1 | 15 | 45 | 15 | 0 | 0 |
| 16 | 1 | 16 | 48 | 16 | 0 | 0 |

La partie la plus gourmande demande **16** mots par niveau (48 propositions). Le plus petit niveau en a **102** : 6.4 parties de cette taille avant qu'un mot ne DOIVE revenir. Le moteur n'empêche les répétitions qu'à l'intérieur d'une partie : d'une partie à l'autre, un mot donné a ~16 % de chances d'être reproposé (16 joueurs), ~9 % à 3 joueurs.

## À relire (avertissements, non bloquants)

### À une lettre près (5) — la devinette de l'un vaut « presque ! » pour l'autre

- « oiseau » / « ciseaux » (oiseau / ciseau) — facile / moyen : peuvent se retrouver dans le même trio
- « lapin » / « sapin » (lapin / sapin) — même niveau (facile) : jamais dans le même trio
- « gâteau » / « bateau » (gateau / bateau) — même niveau (facile) : jamais dans le même trio
- « chapeau » / « château » (chapeau / chateau) — facile / moyen : peuvent se retrouver dans le même trio
- « bouche » / « douche » (bouche / douche) — facile / moyen : peuvent se retrouver dans le même trio

### Un mot dans un autre, sans être un mot entier (14) — pas une fuite pour le moteur

- « chat » est dans « château »
- « cheval » est dans « chevalier »
- « poule » est dans « ampoule »
- « lune » est dans « lunettes »
- « île » est dans « étoile »
- « île » est dans « crocodile »
- « feuille » est dans « portefeuille »
- « voiture » est dans « bus »
- « porte » est dans « portefeuille »
- « clé » est dans « vélo »
- « dent » est dans « dentifrice »
- « dent » est dans « dentiste »
- « pirate » est dans « aspirateur »
- « four » est dans « fourchette »

## Le catalogue complet

### Facile (102)

chat · chien · poisson · oiseau · cheval · vache · cochon · mouton · lapin · souris · canard · poule · serpent · tortue · papillon · abeille · araignée · éléphant · girafe · lion · singe · ours · grenouille · baleine · requin · pomme · banane · poire · cerise · fraise · citron · carotte · tomate · gâteau · pain · fromage · œuf · sucette · pizza · bonbon · maison · arbre · fleur · soleil · lune · étoile · nuage · arc-en-ciel · montagne · île · sapin · champignon · feuille · voiture *(auto)* · vélo *(bicyclette)* · bateau · avion · train · bus *(autobus)* · fusée · camion · ballon · livre · crayon · chaise · table · lit · porte · fenêtre · clé *(clef)* · lunettes · chapeau · chaussure · chaussette · robe · tasse · verre · fourchette · cuillère *(cuiller)* · couteau · assiette · bouteille · horloge · téléphone · parapluie · cadeau · bougie · échelle · marteau · guitare · tambour · cloche · couronne · drapeau · cœur · main · pied · œil · nez · bouche · oreille · dent

### Moyen (107)

château · phare · igloo · moulin · volcan · cactus · palmier · bonhomme de neige · cabane · tente · feu de camp · nid · ruche · fantôme · sorcière · dragon · robot · pirate · cow-boy · astronaute · pompier · policier · cuisinier · clown · roi · princesse · chevalier · squelette · vampire · extraterrestre *(martien)* · hélicoptère · tracteur · ambulance · trottinette · planche à roulettes *(skate)* · lampe · réveil · sablier · balance · ciseaux · agrafeuse · tournevis · scie · pelle · arrosoir · brouette · cadenas · tirelire · valise · sac à dos · portefeuille · coffre au trésor · puzzle · échiquier · trophée · médaille · panier · raquette · bague · collier · cravate · écharpe · gant · botte · casquette · pyjama · baignoire · douche · lavabo · dentifrice · savon · réfrigérateur *(frigo)* · four · micro-ondes · aspirateur · machine à laver · canapé · cheminée · escalier · toboggan · balançoire · manège · cerf-volant · hamac · escargot · pingouin · kangourou · crocodile · hibou *(chouette)* · dauphin · pieuvre · méduse · crabe · homard · zèbre · renard · écureuil · hérisson · coccinelle · moustique · paon · flamant rose *(flamant)* · nager · dormir · danser · courir · pleurer

### Difficile (109)

tire-bouchon · ouvre-boîte · presse-agrumes · fer à repasser · sèche-cheveux · pince à linge · boîte aux lettres · télécommande · calculatrice · imprimante · clavier · manette · écouteurs · microphone · haut-parleur · appareil photo · caméra · projecteur · radiateur · ventilateur · thermomètre · stéthoscope · seringue · pansement · béquille · fauteuil roulant · ancre · loupe · télescope · microscope · aimant · ampoule · boussole · longue-vue · mappemonde *(globe)* · bouée · gouvernail · lampadaire · feu tricolore *(feu rouge)* · passage piéton · rond-point · station-service · gratte-ciel · éolienne · barrage · téléphérique · fontaine · statue · aquarium · sous-marin · montgolfière · parachute · tremplin · trampoline · catapulte · armure · bouclier · arbalète · boomerang · pyramide · momie · totem · mammouth · dinosaure · licorne · centaure · cyclope · épouvantail · hippopotame · acrobate · funambule · plongeur · alpiniste · bûcheron · apiculteur · chef d'orchestre · photographe · dentiste · mécanicien · jardinier · boulanger · facteur · peintre · sculpteur · magicien · détective · ninja · viking · cage · cible · fléchettes · labyrinthe · cerveau · éclipse · comète · météorite · tornade · iceberg · geyser · grotte · oasis · éternuer · jongler · bâiller · ronfler · applaudir · patiner · tricoter · escalader

## Alias

- voiture → auto (facile)
- vélo → bicyclette (facile)
- bus → autobus (facile)
- clé → clef (facile)
- cuillère → cuiller (facile)
- extraterrestre → martien (moyen)
- planche à roulettes → skate (moyen)
- réfrigérateur → frigo (moyen)
- hibou → chouette (moyen)
- flamant rose → flamant (moyen)
- mappemonde → globe (difficile)
- feu tricolore → feu rouge (difficile)
