// Liens vers les pages légales (legal.html, page statique) et adresse de contact.
import { CONFIG } from '../../config.js';

export const legalLinks = () => `
  <nav class="legal-links" aria-label="Informations légales">
    <a href="mailto:${CONFIG.CONTACT_EMAIL}">Contact</a>
    <a href="legal#mentions">Mentions légales</a>
    <a href="legal#cgu">Conditions d'utilisation</a>
    <a href="legal#confidentialite">Confidentialité</a>
  </nav>`;
