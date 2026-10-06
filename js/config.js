// Réglages du jeu. Tout ce qui touche à l'équilibrage est ici.
export const CONFIG = {
  STORAGE_KEY: 'goalz:v1',
  STARTING_BALANCE: 1000,
  DAILY_BONUS: 100,
  MIN_STAKE: 1,
  DEFAULT_STAKE: 50,
  UPCOMING_TARGET: 18,   // matchs fictifs "à venir" maintenus dans la liste
  TICK_MS: 3000,         // fréquence à laquelle on vérifie si un provider doit être rappelé
  FAST_FORWARD_MIN: 15,  // bouton "avancer le temps" (matchs fictifs uniquement)
  RECENT_FINISHED: 12,   // matchs fictifs terminés conservés hors paris
  REAL_DAYS_AHEAD: 7,    // fenêtre des vrais matchs
  REAL_FINISHED_KEEP_H: 36, // vrais matchs terminés gardés pour l'affichage (hors paris)
  REAL_STALE_H: 8,       // vrai match jamais terminé après ce délai et sans pari : supprimé
};
