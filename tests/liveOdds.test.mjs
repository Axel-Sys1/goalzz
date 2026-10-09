// Tests des cotes en direct (js/providers/liveOdds.js) : ajustement des modèles, lecture des horloges,
// évolution des probabilités, règles de fermeture du marché et vitesse.
// Lancer (pas de node) :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/liveOdds.test.mjs
globalThis.console ??= { warn: () => {}, log: print, error: print };

import { LIVE_SPORTS, fitParams, liveState, liveProbs, liveMarket } from '../js/providers/liveOdds.js';
import { fromProbabilities, devig } from '../js/providers/odds.js';
import { CONFIG } from '../js/config.js';

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
const nearProbs = (got, want, tol, msg) => {
  ok(got, `${msg} : probabilités absentes`);
  eq(Object.keys(got).sort(), Object.keys(want).sort(), `${msg} (issues)`);
  for (const k of Object.keys(want)) near(got[k], want[k], tol, `${msg} [${k}]`);
  near(Object.values(got).reduce((a, b) => a + b, 0), 1, 1e-9, `${msg} (somme)`);
};

const MIN = 60_000;
const T = Date.parse('2026-10-09T18:00:00Z'); // « maintenant »

// Horloge et score au coup d'envoi, au format ESPN de chaque sport.
const KICKOFF = {
  football: { liveScore: '0 - 0', clock: "0'" },
  hockey: { liveScore: '0 - 0', clock: 'P1 20:00' },
  basketball: { liveScore: '0 - 0', clock: 'Q1 12:00' },
  americanfootball: { liveScore: '0 - 0', clock: 'Q1 15:00' },
  rugby: { liveScore: '0 - 0', clock: '1re MT' },
  tennis: { liveScore: '0-0', clock: '1er set' },
};

// Vrai match en direct, lu il y a 10 s, score inchangé depuis 10 min.
const live = (sport, odds, extra = {}) => ({
  id: `t:${sport}`, real: true, sport, competition: 'Test', startsAt: T, status: 'live',
  odds, kickoffOdds: odds, seenAt: T, scoreAt: T - 10 * MIN, clockAt: T, meta: {},
  ...KICKOFF[sport], ...extra,
});
// Match portant directement ses paramètres de modèle (comme les fictifs).
const withModel = (sport, model, odds, extra = {}) => live(sport, odds, { meta: { model }, ...extra });
const at = (m, clock, liveScore, extra = {}) => ({ ...m, clock, liveScore, ...extra });

// ─── fitParams ───────────────────────────────────────────────────────────────
await test('fitParams reproduit les probabilités d\'avant-match (tous les sports)', async () => {
  const cases = [
    ['football', { 1: 0.42, X: 0.28, 2: 0.30 }, {}],
    ['football', { 1: 0.72, X: 0.17, 2: 0.11 }, {}],                // gros favori à domicile
    ['football', { 1: 0.85, X: 0.10, 2: 0.05 }, {}],                // très gros favori
    ['football', { 1: 0.12, X: 0.20, 2: 0.68 }, {}],                // favori à l'extérieur
    ['football', { 1: 0.03, X: 0.10, 2: 0.87 }, {}],
    ['hockey', { 1: 0.55, 2: 0.45 }, {}],
    ['hockey', { 1: 0.97, 2: 0.03 }, {}],
    ['hockey', { 1: 0.03, 2: 0.97 }, {}],
    ['basketball', { 1: 0.70, 2: 0.30 }, { league: 'nba' }],
    ['basketball', { 1: 0.20, 2: 0.80 }, { league: 'wnba' }],
    ['basketball', { 1: 0.97, 2: 0.03 }, {}],
    ['americanfootball', { 1: 0.65, 2: 0.35 }, { league: 'nfl' }],
    ['americanfootball', { 1: 0.03, 2: 0.97 }, {}],
    ['tennis', { 1: 0.70, 2: 0.30 }, {}],
    ['tennis', { 1: 0.30, 2: 0.70 }, { league: 'atp', competition: 'Wimbledon · ATP' }],
    ['tennis', { 1: 0.97, 2: 0.03 }, { bestOf: 5 }],
    ['tennis', { 1: 0.03, 2: 0.97 }, {}],
  ];
  for (const [sport, probs, ctx] of cases) {
    const model = fitParams(sport, probs, ctx);
    ok(model && model.sport === sport, `${sport} : paramètres`);
    const clock = ctx.league === 'wnba' ? { clock: 'Q1 10:00' } : {};
    const m = withModel(sport, model, probs, { meta: { model, league: ctx.league }, ...clock });
    nearProbs(liveProbs(m, T), probs, 1e-6, `${sport} ${JSON.stringify(probs)} au coup d'envoi`);
  }
  eq([fitParams('basketball', { 1: 0.5, 2: 0.5 }, { league: 'nba' }).sigma, fitParams('basketball', { 1: 0.5, 2: 0.5 }, { league: 'wnba' }).sigma,
    fitParams('americanfootball', { 1: 0.5, 2: 0.5 }).sigma, fitParams('rugby', { 1: 0.5, X: 0.03, 2: 0.47 }).sigma], [12, 11, 13.5, 14], 'σ par défaut');
  const hockey = fitParams('hockey', { 1: 0.6, 2: 0.4 });
  near(hockey.lh + hockey.la, 6, 1e-9, 'hockey : total de 6 buts');
  ok(hockey.pOT > 0.5 && hockey.pOT < 0.6, 'hockey : prolongation / TAB proche de 0,5, du côté du favori');
  const nba = fitParams('basketball', { 1: 0.7, 2: 0.3 });
  ok(nba.mu > 0 && nba.pOT > 0.5 && nba.pOT < 0.65, 'basket : favori à domicile, prolongation partagée selon la force');
});

