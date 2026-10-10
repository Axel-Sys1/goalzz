// Rangs compétitifs façon Valorant : chaque pari réglé fait gagner ou perdre des RR
// (points de rang). 100 RR = une division ; 8 rangs × 3 divisions, puis Radiant.
// Le rang suit les résultats des paris, pas le solde : miser gros ne fait pas monter plus vite.

import { MARGIN } from '../providers/odds.js';

export const TIERS = [
  { id: 'iron', name: 'Fer', color: '#8a8f94' },
  { id: 'bronze', name: 'Bronze', color: '#c0834f' },
  { id: 'silver', name: 'Argent', color: '#d4dde3' },
  { id: 'gold', name: 'Or', color: '#f2c94c' },
  { id: 'platinum', name: 'Platine', color: '#45c6cf' },
  { id: 'diamond', name: 'Diamant', color: '#d18cf5' },
  { id: 'ascendant', name: 'Ascendant', color: '#3ed68a' },
  { id: 'immortal', name: 'Immortel', color: '#ff4a6a' },
];
export const RADIANT = { id: 'radiant', name: 'Radiant', color: '#fff2a8' };

export const RR_PER_DIVISION = 100;
const DIVISIONS = TIERS.length * 3;             // Fer 1 → Immortel 3
export const IMMORTAL_RR = (DIVISIONS - 3) * RR_PER_DIVISION;
export const RADIANT_SPOTS = 3;                  // les 3 meilleurs Immortels sont Radiant
export const LOSS_RR = 15;

// RR gagnés pour une victoire. Ancien barème (paris réglés avant le 10 octobre 2026) : 12 à 40,
// trop généreux pour les grosses cotes favorites (parier à 1,20 faisait monter presque à coup sûr).
const winRRv1 = (odds) => Math.max(12, Math.min(40, Math.round(10 + 10 * (odds - 1))));
// Barème actuel : réglé pour que parier au hasard aux cotes Goalz (marge comprise) rapporte 0 RR en
// moyenne. Seuls les bons pronostics font monter. Cote 1,25 → 5 · 2 → 17 · 3 → 33 (60 au plus).
export const winRR = (odds) => Math.max(1, Math.min(60, Math.round(LOSS_RR * (odds * (1 + MARGIN) - 1))));
export const RR_VERSION = 2;

// Variation de RR d'un pari réglé (gagné ou perdu), avec le barème en vigueur à son règlement.
export function betRR(b) {
  const odds = b.finalOdds || b.odds;
  if (b.status === 'won') return b.rrv === RR_VERSION ? winRR(odds) : winRRv1(odds);
  return b.status === 'lost' ? -LOSS_RR : 0;
}

// RR d'un joueur humain, recalculés à partir de ses paris réglés (dans l'ordre).
// Les paris les plus anciens peuvent avoir été résumés (sauvegarde en ligne allégée) :
// player.rrBase = RR atteints au moment player.rrBaseAt, on repart de là.
export function playerRR(playerId, s) {
  const p = s.players?.[playerId];
  const since = p?.rrBaseAt || 0;
  const settled = Object.values(s.bets)
    .filter((b) => b.playerId === playerId && (b.status === 'won' || b.status === 'lost') && (b.settledAt || 0) > since)
    .sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
  let rr = p?.rrBase || 0;
  for (const b of settled) rr = Math.max(0, rr + betRR(b));
  return rr;
}

// Rang d'un total de RR. radiant : le joueur fait partie des meilleurs Immortels.
export function rankOf(rr, { radiant = false } = {}) {
  const index = Math.min(DIVISIONS - 1, Math.floor(rr / RR_PER_DIVISION));
  const tier = TIERS[Math.floor(index / 3)];
  const division = (index % 3) + 1;
  const top = index === DIVISIONS - 1;           // Immortel 3 n'a pas de plafond
  const inDivision = rr - index * RR_PER_DIVISION;
  if (radiant && rr >= IMMORTAL_RR) {
    return { ...RADIANT, division: null, label: RADIANT.name, rr, inDivision, progress: 1, top: true };
  }
  return {
    ...tier, division, label: `${tier.name} ${division}`, rr, inDivision,
    progress: top ? 1 : inDivision / RR_PER_DIVISION, top,
  };
}

export const isImmortal = (rr) => rr >= IMMORTAL_RR;
