# Goalz ⚽🏀🎾🥋

Paris sportifs **pour le fun**, avec une monnaie 100 % virtuelle : les Goalz.
**Jeu gratuit, sans argent réel.** Les Goalz ne s'achètent pas et ne s'échangent
pas contre de l'argent ou des lots.

- **Vrais matchs** : foot (Ligue 1, Premier League, LaLiga, Serie A, Bundesliga, Ligue des
  champions, Ligue des nations…), basket (NBA, WNBA), tennis (ATP, WTA), MMA (UFC, PFL),
  boxe, hockey (NHL), foot US (NFL), rugby (Top 14, Champions Cup, Six Nations…).
- **Matchs éclair** : matchs fictifs de 2 minutes pour jouer tout de suite.

## Lancer l'appli en local

Aucune installation : HTML, CSS et JavaScript (modules ES), sans dépendance.

```bash
cd goalz
python3 serve.py
```

Puis ouvrir <http://localhost:5173>. En local, les vrais matchs sont lus **en direct** chez ESPN.

## Version en ligne

<https://claude.ai/artifact/QF2GimwS3nT8S3PyJDRtDi> (page Claude privée, à partager depuis son menu « Partager »).

Une page Claude ne peut pas contacter d'autres sites : elle lit l'**instantané**
`data/real-matches.json`, publié avec elle. L'appli choisit toute seule : sources en direct
si elles répondent, instantané sinon.

### Mise à jour automatique

La tâche planifiée **« Goalz : mise à jour des vrais matchs »** (application Claude, section
*Scheduled*) tourne chaque heure à h05, de 10 h à 2 h du matin :

1. `python3 tools/update_snapshot.py` télécharge les matchs, cotes et résultats et réécrit
   l'instantané ;
2. la page en ligne est republiée au même lien.

Elle tourne quand l'application Claude est ouverte sur ce Mac ; si elle était fermée, la
mise à jour se fait à la réouverture. Pour mettre à jour à la main : même commande, puis
republier la page.

`tools/update_snapshot.py` n'a besoin de rien d'installer : il exécute les providers
JavaScript avec le moteur de macOS (`jsc`) et se charge lui-même du réseau. Chaque résultat
est lu deux fois, à 25 secondes d'écart, avant d'être validé.

## Règles de règlement des paris

- Les paris ferment au coup d'envoi.
- Un résultat n'est validé que s'il est officiel et lu deux fois de suite.
- Foot : le 1N2 se règle sur le score à 90 minutes (prolongations et tirs au but exclus).
- Basket, hockey, foot US, tennis, MMA : pari à 2 issues, prolongations comprises. Un nul
  (rare) est **remboursé**.
- Match reporté, annulé ou abandonné, combat annulé ou « no contest », forfait au tennis :
  **remboursé**. Abandon en cours de match au tennis : réglé sur le vainqueur officiel.
- Sans résultat 48 h après le début : remboursé.
- Cotes : celles des bookmakers quand ESPN les publie (ramenées à la marge Goalz de 7 %),
  sinon estimées par Goalz à partir des classements et bilans (« cotes estimées »).

## Architecture

```
serve.py                   serveur local (sans cache) + enregistrement de l'instantané
tools/update_snapshot.py   mise à jour de l'instantané sans navigateur
publish/artifact.html      page publiée sur claude.ai
data/real-matches.json     instantané des vrais matchs
tests/                     tests des providers (jsc), avec de vraies réponses ESPN
js/
├── config.js  sports.js  store.js  util.js
├── providers/
│   ├── index.js           contrat des providers + choix direct / instantané
│   ├── odds.js            conversion des cotes et modèle maison
│   ├── espn/              foot & sports d'équipe, tennis, MMA
│   ├── thesportsdb/       boxe (TheSportsDB, clé gratuite)
│   ├── snapshotProvider.js
│   └── fakeProvider.js    matchs éclair
├── services/              logique métier (synchro, paris, badges, ligues…)
├── tools/                 génération de l'instantané
└── ui/                    écrans, effets, événements
```

### Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/teamSports.test.mjs
```

(idem pour `tennis`, `mma`, `boxing`).

## Limites

- Tout est stocké dans le navigateur de chaque joueur : les ligues privées fonctionnent
  entre profils d'un même appareil. Un classement partagé entre téléphones demandera un serveur.
- Le classement général inclut 12 joueurs simulés (marqués « simulé »).
- Données ESPN : API publique non officielle, qui peut changer sans préavis.
- Boxe (TheSportsDB gratuit) : au plus 3 combats par jour, cotes neutres (1,86 / 1,86), et
  certains résultats ne sont jamais publiés : le pari est alors remboursé après 4 jours.
