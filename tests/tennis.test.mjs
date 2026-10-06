// Tests de l'adaptateur ESPN tennis (js/providers/espn/tennis.js), sans réseau.
// Lancer depuis n'importe quel dossier :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/tennis.test.mjs
//
// Réponses ESPN enregistrées (tests/fixtures/tennis/), allégées des liens et des champs non lus :
// - atp_/wta_scoreboard_20260927.json            jour ESPN du 27/09/2026, lu à 08:27:59 UTC (2 matchs en cours)
// - atp_scoreboard_20260925-20260929.json        plage de dates au même moment : VIDE alors que Chengdu et Hangzhou
//                                                 sont en cours (raison pour laquelle l'adaptateur ne lit que des jours)
// - atp_/wta_rankings.json                       classements du 27/09/2026 (top 150, points)
// - usopen_scoreboard_20260905.json              flux ATP du 05/09/2026 (US Open terminé : abandons, forfaits).
//                                                 Le flux WTA de ce jour est identique (mêmes 625 matchs, mêmes statuts).
import {
  createTennisAdapter, setsText, roundLabel, shortCode, tournamentName, singlesOf, parseRankings, readFeed, nextDay,
} from '../js/providers/espn/tennis.js';
import { fromProbabilities, tennisProbs } from '../js/providers/odds.js';
import { HOUR } from '../js/providers/espn/common.js';

const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(/[^/]*$/, '');
const FX = `${HERE}fixtures/tennis/`;
const SB = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

// ─── Outils ──────────────────────────────────────────────────────────────────
const texts = {};
const fixture = (name) => JSON.parse(texts[name] ??= readFile(FX + name)); // copie neuve à chaque appel

function fail(msg) { throw new Error(msg); }
const ok = (cond, msg) => { if (!cond) fail(msg); };
const eq = (got, want, msg) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${msg} : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);
};

// Réseau simulé : url → nom de fixture | objet | Error | fonction. Toute autre url échoue (404).
function fakeNet(routes) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    const r = typeof routes === 'function' ? routes(url) : routes[url];
    if (r === undefined) throw new Error(`HTTP 404 (url imprévue) ${url}`);
    if (r instanceof Error) throw r;
    if (typeof r === 'string') return fixture(r);
    return JSON.parse(JSON.stringify(r));
  };
  return { getJson, calls };
}

// Le match ESPN d'id donné dans une réponse scoreboard (pour préparer des variantes).
function compIn(data, id) {
  for (const e of data.events) for (const g of e.groupings) for (const c of g.competitions) if (c.id === id) return c;
  return fail(`match ${id} absent de la fixture`);
}

// Match déjà connu du cœur, tel qu'il est transmis à results() (tournament absent : match
// enregistré avant l'ajout de meta.tournament).
const stored = (league, eventId, iso, tournament) => ({
  id: `espn:tennis:${league}:${eventId}`, startsAt: Date.parse(iso), status: 'scheduled',
  meta: { adapter: 'tennis', league, eventId, ...(tournament ? { tournament } : {}) },
});
const byMatch = (updates) => Object.fromEntries(updates.map((u) => [u.matchId, u]));

