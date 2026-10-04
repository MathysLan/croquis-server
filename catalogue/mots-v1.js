// Croquis — CATALOGUE V1, relu et validé par Mathys. C'est le dictionnaire
// du serveur : mots.js le relaie tel quel (aucune copie ailleurs).
//
// Écrit à la main, sans tirage : inspectable et versionnable. Une entrée :
//   { mot, niveau: 'facile' | 'moyen' | 'difficile', alias?: [...] }
// Le niveau ne sert qu'à composer un trio équilibré (1 facile, 1 moyen,
// 1 difficile) ; il ne change pas le score.
//
// Règles (lot 0) : noms communs concrets et dessinables, quelques actions
// faciles à mimer, expressions de 3 mots au plus, 3 à 20 lettres une fois
// normalisés, alias seulement quand ils servent vraiment. Exclus : noms
// propres, marques, personnes réelles, abstractions, contenu sexuel ou
// offensant, sens trop ambigus, mots trop proches entre eux.
//
// Validation : node tools/valider-catalogue.mjs (écrit catalogue/RAPPORT.md).
'use strict';

const FACILE = [
  // animaux
  'chat', 'chien', 'poisson', 'oiseau', 'cheval', 'vache', 'cochon', 'mouton',
  'lapin', 'souris', 'canard', 'poule', 'serpent', 'tortue', 'papillon', 'abeille',
  'araignée', 'éléphant', 'girafe', 'lion', 'singe', 'ours', 'grenouille', 'baleine',
  'requin',
  // à manger
  'pomme', 'banane', 'poire', 'cerise', 'fraise', 'citron', 'carotte', 'tomate',
  'gâteau', 'pain', 'fromage', 'œuf', 'sucette', 'pizza', 'bonbon',
  // dehors
  'maison', 'arbre', 'fleur', 'soleil', 'lune', 'étoile', 'nuage', 'arc-en-ciel',
  'montagne', 'île', 'sapin', 'champignon', 'feuille',
  // se déplacer
  { mot: 'voiture', alias: ['auto'] },
  { mot: 'vélo', alias: ['bicyclette'] },
  'bateau', 'avion', 'train',
  { mot: 'bus', alias: ['autobus'] },
  'fusée', 'camion',
  // objets
  'ballon', 'livre', 'crayon', 'chaise', 'table', 'lit', 'porte', 'fenêtre',
  { mot: 'clé', alias: ['clef'] },
  'lunettes', 'chapeau', 'chaussure', 'chaussette', 'robe', 'tasse', 'verre',
  'fourchette',
  { mot: 'cuillère', alias: ['cuiller'] },
  'couteau', 'assiette', 'bouteille', 'horloge', 'téléphone', 'parapluie', 'cadeau',
  'bougie', 'échelle', 'marteau', 'guitare', 'tambour', 'cloche', 'couronne', 'drapeau',
  // le corps
  'cœur', 'main', 'pied', 'œil', 'nez', 'bouche', 'oreille', 'dent',
];

