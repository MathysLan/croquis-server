// Test bout en bout du serveur : de vrais clients WebSocket, un vrai serveur
// (dans ce processus), de vraies minuteries — raccourcies.
//
//   node test.js
//
// 1. salon, hôte, refus de transport ; 2. une partie à deux, pilotée à la main
// (choix manuel puis auto, dessin, undo, clear, snapshot, devinettes, débit,
// indices, fin « tous trouvés », fin au chrono, client lent), finie par des
// robots ; 3. les départs (devineur, dessinateur au choix et au dessin, hôte,
// partie incomplète, onglet figé) ; 4. LE FIL : tout ce que chaque client a
// reçu, relu champ par champ — le mot ne sort jamais avant le `turn-end`.
process.env.PORT = process.env.PORT || '8795';
process.env.TEST_CHOOSE_MS = '600';
process.env.TEST_DRAW_MS = '4000';      // indices à 2 000 et 3 000 ms
process.env.TEST_PAUSE_MS = '150';
process.env.TEST_REVEAL_MS = '250';
process.env.PRESENCE_MS = '150';
process.env.ABSENCE_MS = '700';
process.env.PRESENCE_KILL_MS = '300';
process.env.PRESENCE_QUIET = '1';
const http = require('node:http');
const { rooms, MAX_POINTS_TRAIT } = require('./server.js');
const O = require('./test-outils.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const CHOOSE = 600, DRAW = 4000, PAUSE = 150;
const t = O.compteur();
const tous = [];
// turnId → { drawer, choices } relevé CÔTÉ SERVEUR, par room : la vérité
// contre laquelle on relit le fil de chacun.
const toursDe = new Map();

function relever(code) {
  const r = rooms.get(code);
  if (!r || !r.game || !r.game.turn) return;
  const tr = r.game.turn;
  const tours = toursDe.get(code) || toursDe.set(code, new Map()).get(code);
  const e = tours.get(tr.id) || { drawer: tr.drawer, choices: [] };
  for (const w of [...tr.choices, tr.word].filter(Boolean)) if (!e.choices.includes(w.mot)) e.choices.push(w.mot);
  tours.set(tr.id, e);
}

function nouveau(nom) {
  const c = O.client(URL, nom);
  tous.push(c);
  c.on((m) => { if (c.code && ['turn', 'drawing', 'snapshot'].includes(m.type)) relever(c.code); });
  return c;
}

async function table(n, prefixe) {
  const cs = [];
  const h = nouveau(prefixe + '0');
  const you = await O.joindre(h, prefixe + '0');
  cs.push(h);
  for (let i = 1; i < n; i++) {
    const c = nouveau(prefixe + i);
    await O.joindre(c, prefixe + i, you.code);
    cs.push(c);
  }
  await O.attendre(() => h.dernier('lobby') && h.dernier('lobby').players.length === n);
  return { cs, h, code: you.code, parId: Object.fromEntries(cs.map((c) => [c.id, c])) };
}

// Le mot du tour en cours, imposé côté serveur AVANT le choix (les
// propositions envoyées au dessinateur restent celles tirées : seul le mot
// derrière l'index change). `toutes` : les trois, pour un tirage automatique.
function forcer(code, mot, toutes) {
  const g = rooms.get(code).game;
  const w = g.words.find((x) => x.mot === mot);
  if (toutes) g.turn.choices = [w, w, w];
  else g.turn.choices[0] = w;
  relever(code);
}
const wsServeur = (code, id) => rooms.get(code).players.find((p) => p.id === id).ws;
const fermer = (cs) => cs.forEach((c) => { try { c.ws.terminate(); } catch (_) {} });
const index = (c) => c.msgs.length;
const depuis = (c, i, pred) => c.msgs.slice(i).filter(pred);
const get = (path) => new Promise((res) => http.get(`http://127.0.0.1:${process.env.PORT}${path}`, (r) => {
  let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b }));
}).on('error', () => res({ status: 0, body: '' })));

