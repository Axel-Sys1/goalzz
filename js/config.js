// Réglages du jeu. Tout ce qui touche à l'équilibrage est ici.
export const CONFIG = {
  STORAGE_KEY: 'goalz:v1',
  STARTING_BALANCE: 100,  // monnaie rare : on démarre petit et on gagne en pariant juste
  DAILY_BONUS: 50,
  MIN_STAKE: 1,
  DEFAULT_STAKE: 10,
  QUICK_STAKES: [5, 10, 25], // boutons de mise rapide du panier (+ Max)
  RENAME_COST: 1000,       // prix d'un changement de pseudo (gratuit si le pseudo est déjà pris)
  UPCOMING_TARGET: 18,   // matchs fictifs "à venir" maintenus dans la liste
  TICK_MS: 3000,         // fréquence à laquelle on vérifie si un provider doit être rappelé
  FAST_FORWARD_MIN: 15,  // bouton "avancer le temps" (matchs fictifs uniquement)
  RECENT_FINISHED: 12,   // matchs fictifs terminés conservés hors paris
  REAL_DAYS_AHEAD: 7,    // fenêtre des vrais matchs
  REAL_FINISHED_KEEP_H: 36, // vrais matchs terminés gardés pour l'affichage (hors paris)
  REAL_STALE_H: 8,       // vrai match jamais terminé après ce délai et sans pari : supprimé

  // Compte en ligne (connexion par email + sauvegarde de la partie). Coller ici la config
  // « Web app » du projet Firebase ; laissé vide, l'appli reste 100 % locale.
  // Ces valeurs sont publiques par nature : la protection vient des règles Firestore.
  FIREBASE: {
    apiKey: 'AIzaSyA8NTHTF1M42L6p9mbzwrj0e8XEglFtufM',
    authDomain: 'goalzz-5354f.firebaseapp.com',
    projectId: 'goalzz-5354f',
    appId: '1:666078573502:web:f2e1b35f49ed08b4987fef',
  },
};
