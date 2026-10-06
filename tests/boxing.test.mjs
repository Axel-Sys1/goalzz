// Tests du provider TheSportsDB boxe (js/providers/thesportsdb/boxing.js), sans réseau.
// Lancer depuis n'importe quel dossier :
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/boxing.test.mjs
//
// Réponses TheSportsDB (clé gratuite 123) enregistrées le 27/09/2026 vers 08:25 UTC (tests/fixtures/boxing/) :
// - eventsday_2026-09-26/27, 10-03.json    jours UTC de la ligue 4445 (3 combats le 26, résultats pas encore saisis)
// - eventsday_empty.json                   jour sans combat ({"events":null}) : 28/09 → 02/10, 04/10, 25/09
// - eventsday_2026-08-29/09-05/09-12/09-19_results.json  jours passés : strResult rédigé (article)
// - lookupevent_2505463_zuffa1_table.json  strResult en tableau ('Callum Walsh  def.  Carlos Ocampo  UD')
// - lookupevent_2297359 + eventresults_2297359  Canelo vs Crawford : article + WIN/LOSS structurés
// - lookupevent_2373406 + eventresults_2373406  Serrano vs Tellez : pas de texte ; WIN/LOSS de 3 boxeurs
//                                               de la soirée, dont Serrano seule parmi nos deux
// - lookupevent_2610009_no_result.json     Cejudo vs Walton, 10 h après : rien de saisi
// - eventsnextleague_4445.json             l'unique événement « suivant » de la clé gratuite
// Enregistrées le 27/09/2026 vers 17:40 UTC :
// - eventsday_2026-08-28_results.json      Marksman vs Barreto : « handed … his first professional defeat »
// - eventsday_2026-08-08_never_settled.json  3 combats toujours SANS résultat 7 semaines après
// - eventresults_2607379_one_row.json      Cruz vs Bravo : une seule ligne (WIN du vainqueur)
// Les nuls, reports, contradictions et refus 429 (TypeError, faute d'en-tête CORS) n'existent pas dans
// ces données : ce sont des copies d'événements réels dont on change un champ.
import {
  createBoxingProvider, createThrottle, parseEventName, parseTimestamp, norm, outcomeFromText, outcomeFromRows, readResult,
  withoutResult, dayUrl, lookupUrl, resultsUrl,
} from '../js/providers/thesportsdb/boxing.js';

globalThis.console ??= { warn() {}, log: print }; // jsc n'a pas de console

const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(/[^/]*$/, '');
const FX = `${HERE}fixtures/boxing/`;
const MIN = 60_000;
const HOUR = 60 * MIN;

// ─── Outils ──────────────────────────────────────────────────────────────────
const texts = {};
const fixture = (name) => JSON.parse(texts[name] ??= readFile(FX + name));

function fail(msg) { throw new Error(msg); }
const ok = (cond, msg) => { if (!cond) fail(msg); };
const eq = (got, want, msg) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${msg} : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);
};

// Réseau simulé : url → nom de fixture | objet | Error ; eventsday d'un jour non listé → jour vide.
function fakeNet(routes = {}) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    let r = routes[url];
    if (r === undefined && url.includes('/eventsday.php')) r = 'eventsday_empty.json';
    if (r === undefined) throw new Error(`HTTP 404 (url imprévue) ${url}`);
    if (r instanceof Error) throw r;
    if (typeof r === 'string') return fixture(r);
    return JSON.parse(JSON.stringify(r));
  };
  return { getJson, calls };
}

const fast = () => createThrottle({ perMinute: 10_000 });
const provider = (net) => createBoxingProvider({ getJson: net.getJson, throttle: fast() });
const byId = (list) => Object.fromEntries(list.map((m) => [m.id ?? m.matchId, m]));
const eventOf = (file, id) => fixture(file).events.find((e) => e.idEvent === id) || fail(`événement ${id} absent`);
const keys = (a, b) => [a, b].map((n) => {
  const w = norm(n).split(' ');
  return { full: w.join(' '), last: w[w.length - 1] };
});

// Match déjà connu du cœur, tel qu'il est transmis à fetchResults().
const stored = (id, home, away, iso) => ({
  id: `tsdb:boxing:4445:${id}`, startsAt: Date.parse(iso), status: 'scheduled',
  home: { name: home }, away: { name: away }, meta: { event: id },
});

