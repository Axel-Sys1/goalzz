// Panier (une sélection par match) et paris. Deux modes : « simples » (une mise par
// sélection) ou « combiné » (une seule mise, cotes multipliées, tout doit passer).
import { CONFIG } from '../config.js';
import { getState, update, clockFor } from '../store.js';
import { uid } from '../util.js';
import { checkBadges } from './badges.js';
import { currentPlayer } from './players.js';
import { matchStatus, outcomeLabel, matchTitle } from './matchInfo.js';

export const potentialGain = (stake, odds) => Math.floor((Number(stake) || 0) * odds);

export const COMBO_MIN = 2;
export const COMBO_MAX = 10;

// Matchs concernés par un pari (plusieurs pour un combiné).
export const betMatchIds = (b) => (b.legs ? b.legs.map((l) => l.matchId) : [b.matchId]);

const productOdds = (list) => Math.round(list.reduce((x, o) => x * o, 1) * 100) / 100;

export const isCombo = (p) => p.slipMode === 'combo' && p.slip.length >= COMBO_MIN;

export function setSlipMode(mode) {
  update((s) => {
    const p = currentPlayer(s);
    p.slipMode = mode === 'combo' ? 'combo' : 'single';
    if (p.comboStake == null) p.comboStake = CONFIG.DEFAULT_STAKE;
  });
}

export function toggleSelection(matchId, outcome) {
  update((s) => {
    const p = currentPlayer(s);
    const m = s.matches[matchId];
    if (!p || !m || matchStatus(m) !== 'upcoming' || !m.odds[outcome]) return;
    const i = p.slip.findIndex((x) => x.matchId === matchId);
    if (i === -1) p.slip.push({ matchId, outcome, stake: CONFIG.DEFAULT_STAKE });
    else if (p.slip[i].outcome === outcome) p.slip.splice(i, 1);
    else p.slip[i].outcome = outcome;
  });
}

export function removeSelection(matchId) {
  update((s) => {
    const p = currentPlayer(s);
    p.slip = p.slip.filter((x) => x.matchId !== matchId);
  });
}

export function clearSlip() {
  update((s) => { currentPlayer(s).slip = []; });
}

export const COMBO_KEY = '__combo__';

// silent : utilisé pendant la saisie pour ne pas redessiner l'écran à chaque touche.
export function setStake(matchId, stake, { silent = false } = {}) {
  update((s) => {
    const p = currentPlayer(s);
    if (matchId === COMBO_KEY) { p.comboStake = stake; return; }
    const item = p.slip.find((x) => x.matchId === matchId);
    if (item) item.stake = stake;
  }, { silent });
}

export function quickStake(matchId, kind) {
  const s = getState();
  const p = currentPlayer(s);
  if (matchId === COMBO_KEY) {
    const next = kind === 'max' ? p.balance : Math.min(p.balance, (Number(p.comboStake) || 0) + Number(kind));
    setStake(COMBO_KEY, next);
    return;
  }
  const item = p.slip.find((x) => x.matchId === matchId);
  if (!item) return;
  const others = p.slip.reduce((sum, x) => sum + (x === item ? 0 : Number(x.stake) || 0), 0);
  const max = Math.max(0, p.balance - others);
  const next = kind === 'max' ? max : Math.min(max, (Number(item.stake) || 0) + Number(kind));
  setStake(matchId, next);
}

// Résumé et validation du panier du joueur courant.
export function slipCheck(s = getState()) {
  const p = currentPlayer(s);
  const items = p.slip
    .map((x) => ({ ...x, match: s.matches[x.matchId] }))
    .filter((x) => x.match);
  const combo = isCombo(p);
  const comboOdds = productOdds(items.map((x) => x.match.odds[x.outcome]));
  const comboStake = Number(p.comboStake ?? CONFIG.DEFAULT_STAKE);
  const total = combo ? comboStake || 0 : items.reduce((sum, x) => sum + (Number(x.stake) || 0), 0);
  const potential = combo
    ? potentialGain(comboStake, comboOdds)
    : items.reduce((sum, x) => sum + potentialGain(x.stake, x.match.odds[x.outcome]), 0);
  const stakes = combo ? [comboStake] : items.map((x) => Number(x.stake));
  let error = null;
  if (!items.length) error = 'Ton panier est vide.';
  else if (items.some((x) => matchStatus(x.match) !== 'upcoming')) error = 'Un match a déjà commencé : retire-le du panier.';
  else if (combo && items.length > COMBO_MAX) error = `Un combiné peut contenir ${COMBO_MAX} matchs au maximum.`;
  else if (stakes.some((x) => !Number.isInteger(x) || x < CONFIG.MIN_STAKE)) error = `Mise minimum : ${CONFIG.MIN_STAKE} Goalz par pari.`;
  else if (total > p.balance) error = 'Solde insuffisant pour ces mises.';
  return { items, total, potential, error, combo, comboOdds, comboStake: p.comboStake ?? CONFIG.DEFAULT_STAKE };
}