// Flux d'un autre jour ESPN au même instant, faute de capture : ESPN y renvoie les tournois dont la
// fenêtre [date, endDate] couvre ce jour, avec le même tableau (vérifié en direct le 27/09 à 17:52 UTC :
// ATP du 27 et du 28/09 identiques à l'octet près ; WTA du 28/09 = les tournois qui continuent).
function sameInstantDay(name, day) {
  const data = fixture(name);
  const start = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T04:00Z`); // minuit à New York
  data.events = data.events.filter((e) => Date.parse(e.date) < start + 24 * HOUR && Date.parse(e.endDate) > start);
  return data;
}

const NOW = Date.parse('2026-09-27T08:27:59Z'); // instant de capture des fixtures du 27/09
const LIVE_ROUTES = {
  [`${SB}/atp/scoreboard?dates=20260927`]: 'atp_scoreboard_20260927.json',
  [`${SB}/wta/scoreboard?dates=20260927`]: 'wta_scoreboard_20260927.json',
  [`${SB}/atp/scoreboard?dates=20260928`]: sameInstantDay('atp_scoreboard_20260927.json', '20260928'),
  [`${SB}/wta/scoreboard?dates=20260928`]: sameInstantDay('wta_scoreboard_20260927.json', '20260928'),
  [`${SB}/atp/rankings`]: 'atp_rankings.json',
  [`${SB}/wta/rankings`]: 'wta_rankings.json',
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── Fonctions pures ─────────────────────────────────────────────────────────
test('setsText : sets, jeux décisifs, joueur 1 d\'abord', () => {
  const ls = (...v) => ({ linescores: v.map(([value, tiebreak]) => (tiebreak === undefined ? { value } : { value, tiebreak })) });
  eq(setsText(ls([6], [6, 6], [6]), ls([4], [7, 8], [3])), '6-4 6-7(6) 6-3', 'jeu décisif perdu par le joueur 1');
  eq(setsText(ls([7, 7], [6, 5]), ls([6, 4], [7, 7])), '7-6(4) 6-7(5)', 'deux jeux décisifs');
  eq(setsText(ls([6, 12]), ls([7, 14])), '6-7(12)', 'jeu décisif prolongé');
  eq(setsText(ls([6, 3]), ls([6, 5])), '6-6', 'jeu décisif en cours : pas de parenthèses');
  eq(setsText({ linescores: [] }, { linescores: [] }), '', 'forfait : aucun set');
});

test('roundLabel : tours en français, 8es de finale selon la taille du tableau', () => {
  eq(roundLabel('Round 1', 4), '1er tour', 'Round 1');
  eq(roundLabel('Round 3', 4), '3e tour', 'Round 3 (Grand Chelem)');
  eq(roundLabel('Round 4', 4), '8e de finale', 'Round 4 (Grand Chelem)');
  eq(roundLabel('Round 2', 2), '8e de finale', 'Round 2 (tableau de 28/32)');
  eq(roundLabel('Round 2', null), '2e tour', 'Round 2 sans quarts connus');
  eq(roundLabel('Quarterfinal'), 'Quart de finale', 'QF');
  eq(roundLabel('Semifinal'), 'Demi-finale', 'SF');
  eq(roundLabel('Final'), 'Finale', 'F');
  eq(roundLabel('Qualifying 1st Round'), 'Qualifications', 'Q1');
  eq(roundLabel('Qualifying Final'), 'Qualifications', 'QF qualif');
  eq(roundLabel('Round Robin'), 'Phase de groupes', 'Masters');
  eq(roundLabel(''), null, 'vide');
  const us = singlesOf(fixture('usopen_scoreboard_20260905.json'));
  ok(us.length && us.every((e) => e.lastRound === 4), 'US Open : le tour avant les quarts est Round 4');
  const chengdu = singlesOf(fixture('atp_scoreboard_20260927.json')).filter((e) => e.tournament.id === '441-2026');
  ok(chengdu.every((e) => e.lastRound === 2), 'Chengdu (28 joueurs) : le tour avant les quarts est Round 2');
});

test('shortCode et tournamentName', () => {
  eq(shortCode({ shortName: 'L. Pavlovic' }), 'PAV', 'nom simple');
  eq(shortCode({ shortName: 'A. de Minaur' }), 'DEM', 'particule');
  eq(shortCode({ shortName: 'J.J. Wolf' }), 'WOL', 'initiales multiples');
  eq(shortCode({ shortName: 'Y. Bu' }), 'BU', 'nom court');
  eq(shortCode({ shortName: 'C. Frantzén' }), 'FRA', 'accent');
  eq(shortCode({ displayName: 'Jannik Sinner' }), 'SIN', 'sans shortName');
  eq(tournamentName('Singapore Tennis Open presented by BNP Paribas'), 'Singapore Tennis Open', 'sponsor');
  eq(tournamentName('Kinoshita Group Japan Open Tennis Championships'), 'Kinoshita Group Japan Open', 'suffixe');
  eq(tournamentName('Australian Open'), 'Open d\'Australie', 'Grand Chelem');
  eq(tournamentName('French Open'), 'Roland-Garros', 'Grand Chelem');
  eq(tournamentName('US Open'), 'US Open', 'Grand Chelem');
  eq(tournamentName('Columbus Open'), 'Columbus Open', 'pas confondu avec l\'US Open');
});

test('nextDay et readFeed', () => {
  eq([nextDay('20260927'), nextDay('20260930'), nextDay('20261231'), nextDay('20280228'), nextDay('20260307')],
    ['20260928', '20261001', '20270101', '20280229', '20260308'], 'lendemain (fin de mois, d\'année, bissextile, changement d\'heure)');
  const f = readFeed(fixture('atp_scoreboard_20260927.json'));
  eq([...f.tournaments].sort(), ['1001-2026', '441-2026'], 'tournois du flux (Hangzhou, Chengdu)');
  eq(f.byId.get('183414').id, '183414', 'index des simples');
  ok(!f.byId.has('183382'), 'double non indexé');
  ok(/ESPN-icon-tennis/.test(f.logo), 'logo');
  eq(readFeed({ leagues: [], events: [] }).singles.length, 0, 'réponse vide : flux vide, pas une erreur (hors saison)');
  for (const bad of [null, {}, { events: null }, 'Service Unavailable']) {
    let threw = false;
    try { readFeed(bad); } catch { threw = true; }
    ok(threw, `réponse illisible refusée : ${JSON.stringify(bad)}`);
  }
});

test('parseRankings : id athlète → points', () => {
  const atp = parseRankings(fixture('atp_rankings.json'), 'atp');
  eq(atp.size, 150, 'top 150 ATP');
  eq(atp.get('2860'), 1065, 'Shapovalov');
  eq(parseRankings(fixture('wta_rankings.json'), 'wta').get('3641'), 1454, 'Fernandez');
  eq(parseRankings({}, 'atp').size, 0, 'réponse vide');
});

// ─── Liste ───────────────────────────────────────────────────────────────────
async function liveList(routes = LIVE_ROUTES) {
  const net = fakeNet(routes);
  const list = await createTennisAdapter({ getJson: net.getJson }).upcoming({ now: NOW, days: 7 });
  return { list, byId: Object.fromEntries(list.map((m) => [m.id, m])), net };
}

test('liste : requêtes (jour courant + lendemain, 2 circuits, classements)', async () => {
  const { net } = await liveList();
  eq([...net.calls].sort(), Object.keys(LIVE_ROUTES).sort(), 'urls appelées, chacune une fois');
  ok(!net.calls.some((u) => /dates=\d{8}-/.test(u)), 'jamais de plage de dates');
});

test('liste : tournoi qui commence demain, lu dans le flux du lendemain', async () => {
  const full = await liveList();
  const adana = full.list.filter((m) => m.meta.tournament === '1078-2026');
  ok(adana.length >= 3, 'fixture : matchs d\'Adana listables');
  const wta = fixture('wta_scoreboard_20260927.json');
  wta.events = wta.events.filter((e) => e.id !== '1078-2026'); // pas encore dans le flux du jour
  const { byId } = await liveList({ ...LIVE_ROUTES, [`${SB}/wta/scoreboard?dates=20260927`]: wta });
  for (const m of adana) eq(byId[m.id], m, `${m.id} listé depuis le flux du 28/09`);
});

test('liste : match programmé (joueurs, horaire, tour, tournoi, meta)', async () => {
  const { list, byId } = await liveList();
  ok(new Set(list.map((m) => m.id)).size === list.length, 'ids uniques');
  const m = byId['espn:tennis:atp:183414'];
  ok(m, 'Mannarino - Shapovalov listé');
  eq([m.source, m.real, m.sport, m.status, m.outcome], ['espn', true, 'tennis', 'scheduled', null], 'champs de base');
  eq(m.home, { name: 'Adrian Mannarino', short: 'MAN', logo: 'https://a.espncdn.com/i/teamlogos/countries/500/fra.png' }, 'joueur 1');
  eq(m.away, { name: 'Denis Shapovalov', short: 'SHA', logo: 'https://a.espncdn.com/i/teamlogos/countries/500/can.png', record: '(7)' }, 'joueur 2 (tête de série 7)');
  eq(m.startsAt, Date.parse('2026-09-27T08:30Z'), 'horaire (date ISO du match)');
  eq([m.competition, m.round], ['Chengdu Open · ATP', 'Quart de finale'], 'tournoi et tour');
  ok(/ESPN-icon-tennis/.test(m.competitionLogo), 'logo de la ligue');
  eq(m.meta, { adapter: 'tennis', league: 'atp', eventId: '183414', tournament: '441-2026' }, 'meta (id du tournoi)');
  eq(byId['espn:tennis:atp:183361'].round, '8e de finale', 'Round 2 de Hangzhou (tableau de 28) = 8e de finale');
  eq(byId['espn:tennis:wta:186198'].round, 'Qualifications', 'qualifications');
  eq(byId['espn:tennis:wta:184107'].competition, 'Singapore Tennis Open · WTA', 'sponsor retiré, circuit WTA');
});

test('liste : cotes modèle (classement ATP/WTA, 1/2 seulement)', async () => {
  const { list, byId } = await liveList();
  for (const m of list) {
    eq(Object.keys(m.odds).sort(), ['1', '2'], `${m.id} : issues 1 et 2 uniquement`);
    eq(m.oddsSource, 'model', `${m.id} : source des cotes`);
    ok(m.odds[1] >= 1.05 && m.odds[1] <= 15 && m.odds[2] >= 1.05 && m.odds[2] <= 15, `${m.id} : cotes bornées`);
    // Marge Goalz de 7 % (un peu moins quand la cote du favori est ramenée au plancher de 1.05).
    const book = 1 / m.odds[1] + 1 / m.odds[2];
    ok(book > 1.03 && book < 1.1, `${m.id} : marge Goalz (${book.toFixed(3)})`);
  }
  eq(byId['espn:tennis:atp:183414'].odds, fromProbabilities(tennisProbs(745, 1065)), 'Mannarino 745 pts - Shapovalov 1065 pts');
  ok(byId['espn:tennis:atp:183414'].odds[2] < byId['espn:tennis:atp:183414'].odds[1], 'le mieux classé est favori');
  const med = byId['espn:tennis:atp:183373'];
  eq(med.home.record, '(1)', 'Medvedev tête de série 1');
  eq(med.odds, fromProbabilities(tennisProbs(3770, 578)), 'Medvedev 3770 pts - Wong 578 pts');
  const unranked = byId['espn:tennis:wta:184015']; // Cengiz et Kostovic hors top 150 → 300 pts chacune
  eq(unranked.odds, fromProbabilities(tennisProbs(300, 300)), 'joueuses non classées : 300 points');
  eq(unranked.odds[1], unranked.odds[2], 'cotes égales');
});

test('liste : match en cours et matchs terminés (36 h)', async () => {
  const { list, byId } = await liveList();
  const live = byId['espn:tennis:atp:183370'];
  eq([live.status, live.liveScore, live.clock], ['live', '5-6', '1er set'], 'Gaston - Rublev en direct');
  const f1 = byId['espn:tennis:atp:183419'];
  eq([f1.status, f1.outcome, f1.score], ['finished', '2', '1-6 5-7'], 'victoire du joueur 2');
  const f2 = byId['espn:tennis:atp:183357'];
  eq([f2.status, f2.outcome, f2.score], ['finished', '1', '7-6(4) 6-7(5) 6-2'], 'victoire du joueur 1, jeux décisifs');
  const ret = byId['espn:tennis:wta:184060'];
  eq([ret.status, ret.outcome, ret.score], ['finished', '2', '2-6 0-1 ab.'], 'abandon : réglé sur la vainqueure');
  ok(!byId['espn:tennis:atp:186127'], 'match du 22/09 hors fenêtre');
  ok(list.every((m) => m.status === 'live' || m.startsAt >= NOW - 36 * HOUR), 'rien avant now - 36 h');
  ok(list.some((m) => m.status === 'finished') && list.some((m) => m.status === 'scheduled'), 'terminés et programmés');
});

test('liste : simples seulement, TBD et horaires inconnus exclus', async () => {
  const { list, byId } = await liveList();
  const atp = fixture('atp_scoreboard_20260927.json');
  ok(atp.events.some((e) => e.groupings.some((g) => g.grouping.slug === 'mens-doubles')), 'la fixture contient des doubles');
  for (const id of ['183382', '183384', '183435']) ok(!list.some((m) => m.meta.eventId === id), `double ${id} exclu`);
  ok(list.every((m) => !m.home.name.includes('/') && !m.away.name.includes('/')), 'aucune paire de double');
  eq(compIn(atp, '183422').status.type.name, 'STATUS_CANCELED', 'finale TBD marquée annulée dans la fixture');
  for (const id of ['183420', '183422', '183374', '183375', '183376']) ok(!byId[`espn:tennis:atp:${id}`], `TBD ${id} exclu`);
  ok(!byId['espn:tennis:wta:184179'], 'TBD contre joueuse connue exclu');
  ok(list.every((m) => !/tbd/i.test(m.home.name + m.away.name)), 'aucun TBD');
  const wta = fixture('wta_scoreboard_20260927.json');
  eq([compIn(wta, '184183').timeValid, compIn(wta, '184101').timeValid], [false, false], 'fixture : horaires non fixés');
  ok(!byId['espn:tennis:wta:184183'] && !byId['espn:tennis:wta:184101'], 'timeValid false exclu (joueuses connues)');
});

test('liste : statut du tournoi ignoré, plage ESPN trouée jamais utilisée', async () => {
  const { list } = await liveList();
  const atpDay = fixture('atp_scoreboard_20260927.json');
  ok(atpDay.events.every((e) => e.status.type.name === 'STATUS_FINAL'), 'fixture : tournois marqués "Final"');
  eq(fixture('atp_scoreboard_20260925-20260929.json').events.length, 0, 'fixture : plage ATP vide malgré deux tournois en cours');
  const atp = list.filter((m) => m.meta.league === 'atp');
  ok(atp.filter((m) => m.status === 'scheduled').length >= 5, 'matchs ATP programmés malgré le statut "Final"');
});

test('liste : pas de lien ni de mention de bookmaker, meta compacte', async () => {
  const { list } = await liveList();
  const json = JSON.stringify(list);
  ok(!/draft ?kings|"links"|espn\.com\/tennis/i.test(json), 'aucun lien ni bookmaker');
  for (const m of list) eq(Object.keys(m.meta), ['adapter', 'league', 'eventId', 'tournament'], `${m.id} : meta`);
  ok(json.length / list.length < 800, `taille moyenne d'un match (${Math.round(json.length / list.length)} octets)`);
});