await test('fitParams : Grand Chelem masculin en 3 sets gagnants, sinon 2', async () => {
  const p = { 1: 0.6, 2: 0.4 };
  eq(fitParams('tennis', p, { league: 'atp', competition: 'Wimbledon · ATP' }).bestOf, 5, 'Wimbledon ATP');
  eq(fitParams('tennis', p, { league: 'atp', competition: 'Roland-Garros · ATP' }).bestOf, 5, 'Roland-Garros ATP');
  eq(fitParams('tennis', p, { league: 'atp', competition: 'Open d\'Australie · ATP' }).bestOf, 5, 'Open d\'Australie ATP');
  eq(fitParams('tennis', p, { competition: 'US Open · ATP' }).bestOf, 5, 'US Open, ligue lue dans le nom');
  eq(fitParams('tennis', p, { league: 'wta', competition: 'Wimbledon · WTA' }).bestOf, 3, 'Wimbledon WTA');
  eq(fitParams('tennis', p, { league: 'atp', competition: 'Shanghai · ATP' }).bestOf, 3, 'Masters 1000');
  const g3 = fitParams('tennis', p, { bestOf: 3 }).g;
  const g5 = fitParams('tennis', p, { bestOf: 5 }).g;
  ok(g5 < g3, 'à force égale, le favori gagne plus souvent en 5 sets : pJeu plus petit');
});

await test('fitParams : nul hors de portée, issue X absente, entrées invalides', async () => {
  // Nul trop fréquent pour deux Poisson : total minimal (1,6 but), rapport V1/V2 conservé.
  const many = fitParams('football', { 1: 0.45, X: 0.45, 2: 0.10 });
  near(many.lh + many.la, 1.6, 1e-9, 'total minimal');
  const pm = liveProbs(withModel('football', many, { 1: 2, X: 3, 2: 4 }), T);
  near(pm[1] / (pm[1] + pm[2]), 0.45 / 0.55, 1e-6, 'rapport V1/V2 (nul trop haut)');
  // Nul trop rare : total maximal (4 buts).
  const few = fitParams('football', { 1: 0.49, X: 0.02, 2: 0.49 });
  near(few.lh + few.la, 4, 1e-9, 'total maximal');
  near(few.lh, few.la, 1e-6, 'équilibré');
  // Sans nul proposé : total par défaut, rapport conservé.
  const twoWay = fitParams('football', { 1: 0.6, 2: 0.4 });
  near(twoWay.lh + twoWay.la, 2.6, 1e-9, 'total par défaut sans X');
  nearProbs(liveProbs(withModel('football', twoWay, { 1: 1.6, 2: 2.4 }), T), { 1: 0.6, 2: 0.4 }, 1e-6, 'foot sans X');
  // Rugby : une seule inconnue (μ), le nul découle de σ = 14.
  const rugby = { 1: 0.6, X: 0.025, 2: 0.375 };
  const rp = liveProbs(withModel('rugby', fitParams('rugby', rugby), rugby), T);
  near(rp[1] / (rp[1] + rp[2]), 0.6 / 0.975, 1e-6, 'rugby : rapport V1/V2');
  nearProbs(rp, rugby, 0.005, 'rugby : probabilités proches');
  // Sports à 2 issues avec un X dans l'entrée : X retiré des deux côtés.
  const h = fitParams('hockey', { 1: 0.5, X: 0.2, 2: 0.3 });
  nearProbs(liveProbs(withModel('hockey', h, { 1: 2, 2: 3 }), T), { 1: 0.625, 2: 0.375 }, 1e-6, 'hockey avec X en entrée');
  // Extrêmes : tout reste fini.
  for (const sport of LIVE_SPORTS) {
    for (const p1 of [0.03, 0.5, 0.97]) {
      const probs = sport === 'football' || sport === 'rugby' ? { 1: p1 * 0.9, X: 0.1, 2: (1 - p1) * 0.9 } : { 1: p1, 2: 1 - p1 };
      const model = fitParams(sport, probs);
      ok(Object.values(model).every((v) => typeof v === 'string' || Number.isFinite(v)), `${sport} ${p1} : paramètres finis`);
    }
  }
  eq([fitParams('mma', { 1: 0.5, 2: 0.5 }), fitParams('football', null), fitParams('football', { 1: NaN, X: 0.2, 2: 0.3 }),
    fitParams('tennis', { 1: 0, 2: 0 })], [null, null, null, null], 'entrées refusées');
});

