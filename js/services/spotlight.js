// « À l'affiche » : repère les matchs qui intéressent le plus (gros clubs, derbys, chocs,
// affiches serrées, grandes compétitions) pour les mettre en haut de la page.

const norm = (s) => ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const has = (name, key) => norm(name).includes(` ${key} `);

// Équipes et joueurs « locomotives », par sport (noms tels que fournis par ESPN, en minuscules).
const BIG = {
  football: [
    'paris saint germain', 'marseille', 'lyon', 'monaco', 'lille', 'lens', 'nice', 'rennes',
    'real madrid', 'barcelona', 'atletico madrid', 'manchester city', 'manchester united', 'liverpool',
    'arsenal', 'chelsea', 'tottenham hotspur', 'newcastle united', 'bayern munich', 'borussia dortmund',
    'bayer leverkusen', 'juventus', 'internazionale', 'ac milan', 'napoli', 'as roma', 'benfica',
    'fc porto', 'sporting cp', 'ajax amsterdam', 'psv eindhoven', 'celtic', 'rangers',
    'france', 'spain', 'england', 'germany', 'italy', 'portugal', 'brazil', 'argentina', 'netherlands',
    'belgium', 'croatia',
  ],
  basketball: ['lakers', 'celtics', 'warriors', 'knicks', 'spurs', 'bucks', 'nuggets', 'heat', 'thunder', '76ers', 'cavaliers', 'mavericks'],
  americanfootball: ['chiefs', 'eagles', 'cowboys', '49ers', 'packers', 'bills', 'ravens', 'lions'],
  hockey: ['canadiens', 'maple leafs', 'bruins', 'oilers', 'penguins', 'avalanche', 'panthers'],
  rugby: ['toulouse', 'la rochelle', 'toulon', 'racing 92', 'stade francais', 'bordeaux begles', 'clermont',
    'france', 'ireland', 'england', 'new zealand', 'south africa', 'leinster'],
  tennis: ['sinner', 'alcaraz', 'djokovic', 'zverev', 'medvedev', 'fritz', 'draper', 'fils', 'mpetshi perricard',
    'sabalenka', 'swiatek', 'gauff', 'rybakina', 'pegula', 'andreeva', 'zheng'],
};

// Affiches historiques : [équipe A, équipe B, nom affiché].
const RIVALRIES = [
  ['paris saint germain', 'marseille', 'Le Classique'],
  ['real madrid', 'barcelona', 'El Clásico'],
  ['atletico madrid', 'real madrid', 'Derby de Madrid'],
  ['manchester united', 'manchester city', 'Derby de Manchester'],
  ['liverpool', 'manchester united', 'Choc historique'],
  ['liverpool', 'everton', 'Derby de la Mersey'],
  ['arsenal', 'tottenham hotspur', 'Derby de Londres nord'],
  ['internazionale', 'ac milan', 'Derby de Milan'],
  ['juventus', 'internazionale', "Derby d'Italie"],
  ['as roma', 'lazio', 'Derby de Rome'],
  ['bayern munich', 'borussia dortmund', 'Der Klassiker'],
  ['marseille', 'lyon', "L'Olympico"],
  ['lyon', 'saint etienne', 'Derby du Rhône'],
  ['lens', 'lille', 'Derby du Nord'],
  ['nice', 'monaco', 'Derby de la Côte'],
  ['benfica', 'fc porto', 'O Clássico'],
  ['celtic', 'rangers', 'Old Firm'],
  ['ajax amsterdam', 'feyenoord', 'De Klassieker'],
  ['lakers', 'celtics', 'Rivalité historique'],
  ['france', 'england', 'Le Crunch'],
  ['france', 'germany', 'Choc européen'],
  ['france', 'spain', 'Choc européen'],
];

// Poids des compétitions (public surtout français).
const COMPETITION = {
  'Ligue des champions': 3, 'Six Nations': 3, 'Ligue des nations': 2, 'Ligue 1': 2, 'Premier League': 2,
  'LaLiga': 2, 'Coupe de France': 1.5, 'Serie A': 1.5, 'Bundesliga': 1.5, 'Ligue Europa': 1.5, 'NBA': 1.5,
  'Top 14': 1.5, 'Champions Cup': 1.5, 'Ligue Conférence': 1, 'NFL': 1, 'Matchs amicaux': 0.5,
};

const isBig = (sport, team) => (BIG[sport] || []).some((k) => has(team?.name, k));

function rivalry(m) {
  for (const [a, b, label] of RIVALRIES) {
    const h = m.home?.name, w = m.away?.name;
    if ((has(h, a) && has(w, b)) || (has(h, b) && has(w, a))) return label;
  }
  return null;
}

// Intérêt d'un match à venir : { score, tag } (tag = l'étiquette affichée sur la carte).
export function interest(m, now) {
  const derby = rivalry(m);
  const bigs = [m.home, m.away].filter((t) => isBig(m.sport, t)).length;
  const comp = COMPETITION[m.competition] || (m.sport === 'tennis' || m.sport === 'mma' ? 1 : 0.5);
  const o1 = m.odds?.['1'], o2 = m.odds?.['2'];
  const close = o1 && o2 ? Math.max(0, 1.5 - Math.abs(o1 - o2)) : 0;
  const hours = (m.startsAt - now) / 3_600_000;
  let score = comp + bigs * 2.5 + (derby ? 6 : 0) + close + (hours < 36 ? 0.5 : 0) - (hours > 96 ? 1 : 0);
  if (m.oddsSource === 'model') score -= 0.5;
  const tag = derby || (bigs === 2 ? 'Choc au sommet' : bigs === 1 ? 'Gros club' : close > 1 ? 'Affiche serrée' : m.competition);
  return { score, tag, worthy: derby || bigs > 0 || (comp >= 2 && close > 1) };
}

// Les `max` matchs les plus intéressants parmi `list` (déjà limités aux matchs à venir).
export function spotlight(list, now, max = 8) {
  return list
    .filter((m) => m.odds?.['1'] && m.odds?.['2'])
    .map((m) => ({ m, ...interest(m, now) }))
    .filter((x) => x.worthy)
    .sort((a, b) => b.score - a.score || a.m.startsAt - b.m.startsAt)
    .slice(0, max);
}
