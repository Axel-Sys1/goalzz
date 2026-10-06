// Adaptateur ESPN des sports collectifs : football, basket, hockey, foot US et rugby.
// Voir providers/index.js pour le contrat et les formes Match / Update.
//
// Liste et résultats passent par l'endpoint « header » : une requête par ligue pour toute une plage
// de journées, cotes DraftKings conservées après le match. En cas d'échec, repli sur le tableau des
// scores jour par jour (?dates=YYYYMMDD). Les deux sont lus puis ramenés à une même forme (voir fromHeader).
//
// Pièges connus (réponses réelles dans tests/fixtures/team) :
// - l'en-tête liste l'équipe à l'extérieur EN PREMIER : toujours passer par homeAway ;
// - score '' avant le match dans l'en-tête, '0' dans le tableau (et sur les matchs reportés) ;
// - football : `winner` veut dire « qualifié », pas « vainqueur du match » → on compare les scores ;
//   après prolongation / tirs au but, le 1N2 se règle sur le score à 90 minutes (résumé du match) ;
// - hockey : score et vainqueur incluent prolongation et tirs au but (marché à 2 issues) ;
// - foot US : un nul existe (aucun vainqueur) → 'X', remboursé par le cœur faute de cote X ;
// - matchs « If Necessary » supprimés par ESPN quand inutiles, adversaires TBD (id '-1'), heures non fixées ;
// - rugby : événements fantômes restés « à venir », abréviations fausses ('STA' pour trois clubs).
import {
  defaultGetJson, settleAll, etDay, etDaysBetween, etRange, parseDate, espnPhase, hexColor, toInt, matchId, HOUR, DAY,
} from './common.js';
import {
  americanToDecimal, fractionalToDecimal, fromBookmaker, fromProbabilities, parseRecord,
  soccerProbs, soccerProbsFromRecords, twoWayProbs, rugbyProbs, neutralProbs,
} from '../odds.js';
import { sportMeta } from '../../sports.js';

// ─── Ligues suivies ──────────────────────────────────────────────────────────
// sport : clé de sports.js · league : identifiant ESPN · name : nom affiché · logo : logo de la compétition.
const soccerLogo = (n) => `https://a.espncdn.com/i/leaguelogos/soccer/500/${n}.png`;
const usLogo = (slug) => `https://a.espncdn.com/i/teamlogos/leagues/500/${slug}.png`;

export const LEAGUES = [
  { sport: 'football', league: 'fra.1', name: 'Ligue 1', logo: soccerLogo(9) },
  { sport: 'football', league: 'fra.2', name: 'Ligue 2', logo: soccerLogo(96) },
  { sport: 'football', league: 'eng.1', name: 'Premier League', logo: soccerLogo(23) },
  { sport: 'football', league: 'esp.1', name: 'LaLiga', logo: soccerLogo(15) },
  { sport: 'football', league: 'ita.1', name: 'Serie A', logo: soccerLogo(12) },
  { sport: 'football', league: 'ger.1', name: 'Bundesliga', logo: soccerLogo(10) },
  { sport: 'football', league: 'uefa.champions', name: 'Ligue des champions', logo: soccerLogo(2) },
  { sport: 'football', league: 'uefa.europa', name: 'Ligue Europa', logo: soccerLogo(2310) },
  { sport: 'football', league: 'uefa.europa.conf', name: 'Ligue Conférence', logo: soccerLogo(20296) },
  { sport: 'football', league: 'uefa.nations', name: 'Ligue des nations', logo: soccerLogo(2395) },
  { sport: 'football', league: 'fifa.friendly', name: 'Matchs amicaux', logo: soccerLogo(53) },
  { sport: 'football', league: 'fra.coupe_de_france', name: 'Coupe de France', logo: soccerLogo(182) },
  { sport: 'football', league: 'usa.1', name: 'MLS', logo: soccerLogo(19) },
  { sport: 'football', league: 'por.1', name: 'Liga Portugal', logo: soccerLogo(14) },
  { sport: 'football', league: 'ned.1', name: 'Eredivisie', logo: soccerLogo(11) },
  { sport: 'basketball', league: 'nba', name: 'NBA', logo: usLogo('nba') },
  { sport: 'basketball', league: 'wnba', name: 'WNBA', logo: usLogo('wnba') },
  { sport: 'hockey', league: 'nhl', name: 'NHL', logo: usLogo('nhl') },
  { sport: 'americanfootball', league: 'nfl', name: 'NFL', logo: usLogo('nfl') },
  // Rugby : identifiants numériques ESPN, pas de logo de compétition fiable.
  { sport: 'rugby', league: '270559', name: 'Top 14' },
  { sport: 'rugby', league: '271937', name: 'Champions Cup' },
  { sport: 'rugby', league: '180659', name: 'Six Nations' },
  { sport: 'rugby', league: '267979', name: 'Premiership' },
  { sport: 'rugby', league: '289234', name: 'Tests internationaux' },
];

