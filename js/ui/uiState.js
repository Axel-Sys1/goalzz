// État d'affichage non persisté (filtres, onglets).
export const ui = {
  sport: 'all',          // filtre de sport de la liste des matchs
  gender: 'all',         // foot : all | men | women
  day: null,             // jour sélectionné (YYYY-MM-DD) pour les vrais matchs
  betsTab: 'pending',    // pending | won | lost | void
  installPrompt: null,   // proposition d'installation du navigateur (Android, ordinateur)
  profileTab: 'stats',   // stats | settings (Profil)
  challengesOpen: false,  // défis du jour dépliés sur l'écran Matchs
  shopTab: 'daily',      // boutique : daily (cartes du jour) | album | boost | style
  albumSet: null,        // collection affichée dans l'album (null : la première)
  topScope: 'season',     // classement : season (mois en cours) | all (tous les temps)
  rankTab: 'top',        // top (classement général) | division | leagues
};
