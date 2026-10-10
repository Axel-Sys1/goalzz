// Compte en ligne, facultatif : connexion par email + mot de passe (ou compte Google) et
// sauvegarde de la partie dans Firebase, pour la retrouver sur un autre appareil.
// Pas de connexion par lien email : le plan gratuit de Firebase n'en envoie que 5 par jour.
// Inactif tant que CONFIG.FIREBASE n'est pas rempli : l'appli reste alors 100 % locale.
//
// Stockage : un document Firestore par compte, users/<uid> = { data: <JSON>, savedAt }, lisible
// par son seul propriétaire ; et une fiche publique leaderboard/<uid> = { pseudo, rr, balance,
// updatedAt }, lisible par tous les joueurs connectés, pour le classement par division.
// Ligues privées en ligne : leagues/<CODE> = { code, name, ownerUid, members: [uid], createdAt } ;
// chacun ne peut que s'y ajouter ou s'en retirer lui-même.
// Pseudos uniques : pseudos/<pseudo en minuscules> = { uid, pseudo } réserve un pseudo pour un
// compte ; les règles Firestore refusent une fiche de classement dont le pseudo est à quelqu'un d'autre.
import { CONFIG } from '../config.js';
import { emit, getState, onSave, replaceState, resetAll } from '../store.js';
import { playerRR, betRR, LOSS_RR, RR_PER_DIVISION, TIERS, IMMORTAL_RR, RADIANT_SPOTS } from './ranks.js';
import { leagueCode } from '../util.js';
import { isOffensivePseudo } from './moderation.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const EMAIL_KEY = 'goalz:emailForSignIn';
// Au plus une sauvegarde en ligne toutes les 30 s (et à la fermeture de la page) : le plan
// gratuit de Firebase autorise 20 000 écritures par jour pour tout le site.
const PUSH_INTERVAL_MS = 30_000;
const KEEP_SETTLED_BETS = 200; // paris réglés gardés dans la sauvegarde en ligne, par joueur
const MAX_DOC_CHARS = 900_000; // un document Firestore est limité à 1 Mo

export const cloud = {
  enabled: !!CONFIG.FIREBASE?.apiKey,
  ready: false,       // l'état de connexion est connu
  user: null,         // { uid, email } une fois connecté
  mode: 'login',      // formulaire : 'login' (se connecter) ou 'signup' (créer un compte)
  division: null,     // { index, rows: [{ uid, pseudo, rr, balance }], radiant: Set<uid>, at, loading, error }
  pseudoConflict: null, // pseudo du joueur actuel à changer : déjà réservé par un autre compte…
  pseudoBanned: false,  // … ou refusé par le filtre de pseudos
  leagues: null,      // { list: [{ code, name, ownerUid, members, rows }], at, loading, error }
};

const LEAGUES_TTL_MS = 5 * 60_000;
export const LEAGUE_MAX_MEMBERS = 50;

const pseudoKey = (pseudo) => String(pseudo).trim().toLowerCase();
const ownedPseudos = new Set(); // pseudos (clés) déjà vérifiés comme appartenant à ce compte

