// /pronos/<compétition> et /pronos/<compétition>/<équipes>-<id> : pages publiques lisibles par Google
// (HTML complet, sans JavaScript). /pronos seul est servi par index.js. Rendu dans js/seo/pages.js.
import { groups, html } from '../_seo.js';
import { leagueBySlug, renderGone, renderHub, renderLeague, renderMatch, eventId } from '../../js/seo/pages.js';

const SORRY = '<!doctype html><meta charset="utf-8"><title>Goalzz</title><p>Les pronostics sont momentanément indisponibles. <a href="/">Jouer sur Goalzz</a></p>';

export async function onRequestGet({ params, waitUntil }) {
  const parts = [].concat(params.path || []).filter(Boolean);
  if (parts.length > 2) return html(renderGone(null), 404);
  const league = parts[0] ? leagueBySlug(parts[0]) : null;
  if (parts[0] && !league) return html(renderGone(null), 404);

  let all;
  try {
    all = await groups(waitUntil);
  } catch {
    return new Response(SORRY, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600' } });
  }
  if (!league) return html(renderHub(all));

  const matches = all.find((g) => g.league.slug === league.slug)?.matches || [];
  if (parts.length === 1) return html(renderLeague(league, matches));

  const id = /-(\d+)$/.exec(parts[1])?.[1];
  const m = id && matches.find((x) => eventId(x) === id);
  if (!m) return html(renderGone(league), 404);
  return html(renderMatch(league, m, matches.filter((x) => x !== m)));
}