test('liste : tournoi mixte présent dans les deux flux → dédoublonné, circuit selon le tableau', async () => {
  const now = Date.parse('2026-09-05T20:00Z');
  const net = fakeNet({ // l'US Open (24/08 → 13/09) est seul, et entier, dans les quatre flux
    [`${SB}/atp/scoreboard?dates=20260905`]: 'usopen_scoreboard_20260905.json',
    [`${SB}/wta/scoreboard?dates=20260905`]: 'usopen_scoreboard_20260905.json',
    [`${SB}/atp/scoreboard?dates=20260906`]: 'usopen_scoreboard_20260905.json',
    [`${SB}/wta/scoreboard?dates=20260906`]: 'usopen_scoreboard_20260905.json',
    [`${SB}/atp/rankings`]: 'atp_rankings.json',
    [`${SB}/wta/rankings`]: 'wta_rankings.json',
  });
  const list = await createTennisAdapter({ getJson: net.getJson }).upcoming({ now, days: 7 });
  const ids = list.map((m) => m.id);
  eq(new Set(ids).size, ids.length, 'aucun doublon');
  const expected = singlesOf(fixture('usopen_scoreboard_20260905.json'))
    .filter(({ c }) => Date.parse(c.date) >= now - 36 * HOUR && Date.parse(c.date) <= now + 7 * 24 * HOUR);
  eq(list.length, expected.length, 'un match par id ESPN');
  for (const { league, c } of expected) ok(ids.includes(`espn:tennis:${league}:${c.id}`), `${c.id} listé en ${league}`);
  const w = list.find((m) => m.id === 'espn:tennis:wta:182586');
  eq([w.competition, w.home.name, w.outcome, w.meta.league], ['US Open · WTA', 'Iga Swiatek', '1', 'wta'], 'match WTA du flux ATP');
  eq(list.find((m) => m.id === 'espn:tennis:atp:182724').round, '8e de finale', 'Round 4 d\'un Grand Chelem');
  eq(list.find((m) => m.id === 'espn:tennis:atp:182727').round, '3e tour', 'Round 3');
});

