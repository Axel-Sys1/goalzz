// Cartes à collectionner : joueurs de foot (clubs et sélections) et de NBA, rangés en collections.
// Achat à l'unité dans la boutique du jour (sélection perso renouvelée à minuit) ou en pochettes de
// 3 cartes au hasard. Une collection complète rapporte des Goalz. Rien qui aide à gagner ses paris.
import { getState, update } from '../store.js';
import { currentPlayer } from './players.js';
import { CARDS, CARD_SETS } from '../data/cards.js';
import { nextMidnight, seeded, dayKey } from './progress.js';

export { CARDS, CARD_SETS };
export const cardById = (id) => CARDS.find((c) => c.id === id) || null;
export const setById = (id) => CARD_SETS.find((s) => s.id === id) || null;

export const CARD_PRICE = { commun: 250, rare: 600, epique: 1500, legendaire: 3500, mythique: 8000 };
export const PACK = { price: 800, size: 3, perDay: 3 }; // au-delà de 3 par jour : boost « Recharge pochettes »
export const SET_REWARD = 2000;
export const DUPLICATE_REFUND = 0.25; // un doublon tiré dans une pochette est repris à 25 % de son prix
export const DAILY_CARDS = 3;
const SHOP_WEIGHT = { commun: 30, rare: 30, epique: 22, legendaire: 13, mythique: 5 };
const PACK_WEIGHT = { commun: 55, rare: 28, epique: 12, legendaire: 4, mythique: 1 };

export const myCards = (p) => p?.cards || {};
export const hasCard = (p, id) => (myCards(p)[id] || 0) > 0;
export const ownedCount = (p) => CARDS.filter((c) => hasCard(p, c.id)).length;

export function setProgress(p, setId) {
  const list = CARDS.filter((c) => c.set === setId);
  const owned = list.filter((c) => hasCard(p, c.id)).length;
  return { owned, total: list.length, done: list.length > 0 && owned === list.length, claimed: !!p?.setRewards?.[setId] };
}

// Sélection de cartes du jour pour ce joueur : 1 vedette (au moins Épique) à −25 % et 3 cartes,
// parmi celles qu'il n'avait pas avant aujourd'hui (acheter ne remélange pas la boutique).
export function dailyCards(p, t = Date.now()) {
  const rand = seeded(`${p?.id || 'invité'}|cartes|${dayKey(t)}`);
  const dayStart = nextMidnight(t) - 86_400_000;
  const before = (c) => (p?.cardsAt?.[c.id] || Infinity) < dayStart;
  let pool = CARDS.filter((c) => !before(c));
  if (pool.length < DAILY_CARDS + 1) pool = [...CARDS];
  const draw = (filter = () => true) => {
    const list = pool.filter(filter);
    if (!list.length) return null;
    const total = list.reduce((n, c) => n + SHOP_WEIGHT[c.rarity], 0);
    let r = rand() * total;
    const card = list.find((c) => (r -= SHOP_WEIGHT[c.rarity]) <= 0) || list[0];
    pool = pool.filter((c) => c !== card);
    return card;
  };
  const top = draw((c) => ['epique', 'legendaire', 'mythique'].includes(c.rarity)) || draw();
  const items = [];
  while (items.length < DAILY_CARDS && pool.length) items.push(draw());
  return {
    featured: { id: top.id, price: Math.round(CARD_PRICE[top.rarity] * 0.75 / 10) * 10 },
    items: items.map((c) => ({ id: c.id, price: CARD_PRICE[c.rarity] })),
  };
}

export function cardPrice(id, p = currentPlayer(getState()), t = Date.now()) {
  const shop = dailyCards(p, t);
  return [shop.featured, ...shop.items].find((x) => x.id === id)?.price ?? null;
}

// Ajoute une carte (dans un update()) ; annonce une collection complétée et verse sa récompense.
function giveCard(me, card) {
  me.cards ||= {};
  me.cardsAt ||= {};
  me.setRewards ||= {};
  me.cards[card.id] = (me.cards[card.id] || 0) + 1;
  me.cardsAt[card.id] ||= Date.now();
  const prog = setProgress(me, card.set);
  if (prog.done && !prog.claimed) {
    me.setRewards[card.set] = Date.now();
    me.balance += SET_REWARD;
    me.inbox.push({ type: 'reward', amount: SET_REWARD, text: `Collection « ${setById(card.set)?.name} » complète ! +${SET_REWARD.toLocaleString('fr-FR')} Goalz` });
  }
}

export function buyCard(id) {
  const card = cardById(id);
  const p = currentPlayer(getState());
  if (!card || !p) throw new Error('Carte introuvable.');
  if (hasCard(p, id)) throw new Error('Tu l\'as déjà.');
  const price = cardPrice(id, p);
  if (price == null) throw new Error('Cette carte n\'est plus dans ta boutique du jour.');
  if (p.balance < price) throw new Error(`Il te manque ${(price - p.balance).toLocaleString('fr-FR')} Goalz.`);
  update((s) => {
    const me = currentPlayer(s);
    me.balance -= price;
    giveCard(me, card);
  });
  return card;
}

// Pochettes encore ouvrables aujourd'hui (3 par jour, + les recharges achetées aujourd'hui).
export function packsLeft(p, t = Date.now()) {
  const d = p?.packDay?.day === dayKey(t) ? p.packDay : { opened: 0, extra: 0 };
  return Math.max(0, PACK.perDay + d.extra - d.opened);
}

// Pochette : 3 cartes tirées au hasard (plus de chances pour les cartes communes).
// → [{ card, duplicate, refund }]
export function openPack(rand = Math.random) {
  const p = currentPlayer(getState());
  if (!p) throw new Error('Joueur introuvable.');
  if (!packsLeft(p)) throw new Error('Plus de pochette aujourd\'hui : prends une Recharge pochettes dans les Boosts, ou reviens demain !');
  if (p.balance < PACK.price) throw new Error(`Il te manque ${(PACK.price - p.balance).toLocaleString('fr-FR')} Goalz.`);
  const picks = [];
  for (let i = 0; i < PACK.size; i++) {
    const list = CARDS.filter((c) => !picks.includes(c));
    const total = list.reduce((n, c) => n + PACK_WEIGHT[c.rarity], 0);
    let r = rand() * total;
    picks.push(list.find((c) => (r -= PACK_WEIGHT[c.rarity]) <= 0) || list[0]);
  }
  const out = [];
  update((s) => {
    const me = currentPlayer(s);
    me.balance -= PACK.price;
    const day = dayKey(Date.now());
    if (me.packDay?.day !== day) me.packDay = { day, opened: 0, extra: 0 };
    me.packDay.opened += 1;
    for (const card of picks) {
      const duplicate = hasCard(me, card.id);
      const refund = duplicate ? Math.round(CARD_PRICE[card.rarity] * DUPLICATE_REFUND) : 0;
      if (duplicate) me.balance += refund;
      giveCard(me, card);
      out.push({ card, duplicate, refund });
    }
  });
  return out;
}

// Carte favorite, montrée sur le profil et dans la boutique (re-cliquer la retire).
export function favoriteCard(id) {
  update((s) => {
    const me = currentPlayer(s);
    if (!hasCard(me, id)) return;
    me.style ||= {};
    me.style.card = me.style.card === id ? null : id;
  });
}
