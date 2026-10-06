// Outils partagés par les adaptateurs ESPN (API publique, sans clé, CORS ouvert).
//
// Règles imposées par ESPN :
// - Requêtes GET simples, SANS en-tête personnalisé : ESPN répond 403 aux pré-requêtes CORS.
// - Un "jour" dans ?dates=YYYYMMDD est un jour du fuseau de New York (America/New_York).
import { MIN } from '../../util.js';

export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ─── Réseau ──────────────────────────────────────────────────────────────────
// Toute fonction qui appelle le réseau reçoit `getJson` en paramètre, pour pouvoir
// être testée avec des réponses enregistrées (voir tests/).
export async function defaultGetJson(url, { timeoutMs = 15_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} pour ${url}`);
    this.status = status;
  }
}

// Exécute des tâches avec un nombre limité en parallèle ; renvoie { ok: [...], failed: [...] }
// sans jamais rejeter, pour que l'échec d'une ligue n'empêche pas les autres.
export async function settleAll(tasks, concurrency = 6) {
  const ok = [];
  const failed = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try { ok.push(await tasks[idx]()); } catch (err) { failed.push(err); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return { ok, failed };
}

// ─── Dates (fuseau ESPN) ─────────────────────────────────────────────────────
const etFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

// 'YYYYMMDD' du jour ESPN (New York) contenant l'instant `ms`.
export function etDay(ms) {
  return etFormatter.format(new Date(ms)).replaceAll('-', '');
}

// Jours ESPN couvrant [fromMs, toMs], bornes incluses.
export function etDaysBetween(fromMs, toMs) {
  const days = [];
  for (let t = fromMs; t <= toMs + DAY; t += 12 * HOUR) {
    const d = etDay(Math.min(t, toMs));
    if (!days.includes(d)) days.push(d);
    if (t >= toMs) break;
  }
  return days;
}

// Plage 'YYYYMMDD-YYYYMMDD' (jours ESPN) pour les endpoints qui l'acceptent.
export const etRange = (fromMs, toMs) => `${etDay(fromMs)}-${etDay(toMs)}`;

// '2026-10-09T18:45Z' ou '2026-10-09T18:45:00Z' → ms (NaN si invalide).
export const parseDate = (iso) => (iso ? Date.parse(iso) : NaN);

// ─── Statuts ─────────────────────────────────────────────────────────────────
// type = status.type d'ESPN : { name, state: 'pre'|'in'|'post', completed, detail, shortDetail }
// → 'scheduled' | 'live' | 'final' (terminé, résultat exploitable) | 'void' (reporté, annulé, abandonné…)
export function espnPhase(type) {
  if (!type) return 'scheduled';
  if (type.state === 'in' || type.name === 'STATUS_SUSPENDED') return 'live'; // suspendu : reprendra plus tard
  if (type.state === 'post') return type.completed ? 'final' : 'void';
  return 'scheduled';
}

// ─── Divers ──────────────────────────────────────────────────────────────────
export const hexColor = (c) => (c && /^[0-9a-f]{6}$/i.test(c) && !/^f{6}$/i.test(c) ? `#${c}` : null);

export const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export const matchId = (sport, league, eventId) => `espn:${sport}:${league}:${eventId}`;
