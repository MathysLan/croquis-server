// Mini-dictionnaire de TEST (pas le catalogue du jeu). Il couvre ce que le
// moteur doit savoir manipuler : trois niveaux, des accents, un œ, un tiret,
// une apostrophe, une expression de trois mots, des alias, et des longueurs
// choisies pour les indices (4, 5, 6 lettres et plus).
'use strict';
const MOTS = [
  // facile
  { mot: 'chat', niveau: 'facile' },                 // 4 lettres : un seul indice
  { mot: 'pomme', niveau: 'facile' },
  { mot: 'maison', niveau: 'facile' },
  { mot: 'soleil', niveau: 'facile' },
  { mot: 'arbre', niveau: 'facile' },
  { mot: 'poisson', niveau: 'facile' },
  { mot: 'voiture', niveau: 'facile', alias: ['auto'] },
  { mot: 'œuf', niveau: 'facile' },
  { mot: 'chapeau', niveau: 'facile' },
  { mot: 'bateau', niveau: 'facile' },
  // moyen
  { mot: 'château', niveau: 'moyen' },
  { mot: 'éléphant', niveau: 'moyen' },
  { mot: 'parapluie', niveau: 'moyen' },
  { mot: 'micro-ondes', niveau: 'moyen' },
  { mot: 'réfrigérateur', niveau: 'moyen', alias: ['frigo', 'frigidaire'] },
  { mot: 'pomme de terre', niveau: 'moyen', alias: ['patate'] },
  { mot: 'escargot', niveau: 'moyen' },
  { mot: 'bougie', niveau: 'moyen' },                // 6 lettres : deux indices
  // difficile
  { mot: 'tire-bouchon', niveau: 'difficile' },
  { mot: 'phare', niveau: 'difficile' },             // 5 lettres : un seul indice
  { mot: 'sous-marin', niveau: 'difficile' },
  { mot: 'épouvantail', niveau: 'difficile' },
  { mot: 'boussole', niveau: 'difficile' },
  { mot: "tir à l'arc", niveau: 'difficile' },
];
module.exports = { MOTS };
