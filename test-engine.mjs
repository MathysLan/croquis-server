// Tests du moteur pur. Aucune dépendance, aucun réseau, aucune minuterie :
//     node test-engine.mjs
//
// L'horloge est un nombre qu'on avance à la main, le hasard une suite à
// graine : chaque test dit EXACTEMENT ce qui doit se passer, à la milliseconde
// près. Les tests en négatif comptent autant que les autres : un mot qui fuit
// dans view(), une devinette acceptée après l'échéance, un rang en double —
// rien de tout ça ne se voit à l'écran.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.js');
const { MOTS } = require('./test-fixtures/mini-dico.js');

let ok = 0, ko = 0;
const t = (name, cond) => {
  if (cond) { ok++; console.log('OK   ' + name); }
  else { ko++; console.log('KO   ' + name); }
};
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return !re || re.test(e.message); } };

// Hasard à graine (mulberry32).
const graine = (s) => () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let x = Math.imul(s ^ (s >>> 15), 1 | s);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

const T0 = 1_000_000;
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
const partie = (n = 3, o = {}) => E.createGame({ players: ids(n), now: T0, random: graine(1), words: MOTS, ...o });
// Le dessinateur choisit `mot` (posé en première proposition) à l'instant `now`.
const dessiner = (g, mot, now) => {
  if (mot) g.turn.choices[0] = g.words.find((w) => w.mot === mot);
  const r = E.choose(g, g.turn.drawer, g.turnId, 0, now);
  if (!r.ok) throw new Error('choix refusé : ' + r.reason);
  return now;
};
const devineurs = (g) => g.order.filter((id) => id !== g.turn.drawer && !g.players.get(id).left);
const score = (g, id) => g.players.get(id).score;
// Joue toute la partie au chrono (personne ne devine) ; rend les événements.
const jusquAuBout = (g) => {
  const ev = [];
  for (let i = 0; i < 1000 && g.phase !== 'end'; i++) E.tick(g, E.nextDeadline(g), ev);
  return ev;
};
// Tous les nombres d'un objet (pour traquer une horloge qui fuit).
const nombres = (o, acc = []) => {
  if (typeof o === 'number') acc.push(o);
  else if (o && typeof o === 'object') Object.values(o).forEach((v) => nombres(v, acc));
  return acc;
};

// ============================================================ normalisation
const N = E.normaliser;
t('normalisation : casse', N('CHAT') === 'chat' && N('Chat') === 'chat');
t('normalisation : accents', N('Éléphant') === 'elephant' && N('château') === N('chateau'));
t('normalisation : œ et æ dépliés', N('œuf') === 'oeuf' && N('ŒUF') === 'oeuf' && N('ex æquo') === 'exaequo');
t('normalisation : espaces et tirets ignorés', N('micro-ondes') === N('micro ondes') && N('micro-ondes') === N('microondes'));
t('normalisation : apostrophes droites, typographiques, ou aucune', N("tir à l'arc") === N('tir a l’arc') && N("tir à l'arc") === N('tir a l arc'));
t('normalisation : ponctuation ignorée', N('chat !') === 'chat' && N('...chat?') === 'chat');
t('normalisation : déterminant initial retiré',
  ['le chat', 'la chat', 'les chats', "l'chat", 'un chat', 'une chat', 'des chats', 'du chat'].every((s) => N(s) === 'chat'));
t('normalisation : déterminant seul gardé (rien derrière)', N('les') === 'les' && N('un') === 'un');
t('normalisation : déterminant au milieu gardé', N('pomme de terre') === 'pommedeterre' && N('chat le') === 'chatle');
t('normalisation : pluriel s / x retiré', N('chats') === 'chat' && N('châteaux') === N('château') && N('bougies') === N('bougie'));
t('normalisation : pluriel dans une expression', N('pommes de terre') === N('pomme de terre'));
t('normalisation : jeton de 3 lettres gardé (bus, os)', N('bus') === 'bus' && N('os') === 'os');
t('normalisation : null / vide → clé vide', N(null) === '' && N('') === '' && N(' !? ') === '');
t('lettres : sans retrait de pluriel', E.lettres('Châteaux') === 'chateaux' && E.lettres("tir à l'arc") === 'tiralarc');
t('distance : 0, 1, 2', E.distance('chat', 'chat', 1) === 0 && E.distance('chat', 'chot', 1) === 1
  && E.distance('chat', 'chats', 1) === 1 && E.distance('chat', 'chien', 1) === 2);

