// ⚠️ PROVISOIRE. Le serveur a besoin de mots pour tourner en local ; le vrai
// catalogue (~300 mots, 100 par niveau, soumis à Mathys avant publication) le
// remplacera ici. En attendant, ce sont les 24 mots de la fixture de test —
// rien de plus, pour ne rien publier qui n'ait été relu.
//
// Une entrée : { mot, niveau: 'facile' | 'moyen' | 'difficile', alias?: [...] }.
// createGame() refuse un dictionnaire mal formé (niveau inconnu, clé en double…).
'use strict';
module.exports = require('./test-fixtures/mini-dico.js').MOTS;
