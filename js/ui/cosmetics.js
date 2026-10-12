// Affichage des cosmétiques d'un joueur (voir services/progress.js) : pseudo coloré, avatar
// encadré, titre. `style` = { color, frame, title } (ids d'objets), pour soi comme pour les autres.
import { escapeHtml } from '../util.js';
import { itemById } from '../services/progress.js';

const cls = (id) => (id ? String(id).replace(/[^a-z0-9-]/gi, '') : '');

export const nameHtml = (name, style = {}) =>
  `<span class="pz ${style.color ? `pz-${cls(style.color)}` : ''}">${escapeHtml(name)}</span>`;

export function avatarHtml(name, style = {}, size = '') {
  return `<span class="avatar ${size} ${style.frame ? `fr fr-${cls(style.frame)}` : ''}">${escapeHtml(String(name || '?')[0].toUpperCase())}</span>`;
}

export function titleHtml(style = {}) {
  const item = style.title && itemById(style.title);
  return item ? `<span class="pz-title">${escapeHtml(item.name)}</span>` : '';
}
