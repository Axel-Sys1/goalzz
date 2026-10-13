// Matchs à venir des pages publiques (/pronos), regroupés par compétition. Utilisé par les Pages
// Functions : `getJson` est injecté (réseau du serveur, ou réponses enregistrées dans les tests).
import { createTeamSportsAdapter } from '../providers/espn/teamSports.js';
import { LEAGUE_PAGES } from './pages.js';

export const DAYS = 7;

// → [{ league, matches }] dans l'ordre des compétitions de l'appli ; matchs pas encore commencés, triés par heure.
export async function loadGroups({ getJson, now = Date.now(), leagues = LEAGUE_PAGES }) {
  const adapter = createTeamSportsAdapter({ getJson, leagues });
  const all = await adapter.upcoming({ now, days: DAYS });
  return leagues.map((league) => ({
    league,
    matches: all
      .filter((m) => m.sport === league.sport && m.meta?.league === league.league)
      .filter((m) => m.status === 'scheduled' && m.startsAt > now && m.odds && Object.keys(m.odds).length >= 2)
      .sort((a, b) => a.startsAt - b.startsAt),
  }));
}

// Forme compacte à mettre en cache (les objets de compétition sont retrouvés par leur slug).
export const packGroups = (groups) => groups.map((g) => ({ slug: g.league.slug, matches: g.matches }));
export const unpackGroups = (packed) => packed
  .map((g) => ({ league: LEAGUE_PAGES.find((l) => l.slug === g.slug), matches: g.matches }))
  .filter((g) => g.league);
