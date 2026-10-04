// Le dictionnaire du serveur : le catalogue V1 validé (catalogue/mots-v1.js,
// 318 mots, trois niveaux, alias). Ce fichier ne fait que le désigner : le
// catalogue n'existe qu'à un seul endroit. La fixture de 24 mots
// (test-fixtures/mini-dico.js) ne sert plus qu'aux tests du moteur.
//
// Une entrée : { mot, niveau: 'facile' | 'moyen' | 'difficile', alias?: [...] }.
// createGame() refuse un dictionnaire mal formé (niveau inconnu, clé en double…).
// Contrôle : node tools/valider-catalogue.mjs ; node test-catalogue.js.
'use strict';
module.exports = require('./catalogue/mots-v1.js');