// Sigles usuels du Top 14 : ESPN met 'STA' pour trois clubs, 'USA' pour Perpignan, 'SEC' pour Pau…
const RUGBY_SHORT = {
  'Stade Toulousain': 'ST', 'Stade Francais Paris': 'SFP', 'La Rochelle': 'SR', Toulon: 'RCT',
  'Bordeaux Begles': 'UBB', 'Clermont Auvergne': 'ASM', 'Montpellier Herault': 'MHR', 'Castres Olympique': 'CO',
  'Racing 92': 'R92', Pau: 'SP', Perpignan: 'USAP', Bayonne: 'AB', Vannes: 'RCV', Lyon: 'LOU', 'LOU Rugby': 'LOU',
  'South Africa': 'RSA', 'New Zealand': 'NZ', // ESPN : 'SOU', 'NEW'
};

const KEY = 'team';
const LOOKBACK = 36 * HOUR;   // matchs terminés récemment gardés ; délai avant de rembourser un match fantôme
const STALE_PRE = 3 * HOUR;   // encore « à venir » 3 h après l'heure prévue : périmé, plus listé
const FULL_MATCH_MIN = 85;    // football « terminé » avant la 85e minute = arrêté puis donné sur tapis vert
const ESPN_SPORT = { football: 'soccer', americanfootball: 'football' };
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HEADER = 'https://site.api.espn.com/apis/personalized/v2/scoreboard/header';

const espnSport = (sport) => ESPN_SPORT[sport] || sport;
const headerUrl = (cfg, range) => `${HEADER}?sport=${espnSport(cfg.sport)}&league=${cfg.league}&dates=${range}&limit=500`;
const dayUrl = (cfg, day) => `${SITE}/${espnSport(cfg.sport)}/${cfg.league}/scoreboard?dates=${day}&limit=1000`;
const summaryUrl = (league, id) => `${SITE}/soccer/${league}/summary?event=${id}`;

// ─── Lecture des réponses ESPN ───────────────────────────────────────────────
// Forme commune d'un événement :
// { id, date, timeValid, season, seasonType, neutral, week, notes: [texte], stage,
//   st: { name, state, completed, detail, period, clock }, home: Side, away: Side, prices: { home, away, draw } }
// Side : { id, name, abbr, color, altColor, logo, national, score, winner, record, stats, form, shootout }
const sideOf = (list, homeAway) => (list || []).find((c) => c?.homeAway === homeAway);

function fromHeader(h) {
  const side = (c) => c && {
    id: String(c.id ?? ''), name: c.displayName || c.name || '', abbr: c.abbreviation, color: c.color,
    altColor: c.alternateColor, logo: c.logo, national: c.isNational, score: c.score, winner: c.winner,
    record: c.record, stats: c.recordStats, form: c.form, shootout: c.shootoutScore,
  };
  const full = h.fullStatus || {};
  const type = full.type || {};
  return {
    id: String(h.id), date: parseDate(h.date), timeValid: h.timeValid !== false,
    season: toInt(h.season), seasonType: toInt(h.seasonType), neutral: !!h.neutralSite, week: toInt(h.week),
    notes: [h.note, ...(h.notes || []).map((n) => n?.headline)].filter(Boolean),
    stage: [h.group?.name, h.altGameNote].filter(Boolean).join(' / '),
    st: {
      name: type.name, state: type.state || h.status, completed: type.completed === true,
      detail: type.detail || h.summary, period: full.period ?? h.period, clock: full.displayClock ?? h.clock,
    },
    home: side(sideOf(h.competitors, 'home')), away: side(sideOf(h.competitors, 'away')),
    prices: pricesOf(h.odds),
  };
}