test('liste : échecs partiels, classement indisponible, cache de 6 h', async () => {
  // Circuit ATP en panne : la WTA suffit, pas d'erreur.
  const partial = fakeNet({ ...LIVE_ROUTES,
    [`${SB}/atp/scoreboard?dates=20260927`]: new Error('HTTP 500'),
    [`${SB}/atp/scoreboard?dates=20260928`]: null }); // corps vide : réponse illisible
  const wtaOnly = await createTennisAdapter({ getJson: partial.getJson }).upcoming({ now: NOW, days: 7 });
  ok(wtaOnly.length > 0 && wtaOnly.every((m) => m.meta.league === 'wta'), 'matchs WTA seuls');

  // Tout en panne : erreur.
  const down = fakeNet(() => new Error('réseau coupé'));
  let threw = false;
  try { await createTennisAdapter({ getJson: down.getJson }).upcoming({ now: NOW, days: 7 }); } catch { threw = true; }
  ok(threw, 'lève une erreur si toutes les requêtes échouent');

  // Classements en panne (sans cache) : pas de cote fiable → pas de match programmé, le reste est listé.
  const noRank = fakeNet({ ...LIVE_ROUTES, [`${SB}/atp/rankings`]: new Error('HTTP 503'), [`${SB}/wta/rankings`]: new Error('HTTP 503') });
  const list = await createTennisAdapter({ getJson: noRank.getJson }).upcoming({ now: NOW, days: 7 });
  ok(list.length > 0 && list.every((m) => m.status !== 'scheduled'), 'seulement en cours / terminés');
  ok(list.some((m) => m.status === 'live'), 'le direct reste listé');

  // Cache : 1 requête par circuit pendant 6 h ; ensuite, un échec réutilise l'ancien classement.
  let rankingsDown = false;
  const net = fakeNet((url) => (url.endsWith('/rankings') && rankingsDown ? new Error('HTTP 503') : LIVE_ROUTES[url]));
  const adapter = createTennisAdapter({ getJson: net.getJson });
  const count = () => net.calls.filter((u) => u.endsWith('/rankings')).length;
  await adapter.upcoming({ now: NOW, days: 7 });
  await adapter.upcoming({ now: NOW + HOUR, days: 7 });
  eq(count(), 2, 'classements lus une fois par circuit');
  rankingsDown = true;
  const later = await adapter.upcoming({ now: NOW + 7 * HOUR, days: 7 });
  eq(count(), 4, 'classements redemandés après 6 h');
  ok(later.some((m) => m.status === 'scheduled'), 'classement en cache réutilisé si la mise à jour échoue');
});

