import { CONFIG } from '../config.js';
import { getState, update } from '../store.js';
import { uid, todayKey } from '../util.js';
import { checkBadges } from './badges.js';

const newStats = () => ({
  betsPlaced: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0,
  maxOddsWon: 0, maxStake: 0, sports: {}, bonusClaims: 0, leaguesCreated: 0,
});

export const currentPlayer = (s = getState()) => s.players[s.currentPlayerId] || null;
export const listProfiles = (s = getState()) => Object.values(s.players).sort((a, b) => b.lastSeen - a.lastSeen);

export function register(rawPseudo) {
  const pseudo = String(rawPseudo || '').trim().replace(/\s+/g, ' ');
  if (pseudo.length < 2 || pseudo.length > 16) throw new Error('Ton pseudo doit faire entre 2 et 16 caractères.');
  const s = getState();
  const taken = [...Object.values(s.players).map((p) => p.pseudo), ...(s.bots || []).map((b) => b.name)]
    .some((n) => n.toLowerCase() === pseudo.toLowerCase());
  if (taken) throw new Error('Ce pseudo est déjà pris.');

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
