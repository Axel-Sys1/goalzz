// Adaptateur ESPN pour le tennis (circuits ATP et WTA), réuni aux autres dans espn/index.js.
//
// Particularités d'ESPN pour le tennis (vérifiées sur l'API le 27/09/2026) :
// - Un "event" est un TOURNOI. Les matchs sont dans events[].groupings[].competitions[],
//   un grouping par tableau (mens-singles, womens-singles, doubles…). On ne garde que les simples.
// - Un jour (?dates=YYYYMMDD) renvoie chaque tournoi dont la fenêtre [date, endDate] couvre ce jour,
//   avec TOUT son tableau : deux jours d'un même tournoi renvoient le même flux.
// - Une plage (?dates=A-B) n'est PAS fiable : elle omet des tournois en cours ou qui commencent, et
//   revient parfois vide (27/09 : ATP 25→29 vide, WTA 27→29 sans Jingshan ni Adana, en cours).
//   La liste lit donc le jour courant et le lendemain (les joueurs ne sont connus qu'environ 24 h
//   à l'avance ; au-delà, les tableaux ne contiennent que des TBD).
// - ESPN retouche la fenêtre des tournois dans la journée (Japan Open : début déplacé du 30 au 27/09) :
//   un tournoi absent d'un flux ne prouve rien. Un match n'est remboursé pour disparition que si son
//   tournoi est bien dans le flux, sans lui.
// - Les tournois mixtes (Grands Chelems, Pékin…) sont dans les deux flux avec les mêmes ids de match :
//   le circuit se déduit du tableau (womens-singles → wta), jamais du flux qui l'a renvoyé.
// - Le statut du tournoi n'est pas fiable ("Final" alors que des matchs restent à jouer) :
//   seul le statut du match compte.
// - Joueurs pas encore connus : 'TBD' (ids '-3' / '-4'). Horaire pas encore fixé : timeValid false.
// - Aucune cote chez ESPN : cotes maison tirées des points au classement ATP / WTA (top 150).
// - Pas de champ score : le vainqueur est competitors[].winner, le score se lit set par set (linescores).
// - Règles maison : abandon en cours de match → réglé sur le vainqueur officiel ;
//   forfait avant le match (walkover) → remboursé.
import { defaultGetJson, settleAll, etDay, parseDate, espnPhase, toInt, matchId, HOUR, DAY } from './common.js';
import { fromProbabilities, tennisProbs } from '../odds.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const SPORT = 'tennis';
const TOURS = ['atp', 'wta'];
const TOUR_LABEL = { atp: 'ATP', wta: 'WTA' };
const SINGLES = { 'mens-singles': 'atp', 'womens-singles': 'wta' };

const LOOKBACK = 36 * HOUR;      // matchs terminés encore renvoyés par la liste
const STALE_AFTER = 36 * HOUR;   // match jamais joué (ou retiré du tableau) après ce délai → remboursé
const RANKINGS_TTL = 6 * HOUR;
// Un flux (jusqu'à 1,2 Mo) sert à la liste et aux résultats, que le cœur demande ensemble.
// Doit rester sous l'écart des deux lectures qui confirment un résultat (20 s dans
// services/matches.js et tools/snapshot.js) : chaque lecture doit être une vraie requête.
const FEED_TTL = 15_000;

// Jour hors saison, dans le passé : réponse minuscule (aucun tournoi), idéale pour tester l'accès.
const PROBE_URL = `${BASE}/atp/scoreboard?dates=20251215`;

// Avancement d'un statut : quand un match arrive par deux flux, on garde la version la plus récente.
const PROGRESS = { scheduled: 0, live: 1, finished: 2, void: 2 };

export const scoreboardUrl = (tour, dates) => `${BASE}/${tour}/scoreboard?dates=${dates}`;
export const rankingsUrl = (tour) => `${BASE}/${tour}/rankings`;
const otherTour = (tour) => (tour === 'atp' ? 'wta' : 'atp');

// Lendemain d'un jour 'YYYYMMDD' (calendrier, sans fuseau ni changement d'heure).
export function nextDay(day) {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + 1);
  return new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
}

