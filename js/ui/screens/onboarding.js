import { CONFIG } from '../../config.js';
import { escapeHtml, fmt } from '../../util.js';
import { listProfiles } from '../../services/players.js';
import { TIERS, RADIANT, RR_PER_DIVISION, rankOf } from '../../services/ranks.js';
import { coin, googleLogo, icons, rankEmblem } from '../icons.js';
import { eventDecor, eventLogo, eventTag } from '../season.js';
import { inviteBanner, renderAccountCard, PERKS } from './account.js';
import { cloud } from '../../services/cloud.js';
import { ui } from '../uiState.js';
import { pendingReferral, REWARD } from '../../services/referral.js';
import { legalLinks } from './legal.js';
import { matchCard } from './matches.js';
import { matchStatus } from '../../services/matchInfo.js';
import { spotlight } from '../../services/spotlight.js';
import { realNow } from '../../store.js';
import { cardHtml } from '../cards.js';
import { CARDS, cardById } from '../../services/cards.js';

// Les matchs du moment, visibles sans pseudo : en direct d'abord, puis les gros matchs à venir.
function guestMatches(s) {
  const t = realNow();
  const real = Object.values(s.matches).filter((m) => m.real);
  const live = real.filter((m) => matchStatus(m, t) === 'live').sort((a, b) => a.startsAt - b.startsAt).slice(0, 4);
  const upcoming = real.filter((m) => matchStatus(m, t) === 'upcoming');
  const top = spotlight(upcoming, t).map((x) => x.m);
  const soon = [...top, ...upcoming.sort((a, b) => a.startsAt - b.startsAt)]
    .filter((m, i, arr) => arr.indexOf(m) === i).slice(0, 8);
  if (!live.length && !soon.length) return '';
  const card = (m) => matchCard(m, { guest: true });
  return `
    <section class="guest-matches" aria-label="Matchs du moment">
      ${live.length ? `
        <h2 class="section-title"><span class="live-dot"></span>En direct <span class="muted section-note">paris en direct</span></h2>
        <div class="match-grid">${live.map(card).join('')}</div>` : ''}
      ${soon.length ? `
        <h2 class="section-title">Les matchs à venir</h2>
        <div class="match-grid">${soon.map(card).join('')}</div>` : ''}
      <button class="btn btn-primary btn-lg guest-cta" data-action="guest-pick" type="button">
        Voir les ${fmt(real.length)} matchs et parier
      </button>
    </section>`;
}

const FEATURES = [
  { icon: 'stadium', title: 'Les vrais matchs', text: 'Ligue 1, Premier League, Ligue des champions, NBA, tennis, UFC, rugby… résultats officiels en direct.' },
  { icon: 'star', title: 'Collectionne les cartes', text: `${CARDS.length} cartes de stars à débloquer : Mbappé, Wembanyama, Sinner, Dupont… Pochettes surprises et boutique du jour.` },
  { icon: 'trophy', title: 'Des rangs à grimper', text: 'De Fer à Radiant : chaque bon prono te fait monter, chaque raté te fait descendre.' },
  { icon: 'user', title: 'Ligues entre potes', text: 'Crée ta ligue, envoie le lien sur WhatsApp, et voyez qui est le vrai expert.' },
  { icon: 'bolt', title: 'Matchs éclair', text: 'Envie de jouer tout de suite ? Des matchs fictifs de 2 minutes, à toute heure.' },
];

function pseudoForm(title, note = '') {
  return `
        <form class="register" data-form="register" autocomplete="off">
          <label for="pseudo-input">${title}</label>
          ${note ? `<span class="muted">${note}</span>` : ''}
          <input id="pseudo-input" name="pseudo" maxlength="16" placeholder="ex. LeRoiDuProno" required>
          <button class="btn btn-primary btn-lg" type="submit">
            Jouer avec ${fmt(CONFIG.STARTING_BALANCE)} ${coin('coin coin-sm')} offerts
          </button>
        </form>`;
}

// Navigateurs intégrés aux applis (Instagram, TikTok, Snapchat, Facebook…) : Google y refuse la
// connexion, on y propose l'email à la place.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Bytedance|Snapchat|LinkedInApp/i;
const inAppBrowser = () => typeof navigator !== 'undefined' && IN_APP.test(navigator.userAgent || '');

