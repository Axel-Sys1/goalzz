// Provider "ESPN" : réunit les adaptateurs par famille de sports (voir providers/index.js
// pour le contrat). Chaque adaptateur marque ses matchs avec meta.adapter, ce qui permet
// de lui renvoyer ses propres matchs au moment de chercher les résultats.
import { MIN } from '../../util.js';
import { defaultGetJson, settleAll } from './common.js';
import { createTeamSportsAdapter } from './teamSports.js';
import { createTennisAdapter } from './tennis.js';
import { createMmaAdapter } from './mma.js';

// Réponses gardées 15 s et requêtes en cours partagées : la liste et les résultats d'une même
// synchronisation lisent souvent le même flux. (Plus court que l'écart de 20 s exigé entre
// les deux lectures d'un résultat.)
function memoize(getJson, ttlMs = 15_000) {
  const cache = new Map();
  return (url, opts) => {
    const t = Date.now();
    const hit = cache.get(url);
    if (hit && t - hit.at < ttlMs) return hit.promise;
    if (cache.size > 200) for (const [k, v] of cache) if (t - v.at >= ttlMs) cache.delete(k);
    const promise = getJson(url, opts);
    cache.set(url, { at: t, promise });
    promise.catch(() => cache.delete(url));
    return promise;
  };
}

export function createEspnProvider({ getJson: rawGetJson = defaultGetJson, adapters = null } = {}) {
  const getJson = memoize(rawGetJson);
  const list = adapters || [
    createTeamSportsAdapter({ getJson }),
    createTennisAdapter({ getJson }),
    createMmaAdapter({ getJson }),
  ];
  const byKey = new Map(list.map((a) => [a.key, a]));

  return {
    id: 'espn',
    label: 'ESPN',
    real: true,
    // 30 s pendant les matchs : les cotes en direct suivent le score.
    refresh: { upcomingMs: 15 * MIN, resultsMs: 30_000, idleResultsMs: 3 * MIN },

    async probe() {
      const url = list.find((a) => a.probeUrl)?.probeUrl;
      if (!url) return true;
      try {
        await getJson(url, { timeoutMs: 8000 });
        return true;
      } catch {
        return false;
      }
    },

    async fetchUpcoming({ now, days }) {
      const { ok, failed } = await settleAll(list.map((a) => () => a.upcoming({ now, days })), list.length);
      failed.forEach((err) => console.warn('[espn] liste incomplète', err));
      if (!ok.length && failed.length) throw failed[0];
      return ok.flat();
    },

    async fetchResults({ now, matches }) {
      const groups = new Map();
      for (const m of matches) {
        const a = byKey.get(m.meta?.adapter);
        if (!a) continue;
        if (!groups.has(a)) groups.set(a, []);
        groups.get(a).push(m);
      }
      const tasks = [...groups].map(([a, ms]) => () => a.results({ now, matches: ms }));
      const { ok, failed } = await settleAll(tasks, tasks.length || 1);
      failed.forEach((err) => console.warn('[espn] résultats incomplets', err));
      if (!ok.length && failed.length) throw failed[0];
      return ok.flat();
    },
  };
}