// ================================================================= création
// [1] 2 joueurs
{
  const g = partie(2);
  t('[1] 2 joueurs : phase choosing dès le lancement', g.phase === 'choosing');
  t('[1] 2 joueurs : 3 manches, 80 s de dessin', g.rounds === 3 && g.drawMs === 80000);
  t('[1] 2 joueurs : premier dessinateur = premier de l ordre, tour 1, manche 1',
    g.turn.drawer === g.order[0] && g.turnId === 1 && g.turn.round === 1);
  t('[1] 2 joueurs : 15 s de choix', E.nextDeadline(g) === T0 + 15000);
  t('[1] 2 joueurs : 3 propositions distinctes', g.turn.choices.length === 3 && new Set(g.turn.choices).size === 3);
  t('[1] 2 joueurs : une proposition par niveau, dans l ordre',
    g.turn.choices.map((w) => w.niveau).join() === 'facile,moyen,difficile');
  t('[1] 2 joueurs : scores à 0', [...g.players.values()].every((p) => p.score === 0));
  t('[1] événement de départ : turn', g.startEvents.length === 1 && g.startEvents[0].type === 'turn');
}
// [2] 16 joueurs, et les bornes de durée
{
  const g = partie(16);
  t('[2] 16 joueurs : acceptés, 1 manche', g.order.length === 16 && g.rounds === 1);
  t('[2] 16 joueurs : 60 s de dessin', g.drawMs === 60000);
  t('[2] 8 joueurs : 80 s de dessin', partie(8).drawMs === 80000);
  t('[2] 9 joueurs : 60 s de dessin', partie(9).drawMs === 60000);
  t('[2] 17 joueurs refusés', throws(() => partie(17), /16/));
  t('[2] 1 joueur refusé', throws(() => partie(1), /2 joueurs/));
  t('[2] joueur en double refusé', throws(() => partie(2, { players: ['a', 'a'] }), /double/));
  t('[2] sans hasard : refusé', throws(() => partie(2, { random: undefined }), /hasard/));
  t('[2] sans horloge : refusé', throws(() => partie(2, { now: undefined }), /horloge/));
  t('[2] sans dictionnaire : refusé', throws(() => partie(2, { words: undefined }), /dictionnaire/));
  t('[2] moins de 3 mots : refusé', throws(() => partie(2, { words: MOTS.slice(0, 2) }), /3 mots/));
  t('[2] niveau inconnu : refusé', throws(() => partie(2, { words: [...MOTS, { mot: 'lampe', niveau: 'expert' }] }), /niveau/));
  t('[2] mot trop court : refusé', throws(() => partie(2, { words: [...MOTS, { mot: 'os' }] }), /lettres/));
  t('[2] alias qui double un mot : refusé', throws(() => partie(2, { words: [...MOTS, { mot: 'minou', alias: ['chats'] }] }), /double/));
}

// [3] ordre aléatoire des dessinateurs
{
  const n = ids(10);
  const g1 = partie(10, { random: graine(7) });
  const g2 = partie(10, { random: graine(7) });
  const g3 = partie(10, { random: graine(8) });
  t('[3] ordre : une permutation des joueurs', g1.order.slice().sort().join() === n.slice().sort().join());
  t('[3] ordre : même graine → même ordre', g1.order.join() === g2.order.join());
  t('[3] ordre : autre graine → autre ordre', g1.order.join() !== g3.order.join());
  t('[3] ordre : pas l ordre d arrivée', g1.order.join() !== n.join());
  const g = partie(3);
  const dessinateurs = jusquAuBout(g).filter((e) => e.type === 'turn').map((e) => e.drawer);
  dessinateurs.unshift(g.startEvents[0].drawer);
  t('[3] ordre : le même à chaque manche (3 joueurs, 3 manches)',
    dessinateurs.join() === [...g.order, ...g.order, ...g.order].join());
}

// [4] nombre de manches
for (const [n, manches] of [[2, 3], [3, 3], [4, 2], [5, 2], [6, 1], [8, 1], [16, 1]]) {
  const g = partie(n);
  const ev = jusquAuBout(g);
  const tours = 1 + ev.filter((e) => e.type === 'turn').length;
  t(`[4] ${n} joueurs : ${manches} manche(s), ${n * manches} dessins, chacun ${manches} fois`,
    g.rounds === manches && E.roundsFor(n) === manches && tours === n * manches
    && [...g.players.values()].every((p) => p.drawn === manches));
  t(`[4] ${n} joueurs : fin complète`, g.phase === 'end' && g.complete === true);
}

// [5] choix manuel
{
  const g = partie(3);
  const d = g.turn.drawer, autre = devineurs(g)[0];
  const choix = g.turn.choices.slice();
  t('[5] choix : un devineur ne choisit pas', E.choose(g, autre, 1, 0, T0 + 100).reason === 'NOT_DRAWER');
  t('[5] choix : index hors bornes refusé', [3, -1, 1.5, '0', null].every((i) => E.choose(g, d, 1, i, T0 + 100).reason === 'BAD_CHOICE'));
  t('[5] choix : ancien turnId refusé', E.choose(g, d, 0, 0, T0 + 100).reason === 'STALE_TURN');
  t('[5] choix : inconnu refusé', E.choose(g, 'zz', 1, 0, T0 + 100).reason === 'NOT_IN_GAME');
  t('[5] choix : rien n a changé', g.phase === 'choosing' && g.turn.word === null);
  const r = E.choose(g, d, 1, 1, T0 + 4000);
  t('[5] choix manuel : accepté, le 2e mot', r.ok && g.turn.word === choix[1] && g.turn.auto === false);
  t('[5] choix manuel : le dessin commence à l instant du choix', g.phase === 'drawing' && E.nextDeadline(g) === T0 + 4000 + 40000);
  t('[5] choix manuel : fin du dessin à +80 s', g.endsAt === T0 + 4000 + 80000);
  t('[5] choix manuel : événement drawing sans le mot',
    r.events.length === 1 && r.events[0].type === 'drawing' && !JSON.stringify(r.events).includes(choix[1].mot));
  t('[5] choix : pas deux fois', E.choose(g, d, 1, 0, T0 + 5000).reason === 'NOT_CHOOSING');
}

