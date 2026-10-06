// Tests de l'adaptateur ESPN MMA (js/providers/espn/mma.js), sans réseau.
// Lancer depuis n'importe quel dossier :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/mma.test.mjs
//
// Réponses ESPN enregistrées (tests/fixtures/mma/) :
// - ufc_scoreboard_20260926-20261025_upcoming.json  lu le 26/09/2026 vers 20:46 UTC, avant l'UFC Fight Night
//                                                    Rosas Jr. vs Barcelos (12 combats), Contender Series (TBA), UFC 332…
// - ufc_scoreboard_20260925-20261005_final.json     lu le 27/09/2026 à 08:22 UTC : la même soirée terminée
//                                                    (KO, soumissions, décisions, DQ), UFC 332 à venir.
// - core_status_<combat>.json                       méthode de victoire (API core) des 12 combats de cette soirée,
//                                                    + 401745828 (nul, UFC 312) et 401800640 (no contest, UFC 321).
// - core_odds_<combat>.json                         cotes DraftKings (API core) ; liens sportsbook retirés.
//                                                    401912278 : aucune cote ({ count: 0 }).
// - ufc_scoreboard_2025_draw_nocontest.json         UFC 312 et UFC 321 (2025) : seuls les deux événements utiles.
// - ufc_scoreboard_20200321_canceled_event.json     soirée annulée (COVID) : un combat TBA, STATUS_CANCELED.
// - pfl_scoreboard_20260701-20261231.json           PFL : soirées terminées, PFL Chicago, PFL Lyon (TBA).
// - pfl_scoreboard_2025_event_without_bouts.json    soirée PFL Africa 2 sans aucun combat (pas de competitions).
// Les cas absents des données réelles (combat en direct, annulé, reporté, suspendu, horaire non valide,
// cotes inversées ou d'un combattant remplacé) sont des COPIES de combats réels dont on change un champ.
import {
  createMmaAdapter, fighterShort, weightClassFr, cardName, methodLabel, liveClock, finalState, boutOdds,
  scoreboardUrl, oddsUrl, statusUrl,
} from '../js/providers/espn/mma.js';
import { americanToDecimal, fromBookmaker, fromProbabilities, combatProbs, parseRecord, MIN_ODDS, MAX_ODDS } from '../js/providers/odds.js';
import { HOUR, DAY } from '../js/providers/espn/common.js';

const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(/[^/]*$/, '');
const FX = `${HERE}fixtures/mma/`;

// ─── Outils ──────────────────────────────────────────────────────────────────
const texts = {};
const fixture = (name) => JSON.parse(texts[name] ??= readFile(FX + name)); // copie neuve à chaque appel

function fail(msg) { throw new Error(msg); }
const ok = (cond, msg) => { if (!cond) fail(msg); };
const eq = (got, want, msg) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${msg} : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);
};

const EMPTY_ODDS = { count: 0, pageIndex: 1, pageSize: 25, pageCount: 0, items: [] };
const ODDS = {
  401911630: 'core_odds_401911630_rosas_barcelos.json',
  401907089: 'core_odds_401907089.json',
  401912277: 'core_odds_401912277.json',
  401912278: 'core_odds_401912278.json',
};
const STATUS_IDS = ['401914472', '401914469', '401914466', '401914470', '401914467', '401911631', '401914468',
  '401914464', '401914465', '401924683', '401914471', '401911630', '401745828', '401800640'];

// Réseau simulé. `routes` : url exacte → nom de fixture | objet | Error.
// Par défaut : cotes core (fixture, sinon « aucune cote ») et statuts core des fixtures ; toute autre url → 404.
function fakeNet(routes = {}, { odds = {}, status = {} } = {}) {
  const calls = [];
  const resolve = (url) => {
    if (url in routes) return routes[url];
    let m = /\/competitions\/(\d+)\/odds$/.exec(url);
    if (m) return odds[m[1]] ?? ODDS[m[1]] ?? EMPTY_ODDS;
    m = /\/competitions\/(\d+)\/status$/.exec(url);
    if (m) return status[m[1]] ?? (STATUS_IDS.includes(m[1]) ? `core_status_${m[1]}.json` : undefined);
    return undefined;
  };
  const getJson = async (url) => {
    calls.push(url);
    const r = resolve(url);
    if (r === undefined) throw new Error(`HTTP 404 (url imprévue) ${url}`);
    if (r instanceof Error) throw r;
    if (typeof r === 'string') return fixture(r);
    return JSON.parse(JSON.stringify(r));
  };
  return { getJson, calls };
}

function boutIn(data, id) {
  for (const e of data.events) for (const c of e.competitions || []) if (c.id === id) return c;
  return fail(`combat ${id} absent de la fixture`);
}
const eventIn = (data, id) => data.events.find((e) => e.id === id) || fail(`soirée ${id} absente`);