await test('fitParams : déterministe et rapide (< 2 ms)', async () => {
  const p = { 1: 0.5123, X: 0.2611, 2: 0.2266 };
  eq(fitParams('football', p), fitParams('football', { ...p }), 'même entrée, même résultat');
  ok(Object.isFrozen(fitParams('football', p)), 'résultat figé (partagé par le cache)');
  let n = 0;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const x = 0.05 + i * 0.022;
    fitParams('football', { 1: x * 0.75, X: 0.25, 2: (1 - x) * 0.75 });
    fitParams('hockey', { 1: x, 2: 1 - x });
    fitParams('basketball', { 1: x, 2: 1 - x }, { league: i % 2 ? 'wnba' : 'nba' });
    fitParams('rugby', { 1: x * 0.97, X: 0.03, 2: (1 - x) * 0.97 });
    fitParams('tennis', { 1: x, 2: 1 - x }, { bestOf: i % 2 ? 5 : 3 });
    n += 5;
  }
  const per = (Date.now() - t0) / n;
  print(`  ${per.toFixed(3)} ms par ajustement (sans cache)`);
  ok(per < 2, `ajustement trop lent : ${per} ms`);
});

// ─── Probabilités en direct ──────────────────────────────────────────────────
await test('liveProbs au coup d\'envoi ≈ probabilités d\'avant-match (cotes figées, avec marge)', async () => {
  const cases = [
    ['football', { 1: 0.47, X: 0.27, 2: 0.26 }, {}],
    ['hockey', { 1: 0.58, 2: 0.42 }, { league: 'nhl' }],
    ['basketball', { 1: 0.35, 2: 0.65 }, { league: 'wnba' }],
    ['americanfootball', { 1: 0.62, 2: 0.38 }, { league: 'nfl' }],
    ['rugby', { 1: 0.7, X: 0.025, 2: 0.275 }, {}],
    ['tennis', { 1: 0.8, 2: 0.2 }, { league: 'atp' }],
  ];
  for (const [sport, probs, meta] of cases) {
    const odds = fromProbabilities(probs);
    const m = live(sport, odds, { meta, kickoffOdds: odds, ...(meta.league === 'wnba' && { clock: 'Q1 10:00' }) });
    const want = devig(odds);
    const check = (got, msg) => {
      if (sport !== 'rugby') return nearProbs(got, want, 1e-6, msg);
      // Rugby : la cote du nul est plafonnée à 15 avant le match ; seul le rapport V1/V2 est repris.
      eq(Object.keys(got).sort(), ['1', '2', 'X'], `${msg} (issues)`);
      near(got[1] / (got[1] + got[2]), want[1] / (want[1] + want[2]), 1e-6, `${msg} (V1/V2)`);
      near(got.X, 0.025, 0.005, `${msg} (nul)`);
    };
    check(liveProbs(m, T), `${sport} : coup d'envoi`);
    // Les cotes d'avant-match d'un match pas encore figé (kickoffOdds absent) servent aussi.
    check(liveProbs({ ...m, kickoffOdds: undefined }, T), `${sport} : sans kickoffOdds`);
  }
  // Cotes figées au coup d'envoi prioritaires sur des cotes modifiées depuis.
  const m = live('football', fromProbabilities({ 1: 0.2, X: 0.3, 2: 0.5 }), { kickoffOdds: fromProbabilities({ 1: 0.5, X: 0.3, 2: 0.2 }) });
  ok(liveProbs(m, T)[1] > 0.45, 'kickoffOdds prioritaires');
});