// [6] choix automatique à l'expiration
{
  const g = partie(3);
  const choix = g.turn.choices.slice();
  t('[6] auto : rien 1 ms avant', E.tick(g, T0 + 14999).length === 0 && g.phase === 'choosing');
  const ev = E.tick(g, T0 + 15000);
  t('[6] auto : tiré pile à 15 s', g.phase === 'drawing' && ev[0].type === 'drawing' && ev[0].auto === true);
  t('[6] auto : un des trois proposés', choix.includes(g.turn.word));
  t('[6] auto : le dessin part de l échéance', g.endsAt === T0 + 15000 + 80000);
}
{
  const g = partie(3);
  E.tick(g, T0 + 21000);      // minuterie en retard de 6 s
  t('[6] auto, minuterie en retard : le dessin part QUAND MÊME de l échéance (aucun temps offert)', g.endsAt === T0 + 95000);
}
{
  const g = partie(3);
  const r = E.choose(g, g.turn.drawer, 1, 0, T0 + 15000);
  t('[6] choix arrivé pile à l échéance : TOO_LATE, le tirage auto l emporte', r.reason === 'TOO_LATE' && g.turn.auto === true);
}
{
  // Les choix ne reviennent pas : 8 tours avec 24 mots = 24 propositions toutes différentes.
  const g = partie(8);
  const vus = [];
  for (let i = 0; i < 8 && g.phase !== 'end'; i++) {
    vus.push(...g.turn.choices.map((w) => w.mot));
    E.tick(g, E.nextDeadline(g));
    for (let k = 0; k < 20 && g.phase !== 'choosing' && g.phase !== 'end'; k++) E.tick(g, E.nextDeadline(g));
  }
  t('[6] propositions : jamais deux fois le même mot dans une partie (24 mots, 8 tours)', vus.length === 24 && new Set(vus).size === 24);
  t('[6] propositions : à court de mots neufs, toujours 3 distincts', partie(16).turn.choices.length === 3);
}

// [7] bon mot, [8] mauvaise réponse, [24] deux fois, [25] dessinateur
{
  const g = partie(3);
  const now = dessiner(g, 'château', T0 + 1000);
  const [b, c] = devineurs(g);
  const d = g.turn.drawer;
  const r1 = E.guess(g, b, g.turnId, 'bateau', now + 1000);
  t('[8] mauvaise réponse : acceptée comme essai, pas correcte', r1.ok && r1.correct === false && !r1.close && !r1.withheld);
  t('[8] mauvaise réponse : rien ne change', g.turn.found.size === 0 && g.phase === 'drawing');
  t('[8] mauvaise réponse : on peut réessayer (autant de fois qu on veut)',
    E.guess(g, b, g.turnId, 'maison', now + 1100).ok && E.guess(g, b, g.turnId, 'maison', now + 1200).ok);
  t('[25] le dessinateur ne devine pas', E.guess(g, d, g.turnId, 'château', now + 1300).reason === 'IS_DRAWER');
  const r2 = E.guess(g, b, g.turnId, '  Les CHATEAUX ! ', now + 2000);
  t('[7] bon mot : trouvé (casse, accents, déterminant, pluriel, ponctuation)', r2.ok && r2.correct === true);
  t('[7] bon mot : événement found, sans texte ni points',
    r2.events.length === 1 && r2.events[0].type === 'found' && r2.events[0].id === b
    && !('points' in r2.events[0]) && !JSON.stringify(r2.events).includes('chat'));
  t('[7] bon mot : le tour continue (il reste un devineur)', g.phase === 'drawing');
  t('[24] pas deux fois', E.guess(g, b, g.turnId, 'château', now + 3000).reason === 'ALREADY_FOUND');
  t('[24] ni même une mauvaise réponse après avoir trouvé', E.guess(g, b, g.turnId, 'patate', now + 3000).reason === 'ALREADY_FOUND');
  t('[7] vide refusé', E.guess(g, c, g.turnId, '  ?! ', now + 3000).reason === 'EMPTY');
  t('[7] plus de 40 caractères refusé', E.guess(g, c, g.turnId, 'château' + ' '.repeat(40), now + 3000).reason === 'TOO_LONG');
  t('[7] joueur inconnu refusé', E.guess(g, 'zz', g.turnId, 'château', now + 3000).reason === 'NOT_IN_GAME');
  t('[7] ancien turnId refusé', E.guess(g, c, g.turnId - 1, 'château', now + 3000).reason === 'STALE_TURN');
}
{
  const g = partie(3);
  const now = dessiner(g, 'réfrigérateur', T0);
  const [b, c] = devineurs(g);
  t('[7] alias accepté (frigo)', E.guess(g, b, g.turnId, 'Le frigo', now + 10).correct === true);
  t('[7] second alias accepté (frigidaires)', E.guess(g, c, g.turnId, 'frigidaires', now + 20).correct === true);
}
{
  const g = partie(3);
  const now = dessiner(g, "tir à l'arc", T0);
  const [b] = devineurs(g);
  t('[7] expression avec apostrophe tapée sans accent ni apostrophe', E.guess(g, b, g.turnId, 'tir a l arc', now + 10).correct);
}
{
  const g = partie(3);
  const now = dessiner(g, 'parapluie', T0);
  const [b] = devineurs(g);
  const r = E.guess(g, b, g.turnId, 'parapuie', now + 10);
  t('[8] presque (une lettre près, mot ≥ 5 lettres) : close, pas correct', r.ok && !r.correct && r.close === true);
  const f = E.guess(g, b, g.turnId, "c'est un parapluie ?", now + 20);
  t('[8] message qui CONTIENT le mot : retenu (withheld), pas correct', f.ok && !f.correct && f.withheld === true && f.close === false);
  t('[8] mot plus long qui commence pareil : ni retenu ni correct', E.guess(g, b, g.turnId, 'parapluies roses', now + 30).withheld === true
    && E.guess(g, b, g.turnId, 'paraplu', now + 40).withheld === false);
}
{
  const g = partie(3);
  const now = dessiner(g, 'chat', T0);
  const [b] = devineurs(g);
  t('[8] mot de 4 lettres : pas de « presque »', E.guess(g, b, g.turnId, 'chut', now + 10).close === false);
  t('[8] « chaton » n est pas retenu pour « chat » (jetons entiers)', E.guess(g, b, g.turnId, 'chaton', now + 20).withheld === false);
}

