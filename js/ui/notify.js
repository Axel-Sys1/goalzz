// Notifications du téléphone ou de l'ordinateur : pari gagné ou perdu, coup d'envoi d'un match sur
// lequel le joueur a parié. Envoyées par l'appli tant qu'elle est ouverte (même en arrière-plan) :
// des notifications appli fermée demanderaient un serveur d'envoi.
import { getState, realNow, now } from '../store.js';
import { fmt } from '../util.js';
import { matchTitle } from '../services/matchInfo.js';

const PREF = 'goalz:notif';
const SEEN = 'goalz:notif-kickoff';
const REMIND_MS = 15 * 60_000;

const supported = () => typeof Notification === 'function';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage plein ou bloqué */ } };

// 'unsupported' | 'blocked' (refusé dans le navigateur) | 'on' | 'off'
export function notifState() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && read(PREF) === 'on' ? 'on' : 'off';
}

export async function setNotif(on) {
  if (!on) { write(PREF, 'off'); return 'off'; }
  if (!supported()) return 'unsupported';
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  write(PREF, 'on');
  show('Notifications activées', 'Goalzz te préviendra de tes résultats et des coups d\'envoi.', 'test');
  return 'on';
}

// Passe par le service worker quand il existe (obligatoire sur Android et sur iPhone en appli installée).
async function show(title, body, tag) {
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch { /* on retombe sur l'API simple */ }
  try { new Notification(title, opts); } catch { /* navigateur qui refuse hors service worker */ }
}

// Appelé avec les messages de la boîte de réception (effets.js) : seulement si l'appli n'est pas à l'écran.
export function notifyInbox(items) {
  if (notifState() !== 'on' || !document.hidden) return;
  const wins = items.filter((i) => i.type === 'win');
  const losses = items.filter((i) => i.type === 'loss');
  if (wins.length) {
    const total = wins.reduce((s, w) => s + w.amount, 0);
    show(wins.length === 1 ? 'Pari gagné !' : `${wins.length} paris gagnés !`,
      `${wins.length === 1 ? wins[0].label : 'Bien joué'} · +${fmt(total)} Goalz`, 'result');
  } else if (losses.length) {
    show(losses.length === 1 ? 'Pari perdu' : `${losses.length} paris perdus`,
      losses.length === 1 ? losses[0].label : 'La prochaine sera la bonne !', 'result');
  }
}

// Toutes les minutes : un rappel par match parié qui commence dans moins de 15 minutes.
export function checkKickoffs() {
  if (notifState() !== 'on') return;
  const s = getState();
  const me = s.currentPlayerId;
  let seen = [];
  try { seen = JSON.parse(read(SEEN) || '[]'); } catch { /* liste abîmée : on repart de zéro */ }
  const ids = new Set();
  for (const b of Object.values(s.bets)) {
    if (b.playerId !== me || b.status !== 'pending') continue;
    for (const id of b.legs ? b.legs.filter((l) => l.status === 'pending').map((l) => l.matchId) : [b.matchId]) ids.add(id);
  }
  const fresh = [];
  for (const id of ids) {
    const m = s.matches[id];
    if (!m || m.status !== 'scheduled' || seen.includes(id)) continue;
    const left = m.startsAt - (m.real ? realNow() : now());
    if (left > 0 && left <= REMIND_MS) {
      fresh.push(id);
      show('Ça commence !', `${matchTitle(m)} démarre dans ${Math.max(1, Math.round(left / 60_000))} min. Ton pari est en jeu.`, `kickoff-${id}`);
    }
  }
  if (fresh.length) write(SEEN, JSON.stringify([...seen, ...fresh].slice(-200)));
}
