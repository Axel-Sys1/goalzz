// Adaptateur ESPN pour le MMA (UFC, PFL), réuni aux autres dans espn/index.js.
//
// Particularités d'ESPN pour le MMA (vérifiées sur l'API le 27/09/2026) :
// - Un "event" est une SOIRÉE (card) ; chaque competitions[j] est un COMBAT. Un match Goalz = un combat.
// - L'id d'un combat (competitions[j].id) NE CHANGE PAS quand ESPN change un combattant : 401891663
//   (Contender Series) a été créé 'TBA' vs 'Opponent TBA', il oppose aujourd'hui Abushaar et Staines.
//   Id Goalz = combat + ids des combattants order 1 et order 2 ('401911630_5088844_3075570') :
//   un remplaçant (ou des coins inversés) ouvre un NOUVEAU match et l'ancien est remboursé,
//   jamais réglé sur le résultat du remplaçant.
// - Les plages ?dates=AAAAMMJJ-AAAAMMJJ fonctionnent ; le jour est celui de la soirée (fuseau de New York).
// - competitors[] n'est PAS trié : le combattant « order 2 » est souvent listé en premier.
//   On trie toujours par order (1 = domicile, 2 = extérieur).
// - Combattants inconnus : 'TBA' / 'Opponent TBA' avec de VRAIS ids (2431356 / 4402367) ;
//   on filtre donc aussi sur le nom. Certaines soirées n'ont encore aucun combat (pas de competitions).
// - competitions[j].date = début de la partie de soirée (prelims, main card), pas l'heure exacte du combat.
// - Le scoreboard n'a jamais de cotes ni la méthode de victoire (KO, soumission, décision…).
//   · Cotes DraftKings par combat, seulement la semaine du combat, sur l'API "core" :
//     …/events/{soirée}/competitions/{combat}/odds → items[].homeAthleteOdds / awayAthleteOdds.
//     « home » = combattant order 1 (vérifié sur les 11 combats cotés de l'UFC 332), et on le contrôle
//     avec l'id de athlete.$ref : cotes inversées si besoin, ignorées si elles visent un autre combattant.
//   · Méthode : …/competitions/{combat}/status → result.name ('kotko', 'submission', 'dq',
//     'decision---unanimous|split|majority', 'draw', 'no-contest').
// - Combat terminé : competitors[].winner. Aucun vainqueur = nul OU no contest : seule la méthode tranche.
// - Combat annulé : STATUS_CANCELED (post, non terminé), vu seulement en 2020. Depuis, le combat disparaît
//   simplement de la soirée (aucun STATUS_CANCELED sur ~1 700 combats UFC/PFL 2024-2026) :
//   absent d'une soirée qui a encore des combats → remboursé, dès la liste si le cœur fournit `existing`.
// Règles maison : nul → 'X' (pas de cote X, donc remboursé par le cœur) ; no contest, combat annulé → 'void'.
import { MIN } from '../../util.js';
import { defaultGetJson, settleAll, etDay, etRange, parseDate, espnPhase, toInt, matchId, HOUR, DAY } from './common.js';
import { americanToDecimal, combatProbs, fromBookmaker, fromProbabilities, parseRecord } from '../odds.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/mma';
const CORE = 'https://sports.core.api.espn.com/v2/sports/mma/leagues';
const SPORT = 'mma';

export const MMA_LEAGUES = [
  { slug: 'ufc', label: 'UFC' },
  { slug: 'pfl', label: 'PFL' },
];

const LOOKBACK = 36 * HOUR;       // combats terminés / annulés encore renvoyés par la liste
const STALE_AFTER = 36 * HOUR;    // combat jamais disputé (ou disparu du flux) après ce délai → remboursé
const ODDS_AHEAD = 8 * DAY;       // les cotes n'existent que la semaine du combat
const ODDS_TTL = 30 * MIN;        // cotes trouvées : relues toutes les 30 min
const NO_ODDS_TTL = 60 * MIN;     // pas encore de cotes : on réessaie dans l'heure
const FAILED_TTL = 20 * MIN;      // API core en échec : pas de nouvel essai à la liste suivante (15 min)
const CORE_TIMEOUT = 5000;        // cotes et méthode sont facultatives : on n'attend pas 15 s
const CORE_CONCURRENCY = 4;

