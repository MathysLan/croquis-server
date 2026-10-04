// Seize robots, une partie entière, en temps réel.
//
//   node test-16.js
//
// Salon plein (le 17e est refusé), 1 manche de 16 tours, 60 s de dessin
// ramenées à 1 500 ms. Les robots devinent à des délais différents ; certains
// sèchent certains tours (fin au chrono), les autres trouvent (fin « tous
// trouvés »). À la fin : chacun a dessiné une fois, le classement est la somme
// des gains annoncés, et le fil de CHAQUE robot est relu — aucune proposition
// n'a fui chez un devineur avant le turn-end.
process.env.PORT = process.env.PORT || '8796';
process.env.TEST_CHOOSE_MS = '400';
process.env.TEST_DRAW_MS = '1500';
process.env.TEST_PAUSE_MS = '100';
process.env.TEST_REVEAL_MS = '150';
process.env.PRESENCE_QUIET = '1';
const { rooms } = require('./server.js');
const O = require('./test-outils.js');
const E = require('./engine.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const tours = new Map();
const PHOTO = 'data:image/webp;base64,' + require('fs').readFileSync(require('path').join(__dirname, 'test-fixtures', 'avatar-96.webp')).toString('base64');

(async () => {
  const cs = [];
  const nouveau = (nom) => {
    const c = O.client(URL, nom);
    c.on((m) => {
      if (!c.code || !['turn', 'drawing', 'snapshot'].includes(m.type)) return;
      const g = rooms.get(c.code) && rooms.get(c.code).game;
      if (!g || !g.turn) return;
      const e = tours.get(g.turn.id) || { drawer: g.turn.drawer, choices: [] };
      for (const w of [...g.turn.choices, g.turn.word].filter(Boolean)) if (!e.choices.includes(w.mot)) e.choices.push(w.mot);
      tours.set(g.turn.id, e);
    });
    return c;
  };
  const h = nouveau('R0');
  const you = await O.joindre(h, 'R0', null, { kind: 'image', emoji: '🦊', src: PHOTO });
  cs.push(h);
  for (let i = 1; i < 16; i++) {
    const c = nouveau('R' + i);
    await O.joindre(c, 'R' + i, you.code);
    cs.push(c);
  }
  const lob = await h.wait((m) => m.type === 'lobby' && m.players.length === 16, 5000, 0);
  t('[2] salon de 16', !!lob && lob.players.length === 16);
  const x = O.client(URL, 'R16');
  await x.open;
  x.send({ action: 'join', name: 'R16', code: you.code });
  t('[3] le 17e est refusé (partie complète)', /partie complète/.test((await x.wait((m) => m.type === 'error')).message));
  x.ws.terminate();

  // Les robots : délais de 30 à 480 ms. Aux tours 5, 10 et 15, UN robot sèche
  // (le n° turnId) : ces tours finissent au chrono (sauf s'il dessine), les autres « tous trouvés ».
  const carnet = new Map();
  cs.forEach((c, i) => O.robot(c, carnet, {
    choix: i % 4 === 3 ? null : i % 3,            // un robot sur quatre laisse le tirage auto
    delai: 30 + 30 * i,
    traits: 3,
    devine: (turnId) => !(turnId % 5 === 0 && i === turnId % 16),
    rate: i % 5 === 0 ? 'zzz' : null,
  }));
  const debut = Date.now();
  h.send({ action: 'start' });
  const res = await h.wait((m) => m.type === 'results', 60000, 0);
  const duree = Date.now() - debut;
  await O.attendre(() => cs.every((c) => c.dernier('results')), 3000);
  t(`[28] 16 joueurs jusqu'à la fin (${(duree / 1000).toFixed(1)} s) : results complete`, res && res.complete === true);
  const turns = h.tous((m) => m.type === 'turn');
  t('[28] 1 manche, 16 tours, 16 dessinateurs différents', res && turns.length === 16 && new Set(turns.map((m) => m.drawer)).size === 16
    && turns.every((m) => m.round === 1 && m.rounds === 1));
  t('[28] chacun a dessiné une fois', res.ranking.length === 16 && res.ranking.every((r) => r.drawn === 1 && !r.left));
  const snap = h.tous((m) => m.type === 'snapshot')[0];
  t('[28] au-delà de 8 joueurs : 60 s de dessin (ramenées à 1 500 ms par le test)', snap && snap.drawMs === 1500);
  const fins = h.tous((m) => m.type === 'turn-end');
  const raisons = fins.map((m) => m.reason);
  t(`[28] des tours finis « tous trouvés » (${raisons.filter((r) => r === 'all-found').length}) et au chrono (${raisons.filter((r) => r === 'time').length})`,
    fins.length === 16 && raisons.includes('all-found') && raisons.includes('time') && raisons.every((r) => r === 'all-found' || r === 'time'));
  t('[28] tirages automatiques et choix manuels mêlés', h.tous((m) => m.type === 'drawing').some((m) => m.auto) && h.tous((m) => m.type === 'drawing').some((m) => !m.auto));
  const somme = {};
  for (const m of fins) for (const g of m.gains) somme[g.id] = (somme[g.id] || 0) + g.points;
  t('[24] classement : score = somme des gains de chaque turn-end', res.ranking.every((r) => r.score === (somme[r.id] || 0)));
  t('[24] classement trié, rang de compétition (ex æquo purs)', res.ranking.every((r, i, a) => i === 0
    || (a[i - 1].score >= r.score && r.rank === (a[i - 1].score === r.score ? a[i - 1].rank : i + 1))));
  t('[24] la photo de profil traverse jusqu au classement, à l octet près', res.ranking.find((r) => r.id === h.id).avatar.src === PHOTO);
  t('[25] results est le dernier message de jeu chez les 16', cs.every((c) => c.msgs.filter((m) => m.type !== 'presence').pop().type === 'results'));
  // Les gains d'un tour sont ceux du moteur : un devineur entre 50 et 100, le
  // dessinateur la moyenne arrondie de ce qu'il a fait gagner (15 attendus).
  const coherents = fins.every((m) => {
    const d = m.gains.find((g) => g.drawer);
    const dev = m.gains.filter((g) => !g.drawer);
    const moy = Math.round(dev.reduce((n, g) => n + g.points, 0) / 15);
    return dev.every((g) => g.points >= 50 && g.points <= 100) && d.points === moy;
  });
  t('[28] chaque tour : devineurs entre 50 et 100, dessinateur = moyenne sur les 15', coherents);
  const traits = cs.reduce((n, c) => n + c.tous((m) => m.type === 'stroke').length, 0);
  t(`[8] traits relayés : 16 tours × 3 traits × 15 devineurs = 720 (${traits})`, traits === 720);
  t('[8] aucun robot n a reçu ses propres traits', cs.every((c) => {
    const parTour = new Map(h.tous((m) => m.type === 'turn').map((m) => [m.turnId, m.drawer]));
    return c.tous((m) => m.type === 'stroke').every((m) => parTour.get(m.turnId) !== c.id);
  }));

  const ecarts = cs.flatMap((c) => O.inspecterFil(c.msgs).map((e) => `${c.nom} ${e}`));
  t(`[16] fil : ${cs.reduce((n, c) => n + c.msgs.length, 0)} messages relus chez 16 robots, champs attendus, aucun instant`, ecarts.length === 0, ecarts.slice(0, 5).join(' | '));
  const f = cs.flatMap((c) => O.fuites(c, tours));
  t(`[16] secret : aucune proposition chez un devineur avant le turn-end (${tours.size} tours)`, f.length === 0, f.slice(0, 5).join(' | '));
  const proposes = [...tours.values()].flatMap((e) => e.choices);
  t(`[6] catalogue V1 : ${proposes.length} propositions sur ${tours.size} tours, aucune deux fois dans la partie`,
    tours.size === 16 && proposes.length === 48 && new Set(proposes).size === 48);
  t('[16] choices : seulement chez le dessinateur du tour', cs.every((c) => c.tous((m) => m.type === 'choices').every((m) => tours.get(m.turnId).drawer === c.id)));
  void E;

  cs.forEach((c) => c.ws.terminate());
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
