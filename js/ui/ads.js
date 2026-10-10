// Emplacements publicitaires. Ils sont posés une seule fois dans la coque de l'appli (sous l'en-tête,
// au-dessus du panier, en bas de page) et jamais dans les écrans : ceux-ci sont redessinés à chaque
// mise à jour, une annonce placée dedans serait rechargée en boucle (interdit par les régies).
import { CONFIG } from '../config.js';
import { escapeHtml } from '../util.js';

// Formats standards : petit emplacement, puis grand dès que l'emplacement fait 728 px de large.
// Bannière et pavé ont une taille fixe (rien ne bouge quand l'annonce arrive) ; le bas de page s'adapte.
const FORMATS = {
  top: { sm: [320, 50], lg: [728, 90] },
  side: { sm: [300, 250], lg: [300, 250] },
  bottom: { sm: [300, 250], lg: [728, 90], responsive: true },
};

const settings = () => CONFIG.ADS || {};
// Vraies annonces seulement sur le site validé par la régie ; ailleurs (local, miroir) : les encarts.
const isLive = (id) => {
  const { client, slots, hosts = [] } = settings();
  return Boolean(client && slots?.[id] && hosts.includes(location.hostname));
};

function placeholder(id) {
  const { sm, lg } = FORMATS[id];
  const { contact } = settings();
  const body = `
      <strong>Espace publicitaire</strong>
      <small class="ad-size-sm">${sm[0]} × ${sm[1]}</small>
      <small class="ad-size-lg">${lg[0]} × ${lg[1]}</small>`;
  if (!contact) return `<div class="ad-ph">${body}</div>`;
  const newTab = !/^mailto:/i.test(contact);
  return `<a class="ad-ph" href="${escapeHtml(contact)}"${newTab ? ' target="_blank" rel="noopener"' : ''}
    aria-label="Annoncer sur Goalzz${newTab ? ' (nouvel onglet)' : ''}">${body}</a>`;
}

// HTML d'un emplacement ('' si les pubs sont désactivées).
export function adSlot(id) {
  if (!settings().enabled || !FORMATS[id]) return '';
  const live = isLive(id);
  return `
    <div class="ad ad-${id}${live ? ' ad-live' : ''}">
      <span class="ad-label">Publicité</span>
      <div class="ad-box"${live ? ` data-ad-unit="${id}"` : ''}>${live ? '' : placeholder(id)}</div>
    </div>`;
}

let ready = null;
function loadAdSense() {
  if (ready) return ready;
  // Public dès 15 ans : on demande des annonces non personnalisées.
  if (!settings().personalized) (window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = 1;
  ready = new Promise((resolve) => {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(settings().client)}`;
    s.onload = resolve;
    // Bloqueur de pub : on replie les emplacements au lieu de laisser des cadres vides.
    s.onerror = () => document.documentElement.classList.add('no-ads');
    document.head.appendChild(s);
  });
  return ready;
}

// La régie remplit, dans l'ordre de la page, les blocs pas encore traités : un bloc n'est donc créé
// qu'une fois la régie chargée et son emplacement affiché (le pavé n'existe que sur grand écran).
// Un bloc caché passerait devant les autres et resterait vide faute de largeur.
function fill(box) {
  if (box.dataset.filled) return;
  box.dataset.filled = '1';
  const { client, slots } = settings();
  const id = box.dataset.adUnit;
  const sizing = FORMATS[id].responsive ? ' data-ad-format="auto" data-full-width-responsive="true"' : '';
  box.innerHTML = `<ins class="adsbygoogle" data-ad-client="${escapeHtml(client)}" data-ad-slot="${escapeHtml(slots[id])}"${sizing}></ins>`;
  try { window.adsbygoogle.push({}); } catch { /* emplacement refusé par la régie */ }
  // Ni servie ni refusée après quelques secondes : bloqueur qui laisse passer le script.
  setTimeout(() => {
    if (!box.querySelector('ins[data-ad-status]')) box.closest('.ad')?.classList.add('ad-empty');
  }, 6000);
}

const watcher = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const { target: box, contentRect } of entries) {
      if (!contentRect.width) continue;
      watcher.unobserve(box);
      // Toujours affiché une fois la régie chargée ? Sinon on attend qu'il réapparaisse.
      loadAdSense().then(() => {
        if (!box.isConnected) return;
        if (box.offsetWidth) fill(box);
        else watcher.observe(box);
      });
    }
  })
  : null;

// À appeler une fois après avoir posé la coque.
export function mountAds(scope) {
  watcher?.disconnect(); // emplacements d'une coque précédente (déconnexion du joueur)
  const boxes = scope.querySelectorAll('[data-ad-unit]:not([data-filled])');
  if (!boxes.length) return;
  loadAdSense();
  boxes.forEach((box) => (watcher ? watcher.observe(box) : loadAdSense().then(() => fill(box))));
}
