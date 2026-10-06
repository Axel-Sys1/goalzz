import { CONFIG } from '../../config.js';
import { escapeHtml, fmt, fmtOdds, formatKickoff } from '../../util.js';
import { clockFor } from '../../store.js';
import { betsOf } from '../../services/bets.js';
import { isAwaitingKickoff, matchStatus, outcomeLabel, sportOf } from '../../services/matchInfo.js';
import { coin, icons } from '../icons.js';
import { teamMark } from '../logos.js';
import { ui } from '../uiState.js';

const STATUS = {
  pending: { label: 'En cours', empty: 'Aucun pari en cours. Va jeter un œil aux matchs !' },
  won: { label: 'Gagnés', empty: 'Pas encore de pari gagné… ça va venir !' },
  lost: { label: 'Perdus', empty: 'Aucun pari perdu. Joli !' },
  void: { label: 'Remboursés', empty: 'Aucun pari remboursé.' },
};

const LEG = { pending: icons.clock, won: icons.check, lost: icons.cross, void: icons.undo };

function comboCard(b) {
  const pill = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' }[b.status];
  const left = b.legs.filter((l) => l.status === 'pending').length;
  return `
  <article class="bet bet-${b.status} bet-combo">
    <header class="bet-head">
      <span class="comp">Combiné · ${b.legs.length} matchs</span>
      <span class="bet-right">${b.status === 'pending' ? `<span class="kick">${left} restant${left > 1 ? 's' : ''}</span>` : ''}<span class="status-pill">${pill}</span></span>
    </header>
    <ul class="combo-legs">
      ${b.legs.map((l) => `
        <li class="leg leg-${l.status}">
          <span class="leg-icon">${LEG[l.status]}</span>
          <span class="grow">
            <span class="leg-match">${teamMark(l.match.home, 'logo-img logo-sm')} ${escapeHtml(l.match.home.name)} – ${teamMark(l.match.away, 'logo-img logo-sm')} ${escapeHtml(l.match.away.name)}</span>
            <span class="leg-pick">${escapeHtml(outcomeLabel(l.match, l.outcome))}${l.match.score ? ` · ${escapeHtml(l.match.score)}` : ''}</span>
          </span>
          <span class="at">${fmtOdds(l.odds)}</span>
        </li>`).join('')}
    </ul>
    <div class="bet-pick">Cote totale <span class="at">@ ${fmtOdds(b.finalOdds || b.odds)}</span></div>
    ${betNums(b)}
  </article>`;
}

function betNums(b) {
  return `
    <div class="bet-nums">
      <div><span class="muted">Mise</span><strong>${fmt(b.stake)} ${coin('coin coin-xs')}</strong></div>
      <div class="right">
        <span class="muted">${{ pending: 'Gain potentiel', won: 'Gain', lost: 'Résultat', void: 'Mise rendue' }[b.status]}</span>
        <strong class="${b.status === 'won' ? 'gain' : b.status === 'lost' ? 'loss' : ''}">
          ${b.status === 'lost' ? `−${fmt(b.stake)}` : b.status === 'won' ? `+${fmt(b.payout)}` : fmt(b.status === 'void' ? b.payout : b.potential)}
          ${coin('coin coin-xs')}
        </strong>
      </div>
    </div>`;
}

