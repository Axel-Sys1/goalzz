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

  // Paris en direct (cotes recalculées par Goalz selon le score et le temps restant).
  LIVE: {
    MIN_ODDS: 1.25,        // issue plus probable que ça : non proposée (fin de match jouée d'avance)
    MAX_ODDS: 15,          // issue moins probable : non proposée
    CONFIRM_MS: 60_000,    // vrais matchs : un pari n'est validé que si le score n'a pas bougé pendant ce délai
    SUSPEND_MS: { real: 60_000, fake: 4_000 }, // marché suspendu après un changement de score
    STALE_MS: 180_000,     // vrais matchs : source muette depuis ce délai → marché suspendu
  },

  // Emplacements publicitaires : bannière sous l'en-tête, pavé au-dessus du panier (ordinateur) et
  // bas de page ; aucun sur l'accueil ni sur l'écran Panier. Sans régie, chacun affiche un encart
  // « Espace publicitaire » à sa taille. Passer à Google AdSense : voir README.md, « Publicité ».
  ADS: {
    enabled: true,                       // false : aucun emplacement
    client: '',                          // identifiant éditeur AdSense, ex. 'ca-pub-1234567890123456'
    slots: { top: '', side: '', bottom: '' }, // id des blocs d'annonces
    hosts: ['goalzz.fr', 'www.goalzz.fr'], // vraies annonces seulement ici (ailleurs : encarts)
    personalized: false,                 // public dès 15 ans : annonces non personnalisées
    contact: '',                         // lien des encarts (ex. 'mailto:…') ; vide : pas de lien
  },

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
