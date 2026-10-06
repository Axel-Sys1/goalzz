// Tests de l'adaptateur ESPN des sports collectifs, sur des réponses ESPN réelles enregistrées
// (tests/fixtures/team, allégées : liens, diffusions, statistiques de joueurs retirés).
// Lancer (pas de node) :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/teamSports.test.mjs
globalThis.console ??= { warn: () => {}, log: print, error: print };

import { createTeamSportsAdapter, LEAGUES } from '../js/providers/espn/teamSports.js';
import { HttpError, matchId, etDay } from '../js/providers/espn/common.js';
import { fromBookmaker, fromProbabilities, neutralProbs } from '../js/providers/odds.js';

const DIR = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, ''));
const load = (name) => JSON.parse(readFile(`${DIR}fixtures/team/${name}`));

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
async function throws(fn, msg) {
  try { await fn(); } catch { return; }
  fail(`${msg} : aucune erreur levée`);
}

// Faux réseau : [morceau d'URL, fichier | fonction(url)] ; toute autre URL répond HTTP 400 comme ESPN.
function adapterWith(routes, { leagues = LEAGUES, down = [] } = {}) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    if (down.some((part) => url.includes(part))) throw new HttpError(503, url);
    for (const [part, src] of routes) {
      if (url.includes(part)) return typeof src === 'function' ? src(url) : load(src);
    }
    throw new HttpError(400, url);
  };
  return { adapter: createTeamSportsAdapter({ getJson, leagues }), calls };
}

const only = (...keys) => LEAGUES.filter((l) => keys.includes(l.league));
const at = (iso) => Date.parse(iso);
const byEvent = (ms, id) => ms.find((m) => m.meta.eventId === id) || fail(`match ${id} absent`);
const updateOf = (us, m) => us.find((u) => u.matchId === m.id);
const HEADER = 'scoreboard/header';

// Match déjà connu du cœur (forme minimale utile à results()).
const known = (sport, league, eventId, iso) => ({
  id: matchId(sport, league, eventId), sport, startsAt: at(iso), status: 'scheduled',
  meta: { adapter: 'team', league, eventId, day: etDay(at(iso)) },
});

// Événement d'une réponse d'en-tête, pour fabriquer une variante.
const headerEvents = (d) => d.sports[0].leagues[0].events;
const withHeaderEvent = (file, id, patch) => () => {
  const d = load(file);
  const ev = headerEvents(d).find((e) => e.id === id);
  patch(ev);
  return d;
};
const home = (ev) => ev.competitors.find((c) => c.homeAway === 'home');
const away = (ev) => ev.competitors.find((c) => c.homeAway === 'away');