// Match déjà connu du cœur, tel qu'il est transmis à results().
const stored = (league, eventId, boutId, iso) => ({
  id: `espn:mma:${league}:${boutId}`, startsAt: Date.parse(iso), status: 'scheduled',
  meta: { adapter: 'mma', league, eventId, day: 'x' },
});
// Les ids de liste finissent par '<combat>_<combattant1>_<combattant2>' : on indexe par combat.
const boutOnly = (id) => String(id).replace(/_[^:]*$/, '');
const byId = (list) => Object.fromEntries(list.map((m) => [boutOnly(m.id ?? m.matchId), m]));

// Instants de capture des fixtures.
const NOW_PRE = Date.parse('2026-09-26T20:46Z');
const NOW_POST = Date.parse('2026-09-27T08:22Z');
const PRE_SB = {
  [scoreboardUrl('ufc', '20260925-20261003')]: 'ufc_scoreboard_20260926-20261025_upcoming.json',
  [scoreboardUrl('pfl', '20260925-20261003')]: 'pfl_scoreboard_20260925-20261005_empty.json',
};
const POST_SB = {
  [scoreboardUrl('ufc', '20260925-20261004')]: 'ufc_scoreboard_20260925-20261005_final.json',
  [scoreboardUrl('pfl', '20260925-20261004')]: 'pfl_scoreboard_20260925-20261005_empty.json',
};
// Résultats de la soirée du 26/09 (plage = jour de la soirée).
const CARD_SB = { [scoreboardUrl('ufc', '20260926-20260926')]: 'ufc_scoreboard_20260925-20261005_final.json' };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── Fonctions pures ─────────────────────────────────────────────────────────
test('fighterShort : 3 lettres du nom de famille, sans accents ni suffixe', () => {
  eq(fighterShort('Raul Rosas Jr.'), 'ROS', 'suffixe Jr. ignoré');
  eq(fighterShort('Alatengheili'), 'ALA', 'nom unique');
  eq(fighterShort('Roberto Soldić'), 'SOL', 'accent');
  eq(fighterShort("Casey O'Neill"), 'ONE', 'apostrophe');
  eq(fighterShort('Cássio Barão'), 'BAR', 'accents');
});

test('weightClassFr : catégories en français, (F) pour les femmes', () => {
  eq(weightClassFr('Heavyweight'), 'Poids lourds', 'lourds');
  eq(weightClassFr('Light Heavyweight'), 'Mi-lourds', 'mi-lourds avant lourds');
  eq(weightClassFr('Lightweight'), 'Poids légers', 'légers');
  eq(weightClassFr('Welterweight'), 'Mi-moyens', 'mi-moyens');
  eq(weightClassFr('Middleweight'), 'Poids moyens', 'moyens');
  eq(weightClassFr('Featherweight'), 'Poids plumes', 'plumes');
  eq(weightClassFr('Bantamweight'), 'Poids coqs', 'coqs');
  eq(weightClassFr('Flyweight'), 'Poids mouches', 'mouches');
  eq(weightClassFr('W Strawweight'), 'Poids pailles (F)', 'pailles, femmes (scoreboard)');
  eq(weightClassFr("Women's Flyweight"), 'Poids mouches (F)', 'femmes (fightcenter)');
  eq(weightClassFr('Catch Weight'), 'Poids intermédiaire', 'catchweight');
  eq(weightClassFr(undefined), null, 'combat sans catégorie');
});

test('cardName : nom court de la soirée', () => {
  eq(cardName({ name: 'UFC 332: Silva vs. Wang', shortName: 'UFC 332' }), 'UFC 332', 'soirée numérotée');
  eq(cardName({ name: 'UFC Fight Night: Rosas Jr. vs. Barcelos', shortName: 'UFC Fight Night' }), 'UFC Fight Night: Rosas Jr. vs. Barcelos', 'Fight Night : affiche gardée');
  eq(cardName({ name: "Dana White's Contender Series: Season 10, Week 8", shortName: "Dana White's Contender Series" }), 'Contender Series', 'Contender Series');
  eq(cardName({ name: 'UFC 306 – Riyadh Season Noche UFC: O\'Malley vs. Dvalishvili', shortName: 'UFC 306 – Riyadh Season Noche UFC' }), 'UFC 306', 'sous-titre retiré');
  eq(cardName({ name: 'PFL Chicago: Carmouche vs. Bishop 2', shortName: 'PFL Chicago' }), 'PFL Chicago', 'PFL');
});

