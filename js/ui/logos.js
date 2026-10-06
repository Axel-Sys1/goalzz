// Logos des équipes et drapeaux. Sur la page publiée, les images d'autres sites sont bloquées :
// l'instantané embarque alors chaque logo (adresse d'origine → data URI), enregistré ici.
import { escapeHtml } from '../util.js';

let embedded = {};

export function setLogos(map) {
  embedded = map || {};
}

export const logoSrc = (url) => embedded[url] || url;

export const teamMark = (t, cls = 'logo-img') => (t.logo
  ? `<img class="${cls}" src="${escapeHtml(logoSrc(t.logo))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'dot'}))">`
  : `<i class="dot" style="background:${escapeHtml(t.color || '#8593a6')}"></i>`);
