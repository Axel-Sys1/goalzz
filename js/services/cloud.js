// Compte en ligne, facultatif : connexion par un lien reçu par email (sans mot de passe) et
// sauvegarde de la partie dans Firebase, pour la retrouver sur un autre appareil.
// Inactif tant que CONFIG.FIREBASE n'est pas rempli : l'appli reste alors 100 % locale.
//
// Stockage : un document Firestore par compte, users/<uid> = { data: <JSON>, savedAt }.
// Règles Firestore attendues (chacun ne lit et n'écrit que son propre document) :
//   match /users/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }
import { CONFIG } from '../config.js';
import { emit, getState, onSave, replaceState, resetAll } from '../store.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const EMAIL_KEY = 'goalz:emailForSignIn';
const PUSH_DELAY_MS = 3000;
const MAX_DOC_CHARS = 900_000; // un document Firestore est limité à 1 Mo

export const cloud = {
  enabled: !!CONFIG.FIREBASE?.apiKey,
  ready: false,       // l'état de connexion est connu
  user: null,         // { uid, email } une fois connecté
  linkSentTo: null,   // email auquel le dernier lien a été envoyé
};

let fb = null;
let pushTimer = null;
let lastPushed = '';
let pulling = false;

async function sdk() {
  if (fb) return fb;
  const [app, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const firebaseApp = app.initializeApp(CONFIG.FIREBASE);
  const auth = A.getAuth(firebaseApp);
  auth.languageCode = 'fr';
  fb = { auth, db: F.getFirestore(firebaseApp), A, F };
  return fb;
}

const userDoc = () => fb.F.doc(fb.db, 'users', cloud.user.uid);

// Ce qu'on sauvegarde : tout, sauf les matchs sans pari ni place dans un panier
// (ils sont rechargés depuis les sources à chaque visite).
function snapshot(s) {
  const keep = new Set();
  for (const b of Object.values(s.bets)) {
    keep.add(b.matchId);
    (b.legs || []).forEach((l) => keep.add(l.matchId));
  }
  for (const p of Object.values(s.players)) (p.slip || []).forEach((x) => keep.add(x.matchId));
  const matches = {};
  for (const id of keep) if (s.matches[id]) matches[id] = s.matches[id];
  return { ...s, matches };
}

// Première connexion de cet appareil à ce compte : on garde la partie du compte et on y
// ajoute les joueurs créés ici avant de se connecter, pour ne rien perdre.
function merge(local, remote) {
  const players = { ...local.players, ...remote.players };
  return {
    ...local,
    ...remote,
    players,
    bets: { ...local.bets, ...remote.bets },
    leagues: { ...local.leagues, ...remote.leagues },
    matches: { ...remote.matches, ...local.matches }, // les matchs locaux sont plus frais
    bots: remote.bots || local.bots,
    currentPlayerId: players[remote.currentPlayerId] ? remote.currentPlayerId : local.currentPlayerId,
  };
}

async function pull(user) {
  pulling = true;
  try {
    const snap = await fb.F.getDoc(userDoc());
    const remote = snap.exists() ? JSON.parse(snap.data().data) : null;
    const local = getState();
    let next;
    if (local.cloudUid === user.uid) next = local;                       // déjà relié : l'appareil est à jour
    else if (local.cloudUid) next = remote || { players: {}, bets: {}, leagues: {}, currentPlayerId: null }; // autre compte
    else next = remote ? merge(local, remote) : local;
    replaceState({ ...next, matches: { ...next.matches, ...local.matches }, cloudUid: user.uid });
  } finally {
    pulling = false;
  }
  await push();
}

function schedulePush() {
  if (!cloud.user || pulling) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DELAY_MS);
}

async function push() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!cloud.user || !fb) return;
  const data = JSON.stringify(snapshot(getState()));
  if (data === lastPushed) return;
  if (data.length > MAX_DOC_CHARS) { console.warn('Goalz : partie trop volumineuse pour la sauvegarde en ligne.'); return; }
  lastPushed = data;
  try {
    await fb.F.setDoc(userDoc(), { data, savedAt: fb.F.serverTimestamp() });
  } catch (err) {
    lastPushed = '';
    console.warn('Goalz : sauvegarde en ligne impossible', err);
  }
}

const ERRORS = {
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/quota-exceeded': 'Trop de demandes de connexion aujourd\'hui. Réessaie plus tard.',
  'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/invalid-action-code': 'Ce lien de connexion a expiré ou a déjà servi. Demandes-en un nouveau.',
  'auth/expired-action-code': 'Ce lien de connexion a expiré. Demandes-en un nouveau.',
};
const friendly = (err) => new Error(ERRORS[err?.code] || 'Connexion impossible pour le moment. Réessaie plus tard.');

export async function sendLoginLink(rawEmail) {
  const email = String(rawEmail || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
  const { auth, A } = await sdk();
  try {
    await A.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
  } catch (err) {
    throw friendly(err);
  }
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* ignoré */ }
  cloud.linkSentTo = email;
  emit();
}

export async function signOutCloud() {
  if (!fb || !cloud.user) return;
  await push();
  await fb.A.signOut(fb.auth);
  cloud.user = null; // avant resetAll : la partie vide ne doit pas écraser celle du compte
  resetAll(); // la partie reste sur le compte ; on ne la laisse pas sur cet appareil
}

// À appeler au démarrage. `notify(message, type)` affiche un message à l'utilisateur.
export async function initCloud({ notify } = {}) {
  if (!cloud.enabled) return;
  let auth, A;
  try {
    ({ auth, A } = await sdk());
  } catch (err) {
    console.warn('Goalz : service de compte injoignable', err);
    return;
  }

  onSave(schedulePush);
  window.addEventListener('pagehide', push);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push(); });

  // Retour depuis le lien reçu par email.
  if (A.isSignInWithEmailLink(auth, location.href)) {
    let email = null;
    try { email = localStorage.getItem(EMAIL_KEY); } catch { /* ignoré */ }
    if (!email) email = window.prompt('Pour terminer la connexion, retape ton adresse email :');
    if (email) {
      try {
        await A.signInWithEmailLink(auth, email.trim(), location.href);
        try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignoré */ }
        notify?.('Connecté ! Ta partie est sauvegardée en ligne.', 'success');
      } catch (err) {
        notify?.(friendly(err).message, 'error');
      }
    }
    history.replaceState(null, '', location.pathname + location.hash);
  }

  A.onAuthStateChanged(auth, async (user) => {
    cloud.user = user ? { uid: user.uid, email: user.email } : null;
    cloud.ready = true;
    cloud.linkSentTo = null;
    if (user) {
      try { await pull(cloud.user); } catch (err) { console.warn('Goalz : récupération de la partie impossible', err); }
    }
    emit();
  });
}
