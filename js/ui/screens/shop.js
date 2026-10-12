// Boutique : onglet à part. Chaque objet est montré sur une mini carte de joueur (avatar, pseudo,
// titre) pour voir tout de suite le rendu ; raretés façon jeu vidéo ; offre de la semaine en vitrine.
import { escapeHtml, fmt } from '../../util.js';
import { coin, icons } from '../icons.js';
import { avatarHtml, nameHtml } from '../cosmetics.js';
import { ui } from '../uiState.js';
import {
  ITEMS, RARITY, boostActive, dealEndsAt, levelOf, owns, priceOf, style, weeklyDeal,
} from '../../services/progress.js';

const KIND_LABEL = { color: 'Effet de pseudo', frame: 'Cadre', title: 'Titre', boost: 'Boost' };
const CATS = [['all', 'Tout'], ['color', 'Pseudos'], ['frame', 'Cadres'], ['title', 'Titres'], ['boost', 'Boosts']];
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

function action(p, item, price) {
  const mine = owns(p, item);
  const equipped = style(p)[item.kind] === item.id;
  if (item.kind === 'boost') {
    return `<button class="btn btn-buy" data-action="shop-buy" data-id="${item.id}" type="button" ${p.balance < price ? 'disabled' : ''}>${fmt(price)} ${coin('coin coin-sm')}</button>`;
  }
  if (mine) {
    return `<button class="btn ${equipped ? 'btn-equipped' : 'btn-ghost'}" data-action="shop-equip" data-id="${item.id}" type="button">${equipped ? `${icons.check} Équipé` : 'Équiper'}</button>`;
  }
  if (price) {
    return `<button class="btn btn-buy" data-action="shop-buy" data-id="${item.id}" type="button" ${p.balance < price ? 'disabled' : ''}>${fmt(price)} ${coin('coin coin-sm')}</button>
      ${item.level ? `<span class="shop-or">ou gratuit au niveau ${item.level}</span>` : ''}`;
  }
  return `<span class="shop-lock">${icons.lock} ${item.exclusive ? escapeHtml(item.exclusive) : `Niveau ${item.level}`}</span>`;
}

function itemCard(p, item, deal) {
  const isDeal = deal.id === item.id;
  const price = item.price ? priceOf(item) : null;
  return `
    <article class="shop-card rar-${item.rarity} ${style(p)[item.kind] === item.id ? 'is-equipped' : ''} ${owns(p, item) ? 'is-owned' : ''}">
      <span class="rar-label">${RARITY[item.rarity]}</span>
      ${isDeal ? '<span class="deal-flag">−30 %</span>' : ''}
      <div class="shop-art">${preview(p, item)}</div>
      <strong class="shop-name">${escapeHtml(item.name)}</strong>
      <span class="shop-kind">${KIND_LABEL[item.kind]}</span>
      ${isDeal ? `<s class="shop-old">${fmt(item.price)}</s>` : ''}
      <div class="shop-action">${action(p, item, price)}</div>
    </article>`;
}

function countdown(ms) {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d ? `${d} j ${h} h` : `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} min`;
}

export function renderShop(s, p) {
  const deal = weeklyDeal();
  const dealItem = ITEMS.find((i) => i.id === deal.id);
  const cat = CATS.some(([k]) => k === ui.shopCat) ? ui.shopCat : 'all';
  const list = ITEMS
    .filter((i) => cat === 'all' || i.kind === cat)
    .sort((a, b) => ORDER.indexOf(b.rarity) - ORDER.indexOf(a.rarity) || (b.price || 0) - (a.price || 0));
  const lv = levelOf(p.xp);
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

    <section class="shop-deal rar-${dealItem.rarity}">
      <div class="deal-text">
        <span class="deal-kicker">Offre de la semaine</span>
        <strong>${escapeHtml(dealItem.name)}</strong>
        <span class="muted">${RARITY[dealItem.rarity]} · se termine dans ${countdown(dealEndsAt() - Date.now())}</span>
        <div class="deal-price"><s>${fmt(dealItem.price)}</s> <b>${fmt(deal.price)}</b> ${coin('coin coin-sm')}</div>
        <div class="shop-action">${action(p, dealItem, deal.price)}</div>
      </div>
      <div class="deal-art">${preview(p, dealItem)}</div>
    </section>

    <div class="chips shop-cats" role="toolbar" aria-label="Catégories">
      ${CATS.map(([k, label]) => `<button class="chip ${cat === k ? 'active' : ''}" data-action="shop-cat" data-cat="${k}" type="button">${label}</button>`).join('')}
    </div>

    <div class="shop-cards">${list.map((i) => itemCard(p, i, deal)).join('')}</div>

    <p class="muted shop-note">Que du style : rien n'aide à gagner. Les objets marqués d'un niveau se débloquent gratuitement en jouant (tu es niveau ${lv.level}), et ceux de Champion se méritent au Hall of Fame.</p>`;
}
