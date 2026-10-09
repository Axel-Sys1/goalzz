// Provider de matchs 100 % fictifs : équipes, horaires, cotes et matchs simulés en direct.
// Il respecte l'interface décrite dans providers/index.js.
//
// Le score avance pendant le match, au fil des fetchResults, avec le modèle des cotes en direct
// (providers/liveOdds.js) et les mêmes paramètres (meta.model) : ni les cotes d'avant-match ni les
// cotes en direct ne sont battables. Rien n'est tiré à l'avance : chaque appel joue seulement le
// temps écoulé depuis le précédent, et l'état courant (meta.sim) ne contient aucun futur.
import { MIN, rand, randInt, pick, clamp, sigmoid, shuffle, uid } from '../util.js';
import { devig, fromProbabilities } from './odds.js';
import { fitParams, liveProbs } from './liveOdds.js';

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
  },
  tennis: {
    label: 'Tennis', icon: '🎾', hasDraw: false, weight: 0.25, duration: 2 * MIN, // durée estimée
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
  },
};

// ─── Tirages ─────────────────────────────────────────────────────────────────
// Loi de Poisson (méthode de Knuth ; les grandes moyennes sont découpées).
function poissonDraw(lambda) {
  if (!(lambda > 0)) return 0;
  if (lambda > 30) return poissonDraw(lambda / 2) + poissonDraw(lambda / 2);
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = Math.random();
  while (p > limit) { k++; p *= Math.random(); }
  return k;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const elapsedShare = (m, now) => (now - m.startsAt) / (m.endsAt - m.startsAt);
const winner = ([h, a]) => (h > a ? '1' : h < a ? '2' : 'X');

// ─── Simulations par sport ───────────────────────────────────────────────────
// start() : état au coup d'envoi · target(m, now) : avancement visé · advance(sim, model, to) ·
// view(sim) : { liveScore, clock } au format ESPN · outcome(sim) quand sim.done.

// Football : 90 minutes de jeu étalées sur la durée du match, buts ~ Poisson(λ/90) chaque minute.
const FOOTBALL = {
  start: () => ({ min: 0, score: [0, 0] }),
  target: (m, now) => clamp(Math.floor(90 * elapsedShare(m, now)), 0, 90),
  advance(sim, model, to) {
    for (; sim.min < to; sim.min++) {
      sim.score[0] += poissonDraw(model.lh / 90);
      sim.score[1] += poissonDraw(model.la / 90);
    }
    if (sim.min >= 90) sim.done = true;
  },
  view: (sim) => ({ liveScore: `${sim.score[0]} - ${sim.score[1]}`, clock: `${sim.min}'` }),
  outcome: (sim) => winner(sim.score),
};

// Basket : 48 minutes (secondes entières), marge ~ marche aléatoire de moyenne μ et de variance σ² sur le
// match (Poisson(a) − Poisson(b) par minute), plus des paniers « échangés » qui ne changent pas la marge
// (total ≈ 215 points). Égalité au buzzer : prolongations de 5 minutes à la même cadence.
const BASKET_TOTAL = 215;
const QUARTER = 12 * 60;
const REGULATION = 4 * QUARTER;
const OVERTIME = 5 * 60;

function basketRates(model) {
  const minutes = model.minutes || 48;
  const spread = (model.sigma * model.sigma) / minutes;
  const drift = model.mu / minutes;
  return {
    a: Math.max(0, (spread + drift) / 2),
    b: Math.max(0, (spread - drift) / 2),
    c: Math.max(0, (BASKET_TOTAL / minutes - spread) / 2),
  };
}

const BASKETBALL = {
  start: () => ({ sec: 0, end: REGULATION, score: [0, 0] }),
  target: (m, now) => Math.max(0, Math.floor(REGULATION * elapsedShare(m, now))),
  advance(sim, model, to) {
    const r = basketRates(model);
    while (!sim.done && sim.sec < to) {
      const next = Math.min(to, sim.end);
      const dt = (next - sim.sec) / 60;
      const both = poissonDraw(r.c * dt);
      sim.score[0] += poissonDraw(r.a * dt) + both;
      sim.score[1] += poissonDraw(r.b * dt) + both;
      sim.sec = next;
      if (sim.sec === sim.end) {
        if (sim.score[0] !== sim.score[1]) sim.done = true;
        else sim.end += OVERTIME;
      }
    }
  },
  view(sim) {
    const liveScore = `${sim.score[0]} - ${sim.score[1]}`;
    if (sim.sec >= REGULATION) return { liveScore, clock: `Prol. ${mmss(sim.end - sim.sec)}` };
    const q = Math.min(4, Math.floor(sim.sec / QUARTER) + 1);
    return { liveScore, clock: `Q${q} ${mmss(q * QUARTER - sim.sec)}` };
  },
  outcome: (sim) => winner(sim.score),
};

// Tennis : un jeu toutes les 5 s, gagné avec la proba g ; tie-break à 6-6, sets gagnants selon bestOf.
const GAME_MS = 5000;
const setOver = ([a, b]) => Math.max(a, b) === 7 || (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2);
const setsWon = (sets) => sets.filter(setOver).reduce((w, [a, b]) => (a > b ? [w[0] + 1, w[1]] : [w[0], w[1] + 1]), [0, 0]);
const setText = ([a, b, tb]) => `${a}-${b}${tb !== undefined ? `(${tb})` : ''}`;

const TENNIS = {
  start: () => ({ games: 0, sets: [[0, 0]] }),
  target: (m, now) => Math.max(0, Math.floor((now - m.startsAt) / GAME_MS)),
  advance(sim, model, to) {
    const need = Math.ceil((model.bestOf || 3) / 2);
    for (; !sim.done && sim.games < to; sim.games++) {
      const set = sim.sets[sim.sets.length - 1];
      set[Math.random() < model.g ? 0 : 1]++;
      if (!setOver(set)) continue;
      if (Math.min(set[0], set[1]) === 6) set.push(randInt(0, 6)); // points du perdant du tie-break
      const won = setsWon(sim.sets);
      if (Math.max(...won) >= need) sim.done = true;
      else sim.sets.push([0, 0]);
    }
  },
  view(sim) {
    const n = sim.sets.length;
    return { liveScore: sim.sets.map(setText).join(' '), clock: `${n === 1 ? '1er' : `${n}e`} set` };
  },
  outcome: (sim) => winner(setsWon(sim.sets)),
};

const SIMS = { football: FOOTBALL, basketball: BASKETBALL, tennis: TENNIS };

// Pseudo-match au coup d'envoi, pour lire les cotes en direct de départ.
const KICKOFF = {
  football: { liveScore: '0 - 0', clock: "0'" },
  basketball: { liveScore: '0 - 0', clock: 'Q1 12:00' },
  tennis: { liveScore: '0-0', clock: '1er set' },
};

// Modèle des matchs créés avant les paris en direct : ajusté sur leurs probabilités d'origine.
const modelOf = (m) => m.meta?.model || fitParams(m.sport, m.meta?.probs || devig(m.odds) || { 1: 0.5, 2: 0.5 });

// Joue le temps écoulé depuis la dernière simulation → Update.
function simulate(m, now) {
  const kind = SIMS[m.sport];
  const model = modelOf(m);
  const sim = m.meta?.sim ? JSON.parse(JSON.stringify(m.meta.sim)) : kind.start();
  kind.advance(sim, model, kind.target(m, now));
  sim.at = now;
  const view = kind.view(sim);
  if (sim.done) return { matchId: m.id, status: 'finished', outcome: kind.outcome(sim), score: view.liveScore };
  return { matchId: m.id, status: 'live', ...view, meta: m.meta?.model ? { sim } : { sim, model } };
}

// ─── Matchs à venir ──────────────────────────────────────────────────────────
function pickSport() {
  let r = Math.random();
  for (const [key, cat] of Object.entries(CATALOG)) {
    if ((r -= cat.weight) <= 0) return key;
  }
  return 'football';
}

function generateMatch(sport, startsAt) {
  const cat = CATALOG[sport];
  const [home, away] = shuffle(cat.teams);
  const probs = cat.probs(home.rating, away.rating);
  const model = fitParams(sport, probs);
  // Cotes d'avant-match = cotes en direct au coup d'envoi (même modèle, même marge).
  const odds = fromProbabilities(liveProbs({ sport, real: false, startsAt, odds: probs, ...KICKOFF[sport], meta: { model } }, startsAt));
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
    meta: { model }, // données privées du provider
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

    // Matchs commencés : score en direct ({ status: 'live', liveScore, clock, meta: { sim } }) ou résultat.
    async fetchResults({ now, matches }) {
      return matches
        .filter((m) => now >= m.startsAt && SIMS[m.sport])
        .map((m) => simulate(m, now));
    },
  };
}