(async () => {
  // ============================================================ 0. santé
  const h = await get('/');
  t('[santé] GET / → 200 « croquis-server ok »', h.status === 200 && /croquis-server ok/.test(h.body));

  // ======================================================= 1. salon et hôte
  const A = nouveau('A');
  const youA = await O.joindre(A, 'Alice');
  t('[1] créer : code à 4 lettres, le créateur est l hôte', /^[A-Z]{4}$/.test(youA.code) && youA.host === true);
  const B = nouveau('B');
  const youB = await O.joindre(B, 'Bruno', youA.code.toLowerCase());
  t('[1] rejoindre (code en minuscules accepté) : pas hôte', youB.code === youA.code && youB.host === false);
  const lob = await A.wait((m) => m.type === 'lobby' && m.players.length === 2);
  t('[1] salon à 2 : deux joueurs, un seul hôte, max 16', !!lob && lob.players.filter((p) => p.host).length === 1 && lob.max === 16
    && lob.players.find((p) => p.host).id === A.id);

  const X = nouveau('X');
  await X.open;
  X.send({ action: 'guess', turnId: 1, text: 'chat' });
  t('[4] action avant join : refusée', /pas encore dans une partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'join', name: 'X', code: 'ZZZZ' });
  t('[4] code inconnu : refusé', /aucune partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.ws.send('pas du json');
  t('[4] message illisible : refusé', /illisible/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'resume', code: youA.code, token: 'abc' });
  t('[4] resume : prévu mais refusé en V1', /reprise non disponible/.test((await X.wait((m) => m.type === 'error')).message));
  B.send({ action: 'join', name: 'B2', code: youA.code });
  t('[4] join deux fois : refusé', /déjà dans une partie/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'danse' });
  t('[4] action inconnue : refusée', /action inconnue/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'start' });
  t('[4] un invité ne lance pas', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'lobby' });
  t('[4] un invité ne ramène pas au salon', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  {
    const S = nouveau('S');
    await O.joindre(S, 'Solo');
    S.send({ action: 'start' });
    t('[4] hôte seul : il faut 2 joueurs', /au moins 2/.test((await S.suite((m) => m.type === 'error')).message));
    const N = nouveau('N');
    await O.joindre(N, '‮abc\u0007 ' + 'x'.repeat(30), S.code);
    const l = await S.wait((m) => m.type === 'lobby' && m.players.length === 2);
    t('[4] pseudo nettoyé (contrôles, sens d écriture) et coupé à 16', l.players[1].name === 'abc ' + 'x'.repeat(12));
    fermer([S, N]);
  }

  // ======================================= 2. partie à deux, pas à pas
  const code = youA.code;
  const parId = { [A.id]: A, [B.id]: B };
  const iA = index(A), iB = index(B);
  A.send({ action: 'start' });
  const snapA = await A.wait((m) => m.type === 'snapshot', 3000, iA);
  const snapB = await B.wait((m) => m.type === 'snapshot', 3000, iB);
  const turn1 = await B.wait((m) => m.type === 'turn', 3000, iB);
  t('[5] lancement : un snapshot chacun (identité, ordre, 3 manches), rien de privé',
    !!snapA && !!snapB && snapA.you === A.id && snapB.you === B.id && snapA.rounds === 3 && snapA.phase === 'choosing'
    && snapA.words === null && snapB.words === null && snapA.players.every((p) => p.name && p.avatar) && snapA.order.length === 2);
  t('[5] puis turn 1, manche 1/3, 15 s ramenées à 600 ms', !!turn1 && turn1.turnId === 1 && turn1.round === 1 && turn1.rounds === 3
    && turn1.remainingMs > 0 && turn1.remainingMs <= CHOOSE);
  const D1 = parId[turn1.drawer], G1 = D1 === A ? B : A;
  const ch = await D1.wait((m) => m.type === 'choices', 2000, D1 === A ? iA : iB);
  t('[7] choices : 3 mots (facile, moyen, difficile) au dessinateur', !!ch && ch.words.length === 3 && ch.words.map((w) => w.level).join() === 'facile,moyen,difficile');
  t('[7] choices : jamais chez le devineur', G1.tous((m) => m.type === 'choices').length === 0);
  forcer(code, 'parapluie');
  G1.send({ action: 'choose', turnId: 1, index: 0 });
  const rc = await G1.suite((m) => m.type === 'refused');
  t('[5] un devineur ne choisit pas (NOT_DRAWER, à lui seul)', rc && rc.reason === 'NOT_DRAWER' && rc.action === 'choose');
  D1.send({ action: 'choose', turnId: 1, index: 7 });
  t('[5] index invalide : BAD_CHOICE', (await D1.suite((m) => m.type === 'refused')).reason === 'BAD_CHOICE');
  let iD = index(D1), iG = index(G1);
  D1.send({ action: 'choose', turnId: 1, index: 0 });
  const drD = await D1.wait((m) => m.type === 'drawing', 2000, iD);
  const drG = await G1.wait((m) => m.type === 'drawing', 2000, iG);
  t('[5] choix manuel : le dessinateur reçoit SON mot', drD && drD.word === 'parapluie' && drD.auto === false);
  t('[5] choix manuel : le devineur reçoit le gabarit, pas le mot', drG && !('word' in drG) && drG.pattern === '_________' && drG.letters === 9
    && drG.remainingMs > DRAW - 300 && drG.remainingMs <= DRAW);

  // ---- dessin relayé
  iD = index(D1); iG = index(G1);
  D1.send({ action: 'stroke', turnId: 1, s: 1, c: 3, w: 1, p: [0, 0, 500, 375] });
  D1.send({ action: 'stroke', turnId: 1, s: 1, p: [1000, 750], end: true });
  const st = [];
  await O.attendre(() => (st.splice(0, st.length, ...depuis(G1, iG, (m) => m.type === 'stroke'))).length === 2, 2000);
  t('[8] trait relayé au devineur, en deux lots, à l identique',
    st.length === 2 && st[0].s === 1 && st[0].c === 3 && st[0].w === 1 && st[0].p.join() === '0,0,500,375' && st[0].end === false
    && st[1].p.join() === '1000,750' && st[1].end === true && st[1].c === 3);
  const mauvais = [
    { s: 2, c: 0, w: 0, p: [1001, 0] }, { s: 2, c: 0, w: 0, p: [0, 751] }, { s: 2, c: 0, w: 0, p: [-1, 0] },
    { s: 2, c: 0, w: 0, p: [1.5, 0] }, { s: 2, c: 0, w: 0, p: [10, 10, 20] }, { s: 2, c: 13, w: 0, p: [0, 0] },
    { s: 2, c: 0, w: 3, p: [0, 0] }, { s: 2, c: 0, w: 0, p: Array(130).fill(1) }, { s: 2.5, c: 0, w: 0, p: [0, 0] },
    { s: 1, c: 0, w: 0, p: [0, 0] }, { s: 2, c: 0, w: 0, p: [] }, { s: 2, c: 0, w: 0, p: '0,0' }, { s: 2, c: 0, w: 0, p: [0, 0], end: 'oui' },
  ];
  for (const m of mauvais) D1.send({ action: 'stroke', turnId: 1, ...m });
  await O.attendre(() => depuis(D1, iD, (m) => m.type === 'refused').length === mauvais.length, 2000);
  const refusTraits = depuis(D1, iD, (m) => m.type === 'refused');
  t(`[8] ${mauvais.length} traits invalides (hors cadre, flottant, impair, couleur, taille, trop de points, id, trait clos, vide…) : BAD_STROKE`,
    refusTraits.length === mauvais.length && refusTraits.every((r) => r.reason === 'BAD_STROKE' && r.action === 'stroke'));
  G1.send({ action: 'stroke', turnId: 1, s: 9, c: 0, w: 0, p: [0, 0] });
  t('[8] un devineur ne dessine pas', (await G1.suite((m) => m.type === 'refused')).reason === 'NOT_DRAWER');
  D1.send({ action: 'stroke', turnId: 0, s: 9, c: 0, w: 0, p: [0, 0] });
  t('[8] ancien turnId : STALE_TURN', (await D1.suite((m) => m.type === 'refused')).reason === 'STALE_TURN');
  t('[8] aucun trait invalide n a été relayé', depuis(G1, iG, (m) => m.type === 'stroke').length === 2);
  t('[8] le dessinateur ne reçoit JAMAIS ses traits', D1.tous((m) => m.type === 'stroke').length === 0);

  // ---- undo, clear, snapshot
  D1.send({ action: 'stroke', turnId: 1, s: 2, c: 12, w: 2, p: [100, 100, 200, 200], end: true });
  await G1.wait((m) => m.type === 'stroke' && m.s === 2, 2000, iG);
  iG = index(G1);
  D1.send({ action: 'undo', turnId: 1 });
  const un = await G1.wait((m) => m.type === 'undo', 2000, iG);
  t('[9] undo relayé : le dernier trait (s = 2, la gomme)', un && un.s === 2 && un.turnId === 1);
  t('[9] undo : retiré du dessin gardé', rooms.get(code).dessin.traits.map((x) => x.s).join() === '1');
  G1.send({ action: 'snapshot' });
  const sn1 = await G1.suite((m) => m.type === 'snapshot');
  t('[11] snapshot du devineur : le dessin complet (1 trait, 3 points), sans mot ni propositions',
    sn1 && sn1.phase === 'drawing' && sn1.strokes.length === 1 && sn1.strokes[0].p.join() === '0,0,500,375,1000,750' && sn1.strokes[0].end === true
    && sn1.word === null && sn1.words === null && sn1.pattern === '_________' && sn1.remainingMs > 0 && sn1.remainingMs < DRAW);
  D1.send({ action: 'snapshot' });
  const snD = await D1.suite((m) => m.type === 'snapshot');
  t('[11] snapshot du dessinateur : son mot', snD && snD.word === 'parapluie' && snD.strokes.length === 1);
  iG = index(G1);
  D1.send({ action: 'clear', turnId: 1 });
  t('[10] clear relayé', !!(await G1.wait((m) => m.type === 'clear' && m.turnId === 1, 2000, iG)));
  t('[10] clear : dessin vidé', rooms.get(code).dessin.traits.length === 0);
  D1.send({ action: 'undo', turnId: 1 });
  D1.send({ action: 'clear', turnId: 1 });
  await O.sleep(80);
  t('[9][10] undo / clear sur un dessin vide : rien n est relayé', depuis(G1, iG, (m) => m.type === 'undo' || m.type === 'clear').length === 1);

  // (La capacité du dessin — 150 traits, le 151e refusé, undo, clear — est
  // dans test-traits.js : 151 traits à 40 messages/s ne tiennent pas dans un
  // dessin de 4 s.)

  // ---- devinettes
  await O.sleep(1000);
  iD = index(D1); iG = index(G1);
  G1.send({ action: 'guess', turnId: 1, text: 'zzz' });
  const chat1 = await D1.wait((m) => m.type === 'chat', 2000, iD);
  t('[13] mauvaise réponse : chat public (au dessinateur aussi)', chat1 && chat1.text === 'zzz' && chat1.id === G1.id && chat1.scope === 'all');
  G1.send({ action: 'guess', turnId: 1, text: 'parapuie' });
  const proche = await G1.wait((m) => m.type === 'close', 2000, iG);
  await D1.wait((m) => m.type === 'chat' && m.text === 'parapuie', 2000, iD);
  t('[13] « presque » : close à l auteur seul, le texte reste public', !!proche && D1.tous((m) => m.type === 'close').length === 0);
  G1.send({ action: 'guess', turnId: 1, text: "c'est un parapluie ?" });
  const ret = await G1.wait((m) => m.type === 'refused', 2000, iG);
  t('[13] message qui contient le mot : refusé (WITHHELD) à l auteur, jamais relayé', ret && ret.reason === 'WITHHELD'
    && !D1.tous((m) => m.type === 'chat').some((m) => /parapluie/.test(m.text)));
  G1.send({ action: 'guess', turnId: 1, text: 'yyy' });
  t('[14] 4e devinette dans la seconde : TOO_FAST', (await G1.wait((m) => m.type === 'refused' && m.reason === 'TOO_FAST', 2000, iG)) !== null);
  await O.sleep(1000);
  G1.send({ action: 'guess', turnId: 1, text: 'x'.repeat(41) });
  const long = await G1.suite((m) => m.type === 'refused');
  t('[15] 41 caractères : TOO_LONG, pas relayé', long && long.reason === 'TOO_LONG' && !D1.tous((m) => m.type === 'chat').some((m) => m.text.length > 40));
  D1.send({ action: 'guess', turnId: 1, text: 'parapluie' });
  t('[12] le dessinateur ne devine pas (IS_DRAWER)', (await D1.suite((m) => m.type === 'refused')).reason === 'IS_DRAWER');
  iD = index(D1); iG = index(G1);
  G1.send({ action: 'guess', turnId: 1, text: 'Les PARAPLUIES' });
  const fo = await D1.wait((m) => m.type === 'found', 2000, iD);
  t('[12] bonne réponse : found public, sans texte ni points', fo && fo.id === G1.id && fo.order === 1 && Object.keys(fo).join() === 'type,turnId,id,order');
  t('[12] bonne réponse : jamais en chat', !D1.tous((m) => m.type === 'chat').some((m) => /parapl/i.test(m.text)));
  const stop1 = await G1.wait((m) => m.type === 'stop', 2000, iG);
  t('[18] seul devineur trouvé : stop all-found tout de suite', stop1 && stop1.reason === 'all-found');
  G1.send({ action: 'guess', turnId: 1, text: 'parapluie' });
  t('[12] après l arrêt : TOO_LATE (pas de seconde récompense)', (await G1.suite((m) => m.type === 'refused')).reason === 'TOO_LATE');
  const te1 = await G1.wait((m) => m.type === 'turn-end', 2000, iG);
  const g1 = te1 && te1.gains.find((x) => x.id === G1.id), d1 = te1 && te1.gains.find((x) => x.drawer);
  t('[18] turn-end après la pause : mot, raison, gains (devineur = dessinateur à 2)', te1 && te1.word === 'parapluie' && te1.reason === 'all-found'
    && g1.points >= 50 && g1.points <= 100 && d1.id === D1.id && d1.points === g1.points);
  const stopAt = G1.msgs.indexOf(stop1), teAt = G1.msgs.indexOf(te1);
  t('[18] ordre found → stop → turn-end', G1.msgs.findIndex((m) => m.type === 'found' && m.turnId === 1) < stopAt && stopAt < teAt);
  t('[12] score appliqué', te1.scores.find((x) => x.id === G1.id).score === g1.points);

  // ---- tour 2 : choix AUTOMATIQUE, indices, fin au chrono
  const turn2 = await A.wait((m) => m.type === 'turn' && m.turnId === 2, 3000, 0);
  t('[26] tour 2 : l autre joueur dessine', turn2 && turn2.drawer === G1.id && turn2.round === 1);
  const D2 = parId[turn2.drawer], G2 = parId[turn2.drawer === A.id ? B.id : A.id];
  forcer(code, 'bougie', true);
  iD = index(D2); iG = index(G2);
  const dr2 = await G2.wait((m) => m.type === 'drawing' && m.turnId === 2, CHOOSE + 1000, iG);
  const dr2D = await D2.wait((m) => m.type === 'drawing' && m.turnId === 2, 1000, iD);
  t('[6] personne ne choisit : tirage auto à l échéance', dr2 && dr2.auto === true && dr2D.word === 'bougie' && dr2.pattern === '______');
  const h1 = await G2.wait((m) => m.type === 'hint' && m.turnId === 2, DRAW, iG);
  const h2 = await G2.wait((m) => m.type === 'hint' && m.turnId === 2, DRAW, G2.msgs.indexOf(h1) + 1);
  t('[17] indice à 50 % : une lettre de « bougie »', h1 && (h1.pattern.match(/_/g) || []).length === 5 && [...h1.pattern].every((x, i) => x === '_' || x === 'bougie'[i]));
  t('[17] indice à 75 % (6 lettres) : une 2e', h2 && (h2.pattern.match(/_/g) || []).length === 4);
  t('[17] le dessinateur reçoit les indices aussi', D2.tous((m) => m.type === 'hint' && m.turnId === 2).length === 2);
  const stop2 = await G2.wait((m) => m.type === 'stop' && m.turnId === 2, DRAW, iG);
  const te2 = await G2.wait((m) => m.type === 'turn-end' && m.turnId === 2, 1000, iG);
  t('[19] fin au chrono : stop time puis turn-end aussitôt, mot révélé, 0 point',
    stop2 && stop2.reason === 'time' && te2 && te2.word === 'bougie' && te2.gains.every((x) => x.points === 0));

  // ---- tour 3 : mot court (un seul indice), trait trop long, débit des traits, client lent
  const turn3 = await A.wait((m) => m.type === 'turn' && m.turnId === 3, 3000, 0);
  t('[27] tour 3 : manche 2, retour au premier dessinateur', turn3 && turn3.round === 2 && turn3.drawer === D1.id);
  forcer(code, 'chat');
  iD = index(D1); iG = index(G1);
  D1.send({ action: 'choose', turnId: 3, index: 0 });
  await G1.wait((m) => m.type === 'drawing' && m.turnId === 3, 2000, iG);
  const debut3 = iG;
  // un trait qui s'allonge par lots de 64 points jusqu'à dépasser 1 000
  const lot = Array.from({ length: 64 }, (_, k) => [k, k]).flat();
  D1.send({ action: 'stroke', turnId: 3, s: 1, c: 0, w: 0, p: lot });
  for (let k = 1; k < 16; k++) D1.send({ action: 'stroke', turnId: 3, s: 1, p: lot });
  const tl = await D1.wait((m) => m.type === 'refused', 2000, iD);
  t(`[8] polyline de plus de ${MAX_POINTS_TRAIT} points : STROKE_TOO_LONG`, tl && tl.reason === 'STROKE_TOO_LONG'
    && rooms.get(code).dessin.traits[0].p.length / 2 === 15 * 64);
  await O.sleep(1000);
  iD = index(D1);
  for (let s = 2; s < 60; s++) D1.send({ action: 'stroke', turnId: 3, s, c: 0, w: 0, p: [1, 1], end: true });
  await O.attendre(() => depuis(D1, iD, (m) => m.type === 'refused').length >= 18, 2000);
  t('[14] débit des traits : au-delà de 40 par seconde, TOO_FAST', depuis(D1, iD, (m) => m.type === 'refused' && m.reason === 'TOO_FAST').length >= 17);
  // client lent : son tampon d'envoi « gonfle » (simulé côté serveur)
  await O.sleep(1000);
  D1.send({ action: 'clear', turnId: 3 });
  await O.attendre(() => rooms.get(code).dessin.traits.length === 0, 1000);
  const wsG = wsServeur(code, G1.id);
  let tampon = 10 * 1024 * 1024;
  Object.defineProperty(wsG, 'bufferedAmount', { get: () => tampon, configurable: true });
  iG = index(G1);
  D1.send({ action: 'stroke', turnId: 3, s: 200, c: 4, w: 1, p: [1, 2, 3, 4], end: true });
  D1.send({ action: 'stroke', turnId: 3, s: 201, c: 5, w: 2, p: [5, 6], end: true });
  await O.attendre(() => rooms.get(code).dessin.traits.length === 2, 1000);
  await O.sleep(60);
  t('[11] client lent : les traits ne lui sont plus envoyés', depuis(G1, iG, (m) => m.type === 'stroke').length === 0);
  tampon = 0;
  D1.send({ action: 'stroke', turnId: 3, s: 202, c: 6, w: 0, p: [7, 8], end: true });
  const rattrape = await G1.wait((m) => m.type === 'snapshot', 2000, iG);
  t('[11] client lent revenu : un snapshot avec les 3 traits, au lieu du trait seul', rattrape && rattrape.strokes.map((x) => x.s).join() === '200,201,202'
    && depuis(G1, iG, (m) => m.type === 'stroke').length === 0);
  delete wsG.bufferedAmount;
  const h3 = [];
  await G1.wait((m) => m.type === 'turn-end' && m.turnId === 3, DRAW + 1000, iG);
  h3.push(...depuis(G1, debut3, (m) => m.type === 'hint' && m.turnId === 3));
  t('[17] « chat » (4 lettres) : un seul indice', h3.length === 1 && (h3[0].pattern.match(/_/g) || []).length === 3);

  // ---- tours 4 à 6 : les robots finissent la partie
  const carnet = new Map();
  O.robot(A, carnet, { delai: 50 });
  O.robot(B, carnet, { delai: 80 });
  const res = await A.wait((m) => m.type === 'results', 30000, 0);
  await B.wait((m) => m.type === 'results', 2000, 0);
  t('[27] 2 joueurs : 6 tours, 3 manches, chacun dessine 3 fois', res && res.complete === true
    && A.tous((m) => m.type === 'turn').map((m) => m.round).join() === '1,1,2,2,3,3'
    && res.ranking.every((r) => r.drawn === 3));
  t('[26] turnId de 1 à 6, dessinateurs en alternance',
    A.tous((m) => m.type === 'turn').map((m) => m.turnId).join() === '1,2,3,4,5,6'
    && A.tous((m) => m.type === 'turn').every((m, i, a) => i === 0 || m.drawer !== a[i - 1].drawer));
  // classement = somme des gains annoncés tour par tour
  const somme = {};
  for (const m of A.tous((x) => x.type === 'turn-end')) for (const g of m.gains) somme[g.id] = (somme[g.id] || 0) + g.points;
  t('[24] classement final : score = somme des gains de chaque turn-end', res.ranking.every((r) => r.score === (somme[r.id] || 0)));
  t('[24] classement trié, rang de compétition', res.ranking.every((r, i, a) => i === 0
    || (a[i - 1].score >= r.score && r.rank === (a[i - 1].score === r.score ? a[i - 1].rank : i + 1))));
  t('[24] classement : noms et avatars', res.ranking.every((r) => r.name && r.avatar && r.avatar.emoji));
  const dernier = A.msgs.filter((m) => m.type !== 'presence').pop();
  const fin6 = A.msgs.findIndex((m) => m.type === 'turn-end' && m.turnId === 6);
  t('[25] results APRÈS le turn-end du dernier tour, et c est le dernier message de jeu',
    dernier.type === 'results' && fin6 >= 0 && fin6 < A.msgs.indexOf(res));
  await O.sleep(300);
  t('[25] après results : plus rien (ni tour, ni minuterie)', A.msgs.slice(A.msgs.indexOf(res) + 1).every((m) => m.type === 'presence')
    && rooms.get(code).timer === null && rooms.get(code).phase === 'end');
  A.robot.off = true; B.robot.off = true;
  B.send({ action: 'guess', turnId: 6, text: 'x' });
  t('[25] devinette après la fin : NOT_PLAYING', (await B.suite((m) => m.type === 'refused')).reason === 'NOT_PLAYING');
  A.send({ action: 'lobby' });
  const retour = await B.suite((m) => m.type === 'lobby');
  t('[25] l hôte ramène au salon (revanche possible)', retour && retour.phase === 'lobby' && retour.players.length === 2);

  // ============================================== 3. départs
  // ---- devineur qui part, chat entre trouveurs, dessinateur qui part au choix
  {
    const T = await table(4, 'Q');
    const { cs, code: c4 } = T;
    const i0 = cs.map(index);
    T.h.send({ action: 'start' });
    const tr = await T.h.wait((m) => m.type === 'turn', 2000, i0[0]);
    const D = T.parId[tr.drawer];
    const [g1, g2, g3] = cs.filter((c) => c !== D);
    forcer(c4, 'escargot');
    D.send({ action: 'choose', turnId: tr.turnId, index: 0 });
    await g1.wait((m) => m.type === 'drawing', 2000, i0[cs.indexOf(g1)]);
    g1.send({ action: 'guess', turnId: tr.turnId, text: 'escargots' });
    await D.wait((m) => m.type === 'found' && m.id === g1.id, 2000, 0);
    const i3 = index(g3), i2 = index(g2), iDd = index(D), i1 = index(g1);
    g1.send({ action: 'guess', turnId: tr.turnId, text: 'trop facile' });
    const cf = await D.wait((m) => m.type === 'chat', 2000, iDd);
    await g1.wait((m) => m.type === 'chat', 2000, i1);
    await O.sleep(60);
    t('[13] un trouveur écrit encore : chat « found » au dessinateur et aux trouveurs seulement', cf && cf.scope === 'found' && cf.text === 'trop facile'
      && depuis(g3, i3, (m) => m.type === 'chat').length === 0 && depuis(g2, i2, (m) => m.type === 'chat').length === 0);
    g2.ws.close();
    const lv = await D.wait((m) => m.type === 'left' && m.id === g2.id, 2000, iDd);
    t('[21] devineur parti : left diffusé, le tour continue', lv && lv.players.find((p) => p.id === g2.id).left === true && rooms.get(c4).game.phase === 'drawing');
    g3.send({ action: 'guess', turnId: tr.turnId, text: 'escargot' });
    const te = await D.wait((m) => m.type === 'turn-end', 3000, iDd);
    const pts = (id) => te.gains.find((x) => x.id === id).points;
    t('[21] le dernier présent trouve → all-found ; dessinateur = moyenne des 2 restants',
      te && te.reason === 'all-found' && pts(D.id) === Math.round((pts(g1.id) + pts(g3.id)) / 2) && !te.gains.some((x) => x.id === g2.id));
    // tour 2 : son dessinateur part pendant le choix
    const tr2 = await T.h.wait((m) => m.type === 'turn' && m.turnId === 2, 3000, 0);
    const D2 = T.parId[tr2.drawer];
    const temoin = cs.find((c) => c !== D2 && c !== g2);
    const iT = index(temoin);
    D2.ws.close();
    const sk = await temoin.wait((m) => m.type === 'skipped', 2000, iT);
    const tr3 = await temoin.wait((m) => m.type === 'turn' && m.turnId === 3, 2000, iT);
    t('[20] dessinateur parti au choix : skipped, puis le tour suivant tout de suite', sk && sk.drawer === D2.id && tr3 && tr3.drawer !== D2.id
      && temoin.msgs.indexOf(sk) < temoin.msgs.indexOf(tr3));
    const restants = cs.filter((c) => c !== g2 && c !== D2);
    const iR = restants.map(index);
    restants[0].ws.close();
    const fin = await restants[1].wait((m) => m.type === 'results', 2000, iR[1]);
    t('[23] moins de 2 joueurs : results complete:false, partis compris', fin && fin.complete === false && fin.ranking.length === 4
      && fin.ranking.filter((r) => r.left).length === 3);
    fermer(cs);
  }

  // ---- dessinateur qui part en plein dessin
  {
    const T = await table(3, 'R');
    const i0 = T.cs.map(index);
    T.h.send({ action: 'start' });
    const tr = await T.h.wait((m) => m.type === 'turn', 2000, i0[0]);
    const D = T.parId[tr.drawer];
    const [g1, g2] = T.cs.filter((c) => c !== D);
    forcer(T.code, 'boussole');
    D.send({ action: 'choose', turnId: 1, index: 0 });
    await g1.wait((m) => m.type === 'drawing', 2000, 0);
    g1.send({ action: 'guess', turnId: 1, text: 'boussole' });
    await g2.wait((m) => m.type === 'found', 2000, 0);
    const i2 = index(g2);
    D.ws.close();
    const st = await g2.wait((m) => m.type === 'stop', 2000, i2);
    const te = await g2.wait((m) => m.type === 'turn-end', 2000, i2);
    t('[20] dessinateur parti en plein dessin : stop drawer-left, turn-end aussitôt', st && st.reason === 'drawer-left' && te && te.reason === 'drawer-left'
      && te.word === 'boussole');
    t('[20] le trouveur garde ses points, le dessinateur a sa moyenne', te.gains.find((x) => x.id === g1.id).points >= 50
      && te.gains.find((x) => x.drawer).points === Math.round(te.gains.find((x) => x.id === g1.id).points / 2));
    const tr2 = await g2.wait((m) => m.type === 'turn' && m.turnId === 2, 2000, i2);
    t('[20] la partie continue à deux', tr2 && tr2.drawer !== D.id);
    fermer(T.cs);
  }

  // ---- hôte qui part : au salon, puis en partie
  {
    const T = await table(3, 'H');
    const [H0, H1, H2] = T.cs;
    const i1 = index(H1);
    H0.ws.close();
    const l = await H1.wait((m) => m.type === 'lobby' && m.players.length === 2, 2000, i1);
    t('[22] hôte parti au salon : un nouvel hôte', l && l.players.filter((p) => p.host).length === 1 && l.players.find((p) => p.host).id === H1.id);
    H1.send({ action: 'start' });
    const tr = await H2.wait((m) => m.type === 'turn', 2000, 0);
    t('[22] le nouvel hôte lance la partie', !!tr);
    const i2 = index(H2);
    H1.ws.close();
    const lv = await H2.wait((m) => m.type === 'left', 2000, i2);
    const fin = await H2.wait((m) => m.type === 'results', 2000, i2);
    t('[22] hôte parti en partie : left porte le nouvel hôte', lv && lv.host === H2.id);
    t('[23] puis partie incomplète (1 joueur), le dernier est l hôte des résultats', fin && fin.complete === false && fin.host === H2.id);
    fermer(T.cs);
  }

  // ---- onglet figé : la présence le ferme, le moteur le traite comme un départ
  {
    const T = await table(3, 'F');
    const i0 = T.cs.map(index);
    T.h.send({ action: 'start' });
    await T.h.wait((m) => m.type === 'turn', 2000, i0[0]);
    const fige = T.cs[2];
    fige.repond = false;
    const tem = T.cs[0];
    const lv = await tem.wait((m) => m.type === 'left' && m.id === fige.id, 4000, i0[0]);
    t('[présence] onglet figé : fermé (4000 absent) puis left', !!lv && (await O.attendre(() => fige.ferme && fige.ferme.code === 4000, 2000)));
    fermer(T.cs);
  }

  // ============================================================ 4. le fil
  await O.sleep(200);
  const ecarts = tous.flatMap((c) => O.inspecterFil(c.msgs).map((e) => `${c.nom} ${e}`));
  t(`[16] fil : ${tous.reduce((n, c) => n + c.msgs.length, 0)} messages relus, chaque champ attendu, aucun instant`, ecarts.length === 0, ecarts.slice(0, 5).join(' | '));
  const f = tous.flatMap((c) => (c.code && toursDe.has(c.code) ? O.fuites(c, toursDe.get(c.code)) : []));
  const nbTours = [...toursDe.values()].reduce((n, m) => n + m.size, 0);
  t(`[16] secret : sur ${nbTours} tours, aucune proposition chez un devineur avant le turn-end`, f.length === 0, f.slice(0, 5).join(' | '));
  t('[16] contre-épreuve de l inspecteur : un mot glissé dans un message est vu',
    O.fuites({ id: 'zz', nom: 'faux', msgs: [{ type: 'turn', turnId: 1 }, { type: 'hint', turnId: 1, pattern: 'parapluie' }] },
      new Map([[1, { drawer: 'yy', choices: ['parapluie'] }]])).length === 1
    && O.inspecterFil([{ type: 'turn', turnId: 1, endsAt: 5 }, { type: 'drawing', remainingMs: Date.now() }]).length >= 2);

  fermer(tous);
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