export const scoreboardUrl = (league, dates) => `${SITE}/${league}/scoreboard?dates=${dates}&limit=200`;
export const oddsUrl = (league, eventId, boutId) => `${CORE}/${league}/events/${eventId}/competitions/${boutId}/odds`;
export const statusUrl = (league, eventId, boutId) => `${CORE}/${league}/events/${eventId}/competitions/${boutId}/status`;

// Petite réponse (2,5 Ko) pour tester l'accès.
const PROBE_URL = `${CORE}/ufc`;

// ─── Combattants ─────────────────────────────────────────────────────────────
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

// 'Raul Rosas Jr.' → 'ROS', 'Alatengheili' → 'ALA', "Casey O'Neill" → 'ONE'.
export function fighterShort(name) {
  const words = plain(name).split(/\s+/).filter((w) => w && !SUFFIX.test(w));
  const last = (words[words.length - 1] || '').replace(/[^a-z]/g, '');
  return (last || 'xxx').slice(0, 3).toUpperCase();
}

const isPlaceholder = (c) => {
  const name = String(c?.athlete?.displayName ?? '').trim();
  return !name || String(c?.id ?? '').startsWith('-') || /\b(tba|tbd)\b/i.test(name);
};

// Les deux combattants triés par order (1 = domicile), ou null.
export function fightersOf(bout) {
  const list = bout?.competitors || [];
  if (list.length !== 2) return null;
  return [...list].sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
}

const recordOf = (c) => (c.records || []).find((r) => r.type === 'total')?.summary || c.records?.[0]?.summary || null;

function fighterInfo(c) {
  const name = c.athlete.displayName.trim();
  const out = { name, short: fighterShort(name) };
  if (c.athlete.flag?.href) out.logo = c.athlete.flag.href;
  const record = recordOf(c);
  if (record) out.record = record;
  return out;
}

// ─── Identité d'un match ─────────────────────────────────────────────────────
const pairKey = (pair) => pair.map((c) => String(c.id)).join('_');

// Dernière partie de l'id Goalz : '401911630_5088844_3075570' (combat, order 1, order 2).
export const boutKey = (bout, pair) => `${bout.id}_${pairKey(pair)}`;

// Id Goalz → { boutId, pair } ; pair null pour un ancien id sans combattants ('espn:mma:ufc:401911630',
// instantanés publiés jusqu'au 27/09/2026).
export function parseBoutKey(id) {
  const [boutId, ...ids] = String(id ?? '').split(':').pop().split('_');
  return { boutId, pair: ids.length === 2 ? ids.join('_') : null };
}

// Le combat oppose-t-il toujours les combattants du match (mêmes coins) ? null si on ne peut pas le dire.
// Ancien id sans combattants : on compare les noms.
export function sameFighters(m, bout) {
  const pair = fightersOf(bout);
  if (!pair) return null;
  const { pair: key } = parseBoutKey(m.id);
  if (key) return key === pairKey(pair);
  if (!m.home?.name || !m.away?.name) return null;
  return plain(m.home.name) === plain(pair[0].athlete?.displayName) && plain(m.away.name) === plain(pair[1].athlete?.displayName);
}

// ─── Affichage ───────────────────────────────────────────────────────────────
// Nom court de la soirée : 'UFC 332', 'PFL Chicago', 'Contender Series',
// ou le nom complet pour les soirées génériques ('UFC Fight Night: Rosas Jr. vs. Barcelos').
export function cardName(e) {
  const full = String(e?.name ?? '').trim();
  const short = String(e?.shortName || full.split(':')[0]).split(/\s+[–—-]\s+/)[0].trim();
  if (/contender series/i.test(short)) return 'Contender Series';
  if (/\d/.test(short)) return short;
  if (/fight night|noche/i.test(short) && full.includes(':')) return full;
  return short || full;
}

