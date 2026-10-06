// Relais Cloudflare (Pages Function) : /api/fetch?u=<adresse ESPN ou TheSportsDB>
// Tous les joueurs partagent les mêmes réponses mises en cache quelques minutes : les sources
// sportives reçoivent quelques requêtes par minute au total, au lieu de dizaines par visiteur.
const ALLOWED = new Set([
  'site.api.espn.com',
  'site.web.api.espn.com',
  'sports.core.api.espn.com',
  'www.thesportsdb.com',
]);

// Durée de cache (secondes) : courte pour les scores, plus longue pour les fiches et la boxe.
function ttlFor(url) {
  if (url.hostname === 'www.thesportsdb.com') return 600;
  if (url.hostname === 'sports.core.api.espn.com') return 300;
  return 60;
}

const json = (body, status, extra = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
});

export async function onRequestGet({ request, waitUntil }) {
  const self = new URL(request.url);
  let target;
  try { target = new URL(self.searchParams.get('u') || ''); } catch { return json('{"error":"bad url"}', 400); }
  if (!ALLOWED.has(target.hostname)) return json('{"error":"host not allowed"}', 403);
  target.protocol = 'https:';
  const ttl = ttlFor(target);

  const cache = caches.default;
  const key = new Request(`${self.origin}/api/fetch?u=${encodeURIComponent(target.toString())}`);
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('X-Goalz-Cache', 'HIT');
    return res;
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: ttl, cacheEverything: true },
    });
  } catch {
    return json('{"error":"upstream unreachable"}', 502, { 'Cache-Control': 'no-store' });
  }
  const body = await upstream.arrayBuffer();
  if (!upstream.ok) return json(body, upstream.status, { 'Cache-Control': 'no-store', 'X-Goalz-Cache': 'BYPASS' });

  const res = json(body, 200, { 'Cache-Control': `public, max-age=${ttl}`, 'X-Goalz-Cache': 'MISS' });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
