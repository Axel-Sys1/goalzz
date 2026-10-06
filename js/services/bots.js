// Joueurs simulés : ils animent le classement général tant qu'il n'y a pas de serveur.
import { rand, randInt, uid } from '../util.js';
import { winRR, LOSS_RR } from './ranks.js';

const BOT_NAMES = [
  'ButeurFou', 'LaPanenka', 'Coach_Mimi', 'DunkMaster', 'AceDuFond', 'TikiTaka',
  'MrContreAttaque', 'LuckyLob', 'UltraNono', 'ReboundQueen', 'PetitPont', 'Lucarne77',
];

export function ensureBots(s) {
  if (!s.bots) s.bots = BOT_NAMES.map((name) => ({ id: uid('bot'), name, balance: randInt(70, 160) * 10 }));
  // Rangs : les bots s'étalent de Fer à Immortel pour peupler l'échelle.
  for (const b of s.bots) if (b.rr == null) b.rr = randInt(0, 250) * 10;
}

// Chaque "tour", une partie des bots parie avec une espérance légèrement négative.
export function simulateBots(s, rounds = 1) {
  for (let r = 0; r < rounds; r++) {
    for (const b of s.bots || []) {
      if (Math.random() > 0.45) continue;
      const stake = Math.min(b.balance, randInt(2, 20) * 10);
      const odds = rand(1.4, 3.5);
      const won = Math.random() < 0.95 / odds;
      b.balance += won ? Math.floor(stake * odds) - stake : -stake;
      b.rr = Math.max(0, (b.rr || 0) + (won ? winRR(odds) : -LOSS_RR));
      if (b.balance < 100) b.balance += 100; // eux aussi prennent leur bonus
    }
  }
}
