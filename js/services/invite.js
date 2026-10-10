// Invitations aux ligues : un lien https://goalzz.pages.dev/?ligue=CODE ouvre le site et fait
// rejoindre la ligue dès que le joueur est connecté (tout de suite s'il l'est déjà).
import { cloud, joinOnlineLeague } from './cloud.js';
import { getState } from '../store.js';

const KEY = 'goalz:invite';
const SITE = 'https://goalzz.pages.dev/'; // redirigé vers goalzz.fr avec le code (js/move.js)
let joining = false;

export const inviteLink = (code) => `${SITE}?ligue=${encodeURIComponent(code)}`;

// À appeler au démarrage : mémorise le code de l'adresse puis le retire de la barre d'adresse.
export function readInviteFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('ligue') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === 6) {
    try { localStorage.setItem(KEY, code); } catch { /* ignoré */ }
  }
  if (params.has('ligue')) {
    params.delete('ligue');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
}

export function pendingInvite() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function clearInvite() {
  try { localStorage.removeItem(KEY); } catch { /* ignoré */ }
}

// Rejoint la ligue en attente dès que c'est possible. Renvoie le nom de la ligue rejointe.
export async function joinPendingInvite() {
  const code = pendingInvite();
  const s = getState();
  if (!code || joining || !cloud.user || !s.players[s.currentPlayerId]) return null;
  joining = true;
  try {
    const name = await joinOnlineLeague(code);
    clearInvite();
    return { code, name, joined: true };
  } catch (err) {
    clearInvite(); // déjà membre, ligue introuvable ou complète : on n'insiste pas
    return { code, error: err.message };
  } finally {
    joining = false;
  }
}

// Partage d'une ligue : feuille de partage du téléphone, sinon copie du lien.
export async function shareLeague(code, name) {
  const url = inviteLink(code);
  const text = `Rejoins ma ligue « ${name} » sur Goalz, le jeu de pronos gratuit entre potes !`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Goalz', text, url }); return 'shared'; } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  return 'copied';
}