// [9] plusieurs bonnes réponses
{
  const g = partie(4);
  const now = dessiner(g, 'bateau', T0);
  const [b, c, e] = devineurs(g);
  const r1 = E.guess(g, b, g.turnId, 'bateau', now + 5000);
  const r2 = E.guess(g, c, g.turnId, 'BATEAUX', now + 9000);
  t('[9] deux bonnes réponses : toutes deux correctes', r1.correct && r2.correct);
  t('[9] ordre d arrivée gardé', r1.events[0].order === 1 && r2.events[0].order === 2);
  t('[9] chacun ses points (selon SON instant)', r1.points > r2.points);
  t('[9] le tour continue tant que le 3e n a pas trouvé', g.phase === 'drawing' && E.view(g, now + 9000).found.join() === [b, c].join());
  void e;
}

// [10] scoring selon le temps restant
for (const [ecoule, attendu] of [[0, 100], [40000, 75], [20000, 88], [79000, 51], [79999, 50]]) {
  const g = partie(3);
  const now = dessiner(g, 'soleil', T0);
  const r = E.guess(g, devineurs(g)[0], g.turnId, 'soleil', now + ecoule);
  t(`[10] trouvé après ${ecoule / 1000} s sur 80 : ${attendu} points`, r.correct && r.points === attendu);
}
{
  const g = partie(9);
  const now = dessiner(g, 'soleil', T0);
  const r = E.guess(g, devineurs(g)[0], g.turnId, 'soleil', now + 15000);
  t('[10] 9 joueurs (60 s) : trouvé à 15 s → 88 points', r.points === 88);
}
// Bonne réponse juste avant / pile / après l'échéance.
{
  const g = partie(3);
  const now = dessiner(g, 'soleil', T0);
  const [b, c] = devineurs(g);
  const avant = E.guess(g, b, g.turnId, 'soleil', now + 79999);
  t('[10] 1 ms avant l échéance : trouvé, 50 points', avant.correct && avant.points === 50);
  const pile = E.guess(g, c, g.turnId, 'soleil', now + 80000);
  t('[10] pile à l échéance : TOO_LATE', pile.ok === false && pile.reason === 'TOO_LATE');
  t('[10] pile à l échéance : le tour est fini au chrono', g.phase === 'reveal' && g.turn.reason === 'time');
  t('[10] après l échéance (même tour) : TOO_LATE', E.guess(g, c, g.turnId, 'soleil', now + 80500).reason === 'TOO_LATE');
}

