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

<https://goalzz.pages.dev> (Cloudflare Pages), copie sur <https://axel-sys1.github.io/goalzz/>.

- Le site est servi depuis le dépôt GitHub **Axel-Sys1/goalzz** (branche `main`, sans étape
  de build) : chaque `git push` le remet en ligne en une minute environ.
- Publier depuis ce Mac : `./tools/deploy.sh "message"` (commit + push en HTTPS ; l'accès
  GitHub est géré par GitHub CLI, `~/.local/bin/gh`, connecté au compte Axel-Sys1).
- En ligne, les vrais matchs sont lus **en direct** : ESPN via le relais `functions/api/fetch.js`
  (Cloudflare Pages Function) qui met les réponses en cache 1 à 5 min pour tous les joueurs
  (requête refusée ou relais en panne : l'appli interroge ESPN directement) ; TheSportsDB (boxe)
  en direct. L'instantané
  `data/real-matches.json` ne sert que de secours si ces sources ne répondent pas.

### Comptes (Firebase, projet `goalzz-5354f`)

Connexion facultative (email + mot de passe ou Google) : sauvegarde de la partie
(`users/<uid>`), classement par division (`leaderboard/<uid>`) et pseudos uniques
(`pseudos/<pseudo>`), ligues privées (`leagues/<CODE>`). Les règles Firestore limitent chacun
à ses propres documents. Pour tenir dans le plan gratuit : sauvegarde au plus toutes les 30 s,
classements rechargés au plus toutes les 5 min, 200 derniers paris réglés gardés en ligne par
joueur (les RR des plus anciens sont résumés dans `rrBase`). Pseudos filtrés par
`js/services/moderation.js`.

### Publicité

Trois emplacements, réglés dans `CONFIG.ADS` (`js/config.js`) et dessinés par `js/ui/ads.js` :
bannière sous l'en-tête (320×50, 728×90 dès 728 px de large), pavé 300×250 au-dessus du panier
(ordinateur) et bas de page (300×250 ou 728×90). Aucun sur l'accueil ni sur l'écran Panier. Ils
vivent dans la coque de l'appli, jamais dans les écrans redessinés en continu : une annonce n'est
ainsi jamais rechargée toute seule. Sans régie, ils affichent un encart « Espace publicitaire »
(lien vers `contact` si renseigné, sans annonceur de jeux d'argent ni de casino) ;
`enabled: false` les retire.

Passer à Google AdSense :

1. Compte AdSense (titulaire majeur), site `goalzz.pages.dev`, vérifié par la balise
   `<meta name="google-adsense-account" content="ca-pub-…">` dans le `<head>` d'`index.html` (le
   script n'est chargé qu'après le choix d'un pseudo : le robot de Google ne le voit pas).
2. Fichier `ads.txt` donné par AdSense à la racine du dépôt.
3. Confidentialité et messages : message RGPD en français avec le bouton « Ne pas autoriser ».
4. Annonces automatiques désactivées : seuls les trois blocs de la coque sont prévus.
5. Contrôles de blocage : laisser bloquée la catégorie « Jeux d'argent et paris » et bloquer les
   sites des opérateurs de paris (public dès 15 ans).
6. Créer trois blocs d'annonces display, coller l'identifiant éditeur dans `client` et leurs id
   dans `slots`. Les vraies annonces ne s'affichent que sur les domaines de `hosts` ; ailleurs
   (local, miroir GitHub Pages), les encarts restent.
7. Mettre à jour `legal.html#confidentialite`, qui dit aujourd'hui « pas de publicité ciblée,
   pas de cookies publicitaires » : section Publicité (Google, cookies, consentement et comment le
   retirer, liens policies.google.com/technologies/partner-sites et adssettings.google.com).
   Avec des revenus réguliers, l'éditeur n'est plus « non professionnel » (mentions légales).

### Ancienne version claude.ai

<https://claude.ai/artifact/QF2GimwS3nT8S3PyJDRtDi> lit uniquement l'instantané (une page
Claude ne peut pas contacter d'autres sites). Sa tâche planifiée de mise à jour est en pause ;
pour la rafraîchir à la main : `python3 tools/update_snapshot.py`, puis republier la page.

`tools/update_snapshot.py` n'a besoin de rien d'installer : il exécute les providers
JavaScript avec le moteur de macOS (`jsc`) et se charge lui-même du réseau. Chaque résultat
est lu deux fois, à 25 secondes d'écart, avant d'être validé.

## Règles de règlement des paris

- Les paris d'avant-match ferment au coup d'envoi (la sélection quitte le panier).
- Paris en direct (foot, basket, hockey, foot US, rugby, tennis ; pas MMA ni boxe) : cotes recalculées
  par Goalz selon le score et le temps restant (`js/providers/liveOdds.js`), à partir des cotes figées
  au coup d'envoi, avec la même marge de 7 %. En simple uniquement. Une cote qui bouge doit être
  acceptée. Issue sous 1,25 ou au-dessus de 15 non proposée ; marché suspendu juste après un but,
  si la source se tait, et en fin de match (foot dès 85', rugby dès 75', 2 dernières minutes au
  basket, hockey et foot US, prolongations). Vrais matchs : le pari n'est validé que si le score ne
  bouge pas pendant 60 s (la source a du retard sur la télé), sinon il est remboursé ; scores lus
  toutes les 30 s. Matchs éclair : le score se joue en direct pendant les 2 minutes.
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
└── ui/                    écrans, effets, événements, emplacements pub (ads.js)
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
