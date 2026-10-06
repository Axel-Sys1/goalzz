// Provider « TheSportsDB » pour la boxe anglaise (ESPN n'a pas de boxe : 400 « Invalid sport (boxing) »).
// Voir providers/index.js pour le contrat.
//
// Particularités de TheSportsDB avec la clé gratuite « 123 » (vérifiées sur l'API le 27/09/2026) :
// - Ligue « Boxing » = 4445. Chaque événement est UN combat : l'affiche principale d'une soirée,
//   parfois précédée du nom de la soirée ('Zuffa Boxing 11 Fisher vs Pirotton', 'MVPW 06 Mayer vs Cameron').
//   strHomeTeam / strAwayTeam sont vides : les boxeurs se lisent dans strEvent (« A vs B »).
// - Plafonds de la clé gratuite : eventsday → 3 événements par jour, eventsnextleague → 1,
//   eventsseason → les 15 premiers. La liste interroge donc eventsday jour par jour, avec un cache.
// - 30 requêtes / minute ; au-delà, un 429 SANS en-tête CORS : le navigateur ne voit qu'une TypeError.
//   D'où une file d'attente (une requête à la fois, 20 par minute au plus) et une pause de 2 min
//   dès le premier échec, pendant laquelle on sert le cache.
// - Horaires : strTimestamp en UTC sans 'Z' ('2026-09-26T22:00:00') ; dateEvent = jour UTC.
//   Heure inconnue (strTimeLocal vide) : 00:00 UTC du jour, les paris ferment donc en avance.
// - Ni direct, ni score. Les résultats sont saisis à la main, souvent le lendemain ou plus tard :
//   · eventresults.php?id= : WIN / LOSS par boxeur (rare, parfois une seule ligne) ;
//   · strResult : texte libre, soit un tableau ('Callum Walsh \tdef. \tCarlos Ocampo \tUD \t10'),
//     soit un article dont la première phrase commence par le vainqueur
//     ('Filip Hrgovic produced a dramatic comeback to stop Moses Itauma…').
//   On ne règle que si le vainqueur est certain (texte et WIN/LOSS d'accord quand les deux existent).
// - Fiabilité (relevé du 27/09/2026, 13 combats du 08/08 au 19/09) : 6 réglés par le texte, 1 article
//   illisible à l'époque (« handed X his first defeat », géré depuis), 6 SANS AUCUN résultat, même
//   7 semaines après. Rien avant le combat ne permet de savoir lesquels seront renseignés.
//   D'où : au-delà de VOID_AFTER, si TheSportsDB répond toujours sans résultat → remboursé
//   (« sans résultat » du contrat) ; jamais sur une erreur réseau. Le cœur n'a pas d'autre délai :
//   sans cela, les mises resteraient bloquées. (L'instantané, lui, rembourse dès 48 h.)
// - strPostponed 'yes' ou strStatus reporté / annulé / abandonné → remboursé (suspendu : non).
// - Aucune cote ni bilan exploitable : cotes 50/50.
import { MIN } from '../../util.js';
import { defaultGetJson } from '../espn/common.js';
import { fromProbabilities, neutralProbs } from '../odds.js';

const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
export const BOXING_LEAGUE = '4445';
const SPORT = 'boxing';
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LOOKBACK = 36 * HOUR;       // combats récents encore listés
const NEAR_TTL = 30 * MIN;        // jours à ±36 h : relus à chaque rafraîchissement (toutes les heures)
const FAR_TTL = 6 * HOUR;         // jours plus lointains
const RESULT_DELAY = 90 * MIN;    // aucun résultat possible avant la fin de la soirée
const RECHECK_SOON = 10 * MIN;    // résultat introuvable : on repasse…
const RECHECK_LATE = HOUR;        // …moins souvent passé 12 h
const LATE_AFTER = 12 * HOUR;
const VOID_AFTER = 4 * DAY;       // toujours rien de publié (TheSportsDB joignable) : remboursé
const MAX_CHECKS = 6;             // combats vérifiés par appel (2 requêtes chacun)