const DIVISION_TTL_MS = 5 * 60_000; // classements rechargés au plus toutes les 5 min (quota de lectures)
const DIVISION_LIMIT = 50;
const LAST_DIVISION = TIERS.length * 3 - 1;
export const divisionIndex = (rr) => Math.min(LAST_DIVISION, Math.floor(rr / RR_PER_DIVISION));
let lastBoard = '';

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
// Ce qui est sauvegardé en ligne : la partie sans ce qui change tout seul (joueurs simulés,
// scores en direct), sans les matchs inutiles, et seulement les KEEP_SETTLED_BETS derniers paris
// réglés de chaque joueur. Les RR des paris retirés sont résumés dans player.rrBase / rrBaseAt.
function snapshot(s) {
  const players = {};
  const bets = {};
  for (const p of Object.values(s.players)) {
    const mine = Object.values(s.bets).filter((b) => b.playerId === p.id);
    const settled = mine.filter((b) => b.status !== 'pending').sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
    let cut = Math.max(0, settled.length - KEEP_SETTLED_BETS);
    // Ne pas couper entre deux paris réglés au même instant (rrBaseAt doit les séparer nettement).
    while (cut > 0 && (settled[cut - 1].settledAt || 0) === (settled[cut]?.settledAt ?? -1)) cut -= 1;
    const dropped = settled.slice(0, cut);
    const kept = new Set([...mine.filter((b) => b.status === 'pending'), ...settled.slice(dropped.length)].map((b) => b.id));
    for (const b of mine) if (kept.has(b.id)) bets[b.id] = b;
    players[p.id] = dropped.length
      ? { ...p, inbox: [], rrBase: rrAfter(p, dropped), rrBaseAt: dropped[dropped.length - 1].settledAt || 0 }
      : { ...p, inbox: [] };
  }
  const keep = new Set();
  for (const b of Object.values(bets)) {
    keep.add(b.matchId);
    (b.legs || []).forEach((l) => keep.add(l.matchId));
  }
  for (const p of Object.values(s.players)) (p.slip || []).forEach((x) => keep.add(x.matchId));
  const matches = {};
  for (const id of keep) {
    const m = s.matches[id];
    if (m) matches[id] = { ...m, liveScore: null, clock: null };
  }
  const { bots, botsSimAt, ...rest } = s;
  return { ...rest, players, bets, matches };
}

// RR d'un joueur après une liste de paris réglés (même calcul que ranks.playerRR).
function rrAfter(p, settledBets) {
  const since = p.rrBaseAt || 0;
  let rr = p.rrBase || 0;
  for (const b of settledBets) {
    if ((b.settledAt || 0) <= since || (b.status !== 'won' && b.status !== 'lost')) continue;
    rr = Math.max(0, rr + betRR(b));
  }
  return rr;
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

let lastPushAt = 0;

function schedulePush() {
  if (!cloud.user || pulling || pushTimer) return;
  pushTimer = setTimeout(push, Math.max(2000, PUSH_INTERVAL_MS - (Date.now() - lastPushAt)));
}

async function push() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!cloud.user || !fb) return;
  lastPushAt = Date.now();
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
  await publishRank();
}

// Fiche publique du joueur actuel de ce compte, pour le classement par division.
function myEntry(s = getState()) {
  const p = s.players[s.currentPlayerId];
  if (!p || !cloud.user) return null;
  return { uid: cloud.user.uid, pseudo: p.pseudo, rr: playerRR(p.id, s), balance: Math.round(p.balance) };
}

// Le pseudo est-il libre (ou déjà à ce compte) ? Sans service en ligne, on ne peut pas vérifier.
export async function isPseudoAvailable(pseudo) {
  if (!cloud.enabled) return true;
  const { F, db } = await sdk();
  const snap = await F.getDoc(F.doc(db, 'pseudos', pseudoKey(pseudo)));
  return !snap.exists() || snap.data().uid === cloud.user?.uid;
}

// Réserve le pseudo pour ce compte. Renvoie false s'il appartient déjà à un autre joueur.
export async function claimPseudo(pseudo) {
  if (!cloud.user || !fb) return true;
  const key = pseudoKey(pseudo);
  if (ownedPseudos.has(key)) return true;
  const ref = fb.F.doc(fb.db, 'pseudos', key);
  const snap = await fb.F.getDoc(ref);
  if (snap.exists()) {
    if (snap.data().uid !== cloud.user.uid) return false;
  } else {
    try {
      await fb.F.setDoc(ref, { uid: cloud.user.uid, pseudo: String(pseudo).trim() });
    } catch (err) {
      // Réservé par quelqu'un d'autre entre-temps (les règles refusent d'écraser).
      const again = await fb.F.getDoc(ref);
      if (!again.exists() || again.data().uid !== cloud.user.uid) return false;
    }
  }
  ownedPseudos.add(key);
  return true;
}

