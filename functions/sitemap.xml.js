// Plan du site, mis à jour tout seul : pages fixes, compétitions et matchs à venir (/pronos).
import { groups } from './_seo.js';
import { sitemapXml } from '../js/seo/pages.js';

export async function onRequestGet({ waitUntil }) {
  let all = [];
  try { all = await groups(waitUntil); } catch { /* ESPN injoignable : pages fixes seulement */ }
  return new Response(sitemapXml(all), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