test('methodLabel / liveClock / finalState', () => {
  eq(methodLabel('kotko'), 'KO/TKO', 'KO');
  eq(methodLabel('submission'), 'Soumission', 'soumission');
  eq(methodLabel('decision---unanimous'), 'Décision unanime', 'unanime');
  eq(methodLabel('decision---split'), 'Décision partagée', 'partagée');
  eq(methodLabel('decision---majority'), 'Décision majoritaire', 'majoritaire');
  eq(methodLabel('dq'), 'Disqualification', 'DQ');
  eq(methodLabel('no-contest'), 'No contest', 'NC');
  eq(methodLabel('draw'), 'Nul', 'nul');
  eq(liveClock({ period: 2, displayClock: '3:12' }), 'R2 3:12', 'round et temps');
  eq(liveClock({ period: 1, displayClock: '0:00' }), 'R1', 'début de round');
  eq(liveClock({ period: 0, displayClock: '-' }), 'En cours', 'entrée des combattants');
  const bout = { status: { period: 3 }, competitors: [{ order: 2, winner: false }, { order: 1, winner: false }] };
  eq(finalState(bout, 'draw'), { status: 'finished', outcome: 'X', score: 'Nul' }, 'nul → X');
  eq(finalState(bout, 'no-contest'), { status: 'void', score: 'No contest' }, 'no contest → remboursé');
  eq(finalState(bout, null), null, 'aucun vainqueur, méthode inconnue → on attend');
  bout.competitors[0].winner = true;
  eq(finalState(bout, 'decision---unanimous'), { status: 'finished', outcome: '2', score: 'Décision unanime' }, 'vainqueur order 2 listé en premier');
  eq(finalState(bout, null), { status: 'finished', outcome: '2', score: 'Victoire · R3' }, 'méthode inconnue');
});

// ─── Liste ───────────────────────────────────────────────────────────────────
test('liste avant la soirée : combats, ordre des combattants, cotes DraftKings', async () => {
  const net = fakeNet(PRE_SB);
  const list = await createMmaAdapter({ getJson: net.getJson }).upcoming({ now: NOW_PRE, days: 7 });
  const m = byId(list);

  // 12 combats de la Fight Night + 5 du Contender Series + 13 de l'UFC 332 ; le Contender Series TBA est exclu.
  eq(list.length, 30, 'nombre de combats');
  ok(!m['espn:mma:ufc:401891664'] && !m['espn:mma:ufc:401891665'], 'combats TBA / Opponent TBA exclus');
  ok(!list.some((x) => x.meta.eventId === '600061541'), 'soirée du 10/10 hors fenêtre (7 jours)');

  const main = m['espn:mma:ufc:401911630'];
  ok(main, 'combat principal présent');
  eq([main.home.name, main.away.name], ['Raul Rosas Jr.', 'Raoni Barcelos'], 'home = order 1 (listé en second par ESPN)');
  eq([main.home.short, main.away.short], ['ROS', 'BAR'], 'abréviations');
  eq(main.home.record, '12-1-0', 'bilan V-D-N');
  eq(main.home.logo, 'https://a.espncdn.com/i/teamlogos/countries/500/mex.png', 'drapeau');
  eq(main.competition, 'UFC Fight Night: Rosas Jr. vs. Barcelos', 'soirée');
  eq(main.competitionLogo, 'https://a.espncdn.com/i/teamlogos/leagues/500/ufc.png', 'logo UFC');
  eq(main.round, 'Combat principal · Poids coqs', 'combat principal + catégorie');
  eq(main.startsAt, Date.parse('2026-09-27T00:00Z'), 'début de la carte principale');
  eq(main.meta, { adapter: 'mma', league: 'ufc', eventId: '600061266', day: '20260926' }, 'meta (jour ESPN de New York)');
  eq(main.status, 'scheduled', 'à venir');
  // DraftKings : Rosas -142, Barcelos +120 (API core, home = Rosas).
  eq(main.oddsSource, 'bookmaker', 'cotes bookmaker');
  eq(main.odds, fromBookmaker({ 1: americanToDecimal(-142), 2: americanToDecimal(120) }), 'cotes -142 / +120 avec marge Goalz');
  eq(main.odds, { 1: 1.65, 2: 2.14 }, 'valeurs');

  const silva = m['espn:mma:ufc:401912278'];
  eq(silva.round, 'Combat principal · Poids mouches (F)', 'combat principal de l\'UFC 332');
  eq(silva.competition, 'UFC 332', 'UFC 332');
  eq(silva.oddsSource, 'model', 'pas encore de cotes : modèle');

  const mcgee = m['espn:mma:ufc:401907089'];
  eq(mcgee.home.name, 'Court McGee', 'McGee order 1');
  eq(mcgee.odds, fromBookmaker({ 1: americanToDecimal(205), 2: americanToDecimal(-250) }), 'McGee +205 / Nolan -250');
  ok(mcgee.odds[1] > mcgee.odds[2], 'outsider à domicile');

  const pinas = m['espn:mma:ufc:401912277'];
  eq([pinas.home.name, pinas.odds[1] < pinas.odds[2]], ['Damian Pinas', true], 'Pinas (order 1, listé second) favori -485');

  eq(m['espn:mma:ufc:401923734'].competition, 'Contender Series', 'Contender Series');
  eq(m['espn:mma:ufc:401914472'].round, 'Poids pailles (F)', 'catégorie seule hors combat principal');

  for (const x of list) {
    eq(Object.keys(x.odds).sort(), ['1', '2'], `${x.id} : marché 1/2 sans nul`);
    ok(x.odds[1] >= MIN_ODDS && x.odds[1] <= MAX_ODDS && x.odds[2] >= MIN_ODDS && x.odds[2] <= MAX_ODDS, `${x.id} : cotes bornées`);
    ok(1 / x.odds[1] + 1 / x.odds[2] > 1, `${x.id} : marge positive`);
    ok(x.source === 'espn' && x.real === true && x.sport === 'mma' && x.status === 'scheduled', `${x.id} : champs fixes`);
    ok(/^espn:mma:ufc:\d+_\d+_\d+$/.test(x.id) && x.home.short.length === 3, `${x.id} : id (combat + combattants) et abréviation`);
  }
  const text = JSON.stringify(list).toLowerCase();
  ok(!text.includes('draftkings') && !text.includes('sportsbook') && !text.includes('gambl'), 'aucun lien ni marque de bookmaker');
  eq(list.filter((x) => x.oddsSource === 'bookmaker').map((x) => boutOnly(x.id)).sort(), ['401907089', '401911630', '401912277'].map((id) => `espn:mma:ufc:${id}`), 'combats cotés (fixtures core)');
  // Modèle : bilans V-D-N. Abushaar (order 1, 7-1-0) contre Staines (0-0-0).
  const dwcs = m['espn:mma:ufc:401891663'];
  eq([dwcs.home.name, dwcs.home.record, dwcs.away.record], ['Loai Abushaar', '7-1-0', '0-0-0'], 'Contender Series : bilans');
  eq(dwcs.odds, fromProbabilities(combatProbs(parseRecord('7-1-0'), parseRecord('0-0-0'))), 'cotes modèle tirées des bilans');
  ok(dwcs.odds[1] < dwcs.odds[2], 'meilleur bilan favori');
  ok(!net.calls.some((u) => u.endsWith('/status')), 'aucun statut détaillé demandé avant les combats');
  eq(net.calls.filter((u) => u.endsWith('/odds')).length, 30, 'une requête de cotes par combat de la semaine');
});