export function placeSlip() {
  const { items, error, combo, comboOdds, comboStake } = slipCheck();
  if (error) throw new Error(error);
  if (combo) return placeCombo(items, comboOdds, Number(comboStake));
  return update((s) => {
    const p = currentPlayer(s);
    for (const x of items) {
      const odds = x.match.odds[x.outcome];
      const stake = Number(x.stake);
      const id = uid('b');
      s.bets[id] = {
        id, playerId: p.id, matchId: x.matchId, outcome: x.outcome,
        odds, stake, potential: potentialGain(stake, odds),
        status: 'pending', payout: 0, placedAt: clockFor(x.match), settledAt: null, real: !!x.match.real,
      };
      p.balance -= stake;
      p.stats.betsPlaced += 1;
      p.stats.maxStake = Math.max(p.stats.maxStake, stake);
      p.stats.sports[x.match.sport] = true;
    }
    p.slip = [];
    checkBadges(p);
    return items.length;
  });
}

function placeCombo(items, odds, stake) {
  return update((s) => {
    const p = currentPlayer(s);
    const id = uid('b');
    const first = items[0].match;
    s.bets[id] = {
      id, playerId: p.id, matchId: first.id, combo: true,
      legs: items.map((x) => ({ matchId: x.matchId, outcome: x.outcome, odds: x.match.odds[x.outcome], status: 'pending' })),
      odds, stake, potential: potentialGain(stake, odds),
      status: 'pending', payout: 0, placedAt: clockFor(first), settledAt: null, real: items.every((x) => !!x.match.real),
    };
    p.balance -= stake;
    p.stats.betsPlaced += 1;
    p.stats.maxStake = Math.max(p.stats.maxStake, stake);
    for (const x of items) p.stats.sports[x.match.sport] = true;
    p.slip = [];
    checkBadges(p);
    return 1;
  });
}

function recordWin(p, bet, label) {
  p.balance += bet.payout;
  p.stats.wins += 1;
  p.stats.streak += 1;
  p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak);
  p.stats.maxOddsWon = Math.max(p.stats.maxOddsWon, bet.finalOdds || bet.odds);
  if (bet.real) p.stats.realWins = (p.stats.realWins || 0) + 1;
  p.inbox.push({ type: 'win', amount: bet.payout, label });
}

function recordLoss(p, label) {
  p.stats.losses += 1;
  p.stats.streak = 0;
  p.inbox.push({ type: 'loss', label });
}

// Combiné : un match perdu suffit à tout perdre ; un match remboursé compte pour une cote de 1.
function settleCombos(s, m) {
  const combos = Object.values(s.bets).filter((b) => b.legs && b.status === 'pending' && b.legs.some((l) => l.matchId === m.id));
  for (const bet of combos) {
    const p = s.players[bet.playerId];
    if (!p) continue;
    const leg = bet.legs.find((l) => l.matchId === m.id);
    if (leg.status !== 'pending') continue;
    leg.status = m.outcome === 'void' ? 'void' : leg.outcome === m.outcome ? 'won' : 'lost';
    const label = `Combiné ${bet.legs.length} matchs`;
    if (leg.status === 'lost') {
      bet.status = 'lost';
      bet.settledAt = clockFor(m);
      recordLoss(p, label);
    } else if (bet.legs.every((l) => l.status !== 'pending')) {
      bet.settledAt = clockFor(m);
      const won = bet.legs.filter((l) => l.status === 'won');
      if (!won.length) {
        bet.status = 'void';
        bet.payout = bet.stake;
        p.balance += bet.stake;
        p.inbox.push({ type: 'void', amount: bet.stake, label });
      } else {
        bet.status = 'won';
        bet.finalOdds = productOdds(won.map((l) => l.odds));
        bet.payout = potentialGain(bet.stake, bet.finalOdds);
        recordWin(p, bet, label);
      }
    }
    checkBadges(p);
  }
}

// Appelé à l'intérieur d'un update() quand un match se termine ou est annulé.
export function settleMatch(s, m) {
  const bets = Object.values(s.bets)
    .filter((b) => !b.legs && b.matchId === m.id && b.status === 'pending')
    .sort((a, b) => a.placedAt - b.placedAt);
  for (const bet of bets) {
    const p = s.players[bet.playerId];
    if (!p) continue;
    bet.settledAt = clockFor(m);
    const label = `${matchTitle(m)} · ${outcomeLabel(m, bet.outcome)}`;
    if (m.outcome === 'void') {
      // Reporté, annulé ou nul sur un pari à 2 issues : mise rendue, série intacte.
      bet.status = 'void';
      bet.payout = bet.stake;
      p.balance += bet.stake;
      p.inbox.push({ type: 'void', amount: bet.stake, label });
    } else if (bet.outcome === m.outcome) {
      bet.status = 'won';
      bet.payout = bet.potential;
      recordWin(p, { ...bet, real: m.real }, label);
    } else {
      bet.status = 'lost';
      recordLoss(p, label);
    }
    checkBadges(p);
  }
  settleCombos(s, m);
}

export function betsOf(playerId, s = getState()) {
  return Object.values(s.bets)
    .filter((b) => b.playerId === playerId)
    .map((b) => ({ ...b, match: s.matches[b.matchId], legs: b.legs?.map((l) => ({ ...l, match: s.matches[l.matchId] })) }))
    .filter((b) => b.match && (!b.legs || b.legs.every((l) => l.match)));
}
