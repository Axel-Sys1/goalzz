// Badges : chaque badge a un test sur le joueur. checkBadges() est appelé
// après chaque événement (pari placé, pari réglé, bonus, ligue créée).
export const BADGES = [
  { id: 'first_bet', icon: '🎯', name: 'Premier pari', desc: 'Placer ton tout premier pari.', test: (p) => p.stats.betsPlaced >= 1 },
  { id: 'first_win', icon: '🏆', name: 'Première victoire', desc: 'Gagner ton premier pari.', test: (p) => p.stats.wins >= 1 },
  { id: 'streak_5', icon: '🔥', name: 'En feu', desc: 'Gagner 5 paris d\'affilée.', test: (p) => p.stats.bestStreak >= 5 },
  { id: 'big_odds', icon: '🦄', name: 'Coup de génie', desc: 'Gagner un pari à une cote de plus de 5.', test: (p) => p.stats.maxOddsWon > 5 },
  { id: 'high_roller', icon: '💎', name: 'Flambeur', desc: 'Miser 500 Goalz ou plus sur un seul pari.', test: (p) => p.stats.maxStake >= 500 },
  { id: 'all_sports', icon: '🌍', name: 'Touche-à-tout', desc: 'Parier sur 3 sports différents.', test: (p) => Object.keys(p.stats.sports).length >= 3 },
  { id: 'real_win', icon: '🏟️', name: 'Dans le vrai', desc: 'Gagner un pari sur un vrai match.', test: (p) => (p.stats.realWins || 0) >= 1 },
  { id: 'fighter', icon: '🥊', name: 'Au tapis', desc: 'Parier sur un combat de MMA ou de boxe.', test: (p) => !!(p.stats.sports.mma || p.stats.sports.boxing) },
  { id: 'regular', icon: '📈', name: 'Habitué', desc: 'Placer 10 paris.', test: (p) => p.stats.betsPlaced >= 10 },
  { id: 'loyal', icon: '📅', name: 'Fidèle', desc: 'Récupérer le bonus quotidien 5 fois.', test: (p) => p.stats.bonusClaims >= 5 },
  { id: 'founder', icon: '👑', name: 'Fondateur', desc: 'Créer une ligue privée.', test: (p) => p.stats.leaguesCreated >= 1 },
  { id: 'tycoon', icon: '💰', name: 'Magnat', desc: 'Atteindre 5 000 Goalz.', test: (p) => p.balance >= 5000 },
];

export function checkBadges(player) {
  for (const b of BADGES) {
    if (!player.badges[b.id] && b.test(player)) {
      player.badges[b.id] = Date.now();
      player.inbox.push({ type: 'badge', id: b.id });
    }
  }
}
