// Liens vers les pages légales (legal.html, page statique) et adresse de contact.
import { CONFIG } from '../../config.js';

export const legalLinks = () => `
  <nav class="legal-links" aria-label="Informations légales">
    <a href="mailto:${CONFIG.CONTACT_EMAIL}">Contact</a>
    <a href="legal.html#mentions">Mentions légales</a>
    <a href="legal.html#cgu">Conditions d'utilisation</a>
    <a href="legal.html#confidentialite">Confidentialité</a>
  </nav>`;
