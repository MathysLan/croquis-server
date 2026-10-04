// Valide le catalogue de mots de Croquis et écrit son rapport lisible.
//
//   node tools/valider-catalogue.mjs                       catalogue/mots-v1.js
//   node tools/valider-catalogue.mjs chemin/vers/mots.js   un autre catalogue
//
// Les règles de comparaison sont CELLES DU MOTEUR (engine.js : jetons,
// normaliser, distance) : ce qui est vérifié ici est exactement ce que le jeu
// fera d'une devinette. Code de sortie 1 s'il reste une ERREUR ; les
// AVERTISSEMENTS sont à relire, pas bloquants.
//
// Erreurs : forme d'entrée, niveau, caractères, longueur (3–20 lettres),
// plus de 3 mots, déterminant en tête, normalisation des expressions, clé en
// double (mots et alias confondus), alias inutile, une réponse qui en CONTIENT
// une autre (le moteur la retiendrait comme « écris juste le mot »), moins de
// 100 entrées par niveau, catalogue refusé par createGame(), proposition
// répétée ou trio déséquilibré dans une partie simulée (2 à 16 joueurs).
// Avertissements : un mot inclus dans un autre (sans être un mot entier), et
// deux mots à une lettre près (« presque » de l'un pour l'autre).
import { createRequire } from 'node:module';
import { writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');
const E = require(path.join(RACINE, 'engine.js'));
const FICHIER = path.resolve(process.argv[2] || path.join(RACINE, 'catalogue', 'mots-v1.js'));
const CATALOGUE = require(FICHIER);

const erreurs = [];
const avert = [];
const err = (m) => erreurs.push(m);
const NIVEAUX = ['facile', 'moyen', 'difficile'];
const MIN_PAR_NIVEAU = 100;
const DETERMINANTS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du']);
// Minuscules (accents, œ, æ compris), un espace, un tiret ou une apostrophe
// entre deux mots ; rien d'autre (ni chiffre, ni ponctuation, ni double espace).
const FORME = /^[\p{Ll}]+(?:(?: |-|'|’)[\p{Ll}]+)*$/u;
const sansAccents = (s) => s.normalize('NFD').replace(/\p{Mn}/gu, '');

// ------------------------------------------------------------- entrée par entrée
const entrees = [];
CATALOGUE.forEach((e, i) => {
  const ou = `#${i + 1}`;
  if (!e || typeof e.mot !== 'string') return err(`${ou} : { mot } attendu`);
  const nom = `« ${e.mot} »`;
  if (!NIVEAUX.includes(e.niveau)) err(`${nom} : niveau « ${e.niveau} » (facile, moyen, difficile)`);
  if (e.alias !== undefined && (!Array.isArray(e.alias) || !e.alias.length || !e.alias.every((a) => typeof a === 'string'))) err(`${nom} : alias = liste de textes non vide`);
  const formes = [e.mot, ...(e.alias || [])];
  for (const f of formes) {
    const q = f === e.mot ? nom : `${nom}, alias « ${f} »`;
    if (f !== f.normalize('NFC')) err(`${q} : pas en forme Unicode NFC`);
    if (!FORME.test(f)) err(`${q} : caractères inattendus (minuscules, espace, tiret, apostrophe)`);
    const n = E.lettres(f).length;
    if (n < E.MOT_MIN || n > E.MOT_MAX) err(`${q} : ${n} lettres (${E.MOT_MIN} à ${E.MOT_MAX})`);
    if (f.split(' ').length > 3) err(`${q} : plus de 3 mots`);
    const js = E.jetons(f);
    if (js.length > 1 && DETERMINANTS.has(js[0])) err(`${q} : commence par un déterminant (le moteur l'enlève des devinettes)`);
    // L'expression doit donner la MÊME clé quelle que soit la façon de la taper.
    const k = E.normaliser(f);
    // (variantes : sans accents, tirets ou apostrophes en espaces, tout collé,
    //  en capitales ; au pluriel seulement si le mot ne finit pas déjà par s / x
    //  et que son dernier jeton dépasse 3 lettres — la règle du moteur)
    const variantes = [sansAccents(f), f.replace(/-/g, ' '), f.replace(/['’]/g, ' '), f.replace(/[-'’ ]/g, ''), f.toUpperCase()];
    if (!/[sx]$/.test(f) && js.at(-1).length >= 3) variantes.push(`${f}s`);
    // Les clés que le MOTEUR accepte pour cette entrée : celle de chaque forme
    // et celle de sa forme collée (engine.js, cleCollee — lot 6A).
    const clesEntree = formes.flatMap((x) => [E.normaliser(x), E.cleCollee(x)]);
    for (const v of variantes) if (!clesEntree.includes(E.normaliser(v))) err(`${q} : « ${v} » (clé « ${E.normaliser(v)} ») n'est pas reconnu comme « ${f} »`);
  }
  // Les clés de chaque forme (la sienne et celle de sa forme collée) : un
  // alias dont les clés sont déjà toutes acceptées ne sert à rien.
  const clesDe = formes.map((f) => [...new Set([E.normaliser(f), E.cleCollee(f)])]);
  formes.forEach((f, j) => { if (j && clesDe[j].every((k) => clesDe.slice(0, j).flat().includes(k))) err(`${nom} : alias « ${f} » en double (déjà accepté : « ${clesDe[j].join(' / ')} »)`); });
  entrees.push({ i, mot: e.mot, niveau: e.niveau, alias: e.alias || [], formes, cles: [...new Set(clesDe.flat())] });
});

// ------------------------------------------------------------- entre entrées
const parCle = new Map();
for (const e of entrees) for (const k of e.cles) {
  if (parCle.has(k) && parCle.get(k) !== e) err(`clé « ${k} » en double : « ${parCle.get(k).mot} » et « ${e.mot} »`);
  else parCle.set(k, e);
}
// Une réponse qui CONTIENT une autre réponse (en mots entiers, comme le moteur
// cherche une fuite) : « pomme de terre » contient « pomme ».
for (const e of entrees) for (const f of e.formes) {
  const js = E.jetons(f);
  for (let a = 0; a < js.length; a++) for (let b = a + 1; b <= js.length; b++) {
    if (a === 0 && b === js.length) continue;
    const k = E.normaliser(js.slice(a, b).join(' '));
    const autre = parCle.get(k);
    if (autre && autre !== e) err(`« ${f} » (${e.mot}) contient la réponse « ${autre.mot} » : le moteur retiendrait l'une comme fuite de l'autre`);
  }
}
// À relire : inclusions de lettres (sur les lettres COMPLÈTES : la clé sans
// pluriel ferait voir « our » de « ours » dans « tambour »), et voisins à une
// lettre près — seulement là où le moteur dit vraiment « presque ! » (clé
// visée de PROCHE_MIN lettres ou plus).
const toutes = entrees.flatMap((e) => e.cles.map((k) => ({ k, e })));
const lettresDe = entrees.flatMap((e) => e.formes.map((f) => ({ l: E.lettres(f), e })));
for (const A of lettresDe) for (const B of lettresDe) {
  if (A.e === B.e || A.l.length >= B.l.length) continue;
  if (B.l.includes(A.l) && !avert.some((w) => w.type === 'inclus' && w.a === A.e && w.b === B.e)) avert.push({ type: 'inclus', a: A.e, b: B.e, texte: `« ${A.e.mot} » est dans « ${B.e.mot} »` });
}
for (let x = 0; x < toutes.length; x++) for (let y = x + 1; y < toutes.length; y++) {
  const A = toutes[x], B = toutes[y];
  if (A.e === B.e || Math.max(A.k.length, B.k.length) < E.PROCHE_MIN) continue;
  if (E.distance(A.k, B.k, 1) === 1) avert.push({ type: 'voisins', a: A.e, b: B.e, texte: `« ${A.e.mot} » / « ${B.e.mot} » (${A.k} / ${B.k})` });
}

// ------------------------------------------------------------- les niveaux
const compte = Object.fromEntries(NIVEAUX.map((n) => [n, entrees.filter((e) => e.niveau === n).length]));
for (const n of NIVEAUX) if (compte[n] < MIN_PAR_NIVEAU) err(`niveau ${n} : ${compte[n]} entrées (au moins ${MIN_PAR_NIVEAU})`);

// --------------------------------------------- le moteur l'accepte-t-il ?
const graine = (s) => () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let x = Math.imul(s ^ (s >>> 15), 1 | s);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
let accepte = true;
try { E.createGame({ players: ['a', 'b'], now: 0, random: graine(1), words: CATALOGUE }); }
catch (x) { accepte = false; err(`createGame() refuse le catalogue : ${x.message}`); }

// ------------------------------------------- couverture : parties simulées
// Chaque partie est jouée au chrono par le vrai moteur, de 2 à 16 joueurs, sur
// 30 graines : aucune proposition ne doit revenir dans une partie, et chaque
// trio doit compter un mot de chaque niveau.
const couverture = [];
if (accepte) {
  for (let n = 2; n <= 16; n++) {
    let repetitions = 0, trioBancal = 0, tours = 0, proposes = 0;
    for (let s = 1; s <= 30; s++) {
      const g = E.createGame({ players: Array.from({ length: n }, (_, i) => 'p' + i), now: 0, random: graine(1000 * n + s), words: CATALOGUE });
      const vus = new Set();
      let vu = 0;
      for (let k = 0; k < 10000 && g.phase !== 'end'; k++) {
        if (g.turnId !== vu) {
          vu = g.turnId;
          tours++;
          const niv = g.turn.choices.map((w) => w.niveau).join();
          if (niv !== 'facile,moyen,difficile') trioBancal++;
          for (const w of g.turn.choices) { if (vus.has(w.mot)) repetitions++; vus.add(w.mot); proposes++; }
        }
        E.tick(g, E.nextDeadline(g));
      }
    }
    couverture.push({ n, manches: E.roundsFor(n), toursParPartie: n * E.roundsFor(n), repetitions, trioBancal, proposesParPartie: proposes / 30 });
    if (repetitions) err(`${n} joueurs : ${repetitions} propositions répétées dans une même partie`);
    if (trioBancal) err(`${n} joueurs : ${trioBancal} trios sans un mot de chaque niveau`);
  }
}
const maxTours = Math.max(...couverture.map((c) => c.toursParPartie));

// ---------------------------------------------------------------- rapport
const taille = statSync(FICHIER).size;
const lignes = [];
const L = (s = '') => lignes.push(s);
L('# Croquis — rapport du catalogue');
L();
L(`Fichier : \`${path.relative(RACINE, FICHIER).replace(/\\/g, '/')}\` · généré par \`node tools/valider-catalogue.mjs\`. Catalogue du serveur : \`mots.js\` le relaie tel quel.`);
L();
L(`- Entrées : **${entrees.length}** — facile **${compte.facile}**, moyen **${compte.moyen}**, difficile **${compte.difficile}**`);
L(`- Alias : **${entrees.reduce((s, e) => s + e.alias.length, 0)}** sur ${entrees.filter((e) => e.alias.length).length} entrées`);
L(`- Taille du fichier : ${(taille / 1024).toFixed(1)} Ko`);
L(`- Erreurs : **${erreurs.length}** · avertissements à relire : **${avert.length}**`);
L();
L('## Couverture (parties simulées par le moteur, 30 graines par taille)');
L();
L('| joueurs | manches | tours | mots proposés / partie | par niveau | répétitions | trios bancals |');
L('|---:|---:|---:|---:|---:|---:|---:|');
for (const c of couverture) L(`| ${c.n} | ${c.manches} | ${c.toursParPartie} | ${c.proposesParPartie} | ${c.toursParPartie} | ${c.repetitions} | ${c.trioBancal} |`);
L();
const minNiv = Math.min(...NIVEAUX.map((n) => compte[n]));
L(`La partie la plus gourmande demande **${maxTours}** mots par niveau (${maxTours * 3} propositions). Le plus petit niveau en a **${minNiv}** : `
  + `${(minNiv / maxTours).toFixed(1)} parties de cette taille avant qu'un mot ne DOIVE revenir. Le moteur n'empêche les répétitions qu'à l'intérieur d'une partie : `
  + `d'une partie à l'autre, un mot donné a ~${Math.round(100 * maxTours / minNiv)} % de chances d'être reproposé (16 joueurs), ~${Math.round(100 * 9 / minNiv)} % à 3 joueurs.`);
L();
if (erreurs.length) { L('## Erreurs'); L(); for (const e of erreurs) L(`- ${e}`); L(); }
L('## À relire (avertissements, non bloquants)');
L();
const voisins = avert.filter((a) => a.type === 'voisins'), inclus = avert.filter((a) => a.type === 'inclus');
L(`### À une lettre près (${voisins.length}) — la devinette de l'un vaut « presque ! » pour l'autre`);
L();
for (const a of voisins) L(`- ${a.texte} — ${a.a.niveau === a.b.niveau ? `même niveau (${a.a.niveau}) : jamais dans le même trio` : `${a.a.niveau} / ${a.b.niveau} : peuvent se retrouver dans le même trio`}`);
L();
L(`### Un mot dans un autre, sans être un mot entier (${inclus.length}) — pas une fuite pour le moteur`);
L();
for (const a of inclus) L(`- ${a.texte}`);
L();
L('## Le catalogue complet');
for (const n of NIVEAUX) {
  L();
  L(`### ${n[0].toUpperCase() + n.slice(1)} (${compte[n]})`);
  L();
  L(entrees.filter((e) => e.niveau === n).map((e) => (e.alias.length ? `${e.mot} *(${e.alias.join(', ')})*` : e.mot)).join(' · '));
}
L();
L('## Alias');
L();
for (const e of entrees.filter((x) => x.alias.length)) L(`- ${e.mot} → ${e.alias.join(', ')} (${e.niveau})`);
writeFileSync(path.join(RACINE, 'catalogue', 'RAPPORT.md'), lignes.join('\n') + '\n');

// ---------------------------------------------------------------- console
console.log(`${entrees.length} entrées : facile ${compte.facile}, moyen ${compte.moyen}, difficile ${compte.difficile} · ${(taille / 1024).toFixed(1)} Ko`);
console.log(`couverture : ${couverture.length} tailles de partie simulées × 30, partie max ${maxTours} tours (${maxTours} mots par niveau)`);
console.log(`avertissements : ${voisins.length} voisins à une lettre, ${inclus.length} inclusions`);
for (const e of erreurs) console.log('ERREUR ' + e);
console.log(erreurs.length ? `\n${erreurs.length} ERREUR(S)` : '\nCATALOGUE VALIDE');
process.exit(erreurs.length ? 1 : 0);