// [11] scoring du dessinateur, [12] personne ne trouve
{
  const g = partie(4);
  const now = dessiner(g, 'escargot', T0);
  const d = g.turn.drawer;
  const [b, c, e] = devineurs(g);
  E.guess(g, b, g.turnId, 'escargot', now);            // 100
  E.guess(g, c, g.turnId, 'escargot', now + 40000);    // 75
  t('[11] points comptés à la fin du tour seulement', score(g, b) === 0 && score(g, d) === 0);
  E.tick(g, now + 80000);
  t('[11] devineurs : 100 et 75, l autre 0', score(g, b) === 100 && score(g, c) === 75 && score(g, e) === 0);
  t('[11] dessinateur : moyenne (100 + 75 + 0) / 3 = 58', score(g, d) === 58);
}
{
  const g = partie(3);
  const now = dessiner(g, 'boussole', T0);
  E.guess(g, devineurs(g)[0], g.turnId, 'compas', now + 1000);
  E.tick(g, now + 80000);
  t('[12] personne ne trouve : 0 pour tous, dessinateur compris', [...g.players.values()].every((p) => p.score === 0));
  t('[12] personne ne trouve : fin au chrono, mot révélé', g.phase === 'reveal' && g.turn.reason === 'time' && E.view(g).word === 'boussole');
}

// [13] [14] [15] indices
{
  const g = partie(3);
  const now = dessiner(g, 'bougie', T0);
  const vu = (at) => E.view(g, at).pattern;
  t('[13] gabarit de départ : 6 trous', vu(now) === '______');
  t('[13] prochaine échéance : l indice à 50 %', E.nextDeadline(g) === now + 40000);
  t('[13] rien 1 ms avant 50 %', E.tick(g, now + 39999).length === 0);
  const e1 = E.tick(g, now + 40000);
  const p1 = vu(now + 40000);
  t('[13] indice à 50 % : une lettre, à sa place', e1.length === 1 && e1[0].type === 'hint' && (p1.match(/_/g) || []).length === 5
    && [...p1].every((ch, i) => ch === '_' || ch === 'bougie'[i]));
  t('[14] prochaine échéance : l indice à 75 %', E.nextDeadline(g) === now + 60000);
  const e2 = E.tick(g, now + 60000);
  const p2 = vu(now + 60000);
  t('[14] indice à 75 % (mot de 6 lettres) : une 2e lettre, la 1re reste', e2[0].type === 'hint' && (p2.match(/_/g) || []).length === 4
    && [...p1].every((ch, i) => ch === '_' || p2[i] === ch));
  t('[14] puis plus que la fin du dessin', E.nextDeadline(g) === now + 80000);
  t('[13] un indice ne retire aucun point (60 s sur 80 → 63)', E.guess(g, devineurs(g)[0], g.turnId, 'bougie', now + 60000).points === 63);
}
for (const mot of ['chat', 'phare']) {
  const g = partie(3);
  const now = dessiner(g, mot, T0);
  const ev = [];
  E.tick(g, now + 79999, ev);
  t(`[15] « ${mot} » (${mot.length} lettres) : un seul indice, à 50 %`, ev.filter((e) => e.type === 'hint').length === 1
    && (E.view(g).pattern.match(/_/g) || []).length === mot.length - 1);
}
{
  const g = partie(3);
  const now = dessiner(g, 'tire-bouchon', T0);
  t('[13] gabarit : le tiret est visible d emblée', E.view(g).pattern === '____-_______');
  E.tick(g, now + 79999);
  const p = E.view(g).pattern;
  t('[14] mot de 11 lettres : 2 indices, tiret intact', (p.match(/_/g) || []).length === 9 && p[4] === '-');
}
{
  const g = partie(3);
  const now = dessiner(g, 'bougie', T0);
  E.guess(g, devineurs(g)[0], g.turnId, 'bougie', now + 1000);
  E.guess(g, devineurs(g)[1], g.turnId, 'bougie', now + 2000);
  t('[13] tour fini avant 50 % : aucun indice ne reste armé', g.phase === 'pause' && g.turn.hints.length === 0);
}

// [16] fin immédiate quand tout le monde a trouvé, pause, [18] révélation
{
  const g = partie(3);
  const now = dessiner(g, 'arbre', T0);
  const d = g.turn.drawer;
  const [b, c] = devineurs(g);
  E.guess(g, b, g.turnId, 'arbre', now + 8000);              // 95
  const r = E.guess(g, c, g.turnId, 'arbre', now + 16000);   // 90
  t('[16] le dernier devineur trouve : arrêt immédiat', r.events.map((e) => e.type).join() === 'found,stop' && r.events[1].reason === 'all-found');
  t('[16] puis pause de 1,5 s (mot pas encore révélé)', g.phase === 'pause' && E.nextDeadline(g) === now + 16000 + 1500 && E.view(g).word === null);
  t('[16] points comptés à l arrêt : 95, 90, dessinateur (95 + 90) / 2 = 93', score(g, b) === 95 && score(g, c) === 90 && score(g, d) === 93);
  t('[16] pendant la pause : TOO_LATE', E.guess(g, b, g.turnId, 'arbre', now + 16500).reason === 'TOO_LATE');
  t('[18] rien 1 ms avant la fin de la pause', E.tick(g, now + 17499).length === 0);
  const ev = E.tick(g, now + 17500);
  t('[18] révélation à la fin de la pause', g.phase === 'reveal' && ev[0].type === 'reveal' && ev[0].word === 'arbre');
  t('[18] révélation : gains du tour, dessinateur marqué', ev[0].gains.length === 3 && ev[0].gains.find((x) => x.drawer).id === d);
  t('[18] révélation : 6 s', E.nextDeadline(g) === now + 17500 + 6000);
  const v = E.view(g, now + 18000);
  t('[18] vue pendant la révélation : mot, raison, gains, temps restant',
    v.word === 'arbre' && v.reason === 'all-found' && v.gains.length === 3 && v.remainingMs === 5500);
  const suite = E.tick(g, now + 23500);
  t('[18] après la révélation : tour suivant, dessinateur suivant', suite[0].type === 'turn' && g.turnId === 2
    && g.turn.drawer === g.order[1] && g.phase === 'choosing' && g.endsAt === now + 23500 + 15000);
}