await test('liveProbs : une avance profite au meneur, d\'autant plus que le temps passe', async () => {
  const fm = live('football', fromProbabilities({ 1: 0.45, X: 0.27, 2: 0.28 }));
  const f = (clock, score) => liveProbs(at(fm, clock, score), T);
  ok(f("30'", '1 - 0')[1] > f("30'", '0 - 0')[1], 'foot : but du domicile');
  ok(f("30'", '0 - 1')[2] > f("30'", '0 - 0')[2], 'foot : but de l\'extérieur');
  ok(f("60'", '1 - 0')[1] > f("30'", '1 - 0')[1] && f("80'", '1 - 0')[1] > f("60'", '1 - 0')[1], 'foot : l\'avance pèse plus avec le temps');
  ok(f("60'", '0 - 0').X > f("30'", '0 - 0').X && f("80'", '0 - 0').X > f("60'", '0 - 0').X, 'foot : le nul monte à 0-0');
  ok(f("80'", '2 - 2').X > 0.5, 'foot : 2-2 à la 80e, nul probable');
  ok(f('MT', '1 - 0')[1] > f("44'", '1 - 0')[1] - 1e-12, 'foot : la mi-temps compte pour 45 minutes');

  const hm = live('hockey', fromProbabilities({ 1: 0.5, 2: 0.5 }), { meta: { league: 'nhl' } });
  const h = (clock, score) => liveProbs(at(hm, clock, score), T)[1];
  ok(h('P2 10:00', '1 - 0') > h('P2 10:00', '0 - 0') && h('P3 5:00', '1 - 0') > h('P2 10:00', '1 - 0'), 'hockey');

  for (const [sport, league, q] of [['basketball', 'nba', 12], ['basketball', 'wnba', 10], ['americanfootball', 'nfl', 15]]) {
    const bm = live(sport, fromProbabilities({ 1: 0.5, 2: 0.5 }), { meta: { league } });
    const b = (clock, score) => liveProbs(at(bm, clock, score), T)[1];
    ok(b(`Q2 ${Math.floor(q / 2)}:00`, '30 - 25') > b(`Q2 ${Math.floor(q / 2)}:00`, '25 - 25'), `${league} : avance`);
    ok(b('Q4 6:00', '80 - 75') > b(`Q2 ${Math.floor(q / 2)}:00`, '30 - 25'), `${league} : même avance plus tard`);
    near(b('Q3 5:00', '50 - 50'), 0.5, 0.06, `${league} : à égalité, proche de l'avant-match`);
  }

  const rm = live('rugby', fromProbabilities({ 1: 0.5, X: 0.03, 2: 0.47 }));
  const r = (clock, score, startsAt = T - 20 * MIN) => liveProbs(at(rm, clock, score, { startsAt }), T)[1];
  ok(r('1re MT', '7 - 0') > r('1re MT', '0 - 0') && r('2e MT', '7 - 0') > r('1re MT', '7 - 0'), 'rugby');

  const tm = live('tennis', fromProbabilities({ 1: 0.5, 2: 0.5 }));
  const t = (score) => liveProbs(at(tm, '2e set', score), T)[1];
  ok(t('6-4 0-0') > 0.5 && t('6-4 3-2') > t('6-4 0-0') && t('6-4 5-2') > t('6-4 3-2'), 'tennis : set et jeux d\'avance');
  near(t('6-4'), t('6-4 0-0'), 1e-12, 'tennis : set juste terminé = set suivant à 0-0');
  ok(t('4-6 6-3 3-1') > t('4-6 6-3 1-1'), 'tennis : break dans le set décisif');
  near(t('6-4 6-6'), 0.5 + 0.5 * 0.5, 1e-9, 'tennis : tie-break à 50 %');
});

