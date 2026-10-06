// Provider de matchs 100 % fictifs : équipes, horaires, cotes et résultats générés.
// Il respecte l'interface décrite dans providers/index.js.
import { MIN, rand, randInt, pick, clamp, sigmoid, shuffle, uid } from '../util.js';

const team = (name, short, color, rating) => ({ name, short, color, rating });

const CATALOG = {
  football: {
    label: 'Football', icon: '⚽', hasDraw: true, weight: 0.5, duration: 2 * MIN,
    competitions: ['Ligue Étoile', 'Coupe des Volcans', 'Super Ligue Atlantique'],
    teams: [
      team('Olympique Tonnerre', 'OTO', '#ff5a36', 86),
      team('FC Lumière', 'FCL', '#ffd23f', 82),
      team('Real Mistral', 'RMI', '#e8e8e8', 83),
      team('Sporting Comète', 'SCO', '#9d7bff', 80),
      team('AS Marée Haute', 'AMH', '#00c2d1', 78),
      team('Atlético Sirocco', 'ATS', '#e84a5f', 77),
      team('Dynamo Éclair', 'DYE', '#f5f542', 76),
      team('Racing Brume', 'RCB', '#7aa2ff', 74),
      team('Union Granit', 'UGR', '#b0b8c4', 72),
      team('Kickers Boréal', 'KBO', '#5ad1ff', 71),
      team('Stade Aurore', 'SAU', '#ff8fb1', 70),
      team('US Forêt-Noire', 'UFN', '#2ecc71', 68),
    ],
    probs(h, a) {
      const d = (h - a + 3) / 12; // +3 : avantage du terrain
      const pDraw = clamp(0.28 - Math.abs(d) * 0.06, 0.16, 0.3);
      const p1 = (1 - pDraw) * sigmoid(d * 1.1);
      return { 1: p1, X: pDraw, 2: 1 - pDraw - p1 };
    },
    score(outcome) {
      if (outcome === 'X') { const g = randInt(0, 3); return `${g} - ${g}`; }
      const w = randInt(1, 4), l = randInt(0, w - 1);
      return outcome === '1' ? `${w} - ${l}` : `${l} - ${w}`;
    },
  },
  basketball: {
    label: 'Basket', icon: '🏀', hasDraw: false, weight: 0.25, duration: 2 * MIN,
    competitions: ['Pro League Néon', 'Coupe du Parquet'],
    teams: [
      team('Aigles Néon', 'AIG', '#3dff8a', 85),
      team('Loups d\'Argent', 'LOU', '#c0c7d1', 83),
      team('Frelons Volcaniques', 'FRE', '#ff8a1f', 81),
      team('Requins du Port', 'REQ', '#2f8cff', 79),
      team('Bisons Électriques', 'BIS', '#f5f542', 77),
      team('Faucons de Minuit', 'FAU', '#8f6bff', 75),
      team('Panthères Solaires', 'PAN', '#ffb13d', 74),
      team('Albatros Rapides', 'ALB', '#5ad1ff', 72),
      team('Ours Polaires', 'OUR', '#e8f4ff', 70),
      team('Cobras Urbains', 'COB', '#e84a5f', 69),
    ],
    probs(h, a) {
      const p1 = clamp(sigmoid((h - a + 3) / 7), 0.08, 0.92);
      return { 1: p1, 2: 1 - p1 };
    },
    score(outcome) {
      const l = randInt(82, 112), w = l + randInt(1, 22);
      return outcome === '1' ? `${w} - ${l}` : `${l} - ${w}`;
    },
  },
  tennis: {
    label: 'Tennis', icon: '🎾', hasDraw: false, weight: 0.25, duration: 2 * MIN,
    competitions: ['Open de la Baie', 'Masters des Cimes', 'Trophée Azur'],
    teams: [
      team('L. Moreau', 'MOR', '#3dff8a', 86),
      team('K. Andersen', 'AND', '#ff8a1f', 84),
      team('T. Okafor', 'OKA', '#5ad1ff', 82),
      team('M. Rossi', 'ROS', '#e84a5f', 80),
      team('S. Tanaka', 'TAN', '#ffd23f', 79),
      team('A. Novak', 'NOV', '#9d7bff', 77),
      team('J. Delacroix', 'DEL', '#2f8cff', 75),
      team('R. Silva', 'SIL', '#2ecc71', 74),
      team('E. Varga', 'VAR', '#ff8fb1', 72),
      team('D. Kowalski', 'KOW', '#c0c7d1', 70),
    ],
    probs(h, a) {
      const p1 = clamp(sigmoid((h - a) / 6), 0.1, 0.9);
      return { 1: p1, 2: 1 - p1 };
    },
    score(outcome) {
      const winSet = () => { const r = Math.random(); return r < 0.15 ? [7, 6] : r < 0.3 ? [7, 5] : [6, randInt(0, 4)]; };
      const pattern = Math.random() < 0.4 ? pick([['L', 'W', 'W'], ['W', 'L', 'W']]) : ['W', 'W'];
      const sets = pattern.map((p) => (p === 'W' ? winSet() : winSet().reverse()));
      return sets.map(([w, l]) => (outcome === '1' ? `${w}-${l}` : `${l}-${w}`)).join('  ');
    },
  },
};

