// Vrais matchs lus depuis l'instantané publié avec l'appli (data/real-matches.json).
// Sert quand la page ne peut pas joindre les sources en direct (par exemple une fois
// publiée sur claude.ai, où les requêtes vers d'autres sites sont bloquées).
// L'instantané est produit par js/tools/snapshot.js à partir des providers en direct.
import { MIN } from '../util.js';
import { setLogos } from '../ui/logos.js';

const SETTLED = new Set(['finished', 'void']);

export function createSnapshotProvider({ url = 'data/real-matches.json' } = {}) {
  let snap = null;
  let loadedAt = 0;

  async function load(force = false) {
    if (snap && !force && Date.now() - loadedAt < MIN) return snap;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Instantané indisponible (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data.matches)) throw new Error('Instantané illisible');
    snap = data;
    setLogos(data.logos);
    loadedAt = Date.now();
    return snap;
  }

  // Une donnée figée n'est jamais "en direct" : un match commencé mais pas encore réglé reste
  // fermé aux paris, sans score figé trompeur, jusqu'au prochain instantané.
  const frozen = (m) => {
    if (SETTLED.has(m.status)) return m;
    if (m.status === 'live') return { ...m, liveScore: null, clock: 'Résultat à venir' };
    return { ...m, status: 'scheduled', liveScore: null, clock: null };
  };

  return {
    id: 'snapshot',
    label: 'Instantané Goalz',
    real: true,
    snapshot: true,
    refresh: { upcomingMs: 10 * MIN, resultsMs: 2 * MIN },

    async available() {
      try { await load(true); return true; } catch { return false; }
    },
    get generatedAt() { return snap?.generatedAt || null; },
    get sources() { return snap?.sources || []; },

    async fetchUpcoming() {
      const data = await load();
      return data.matches.map(frozen);
    },

    async fetchResults({ matches }) {
      const data = await load();
      const byId = new Map(data.matches.map((m) => [m.id, m]));
      const out = [];
      for (const m of matches) {
        const s = byId.get(m.id);
        if (!s) {
          // Sorti de la liste : l'index des résultats le connaît peut-être encore.
          const r = data.results?.[m.id];
          if (r) out.push({ matchId: m.id, status: r[0], outcome: r[1], score: r[2] });
          else if (data.generatedAt > m.startsAt + 4 * 24 * 60 * MIN) out.push({ matchId: m.id, status: 'void' });
          continue;
        }
        if (SETTLED.has(s.status)) out.push({ matchId: m.id, status: s.status, outcome: s.outcome, score: s.score });
        else if (s.startsAt !== m.startsAt) out.push({ matchId: m.id, status: 'scheduled', startsAt: s.startsAt });
      }
      return out;
    },
  };
}