// [17] fin au chrono
{
  const g = partie(3);
  const now = dessiner(g, 'pomme', T0);
  E.tick(g, now + 79999);
  t('[17] 1 ms avant : on dessine encore', g.phase === 'drawing');
  const ev = E.tick(g, now + 80000);
  t('[17] pile à 80 s : stop au chrono puis révélation directe (pas de pause)',
    ev.map((e) => e.type).join() === 'stop,reveal' && ev[0].reason === 'time' && g.phase === 'reveal');
  t('[17] la révélation dure 6 s à partir de l échéance', g.endsAt === now + 80000 + 6000);
}
{
  const g = partie(2);
  const ev = E.tick(g, T0 + 10_000_000);     // minuterie très en retard : tout est rattrapé
  const types = ev.map((e) => e.type);
  t('[17] tick très en retard : la partie entière rattrapée dans l ordre (6 dessins, fin complète)',
    g.phase === 'end' && g.complete === true && types.filter((x) => x === 'drawing').length === 6 && types[types.length - 1] === 'end');
}

// [19] joueur qui quitte pendant le choix
{
  const g = partie(3);
  const [d, x, y] = g.order;
  const ev = E.leave(g, d, T0 + 3000);
  t('[19] dessinateur parti au choix : tour sauté', ev.map((e) => e.type).join() === 'left,skipped,turn');
  t('[19] le suivant choisit tout de suite, 15 s pleines', g.turn.drawer === x && g.phase === 'choosing' && g.endsAt === T0 + 3000 + 15000);
  const dessinateurs = [x, ...jusquAuBout(g).filter((e) => e.type === 'turn').map((e) => e.drawer)];
  t('[19] le parti ne dessine plus jamais (2 restants × 3 manches)', !dessinateurs.includes(d) && dessinateurs.length === 6);
  t('[19] partie quand même complète', g.complete === true);
  void y;
}
{
  const g = partie(4);
  const [d, , , z] = g.order;
  E.leave(g, z, T0 + 3000);
  t('[19] devineur parti au choix : le tour continue', g.turn.drawer === d && g.phase === 'choosing');
  dessiner(g, 'maison', T0 + 4000);
  t('[19] … et il n est pas attendu au dessin', !g.turn.expected.has(z) && g.turn.expected.size === 2);
  t('[19] … et il ne devine plus', E.guess(g, z, g.turnId, 'maison', T0 + 5000).reason === 'NOT_IN_GAME');
}

// [20] dessinateur qui quitte pendant le dessin
{
  const g = partie(4);
  const now = dessiner(g, 'poisson', T0);
  const d = g.turn.drawer;
  const [b, c, e] = devineurs(g);
  E.guess(g, b, g.turnId, 'poisson', now);     // 100
  const ev = E.leave(g, d, now + 10000);
  t('[20] dessinateur parti : stop drawer-left puis révélation', ev.map((x) => x.type).join() === 'left,stop,reveal'
    && g.turn.reason === 'drawer-left' && g.phase === 'reveal');
  t('[20] le devineur garde ses points', score(g, b) === 100);
  t('[20] le dessinateur parti a sa moyenne (100 + 0 + 0) / 3 = 33', score(g, d) === 33);
  t('[20] plus personne ne devine ce tour', E.guess(g, c, g.turnId, 'poisson', now + 10001).reason === 'TOO_LATE');
  void e;
}

