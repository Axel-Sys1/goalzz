// Boutique, façon Valorant : chaque jour, une sélection perso de cartes joueurs (1 vedette à −25 % +
// 3 cartes, renouvelée à minuit) et une pochette de 3 cartes au hasard ; les boosts toujours en vente ;
// l'album des collections ; le style (effets de pseudo, cadres, titres), débloqué par niveau.
import { escapeHtml, fmt } from '../../util.js';
import { coin, icons } from '../icons.js';
import { avatarHtml, nameHtml } from '../cosmetics.js';
import { cardHtml } from '../cards.js';
import { ui } from '../uiState.js';
import {
  ITEMS, RARITY, boostActive, levelOf, nextMidnight, owns, priceOf, style,
} from '../../services/progress.js';
import {
  CARDS, CARD_SETS, CARD_PRICE, PACK, RARITY_ORDER, cardById, dailyCards, hasCard, myCards, ownedCount, packsLeft, setProgress, setReward,
} from '../../services/cards.js';

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

function countdown(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

const buyBtn = (action, id, price, p) => `
  <button class="btn btn-buy" data-action="${action}" ${id ? `data-id="${id}"` : ''} type="button" ${p.balance < price ? 'disabled' : ''}>${fmt(price)} ${coin('coin coin-sm')}</button>`;

// ─── Cartes du jour ──────────────────────────────────────────────────────────
function offer(p, id, price, { featured = false } = {}) {
  const card = cardById(id);
  const promo = price < CARD_PRICE[card.rarity];
  const mine = hasCard(p, id);
  return `
    <article class="card-offer rar-${card.rarity} ${featured ? 'is-featured' : ''} ${mine ? 'is-owned' : ''}">
      ${featured ? '<span class="offer-flag">Vedette du jour</span>' : ''}
      ${promo ? `<span class="deal-flag">−${Math.round((1 - price / CARD_PRICE[card.rarity]) * 100)} %</span>` : ''}
      ${cardHtml(card, { size: featured ? 'lg' : '' })}
      <span class="offer-set">${escapeHtml(CARD_SETS.find((s) => s.id === card.sport)?.name || '')}</span>
      ${promo ? `<s class="shop-old">${fmt(CARD_PRICE[card.rarity])}</s>` : ''}
      <div class="shop-action">${mine ? `<span class="btn btn-equipped">${icons.check} Dans ton album</span>` : buyBtn('card-buy', id, price, p)}</div>
    </article>`;
}

function packOffer(p) {
  const left = packsLeft(p);
  return `
    <article class="card-offer pack-offer ${left ? '' : 'is-empty'}">
      <div class="pack-art">
        <span class="pack-pouch"><span>GOAL<b>ZZ</b></span><small>${PACK.size} cartes</small></span>
      </div>
      <strong class="shop-name">Pochette surprise</strong>
      <span class="pack-desc">${PACK.size} cartes au hasard. Doublon repris en Goalz.</span>
      <span class="pack-left">${left ? `Encore ${left} aujourd'hui` : 'Plus de pochette aujourd\'hui'}</span>
      <div class="shop-action">${left
        ? buyBtn('pack-open', '', PACK.price, p)
        : `<button class="btn btn-ghost" data-action="shop-tab" data-tab="boost" type="button">${icons.bolt} Recharger</button>`}</div>
    </article>`;
}

function dailyView(p) {
  const shop = dailyCards(p);
  return `
    <div class="daily-head">
      <span class="muted">Ta sélection perso, différente pour chaque joueur.</span>
      <span class="daily-timer">${icons.clock} Nouvelles cartes dans ${countdown(nextMidnight() - Date.now())}</span>
    </div>
    <div class="daily-featured">${offer(p, shop.featured.id, shop.featured.price, { featured: true })}</div>
    <div class="offer-grid">
      ${shop.items.map((x) => offer(p, x.id, x.price)).join('')}
      ${packOffer(p)}
    </div>
    <p class="muted shop-note">Les cartes à l'unité ne sont en vente que dans ta boutique du jour. Complète une collection pour un gros bonus de Goalz !</p>`;
}

// ─── Album ───────────────────────────────────────────────────────────────────
function albumView(p) {
  const setId = CARD_SETS.some((s) => s.id === ui.albumSet) ? ui.albumSet : CARD_SETS[0].id;
  const mine = myCards(p);
  const fav = style(p).card;
  const prog = setProgress(p, setId);
  const list = CARDS.filter((c) => c.sport === setId);
  const tile = (c) => (hasCard(p, c.id)
    ? `<button class="album-card ${fav === c.id ? 'is-fav' : ''}" data-action="card-fav" data-id="${c.id}" type="button" aria-label="${escapeHtml(c.name)} : carte favorite">${cardHtml(c, { count: mine[c.id], favorite: fav === c.id })}</button>`
    : `<div class="album-card">${cardHtml(c, { owned: false })}</div>`);
  return `
    <p class="muted shop-cat-help">${ownedCount(p)} carte${ownedCount(p) > 1 ? 's' : ''} sur ${CARDS.length}. Touche une de tes cartes pour en faire ta carte favorite (visible sur ton profil).</p>
    <div class="album-sets">
      ${CARD_SETS.map((s) => {
        const sp = setProgress(p, s.id);
        return `<button class="album-set ${s.id === setId ? 'active' : ''} ${sp.done ? 'is-done' : ''}" data-action="album-set" data-set="${s.id}" type="button">
          <span>${escapeHtml(s.name)}</span><small>${sp.owned}/${sp.total}</small></button>`;
      }).join('')}
    </div>
    <div class="album-progress">
      <div class="album-bar"><i style="width:${Math.round((prog.owned / prog.total) * 100)}%"></i></div>
      <span>${prog.done ? `${icons.check} Collection complète` : `${prog.owned}/${prog.total} · complète-la pour +${fmt(setReward(setId))} ${coin('coin coin-sm')}`}</span>
    </div>
    ${RARITY_ORDER.map((r) => {
      const group = list.filter((c) => c.rarity === r).sort((a, b) => Number(hasCard(p, b.id)) - Number(hasCard(p, a.id)) || a.name.localeCompare(b.name));
      if (!group.length) return '';
      return `
      <h3 class="album-rar rar-${r}">${RARITY[r]} <small>${group.filter((c) => hasCard(p, c.id)).length}/${group.length}</small></h3>
      <div class="album-grid">${group.map(tile).join('')}</div>`;
    }).join('')}`;
}

