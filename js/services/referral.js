// Parrainage : un joueur avec un compte donne le pseudo de son parrain (ou arrive par le lien
// https://goalzz.fr/?parrain=PSEUDO) et chacun reçoit REWARD Goalz.
// En ligne : referrals/<uid du filleul> = { parrain: uid, pseudo, at, claimed } ; créé une seule fois
// par le filleul (règles Firestore), puis « réclamé » par le parrain à sa prochaine visite.
import { cloud, referralDb } from './cloud.js';
import { getState, update } from '../store.js';
import { currentPlayer } from './players.js';
import { addXp, XP } from './progress.js';

export const REWARD = 200;
const KEY = 'goalz:parrain';
const SITE = 'https://goalzz.fr/';
let busy = false;

export const referralLink = (pseudo) => `${SITE}?parrain=${encodeURIComponent(pseudo)}`;

// Au démarrage : mémorise le parrain de l'adresse puis le retire de la barre d'adresse.
export function readReferralFromUrl() {
  const params = new URLSearchParams(location.search);
  const name = (params.get('parrain') || '').trim().slice(0, 16);
  if (name) { try { localStorage.setItem(KEY, name); } catch { /* ignoré */ } }
  if (params.has('parrain')) {
    params.delete('parrain');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
}

export function pendingReferral() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
const clearPending = () => { try { localStorage.removeItem(KEY); } catch { /* ignoré */ } };

// Le joueur actuel peut-il encore déclarer un parrain ?
export const canBeReferred = (p = currentPlayer(getState())) => !!p && !p.referredBy && !!cloud.user;

function credit(amount, text, patch = () => {}) {
  update((s) => {
    const p = currentPlayer(s);
    if (!p) return;
    p.balance += amount;
    addXp(p, XP.referral, { boostable: false });
    patch(p);
    p.inbox.push({ type: 'reward', amount, text });
  });
}

// Déclare `pseudo` comme parrain du joueur actuel. Lève une erreur lisible si c'est impossible.
export async function applyReferral(rawPseudo) {
  const pseudo = String(rawPseudo || '').trim();
  const p = currentPlayer(getState());
  if (!cloud.user) throw new Error('Crée ton compte pour utiliser un parrainage.');
  if (!p) throw new Error('Choisis d\'abord ton pseudo.');
  if (p.referredBy) throw new Error('Tu as déjà un parrain.');
  if (pseudo.length < 2) throw new Error('Entre le pseudo de ton parrain.');
  if (pseudo.toLowerCase() === p.pseudo.toLowerCase()) throw new Error('Tu ne peux pas être ton propre parrain.');
  const res = await referralDb.create(pseudo);
  if (res === 'unknown') throw new Error(`Aucun joueur « ${pseudo} » avec un compte.`);
  if (res === 'self') throw new Error('Tu ne peux pas être ton propre parrain.');
  if (res === 'already') {
    update((s) => { const me = currentPlayer(s); if (me) me.referredBy = me.referredBy || '?'; });
    throw new Error('Ce compte a déjà un parrain.');
  }
  credit(REWARD, `Parrainage : +${REWARD} Goalz grâce à ${pseudo} !`, (me) => { me.referredBy = pseudo; });
  clearPending();
  return pseudo;
}

// Parrain venu par un lien : appliqué dès que le joueur a un compte et un pseudo.
export async function applyPendingReferral() {
  const name = pendingReferral();
  if (!name || busy || !canBeReferred()) return null;
  busy = true;
  try {
    return { ok: await applyReferral(name) };
  } catch (err) {
    clearPending();
    return { error: err.message };
  } finally {
    busy = false;
  }
}

// Parrain : récupère les récompenses de ses nouveaux filleuls (une fois chacun, sur un seul appareil).
export async function claimReferralRewards() {
  if (busy || !cloud.user || !currentPlayer(getState())) return 0;
  busy = true;
  try {
    const names = await referralDb.claimAll();
    for (const name of names) {
      credit(REWARD, `Parrainage : ${name} a rejoint Goalzz avec ton lien, +${REWARD} Goalz !`, (me) => {
        me.stats.referrals = (me.stats.referrals || 0) + 1;
      });
    }
    return names.length;
  } catch (err) {
    console.warn('Goalz : parrainages indisponibles', err);
    return 0;
  } finally {
    busy = false;
  }
}
