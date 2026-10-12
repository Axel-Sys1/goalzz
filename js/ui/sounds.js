// Sons de l'appli, synthétisés avec Web Audio (aucun fichier à télécharger) : cote choisie, pari
// validé, pari gagné ou perdu, bonus. Coupables dans Profil → Réglages (préférence de l'appareil).
const PREF = 'goalz:sound';
let ctx = null;

const read = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
export const soundOn = () => read() !== 'off';
export function setSound(on) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* préférence non gardée */ }
  if (on) play('pick');
}

// Le navigateur n'autorise le son qu'après un geste du joueur : le contexte est créé au premier clic.
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => { if (soundOn()) audio(); }, { once: true, capture: true });
}

// Une note : fréquence (Hz), départ et durée (s), forme d'onde, volume, glissando éventuel.
function tone(a, { f, at = 0, d = 0.15, type = 'sine', v = 0.18, to = null }) {
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + d + 0.02);
}

// Bruit bref (impact du tampon).
function thump(a, { at = 0, d = 0.12, v = 0.35 }) {
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * d), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const g = a.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  g.gain.value = v;
  src.buffer = buf;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS = {
  pick: (a) => tone(a, { f: 660, to: 990, d: 0.08, type: 'triangle', v: 0.14 }),
  unpick: (a) => tone(a, { f: 660, to: 440, d: 0.08, type: 'triangle', v: 0.1 }),
  place: (a) => {
    thump(a, { d: 0.14, v: 0.45 });
    tone(a, { f: 523, at: 0.08, d: 0.12, type: 'square', v: 0.07 });
    tone(a, { f: 784, at: 0.16, d: 0.22, type: 'square', v: 0.07 });
  },
  win: (a) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(a, { f, at: i * 0.09, d: 0.22, type: 'triangle', v: 0.16 }));
    for (let i = 0; i < 7; i++) tone(a, { f: 1800 + (i % 3) * 350, at: 0.38 + i * 0.06, d: 0.09, type: 'sine', v: 0.07 });
  },
  loss: (a) => {
    tone(a, { f: 392, d: 0.2, type: 'triangle', v: 0.12 });
    tone(a, { f: 330, at: 0.18, d: 0.2, type: 'triangle', v: 0.12 });
    tone(a, { f: 262, at: 0.36, d: 0.35, type: 'triangle', v: 0.12, to: 247 });
  },
  bonus: (a) => [880, 1175, 1480].forEach((f, i) => tone(a, { f, at: i * 0.07, d: 0.18, type: 'sine', v: 0.13 })),
};

export function play(name) {
  if (!soundOn() || !SOUNDS[name]) return;
  if (document.hidden) return; // pas de son quand l'appli n'est pas à l'écran
  try {
    const a = audio();
    if (a) SOUNDS[name](a);
  } catch { /* son indisponible : on continue sans */ }
}