function fromBoard(e) {
  const c = e.competitions?.[0] || {};
  const status = e.status || c.status || {};
  const type = status.type || {};
  const side = (k) => k && {
    id: String(k.team?.id ?? k.id ?? ''), name: k.team?.displayName || k.team?.name || '', abbr: k.team?.abbreviation,
    color: k.team?.color, altColor: k.team?.alternateColor, logo: k.team?.logo, national: k.team?.isNational,
    score: k.score, winner: k.winner, record: recordSummary(k.records), stats: null, form: k.form, shootout: k.shootoutScore,
  };
  return {
    id: String(e.id), date: parseDate(e.date || c.date), timeValid: c.timeValid !== false,
    season: toInt(e.season?.year), seasonType: toInt(e.season?.type), neutral: !!c.neutralSite, week: toInt(e.week?.number),
    notes: (c.notes || []).map((n) => n?.headline).filter(Boolean),
    stage: [e.season?.slug, c.altGameNote].filter(Boolean).join(' / '),
    st: {
      name: type.name, state: type.state, completed: type.completed === true,
      detail: type.detail, period: status.period, clock: status.displayClock,
    },
    home: side(sideOf(c.competitors, 'home')), away: side(sideOf(c.competitors, 'away')),
    prices: (c.odds || []).map(pricesOf).find((p) => p?.home && p?.away) || null,
  };
}

const recordSummary = (records) =>
  (records || []).find((r) => r?.type === 'total' || r?.type === 'ytd')?.summary ?? records?.[0]?.summary;

// Cotes décimales { home, away, draw } d'une entrée odds ESPN, liens et mentions du bookmaker ignorés.
// En-tête : odds.home.moneyLine (nombre américain) · tableau : moneyline.home.close.odds ('+120', 'OFF')
// · Bet 365 : homeTeamOdds.value (déjà décimal) ou .summary (fractionnaire).
function pricesOf(o) {
  if (!o) return null;
  const price = (side, legacy) => {
    const ml = o.moneyline?.[side];
    const line = ml ? (ml.close ? ml.close.odds : ml.open?.odds) : undefined;
    return americanToDecimal(o[side]?.moneyLine) ?? americanToDecimal(line)
      ?? americanToDecimal(o[legacy]?.moneyLine) ?? decimalOf(o[legacy]);
  };
  return { home: price('home', 'homeTeamOdds'), away: price('away', 'awayTeamOdds'), draw: price('draw', 'drawOdds') };
}

const decimalOf = (x) => (x?.value > 1 ? x.value : fractionalToDecimal(x?.summary));

// ─── Cotes ───────────────────────────────────────────────────────────────────
// Bookmaker si le marché du sport est complet et cohérent, sinon modèle maison (odds.js).
function oddsFor(sport, ev) {
  const book = bookOdds(ev.prices, sportMeta(sport).hasDraw);
  return book
    ? { odds: book, oddsSource: 'bookmaker' }
    : { odds: fromProbabilities(modelProbs(sport, ev)), oddsSource: 'model' };
}

function bookOdds(p, hasDraw) {
  if (!p) return null;
  const d = hasDraw ? { 1: p.home, X: p.draw, 2: p.away } : { 1: p.home, 2: p.away };
  const prices = Object.values(d);
  if (prices.some((v) => !(v > 1))) return null;
  const overround = prices.reduce((s, v) => s + 1 / v, 0);
  return overround > 0.98 && overround < 1.35 ? fromBookmaker(d) : null;
}

function modelProbs(sport, { home, away, neutral }) {
  if (sport === 'football') {
    const h = goalRecord(home.stats);
    const a = goalRecord(away.stats);
    if (h && a) return soccerProbs({ home: h, away: a, neutral });
    const rh = parseRecord(recordText(home.record), 'wdl');
    const ra = parseRecord(recordText(away.record), 'wdl');
    return rh || ra ? soccerProbsFromRecords({ home: rh, away: ra, neutral }) : neutralProbs(true);
  }
  if (sport === 'rugby') {
    const form = (s) => ({ record: formRecord(s.form || s.record) });
    return rugbyProbs({ home: form(home), away: form(away), neutral });
  }
  return twoWayProbs({ home: { record: winLoss(sport, home.record) }, away: { record: winLoss(sport, away.record) }, sport, neutral });
}

// Football (en-tête) : différence de buts et matchs joués de la saison en cours.
function goalRecord(stats) {
  const v = (k) => (Number.isFinite(stats?.[k]?.value) ? stats[k].value : null);
  const gp = v('gamesPlayed');
  if (gp === null) return null;
  const [pf, pa] = [v('pointsFor'), v('pointsAgainst')];
  const gd = pf !== null && pa !== null ? pf - pa : v('pointDifferential') ?? 0;
  return { gd, gp };
}

// '8-8-10, 32 pts' → '8-8-10' ; '2-0-1, 5 PTS' → '2-0-1'.
const recordText = (s) => String(s ?? '').split(',')[0].trim();

// NHL 'V-D-DP' : une défaite en prolongation reste une défaite. NFL 'V-D-N' : le nul compte pour moitié.
function winLoss(sport, s) {
  const r = parseRecord(recordText(s));
  if (!r) return null;
  return sport === 'hockey' ? { w: r.w, l: r.l + r.d, d: 0 } : r;
}

