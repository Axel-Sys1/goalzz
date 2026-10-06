// Produit data/real-matches.json à partir des providers en direct.
// Deux façons de le lancer :
// - sans navigateur (automatique) : python3 tools/update_snapshot.py
// - depuis la page servie par serve.py (le serveur enregistre le fichier) :
//     const { buildSnapshot } = await import('./js/tools/snapshot.js');
//     await buildSnapshot();
// Chaque instantané repart du précédent : les matchs non réglés y sont revérifiés,
// ce qui permet de régler les paris placés sur la version publiée.
import { CONFIG } from '../config.js';
import { MIN } from '../util.js';
import { liveProviders } from '../providers/index.js';

const HOUR = 60 * MIN;
const KEEP_SETTLED_H = 96;   // matchs réglés conservés 4 jours dans la liste
const KEEP_RESULTS_D = 30;   // index compact des résultats conservé 30 jours (paris placés avant)
// Filet de sécurité : chaque source rembourse déjà elle-même ses matchs sans issue (36 h à
// 4 jours selon le sport). Ce délai ne sert que si une source se tait complètement.
const VOID_AFTER_H = 240;
const CONFIRM_DELAY_MS = 20_000;
const SETTLED = new Set(['finished', 'void']);
const OUTCOMES = new Set(['1', 'X', '2']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const terminalKey = (u) => (u.status === 'void' || (u.status === 'finished' && OUTCOMES.has(u.outcome))
  ? `${u.status}|${u.outcome ?? ''}|${u.score ?? ''}` : null);

async function loadPrevious(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* premier instantané */ }
  return { matches: [] };
}