// [21] devineur qui quitte pendant le dessin
{
  const g = partie(4);
  const now = dessiner(g, 'voiture', T0);
  const d = g.turn.drawer;
  const [b, c, e] = devineurs(g);
  E.guess(g, b, g.turnId, 'voiture', now);       // 100
  E.leave(g, c, now + 1000);
  t('[21] devineur parti : le tour continue (un autre cherche encore)', g.phase === 'drawing' && !g.turn.expected.has(c));
  E.tick(g, now + 80000);
  t('[21] il sort du dénominateur : dessinateur (100 + 0) / 2 = 50', score(g, d) === 50 && score(g, e) === 0);
}
{
  const g = partie(4);
  const now = dessiner(g, 'voiture', T0);
  const [b, c, e] = devineurs(g);
  E.guess(g, b, g.turnId, 'voiture', now);
  E.guess(g, c, g.turnId, 'auto', now + 40000);
  const ev = E.leave(g, e, now + 50000);
  t('[21] le seul qui cherchait part : tous les présents ont trouvé → arrêt immédiat',
    ev.map((x) => x.type).join() === 'left,stop' && g.turn.reason === 'all-found' && g.phase === 'pause');
}
{
  const g = partie(4);
  const now = dessiner(g, 'voiture', T0);
  const d = g.turn.drawer;
  const [b, c] = devineurs(g);
  E.guess(g, b, g.turnId, 'voiture', now);       // 100, puis il part
  E.leave(g, b, now + 1000);
  E.tick(g, now + 80000);
  t('[21] un trouveur parti garde ses points mais sort de la moyenne', score(g, b) === 100 && score(g, d) === 0);
  void c;
}

// [22] moins de 2 joueurs
{
  const g = partie(2);
  const now = dessiner(g, 'chapeau', T0);
  const [b] = devineurs(g);
  E.guess(g, b, g.turnId, 'chapeau', now);
  const d = g.turn.drawer;
  // Un 2e tour pour que le classement porte quelque chose.
  E.tick(g, E.nextDeadline(g)); E.tick(g, E.nextDeadline(g));
  t('[22] (2e tour lancé)', g.turnId === 2 && g.phase === 'choosing');
  const ev = E.leave(g, d, E.nextDeadline(g) - 1);
  t('[22] 2 joueurs, l un part : fin INCOMPLÈTE', g.phase === 'end' && g.complete === false && ev[ev.length - 1].type === 'end');
  t('[22] classement quand même rendu (parti compris)', ev[ev.length - 1].ranking.length === 2 && ev[ev.length - 1].ranking.find((r) => r.id === d).left);
  t('[22] après la fin : plus rien', E.tick(g, T0 + 10_000_000).length === 0 && E.leave(g, b, T0 + 10_000_000).length === 0
    && E.guess(g, b, g.turnId, 'x', T0 + 10_000_000).ok === false && E.nextDeadline(g) === null);
}
{
  const g = partie(4);
  const now = dessiner(g, 'pomme', T0);
  const [b, c, e] = devineurs(g);
  E.guess(g, b, g.turnId, 'pommes', now);       // 100 — compté même si la partie avorte
  E.leave(g, b, now + 500);
  E.leave(g, c, now + 1000);
  t('[22] 4 → 2 : la partie continue (e cherche encore)', g.phase === 'drawing');
  const ev = E.leave(g, e, now + 2000);
  t('[22] 4 → 1 en plein dessin : tour arrêté (abandon), points comptés, fin incomplète',
    ev.map((x) => x.type).join() === 'left,stop,reveal,end' && g.turn.reason === 'abandon' && score(g, b) === 100 && g.complete === false);
}
{
  const g = partie(3);
  const now = dessiner(g, 'pomme', T0);
  E.tick(g, now + 80000);
  E.leave(g, g.order[1], now + 81000);
  const ev = E.leave(g, g.order[2], now + 82000);
  t('[22] départs pendant la révélation : fin incomplète tout de suite', ev.map((x) => x.type).join() === 'left,end' && g.complete === false);
}

// [23] égalités et rangs
{
  const g = partie(5);
  const pts = [13, 13, 5, 20, 5];
  g.order.forEach((id, i) => { g.players.get(id).score = pts[i]; });
  const r = E.ranking(g);
  t('[23] 20, 13, 13, 5, 5 → rangs 1, 2, 2, 4, 4', r.map((x) => x.score).join() === '20,13,13,5,5' && r.map((x) => x.rank).join() === '1,2,2,4,4');
  t('[23] à égalité, l affichage suit l ordre de passage', r[1].id === g.order[0] && r[2].id === g.order[1]);
}
{
  const g = partie(2);
  const now = dessiner(g, 'chapeau', T0);
  E.guess(g, devineurs(g)[0], g.turnId, 'chapeau', now);   // 100 pour lui, 100 pour le dessinateur
  E.tick(g, E.nextDeadline(g));
  const r = E.ranking(g);
  t('[23] 2 joueurs à 100 : tous deux 1er', r.every((x) => x.rank === 1 && x.score === 100));
  t('[23] tous à 0 : tous 1er', E.ranking(partie(3)).every((x) => x.rank === 1));
}
{
  // Une partie complète jouée de bout en bout : le classement de fin = les scores.
  const g = partie(3, { random: graine(3) });
  const ev = [];
  let n = 0;
  while (g.phase !== 'end' && n++ < 100) {
    if (g.phase === 'choosing') {
      const at = g.endsAt - 10000;
      dessiner(g, null, at);
      const [b, c] = devineurs(g);
      const mot = g.turn.word.mot;
      ev.push(...E.guess(g, b, g.turnId, mot, at + 2000).events);
      if (n % 2) ev.push(...E.guess(g, c, g.turnId, mot, at + 30000).events);
    }
    E.tick(g, E.nextDeadline(g), ev);
  }
  const fin = ev[ev.length - 1];
  t('[23] partie complète : 9 tours, événement end, complete', fin.type === 'end' && fin.complete === true && g.turnId === 9);
  t('[23] classement de fin trié, rangs cohérents',
    fin.ranking.every((x, i, a) => i === 0 || (a[i - 1].score >= x.score && (a[i - 1].score === x.score ? a[i - 1].rank === x.rank : x.rank === i + 1))));
  t('[23] classement de fin = scores', fin.ranking.every((x) => x.score === score(g, x.id)));
}

