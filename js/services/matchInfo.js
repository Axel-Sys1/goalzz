// Petites fonctions de lecture sur un match, partagées par les services et l'UI.
import { clockFor } from '../store.js';
import { sportMeta } from '../sports.js';

const PERSON_SPORTS = new Set(['tennis', 'mma', 'boxing']);

// upcoming : on peut parier · live : commencé (paris fermés) · finished / void : réglé.
export function matchStatus(m, t = clockFor(m)) {
  if (m.status === 'finished' || m.status === 'void') return m.status;
  if (m.status === 'live' || t >= m.startsAt) return 'live';
  return 'upcoming';
}

// Commencé d'après l'horloge mais la source ne l'a pas encore confirmé.
export const isAwaitingKickoff = (m, t = clockFor(m)) =>
  m.real && m.status === 'scheduled' && t >= m.startsAt;

export function outcomeLabel(m, outcome) {
  if (outcome === 'X') return 'Match nul';
  const side = outcome === '1' ? m.home : m.away;
  return PERSON_SPORTS.has(m.sport) ? `${side.name} gagne` : `Victoire ${side.name}`;
}

export function outcomeShort(m, outcome) {
  if (outcome === 'X') return 'Nul';
  return outcome === '1' ? m.home.short : m.away.short;
}

export const matchTitle = (m) => `${m.home.name} – ${m.away.name}`;

export const sportOf = (m) => sportMeta(m.sport);
