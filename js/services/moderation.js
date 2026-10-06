// Filtre de pseudos : refuse les insultes et propos haineux les plus courants (français et anglais),
// y compris écrits avec des chiffres (b1te, 5alope…), des espaces ou des points (b.i.t.e).

// Recherchés n'importe où dans le pseudo (mots assez longs pour ne pas créer de faux positifs).
const ANYWHERE = [
  'bite', 'salope', 'salaud', 'connard', 'connasse', 'encule', 'enculer', 'putain', 'niquer',
  'tamere', 'batard', 'tapette', 'couille', 'chatte', 'branle', 'branleur',
  'bougnoul', 'negre', 'youpin', 'bicot', 'gouine', 'suceur', 'suceuse', 'teube',
  'enfoire', 'pouffiasse', 'grognasse', 'zgeg', 'chibre', 'nichon', 'vagin', 'penis', 'porno',
  'fuck', 'fucker', 'bitch', 'cunt', 'nigger', 'nigga', 'whore', 'slut', 'faggot', 'retard',
  'pussy', 'asshole', 'dickhead', 'motherf', 'hitler', 'daesh', 
];
// Refusés seulement s'ils forment un mot entier du pseudo (trop courts pour une recherche partout).
const WHOLE_WORD = [
  'con', 'conne', 'cul', 'pd', 'fdp', 'ntm', 'nik', 'tg', 'bz', 'zob', 'sex', 'sexe', 'dick', 'cock',
  'ass', 'fag', 'kkk', 'ss', 'tepu', 'tchoin', 'merde', 'caca', 'pipi', 'zizi', 'suce', 'suc',
  'nique', 'pute', 'tamer', 'pede', 'raton', 'catin', 'negro', 'shit', 'nazi', 'heil', 'pedo', 'viol', 'nazis',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '€': 'e', '!': 'i' };

function normalize(pseudo) {
  return String(pseudo)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[0134578@$€!]/g, (c) => LEET[c])
    .replace(/(.)\1{2,}/g, '$1$1');                    // « biiiite » → « biite »
}

export function isOffensivePseudo(pseudo) {
  const n = normalize(pseudo);
  const glued = n.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'); // « b.i.i.t.e » → « bite »
  if (ANYWHERE.some((w) => glued.includes(w) || n.replace(/[^a-z]/g, '').includes(w))) return true;
  const words = n.split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => WHOLE_WORD.includes(w) || WHOLE_WORD.includes(w.replace(/(.)\1+/g, '$1')));
}
