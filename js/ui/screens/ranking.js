import { escapeHtml, fmt } from '../../util.js';
import { globalRanking, leagueRanking } from '../../services/leaderboard.js';
import { myLeagues } from '../../services/leagues.js';
import { TIERS, RADIANT, RR_PER_DIVISION, LOSS_RR, RADIANT_SPOTS, rankOf, playerRR, seasonKey, seasonLabel, seasonEnd, seasonRR } from '../../services/ranks.js';
import { cloud, divisionRows, loadDivision, loadMyLeagues, loadTop, topRows, loadSeason, seasonRows, loadHallOfFame, LEAGUE_MAX_MEMBERS } from '../../services/cloud.js';
import { renderAccountCard } from './account.js';
import { renamePanel } from './profile.js';
import { coin, icons, rankEmblem } from '../icons.js';
import { avatarHtml, nameHtml, titleHtml } from '../cosmetics.js';
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
            ${nameHtml(r.name, r.style)}
            ${r.id === meId ? '<span class="tag">Toi</span>' : ''}
            ${r.isBot ? '<span class="tag tag-muted">simulé</span>' : ''}
          </span>
          <span class="rank-tier">${r.rank.label}${r.level ? ` · Niv. ${r.level}` : ''}${r.style?.title ? ` · ${titleHtml(r.style)}` : ''}</span>
        </span>
        <span class="rank-score">
          <strong>${fmt(r.rr)} <small>RR</small></strong>
          <span class="muted">${fmt(r.balance)} ${coin('coin coin-xs')}</span>
        </span>
      </li>`).join('')}
  </ol>`;
}