// Rugby : ESPN ne donne que la forme ('WLWWL', T = nul), plus récent en premier.
function formRecord(form) {
  const f = String(form ?? '').toUpperCase();
  if (!/^[WLDT]{1,10}$/.test(f)) return null;
  const n = (ch) => f.split('').filter((x) => x === ch).length;
  return { w: n('W'), l: n('L'), d: n('D') + n('T') };
}

// ─── Équipes ─────────────────────────────────────────────────────────────────
function teamsOf(sport, ev) {
  const home = teamOf(sport, ev.home);
  const away = teamOf(sport, ev.away);
  if (home.short === away.short) {
    home.short = nameShort(ev.home.name);
    away.short = nameShort(ev.away.name);
  }
  return { home, away };
}

function teamOf(sport, s) {
  const t = { name: s.name, short: shortOf(sport, s) };
  const color = hexColor(s.color) || hexColor(s.altColor);
  if (color) t.color = color;
  // Logo de pays sur un club (Perpignan affiché avec le drapeau américain) : ignoré.
  if (s.logo && !(s.national === false && s.logo.includes('/countries/'))) t.logo = s.logo;
  const record = recordText(s.record);
  if (sport !== 'rugby' && /^\d+(-\d+){1,2}$/.test(record)) t.record = record;
  return t;
}