test('liste : cache des cotes, erreur réseau des cotes → modèle, jamais d\'exception', async () => {
  const net = fakeNet(PRE_SB);
  const a = createMmaAdapter({ getJson: net.getJson });
  await a.upcoming({ now: NOW_PRE, days: 7 });
  const n = net.calls.length;
  await a.upcoming({ now: NOW_PRE + 10 * 60_000, days: 7 });
  eq(net.calls.length - n, 2, '10 min plus tard : seuls les 2 scoreboards sont relus (cotes en cache)');
  await a.upcoming({ now: NOW_PRE + 45 * 60_000, days: 7 });
  eq(net.calls.length - n - 2, 2 + 3, '45 min plus tard : les 3 cotes trouvées sont relues, « pas de cote » encore en cache');

  const down = fakeNet(PRE_SB, { odds: Object.fromEntries(Object.keys(ODDS).map((k) => [k, new TypeError('Failed to fetch')])) });
  const list = byId(await createMmaAdapter({ getJson: down.getJson }).upcoming({ now: NOW_PRE, days: 7 }));
  eq(list['espn:mma:ufc:401911630'].oddsSource, 'model', 'API core injoignable : cotes modèle');
});

test('cotes : rattachement home/away par l\'id de l\'athlète (pièges)', async () => {
  const pair = boutIn(fixture('ufc_scoreboard_20260926-20261025_upcoming.json'), '401911630').competitors
    .sort((a, b) => a.order - b.order); // [Rosas, Barcelos]
  const real = fixture('core_odds_401911630_rosas_barcelos.json');
  eq(boutOdds(real, pair), { 1: 1.65, 2: 2.14 }, 'réel : home = Rosas = order 1');

  const swapped = fixture('core_odds_401911630_rosas_barcelos.json');
  const it = swapped.items[0];
  [it.homeAthleteOdds, it.awayAthleteOdds] = [it.awayAthleteOdds, it.homeAthleteOdds];
  eq(boutOdds(swapped, pair), { 1: 1.65, 2: 2.14 }, 'home/away inversés chez ESPN : remis dans l\'ordre par l\'id');

  const replaced = fixture('core_odds_401911630_rosas_barcelos.json');
  replaced.items[0].awayAthleteOdds.athlete.$ref = 'http://sports.core.api.espn.com/v2/sports/mma/athletes/9999999?lang=en';
  eq(boutOdds(replaced, pair), null, 'cotes visant un autre adversaire (remplaçant) : ignorées');

  const noRef = fixture('core_odds_401911630_rosas_barcelos.json');
  delete noRef.items[0].homeAthleteOdds.athlete;
  delete noRef.items[0].awayAthleteOdds.athlete;
  eq(boutOdds(noRef, pair), { 1: 1.65, 2: 2.14 }, 'sans id : home = order 1');

  const decimalOnly = fixture('core_odds_401911630_rosas_barcelos.json');
  delete decimalOnly.items[0].homeAthleteOdds.moneyLine;
  delete decimalOnly.items[0].awayAthleteOdds.moneyLine;
  eq(boutOdds(decimalOnly, pair), fromBookmaker({ 1: americanToDecimal('-142'), 2: americanToDecimal('+120') }), 'sans moneyLine : current.moneyLine.american');
  eq(boutOdds({ count: 0, items: [] }, pair), null, 'aucune cote');

  const net = fakeNet(PRE_SB, { odds: { 401911630: replaced } });
  const m = byId(await createMmaAdapter({ getJson: net.getJson }).upcoming({ now: NOW_PRE, days: 7 }))['espn:mma:ufc:401911630'];
  eq(m.oddsSource, 'model', 'adaptateur : combattant remplacé → modèle');
  const net2 = fakeNet(PRE_SB, { odds: { 401911630: swapped } });
  const m2 = byId(await createMmaAdapter({ getJson: net2.getJson }).upcoming({ now: NOW_PRE, days: 7 }))['espn:mma:ufc:401911630'];
  eq([m2.home.name, m2.odds[1], m2.oddsSource], ['Raul Rosas Jr.', 1.65, 'bookmaker'], 'adaptateur : inversion corrigée');
});

