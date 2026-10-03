// Moteur PUR du jeu de dessin (nom provisoire : Croquis). Aucun réseau, aucun
// DOM, aucune minuterie, aucun dessin : l'horloge (`now`, en ms) et le hasard
// (`random`) sont injectés. Même forme que engine.js de roquette-server : tout
// ce qui décide d'un tour, d'un mot ou d'un point est ici, et rien d'autre. Le
// serveur (lot suivant) branchera ce moteur sur ses sockets et sur UNE
// minuterie, posée à `nextDeadline()`.
//
// La boucle : un dessinateur choisit un mot parmi trois, dessine, les autres
// devinent ; chaque bonne réponse rapporte selon le temps restant, le
// dessinateur gagne la moyenne de ce qu'il a fait gagner. Chacun dessine
// autant de fois que les autres.
//
// LE MOT EST LE SECRET DE CE JEU. Les trois propositions et le mot choisi ne
// sortent que par `drawerView()` (le dessinateur) et, à la révélation, par
// `view()`. Les points d'un tour ne sortent qu'à sa fin. Les tests le
// vérifient sur le JSON entier de chaque vue.
//
// Phases :  choosing → drawing → [pause] → reveal → choosing … → end
//   (le salon, `lobby`, est l'affaire du serveur : createGame = « Lancer »)
//   choosing  le dessinateur choisit (CHOOSE_MS) ; sinon tirage automatique ;
//   drawing   on devine ; indices à 50 % et 75 % ; fin au chrono, ou dès que
//             tous les devineurs encore présents ont trouvé ;
//   pause     tout le monde a trouvé : 1,5 s pour voir le dernier « trouvé » ;
//   reveal    le mot et les gains du tour (REVEAL_MS) ;
//   end       classement ; `complete: false` si la partie s'est arrêtée faute
//             de joueurs (le Hub n'en recevra aucun classement).
//
// Toute transition automatique a lieu à SON échéance, pas à l'heure où la
// minuterie se réveille : une minuterie en retard ne donne de temps à personne,
// et `tick()` rattrape plusieurs échéances d'un coup dans le bon ordre.
'use strict';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;
const CHOOSE_MS = 15000;
const DRAW_MS = 80000;
const DRAW_MS_LARGE = 60000;      // au-delà de LARGE_AFTER joueurs
const LARGE_AFTER = 8;
const PAUSE_MS = 1500;            // tout le monde a trouvé → pause, puis révélation
const REVEAL_MS = 6000;
const CHOICES = 3;
const NIVEAUX = ['facile', 'moyen', 'difficile'];
// Indices : une lettre à 50 % du dessin ; une seconde à 75 %, seulement pour
// un mot de 6 lettres ou plus. Ils ne retirent aucun point.
const HINTS = [{ at: 0.5, minLetters: 0 }, { at: 0.75, minLetters: 6 }];
const SAISIE_MAX = 40;            // caractères bruts d'une devinette
const MOT_MIN = 3;                // lettres d'un mot du dictionnaire
const MOT_MAX = 20;
const PROCHE_MIN = 5;             // « presque » seulement pour un mot de 5 lettres ou plus

// Les refus, avec leur code (le serveur les relaiera tels quels).
const REFUS = {
  NOT_IN_GAME: "tu n'es pas dans cette partie",
  NOT_CHOOSING: "ce n'est pas le moment de choisir",
  NOT_DRAWER: "ce n'est pas toi qui dessines",
  BAD_CHOICE: 'choix invalide',
  NOT_DRAWING: "ce n'est pas le moment de deviner",
  STALE_TURN: 'ce tour est déjà passé',
  TOO_LATE: 'trop tard',
  IS_DRAWER: 'tu dessines : tu ne devines pas',
  ALREADY_FOUND: 'tu as déjà trouvé',
  EMPTY: 'devinette vide',
  TOO_LONG: 'trop long',
};

// Nombre de manches selon le nombre de joueurs AU LANCEMENT.
function roundsFor(n) {
  if (n <= 3) return 3;
  if (n <= 5) return 2;
  return 1;
}

