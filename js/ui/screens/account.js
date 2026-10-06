// Carte « compte en ligne » : connexion par email et état de la sauvegarde.
import { escapeHtml } from '../../util.js';
import { cloud } from '../../services/cloud.js';

export function renderAccountCard({ compact = false } = {}) {
  if (!cloud.enabled || !cloud.ready) return '';

  if (cloud.user) {
    return `
      <section class="card account-card">
        <div class="grow">
          <strong>☁️ Partie sauvegardée en ligne</strong>
          <span class="muted">Connecté avec ${escapeHtml(cloud.user.email)}</span>
        </div>
        <button class="btn btn-ghost" data-action="cloud-logout" type="button">Se déconnecter</button>
      </section>`;
  }

  if (cloud.linkSentTo) {
    return `
      <section class="card account-card account-sent">
        <strong>📬 Regarde tes mails</strong>
        <span class="muted">On a envoyé un lien de connexion à <b>${escapeHtml(cloud.linkSentTo)}</b>.
          Ouvre-le sur cet appareil pour retrouver ta partie. Pense à vérifier les spams.</span>
        <button class="link-btn" data-action="cloud-retry" type="button">Changer d'adresse</button>
      </section>`;
  }

  return `
    <form class="card account-card account-form" data-form="cloud-login">
      <label for="email-input"><strong>${compact ? 'Déjà un compte ? Connecte-toi' : '☁️ Sauvegarde ta partie'}</strong></label>
      <span class="muted">${compact
        ? 'Reçois un lien par email pour retrouver ta partie sur cet appareil.'
        : 'Connecte-toi avec ton email pour ne jamais perdre ta progression et la retrouver sur tous tes appareils.'}</span>
      <div class="account-row">
        <input id="email-input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="ton@email.fr" required>
        <button class="btn btn-primary" type="submit">Recevoir le lien</button>
      </div>
      <span class="fineprint">Pas de mot de passe. Ton email sert seulement à te connecter.</span>
    </form>`;
}