const MARGIN = 1.07; // marge du "bookmaker" : les cotes sont un peu en dessous du juste prix

function pickSport() {
  let r = Math.random();
  for (const [key, cat] of Object.entries(CATALOG)) {
    if ((r -= cat.weight) <= 0) return key;
  }
  return 'football';
}

function sampleOutcome(probs) {
  let r = Math.random();
  for (const [k, p] of Object.entries(probs)) {
    if ((r -= p) <= 0) return k;
  }
  return Object.keys(probs)[0];
}

function generateMatch(sport, startsAt) {
  const cat = CATALOG[sport];
  const [home, away] = shuffle(cat.teams);
  const probs = cat.probs(home.rating, away.rating);
  const odds = {};
  for (const [k, p] of Object.entries(probs)) {
    odds[k] = Math.max(1.05, Math.round(100 / (p * MARGIN)) / 100);
  }
  const strip = ({ name, short, color }) => ({ name, short, color });
  return {
    id: uid('fake'),
    source: 'fake',
    real: false,
    sport,
    competition: pick(cat.competitions),
    home: strip(home),
    away: strip(away),
    startsAt,
    endsAt: startsAt + cat.duration,
    odds,
    oddsSource: 'fake',
    status: 'scheduled',
    outcome: null,
    score: null,
    meta: { probs }, // données privées du provider
  };
}

export function createFakeProvider() {
  return {
    id: 'fake',
    label: 'Matchs fictifs',
    real: false,
    refresh: { upcomingMs: 3000, resultsMs: 3000 },

    // Complète la liste pour garder CONFIG.UPCOMING_TARGET matchs à venir.
    async fetchUpcoming({ now, existing, target }) {
      const upcoming = existing.filter((m) => now < m.startsAt);
      const missing = target - upcoming.length;
      if (missing <= 0) return [];
      let cursor = Math.max(now, ...upcoming.map((m) => m.startsAt));
      const out = [];
      for (let i = 0; i < missing; i++) {
        cursor += randInt(1, 5) * MIN + rand(0, 30_000);
        const kickoff = Math.ceil(cursor / MIN) * MIN; // coup d'envoi à la minute pile
        out.push(generateMatch(pickSport(), kickoff));
      }
      return out;
    },

    async fetchResults({ now, matches }) {
      return matches
        .filter((m) => now >= m.endsAt)
        .map((m) => {
          const outcome = sampleOutcome(m.meta.probs);
          return { matchId: m.id, status: 'finished', outcome, score: CATALOG[m.sport].score(outcome) };
        });
    },
  };
}
