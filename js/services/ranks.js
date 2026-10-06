// Rangs compétitifs façon Valorant : chaque pari réglé fait gagner ou perdre des RR
// (points de rang). 100 RR = une division ; 8 rangs × 3 divisions, puis Radiant.
// Le rang suit les résultats des paris, pas le solde : miser gros ne fait pas monter plus vite.

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

// RR gagnés pour une victoire : plus la cote est haute, plus ça rapporte (12 à 40).
export const winRR = (odds) => Math.max(12, Math.min(40, Math.round(10 + 10 * (odds - 1))));

// RR d'un joueur humain, recalculés à partir de ses paris réglés (dans l'ordre).
export function playerRR(playerId, s) {
  const settled = Object.values(s.bets)
    .filter((b) => b.playerId === playerId && (b.status === 'won' || b.status === 'lost'))
    .sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
  let rr = 0;
  for (const b of settled) rr = Math.max(0, rr + (b.status === 'won' ? winRR(b.finalOdds || b.odds) : -LOSS_RR));
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