// ─── Liste ───────────────────────────────────────────────────────────────────
await test('liste football (en-tête MLS) : ids, domicile/extérieur, heures, cotes, reporté', async () => {
  const { adapter, calls } = adapterWith([['league=usa.1', 'header_soccer_usa.1_20260926-20261010.json']], { leagues: only('usa.1') });
  const ms = await adapter.upcoming({ now: at('2026-09-26T20:00Z'), days: 7 });
  eq(calls, ['https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=soccer&league=usa.1&dates=20260925-20261003&limit=500'], 'URL');
  eq(ms.length, 16, 'nombre de matchs dans la fenêtre (-36 h, +7 j)');
  eq(new Set(ms.map((m) => m.id)).size, ms.length, 'ids uniques');

  const m = byEvent(ms, '761830');
  eq(m.id, 'espn:football:usa.1:761830', 'id');
  eq([m.source, m.real, m.sport, m.competition, m.status, m.outcome, m.score], ['espn', true, 'football', 'MLS', 'scheduled', null, null], 'champs');
  eq(m.competitionLogo, 'https://a.espncdn.com/i/leaguelogos/soccer/500/19.png', 'logo compétition');
  // L'en-tête liste l'extérieur (New York City FC) en premier : l'équipe à domicile est Atlanta.
  eq([m.home.name, m.home.short, m.home.color, m.home.record], ['Atlanta United FC', 'ATL', '#9d2235', '7-5-14'], 'domicile');
  eq([m.away.name, m.away.short], ['New York City FC', 'NYC'], 'extérieur');
  eq(m.home.logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/18418.png', 'logo domicile');
  eq(m.startsAt, at('2026-09-26T23:30:00Z'), 'heure (date ISO, pas le texte du statut)');
  // DraftKings +150 / +250 / +155 → décimal → marge Goalz.
  eq(m.oddsSource, 'bookmaker', 'source des cotes');
  eq(m.odds, fromBookmaker({ 1: 2.5, X: 3.5, 2: 2.55 }), 'cotes bookmaker');
  eq(m.meta, { adapter: 'team', league: 'usa.1', eventId: '761830', day: '20260926' }, 'meta');

  // Reporté (scores '0'-'0') : annulé, surtout pas un nul.
  const p = byEvent(ms, '761833');
  eq([p.status, p.outcome], ['void', 'void'], 'reporté');

  // Sans cote DraftKings : modèle 1N2 (Seattle 8-8-9 nettement devant Kansas City 5-3-17).
  const md = byEvent(ms, '761798');
  eq(md.oddsSource, 'model', 'modèle');
  ok(md.odds.X > 1 && md.odds[1] < md.odds[2], `cotes modèle incohérentes ${JSON.stringify(md.odds)}`);
  eq(md.meta.day, '20261001', 'journée ESPN (New York) de 01:30Z');

  ok(!ms.some((x) => x.meta.eventId === '761660'), 'hors fenêtre exclu');
  const text = JSON.stringify(ms).toLowerCase();
  ok(!/draftkings|sportsbook|bet365|espnbet/.test(text), 'lien ou marque de bookmaker stocké');
  ok(ms.every((x) => JSON.stringify(x.meta).length < 120), 'meta trop lourde');
});

await test('liste football : repli jour par jour si l\'en-tête échoue, cote OFF → modèle', async () => {
  const offOdds = () => {
    const d = load('scoreboard_soccer_usa.1_20260926.json');
    const c = d.events.find((e) => e.id === '761831').competitions[0];
    c.odds[0].moneyline.home.close.odds = 'OFF';
    return d;
  };
  const { adapter, calls } = adapterWith([['soccer/usa.1/scoreboard?dates=20260926', offOdds]], { leagues: only('usa.1'), down: [HEADER] });
  const ms = await adapter.upcoming({ now: at('2026-09-26T20:00Z'), days: 7 });
  ok(calls.includes('https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=20260926&limit=1000'), 'URL jour');
  eq(calls.filter((u) => u.includes('/scoreboard?dates=')).length, 9, 'une requête par journée ESPN');
  eq(ms.length, 14, 'matchs du jour lu (les autres journées ont échoué)');
  const m = byEvent(ms, '761830');
  eq([m.home.short, m.away.short, m.oddsSource], ['ATL', 'NYC', 'bookmaker'], 'tableau : domicile en premier');
  eq(m.odds, fromBookmaker({ 1: 2.5, X: 3.5, 2: 2.55 }), 'cotes texte américaines');
  eq(byEvent(ms, '761831').oddsSource, 'model', 'cote OFF → modèle');
  eq(byEvent(ms, '761833').status, 'void', 'reporté');
});

await test('liste football terminée (Ligue des nations) : 1 / N / 2, score, modèle, phase', async () => {
  const { adapter } = adapterWith([['league=uefa.nations', 'header_soccer_uefa.nations_20260926-20261003.json']], { leagues: only('uefa.nations') });
  const ms = await adapter.upcoming({ now: at('2026-09-27T12:00Z'), days: 7 });
  const res = (id) => { const m = byEvent(ms, id); return [m.status, m.outcome, m.score]; };
  eq(res('401861062'), ['finished', '1', '2 - 0'], 'victoire à domicile (Albanie)');
  eq(res('401861061'), ['finished', '2', '1 - 2'], 'victoire à l\'extérieur (Luxembourg)');
  eq(res('401861059'), ['finished', '2', '0 - 7'], 'victoire à l\'extérieur (Finlande)');
  eq(res('401861060'), ['finished', 'X', '1 - 1'], 'nul');
  eq(res('401861057'), ['finished', 'X', '0 - 0'], 'nul 0-0');
  eq(byEvent(ms, '401861062').oddsSource, 'model', 'pas de cote → modèle');
  eq(byEvent(ms, '401861061').oddsSource, 'bookmaker', 'cote de clôture gardée');
  eq(byEvent(ms, '401861061').round, 'Groupe C4', 'phase traduite');
  const s = byEvent(ms, '401861067');
  eq([s.status, s.score, s.liveScore], ['scheduled', null, undefined], 'score \'\' avant le match : aucun score');
  ok(byEvent(ms, '401861057').home.logo.includes('/countries/'), 'logo de sélection nationale gardé');
});

await test('liste basket WNBA : TBD, « If Necessary », cotes bookmaker ou modèle, tour', async () => {
  const { adapter } = adapterWith([['league=wnba', 'header_basketball_wnba_20260926-20261010.json']], { leagues: only('wnba') });
  const ms = await adapter.upcoming({ now: at('2026-09-27T12:00Z'), days: 14 });
  eq(ms.length, 8, 'matchs 1 et 2 du 1er tour seulement');
  ok(!ms.some((m) => /TBD/.test(m.home.name + m.away.name)), 'adversaire TBD listé');
  ok(!ms.some((m) => ['401918021', '401918295'].includes(m.meta.eventId)), 'If Necessary (heure non fixée) ou TBD à heure fixée listé');
  const g1 = byEvent(ms, '401918014');
  eq([g1.home.short, g1.away.short, g1.home.record], ['MIN', 'NY', '33-11'], 'équipes');
  eq(g1.oddsSource, 'bookmaker', 'cote match 1');
  eq(g1.odds, fromBookmaker({ 1: 1 + 100 / 258, 2: 3.1 }), 'moneyline -258 / +210');
  eq(Object.keys(g1.odds).sort(), ['1', '2'], 'basket : 2 issues');
  eq(g1.round, '1er tour · match 1', 'tour');
  const g2 = byEvent(ms, '401918018');
  eq([g2.oddsSource, Object.keys(g2.odds).length], ['model', 2], 'match 2 : modèle à 2 issues');
});

await test('liste hockey NHL : en direct, cotes à 2 issues, bilan V-D-DP, présaison', async () => {
  const { adapter } = adapterWith([['league=nhl', 'header_hockey_nhl_20260926-20261003.json']], { leagues: only('nhl') });
  const ms = await adapter.upcoming({ now: at('2026-09-26T20:30Z'), days: 7 });
  const live = byEvent(ms, '401879457');
  eq([live.status, live.liveScore, live.clock, live.score], ['live', '0 - 2', 'Fin P2', null], 'en direct');
  eq(live.round, 'Présaison', 'présaison');
  const odds = byEvent(ms, '401891773');
  eq([odds.oddsSource, odds.round], ['bookmaker', undefined], 'saison régulière avec cotes');
  eq(odds.odds, fromBookmaker({ 1: 1 + 100 / 130, 2: 2.1 }), 'moneyline (prolongation et tirs au but inclus)');
  const model = byEvent(ms, '401892432');
  eq([model.oddsSource, Object.keys(model.odds).sort()], ['model', ['1', '2']], 'modèle sans X');
  eq(byEvent(ms, '401879361').away.record, '2-0-1', 'bilan « 2-0-1, 5 PTS » raccourci');
});

await test('liste foot US NFL : cotes 1/2, semaine', async () => {
  const { adapter } = adapterWith([['league=nfl', 'header_football_nfl_20260926-20261006.json']], { leagues: only('nfl') });
  const ms = await adapter.upcoming({ now: at('2026-09-27T12:00Z'), days: 7 });
  eq(ms.length, 16, 'semaine 3 et jeudi de la semaine 4 (jusqu\'au 4/10 12:00Z)');
  ok(ms.every((m) => m.oddsSource === 'bookmaker' && m.odds.X === undefined), 'toutes cotées, sans X');
  const m = byEvent(ms, '401872953');
  eq([m.sport, m.home.short, m.away.short, m.round], ['americanfootball', 'BUF', 'LAC', 'Semaine 3'], 'match');
  eq(m.id, 'espn:americanfootball:nfl:401872953', 'id avec la clé Goalz du sport');
  eq(byEvent(ms, '401872960').round, 'Semaine 3', 'note « NFL Rio Game » ignorée');
});

await test('liste rugby Top 14 : fantômes, doublon, sigles, logos faux, résultats, modèle 1N2', async () => {
  const { adapter } = adapterWith([['league=270559', 'header_rugby_270559_20260926-20261031.json']], { leagues: only('270559') });
  const ms = await adapter.upcoming({ now: at('2026-09-27T12:00Z'), days: 7 });
  const ids = ms.map((m) => m.meta.eventId);
  ok(!ids.includes('604853'), 'fantôme « à venir » dans le passé listé');
  ok(!ids.includes('604855'), 'fantôme d\'une autre saison sans logos listé');
  ok(ids.includes('604392') && !ids.includes('604393'), 'doublon (même affiche, même heure) non retiré');
  eq(ms.length, 13, 'nombre de matchs (26/09 → 04/10 12:00Z)');
  const perp = byEvent(ms, '604381');
  eq([perp.status, perp.outcome, perp.score], ['finished', '1', '38 - 25'], 'victoire à domicile');
  eq([perp.home.name, perp.home.short, perp.home.logo, perp.away.short], ['Perpignan', 'USAP', undefined, 'UBB'], 'sigles et logo « drapeau USA » retiré');
  eq(byEvent(ms, '604384').outcome, '2', 'victoire à l\'extérieur (Bayonne)');
  const next = byEvent(ms, '604387');
  eq([next.home.short, next.away.short, next.home.record], ['ST', 'MHR', undefined], 'plus de « STA »');
  eq(next.oddsSource, 'model', 'pas de cote rugby');
  ok(next.odds.X > 1 && next.odds[1] > 1 && next.odds[2] > 1, 'rugby : 1 / N / 2');
  ok(next.odds.X >= 10, `nul rugby trop probable ${next.odds.X}`);
  eq(next.competitionLogo, undefined, 'pas de logo de compétition inventé');
});

await test('liste rugby : fantôme STATUS_TBD de la même saison (Top 14, 9 mai 2026) non listé', async () => {
  const { adapter } = adapterWith([['league=270559', 'header_rugby_270559_20260509.json']], { leagues: only('270559') });
  const ms = await adapter.upcoming({ now: at('2026-05-09T12:00Z'), days: 1 });
  // 603959 « Bordeaux–Bayonne » à 15:25Z : saison 2026 comme les vrais matchs, sans logos, statut STATUS_TBD.
  ok(!ms.some((m) => m.meta.eventId === '603959'), 'fantôme « Bordeaux–Bayonne » listé');
  const real = byEvent(ms, '602834');
  eq([real.home.name, real.away.name, real.startsAt], ['Bayonne', 'Bordeaux Begles', at('2026-05-09T14:35:00Z')], 'vrai match');
  eq(ms.length, 6, 'les six vrais matchs du jour');
});

await test('liste : n\'échoue que si toutes les ligues échouent', async () => {
  const none = adapterWith([], { leagues: only('usa.1', 'nba') });
  await throws(() => none.adapter.upcoming({ now: at('2026-09-26T20:00Z'), days: 7 }), 'tout en panne');
  const some = adapterWith([['league=usa.1', 'header_soccer_usa.1_20260926-20261010.json']], { leagues: only('usa.1', 'nba') });
  eq((await some.adapter.upcoming({ now: at('2026-09-26T20:00Z'), days: 7 })).length, 16, 'ligue en panne ignorée');
});

// ─── Résultats ───────────────────────────────────────────────────────────────
await test('résultats basket NBA (en-tête) : prolongation, victoires, reporté', async () => {
  const { adapter, calls } = adapterWith([['league=nba', 'header_basketball_nba_20260105-20260110.json']]);
  const ot = known('basketball', 'nba', '401810362', '2026-01-06T01:30:00Z');
  const homeWin = known('basketball', 'nba', '401810357', '2026-01-06T00:00:00Z');
  const pp = known('basketball', 'nba', '401810384', '2026-01-09T01:00:00Z');
  const us = await adapter.results({ now: at('2026-01-10T12:00Z'), matches: [ot, homeWin, pp] });
  eq(calls, ['https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=basketball&league=nba&dates=20260105-20260108&limit=500'], 'une requête pour la ligue');
  eq(updateOf(us, ot), { matchId: ot.id, status: 'finished', outcome: '2', score: '124 - 125 (prol.)' }, 'Denver gagne après prolongation');
  eq(updateOf(us, homeWin), { matchId: homeWin.id, status: 'finished', outcome: '1', score: '121 - 90' }, 'Detroit gagne');
  eq(updateOf(us, pp), { matchId: pp.id, status: 'void' }, 'reporté');
});

await test('résultats basket : repli sur le tableau du jour (vainqueur absent si reporté)', async () => {
  const { adapter, calls } = adapterWith([['basketball/nba/scoreboard?dates=20260108', 'scoreboard_basketball_nba_20260108.json']], { down: [HEADER] });
  const away = known('basketball', 'nba', '401810383', '2026-01-09T00:00Z');
  const pp = known('basketball', 'nba', '401810384', '2026-01-09T01:00Z');
  const us = await adapter.results({ now: at('2026-01-09T12:00Z'), matches: [away, pp] });
  ok(calls.some((u) => u.includes('/basketball/nba/scoreboard?dates=20260108&limit=1000')), 'URL jour');
  eq(updateOf(us, away), { matchId: away.id, status: 'finished', outcome: '2', score: '112 - 114' }, 'Indiana gagne à Charlotte');
  eq(updateOf(us, pp), { matchId: pp.id, status: 'void' }, 'reporté');
});

await test('résultats hockey NHL : tirs au but et prolongation inclus dans le vainqueur', async () => {
  const board = () => {
    const d = load('scoreboard_hockey_nhl_20260920.json');
    const t = d.events.find((e) => e.id === '401879644').status;
    Object.assign(t, { period: 4 });
    Object.assign(t.type, { detail: 'Final/OT', shortDetail: 'Final/OT' });
    return d;
  };
  const { adapter } = adapterWith([['hockey/nhl/scoreboard?dates=20260920', board]], { down: [HEADER] });
  const so = known('hockey', 'nhl', '401879358', '2026-09-20T21:00Z');
  const ot = known('hockey', 'nhl', '401879644', '2026-09-20T17:00Z');
  const aw = known('hockey', 'nhl', '401879309', '2026-09-21T00:00Z');
  const us = await adapter.results({ now: at('2026-09-21T12:00Z'), matches: [so, ot, aw] });
  eq(updateOf(us, so), { matchId: so.id, status: 'finished', outcome: '1', score: '3 - 2 (t.a.b.)' }, 'tirs au but');
  eq(updateOf(us, ot), { matchId: ot.id, status: 'finished', outcome: '1', score: '2 - 1 (prol.)' }, 'prolongation');
  eq(updateOf(us, aw), { matchId: aw.id, status: 'finished', outcome: '2', score: '2 - 4' }, 'victoire à l\'extérieur');
});

await test('résultats foot US NFL : match nul → X (remboursé par le cœur faute de cote X)', async () => {
  const { adapter } = adapterWith([['football/nfl/scoreboard?dates=20250928', 'scoreboard_football_nfl_20250928.json']], { down: [HEADER] });
  const tie = known('americanfootball', 'nfl', '401772921', '2025-09-29T00:20Z');
  const aw = known('americanfootball', 'nfl', '401772845', '2025-09-28T17:00Z');
  const us = await adapter.results({ now: at('2025-09-29T12:00Z'), matches: [tie, aw] });
  eq(updateOf(us, tie), { matchId: tie.id, status: 'finished', outcome: 'X', score: '40 - 40 (prol.)' }, 'nul Dallas–Green Bay');
  eq(updateOf(us, aw), { matchId: aw.id, status: 'finished', outcome: '2', score: '25 - 31' }, 'Philadelphie gagne');
});

await test('résultats rugby : nul et victoire (URC), ligue hors configuration', async () => {
  const urc = [{ sport: 'rugby', league: '270557', name: 'URC' }];
  const { adapter } = adapterWith([['rugby/270557/scoreboard', 'scoreboard_rugby_270557_202510.json']], { leagues: urc, down: [HEADER] });
  const draw = known('rugby', '270557', '602539', '2025-10-03T19:05Z');
  const win = known('rugby', '270557', '602544', '2025-10-10T18:45Z');
  const us = await adapter.results({ now: at('2025-10-11T12:00Z'), matches: [draw, win] });
  eq(updateOf(us, draw), { matchId: draw.id, status: 'finished', outcome: 'X', score: '17 - 17' }, 'nul');
  eq(updateOf(us, win), { matchId: win.id, status: 'finished', outcome: '1', score: '20 - 19' }, 'victoire');
});

await test('résultats rugby : doublon ESPN resté « à venir » → on suit son jumeau terminé', async () => {
  // 604392 et 604393 : Racing 92–Perpignan, même heure, deux ids (vrai doublon du Top 14 en septembre 2026).
  const twin = withHeaderEvent('header_rugby_270559_20260926-20261031.json', '604393', (ev) => {
    Object.assign(ev.fullStatus.type, { name: 'STATUS_FINAL', state: 'post', completed: true, detail: 'FT' });
    home(ev).score = '24'; away(ev).score = '27'; home(ev).winner = false; away(ev).winner = true;
  });
  const { adapter } = adapterWith([['league=270559', twin]]);
  const m = known('rugby', '270559', '604392', '2026-10-03T14:35:00Z');
  eq(await adapter.results({ now: at('2026-10-03T15:00Z'), matches: [m] }), [{ matchId: m.id, status: 'scheduled' }], 'peu après le coup d\'envoi : on attend');
  eq(await adapter.results({ now: at('2026-10-03T18:00Z'), matches: [m] }),
    [{ matchId: m.id, status: 'finished', outcome: '2', score: '24 - 27' }], 'résultat du jumeau');
});

await test('résultats football : prolongation → 1N2 sur le score à 90 minutes (résumé du match)', async () => {
  const routes = [
    ['soccer/uefa.champions/scoreboard?dates=20260225', 'scoreboard_soccer_uefa.champions_20260225.json'],
    ['soccer/uefa.champions/summary?event=401858765', 'summary_soccer_uefa.champions_401858765.json'],
  ];
  const { adapter, calls } = adapterWith(routes, { down: [HEADER] });
  const aet = known('football', 'uefa.champions', '401858765', '2026-02-25T20:00Z');
  const tie = known('football', 'uefa.champions', '401858763', '2026-02-25T20:00Z');
  const win = known('football', 'uefa.champions', '401858762', '2026-02-25T17:45Z');
  const us = await adapter.results({ now: at('2026-02-26T10:00Z'), matches: [aet, tie, win] });
  ok(calls.includes('https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/summary?event=401858765'), 'URL résumé');
  // Juventus 3-0 à la 90e, 3-2 après prolongation, Galatasaray qualifié (winner = true) : le 1N2 est '1'.
  eq(updateOf(us, aet), { matchId: aet.id, status: 'finished', outcome: '1', score: '3 - 2 (a.p.)' }, 'a.p.');
  // PSG 2-2 Monaco avec winner = true pour le PSG (qualifié) : c'est un nul.
  eq(updateOf(us, tie), { matchId: tie.id, status: 'finished', outcome: 'X', score: '2 - 2' }, 'winner ignoré');
  eq(updateOf(us, win), { matchId: win.id, status: 'finished', outcome: '1', score: '4 - 1' }, 'victoire');
  // Deuxième lecture (confirmation du cœur) : le résumé, lourd, n'est pas redemandé.
  const again = await adapter.results({ now: at('2026-02-26T10:01Z'), matches: [aet] });
  eq(updateOf(again, aet)?.outcome, '1', 'deuxième lecture');
  eq(calls.filter((u) => u.includes('/summary?')).length, 1, 'résumé mis en cache');

  // Résumé indisponible : on ne règle pas (on réessaiera), les autres matchs si.
  const noSummary = adapterWith(routes.slice(0, 1), { down: [HEADER] });
  const us2 = await noSummary.adapter.results({ now: at('2026-02-26T10:00Z'), matches: [aet, win] });
  eq(updateOf(us2, aet), undefined, 'pas de règlement sans score à 90 minutes');
  eq(updateOf(us2, win)?.outcome, '1', 'autres matchs réglés');
});

await test('résultats football : tirs au but → nul à 90 minutes, score des tirs au but', async () => {
  const routes = [
    ['soccer/usa.1/scoreboard?dates=20251026', 'scoreboard_soccer_usa.1_20251026.json'],
    ['soccer/usa.1/summary?event=760067', 'summary_soccer_usa.1_760067.json'],
    ['soccer/fifa.world/scoreboard?dates=20260629', 'scoreboard_soccer_fifa.world_20260629.json'],
  ];
  const { adapter } = adapterWith(routes, { down: [HEADER] });
  const pen = known('football', 'usa.1', '760067', '2025-10-26T21:30Z');
  const us = await adapter.results({ now: at('2025-10-27T12:00Z'), matches: [pen] });
  eq(updateOf(us, pen), { matchId: pen.id, status: 'finished', outcome: 'X', score: '2 - 2 (t.a.b. 4-2)' }, 't.a.b.');
  // Coupe du monde (ligue hors configuration) sans résumé enregistré : rien, le match normal est réglé.
  const wc = known('football', 'fifa.world', '760489', '2026-06-29T20:30Z');
  const ft = known('football', 'fifa.world', '760487', '2026-06-29T17:00Z');
  const us2 = await adapter.results({ now: at('2026-06-30T12:00Z'), matches: [wc, ft] });
  eq(updateOf(us2, wc), undefined, 'tirs au but sans résumé');
  eq(updateOf(us2, ft), { matchId: ft.id, status: 'finished', outcome: '1', score: '2 - 1' }, 'Brésil–Japon');
});

await test('résultats football : périodes du résumé fausses → buts un par un (finale LdC 2026)', async () => {
  const routes = [
    ['league=uefa.champions', 'header_soccer_uefa.champions_20260530.json'],
    ['soccer/uefa.champions/summary?event=401862897', 'summary_soccer_uefa.champions_401862897.json'],
  ];
  const { adapter, calls } = adapterWith(routes);
  const final = known('football', 'uefa.champions', '401862897', '2026-05-30T16:00:00Z');
  // PSG 1-1 Arsenal, 4-3 aux t.a.b. Périodes du résumé '0','2','-1','0' / '1','1','-1','0' : 2-2 à la
  // mi-temps, faux. Buts : Arsenal à la 6e, PSG à la 65e → 1-1 à 90 minutes.
  const us = await adapter.results({ now: at('2026-05-30T20:00Z'), matches: [final] });
  eq(calls[0], 'https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=soccer&league=uefa.champions&dates=20260530-20260530&limit=500', 'URL');
  eq(updateOf(us, final), { matchId: final.id, status: 'finished', outcome: 'X', score: '1 - 1 (t.a.b. 4-3)' }, 'finale');
  const later = await adapter.results({ now: at('2026-06-02T20:00Z'), matches: [final] });
  eq(updateOf(later, final)?.outcome, 'X', 'toujours réglé ensuite (jamais bloqué, jamais remboursé)');
  eq(calls.filter((u) => u.includes('/summary?')).length, 1, 'résumé lu une seule fois');

  const listed = await adapterWith(routes, { leagues: only('uefa.champions') }).adapter.upcoming({ now: at('2026-05-30T21:00Z'), days: 1 });
  const m = byEvent(listed, '401862897');
  eq([m.status, m.outcome, m.score], ['finished', 'X', '1 - 1 (t.a.b. 4-3)'], 'listé terminé');

  // Même en match retour (règle du nul inapplicable), les buts un par un suffisent ; un but déplacé en
  // prolongation change le 1N2 (PSG 1-0 à la 90e).
  const asLeg2 = (patch) => () => {
    const d = load('summary_soccer_uefa.champions_401862897.json');
    d.header.competitions[0].leg = { value: 2, displayValue: '2nd Leg' };
    patch(d);
    return d;
  };
  const withGoals = (patch) => adapterWith([routes[0], [routes[1][0], asLeg2(patch)]]).adapter
    .results({ now: at('2026-05-30T20:00Z'), matches: [final] });
  eq((await withGoals(() => {}))[0]?.outcome, 'X', 'match retour : buts un par un');
  const moved = await withGoals((d) => { d.keyEvents.find((k) => k.scoringPlay && k.team.id === '359').period.number = 3; });
  eq(moved[0]?.outcome, '1', 'but d\'Arsenal en prolongation → PSG 1-0 à la 90e');
});

await test('résultats football : aucune source fiable, pas un match retour → nul à 90 minutes', async () => {
  const routes = [
    ['soccer/fifa.friendly/scoreboard?dates=20260330', 'scoreboard_soccer_fifa.friendly_20260330.json'],
    ['soccer/fifa.friendly/summary?event=401866485', 'summary_soccer_fifa.friendly_401866485.json'],
  ];
  const { adapter } = adapterWith(routes, { down: [HEADER] });
  // Trinité-et-Tobago 2-2 Gabon, tirs au but directs : périodes 0-0-0-0 (faux), aucun but détaillé.
  // Sans match aller, un match qui va en prolongation ou aux tirs au but était à égalité à la 90e.
  const pen = known('football', 'fifa.friendly', '401866485', '2026-03-30T10:00Z');
  const ft = known('football', 'fifa.friendly', '401856420', '2026-03-30T07:00Z');
  const us = await adapter.results({ now: at('2026-03-30T14:00Z'), matches: [pen, ft] });
  eq(updateOf(us, pen), { matchId: pen.id, status: 'finished', outcome: 'X', score: '2 - 2 (t.a.b. 2-3)' }, 't.a.b.');
  eq(updateOf(us, ft)?.status, 'finished', 'match normal du même jour');

  // Les mêmes données sur un match retour : périodes 0-0-0-0 pour un 2-2 rejetées, rien de réglable.
  const leg2 = adapterWith([routes[0], [routes[1][0], () => {
    const d = load(routes[1][1]);
    d.header.competitions[0].notes.unshift({ type: 'event', headline: '2nd Leg - Tied on aggregate' });
    return d;
  }]], { down: [HEADER] });
  eq(await leg2.adapter.results({ now: at('2026-03-30T14:00Z'), matches: [pen] }), [], 'match retour : pas de 0-0 inventé');
});

await test('résultats football : match retour sans score à 90 minutes fiable → remboursé après 36 h', async () => {
  // Finale LdC transformée en match retour, sans buts détaillés : ni les périodes ni la règle du nul ne valent.
  let summaryDown = false;
  const leg2 = (url) => {
    if (summaryDown) throw new HttpError(503, url);
    const d = load('summary_soccer_uefa.champions_401862897.json');
    d.header.competitions[0].leg = { value: 2, displayValue: '2nd Leg' };
    delete d.keyEvents;
    return d;
  };
  const { adapter, calls } = adapterWith([
    ['league=uefa.champions', 'header_soccer_uefa.champions_20260530.json'],
    ['soccer/uefa.champions/summary?event=401862897', leg2],
  ]);
  const m = known('football', 'uefa.champions', '401862897', '2026-05-30T16:00:00Z');
  const run = (iso) => adapter.results({ now: at(iso), matches: [m] });
  const summaries = () => calls.filter((u) => u.includes('/summary?')).length;
  eq(await run('2026-05-30T20:00Z'), [], 'avant 36 h : on attend');
  eq(await run('2026-05-30T20:30Z'), [], 'toujours en attente');
  eq(summaries(), 1, 'résumé (~450 Ko) non relu dans l\'heure');
  await run('2026-05-30T21:05Z');
  eq(summaries(), 2, 'relu au bout d\'une heure');
  summaryDown = true;
  eq(await run('2026-06-01T12:00Z'), [], 'résumé injoignable : jamais remboursé');
  summaryDown = false;
  eq(await run('2026-06-01T12:01Z'), [{ matchId: m.id, status: 'void' }], 'remboursé 36 h après le coup d\'envoi');
});

await test('résultats football : « FT » avec une horloge à 0\' (match peu suivi) → réglé, pas remboursé', async () => {
  const { adapter } = adapterWith([['league=fifa.friendly', 'header_soccer_fifa.friendly_20260526.json']], { leagues: only('fifa.friendly') });
  // Maroc 5-0 Burundi : STATUS_FULL_TIME, completed, horloge « 0' » (ESPN n'a pas suivi le match).
  const m = known('football', 'fifa.friendly', '401872678', '2026-05-26T11:00:00Z');
  const us = await adapter.results({ now: at('2026-05-26T14:00Z'), matches: [m] });
  eq(updateOf(us, m), { matchId: m.id, status: 'finished', outcome: '1', score: '5 - 0' }, 'Maroc–Burundi');
  const listed = byEvent(await adapter.upcoming({ now: at('2026-05-26T20:00Z'), days: 1 }), '401872678');
  eq([listed.status, listed.outcome, listed.score], ['finished', '1', '5 - 0'], 'listé terminé');
});

await test('résultats : annulé, arrêté, tapis vert → remboursés ; suspendu → on attend', async () => {
  const routes = [
    ['soccer/fifa.friendly/scoreboard?dates=20260928', 'scoreboard_soccer_fifa.friendly_20260928.json'],
    ['soccer/fra.1/scoreboard?dates=20260517', 'scoreboard_soccer_fra.1_20260517.json'],
    ['soccer/fra.2/scoreboard?dates=20251205', 'scoreboard_soccer_fra.2_20251205.json'],
  ];
  const { adapter } = adapterWith(routes, { down: [HEADER] });
  const canceled = known('football', 'fifa.friendly', '401916227', '2026-09-28T09:30Z');
  const abandoned = known('football', 'fra.1', '746714', '2026-05-17T19:00Z');
  const draw = known('football', 'fra.1', '746715', '2026-05-17T19:00Z');
  const awarded = known('football', 'fra.2', '747597', '2025-12-05T19:00Z');
  const normal = known('football', 'fra.2', '747600', '2025-12-05T19:00Z');
  const now = at('2026-09-28T12:00Z');
  const us = await adapter.results({ now, matches: [canceled, abandoned, draw, awarded, normal] });
  eq(updateOf(us, canceled), { matchId: canceled.id, status: 'void' }, 'annulé');
  eq(updateOf(us, abandoned), { matchId: abandoned.id, status: 'void' }, 'arrêté (STATUS_ABANDONED)');
  eq(updateOf(us, draw)?.outcome, 'X', 'Nice–Metz 0-0');
  // « FT » à la 58e sur 0-0, victoire donnée à Red Star : le score n'est pas le résultat → remboursé.
  eq(updateOf(us, awarded), { matchId: awarded.id, status: 'void' }, 'tapis vert');
  eq(updateOf(us, normal)?.outcome, '1', 'Grenoble 1-0');

  const suspended = adapterWith([['league=usa.1', withHeaderEvent('header_soccer_usa.1_20260926-20261010.json', '761830', (ev) => {
    Object.assign(ev.fullStatus.type, { name: 'STATUS_SUSPENDED', state: 'post', completed: false, detail: 'Suspended' });
    home(ev).score = '1'; away(ev).score = '0';
  })]]);
  const m = known('football', 'usa.1', '761830', '2026-09-26T23:30:00Z');
  const [u] = await suspended.adapter.results({ now: at('2026-09-28T12:00Z'), matches: [m] });
  eq(u, { matchId: m.id, status: 'live', liveScore: '1 - 0', clock: 'Interrompu' }, 'suspendu');
});

await test('résultats : en direct (score \'\' → 0), horloges basket / football, heure déplacée', async () => {
  const file = 'header_basketball_nba_20260105-20260110.json';
  const nba = adapterWith([['league=nba', () => {
    const d = load(file);
    const evs = headerEvents(d);
    const q3 = evs.find((e) => e.id === '401810357');
    Object.assign(q3.fullStatus, { period: 3, displayClock: '5:12' });
    Object.assign(q3.fullStatus.type, { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false });
    home(q3).score = '71'; away(q3).score = '';
    const ht = evs.find((e) => e.id === '401810358');
    Object.assign(ht.fullStatus.type, { name: 'STATUS_HALFTIME', state: 'in', completed: false });
    const moved = evs.find((e) => e.id === '401810359');
    Object.assign(moved.fullStatus.type, { name: 'STATUS_SCHEDULED', state: 'pre', completed: false });
    moved.date = '2026-01-06T02:00:00Z';
    return d;
  }]]);
  const q3 = known('basketball', 'nba', '401810357', '2026-01-06T00:00:00Z');
  const ht = known('basketball', 'nba', '401810358', '2026-01-06T00:30:00Z');
  const moved = known('basketball', 'nba', '401810359', '2026-01-06T00:30:00Z');
  const us = await nba.adapter.results({ now: at('2026-01-06T01:00Z'), matches: [q3, ht, moved] });
  eq(updateOf(us, q3), { matchId: q3.id, status: 'live', liveScore: '71 - 0', clock: 'Q3 5:12' }, 'Q3');
  eq(updateOf(us, ht)?.clock, 'MT', 'mi-temps');
  eq(updateOf(us, moved), { matchId: moved.id, status: 'scheduled', startsAt: at('2026-01-06T02:00:00Z') }, 'heure déplacée');

  const soccer = adapterWith([['league=uefa.nations', withHeaderEvent('header_soccer_uefa.nations_20260926-20261003.json', '401861067', (ev) => {
    Object.assign(ev.fullStatus, { period: 2, displayClock: "67'" });
    Object.assign(ev.fullStatus.type, { name: 'STATUS_SECOND_HALF', state: 'in', completed: false });
    home(ev).score = '2'; away(ev).score = '1';
  })]]);
  const live = known('football', 'uefa.nations', '401861067', '2026-09-27T13:00:00Z');
  const [u] = await soccer.adapter.results({ now: at('2026-09-27T14:10Z'), matches: [live] });
  eq(u, { matchId: live.id, status: 'live', liveScore: '2 - 1', clock: "67'" }, 'football en direct');
});

await test('résultats : jamais commencé ou disparu → remboursé seulement après 36 h et confirmation', async () => {
  const file = 'header_basketball_wnba_20260926-20261010.json';
  const dropped = () => {
    const d = load(file);
    d.sports[0].leagues[0].events = headerEvents(d).filter((e) => e.id !== '401918021');
    return d;
  };
  const emptyDay = () => ({ leagues: [{ slug: 'wnba' }], events: [] });
  // Match 3 « If Necessary » listé (heure fixée ensuite), puis supprimé par ESPN.
  const gone = known('basketball', 'wnba', '401918021', '2026-10-01T23:00Z');
  const stale = known('basketball', 'wnba', '401918018', '2026-09-29T22:30Z'); // encore « pre » dans l'en-tête

  const early = adapterWith([['league=wnba', dropped], ['wnba/scoreboard?dates=', emptyDay]]);
  const us1 = await early.adapter.results({ now: at('2026-10-02T12:00Z'), matches: [gone] });
  eq(us1, [], 'moins de 36 h : on attend');

  const late = adapterWith([['league=wnba', dropped], ['wnba/scoreboard?dates=20261001', emptyDay]]);
  const us2 = await late.adapter.results({ now: at('2026-10-03T12:00Z'), matches: [gone, stale] });
  eq(updateOf(us2, gone), { matchId: gone.id, status: 'void' }, 'absent de l\'en-tête ET du tableau du jour');
  ok(late.calls.some((u) => u.includes('/basketball/wnba/scoreboard?dates=20261001')), 'confirmation demandée');
  eq(updateOf(us2, stale), { matchId: stale.id, status: 'void' }, 'toujours « à venir » 36 h après');

  const unconfirmed = adapterWith([['league=wnba', dropped]]);
  const us3 = await unconfirmed.adapter.results({ now: at('2026-10-03T12:00Z'), matches: [gone] });
  eq(us3, [], 'confirmation en erreur : pas de remboursement');
});

await test('résultats : une erreur réseau ne rembourse jamais', async () => {
  const m = known('football', 'usa.1', '761830', '2026-09-20T23:30Z');
  const down = adapterWith([]);
  await throws(() => down.adapter.results({ now: at('2026-09-27T12:00Z'), matches: [m] }), 'tout en panne');
  const nba = known('basketball', 'nba', '401810357', '2026-01-06T00:00:00Z');
  const partial = adapterWith([['league=nba', 'header_basketball_nba_20260105-20260110.json']]);
  const us = await partial.adapter.results({ now: at('2026-09-27T12:00Z'), matches: [m, nba] });
  eq(us.map((u) => u.matchId), [nba.id], 'seule la ligue joignable est réglée, rien pour l\'autre');
});

await test('résultats : un match resté en suspens ne fait pas lire toute la saison dans l\'en-tête', async () => {
  const { adapter, calls } = adapterWith([['league=nba', 'header_basketball_nba_20260105-20260110.json']]);
  const stuck = known('basketball', 'nba', '401800001', '2025-12-01T01:00:00Z');
  const recent = known('basketball', 'nba', '401810357', '2026-01-06T00:00:00Z');
  const us = await adapter.results({ now: at('2026-01-06T12:00Z'), matches: [stuck, recent] });
  const ranges = calls.filter((u) => u.includes(HEADER)).map((u) => /dates=([\d-]+)/.exec(u)[1]).sort();
  eq(ranges, ['20251130-20251130', '20260105-20260105'], 'une plage par groupe de journées proches');
  eq(us.map((u) => u.matchId), [recent.id], 'match récent réglé, l\'ancien introuvable sans confirmation n\'est pas remboursé');
});

await test('cotes : modèle neutre sans aucun bilan', async () => {
  const bare = withHeaderEvent('header_soccer_usa.1_20260926-20261010.json', '761798', (ev) => {
    ev.competitors.forEach((c) => { delete c.recordStats; delete c.record; });
  });
  const { adapter } = adapterWith([['league=usa.1', bare]], { leagues: only('usa.1') });
  const ms = await adapter.upcoming({ now: at('2026-09-26T20:00Z'), days: 7 });
  eq(byEvent(ms, '761798').odds, fromProbabilities(neutralProbs(true)), 'cotes neutres');
  ok(typeof adapter.probeUrl === 'string' && adapter.probeUrl.startsWith('https://site.api.espn.com/'), 'probeUrl');
});

print('ALL PASS');