test('liste après la soirée : combats terminés avec vainqueur et méthode', async () => {
  const net = fakeNet(POST_SB);
  const a = createMmaAdapter({ getJson: net.getJson });
  const list = await a.upcoming({ now: NOW_POST, days: 7 });
  const m = byId(list);
  const done = list.filter((x) => x.status === 'finished');
  eq(done.length, 12, '12 combats terminés');
  for (const x of done) ok(['1', '2'].includes(x.outcome) && x.score, `${x.id} : issue et score`);
  const check = (id, names, outcome, score) => {
    const x = m[`espn:mma:ufc:${id}`];
    eq([x.home.name, x.away.name, x.outcome, x.score], [...names, outcome, score], id);
  };
  check('401914472', ['Vanessa Demopoulos', 'Yazmin Jauregui'], '2', 'KO/TKO · R1');        // victoire extérieur
  check('401914470', ['Elves Brener', 'Josiah Harrell'], '1', 'KO/TKO · R1');                // victoire domicile
  check('401914469', ['John Castaneda', 'Alatengheili'], '2', 'Décision partagée');         // order 2 listé en premier
  check('401914468', ['Brady Hiestand', 'Rinya Nakamura'], '1', 'Soumission · R2');
  check('401914465', ['Mehemmedeli Osmanli', 'Ilimbek Akylbek Uulu'], '2', 'Disqualification · R1');
  check('401911630', ['Raul Rosas Jr.', 'Raoni Barcelos'], '1', 'KO/TKO · R5');
  eq(list.filter((x) => x.status === 'scheduled').length, 18, 'Contender Series + UFC 332 à venir');
  eq(net.calls.filter((u) => u.endsWith('/status')).length, 12, 'un statut détaillé par combat terminé');
  const n = net.calls.length;
  await a.upcoming({ now: NOW_POST + 20 * 60_000, days: 7 });
  ok(!net.calls.slice(n).some((u) => u.endsWith('/status')), 'méthodes en cache : pas relues');

  const noCore = fakeNet(POST_SB, { status: { 401914470: new TypeError('Failed to fetch') } });
  const x = byId(await createMmaAdapter({ getJson: noCore.getJson }).upcoming({ now: NOW_POST, days: 7 }))['espn:mma:ufc:401914470'];
  eq([x.status, x.outcome, x.score], ['finished', '1', 'Victoire · R1'], 'statut détaillé injoignable : vainqueur du scoreboard');
});

// ─── Résultats ───────────────────────────────────────────────────────────────
test('résultats : victoires domicile / extérieur, combat retiré, requêtes', async () => {
  const net = fakeNet(CARD_SB);
  const matches = [
    stored('ufc', '600061266', '401914472', '2026-09-26T21:00Z'),
    stored('ufc', '600061266', '401914470', '2026-09-26T21:00Z'),
    stored('ufc', '600061266', '401911630', '2026-09-27T00:00Z'),
    stored('ufc', '600061266', '401999999', '2026-09-27T00:00Z'), // n'existe plus sur la carte terminée
  ];
  const u = byId(await createMmaAdapter({ getJson: net.getJson }).results({ now: NOW_POST, matches }));
  eq(u['espn:mma:ufc:401914472'], { matchId: 'espn:mma:ufc:401914472', status: 'finished', outcome: '2', score: 'KO/TKO · R1' }, 'victoire extérieur');
  eq(u['espn:mma:ufc:401914470'], { matchId: 'espn:mma:ufc:401914470', status: 'finished', outcome: '1', score: 'KO/TKO · R1' }, 'victoire domicile');
  eq(u['espn:mma:ufc:401911630'].outcome, '1', 'combat principal');
  eq(u['espn:mma:ufc:401999999'], { matchId: 'espn:mma:ufc:401999999', status: 'void' }, 'combat retiré d\'une soirée terminée → remboursé');
  eq(net.calls.filter((c) => c.includes('/scoreboard')).length, 1, 'un seul scoreboard pour la soirée');
});

