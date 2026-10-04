# croquis-server (nom provisoire)

Serveur arbitre du **jeu de dessin** du portfolio de Mathys Langiny. Le client
vivra dans le dépôt du portfolio (`games/<jeu>/`, GitHub Pages). Ici, il n'y a
que l'arbitre : **le front est statique, le serveur est la seule autorité.**

## Le jeu

Un joueur dessine, il a choisi son mot parmi trois ; les autres devinent. Une
bonne réponse rapporte `50 + 50 × tempsRestant / durée` ; le dessinateur gagne
la moyenne de ce qu'il a fait gagner (0 pour qui n'a pas trouvé). Chacun dessine
autant de fois que les autres : 3 manches à 2–3 joueurs, 2 à 4–5, 1 à 6–16.
15 s de choix (tirage automatique sinon), 80 s de dessin (60 s au-delà de 8
joueurs), indices à 50 % et 75 % (le second pour 6 lettres ou plus), arrêt dès
que tous les présents ont trouvé (pause 1,5 s), révélation 6 s.

## Les fichiers

- `engine.js` — **le moteur pur** : phases, tours, mots, devinettes, scores,
  départs, classement. Horloge et hasard injectés, aucun réseau.
- `server.js` — l'orchestre : rooms, joueurs, minuterie unique posée sur
  `nextDeadline()`, traduction des événements du moteur en messages, et le
  **dessin** (du transport : validé, gardé pour `snapshot`, relayé).
- `mots.js` — relaie le **catalogue V1** (`catalogue/mots-v1.js`, 318 mots :
  102 faciles, 107 moyens, 109 difficiles, avec alias), sans le recopier.
  Validation : `node tools/valider-catalogue.mjs` (écrit
  `catalogue/RAPPORT.md`) ; tirage sur le vrai catalogue : `node
  test-catalogue.js`. La fixture de 24 mots (`test-fixtures/mini-dico.js`)
  ne sert plus qu'aux tests du moteur.
- `avatar.js`, `presence.js` — copiés tels quels des autres serveurs.

## Lancer en local

    npm install
    npm start          # écoute sur $PORT, 8095 par défaut ; GET / → « croquis-server ok »
    npm test

## Le protocole

Un seul WebSocket, du JSON. Client → serveur : `{ action, … }` ; serveur →
client : `{ type, … }` (comme les autres serveurs du portfolio). Les
`presence` sont ceux de `presence.js`.

| Client → serveur | |
|---|---|
| `join { name, avatar, code? }` | sans code : crée une room (on en est l'hôte) |
| `start` | hôte, au salon ou à la fin (revanche) ; aucun réglage en V1 |
| `lobby` | hôte, à la fin : retour au salon |
| `choose { turnId, index }` | dessinateur, phase de choix |
| `stroke { turnId, s, c, w, p, end? }` | dessinateur ; `p` = `[x, y, x, y…]` entiers dans 1000 × 750 ; `c` 0–11 palette, 12 gomme ; `w` 0–2 ; un nouveau `s` ouvre un trait (`c`, `w` requis), le même `s` le prolonge, `end: true` le clôt |
| `undo { turnId }`, `clear { turnId }` | dessinateur |
| `guess { turnId, text }` | devineur ; 40 caractères |
| `snapshot` | l'état complet, pour soi |
| `resume { code, token }` | **refusé en V1** (pas de reprise en pleine partie) |

| Serveur → client | à qui |
|---|---|
| `you { id, code, host }` | soi |
| `lobby { code, phase, max, players }` | tous |
| `snapshot { … }` | soi : au lancement (sans rien de privé), sur demande, ou à un client lent rattrapé |
| `turn { turnId, round, rounds, drawer, remainingMs, players }` | tous |
| `choices { turnId, words: [{ word, level }], remainingMs }` | **le dessinateur seul** |
| `drawing { turnId, drawer, auto, pattern, letters, remainingMs, word? }` | tous ; `word` **au dessinateur seul** |
| `stroke`, `undo { s }`, `clear` | tous **sauf le dessinateur** |
| `hint { turnId, pattern }` | tous |
| `chat { turnId, id, text, scope }` | `all` : une mauvaise réponse, à tous ; `found` : un trouveur qui écrit, aux trouveurs et au dessinateur |
| `close { turnId }` | l'auteur seul (« presque ») |
| `refused { action, turnId, reason, message }` | l'auteur seul |
| `found { turnId, id, order }` | tous — jamais le texte ni les points |
| `stop { turnId, reason }` | tous : `all-found`, `time`, `drawer-left`, `abandon` |
| `turn-end { turnId, word, reason, gains, scores, remainingMs }` | tous : le mot est révélé ici |
| `skipped { turnId, drawer }` | tous : le dessinateur est parti pendant le choix |
| `left { id, host, players }` | tous |
| `results { complete, host, ranking }` | tous ; `complete: false` = partie incomplète (le Hub n'en recevra aucun classement) |
| `error { message }` | soi |

Aucun message ne porte d'horodatage ni d'échéance absolue : seulement
`remainingMs`. Le mot ne sort qu'au dessinateur jusqu'au `turn-end`. `test.js`
et `test-16.js` relisent tout le fil de chaque client pour le vérifier.

Pour un test : `TEST_CHOOSE_MS`, `TEST_DRAW_MS`, `TEST_PAUSE_MS`,
`TEST_REVEAL_MS` raccourcissent les phases (jamais en production).
