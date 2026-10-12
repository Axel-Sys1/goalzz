// Progression : niveau du joueur (XP), cosmétiques à débloquer par niveau ou à acheter en Goalz
// (couleur de pseudo, cadre d'avatar, titre) et boost d'XP. Rien qui aide à gagner : la boutique
// ne vend que du style, et les objets de prestige (rang, saison) ne s'achètent pas.
import { getState, update } from '../store.js';
import { currentPlayer } from './players.js';

export const MAX_LEVEL = 100;
export const BOOST_MS = 24 * 3600_000;

// XP pour passer du niveau n au niveau n + 1 : 100, 120, 140… (≈ 107 000 XP pour le niveau 100).
export const xpToNext = (n) => 100 + 20 * (n - 1);

export function levelOf(xp = 0) {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && rest >= xpToNext(level)) { rest -= xpToNext(level); level += 1; }
  const need = level < MAX_LEVEL ? xpToNext(level) : 0;
  return { level, into: rest, need, progress: need ? rest / need : 1 };
}

// XP gagnés : à chaque pari placé, puis à son règlement (plus pour une grosse cote).
export const XP = {
  place: (legs = 1) => 10 + (legs > 1 ? 5 * legs : 0),
  won: (odds) => Math.min(80, 20 + Math.round(15 * (odds - 1))),
  lost: () => 5,
  bonus: 25,
  referral: 100,
};

// ─── Catalogue ───────────────────────────────────────────────────────────────
// kind : color (pseudo) | frame (cadre d'avatar) | title | boost. level : débloqué gratuitement à ce
// niveau. price : en vente dans la boutique (Goalz). Un objet peut avoir les deux.
// rarity : commun | rare | epique | legendaire | mythique | exclusif (couleur et lueur dans la boutique).
export const ITEMS = [
  // Effets de pseudo
  { id: 'color-orange', kind: 'color', rarity: 'commun', name: 'Orange Goalzz', level: 2 },
  { id: 'color-blue', kind: 'color', rarity: 'commun', name: 'Bleu électrique', price: 500 },
  { id: 'color-green', kind: 'color', rarity: 'commun', name: 'Vert pelouse', price: 500 },
  { id: 'color-pink', kind: 'color', rarity: 'rare', name: 'Rose fluo', price: 800 },
  { id: 'color-purple', kind: 'color', rarity: 'rare', name: 'Violet royal', level: 8, price: 1500 },
  { id: 'color-ice', kind: 'color', rarity: 'epique', name: 'Glace', price: 2500 },
  { id: 'color-toxic', kind: 'color', rarity: 'epique', name: 'Toxique', price: 2500 },
  { id: 'color-gold', kind: 'color', rarity: 'epique', name: 'Or massif', level: 15, price: 3000 },
  { id: 'color-lava', kind: 'color', rarity: 'legendaire', name: 'Lave', price: 5000 },
  { id: 'color-galaxy', kind: 'color', rarity: 'legendaire', name: 'Galaxie', price: 6000 },
  { id: 'color-fire', kind: 'color', rarity: 'legendaire', name: 'Flammes', level: 30 },
  { id: 'color-neon', kind: 'color', rarity: 'mythique', name: 'Néon arc-en-ciel', price: 8000 },
  // Cadres d'avatar
  { id: 'frame-bronze', kind: 'frame', rarity: 'commun', name: 'Bronze', level: 5 },
  { id: 'frame-pitch', kind: 'frame', rarity: 'rare', name: 'Pelouse', price: 1200 },
  { id: 'frame-silver', kind: 'frame', rarity: 'rare', name: 'Argent', level: 12, price: 2000 },
  { id: 'frame-lightning', kind: 'frame', rarity: 'epique', name: 'Éclair', price: 4000 },
  { id: 'frame-gold', kind: 'frame', rarity: 'epique', name: 'Or', level: 25, price: 5000 },
  { id: 'frame-fire', kind: 'frame', rarity: 'legendaire', name: 'Flammes', price: 6000 },
  { id: 'frame-galaxy', kind: 'frame', rarity: 'legendaire', name: 'Galaxie', price: 7000 },
  { id: 'frame-diamond', kind: 'frame', rarity: 'legendaire', name: 'Diamant', level: 40 },
  { id: 'frame-legend', kind: 'frame', rarity: 'mythique', name: 'Légende', level: 60 },
  { id: 'frame-champion', kind: 'frame', rarity: 'exclusif', name: 'Champion', exclusive: 'Top 3 d\'une saison' },
  // Titres
  { id: 'title-rookie', kind: 'title', rarity: 'commun', name: 'Rookie', level: 1 },
  { id: 'title-prono', kind: 'title', rarity: 'commun', name: 'Pronostiqueur', level: 5 },
  { id: 'title-ultra', kind: 'title', rarity: 'commun', name: 'Ultra', price: 1000 },
  { id: 'title-1n2', kind: 'title', rarity: 'rare', name: 'Mister 1N2', price: 1500 },
  { id: 'title-prophet', kind: 'title', rarity: 'rare', name: 'Le Prophète', price: 1500 },
  { id: 'title-expert', kind: 'title', rarity: 'rare', name: 'Expert', level: 20 },
  { id: 'title-sniper', kind: 'title', rarity: 'epique', name: 'Sniper', price: 2500 },
  { id: 'title-combo', kind: 'title', rarity: 'epique', name: 'Roi du combiné', price: 2500 },
  { id: 'title-boss', kind: 'title', rarity: 'legendaire', name: 'Le Boss', price: 4000 },
  { id: 'title-machine', kind: 'title', rarity: 'legendaire', name: 'Machine à cotes', price: 4000 },
  { id: 'title-legend', kind: 'title', rarity: 'legendaire', name: 'Légende', level: 50 },
  { id: 'title-untouchable', kind: 'title', rarity: 'mythique', name: 'Intouchable', price: 7000 },
  { id: 'title-goat', kind: 'title', rarity: 'mythique', name: 'GOAT', level: 100 },
  { id: 'title-champion', kind: 'title', rarity: 'exclusif', name: 'Champion de saison', exclusive: 'Top 3 d\'une saison' },
  // Boost
  { id: 'boost-xp', kind: 'boost', rarity: 'rare', name: 'Boost XP ×2 · 24 h', price: 1000 },
];
export const RARITY = {
  commun: 'Commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique', exclusif: 'Exclusif',
};
export const itemById = (id) => ITEMS.find((i) => i.id === id);
export const KINDS = { color: 'Effets de pseudo', frame: 'Cadres', title: 'Titres', boost: 'Boosts' };

