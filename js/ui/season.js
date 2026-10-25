// Habillage saisonnier (CONFIG.EVENTS) : logo, mention dans la barre du haut et décor animé.
// L'événement actif est posé sur <html data-event="…"> au démarrage (main.js) ; les couleurs sont
// dans styles.css (:root[data-event="…"]).
import { CONFIG } from '../config.js';
import { baubleLogo, icons, pumpkinLogo } from './icons.js';

// Événement du jour : le premier dont la période (dates incluses) contient aujourd'hui. Aperçu avant
// l'heure : ?theme=noel dans l'adresse (?theme=aucun pour aucun habillage).
export function activeEvent(t = new Date()) {
  const forced = new URLSearchParams(location.search).get('theme');
  if (forced) return (CONFIG.EVENTS || []).find((e) => e.id === forced) || null;
  return (CONFIG.EVENTS || []).find((e) => t >= new Date(`${e.from}T00:00:00`) && t <= new Date(`${e.until}T23:59:59`)) || null;
}

const current = () => document.documentElement.dataset.event || null;
const event = () => (CONFIG.EVENTS || []).find((e) => e.id === current()) || null;

// Logo : citrouille à Halloween, ballon en boule de Noël à Noël, ballon le reste du temps.
export function eventLogo() {
  if (current() === 'halloween') return pumpkinLogo;
  if (current() === 'noel') return baubleLogo;
  return icons.ball;
}

// « 🎃 Spécial Halloween · » en tête de la barre du haut ; `short` : « · 🎃 spécial Halloween » (accroche).
export function eventTag({ short = false } = {}) {
  const e = event();
  if (!e) return '';
  return short ? ` · ${e.emoji} spécial ${e.name}` : `${e.emoji} Spécial ${e.name} · `;
}

// Flocons de neige : positions et vitesses fixes (pas d'aléatoire, même rendu à chaque fois).
const snow = () => `<div class="snow" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => {
  const size = 8 + ((i * 7) % 12);
  const left = (i * 37) % 100;
  const dur = 9 + ((i * 5) % 11);
  const delay = -((i * 3.7) % 15).toFixed(1);
  const dx = ((i % 5) - 2) * 25;
  return `<i style="left:${left}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;--dx:${dx}px">❄</i>`;
}).join('')}</div>`;

// Boules de Noël suspendues en haut de l'accueil, qui se balancent.
const hangingBaubles = () => `<div class="baubles" aria-hidden="true">${[
  [8, 90, '#e3242b'], [22, 150, '#ffd166'], [78, 120, '#1f9d5c'], [91, 70, '#e3242b'],
].map(([left, len, c], i) => `<span style="left:${left}%;--len:${len}px;--c:${c};animation-delay:${-i * 0.7}s"><i></i></span>`).join('')}</div>`;

// Décor animé, transparent aux clics. `landing` : écran d'accueil (sans la toile d'araignée).
export function eventDecor({ landing = false } = {}) {
  if (current() === 'halloween') return `<div class="spooky" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i>${landing ? '' : '<b></b>'}<s></s><u>👻</u><em></em></div>`;
  if (current() === 'noel') return `${snow()}${landing ? hangingBaubles() : ''}`;
  return '';
}