export const dayUrl = (day) => `${BASE}/eventsday.php?d=${day}&l=${BOXING_LEAGUE}`;
export const lookupUrl = (id) => `${BASE}/lookupevent.php?id=${id}`;
export const resultsUrl = (id) => `${BASE}/eventresults.php?id=${id}`;
const PROBE_URL = `${BASE}/eventsnextleague.php?id=${BOXING_LEAGUE}`; // 1 événement, 1,5 Ko

// ─── File d'attente ──────────────────────────────────────────────────────────
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Une requête à la fois, au plus `perMinute` sur 60 s glissantes, et plus aucune pendant `pauseMs`
// après un échec (sans doute un 429, que le CORS rend indiscernable d'une panne).
export function createThrottle({ perMinute = 20, pauseMs = 2 * MIN, clock = () => Date.now(), sleep = wait } = {}) {
  const stamps = [];
  let pausedUntil = 0;
  let chain = Promise.resolve();
  const run = (task) => {
    const job = chain.then(async () => {
      if (clock() < pausedUntil) throw new Error('TheSportsDB : en pause après un refus');
      for (;;) {
        const t = clock();
        while (stamps.length && stamps[0] <= t - 60_000) stamps.shift();
        if (stamps.length < perMinute) break;
        await sleep(stamps[0] + 60_000 - t);
      }
      stamps.push(clock());
      try {
        return await task();
      } catch (err) {
        pausedUntil = clock() + pauseMs;
        throw err;
      }
    });
    chain = job.catch(() => {});
    return job;
  };
  return { run, paused: () => clock() < pausedUntil };
}

