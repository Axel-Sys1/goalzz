import { CONFIG } from '../../config.js';
import { escapeHtml, fmt } from '../../util.js';
import { listProfiles } from '../../services/players.js';
import { TIERS, RADIANT, RR_PER_DIVISION, rankOf } from '../../services/ranks.js';
import { coin, icons, rankEmblem } from '../icons.js';
import { inviteBanner, renderAccountCard } from './account.js';
import { legalLinks } from './legal.js';

const FEATURES = [
  { icon: 'stadium', title: 'Les vrais matchs', text: 'Ligue 1, Premier League, Ligue des champions, NBA, tennis, UFC, rugby… résultats officiels en direct.' },
  { icon: 'trophy', title: 'Des rangs à grimper', text: 'De Fer à Radiant : chaque bon prono te fait monter, chaque raté te fait descendre.' },
  { icon: 'user', title: 'Ligues entre potes', text: 'Crée ta ligue, envoie le lien sur WhatsApp, et voyez qui est le vrai expert.' },
  { icon: 'bolt', title: 'Matchs éclair', text: 'Envie de jouer tout de suite ? Des matchs fictifs de 2 minutes, à toute heure.' },
];

export function renderOnboarding(s) {
  const profiles = listProfiles(s);
  const ladder = [...TIERS.map((t, i) => ({ ...rankOf(i * 3 * RR_PER_DIVISION), division: null, label: t.name })), { ...RADIANT, division: null, label: RADIANT.name }];
  return `
  <div class="onboarding">
    <div class="hero-glow"></div>
    <div class="landing">
      <section class="landing-hero">
        <div class="brand-big">${icons.ball}<span>GOAL<b>Z</b></span></div>
        <h1 class="landing-title">Pronostique.<br>Grimpe.<br><b>Domine tes potes.</b></h1>
        <p class="tagline">Le jeu de pronos sportifs gratuit avec une monnaie 100 % virtuelle.</p>
        <div class="landing-ladder" aria-label="Les rangs, de Fer à Radiant">
          ${ladder.map((r, i) => `<span style="animation-delay:${0.15 + i * 0.07}s">${rankEmblem(r)}</span>`).join('')}
        </div>
      </section>

      <ul class="features">
          ${FEATURES.map((f) => `
            <li>
              <span class="feature-icon">${icons[f.icon]}</span>
              <span><strong>${f.title}</strong><span class="muted">${f.text}</span></span>
            </li>`).join('')}
      </ul>

      <section class="onboarding-card">
        ${inviteBanner()}
        <form class="register" data-form="register" autocomplete="off">
          <label for="pseudo-input">Choisis ton pseudo</label>
          <input id="pseudo-input" name="pseudo" maxlength="16" placeholder="ex. LeRoiDuProno" required>
          <button class="btn btn-primary btn-lg" type="submit">
            Jouer avec ${fmt(CONFIG.STARTING_BALANCE)} ${coin('coin coin-sm')} offerts
          </button>
          <span class="fineprint">Gratuit, sans inscription obligatoire. Crée un compte ensuite pour jouer sur tous tes appareils.</span>
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
          Jeu gratuit, sans argent réel. Les Goalz ne s'achètent pas et ne s'échangent pas contre
          de l'argent ou des lots.
        </p>
        ${legalLinks()}
      </section>
    </div>
  </div>`;
}
