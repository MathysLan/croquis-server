// croquis-server — serveur arbitre du jeu de dessin (nom provisoire).
//
// Même forme que les autres serveurs du portfolio (roquette, passeur,
// qui-ment…) : un seul WebSocket, du JSON, des rooms à code de 4 lettres, et
// une règle d'or — LE CLIENT N'A AUCUNE AUTORITÉ. Il envoie des intentions
// (« je choisis le 2e mot », « voici un bout de trait », « je propose
// chapeau ») ; engine.js décide de tout ce qui touche au jeu.
//
// Ce fichier ORCHESTRE le moteur, il ne recopie aucune de ses règles :
//   - une partie = E.createGame() ; choix, devinettes et départs passent par
//     E.choose(), E.guess(), E.leave() ;
//   - UNE minuterie par room, posée sur E.nextDeadline() ; à l'échéance,
//     E.tick(Date.now()), puis on la repose ;
//   - les événements du moteur deviennent des messages, et c'est tout.
// Le DESSIN, lui, n'est pas du jeu : c'est du transport. Ce fichier le valide
// (bornes, palette, tailles, débit), le garde (pour `snapshot`) et le relaie
// aux devineurs — jamais au dessinateur, qui dessine en local.
//
// LE MOT EST LE SECRET DE CE JEU. Il ne part qu'au dessinateur (`choices`,
// `drawing`, `snapshot`) jusqu'au `turn-end`. Une bonne réponse n'est jamais
// relayée (seul `found` part, sans texte). Aucun message ne porte d'horodatage
// ni d'échéance absolue : seulement `remainingMs`. test.js relit TOUT le fil
// de chaque client pour le vérifier.
//
// Pas de reprise en pleine partie en V1 : un joueur qui perd sa connexion est
// parti (le moteur décide de la suite) ; `resume` est refusé.
'use strict';
const http = require('node:http');
const { WebSocketServer } = require('ws');
const E = require('./engine.js');
const MOTS = require('./mots.js');
const { cleanAvatar } = require('./avatar.js');
const presenceJoueurs = require('./presence.js');

const PORT = process.env.PORT || 8095;
const AVATAR_DEFAUT = '🙂';

// Délais raccourcis : POUR LES TESTS SEULEMENT (personne ne pose ces variables
// en production ; sans elles, les valeurs du moteur s'appliquent).
const ms = (v) => (Number(v) > 0 ? Number(v) : undefined);
const REGLES = {
  chooseMs: ms(process.env.TEST_CHOOSE_MS),
  drawMs: ms(process.env.TEST_DRAW_MS),
  pauseMs: ms(process.env.TEST_PAUSE_MS),
  revealMs: ms(process.env.TEST_REVEAL_MS),
};

// ------------------------------------------------------------------ dessin
// Repère logique fixe ; le client met à l'échelle. Coordonnées entières.
const LARGEUR = 1000;
const HAUTEUR = 750;
const COULEURS = 13;            // 0–11 : la palette ; 12 : la gomme (couleur du fond)
const EPAISSEURS = 3;           // fin, moyen, gros
const MAX_TRAITS = 150;         // traits présents dans un dessin (undo en rend, clear les vide)
const MAX_POINTS_TRAIT = 1000;  // points d'une polyline
const MAX_POINTS_MSG = 64;      // points par message (le client envoie par lots de ~50 ms)
const MAX_ID_TRAIT = 1_000_000;

// Débit par connexion, sur une fenêtre d'une seconde. `stroke` couvre aussi
// undo et clear. Une devinette de trop est refusée (TOO_FAST), un bout de
// trait de trop aussi (le client doit le savoir : son dessin diverge).
const DEBIT = { tout: 80, stroke: 40, guess: 3, snapshot: 2 };

// Un client qui n'arrive plus à suivre (son tampon d'envoi gonfle) ne reçoit
// plus les traits un par un : quand il a vidé son tampon, il reçoit un
// `snapshot` (le dessin complet) à la place.
const LENT_HAUT = 512 * 1024;
const LENT_BAS = 64 * 1024;

