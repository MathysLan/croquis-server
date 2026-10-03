// La capacité d'un dessin : MAX_TRAITS traits, pas un de plus.
//
//   node test-traits.js
//
// À part de test.js parce que 151 traits au débit permis (40 messages/s) ne
// tiennent pas dans un dessin de 4 s : ici le dessin dure 30 s, et les traits
// partent par lots de 35, une fenêtre de débit chacun. Aucun refus TOO_FAST
// n'est toléré : un refus doit venir de la capacité, pas du débit.
process.env.PORT = process.env.PORT || '8798';
process.env.TEST_CHOOSE_MS = '2000';
process.env.TEST_DRAW_MS = '30000';
process.env.PRESENCE_QUIET = '1';
const { rooms, MAX_TRAITS, DEBIT } = require('./server.js');
const O = require('./test-outils.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const LOT = 35;
let prochainS = 1;

(async () => {
  const A = O.client(URL, 'A'), B = O.client(URL, 'B');
  const you = await O.joindre(A, 'Alice');
  await O.joindre(B, 'Bruno', you.code);
  await A.wait((m) => m.type === 'lobby' && m.players.length === 2, 3000, 0);
  A.send({ action: 'start' });
  const tr = await A.wait((m) => m.type === 'turn', 3000, 0);
  const D = tr.drawer === A.id ? A : B, G = D === A ? B : A;
  D.send({ action: 'choose', turnId: 1, index: 0 });
  await G.wait((m) => m.type === 'drawing', 3000, 0);
  const dessin = () => rooms.get(you.code).dessin.traits.length;
  const refus = (i) => D.msgs.slice(i).filter((m) => m.type === 'refused');
  const relais = (i) => G.msgs.slice(i).filter((m) => m.type === 'stroke');

  // Envoie n traits complets (un message chacun), par lots d'une fenêtre de
  // débit, et attend que le serveur les ait tous traités.
  async function tracer(n) {
    for (let k = 0; k < n; k += LOT) {
      const lot = Math.min(LOT, n - k);
      const avant = D.msgs.length, gAvant = G.msgs.length, tAvant = dessin();
      for (let j = 0; j < lot; j++) {
        const s = prochainS++;
        D.send({ action: 'stroke', turnId: 1, s, c: s % 13, w: s % 3, p: [s % 1000, s % 750], end: true });
      }
      // traité = accepté (relayé) ou refusé
      await O.attendre(() => (dessin() - tAvant) + refus(avant).length >= lot && relais(gAvant).length >= dessin() - tAvant, 3000);
      await O.sleep(1050);                  // fenêtre de débit neuve
    }
  }

  t(`limite : MAX_TRAITS = 150, débit des traits ${DEBIT.stroke}/s inchangé`, MAX_TRAITS === 150 && DEBIT.stroke === 40);

  // ---- 150 acceptés, le 151e refusé
  let iD = D.msgs.length, iG = G.msgs.length;
  await tracer(150);
  t('150 traits acceptés : tous gardés', dessin() === 150);
  t('150 traits acceptés : tous relayés au devineur', relais(iG).length === 150);
  t('150 traits acceptés : aucun refus (ni capacité, ni débit)', refus(iD).length === 0);
  iD = D.msgs.length; iG = G.msgs.length;
  await tracer(1);
  const r151 = refus(iD);
  t('le 151e est refusé : TOO_MANY_STROKES, à l auteur', r151.length === 1 && r151[0].reason === 'TOO_MANY_STROKES' && r151[0].action === 'stroke');
  t('le 151e n est ni gardé ni relayé', dessin() === 150 && relais(iG).length === 0);

  // ---- undo libère une place
  iG = G.msgs.length;
  D.send({ action: 'undo', turnId: 1 });
  const un = await G.wait((m) => m.type === 'undo', 2000, iG);
  t('undo : relayé, le dessin repasse à 149', !!un && dessin() === 149);
  iD = D.msgs.length;
  await tracer(1);
  t('undo : la place libérée accepte un trait (150)', dessin() === 150 && refus(iD).length === 0);
  await tracer(1);
  t('undo : puis de nouveau plein (refus suivant)', dessin() === 150 && refus(iD).length === 1 && refus(iD)[0].reason === 'TOO_MANY_STROKES');

  // ---- le snapshot porte les 150
  G.send({ action: 'snapshot' });
  const sn = await G.suite((m) => m.type === 'snapshot');
  t('snapshot : les 150 traits, dans l ordre', sn && sn.strokes.length === 150
    && sn.strokes.every((x, i, a) => i === 0 || x.s > a[i - 1].s));

  // ---- clear remet la capacité à zéro
  iG = G.msgs.length;
  D.send({ action: 'clear', turnId: 1 });
  t('clear : relayé, dessin vide', !!(await G.wait((m) => m.type === 'clear', 2000, iG)) && dessin() === 0);
  await O.sleep(1050);
  iD = D.msgs.length; iG = G.msgs.length;
  await tracer(150);
  t('après clear : de nouveau 150 traits acceptés et relayés', dessin() === 150 && relais(iG).length === 150 && refus(iD).length === 0);
  await tracer(1);
  t('après clear : le 151e de nouveau refusé', dessin() === 150 && refus(iD).length === 1 && refus(iD)[0].reason === 'TOO_MANY_STROKES');

  t('aucun refus TOO_FAST de toute la suite', D.msgs.every((m) => !(m.type === 'refused' && m.reason === 'TOO_FAST')));
  t('le dessin était toujours en cours (aucun refus de phase)', rooms.get(you.code).game.phase === 'drawing');
  const ecarts = [A, B].flatMap((c) => O.inspecterFil(c.msgs).map((e) => `${c.nom} ${e}`));
  t(`fil : ${A.msgs.length + B.msgs.length} messages relus, champs attendus`, ecarts.length === 0, ecarts.slice(0, 3).join(' | '));

  [A, B].forEach((c) => c.ws.terminate());
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
