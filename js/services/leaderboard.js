import { getState } from '../store.js';
import { playerRR, rankOf, isImmortal, RADIANT_SPOTS } from './ranks.js';

// Classement par RR, puis par solde à égalité.
const byRR = (a, b) => b.rr - a.rr || b.balance - a.balance || a.name.localeCompare(b.name);

const humanRow = (p, s) => ({ id: p.id, name: p.pseudo, balance: p.balance, rr: playerRR(p.id, s), isBot: false });

// Les RADIANT_SPOTS meilleurs Immortels du classement général sont Radiant.
function withRanks(rows, radiantIds) {
  return rows.map((r) => ({ ...r, rank: rankOf(r.rr, { radiant: radiantIds.has(r.id) }) }));
}

function radiantIds(sorted) {
  return new Set(sorted.filter((r) => isImmortal(r.rr)).slice(0, RADIANT_SPOTS).map((r) => r.id));
}

// Seuls les vrais joueurs sont classés : les joueurs simulés n'apparaissent plus.
function globalRows(s) {
  return Object.values(s.players).map((p) => humanRow(p, s)).sort(byRR);
}

export function globalRanking(s = getState()) {
  const rows = globalRows(s);
  return withRanks(rows, radiantIds(rows));
}

export function leagueRanking(code, s = getState()) {
  const l = s.leagues[code];
  if (!l) return [];
  const rows = l.members
    .map((id) => s.players[id])
    .filter(Boolean)
    .map((p) => humanRow(p, s))
    .sort(byRR);
  return withRanks(rows, radiantIds(globalRows(s)));
}