// ─── Boosts et style ─────────────────────────────────────────────────────────
function preview(p, item) {
  if (item.packs) return `<div class="boost-art">${icons.bag}<b>+${item.packs}</b></div>`;
  if (item.kind === 'boost') return `<div class="boost-art">${icons.bolt}<b>×2</b></div>`;
  return playerCard(p, { ...style(p), [item.kind]: item.id });
}

function action(p, item) {
  const equipped = style(p)[item.kind] === item.id;
  if (item.kind !== 'boost' && owns(p, item)) {
    return `<button class="btn ${equipped ? 'btn-equipped' : 'btn-ghost'}" data-action="shop-equip" data-id="${item.id}" type="button">${equipped ? `${icons.check} Équipé` : 'Équiper'}</button>`;
  }
  if (item.kind === 'boost') return buyBtn('shop-buy', item.id, priceOf(item), p);
  if (item.exclusive) return `<span class="shop-lock">${icons.lock} ${escapeHtml(item.exclusive)}</span>`;
  const lv = levelOf(p.xp).level;
  return `<span class="shop-lock">${icons.lock} Niveau ${item.level}</span><span class="shop-or">encore ${item.level - lv} niveau${item.level - lv > 1 ? 'x' : ''}</span>`;
}

function itemCard(p, item) {
  return `
    <article class="shop-card rar-${item.rarity} ${style(p)[item.kind] === item.id ? 'is-equipped' : ''} ${owns(p, item) ? 'is-owned' : ''}">
      <span class="rar-label">${RARITY[item.rarity]}</span>
      <div class="shop-art">${preview(p, item)}</div>
      <strong class="shop-name">${escapeHtml(item.name)}</strong>
      <span class="shop-kind">${KIND_LABEL[item.kind]}</span>
      <div class="shop-action">${action(p, item)}</div>
    </article>`;
}

function boostView(p) {
  return `
    <p class="muted shop-cat-help">XP ×2 pour monter de niveau plus vite, ou une recharge pour ouvrir 3 pochettes de plus aujourd'hui (${packsLeft(p)} restante${packsLeft(p) > 1 ? 's' : ''} pour l'instant). Ils n'aident pas à gagner tes paris.</p>
    <div class="shop-cards">${ITEMS.filter((i) => i.kind === 'boost').map((i) => itemCard(p, i)).join('')}</div>`;
}

function styleView(p) {
  const lv = levelOf(p.xp).level;
  const kinds = [['color', 'Effets de pseudo'], ['frame', 'Cadres'], ['title', 'Titres']];
  const next = ITEMS.filter((i) => i.level > lv && !i.retired).sort((a, b) => a.level - b.level)[0];
  return `
    <p class="muted shop-cat-help">Le style ne s'achète pas, il se mérite : monte de niveau en pariant (tu es niveau ${lv}).${next ? ` Prochain déblocage : <b>${escapeHtml(next.name)}</b> au niveau ${next.level}.` : ''}</p>
    ${kinds.map(([k, label]) => `
      <h2 class="section-title">${label}</h2>
      <div class="shop-cards">${ITEMS.filter((i) => i.kind === k && (!i.retired || owns(p, i)))
        .sort((a, b) => Number(owns(p, b)) - Number(owns(p, a)) || (a.level ?? 999) - (b.level ?? 999))
        .map((i) => itemCard(p, i)).join('')}</div>`).join('')}`;
}

const TABS = [['daily', 'Cartes du jour'], ['album', 'Album'], ['boost', 'Boosts'], ['style', 'Style']];

export function renderShop(s, p) {
  const tab = TABS.some(([k]) => k === ui.shopTab) ? ui.shopTab : 'daily';
  const fav = cardById(style(p).card);
  return `
    <section class="shop-hero">
      <div class="shop-hero-top">
        <h1 class="page-title">Boutique</h1>
        <span class="shop-wallet">${fmt(p.balance)} ${coin()}</span>
      </div>
      <div class="shop-me">
        ${playerCard(p, style(p), { big: true })}
        <span class="shop-me-cards">${icons.star} ${ownedCount(p)}/${CARDS.length} cartes${fav ? ` · favorite : ${escapeHtml(fav.name)}` : ''}</span>
        ${boostActive(p) ? `<span class="tag tag-boost">${icons.bolt} XP ×2 actif</span>` : ''}
      </div>
    </section>
    <div class="tabs shop-tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab ${tab === k ? 'active' : ''}" data-action="shop-tab" data-tab="${k}" role="tab" aria-selected="${tab === k}" type="button">${label}</button>`).join('')}
    </div>
    ${tab === 'album' ? albumView(p) : tab === 'boost' ? boostView(p) : tab === 'style' ? styleView(p) : dailyView(p)}`;
}