// ─── Lecture du flux ─────────────────────────────────────────────────────────
// Simples d'une réponse scoreboard : [{ league, tournament: { id, name }, c, lastRound }], c = le match ESPN.
export function singlesOf(data) {
  const out = [];
  for (const ev of data?.events || []) {
    const tournament = { id: String(ev.id ?? ''), name: ev.name };
    for (const g of ev.groupings || []) {
      const league = SINGLES[g.grouping?.slug];
      if (!league) continue;
      const comps = g.competitions || [];
      const lastRound = lastMainRound(comps);
      for (const c of comps) if (c?.id) out.push({ league, tournament, c, lastRound });
    }
  }
  return out;
}

const leagueLogo = (data) => data?.leagues?.[0]?.logos?.[0]?.href || null;

// Réponse scoreboard → flux compact { logo, singles, byId (id match → match ESPN), tournaments (ids) }.
// Lève une erreur si la réponse n'a pas la forme d'un scoreboard (corps vide, page d'erreur…).
export function readFeed(data) {
  if (!Array.isArray(data?.events)) throw new Error('ESPN tennis : réponse illisible');
  const singles = singlesOf(data);
  return {
    logo: leagueLogo(data),
    singles,
    byId: new Map(singles.map((e) => [String(e.c.id), e.c])),
    tournaments: new Set(singles.map((e) => e.tournament.id).filter(Boolean)),
  };
}

// ─── Tours et tournois ───────────────────────────────────────────────────────
const ROUND_NUM = /^round (\d+)$/i;

// Numéro du tour qui précède les quarts (les 8es de finale), quelle que soit la taille du tableau :
// 'Round 2' pour un tableau de 32, 'Round 4' pour un Grand Chelem. null si le tableau n'a pas de quarts.
function lastMainRound(comps) {
  const names = comps.map((c) => c?.round?.displayName || '');
  if (!names.some((n) => /^quarter/i.test(n))) return null;
  const nums = names.map((n) => toInt(ROUND_NUM.exec(n)?.[1])).filter(Boolean);
  return nums.length ? Math.max(...nums) : null;
}

// 'Round 2', 'Quarterfinal', 'Qualifying Final'… → libellé français (tel quel si inconnu).
export function roundLabel(name, lastRound = null) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (/qualif/i.test(n)) return 'Qualifications';
  if (/^round robin/i.test(n)) return 'Phase de groupes';
  if (/^round of 16$/i.test(n)) return '8e de finale';
  if (/^quarter/i.test(n)) return 'Quart de finale';
  if (/^semi/i.test(n)) return 'Demi-finale';
  if (/^final$/i.test(n)) return 'Finale';
  const k = toInt(ROUND_NUM.exec(n)?.[1]);
  if (!k) return n;
  if (k === lastRound) return '8e de finale';
  return k === 1 ? '1er tour' : `${k}e tour`;
}

const SLAMS = [
  [/^australian open$/i, 'Open d\'Australie'],
  [/^(roland[ -]garros|french open)$/i, 'Roland-Garros'],
  [/^wimbledon/i, 'Wimbledon'],
  [/^us open$/i, 'US Open'],
];

// Nom court du tournoi : noms français des Grands Chelems, sans la mention du sponsor.
export function tournamentName(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  const slam = SLAMS.find(([re]) => re.test(raw));
  if (slam) return slam[1];
  return raw.replace(/ presented by .*$/i, '').replace(/ tennis championships$/i, '').trim() || 'Tennis';
}

// ─── Joueurs ─────────────────────────────────────────────────────────────────
const isTbd = (cp) => !cp?.athlete || String(cp.id ?? '').startsWith('-') || /^tbd$/i.test(String(cp.athlete.displayName || '').trim());

// Joueur 1 = 'home' (order 1), joueur 2 = 'away'. Ne jamais se fier à l'ordre du tableau.
function sidesOf(c) {
  const cps = c?.competitors || [];
  const home = cps.find((x) => x.homeAway === 'home') || cps.find((x) => x.order === 1);
  const away = cps.find((x) => x.homeAway === 'away') || cps.find((x) => x.order === 2);
  return home && away && home !== away ? { home, away } : null;
}

