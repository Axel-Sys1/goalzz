// Joueur vedette d'une équipe, pour habiller les matchs « À l'affiche » (photo détourée, façon
// Betclic) : la carte la plus rare de cette équipe dans le catalogue des cartes (js/data/cards.js).
import { CONFIG } from '../config.js';
import { CARDS } from '../services/cards.js';
import { slugify } from '../seo/pages.js';

const RANK = { mythique: 5, legendaire: 4, epique: 3, rare: 2, commun: 1 };
// Noms ESPN → noms du catalogue (TheSportsDB), une fois passés en slug.
const ALIAS = {
  'paris-saint-germain': 'paris-sg', internazionale: 'inter-milan', 'as-monaco': 'monaco', 'olympique-de-marseille': 'marseille',
  'athletic-club': 'athletic-bilbao', 'brighton-hove-albion': 'brighton-and-hove-albion',
  // Sélections nationales (cartes en français)
  argentina: 'argentine', brazil: 'bresil', spain: 'espagne', norway: 'norvege', england: 'angleterre',
  morocco: 'maroc', egypt: 'egypte', croatia: 'croatie', belgium: 'belgique', 'south-korea': 'coree-du-sud',
};

let index = null;
function build() {
  index = new Map();
  for (const c of CARDS) {
    if (!c.img || !c.cutout) continue;
    const key = `${c.sport}|${c.national ? 'n' : 'c'}|${slugify(c.team)}`;
    const cur = index.get(key);
    if (!cur || RANK[c.rarity] > RANK[cur.rarity]) index.set(key, c);
  }
}

// → { name, img } | null. national : équipe nationale (sinon club).
export function starOf(team, sport) {
  if (!CONFIG.CARD_PHOTOS || !team?.name) return null;
  if (!index) build();
  const slug = slugify(team.name);
  const key = ALIAS[slug] || slug;
  const c = index.get(`${sport}|c|${key}`) || index.get(`${sport}|n|${key}`);
  return c ? { name: c.name, img: `${c.img}/medium` } : null;
}