function myRankCard(me, pos, total, where = null) {
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
          · ${pos}<sup>${pos === 1 ? 'er' : 'e'}</sup> sur ${total}${where ? ` en ${escapeHtml(where)}` : ''}
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
        Chaque pari perdu coûte ${LOSS_RR} RR ; un pari gagné rapporte selon la cote (1,25 → 5 RR, 2 → 17 RR, 3 → 33 RR). Parier sur les favoris ne suffit pas : il faut voir juste plus souvent que les cotes.
        Un pari remboursé ne change rien. ${RR_PER_DIVISION} RR = une division (1, 2, 3), puis rang suivant.
        Les ${RADIANT_SPOTS} meilleurs Immortels deviennent Radiant. Le rang dépend de tes résultats,
        pas de ton solde ni de tes mises.
      </p>
    </details>`;
}

const leagueForms = () => `
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
    </div>`;

const leagueRow = (r, radiant) => ({
  id: r.uid, name: r.pseudo, rr: r.rr, balance: r.balance, isBot: false, style: { color: r.color, frame: r.frame, title: r.title }, level: r.level, rank: rankOf(r.rr, { radiant }),
});

// Ligues en ligne : partagées entre les appareils de tous les membres.
function onlineLeaguesView() {
  loadMyLeagues();
  const L = cloud.leagues;
  const meId = cloud.user.uid;
  const radiant = cloud.division?.radiant || new Set();
  return `
    ${leagueForms()}
    ${L?.error ? `<div class="empty feed-error"><p class="muted">${escapeHtml(L.error)}</p></div>` : ''}
    ${!L || (L.loading && !L.list.length) ? '<div class="skeletons"><div class="skeleton"></div></div>' : ''}
    ${L && !L.loading && !L.list.length ? `
      <div class="empty">
        <p><strong>Pas encore de ligue</strong></p>
        <p class="muted">Crée une ligue et envoie son code à tes amis : chacun la rejoint depuis son téléphone et vous avez votre propre classement.</p>
      </div>` : ''}
    ${(L?.list || []).map((l) => `
      <section class="card league">
        <header class="league-head">
          <div class="grow">
            <h3>${escapeHtml(l.name)}</h3>
            <span class="muted">${l.members.length} / ${LEAGUE_MAX_MEMBERS} membres${l.ownerUid === meId ? ' · tu l\'as créée' : ''}</span>
          </div>
          <button class="code-chip" data-action="copy-code" data-code="${escapeHtml(l.code)}" type="button" title="Copier le code">
            ${escapeHtml(l.code)} ${icons.copy}
          </button>
        </header>
        <button class="btn btn-primary btn-block invite-btn" data-action="league-invite" data-code="${escapeHtml(l.code)}" data-name="${escapeHtml(l.name)}" type="button">
          ${icons.share} Inviter des amis
        </button>
        ${rankList(l.rows.map((r) => leagueRow(r, radiant.has(r.uid))), meId)}
        <button class="link-btn danger" data-action="league-leave" data-code="${escapeHtml(l.code)}" type="button">Quitter la ligue</button>
      </section>`).join('')}
    ${L?.list?.length ? '<p class="muted division-note"><button class="link-btn" data-action="leagues-refresh" type="button">Actualiser les ligues</button></p>' : ''}`;
}

function leaguesView(s, p) {
  if (cloud.user) return onlineLeaguesView();
  const leagues = myLeagues(p.id, s);
  return `
    ${cloud.enabled ? `
      <div class="card division-locked">
        <strong>Joue en ligue avec tes amis</strong>
        <span class="muted">Connecte-toi pour créer des ligues que tes amis rejoignent depuis leur propre téléphone. Sans compte, les ligues restent sur cet appareil.</span>
      </div>
      ${renderAccountCard()}` : ''}
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

// Classement en ligne : les joueurs connectés qui sont dans la même division que toi.
function divisionView(s, p) {
  const myRR = playerRR(p.id, s);
  const myRank = rankOf(myRR);

  if (!cloud.enabled) return localView(s, p);
  if (!cloud.ready) return '<div class="skeletons"><div class="skeleton"></div></div>';
  if (!cloud.user) {
    return `
      <div class="card division-locked">
        <strong>Vois les joueurs de ta division</strong>
        <span class="muted">Connecte-toi pour te mesurer à tous les ${escapeHtml(myRank.label)} du jeu et voir qui est premier.</span>
      </div>
      ${renderAccountCard()}
      ${localView(s, p)}`;
  }

  loadDivision(myRR);
  const d = cloud.division;
  const rows = divisionRows().map((r) => ({
    id: r.uid, name: r.pseudo, rr: r.rr, balance: r.balance, isBot: false, style: { color: r.color, frame: r.frame, title: r.title }, level: r.level,
    rank: rankOf(r.rr, { radiant: d?.radiant?.has(r.uid) }),
  }));
  const meId = cloud.user.uid;
  const pos = rows.findIndex((r) => r.id === meId) + 1;
  const me = rows[pos - 1] || { rank: myRank };

  return `
    ${renamePanel(p)}
    ${myRankCard(me, pos || 1, rows.length || 1, myRank.label)}
    ${ladder()}
    <div class="section-row">
      <h2 class="section-title">Division ${escapeHtml(myRank.label)}</h2>
      <button class="link-btn" data-action="division-refresh" type="button">Actualiser</button>
    </div>
    ${d?.error ? `<div class="empty feed-error"><p class="muted">${escapeHtml(d.error)}</p></div>` : ''}
    ${!rows.length && d?.loading ? '<div class="skeletons"><div class="skeleton"></div></div>' : ''}
    ${rows.length ? rankList(rows, meId) : ''}
    ${rows.length === 1 ? '<p class="muted division-note">Tu es seul dans cette division pour l\'instant. Les autres joueurs apparaîtront ici dès qu\'ils y arriveront.</p>' : ''}`;
}

// Sans compte en ligne : les joueurs de cet appareil.
function localView(s, p) {
  const rows = globalRanking(s);
  const myPos = rows.findIndex((r) => r.id === p.id) + 1;
  return `
    ${cloud.user ? '' : myRankCard(rows[myPos - 1], myPos, rows.length)}
    ${cloud.user ? '' : ladder()}
    <h2 class="section-title">Joueurs de cet appareil</h2>
    ${rankList(rows, p.id)}`;
}

// Hall of Fame : le podium de la saison terminée (mois précédent).
function hallOfFame() {
  const h = cloud.hof;
  if (!h?.rows?.length) return '';
  const medal = ['🥇', '🥈', '🥉'];
  return `
    <section class="card hof">
      <div class="hof-head"><strong>Hall of Fame</strong><span class="muted">Champions de ${escapeHtml(seasonLabel(h.key))}</span></div>
      <ol class="hof-podium">
        ${h.rows.map((r, i) => `
          <li class="hof-${i + 1}">
            <span class="hof-medal">${medal[i]}</span>
            ${avatarHtml(r.pseudo, { frame: r.frame || 'frame-champion' })}
            ${nameHtml(r.pseudo, { color: r.color })}
            <small>${fmt(r.score)} RR</small>
          </li>`).join('')}
      </ol>
    </section>`;
}

// Classement de la saison : RR gagnés depuis le 1er du mois ; le top 3 entre au Hall of Fame.
function seasonView(s, p) {
  loadSeason();
  const c = cloud.season;
  const meId = cloud.user.uid;
  const rows = seasonRows().map((r) => ({
    id: r.uid, name: r.pseudo, rr: r.seasonRR, balance: r.balance, isBot: false,
    style: { color: r.color, frame: r.frame, title: r.title }, level: r.level, rank: rankOf(r.rr),
  }));
  const mine = seasonRR(p.id, s);
  const pos = rows.findIndex((r) => r.id === meId) + 1;
  const days = Math.max(0, Math.ceil((seasonEnd() - Date.now()) / 86_400_000));
  return `
    <div class="section-row">
      <h2 class="section-title">Saison ${escapeHtml(seasonLabel(seasonKey()))}</h2>
      <button class="link-btn" data-action="season-refresh" type="button">Actualiser</button>
    </div>
    <p class="muted division-note">Fin dans ${days} jour${days > 1 ? 's' : ''}. Tout le monde repart de 0 le 1er du mois : le top 3 entre au Hall of Fame et gagne un cadre et un titre Champion exclusifs.
      ${pos ? ` Tu es <strong>${pos === 1 ? '1er' : `${pos}e`}</strong> avec ${fmt(mine)} RR.` : ' Gagne des paris pour entrer dans le classement.'}</p>
    ${c?.error ? `<div class="empty feed-error"><p class="muted">${escapeHtml(c.error)}</p></div>` : ''}
    ${!rows.length && c?.loading ? '<div class="skeletons"><div class="skeleton"></div></div>' : ''}
    ${rows.length ? rankList(rows, meId) : (c?.loading ? '' : '<div class="empty"><p class="muted">Personne n\'a encore marqué de RR ce mois-ci. À toi de lancer la saison !</p></div>')}`;
}

// Classement général : tous les joueurs connectés du jeu, du meilleur au moins bon.
function topView(s, p) {
  const myRR = playerRR(p.id, s);
  if (!cloud.enabled) return localView(s, p);
  if (!cloud.ready) return '<div class="skeletons"><div class="skeleton"></div></div>';
  if (!cloud.user) {
    return `
      <div class="card division-locked">
        <strong>Le classement de tous les joueurs</strong>
        <span class="muted">Connecte-toi pour apparaître dans le classement général et voir qui est le meilleur pronostiqueur de Goalzz.</span>
      </div>
      ${renderAccountCard()}
      ${localView(s, p)}`;
  }
  loadHallOfFame();
  const scope = ui.topScope === 'all' ? 'all' : 'season';
  const head = `
    ${renamePanel(p)}
    ${hallOfFame()}
    <div class="tabs scope-tabs" role="tablist">
      <button class="tab ${scope === 'season' ? 'active' : ''}" data-action="top-scope" data-scope="season" role="tab" type="button">Saison ${escapeHtml(seasonLabel(seasonKey()).split(' ')[0])}</button>
      <button class="tab ${scope === 'all' ? 'active' : ''}" data-action="top-scope" data-scope="all" role="tab" type="button">Tous les temps</button>
    </div>`;
  if (scope === 'season') return head + seasonView(s, p);
  loadTop(myRR);
  const t = cloud.top;
  const { rows: raw, radiant, myPos, me } = topRows();
  const rows = raw.map((r) => ({ id: r.uid, name: r.pseudo, rr: r.rr, balance: r.balance, isBot: false, style: { color: r.color, frame: r.frame, title: r.title }, level: r.level, rank: rankOf(r.rr, { radiant: radiant.has(r.uid) }) }));
  const meId = cloud.user.uid;
  const mine = rows.find((r) => r.id === meId);
  return `
    ${head}
    <div class="section-row">
      <h2 class="section-title">Classement général</h2>
      <button class="link-btn" data-action="top-refresh" type="button">Actualiser</button>
    </div>
    ${myPos ? `<p class="muted division-note">Tu es <strong>${myPos === 1 ? '1er' : `${myPos}e`}</strong> sur tous les joueurs${mine ? '' : ` avec ${fmt(myRR)} RR`}.</p>` : ''}
    ${t?.error ? `<div class="empty feed-error"><p class="muted">${escapeHtml(t.error)}</p></div>` : ''}
    ${!rows.length && t?.loading ? '<div class="skeletons"><div class="skeleton"></div></div>' : ''}
    ${rows.length ? rankList(rows, meId) : ''}
    ${me && !mine ? `<p class="muted division-note">Seuls les 100 premiers sont affichés.</p>` : ''}`;
}

export function renderRanking(s, p) {
  if (ui.rankTab !== 'leagues' && ui.rankTab !== 'division') ui.rankTab = 'top';
  return `
    <h1 class="page-title">Rangs</h1>
    <div class="tabs" role="tablist">
      <button class="tab ${ui.rankTab === 'top' ? 'active' : ''}" data-action="rank-tab" data-tab="top" role="tab" type="button">Classement</button>
      <button class="tab ${ui.rankTab === 'division' ? 'active' : ''}" data-action="rank-tab" data-tab="division" role="tab" type="button">Ma division</button>
      <button class="tab ${ui.rankTab === 'leagues' ? 'active' : ''}" data-action="rank-tab" data-tab="leagues" role="tab" type="button">Ligues privées</button>
    </div>
    ${ui.rankTab === 'top' ? topView(s, p) : ui.rankTab === 'division' ? divisionView(s, p) : leaguesView(s, p)}
  `;
}
