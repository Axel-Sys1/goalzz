// Tests des matchs éclair fictifs en direct (js/providers/fakeProvider.js) : la simulation suit le
// modèle des cotes en direct (js/providers/liveOdds.js), écrit des scores et horloges lisibles,
// et se termine proprement, même après un saut de temps (« +15 min »).
// Lancer (pas de node) :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/fakeLive.test.mjs
globalThis.console ??= { warn: () => {}, log: print, error: print };

import { createFakeProvider } from '../js/providers/fakeProvider.js';
import { fitParams, liveState, liveProbs, liveMarket } from '../js/providers/liveOdds.js';
import { fromProbabilities } from '../js/providers/odds.js';

// ─── Outils ──────────────────────────────────────────────────────────────────
async function test(name, fn) {
  await fn();
  print(`PASS ${name}`);
}
const fail = (msg) => { throw new Error(msg); };
const ok = (cond, msg) => cond || fail(msg);
const eq = (a, b, msg) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  if (x !== y) fail(`${msg} : attendu ${y}, obtenu ${x}`);
};
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} : attendu ${b} ± ${tol}, obtenu ${a}`);

// Tirages reproductibles : Math.random remplacé par un générateur à graine (mulberry32).
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(20261009);

const MIN = 60_000;
const T0 = Date.parse('2026-10-09T18:00:00Z');
const SPORTS = ['football', 'basketball', 'tennis'];
const provider = createFakeProvider();

// Ce que fait le cœur (services/matches.js applyUpdate) d'une mise à jour, en plus court.
function apply(m, u, t) {
  if (u.status === 'finished') return { ...m, status: 'finished', outcome: u.outcome, score: u.score, liveScore: null, clock: null };
  const next = { ...m, status: u.status, meta: { ...m.meta, ...(u.meta || {}) } };
  if (!next.kickoffOdds) next.kickoffOdds = { ...m.odds };
  if (u.liveScore !== m.liveScore) {
    if (m.liveScore != null) next.scoreAt = t;
    next.liveScore = u.liveScore;
  }
  if (u.clock !== m.clock) { next.clock = u.clock; next.clockAt = t; }
  return next;
}

async function step(m, t) {
  const us = await provider.fetchResults({ now: t, matches: [m] });
  eq(us.length, 1, 'une mise à jour par match commencé');
  eq(us[0].matchId, m.id, 'id');
  return us[0];
}

// Réserve de matchs : quelques-uns de chaque sport.
async function newMatches(n) {
  const out = [];
  let now = T0;
  while (SPORTS.some((s) => out.filter((m) => m.sport === s).length < n)) {
    const batch = await provider.fetchUpcoming({ now, existing: [], target: 30 });
    out.push(...batch);
    now += 10 * MIN;
  }
  return out;
}
const pool = await newMatches(60);
const ofSport = (sport, n) => pool.filter((m) => m.sport === sport).slice(0, n);

const parseScore = (s) => s.split(' - ').map(Number);
const parseSets = (s) => s.split(' ').map((x) => /^(\d)-(\d)(?:\((\d)\))?$/.exec(x) || fail(`set illisible ${x}`)).map((x) => [+x[1], +x[2]]);
const setOver = ([a, b]) => Math.max(a, b) === 7 || (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2);
const winner = ([a, b]) => (a > b ? '1' : a < b ? '2' : 'X');
const gamesOf = (sets) => sets.reduce((n, [a, b]) => n + a + b, 0);

// Résultat cohérent avec le score final.
function checkFinal(m, u) {
  eq(u.status, 'finished', `${m.sport} : terminé`);
  ok(u.outcome in m.odds, `${m.sport} : issue ${u.outcome} proposée avant le match`);
  if (m.sport === 'tennis') {
    const sets = parseSets(u.score);
    ok(sets.every(setOver), `tennis : sets complets ${u.score}`);
    sets.filter(([a, b]) => Math.min(a, b) === 6).forEach(([a, b]) => ok(Math.max(a, b) === 7, 'tie-break à 6-6'));
    const won = [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
    eq(Math.max(...won), 2, `tennis : 2 sets gagnants ${u.score}`);
    eq(winner(won), u.outcome, `tennis : vainqueur ${u.score}`);
  } else {
    const score = parseScore(u.score);
    ok(score.every(Number.isInteger), `${m.sport} : score ${u.score}`);
    eq(winner(score), u.outcome, `${m.sport} : vainqueur ${u.score}`);
    if (m.sport === 'basketball') ok(score[0] !== score[1], 'basket : jamais de nul');
  }
}

// Joue un match en entier, une lecture toutes les `every` ms ; vérifie chaque état intermédiaire.
async function playOut(m0, every = 3000) {
  let m = m0;
  let last = null;
  const seen = { open: 0, closed: 0, updates: 0 };
  for (let t = m0.startsAt; t < m0.startsAt + 60 * MIN; t += every) {
    const u = await step(m, t);
    if (u.status === 'finished') { checkFinal(m0, u); return { u, m, seen }; }
    eq(u.status, 'live', 'en direct');
    m = apply(m, u, t);
    const st = liveState(m, t);
    ok(st, `${m.sport} : état illisible ${u.liveScore} / ${u.clock}`);
    checkSim(m, st);
    if (last && st.progress != null && last.progress != null) ok(st.progress >= last.progress, 'le temps avance');
    if (last) checkScoreGrows(m.sport, last.score, st.score);
    const mk = liveMarket(m, t);
    seen[mk.open ? 'open' : 'closed']++;
    seen.updates++;
    last = st;
  }
  return fail(`${m0.sport} : pas terminé`);
}

// L'état lu dans liveScore / clock est exactement celui de la simulation.
function checkSim(m, st) {
  const sim = m.meta.sim;
  if (m.sport === 'football') {
    eq(Object.keys(sim).sort(), ['at', 'min', 'score'], 'foot : la simulation ne garde que le présent');
    eq([st.progress, st.score], [sim.min / 90, sim.score], 'foot : minute et score relus');
  } else if (m.sport === 'basketball') {
    eq(Object.keys(sim).sort(), ['at', 'end', 'score', 'sec'], 'basket : la simulation ne garde que le présent');
    eq(st.score, sim.score, 'basket : score relu');
    if (sim.sec < 2880) near(st.progress, sim.sec / 2880, 1e-12, 'basket : temps relu');
    else eq(st.closed, 'Prolongation', 'basket : prolongation fermée');
  } else {
    eq(Object.keys(sim).sort(), ['at', 'games', 'sets'], 'tennis : la simulation ne garde que le présent');
    eq(st.score.sets, sim.sets.map(([a, b]) => [a, b]), 'tennis : sets relus');
  }
}

function checkScoreGrows(sport, a, b) {
  if (sport === 'tennis') ok(gamesOf(b.sets) >= gamesOf(a.sets), 'tennis : les jeux s\'ajoutent');
  else ok(b[0] >= a[0] && b[1] >= a[1], `${sport} : les scores ne baissent pas`);
}

// ─── Création ────────────────────────────────────────────────────────────────
await test('matchs créés : modèle joint, cotes d\'avant-match = cotes en direct au coup d\'envoi', async () => {
  const kickoff = {
    football: { liveScore: '0 - 0', clock: "0'" },
    basketball: { liveScore: '0 - 0', clock: 'Q1 12:00' },
    tennis: { liveScore: '0-0', clock: '1er set' },
  };
  for (const m of pool) {
    ok(SPORTS.includes(m.sport), 'sport connu');
    eq([m.status, m.real, m.source, m.endsAt - m.startsAt], ['scheduled', false, 'fake', 2 * MIN], 'champs');
    ok(m.meta.model && m.meta.model.sport === m.sport && !m.meta.sim, 'modèle joint, aucune simulation avant le match');
    const probs = liveProbs({ ...m, status: 'live', ...kickoff[m.sport] }, m.startsAt);
    eq(m.odds, fromProbabilities(probs), `${m.sport} : cotes d'avant-match`);
    eq(Object.keys(m.odds).sort(), m.sport === 'football' ? ['1', '2', 'X'] : ['1', '2'], 'issues');
  }
  eq(await provider.fetchResults({ now: pool[0].startsAt - 1, matches: [pool[0]] }), [], 'rien avant le coup d\'envoi');
});

