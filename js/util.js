export const MIN = 60_000;

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
export const fmtOdds = (o) => o.toFixed(2);

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatKickoff(ts, now) {
  const diff = ts - now;
  if (diff <= 0) return 'En cours';
  if (diff < 10 * MIN) return `dans ${countdown(diff)}`;
  if (diff < 60 * MIN) return `dans ${Math.round(diff / MIN)} min`;
  const d = new Date(ts);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return todayKey(d) === todayKey(new Date(now))
    ? `Aujourd'hui ${hm}`
    : `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} ${hm}`;
}

export function leagueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => pick(chars)).join('');
}
