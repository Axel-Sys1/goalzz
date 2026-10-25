// Affichage d'une pub récompensée. Vraie pub Google (« H5 Games Ads ») quand elle est activée sur le
// site validé, sinon pub simulée : un encart et un compte à rebours. Rend 'viewed' (pub vue jusqu'au
// bout), 'dismissed' (fermée avant la fin) ou 'unavailable' (aucune pub à montrer).
import { CONFIG } from '../config.js';
import { fmt } from '../util.js';
import { coin } from './icons.js';
import { prepareRewarded, rewardedLive } from './ads.js';

const settings = () => CONFIG.ADS?.rewarded || {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleAd() {
  const ok = await Promise.race([prepareRewarded(), wait(8000).then(() => false)]);
  if (!ok) return 'unavailable';
  return new Promise((resolve) => {
    let viewed = false;
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    // Filet de sécurité : la régie prévient toujours via adBreakDone, sauf si elle plante.
    setTimeout(() => finish(viewed ? 'viewed' : 'unavailable'), 120_000);
    (window.adsbygoogle = window.adsbygoogle || []).push({
      type: 'reward',
      name: 'goalz-reward',
      beforeReward: (showAdFn) => showAdFn(), // le joueur vient de cliquer : on lance la pub tout de suite
      adViewed: () => { viewed = true; },
      adDismissed: () => { viewed = false; },
      adBreakDone: (info) => finish(viewed ? 'viewed' : info?.breakStatus === 'dismissed' ? 'dismissed' : 'unavailable'),
    });
  });
}

// Pub simulée : le compte à rebours ne tourne que si la page est visible.
function simulatedAd() {
  const total = (settings().seconds || 15) * 1000;
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'dialog-overlay';
    ov.innerHTML = `
      <div class="dialog reward-ad" role="dialog" aria-modal="true" aria-labelledby="reward-ad-title">
        <span class="ad-label">Bonus vidéo</span>
        <div class="reward-ad-box">${coin('coin')}<strong>Ton bonus arrive</strong><small>Reste sur la page jusqu'à la fin</small></div>
        <h2 id="reward-ad-title">+${fmt(settings().goalz || 0)} Goalz</h2>
        <div class="reward-ad-bar"><span></span></div>
        <p class="muted" aria-live="polite">Récompense dans <b>${Math.ceil(total / 1000)}</b> s</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" type="button" data-choice="close">Fermer sans récompense</button>
        </div>
      </div>`;
    const bar = ov.querySelector('.reward-ad-bar span');
    const secs = ov.querySelector('p b');
    let elapsed = 0;
    let last = Date.now();
    const close = (result) => {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      previous?.focus?.();
      resolve(result);
    };
    const timer = setInterval(() => {
      const t = Date.now();
      if (!document.hidden) elapsed += t - last;
      last = t;
      bar.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
      secs.textContent = Math.max(0, Math.ceil((total - elapsed) / 1000));
      if (elapsed >= total) close('viewed');
    }, 200);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close('dismissed'); } };
    ov.querySelector('[data-choice="close"]').addEventListener('click', () => close('dismissed'));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    ov.querySelector('[data-choice="close"]').focus();
  });
}

let busy = false;
export async function watchRewardAd() {
  if (busy) return 'busy';
  busy = true;
  try {
    return await (rewardedLive() ? googleAd() : simulatedAd());
  } finally {
    busy = false;
  }
}