// ─── Matchs complets ─────────────────────────────────────────────────────────
await test('matchs complets : états relisibles, scores croissants, résultat cohérent avec le score', async () => {
  for (const sport of SPORTS) {
    const totals = [];
    let durations = 0;
    let open = 0;
    let updates = 0;
    for (const m0 of ofSport(sport, 60)) {
      const { u, m, seen } = await playOut(m0);
      open += seen.open;
      updates += seen.updates;
      durations += m.meta.sim.at - m0.startsAt;
      if (sport !== 'tennis') totals.push(parseScore(u.score).reduce((a, b) => a + b, 0));
    }
    const mean = totals.reduce((a, b) => a + b, 0) / (totals.length || 1);
    print(`  ${sport} : ${(durations / 60 / 1000).toFixed(0)} s en moyenne, ${Math.round((100 * open) / updates)} % des lectures ouvertes aux paris${totals.length ? `, ${mean.toFixed(1)} points/buts par match` : ''}`);
    ok(open > updates / 2, `${sport} : marché ouvert la plupart du temps`);
    if (sport === 'basketball') ok(mean > 195 && mean < 235, `basket : total réaliste (${mean})`);
    if (sport === 'football') ok(mean > 1.6 && mean < 4.2, `foot : total réaliste (${mean})`);
  }
});