// ─── Résultats ───────────────────────────────────────────────────────────────
test('résultats : direct, victoires, forfait, horaire décalé, match introuvable récent', async () => {
  const net = fakeNet(LIVE_ROUTES);
  const matches = [
    stored('atp', '183370', '2026-09-27T07:45Z'),  // en cours
    stored('atp', '183418', '2026-09-27T05:05Z'),  // Brooksby - Basilashvili : joueur 2
    stored('atp', '183371', '2026-09-27T05:35Z'),  // Marozsan - Jacquet : joueur 2, jeu décisif 14-12
    stored('wta', '186185', '2026-09-27T04:55Z'),  // Sidorova - Guo : joueuse 1
    stored('wta', '186197', '2026-09-27T04:00Z'),  // forfait (STATUS_WALKOVER)
    stored('atp', '183414', '2026-09-27T08:00Z'),  // l'ordre de jeu a glissé à 08:30
    stored('wta', '184107', '2026-09-27T09:00Z'),  // programmé, horaire inchangé
    stored('atp', '999999', '2026-09-27T06:00Z'),  // introuvable, mais récent
  ];
  const u = byMatch(await createTennisAdapter({ getJson: net.getJson }).results({ now: NOW, matches }));
  eq(u['espn:tennis:atp:183370'], { matchId: 'espn:tennis:atp:183370', status: 'live', liveScore: '5-6', clock: '1er set' }, 'direct');
  eq(u['espn:tennis:atp:183418'], { matchId: 'espn:tennis:atp:183418', status: 'finished', outcome: '2', score: '4-6 6-7(4)' }, 'victoire joueur 2');
  eq(u['espn:tennis:atp:183371'].score, '6-7(12) 4-6', 'jeu décisif prolongé');
  eq(u['espn:tennis:wta:186185'], { matchId: 'espn:tennis:wta:186185', status: 'finished', outcome: '1', score: '6-3 6-4' }, 'victoire joueuse 1');
  eq(u['espn:tennis:wta:186197'], { matchId: 'espn:tennis:wta:186197', status: 'void' }, 'forfait remboursé');
  eq(u['espn:tennis:atp:183414'], { matchId: 'espn:tennis:atp:183414', status: 'scheduled', startsAt: Date.parse('2026-09-27T08:30Z') }, 'nouvel horaire');
  eq(u['espn:tennis:wta:184107'], { matchId: 'espn:tennis:wta:184107', status: 'scheduled' }, 'toujours programmé');
  ok(!u['espn:tennis:atp:999999'], 'introuvable depuis moins de 36 h : on attend');
  eq(new Set(net.calls).size, net.calls.length, 'chaque flux lu une seule fois');
  eq([...net.calls].sort(), [`${SB}/atp/scoreboard?dates=20260927`, `${SB}/wta/scoreboard?dates=20260927`], 'jour ESPN des matchs');
});

