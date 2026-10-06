import { escapeHtml, fmt } from '../../util.js';
import { globalRanking, leagueRanking } from '../../services/leaderboard.js';
import { myLeagues } from '../../services/leagues.js';
import { TIERS, RADIANT, RR_PER_DIVISION, LOSS_RR, RADIANT_SPOTS, rankOf } from '../../services/ranks.js';
import { coin, icons, rankEmblem } from '../icons.js';
import { ui } from '../uiState.js';

function rankList(rows, meId) {
  return `
  <ol class="rank-list">
    ${rows.map((r, i) => `
      <li class="rank-row ${r.id === meId ? 'me' : ''}" style="--rank-color:${r.rank.color}">
        <span class="rank-pos">${i + 1}</span>
        ${rankEmblem(r.rank)}
        <span class="grow rank-who">
          <span class="rank-name">
            ${escapeHtml(r.name)}
            ${r.id === meId ? '<span class="tag">Toi</span>' : ''}
            ${r.isBot ? '<span class="tag tag-muted">simulé</span>' : ''}
          </span>
          <span class="rank-tier">${r.rank.label}</span>
        </span>
        <span class="rank-score">
          <strong>${fmt(r.rr)} <small>RR</small></strong>
          <span class="muted">${fmt(r.balance)} ${coin('coin coin-xs')}</span>
        </span>
      </li>`).join('')}
  </ol>`;
}

function myRankCard(me, pos, total) {
  const r = me.rank;
  return `
    <section class="card my-rank-card" style="--rank-color:${r.color}">
      ${rankEmblem(r, 'rank-emblem rank-emblem-lg')}
      <div class="grow">
        <span class="muted">Ton rang</span>
        <h2 class="my-rank-name">${r.label}</h2>
        <div class="rr-bar"><span style="width:${Math.round(r.progress * 100)}%"></span></div>
        <span class="muted rr-text">
          ${r.top ? `${fmt(r.rr)} RR` : `${r.inDivision} / ${RR_PER_DIVISION} RR`}
          · ${pos}<sup>${pos === 1 ? 'er' : 'e'}</sup> sur ${total}
        </span>
      </div>
    </section>`;
}

function ladder() {
  const steps = [...TIERS.map((t, i) => ({ ...rankOf(i * 3 * RR_PER_DIVISION), division: null, label: t.name })),
    { ...RADIANT, division: null, label: RADIANT.name }];
  return `
    <details class="card rank-help">
      <summary>Comment marchent les rangs ?</summary>
      <div class="ladder">
        ${steps.map((t) => `<span class="ladder-step">${rankEmblem(t)}<small>${t.label}</small></span>`).join('')}
      </div>
      <p class="muted">
        Chaque pari gagné rapporte de 12 à 40 RR selon la cote, chaque pari perdu en coûte ${LOSS_RR}.
        Un pari remboursé ne change rien. ${RR_PER_DIVISION} RR = une division (1, 2, 3), puis rang suivant.
        Les ${RADIANT_SPOTS} meilleurs Immortels deviennent Radiant. Le rang dépend de tes résultats,
        pas de ton solde ni de tes mises.
      </p>
    </details>`;
}

function leaguesView(s, p) {
  const leagues = myLeagues(p.id, s);
  return `
    <div class="league-forms">
      <form class="card form-inline" data-form="league-create" autocomplete="off">
        <label for="league-name">Créer une ligue</label>
        <div class="input-row">
          <input id="league-name" name="name" maxlength="24" placeholder="ex. Les Potes du Jeudi" required>
          <button class="btn btn-primary" type="submit">Créer</button>
        </div>
      </form>
      <form class="card form-inline" data-form="league-join" autocomplete="off">
        <label for="league-code">Rejoindre avec un code</label>
        <div class="input-row">
          <input id="league-code" name="code" maxlength="6" placeholder="ABC123" class="code-input" required>
          <button class="btn btn-ghost" type="submit">Rejoindre</button>
        </div>
      </form>
    </div>

    ${leagues.length ? leagues.map((l) => `
      <section class="card league">
        <header class="league-head">
          <div class="grow">
            <h3>${escapeHtml(l.name)}</h3>
            <span class="muted">${l.members.length} membre${l.members.length > 1 ? 's' : ''}${l.ownerId === p.id ? ' · tu es l\'admin' : ''}</span>
          </div>
          <button class="code-chip" data-action="copy-code" data-code="${l.code}" type="button" title="Copier le code">
            ${l.code} ${icons.copy}
          </button>
        </header>
        ${rankList(leagueRanking(l.code, s), p.id)}
        <button class="link-btn danger" data-action="league-leave" data-code="${l.code}" type="button">Quitter la ligue</button>
      </section>`).join('') : `
      <div class="empty">
        <p><strong>Pas encore de ligue</strong></p>
        <p class="muted">Crée une ligue et partage son code avec tes amis pour avoir votre propre classement.</p>
      </div>`}
  `;
}

export function renderRanking(s, p) {
  const rows = globalRanking(s);
  const myPos = rows.findIndex((r) => r.id === p.id) + 1;
  return `
    <h1 class="page-title">Rangs</h1>
    <div class="tabs" role="tablist">
      <button class="tab ${ui.rankTab === 'global' ? 'active' : ''}" data-action="rank-tab" data-tab="global" role="tab" type="button">Général</button>
      <button class="tab ${ui.rankTab === 'leagues' ? 'active' : ''}" data-action="rank-tab" data-tab="leagues" role="tab" type="button">Ligues privées</button>
    </div>
    ${ui.rankTab === 'global' ? `
      ${myRankCard(rows[myPos - 1], myPos, rows.length)}
      ${ladder()}
      ${rankList(rows, p.id)}` : leaguesView(s, p)}
  `;
}
