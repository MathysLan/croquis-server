// Le catalogue V1 dans le runtime : le serveur tire bien ses mots de
// catalogue/mots-v1.js (plus de la fixture de 24 mots), et le tirage tient
// ses promesses sur le vrai catalogue.
//
//   node test-catalogue.js
//
// [A] la source : mots.js EST le catalogue (même objet, rien de recopié),
//     318 mots, trois niveaux, alias et clés normalisées intacts dans le moteur ;
// [B] le serveur réel : une partie lancée par WebSocket joue sur ces 318 mots ;
// [C] parties complètes au moteur, 2, 8 et 16 joueurs, 20 graines chacune
//     (≈ 1 800 propositions) : 3 mots par tour, un par niveau, aucune
//     proposition répétée, aucun mot joué reproposé, aucun doublon caché par
//     un alias (clés normalisées disjointes) ;
// [D] le mécanisme poussé à bout : une partie à 2 joueurs étirée à 120 tours
//     propose les 318 mots une fois chacun, trio équilibré tant que les trois
//     niveaux ont un mot neuf, puis ne repropose jamais un mot joué.
process.env.PORT = process.env.PORT || '8794';
process.env.TEST_CHOOSE_MS = '2000';
process.env.PRESENCE_QUIET = '1';
const { rooms } = require('./server.js');
const O = require('./test-outils.js');
const E = require('./engine.js');
const MOTS = require('./mots.js');
const CATALOGUE = require('./catalogue/mots-v1.js');
const MINI = require('./test-fixtures/mini-dico.js').MOTS;

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const TRIO = 'facile,moyen,difficile';

// Hasard à graine (mulberry32), comme test-engine.mjs.
const graine = (s) => () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let x = Math.imul(s ^ (s >>> 15), 1 | s);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const partie = (n, s) => E.createGame({ players: Array.from({ length: n }, (_, i) => 'p' + i), now: 0, random: graine(s), words: MOTS });

// Joue une partie jusqu'au bout (ou `maxTours`) : un dessinateur sur deux
// choisit lui-même (index tiré), les autres laissent le tirage automatique.
// Rend la liste des tours : { choices: [mot préparé…], word }.
function jouer(g, maxTours = Infinity) {
  const r = graine(7);
  const tours = [];
  for (let k = 0; k < 100000 && g.phase !== 'end'; k++) {
    if (g.phase === 'choosing' && (!tours.length || tours[tours.length - 1].id !== g.turnId)) {
      if (tours.length >= maxTours) break;
      tours.push({ id: g.turnId, choices: g.turn.choices.slice(), word: null });
      if (g.turnId % 2) {
        const res = E.choose(g, g.turn.drawer, g.turnId, Math.floor(r() * 3), E.nextDeadline(g) - 1);
        if (!res.ok) throw new Error('choix refusé : ' + res.reason);
      }
    }
    const cur = tours[tours.length - 1];
    if (cur && g.turn && cur.id === g.turnId && g.turn.word) cur.word = g.turn.word;
    E.tick(g, E.nextDeadline(g));
  }
  return tours;
}

// Les écarts d'une partie : trios incomplets, propositions répétées, mot joué
// reproposé, clé normalisée (mot ou alias) partagée par deux propositions.
function ecarts(tours) {
  const e = { taille: 0, niveaux: 0, repetes: 0, rejoues: 0, cles: 0, proposes: 0 };
  const vus = new Set(), joues = new Set(), cles = new Map();
  for (const tr of tours) {
    if (tr.choices.length !== 3 || new Set(tr.choices).size !== 3) e.taille++;
    if (tr.choices.map((w) => w.niveau).join() !== TRIO) e.niveaux++;
    for (const w of tr.choices) {
      e.proposes++;
      if (vus.has(w.mot)) e.repetes++;
      if (joues.has(w.mot)) e.rejoues++;
      vus.add(w.mot);
      for (const k of w.cles) {
        if (cles.has(k) && cles.get(k) !== w.mot) e.cles++;
        cles.set(k, w.mot);
      }
    }
    if (tr.word) joues.add(tr.word.mot);
  }
  return e;
}

