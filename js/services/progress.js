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
export const ITEMS = [
  // Couleurs de pseudo
  { id: 'color-orange', kind: 'color', name: 'Orange Goalzz', level: 2 },
  { id: 'color-blue', kind: 'color', name: 'Bleu électrique', price: 500 },
  { id: 'color-green', kind: 'color', name: 'Vert pelouse', price: 500 },
  { id: 'color-pink', kind: 'color', name: 'Rose fluo', price: 800 },
  { id: 'color-purple', kind: 'color', name: 'Violet royal', level: 8, price: 1500 },
  { id: 'color-gold', kind: 'color', name: 'Or', level: 15, price: 3000 },
  { id: 'color-fire', kind: 'color', name: 'Flammes (animé)', level: 30 },
  { id: 'color-neon', kind: 'color', name: 'Néon arc-en-ciel (animé)', price: 8000 },
  // Cadres d'avatar
  { id: 'frame-bronze', kind: 'frame', name: 'Cadre bronze', level: 5 },
  { id: 'frame-silver', kind: 'frame', name: 'Cadre argent', level: 12, price: 2000 },
  { id: 'frame-gold', kind: 'frame', name: 'Cadre or', level: 25, price: 5000 },
  { id: 'frame-pitch', kind: 'frame', name: 'Cadre pelouse', price: 1200 },
  { id: 'frame-fire', kind: 'frame', name: 'Cadre flammes (animé)', price: 6000 },
  { id: 'frame-diamond', kind: 'frame', name: 'Cadre diamant', level: 40 },
  { id: 'frame-legend', kind: 'frame', name: 'Cadre légende (animé)', level: 60 },
  // Titres
  { id: 'title-rookie', kind: 'title', name: 'Rookie', level: 1 },
  { id: 'title-prono', kind: 'title', name: 'Pronostiqueur', level: 5 },
  { id: 'title-expert', kind: 'title', name: 'Expert', level: 20 },
  { id: 'title-legend', kind: 'title', name: 'Légende', level: 50 },
  { id: 'title-goat', kind: 'title', name: 'GOAT', level: 100 },
  { id: 'title-prophet', kind: 'title', name: 'Le Prophète', price: 1500 },
  { id: 'title-1n2', kind: 'title', name: 'Mister 1N2', price: 1500 },
  { id: 'title-combo', kind: 'title', name: 'Roi du combiné', price: 2500 },
  { id: 'title-sniper', kind: 'title', name: 'Sniper', price: 2500 },
  { id: 'title-ultra', kind: 'title', name: 'Ultra', price: 1000 },
  // Boost
  { id: 'boost-xp', kind: 'boost', name: 'Boost XP ×2 (24 h)', price: 1000 },
];
export const itemById = (id) => ITEMS.find((i) => i.id === id);
export const KINDS = { color: 'Couleurs de pseudo', frame: 'Cadres', title: 'Titres', boost: 'Boosts' };

// Offre de la semaine : un objet en vente à −30 %, qui change chaque lundi.
export function weeklyDeal(t = Date.now()) {
  const forSale = ITEMS.filter((i) => i.price && i.kind !== 'boost');
  const week = Math.floor((t / 86_400_000 + 3) / 7); // semaines commençant le lundi
  const item = forSale[week % forSale.length];
  return { id: item.id, price: Math.round(item.price * 0.7 / 10) * 10 };
}
export const priceOf = (item, t = Date.now()) => (weeklyDeal(t).id === item.id ? weeklyDeal(t).price : item.price);

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
