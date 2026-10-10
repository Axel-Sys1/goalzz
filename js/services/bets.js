// Panier (une sélection par match) et paris. Deux modes : « simples » (une mise par
// sélection) ou « combiné » (une seule mise, cotes multipliées, tout doit passer).
// Paris en direct : la cote est celle que le joueur a vue (et acceptée si elle a bougé) ;
// ils se jouent en simple uniquement.
import { CONFIG } from '../config.js';
import { getState, update, clockFor } from '../store.js';
import { uid } from '../util.js';
import { checkBadges } from './badges.js';
import { currentPlayer } from './players.js';
import { matchStatus, outcomeLabel, matchTitle } from './matchInfo.js';
import { liveMarket } from '../providers/liveOdds.js';
import { RR_VERSION } from './ranks.js';

export const potentialGain = (stake, odds) => Math.floor((Number(stake) || 0) * odds);

export const COMBO_MIN = 2;
export const COMBO_MAX = 10;

// Matchs concernés par un pari (plusieurs pour un combiné).
export const betMatchIds = (b) => (b.legs ? b.legs.map((l) => l.matchId) : [b.matchId]);

const productOdds = (list) => Math.round(list.reduce((x, o) => x * o, 1) * 100) / 100;

export const isCombo = (p) => p.slipMode === 'combo' && p.slip.length >= COMBO_MIN && !p.slip.some((x) => x.live);

// Cote proposée maintenant pour une issue : avant le match, ou en direct ; null si fermée.
export function offeredOdds(m, outcome, t = clockFor(m)) {
  const status = matchStatus(m, t);
  if (status === 'upcoming') return m.odds[outcome] ?? null;
  if (status !== 'live') return null;
  const market = liveMarket(m, t);
  return market.open ? market.odds[outcome] ?? null : null;
}

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
    if (!p || !m) return;
    const i = p.slip.findIndex((x) => x.matchId === matchId);
    if (i !== -1 && p.slip[i].outcome === outcome) { p.slip.splice(i, 1); return; }
    const odds = offeredOdds(m, outcome);
    if (!odds) return;
    const live = matchStatus(m) === 'live';
    const item = { matchId, outcome, stake: i === -1 ? CONFIG.DEFAULT_STAKE : p.slip[i].stake, ...(live && { live: true, odds }) };
    if (i === -1) p.slip.push(item);
    else p.slip[i] = item;
  });
}

