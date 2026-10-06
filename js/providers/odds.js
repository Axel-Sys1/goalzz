// Cotes : conversion des cotes bookmaker et modèle maison quand aucune n'est publiée.
// Formules calibrées sur les cotes DraftKings d'ESPN (voir README, section Cotes).
import { clamp } from '../util.js';

export const MARGIN = 0.07;
export const MIN_ODDS = 1.05;
export const MAX_ODDS = 15;

const logistic = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

// ─── Conversions ─────────────────────────────────────────────────────────────
// Cote américaine (nombre ou texte '+120', '-150', 'EVEN') → cote décimale. 'OFF', vide → null.
export function americanToDecimal(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const t = v.trim().toUpperCase();
    if (t === 'EVEN' || t === 'EV') return 2;
    if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
    v = Number(t);
  }
  if (!Number.isFinite(v) || v === 0) return null;
  if (v > 0 && v < 100) return null; // valeur incohérente
  return v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v);
}

// '6/5' → 2.2
export function fractionalToDecimal(f) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(f ?? ''));
  if (!m || Number(m[2]) === 0) return null;
  return 1 + Number(m[1]) / Number(m[2]);
}

// ─── Mise en forme des cotes ─────────────────────────────────────────────────
// Probabilités { 1, X?, 2 } (somme ≈ 1) → cotes décimales avec la marge Goalz.
export function fromProbabilities(probs, margin = MARGIN) {
  const total = Object.values(probs).reduce((a, b) => a + b, 0);
  const odds = {};
  for (const [k, p] of Object.entries(probs)) {
    const q = p / total;
    odds[k] = clamp(Math.floor(100 / (q * (1 + margin))) / 100, MIN_ODDS, MAX_ODDS);
  }
  return odds;
}

// Cotes décimales d'un bookmaker → probabilités sans marge.
export function devig(decimalOdds) {
  const inv = {};
  let sum = 0;
  for (const [k, d] of Object.entries(decimalOdds)) {
    if (!(d > 1)) return null;
    inv[k] = 1 / d;
    sum += inv[k];
  }
  for (const k of Object.keys(inv)) inv[k] /= sum;
  return inv;
}

// Cotes bookmaker → cotes Goalz (même marge pour toutes les sources). null si incomplet.
export function fromBookmaker(decimalOdds, margin = MARGIN) {
  const probs = devig(decimalOdds);
  return probs ? fromProbabilities(probs, margin) : null;
}

// ─── Bilans ──────────────────────────────────────────────────────────────────
// 'W-D-L' (foot), 'W-L', 'W-L-T' (NFL), 'W-L-OTL' (NHL), 'W-L-D' (MMA/boxe).
// order indique le sens du 3e nombre : 'wdl' (foot) ou 'wlx' (autres).
export function parseRecord(summary, order = 'wlx') {
  const parts = String(summary ?? '').split(/[-–]/).map((x) => parseInt(x, 10));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (order === 'wdl') {
    if (parts.length < 3) return null;
    return { w: parts[0], d: parts[1], l: parts[2] };
  }
  return { w: parts[0], l: parts[1], d: parts[2] || 0 };
}

// ─── Modèles ─────────────────────────────────────────────────────────────────
// Football, 1N2.
// Avec classements (différence de buts) : r = (GD + 20·gPrev) / (GP + 20), gPrev = GD/match de la saison passée
// (-0.7 si inconnue, ex. promu). Sans saison passée : r = GD / (GP + 15).
// x = rHome − rAway + avantage du terrain (0 sur terrain neutre).
export function soccerProbs({ home, away, neutral = false }) {
  const hasPrev = home.prevGdPerGame !== undefined || away.prevGdPerGame !== undefined;
  const rate = (t) => (hasPrev
    ? ((t.gd || 0) + 20 * (t.prevGdPerGame ?? -0.7)) / ((t.gp || 0) + 20)
    : (t.gd || 0) / ((t.gp || 0) + 15));
  const k = hasPrev ? 1.0 : 1.75;
  const h = neutral ? 0 : (hasPrev ? 0.4 : 0.2);
  const x = rate(home) - rate(away) + h;
  const pD = hasPrev ? clamp(0.29 - 0.06 * Math.abs(x), 0.12, 0.32) : clamp(0.28 - 0.1 * Math.abs(x), 0.12, 0.32);
  const q = logistic(k * x);
  return { 1: (1 - pD) * q, X: pD, 2: (1 - pD) * (1 - q) };
}

// Football avec seulement les bilans V-N-D : r = (3V + N − 1.35·J) / (J + 16).
export function soccerProbsFromRecords({ home, away, neutral = false }) {
  const rate = (r) => {
    const gp = r ? r.w + r.d + r.l : 0;
    return r ? (3 * r.w + r.d - 1.35 * gp) / (gp + 16) : 0;
  };
  const x = rate(home) - rate(away) + (neutral ? 0 : 0.15);
  const pD = clamp(0.28 - 0.1 * Math.abs(x), 0.12, 0.32);
  const q = logistic(2.25 * x);
  return { 1: (1 - pD) * q, X: pD, 2: (1 - pD) * (1 - q) };
}

// Sports à 2 issues (basket, hockey, foot US, rugby…) à partir des bilans.
// w = (V + 0.5·N + m·w0) / (J + m), w0 = % de victoires de la saison passée (0.5 sinon).
export const HOME_ADVANTAGE = { basketball: 0.25, americanfootball: 0.15, hockey: 0.15, rugby: 0.3, baseball: 0.1 };

export function twoWayProbs({ home, away, sport, neutral = false, m = 10 }) {
  const rate = (r, w0 = 0.5) => {
    const gp = r ? r.w + r.l + (r.d || 0) : 0;
    const wins = r ? r.w + 0.5 * (r.d || 0) : 0;
    return clamp((wins + m * w0) / (gp + m), 0.05, 0.95);
  };
  const x = logit(rate(home?.record, home?.prevWinPct)) - logit(rate(away?.record, away?.prevWinPct))
    + (neutral ? 0 : HOME_ADVANTAGE[sport] ?? 0.15);
  const p1 = clamp(logistic(x), 0.05, 0.95);
  return { 1: p1, 2: 1 - p1 };
}

// Rugby à 3 issues : le nul (~2,5 %) est retiré des deux côtés.
export function rugbyProbs(args) {
  const two = twoWayProbs({ ...args, sport: 'rugby' });
  const pD = 0.025;
  return { 1: two[1] * (1 - pD), X: pD, 2: two[2] * (1 - pD) };
}

// MMA et boxe : bilans V-D-N des combattants. Non calibré : les cotes bookmaker sont prioritaires.
export function combatProbs(a, b) {
  const rate = (r) => (r ? (r.w + 3) / (r.w + r.l + 6) : 0.5);
  const p = logistic(1.2 * (logit(rate(a)) - logit(rate(b))));
  const p1 = clamp(p, 0.08, 0.92);
  return { 1: p1, 2: 1 - p1 };
}

// Tennis : points au classement ATP/WTA (300 si hors top 150). Non calibré.
export function tennisProbs(pointsA, pointsB) {
  const a = Math.max(pointsA || 300, 1) ** 0.9;
  const b = Math.max(pointsB || 300, 1) ** 0.9;
  const p1 = clamp(a / (a + b), 0.08, 0.92);
  return { 1: p1, 2: 1 - p1 };
}

// Rien de connu sur les participants : cotes prudentes et égales.
export const neutralProbs = (hasDraw) => (hasDraw ? { 1: 0.4, X: 0.27, 2: 0.33 } : { 1: 0.5, 2: 0.5 });