test('résultats : abandons et forfait de l\'US Open, match WTA retrouvé dans le flux ATP', async () => {
  // Un jour ESPN renvoie tout le tableau des tournois en cours : n'importe quel jour du tournoi
  // renvoie donc l'US Open. Le flux WTA est simulé vide pour forcer la recherche dans le flux ATP.
  const net = fakeNet((url) => {
    const m = /\/(atp|wta)\/scoreboard\?dates=(\d{8})$/.exec(url);
    if (!m || m[2] < '20260824' || m[2] > '20260913') return undefined;
    return m[1] === 'atp' ? 'usopen_scoreboard_20260905.json' : { events: [] };
  });
  const matches = [
    stored('atp', '182706', '2026-09-01T18:50Z'),  // Sweeny - Moutet, abandon de Moutet
    stored('atp', '184599', '2026-08-25T15:05Z'),  // Kwon - Lajovic, abandon de Kwon
    stored('atp', '184769', '2026-08-27T16:30Z'),  // Virtanen - Dimitrov, forfait
    stored('wta', '184744', '2026-08-24T19:45Z'),  // Bronzetti - Giovannini, abandon (tableau féminin)
  ];
  const u = byMatch(await createTennisAdapter({ getJson: net.getJson }).results({ now: Date.parse('2026-09-06T12:00Z'), matches }));
  eq(u['espn:tennis:atp:182706'], { matchId: 'espn:tennis:atp:182706', status: 'finished', outcome: '1', score: '7-6(4) 6-4 3-0 ab.' }, 'abandon, joueur 1 vainqueur');
  eq(u['espn:tennis:atp:184599'], { matchId: 'espn:tennis:atp:184599', status: 'finished', outcome: '2', score: '6-4 5-7 1-3 ab.' }, 'abandon, joueur 2 vainqueur');
  eq(u['espn:tennis:atp:184769'], { matchId: 'espn:tennis:atp:184769', status: 'void' }, 'forfait remboursé');
  eq(u['espn:tennis:wta:184744'], { matchId: 'espn:tennis:wta:184744', status: 'finished', outcome: '1', score: '5-0 ab.' }, 'match WTA retrouvé dans le flux ATP');
  ok(net.calls.includes(`${SB}/wta/scoreboard?dates=20260824`) && net.calls.includes(`${SB}/atp/scoreboard?dates=20260824`), 'flux WTA puis ATP');
  ok(!net.calls.some((c) => c.includes('/wta/') && !c.endsWith('20260824')), 'flux WTA seulement pour le match WTA');
});

test('résultats : Grand Chelem, un seul flux lu pour les deux circuits', async () => {
  const net = fakeNet({
    [`${SB}/wta/scoreboard?dates=20260905`]: 'usopen_scoreboard_20260905.json', // flux WTA identique au flux ATP ce jour-là
    [`${SB}/atp/scoreboard?dates=20260905`]: 'usopen_scoreboard_20260905.json',
  });
  const matches = [
    stored('wta', '182540', '2026-09-05T15:05Z'),  // Potapova - Anisimova
    stored('wta', '182560', '2026-09-05T15:05Z'),  // Keys - Zheng
    stored('atp', '182727', '2026-09-05T15:40Z'),  // Fritz - Cerundolo
  ];
  const u = byMatch(await createTennisAdapter({ getJson: net.getJson }).results({ now: Date.parse('2026-09-06T12:00Z'), matches }));
  eq([u['espn:tennis:wta:182540'].outcome, u['espn:tennis:wta:182560'].outcome, u['espn:tennis:atp:182727'].outcome], ['1', '2', '2'], 'vainqueurs');
  eq(net.calls, [`${SB}/wta/scoreboard?dates=20260905`], 'un seul flux (circuit le plus représenté)');
});