// Offre de la semaine : un objet en vente à −30 %, qui change chaque lundi.
export function weeklyDeal(t = Date.now()) {
  const forSale = ITEMS.filter((i) => i.price && i.kind !== 'boost' && i.rarity !== 'commun');
  const week = Math.floor((t / 86_400_000 + 3) / 7); // semaines commençant le lundi
  const item = forSale[week % forSale.length];
  return { id: item.id, price: Math.round(item.price * 0.7 / 10) * 10 };
}
// Prochain changement de l'offre (lundi, minuit UTC).
export function dealEndsAt(t = Date.now()) {
  const week = Math.floor((t / 86_400_000 + 3) / 7);
  return (week + 1) * 7 * 86_400_000 - 3 * 86_400_000;
}
// Promos du jour : 2 objets à −20 %, pas dans la même catégorie que l'offre de la semaine, renouvelés à minuit.
export function dailyDeals(t = Date.now()) {
  const weekKind = itemById(weeklyDeal(t).id).kind;
  const pool = ITEMS.filter((i) => i.price && i.kind !== weekKind);
  const day = Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86_400_000);
  const a = pool[(day * 7) % pool.length];
  const rest = pool.filter((i) => i.kind !== a.kind);
  const b = rest[(day * 11) % rest.length];
  return [a, b].map((i) => ({ id: i.id, price: Math.round(i.price * 0.8 / 10) * 10 }));
}
export function nextMidnight(t = Date.now()) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
// Prix actuel d'un objet : le meilleur entre son prix normal et une promo en cours.
export function priceOf(item, t = Date.now()) {
  const deals = [weeklyDeal(t), ...dailyDeals(t)].filter((d) => d.id === item.id).map((d) => d.price);
  return Math.min(item.price, ...deals);
}

export const style = (p) => p?.style || {};
export const owns = (p, item) => item.kind !== 'boost' && (levelOf(p?.xp).level >= (item.level ?? Infinity) || !!p?.owned?.[item.id]);
export const boostActive = (p, t = Date.now()) => (p?.boostUntil || 0) > t;

// Joueurs créés avant les niveaux : XP de départ tirés de leurs statistiques.
export function ensureProgress(p) {
  if (p.xp == null) p.xp = (p.stats?.betsPlaced || 0) * XP.place() + (p.stats?.wins || 0) * 25 + (p.stats?.losses || 0) * XP.lost();
  p.owned ||= {};
  p.style ||= {};
}

// Ajoute de l'XP (dans un update()). Annonce les niveaux gagnés et ce qu'ils débloquent.
export function addXp(p, amount, { boostable = true } = {}) {
  ensureProgress(p);
  const gain = Math.round(amount * (boostable && boostActive(p) ? 2 : 1));
  const before = levelOf(p.xp).level;
  p.xp += gain;
  const after = levelOf(p.xp).level;
  if (after > before) {
    const unlocks = ITEMS.filter((i) => i.level > before && i.level <= after).map((i) => i.name);
    p.inbox.push({ type: 'level', level: after, unlocks });
  }
  return gain;
}

// ─── Boutique ────────────────────────────────────────────────────────────────
export function buyItem(id) {
  const item = itemById(id);
  const p = currentPlayer(getState());
  if (!item || !item.price || !p) throw new Error('Objet introuvable.');
  if (owns(p, item)) throw new Error('Tu l\'as déjà.');
  const price = priceOf(item);
  if (p.balance < price) throw new Error(`Il te manque ${(price - p.balance).toLocaleString('fr-FR')} Goalz.`);
  update((s) => {
    const me = currentPlayer(s);
    ensureProgress(me);
    me.balance -= price;
    if (item.kind === 'boost') me.boostUntil = Math.max(Date.now(), me.boostUntil || 0) + BOOST_MS;
    else { me.owned[item.id] = Date.now(); me.style[item.kind] = item.id; }
  });
  return item;
}

export function equipItem(id) {
  const item = itemById(id);
  update((s) => {
    const me = currentPlayer(s);
    ensureProgress(me);
    if (!item || !owns(me, item)) return;
    me.style[item.kind] = me.style[item.kind] === id ? null : id; // re-cliquer retire l'objet
  });
}
