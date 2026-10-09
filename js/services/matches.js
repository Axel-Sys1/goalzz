// Synchronisation avec les providers : ajoute et met à jour les matchs,
// récupère les résultats, règle les paris et verse les gains.
// Chaque provider a son propre rythme (quelques secondes pour les fictifs,
// une à quinze minutes pour les vrais matchs).
import { CONFIG } from '../config.js';
import { getState, update, emit, now, realNow } from '../store.js';
import { MIN } from '../util.js';
import { providers, realProviders, fakeProvider, initProviders, owns } from '../providers/index.js';
import { settleMatch, betMatchIds, reviewLiveBets } from './bets.js';
import { simulateBots } from './bots.js';
import { matchStatus, matchTitle } from './matchInfo.js';
import { frenchTeamName } from '../countries.js';
import { LIVE_SPORTS } from '../providers/liveOdds.js';

const HOUR = 60 * MIN;
const RETRY_MS = 60_000;
const CONFIRM_GAP_MS = 20_000; // écart minimal entre les deux lectures d'un résultat
const OUTCOMES = new Set(['1', 'X', '2']);

// État réseau par provider (non persisté).
const feed = {};
const feedOf = (p) => (feed[p.id] ||= { nextUpcoming: 0, nextResults: 0, inflight: false, loading: false, error: null, lastOk: 0 });

const clockOf = (p) => (p.real ? realNow() : now());
const isSettled = (m) => m.status === 'finished' || m.status === 'void';

let ready = false;

// Choisit les sources (direct ou instantané) puis lance la première synchronisation.
export async function startSync() {
  await initProviders();
  ready = true;
  emit();
  await syncAll();
}

export function realFeedState() {
  if (!ready) return { configured: true, loading: true, error: null, lastOk: 0, sources: [], snapshotAt: null };
  if (!realProviders.length) return { configured: false, loading: false, error: null, lastOk: 0, sources: [], snapshotAt: null };
  const states = realProviders.map(feedOf);
  const snap = realProviders.find((p) => p.snapshot);
  return {
    configured: true,
    loading: states.some((f) => f.loading),
    error: states.every((f) => f.error) ? states.map((f) => f.error).join(' · ') : null,
    lastOk: Math.max(...states.map((f) => f.lastOk)),
    sources: snap ? snap.sources : realProviders.map((p) => p.label),
    snapshotAt: snap ? snap.generatedAt : null,
  };
}

export async function syncAll({ force = false, only = null } = {}) {
  if (!ready) return;
  const list = providers.filter((p) => !only || only(p));
  await Promise.all(list.map((p) => syncProvider(p, force)));
  maybeSimulateBots();
}

async function syncProvider(p, force) {
  const f = feedOf(p);
  if (f.inflight) return;
  const wall = Date.now();
  const t = clockOf(p);
  const mine = Object.values(getState().matches).filter((m) => owns(p, m) && !isSettled(m));
  // Les vrais matchs sont suivis un peu avant l'heure prévue (avance de coup d'envoi, statut en direct).
  const started = mine.filter((m) => t >= m.startsAt - (p.real ? 5 * MIN : 0));
  const dueUpcoming = force || wall >= f.nextUpcoming;
  const dueResults = started.length > 0 && (force || wall >= f.nextResults);
  if (!dueUpcoming && !dueResults) return;

  f.inflight = true;
  const firstLoad = p.real && dueUpcoming && !f.lastOk;
  if (firstLoad) { f.loading = true; emit(); }

  const [fresh, updates] = await Promise.allSettled([
    dueUpcoming ? p.fetchUpcoming({ now: t, existing: mine, target: CONFIG.UPCOMING_TARGET, days: CONFIG.REAL_DAYS_AHEAD }) : [],
    dueResults ? p.fetchResults({ now: t, matches: started }) : [],
  ]);

  if (dueUpcoming) {
    if (fresh.status === 'fulfilled') { f.nextUpcoming = wall + p.refresh.upcomingMs; f.lastOk = wall; f.error = null; }
    else { f.nextUpcoming = wall + RETRY_MS; f.error = fresh.reason?.message || 'Source indisponible'; console.warn(`[${p.id}] fetchUpcoming`, fresh.reason); }
  }
  if (dueResults) {
    const live = started.some((m) => m.status === 'live');
    const interval = live ? p.refresh.resultsMs : (p.refresh.idleResultsMs || p.refresh.resultsMs);
    if (updates.status === 'fulfilled') f.nextResults = wall + interval;
    else { f.nextResults = wall + RETRY_MS; console.warn(`[${p.id}] fetchResults`, updates.reason); }
  }

  const freshList = fresh.status === 'fulfilled' ? fresh.value || [] : [];
  const updateList = updates.status === 'fulfilled' ? updates.value || [] : [];
  f.inflight = false;
  f.loading = false;

  let changed = false;
  if (freshList.length || updateList.length) {
    update((s) => {
      for (const m of freshList) changed = upsertMatch(s, m, p) || changed;
      // L'instantané ne contient que des résultats déjà lus deux fois par tools/update_snapshot.py.
      for (const u of updateList) changed = applyUpdate(s, u, { trusted: !!p.snapshot }) || changed;
      if (changed) {
        dropStartedFromSlips(s);
        prune(s, p);
      }
    }, { silent: true });
  }
  if (changed || firstLoad) emit();
}