function betCard(b) {
  if (b.legs) return comboCard(b);
  const m = b.match;
  const t = clockFor(m);
  const st = matchStatus(m, t);
  let when = '';
  if (b.status === 'pending') {
    if (st === 'live') when = isAwaitingKickoff(m, t) ? '<span class="soon-pill">PARIS FERMÉS</span>' : '<span class="live-pill">EN DIRECT</span>';
    else when = `<span class="kick" data-kickoff="${m.startsAt}"${m.real ? ' data-real="1"' : ''}>${formatKickoff(m.startsAt, t)}</span>`;
  }
  const pill = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' }[b.status];
  const score = m.score || (st === 'live' && m.liveScore ? m.liveScore : '');
  return `
  <article class="bet bet-${b.status}">
    <header class="bet-head">
      <span class="comp">${sportOf(m).icon} ${escapeHtml(m.competition)}${m.real ? '' : ' <span class="tag tag-muted">éclair</span>'}</span>
      <span class="bet-right">${when}<span class="status-pill">${pill}</span></span>
    </header>
    <div class="bet-match">
      <span class="bet-teams">${teamMark(m.home, 'logo-img logo-sm')} ${escapeHtml(m.home.name)} – ${teamMark(m.away, 'logo-img logo-sm')} ${escapeHtml(m.away.name)}</span>
      ${score ? `<span class="bet-score">${escapeHtml(score)}</span>` : ''}
    </div>
    <div class="bet-pick">${escapeHtml(outcomeLabel(m, b.outcome))} <span class="at">@ ${fmtOdds(b.odds)}</span></div>
    ${betNums(b)}
  </article>`;
}

export function renderMyBets(s, p) {
  const bets = betsOf(p.id, s);
  const groups = { pending: [], won: [], lost: [], void: [] };
  bets.forEach((b) => groups[b.status].push(b));
  const startOf = (b) => Math.min(...(b.legs ? b.legs.filter((l) => l.status === 'pending').map((l) => l.match.startsAt) : [b.match.startsAt]));
  groups.pending.sort((a, b) => startOf(a) - startOf(b));
  groups.won.sort((a, b) => b.settledAt - a.settledAt);
  groups.lost.sort((a, b) => b.settledAt - a.settledAt);
  groups.void.sort((a, b) => b.settledAt - a.settledAt);
  if (ui.betsTab === 'void' && !groups.void.length) ui.betsTab = 'pending';
  const tabs = Object.entries(STATUS).filter(([k]) => k !== 'void' || groups.void.length);
  const pendingFake = groups.pending.some((b) => (b.legs ? b.legs.some((l) => !l.match.real) : !b.match.real));

  const settled = groups.won.length + groups.lost.length;
  const rate = settled ? Math.round((groups.won.length / settled) * 100) : 0;
  const net = groups.won.reduce((x, b) => x + b.payout - b.stake, 0) - groups.lost.reduce((x, b) => x + b.stake, 0);
  const list = groups[ui.betsTab];

  return `
    <h1 class="page-title">Mes paris</h1>

    <div class="stat-row">
      <div class="stat"><span class="muted">Paris placés</span><strong>${bets.length}</strong></div>
      <div class="stat"><span class="muted">Réussite</span><strong>${settled ? `${rate} %` : '–'}</strong></div>
      <div class="stat"><span class="muted">Bilan</span><strong class="${net > 0 ? 'gain' : net < 0 ? 'loss' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt(Math.abs(net))}</strong></div>
    </div>

    <div class="tabs" role="tablist">
      ${tabs.map(([k, v]) => `
        <button class="tab ${ui.betsTab === k ? 'active' : ''}" role="tab" aria-selected="${ui.betsTab === k}"
          data-action="bets-tab" data-tab="${k}" type="button">
          ${v.label} <span class="tab-count">${groups[k].length}</span>
        </button>`).join('')}
    </div>

    ${ui.betsTab === 'pending' && pendingFake ? `
      <div class="ff-card">
        <div class="grow">
          <strong>Des matchs éclair sont en cours</strong>
          <span class="muted">Avance l'horloge des matchs fictifs. Les vrais matchs, eux, suivent le temps réel.</span>
        </div>
        <button class="btn btn-ghost" data-action="fast-forward" type="button">${icons.forward} +${CONFIG.FAST_FORWARD_MIN} min</button>
      </div>` : ''}

    ${list.length
      ? `<div class="bet-list">${list.map((b) => betCard(b)).join('')}</div>`
      : `<div class="empty"><p class="muted">${STATUS[ui.betsTab].empty}</p>
          ${ui.betsTab === 'pending' ? `<button class="btn btn-ghost" data-action="go" data-route="matchs" type="button">Voir les matchs</button>` : ''}</div>`}
  `;
}
