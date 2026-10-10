// Animations et notifications : solde qui défile, toasts, confettis, badges.
import { update } from '../store.js';
import { BADGES } from '../services/badges.js';
import { fmt, rand, pick, escapeHtml } from '../util.js';
import { notifyInbox } from './notify.js';
import { icons } from './icons.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Solde animé ----------
let shown = null;
let shownFor = null;
let raf = 0;

export function animateBalance(player) {
  const box = document.getElementById('balance');
  const el = document.getElementById('balance-value');
  if (!box || !el) return;
  if (shownFor !== player.id || shown === null) {
    shown = player.balance; shownFor = player.id;
    el.textContent = fmt(shown);
    return;
  }
  if (player.balance === shown) return;
  const from = shown, to = player.balance, diff = to - from;
  shown = to;
  floatDelta(box, diff);
  box.classList.remove('up', 'down');
  void box.offsetWidth; // relance l'animation CSS
  box.classList.add(diff > 0 ? 'up' : 'down');
  cancelAnimationFrame(raf);
  if (reducedMotion()) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), D = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / D);
    el.textContent = fmt(from + diff * (1 - Math.pow(1 - k, 3)));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function floatDelta(anchor, diff) {
  const f = document.createElement('span');
  f.className = `float-delta ${diff > 0 ? 'pos' : 'neg'}`;
  f.textContent = `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`;
  anchor.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}

// ---------- Sélection d'un pari ----------
// Rejoue une animation CSS même si la classe était déjà là.
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Où se trouve le panier à l'écran : barre du bas (mobile) ou panneau de droite (ordinateur).
function slipTarget() {
  const candidates = [
    document.querySelector('#aside .slip-head h2'),
    document.querySelector('.slipbar .slipbar-count'),
    document.querySelector('#nav-bottom a[href="#panier"] .nav-icon'),
    document.querySelector('#nav-top a[href="#panier"] .nav-icon'),
  ];
  return candidates.find((el) => el && el.getClientRects().length && el.getBoundingClientRect().width > 0) || null;
}

// Une pastille avec la cote part du bouton et file vers le panier en arc de cercle.
export function flyToSlip(fromRect, label) {
  const target = slipTarget();
  if (!target || !fromRect || reducedMotion()) { if (target) replay(target, 'bump'); return; }
  const to = target.getBoundingClientRect();
  const chip = document.createElement('span');
  chip.className = 'fly-chip';
  chip.textContent = label;
  document.body.appendChild(chip);
  const w = chip.offsetWidth, h = chip.offsetHeight;
  const x0 = fromRect.left + fromRect.width / 2 - w / 2, y0 = fromRect.top + fromRect.height / 2 - h / 2;
  const x1 = to.left + to.width / 2 - w / 2, y1 = to.top + to.height / 2 - h / 2;
  const peak = Math.min(y0, y1) - 70;
  const anim = chip.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
    { transform: `translate(${(x0 + x1) / 2}px, ${peak}px) scale(1.15) rotate(-6deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${x1}px, ${y1}px) scale(0.45)`, opacity: 0.6 },
  ], { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' });
  anim.onfinish = () => {
    chip.remove();
    replay(target, 'bump');
    replay(target.closest('.slipbar'), 'bump');
  };
}