// Inscription : Google en un clic, l'email en secours (replié). `title` / `note` : écran verrouillé
// d'un joueur sans compte (sa partie passe sur le compte à la connexion).
function signupCard({ title = null, note = null } = {}) {
  const login = cloud.mode === 'login';
  const inApp = inAppBrowser();
  const emailOpen = ui.emailOpen || inApp;
  title = login ? 'Content de te revoir' : title || 'Crée ton compte gratuit';
  return `
        <section class="register signup-first">
          ${pendingReferral() && !login ? `<p class="referral-hello">🎁 <b>${escapeHtml(pendingReferral())}</b> t'invite : crée ton compte et vous gagnez <b>${REWARD} Goalz</b> chacun !</p>` : ''}
          <h2>${title}</h2>
          ${login ? '<span class="muted">Connecte-toi pour retrouver ta partie.</span>' : note ? `<p class="saved-game">${note}</p>` : `
          <ul class="perks">${PERKS.map(([icon, text]) => `<li>${icons[icon]}<span>${text}</span></li>`).join('')}</ul>`}
          ${inApp ? `<p class="in-app-hint">Dans cette appli, Google bloque sa connexion : inscris-toi avec ton email, ou ouvre goalzz.fr dans ton navigateur pour utiliser Google.</p>`
            : `<button class="btn btn-primary btn-lg" data-action="cloud-google" type="button"><span class="google-chip">${googleLogo}</span>Continuer avec Google</button>
          <button class="or or-toggle" data-action="email-open" type="button" aria-expanded="${emailOpen}"><span>ou avec un email ${emailOpen ? '▴' : '▾'}</span></button>`}
          ${emailOpen ? `
          <form class="account-form" data-form="cloud-auth">
            <input id="email-input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="ton@email.fr" required>
            <input id="password-input" name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}"
              placeholder="${login ? 'Mot de passe' : 'Choisis un mot de passe (6 caractères min.)'}" minlength="6" required>
            <button class="btn ${inApp ? 'btn-primary' : 'btn-ghost'}" type="submit">${login ? 'Se connecter' : 'Créer mon compte'}</button>
          </form>` : ''}
          <div class="account-links">
            <button class="link-btn" data-action="cloud-mode" data-mode="${login ? 'signup' : 'login'}" type="button">${login ? 'Créer un compte' : 'J\'ai déjà un compte'}</button>
            ${login && emailOpen ? '<button class="link-btn" data-action="cloud-reset" type="button">Mot de passe oublié ?</button>' : ''}
          </div>
          <span class="fineprint">${note ? 'Gratuit, sans argent réel.' : `${fmt(CONFIG.STARTING_BALANCE)} Goalz offerts à l'inscription · jeu gratuit, sans argent réel.`}</span>
        </section>`;
}

// Écran d'accueil : l'inscription, et « jouer sans compte » (parier seulement) en option.
const signupFirst = () => `${signupCard()}
        <details class="guest-play">
          <summary>Jouer sans compte</summary>
          ${pseudoForm('Choisis ton pseudo', 'Sans compte, tu peux parier sur tous les matchs. Boutique, cartes, classement et bonus demandent un compte.')}
        </details>`;

// Écrans réservés aux joueurs avec un compte (boutique, classement, profil), vus sans compte.
const LOCKED = {
  boutique: ['La boutique', 'les cartes de joueurs, les pochettes et les styles'],
  classement: ['Les rangs', 'le classement, ta division et les ligues entre potes'],
  profil: ['Ton profil', 'tes stats, ton niveau, le parrainage et les réglages'],
};
export function renderLocked(routeId) {
  const [label, what] = LOCKED[routeId] || ['Cet écran', 'tout le jeu'];
  return `
    <div class="locked-page">
      <h1 class="page-title">${label}</h1>
      ${signupCard({
        title: 'Crée ton compte pour débloquer',
        note: `${icons.lock} Sans compte, tu peux seulement parier. Avec un compte gratuit : ${what}, les bonus du jour et les défis. Tes paris et tes Goalz te suivent.`,
      })}
    </div>`;
}

export function renderOnboarding(s) {
  const profiles = listProfiles(s);
  const ladder = [...TIERS.map((t, i) => ({ ...rankOf(i * 3 * RR_PER_DIVISION), division: null, label: t.name })), { ...RADIANT, division: null, label: RADIANT.name }];
  const bg = CONFIG.CARD_PHOTOS && CONFIG.LANDING_BG;
  const showcase = ['liga-kylian-mbappe', 'nba-victor-wembanyama', 'tennis-jannik-sinner'].map(cardById).filter(Boolean);
  return `
  <div class="onboarding ${bg ? 'has-bg' : ''}">
    ${bg ? `<div class="landing-bg" style="background-image:url('${escapeHtml(bg)}')"></div>` : ''}
    <div class="hero-glow"></div>
    ${eventDecor({ landing: true })}
    <div class="landing">
      <section class="landing-hero">
        <div class="brand-big">${eventLogo()}<span>GOAL<b>ZZ</b></span></div>
        <h1 class="landing-title">Pronostique.<br>Collectionne.<br><b>Domine tes potes.</b></h1>
        <p class="tagline">Le jeu de pronos sportifs gratuit avec une monnaie 100 % virtuelle${eventTag({ short: true })}.</p>
        ${showcase.length ? `
        <div class="landing-cards" aria-label="Exemples de cartes à collectionner">
          ${showcase.map((c, i) => `<div class="lc lc-${i}">${cardHtml(c)}</div>`).join('')}
          <span class="lc-caption">${CARDS.length} cartes à collectionner · foot, NBA, tennis, UFC, rugby…</span>
        </div>` : ''}
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
        ${!cloud.enabled ? pseudoForm('Choisis ton pseudo') : cloud.user ? pseudoForm('Dernière étape : choisis ton pseudo', `Compte créé${cloud.user.email ? ` (${escapeHtml(cloud.user.email)})` : ''}. Ton pseudo sera visible dans le classement.`) : signupFirst()}

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

        ${cloud.enabled ? '' : renderAccountCard({ compact: true })}

        <p class="fineprint">
          Jeu gratuit, sans argent réel. Les Goalz ne s'achètent pas et ne s'échangent pas contre
          de l'argent ou des lots.
        </p>
        ${legalLinks()}
      </section>
    </div>
    ${guestMatches(s)}
  </div>`;
}