test('résultats : nul → X, no contest → remboursé (UFC 312 / UFC 321)', async () => {
  const sb = { [scoreboardUrl('ufc', '20250208-20251025')]: 'ufc_scoreboard_2025_draw_nocontest.json' };
  const matches = [
    stored('ufc', '600050481', '401745828', '2025-02-09T03:00Z'), // Crute vs Bellato : nul
    stored('ufc', '600055085', '401800640', '2025-10-25T18:00Z'), // Aspinall vs Gane : no contest (doigt dans l'œil)
    stored('ufc', '600055085', '401817813', '2025-10-25T18:00Z'), // Jandiroba vs Dern : décision
  ];
  const now = Date.parse('2025-10-25T23:00Z');
  const u = byId(await createMmaAdapter({ getJson: fakeNet(sb, {
    status: { 401817813: { type: { completed: true }, result: { name: 'decision---unanimous' } } },
  }).getJson }).results({ now, matches }));
  eq(u['espn:mma:ufc:401745828'], { matchId: 'espn:mma:ufc:401745828', status: 'finished', outcome: 'X', score: 'Nul' }, 'nul');
  eq(u['espn:mma:ufc:401800640'], { matchId: 'espn:mma:ufc:401800640', status: 'void', score: 'No contest' }, 'no contest');
  eq(u['espn:mma:ufc:401817813'], { matchId: 'espn:mma:ufc:401817813', status: 'finished', outcome: '2', score: 'Décision unanime' }, 'Dern (order 2) gagne');

  // API core injoignable : sans vainqueur, impossible de distinguer nul et no contest → on attend.
  const down = fakeNet(sb, { status: { 401745828: new TypeError('Failed to fetch'), 401800640: new Error('HTTP 503') } });
  const w = byId(await createMmaAdapter({ getJson: down.getJson }).results({ now, matches: matches.slice(0, 2) }));
  eq(Object.keys(w).length, 0, 'aucune mise à jour (surtout pas de remboursement) si le statut détaillé manque');
});

test('résultats : combat en direct, annulé, reporté, suspendu, soirée annulée', async () => {
  const base = fixture('ufc_scoreboard_20260925-20261005_final.json');
  const setStatus = (id, type, extra = {}) => Object.assign(boutIn(base, id).status, { type: { ...type }, ...extra });
  setStatus('401912278', { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, { period: 2, displayClock: '3:12' });
  setStatus('401907089', { id: '5', name: 'STATUS_CANCELED', state: 'post', completed: false, detail: 'Canceled' });
  setStatus('401907087', { id: '6', name: 'STATUS_POSTPONED', state: 'post', completed: false, detail: 'Postponed' });
  setStatus('401917347', { id: '8', name: 'STATUS_SUSPENDED', state: 'post', completed: false, detail: 'Suspended' });
  const url = scoreboardUrl('ufc', '20261003-20261003');
  const matches = ['401912278', '401907089', '401907087', '401917347', '401912275']
    .map((id) => stored('ufc', '600061182', id, '2026-10-03T20:00Z'));
  const now = Date.parse('2026-10-04T01:00Z');
  const u = byId(await createMmaAdapter({ getJson: fakeNet({ [url]: base }).getJson }).results({ now, matches }));
  eq(u['espn:mma:ufc:401912278'], { matchId: 'espn:mma:ufc:401912278', status: 'live', clock: 'R2 3:12' }, 'en direct');
  eq(u['espn:mma:ufc:401907089'].status, 'void', 'combat annulé');
  eq(u['espn:mma:ufc:401907087'].status, 'void', 'combat reporté');
  ok(!u['espn:mma:ufc:401917347'], 'combat suspendu : on attend, pas de remboursement');
  ok(!u['espn:mma:ufc:401912275'], 'combat pas encore commencé (partie de soirée plus tardive) : rien');
  const late = byId(await createMmaAdapter({ getJson: fakeNet({ [url]: base }).getJson }).results({ now: now + 40 * HOUR, matches: matches.slice(3) }));
  ok(!late['espn:mma:ufc:401917347'], 'suspendu depuis 40 h : toujours pas de remboursement ici');
  eq(late['espn:mma:ufc:401912275'].status, 'void', 'toujours « pre » 36 h après le début : remboursé');

  // Soirée entière annulée alors que ses combats restent « programmés ».
  const cancelled = fixture('ufc_scoreboard_20260925-20261005_final.json');
  eventIn(cancelled, '600061182').status.type = { id: '5', name: 'STATUS_CANCELED', state: 'post', completed: false };
  const c = byId(await createMmaAdapter({ getJson: fakeNet({ [url]: cancelled }).getJson }).results({ now, matches: matches.slice(4) }));
  eq(c['espn:mma:ufc:401912275'].status, 'void', 'soirée annulée → combat remboursé');

  // Données réelles : soirée annulée du 21/03/2020 (combat TBA en STATUS_CANCELED).
  const covid = { [scoreboardUrl('ufc', '20200321-20200321')]: 'ufc_scoreboard_20200321_canceled_event.json' };
  const r = await createMmaAdapter({ getJson: fakeNet(covid).getJson })
    .results({ now: Date.parse('2020-03-22T12:00Z'), matches: [stored('ufc', '401219517', '401219545', '2020-03-21T22:00Z')] });
  eq(r, [{ matchId: 'espn:mma:ufc:401219545', status: 'void' }], 'STATUS_CANCELED réel → remboursé');
});

test('liste : en direct (cote d\'avant-combat gardée), annulé → void, horaire non valide, id négatif', async () => {
  const live = fixture('ufc_scoreboard_20260926-20261025_upcoming.json');
  Object.assign(boutIn(live, '401911630').status, { period: 3, displayClock: '1:05', type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false } });
  boutIn(live, '401914472').status.type = { id: '5', name: 'STATUS_CANCELED', state: 'post', completed: false };
  boutIn(live, '401914469').timeValid = false;
  boutIn(live, '401914466').competitors[0].id = '-1';

  // Même adaptateur (donc même cache) : avant la soirée, puis pendant, avec l'API core en panne.
  const ufcUrl = scoreboardUrl('ufc', '20260925-20261003');
  let board = 'ufc_scoreboard_20260926-20261025_upcoming.json';
  let coreDown = false;
  const net = fakeNet({ ...PRE_SB, get [ufcUrl]() { return board; } },
    { odds: { get 401911630() { return coreDown ? new TypeError('Failed to fetch') : undefined; } } });
  const a = createMmaAdapter({ getJson: net.getJson });
  await a.upcoming({ now: NOW_PRE, days: 7 });
  board = live;
  coreDown = true;
  const m = byId(await a.upcoming({ now: NOW_PRE + 4 * HOUR, days: 7 }));
  const main = m['espn:mma:ufc:401911630'];
  eq([main.status, main.clock], ['live', 'R3 1:05'], 'en direct');
  eq([main.oddsSource, main.odds], ['bookmaker', { 1: 1.65, 2: 2.14 }], 'en direct : cote d\'avant-combat gardée (cache)');
  eq(m['espn:mma:ufc:401914472'].status, 'void', 'combat annulé listé en void');
  ok(!m['espn:mma:ufc:401914469'], 'timeValid false exclu');
  ok(!m['espn:mma:ufc:401914466'], 'combattant d\'id négatif exclu');

  const cold = byId(await createMmaAdapter({ getJson: net.getJson }).upcoming({ now: NOW_PRE + 4 * HOUR, days: 7 }));
  eq([cold['espn:mma:ufc:401911630'].status, cold['espn:mma:ufc:401911630'].oddsSource], ['live', 'model'], 'sans cache ni API core : modèle');
});