const NOW = Date.parse('2026-09-27T08:22Z'); // capture des fixtures eventsday
const LIVE_DAYS = {
  [dayUrl('2026-09-26')]: 'eventsday_2026-09-26.json',
  [dayUrl('2026-09-27')]: 'eventsday_2026-09-27.json',
  [dayUrl('2026-10-03')]: 'eventsday_2026-10-03.json',
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── Fonctions pures ─────────────────────────────────────────────────────────
test('parseEventName / parseTimestamp / norm', () => {
  eq(parseEventName('Henry Cejudo vs Javon Walton'), { card: null, home: 'Henry Cejudo', away: 'Javon Walton' }, 'affiche simple');
  eq(parseEventName('Zuffa Boxing 11 Fisher vs Pirotton'), { card: 'Zuffa Boxing 11', home: 'Fisher', away: 'Pirotton' }, 'nom de soirée');
  eq(parseEventName('Prime Video Boxing 16 Inoue vs Nasukawa II'), { card: 'Prime Video Boxing 16', home: 'Inoue', away: 'Nasukawa' }, 'revanche');
  eq(parseEventName('MVPW 06 Mayer vs Cameron'), { card: 'MVPW 06', home: 'Mayer', away: 'Cameron' }, 'numéro à zéro');
  eq(parseEventName('Boxing Day Card'), null, 'pas de « vs »');
  eq(parseTimestamp({ strTimestamp: '2026-09-26T22:00:00' }), Date.parse('2026-09-26T22:00:00Z'), 'UTC sans Z');
  eq(parseTimestamp({ strTimestamp: '', dateEvent: '2026-10-03', strTime: '00:00:00' }), Date.parse('2026-10-03T00:00:00Z'), 'repli dateEvent');
  eq(norm('Isaac “Pitbull” Cruz'), 'isaac cruz', 'surnom retiré');
  eq(norm('Saúl “Canelo” Álvarez'), 'saul alvarez', 'accents et surnom');
});

test('résultat en texte : articles réels (le vainqueur est le sujet de la 1re phrase)', () => {
  const cases = [
    ['eventsday_2026-08-29_results.json', '2528768', 'Moses Itauma', 'Filip Hrgovic', '2', 'KO/TKO'],
    ['eventsday_2026-08-29_results.json', '2528769', 'Mayer', 'Cameron', '2', 'Décision unanime'],
    ['eventsday_2026-09-05_results.json', '2548282', 'Katie Taylor', 'Flora Pili', '1', 'Décision unanime'],
    ['eventsday_2026-09-12_results.json', '2548270', 'Ryan Garcia', 'Conor Benn', '1', 'KO/TKO'],
    ['eventsday_2026-09-19_results.json', '2548283', 'John Hedges', 'Pat Brown', '2', 'KO/TKO'],
    ['eventsday_2026-09-19_results.json', '2607379', 'Isaac Cruz', 'Nestor Bravo', '1', 'KO/TKO'],
    ['lookupevent_2297359_canelo_crawford.json', '2297359', 'Canelo Alvarez', 'Terence Crawford', '2', 'Décision unanime'],
  ];
  for (const [file, id, a, b, outcome, method] of cases) {
    eq(outcomeFromText(eventOf(file, id).strResult, keys(a, b)), { outcome, method }, `${a} vs ${b}`);
  }
  const table = eventOf('lookupevent_2505463_zuffa1_table.json', '2505463').strResult;
  eq(outcomeFromText(table, keys('Walsh', 'Ocampo')), { outcome: '1', method: 'Décision unanime' }, 'tableau : Walsh def. Ocampo UD');
  eq(outcomeFromText(table, keys('Austin Deanda', 'Misael Rodriguez')), { outcome: '2', method: 'KO/TKO' }, 'tableau : RTD, accent, vainqueur en 2e');
  eq(outcomeFromText(table, keys('Walsh', 'Deanda')), null, 'deux boxeurs de combats différents : rien');
});

test('résultat en texte : pièges (passif, perdant sujet, possessif, nul, no contest)', () => {
  const k = keys('Moses Itauma', 'Filip Hrgovic');
  eq(outcomeFromText('Moses Itauma was stopped by Filip Hrgovic in the ninth round.', k), null, 'passif');
  eq(outcomeFromText('Moses Itauma lost to Filip Hrgovic by knockout.', k), null, 'perdant sujet');
  eq(outcomeFromText('Moses Itauma has lost his title to Filip Hrgovic.', k), null, '« has lost »');
  eq(outcomeFromText("Itauma's unbeaten run ended when Filip Hrgovic stopped him.", k), null, 'possessif');
  eq(outcomeFromText('After a dramatic ninth round in Riyadh, the referee finally let Filip Hrgovic beat Itauma.', k), null, 'sujet trop loin');
  eq(outcomeFromText('Filip Hrgovic and Moses Itauma fought to a split draw.', k), { outcome: 'X', method: null }, 'nul');
  eq(outcomeFromText('Moses Itauma vs Filip Hrgovic was ruled a no contest after a clash of heads.', k), { outcome: 'void', method: null }, 'no contest');
  eq(outcomeFromText('Filip Hrgovic stopped Joe Bloggs in round two.', k), null, 'adversaire absent');
  eq(outcomeFromText('', k), null, 'vide');
  eq(outcomeFromText('Filip Hrgovic has retained his title by stopping Moses Itauma.', k), { outcome: '2', method: 'KO/TKO' }, '« has retained »');
});

test('résultat en texte : indéterminable → rien (subordonnée, incise, passif, négation, futur)', () => {
  const k = keys('Moses Itauma', 'Filip Hrgovic');
  eq(outcomeFromText('After Moses Itauma beat Filip Hrgovic in 2024, the rematch ended in controversy.', k), null, 'subordonnée en tête');
  eq(outcomeFromText('Moses Itauma, who defeated Filip Hrgovic in 2024, lost the rematch.', k), null, 'incise « who »');
  eq(outcomeFromText('Moses Itauma, knocked down twice, lost to Filip Hrgovic on points.', k), null, 'incise après une virgule');
  eq(outcomeFromText('Moses Itauma knocked down and then got stopped by Filip Hrgovic.', k), null, 'passif « by » juste avant l\'adversaire');
  eq(outcomeFromText('Moses Itauma did not beat Filip Hrgovic.', k), null, 'négation');
  eq(outcomeFromText('Moses Itauma will defend his title against Filip Hrgovic in December.', k), null, 'futur (annonce)');
  eq(outcomeFromText('Moses Itauma aims to stop Filip Hrgovic.', k), null, 'intention');
  eq(outcomeFromText('Moses Itauma and Filip Hrgovic could fight to a draw.', k), null, 'nul au conditionnel');
  eq(outcomeFromText('Moses Itauma handed Filip Hrgovic the win after a low blow.', k), null, '« handed … the win » : pas une défaite de l\'adversaire');
  const marksman = eventOf('eventsday_2026-08-28_results.json', '2594489').strResult;
  eq(outcomeFromText(marksman, keys('Corey Marksman', 'Christian Barreto')), { outcome: '1', method: 'Décision unanime' },
    'réel : « handed Christian Barreto his first professional defeat »');
});

test('résultat en tableau : nul, no contest, combat sans résultat, initiale « D. »', () => {
  const k = keys('Dave Allen', 'Jon Doe');
  eq(outcomeFromText('Heavyweight \tDave Allen \tvs. \tJon Doe \tDraw (SD) \t10 \t\t', k), { outcome: 'X', method: null }, 'nul');
  eq(outcomeFromText('Heavyweight \tDave Allen \tvs. \tJon Doe \tNC \t3 \t\t', k), { outcome: 'void', method: null }, 'no contest');
  eq(outcomeFromText('Heavyweight \tD. Allen \tvs. \tJon Doe \t\t\t\t', k), null, 'initiale « D. » : pas un nul');
  eq(outcomeFromText('Heavyweight \tDave Allen \tvs. \tJon Doe \t\t\t\t', k), null, 'combat pas encore renseigné');
});

test('résultats structurés (eventresults) : WIN / LOSS, homonymes, nul', () => {
  const canelo = fixture('eventresults_2297359_win_loss.json').results;
  eq(outcomeFromRows(canelo, keys('Canelo Alvarez', 'Terence Crawford')), '2', 'Crawford WIN (Canelo Álvarez accentué)');
  const serrano = fixture('eventresults_2373406_other_bouts.json').results;
  eq(outcomeFromRows(serrano, keys('Amanda Serrano', 'Reina Tellez')), '1', 'Serrano WIN, les autres lignes concernent d\'autres combats');
  const cruz = fixture('eventresults_2607379_one_row.json').results;
  eq(outcomeFromRows(cruz, keys('Isaac Cruz', 'Nestor Bravo')), '1', 'réel : une seule ligne, WIN de Cruz');
  eq(readResult(eventOf('eventsday_2026-09-19_results.json', '2607379'), ['Isaac Cruz', 'Nestor Bravo'], cruz),
    { status: 'finished', outcome: '1', score: 'KO/TKO' }, 'réel : article et ligne WIN d\'accord');
  eq(outcomeFromRows([{ strPlayer: 'Isaac Cruz', strDetail: 'LOSS' }], keys('Isaac Cruz', 'Nestor Bravo')), null, 'LOSS seul : vainqueur non écrit');
  const draw = canelo.map((r) => ({ ...r, strDetail: 'DRAW' }));
  eq(outcomeFromRows(draw, keys('Canelo Alvarez', 'Terence Crawford')), 'X', 'nul');
  const both = canelo.map((r) => ({ ...r, strDetail: 'WIN' }));
  eq(outcomeFromRows(both, keys('Canelo Alvarez', 'Terence Crawford')), null, 'deux WIN : incohérent');
  eq(outcomeFromRows(null, keys('A B', 'C D')), null, 'aucune ligne');
  const ev = eventOf('lookupevent_2297359_canelo_crawford.json', '2297359');
  eq(readResult(ev, ['Canelo Alvarez', 'Terence Crawford'], canelo), { status: 'finished', outcome: '2', score: 'Décision unanime' }, 'texte et lignes d\'accord');
  const flipped = canelo.map((r) => ({ ...r, strDetail: r.strDetail === 'WIN' ? 'LOSS' : 'WIN' }));
  eq(readResult(ev, ['Canelo Alvarez', 'Terence Crawford'], flipped), null, 'texte et lignes contradictoires : rien');
  eq(readResult({ ...ev, strPostponed: 'yes' }, ['Canelo Alvarez', 'Terence Crawford']), { status: 'void' }, 'reporté');
});

// ─── Liste ───────────────────────────────────────────────────────────────────
test('liste : combats du 25/09 au 04/10, noms, soirée, heure UTC, cotes 50/50', async () => {
  const net = fakeNet(LIVE_DAYS);
  const list = await provider(net).fetchUpcoming({ now: NOW, days: 7 });
  const m = byId(list);
  eq(list.map((x) => x.id).sort(), ['2548280', '2548284', '2580338', '2607378', '2610009'].map((id) => `tsdb:boxing:4445:${id}`), 'combats listés');
  const cejudo = m['tsdb:boxing:4445:2610009'];
  eq([cejudo.home.name, cejudo.away.name, cejudo.home.short, cejudo.away.short], ['Henry Cejudo', 'Javon Walton', 'CEJ', 'WAL'], 'boxeurs lus dans strEvent');
  eq([cejudo.competition, cejudo.startsAt, cejudo.status], ['Boxe', Date.parse('2026-09-26T22:00:00Z'), 'scheduled'], 'commencé sans résultat : reste programmé');
  eq(cejudo.competitionLogo, 'https://r2.thesportsdb.com/images/media/league/badge/j14hx41784791003.png', 'logo de la ligue');
  eq(cejudo.meta, { event: '2610009' }, 'meta');
  const inoue = m['tsdb:boxing:4445:2548280'];
  eq([inoue.competition, inoue.home.name, inoue.away.name], ['Prime Video Boxing 16', 'Inoue', 'Nasukawa'], 'nom de soirée');
  eq(m['tsdb:boxing:4445:2580338'].competition, 'Zuffa Boxing 11', 'Zuffa Boxing');
  for (const x of list) {
    ok(x.source === 'tsdb' && x.real === true && x.sport === 'boxing', `${x.id} : champs fixes`);
    eq([x.odds, x.oddsSource], [{ 1: 1.86, 2: 1.86 }, 'model'], `${x.id} : cotes 50/50 sans nul`);
  }
  eq(net.calls.length, 10, 'un appel par jour UTC (25/09 → 04/10)');
  eq(net.calls[0], dayUrl('2026-09-27'), 'aujourd\'hui d\'abord');
  eq(net.calls.slice(-2), [dayUrl('2026-09-26'), dayUrl('2026-09-25')], 'le passé en dernier');
  ok(net.calls.every((u) => u.startsWith('https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=') && u.endsWith('&l=4445')), 'urls eventsday');
});

test('liste : combats passés réglés par le texte, même réponse que fetchResults', async () => {
  const now = Date.parse('2026-09-20T12:00Z');
  const routes = { [dayUrl('2026-09-19')]: 'eventsday_2026-09-19_results.json' };
  const p = provider(fakeNet(routes));
  const m = byId(await p.fetchUpcoming({ now, days: 7 }));
  const cruz = m['tsdb:boxing:4445:2607379'];
  eq([cruz.status, cruz.outcome, cruz.score], ['finished', '1', 'KO/TKO'], 'Cruz (domicile) gagne par KO');
  const brown = m['tsdb:boxing:4445:2548283'];
  eq([brown.home.name, brown.away.name, brown.status, brown.outcome], ['John Hedges', 'Pat Brown', 'finished', '2'], 'Brown (extérieur) gagne');

  const ev = eventOf('eventsday_2026-09-19_results.json', '2607379');
  const net = fakeNet({ [lookupUrl('2607379')]: { events: [ev] }, [resultsUrl('2607379')]: 'eventresults_empty.json' });
  const u = await provider(net).fetchResults({ now, matches: [stored('2607379', 'Isaac Cruz', 'Nestor Bravo', '2026-09-19T20:45Z')] });
  eq(u, [{ matchId: 'tsdb:boxing:4445:2607379', status: 'finished', outcome: '1', score: 'KO/TKO' }], 'fetchResults : même issue et même score');
});

test('liste : combat déjà suivi réglé par fetchResults seulement, report → void, adversaire inconnu absent', async () => {
  const now = Date.parse('2026-09-20T12:00Z');
  const routes = { [dayUrl('2026-09-19')]: 'eventsday_2026-09-19_results.json' };
  const existing = [stored('2607379', 'Isaac Cruz', 'Nestor Bravo', '2026-09-19T20:45Z')];
  const m = byId(await provider(fakeNet(routes)).fetchUpcoming({ now, existing, days: 7 }));
  const cruz = m['tsdb:boxing:4445:2607379'];
  eq([cruz.status, cruz.outcome, cruz.score], ['scheduled', null, null], 'déjà suivi (paris possibles) : le résultat attend fetchResults (texte + WIN/LOSS)');
  eq([m['tsdb:boxing:4445:2548283'].status, m['tsdb:boxing:4445:2548283'].outcome], ['finished', '2'], 'découvert déjà terminé : réglé par la liste');

  const whittaker = eventOf('eventsday_2026-10-03.json', '2548284');
  const day = (events) => fakeNet({ [dayUrl('2026-10-03')]: { events } });
  const list = async (events, ex = []) => byId(await provider(day(events)).fetchUpcoming({ now: NOW, existing: ex, days: 7 }));
  eq((await list([{ ...whittaker, strPostponed: 'yes' }]))['tsdb:boxing:4445:2548284'].status, 'void', 'strPostponed yes → void');
  eq((await list([{ ...whittaker, strStatus: 'Match Cancelled' }]))['tsdb:boxing:4445:2548284'].status, 'void', 'annulé → void');
  eq((await list([{ ...whittaker, strPostponed: 'yes' }], [stored('2548284', 'Ben Whittaker', 'Conor Wallace', '2026-10-03T00:00Z')]))['tsdb:boxing:4445:2548284'].status,
    'void', 'report d\'un combat suivi : void aussi (le cœur le relira deux fois)');
  eq((await list([{ ...whittaker, strStatus: 'SUSP' }]))['tsdb:boxing:4445:2548284'].status, 'scheduled', 'suspendu : pas de remboursement');

  const placeholders = ['Ben Whittaker vs TBA', 'Ben Whittaker vs Opponent TBC', 'Ben Whittaker vs To Be Announced', 'Ben Whittaker vs ?', 'Fight Night 5 Smith vs Smith']
    .map((strEvent, i) => ({ ...whittaker, idEvent: String(9000 + i), strEvent }));
  eq(Object.keys(await list(placeholders)), [], 'adversaire inconnu ou boxeurs indiscernables : jamais listé');
});

test('liste : cache par jour (jours proches relus, lointains gardés 6 h)', async () => {
  const net = fakeNet(LIVE_DAYS);
  const p = provider(net);
  await p.fetchUpcoming({ now: NOW, days: 7 });
  await p.fetchUpcoming({ now: NOW + 10 * MIN, days: 7 });
  eq(net.calls.length, 10, '10 min après : tout vient du cache');
  await p.fetchUpcoming({ now: NOW + 61 * MIN, days: 7 });
  eq(net.calls.slice(10).sort(), ['2026-09-26', '2026-09-27', '2026-09-28'].map(dayUrl).sort(), '1 h après : seuls les jours à ±36 h sont relus');
});

test('liste : refus 429 (TypeError sans CORS) → liste partielle, pause, jamais d\'exception si un jour a répondu', async () => {
  const net = fakeNet({ ...LIVE_DAYS, [dayUrl('2026-09-28')]: new TypeError('Failed to fetch') });
  const p = createBoxingProvider({ getJson: net.getJson, throttle: createThrottle({ perMinute: 10_000, pauseMs: 2 * MIN }) });
  const list = await p.fetchUpcoming({ now: NOW, days: 7 });
  eq(list.map((x) => x.id), ['tsdb:boxing:4445:2548280'], 'le jour déjà lu (27/09) est rendu');
  eq(net.calls, [dayUrl('2026-09-27'), dayUrl('2026-09-28')], 'plus aucune requête après le refus');

  const again = await p.fetchUpcoming({ now: NOW + 5 * MIN, days: 7 });
  eq(again.map((x) => x.id), ['tsdb:boxing:4445:2548280'], 'pendant la pause : le cache seulement');
  eq(net.calls.length, 2, 'pendant la pause, aucune nouvelle requête réseau');

  const dead = fakeNet({ [dayUrl('2026-09-27')]: new TypeError('Failed to fetch') });
  let threw = false;
  try {
    await provider(dead).fetchUpcoming({ now: NOW, days: 7 });
  } catch (err) { threw = err instanceof TypeError; }
  ok(threw, 'rien de lu et rien en cache : l\'erreur remonte (le cœur réessaiera)');
});

test('file d\'attente : 20 requêtes par minute au plus, pause après un échec', async () => {
  let t = 0;
  const slept = [];
  const q = createThrottle({ perMinute: 20, pauseMs: 2 * MIN, clock: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  const starts = [];
  for (let i = 0; i < 45; i += 1) {
    await q.run(async () => { starts.push(t); t += 1000; });
  }
  for (let i = 20; i < starts.length; i += 1) ok(starts[i] - starts[i - 20] >= 60_000, `requête ${i} : 20 au plus sur 60 s`);
  ok(slept.length >= 2, 'la file a attendu');
  let refused = 0;
  await q.run(async () => { throw new TypeError('Failed to fetch'); }).catch(() => {});
  let ran = false;
  await q.run(async () => { ran = true; }).catch(() => { refused += 1; });
  ok(!ran && refused === 1 && q.paused(), 'en pause juste après un échec');
  t += 2 * MIN + 1;
  await q.run(async () => { ran = true; });
  ok(ran && !q.paused(), 'reprise après 2 min');
});

// ─── Résultats ───────────────────────────────────────────────────────────────
test('résultats : tableau, article + WIN/LOSS, WIN seul, rien de saisi, remboursé après 4 jours', async () => {
  const zuffa = provider(fakeNet({ [lookupUrl('2505463')]: 'lookupevent_2505463_zuffa1_table.json', [resultsUrl('2505463')]: 'eventresults_empty.json' }));
  eq(await zuffa.fetchResults({ now: Date.parse('2026-01-25T12:00Z'), matches: [stored('2505463', 'Walsh', 'Ocampo', '2026-01-23T21:30Z')] }),
    [{ matchId: 'tsdb:boxing:4445:2505463', status: 'finished', outcome: '1', score: 'Décision unanime' }], 'tableau Zuffa Boxing 1');

  const canelo = provider(fakeNet({ [lookupUrl('2297359')]: 'lookupevent_2297359_canelo_crawford.json', [resultsUrl('2297359')]: 'eventresults_2297359_win_loss.json' }));
  eq(await canelo.fetchResults({ now: Date.parse('2025-09-15T12:00Z'), matches: [stored('2297359', 'Canelo Alvarez', 'Terence Crawford', '2025-09-13T21:30Z')] }),
    [{ matchId: 'tsdb:boxing:4445:2297359', status: 'finished', outcome: '2', score: 'Décision unanime' }], 'Canelo vs Crawford : victoire extérieur');

  const serrano = provider(fakeNet({ [lookupUrl('2373406')]: 'lookupevent_2373406_serrano_tellez.json', [resultsUrl('2373406')]: 'eventresults_2373406_other_bouts.json' }));
  eq(await serrano.fetchResults({ now: Date.parse('2026-01-05T12:00Z'), matches: [stored('2373406', 'Amanda Serrano', 'Reina Tellez', '2026-01-04T01:00Z')] }),
    [{ matchId: 'tsdb:boxing:4445:2373406', status: 'finished', outcome: '1', score: null }], 'WIN structuré seul (pas de texte)');

  const net = fakeNet({ [lookupUrl('2610009')]: 'lookupevent_2610009_no_result.json', [resultsUrl('2610009')]: 'eventresults_empty.json' });
  const p = provider(net);
  const cejudo = [stored('2610009', 'Henry Cejudo', 'Javon Walton', '2026-09-26T22:00Z')];
  eq(await p.fetchResults({ now: NOW, matches: cejudo }), [], 'rien de saisi 10 h après : aucune mise à jour');
  eq(net.calls.length, 2, 'lookupevent + eventresults');
  eq(await p.fetchResults({ now: NOW + 5 * MIN, matches: cejudo }), [], 'revérifié plus tard seulement');
  eq(net.calls.length, 2, 'pas de requête 5 min après');
  await p.fetchResults({ now: NOW + 11 * MIN, matches: cejudo });
  eq(net.calls.length, 4, 'revérifié 10 min après');
  await p.fetchResults({ now: NOW + 3 * 24 * HOUR, matches: cejudo });
  eq(await p.fetchResults({ now: NOW + 3 * 24 * HOUR + 30 * MIN, matches: cejudo }), [], 'passé 12 h : toutes les heures');
  eq(net.calls.length, 6, 'une seule vérification dans l\'heure');
  // Le contrat : « void = reporté / annulé / sans résultat ». Le cœur n'a aucun autre délai de
  // remboursement : sans ce void, les mises resteraient bloquées (6 combats sur 13 jamais renseignés).
  eq(await p.fetchResults({ now: NOW + 5 * 24 * HOUR, matches: cejudo }), [{ matchId: 'tsdb:boxing:4445:2610009', status: 'void' }],
    'toujours rien 4 jours après, TheSportsDB joignable : remboursé');
  eq(net.calls.length, 8, 'lookupevent + eventresults relus avant de rembourser');
  eq(await p.fetchResults({ now: NOW + 5 * 24 * HOUR + 10 * MIN, matches: cejudo }), [{ matchId: 'tsdb:boxing:4445:2610009', status: 'void' }],
    'relu au passage suivant (double lecture du cœur)');
});

test('résultats : combats réels jamais renseignés (08/08) → remboursés à 4 jours, pas avant', async () => {
  const evs = fixture('eventsday_2026-08-08_never_settled.json').events;
  const routes = {};
  for (const ev of evs) {
    routes[lookupUrl(ev.idEvent)] = { events: [ev] };
    routes[resultsUrl(ev.idEvent)] = 'eventresults_empty.json';
  }
  const matches = evs.map((ev) => {
    const p = parseEventName(ev.strEvent);
    return stored(ev.idEvent, p.home, p.away, `${ev.strTimestamp}Z`);
  });
  const at3d = await provider(fakeNet(routes)).fetchResults({ now: Date.parse('2026-08-11T12:00Z'), matches });
  eq(at3d, [], '3 jours après : rien (résultat indéterminable, pas encore de remboursement)');
  const late = await provider(fakeNet(routes)).fetchResults({ now: Date.parse('2026-09-27T17:40Z'), matches });
  eq(late.map((u) => u.status), ['void', 'void', 'void'], '7 semaines après, toujours rien : remboursés');

  const m = matches[0];
  const ev = evs.find((e) => e.idEvent === m.meta.event);
  const t = m.startsAt + 5 * 24 * HOUR;
  eq(withoutResult(m, ev, true, t), { status: 'void' }, 'TheSportsDB a répondu : void');
  eq(withoutResult(m, ev, false, t), null, 'eventresults en échec : jamais de void');
  eq(withoutResult(m, null, true, t), { status: 'void' }, 'événement supprimé depuis 4 jours : void');
  eq(withoutResult(m, null, true, m.startsAt + 3 * 24 * HOUR), null, 'supprimé depuis 3 jours seulement : rien');
  eq(withoutResult(m, { ...ev, strTimestamp: '2026-10-10T20:00:00' }, true, t), { status: 'scheduled', startsAt: Date.parse('2026-10-10T20:00:00Z') }, 'nouvelle date à venir : reprogrammé');
});

test('résultats : reporté → void, nul → X, reprogrammé, trop tôt, réseau en panne', async () => {
  const base = eventOf('lookupevent_2610009_no_result.json', '2610009');
  const cejudo = [stored('2610009', 'Henry Cejudo', 'Javon Walton', '2026-09-26T22:00Z')];
  const run = (ev, rows = 'eventresults_empty.json', now = NOW) => provider(fakeNet({
    [lookupUrl('2610009')]: { events: [ev] }, [resultsUrl('2610009')]: rows,
  })).fetchResults({ now, matches: cejudo });

  const VOID = [{ matchId: 'tsdb:boxing:4445:2610009', status: 'void' }];
  eq(await run({ ...base, strPostponed: 'yes' }), VOID, 'strPostponed yes');
  for (const st of ['Postponed', 'Match Postponed', 'PST', 'CANC', 'Cancelled', 'Abandoned']) eq(await run({ ...base, strStatus: st }), VOID, `strStatus ${st}`);
  eq(await run({ ...base, strStatus: 'SUSP' }), [], 'suspendu : ni void ni résultat');
  eq(await run(base, { results: [
    { strPlayer: 'Henry Cejudo', strDetail: 'DRAW' }, { strPlayer: 'Javon Walton', strDetail: 'DRAW' },
  ] }), [{ matchId: 'tsdb:boxing:4445:2610009', status: 'finished', outcome: 'X', score: 'Nul' }], 'nul structuré');
  eq(await run({ ...base, strResult: 'Henry Cejudo and Javon Walton fought to a majority draw in Miami.' }),
    [{ matchId: 'tsdb:boxing:4445:2610009', status: 'finished', outcome: 'X', score: 'Nul' }], 'nul rédigé');
  eq(await run({ ...base, strResult: 'Javon Walton defeated Henry Cejudo by split decision.' }, { results: [
    { strPlayer: 'Henry Cejudo', strDetail: 'WIN' }, { strPlayer: 'Javon Walton', strDetail: 'LOSS' },
  ] }), [], 'texte et WIN/LOSS contradictoires : rien');
  eq(await run({ ...base, strResult: 'Henry Cejudo was stopped by Javon Walton in round four.' }), [], 'texte indéterminable (passif) : rien');
  eq(await run({ ...base, strResult: 'Henry Cejudo will face Javon Walton on Saturday.' }), [], 'annonce, pas un résultat : rien');
  eq(await run({ ...base, strResult: 'Javon Walton knocked out Henry Cejudo in the second round.' }),
    [{ matchId: 'tsdb:boxing:4445:2610009', status: 'finished', outcome: '2', score: 'KO/TKO' }], 'victoire extérieur rédigée');
  eq(await run({ ...base, strTimestamp: '2026-10-10T22:00:00' }),
    [{ matchId: 'tsdb:boxing:4445:2610009', status: 'scheduled', startsAt: Date.parse('2026-10-10T22:00:00Z') }], 'reprogrammé');

  const early = fakeNet({});
  eq(await provider(early).fetchResults({ now: Date.parse('2026-09-26T23:00Z'), matches: cejudo }), [], 'moins de 90 min après le début');
  eq(early.calls.length, 0, 'aucune requête trop tôt');

  let threw = false;
  try {
    await provider(fakeNet({ [lookupUrl('2610009')]: new TypeError('Failed to fetch') })).fetchResults({ now: NOW + 3 * 24 * HOUR, matches: cejudo });
  } catch { threw = true; }
  ok(threw, 'rien de joignable : erreur (le cœur réessaie), jamais de remboursement');
  threw = false;
  try {
    await provider(fakeNet({ [lookupUrl('2610009')]: new TypeError('Failed to fetch') })).fetchResults({ now: NOW + 30 * 24 * HOUR, matches: cejudo });
  } catch { threw = true; }
  ok(threw, 'même 30 jours après : une panne ne rembourse jamais');
  const noRows = await provider(fakeNet({ [lookupUrl('2610009')]: { events: [base] }, [resultsUrl('2610009')]: new TypeError('Failed to fetch') }))
    .fetchResults({ now: NOW + 30 * 24 * HOUR, matches: cejudo });
  eq(noRows, [], 'lookupevent lu mais eventresults en échec : pas de remboursement (un WIN/LOSS y est peut-être)');

  const gone = await provider(fakeNet({ [lookupUrl('2610009')]: 'lookupevent_unknown.json' })).fetchResults({ now: NOW, matches: cejudo });
  eq(gone, [], 'événement supprimé chez TheSportsDB, 10 h après : rien');

  // eventresults refusé : on règle quand même sur le texte, et on s'arrête là.
  // Les plus anciens d'abord : Canelo (20:00) passe avant Cejudo (22:00).
  const two = [...cejudo, stored('2297359', 'Canelo Alvarez', 'Terence Crawford', '2026-09-26T20:00Z')];
  const ev2 = { ...eventOf('lookupevent_2297359_canelo_crawford.json', '2297359'), strTimestamp: '2026-09-26T20:00:00' };
  const half = fakeNet({ [lookupUrl('2297359')]: { events: [ev2] }, [resultsUrl('2297359')]: new TypeError('Failed to fetch') });
  const u = await provider(half).fetchResults({ now: NOW, matches: two });
  eq(u, [{ matchId: 'tsdb:boxing:4445:2297359', status: 'finished', outcome: '2', score: 'Décision unanime' }], 'texte seul après un refus');
  eq(half.calls, [lookupUrl('2297359'), resultsUrl('2297359')], 'le combat suivant attendra (pause)');
});

test('provider : forme, rythme, test d\'accès', async () => {
  const p = provider(fakeNet({ 'https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4445': 'eventsnextleague_4445.json' }));
  eq([p.id, p.label, p.real], ['tsdb', 'TheSportsDB', true], 'identité');
  eq(p.refresh, { upcomingMs: 60 * MIN, resultsMs: 10 * MIN }, 'rythme');
  eq(await p.probe(), true, 'probe joignable');
  eq(await provider(fakeNet({})).probe(), false, 'probe en échec');
  eq(await p.fetchResults({ now: NOW, matches: [] }), [], 'rien à suivre');
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