// Options (utilisées par l'outil sans navigateur) :
// - previous : instantané précédent déjà chargé ; save: false pour récupérer { report, snapshot }
// - providers / confirmProviders : sources de la 1re et de la 2e lecture des résultats
// - now, confirmDelayMs : heure de référence et écart entre les deux lectures
export async function buildSnapshot({
  url = 'data/real-matches.json',
  save = true,
  previous = null,
  providers = liveProviders,
  confirmProviders = providers,
  now = Date.now(),
  confirmDelayMs = CONFIRM_DELAY_MS,
} = {}) {
  if (!providers.length) throw new Error('Aucune source en direct : instantané non généré.');
  const prev = previous || await loadPrevious(url);
  const byId = new Map(prev.matches.map((m) => [m.id, m]));
  const results = { ...(prev.results || {}) };
  const aliases = { ...(prev.aliases || {}) }; // ancien id → nouvel id du même match
  const report = { providers: {}, errors: [] };
  const resultsOk = new Set(); // providers dont la vérification des résultats a réussi

  for (const [i, p] of providers.entries()) {
    const confirmWith = confirmProviders[i] || p;
    const r = (report.providers[p.id] = { fresh: 0, settled: 0, voided: 0 });
    const unsettled = () => [...byId.values()].filter((m) => m.source === p.id && !SETTLED.has(m.status));

    try {
      const fresh = await p.fetchUpcoming({ now, existing: unsettled(), days: CONFIG.REAL_DAYS_AHEAD });
      for (const inc of fresh) {
        const cur = byId.get(inc.id);
        if (cur && SETTLED.has(cur.status)) continue;
        const merged = { outcome: null, score: null, meta: {}, ...cur, ...inc, source: cur?.source || inc.source || p.id, real: true };
        // Un résultat lu dans la liste ne suffit pas pour un match déjà connu (des paris
        // peuvent exister) : il passera par la double lecture de fetchResults ci-dessous.
        if (cur && SETTLED.has(inc.status)) Object.assign(merged, { status: 'live', outcome: null, score: cur.score ?? null });
        byId.set(inc.id, merged);
      }
      r.fresh = fresh.length;
    } catch (err) {
      report.errors.push(`${p.id} fetchUpcoming : ${err.message}`);
    }

    // Deux lectures espacées : on ne garde un résultat que s'il est identique aux deux.
    const started = unsettled().filter((m) => now >= m.startsAt - 5 * MIN);
    if (!started.length) { resultsOk.add(p.id); continue; }
    try {
      const first = await p.fetchResults({ now, matches: started });
      const firstKeys = new Map(first.map((u) => [u.matchId, terminalKey(u)]));
      const toConfirm = started.filter((m) => firstKeys.get(m.id));
      if (toConfirm.length && confirmDelayMs > 0) await sleep(confirmDelayMs);
      const second = toConfirm.length ? await confirmWith.fetchResults({ now: now + confirmDelayMs, matches: toConfirm }) : [];
      const confirmed = new Map(second.filter((u) => terminalKey(u) && terminalKey(u) === firstKeys.get(u.matchId)).map((u) => [u.matchId, u]));
      resultsOk.add(p.id);

      for (const u of first) {
        const m = byId.get(u.matchId);
        if (!m) continue;
        const done = confirmed.get(u.matchId);
        if (done) {
          Object.assign(m, { status: done.status, outcome: done.status === 'void' ? 'void' : done.outcome, score: done.score ?? m.score ?? null, liveScore: null, clock: null, finishedAt: now });
          r[done.status === 'void' ? 'voided' : 'settled'] += 1;
        } else if (!terminalKey(u)) {
          if (u.status === 'live' || u.status === 'scheduled') m.status = u.status;
          if (u.liveScore !== undefined) m.liveScore = u.liveScore;
          if (u.clock !== undefined) m.clock = u.clock;
          if (u.startsAt) m.startsAt = u.startsAt;
        }
      }
    } catch (err) {
      report.errors.push(`${p.id} fetchResults : ${err.message}`);
    }
  }

  // Anciens ids MMA (sans les combattants, instantanés jusqu'au 27/09/2026) : remplacés par le
  // nouvel id du même duel ; le résultat du nouveau sera recopié sous l'ancien (paris déjà placés).
  for (const [id, m] of byId) {
    if (m.sport !== 'mma' || /_\d+_\d+$/.test(id)) continue;
    const twin = [...byId.values()].find((x) => x.id.startsWith(`${id}_`) && x.home?.name === m.home?.name && x.away?.name === m.away?.name);
    if (!twin) continue;
    if (SETTLED.has(m.status)) results[id] = [m.status, m.outcome, m.score ?? null, m.finishedAt || now];
    byId.delete(id);
    aliases[id] = twin.id;
  }

  // Nettoyage : réglés trop anciens retirés de la liste (leur résultat reste dans l'index) ;
  // sans nouvelles depuis trop longtemps ET source vérifiée avec succès : remboursés.
  for (const [id, m] of byId) {
    if (SETTLED.has(m.status)) {
      results[id] = [m.status, m.outcome, m.score ?? null, m.finishedAt || now];
      if ((m.finishedAt || m.startsAt) < now - KEEP_SETTLED_H * HOUR) byId.delete(id);
    } else if (m.startsAt < now - VOID_AFTER_H * HOUR && resultsOk.has(m.source) && m.status !== 'live') {
      Object.assign(m, { status: 'void', outcome: 'void', liveScore: null, clock: null, finishedAt: now });
      results[id] = ['void', 'void', null, now];
    }
  }
  for (const [oldId, newId] of Object.entries(aliases)) {
    if (results[newId]) results[oldId] = results[newId];
  }
  for (const [id, r] of Object.entries(results)) {
    if (r[3] < now - KEEP_RESULTS_D * 24 * HOUR) delete results[id];
  }
  for (const [oldId, newId] of Object.entries(aliases)) {
    if (!results[oldId] && !byId.has(newId) && !results[newId]) delete aliases[oldId]; // piste perdue
  }

  const snapshot = {
    version: 1,
    generatedAt: now,
    sources: providers.map((p) => p.label),
    matches: [...byId.values()].sort((a, b) => a.startsAt - b.startsAt),
    results, // { id: [status, outcome, score, finishedAt] }
    aliases,
  };
  report.total = snapshot.matches.length;
  report.upcoming = snapshot.matches.filter((m) => !SETTLED.has(m.status) && m.startsAt > now).length;

  if (!save) return { report, snapshot };
  const res = await fetch('/__snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) throw new Error(`Enregistrement refusé (${res.status}) : lancez l'appli avec serve.py`);
  return report;
}