const WEIGHTS = [
  [/super\s*heavy/i, 'Poids super-lourds'],
  [/light\s*heavy/i, 'Mi-lourds'],
  [/heavy/i, 'Poids lourds'],
  [/middle/i, 'Poids moyens'],
  [/welter/i, 'Mi-moyens'],
  [/light/i, 'Poids légers'],
  [/feather/i, 'Poids plumes'],
  [/bantam/i, 'Poids coqs'],
  [/fly/i, 'Poids mouches'],
  [/straw/i, 'Poids pailles'],
  [/atom/i, 'Poids atomes'],
  [/catch/i, 'Poids intermédiaire'],
  [/open/i, 'Toutes catégories'],
];

// 'W Strawweight' → 'Poids pailles (F)', 'Light Heavyweight' → 'Mi-lourds'. Inconnue → null.
export function weightClassFr(text) {
  const t = String(text ?? '').trim();
  const hit = t && WEIGHTS.find(([re]) => re.test(t));
  if (!hit) return null;
  return /^w\s|women/i.test(t) ? `${hit[1]} (F)` : hit[1];
}

// Combat principal : celui dont les deux noms figurent dans le titre de la soirée
// ('UFC 332: Silva vs. Wang', 'UFC 331: Van vs. Pantoja 2').
function headliners(eventName) {
  const tail = String(eventName ?? '').split(':').slice(1).join(':');
  const parts = plain(tail).split(/\s+vs\.?\s+/).map((p) => p.replace(/\s+\d+$/, '').trim());
  return parts.length === 2 && parts.every(Boolean) ? parts : null;
}

function isMainEvent(e, [a, b]) {
  const h = headliners(e.name);
  if (!h) return false;
  const na = plain(a.athlete.displayName);
  const nb = plain(b.athlete.displayName);
  return (na.includes(h[0]) && nb.includes(h[1])) || (na.includes(h[1]) && nb.includes(h[0]));
}

function roundLabel(e, bout, pair) {
  const parts = [isMainEvent(e, pair) ? 'Combat principal' : null, weightClassFr(bout.type?.abbreviation || bout.type?.text)];
  return parts.filter(Boolean).join(' · ') || null;
}

const leagueLogo = (data) => data?.leagues?.[0]?.logos?.[0]?.href || null;

// ─── Statuts et résultats ────────────────────────────────────────────────────
// 'scheduled' | 'live' | 'final' | 'void' | 'wait' (suspendu / retardé : on attend, jamais remboursé pour ça).
function phaseOf(type) {
  if (/SUSPENDED|DELAYED/i.test(type?.name || '')) return 'wait';
  return espnPhase(type);
}

// Statut d'un combat, en tenant compte d'une soirée annulée ou reportée en bloc.
function boutPhase(bout, e) {
  const p = phaseOf(bout?.status?.type);
  return p === 'scheduled' && phaseOf(e?.status?.type) === 'void' ? 'void' : p;
}

// Index d'un scoreboard : combats (id → { e, bout }) et soirées (id → e).
export function indexBoard(data) {
  const bouts = new Map();
  const events = new Map();
  for (const e of data?.events || []) {
    events.set(String(e.id), e);
    for (const bout of e.competitions || []) bouts.set(String(bout.id), { e, bout });
  }
  return { bouts, events };
}

// Un match connu a-t-il perdu son combat ? Combattants changés (remplaçant, coins inversés, retour à 'TBA'),
// ou combat retiré d'une soirée qui en compte encore (ESPN supprime les combats annulés).
// Soirée absente du flux ou sans aucun combat (données incomplètes) : on ne conclut rien.
export function lostBout(m, { bouts, events }) {
  const found = bouts.get(parseBoutKey(m.id).boutId);
  if (found) return sameFighters(m, found.bout) === false;
  return !!events.get(String(m.meta?.eventId))?.competitions?.length;
}

