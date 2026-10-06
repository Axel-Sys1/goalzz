// Délégation d'événements : les boutons portent data-action, les formulaires data-form.
import { resetAll, update } from '../store.js';
import { claimBonus, currentPlayer, login, logout, register, renamePlayer } from '../services/players.js';
import { clearSlip, placeSlip, quickStake, removeSelection, setSlipMode, setStake, toggleSelection } from '../services/bets.js';
import { fastForward, refreshReal } from '../services/matches.js';
import { createLeague, joinLeague, leaveLeague } from '../services/leagues.js';
import { go, render } from './app.js';
import { betStamp, flyToSlip, replay, toast } from './effects.js';
import { getState } from '../store.js';
import { slipCheck } from '../services/bets.js';
import { confirmDialog } from './dialog.js';
import { refreshSlipNumbers } from './screens/slip.js';
import { ui } from './uiState.js';
import { CONFIG } from '../config.js';
import { cloud, loadDivision, resetPassword, signInWithEmail, signInWithGoogle, signOutCloud } from '../services/cloud.js';
import { playerRR } from '../services/ranks.js';

const actions = {
  login: (el) => login(el.dataset.id),
  logout: () => logout(),
  go: (el) => go(el.dataset.route),

  'claim-bonus': () => claimBonus(),

  'profile-tab': (el) => { ui.profileTab = el.dataset.tab === 'settings' ? 'settings' : 'stats'; render(); },
  'cloud-mode': (el) => { cloud.mode = el.dataset.mode === 'signup' ? 'signup' : 'login'; render(); },
  'cloud-google': () => signInWithGoogle(),
  'cloud-reset': async () => {
    const email = await resetPassword(document.getElementById('email-input')?.value);
    toast(`Si un compte existe pour ${email}, un email pour changer ton mot de passe vient de partir. Pense aux spams.`, 'info');
  },
  'cloud-logout': async () => {
    const ok = await confirmDialog({
      title: 'Se déconnecter ?',
      message: 'Ta partie reste sauvegardée sur ton compte. Elle sera retirée de cet appareil.',
      confirmLabel: 'Se déconnecter',
    });
    if (!ok) return;
    await signOutCloud();
    location.hash = '';
    location.reload();
  },

  pick: (el) => {
    const { match, outcome } = el.dataset;
    const from = el.getBoundingClientRect();
    const label = el.querySelector('.odd-val')?.textContent || '';
    toggleSelection(match, outcome);
    // L'écran vient d'être redessiné : on anime les nouveaux boutons.
    const picked = getState().players[getState().currentPlayerId]?.slip.some((x) => x.matchId === match && x.outcome === outcome);
    const sel = `[data-action="pick"][data-match="${CSS.escape(match)}"][data-outcome="${CSS.escape(outcome)}"]`;
    document.querySelectorAll(sel).forEach((b) => replay(b, picked ? 'just-picked' : 'just-unpicked'));
    if (picked) {
      flyToSlip(from, label);
      document.querySelectorAll(`[data-slip-item="${CSS.escape(match)}"]`).forEach((it) => replay(it, 'is-new'));
    }
  },
  'filter-sport': (el) => { ui.sport = el.dataset.sport; render(); },
  'filter-day': (el) => { ui.day = el.dataset.day; render(); },
  'set-mode': (el) => {
    ui.sport = 'all';
    update((s) => { s.prefs.mode = el.dataset.mode === 'fake' ? 'fake' : 'real'; });
  },
  'refresh-real': async () => {
    await refreshReal();
    toast('Vrais matchs actualisés', 'info');
  },

  'slip-remove': (el) => removeSelection(el.dataset.match),
  'slip-clear': () => clearSlip(),
  'slip-mode': (el) => setSlipMode(el.dataset.mode),
  'slip-quick': (el) => {
    quickStake(el.dataset.match, el.dataset.amount);
    document.querySelectorAll(`[data-stake="${CSS.escape(el.dataset.match)}"]`).forEach((i) => replay(i, 'bumped'));
  },
  'slip-place': async () => {
    const { error, combo } = slipCheck(getState());
    if (error) throw new Error(error);
    // Les sélections glissent hors du panier, puis le ticket est tamponné.
    const lists = document.querySelectorAll('.slip-items');
    lists.forEach((l) => l.classList.add('sending'));
    await new Promise((r) => setTimeout(r, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280));
    let n;
    try { n = placeSlip(); } finally { lists.forEach((l) => l.classList.remove('sending')); }
    betStamp({ count: n, combo });
    toast(combo ? 'Combiné validé. Bonne chance !' : n > 1 ? `${n} paris validés. Bonne chance !` : 'Pari validé. Bonne chance !', 'success');
  },

  'bets-tab': (el) => { ui.betsTab = el.dataset.tab; render(); },
  'fast-forward': async () => {
    await fastForward();
    toast(`+${CONFIG.FAST_FORWARD_MIN} minutes pour les matchs éclair`, 'info');
  },

  'rank-tab': (el) => { ui.rankTab = el.dataset.tab; render(); },
  'division-refresh': async () => {
    const s = getState();
    await loadDivision(playerRR(s.currentPlayerId, s), { force: true });
  },
  'league-leave': async (el) => {
    const ok = await confirmDialog({ title: 'Quitter cette ligue ?', message: 'Tu pourras la rejoindre à nouveau avec son code.', confirmLabel: 'Quitter', danger: true });
    if (ok) leaveLeague(el.dataset.code);
  },
  'copy-code': async (el) => {
    const code = el.dataset.code;
    try {
      await navigator.clipboard.writeText(code);
      toast(`Code ${code} copié ! Partage-le avec tes amis.`, 'success');
    } catch {
      toast(`Code de la ligue : ${code}`, 'info');
    }
  },

  'reset-app': async () => {
    const ok = await confirmDialog({
      title: 'Réinitialiser Goalz ?',
      message: 'Tous les joueurs, paris et ligues de cet appareil seront effacés.',
      confirmLabel: 'Tout effacer',
      danger: true,
    });
    if (!ok) return;
    resetAll();
    location.hash = '';
    location.reload();
  },
};

