// Coque de l'appli : en-tête, navigation, routeur et rendu des écrans.
import { CONFIG } from '../config.js';
import { clockFor, getState, now, realNow } from '../store.js';
import { countdown, fmt, formatKickoff } from '../util.js';
import { canClaimBonus, currentPlayer } from '../services/players.js';
import { icons, coin } from './icons.js';
import { animateBalance, processInbox } from './effects.js';
import { renderOnboarding } from './screens/onboarding.js';
import { renderMatches, kickoffShort } from './screens/matches.js';
import { matchStatus } from '../services/matchInfo.js';
import { LIVE_SPORTS, liveMarket } from '../providers/liveOdds.js';
import { renderSlip } from './screens/slip.js';
import { slipCheck } from '../services/bets.js';
import { renderMyBets } from './screens/myBets.js';
import { renderRanking } from './screens/ranking.js';
import { renderProfile } from './screens/profile.js';
import { adSlot, mountAds } from './ads.js';

const ROUTES = [
  { id: 'matchs', label: 'Matchs', icon: 'ball', render: renderMatches },
  { id: 'panier', label: 'Panier', icon: 'ticket', render: renderSlip },
  { id: 'paris', label: 'Mes paris', icon: 'list', render: renderMyBets },
  { id: 'classement', label: 'Rangs', icon: 'trophy', render: renderRanking },
  { id: 'profil', label: 'Profil', icon: 'user', render: renderProfile },
];

export function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '');
  return ROUTES.find((r) => r.id === id) || ROUTES[0];
}

export function go(routeId) {
  location.hash = routeId;
}

const root = document.getElementById('app');
let shellMounted = false;
let lastRouteId = null;
let liveSig = '';

const shellHtml = () => `
  <header class="topbar">
    <div class="topbar-inner">
      <a class="logo" href="#matchs" aria-label="Goalz, accueil">${icons.ball}<span>GOAL<b>Z</b></span></a>
      <nav class="nav-top" id="nav-top" aria-label="Navigation principale"></nav>
      <div class="top-right">
        <button class="bonus-btn" id="bonus-btn" data-action="claim-bonus" type="button">${icons.gift}<span class="bonus-dot"></span></button>
        <div class="balance" id="balance" aria-live="polite">
          ${coin()}<span id="balance-value">0</span>
        </div>
      </div>
    </div>
    <div class="freebar">Jeu gratuit, sans argent réel<span class="hide-sm"> · Les Goalz n'ont aucune valeur monétaire</span></div>
  </header>
  ${adSlot('top') ? `<div class="ad-band">${adSlot('top')}</div>` : ''}
  <div class="layout">
    <main id="content" class="content"></main>
    <div class="aside">
      ${adSlot('side')}
      <aside id="aside" class="aside-slip" aria-label="Panier"></aside>
    </div>
    ${adSlot('bottom')}
  </div>
  <div id="slipbar"></div>
  <nav class="nav-bottom" id="nav-bottom" aria-label="Navigation"></nav>`;

function navHtml(route, p) {
  return ROUTES.map((r) => `
    <a href="#${r.id}" class="nav-item ${r.id === route.id ? 'active' : ''}" ${r.id === route.id ? 'aria-current="page"' : ''}>
      <span class="nav-icon">${icons[r.icon]}${r.id === 'panier' && p.slip.length ? `<span class="nav-badge">${p.slip.length}</span>` : ''}</span>
      <span>${r.label}</span>
    </a>`).join('');
}

function renderHeader(p) {
  const bonus = root.querySelector('#bonus-btn');
  const available = canClaimBonus(p);
  bonus.classList.toggle('available', available);
  bonus.title = available ? `Récupérer ton bonus du jour (+${CONFIG.DAILY_BONUS})` : 'Bonus déjà récupéré. Reviens demain !';
  bonus.setAttribute('aria-label', bonus.title);
  animateBalance(p);
}

let lastPotential = null;

