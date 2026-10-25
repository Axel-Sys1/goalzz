// Défis du jour (les mêmes pour tous les joueurs, renouvelés à minuit) et série de connexion
// (le bonus du jour grandit chaque jour d'affilée). Récompenses en Goalz et en XP, versées
// automatiquement dès qu'un défi est réussi.
import { CONFIG } from '../config.js';
import { todayKey } from '../util.js';
import { addXp } from './progress.js';
import { isGuest } from './cloud.js';

// ─── Série de connexion ──────────────────────────────────────────────────────
export const STREAK_DAYS = 7;
// Bonus du jour selon la série : 50, 60, 70… et un gros bonus le 7e jour.
export const bonusFor = (day) => (day >= STREAK_DAYS ? 250 : CONFIG.DAILY_BONUS + 10 * (day - 1));

const yesterdayKey = () => todayKey(new Date(Date.now() - 86_400_000));

// Jour de série qu'obtiendrait le joueur en récupérant son bonus aujourd'hui (1 à 7, puis on repart).
export function nextStreakDay(p) {
  const continues = p.lastBonusDate === yesterdayKey();
  const day = continues ? (p.bonusStreak || 0) + 1 : 1;
  return day > STREAK_DAYS ? 1 : day;
}

// ─── Défis du jour ───────────────────────────────────────────────────────────
// type : événement compté. target : nombre à atteindre. Un défi par « famille » au plus chaque jour.
const POOL = [
  { id: 'place3', family: 'place', type: 'place', target: 3, text: 'Place 3 paris', goalz: 60, xp: 50 },
  { id: 'place5', family: 'place', type: 'place', target: 5, text: 'Place 5 paris', goalz: 100, xp: 80 },
  { id: 'win1', family: 'win', type: 'win', target: 1, text: 'Gagne un pari', goalz: 60, xp: 60 },
  { id: 'win3', family: 'win', type: 'win', target: 3, text: 'Gagne 3 paris', goalz: 150, xp: 120 },
  { id: 'odds2', family: 'odds', type: 'winOdds2', target: 1, text: 'Gagne un pari à une cote de 2,00 ou plus', goalz: 120, xp: 100 },
  { id: 'combo3', family: 'combo', type: 'combo3', target: 1, text: 'Place un combiné d\'au moins 3 matchs', goalz: 80, xp: 70 },
  { id: 'live', family: 'live', type: 'live', target: 1, text: 'Place un pari en direct', goalz: 80, xp: 70 },
  { id: 'foot', family: 'sport', type: 'sport:football', target: 2, text: 'Parie sur 2 matchs de foot', goalz: 60, xp: 50 },
  { id: 'basket', family: 'sport', type: 'sport:basketball', target: 1, text: 'Parie sur un match de basket', goalz: 60, xp: 50 },
  { id: 'tennis', family: 'sport', type: 'sport:tennis', target: 1, text: 'Parie sur un match de tennis', goalz: 60, xp: 50 },
  { id: 'real', family: 'real', type: 'real', target: 2, text: 'Parie sur 2 vrais matchs', goalz: 60, xp: 50 },
  { id: 'flash', family: 'flash', type: 'flash', target: 3, text: 'Parie sur 3 matchs éclair', goalz: 60, xp: 50 },
];

// Tirage déterministe à partir de la date : même liste pour tout le monde ce jour-là.
function seeded(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function todaysChallenges(date = todayKey()) {
  const rand = seeded(`goalzz-${date}`);
  const pool = [...POOL];
  const picked = [];
  while (picked.length < 3 && pool.length) {
    const c = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    if (!picked.some((x) => x.family === c.family)) picked.push(c);
  }
  return picked;
}

function dailyOf(p) {
  const date = todayKey();
  if (!p.daily || p.daily.date !== date) p.daily = { date, progress: {}, done: {} };
  return p.daily;
}

// État des défis du jour pour l'affichage : [{ ...défi, count, done }].
export function challengeStatus(p) {
  const d = p.daily?.date === todayKey() ? p.daily : { progress: {}, done: {} };
  return todaysChallenges().map((c) => ({ ...c, count: Math.min(c.target, d.progress[c.id] || 0), done: !!d.done[c.id] }));
}

// Compte un événement (dans un update()). events : liste de types ('place', 'win', 'sport:football'…).
export function track(p, events) {
  if (isGuest()) return; // défis réservés aux joueurs avec un compte
  const d = dailyOf(p);
  for (const c of todaysChallenges(d.date)) {
    if (d.done[c.id]) continue;
    const n = events.filter((e) => e === c.type).length;
    if (!n) continue;
    d.progress[c.id] = (d.progress[c.id] || 0) + n;
    if (d.progress[c.id] >= c.target) {
      d.done[c.id] = true;
      p.balance += c.goalz;
      addXp(p, c.xp, { boostable: false });
      p.inbox.push({ type: 'reward', amount: c.goalz, text: `Défi réussi : ${c.text} · +${c.goalz} Goalz, +${c.xp} XP` });
    }
  }
}

// Événements d'un pari placé : ['place', 'sport:…', 'real' | 'flash', 'live', 'combo3'].
export function placeEvents(matches, { live = false, combo = false } = {}) {
  const ev = [];
  if (combo) {
    ev.push('place');
    if (matches.length >= 3) ev.push('combo3');
  } else matches.forEach(() => ev.push('place'));
  for (const m of matches) {
    ev.push(`sport:${m.sport}`, m.real ? 'real' : 'flash');
  }
  if (live) ev.push('live');
  return ev;
}