// Refus propres au transport (les autres viennent de E.REFUS).
const REFUS = {
  ...E.REFUS,
  TOO_FAST: 'trop vite',
  NOT_PLAYING: 'aucune partie en cours',
  BAD_STROKE: 'trait invalide',
  TOO_MANY_STROKES: `${MAX_TRAITS} traits maximum`,
  STROKE_TOO_LONG: 'trait trop long',
  WITHHELD: 'écris juste le mot',
};

const rooms = new Map();

const nouveauCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join(''); }
  while (rooms.has(c));
  return c;
};

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcast = (room, obj, garder) => room.players.forEach((p) => { if (!garder || garder(p)) send(p.ws, obj); });

// Un texte venu d'un joueur et relayé aux autres : sans caractère de contrôle
// ni forçage du sens d'écriture (qui retourneraient l'affichage chez les
// autres). Le ZWJ des emoji reste.
const INVISIBLES = new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200e, 0x200f], [0x061c, 0x061c], [0x202a, 0x202e], [0x2066, 0x2069], [0x2028, 0x2029]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const nettoyer = (s) => String(s == null ? '' : s)
  .replace(INVISIBLES, '')
  .trim();

// ------------------------------------------------------------- ce qui se dit
const joueur = (room, id) => room.players.find((p) => p.id === id) || null;

// En partie : l'état des scores. Les noms et avatars ne partent qu'au
// `snapshot` (le client les garde) et dans `results` : à 16 joueurs avec
// photo, les renvoyer à chaque message ferait ~200 Ko à chaque fois.
const scores = (room) => E.view(room.game).players;

function lobbyState(room) {
  return { type: 'lobby', code: room.code, phase: room.phase, max: E.MAX_PLAYERS, players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, host: p.id === room.hostId })) };
}

function classement(room, ranking) {
  return ranking.map((r) => {
    const p = room.roster.get(r.id);
    return { id: r.id, name: p.name, avatar: p.avatar, rank: r.rank, score: r.score, found: r.found, drawn: r.drawn, left: r.left };
  });
}

// L'état complet, pour UN joueur : au lancement (sans la partie privée), et à
// la demande (`snapshot`, ou un client qui n'a pas suivi). Le dessinateur y
// trouve ses propositions ou son mot — personne d'autre.
function snapshot(room, p, prive = true) {
  const g = room.game;
  const now = Date.now();
  const v = (prive && E.drawerView(g, p.id, now)) || E.view(g, now);
  const avecDessin = ['drawing', 'pause', 'reveal'].includes(v.phase);
  return {
    type: 'snapshot',
    code: room.code,
    you: p.id,
    host: room.hostId,
    phase: v.phase,
    round: v.round,
    rounds: v.rounds,
    turnId: v.turnId,
    drawer: v.drawer,
    order: v.order,
    drawMs: v.drawMs,
    remainingMs: v.remainingMs,
    pattern: v.pattern,
    letters: v.letters,
    found: v.found,
    word: v.word,
    reason: v.reason,
    gains: v.gains,
    words: v.choices ? v.choices.map((w) => ({ word: w.mot, level: w.niveau })) : null,
    players: v.players.map((x) => ({ ...x, name: room.roster.get(x.id).name, avatar: room.roster.get(x.id).avatar, host: x.id === room.hostId })),
    strokes: avecDessin ? room.dessin.traits.map((t) => ({ s: t.s, c: t.c, w: t.w, p: t.p.slice(), end: t !== room.dessin.ouvert })) : [],
    complete: v.complete,
    ranking: v.ranking ? classement(room, v.ranking) : null,
  };
}

// Le temps restant de la phase EN COURS, si elle est bien celle de
// l'événement (un lot d'événements peut en enjamber plusieurs) ; sinon 0.
function reste(room, turnId, phases) {
  const g = room.game;
  if (g.turnId !== turnId || !phases.includes(g.phase)) return 0;
  return E.view(g, Date.now()).remainingMs;
}

