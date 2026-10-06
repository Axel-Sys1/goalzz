import { CONFIG } from '../config.js';
import { getState, update } from '../store.js';
import { uid, todayKey } from '../util.js';
import { checkBadges } from './badges.js';
import { claimPseudo, cloud, isPseudoAvailable } from './cloud.js';
import { isOffensivePseudo } from './moderation.js';

const newStats = () => ({
  betsPlaced: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0,
  maxOddsWon: 0, maxStake: 0, sports: {}, bonusClaims: 0, leaguesCreated: 0,
});

export const currentPlayer = (s = getState()) => s.players[s.currentPlayerId] || null;
export const listProfiles = (s = getState()) => Object.values(s.players).sort((a, b) => b.lastSeen - a.lastSeen);

// Pseudo propre et valide, sinon une erreur lisible.
function cleanPseudo(raw) {
  const pseudo = String(raw || '').trim().replace(/\s+/g, ' ');
  if (pseudo.length < 2 || pseudo.length > 16) throw new Error('Ton pseudo doit faire entre 2 et 16 caractères.');
  if (!/^[\p{L}\p{N} _.-]+$/u.test(pseudo)) throw new Error('Ton pseudo ne peut contenir que des lettres, des chiffres, des espaces et _ . -');
  if (isOffensivePseudo(pseudo)) throw new Error('Ce pseudo n\'est pas autorisé. Choisis-en un autre.');
  return pseudo;
}

// Pseudo unique dans tout le jeu : vérifié en ligne, et réservé tout de suite si on est connecté.
async function ensureFreePseudo(pseudo, exceptPlayerId = null) {
  const s = getState();
  const local = [...Object.values(s.players).filter((p) => p.id !== exceptPlayerId).map((p) => p.pseudo), ...(s.bots || []).map((b) => b.name)];
  const taken = () => new Error(`Le pseudo « ${pseudo} » est déjà pris. Choisis-en un autre.`);
  if (local.some((n) => n.toLowerCase() === pseudo.toLowerCase())) throw taken();
  let free = true;
  try {
    free = cloud.user ? await claimPseudo(pseudo) : await isPseudoAvailable(pseudo);
  } catch {
    if (cloud.user) throw new Error('Impossible de vérifier le pseudo pour le moment. Réessaie dans un instant.');
  }
  if (!free) throw taken();
}

export async function register(rawPseudo) {
  const pseudo = cleanPseudo(rawPseudo);
  await ensureFreePseudo(pseudo);

  update((st) => {
    const id = uid('p');
    st.players[id] = {
      id, pseudo,
      balance: CONFIG.STARTING_BALANCE,
      createdAt: Date.now(), lastSeen: Date.now(),
      lastBonusDate: null,
      stats: newStats(),
      badges: {},
      inbox: [{ type: 'welcome', amount: CONFIG.STARTING_BALANCE }],
      slip: [],
    };
    st.currentPlayerId = id;
  });
}

// Changer le pseudo du joueur actuel : coûte CONFIG.RENAME_COST Goalz, sauf si son pseudo
// actuel est déjà pris par un autre compte (il doit alors en changer, gratuitement).
export async function renamePlayer(rawPseudo, { free = false } = {}) {
  const p = currentPlayer();
  if (!p) return;
  const pseudo = cleanPseudo(rawPseudo);
  if (pseudo.toLowerCase() === p.pseudo.toLowerCase() && pseudo === p.pseudo) throw new Error('C\'est déjà ton pseudo.');
  const cost = free ? 0 : CONFIG.RENAME_COST;
  if (p.balance < cost) throw new Error(`Il te faut ${cost.toLocaleString('fr-FR')} Goalz pour changer de pseudo.`);
  await ensureFreePseudo(pseudo, p.id);
  update((st) => {
    const me = st.players[p.id];
    if (me.balance < cost) throw new Error(`Il te faut ${cost.toLocaleString('fr-FR')} Goalz pour changer de pseudo.`);
    me.balance -= cost;
    me.pseudo = pseudo;
  });
}

export function login(id) {
  update((st) => {
    if (!st.players[id]) return;
    st.currentPlayerId = id;
    st.players[id].lastSeen = Date.now();
  });
}

export function logout() {
  update((st) => { st.currentPlayerId = null; });
}

export const canClaimBonus = (p) => !!p && p.lastBonusDate !== todayKey();

export function claimBonus() {
  const p = currentPlayer();
  if (!canClaimBonus(p)) throw new Error('Bonus déjà récupéré aujourd\'hui. Reviens demain !');
  update((st) => {
    const me = st.players[p.id];
    me.balance += CONFIG.DAILY_BONUS;
    me.lastBonusDate = todayKey();
    me.stats.bonusClaims += 1;
    me.inbox.push({ type: 'bonus', amount: CONFIG.DAILY_BONUS });
    checkBadges(me);
  });
}
