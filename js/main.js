import { CONFIG } from './config.js';
import { subscribe, update } from './store.js';
import { ensureBots } from './services/bots.js';
import { startSync, syncAll } from './services/matches.js';
import { render, tick } from './ui/app.js';
import { bindEvents } from './ui/events.js';
import { toast } from './ui/effects.js';
import { initCloud } from './services/cloud.js';
import { joinPendingInvite, readInviteFromUrl } from './services/invite.js';
import { ui } from './ui/uiState.js';

readInviteFromUrl();
update((s) => ensureBots(s), { silent: true });

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