// Pari validé : petit ticket tamponné au centre de l'écran.
export function betStamp({ count = 1, combo = false } = {}) {
  if (reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'bet-stamp';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <small>${combo ? 'Combiné' : count > 1 ? `${count} paris` : 'Pari'}</small>
    <strong>Ticket envoyé</strong>
    <span class="stamp">Validé</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// ---------- Toasts ----------
export function toast(message, type = 'info') {
  let wrap = document.getElementById('toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, type === 'error' ? 3800 : 3200);
}

// ---------- Confettis ----------
export function confetti({ colors = ['#ff6b1a', '#ffffff', '#5aa8ff', '#ffc83d', '#1c335f'], count = 150, originY = 0.3 } = {}) {
  if (reducedMotion()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + rand(-40, 40), y: H * originY,
    vx: rand(-8, 8), vy: rand(-14, -4), g: rand(0.25, 0.42),
    s: rand(6, 11), r: rand(0, 6.28), vr: rand(-0.3, 0.3),
    c: pick(colors), round: Math.random() < 0.3,
  }));
  const t0 = performance.now(), D = 2600;
  const frame = (t) => {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - el / D);
    for (const q of parts) {
      q.vy += q.g; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.r += q.vr;
      ctx.save();
      ctx.translate(q.x, q.y); ctx.rotate(q.r); ctx.fillStyle = q.c;
      if (q.round) { ctx.beginPath(); ctx.arc(0, 0, q.s / 2.4, 0, 6.28); ctx.fill(); }
      else ctx.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2);
      ctx.restore();
    }
    if (el < D) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- Badges ----------
const badgeQueue = [];
let badgeOpen = false;

function showNextBadge() {
  const id = badgeQueue.shift();
  if (!id) { badgeOpen = false; return; }
  const b = BADGES.find((x) => x.id === id);
  if (!b) { showNextBadge(); return; }
  badgeOpen = true;
  const ov = document.createElement('div');
  ov.className = 'badge-overlay';
  ov.innerHTML = `
    <div class="badge-pop" role="dialog" aria-modal="true" aria-labelledby="badge-pop-title">
      <div class="badge-rays"></div>
      <div class="badge-pop-icon">${icons[b.icon] || ""}</div>
      <p class="eyebrow">Badge débloqué !</p>
      <h2 id="badge-pop-title">${escapeHtml(b.name)}</h2>
      <p class="muted">${escapeHtml(b.desc)}</p>
      <button class="btn btn-primary" type="button">Continuer</button>
    </div>`;
  document.body.appendChild(ov);
  const close = () => {
    ov.classList.add('out');
    setTimeout(() => { ov.remove(); setTimeout(showNextBadge, 150); }, 250);
  };
  ov.querySelector('button').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('button').focus();
  confetti({ colors: ['#ff6b1a', '#ffffff', '#ffc83d', '#5aa8ff'], originY: 0.4 });
}

function queueBadge(id) {
  badgeQueue.push(id);
  if (!badgeOpen) showNextBadge();
}

// ---------- Boîte de réception du joueur ----------
// Les services déposent des événements dans player.inbox ; l'UI les affiche ici.
export function processInbox(player) {
  if (!player.inbox?.length) return;
  const items = player.inbox.slice();
  update((s) => { s.players[player.id].inbox = []; }, { silent: true });
  notifyInbox(items);

  const wins = items.filter((i) => i.type === 'win');
  const losses = items.filter((i) => i.type === 'loss');

  for (const i of items.filter((x) => x.type === 'welcome')) {
    toast(`Bienvenue ! ${fmt(i.amount)} Goalz offerts pour commencer.`, 'win');
  }
  for (const i of items.filter((x) => x.type === 'bonus')) {
    toast(`Bonus du jour : +${fmt(i.amount)} Goalz`, 'win');
    confetti({ colors: ['#ffc83d', '#e79a00', '#fff3c4'], count: 70, originY: 0.12 });
  }
  if (wins.length) {
    const total = wins.reduce((s, w) => s + w.amount, 0);
    toast(wins.length === 1
      ? `Pari gagné : ${wins[0].label} · +${fmt(total)} Goalz`
      : `${wins.length} paris gagnés · +${fmt(total)} Goalz`, 'win');
    confetti();
  }
  if (losses.length) {
    toast(losses.length === 1
      ? `Pari perdu : ${losses[0].label}. La prochaine sera la bonne !`
      : `${losses.length} paris perdus… la prochaine sera la bonne !`, 'loss');
  }
  for (const i of items.filter((x) => x.type === 'void')) {
    toast(`Pari remboursé (+${fmt(i.amount)}) : ${i.label}`, 'info');
  }
  for (const i of items.filter((x) => x.type === 'info')) toast(i.text, 'info');
  for (const i of items.filter((x) => x.type === 'badge')) queueBadge(i.id);
}