const letters = (s) => String(s || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();

// 3 lettres du nom de famille, sans accents : 'L. Pavlovic' → 'PAV', 'A. de Minaur' → 'DEM', 'Y. Bu' → 'BU'.
export function shortCode(athlete) {
  const short = String(athlete?.shortName || '').trim();
  const last = /^(\S+\.\s*)+\S/.test(short)
    ? short.replace(/^(\S+\.\s*)+/, '')
    : String(athlete?.displayName || '').trim().split(/\s+/).pop();
  const code = letters(last).slice(0, 3);
  return code.length >= 2 ? code : letters(athlete?.displayName).slice(0, 3) || '?';
}

function player(cp) {
  const a = cp.athlete;
  const p = { name: String(a.displayName).replace(/\s+/g, ' ').trim(), short: shortCode(a) };
  if (a.flag?.href) p.logo = a.flag.href;
  const seed = toInt(cp.curatedRank?.current);
  if (seed > 0 && seed < 99) p.record = `(${seed})`; // tête de série
  return p;
}

// ─── Score et statut ─────────────────────────────────────────────────────────
// Sets joués, joueur 1 d'abord : '6-4 7-6(5) 3-2'. Entre parenthèses : les points du perdant
// du jeu décisif (affichés seulement pour un set gagné 7-6).
export function setsText(home, away) {
  const h = home?.linescores || [];
  const a = away?.linescores || [];
  const sets = [];
  for (let i = 0; i < Math.max(h.length, a.length); i++) {
    const x = toInt(h[i]?.value) ?? 0;
    const y = toInt(a[i]?.value) ?? 0;
    const tbs = [h[i]?.tiebreak, a[i]?.tiebreak].map(toInt).filter((v) => v !== null);
    const tb = tbs.length && Math.min(x, y) === 6 && Math.max(x, y) === 7 ? `(${Math.min(...tbs)})` : '';
    sets.push(`${x}-${y}${tb}`);
  }
  return sets.join(' ');
}

const setLabel = (n) => (n > 0 ? `${n === 1 ? '1er' : `${n}e`} set` : null);

// 'scheduled' | 'live' | 'final' | 'void' | 'suspended'.
function phaseOf(c) {
  const name = c?.status?.type?.name;
  if (name === 'STATUS_WALKOVER') return 'void';        // forfait : aucune balle jouée → remboursé
  if (name === 'STATUS_SUSPENDED') return 'suspended';  // interrompu (pluie…) : reprise attendue
  return espnPhase(c?.status?.type);
}

function winnerOf({ home, away }) {
  if (home.winner === true && away.winner !== true) return '1';
  if (away.winner === true && home.winner !== true) return '2';
  return null;
}

// État d'un match ESPN → champs communs à Match et Update.
// null : terminé mais sans vainqueur indiqué (rien d'exploitable pour l'instant).
function stateOf(c, sides) {
  const phase = phaseOf(c);
  if (phase === 'void') return { status: 'void' };
  if (phase === 'final') {
    const outcome = winnerOf(sides);
    if (!outcome) return null;
    const retired = c.status.type.name === 'STATUS_RETIRED';
    const sets = setsText(sides.home, sides.away);
    return { status: 'finished', outcome, score: retired ? `${sets} ab.`.trim() : sets };
  }
  if (phase === 'live' || phase === 'suspended') {
    return {
      status: 'live',
      liveScore: setsText(sides.home, sides.away) || '0-0',
      clock: phase === 'suspended' ? 'Interrompu' : setLabel(toInt(c.status?.period)),
    };
  }
  return { status: 'scheduled' };
}

// ─── Match normalisé ─────────────────────────────────────────────────────────
// null si le match ne doit pas être proposé (TBD, horaire inconnu, pas de cote fiable…).
function toMatch({ league, tournament, c, lastRound }, { logo, points }) {
  if (c.timeValid === false) return null;
  const sides = sidesOf(c);
  if (!sides || isTbd(sides.home) || isTbd(sides.away)) return null;
  const startsAt = parseDate(c.date);
  if (!Number.isFinite(startsAt)) return null;
  const state = stateOf(c, sides);
  if (!state) return null;
  // Sans classement, la cote serait 50/50 pour tout le monde : on attend le prochain passage.
  if (state.status === 'scheduled' && !points) return null;

  const pts = (cp) => points?.get(String(cp.id));
  const m = {
    id: matchId(SPORT, league, c.id),
    source: 'espn',
    real: true,
    sport: SPORT,
    competition: `${tournamentName(tournament.name)} · ${TOUR_LABEL[league]}`,
  };
  if (logo) m.competitionLogo = logo;
  const round = roundLabel(c.round?.displayName, lastRound);
  if (round) m.round = round;
  Object.assign(m, {
    home: player(sides.home),
    away: player(sides.away),
    startsAt,
    odds: fromProbabilities(tennisProbs(pts(sides.home), pts(sides.away))),
    oddsSource: 'model',
    outcome: null,
    score: null,
    ...state,
    meta: { adapter: 'tennis', league, eventId: String(c.id), tournament: tournament.id },
  });
  if (m.status === 'void') m.outcome = 'void';
  return m;
}

// ─── Classements ─────────────────────────────────────────────────────────────
// Réponse /rankings → Map(id athlète → points). L'id rejoint competitors[].id du scoreboard.
export function parseRankings(data, tour) {
  const lists = data?.rankings || [];
  const list = lists.find((r) => r?.type === tour && r.ranks?.length) || lists.find((r) => r?.ranks?.length);
  const points = new Map();
  for (const r of list?.ranks || []) {
    const id = r?.athlete?.id;
    const p = Number(r?.points);
    if (id && p > 0) points.set(String(id), p);
  }
  return points;
}

// ─── Adaptateur ──────────────────────────────────────────────────────────────
export function createTennisAdapter({ getJson = defaultGetJson } = {}) {
  const rankCache = {}; // circuit → { at, points }, gardé en mémoire RANKINGS_TTL

  async function rankings(tour, now) {
    const cached = rankCache[tour];
    if (cached && now - cached.at < RANKINGS_TTL) return cached.points;
    try {
      const points = parseRankings(await getJson(rankingsUrl(tour)), tour);
      if (!points.size) throw new Error(`Classement ${TOUR_LABEL[tour]} vide`);
      rankCache[tour] = { at: now, points };
      return points;
    } catch (err) {
      if (cached) return cached.points; // un classement un peu ancien vaut mieux que rien
      throw err;
    }
  }

  // Flux lus par url : une requête en cours est partagée, sa réponse gardée FEED_TTL
  // (un échec n'est pas gardé). Les flux expirés sont oubliés à chaque lecture.
  const feedCache = new Map(); // url → { at, promise }
  function feed(url, now) {
    for (const [u, e] of feedCache) if (!(now >= e.at && now - e.at < FEED_TTL)) feedCache.delete(u);
    let e = feedCache.get(url);
    if (!e) {
      e = { at: now, promise: Promise.resolve().then(() => getJson(url)).then(readFeed) };
      feedCache.set(url, e);
      e.promise.catch(() => { if (feedCache.get(url) === e) feedCache.delete(url); });
    }
    return e.promise;
  }

  async function upcoming({ now, days = 7 }) {
    const from = now - LOOKBACK;
    const to = now + days * DAY;
    const today = etDay(now);
    const urls = TOURS.flatMap((tour) => [scoreboardUrl(tour, today), scoreboardUrl(tour, nextDay(today))]);
    const [boards, ranks] = await Promise.all([
      settleAll(urls.map((url) => () => feed(url, now))),
      settleAll(TOURS.map((tour) => async () => [tour, await rankings(tour, now)])),
    ]);
    if (!boards.ok.length) throw boards.failed[0] || new Error('ESPN tennis : aucune réponse');

    const points = Object.fromEntries(ranks.ok);
    const byId = new Map();
    for (const f of boards.ok) {
      for (const entry of f.singles) {
        const m = toMatch(entry, { logo: f.logo, points: points[entry.league] });
        if (!m) continue;
        if (m.status !== 'live' && (m.startsAt < from || m.startsAt > to)) continue;
        const cur = byId.get(m.id);
        if (!cur || PROGRESS[m.status] > PROGRESS[cur.status]) byId.set(m.id, m);
      }
    }
    return [...byId.values()];
  }

  async function results({ now, matches }) {
    const mine = (matches || []).filter((m) => TOURS.includes(m.meta?.league) && m.meta?.eventId && Number.isFinite(m.startsAt));
    if (!mine.length) return [];

    // Un flux par (circuit, jour ESPN du match) ; null = requête en échec ou réponse illisible.
    const feeds = new Map();
    const errors = [];
    const load = async (urls) => {
      const todo = [...new Set(urls)].filter((u) => !feeds.has(u));
      const { failed } = await settleAll(todo.map((url) => async () => {
        feeds.set(url, null);
        feeds.set(url, await feed(url, now));
      }));
      errors.push(...failed);
    };
    // Pour chaque jour, on lit d'abord le flux du circuit le plus représenté, puis l'autre circuit
    // seulement pour les matchs introuvables. Les tournois mixtes (Grands Chelems) étant en entier
    // dans les deux flux, un seul flux suffit souvent.
    const tally = {};
    for (const m of mine) {
      const k = `${etDay(m.startsAt)}|${m.meta.league}`;
      tally[k] = (tally[k] || 0) + 1;
    }
    const urlsOf = (m) => {
      const day = etDay(m.startsAt);
      const first = (tally[`${day}|wta`] || 0) > (tally[`${day}|atp`] || 0) ? 'wta' : 'atp';
      return [scoreboardUrl(first, day), scoreboardUrl(otherTour(first), day)];
    };
    const find = (m, url) => feeds.get(url)?.byId.get(String(m.meta.eventId));

    await load(mine.map((m) => urlsOf(m)[0]));
    await load(mine.filter((m) => !find(m, urlsOf(m)[0])).map((m) => urlsOf(m)[1]));
    // Aucun simple nulle part (échecs, réponses vides) : rien d'exploitable, c'est une panne.
    if ([...feeds.values()].every((f) => !f?.singles.length)) throw errors[0] || new Error('ESPN tennis : aucun match dans les flux');

    const out = [];
    for (const m of mine) {
      const urls = urlsOf(m);
      const c = urls.map((u) => find(m, u)).find(Boolean);
      if (c) {
        const u = updateFor(m, c, now);
        if (u) out.push(u);
      } else if (now - m.startsAt > STALE_AFTER && urls.every((u) => feeds.get(u))
        && urls.some((u) => feeds.get(u).tournaments.has(m.meta.tournament))) {
        // Retiré du tableau : les deux flux ont répondu, son tournoi y est, lui non.
        // Tournoi absent (fenêtre retouchée, flux vide ou partiel) ou ancien match sans
        // meta.tournament : on attend.
        out.push({ matchId: m.id, status: 'void' });
      }
    }
    return out;
  }

  return { key: 'tennis', probeUrl: PROBE_URL, upcoming, results };
}

// Match retrouvé dans le flux → Update (null : rien à signaler).
function updateFor(m, c, now) {
  const sides = sidesOf(c);
  if (!sides) return null;
  const espnStart = c.timeValid === false ? NaN : parseDate(c.date);
  const start = Number.isFinite(espnStart) ? Math.max(m.startsAt, espnStart) : m.startsAt;
  const stale = now - start > STALE_AFTER;
  const state = stateOf(c, sides);
  if (!state) return stale ? { matchId: m.id, status: 'void' } : null;
  if (state.status === 'scheduled') {
    if (stale) return { matchId: m.id, status: 'void' };
    const u = { matchId: m.id, status: 'scheduled' };
    if (Number.isFinite(espnStart) && espnStart !== m.startsAt) u.startsAt = espnStart; // ordre de jeu décalé
    return u;
  }
  return { matchId: m.id, ...state };
}
