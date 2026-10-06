// Catalogue des sports connus de l'appli, toutes sources confondues.
// hasDraw : le match nul est un résultat pariable (1 / N / 2). Sinon, pari à 2 issues
// et un nul éventuel est remboursé.
export const SPORTS = {
  football: { label: 'Football', icon: '⚽', hasDraw: true },
  basketball: { label: 'Basket', icon: '🏀', hasDraw: false },
  tennis: { label: 'Tennis', icon: '🎾', hasDraw: false },
  mma: { label: 'MMA', icon: '🥋', hasDraw: false },
  boxing: { label: 'Boxe', icon: '🥊', hasDraw: false },
  rugby: { label: 'Rugby', icon: '🏉', hasDraw: true },
  hockey: { label: 'Hockey', icon: '🏒', hasDraw: false },
  americanfootball: { label: 'Foot US', icon: '🏈', hasDraw: false },
};

export const SPORT_ORDER = Object.keys(SPORTS);

export const sportMeta = (key) => SPORTS[key] || { label: key, icon: '🏅', hasDraw: false };