// Variantes de la fixture ATP du 27/09 : statuts qu'on ne peut pas capturer à la demande.
function patchedAtp(patch) {
  const data = fixture('atp_scoreboard_20260927.json');
  patch((id) => compIn(data, id));
  return data;
}
const status = (id, name, state, completed) => ({ period: 1, type: { id, name, state, completed, description: name, detail: name, shortDetail: name } });

test('résultats : reporté, annulé, interrompu, sans vainqueur, match fantôme', async () => {
  const atp = patchedAtp((c) => {
    c('183414').status = status('6', 'STATUS_POSTPONED', 'post', false);
    c('183415').status = status('5', 'STATUS_CANCELED', 'post', false);
    const s = c('183372');
    s.status = status('8', 'STATUS_SUSPENDED', 'post', false);
    for (const cp of s.competitors) {
      cp.linescores = cp.homeAway === 'home' ? [{ value: 6, winner: true }, { value: 2 }] : [{ value: 3, winner: false }, { value: 3 }];
    }
    for (const cp of c('183418').competitors) delete cp.winner; // terminé mais vainqueur absent
  });
  const routes = { ...LIVE_ROUTES, [`${SB}/atp/scoreboard?dates=20260927`]: atp };
  const matches = [
    stored('atp', '183414', '2026-09-27T08:30Z'),
    stored('atp', '183415', '2026-09-27T09:30Z'),
    stored('atp', '183372', '2026-09-27T09:00Z'),
    stored('atp', '183418', '2026-09-27T05:05Z'),
    stored('atp', '183373', '2026-09-27T11:30Z'),  // toujours 'pre' dans le flux
    stored('atp', '999999', '2026-09-27T06:00Z', '441-2026'),  // retiré du tableau de Chengdu (présent dans le flux)
    stored('atp', '999998', '2026-09-27T06:00Z', '5-2026'),    // Japan Open : absent du flux (fenêtre retouchée)
    stored('atp', '999997', '2026-09-27T06:00Z'),              // ancien match, sans meta.tournament
  ];
  const run = async (now, r = routes) => byMatch(await createTennisAdapter({ getJson: fakeNet(r).getJson }).results({ now, matches }));

  const soon = await run(NOW + 2 * HOUR);
  eq(soon['espn:tennis:atp:183414'].status, 'void', 'reporté → remboursé');
  eq(soon['espn:tennis:atp:183415'].status, 'void', 'annulé → remboursé');
  eq(soon['espn:tennis:atp:183372'], { matchId: 'espn:tennis:atp:183372', status: 'live', liveScore: '6-3 2-3', clock: 'Interrompu' }, 'interrompu : on attend la reprise');
  ok(!soon['espn:tennis:atp:183418'], 'terminé sans vainqueur : on attend');
  eq(soon['espn:tennis:atp:183373'], { matchId: 'espn:tennis:atp:183373', status: 'scheduled' }, 'pas encore commencé');
  ok(!soon['espn:tennis:atp:999999'], 'absent depuis peu : on attend');

  const late = await run(Date.parse('2026-09-27T11:30Z') + 37 * HOUR);
  eq(late['espn:tennis:atp:183373'].status, 'void', 'toujours "pre" 37 h après l\'heure prévue → remboursé');
  eq(late['espn:tennis:atp:999999'].status, 'void', 'retiré du tableau de son tournoi après 36 h → remboursé');
  ok(!late['espn:tennis:atp:999998'], 'tournoi absent du flux : rien ne prouve que le match a disparu → on attend');
  ok(!late['espn:tennis:atp:999997'], 'sans meta.tournament : on attend');
  eq(late['espn:tennis:atp:183418'].status, 'void', 'terminé sans vainqueur après 36 h → remboursé');
  eq(late['espn:tennis:atp:183372'].status, 'live', 'interrompu : jamais remboursé automatiquement');

  const lateWtaDown = await run(Date.parse('2026-09-27T11:30Z') + 37 * HOUR, { ...routes, [`${SB}/wta/scoreboard?dates=20260927`]: new Error('HTTP 502') });
  ok(!lateWtaDown['espn:tennis:atp:999999'], 'flux WTA en panne : pas de remboursement du match introuvable');
});