await test('un but suspend brièvement le marché fictif, puis il rouvre', async () => {
  let goals = 0;
  for (const m0 of ofSport('football', 30)) {
    let m = m0;
    for (let t = m0.startsAt; ; t += 1000) {
      const u = await step(m, t);
      if (u.status === 'finished') break;
      const before = m.liveScore;
      m = apply(m, u, t);
      if (before != null && before !== m.liveScore && liveState(m, t).closed === null) {
        goals++;
        eq(liveMarket(m, t).reason, 'But ! Cotes en cours de mise à jour', 'suspendu après le but');
        const later = apply(m, await step(m, t + 4000), t + 4000);
        if (later.liveScore === m.liveScore && !liveState(later, t + 4000).closed) {
          ok(liveMarket(later, t + 4000).reason !== 'But ! Cotes en cours de mise à jour', 'rouvert 4 s plus tard');
        }
      }
    }
  }
  ok(goals > 20, `des buts (${goals})`);
});

// ─── Monte Carlo ─────────────────────────────────────────────────────────────
// Depuis un même état, simuler la fin du match de nombreuses fois : fréquences ≈ liveProbs.
async function monteCarlo(m, t, n, label, bias = 0.006) {
  const probs = liveProbs(m, t);
  ok(probs, `${label} : probabilités`);
  const count = Object.fromEntries(Object.keys(probs).map((k) => [k, 0]));
  for (let i = 0; i < n; i++) {
    const u = await step(m, t + 30 * MIN);
    eq(u.status, 'finished', `${label} : terminé`);
    count[u.outcome]++;
  }
  const freq = Object.fromEntries(Object.entries(count).map(([k, c]) => [k, c / n]));
  print(`  ${label} : modèle ${JSON.stringify(probs, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}, simulé ${JSON.stringify(freq)}`);
  for (const k of Object.keys(probs)) {
    const sd = Math.sqrt((probs[k] * (1 - probs[k])) / n);
    near(freq[k], probs[k], 4 * sd + bias, `${label} [${k}]`);
  }
}

// Avance un match jusqu'à t par lectures successives (comme le cœur).
async function advance(m0, until, every = 3000) {
  let m = m0;
  for (let t = m0.startsAt; t <= until; t += every) {
    const u = await step(m, t);
    if (u.status !== 'live') fail('terminé trop tôt');
    m = apply(m, u, t);
  }
  return m;
}

// Coup d'envoi : aucune simulation encore, tout le match reste à jouer.
const kickoff = (m0, liveScore, clock) => ({ ...m0, status: 'live', liveScore, clock, clockAt: m0.startsAt });

// État choisi à la main (format de meta.sim), lu au même instant.
function craft(m0, t, sim, view) {
  return { ...m0, status: 'live', ...view, clockAt: t, kickoffOdds: m0.odds, meta: { ...m0.meta, sim: { ...sim, at: t } } };
}

