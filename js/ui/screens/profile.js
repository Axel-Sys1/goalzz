import { escapeHtml, fmt, fmtOdds } from '../../util.js';
import { BADGES } from '../../services/badges.js';
import { coin } from '../icons.js';

export function renderProfile(s, p) {
  const st = p.stats;
  const unlocked = BADGES.filter((b) => p.badges[b.id]).length;
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
          <span class="badge-icon">${b.icon}</span>
          <strong>${escapeHtml(b.name)}</strong>
          <span class="muted">${escapeHtml(b.desc)}</span>
        </div>`).join('')}
    </div>

    <section class="card disclaimer">
      <h2>🎮 Jeu gratuit, sans argent réel</h2>
      <p class="muted">
        Les Goalz sont une monnaie 100 % virtuelle. Ils ne peuvent pas être achetés, ni échangés
        contre de l'argent, des lots ou quoi que ce soit d'autre. Les « matchs éclair » sont
        fictifs ; les « vrais matchs » suivent les résultats officiels.
      </p>
    </section>

    <div class="profile-actions">
      <button class="btn btn-ghost" data-action="logout" type="button">Changer de joueur</button>
      <button class="link-btn danger" data-action="reset-app" type="button">Réinitialiser l'appli</button>
    </div>
  `;
}