const MOYEN = [
  // lieux et décors
  'château', 'phare', 'igloo', 'moulin', 'volcan', 'cactus', 'palmier',
  'bonhomme de neige', 'cabane', 'tente', 'feu de camp', 'nid', 'ruche',
  // personnages
  'fantôme', 'sorcière', 'dragon', 'robot', 'pirate', 'cow-boy', 'astronaute',
  'pompier', 'policier', 'cuisinier', 'clown', 'roi', 'princesse', 'chevalier',
  'squelette', 'vampire',
  { mot: 'extraterrestre', alias: ['martien'] },
  // véhicules
  'hélicoptère', 'tracteur', 'ambulance', 'trottinette',
  { mot: 'planche à roulettes', alias: ['skate'] },
  // objets
  'lampe', 'réveil', 'sablier', 'balance', 'ciseaux', 'agrafeuse', 'tournevis',
  'scie', 'pelle', 'arrosoir', 'brouette', 'cadenas', 'tirelire',
  'valise',
  'sac à dos',
  'portefeuille', 'coffre au trésor', 'puzzle', 'échiquier',
  'trophée', 'médaille', 'panier', 'raquette',
  // vêtements
  'bague', 'collier', 'cravate', 'écharpe', 'gant', 'botte', 'casquette', 'pyjama',
  // la maison
  'baignoire', 'douche', 'lavabo', 'dentifrice', 'savon',
  { mot: 'réfrigérateur', alias: ['frigo'] },
  'four', 'micro-ondes', 'aspirateur', 'machine à laver', 'canapé', 'cheminée',
  'escalier',
  // jeux
  'toboggan', 'balançoire', 'manège', 'cerf-volant', 'hamac',
  // animaux
  'escargot', 'pingouin', 'kangourou', 'crocodile',
  { mot: 'hibou', alias: ['chouette'] },
  'dauphin',
  'pieuvre',
  'méduse', 'crabe', 'homard', 'zèbre', 'renard', 'écureuil', 'hérisson',
  'coccinelle', 'moustique', 'paon',
  { mot: 'flamant rose', alias: ['flamant'] },
  // actions
  'nager', 'dormir', 'danser', 'courir', 'pleurer',
];

const DIFFICILE = [
  // objets composés
  'tire-bouchon', 'ouvre-boîte', 'presse-agrumes', 'fer à repasser', 'sèche-cheveux',
  'pince à linge', 'boîte aux lettres', 'télécommande', 'calculatrice', 'imprimante',
  'clavier', 'manette', 'écouteurs', 'microphone', 'haut-parleur', 'appareil photo',
  'caméra', 'projecteur', 'radiateur', 'ventilateur', 'thermomètre', 'stéthoscope',
  'seringue', 'pansement', 'béquille', 'fauteuil roulant', 'ancre', 'loupe',
  'télescope', 'microscope', 'aimant', 'ampoule', 'boussole', 'longue-vue',
  { mot: 'mappemonde', alias: ['globe'] },
  'bouée', 'gouvernail',
  // la ville
  'lampadaire',
  { mot: 'feu tricolore', alias: ['feu rouge'] },
  'passage piéton', 'rond-point', 'station-service', 'gratte-ciel', 'éolienne',
  'barrage', 'téléphérique', 'fontaine', 'statue', 'aquarium',
  // véhicules et engins
  'sous-marin',
  'montgolfière', 'parachute', 'tremplin', 'trampoline',
  // armes et légendes
  'catapulte', 'armure', 'bouclier', 'arbalète', 'boomerang', 'pyramide', 'momie',
  'totem', 'mammouth', 'dinosaure', 'licorne', 'centaure', 'cyclope', 'épouvantail',
  'hippopotame',
  // métiers
  'acrobate', 'funambule', 'plongeur', 'alpiniste', 'bûcheron', 'apiculteur',
  "chef d'orchestre", 'photographe', 'dentiste', 'mécanicien', 'jardinier',
  'boulanger', 'facteur', 'peintre', 'sculpteur', 'magicien', 'détective', 'ninja',
  'viking',
  // jeux et décors
  'cage', 'cible', 'fléchettes', 'labyrinthe',
  // le ciel et la terre
  'cerveau', 'éclipse', 'comète', 'météorite', 'tornade', 'iceberg', 'geyser',
  'grotte', 'oasis',
  // actions
  'éternuer', 'jongler', 'bâiller', 'ronfler', 'applaudir', 'patiner', 'tricoter',
  'escalader',
];

const entree = (niveau) => (x) => (typeof x === 'string' ? { mot: x, niveau } : { mot: x.mot, niveau, alias: x.alias });

module.exports = [
  ...FACILE.map(entree('facile')),
  ...MOYEN.map(entree('moyen')),
  ...DIFFICILE.map(entree('difficile')),
];
