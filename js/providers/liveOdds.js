// Cotes en direct : probabilités recalculées selon le score et le temps restant, à partir des cotes
// d'avant-match figées au coup d'envoi (ou du modèle des matchs fictifs, meta.model).
// Module pur : ni stockage ni horloge, l'heure du match est toujours passée en paramètre.
//
// Modèles (fitParams ajuste leurs paramètres pour reproduire les probabilités d'avant-match) :
// - foot : buts domicile / extérieur ~ deux Poisson indépendants (λh, λa sur 90 min) ;
// - hockey : idem (≈ 6 buts), égalité après 60 min → prolongation / TAB gagnée avec pOT ;
// - basket, foot US : marge finale ~ Normale(μ, σ²), égalité → prolongation gagnée avec pOT ;
// - rugby : marge finale ~ Normale(μ, 14²), nul possible (|marge| < 0,5) ;
// - tennis : jeux indépendants gagnés avec la proba g par le joueur 1, tie-break à 6-6 (gagné avec g).
// En cours de match, seule la part du temps réglementaire restant (r = 1 − progress) reste aléatoire.
import { CONFIG } from '../config.js';
import { devig, fromProbabilities } from './odds.js';
import { MIN, clamp } from '../util.js';

export const LIVE_SPORTS = new Set(['football', 'basketball', 'hockey', 'americanfootball', 'rugby', 'tennis']);

const FOOT_TOTAL = { min: 1.6, max: 4.0, noDraw: 2.6 }; // buts sur 90 min
const HOCKEY_TOTAL = 6;
const SIGMA = { nba: 12, wnba: 11, americanfootball: 13.5, rugby: 14 };
const TOTAL_MIN = { football: 90, rugby: 80 };
const CLOSE_MIN = { football: 85, rugby: 75 }; // fermeture : fin de match jouée d'avance
const LAST_MIN = 2;                            // sports à périodes : fermé dans les 2 dernières minutes
// Vrais matchs NBA, WNBA, NFL : modèle trop tranché en fin de match, on ferme plus tôt.
const LAST_MIN_REAL = { basketball: 6, americanfootball: 6 };
const FAKE_STALE_MS = 15_000;                  // matchs fictifs : simulation pas relancée depuis (bouton +15 min)
const GOAL_SPORTS = new Set(['football', 'hockey']); // fictifs : seuls les buts suspendent le marché
const GRAND_SLAM = /open d'australie|australian open|roland[- ]garros|french open|wimbledon|us open/i;

// Périodes des sports chronométrés : nombre, durée, prolongation (minutes), préfixe ESPN.
function periodsOf(sport, league) {
  if (sport === 'basketball') return { count: 4, len: league === 'wnba' ? 10 : 12, ot: 5, tag: 'Q' };
  if (sport === 'americanfootball') return { count: 4, len: 15, ot: 10, tag: 'Q' };
  if (sport === 'hockey') return { count: 3, len: 20, tag: 'P' };
  return null;
}

// ─── Outils de probabilité ───────────────────────────────────────────────────
// Φ, fonction de répartition de la loi normale (Abramowitz-Stegun 7.1.26, erreur < 2e-7).
function phi(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592)
    * k * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Marge finale entière ~ Normale(m, s²) arrondie : victoire (≥ 1), égalité, défaite (≤ −1).
function marginSplit(m, s) {
  if (!(s > 1e-9)) return { win: m >= 0.5 ? 1 : 0, lose: m <= -0.5 ? 1 : 0, tie: Math.abs(m) < 0.5 ? 1 : 0 };
  const win = 1 - phi((0.5 - m) / s);
  const lose = phi((-0.5 - m) / s);
  return { win, lose, tie: Math.max(0, 1 - win - lose) };
}

