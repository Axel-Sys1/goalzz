import { CONFIG } from './config.js';
import { getState, subscribe, update } from './store.js';
import { ensureBots } from './services/bots.js';
import { ensureProgress } from './services/progress.js';
import { startSync, syncAll } from './services/matches.js';
import { render, tick } from './ui/app.js';
import { bindEvents } from './ui/events.js';
import { toast } from './ui/effects.js';
import { cloud, initCloud } from './services/cloud.js';
import { joinPendingInvite, readInviteFromUrl } from './services/invite.js';
import { ui } from './ui/uiState.js';
import { applyPendingReferral, claimReferralRewards, readReferralFromUrl } from './services/referral.js';

readInviteFromUrl();
readReferralFromUrl();
update((s) => { ensureBots(s); Object.values(s.players).forEach(ensureProgress); }, { silent: true });

bindEvents();
subscribe(render);
window.addEventListener('hashchange', render);
render();

// Compte en ligne (facultatif) : connexion par email et sauvegarde de la partie.
initCloud({ notify: toast });

// Lien d'invitation à une ligue : on la rejoint dès que le joueur est connecté.
subscribe(async () => {
  const res = await joinPendingInvite();
  if (!res) return;
  if (res.joined) {
    toast(`Bienvenue dans la ligue « ${res.name} » !`, 'success');
    ui.rankTab = 'leagues';
    location.hash = 'classement';
  } else if (res.error && !/déjà/.test(res.error)) {
    toast(`Invitation ${res.code} : ${res.error}`, 'error');
  }
});

// Parrainage : parrain venu par un lien (appliqué dès le compte et le pseudo prêts), et récompenses
// des filleuls réclamées une fois par session de compte.
let claimedFor = null;
subscribe(async () => {
  const res = await applyPendingReferral();
  if (res?.error && !/déjà/.test(res.error)) toast(`Parrainage : ${res.error}`, 'error');
  const s = getState();
  const key = cloud.user && s.currentPlayerId ? `${cloud.user.uid}|${s.currentPlayerId}` : null;
  if (key && key !== claimedFor) { claimedFor = key; claimReferralRewards(); }
});

// Choix des sources (direct ou instantané), puis chaque provider décide lui-même
// s'il doit être rappelé (voir services/matches.js).
startSync();
setInterval(syncAll, CONFIG.TICK_MS);
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncAll();
});

// Application installable (écran d'accueil du téléphone) et utilisable hors ligne.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installPrompt = e; render(); });
window.addEventListener('appinstalled', () => { ui.installPrompt = null; toast('Goalzz est installé sur ton écran d\'accueil !', 'success'); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
