// Service worker : rend Goalzz installable et utilisable hors ligne (dernière version vue).
// Réseau d'abord, sans le cache du navigateur (cache: 'no-cache' : chaque fichier est revérifié
// auprès du serveur), pour que chaque mise en ligne arrive tout de suite ; le cache ne sert que si le
// réseau ne répond pas. Les données sportives et Firebase ne sont jamais mises en cache ici.
const CACHE = 'goalz-v2';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/main.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

// Nouvelle version : on vide l'ancien cache et on recharge une fois les pages ouvertes, pour qu'elles
// prennent les nouveaux fichiers (ex. après des fichiers restés 4 h dans le cache du navigateur).
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((list) => Promise.all(list.map((c) => c.navigate(c.url).catch(() => null)))));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return;
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
  );
});