test('résultats : flux vides, illisibles ou partiels → jamais de remboursement', async () => {
  const late = Date.parse('2026-09-27T08:30Z') + 37 * HOUR;
  const matches = [stored('atp', '183414', '2026-09-27T08:30Z', '441-2026'), stored('atp', '999999', '2026-09-27T06:00Z', '441-2026')];
  const run = (routes) => createTennisAdapter({ getJson: fakeNet(routes).getJson }).results({ now: late, matches });
  const threw = async (routes) => { try { await run(routes); return false; } catch { return true; } };

  // Réponses 200 sans aucun match (vu en direct : plages vides) ou corps illisibles : c'est une panne.
  ok(await threw(() => ({ leagues: [], events: [] })), 'deux flux vides : erreur, aucun remboursement');
  ok(await threw(() => null), 'deux corps vides : erreur');
  ok(await threw(() => ({ code: 400, message: 'Failed to get events endpoint.' })), 'deux réponses d\'erreur ESPN : erreur');

  // Flux ATP vide, flux WTA normal : Chengdu n'est dans aucun flux → on attend.
  const atpEmpty = await run({ ...LIVE_ROUTES, [`${SB}/atp/scoreboard?dates=20260927`]: { leagues: [], events: [] } });
  eq(atpEmpty, [], 'flux ATP vide : rien');

  // Flux ATP partiel (Chengdu manquant, fenêtre retouchée) : on attend.
  const partial = fixture('atp_scoreboard_20260927.json');
  partial.events = partial.events.filter((e) => e.id !== '441-2026');
  eq(await run({ ...LIVE_ROUTES, [`${SB}/atp/scoreboard?dates=20260927`]: partial }), [], 'tournoi absent du flux : rien');

  // Flux WTA illisible : pas de remboursement du match retiré (l'autre flux n'a pas répondu).
  const wtaBad = byMatch(await run({ ...LIVE_ROUTES, [`${SB}/wta/scoreboard?dates=20260927`]: { error: 'x' } }));
  ok(!wtaBad['espn:tennis:atp:999999'], 'flux WTA illisible : on attend');

  // Tout répond : le match retiré est remboursé, l'autre (programmé 37 h plus tôt) aussi.
  const all = byMatch(await run(LIVE_ROUTES));
  eq([all['espn:tennis:atp:999999'].status, all['espn:tennis:atp:183414'].status], ['void', 'void'], 'flux complets');
});

test('résultats : erreurs réseau', async () => {
  const matches = [stored('atp', '183370', '2026-09-27T07:45Z'), stored('wta', '184107', '2026-09-27T09:00Z')];
  let threw = false;
  try {
    await createTennisAdapter({ getJson: fakeNet(() => new Error('HTTP 500')).getJson }).results({ now: NOW + 40 * HOUR, matches });
  } catch { threw = true; }
  ok(threw, 'lève une erreur si toutes les requêtes échouent');
  const half = fakeNet({ ...LIVE_ROUTES, [`${SB}/atp/scoreboard?dates=20260927`]: new Error('HTTP 500') });
  const u = byMatch(await createTennisAdapter({ getJson: half.getJson }).results({ now: NOW + 40 * HOUR, matches }));
  ok(!u['espn:tennis:atp:183370'], 'flux ATP en panne : pas de remboursement (même après 36 h)');
  eq(u['espn:tennis:wta:184107'].status, 'void', 'flux WTA joignable : match jamais joué après 36 h → remboursé');
  eq(await createTennisAdapter({ getJson: fakeNet({}).getJson }).results({ now: NOW, matches: [] }), [], 'rien à suivre');
});

test('flux partagés entre liste et résultats, jamais entre deux lectures de confirmation', async () => {
  const net = fakeNet(LIVE_ROUTES);
  const a = createTennisAdapter({ getJson: net.getJson });
  const matches = [stored('wta', '184107', '2026-09-27T09:00Z', '1009-2026'), stored('atp', '183370', '2026-09-27T07:45Z', '441-2026')];
  // Comme services/matches.js : liste et résultats lancés ensemble, au même instant.
  const [list, ups] = await Promise.all([a.upcoming({ now: NOW, days: 7 }), a.results({ now: NOW, matches })]);
  ok(list.length > 0 && ups.length === 2, 'liste et résultats complets');
  eq([...net.calls].sort(), Object.keys(LIVE_ROUTES).sort(), 'chaque flux téléchargé une seule fois');

  // Lecture de confirmation 20 s plus tard (services/matches.js, tools/snapshot.js) : nouvelle requête.
  await a.results({ now: NOW + 20_000, matches });
  eq(net.calls.filter((u) => u.endsWith('scoreboard?dates=20260927')).length, 4, 'flux relus après 20 s');
  await a.results({ now: NOW + 25_000, matches });
  eq(net.calls.filter((u) => u.endsWith('scoreboard?dates=20260927')).length, 4, 'réponse gardée moins de 20 s');

  // Un échec n'est pas gardé : la lecture suivante, même immédiate, refait la requête.
  let down = true;
  const flaky = fakeNet((url) => (down ? new Error('HTTP 503') : LIVE_ROUTES[url]));
  const b = createTennisAdapter({ getJson: flaky.getJson });
  let threw = false;
  try { await b.results({ now: NOW, matches }); } catch { threw = true; }
  ok(threw, 'panne : erreur');
  down = false;
  eq((await b.results({ now: NOW, matches })).length, 2, 'réessai immédiat après une panne');
});

test('adaptateur : clé et url de test d\'accès', () => {
  const a = createTennisAdapter({ getJson: fakeNet({}).getJson });
  eq(a.key, 'tennis', 'clé');
  ok(a.probeUrl.startsWith(`${SB}/atp/scoreboard?dates=`), 'probeUrl');
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