// Round en cours : 'R2 3:12' (temps écoulé dans le round).
export function liveClock(status) {
  const r = toInt(status?.period);
  if (!r) return 'En cours';
  const clock = status?.displayClock;
  return clock && clock !== '-' && clock !== '0:00' ? `R${r} ${clock}` : `R${r}`;
}

// result.name de l'API core → libellé français.
export function methodLabel(name) {
  const n = String(name ?? '').toLowerCase();
  if (!n) return null;
  if (n.includes('no-contest') || n.includes('no contest')) return 'No contest';
  if (n.includes('draw')) return 'Nul';
  if (n.includes('decision')) {
    if (n.includes('technical')) return 'Décision technique';
    if (n.includes('unanimous')) return 'Décision unanime';
    if (n.includes('split')) return 'Décision partagée';
    if (n.includes('majority')) return 'Décision majoritaire';
    return 'Décision';
  }
  if (n.includes('submission')) return 'Soumission';
  if (n === 'dq' || n.includes('disqualif')) return 'Disqualification';
  if (n.includes('ko')) return 'KO/TKO';
  return null;
}

// Texte du score d'un combat gagné : 'KO/TKO · R2', 'Décision unanime', 'Victoire · R3' (méthode inconnue).
function finishText(resultName, status) {
  const method = methodLabel(resultName);
  const r = toInt(status?.period);
  if (method && method.startsWith('Décision')) return method;
  const head = method || 'Victoire';
  return r ? `${head} · R${r}` : head;
}

// Combat terminé → { status, outcome?, score } ; null s'il faut attendre (vainqueur ou méthode inconnus).
// resultName vient de l'API core ; null si elle n'a pas répondu.
export function finalState(bout, resultName) {
  const n = String(resultName ?? '').toLowerCase();
  if (n.includes('no-contest')) return { status: 'void', score: 'No contest' };
  if (n.includes('draw')) return { status: 'finished', outcome: 'X', score: 'Nul' };
  const pair = fightersOf(bout);
  if (!pair) return null;
  const [a, b] = pair.map((c) => c.winner === true);
  if (a === b) return null;
  return { status: 'finished', outcome: a ? '1' : '2', score: finishText(resultName, bout.status) };
}

// ─── Cotes ───────────────────────────────────────────────────────────────────
const athleteIdOf = (side) => /athletes\/(\d+)/.exec(side?.athlete?.$ref || '')?.[1] || null;

function sideDecimal(side) {
  const cur = side?.current?.moneyLine;
  return americanToDecimal(side?.moneyLine)
    ?? americanToDecimal(cur?.american ?? cur?.alternateDisplayValue)
    ?? (cur?.decimal > 1 ? cur.decimal : null);
}

// Réponse core /odds → cotes Goalz { 1, 2 } (marge maison), ou null.
// home/away sont rattachés aux combattants par l'id de athlete.$ref, sinon home = order 1.
export function boutOdds(data, pair) {
  const want = pair.map((c) => String(c.id));
  const items = (data?.items || []).filter(Boolean)
    .sort((x, y) => (x.provider?.priority ?? 99) - (y.provider?.priority ?? 99));
  for (const it of items) {
    let home = it.homeAthleteOdds;
    let away = it.awayAthleteOdds;
    const ids = [athleteIdOf(home), athleteIdOf(away)];
    const straight = (!ids[0] || ids[0] === want[0]) && (!ids[1] || ids[1] === want[1]);
    const swapped = (!ids[0] || ids[0] === want[1]) && (!ids[1] || ids[1] === want[0]);
    if (ids.some(Boolean) && !straight && !swapped) continue; // cotes d'un combattant remplacé
    if (!straight) [home, away] = [away, home];
    const d1 = sideDecimal(home);
    const d2 = sideDecimal(away);
    if (d1 && d2) {
      const odds = fromBookmaker({ 1: d1, 2: d2 });
      if (odds) return odds;
    }
  }
  return null;
}