await test('Monte Carlo : la simulation suit les probabilités en direct (foot)', async () => {
  const N = 4000;
  const [m0] = ofSport('football', 1);
  await monteCarlo(kickoff(m0, '0 - 0', "0'"), m0.startsAt, N, 'foot, coup d\'envoi');
  const t = m0.startsAt + 60 * 1000; // 45e minute
  const mid = await advance(m0, t);
  await monteCarlo(mid, t, N, `foot, ${mid.clock} ${mid.liveScore}`);
  const t60 = m0.startsAt + 80 * 1000;
  await monteCarlo(craft(m0, t60, { min: 60, score: [1, 0] }, { liveScore: '1 - 0', clock: "60'" }), t60, N, 'foot, 1-0 à la 60e');
  await monteCarlo(craft(m0, t60, { min: 60, score: [1, 1] }, { liveScore: '1 - 1', clock: "60'" }), t60, N, 'foot, 1-1 à la 60e');
});

await test('Monte Carlo : la simulation suit les probabilités en direct (basket)', async () => {
  const N = 4000;
  const [m0] = ofSport('basketball', 1);
  await monteCarlo(kickoff(m0, '0 - 0', 'Q1 12:00'), m0.startsAt, N, 'basket, coup d\'envoi', 0.01);
  const t = m0.startsAt + 60 * 1000; // mi-temps
  const mid = await advance(m0, t);
  await monteCarlo(mid, t, N, `basket, ${mid.clock} ${mid.liveScore}`, 0.01);
  // Égalité à 5 minutes de la fin : la prolongation pèse.
  const t4 = m0.startsAt + 2580 * 1000 / 24;
  await monteCarlo(craft(m0, t4, { sec: 2580, end: 2880, score: [96, 96] }, { liveScore: '96 - 96', clock: 'Q4 5:00' }), t4, N, 'basket, 96-96 Q4 5:00', 0.01);
  await monteCarlo(craft(m0, t4, { sec: 2580, end: 2880, score: [92, 96] }, { liveScore: '92 - 96', clock: 'Q4 5:00' }), t4, N, 'basket, 92-96 Q4 5:00', 0.01);
});

await test('Monte Carlo : la simulation suit les probabilités en direct (tennis)', async () => {
  const N = 4000;
  const [m0] = ofSport('tennis', 1);
  await monteCarlo(kickoff(m0, '0-0', '1er set'), m0.startsAt, N, 'tennis, coup d\'envoi');
  const t = m0.startsAt + 50 * 1000; // 10 jeux
  const mid = await advance(m0, t);
  await monteCarlo(mid, t, N, `tennis, ${mid.liveScore}`);
  await monteCarlo(craft(m0, t, { games: 15, sets: [[4, 6], [3, 2]] }, { liveScore: '4-6 3-2', clock: '2e set' }), t, N, 'tennis, 4-6 3-2');
  await monteCarlo(craft(m0, t, { games: 22, sets: [[6, 4], [5, 6]] }, { liveScore: '6-4 5-6', clock: '2e set' }), t, N, 'tennis, 6-4 5-6');
});

// ─── Sauts de temps ──────────────────────────────────────────────────────────
await test('« +15 min » : les matchs en cours se terminent proprement', async () => {
  for (const sport of SPORTS) {
    for (const m0 of ofSport(sport, 40)) {
      // Commencé puis saut de 15 minutes.
      const t1 = m0.startsAt + 1000;
      const m1 = apply(m0, await step(m0, t1), t1);
      const jump = t1 + 15 * MIN;
      eq(liveMarket(m1, jump).reason, 'Score en attente', `${sport} : pas de pari avant la nouvelle simulation`);
      checkFinal(m0, await step(m1, jump));
      // Jamais simulé (coup d'envoi passé pendant le saut).
      checkFinal(m0, await step(m0, m0.startsAt + 15 * MIN));
    }
  }
});

await test('match fictif créé avant le direct (sans modèle) : simulé, modèle rendu au cœur', async () => {
  const probs = { 1: 0.5, X: 0.25, 2: 0.25 };
  const legacy = {
    ...ofSport('football', 1)[0], id: 'fake_legacy', odds: { 1: 1.87, X: 3.74, 2: 3.74 }, meta: { probs },
  };
  const t = legacy.startsAt + 30_000;
  const u = await step(legacy, t);
  eq(u.status, 'live', 'en direct');
  eq(u.meta.model, fitParams('football', probs), 'modèle ajusté sur les probabilités d\'origine');
  const m = apply(legacy, u, t);
  ok(liveProbs(m, t), 'cotes en direct disponibles');
  const u2 = await step(m, t + 3000);
  ok(!u2.meta.model, 'modèle déjà connu : pas renvoyé');
});

print('ALL PASS');
