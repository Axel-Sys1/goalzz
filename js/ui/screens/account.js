// Carte « compte en ligne » : connexion (email + mot de passe ou Google) et état de la sauvegarde.
import { escapeHtml } from '../../util.js';
import { cloud } from '../../services/cloud.js';

export function renderAccountCard({ compact = false } = {}) {
  if (!cloud.enabled || !cloud.ready) return '';

  if (cloud.user) {
    return `
      <section class="card account-card">
        <div class="grow">
          <strong>Partie sauvegardée en ligne</strong>
          <span class="muted">Connecté avec ${escapeHtml(cloud.user.email || 'ton compte')}</span>
        </div>
        <button class="btn btn-ghost" data-action="cloud-logout" type="button">Se déconnecter</button>
      </section>`;
  }

  const signup = cloud.mode === 'signup';
  const title = signup ? 'Crée ton compte' : compact ? 'Déjà un compte ? Connecte-toi' : 'Sauvegarde ta partie';
  const intro = signup
    ? 'Ta partie sera sauvegardée en ligne et tu la retrouveras sur tous tes appareils.'
    : compact
      ? 'Retrouve ta partie sur cet appareil.'
      : 'Connecte-toi pour ne jamais perdre ta progression et la retrouver sur tous tes appareils.';

  return `
    <form class="card account-card account-form" data-form="cloud-auth">
      <strong>${title}</strong>
      <span class="muted">${intro}</span>
      <input id="email-input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="ton@email.fr" required>
      <input id="password-input" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"
        placeholder="${signup ? 'Choisis un mot de passe (6 caractères min.)' : 'Mot de passe'}" minlength="6" required>
      <button class="btn btn-primary" type="submit">${signup ? 'Créer mon compte' : 'Se connecter'}</button>
      <button class="btn btn-ghost" data-action="cloud-google" type="button">Continuer avec Google</button>
      <div class="account-links">
        <button class="link-btn" data-action="cloud-mode" data-mode="${signup ? 'login' : 'signup'}" type="button">
          ${signup ? 'J\'ai déjà un compte' : 'Pas encore de compte ? Créer un compte'}
        </button>
        ${signup ? '' : '<button class="link-btn" data-action="cloud-reset" type="button">Mot de passe oublié ?</button>'}
      </div>
    </form>`;
}