// ─── Lecture des horloges ────────────────────────────────────────────────────
await test('liveState : tous les formats d\'horloge ESPN', async () => {
  const st = (sport, clock, liveScore = '0 - 0', extra = {}) => liveState({ ...live(sport, { 1: 2, 2: 2 }), clock, liveScore, ...extra }, T);
  const P = (s) => s && s.progress;
  // Football : minute + minutes entières écoulées depuis la dernière horloge, plafonnée par mi-temps.
  near(P(st('football', "67'")), 67 / 90, 1e-12, "67'");
  near(P(st('football', "67'", '0 - 0', { clockAt: T - 3.5 * MIN })), 70 / 90, 1e-12, "67' lue il y a 3 min 30");
  near(P(st('football', "67'", '0 - 0', { clockAt: T - 59_000 })), 67 / 90, 1e-12, "67' lue il y a 59 s");
  near(P(st('football', "44'", '0 - 0', { clockAt: T - 5 * MIN })), 45 / 90, 1e-12, '1re mi-temps plafonnée à 45');
  near(P(st('football', "45'+2'", '0 - 0', { clockAt: T - 4 * MIN })), 45 / 90, 1e-12, "45'+2'");
  near(P(st('football', 'MT', '0 - 0', { clockAt: T - 10 * MIN })), 0.5, 1e-12, 'MT = 45');
  eq(st('football', 'MT').closed, null, 'on parie à la mi-temps');
  eq(st('football', "84'").closed, null, "84' ouvert");
  eq(st('football', "82'", '0 - 0', { clockAt: T - 3 * MIN }).closed, 'Fin de match proche', "82' + 3 min");
  near(P(st('football', "88'", '0 - 0', { clockAt: T - 6 * MIN })), 1, 1e-12, '2e mi-temps plafonnée à 90');
  const added = st('football', "90'+3'", '2 - 1');
  eq([added.progress, added.score, added.closed], [1, [2, 1], 'Fin de match proche'], "90'+3'");
  eq(st('football', "105'").closed, 'Prolongation', 'prolongation');
  eq(st('football', 'Interrompu', '1 - 0').closed, 'Match interrompu', 'interrompu');
  eq(st('football', 'TAB', '1 - 1').closed, 'Tirs au but', 'tirs au but');
  eq(st('football', "67'", '2 - 1').score, [2, 1], 'score');

  // Basket (NBA 4 × 12, WNBA 4 × 10), foot US (4 × 15), hockey (3 × 20) : temps restant de la période.
  near(P(st('basketball', 'Q3 5:12')), (24 + 12 - 5.2) / 48, 1e-12, 'NBA Q3 5:12');
  near(P(st('basketball', 'Q3 5:12', '0 - 0', { meta: { league: 'wnba' } })), (20 + 10 - 5.2) / 40, 1e-12, 'WNBA Q3 5:12');
  near(P(st('basketball', 'Q3 5:12', '0 - 0', { clockAt: T - 5 * MIN })), (24 + 12 - 5.2) / 48, 1e-12, 'pas d\'extrapolation');
  near(P(st('basketball', 'Fin Q3')), 36 / 48, 1e-12, 'Fin Q3');
  near(P(st('basketball', 'MT')), 0.5, 1e-12, 'basket MT');
  near(P(st('basketball', 'Q1')), 0, 1e-12, 'période sans horloge : début de période');
  eq(st('basketball', 'Q4 2:00', '0 - 0', { real: false }).closed, null, 'fictif, 2:00 restantes : ouvert');
  eq(st('basketball', 'Q4 1:59', '0 - 0', { real: false }).closed, 'Fin de match proche', 'fictif, 1:59 restante');
  eq(st('basketball', 'Q4 6:00').closed, null, 'vrai match, 6:00 restantes : ouvert');
  eq(st('basketball', 'Q4 5:59').closed, 'Fin de match proche', 'vrai match NBA : fermé à moins de 6 min');
  near(P(st('basketball', 'Q4 45.2')), (48 - 45.2 / 60) / 48, 1e-12, 'secondes seules');
  eq(st('basketball', 'Fin Q4').closed, 'Fin de match proche', 'Fin Q4');
  const ot = st('basketball', 'Prol. 3:10', '101 - 99');
  eq([ot.progress, ot.closed], [null, 'Prolongation'], 'Prol. 3:10');
  near(P(st('americanfootball', 'Q3 5:12')), (30 + 15 - 5.2) / 60, 1e-12, 'NFL Q3 5:12');
  near(P(st('americanfootball', 'MT')), 0.5, 1e-12, 'NFL MT');
  near(P(st('americanfootball', 'Fin Q3')), 45 / 60, 1e-12, 'NFL Fin Q3');
  eq(st('americanfootball', 'Prol. 8:00').closed, 'Prolongation', 'NFL prolongation');
  near(P(st('hockey', 'P2 12:00')), 28 / 60, 1e-12, 'P2 12:00');
  near(P(st('hockey', 'Fin P2')), 40 / 60, 1e-12, 'Fin P2');
  eq(st('hockey', 'P3 1:59').closed, 'Fin de match proche', 'P3 1:59');
  eq(st('hockey', 'Prol.').closed, 'Prolongation', 'hockey Prol.');
  eq(st('hockey', 'TAB').closed, 'Tirs au but', 'hockey TAB');
  eq([st('hockey', 'Q2 5:00'), st('basketball', 'P2 5:00'), st('basketball', 'Q5 5:00'), st('basketball', 'Q2 13:00')],
    [null, null, null, null], 'périodes incohérentes');

  // Rugby : seule la mi-temps est connue.
  near(P(st('rugby', '1re MT', '0 - 0', { startsAt: T - 25.5 * MIN })), 25 / 80, 1e-12, '1re MT 25 min');
  near(P(st('rugby', '1re MT', '0 - 0', { startsAt: T - 55 * MIN })), 40 / 80, 1e-12, '1re MT plafonnée');
  near(P(st('rugby', 'MT')), 40 / 80, 1e-12, 'rugby MT');
  near(P(st('rugby', '2e MT', '0 - 0', { clockAt: T - 20 * MIN })), 60 / 80, 1e-12, '2e MT 20 min');
  eq(st('rugby', '2e MT', '0 - 0', { clockAt: T - 35 * MIN }).closed, 'Fin de match proche', '2e MT 75e');
  near(P(st('rugby', '2e MT', '0 - 0', { clockAt: T - 70 * MIN })), 1, 1e-12, '2e MT plafonnée');

  // Tennis : jeux par set, le dernier est le set en cours ; jamais fermé par le temps.
  const t1 = st('tennis', '2e set', '6-4 3-2');
  eq([t1.score, t1.closed, t1.label], [{ sets: [[6, 4], [3, 2]] }, null, '2e set'], '6-4 3-2');
  eq(st('tennis', '2e set', '7-6(5) 2-1').score, { sets: [[7, 6], [2, 1]] }, '7-6(5) 2-1');
  eq(st('tennis', '1er set', '0-0').score, { sets: [[0, 0]] }, '0-0');
  eq(st('tennis', '5e set', '6-7(3) 7-6(8) 6-4 4-6 6-6').closed, null, 'tie-break du 5e set');
  eq(st('tennis', 'Interrompu', '6-4 3-2').closed, 'Match interrompu', 'tennis interrompu');
  eq([st('tennis', '2e set', '5-3 2-1'), st('tennis', '1er set', '6 - 4 abc')], [null, null], 'sets illisibles');

  // Illisible : pas d'horloge, horloge inconnue, pas de score.
  eq([st('football', null), st('football', 'Résultat à venir'), st('football', "67'", null), st('basketball', 'Q3 5:12', 'abc')],
    [null, null, null, null], 'illisible');
  eq(liveState({ ...live('mma', { 1: 2, 2: 2 }), clock: 'R2', liveScore: '0 - 0' }, T), null, 'sport hors direct');
});