// Les événements du moteur → les messages. Rien n'est inventé ici.
function diffuser(room, events) {
  const g = room.game;
  for (const e of events) {
    if (e.type === 'turn') {
      room.dessin = { turnId: e.turnId, traits: [], ouvert: null };
      room.players.forEach((p) => { p.ws.lent = false; });
      const remainingMs = reste(room, e.turnId, ['choosing']);
      broadcast(room, { type: 'turn', turnId: e.turnId, round: e.round, rounds: e.rounds, drawer: e.drawer, remainingMs, players: scores(room) });
      // Les propositions : au SEUL dessinateur, et seulement si ce tour est
      // encore celui du moteur (sinon elles ne servent plus à rien).
      const d = joueur(room, e.drawer);
      if (d && g.turnId === e.turnId && g.phase === 'choosing') {
        send(d.ws, { type: 'choices', turnId: e.turnId, words: g.turn.choices.map((w) => ({ word: w.mot, level: w.niveau })), remainingMs });
      }
    } else if (e.type === 'drawing') {
      const base = { type: 'drawing', turnId: e.turnId, drawer: e.drawer, auto: e.auto, pattern: e.pattern, letters: e.letters, remainingMs: reste(room, e.turnId, ['drawing']) };
      const memeTour = g.turnId === e.turnId;
      room.players.forEach((p) => {
        if (p.id === e.drawer) { if (memeTour) send(p.ws, { ...base, word: g.turn.word.mot }); }
        else send(p.ws, base);
      });
    } else if (e.type === 'hint') {
      broadcast(room, { type: 'hint', turnId: e.turnId, pattern: e.pattern });
    } else if (e.type === 'found') {
      broadcast(room, { type: 'found', turnId: e.turnId, id: e.id, order: e.order });
    } else if (e.type === 'stop') {
      if (room.dessin.turnId === e.turnId) room.dessin.ouvert = null;
      broadcast(room, { type: 'stop', turnId: e.turnId, reason: e.reason });
    } else if (e.type === 'reveal') {
      broadcast(room, { type: 'turn-end', turnId: e.turnId, word: e.word, reason: e.reason, gains: e.gains, scores: e.scores, remainingMs: reste(room, e.turnId, ['reveal']) });
    } else if (e.type === 'skipped') {
      broadcast(room, { type: 'skipped', turnId: e.turnId, drawer: e.drawer });
    } else if (e.type === 'left') {
      broadcast(room, { type: 'left', id: e.id, host: room.hostId, players: scores(room) });
    } else if (e.type === 'end') {
      terminer(room, e);
    }
  }
}

function terminer(room, e) {
  clearTimeout(room.timer);
  room.timer = null;
  room.phase = 'end';
  broadcast(room, { type: 'results', complete: e.complete, host: room.hostId, ranking: classement(room, e.ranking) });
}

// ------------------------------------------------------------- la minuterie
// Une seule par room, toujours posée sur l'échéance que donne le moteur. Une
// minuterie en retard ne change rien : le moteur date chaque transition de SON
// échéance, pas de l'heure du réveil.
function planifier(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (room.phase !== 'playing' || !room.game) return;
  const d = E.nextDeadline(room.game);
  if (d == null) return;
  room.timer = setTimeout(() => echeance(room), Math.max(0, d - Date.now()));
}

function echeance(room) {
  room.timer = null;
  if (rooms.get(room.code) !== room || room.phase !== 'playing') return;
  diffuser(room, E.tick(room.game, Date.now()));
  planifier(room);       // une minuterie un poil en avance ne fait rien : on repose
}

// Avant une action qui ne passe pas par le moteur (trait, undo, clear) : le
// moteur rattrape d'abord une échéance que la minuterie n'a pas encore vue.
function rattraper(room) {
  diffuser(room, E.tick(room.game, Date.now()));
  planifier(room);
}