function renderSlipBar(route, p) {
  const bar = root.querySelector('#slipbar');
  if (!p.slip.length || route.id === 'panier') { bar.innerHTML = ''; lastPotential = null; return; }
  const { potential, combo } = slipCheck(getState());
  const changed = lastPotential !== null && lastPotential !== potential;
  const appeared = !bar.querySelector('.slipbar');
  lastPotential = potential;
  bar.innerHTML = `
    <a class="slipbar" href="#panier">
      <span class="slipbar-count">${p.slip.length}</span>
      <span class="grow">${combo ? 'matchs en combiné' : p.slip.length > 1 ? 'sélections' : 'sélection'} dans le panier</span>
      <span class="slipbar-gain${changed ? ' roll' : ''}"><span>${fmt(potential)}</span> ${coin('coin coin-sm')}</span>
      ${icons.arrow}
    </a>`;
  if (!appeared) bar.querySelector('.slipbar').classList.add('no-enter');
}

function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id || a === document.body) return null;
  let sel = null;
  try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* pas un champ texte */ }
  return { id: a.id, sel };
}

function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  try { if (f.sel && f.sel[0] != null) el.setSelectionRange(f.sel[0], f.sel[1]); } catch { /* ignoré */ }
}

// Un rafraîchissement (ex. nouveaux matchs) ne doit pas effacer ce que l'utilisateur est en train de taper.
function captureInputs() {
  const values = {};
  root.querySelectorAll('input[id]').forEach((el) => { if (el.value) values[el.id] = el.value; });
  return values;
}

function restoreInputs(values) {
  for (const [id, v] of Object.entries(values)) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = v;
  }
}

// Matchs commencés et cotes en direct proposées : si l'une change (coup d'envoi, minute qui passe,
// marché suspendu ou rouvert), on redessine.
function marketSig(m) {
  if (matchStatus(m) !== 'live' || !LIVE_SPORTS.has(m.sport)) return '';
  const { open, odds } = liveMarket(m, clockFor(m));
  return open ? Object.values(odds).join('/') : 'x';
}
const liveSignature = (s) =>
  Object.values(s.matches).filter((m) => matchStatus(m) !== 'upcoming').map((m) => `${m.id}:${marketSig(m)}`).join(',');

export function render() {
  const focus = captureFocus();
  const typed = captureInputs();
  const s = getState();
  const p = currentPlayer(s);

  if (!p) {
    shellMounted = false;
    lastRouteId = null;
    root.innerHTML = renderOnboarding(s);
    restoreInputs(typed);
    restoreFocus(focus);
    return;
  }

  if (!shellMounted) { root.innerHTML = shellHtml(); shellMounted = true; mountAds(root); }
  const route = currentRoute();

  renderHeader(p);
  root.querySelector('#nav-top').innerHTML = navHtml(route, p);
  root.querySelector('#nav-bottom').innerHTML = navHtml(route, p);
  const content = root.querySelector('#content');
  content.innerHTML = route.render(s, p, { context: 'page' });
  content.classList.toggle('enter', route.id !== lastRouteId);

  const showAside = route.id !== 'panier';
  root.querySelector('.layout').classList.toggle('no-aside', !showAside);
  // Pas de pub sur le panier : écran de validation, une pub sous « Valider » attirerait les clics.
  root.classList.toggle('ads-off', route.id === 'panier');
  root.querySelector('#aside').innerHTML = showAside ? renderSlip(s, p, { context: 'aside' }) : '';
  renderSlipBar(route, p);

  if (route.id !== lastRouteId) {
    if (lastRouteId !== null) window.scrollTo({ top: 0 });
    lastRouteId = route.id;
  }
  liveSig = liveSignature(s);
  restoreInputs(typed);
  restoreFocus(focus);
  updateClocks();
  processInbox(p);
}

// Met à jour les comptes à rebours sans redessiner la page.
export function updateClocks() {
  const game = now();
  const real = realNow();
  const clock = (el) => (el.dataset.real ? real : game);
  document.querySelectorAll('[data-kickoff]').forEach((el) => {
    el.textContent = formatKickoff(Number(el.dataset.kickoff), clock(el));
  });
  document.querySelectorAll('[data-kickoff-short]').forEach((el) => {
    el.textContent = kickoffShort(Number(el.dataset.kickoffShort), clock(el));
  });
  document.querySelectorAll('[data-ends]').forEach((el) => {
    const ms = Number(el.dataset.ends) - game;
    el.textContent = ms > 0 ? `Fin dans ${countdown(ms)}` : 'Résultat imminent…';
  });
}

// Appelé chaque seconde : redessine seulement si un match vient de commencer.
export function tick() {
  const s = getState();
  if (!currentPlayer(s)) return;
  if (liveSignature(s) !== liveSig) render();
  else updateClocks();
}
