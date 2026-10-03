// Outils communs aux tests WebSocket de ce dépôt (test.js, test-16.js). Pas un
// test : un client qui garde TOUT ce qu'il reçoit, des attentes sur condition
// (jamais de délai fixe), des robots joueurs, et l'inspecteur de fil qui
// vérifie champ par champ qu'aucun message ne trahit le mot ni une échéance.
'use strict';
const WebSocket = require('ws');
const E = require('./engine.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function compteur() {
  let ok = 0, ko = 0;
  const t = (nom, cond, detail) => {
    if (cond) { ok++; console.log('OK   ' + nom); }
    else { ko++; console.log('KO   ' + nom + (detail ? ' — ' + detail : '')); }
  };
  t.bilan = () => ({ ok, ko });
  return t;
}

// Un client : il répond à la présence (sauf si on le lui interdit), garde tous
// les messages, et sait attendre le prochain qui satisfait une condition.
function client(url, nom) {
  const ws = new WebSocket(url);
  const c = { ws, nom, msgs: [], repond: true, ferme: null, lu: 0, ecouteurs: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.type === 'presence' && m.remplace !== true && c.repond) ws.send(JSON.stringify({ action: 'presence', n: m.n }));
    for (const f of c.ecouteurs) f(m);
  });
  ws.on('close', (code, why) => { c.ferme = { code, raison: String(why) }; });
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  c.wait = async (pred, ms = 5000, depuis = c.lu) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      for (let i = depuis; i < c.msgs.length; i++) if (pred(c.msgs[i])) { c.lu = i + 1; return c.msgs[i]; }
      await sleep(3);
    }
    return null;
  };
  c.suite = (pred, ms) => c.wait(pred, ms, c.msgs.length);
  c.tous = (pred) => c.msgs.filter(pred);
  c.dernier = (type) => [...c.msgs].reverse().find((m) => m.type === type);
  c.on = (f) => c.ecouteurs.push(f);
  return c;
}

async function joindre(c, nom, code, avatar) {
  await c.open;
  const msg = { action: 'join', name: nom, avatar: avatar || { kind: 'emoji', emoji: '🎨' } };
  if (code) msg.code = code;
  c.send(msg);
  const you = await c.wait((m) => m.type === 'you' || m.type === 'error');
  if (!you || you.type === 'error') throw new Error(`${nom} : join refusé (${you && you.message})`);
  c.id = you.id;
  c.code = you.code;
  return you;
}

async function attendre(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await sleep(3); }
  return false;
}

// ----------------------------------------------------------------- robots
// Un robot joue comme un humain pressé, en temps réel :
//   dessinateur : choisit (index `choix`, ou rien si `choix === null` : tirage
//   auto), puis trace `traits` traits ; il note le mot dans `carnet` — c'est
//   CE QUE LE TEST SAIT, pas ce que le serveur dit aux devineurs ;
//   devineur : après `delai` ms, propose `rate` puis le mot du carnet, si
//   `devine(turnId)` le veut.
function robot(c, carnet, o = {}) {
  const opts = { choix: 0, delai: 30, traits: 2, devine: () => true, rate: null, ...o };
  c.robot = opts;
  c.on((m) => {
    if (opts.off) return;
    if (m.type === 'choices' && opts.choix !== null) {
      setTimeout(() => c.send({ action: 'choose', turnId: m.turnId, index: opts.choix }), 5);
    } else if (m.type === 'drawing' && m.word) {
      carnet.set(m.turnId, m.word);
      for (let k = 0; k < opts.traits; k++) {
        c.send({ action: 'stroke', turnId: m.turnId, s: k + 1, c: k % 12, w: k % 3, p: [10 * k, 10, 10 * k + 50, 60], end: true });
      }
    } else if (m.type === 'drawing' && opts.devine(m.turnId)) {
      const turnId = m.turnId;
      setTimeout(async () => {
        if (opts.rate) c.send({ action: 'guess', turnId, text: opts.rate });
        await attendre(() => carnet.has(turnId), 2000);
        await sleep(opts.rate ? 400 : 0);    // pas deux devinettes dans la même seconde de débit
        if (carnet.has(turnId)) c.send({ action: 'guess', turnId, text: carnet.get(turnId) });
      }, opts.delai);
    }
  });
  return c;
}