test('PFL : liste seule quand l\'UFC échoue, soirée sans combats, TBA', async () => {
  const now = Date.parse('2026-10-15T12:00Z');
  const pfl = fixture('pfl_scoreboard_20260701-20261231.json');
  pfl.events.push(...fixture('pfl_scoreboard_2025_event_without_bouts.json').events); // soirée sans competitions
  const routes = {
    [scoreboardUrl('ufc', '20261013-20261022')]: new TypeError('Failed to fetch'),
    [scoreboardUrl('pfl', '20261013-20261022')]: pfl,
  };
  const list = await createMmaAdapter({ getJson: fakeNet(routes).getJson }).upcoming({ now, days: 7 });
  eq(list.map((x) => boutOnly(x.id)).sort(), ['401912821', '401912823', '401917242', '401917243', '401917247', '401919461'].map((id) => `espn:mma:pfl:${id}`), 'PFL Chicago (6 combats) malgré l\'UFC en panne');
  const main = byId(list)['espn:mma:pfl:401912821'];
  eq([main.competition, main.round, main.home.name, main.away.name], ['PFL Chicago', 'Combat principal · Poids mouches (F)', 'Liz Carmouche', 'Jena Bishop'], 'affiche « Carmouche vs. Bishop 2 »');
  eq(main.competitionLogo, 'https://a.espncdn.com/i/teamlogos/leagues/500/pfl.png', 'logo PFL');
  eq(main.meta.league, 'pfl', 'ligue');
  eq(byId(list)['espn:mma:pfl:401919461'].home.short, 'BAR', 'Cássio Barão → BAR');

  const lyon = await createMmaAdapter({ getJson: fakeNet({
    [scoreboardUrl('ufc', '20261215-20261224')]: 'pfl_scoreboard_20260925-20261005_empty.json',
    [scoreboardUrl('pfl', '20261215-20261224')]: 'pfl_scoreboard_20260701-20261231.json',
  }).getJson }).upcoming({ now: Date.parse('2026-12-17T12:00Z'), days: 7 });
  eq(lyon.map((x) => boutOnly(x.id)), ['espn:mma:pfl:401914115'], 'PFL Lyon : combat TBA exclu');

  let threw = false;
  try {
    await createMmaAdapter({ getJson: fakeNet({}).getJson }).upcoming({ now, days: 7 });
  } catch { threw = true; }
  ok(threw, 'lève une erreur si toutes les ligues échouent');
});

