// Délégation d'événements : les boutons portent data-action, les formulaires data-form.
import { resetAll, update } from '../store.js';
import { claimBonus, login, logout, register } from '../services/players.js';
import { clearSlip, placeSlip, quickStake, removeSelection, setSlipMode, setStake, toggleSelection } from '../services/bets.js';
import { fastForward, refreshReal } from '../services/matches.js';
import { createLeague, joinLeague, leaveLeague } from '../services/leagues.js';
import { go, render } from './app.js';
import { toast } from './effects.js';
import { confirmDialog } from './dialog.js';
import { refreshSlipNumbers } from './screens/slip.js';
import { ui } from './uiState.js';
import { CONFIG } from '../config.js';
import { cloud, resetPassword, signInWithEmail, signInWithGoogle, signOutCloud } from '../services/cloud.js';

const actions = {
  login: (el) => login(el.dataset.id),
  logout: () => logout(),
  go: (el) => go(el.dataset.route),

  'claim-bonus': () => claimBonus(),

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
    toggleSelection(el.dataset.match, el.dataset.outcome);
    document.querySelector('.slipbar')?.classList.add('bump');
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
  'slip-quick': (el) => quickStake(el.dataset.match, el.dataset.amount),
  'slip-place': () => {
    const n = placeSlip();
    toast(n > 1 ? `${n} paris validés. Bonne chance !` : 'Pari validé. Bonne chance !', 'success');
  },

  'bets-tab': (el) => { ui.betsTab = el.dataset.tab; render(); },
  'fast-forward': async () => {
    await fastForward();
    toast(`⏩ +${CONFIG.FAST_FORWARD_MIN} minutes pour les matchs éclair`, 'info');
  },

  'rank-tab': (el) => { ui.rankTab = el.dataset.tab; render(); },
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