// ------------------------------------------------------------------ partie
function lancer(room) {
  room.game = E.createGame({
    players: room.players.map((p) => p.id),
    now: Date.now(),
    random: Math.random,
    words: MOTS,
    regles: REGLES,
  });
  room.roster = new Map(room.players.map((p) => [p.id, { name: p.name, avatar: p.avatar }]));
  room.phase = 'playing';
  room.dessin = { turnId: 0, traits: [], ouvert: null };
  // L'identité de tous, une fois, sans rien de privé ; puis le premier tour
  // (et les propositions au seul dessinateur).
  room.players.forEach((p) => send(p.ws, snapshot(room, p, false)));
  diffuser(room, room.game.startEvents);
  planifier(room);
}

// --------------------------------------------------------------------- débit
function debit(ws, quoi) {
  const now = Date.now();
  const b = ws.debit || (ws.debit = {});
  const x = b[quoi] || (b[quoi] = { depuis: now, n: 0 });
  if (now - x.depuis >= 1000) { x.depuis = now; x.n = 0; }
  x.n += 1;
  return x.n <= DEBIT[quoi];
}

// -------------------------------------------------------------------- traits
const entier = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Rend un code de refus, ou null si le bout de trait est recevable.
function validerPoints(p, vide) {
  if (!Array.isArray(p) || p.length % 2) return 'BAD_STROKE';
  if (!vide && p.length < 2) return 'BAD_STROKE';
  if (p.length > 2 * MAX_POINTS_MSG) return 'BAD_STROKE';
  for (let i = 0; i < p.length; i += 2) {
    if (!entier(p[i], 0, LARGEUR) || !entier(p[i + 1], 0, HAUTEUR)) return 'BAD_STROKE';
  }
  return null;
}

// Les traits partent aux devineurs (jamais au dessinateur). Un client trop
// lent est sauté, puis remis d'aplomb par un snapshot quand il a rattrapé.
function relayer(room, obj) {
  const dessinateur = room.game.turn.drawer;
  for (const p of room.players) {
    if (p.id === dessinateur) continue;
    const ws = p.ws;
    if (ws.lent) {
      if (ws.bufferedAmount <= LENT_BAS) { ws.lent = false; send(ws, snapshot(room, p)); }
      continue;
    }
    if (ws.bufferedAmount > LENT_HAUT) { ws.lent = true; continue; }
    send(ws, obj);
  }
}

// ---------------------------------------------------------------- transport
const server = http.createServer((req, res) => {
  // Render veut une réponse HTTP pour son health check.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('croquis-server ok\n');
});
// 64 Ko : un join avec une photo de profil (≤ 12 Ko décodés) tient largement.
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
// Présence applicative : un onglet gelé ne reste pas compté dans sa room (voir
// presence.js). Le module ne fait que fermer le socket ; le départ habituel fait le reste.
const presence = presenceJoueurs.attach(wss);