// ---------------------------------------------------------------- le fil
// Chaque type de message a ses champs, et seulement eux. Un champ de plus —
// « juste pour l'affichage » — c'est typiquement par là qu'un secret finit par
// fuiter : le test refuse tout champ inconnu.
const CHAMPS = {
  presence: ['type', 'n', 'cle', 'remplace'],
  you: ['type', 'id', 'code', 'host'],
  lobby: ['type', 'code', 'phase', 'max', 'players'],
  snapshot: ['type', 'code', 'you', 'host', 'phase', 'round', 'rounds', 'turnId', 'drawer', 'order', 'drawMs', 'remainingMs',
    'pattern', 'letters', 'found', 'word', 'reason', 'gains', 'words', 'players', 'strokes', 'complete', 'ranking'],
  turn: ['type', 'turnId', 'round', 'rounds', 'drawer', 'remainingMs', 'players'],
  choices: ['type', 'turnId', 'words', 'remainingMs'],
  drawing: ['type', 'turnId', 'drawer', 'auto', 'pattern', 'letters', 'remainingMs', 'word'],
  hint: ['type', 'turnId', 'pattern'],
  found: ['type', 'turnId', 'id', 'order'],
  stop: ['type', 'turnId', 'reason'],
  'turn-end': ['type', 'turnId', 'word', 'reason', 'gains', 'scores', 'remainingMs'],
  skipped: ['type', 'turnId', 'drawer'],
  left: ['type', 'id', 'host', 'players'],
  chat: ['type', 'turnId', 'id', 'text', 'scope'],
  close: ['type', 'turnId'],
  refused: ['type', 'action', 'turnId', 'reason', 'message'],
  stroke: ['type', 'turnId', 's', 'c', 'w', 'p', 'end'],
  undo: ['type', 'turnId', 's'],
  clear: ['type', 'turnId'],
  results: ['type', 'complete', 'host', 'ranking'],
  error: ['type', 'message'],
};
const SOUS = {
  players: ['id', 'name', 'avatar', 'host', 'score', 'left', 'found', 'drawn'],
  scores: ['id', 'score'],
  gains: ['id', 'points', 'drawer'],
  ranking: ['id', 'name', 'avatar', 'rank', 'score', 'found', 'drawn', 'left'],
  words: ['word', 'level'],
  strokes: ['s', 'c', 'w', 'p', 'end'],
  avatar: ['kind', 'emoji', 'src'],
};
// Sur les NOMS de champs : l'état interne du moteur n'a rien à faire sur le fil.
const CLES_INTERDITES = /endsat|deadline|startedat|^at$|timestamp|expected|proposed|choices|cles|random|hints|revealed|^ms$/i;
const MAX_DUREE = 80000;

// Rend la liste des écarts (vide = fil propre).
function inspecterFil(msgs) {
  const ecarts = [];
  const objet = (o, champs, ou) => { for (const k of Object.keys(o)) if (!champs.includes(k)) ecarts.push(`${ou} : champ inattendu « ${k} »`); };
  const parcourir = (o, ou, cle) => {
    if (Array.isArray(o)) { o.forEach((x) => parcourir(x, ou, cle)); return; }
    if (typeof o === 'number') {
      // Ni horloge ni échéance : aucun nombre au-delà d'une durée de phase,
      // sauf l'identifiant de trait, choisi par le client.
      if (cle !== 's' && o > MAX_DUREE) ecarts.push(`${ou} : ${cle}=${o} ressemble à un instant`);
      if ((cle === 'remainingMs' || cle === 'drawMs') && (o < 0 || o > MAX_DUREE)) ecarts.push(`${ou} : ${cle}=${o} hors bornes`);
      return;
    }
    if (!o || typeof o !== 'object') return;
    if (SOUS[cle]) objet(o, SOUS[cle], `${ou} ${cle}`);
    for (const [k, v] of Object.entries(o)) {
      if (CLES_INTERDITES.test(k)) ecarts.push(`${ou} : champ interdit « ${k} »`);
      parcourir(v, ou, k);
    }
  };
  msgs.forEach((m, i) => {
    const ou = `#${i} ${m.type}`;
    const champs = CHAMPS[m.type];
    if (!champs) { ecarts.push(`${ou} : type inconnu`); return; }
    objet(m, champs, ou);
    for (const [k, v] of Object.entries(m)) {
      if (CLES_INTERDITES.test(k)) ecarts.push(`${ou} : champ interdit « ${k} »`);
      parcourir(v, ou, k);
    }
  });
  return ecarts;
}

// Toutes les chaînes d'un message, sauf son type (« chat » est un type de
// message ET un mot de la fixture).
const chaines = (o, acc = []) => {
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => chaines(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'type') chaines(v, acc);
  return acc;
};
// Le message contient-il `mot` (tel quel, ou sans accent ni séparateur) ?
function contient(m, mot) {
  const cle = E.lettres(mot);
  return chaines(m).some((s) => s.toLowerCase().includes(mot.toLowerCase()) || (cle.length >= 4 && E.lettres(s).includes(cle)));
}

// LE TEST DES SECRETS, pour un client : entre `turn` T et `turn-end` T, aucune
// des propositions du tour T n'apparaît chez lui s'il n'est pas le dessinateur
// de T — sauf dans un chat entre trouveurs (il ne le reçoit qu'après avoir
// trouvé). `tours` : turnId → { drawer, choices: [mot…] }, relevé côté serveur.
function fuites(c, tours) {
  const ecarts = [];
  let t = null;
  c.msgs.forEach((m, i) => {
    if (m.type === 'turn') t = m.turnId;
    if (m.type === 'snapshot' && m.phase !== 'end') t = m.turnId;
    if (t == null) return;
    const tour = tours.get(t);
    if (!tour || tour.drawer === c.id) { if (m.type === 'turn-end' && m.turnId === t) t = null; return; }
    if (m.type === 'turn-end' && m.turnId === t) { t = null; return; }
    if (m.type === 'chat' && m.scope === 'found') return;
    for (const mot of tour.choices) if (contient(m, mot)) ecarts.push(`${c.nom} #${i} ${m.type} (tour ${t}) contient « ${mot} »`);
  });
  return ecarts;
}

module.exports = { sleep, compteur, client, joindre, attendre, robot, inspecterFil, fuites, contient };