// ─── Lecture des événements ──────────────────────────────────────────────────
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Minuscules, sans accents ni surnoms entre guillemets : 'Isaac “Pitbull” Cruz' → 'isaac cruz'.
export function norm(s) {
  return plain(s).replace(/[“"«][^“”"«»]*[”"»]/g, ' ').replace(/’/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
}

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/;
const nameKeys = (name) => {
  const words = norm(name).split(' ').filter((w) => w && !SUFFIX.test(w));
  return { full: words.join(' '), last: words[words.length - 1] || '' };
};

const shortOf = (name) => (nameKeys(name).last.replace(/[^a-z]/g, '') || 'xxx').slice(0, 3).toUpperCase();
// Adversaire pas encore connu : 'TBA', 'Opponent TBC', 'To Be Announced', '?'…
const isPlaceholder = (name) => !name || !/[a-z]/.test(norm(name)) || /\b(tba|tbd|tbc)\b/i.test(name)
  || /^opponent\b/i.test(name) || /\bto be (announced|determined|confirmed)\b/i.test(name);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 'Zuffa Boxing 11 Fisher vs Pirotton' → { card: 'Zuffa Boxing 11', home: 'Fisher', away: 'Pirotton' }
// 'Prime Video Boxing 16 Inoue vs Nasukawa II' → away 'Nasukawa' (numéro de revanche retiré).
export function parseEventName(title) {
  const m = /^(.*?)\s+vs\.?\s+(.+)$/i.exec(clean(title));
  if (!m) return null;
  let home = m[1];
  let card = null;
  const pre = /^(.*\d)\s+(\D.*)$/.exec(home); // préfixe terminé par un numéro : nom de la soirée
  if (pre) [, card, home] = pre;
  return { card, home: home.trim(), away: m[2].replace(/\s+(?:\d+|ii|iii|iv)$/i, '').trim() };
}

// strTimestamp est en UTC sans fuseau.
export function parseTimestamp(ev) {
  const ts = clean(ev?.strTimestamp);
  if (ts) {
    const t = Date.parse(/(z|[+-]\d\d:?\d\d)$/i.test(ts) ? ts : `${ts}Z`);
    if (Number.isFinite(t)) return t;
  }
  return ev?.dateEvent ? Date.parse(`${ev.dateEvent}T${String(ev.strTime || '00:00:00').slice(0, 8)}Z`) : NaN;
}

const isPostponed = (ev) => String(ev?.strPostponed ?? '').toLowerCase() === 'yes'
  || /postp|cancel|\bcanc\b|\bpst\b|\babd\b|abandon/i.test(ev?.strStatus || '');

// ─── Résultats ───────────────────────────────────────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Première mention du boxeur dans un texte normalisé : { index, end }, ou null. Nom complet d'abord.
function findName(text, keys) {
  for (const k of [keys.full, keys.last]) {
    if (!k) continue;
    const m = new RegExp(`(^|[^a-z'])${escapeRe(k)}(?![a-z])`).exec(text);
    if (m) return { index: m.index + m[1].length, end: m.index + m[0].length };
  }
  return null;
}

function methodOf(text) {
  if (/technical decision/.test(text)) return 'Décision technique';
  if (/unanimous decision|\bud\b/.test(text)) return 'Décision unanime';
  if (/split decision|\bsd\b/.test(text)) return 'Décision partagée';
  if (/majority decision|\bmd\b/.test(text)) return 'Décision majoritaire';
  if (/disqualif|\bdq\b/.test(text)) return 'Disqualification';
  if (/knock|stop|\bko\b|\btko\b|\brtd\b|retire/.test(text)) return 'KO/TKO';
  if (/decision|on points/.test(text)) return 'Décision';
  return null;
}

const WIN_WORDS = /\b(def|defeat(ed|s|ing)?|beat|beats|beating|stop(ped|s|ping|page)?|knock(ed|s|ing)?|knockout|ko|tko|won|win|wins|winning|retain(ed|s|ing)?|claim(ed|s|ing)?|dominat\w*|outpoint\w*|outbox\w*|victory|upset\w*)\b/;
const STRONG_WIN = /\b(def|defeat(ed|s)?|beat|beats|stop(ped|s|page)?|knock\w*|won|wins?)\b/;
const DRAW_WORDS = /\b(draw|drew|drawn)\b/;
const NC_WORDS = /\bno[- ]contest\b/;
// Mot qui suit le nom d'un sujet PERDANT ('X was stopped', 'X lost', 'X and Y fought to a draw'),
// ou qui ouvre une incise ('X, who beat Y in 2024, lost the rematch').
const LOSER_NEXT = /^(was|were|is|are|lost|loses|losing|fell|falls|suffered|suffers|drew|draws|fought|fights|and|vs|versus|failed|could|couldn't|retired|quit|who|whose|which)$/;
const LOSER_AFTER_HAS = /^(lost|been|fallen|suffered|failed|drawn|retired)$/;
// Mot avant le sujet qui ouvre une subordonnée ('After Itauma beat Hrgovic in 2024, …').
const LEADING_CLAUSE = /^(after|when|while|as|since|though|although|despite|before|until|once|if|having|following)$/;
// Entre les deux noms : négation, futur, intention, ou passif ('… stopped by Y') → pas un résultat.
const NOT_A_RESULT = /\b(not|never|without|unable|will|would|could|should|can|may|might|aims?|aiming|hopes?|hoping|plans?|expects?|seeks?|seeking|faces?|facing|meets?)\b|n't\b|\bby\s*$/;
const FUTURE = /\b(will|would|could|should|may|might)\b/;
// 'Corey Marksman handed Christian Barreto his first professional defeat' : le sujet gagne.
const HANDED = /^\s*hand(ed|s)\s*$/;
const LOSS_AFTER = /^\s*(his|her|their|a|an)\b[^.;,]{0,40}?\b(defeat|loss)\b/;

// Tableau ('Callum Walsh \tdef. \tCarlos Ocampo \tUD') puis première phrase d'un article.
// → { outcome: '1' | '2' | 'X' | 'void', method } ou null.
export function outcomeFromText(text, [home, away]) {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('\t') && !/\sdef\.\s/.test(line)) continue;
    const l = norm(line);
    const h = findName(l, home);
    const a = findName(l, away);
    if (!h || !a) continue;
    const d = /(^|\s)def\.?(\s|$)/.exec(l);
    if (d) {
      const at = d.index;
      if (h.end <= at && a.index > at) return { outcome: '1', method: methodOf(l.slice(at)) };
      if (a.end <= at && h.index > at) return { outcome: '2', method: methodOf(l.slice(at)) };
      return null;
    }
    if (/\bno contest\b|\bnc\b/.test(l)) return { outcome: 'void', method: null };
    if (DRAW_WORDS.test(l)) return { outcome: 'X', method: null }; // pas de 'D' isolé : initiale d'un prénom
    return null;
  }

  const paragraph = raw.split(/\r?\n/).map((p) => p.trim()).find(Boolean) || '';
  const s = norm(paragraph.split(/(?<=[.!?])\s+(?=[A-Z“"«])/)[0]);
  const h = findName(s, home);
  const a = findName(s, away);
  if (!h || !a) return null;
  if (NC_WORDS.test(s)) return FUTURE.test(s) ? null : { outcome: 'void', method: null };
  if (DRAW_WORDS.test(s)) return STRONG_WIN.test(s) || FUTURE.test(s) ? null : { outcome: 'X', method: null };

  // Le vainqueur est le sujet : cité en premier, dans les 4 premiers mots, suivi d'un verbe
  // qui n'est pas celui d'un perdant, avec un mot de victoire avant le nom de l'adversaire.
  const [subject, other, outcome] = h.index < a.index ? [h, a, '1'] : [a, h, '2'];
  const before = s.slice(0, subject.index).split(' ').filter(Boolean);
  if (before.length > 3 || before.some((w) => LEADING_CLAUSE.test(w.replace(/[^a-z]/g, '')))) return null;
  if (s[subject.end] === "'" || s[subject.end] === ',') return null; // possessif ('Benn's bid…') ou incise
  const next = s.slice(subject.end).split(' ').map((w) => w.replace(/[^a-z']/g, '')).filter((w) => w && !SUFFIX.test(w));
  if (LOSER_NEXT.test(next[0] || '')) return null;
  if (/^(has|had|have)$/.test(next[0] || '') && LOSER_AFTER_HAS.test(next[1] || '')) return null;
  const between = s.slice(subject.end, other.index);
  if (NOT_A_RESULT.test(between)) return null;
  const won = WIN_WORDS.test(between) || (HANDED.test(between) && LOSS_AFTER.test(s.slice(other.end)));
  return won ? { outcome, method: methodOf(s) } : null;
}

// eventresults.php : une ligne par boxeur, strDetail 'WIN' / 'LOSS' (parfois d'autres combats de la soirée).
export function outcomeFromRows(rows, fighters) {
  if (!rows?.length) return null;
  const details = fighters.map((keys) => {
    const byFull = rows.filter((r) => findName(norm(r.strPlayer), { full: keys.full }));
    const hits = byFull.length ? byFull : rows.filter((r) => findName(norm(r.strPlayer), { last: keys.last }));
    if (hits.length > 1) return '?';
    return hits.length ? String(hits[0].strDetail ?? '').trim().toUpperCase() : null;
  });
  if (details.includes('?')) return null;
  const [h, a] = details;
  if ([h, a].some((d) => /^(NC|NO.?CONTEST)$/.test(d || ''))) return 'void';
  if (h === 'DRAW' || a === 'DRAW') return h === 'WIN' || a === 'WIN' ? null : 'X';
  if (h === 'WIN' && a !== 'WIN') return '1';
  if (a === 'WIN' && h !== 'WIN') return '2';
  return null;
}

// Événement (+ lignes eventresults si lues) → { status, outcome?, score? } ou null si rien de sûr.
// Le score (méthode) ne dépend que du texte : la liste et les résultats donnent la même réponse.
export function readResult(ev, names, rows = null) {
  if (isPostponed(ev)) return { status: 'void' };
  const keys = names.map(nameKeys);
  if (!keys[0].last || !keys[1].last || keys[0].full === keys[1].full) return null;
  const text = outcomeFromText(ev?.strResult, keys);
  const found = [text?.outcome, outcomeFromRows(rows, keys)].filter(Boolean);
  if (!found.length || found.some((o) => o !== found[0])) return null; // rien, ou sources contradictoires
  if (found[0] === 'void') return { status: 'void', score: 'No contest' };
  if (found[0] === 'X') return { status: 'finished', outcome: 'X', score: 'Nul' };
  return { status: 'finished', outcome: found[0], score: text?.method ?? null };
}

// ─── Provider ────────────────────────────────────────────────────────────────
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function utcDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${utcDay(from)}T00:00:00Z`); t <= to; t += DAY) out.push(utcDay(t));
  return out;
}

const idOf = (eventId) => `tsdb:${SPORT}:${BOXING_LEAGUE}:${eventId}`;

// Deux boxeurs qu'on sait distinguer dans un résultat (sinon, aucun règlement possible).
const distinct = (a, b) => {
  const [x, y] = [a, b].map(nameKeys);
  return !!x.last && !!y.last && x.full !== y.full;
};

// `known` : ids déjà suivis par le cœur (des paris existent peut-être). Leur résultat passe par
// fetchResults, qui croise le texte et eventresults ; la liste ne règle que les combats découverts
// déjà terminés (aucun pari possible). Un report, lui, est rendu dans les deux cas.
function toMatch(ev, now, known = new Set()) {
  if (!ev?.idEvent || String(ev.idLeague) !== BOXING_LEAGUE) return null;
  const parts = parseEventName(ev.strEvent);
  const home = clean(ev.strHomeTeam) || parts?.home;
  const away = clean(ev.strAwayTeam) || parts?.away;
  if (isPlaceholder(home) || isPlaceholder(away) || !distinct(home, away)) return null;
  const startsAt = parseTimestamp(ev);
  if (!Number.isFinite(startsAt)) return null;
  const m = {
    id: idOf(ev.idEvent),
    source: 'tsdb',
    real: true,
    sport: SPORT,
    competition: parts?.card || 'Boxe',
    home: { name: home, short: shortOf(home) },
    away: { name: away, short: shortOf(away) },
    startsAt,
    odds: fromProbabilities(neutralProbs(false)),
    oddsSource: 'model',
    status: 'scheduled',
    outcome: null,
    score: null,
    meta: { event: String(ev.idEvent) },
  };
  if (ev.strLeagueBadge) m.competitionLogo = ev.strLeagueBadge;
  const result = isPostponed(ev) ? { status: 'void' }
    : now >= startsAt && !known.has(m.id) ? readResult(ev, [home, away]) : null;
  if (result) Object.assign(m, result);
  return m;
}

// Aucun résultat lisible pour un combat suivi (`ev` absent : supprimé chez TheSportsDB).
// Nouvelle heure à venir → reprogrammé ; toujours rien VOID_AFTER après le début, alors que
// TheSportsDB a répondu (`answered`) → remboursé ; sinon rien, on repassera.
export function withoutResult(m, ev, answered, now) {
  const start = ev ? parseTimestamp(ev) : NaN;
  if (Number.isFinite(start) && start > now) return start !== m.startsAt ? { status: 'scheduled', startsAt: start } : null;
  const at = Number.isFinite(start) ? start : m.startsAt;
  return answered && now - at >= VOID_AFTER ? { status: 'void' } : null;
}

export function createBoxingProvider({ getJson = defaultGetJson, throttle = createThrottle() } = {}) {
  const dayCache = new Map();    // 'AAAA-MM-JJ' → { at, events }
  const nextCheck = new Map();   // matchId → instant de la prochaine vérification
  const get = (url, opts) => throttle.run(() => getJson(url, opts));

  return {
    id: 'tsdb',
    label: 'TheSportsDB',
    real: true,
    refresh: { upcomingMs: 60 * MIN, resultsMs: 10 * MIN },

    async probe() {
      try {
        await get(PROBE_URL, { timeoutMs: 8000 });
        return true;
      } catch {
        return false;
      }
    },

    async fetchUpcoming({ now, existing = [], days = 7 }) {
      const known = new Set(existing.map((m) => m.id));
      const from = now - LOOKBACK;
      const to = now + days * DAY;
      const today = utcDay(now);
      const all = utcDays(from, to);
      // Aujourd'hui et les jours à venir d'abord : en cas de refus, le passé attendra.
      const order = [...all.filter((d) => d >= today), ...all.filter((d) => d < today).reverse()];
      const events = new Map();
      let got = 0;
      let firstErr = null;
      for (const day of order) {
        const hit = dayCache.get(day);
        const near = Math.abs(Date.parse(`${day}T12:00:00Z`) - now) <= LOOKBACK;
        let list = hit && now - hit.at < (near ? NEAR_TTL : FAR_TTL) ? hit.events : null;
        if (!list && !firstErr) {
          try {
            const data = await get(dayUrl(day));
            list = (data?.events || []).filter((e) => String(e?.idLeague) === BOXING_LEAGUE);
            dayCache.set(day, { at: now, events: list });
          } catch (err) {
            firstErr = err; // plus aucune requête pour ce rafraîchissement
          }
        }
        list ??= hit?.events ?? null; // refus ou pause : dernière version connue
        if (!list) continue;
        got += 1;
        for (const ev of list) events.set(String(ev.idEvent), ev);
      }
      if (firstErr) console.warn('[tsdb] liste de boxe incomplète', firstErr);
      if (!got && firstErr) throw firstErr;
      return [...events.values()].map((ev) => toMatch(ev, now, known))
        .filter((m) => m && m.startsAt >= from && m.startsAt <= to);
    },

    async fetchResults({ now, matches }) {
      // Les plus anciens d'abord : ce sont les plus susceptibles d'avoir un résultat saisi,
      // et les plus proches du remboursement.
      const due = matches
        .filter((m) => m.meta?.event && now >= m.startsAt + RESULT_DELAY && now >= (nextCheck.get(m.id) || 0))
        .sort((a, b) => a.startsAt - b.startsAt)
        .slice(0, MAX_CHECKS);
      const updates = [];
      let reached = 0;
      let firstErr = null;
      for (const m of due) {
        let ev;
        try {
          const data = await get(lookupUrl(m.meta.event));
          reached += 1;
          ev = (data?.events || []).find((e) => String(e?.idEvent) === m.meta.event);
        } catch (err) {
          firstErr = err; // rien de lu pour ce combat : aucune mise à jour, surtout pas de remboursement
          break;
        }
        let u = null;
        if (ev && isPostponed(ev)) u = { status: 'void' };
        else {
          let rows = null;
          if (ev) {
            try {
              rows = (await get(resultsUrl(m.meta.event)))?.results || [];
              reached += 1;
            } catch (err) {
              firstErr = err; // on garde le texte de lookupevent
            }
            u = readResult(ev, [m.home.name, m.away.name], rows);
          }
          // Sans résultat : les deux lectures ont répondu (ou l'événement a disparu) pour rembourser.
          u ||= withoutResult(m, ev, !ev || rows !== null, now);
        }
        if (u) updates.push({ matchId: m.id, ...u });
        else nextCheck.set(m.id, now + (now - m.startsAt < LATE_AFTER ? RECHECK_SOON : RECHECK_LATE));
        if (firstErr) break;
      }
      if (!reached && firstErr) throw firstErr;
      return updates;
    },
  };
}