// ─── Marché ──────────────────────────────────────────────────────────────────
const { MIN_ODDS, MAX_ODDS, SUSPEND_MS, STALE_MS } = CONFIG.LIVE;
const FOOT_ODDS = fromProbabilities({ 1: 0.45, X: 0.27, 2: 0.28 });

await test('liveMarket : ouvert, cotes = probabilités en direct avec la marge Goalz', async () => {
  const m = at(live('football', FOOT_ODDS), "30'", '1 - 0');
  const mk = liveMarket(m, T);
  eq([mk.open, mk.reason], [true, null], 'ouvert');
  eq(mk.odds, fromProbabilities(liveProbs(m, T)), 'cotes');
  eq(Object.keys(mk.odds).sort(), ['1', '2', 'X'], 'issues du foot');
  eq(mk.state.score, [1, 0], 'état joint');
  eq(Object.keys(liveMarket(live('basketball', fromProbabilities({ 1: 0.5, 2: 0.5 })), T).odds).sort(), ['1', '2'], 'basket sans X');
  // Paliers lisibles : la cote du foot ne bouge qu'à la minute entière.
  const later = liveMarket({ ...m, clockAt: T - 50_000 }, T);
  eq(later.odds, mk.odds, 'même minute, mêmes cotes');
  ok(JSON.stringify(liveMarket({ ...m, clockAt: T - 61_000 }, T).odds) !== JSON.stringify(mk.odds), 'minute suivante, cotes nouvelles');
  // Mi-temps : on parie.
  eq(liveMarket(at(m, 'MT', '1 - 0'), T).open, true, 'mi-temps ouverte');
});

await test('liveMarket : règles de fermeture', async () => {
  const m = at(live('football', FOOT_ODDS), "30'", '1 - 0');
  const closed = (x, reason, msg) => {
    const mk = liveMarket(x, T);
    eq([mk.open, mk.reason], [false, reason], msg);
    ok(Object.values(mk.odds).every((v) => v === null), `${msg} : aucune cote proposée`);
  };
  closed({ ...m, sport: 'mma', odds: { 1: 1.8, 2: 2 } }, 'Pas de paris en direct sur ce sport', 'MMA');
  closed({ ...m, sport: 'boxing', odds: { 1: 1.8, 2: 2 } }, 'Pas de paris en direct sur ce sport', 'boxe');
  closed({ ...m, status: 'scheduled', startsAt: T + MIN }, 'Match pas encore commencé', 'à venir');
  closed({ ...m, status: 'finished' }, 'Match terminé', 'terminé');
  closed({ ...m, status: 'void' }, 'Match terminé', 'annulé');
  closed({ ...m, status: 'scheduled', startsAt: T - MIN }, 'En attente du coup d\'envoi', 'vrai match pas encore confirmé');
  closed({ ...m, clock: 'Résultat à venir' }, 'Score en attente', 'horloge illisible');
  // Suspendu après un but : vrais matchs SUSPEND_MS.real, fictifs SUSPEND_MS.fake.
  closed({ ...m, scoreAt: T - SUSPEND_MS.real + 1000 }, 'But ! Cotes en cours de mise à jour', 'but récent');
  eq(liveMarket({ ...m, scoreAt: T - SUSPEND_MS.real }, T).open, true, 'fin de la suspension');
  const fake = { ...m, real: false, meta: { model: fitParams('football', devig(FOOT_ODDS)), sim: { at: T - 2000 } } };
  closed({ ...fake, scoreAt: T - SUSPEND_MS.fake + 500 }, 'But ! Cotes en cours de mise à jour', 'fictif : but récent');
  eq(liveMarket({ ...fake, scoreAt: T - SUSPEND_MS.fake }, T).open, true, 'fictif : suspension courte');
  // Source muette.
  closed({ ...m, seenAt: T - STALE_MS - 1 }, 'Score en attente', 'source muette');
  eq(liveMarket({ ...m, seenAt: T - STALE_MS }, T).open, true, 'source lue juste à temps');
  closed({ ...m, seenAt: undefined }, 'Score en attente', 'jamais lue');
  closed({ ...fake, meta: { ...fake.meta, sim: { at: T - 15 * MIN } } }, 'Score en attente', 'fictif : temps avancé, simulation pas relancée');
  closed({ ...fake, meta: { model: fake.meta.model } }, 'Score en attente', 'fictif sans simulation');
  // Fin de match, prolongation, interruption.
  closed(at(m, "85'", '1 - 1'), 'Fin de match proche', "85'");
  closed(at(m, "80'", '1 - 1', { clockAt: T - 5 * MIN }), 'Fin de match proche', "80' lue il y a 5 min");
  closed(at(m, 'Interrompu', '1 - 1'), 'Match interrompu', 'interrompu');
  const bm = live('basketball', fromProbabilities({ 1: 0.5, 2: 0.5 }));
  closed(at(bm, 'Q4 1:30', '90 - 88'), 'Fin de match proche', 'basket 1:30');
  closed(at(bm, 'Prol. 3:10', '101 - 99'), 'Prolongation', 'basket prolongation');
  closed(at(live('hockey', fromProbabilities({ 1: 0.5, 2: 0.5 })), 'TAB', '2 - 2'), 'Tirs au but', 'hockey TAB');
  // Plus aucune issue entre MIN_ODDS et MAX_ODDS : marché fermé.
  closed(at(m, "70'", '4 - 0'), 'Issue quasi certaine', '4-0 à la 70e');
  closed(at(live('tennis', fromProbabilities({ 1: 0.5, 2: 0.5 })), '2e set', '6-0 5-0'), 'Issue quasi certaine', 'tennis 6-0 5-0');
});