async function publishRank() {
  const me = myEntry();
  if (!me || !fb) return;
  // Pseudo refusé par le filtre : on retire la fiche publique et on demande d'en changer.
  if (isOffensivePseudo(me.pseudo)) {
    if (cloud.pseudoConflict !== me.pseudo || !cloud.pseudoBanned) { cloud.pseudoConflict = me.pseudo; cloud.pseudoBanned = true; emit(); }
    if (lastBoard !== 'banned') {
      lastBoard = 'banned';
      fb.F.deleteDoc(fb.F.doc(fb.db, 'leaderboard', me.uid)).catch(() => {});
    }
    return;
  }
  let mine = false;
  try { mine = await claimPseudo(me.pseudo); } catch (err) { console.warn('Goalz : vérification du pseudo impossible', err); return; }
  const conflict = mine ? null : me.pseudo;
  if (conflict !== cloud.pseudoConflict || cloud.pseudoBanned) { cloud.pseudoConflict = conflict; cloud.pseudoBanned = false; emit(); }
  if (!mine) return;
  const key = JSON.stringify(me);
  if (key === lastBoard) return;
  lastBoard = key;
  try {
    await fb.F.setDoc(fb.F.doc(fb.db, 'leaderboard', me.uid),
      { pseudo: me.pseudo, rr: me.rr, balance: me.balance, updatedAt: fb.F.serverTimestamp() });
  } catch (err) {
    lastBoard = '';
    console.warn('Goalz : publication du rang impossible', err);
  }
}

// Joueurs de la même division que `rr` (ex. tous les Or 2), du meilleur au moins bon.
// Rechargé au plus toutes les 5 minutes, sauf `force`.
export async function loadDivision(rr, { force = false } = {}) {
  if (!cloud.user || !fb) return;
  const index = divisionIndex(rr);
  const d = cloud.division;
  if (d && d.index === index && !force && (d.loading || Date.now() - d.at < DIVISION_TTL_MS)) return;
  cloud.division = { index, rows: d?.index === index ? d.rows : [], radiant: d?.radiant || new Set(), at: Date.now(), loading: true, error: null };
  const { F, db } = fb;
  const col = F.collection(db, 'leaderboard');
  const low = index * RR_PER_DIVISION;
  const filters = [F.where('rr', '>=', low)];
  if (index < LAST_DIVISION) filters.push(F.where('rr', '<', low + RR_PER_DIVISION));
  try {
    const [snap, top] = await Promise.all([
      F.getDocs(F.query(col, ...filters, F.orderBy('rr', 'desc'), F.limit(DIVISION_LIMIT))),
      // Radiant : les meilleurs Immortels de tout le jeu.
      F.getDocs(F.query(col, F.where('rr', '>=', IMMORTAL_RR), F.orderBy('rr', 'desc'), F.limit(RADIANT_SPOTS))),
    ]);
    const rows = snap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    cloud.division = { index, rows, radiant: new Set(top.docs.map((doc) => doc.id)), at: Date.now(), loading: false, error: null };
  } catch (err) {
    console.warn('Goalz : classement de division indisponible', err);
    cloud.division = { ...cloud.division, loading: false, error: 'Classement indisponible pour le moment.' };
  }
  emit();
}

// Lignes de la division, avec le joueur actuel toujours à jour (même avant sa publication).
export function divisionRows() {
  const d = cloud.division;
  const me = myEntry();
  if (!d) return [];
  let rows = d.rows.filter((r) => r.uid !== me?.uid && !isOffensivePseudo(r.pseudo));
  if (me && divisionIndex(me.rr) === d.index) rows.push(me);
  return rows.sort((a, b) => b.rr - a.rr || b.balance - a.balance || String(a.pseudo).localeCompare(String(b.pseudo)));
}

const ERRORS = {
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  'auth/wrong-password': 'Email ou mot de passe incorrect.',
  'auth/user-not-found': 'Email ou mot de passe incorrect.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cet email : connecte-toi.',
  'auth/weak-password': 'Mot de passe trop court : 6 caractères minimum.',
  'auth/missing-password': 'Entre ton mot de passe.',
  'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/popup-blocked': 'Ton navigateur a bloqué la fenêtre Google. Autorise les pop-ups et réessaie.',
  'auth/quota-exceeded': 'Trop de demandes aujourd\'hui. Réessaie demain.',
  'auth/invalid-action-code': 'Ce lien a expiré ou a déjà servi.',
  'auth/expired-action-code': 'Ce lien a expiré.',
};
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);
const friendly = (err) => new Error(ERRORS[err?.code] || 'Connexion impossible pour le moment. Réessaie plus tard.');