// Le joueur accepte les nouvelles cotes en direct de son panier.
export function acceptOdds() {
  update((s) => {
    for (const x of currentPlayer(s).slip) {
      const m = s.matches[x.matchId];
      const now = x.live && m ? offeredOdds(m, x.outcome) : null;
      if (now) x.odds = now;
    }
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
  // odds : cote retenue (vue par le joueur pour le direct) ; current : cote proposée en ce moment.
  const items = p.slip
    .filter((x) => s.matches[x.matchId])
    .map((x) => {
      const match = s.matches[x.matchId];
      const current = x.live && matchStatus(match) === 'live' ? offeredOdds(match, x.outcome) : match.odds[x.outcome];
      return { ...x, match, odds: x.live ? x.odds : match.odds[x.outcome], current };
    });
  const combo = isCombo(p);
  const comboOdds = productOdds(items.map((x) => x.odds));
  const comboStake = Number(p.comboStake ?? CONFIG.DEFAULT_STAKE);
  const total = combo ? comboStake || 0 : items.reduce((sum, x) => sum + (Number(x.stake) || 0), 0);
  const potential = combo
    ? potentialGain(comboStake, comboOdds)
    : items.reduce((sum, x) => sum + potentialGain(x.stake, x.odds), 0);
  const stakes = combo ? [comboStake] : items.map((x) => Number(x.stake));
  const live = items.filter((x) => x.live);
  const oddsChanged = live.some((x) => x.current && x.current !== x.odds);
  let error = null;
  if (!items.length) error = 'Ton panier est vide.';
  else if (items.some((x) => !x.live && matchStatus(x.match) !== 'upcoming')) error = 'Un match a déjà commencé : retire-le du panier.';
  else if (live.some((x) => !x.current)) error = 'Paris suspendus sur un match en direct : attends la reprise ou retire-le.';
  else if (oddsChanged) error = 'Une cote en direct a changé : accepte la nouvelle cote pour valider.';
  else if (combo && items.length > COMBO_MAX) error = `Un combiné peut contenir ${COMBO_MAX} matchs au maximum.`;
  else if (stakes.some((x) => !Number.isInteger(x) || x < CONFIG.MIN_STAKE)) error = `Mise minimum : ${CONFIG.MIN_STAKE} Goalz par pari.`;
  else if (total > p.balance) error = 'Solde insuffisant pour ces mises.';
  return { items, total, potential, error, combo, comboOdds, comboStake: p.comboStake ?? CONFIG.DEFAULT_STAKE, oddsChanged, hasLive: live.length > 0 };
}

export function placeSlip() {
  const { items, error, combo, comboOdds, comboStake } = slipCheck();
  if (error) throw new Error(error);
  if (combo) return placeCombo(items, comboOdds, Number(comboStake));
  return update((s) => {
    const p = currentPlayer(s);
    for (const x of items) {
      const { odds } = x;
      const stake = Number(x.stake);
      const id = uid('b');
      const t = clockFor(x.match);
      s.bets[id] = {
        id, playerId: p.id, matchId: x.matchId, outcome: x.outcome,
        odds, stake, potential: potentialGain(stake, odds),
        status: 'pending', payout: 0, placedAt: t, settledAt: null, real: !!x.match.real,
        ...(x.live && { live: { score: x.match.liveScore ?? null, clock: x.match.clock ?? null } }),
        // Vrai match : validé seulement si le score ne bouge pas pendant CONFIG.LIVE.CONFIRM_MS (la source a du retard).
        ...(x.live && x.match.real && { check: { score: x.match.liveScore ?? null, until: t + CONFIG.LIVE.CONFIRM_MS } }),
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
      legs: items.map((x) => ({ matchId: x.matchId, outcome: x.outcome, odds: x.odds, status: 'pending' })),
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
      bet.rrv = RR_VERSION;
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
        bet.rrv = RR_VERSION;
        bet.finalOdds = productOdds(won.map((l) => l.odds));
        bet.payout = potentialGain(bet.stake, bet.finalOdds);
        recordWin(p, bet, label);
      }
    }
    checkBadges(p);
  }
}

function refund(p, bet, t, label) {
  bet.status = 'void';
  bet.payout = bet.stake;
  bet.settledAt = t;
  p.balance += bet.stake;
  p.inbox.push({ type: 'void', amount: bet.stake, label });
}

// Basket : des paniers toutes les 30 s ; seul un écart qui bouge de 3 points ou plus compte.
function scoreMoved(m, before) {
  if (m.liveScore === before) return false;
  if (m.sport !== 'basketball') return true;
  const gap = (x) => { const [h, a] = String(x ?? '').split(' - ').map(Number); return h - a; };
  const d = gap(m.liveScore) - gap(before);
  return !(Math.abs(d) < 3);
}

// Vrais matchs, dans un update() à chaque lecture du score : un pari en direct est refusé (mise rendue)
// si le score a bougé avant la fin de sa validation, et validé quand le délai est passé sans changement.
export function reviewLiveBets(s, m, t) {
  for (const bet of Object.values(s.bets)) {
    if (!bet.check || bet.matchId !== m.id || bet.status !== 'pending') continue;
    const p = s.players[bet.playerId];
    if (!p) continue;
    if (scoreMoved(m, bet.check.score)) {
      delete bet.check;
      bet.refused = true;
      refund(p, bet, t, `${matchTitle(m)} : pari en direct refusé, le score a changé`);
    } else if (t >= bet.check.until) {
      delete bet.check;
    }
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
    if (bet.check) {
      // Pari en direct pas encore validé quand le match se termine : remboursé.
      delete bet.check;
      bet.refused = true;
      refund(p, bet, bet.settledAt, `${matchTitle(m)} : pari en direct non validé avant la fin`);
    } else if (m.outcome === 'void') {
      // Reporté, annulé ou nul sur un pari à 2 issues : mise rendue, série intacte.
      refund(p, bet, bet.settledAt, label);
    } else if (bet.outcome === m.outcome) {
      bet.status = 'won';
      bet.rrv = RR_VERSION;
      bet.payout = bet.potential;
      recordWin(p, { ...bet, real: m.real }, label);
    } else {
      bet.status = 'lost';
      bet.rrv = RR_VERSION;
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
