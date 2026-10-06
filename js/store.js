// État global de l'appli, persisté dans localStorage.
// Pour passer à un vrai serveur plus tard, c'est ce module (et les services)
// qu'il faudra faire parler à une API au lieu du navigateur.
import { CONFIG } from './config.js';

const listeners = new Set();
const saveListeners = new Set();

function initialState() {
  return {
    version: 3,
    players: {},          // joueurs humains de cet appareil
    currentPlayerId: null,
    matches: {},
    bets: {},
    leagues: {},
    bots: null,           // joueurs simulés pour animer le classement
    botsSimAt: null,      // dernière simulation des bots (heure réelle)
    clockOffset: 0,       // décalage de l'horloge des matchs fictifs (bouton "avancer le temps")
    prefs: { mode: 'real' }, // 'real' : vrais matchs · 'fake' : matchs éclair fictifs
    cloudUid: null,       // compte en ligne auquel cet appareil est relié (services/cloud.js)
  };
}

function migrate(s) {
  // v1 → v2 : les matchs fictifs portent désormais real: false.
  for (const m of Object.values(s.matches || {})) {
    if (m.real === undefined) m.real = false;
    if (m.status === 'upcoming') m.status = 'scheduled';
  }
  s.prefs = { ...initialState().prefs, ...(s.prefs || {}) };
  // v2 → v3 : les combats MMA ont un nouvel id (combat + combattants). Les anciens non réglés,
  // sans pari ni place dans un panier, sont retirés (ils réapparaissent sous le nouvel id).
  if ((s.version || 1) < 3) {
    const used = new Set(Object.values(s.bets || {}).map((b) => b.matchId));
    for (const pl of Object.values(s.players || {})) (pl.slip || []).forEach((x) => used.add(x.matchId));
    for (const [id, m] of Object.entries(s.matches || {})) {
      const legacy = m.sport === 'mma' && id.startsWith('espn:mma:') && !id.split(':').pop().includes('_');
      if (legacy && !used.has(id) && m.status !== 'finished' && m.status !== 'void') delete s.matches[id];
    }
  }
  s.version = 3;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) return migrate({ ...initialState(), ...JSON.parse(raw) });
  } catch { /* stockage indisponible ou corrompu : on repart de zéro */ }
  return initialState();
}

let state = load();

function save() {
  try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state)); } catch { /* ignoré */ }
  saveListeners.forEach((fn) => fn(state));
}

// Prévient à chaque sauvegarde, même silencieuse (utilisé par la sauvegarde en ligne).
export function onSave(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

// Remplace tout l'état (ex. partie récupérée depuis le compte en ligne).
export function replaceState(next) {
  state = migrate({ ...initialState(), ...next });
  save();
  emit();
}

export const getState = () => state;

// Prévient l'UI sans modifier l'état (ex. fin d'un chargement réseau).
export function emit() {
  listeners.forEach((fn) => fn(state));
}

// Applique une mutation, sauvegarde, puis prévient l'UI (sauf si silent).
export function update(mutator, { silent = false } = {}) {
  const result = mutator(state);
  save();
  if (!silent) emit();
  return result;
}

// Un autre onglet a enregistré : on recharge son état au lieu de l'écraser au prochain save().
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CONFIG.STORAGE_KEY || !e.newValue) return;
    try {
      state = migrate({ ...initialState(), ...JSON.parse(e.newValue) });
      emit();
    } catch { /* ignoré */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetAll() {
  state = initialState();
  save();
  emit();
}

// Horloge des matchs fictifs : l'heure réelle + le décalage simulé.
export const now = () => Date.now() + (state.clockOffset || 0);

// Horloge des vrais matchs : on ne peut pas accélérer la réalité.
export const realNow = () => Date.now();

// L'horloge qui s'applique à un match donné.
export const clockFor = (m) => (m && m.real ? realNow() : now());