await test('liveMarket : issues hors de [MIN_ODDS, MAX_ODDS[ non proposées', async () => {
  let partial = 0;
  for (const score of ['0 - 0', '1 - 0', '2 - 0', '0 - 1', '0 - 2', '3 - 1', '2 - 2']) {
    for (const minute of [5, 30, 55, 70, 84]) {
      const m = at(live('football', FOOT_ODDS), `${minute}'`, score);
      const mk = liveMarket(m, T);
      const priced = fromProbabilities(liveProbs(m, T));
      for (const k of ['1', 'X', '2']) {
        const inside = priced[k] >= MIN_ODDS && priced[k] < MAX_ODDS;
        eq(mk.odds[k], mk.open && inside ? priced[k] : null, `${score} à la ${minute}e [${k}]`);
      }
      if (mk.open && Object.values(mk.odds).includes(null)) partial++;
      eq(mk.open, Object.values(priced).some((o) => o >= MIN_ODDS && o < MAX_ODDS), `${score} à la ${minute}e : ouvert`);
    }
  }
  ok(partial >= 5, 'des marchés ouverts avec une partie des issues seulement');
  // Exemple précis : 1-0 à la 70e pour un favori, seul le nul reste proposé.
  const fav = at(live('football', fromProbabilities({ 1: 0.7, X: 0.18, 2: 0.12 })), "70'", '1 - 0');
  const mk = liveMarket(fav, T);
  eq([mk.open, mk.odds[1], mk.odds[2]], [true, null, null], 'favori à 1-0 : victoire trop sûre, défaite trop improbable');
  ok(mk.odds.X >= MIN_ODDS && mk.odds.X < MAX_ODDS, 'nul proposé');
});

await test('liveMarket : 10 000 appels bien en dessous d\'une seconde', async () => {
  const two = fromProbabilities({ 1: 0.55, 2: 0.45 });
  const matches = [
    at(live('football', FOOT_ODDS), "67'", '1 - 1', { clockAt: T - 90_000 }),
    at(live('football', fromProbabilities({ 1: 0.2, X: 0.25, 2: 0.55 })), "12'", '0 - 0'),
    at(live('basketball', two, { meta: { league: 'nba' } }), 'Q3 5:12', '71 - 66'),
    at(live('basketball', two, { meta: { league: 'wnba' } }), 'Q2 1:12', '30 - 36'),
    at(live('hockey', two), 'P2 12:00', '2 - 1'),
    at(live('americanfootball', two), 'Q3 9:40', '17 - 10'),
    at(live('rugby', fromProbabilities({ 1: 0.5, X: 0.03, 2: 0.47 }), { startsAt: T - 30 * MIN }), '1re MT', '10 - 7'),
    at(live('tennis', two, { meta: { league: 'atp' }, competition: 'Wimbledon · ATP' }), '3e set', '6-4 3-6 2-1'),
  ];
  const t0 = Date.now();
  let open = 0;
  for (let i = 0; i < 10_000; i++) if (liveMarket(matches[i % matches.length], T + (i % 7) * 1000).open) open++;
  const ms = Date.now() - t0;
  print(`  10 000 appels : ${ms} ms`);
  ok(open === 10_000, 'tous ouverts');
  ok(ms < 400, `trop lent : ${ms} ms`);
});

