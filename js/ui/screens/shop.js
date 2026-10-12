// Boutique, façon Valorant : une boutique du jour personnelle (1 vedette à −25 % + 4 objets, renouvelée
// à minuit), les boosts toujours en vente, et la collection pour équiper ce qu'on a. Chaque objet est
// montré sur une mini carte du joueur (avatar, pseudo, titre).
import { escapeHtml, fmt } from '../../util.js';
import { coin, icons } from '../icons.js';
import { avatarHtml, nameHtml } from '../cosmetics.js';
import { ui } from '../uiState.js';
import {
  ITEMS, RARITY, boostActive, dailyShop, levelOf, nextMidnight, owns, priceOf, style,
} from '../../services/progress.js';

const KIND_LABEL = { color: 'Effet de pseudo', frame: 'Cadre', title: 'Titre', boost: 'Boost' };
const ORDER = ['exclusif', 'commun', 'rare', 'epique', 'legendaire', 'mythique']; // tri : mythique d'abord, exclusifs (non vendus) à la fin

// Le joueur tel qu'il apparaîtrait avec l'objet (le reste de son style est conservé).
function playerCard(p, look, { big = false } = {}) {
  const title = look.title && ITEMS.find((i) => i.id === look.title);
  return `
    <div class="pcard ${big ? 'pcard-big' : ''}">
      ${avatarHtml(p.pseudo, look, big ? 'avatar-lg' : '')}
      <span class="pcard-who">
        ${nameHtml(p.pseudo, look)}
        ${title ? `<span class="pz-title rar-${title.rarity}">${escapeHtml(title.name)}</span>` : '<span class="pcard-sub">Niv. ' + levelOf(p.xp).level + '</span>'}
      </span>
    </div>`;
}

function preview(p, item) {
  if (item.kind === 'boost') return `<div class="boost-art">${icons.bolt}<b>×2</b></div>`;
  return playerCard(p, { ...style(p), [item.kind]: item.id });
}

function buyButton(p, item, price) {
  return `<button class="btn btn-buy" data-action="shop-buy" data-id="${item.id}" type="button" ${p.balance < price ? 'disabled' : ''}>${fmt(price)} ${coin('coin coin-sm')}</button>`;
}

function action(p, item, price) {
  const equipped = style(p)[item.kind] === item.id;
  if (item.kind !== 'boost' && owns(p, item)) {
    return `<button class="btn ${equipped ? 'btn-equipped' : 'btn-ghost'}" data-action="shop-equip" data-id="${item.id}" type="button">${equipped ? `${icons.check} Équipé` : 'Équiper'}</button>`;
  }
  if (price != null) return buyButton(p, item, price);
  if (item.exclusive) return `<span class="shop-lock">${icons.lock} ${escapeHtml(item.exclusive)}</span>`;
  if (item.level) return `<span class="shop-lock">${icons.lock} Niveau ${item.level}${item.price ? ' ou boutique du jour' : ''}</span>`;
  return `<span class="shop-lock">${icons.lock} Pas dans ta boutique aujourd'hui</span>`;
}

function itemCard(p, item, price = priceOf(item, p), { featured = false } = {}) {
  const promo = price != null && price < item.price;
  return `
    <article class="shop-card rar-${item.rarity} ${featured ? 'is-featured' : ''} ${style(p)[item.kind] === item.id ? 'is-equipped' : ''} ${owns(p, item) ? 'is-owned' : ''}">
      <span class="rar-label">${featured ? 'Vedette · ' : ''}${RARITY[item.rarity]}</span>
      ${promo ? `<span class="deal-flag">−${Math.round((1 - price / item.price) * 100)} %</span>` : ''}
      <div class="shop-art">${preview(p, item)}</div>
      <strong class="shop-name">${escapeHtml(item.name)}</strong>
      <span class="shop-kind">${KIND_LABEL[item.kind]}</span>
      ${promo ? `<s class="shop-old">${fmt(item.price)}</s>` : ''}
      <div class="shop-action">${action(p, item, price)}</div>
    </article>`;
}

function countdown(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

const TABS = [['daily', 'Boutique du jour'], ['boost', 'Boosts'], ['collection', 'Collection']];

function dailyView(p) {
  const shop = dailyShop(p);
  const featured = ITEMS.find((i) => i.id === shop.featured.id);
  return `
    <div class="daily-head">
      <span class="muted">Ta sélection perso, différente pour chaque joueur.</span>
      <span class="daily-timer">${icons.clock} Nouvelle boutique dans ${countdown(nextMidnight() - Date.now())}</span>
    </div>
    <div class="daily-featured">${itemCard(p, featured, shop.featured.price, { featured: true })}</div>
    <div class="shop-cards daily-cards">${shop.items.map((x) => itemCard(p, ITEMS.find((i) => i.id === x.id), x.price)).join('')}</div>
    <p class="muted shop-note">Les cosmétiques ne s'achètent que dans ta boutique du jour : s'il te plaît, prends-le avant minuit !</p>`;
}

function boostView(p) {
  return `
    <p class="muted shop-cat-help">Pour monter de niveau deux fois plus vite. Toujours disponibles, et ils n'aident pas à gagner tes paris.</p>
    <div class="shop-cards">${ITEMS.filter((i) => i.kind === 'boost').map((i) => itemCard(p, i)).join('')}</div>`;
}

function collectionView(p) {
  const lv = levelOf(p.xp).level;
  const kinds = [['color', 'Effets de pseudo'], ['frame', 'Cadres'], ['title', 'Titres']];
  const mineCount = ITEMS.filter((i) => i.kind !== 'boost' && owns(p, i)).length;
  return `
    <p class="muted shop-cat-help">${mineCount} objet${mineCount > 1 ? 's' : ''} à toi. Touche « Équiper » pour changer de style. Les autres se débloquent en montant de niveau (tu es niveau ${lv}), dans ta boutique du jour, ou au Hall of Fame.</p>
    ${kinds.map(([k, label]) => `
      <h2 class="section-title">${label}</h2>
      <div class="shop-cards">${ITEMS.filter((i) => i.kind === k)
        .sort((a, b) => Number(owns(p, b)) - Number(owns(p, a)) || ORDER.indexOf(b.rarity) - ORDER.indexOf(a.rarity))
        .map((i) => itemCard(p, i)).join('')}</div>`).join('')}`;
}

export function renderShop(s, p) {
  const tab = TABS.some(([k]) => k === ui.shopTab) ? ui.shopTab : 'daily';
  return `
    <section class="shop-hero">
      <div class="shop-hero-top">
        <h1 class="page-title">Boutique</h1>
        <span class="shop-wallet">${fmt(p.balance)} ${coin()}</span>
      </div>
      <div class="shop-me">
        <span class="muted">Ton style</span>
        ${playerCard(p, style(p), { big: true })}
        ${boostActive(p) ? `<span class="tag tag-boost">${icons.bolt} XP ×2 actif</span>` : ''}
      </div>
    </section>
    <div class="tabs shop-tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab ${tab === k ? 'active' : ''}" data-action="shop-tab" data-tab="${k}" role="tab" aria-selected="${tab === k}" type="button">${label}</button>`).join('')}
    </div>
    ${tab === 'boost' ? boostView(p) : tab === 'collection' ? collectionView(p) : dailyView(p)}`;
}
