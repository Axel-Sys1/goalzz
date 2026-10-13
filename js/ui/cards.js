// Rendu des cartes joueurs (boutique, album, profil) et ouverture d'une pochette.
import { CONFIG } from '../config.js';
import { escapeHtml } from '../util.js';
import { icons } from './icons.js';
import { RARITY } from '../services/progress.js';
import { setById } from '../services/cards.js';

const FLAGS = {
  France: '🇫🇷', Argentine: '🇦🇷', Portugal: '🇵🇹', Brésil: '🇧🇷', Espagne: '🇪🇸', Norvège: '🇳🇴',
  Angleterre: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', Maroc: '🇲🇦', Égypte: '🇪🇬', Croatie: '🇭🇷', Belgique: '🇧🇪', 'Corée du Sud': '🇰🇷',
  Italie: '🇮🇹', Serbie: '🇷🇸', Biélorussie: '🇧🇾', Pologne: '🇵🇱', 'États-Unis': '🇺🇸', Allemagne: '🇩🇪', Russie: '🇷🇺',
  'Royaume-Uni': '🇬🇧', Danemark: '🇩🇰', Kazakhstan: '🇰🇿', Australie: '🇦🇺', Ukraine: '🇺🇦', Mexique: '🇲🇽', Japon: '🇯🇵',
  Géorgie: '🇬🇪', 'Afrique du Sud': '🇿🇦', 'Nouvelle-Zélande': '🇳🇿', Écosse: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', Canada: '🇨🇦', Suède: '🇸🇪',
  Tchéquie: '🇨🇿', 'Pays-Bas': '🇳🇱', Haïti: '🇭🇹', Suisse: '🇨🇭', Irlande: '🇮🇪', Cameroun: '🇨🇲', Brazil: '🇧🇷',
};
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// owned : carte possédée ; sinon grisée (album). size : '' | 'sm' | 'lg'.
export function cardHtml(card, { owned = true, size = '', count = 0, favorite = false } = {}) {
  const photo = CONFIG.CARD_PHOTOS && card.img
    ? `<img class="pc-photo ${card.cutout ? '' : 'pc-thumb'}" src="${escapeHtml(card.img)}${card.cutout ? '/preview' : ''}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  const team = card.national ? `${FLAGS[card.team] || ''} ${card.team}` : card.team;
  return `
    <div class="pcard-x rar-${card.rarity} ${size ? `pc-${size}` : ''} ${owned ? '' : 'pc-missing'} ${card.national ? 'pc-national' : ''}" data-sport="${card.sport}">
      <div class="pc-bg"><span class="pc-initials">${initials(card.name)}</span></div>
      ${photo}
      <div class="pc-top">
        <span class="pc-rar">${RARITY[card.rarity]}</span>
        ${card.num ? `<span class="pc-num">${escapeHtml(card.num)}</span>` : ''}
      </div>
      <div class="pc-info">
        <strong class="pc-name">${escapeHtml(card.name)}</strong>
        <span class="pc-team">${escapeHtml(team)}${card.pos ? ` · ${escapeHtml(card.pos)}` : ''}</span>
      </div>
      ${count > 1 ? `<span class="pc-count">×${count}</span>` : ''}
      ${favorite ? `<span class="pc-fav" title="Carte favorite">${icons.star}</span>` : ''}
      ${owned ? '' : `<span class="pc-lock">${icons.lock}</span>`}
    </div>`;
}

// Ouverture d'une pochette : les 3 cartes se retournent l'une après l'autre.
export function showPack(results, onClose) {
  document.querySelector('.pack-overlay')?.remove();
  const el = document.createElement('div');
  el.className = 'pack-overlay';
  el.innerHTML = `
    <div class="pack-stage" role="dialog" aria-label="Ouverture de la pochette">
      <h2 class="pack-title">Ta pochette</h2>
      <div class="pack-cards">
        ${results.map(({ card, duplicate, refund }, i) => `
          <div class="pack-slot" style="--i:${i}">
            <div class="pack-flip">
              <div class="pack-back"><span>GOAL<b>ZZ</b></span></div>
              <div class="pack-front">${cardHtml(card)}</div>
            </div>
            <span class="pack-tag ${duplicate ? 'is-dup' : 'is-new'}">${duplicate ? `Doublon · +${refund} Goalz` : `Nouvelle · ${escapeHtml(setById(card.sport)?.name || '')}`}</span>
          </div>`).join('')}
      </div>
      <button class="btn btn-primary btn-lg" data-pack-close type="button">Super !</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const close = () => { el.remove(); onClose?.(); };
  el.querySelector('[data-pack-close]').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