// [26] aucune fuite, [27] vues publiques / privées
{
  const g = partie(3);
  const d = g.turn.drawer;
  const [b, c] = devineurs(g);
  const secrets = (w) => [w.mot, ...[...w.cles].filter((k) => k.length >= 4)];
  const fuite = (obj, words) => { const s = JSON.stringify(obj).toLowerCase(); return words.some((w) => secrets(w).some((x) => s.includes(x.toLowerCase()))); };
  const choix = g.turn.choices.slice();

  const v0 = E.view(g, T0 + 1000);
  t('[26] choix : aucune proposition dans la vue publique', !fuite(v0, choix) && !('choices' in v0));
  t('[26] choix : aucun mot dans l événement de départ', !fuite(g.startEvents, choix));
  const dv = E.drawerView(g, d, T0 + 1000);
  t('[27] vue du dessinateur au choix : ses 3 propositions (mot + niveau)',
    dv.choices.length === 3 && dv.choices.every((x, i) => x.mot === choix[i].mot && x.niveau === choix[i].niveau));
  t('[27] vue du dessinateur : rien pour un devineur', E.drawerView(g, b, T0 + 1000) === null);

  const r = E.choose(g, d, g.turnId, 2, T0 + 2000);
  const mot = g.turn.word;
  const v1 = E.view(g, T0 + 3000);
  t('[26] dessin : ni le mot ni les autres propositions dans la vue publique', !fuite(v1, choix));
  t('[26] dessin : ni dans l événement drawing', !fuite(r.events, choix));
  t('[27] vue publique au dessin : gabarit, nombre de lettres, temps restant', v1.pattern === '_'.repeat(mot.mot.length).replace(/_/g, (u, i) => (/\p{L}/u.test(mot.mot[i]) ? '_' : mot.mot[i]))
    && v1.letters === E.lettres(mot.mot).length && v1.remainingMs === 79000 && v1.word === null);
  t('[27] vue du dessinateur au dessin : son mot, pas les propositions', E.drawerView(g, d, T0 + 3000).word === mot.mot && !('choices' in E.drawerView(g, d, T0 + 3000)));
  const g1 = E.guess(g, b, g.turnId, mot.mot, T0 + 4000);
  const v2 = E.view(g, T0 + 4000);
  t('[26] après une bonne réponse : vue publique sans mot ni points du tour',
    !fuite(v2, [mot]) && !fuite(g1.events, [mot]) && v2.found.join() === b && v2.players.every((p) => p.score === 0));
  t('[26] vues : aucune échéance absolue ni état interne', [v0, v1, v2].every((v) => nombres(v).every((n) => n < T0))
    && ['endsAt', 'random', 'words', 'proposed', 'turn', 'choices'].every((k) => !(k in v1)));
  E.guess(g, c, g.turnId, mot.mot, T0 + 5000);
  t('[26] pendant la pause : le mot n est pas encore public', g.phase === 'pause' && E.view(g).word === null);
  E.tick(g, E.nextDeadline(g));
  t('[27] révélation : le mot devient public', E.view(g).word === mot.mot);
  t('[27] révélation : plus de vue dessinateur', E.drawerView(g, d) === null);
  t('[27] vue publique : jamais les propositions non choisies, même à la révélation',
    !fuite(E.view(g), choix.filter((w) => w !== mot)));
}
{
  // Les indices ne révèlent jamais le mot entier, même sur un mot de 3 lettres.
  const g = partie(3, { words: [...MOTS, { mot: 'riz', niveau: 'facile' }] });
  const now = dessiner(g, 'riz', T0);
  E.tick(g, now + 79999);
  t('[26] mot de 3 lettres : l indice en laisse au moins une cachée', (E.view(g).pattern.match(/_/g) || []).length === 2);
}

// ============================================================ déterminisme
{
  const jouer = () => {
    const g = partie(5, { random: graine(42) });
    const ev = [...g.startEvents];
    let n = 0;
    while (g.phase !== 'end' && n++ < 100) {
      if (g.phase === 'drawing' && !g.turn.found.size) {
        const at = g.turn.startedAt + 12345;
        ev.push(...E.guess(g, devineurs(g)[0], g.turnId, g.turn.word.mot, at).events);
      }
      E.tick(g, E.nextDeadline(g), ev);
    }
    return JSON.stringify(ev);
  };
  t('déterminisme : même graine, mêmes actions → mêmes événements, au caractère près', jouer() === jouer());
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