function checkEmail(raw) {
  const email = String(raw || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
  return email;
}

// mode 'login' : compte existant · 'signup' : nouveau compte.
export async function signInWithEmail(rawEmail, password, mode = 'login') {
  const email = checkEmail(rawEmail);
  if (mode === 'signup' && String(password || '').length < 6) throw new Error('Mot de passe trop court : 6 caractères minimum.');
  const { auth, A } = await sdk();
  try {
    if (mode === 'signup') await A.createUserWithEmailAndPassword(auth, email, password);
    else await A.signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw friendly(err);
  }
}

export async function signInWithGoogle() {
  const { auth, A } = await sdk();
  try {
    await A.signInWithPopup(auth, new A.GoogleAuthProvider());
  } catch (err) {
    if (SILENT.has(err?.code)) return;
    throw friendly(err);
  }
}

// Mot de passe oublié : Firebase envoie un email de réinitialisation (quota limité sur le plan gratuit).
export async function resetPassword(rawEmail) {
  const email = checkEmail(rawEmail);
  const { auth, A } = await sdk();
  try {
    await A.sendPasswordResetEmail(auth, email, { url: location.origin + location.pathname });
  } catch (err) {
    throw friendly(err);
  }
  return email;
}

// ---------- Ligues privées en ligne ----------
function leagueRef(code) { return fb.F.doc(fb.db, 'leagues', code); }

function needAccount() {
  if (!cloud.user || !fb) throw new Error('Connecte-toi pour créer ou rejoindre une ligue avec tes amis.');
}

// Fiches de classement des membres (par paquets de 30, la limite d'une requête « in »).
async function memberRows(uids) {
  const { F, db } = fb;
  const rows = [];
  for (let i = 0; i < uids.length; i += 30) {
    const chunk = uids.slice(i, i + 30);
    const snap = await F.getDocs(F.query(F.collection(db, 'leaderboard'), F.where(F.documentId(), 'in', chunk)));
    snap.forEach((d) => rows.push({ uid: d.id, ...d.data() }));
  }
  const me = myEntry();
  const out = rows.filter((r) => r.uid !== me?.uid && !isOffensivePseudo(r.pseudo));
  if (me && uids.includes(me.uid)) out.push(me);
  return out.sort((a, b) => b.rr - a.rr || b.balance - a.balance);
}

// Mes ligues et le classement de chacune. Rechargé au plus toutes les 5 minutes, sauf `force`.
export async function loadMyLeagues({ force = false } = {}) {
  if (!cloud.user || !fb) return;
  const cur = cloud.leagues;
  if (cur && !force && (cur.loading || Date.now() - cur.at < LEAGUES_TTL_MS)) return;
  cloud.leagues = { list: cur?.list || [], at: Date.now(), loading: true, error: null };
  const { F, db } = fb;
  try {
    const snap = await F.getDocs(F.query(F.collection(db, 'leagues'), F.where('members', 'array-contains', cloud.user.uid)));
    const list = await Promise.all(snap.docs.map(async (d) => {
      const l = d.data();
      return { ...l, code: d.id, rows: await memberRows(l.members || []) };
    }));
    list.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    cloud.leagues = { list, at: Date.now(), loading: false, error: null };
  } catch (err) {
    console.warn('Goalz : ligues indisponibles', err);
    cloud.leagues = { ...cloud.leagues, loading: false, error: 'Ligues indisponibles pour le moment.' };
  }
  emit();
}

export async function createOnlineLeague(rawName) {
  needAccount();
  const name = String(rawName || '').trim();
  if (name.length < 3 || name.length > 24) throw new Error('Le nom de la ligue doit faire entre 3 et 24 caractères.');
  await publishRank(); // pour apparaître tout de suite dans le classement de la ligue
  const { F } = fb;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = leagueCode();
    try {
      // « create » seulement : les règles refusent d'écraser une ligue qui existe déjà.
      await F.setDoc(leagueRef(code), { code, name, ownerUid: cloud.user.uid, members: [cloud.user.uid], createdAt: F.serverTimestamp() });
      await loadMyLeagues({ force: true });
      return code;
    } catch (err) {
      if (err?.code !== 'permission-denied') throw new Error('Impossible de créer la ligue pour le moment.');
    }
  }
  throw new Error('Impossible de créer la ligue pour le moment.');
}