function shortOf(sport, s) {
  if (sport === 'rugby' && RUGBY_SHORT[s.name]) return RUGBY_SHORT[s.name];
  const a = String(s.abbr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return a.length >= 2 ? a.slice(0, 4) : nameShort(s.name);
}

const FILLER = new Set(['FC', 'AFC', 'CF', 'SC', 'AC', 'AS', 'CD', 'RC', 'US', 'LA', 'LE', 'LES', 'DE', 'DU', 'THE', 'CLUB', 'RUGBY', 'STADE']);

function nameShort(name) {
  const words = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const main = words.filter((w) => !FILLER.has(w));
  return ((main.length ? main : words)[0] || '???').slice(0, 3);
}

// ─── Tour / phase ────────────────────────────────────────────────────────────
// Seulement ce qu'on sait traduire : le reste (notes ESPN en anglais) est ignoré.
const ROUNDS = [
  [/first round|round[- ]one\b/i, '1er tour'],
  [/second round|round[- ]two\b/i, '2e tour'],
  [/conference finals?/i, 'Finale de conférence'],
  [/quarter-?finals?/i, 'Quart de finale'],
  [/semi-?finals?/i, 'Demi-finale'],
  [/round[- ]of[- ]16/i, '8e de finale'],
  [/round[- ]of[- ]32/i, '16e de finale'],
  [/\bfinals?\b/i, 'Finale'],
  [/knockout[- ]round[- ]playoffs/i, 'Barrages'],
  [/league[- ]phase/i, 'Phase de ligue'],
  [/qualifying/i, 'Tour préliminaire'],
  [/\bgroup ([a-z]\d?)\b/i, (m) => `Groupe ${m[1].toUpperCase()}`],
  [/nba cup/i, 'NBA Cup'],
];

function translateRound(text) {
  for (const [re, fr] of ROUNDS) {
    const m = re.exec(text);
    if (m) return typeof fr === 'function' ? fr(m) : fr;
  }
  return null;
}

function roundOf(sport, ev) {
  const us = sport === 'basketball' || sport === 'hockey' || sport === 'americanfootball';
  const texts = sport === 'football' ? [...ev.notes, ev.stage] : ev.notes;
  let phase = texts.map(translateRound).find(Boolean) || null;
  if (us && ev.seasonType === 1) phase = 'Présaison';
  if (!phase && sport === 'americanfootball' && ev.seasonType === 2 && ev.week) phase = `Semaine ${ev.week}`;
  const game = ev.notes.map((t) => /\bgame (\d+)/i.exec(t)?.[1]).find(Boolean);
  const leg = ev.notes.map((t) => (/\b1st leg/i.test(t) ? 'aller' : /\b2nd leg/i.test(t) ? 'retour' : null)).find(Boolean);
  const detail = game ? `match ${game}` : leg;
  if (phase && detail) return `${phase} · ${detail}`;
  return phase || (detail ? detail[0].toUpperCase() + detail.slice(1) : undefined);
}

// ─── Statut, score, horloge ──────────────────────────────────────────────────
// 'scheduled' | 'live' | 'final' | 'void'
function phaseOf(sport, st) {
  if (st.name === 'STATUS_SUSPENDED') return 'live'; // interrompu, reprendra : on attend
  const phase = espnPhase(st);
  if (phase === 'final' && sport === 'football' && stoppedEarly(st)) return 'void';
  return phase;
}

// Ex. Bastia–Red Star (Ligue 2, 2025) : « FT » à la 58e, 0-0, victoire attribuée à Red Star.
// Horloge à 0' ou absente = inconnue : match peu suivi par ESPN (Maroc–Burundi 5-0, amical 2026, « FT » à 0').
const extraTimeOf = (st) => /_(AET|PEN)$/.exec(st.name || '')?.[1] || null;
const stoppedEarly = (st) => {
  const clock = toInt(st.clock);
  return !extraTimeOf(st) && clock > 0 && clock < FULL_MATCH_MIN;
};

const compare = (h, a) => (h > a ? '1' : h < a ? '2' : 'X');
const liveScore = (ev) => `${toInt(ev.home.score) ?? 0} - ${toInt(ev.away.score) ?? 0}`;

// Texte court de l'horloge : "67'", 'MT', 'Q3 5:12', 'P2 12:00', 'Fin Q3', 'Prol. 3:10', 'TAB'.
function clockText(sport, st) {
  const name = st.name || '';
  const p = toInt(st.period) || 0;
  const c = st.clock ? String(st.clock) : '';
  if (/HALFTIME/.test(name)) return 'MT';
  if (/SUSPENDED|DELAY/.test(name)) return 'Interrompu';
  if (/SHOOTOUT/.test(name)) return 'TAB';
  if (sport === 'football') return c || null;
  if (sport === 'rugby') return p === 1 ? '1re MT' : p === 2 ? '2e MT' : null; // horloge ESPN figée à 1'
  const regular = sport === 'hockey' ? 3 : 4;
  const part = p > regular ? 'Prol.' : `${sport === 'hockey' ? 'P' : 'Q'}${p}`;
  if (/END_PERIOD|END_OF_PERIOD/.test(name)) return `Fin ${part}`;
  return c ? `${part} ${c}` : part;
}

// Prolongation / tirs au but des sports US (scores déjà inclus).
function extraSuffix(sport, st) {
  const d = String(st.detail || '');
  if (/\bSO\b/.test(d)) return ' (t.a.b.)';
  if (/\d?OT\b/.test(d) || (toInt(st.period) ?? 0) > (sport === 'hockey' ? 3 : 4)) return ' (prol.)';
  return '';
}

// ─── Score à 90 minutes (football, prolongation / tirs au but) ───────────────
// Résumé ESPN → { outcome: '1'|'X'|'2'|null, shootout: [dom, ext] } ; null si la réponse est illisible.
// outcome null : résumé lu, mais score à 90 minutes introuvable. `final` : score final [dom, ext] de l'en-tête.
// Deux sources recoupées (buts par période, buts un par un), puis la règle « prolongation hors match retour
// = égalité à la 90e ». Ex. finale LdC 2026 PSG–Arsenal (1-1, t.a.b.) : périodes '0','2','-1','0' et
// '1','1','-1','0' (mi-temps 2-2, faux) mais buts à la 6e et à la 65e (1-1, juste).
function ninetyOf(d, ev, final) {
  const comp = d?.header?.competitions?.[0];
  if (!comp) return null;
  const sides = [sideOf(comp.competitors, 'home'), sideOf(comp.competitors, 'away')];
  const shootout = sides.map((c) => toInt(c?.shootoutScore));
  const same = String(d.header.id ?? comp.id) === ev.id && comp.status?.type?.completed === true
    && sides.every((c, i) => c && toInt(c.score) === final[i]);
  if (!same) return { outcome: null, shootout };
  const found = [byPeriods(sides, final), byGoals(d.keyEvents, sides, final)]
    .filter(Boolean).map(([h, a]) => compare(h, a));
  const agreed = found.length > 0 && found.every((o) => o === found[0]);
  return { outcome: agreed ? found[0] : secondLeg(comp, ev) ? null : 'X', shootout };
}

// Buts par période : mi-temps 1 et 2, prolongations 3 et 4 (0 sans prolongation), la 5e = tirs au but.
// Retenu seulement sans valeur négative et si les 4 périodes redonnent le score final.
function byPeriods(sides, final) {
  const ninety = sides.map((c, i) => {
    const p = [0, 1, 2, 3].map((k) => toInt(c.linescores?.[k]?.displayValue ?? c.linescores?.[k]?.value));
    const valid = p.every((x) => x !== null && x >= 0) && p[0] + p[1] + p[2] + p[3] === final[i];
    return valid ? p[0] + p[1] : null;
  });
  return ninety.includes(null) ? null : ninety;
}

// Buts un par un (keyEvents ; contre son camp : compté pour l'équipe qui en profite), tirs au but exclus.
// Retenu seulement si les buts des périodes 1 à 4 redonnent le score final.
function byGoals(keyEvents, sides, final) {
  const ids = sides.map((c) => String(c.id ?? c.team?.id));
  const total = [0, 0];
  const ninety = [0, 0];
  for (const k of keyEvents || []) {
    const period = toInt(k?.period?.number);
    if (!k?.scoringPlay || k.shootout || period >= 5) continue;
    const i = ids.indexOf(String(k.team?.id));
    if (i < 0 || !(period >= 1)) return null;
    total[i] += 1;
    if (period <= 2) ninety[i] += 1;
  }
  return total[0] === final[0] && total[1] === final[1] ? ninety : null;
}

// Match retour d'un aller-retour : la prolongation y dépend du score cumulé, pas d'une égalité à la 90e.
const LEG2 = /\b2nd leg\b|aggregate/i;
function secondLeg(comp, ev) {
  const notes = [...(comp.notes || []).map((n) => n?.headline || n?.text), ...ev.notes];
  return toInt(comp.leg?.value) > 1 || (comp.series || []).some((s) => toInt(s?.leg) > 1)
    || (comp.competitors || []).some((c) => c?.aggregateScore != null) || notes.some((t) => LEG2.test(t || ''));
}

export function createTeamSportsAdapter({ getJson = defaultGetJson, leagues = LEAGUES } = {}) {
  const leagueOf = (sport, league) =>
    leagues.find((l) => l.sport === sport && l.league === league) || LEAGUES.find((l) => l.sport === sport && l.league === league)
    || { sport, league, name: league };

  async function loadHeader(cfg, range) {
    const d = await getJson(headerUrl(cfg, range));
    const league = d?.sports?.[0]?.leagues?.[0];
    if (!league) throw new Error(`[espn] en-tête illisible pour ${cfg.league}`);
    return (league.events || []).map(fromHeader);
  }

  // Tableau des scores jour par jour → { events, days: journées effectivement lues }. Lève si tout a échoué.
  async function loadDays(cfg, days) {
    const tasks = days.map((day) => async () => {
      const d = await getJson(dayUrl(cfg, day));
      if (!Array.isArray(d?.events)) throw new Error(`[espn] tableau illisible pour ${cfg.league} ${day}`);
      return { day, events: d.events.map(fromBoard) };
    });
    const { ok, failed } = await settleAll(tasks, 4);
    if (!ok.length && failed.length) throw failed[0];
    return { events: ok.flatMap((r) => r.events), days: new Set(ok.map((r) => r.day)) };
  }

  // Football après prolongation / tirs au but : 1N2 à 90 minutes lu dans le résumé du match (voir ninetyOf).
  // → { outcome, shootout } | null (résumé injoignable). Résumé lourd (~450 Ko) : gardé en mémoire une fois
  // le 1N2 trouvé ; s'il est introuvable (données ESPN incohérentes), relu au plus une fois par heure.
  const ninetyCache = new Map();
  async function ninetyMinutes(league, ev, final, now) {
    const key = `${ev.id}|${final}`;
    const hit = ninetyCache.get(key);
    if (hit && (hit.n.outcome || now - hit.at < HOUR)) return hit.n;
    let d;
    try {
      d = await getJson(summaryUrl(league, ev.id));
    } catch {
      return null;
    }
    const n = ninetyOf(d, ev, final);
    if (n) ninetyCache.set(key, { n, at: now });
    return n;
  }

  // Résultat d'un match terminé → { status: 'finished', outcome, score } | { status: 'void' } | null (pas encore réglable).
  async function finalState(cfg, ev, now) {
    const h = toInt(ev.home.score);
    const a = toInt(ev.away.score);
    if (h === null || a === null) return null;
    if (cfg.sport === 'rugby') return { status: 'finished', outcome: compare(h, a), score: `${h} - ${a}` };
    if (cfg.sport !== 'football') {
      const w = ev.home.winner === true && ev.away.winner !== true ? '1'
        : ev.away.winner === true && ev.home.winner !== true ? '2' : null;
      return { status: 'finished', outcome: w || compare(h, a), score: `${h} - ${a}${extraSuffix(cfg.sport, ev.st)}` };
    }
    const extra = extraTimeOf(ev.st);
    if (!extra) return { status: 'finished', outcome: compare(h, a), score: `${h} - ${a}` };
    // Prolongation / tirs au but : le 1N2 porte sur les 90 minutes ; le score affiché reste le score final.
    const n = await ninetyMinutes(cfg.league, ev, [h, a], now);
    if (!n) return null; // résumé injoignable : on réessaiera, jamais de remboursement sur erreur réseau
    // Score à 90 minutes introuvable : remboursé 36 h après le coup d'envoi plutôt que des paris bloqués pour toujours.
    if (!n.outcome) return now - ev.date > LOOKBACK ? { status: 'void' } : null;
    const hs = toInt(ev.home.shootout) ?? n.shootout[0];
    const as = toInt(ev.away.shootout) ?? n.shootout[1];
    const tag = extra === 'AET' ? 'a.p.' : hs !== null && as !== null ? `t.a.b. ${hs}-${as}` : 't.a.b.';
    return { status: 'finished', outcome: n.outcome, score: `${h} - ${a} (${tag})` };
  }

  async function stateOf(cfg, ev, now) {
    switch (phaseOf(cfg.sport, ev.st)) {
      case 'live': return { status: 'live', liveScore: liveScore(ev), clock: clockText(cfg.sport, ev.st) };
      case 'void': return { status: 'void' };
      case 'final': return finalState(cfg, ev, now);
      default: return { status: 'scheduled' };
    }
  }

  async function toMatch(cfg, ev, now) {
    const state = await stateOf(cfg, ev, now);
    if (!state) return null;
    const round = roundOf(cfg.sport, ev);
    return {
      id: matchId(cfg.sport, cfg.league, ev.id),
      source: 'espn',
      real: true,
      sport: cfg.sport,
      competition: cfg.name,
      ...(cfg.logo && { competitionLogo: cfg.logo }),
      ...(round && { round }),
      ...teamsOf(cfg.sport, ev),
      startsAt: ev.date,
      ...oddsFor(cfg.sport, ev),
      outcome: state.status === 'void' ? 'void' : null,
      score: null,
      ...state,
      meta: { adapter: KEY, league: cfg.league, eventId: ev.id, day: etDay(ev.date) },
    };
  }

  async function listLeague(cfg, now, days) {
    const from = now - LOOKBACK;
    const to = now + days * DAY;
    let events;
    try {
      events = await loadHeader(cfg, etRange(from, to));
    } catch (err) {
      console.warn(`[espn] en-tête indisponible pour ${cfg.league}, repli jour par jour`, err);
      events = (await loadDays(cfg, etDaysBetween(from, to))).events;
    }
    const out = [];
    for (const ev of cleanList(events, now)) {
      if (ev.date < from || ev.date > to) continue;
      const m = await toMatch(cfg, ev, now);
      if (m) out.push(m);
    }
    return out;
  }

  async function settleLeague(ms, now) {
    const cfg = leagueOf(ms[0].sport, ms[0].meta.league);
    const idOf = (m) => String(m.meta.eventId);
    const days = [...new Set(ms.map((m) => etDay(m.startsAt)))].sort();
    const byId = new Map();
    const checked = new Set(); // journées lues dans le tableau du jour : l'absence d'un match y est confirmée
    const add = (r) => {
      r.events.forEach((ev) => byId.set(ev.id, ev));
      r.days.forEach((d) => checked.add(d));
    };
    // Une requête d'en-tête par groupe de journées proches (repli jour par jour si elle échoue).
    const runs = dayRuns(days);
    const { failed } = await settleAll(runs.map((run) => async () => {
      try {
        add({ events: await loadHeader(cfg, `${run[0]}-${run[run.length - 1]}`), days: [] });
      } catch {
        add(await loadDays(cfg, run));
      }
    }), 2);
    if (failed.length === runs.length) throw failed[0];
    // Absent de l'en-tête 36 h après le début (match « If Necessary » supprimé…) : confirmé par le tableau du jour.
    const lost = ms.filter((m) => !byId.has(idOf(m)) && now - m.startsAt > LOOKBACK).map((m) => etDay(m.startsAt));
    const toCheck = [...new Set(lost)].filter((d) => !checked.has(d));
    if (toCheck.length) {
      try { add(await loadDays(cfg, toCheck)); } catch { /* on réessaiera au prochain passage */ }
    }

    const out = [];
    for (const m of ms) {
      const u = await updateOf(cfg, m, followTwin(byId.get(idOf(m)), byId, now), now, checked);
      if (u) out.push({ matchId: m.id, ...u });
    }
    return out;
  }

  async function updateOf(cfg, m, ev, now, checked) {
    if (!ev) return now - m.startsAt > LOOKBACK && checked.has(etDay(m.startsAt)) ? { status: 'void' } : null;
    const state = await stateOf(cfg, ev, now);
    if (!state || state.status !== 'scheduled') return state;
    const start = ev.timeValid && Number.isFinite(ev.date) ? ev.date : m.startsAt;
    if (now - start > LOOKBACK) return { status: 'void' }; // jamais commencé 36 h après l'heure prévue
    return start !== m.startsAt ? { status: 'scheduled', startsAt: start } : { status: 'scheduled' };
  }

  return {
    key: KEY,
    // Journée sans match (NBA, 1er août) : réponse de ~400 octets, même endpoint que la liste.
    probeUrl: `${HEADER}?sport=basketball&league=nba&dates=20260801-20260801&limit=1`,

    async upcoming({ now, days = 7 }) {
      const tasks = leagues.map((cfg) => () => listLeague(cfg, now, days));
      const { ok, failed } = await settleAll(tasks, 6);
      failed.forEach((err) => console.warn('[espn] ligue indisponible', err));
      if (!ok.length && failed.length) throw failed[0];
      return ok.flat();
    },

    async results({ now, matches }) {
      const groups = new Map();
      for (const m of matches) {
        if (!m.meta?.league || !m.meta?.eventId) continue;
        const k = `${m.sport}|${m.meta.league}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(m);
      }
      const tasks = [...groups.values()].map((ms) => () => settleLeague(ms, now));
      const { ok, failed } = await settleAll(tasks, 4);
      failed.forEach((err) => console.warn('[espn] résultats indisponibles', err));
      if (!ok.length && failed.length) throw failed[0];
      return ok.flat();
    },
  };
}

// Retire l'inexploitable : participant inconnu (TBD, id '-1'), heure non fixée, doublons, et fantômes
// (encore « à venir » bien après l'heure prévue, ou équipes sans logo d'une autre saison que la ligue).
// Statut STATUS_TBD = heure non fixée : ex. fantôme 603959 du Top 14 (9 mai 2026, même saison),
// « Bordeaux–Bayonne » à l'envers 50 min après le vrai Bayonne–Bordeaux Bègles.
function cleanList(events, now) {
  const main = mainSeason(events);
  const kept = new Map();
  for (const ev of events) {
    if (!ev.home || !ev.away || isPlaceholder(ev.home) || isPlaceholder(ev.away)) continue;
    if (!ev.timeValid || ev.st.name === 'STATUS_TBD' || !Number.isFinite(ev.date)) continue;
    if (ev.st.state === 'pre' && ev.date < now - STALE_PRE) continue;
    if ((!ev.home.logo || !ev.away.logo) && main && ev.season && ev.season !== main) continue;
    // Même affiche à la même heure sous deux ids : on garde celui qui a avancé, sinon le plus ancien id.
    const key = `${ev.home.id}|${ev.away.id}|${ev.date}`;
    const prev = kept.get(key);
    const better = !prev
      || (prev.st.state === 'pre' && ev.st.state !== 'pre')
      || ((prev.st.state === 'pre') === (ev.st.state === 'pre') && Number(ev.id) < Number(prev.id));
    if (better) kept.set(key, ev);
  }
  return [...kept.values()];
}

// Doublon ESPN (rugby : même affiche, même heure, deux ids) : si le nôtre est resté « à venir » bien après
// le coup d'envoi alors que son jumeau a commencé ou est terminé, on suit le jumeau.
function followTwin(ev, byId, now) {
  if (!ev || ev.st.state !== 'pre' || !(now - ev.date > STALE_PRE)) return ev;
  const same = (x) => x.id !== ev.id && x.date === ev.date && x.home?.id === ev.home?.id && x.away?.id === ev.away?.id;
  return [...byId.values()].find((x) => same(x) && x.st.state !== 'pre') || ev;
}

const isPlaceholder = (s) =>!s.name || s.id.startsWith('-') || /^(TBD|TBA)$/i.test(s.name.trim());

// Journées ESPN triées → groupes de journées proches (3 jours d'écart au plus). Un match resté en suspens
// ne fait pas lire toute une saison (LdC du 30/05 au 21/10 : 682 Ko, contre ~12 Ko pour une journée).
const dayMs = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
function dayRuns(days) {
  const runs = [];
  for (const d of days) {
    const run = runs[runs.length - 1];
    if (run && dayMs(d) - dayMs(run[run.length - 1]) <= 3 * DAY) run.push(d);
    else runs.push([d]);
  }
  return runs;
}

// Saison la plus fréquente parmi les événements aux équipes identifiées (avec logos).
function mainSeason(events) {
  const count = new Map();
  for (const ev of events) {
    if (ev.season && ev.home?.logo && ev.away?.logo) count.set(ev.season, (count.get(ev.season) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
