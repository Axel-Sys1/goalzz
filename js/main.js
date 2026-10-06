import { CONFIG } from './config.js';
import { subscribe, update } from './store.js';
import { ensureBots } from './services/bots.js';
import { startSync, syncAll } from './services/matches.js';
import { render, tick } from './ui/app.js';
import { bindEvents } from './ui/events.js';

update((s) => ensureBots(s), { silent: true });

bindEvents();
subscribe(render);
window.addEventListener('hashchange', render);
render();

// Choix des sources (direct ou instantané), puis chaque provider décide lui-même
// s'il doit être rappelé (voir services/matches.js).
startSync();
setInterval(syncAll, CONFIG.TICK_MS);
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncAll();
});