// ------------------------------------------------------------ normalisation
// Casse, accents, œ/æ ; tout ce qui n'est pas une lettre (tirets, espaces,
// ponctuation, chiffres) devient un séparateur. Les apostrophes coupent un mot
// en deux jetons (« l'arc » → l, arc ; « aujourd'hui » → aujourd, hui).
function jetons(s) {
  return String(s == null ? '' : s)
    .replace(/[’‘ʼ`´]/g, "'")
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

const DETERMINANTS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du']);

// Pluriel : un s ou x final est retiré de chaque jeton de plus de 3 lettres
// (« bus », « os » restent). Appliqué des DEUX côtés (mot et devinette) :
// « châteaux » = « château », « pommes de terre » = « pomme de terre ».
const singulier = (t) => (t.length > 3 && /[sx]$/.test(t) ? t.slice(0, -1) : t);

// La clé d'une suite de jetons : déterminant initial retiré (s'il reste
// quelque chose derrière), pluriels retirés, le tout collé.
function cleJetons(js) {
  const t = js.length > 1 && DETERMINANTS.has(js[0]) ? js.slice(1) : js;
  return t.map(singulier).join('');
}

// LA normalisation d'une devinette, et d'un mot du dictionnaire : les deux
// passent par ici, rien d'autre ne compare.
//   « Un Château ! » → chateau ; « micro-ondes » → microonde ; « l'œuf » → oeuf
function normaliser(s) {
  return cleJetons(jetons(s));
}

// Les lettres seules (sans retrait de déterminant ni de pluriel) : longueur
// d'un mot du dictionnaire.
const lettres = (s) => jetons(s).join('');

// Distance d'édition (Levenshtein), bornée : rend max + 1 dès qu'on dépasse.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let mini = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < mini) mini = cur[j];
    }
    if (mini > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ------------------------------------------------------------------ hasard
function shuffle(arr, random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr, random) => arr[Math.floor(random() * arr.length)];

// ------------------------------------------------------------ dictionnaire
// Une entrée : { mot, niveau?, alias? }. Le moteur ne fait que la manipuler :
// il en tire les clés acceptées (le mot et ses alias, normalisés).
function preparerMot(e, i) {
  if (!e || typeof e.mot !== 'string') throw new Error(`mot n°${i} : { mot } attendu`);
  const n = lettres(e.mot).length;
  if (n < MOT_MIN || n > MOT_MAX) throw new Error(`mot « ${e.mot} » : ${MOT_MIN} à ${MOT_MAX} lettres`);
  if (e.niveau != null && !NIVEAUX.includes(e.niveau)) throw new Error(`mot « ${e.mot} » : niveau inconnu « ${e.niveau} »`);
  const alias = Array.isArray(e.alias) ? e.alias.map(String) : [];
  const formes = [e.mot, ...alias];
  const cles = new Set(formes.map(normaliser).filter(Boolean));
  return {
    mot: e.mot.normalize('NFC'),
    niveau: e.niveau || null,
    alias,
    cles,
    // le plus long nombre de jetons d'une forme : borne la recherche de fuite
    maxJetons: Math.max(...formes.map((f) => jetons(f).length)),
  };
}

// --------------------------------------------------------------- création
// opts : { players: [id…], now, random, words: [{ mot, niveau?, alias? }…], regles? }
// `regles` ({ chooseMs, drawMs, pauseMs, revealMs }) n'existe que pour les
// tests du serveur, qui ne vont pas attendre 80 s par tour.
function createGame(opts) {
  const o = opts || {};
  const ids = Array.isArray(o.players) ? o.players.map(String) : [];
  if (new Set(ids).size !== ids.length) throw new Error('joueur en double');
  if (ids.length < MIN_PLAYERS) throw new Error(`il faut au moins ${MIN_PLAYERS} joueurs`);
  if (ids.length > MAX_PLAYERS) throw new Error(`${MAX_PLAYERS} joueurs maximum`);
  if (typeof o.random !== 'function') throw new Error('hasard non fourni');
  if (!Number.isFinite(o.now)) throw new Error('horloge non fournie');
  if (!Array.isArray(o.words)) throw new Error('dictionnaire non fourni');
  const words = o.words.map(preparerMot);
  if (words.length < CHOICES) throw new Error(`il faut au moins ${CHOICES} mots`);
  const vues = new Set();
  for (const w of words) for (const k of w.cles) {
    if (vues.has(k)) throw new Error(`clé « ${k} » en double dans le dictionnaire`);
    vues.add(k);
  }

  const r = o.regles || {};
  const order = shuffle(ids, o.random);       // tiré UNE fois, le même à chaque manche
  const players = new Map();
  for (const id of order) players.set(id, { id, score: 0, left: false, found: 0, drawn: 0 });

  const g = {
    phase: null,
    order,
    players,
    rounds: roundsFor(ids.length),
    chooseMs: r.chooseMs || CHOOSE_MS,
    drawMs: r.drawMs || (ids.length > LARGE_AFTER ? DRAW_MS_LARGE : DRAW_MS),
    pauseMs: r.pauseMs || PAUSE_MS,
    revealMs: r.revealMs || REVEAL_MS,
    words,
    proposed: new Set(),      // mots déjà proposés dans la partie (jamais deux fois)
    slot: -1,                 // index dans rounds × order
    turnId: 0,
    turn: null,
    endsAt: null,             // échéance de la phase : SECRÈTE (view donne un reste)
    complete: null,
    random: o.random,
  };
  const ev = [];
  prochainTour(g, o.now, ev);
  g.startEvents = ev;
  return g;
}

// ---------------------------------------------------------------- outils
const presents = (g) => g.order.filter((id) => !g.players.get(id).left);

// Trois mots jamais proposés : un par niveau quand le dictionnaire en a, sinon
// au hasard. À court de mots neufs, on reprend des mots proposés mais jamais
// joués, puis n'importe lesquels (hors doublon dans les trois).
function tirerChoix(g) {
  const joues = new Set(g.joues || []);
  const niveaux = [
    (w) => !g.proposed.has(w),
    (w) => !joues.has(w),
    () => true,
  ];
  const choix = [];
  for (const libre of niveaux) {
    for (const niv of NIVEAUX) {
      if (choix.length >= CHOICES) break;
      if (choix.some((w) => w.niveau === niv)) continue;
      const pool = g.words.filter((w) => w.niveau === niv && libre(w) && !choix.includes(w));
      if (pool.length) choix.push(pick(pool, g.random));
    }
    while (choix.length < CHOICES) {
      const pool = g.words.filter((w) => libre(w) && !choix.includes(w));
      if (!pool.length) break;
      choix.push(pick(pool, g.random));
    }
    if (choix.length >= CHOICES) break;
  }
  // Toujours dans l'ordre facile → moyen → difficile → sans niveau.
  const rang = (w) => (w.niveau ? NIVEAUX.indexOf(w.niveau) : NIVEAUX.length);
  choix.sort((a, b) => rang(a) - rang(b));
  for (const w of choix) g.proposed.add(w);
  return choix;
}

// Passe au tour suivant à l'instant `at` : le prochain dessinateur présent,
// ou la fin de partie (complète) quand tout le monde a dessiné ses manches.
function prochainTour(g, at, ev) {
  const n = g.order.length;
  for (;;) {
    g.slot += 1;
    if (g.slot >= g.rounds * n) return finir(g, true, ev);
    if (!g.players.get(g.order[g.slot % n]).left) break;
  }
  const drawer = g.order[g.slot % n];
  g.turnId += 1;
  g.turn = {
    id: g.turnId,
    round: Math.floor(g.slot / n) + 1,
    drawer,
    choices: tirerChoix(g),
    word: null,
    auto: false,
    startedAt: null,
    hints: [],          // instants des indices à venir
    revealed: new Set(),// positions (dans le mot affiché) révélées
    expected: new Set(),// devineurs présents au début du dessin, moins les partis
    found: new Map(),   // id → { at, points, order }
    reason: null,
    gains: null,
  };
  g.phase = 'choosing';
  g.endsAt = at + g.chooseMs;
  ev.push({ type: 'turn', turnId: g.turnId, round: g.turn.round, rounds: g.rounds, drawer });
}

function commencerDessin(g, at, index, auto, ev) {
  const t = g.turn;
  t.word = t.choices[index];
  t.auto = auto;
  t.startedAt = at;
  (g.joues || (g.joues = [])).push(t.word);
  for (const id of presents(g)) if (id !== t.drawer) t.expected.add(id);
  const nb = lettres(t.word.mot).length;
  t.hints = HINTS.filter((h) => nb >= h.minLetters).map((h) => at + Math.round(g.drawMs * h.at));
  g.players.get(t.drawer).drawn += 1;
  g.phase = 'drawing';
  g.endsAt = at + g.drawMs;
  ev.push({ type: 'drawing', turnId: t.id, drawer: t.drawer, auto, pattern: gabarit(t), letters: nb });
}

// Positions des lettres du mot affiché (les espaces, tirets, apostrophes
// sont visibles d'emblée).
const positionsLettres = (mot) => Array.from(mot).map((c, i) => (/\p{L}/u.test(c) ? i : -1)).filter((i) => i >= 0);

function gabarit(t) {
  return Array.from(t.word.mot).map((c, i) => (/\p{L}/u.test(c) && !t.revealed.has(i) ? '_' : c)).join('');
}

function indice(g, at, ev) {
  const t = g.turn;
  t.hints.shift();
  const libres = positionsLettres(t.word.mot).filter((i) => !t.revealed.has(i));
  if (libres.length <= 1) return;          // jamais le mot entier par indices
  t.revealed.add(pick(libres, g.random));
  ev.push({ type: 'hint', turnId: t.id, pattern: gabarit(t) });
}

// Arrête le dessin à l'instant `at` et compte les points du tour.
//   devineur : 50 + 50 × reste / durée (calculé à la réponse) ;
//   dessinateur : moyenne des points des devineurs ATTENDUS (ceux qui sont
//   encore là), 0 pour qui n'a pas trouvé ; personne attendu → 0.
// Un devineur parti garde ce qu'il a gagné, mais ne compte plus dans la
// moyenne du dessinateur.
function arreter(g, at, reason, ev) {
  const t = g.turn;
  t.reason = reason;
  t.hints = [];
  const gains = new Map();
  for (const [id, f] of t.found) gains.set(id, f.points);
  let somme = 0;
  for (const id of t.expected) somme += t.found.has(id) ? t.found.get(id).points : 0;
  const pourDessinateur = t.expected.size ? Math.round(somme / t.expected.size) : 0;
  gains.set(t.drawer, pourDessinateur);
  for (const [id, pts] of gains) g.players.get(id).score += pts;
  t.gains = gains;
  ev.push({ type: 'stop', turnId: t.id, reason });
  if (reason === 'all-found') {
    g.phase = 'pause';
    g.endsAt = at + g.pauseMs;
  } else {
    reveler(g, at, ev);
  }
}

function reveler(g, at, ev) {
  const t = g.turn;
  g.phase = 'reveal';
  g.endsAt = at + g.revealMs;
  ev.push({ type: 'reveal', turnId: t.id, word: t.word.mot, reason: t.reason, gains: gainsPublics(g), scores: scores(g) });
}

function finir(g, complete, ev) {
  if (g.phase === 'end') return;
  g.phase = 'end';
  g.endsAt = null;
  g.complete = complete;
  ev.push({ type: 'end', complete, ranking: ranking(g) });
}

// Tous les devineurs encore présents ont trouvé (et il en reste au moins un).
function tousTrouve(t) {
  if (!t.expected.size) return false;
  for (const id of t.expected) if (!t.found.has(id)) return false;
  return true;
}

// ----------------------------------------------------------------- horloge
// L'échéance que le serveur doit attendre (une seule minuterie). Jamais envoyée.
function nextDeadline(g) {
  if (g.phase === 'end' || g.endsAt == null) return null;
  if (g.phase === 'drawing' && g.turn.hints.length) return Math.min(g.turn.hints[0], g.endsAt);
  return g.endsAt;
}

// Fait avancer le jeu jusqu'à `now`. Le serveur l'appelle à l'échéance ;
// `choose`, `guess` et `leave` l'appellent d'abord. Rend les événements.
function tick(g, now, events) {
  const ev = events || [];
  for (let garde = 0; garde < 10000; garde++) {
    const t = g.turn;
    if (g.phase === 'choosing' && now >= g.endsAt) {
      commencerDessin(g, g.endsAt, Math.floor(g.random() * t.choices.length), true, ev);
    } else if (g.phase === 'drawing' && t.hints.length && t.hints[0] < g.endsAt && now >= t.hints[0]) {
      indice(g, t.hints[0], ev);
    } else if (g.phase === 'drawing' && now >= g.endsAt) {
      arreter(g, g.endsAt, 'time', ev);
    } else if (g.phase === 'pause' && now >= g.endsAt) {
      reveler(g, g.endsAt, ev);
    } else if (g.phase === 'reveal' && now >= g.endsAt) {
      prochainTour(g, g.endsAt, ev);
    } else break;
  }
  return ev;
}

// ------------------------------------------------------------------ actions
// Le dessinateur choisit un des trois mots. Rend { ok, reason?, events }.
function choose(g, playerId, turnId, index, now) {
  const events = tick(g, now);
  const refus = (reason) => ({ ok: false, reason, message: REFUS[reason], events });
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left) return refus('NOT_IN_GAME');
  // Le délai a expiré pendant ce même appel : le tirage automatique est passé.
  if (events.some((e) => e.type === 'drawing' && e.turnId === turnId)) return refus('TOO_LATE');
  if (g.phase !== 'choosing') return refus('NOT_CHOOSING');
  if (turnId !== g.turnId) return refus('STALE_TURN');
  if (id !== g.turn.drawer) return refus('NOT_DRAWER');
  if (!Number.isInteger(index) || index < 0 || index >= g.turn.choices.length) return refus('BAD_CHOICE');
  commencerDessin(g, now, index, false, events);
  return { ok: true, events };
}

// Une devinette. Rend { ok, reason?, correct, points?, close?, withheld?, events }.
//   correct   bonne réponse : le texte ne doit JAMAIS être diffusé ;
//   close     à une lettre près (mot de 5 lettres ou plus) : à dire au seul auteur ;
//   withheld  le message CONTIENT le mot sans l'être (« c'est un chat ? ») :
//             à ne pas diffuser, l'auteur doit écrire le mot seul.
function guess(g, playerId, turnId, text, now) {
  const events = tick(g, now);
  const refus = (reason) => ({ ok: false, reason, message: REFUS[reason], correct: false, events });
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left) return refus('NOT_IN_GAME');
  if (events.some((e) => e.type === 'stop' && e.turnId === turnId)) return refus('TOO_LATE');
  if (g.phase !== 'drawing') return refus(turnId === g.turnId && g.phase !== 'choosing' ? 'TOO_LATE' : 'NOT_DRAWING');
  if (turnId !== g.turnId) return refus('STALE_TURN');
  const t = g.turn;
  if (id === t.drawer) return refus('IS_DRAWER');
  if (t.found.has(id)) return refus('ALREADY_FOUND');
  if (!t.expected.has(id)) return refus('NOT_IN_GAME');

  const brut = String(text == null ? '' : text);
  if (brut.length > SAISIE_MAX) return refus('TOO_LONG');
  const js = jetons(brut);
  const k = cleJetons(js);
  if (!k) return refus('EMPTY');

  if (t.word.cles.has(k)) {
    const points = Math.round(50 + 50 * (g.endsAt - now) / g.drawMs);
    t.found.set(id, { at: now, points, order: t.found.size + 1 });
    p.found += 1;
    events.push({ type: 'found', turnId: t.id, id, order: t.found.size });
    if (tousTrouve(t)) arreter(g, now, 'all-found', events);
    return { ok: true, correct: true, points, events };
  }

  // Fuite : une suite de jetons du message EST le mot.
  let withheld = false;
  for (let i = 0; i < js.length && !withheld; i++) {
    for (let n = 1; n <= t.word.maxJetons + 1 && i + n <= js.length; n++) {
      if (t.word.cles.has(cleJetons(js.slice(i, i + n)))) { withheld = true; break; }
    }
  }
  const close = !withheld && [...t.word.cles].some((c) => c.length >= PROCHE_MIN && distance(k, c, 1) === 1);
  return { ok: true, correct: false, close, withheld, events };
}

// Un joueur s'en va (onglet fermé, réseau coupé, présence expirée). Pas de
// retour en pleine partie en V1. Il garde ses points (classement), mais :
//   - dessinateur pendant le choix → tour sauté ;
//   - dessinateur pendant le dessin → le tour s'arrête (points comptés) ;
//   - devineur pendant le dessin → il sort de la moyenne du dessinateur, et
//     si tous les autres ont trouvé, le tour s'arrête ;
//   - moins de 2 présents → fin de partie INCOMPLÈTE (tour en cours compté).
function leave(g, playerId, now) {
  const events = tick(g, now);
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left || g.phase === 'end') return events;
  p.left = true;
  events.push({ type: 'left', id });
  const t = g.turn;
  const etaitDessinateur = t && t.drawer === id;
  if (t) t.expected.delete(id);

  if (presents(g).length < MIN_PLAYERS) {
    if (g.phase === 'drawing') arreter(g, now, etaitDessinateur ? 'drawer-left' : 'abandon', events);
    finir(g, false, events);
    return events;
  }
  if (g.phase === 'choosing' && etaitDessinateur) {
    events.push({ type: 'skipped', turnId: t.id, drawer: id });
    prochainTour(g, now, events);
  } else if (g.phase === 'drawing') {
    if (etaitDessinateur) arreter(g, now, 'drawer-left', events);
    else if (tousTrouve(t)) arreter(g, now, 'all-found', events);
  }
  // pause / reveal : rien. Un dessinateur parti sera sauté à son tour.
  return events;
}

// ------------------------------------------------------------------- lecture
// Rang de compétition sur le score, ex æquo purs (13, 13, 5 → 1, 1, 3). Les
// joueurs partis restent classés avec leurs points. À égalité, l'ordre de
// passage départage l'AFFICHAGE seulement, jamais le rang.
function ranking(g) {
  const lignes = g.order.map((id) => {
    const p = g.players.get(id);
    return { id, score: p.score, found: p.found, drawn: p.drawn, left: p.left };
  });
  lignes.sort((a, b) => b.score - a.score);
  lignes.forEach((l, i) => { l.rank = i > 0 && lignes[i - 1].score === l.score ? lignes[i - 1].rank : i + 1; });
  return lignes;
}

const scores = (g) => g.order.map((id) => ({ id, score: g.players.get(id).score }));

function gainsPublics(g) {
  const t = g.turn;
  return [...t.gains].map(([id, points]) => ({ id, points, drawer: id === t.drawer }));
}

// CE QUE TOUT LE MONDE A LE DROIT DE VOIR. Ni les propositions, ni le mot
// avant la révélation, ni les points d'un tour avant sa fin, ni aucune
// échéance absolue : seulement le temps restant, si `now` est fourni.
function view(g, now) {
  const t = g.turn;
  const enJeu = g.phase === 'drawing' || g.phase === 'pause';
  const revele = g.phase === 'reveal' || (g.phase === 'end' && t && t.reason);
  return {
    phase: g.phase,
    round: t ? t.round : null,
    rounds: g.rounds,
    turnId: g.turnId,
    drawer: t && g.phase !== 'end' ? t.drawer : null,
    order: g.order.slice(),
    drawMs: g.drawMs,
    remainingMs: Number.isFinite(now) && g.endsAt != null ? Math.max(0, g.endsAt - now) : null,
    pattern: enJeu ? gabarit(t) : null,
    letters: enJeu ? lettres(t.word.mot).length : null,
    found: enJeu ? [...t.found.keys()] : [],
    word: revele ? t.word.mot : null,
    reason: revele ? t.reason : null,
    gains: revele ? gainsPublics(g) : null,
    players: g.order.map((id) => {
      const p = g.players.get(id);
      return { id, score: p.score, left: p.left, found: p.found, drawn: p.drawn };
    }),
    complete: g.phase === 'end' ? g.complete : null,
    ranking: g.phase === 'end' ? ranking(g) : null,
  };
}

// La vue du DESSINATEUR courant : la vue publique + ses propositions (choix)
// ou son mot (dessin, pause). Pour tout autre joueur : null.
function drawerView(g, playerId, now) {
  const t = g.turn;
  if (!t || String(playerId) !== t.drawer) return null;
  if (!['choosing', 'drawing', 'pause'].includes(g.phase)) return null;
  const v = view(g, now);
  if (g.phase === 'choosing') v.choices = t.choices.map((w) => ({ mot: w.mot, niveau: w.niveau }));
  else v.word = t.word.mot;
  return v;
}

module.exports = {
  normaliser, jetons, lettres, distance, shuffle, roundsFor,
  createGame, tick, nextDeadline, choose, guess, leave, view, drawerView, ranking,
  MIN_PLAYERS, MAX_PLAYERS, CHOOSE_MS, DRAW_MS, DRAW_MS_LARGE, LARGE_AFTER, PAUSE_MS, REVEAL_MS,
  CHOICES, NIVEAUX, HINTS, SAISIE_MAX, MOT_MIN, MOT_MAX, PROCHE_MIN, REFUS,
};
