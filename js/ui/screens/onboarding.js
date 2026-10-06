import { CONFIG } from '../../config.js';
import { escapeHtml, fmt } from '../../util.js';
import { listProfiles } from '../../services/players.js';
import { coin, icons } from '../icons.js';
import { renderAccountCard } from './account.js';

export function renderOnboarding(s) {
  const profiles = listProfiles(s);
  return `
  <div class="onboarding">
    <div class="hero-glow"></div>
    <div class="onboarding-card">
      <div class="brand-big">${icons.ball}<span>GOAL<b>Z</b></span></div>
      <p class="tagline">Foot, basket, tennis, MMA, rugby… sur les vrais matchs.<br>Grimpe les rangs. Défie tes potes.</p>

      <div class="free-pill">Jeu gratuit · sans argent réel</div>

      <form class="register" data-form="register" autocomplete="off">
        <label for="pseudo-input">Choisis ton pseudo</label>
        <input id="pseudo-input" name="pseudo" maxlength="16" placeholder="ex. LeRoiDuPronostic" required>
        <button class="btn btn-primary btn-lg" type="submit">
          Commencer avec ${fmt(CONFIG.STARTING_BALANCE)} ${coin('coin coin-sm')}
        </button>
      </form>

      ${profiles.length ? `
        <div class="profiles">
          <p class="eyebrow">Ou reprends ta partie</p>
          ${profiles.map((p) => `
            <button class="profile-row" data-action="login" data-id="${p.id}" type="button">
              <span class="avatar">${escapeHtml(p.pseudo[0].toUpperCase())}</span>
              <span class="grow">${escapeHtml(p.pseudo)}</span>
              <span class="amount">${fmt(p.balance)} ${coin('coin coin-sm')}</span>
            </button>`).join('')}
        </div>` : ''}

      ${renderAccountCard({ compact: true })}

      <p class="fineprint">
        Les Goalz sont une monnaie 100 % virtuelle : ils ne s'achètent pas et ne s'échangent
        pas contre de l'argent ou des lots. Aucune transaction d'argent réel.
      </p>
    </div>
  </div>`;
}