export async function joinOnlineLeague(rawCode) {
  needAccount();
  const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { F } = fb;
  const snap = await F.getDoc(leagueRef(code)).catch(() => null);
  if (!snap || !snap.exists()) throw new Error('Aucune ligue trouvée avec ce code.');
  const l = snap.data();
  if (l.members.includes(cloud.user.uid)) throw new Error('Tu fais déjà partie de cette ligue.');
  if (l.members.length >= LEAGUE_MAX_MEMBERS) throw new Error(`Cette ligue est complète (${LEAGUE_MAX_MEMBERS} joueurs).`);
  await publishRank();
  await F.updateDoc(leagueRef(code), { members: F.arrayUnion(cloud.user.uid) });
  await loadMyLeagues({ force: true });
  return l.name;
}

export async function leaveOnlineLeague(code) {
  needAccount();
  const { F } = fb;
  const snap = await F.getDoc(leagueRef(code));
  if (!snap.exists()) return;
  const l = snap.data();
  if (l.members.length <= 1) await F.deleteDoc(leagueRef(code));
  else await F.updateDoc(leagueRef(code), { members: F.arrayRemove(cloud.user.uid) });
  await loadMyLeagues({ force: true });
}

// Suppression du compte (droit à l'effacement) : ligues, pseudos, fiche publique, partie, compte.
// Firebase exige une connexion récente pour supprimer un compte : sinon on demande de se reconnecter
// avant d'effacer quoi que ce soit.
export async function deleteAccount() {
  needAccount();
  const { F, db, A, auth } = fb;
  const user = auth.currentUser;
  const lastLogin = Date.parse(user?.metadata?.lastSignInTime || 0);
  if (!user || Date.now() - lastLogin > 4 * 60_000) {
    await A.signOut(auth);
    cloud.user = null;
    throw new Error('Par sécurité, reconnecte-toi puis relance la suppression (Profil → Réglages).');
  }
  const uid = user.uid;
  clearTimeout(pushTimer);
  pushTimer = null;
  cloud.user = null; // plus aucune sauvegarde ne doit recréer les données pendant l'effacement
  const leagues = await F.getDocs(F.query(F.collection(db, 'leagues'), F.where('members', 'array-contains', uid)));
  for (const d of leagues.docs) {
    if ((d.data().members || []).length <= 1) await F.deleteDoc(d.ref);
    else await F.updateDoc(d.ref, { members: F.arrayRemove(uid) });
  }
  const pseudos = new Set([...ownedPseudos, ...Object.values(getState().players).map((p) => pseudoKey(p.pseudo))]);
  for (const key of pseudos) {
    const ref = F.doc(db, 'pseudos', key);
    const snap = await F.getDoc(ref).catch(() => null);
    if (snap?.exists() && snap.data().uid === uid) await F.deleteDoc(ref);
  }
  await F.deleteDoc(F.doc(db, 'leaderboard', uid)).catch(() => {});
  await F.deleteDoc(F.doc(db, 'users', uid));
  await user.delete();
  cloud.division = null;
  cloud.leagues = null;
  cloud.pseudoConflict = null;
  cloud.pseudoBanned = false;
  ownedPseudos.clear();
  lastBoard = '';
  resetAll();
}

export async function signOutCloud() {
  if (!fb || !cloud.user) return;
  await push();
  await fb.A.signOut(fb.auth);
  cloud.user = null; // avant resetAll : la partie vide ne doit pas écraser celle du compte
  cloud.division = null;
  cloud.pseudoConflict = null;
  cloud.pseudoBanned = false;
  cloud.leagues = null;
  ownedPseudos.clear();
  lastBoard = '';
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
    cloud.enabled = false; // l'appli reste jouable, sans compte
    emit();
    return;
  }

  onSave(schedulePush);
  window.addEventListener('pagehide', push);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push(); });

  // Anciens liens de connexion envoyés par email (avant le passage au mot de passe).
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
    if (user) {
      try { await pull(cloud.user); } catch (err) { console.warn('Goalz : récupération de la partie impossible', err); }
    }
    emit();
  });
}