const modelOdds = (home, away) => fromProbabilities(combatProbs(parseRecord(home.record), parseRecord(away.record)));

// ─── Adaptateur ──────────────────────────────────────────────────────────────
export function createMmaAdapter({ getJson = defaultGetJson, leagues = MMA_LEAGUES } = {}) {
  const oddsCache = new Map();   // combat → { at, odds | null }
  const methods = new Map();     // combat → result.name d'un combat terminé (ne change plus)

  // Cotes bookmaker d'un combat (cache ; erreur réseau → dernière cote connue, sinon null = modèle).
  async function oddsFor(row, now) {
    const key = String(row.bout.id);
    const hit = oddsCache.get(key);
    // En direct, on garde la cote d'avant-combat si on l'a.
    if (hit && (row.phase === 'live' || now - hit.at < (hit.odds ? ODDS_TTL : NO_ODDS_TTL))) return hit.odds;
    try {
      const odds = boutOdds(await getJson(oddsUrl(row.league, row.event.id, row.bout.id), { timeoutMs: 5000 }), row.pair);
      oddsCache.set(key, { at: now, odds });
      return odds;
    } catch {
      // Échec mémorisé : pas de nouvel essai avant NO_ODDS_TTL (évite de bloquer chaque rafraîchissement).
      oddsCache.set(key, { at: now, odds: hit?.odds ?? null });
      return hit?.odds ?? null;
    }
  }

  // Méthode d'un combat terminé (null si l'API core ne répond pas ou pas encore).
  async function methodFor(league, eventId, boutId) {
    const key = String(boutId);
    if (methods.has(key)) return methods.get(key);
    try {
      const st = await getJson(statusUrl(league, eventId, boutId), { timeoutMs: 5000 });
      const name = st?.result?.name || null;
      if (name && st?.type?.completed) methods.set(key, name);
      return name;
    } catch {
      return null;
    }
  }

  function rowOf(league, logo, e, bout) {
    if (!bout?.id || bout.timeValid === false) return null;
    const pair = fightersOf(bout);
    if (!pair || pair.some(isPlaceholder)) return null;
    const startsAt = parseDate(bout.date || bout.startDate || e.date);
    if (!Number.isFinite(startsAt)) return null;
    return { league, logo, event: e, bout, pair, startsAt, phase: boutPhase(bout, e) };
  }

  // Ligne du flux (+ cotes / méthode) → Match, ou null si un combat terminé n'a pas encore de résultat sûr.
  function toMatch(row) {
    const { league, event: e, bout, pair, startsAt } = row;
    const [home, away] = pair.map(fighterInfo);
    const m = {
      id: matchId(SPORT, league, boutKey(bout, pair)), // un combattant remplacé = un nouveau pari
      source: 'espn',
      real: true,
      sport: SPORT,
      competition: cardName(e),
      home,
      away,
      startsAt,
      odds: row.odds || modelOdds(home, away),
      oddsSource: row.odds ? 'bookmaker' : 'model',
      status: 'scheduled',
      outcome: null,
      score: null,
      meta: { adapter: SPORT, league, eventId: String(e.id), day: etDay(startsAt) },
    };
    if (row.logo) m.competitionLogo = row.logo;
    const round = roundLabel(e, bout, pair);
    if (round) m.round = round;

    if (row.phase === 'live') Object.assign(m, { status: 'live', clock: liveClock(bout.status) });
    else if (row.phase === 'void') m.status = 'void';
    else if (row.phase === 'final') {
      const st = finalState(bout, row.method);
      if (!st) return null;
      Object.assign(m, st);
    }
    return m;
  }

  // Mise à jour d'un match d'après le flux (index des combats et des soirées).
  async function updateFor(m, bouts, events, now) {
    const { boutId } = parseBoutKey(m.id);
    const late = now - m.startsAt > STALE_AFTER;
    const found = bouts.get(boutId);
    if (!found) {
      // Combat retiré d'une soirée terminée ou annulée, ou disparu du flux depuis trop longtemps.
      const card = events.get(String(m.meta?.eventId));
      const cardPhase = card ? phaseOf(card.status?.type) : null;
      if (cardPhase === 'final' || cardPhase === 'void') return { matchId: m.id, status: 'void' };
      if (late && cardPhase !== 'live' && cardPhase !== 'wait') return { matchId: m.id, status: 'void' };
      return null;
    }
    const { e, bout } = found;
    // Un combattant a été remplacé : le pari d'origine n'a plus d'objet, il est remboursé.
    if (sameFighters(m, bout) === false) return { matchId: m.id, status: 'void' };
    const phase = boutPhase(bout, e);
    if (phase === 'live') return { matchId: m.id, status: 'live', clock: liveClock(bout.status) };
    if (phase === 'void') return { matchId: m.id, status: 'void' };
    if (phase === 'final') {
      const st = finalState(bout, await methodFor(m.meta?.league, e.id, bout.id));
      return st ? { matchId: m.id, ...st } : null;
    }
    if (phase === 'wait') return null;
    if (late) return { matchId: m.id, status: 'void' };
    const start = parseDate(bout.date || e.date);
    return Number.isFinite(start) && start !== m.startsAt ? { matchId: m.id, status: 'scheduled', startsAt: start } : null;
  }

  return {
    key: SPORT,
    probeUrl: PROBE_URL,

    async upcoming({ now, days = 7 }) {
      const from = now - LOOKBACK;
      const to = now + days * DAY;
      const range = etRange(from, to);
      const { ok, failed } = await settleAll(
        leagues.map(({ slug }) => async () => ({ slug, data: await getJson(scoreboardUrl(slug, range)) })),
        leagues.length,
      );
      if (!ok.length && failed.length) throw failed[0];

      const rows = [];
      for (const { slug, data } of ok) {
        const logo = leagueLogo(data);
        for (const e of data?.events || []) {
          for (const bout of e.competitions || []) {
            const row = rowOf(slug, logo, e, bout);
            if (row && row.startsAt >= from && row.startsAt <= to + 12 * HOUR) rows.push(row);
          }
        }
      }

      // Requêtes secondaires : cotes des combats de la semaine, méthode des combats terminés.
      const extra = [];
      for (const row of rows) {
        if (row.phase === 'live' || (row.phase === 'scheduled' && row.startsAt <= now + ODDS_AHEAD)) {
          extra.push(async () => { row.odds = await oddsFor(row, now); });
        } else if (row.phase === 'final') {
          extra.push(async () => { row.method = await methodFor(row.league, row.event.id, row.bout.id); });
        }
      }
      await settleAll(extra, CORE_CONCURRENCY);
      return rows.map(toMatch).filter(Boolean);
    },

    async results({ now, matches }) {
      const byLeague = new Map();
      for (const m of matches) {
        const league = m.meta?.league;
        if (!league) continue;
        if (!byLeague.has(league)) byLeague.set(league, []);
        byLeague.get(league).push(m);
      }
      const tasks = [...byLeague].map(([league, list]) => async () => {
        const starts = list.map((m) => m.startsAt);
        const data = await getJson(scoreboardUrl(league, etRange(Math.min(...starts) - 12 * HOUR, Math.max(...starts))));
        const bouts = new Map();
        const events = new Map();
        for (const e of data?.events || []) {
          events.set(String(e.id), e);
          for (const bout of e.competitions || []) bouts.set(String(bout.id), { e, bout });
        }
        const out = [];
        await settleAll(list.map((m) => async () => {
          const u = await updateFor(m, bouts, events, now);
          if (u) out.push(u);
        }), CORE_CONCURRENCY);
        return out;
      });
      const { ok, failed } = await settleAll(tasks, tasks.length || 1);
      if (!ok.length && failed.length) throw failed[0];
      return ok.flat();
    },
  };
}
