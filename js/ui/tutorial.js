// Parcours guidé des nouveaux joueurs : une bulle en bas d'écran et l'élément à toucher qui
// s'illumine. 1. touche une cote · 2. valide ton pari · 3. bravo (défis, boutique). Seuls les joueurs
// créés depuis l'ajout du parcours le voient (player.tutorial), et « Passer » l'arrête.
import { icons } from './icons.js';

export function tutorialStep(p) {
  if (!p?.tutorial || p.tutorialDone) return null;
  if (p.stats.betsPlaced > 0) return 3;
  return p.slip.length ? 2 : 1;
}

const TEXT = {
  1: ['Ton premier prono', 'Touche une cote sur un match qui te tente : elle part dans ton panier.'],
  2: ['Valide ton pari', 'Choisis ta mise, puis touche « Valider le pari ». Tu as 100 Goalz pour commencer !'],
  3: ['Bravo, c\'est parti ! 🎉', 'Chaque pari te fait monter de niveau. Les défis du jour rapportent des Goalz, à dépenser en cartes de joueurs dans la Boutique.'],
};

export function coachHtml(step) {
  if (!step) return '';
  const [title, text] = TEXT[step];
  return `
    <div class="coach" role="status">
      <div class="coach-steps">${[1, 2, 3].map((n) => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div>
      <strong>${title}</strong>
      <span>${text}</span>
      <div class="coach-actions">
        ${step === 3
          ? `<button class="btn btn-ghost" data-action="coach-done" type="button">OK</button>
             <button class="btn btn-primary" data-action="coach-shop" type="button">${icons.bag} Voir la boutique</button>`
          : '<button class="link-btn" data-action="coach-done" type="button">Passer</button>'}
      </div>
    </div>`;
}

// Illumine l'élément à toucher pour l'étape en cours (après chaque rendu).
export function highlight(step, routeId) {
  document.querySelectorAll('.coach-target').forEach((el) => el.classList.remove('coach-target'));
  let el = null;
  if (step === 1 && routeId === 'matchs') {
    el = document.querySelector('.spot-card .odds, .match-upcoming .odds');
  } else if (step === 2) {
    const wide = window.matchMedia('(min-width: 1000px)').matches;
    el = routeId === 'panier' || wide ? document.querySelector('[data-slip-submit]') : document.querySelector('.slipbar');
  }
  el?.classList.add('coach-target');
}