// ─── Régressions (relecture) ─────────────────────────────────────────────────
await test('foot réel : temps additionnel compté dans le temps restant (fictifs inchangés)', async () => {
  const even = fromProbabilities({ 1: 0.37, X: 0.27, 2: 0.36 });
  // 0-0 à la 80e, match équilibré : environ 15 % par équipe chez les bookmakers (11 % sans temps additionnel).
  const p80 = liveProbs(at(live('football', even), "80'", '0 - 0'), T);
  ok(p80[1] > 0.14 && p80[2] > 0.14 && p80.X < 0.72, `0-0 à la 80e : ${JSON.stringify(p80)}`);
  // Le temps restant ne remonte jamais : 44', 45'+1', MT, 46', 84'.
  const draw = (clock) => liveProbs(at(live('football', even), clock, '0 - 0'), T).X;
  const seq = ["44'", "45'+1'", "45'+3'", 'MT', "46'", "60'", "84'"].map(draw);
  ok(seq.every((x, i) => i === 0 || x >= seq[i - 1] - 1e-12), `nul croissant avec le temps : ${seq}`);
  // Coup d'envoi : toujours les probabilités d'avant-match.
  nearProbs(liveProbs(live('football', even), T), devig(even), 1e-6, 'coup d\'envoi');
  // Fictif : la simulation s'arrête à 90', le modèle aussi (Poisson sur les 10 dernières minutes).
  const model = fitParams('football', devig(even));
  const fake = { ...at(live('football', even), "80'", '0 - 0'), real: false, meta: { model, sim: { at: T } } };
  const pf = liveProbs(fake, T);
  const pois = (l, k) => Math.exp(-l) * l ** k / [1, 1, 2, 6, 24, 120, 720][k];
  let tie = 0;
  for (let k = 0; k <= 6; k++) tie += pois(model.lh / 9, k) * pois(model.la / 9, k);
  near(pf.X, tie, 1e-6, 'fictif à la 80e : buts sur les 10 dernières minutes seulement');
});

await test('rugby : 2e mi-temps rouverte en cours de route, reprise estimée', async () => {
  const odds = fromProbabilities({ 1: 0.49, X: 0.02, 2: 0.49 });
  // Coup d'envoi il y a 88 min, page rouverte maintenant : clockAt = maintenant, pas l'heure de la reprise.
  const reopened = liveState(at(live('rugby', odds, { startsAt: T - 88 * MIN, clockAt: T }), '2e MT', '14 - 10'), T);
  near(reopened.progress, (40 + 28) / 80, 1e-12, 'reprise estimée 60 min après le coup d\'envoi');
  // Reprise vue en direct (65 min après le coup d'envoi) : clockAt fait foi.
  const seen = liveState(at(live('rugby', odds, { startsAt: T - 85 * MIN, clockAt: T - 20 * MIN }), '2e MT', '14 - 10'), T);
  near(seen.progress, 60 / 80, 1e-12, 'reprise vue');
  // Sans clockAt : même estimation.
  const none = liveState(at(live('rugby', odds, { startsAt: T - 88 * MIN, clockAt: undefined }), '2e MT', '14 - 10'), T);
  near(none.progress, (40 + 28) / 80, 1e-12, 'sans clockAt');
});

await test('probabilités toujours dans [0, 1], modèle stocké abîmé sans plantage', async () => {
  const two = fromProbabilities({ 1: 0.3, 2: 0.7 });
  for (const score of ['10 - 3', '3 - 10', '99999999999999999999 - 0', '0 - 99999999999999999999'])
    for (const clock of ['P1 20:00', 'P3 15:00', 'MT', 'Fin P2']) {
      const p = liveProbs(at(live('hockey', two), clock, score), T);
      ok(p[1] >= 0 && p[1] <= 1 && p[2] >= 0 && p[2] <= 1, `hockey ${score} ${clock} : ${JSON.stringify(p)}`);
    }
  // meta.model relu du localStorage, incomplet ou d'un autre sport : marché fermé, jamais d'exception ni de NaN.
  const broken = [{ sport: 'tennis' }, { sport: 'tennis', g: 0.6 }, { sport: 'tennis', g: 0.6, bestOf: 4 },
    { sport: 'basketball', mu: 'x', sigma: 12, pOT: 0.5 }, { sport: 'football', lh: NaN, la: 1 }, { sport: 'hockey' }];
  for (const model of broken) {
    const sport = model.sport;
    const m = { ...live(sport, sport === 'football' ? FOOT_ODDS : two), real: false, meta: { model, sim: { at: T } } };
    eq(liveProbs(m, T), null, `${JSON.stringify(model)} : pas de probabilités`);
    const mk = liveMarket(m, T);
    eq([mk.open, mk.reason], [false, 'Cotes indisponibles'], `${JSON.stringify(model)} : fermé`);
  }
});

print('ALL PASS');