test('résultats : réseau en panne ou soirée absente → jamais de remboursement à tort', async () => {
  const matches = [stored('ufc', '600061266', '401914472', '2026-09-26T21:00Z')];
  let threw = false;
  try {
    await createMmaAdapter({ getJson: fakeNet({ [scoreboardUrl('ufc', '20260926-20260926')]: new TypeError('Failed to fetch') }).getJson })
      .results({ now: NOW_POST + 3 * DAY, matches });
  } catch { threw = true; }
  ok(threw, 'scoreboard injoignable : erreur (le cœur réessaie), aucun remboursement');

  const empty = { [scoreboardUrl('ufc', '20260926-20260926')]: { leagues: [], events: [] } };
  eq(await createMmaAdapter({ getJson: fakeNet(empty).getJson }).results({ now: NOW_POST, matches }), [], 'soirée absente depuis 11 h : on attend');
  eq(await createMmaAdapter({ getJson: fakeNet(empty).getJson }).results({ now: NOW_POST + 30 * HOUR, matches }),
    [{ matchId: 'espn:mma:ufc:401914472', status: 'void' }], 'absente d\'un flux valide 36 h après : remboursé');

  // Une ligue en panne n'empêche pas l'autre.
  const mixed = [...matches, stored('pfl', '600061331', '401912821', '2026-10-17T03:00Z')];
  const u = await createMmaAdapter({ getJson: fakeNet({ ...CARD_SB }).getJson }).results({ now: NOW_POST, matches: mixed });
  eq(u.map((x) => x.matchId), ['espn:mma:ufc:401914472'], 'PFL en panne : résultats UFC quand même');
  eq(await createMmaAdapter({ getJson: fakeNet({}).getJson }).results({ now: NOW_POST, matches: [] }), [], 'rien à suivre');
});

test('résultats : combat reprogrammé → nouvelle heure', async () => {
  const data = fixture('ufc_scoreboard_20260925-20261005_final.json');
  const m = stored('ufc', '600061182', '401912275', '2026-10-03T18:00Z'); // connu à 18:00, ESPN dit 20:00
  const u = await createMmaAdapter({ getJson: fakeNet({ [scoreboardUrl('ufc', '20261003-20261003')]: data }).getJson })
    .results({ now: Date.parse('2026-10-03T18:10Z'), matches: [m] });
  eq(u, [{ matchId: m.id, status: 'scheduled', startsAt: Date.parse('2026-10-03T20:00Z') }], 'startsAt corrigé');
});

test('combattant remplacé sous le même numéro de combat → nouveau pari, ancien remboursé', async () => {
  const net = fakeNet(PRE_SB);
  const list = await createMmaAdapter({ getJson: net.getJson }).upcoming({ now: NOW_PRE, days: 7 });
  const main = byId(list)['espn:mma:ufc:401911630'];
  ok(main && /_\d+_\d+$/.test(main.id), 'id avec les deux combattants');

  // Même flux, mais le combattant order 2 du combat principal est remplacé.
  const ufc = fixture(PRE_SB[scoreboardUrl('ufc', '20260925-20261003')]);
  for (const e of ufc.events || []) {
    for (const bout of e.competitions || []) {
      if (String(bout.id) !== '401911630') continue;
      const c = bout.competitors.find((x) => x.order === 2);
      c.id = '999999';
      c.athlete = { ...c.athlete, id: '999999', displayName: 'Remplaçant Test' };
    }
  }
  const pfl = fixture(PRE_SB[scoreboardUrl('pfl', '20260925-20261003')]);
  // Toute demande de programme renvoie le flux modifié ; cotes et statuts : réseau coupé.
  const swappedNet = async (url) => {
    if (url.includes('/mma/ufc/scoreboard')) return JSON.parse(JSON.stringify(ufc));
    if (url.includes('/mma/pfl/scoreboard')) return JSON.parse(JSON.stringify(pfl));
    throw new TypeError('Failed to fetch');
  };
  const after = await createMmaAdapter({ getJson: swappedNet }).upcoming({ now: NOW_PRE, days: 7 });
  const renamed = byId(after)['espn:mma:ufc:401911630'];
  ok(renamed && renamed.id !== main.id, 'le remplacement crée un autre pari');
  const u = await createMmaAdapter({ getJson: swappedNet }).results({ now: main.startsAt + 60_000, matches: [main] });
  eq(u, [{ matchId: main.id, status: 'void' }], 'le pari sur l\'ancien duel est remboursé');
});

test('adaptateur : clé, url de test d\'accès, urls core', () => {
  const a = createMmaAdapter({ getJson: fakeNet({}).getJson });
  eq(a.key, 'mma', 'clé');
  eq(a.probeUrl, 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc', 'probeUrl (2,5 Ko)');
  eq(oddsUrl('ufc', '600061266', '401911630'), 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/600061266/competitions/401911630/odds', 'url cotes');
  eq(statusUrl('ufc', 1, 2), 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/1/competitions/2/status', 'url statut');
  ok(!a.probeUrl.startsWith('http://'), 'https');
});

// ─── Exécution ───────────────────────────────────────────────────────────────
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (err) {
    print(`FAIL ${name}\n  ${err.message}`);
    throw err;
  }
  print(`PASS ${name}`);
}
print('ALL PASS');
