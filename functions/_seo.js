// Données partagées des pages publiques : matchs à venir lus chez ESPN depuis le serveur, gardés
// 15 min dans le cache Cloudflare. Si ESPN ne répond pas, on ressert la dernière version connue
// (gardée 2 jours) plutôt qu'une page vide.
import { loadGroups, packGroups, unpackGroups } from '../js/seo/data.js';

const FRESH_S = 15 * 60;
const KEEP_S = 2 * 24 * 3600;
const KEY_FRESH = 'https://goalzz.fr/__seo/groups-v1';
const KEY_STALE = 'https://goalzz.fr/__seo/groups-v1-stale';

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return res.json();
}

const store = (cache, key, body, ttl) => cache.put(key, new Response(body, {
  headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
}));

export async function groups(waitUntil) {
  const cache = caches.default;
  const hit = await cache.match(KEY_FRESH);
  if (hit) return unpackGroups(await hit.json());
  try {
    const fresh = await loadGroups({ getJson, now: Date.now() });
    const total = fresh.reduce((n, g) => n + g.matches.length, 0);
    if (!total) throw new Error('aucun match lu');
    const body = JSON.stringify(packGroups(fresh));
    waitUntil(Promise.all([store(cache, KEY_FRESH, body, FRESH_S), store(cache, KEY_STALE, body, KEEP_S)]));
    return fresh;
  } catch (err) {
    const old = await cache.match(KEY_STALE);
    if (old) {
      // Matchs déjà commencés retirés de la vieille copie.
      const now = Date.now();
      return unpackGroups(await old.json()).map((g) => ({ ...g, matches: g.matches.filter((m) => m.startsAt > now) }));
    }
    throw err;
  }
}

export const html = (body, status = 200, maxAge = 600) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
  },
});