// Loi de Poisson tronquée (queue négligeable).
function poisson(lambda) {
  const n = Math.ceil(lambda + 8 * Math.sqrt(lambda) + 8);
  const p = new Float64Array(n + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= n; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

// X ~ Poisson(lx), Y ~ Poisson(ly) indépendants : P(X − Y > k) et P(X − Y = k).
function poissonDiff(lx, ly, k) {
  const px = poisson(lx);
  const py = poisson(ly);
  const tail = new Float64Array(px.length + 1); // tail[i] = P(X ≥ i)
  for (let i = px.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + px[i];
  let gt = 0;
  let eq = 0;
  for (let y = 0; y < py.length; y++) {
    const x = k + y; // X − Y = k ⇔ X = k + y
    gt += py[y] * (x + 1 <= 0 ? 1 : x + 1 < tail.length ? tail[x + 1] : 0);
    if (x >= 0 && x < px.length) eq += py[y] * px[x];
  }
  return { gt, eq };
}

// Plus petite valeur x de [lo, hi] telle que f(x) ≥ target (f croissante).
function solve(f, target, lo, hi, steps = 40) {
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Ajustement avant-match ──────────────────────────────────────────────────
const cache = new Map();

// Probabilités sans marge → paramètres du modèle (déterministe ; résultat figé et mis en cache).
export function fitParams(sport, probs, ctx = {}) {
  const p = normalize(probs);
  if (!p || !LIVE_SPORTS.has(sport)) return null;
  const key = `${sport}|${ctx.league ?? ''}|${ctx.competition ?? ''}|${ctx.bestOf ?? ''}|${p[1]}|${p.X ?? ''}|${p[2]}`;
  let params = cache.get(key);
  if (!params) {
    params = Object.freeze(FITS[sport](p, ctx));
    if (cache.size > 500) cache.clear();
    cache.set(key, params);
  }
  return params;
}

function normalize(probs) {
  if (!probs) return null;
  const p1 = Number(probs[1]);
  const p2 = Number(probs[2]);
  const pX = probs.X === undefined || probs.X === null ? null : Number(probs.X);
  if (!(p1 >= 0) || !(p2 >= 0) || (pX !== null && !(pX >= 0))) return null;
  const sum = p1 + p2 + (pX ?? 0);
  if (!(p1 + p2 > 0)) return null;
  return pX === null ? { 1: p1 / sum, 2: p2 / sum } : { 1: p1 / sum, X: pX / sum, 2: p2 / sum };
}

// Part de la victoire hors nul, bornée pour rester ajustable.
const ratioOf = (p) => clamp(p[1] / (p[1] + p[2]), 0.002, 0.998);

const FITS = {
  // λh, λa : rapport V1/(V1+V2) exact, puis total de buts qui donne le nul voulu (borné à [1,6 ; 4]).
  football(p) {
    const r = ratioOf(p);
    const fitAt = (total) => {
      const s = solve((x) => { const d = poissonDiff(x * total, (1 - x) * total, 0); return d.gt / (1 - d.eq); }, r, 0.0005, 0.9995, 32);
      return { sport: 'football', lh: s * total, la: (1 - s) * total };
    };
    const drawOf = (q) => poissonDiff(q.lh, q.la, 0).eq;
    if (p.X === undefined) return fitAt(FOOT_TOTAL.noDraw);
    const low = fitAt(FOOT_TOTAL.min);
    if (p.X >= drawOf(low)) return low;
    const high = fitAt(FOOT_TOTAL.max);
    if (p.X <= drawOf(high)) return high;
    // Le nul diminue quand le total augmente : on cherche le total où il vaut p.X.
    return fitAt(solve((total) => -drawOf(fitAt(total)), -p.X, FOOT_TOTAL.min, FOOT_TOTAL.max, 24));
  },

  // Total fixe, part des buts ajustée ; prolongation / TAB : 60 % décidés par le prochain but, sinon pile ou face.
  hockey(p) {
    const r = ratioOf(p);
    const s = solve((x) => hockeyWin(x * HOCKEY_TOTAL, (1 - x) * HOCKEY_TOTAL, 0, hockeyOT(x)), r, 0.0005, 0.9995);
    return { sport: 'hockey', lh: s * HOCKEY_TOTAL, la: (1 - s) * HOCKEY_TOTAL, pOT: hockeyOT(s) };
  },

  basketball: (p, ctx) => marginFit('basketball', p, SIGMA[ctx.league === 'wnba' ? 'wnba' : 'nba'], periodsOf('basketball', ctx.league)),
  americanfootball: (p) => marginFit('americanfootball', p, SIGMA.americanfootball, periodsOf('americanfootball')),

  // Une seule inconnue (μ) : on reproduit le rapport V1/(V1+V2), le nul découle de σ.
  rugby(p) {
    const r = ratioOf(p);
    const sigma = SIGMA.rugby;
    const mu = solve((x) => { const d = marginSplit(x, sigma); return d.win / (d.win + d.lose); }, r, -120, 120);
    return { sport: 'rugby', mu, sigma };
  },

  tennis(p, ctx) {
    const bestOf = ctx.bestOf || tennisBestOf(ctx);
    const need = Math.ceil(bestOf / 2);
    const g = solve((x) => matchWin(setTable(x)[0], 0, 0, need), ratioOf(p), 0.0005, 0.9995);
    return { sport: 'tennis', g, bestOf };
  },
};

const hockeyOT = (share) => 0.2 + 0.6 * share;
function hockeyWin(lh, la, lead, pOT) {
  const d = poissonDiff(lh, la, -lead);
  return d.gt + d.eq * pOT;
}

// Marge ~ Normale(μ, σ²) sur `minutes` ; prolongation de `ot` minutes à la même cadence.
function marginFit(sport, p, sigma, per) {
  const minutes = per.count * per.len;
  const otOf = (mu) => {
    const d = marginSplit((mu * per.ot) / minutes, sigma * Math.sqrt(per.ot / minutes));
    return d.win / (d.win + d.lose);
  };
  const mu = solve((x) => { const d = marginSplit(x, sigma); return d.win + d.tie * otOf(x); }, ratioOf(p), -120, 120);
  return { sport, mu, sigma, minutes, pOT: otOf(mu) };
}

// Grand Chelem masculin : 3 sets gagnants, sinon 2.
function tennisBestOf({ league, competition = '' }) {
  const atp = league ? league === 'atp' : /\bATP\b/.test(competition);
  return atp && GRAND_SLAM.test(competition) ? 5 : 3;
}

// S[i·8 + j] : proba que le joueur 1 gagne le set mené i jeux à j (tie-break à 6-6).
function setTable(g) {
  const S = new Float64Array(64);
  for (let i = 7; i >= 0; i--) {
    for (let j = 7; j >= 0; j--) {
      if (i === 7 || (i === 6 && j <= 4)) S[i * 8 + j] = 1;
      else if (j === 7 || (j === 6 && i <= 4)) S[i * 8 + j] = 0;
      else if (i === 6 && j === 6) S[i * 8 + j] = g;
      else S[i * 8 + j] = g * S[(i + 1) * 8 + j] + (1 - g) * S[i * 8 + j + 1];
    }
  }
  return S;
}

// Proba que le joueur 1 gagne le match mené s1 sets à s2 (set gagné avec ps).
function matchWin(ps, s1, s2, need) {
  if (s1 >= need) return 1;
  if (s2 >= need) return 0;
  return ps * matchWin(ps, s1 + 1, s2, need) + (1 - ps) * matchWin(ps, s1, s2 + 1, need);
}

// ─── Lecture de l'état du match ──────────────────────────────────────────────
const SCORE_RE = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/;
const FOOT_RE = /^(\d+)'?(?:\s*\+\s*(\d+)'?)?$/;
const PERIOD_RE = /^([QP])(\d)(?:\s+(?:(\d+):(\d{1,2}(?:\.\d+)?)|(\d+(?:\.\d+)?)))?$/;
const SET_RE = /^(\d)-(\d)(?:\(\d+\))?$/;

const parseScore = (s) => {
  const x = SCORE_RE.exec(String(s ?? ''));
  return x ? [Number(x[1]), Number(x[2])] : null;
};
const wholeMinutes = (ms) => (ms > 0 ? Math.floor(ms / MIN) : 0);
const state = (progress, score, label, closed = null) => ({ progress, score, label, closed });
// Hors du temps réglementaire (prolongation, TAB) ou interrompu : progress null, le modèle ne s'applique plus.
const offModel = (score, label, closed) => state(null, score, label, closed);

// { progress (0 → 1 du temps réglementaire, null hors modèle), score, label, closed } ou null si illisible.
export function liveState(m, t) {
  if (!m || !LIVE_SPORTS.has(m.sport)) return null;
  const clock = m.clock == null ? '' : String(m.clock).trim();
  const tennis = m.sport === 'tennis';
  const score = tennis ? parseSets(m.liveScore) : parseScore(m.liveScore);
  if (/^interrompu/i.test(clock)) return offModel(tennis ? score && { sets: score } : score, 'Interrompu', 'Match interrompu');
  if (!score) return null;
  if (tennis) return tennisState(score, clock);
  if (clock === 'TAB') return offModel(score, 'TAB', 'Tirs au but');
  if (m.sport === 'football') return footballState(m, t, clock, score);
  if (m.sport === 'rugby') return rugbyState(m, t, clock, score);
  return periodState(m, clock, score);
}

function closeAt(minute, score, label, sport) {
  const closed = minute >= CLOSE_MIN[sport] ? 'Fin de match proche' : null;
  return state(minute / TOTAL_MIN[sport], score, label, closed);
}

// Vrais matchs de foot : temps additionnel moyen (minutes de jeu en plus de 45 + 45). Sans lui, le modèle
// croyait le match fini à 90' alors qu'il reste 5 à 8 minutes de jeu : à 0-0 à 80', 11 % par équipe au
// lieu d'environ 15 % (cotes de bookmaker) : cote 8,1 au lieu de 6, environ +18 % d'espérance pour le
// parieur. Les matchs fictifs n'ont pas de temps additionnel (la simulation s'arrête à 90').
const ADDED = { first: 2, second: 6 };
const FOOT_PLAYED = 90 + ADDED.first + ADDED.second;

// Part des buts restant à jouer (left) d'un vrai match : minutes jouées, temps additionnel compris.
function footballLeft(minute, firstHalf, extra) {
  const played = firstHalf ? minute + Math.min(extra, ADDED.first) : minute + ADDED.first;
  return Math.max(0, 1 - played / FOOT_PLAYED);
}

// Minute lue dans l'horloge, prolongée du temps écoulé depuis sa dernière mise à jour (minutes entières).
function footballState(m, t, clock, score) {
  const withLeft = (st, minute, firstHalf, extra = 0) => (m.real ? { ...st, left: footballLeft(minute, firstHalf, extra) } : st);
  if (clock === 'MT') return withLeft(state(0.5, score, 'Mi-temps'), 45, true, ADDED.first);
  const c = FOOT_RE.exec(clock);
  if (!c) return null;
  const base = Number(c[1]);
  if (base > 90) return offModel(score, clock, 'Prolongation');
  const cap = base <= 45 ? 45 : 90;
  const minute = c[2] ? Math.min(base, cap) : Math.min(cap, base + wholeMinutes(t - (m.clockAt ?? t)));
  const st = closeAt(minute, score, c[2] ? clock : `${minute}'`, 'football');
  return withLeft(st, minute, base <= 45, c[2] && base === 45 ? Number(c[2]) : 0);
}

// Reprise de la 2e mi-temps : clockAt (passage à '2e MT') s'il est plausible (reprise vue en direct, entre
// 50 et 70 min après le coup d'envoi), sinon une reprise estimée à 60 min. Page rouverte en pleine
// 2e mi-temps : clockAt est l'heure de la première lecture, pas celle de la reprise ; le match aurait paru
// 30 min plus jeune et le meneur bien trop peu favori (+4 à la 70e : 64 % au lieu de 76 %).
const RUGBY_RESTART = { guess: 60 * MIN, latest: 70 * MIN };
function secondHalfStart(m) {
  const seen = m.clockAt != null && m.clockAt <= m.startsAt + RUGBY_RESTART.latest;
  return seen ? m.clockAt : m.startsAt + RUGBY_RESTART.guess;
}

// ESPN ne donne que la mi-temps en cours : minutes depuis le coup d'envoi, puis depuis la reprise.
function rugbyState(m, t, clock, score) {
  let minute;
  if (clock === 'MT') minute = 40;
  else if (clock === '1re MT') minute = Math.min(40, wholeMinutes(t - m.startsAt));
  else if (clock === '2e MT') minute = 40 + Math.min(40, wholeMinutes(t - secondHalfStart(m)));
  else return null;
  return closeAt(minute, score, clock, 'rugby');
}

// Temps restant de la période lu dans l'horloge ('Q3 5:12', 'P2 12:00', 'Q4 45.2'), sans extrapolation.
function periodState(m, clock, score) {
  const per = periodsOf(m.sport, m.meta?.league);
  const total = per.count * per.len;
  if (/^(fin )?prol/i.test(clock)) return offModel(score, clock, 'Prolongation');
  let elapsed;
  const end = /^Fin ([QP])(\d)$/.exec(clock);
  const run = PERIOD_RE.exec(clock);
  if (clock === 'MT') elapsed = total / 2;
  else if (end && end[1] === per.tag && end[2] >= 1 && end[2] <= per.count) elapsed = end[2] * per.len;
  else if (run && run[1] === per.tag && run[2] >= 1 && run[2] <= per.count) {
    const left = run[3] !== undefined ? Number(run[3]) + Number(run[4]) / 60 : run[5] !== undefined ? Number(run[5]) / 60 : per.len;
    if (left > per.len) return null;
    elapsed = (run[2] - 1) * per.len + per.len - left;
  } else return null;
  const last = (m.real && LAST_MIN_REAL[m.sport]) || LAST_MIN;
  const closed = total - elapsed < last ? 'Fin de match proche' : null;
  return state(elapsed / total, score, clock === 'MT' ? 'Mi-temps' : clock, closed);
}

// '6-4 7-6(5) 3-2' → [[6,4],[7,6],[3,2]] ; '0-0' au début. null si illisible.
function parseSets(text) {
  const parts = String(text ?? '').trim().split(/\s+/);
  const sets = [];
  for (const p of parts) {
    const x = SET_RE.exec(p);
    if (!x) return null;
    sets.push([Number(x[1]), Number(x[2])]);
  }
  return sets.length ? sets : null;
}

const setOver = ([a, b]) => Math.max(a, b) === 7 || (Math.max(a, b) >= 6 && Math.abs(a - b) >= 2);

// Sets terminés, set en cours : le dernier set affiché peut être fini (le suivant n'a pas commencé).
function tennisSplit(sets) {
  const done = [];
  for (let i = 0; i < sets.length; i++) {
    if (setOver(sets[i])) done.push(sets[i]);
    else if (i < sets.length - 1) return null; // set non terminé suivi d'un autre : incohérent
  }
  const last = sets[sets.length - 1];
  const won = [0, 0];
  done.forEach(([a, b]) => { won[a > b ? 0 : 1]++; });
  return { won, current: setOver(last) ? [0, 0] : last };
}

// progress est indicatif (sets et jeux joués, sur 3 sets) : le modèle du tennis ne lit que le score.
function tennisState(sets, clock) {
  const split = tennisSplit(sets);
  if (!split) return null;
  const { won, current } = split;
  const progress = Math.min(1, (won[0] + won[1] + (current[0] + current[1]) / 12) / 3);
  return state(progress, { sets }, clock || null);
}

// ─── Probabilités en direct ──────────────────────────────────────────────────
// Paramètres du match : modèle des fictifs, sinon ajustés sur les cotes figées au coup d'envoi.
// Modèle stocké (localStorage) utilisable : bon sport, paramètres numériques finis. Un modèle abîmé
// faisait boucler sans fin le calcul du tennis (bestOf absent) ou rendait des cotes NaN.
const MODEL_KEYS = {
  football: ['lh', 'la'], hockey: ['lh', 'la', 'pOT'], basketball: ['mu', 'sigma', 'pOT'],
  americanfootball: ['mu', 'sigma', 'pOT'], rugby: ['mu', 'sigma'], tennis: ['g', 'bestOf'],
};
function validModel(p, sport) {
  if (!p || p.sport !== sport || !MODEL_KEYS[sport].every((k) => Number.isFinite(p[k]))) return false;
  if (sport === 'tennis') return p.g > 0 && p.g < 1 && (p.bestOf === 3 || p.bestOf === 5);
  return sport === 'football' || sport === 'hockey' ? p.lh >= 0 && p.la >= 0 : p.sigma > 0;
}

function paramsOf(m) {
  if (m.meta?.model) return validModel(m.meta.model, m.sport) ? m.meta.model : null;
  const base = m.kickoffOdds || m.odds;
  const probs = base && devig(base);
  return probs ? fitParams(m.sport, probs, { league: m.meta?.league, competition: m.competition }) : null;
}

// { 1, X, 2 } du modèle pour un état lisible (X = 0 dans les sports sans nul).
function modelProbs(p, st) {
  const left = st.left ?? 1 - st.progress; // left : vrais matchs de foot, temps additionnel compris
  if (p.sport === 'tennis') return tennisProbs(p, st.score.sets);
  const [h, a] = st.score;
  if (p.sport === 'football') {
    const d = poissonDiff(p.lh * left, p.la * left, a - h);
    return { 1: d.gt, X: d.eq, 2: Math.max(0, 1 - d.gt - d.eq) };
  }
  if (p.sport === 'hockey') {
    const w = clamp(hockeyWin(p.lh * left, p.la * left, h - a, p.pOT), 0, 1); // arrondis : jamais 1 + 2e-16
    return { 1: w, X: 0, 2: 1 - w };
  }
  const d = marginSplit(h - a + p.mu * left, p.sigma * Math.sqrt(left));
  if (p.sport === 'rugby') return { 1: d.win, X: d.tie, 2: d.lose };
  const w = d.win + d.tie * p.pOT;
  return { 1: w, X: 0, 2: 1 - w };
}

function tennisProbs(p, sets) {
  const { won, current } = tennisSplit(sets);
  const need = Math.ceil(p.bestOf / 2);
  const S = setTable(p.g);
  const ps = S[0];
  const [i, j] = current;
  const set = i <= 7 && j <= 7 ? S[i * 8 + j] : 0.5;
  const w = won[0] >= need || won[1] >= need
    ? matchWin(ps, won[0], won[1], need)
    : set * matchWin(ps, won[0] + 1, won[1], need) + (1 - set) * matchWin(ps, won[0], won[1] + 1, need);
  return { 1: w, X: 0, 2: 1 - w };
}

function probsFor(m, st) {
  if (st.progress == null) return null;
  const params = paramsOf(m);
  if (!params || params.sport !== m.sport) return null;
  const full = modelProbs(params, st);
  if ('X' in (m.odds || {})) return full;
  // Pari à 2 issues : un nul serait remboursé, on le retire des deux côtés.
  const two = full[1] + full[2];
  return two > 0 ? { 1: full[1] / two, 2: full[2] / two } : null;
}

// Probabilités { 1, X?, 2 } (mêmes clés que m.odds, somme 1) à l'instant t ; null si l'état est illisible.
export function liveProbs(m, t) {
  const st = liveState(m, t);
  return st ? probsFor(m, st) : null;
}

// ─── Marché en direct ────────────────────────────────────────────────────────
// Même règle que services/matchInfo.js matchStatus (ce module reste sans store).
function statusAt(m, t) {
  if (m.status === 'finished' || m.status === 'void') return m.status;
  return m.status === 'live' || t >= m.startsAt ? 'live' : 'upcoming';
}

const SCORED = {
  football: 'But ! Cotes en cours de mise à jour',
  hockey: 'But ! Cotes en cours de mise à jour',
  tennis: 'Jeu terminé : cotes en cours de mise à jour',
};

// Source muette : vrais matchs (dernière lecture), fictifs (dernière simulation).
function isStale(m, t) {
  if (m.real) return !(t - m.seenAt <= CONFIG.LIVE.STALE_MS);
  const at = m.meta?.sim?.at;
  return !(t - at <= FAKE_STALE_MS);
}

// Suspendu juste après un changement de score (fictifs : seulement les buts, le reste bouge sans cesse).
function justScored(m, t) {
  // Basket : un panier toutes les 30 s, le marché ne rouvrirait jamais.
  if (m.scoreAt == null || m.sport === 'basketball' || (!m.real && !GOAL_SPORTS.has(m.sport))) return false;
  return t - m.scoreAt < CONFIG.LIVE.SUSPEND_MS[m.real ? 'real' : 'fake'];
}

// { open, reason, odds: { 1, X?, 2 } (null = non proposée ; toutes null si fermé), state }.
export function liveMarket(m, t) {
  const keys = Object.keys(m.odds || { 1: 0, 2: 0 });
  const shut = (reason, st = null) => ({ open: false, reason, odds: Object.fromEntries(keys.map((k) => [k, null])), state: st });
  if (!LIVE_SPORTS.has(m.sport)) return shut('Pas de paris en direct sur ce sport');
  const status = statusAt(m, t);
  if (status !== 'live') return shut(status === 'upcoming' ? 'Match pas encore commencé' : 'Match terminé');
  if (m.real && m.status === 'scheduled') return shut('En attente du coup d\'envoi');
  const st = liveState(m, t);
  if (!st) return shut('Score en attente');
  if (st.closed) return shut(st.closed, st);
  if (justScored(m, t)) return shut(SCORED[m.sport] || 'Score modifié : cotes en cours de mise à jour', st);
  if (isStale(m, t)) return shut('Score en attente', st);
  const probs = probsFor(m, st);
  if (!probs) return shut('Cotes indisponibles', st);
  const priced = fromProbabilities(probs);
  const { MIN_ODDS, MAX_ODDS } = CONFIG.LIVE;
  const odds = Object.fromEntries(keys.map((k) => {
    const o = priced[k];
    return [k, o >= MIN_ODDS && o < MAX_ODDS ? o : null];
  }));
  if (!Object.values(odds).some(Boolean)) return shut('Issue quasi certaine', st);
  return { open: true, reason: null, odds, state: st };
}