(async () => {
  // ---------------------------------------------------------------- [A] source
  t('[A] mots.js est le catalogue V1 lui-même (même objet, aucune copie)', MOTS === CATALOGUE);
  t('[A] mots.js n est plus la fixture de 24 mots', MOTS !== MINI && MOTS.length !== MINI.length
    && !MINI.every((m) => MOTS.some((w) => w.mot === m.mot && w.niveau === m.niveau)));
  const par = (niv) => MOTS.filter((w) => w.niveau === niv).length;
  t(`[A] 318 mots : ${par('facile')} faciles, ${par('moyen')} moyens, ${par('difficile')} difficiles`,
    MOTS.length === 318 && par('facile') === 102 && par('moyen') === 107 && par('difficile') === 109);
  const g0 = partie(2, 1);
  t('[A] le moteur accepte les 318 mots, dans l ordre', g0.words.length === 318 && g0.words.every((w, i) => w.mot === MOTS[i].mot.normalize('NFC')));
  t('[A] niveaux conservés mot à mot', g0.words.every((w, i) => w.niveau === MOTS[i].niveau));
  const avecAlias = MOTS.filter((w) => w.alias && w.alias.length);
  t(`[A] alias conservés (${avecAlias.length} mots en ont)`, avecAlias.length > 0
    && g0.words.every((w, i) => JSON.stringify(w.alias) === JSON.stringify(MOTS[i].alias || [])));
  const attendues = (e) => new Set([e.mot, ...(e.alias || [])].flatMap((f) => [E.normaliser(f), E.cleCollee(f)]).filter(Boolean));
  t('[A] clés acceptées = normalisation existante (mot, alias, forme collée)', g0.words.every((w, i) => {
    const a = attendues(MOTS[i]);
    return a.size === w.cles.size && [...a].every((k) => w.cles.has(k));
  }));
  const toutesCles = g0.words.flatMap((w) => [...w.cles]);
  t(`[A] aucune clé partagée par deux mots (${toutesCles.length} clés)`, new Set(toutesCles).size === toutesCles.length);
  // Une devinette par alias et par forme collée, sur le vrai catalogue.
  const devine = (mot, texte) => {
    const g = partie(2, 3);
    g.turn.choices[0] = g.words.find((w) => w.mot === mot);
    E.choose(g, g.turn.drawer, g.turnId, 0, 1);
    const autre = g.order.find((id) => id !== g.turn.drawer);
    return E.guess(g, autre, g.turnId, texte, 2).correct === true;
  };
  t('[A] alias accepté en devinette : « auto » pour voiture, « clef » pour clé', devine('voiture', 'auto') && devine('clé', 'clef'));
  t('[A] forme collée acceptée : « bonhommedeneige », « Feu-de-camp »', devine('bonhomme de neige', 'bonhommedeneige') && devine('feu de camp', 'Feu-de-camp'));

  // ---------------------------------------------------------- [B] serveur réel
  const A = O.client(URL, 'A'), B = O.client(URL, 'B');
  const you = await O.joindre(A, 'A');
  await O.joindre(B, 'B', you.code);
  await A.wait((m) => m.type === 'lobby' && m.players.length === 2, 3000, 0);
  A.send({ action: 'start' });
  const tr = await A.wait((m) => m.type === 'turn', 3000, 0);
  const D = tr && (tr.drawer === A.id ? A : B);
  const ch = D && await D.wait((m) => m.type === 'choices', 3000, 0);
  const gs = rooms.get(you.code).game;
  t('[B] la partie du serveur joue sur 318 mots', gs.words.length === 318);
  t('[B] … ceux du catalogue, dans l ordre', gs.words.every((w, i) => w.mot === CATALOGUE[i].mot.normalize('NFC') && w.niveau === CATALOGUE[i].niveau));
  t('[B] aucun mot de la fixture qui n est pas au catalogue', gs.words.every((w) => CATALOGUE.some((c) => c.mot.normalize('NFC') === w.mot)));
  t('[B] choices : 3 mots du catalogue, facile → moyen → difficile', !!ch && ch.words.length === 3
    && ch.words.map((w) => w.level).join() === TRIO
    && ch.words.every((w) => CATALOGUE.some((c) => c.mot.normalize('NFC') === w.word && c.niveau === w.level)), ch && JSON.stringify(ch.words));
  [A, B].forEach((c) => c.ws.terminate());

  // ------------------------------------------------- [C] parties complètes
  let total = 0;
  for (const n of [2, 8, 16]) {
    const somme = { tours: 0, taille: 0, niveaux: 0, repetes: 0, rejoues: 0, cles: 0, proposes: 0, finies: 0, choisis: 0 };
    for (let s = 1; s <= 20; s++) {
      const g = partie(n, 100 * n + s);
      const tours = jouer(g);
      const e = ecarts(tours);
      somme.tours += tours.length;
      somme.finies += g.phase === 'end' ? 1 : 0;
      somme.choisis += tours.filter((x) => x.word).length;
      for (const k of Object.keys(e)) somme[k] += e[k];
    }
    total += somme.proposes;
    const attendu = 20 * n * E.roundsFor(n);
    t(`[C] ${n} joueurs : 20 parties jusqu'au bout, ${somme.tours} tours (${attendu} attendus), un mot joué par tour`,
      somme.finies === 20 && somme.tours === attendu && somme.choisis === attendu);
    t(`[C] ${n} joueurs : chaque tour reçoit 3 propositions distinctes`, somme.taille === 0);
    t(`[C] ${n} joueurs : chaque trio = 1 facile, 1 moyen, 1 difficile`, somme.niveaux === 0, `${somme.niveaux} trios bancals`);
    t(`[C] ${n} joueurs : ${somme.proposes} propositions, aucune répétée dans sa partie`, somme.repetes === 0, `${somme.repetes} répétitions`);
    t(`[C] ${n} joueurs : aucun mot joué ne revient en proposition`, somme.rejoues === 0, `${somme.rejoues}`);
    t(`[C] ${n} joueurs : aucun doublon caché par un alias (clés disjointes)`, somme.cles === 0, `${somme.cles}`);
  }
  t(`[C] plusieurs centaines de propositions contrôlées (${total})`, total >= 1000);

  // ------------------------------------------------ [D] épuisement du catalogue
  // Le nombre de manches est forcé à 60 (120 tours) : au-delà de ce qu'une
  // vraie partie demande (48 propositions à 16 joueurs), pour voir le
  // catalogue entier passer et la règle de repli s'appliquer.
  const g = partie(2, 42);
  g.rounds = 60;
  const tours = jouer(g, 120);
  const neufs = tours.slice(0, 106);
  const eN = ecarts(neufs);
  const proposes = neufs.flatMap((x) => x.choices.map((w) => w.mot));
  t(`[D] 120 tours joués (${tours.length})`, tours.length === 120);
  t('[D] 106 premiers tours : les 318 mots proposés, une fois chacun', proposes.length === 318 && new Set(proposes).size === 318 && eN.repetes === 0);
  // Un trio équilibré est dû tant que chaque niveau garde un mot jamais proposé.
  const reste = { facile: 102, moyen: 107, difficile: 109 };
  let dus = 0, tenus = 0, horsTrio = 0;
  for (const x of neufs) {
    if (Object.values(reste).every((v) => v > 0)) { dus++; if (x.choices.map((w) => w.niveau).join() === TRIO) tenus++; }
    else horsTrio++;
    for (const w of x.choices) reste[w.niveau]--;
  }
  t(`[D] trio 1 facile / 1 moyen / 1 difficile à chaque tour où il est possible (${tenus}/${dus}, les ${horsTrio} derniers sans facile neuf)`,
    dus === 102 && tenus === dus && horsTrio === 4);
  t('[D] … et sans doublon caché par un alias', eN.cles === 0);
  const e = ecarts(tours);
  t('[D] après épuisement : toujours 3 propositions distinctes', e.taille === 0);
  t('[D] après épuisement : aucun mot déjà joué ne revient (repli sur les mots jamais joués)', e.rejoues === 0, `${e.rejoues}`);

  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
