// Registre des sources de matchs.
//
// ─── Contrat d'un provider ────────────────────────────────────────────────
// {
//   id: 'espn',                 identifiant court, préfixe des ids de match
//   label: 'ESPN',              affiché dans l'appli (crédit des données)
//   real: true,                 vrais matchs (horloge réelle) ou fictifs (horloge du jeu)
//   refresh: {
//     upcomingMs,               intervalle entre deux fetchUpcoming
//     resultsMs,                intervalle entre deux fetchResults quand des matchs sont en cours
//     idleResultsMs?,           idem quand aucun match n'est en direct (défaut : resultsMs)
//   },
//   async probe?() → boolean    la source est-elle joignable depuis cette page ?
//   async fetchUpcoming({ now, existing, days }) → Match[]
//       Matchs à ajouter ou mettre à jour (programmés, en cours, ou terminés récemment).
//       `existing` : matchs non réglés de ce provider déjà connus.
//       Le cœur fusionne par id ; un match absent de la réponse n'est PAS supprimé.
//       Doit lever une erreur seulement si TOUT a échoué (un échec partiel renvoie le reste).
//   async fetchResults({ now, matches }) → Update[]
//       `matches` : matchs de ce provider commencés (ou sur le point de l'être) et non réglés.
//       Update : { matchId, status: 'scheduled'|'live'|'finished'|'void',
//                  outcome?: '1'|'X'|'2' (obligatoire si finished),
//                  score?, liveScore?, clock?, startsAt? }
//       'void' = reporté / annulé / sans résultat → les paris sont remboursés.
//       Ne jamais renvoyer 'void' à cause d'une erreur réseau.
// }
//
// ─── Match (forme normalisée) ─────────────────────────────────────────────
// {
//   id: '<provider>:<sport>:<ligue>:<idSource>',  unique et stable
//   source, real, sport (clé de sports.js), competition, competitionLogo?, round?,
//   home: { name, short, color?, logo?, record? },  away: { … }   (combattants/joueurs pour MMA, boxe, tennis)
//   startsAt (ms), endsAt? (ms, estimation), odds: { 1, X?, 2 } en cotes décimales,
//   oddsSource: 'bookmaker' | 'model' | 'fake',
//   status: 'scheduled' | 'live' | 'finished' | 'void',
//   outcome: null | '1' | 'X' | '2' | 'void', score, liveScore?, clock?, meta (privé au provider)
// }
import { createFakeProvider } from './fakeProvider.js';
import { createSnapshotProvider } from './snapshotProvider.js';
import { createEspnProvider } from './espn/index.js';
import { createBoxingProvider, createThrottle } from './thesportsdb/boxing.js';

export const fakeProvider = createFakeProvider();
export const snapshotProvider = createSnapshotProvider();

// Sources de vrais matchs interrogées en direct. `getJson` permet d'injecter le réseau et
// `unthrottled` retire la limite de débit de la boxe (l'outil d'instantané sans navigateur
// espace lui-même ses requêtes).
export function createLiveProviders({ getJson, unthrottled = false } = {}) {
  const net = getJson ? { getJson } : {};
  return [
    createEspnProvider(net),
    createBoxingProvider({ ...net, ...(unthrottled ? { throttle: createThrottle({ perMinute: 1e6, pauseMs: 0 }) } : {}) }),
  ];
}

export const liveProviders = createLiveProviders();

// Un provider gère les matchs dont il est la source ; l'instantané gère tous les vrais matchs.
export const owns = (p, m) => (p.snapshot ? !!m.real : m.source === p.id);

// Sources réellement utilisées sur cette page (fixées par initProviders).
export let realProviders = [];
export let providers = [fakeProvider];

export const providerById = (id) => providers.find((p) => p.id === id);

// Direct si au moins une source répond, sinon l'instantané publié avec l'appli.
export async function initProviders() {
  const reachable = await Promise.all(liveProviders.map((p) => (p.probe ? p.probe().catch(() => false) : true)));
  if (liveProviders.length && reachable.some(Boolean)) {
    realProviders = liveProviders.filter((_, i) => reachable[i]);
  } else if (await snapshotProvider.available()) {
    realProviders = [snapshotProvider];
  } else {
    realProviders = liveProviders;
  }
  providers = [...realProviders, fakeProvider];
}