function upsertMatch(s, incoming, p) {
  const cur = s.matches[incoming.id];
  // La source d'origine est conservée : un match ESPN reste un match ESPN, même lu via l'instantané.
  const m = { outcome: null, score: null, meta: {}, ...incoming, source: cur?.source || incoming.source || p.id, real: !!p.real };
  for (const side of ['home', 'away']) if (m[side]?.name) m[side] = { ...m[side], name: frenchTeamName(m[side].name) };
  if (cur && isSettled(cur)) return false;

  // Un match déjà terminé à la découverte, ou terminé entre deux rafraîchissements.
  if (m.status === 'finished' || m.status === 'void') {
    if (!cur) {
      if (m.status === 'finished' && !OUTCOMES.has(m.outcome)) return false;
      s.matches[m.id] = { ...m, status: 'scheduled', outcome: null };
    }
    // Découvert déjà terminé : aucun pari n'a pu être placé dessus, inutile de confirmer.
    return applyUpdate(s, { matchId: m.id, status: m.status, outcome: m.outcome, score: m.score }, { trusted: !cur || !!p.snapshot });
  }

  if (!cur) { s.matches[m.id] = m; return true; }
  // Match en cours : score et horloge ne viennent que de fetchResults (applyUpdate date leurs changements).
  if (cur.status === 'live') { delete m.liveScore; delete m.clock; delete m.status; }
  const next = { ...cur, ...m, meta: { ...cur.meta, ...m.meta } };
  if (JSON.stringify(next) === JSON.stringify(cur)) return false;
  s.matches[m.id] = next;
  return true;
}

