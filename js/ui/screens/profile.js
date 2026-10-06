import { CONFIG } from '../../config.js';
import { escapeHtml, fmt, fmtOdds } from '../../util.js';
import { BADGES } from '../../services/badges.js';
import { coin, icons } from '../icons.js';
import { renderAccountCard } from './account.js';
import { cloud } from '../../services/cloud.js';
import { ui } from '../uiState.js';
import { legalLinks } from './legal.js';

const pseudoTaken = (p) => !!cloud.pseudoConflict && cloud.pseudoConflict === p.pseudo;

export function renderProfile(s, p) {
  if (pseudoTaken(p)) ui.profileTab = 'settings';
  const tab = ui.profileTab === 'settings' ? 'settings' : 'stats';
  const since = new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <section class="profile-hero card">
      <span class="avatar avatar-lg">${escapeHtml(p.pseudo[0].toUpperCase())}</span>
      <div class="grow">
        <h1>${escapeHtml(p.pseudo)}</h1>
        <span class="muted">Joueur depuis le ${since}</span>
      </div>
      <div class="profile-balance">${fmt(p.balance)} ${coin()}</div>
    </section>

    <div class="tabs" role="tablist">
      <button class="tab ${tab === 'stats' ? 'active' : ''}" data-action="profile-tab" data-tab="stats" role="tab" aria-selected="${tab === 'stats'}" type="button">Profil</button>
      <button class="tab ${tab === 'settings' ? 'active' : ''}" data-action="profile-tab" data-tab="settings" role="tab" aria-selected="${tab === 'settings'}" type="button">Réglages</button>
    </div>

    ${tab === 'settings' ? settingsView(p) : statsView(p)}
  `;
}

function statsView(p) {
  const st = p.stats;
  const unlocked = BADGES.filter((b) => p.badges[b.id]).length;
  return `
    ${cloud.user ? '' : renderAccountCard()}

    <div class="stat-row stat-row-4">
      <div class="stat"><span class="muted">Paris</span><strong>${st.betsPlaced}</strong></div>
      <div class="stat"><span class="muted">Victoires</span><strong>${st.wins}</strong></div>
      <div class="stat"><span class="muted">Meilleure série</span><strong>${st.bestStreak}</strong></div>
      <div class="stat"><span class="muted">Plus grosse cote</span><strong>${st.maxOddsWon ? fmtOdds(st.maxOddsWon) : '–'}</strong></div>
    </div>

    <div class="section-row">
      <h2 class="section-title">Badges</h2>
      <span class="muted">${unlocked} / ${BADGES.length}</span>
    </div>
    <div class="badge-grid">
      ${BADGES.map((b) => `
        <div class="badge ${p.badges[b.id] ? 'unlocked' : 'locked'}">
          <span class="badge-icon">${icons[b.icon] || ''}</span>
          <strong>${escapeHtml(b.name)}</strong>
          <span class="muted">${escapeHtml(b.desc)}</span>
        </div>`).join('')}
    </div>

    <section class="card disclaimer">
      <h2>Jeu gratuit, sans argent réel</h2>
      <p class="muted">
        Les Goalz sont une monnaie 100 % virtuelle. Ils ne peuvent pas être achetés, ni échangés
        contre de l'argent, des lots ou quoi que ce soit d'autre. Les « matchs éclair » sont
        fictifs ; les « vrais matchs » suivent les résultats officiels.
      </p>
    </section>`;
}

function settingsView(p) {
  return `
    ${pseudoCard(p)}

    <h2 class="section-title">Compte</h2>
    ${renderAccountCard()}

    <h2 class="section-title">Appareil</h2>
    <section class="card settings-list">
      ${installRow()}
      <div class="settings-row">
        <div class="grow"><strong>Changer de joueur</strong><span class="muted">Revenir à l'écran d'accueil pour jouer avec un autre profil.</span></div>
        <button class="btn btn-ghost" data-action="logout" type="button">Changer</button>
      </div>
      ${cloud.user ? `
      <div class="settings-row">
        <div class="grow"><strong>Supprimer mon compte</strong><span class="muted">Efface définitivement ton compte, ta partie en ligne et ta place dans les classements.</span></div>
        <button class="link-btn danger" data-action="delete-account" type="button">Supprimer</button>
      </div>` : ''}
      <div class="settings-row">
        <div class="grow"><strong>Réinitialiser l'appli</strong><span class="muted">Efface tous les joueurs, paris et ligues de cet appareil.</span></div>
        <button class="link-btn danger" data-action="reset-app" type="button">Tout effacer</button>
      </div>
    </section>
    ${legalLinks()}`;
}

// Changement de pseudo : payant, sauf si un autre compte a déjà réservé le pseudo actuel.
function pseudoCard(p) {
  const taken = pseudoTaken(p);
  const cost = CONFIG.RENAME_COST;
  const short = !taken && p.balance < cost;
  return `
    <form class="card rename-card ${taken ? 'is-conflict' : ''}" data-form="rename" autocomplete="off">
      <strong>${!taken ? 'Changer de pseudo' : cloud.pseudoBanned ? `Le pseudo « ${escapeHtml(p.pseudo)} » n'est pas autorisé` : `Le pseudo « ${escapeHtml(p.pseudo)} » est déjà pris`}</strong>
      <span class="muted">${taken
        ? `${cloud.pseudoBanned ? 'Il contient un mot interdit.' : 'Un autre joueur l\'utilise déjà.'} Choisis-en un nouveau (gratuit) pour apparaître dans le classement.`
        : `Ton pseudo doit être unique dans tout le jeu. Le changer coûte ${fmt(cost)} Goalz.`}</span>
      <div class="input-row">
        <input id="rename-input" name="pseudo" maxlength="16" placeholder="Nouveau pseudo" required ${short ? 'disabled' : ''}>
        <button class="btn btn-primary" type="submit" ${short ? 'disabled' : ''}>
          ${taken ? 'Valider' : `${fmt(cost)} ${coin('coin coin-sm')}`}
        </button>
      </div>
      ${short ? `<span class="warn">Il te manque ${fmt(cost - p.balance)} Goalz.</span>` : ''}
    </form>`;
}

// Encadré affiché ailleurs (Rangs) quand le pseudo est pris par un autre compte.
export function renamePanel(p) {
  return pseudoTaken(p) ? pseudoCard(p) : '';
}

// Installer Goalz comme une appli : bouton du navigateur (Android, ordinateur) ou consigne iPhone.
function installRow() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ui.installPrompt && !ios) return '';
  return `
      <div class="settings-row">
        <div class="grow"><strong>Installer l'appli</strong><span class="muted">${ui.installPrompt
          ? 'Ajoute Goalz à ton écran d\'accueil, comme une vraie appli.'
          : 'Sur iPhone : touche Partager, puis « Sur l\'écran d\'accueil ».'}</span></div>
        ${ui.installPrompt ? '<button class="btn btn-primary" data-action="install-app" type="button">Installer</button>' : ''}
      </div>`;
}