const forms = {
  register: (data) => register(data.get('pseudo')),
  rename: async (data, form) => {
    const free = cloud.pseudoConflict === currentPlayer()?.pseudo;
    const pseudo = String(data.get('pseudo') || '').trim();
    if (!free) {
      const ok = await confirmDialog({
        title: 'Changer de pseudo ?',
        message: `Ton pseudo deviendra « ${pseudo} » pour ${CONFIG.RENAME_COST.toLocaleString('fr-FR')} Goalz.`,
        confirmLabel: 'Payer et changer',
      });
      if (!ok) return;
    }
    await renamePlayer(pseudo, { free });
    cloud.pseudoConflict = null;
    form.reset();
    render();
    toast(free ? 'Pseudo changé !' : `Pseudo changé (−${CONFIG.RENAME_COST.toLocaleString('fr-FR')} Goalz)`, 'success');
  },
  'cloud-auth': async (data, form) => {
    const btn = form.querySelector('button[type="submit"]');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
    try {
      await signInWithEmail(data.get('email'), data.get('password'), cloud.mode);
      toast(cloud.mode === 'signup' ? 'Compte créé ! Ta partie est sauvegardée en ligne.' : 'Connecté ! Ta partie est récupérée.', 'success');
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  },

  'league-create': (data, form) => {
    const code = createLeague(data.get('name'));
    form.reset();
    toast(`Ligue créée ! Code à partager : ${code}`, 'success');
  },
  'league-join': (data, form) => {
    const name = joinLeague(data.get('code'));
    form.reset();
    toast(`Bienvenue dans « ${name} » !`, 'success');
  },
};

async function safely(fn) {
  try { await fn(); } catch (err) { toast(err.message || 'Oups, une erreur est survenue.', 'error'); }
}

export function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    safely(() => fn(el));
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = forms[form.dataset.form];
    if (fn) safely(() => fn(new FormData(form), form));
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-stake]')) {
      const clean = el.value.replace(/\D/g, '').slice(0, 7);
      if (clean !== el.value) el.value = clean;
      setStake(el.dataset.stake, clean === '' ? '' : Number(clean), { silent: true });
      refreshSlipNumbers();
    } else if (el.matches('.code-input')) {
      el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
  });
}