function applyUpdate(s, u, { trusted = false } = {}) {
  const m = s.matches[u.matchId];
  if (!m || isSettled(m)) return false;
  const settledAt = m.real ? realNow() : now();

  // Vrais matchs : un résultat (ou une annulation) doit être lu deux fois de suite,
  // car les sources publient parfois un statut erroné pendant quelques secondes.
  const terminal = (u.status === 'finished' && OUTCOMES.has(u.outcome)) || u.status === 'void';
  if (m.real && terminal && !trusted) {
    const key = `${u.status}|${u.outcome ?? ''}|${u.score ?? ''}`;
    const wall = Date.now();
    // Deux lectures identiques, espacées d'au moins CONFIRM_GAP_MS (deux requêtes du même
    // instant ne comptent que pour une).
    if (m.pendingFinal?.key !== key) {
      m.pendingFinal = { key, at: wall };
      if (u.status === 'finished' && u.score) m.liveScore = u.score;
      return true;
    }
    if (wall - m.pendingFinal.at < CONFIRM_GAP_MS) return false;
  } else if (m.pendingFinal && !terminal) {
    delete m.pendingFinal;
  }

  if (u.status === 'finished' && OUTCOMES.has(u.outcome)) {
    // Nul sur un pari à 2 issues (MMA, boxe, basket…) : remboursé.
    const outcome = m.odds[u.outcome] ? u.outcome : 'void';
    Object.assign(m, { status: 'finished', outcome, score: u.score ?? m.liveScore ?? m.score, liveScore: null, clock: null, finishedAt: settledAt });
    delete m.pendingFinal;
    settleMatch(s, m);
    if (!m.real) simulateBots(s, 1);
    return true;
  }
  if (u.status === 'void') {
    Object.assign(m, { status: 'void', outcome: 'void', score: u.score ?? null, liveScore: null, clock: null, finishedAt: settledAt });
    delete m.pendingFinal;
    settleMatch(s, m);
    return true;
  }

  const before = JSON.stringify([m.status, m.liveScore, m.clock, m.startsAt]);
  if (u.status === 'live' || u.status === 'scheduled') m.status = u.status;
  // Cotes d'avant-match figées au coup d'envoi : base des cotes en direct (voir providers/liveOdds.js).
  if (m.status === 'live' && !m.kickoffOdds) m.kickoffOdds = { ...m.odds };
  // Heures (horloge du match) des derniers changements : suspension après un but, minute en cours…
  if (u.liveScore !== undefined && u.liveScore !== m.liveScore) {
    if (m.liveScore != null) m.scoreAt = settledAt;
    m.liveScore = u.liveScore;
  }
  if (u.clock !== undefined && u.clock !== m.clock) { m.clock = u.clock; m.clockAt = settledAt; }
  if (u.meta) m.meta = { ...m.meta, ...u.meta };
  if (u.startsAt) m.startsAt = u.startsAt;
  if (m.real) {
    m.seenAt = settledAt;
    reviewLiveBets(s, m, settledAt);
  }
  return before !== JSON.stringify([m.status, m.liveScore, m.clock, m.startsAt]);
}

export function fastForward(minutes = CONFIG.FAST_FORWARD_MIN) {
  update((s) => { s.clockOffset = (s.clockOffset || 0) + minutes * MIN; });
  return syncAll({ force: true, only: (p) => p === fakeProvider });
}

export const refreshReal = () => syncAll({ force: true, only: (p) => p.real });

// Sélections d'avant-match retirées au coup d'envoi (la cote n'est plus valable) ; sélections en direct
// retirées à la fin du match.
function dropStartedFromSlips(s) {
  for (const p of Object.values(s.players)) {
    const kept = [];
    for (const x of p.slip) {
      const m = s.matches[x.matchId];
      const status = m && matchStatus(m);
      if (status === 'upcoming' || (x.live && status === 'live')) kept.push(x);
      else if (m && x.live) p.inbox.push({ type: 'info', text: `${matchTitle(m)} est terminé : retiré de ton panier.` });
      else if (m) {
        const again = LIVE_SPORTS.has(m.sport) ? ' Tu peux le rejouer en direct.' : '';
        p.inbox.push({ type: 'info', text: `${matchTitle(m)} a commencé : retiré de ton panier.${again}` });
      }
    }
    p.slip = kept;
  }
}

function prune(s, p) {
  const referenced = new Set(Object.values(s.bets).flatMap(betMatchIds));
  for (const pl of Object.values(s.players)) pl.slip.forEach((x) => referenced.add(x.matchId));
  const mine = Object.values(s.matches).filter((m) => owns(p, m) && !referenced.has(m.id));

  if (!p.real) {
    mine.filter(isSettled)
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(CONFIG.RECENT_FINISHED)
      .forEach((m) => delete s.matches[m.id]);
    return;
  }
  const t = realNow();
  for (const m of mine) {
    const old = isSettled(m)
      ? (m.finishedAt || m.startsAt) < t - CONFIG.REAL_FINISHED_KEEP_H * HOUR
      : m.startsAt < t - CONFIG.REAL_STALE_H * HOUR;
    if (old) delete s.matches[m.id];
  }
}

// Les bots jouent au fil du temps réel (un "tour" toutes les 5 minutes).
function maybeSimulateBots() {
  const s = getState();
  const t = Date.now();
  if (!s.botsSimAt) { update((st) => { st.botsSimAt = t; }, { silent: true }); return; }
  const rounds = Math.min(24, Math.floor((t - s.botsSimAt) / (5 * MIN)));
  if (rounds <= 0) return;
  update((st) => { simulateBots(st, rounds); st.botsSimAt += rounds * 5 * MIN; }, { silent: true });
}