wss.on('connection', (ws) => {
  let room = null, me = null;
  const fail = (message) => send(ws, { type: 'error', message });
  const refuser = (action, turnId, reason) => send(ws, {
    type: 'refused', action, turnId: Number.isInteger(turnId) ? turnId : null, reason, message: REFUS[reason] || reason,
  });
  // Une trame illisible ou trop grosse (> maxPayload) fait émettre `error` au
  // socket, puis `ws` le ferme (1009) et `close` fait le départ habituel. Sans
  // cet écouteur, l'erreur non traitée ferait tomber TOUT le serveur.
  ws.on('error', () => {});

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return fail('message illisible'); }
    if (!msg || typeof msg !== 'object') return fail('message illisible');
    if (presence.consume(ws, msg)) return;   // { action: 'presence' } : jamais « pas encore dans une partie »
    if (!debit(ws, 'tout')) return;
    const a = msg.action;

    if (a === 'join') {
      if (me) return fail('déjà dans une partie');
      const name = nettoyer(msg.name).slice(0, 16) || 'Joueur';
      // Emoji, ou photo de profil revalidée : voir avatar.js.
      const avatar = cleanAvatar(msg.avatar, AVATAR_DEFAUT);
      let r;
      if (msg.code) {
        r = rooms.get(String(msg.code).toUpperCase().trim());
        if (!r) return fail('aucune partie avec ce code');
        if (r.phase !== 'lobby') return fail('partie déjà commencée');
        if (r.players.length >= E.MAX_PLAYERS) return fail('partie complète');
      } else {
        const c = nouveauCode();
        r = { code: c, players: [], hostId: null, phase: 'lobby', game: null, roster: null, timer: null, dessin: null };
        rooms.set(c, r);
      }
      let id;
      do { id = Math.random().toString(36).slice(2, 9); } while (r.players.some((p) => p.id === id));
      room = r;
      me = { id, ws, name, avatar };
      room.players.push(me);
      if (!room.hostId) room.hostId = me.id;
      send(ws, { type: 'you', id: me.id, code: room.code, host: room.hostId === me.id });
      broadcast(room, lobbyState(room));
      return;
    }

    // Prévu par le contrat, PAS actif en V1 : aucune reprise en pleine partie.
    if (a === 'resume') return fail('reprise non disponible : rejoins une nouvelle partie');

    if (!room || !me) return fail('pas encore dans une partie');

    if (a === 'start') {
      if (me.id !== room.hostId) return fail("seul l'hôte lance la partie");
      if (room.phase === 'playing') return fail('partie déjà en cours');
      if (room.players.length < E.MIN_PLAYERS) return fail(`il faut au moins ${E.MIN_PLAYERS} joueurs`);
      return lancer(room);                  // depuis le salon, ou la fin (revanche) ; aucun réglage en V1
    }

    if (a === 'lobby') {
      if (me.id !== room.hostId) return fail("seul l'hôte ramène au salon");
      if (room.phase !== 'end') return;
      room.phase = 'lobby';
      room.game = null;
      room.roster = null;
      room.dessin = null;
      return broadcast(room, lobbyState(room));
    }

    if (a === 'snapshot') {
      if (!debit(ws, 'snapshot')) return;
      if (!room.game) return send(ws, lobbyState(room));
      return send(ws, snapshot(room, me));
    }

    if (a === 'choose') {
      if (room.phase !== 'playing') return refuser(a, msg.turnId, 'NOT_PLAYING');
      const r = E.choose(room.game, me.id, msg.turnId, msg.index, Date.now());
      diffuser(room, r.events);
      if (!r.ok) refuser(a, msg.turnId, r.reason);
      return planifier(room);
    }

    if (a === 'guess') {
      if (!debit(ws, 'guess')) return refuser(a, msg.turnId, 'TOO_FAST');
      if (room.phase !== 'playing') return refuser(a, msg.turnId, 'NOT_PLAYING');
      const g = room.game;
      const text = typeof msg.text === 'string' ? msg.text : '';
      const r = E.guess(g, me.id, msg.turnId, text, Date.now());
      diffuser(room, r.events);
      if (!r.ok) {
        // A déjà trouvé : il peut encore écrire, mais seulement aux autres
        // trouveurs et au dessinateur (eux connaissent le mot).
        const propre = nettoyer(text);
        if (r.reason === 'ALREADY_FOUND' && propre && text.length <= E.SAISIE_MAX) {
          const t = g.turn;
          broadcast(room, { type: 'chat', turnId: t.id, id: me.id, text: propre, scope: 'found' },
            (p) => p.id === t.drawer || t.found.has(p.id));
        } else refuser(a, msg.turnId, r.reason);
      } else if (r.correct) {
        // Rien de plus : `found` est parti (sans texte) avec les événements.
      } else if (r.withheld) {
        refuser(a, msg.turnId, 'WITHHELD');
      } else {
        broadcast(room, { type: 'chat', turnId: g.turnId, id: me.id, text: nettoyer(text), scope: 'all' });
        if (r.close) send(ws, { type: 'close', turnId: g.turnId });
      }
      return planifier(room);
    }

    if (a === 'stroke' || a === 'undo' || a === 'clear') {
      if (!debit(ws, 'stroke')) return refuser(a, msg.turnId, 'TOO_FAST');
      if (room.phase !== 'playing') return refuser(a, msg.turnId, 'NOT_PLAYING');
      rattraper(room);
      if (room.phase !== 'playing') return refuser(a, msg.turnId, 'NOT_PLAYING');
      const g = room.game;
      if (g.phase !== 'drawing') return refuser(a, msg.turnId, 'NOT_DRAWING');
      if (msg.turnId !== g.turnId) return refuser(a, msg.turnId, 'STALE_TURN');
      if (me.id !== g.turn.drawer) return refuser(a, msg.turnId, 'NOT_DRAWER');
      const d = room.dessin;

      if (a === 'undo') {
        const t = d.traits.pop();
        if (!t) return;
        if (t === d.ouvert) d.ouvert = null;
        return relayer(room, { type: 'undo', turnId: g.turnId, s: t.s });
      }
      if (a === 'clear') {
        if (!d.traits.length) return;
        d.traits = [];
        d.ouvert = null;
        return relayer(room, { type: 'clear', turnId: g.turnId });
      }

      const s = msg.s;
      const fin = msg.end === true;
      if (!entier(s, 0, MAX_ID_TRAIT) || (msg.end !== undefined && typeof msg.end !== 'boolean')) return refuser(a, msg.turnId, 'BAD_STROKE');
      let t;
      if (d.ouvert && d.ouvert.s === s) {
        // La suite du trait en cours (un lot vide est permis pour le clore).
        t = d.ouvert;
        const e = validerPoints(msg.p, fin);
        if (e) return refuser(a, msg.turnId, e);
        if ((t.p.length + msg.p.length) / 2 > MAX_POINTS_TRAIT) return refuser(a, msg.turnId, 'STROKE_TOO_LONG');
        t.p.push(...msg.p);
      } else {
        if (d.traits.some((x) => x.s === s)) return refuser(a, msg.turnId, 'BAD_STROKE');   // trait déjà clos
        if (!entier(msg.c, 0, COULEURS - 1) || !entier(msg.w, 0, EPAISSEURS - 1)) return refuser(a, msg.turnId, 'BAD_STROKE');
        const e = validerPoints(msg.p, false);
        if (e) return refuser(a, msg.turnId, e);
        if (d.traits.length >= MAX_TRAITS) return refuser(a, msg.turnId, 'TOO_MANY_STROKES');
        t = { s, c: msg.c, w: msg.w, p: msg.p.slice() };
        d.traits.push(t);               // un nouveau trait clôt le précédent
        d.ouvert = t;
      }
      if (fin) d.ouvert = null;
      return relayer(room, { type: 'stroke', turnId: g.turnId, s, c: t.c, w: t.w, p: msg.p.slice(), end: fin });
    }

    fail('action inconnue');
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players = room.players.filter((p) => p !== me);
    if (!room.players.length) {
      clearTimeout(room.timer);
      room.timer = null;
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === me.id) room.hostId = room.players[0].id;
    if (room.phase === 'playing') {
      // Pas de reprise en V1 : partir est définitif pour cette partie. Le
      // moteur décide (tour sauté, tour arrêté, dénominateur, fin incomplète).
      diffuser(room, E.leave(room.game, me.id, Date.now()));
      return planifier(room);
    }
    broadcast(room, lobbyState(room));     // salon, ou écran de fin (`phase: 'end'`)
  });
});

server.listen(PORT, () => console.log(`croquis-server à l'écoute sur :${PORT} — ${MOTS.length} mots (provisoires)`));

module.exports = {
  server, wss, rooms,
  LARGEUR, HAUTEUR, COULEURS, EPAISSEURS, MAX_TRAITS, MAX_POINTS_TRAIT, MAX_POINTS_MSG, DEBIT,
};
