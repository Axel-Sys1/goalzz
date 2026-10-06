// Ligues privées avec code à partager.
// Version 1 : stockées sur cet appareil (plusieurs profils peuvent rejoindre).
// Avec un serveur, seules ces fonctions changeront pour appeler l'API.
import { getState, update } from '../store.js';
import { leagueCode } from '../util.js';
import { checkBadges } from './badges.js';
import { currentPlayer } from './players.js';

export function createLeague(rawName) {
  const name = String(rawName || '').trim();
  if (name.length < 3 || name.length > 24) throw new Error('Le nom de la ligue doit faire entre 3 et 24 caractères.');
  const p = currentPlayer();
  return update((s) => {
    let code;
    do code = leagueCode(); while (s.leagues[code]);
    s.leagues[code] = { code, name, ownerId: p.id, members: [p.id], createdAt: Date.now() };
    const me = s.players[p.id];
    me.stats.leaguesCreated += 1;
    checkBadges(me);
    return code;
  });
}

export function joinLeague(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = currentPlayer();
  const league = getState().leagues[code];
  if (!league) throw new Error('Aucune ligue trouvée avec ce code.');
  if (league.members.includes(p.id)) throw new Error('Tu fais déjà partie de cette ligue.');
  update((s) => { s.leagues[code].members.push(p.id); });
  return league.name;
}

export function leaveLeague(code) {
  const p = currentPlayer();
  update((s) => {
    const l = s.leagues[code];
    if (!l) return;
    l.members = l.members.filter((id) => id !== p.id);
    if (!l.members.length) delete s.leagues[code];
    else if (l.ownerId === p.id) l.ownerId = l.members[0];
  });
}

export const myLeagues = (playerId, s = getState()) =>
  Object.values(s.leagues).filter((l) => l.members.includes(playerId)).sort((a, b) => a.createdAt - b.createdAt);
