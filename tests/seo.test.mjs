// Tests des pages publiques /pronos (js/seo), sur des réponses ESPN réelles enregistrées.
// Lancer : /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/seo.test.mjs
globalThis.console ??= { warn: () => {}, log: print, error: print };

import { loadGroups, packGroups, unpackGroups } from '../js/seo/data.js';
import {
  LEAGUE_PAGES, leagueBySlug, matchPath, renderGone, renderHub, renderLeague, renderMatch, sitemapXml, slugify,
} from '../js/seo/pages.js';

const DIR = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, ''));
const load = (name) => JSON.parse(readFile(`${DIR}fixtures/team/${name}`));
const fail = (msg) => { throw new Error(msg); };
const ok = (cond, msg) => cond || fail(msg);
const eq = (a, b, msg) => (JSON.stringify(a) === JSON.stringify(b) ? true : fail(`${msg} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`));
async function test(name, fn) { await fn(); print(`PASS ${name}`); }

const ROUTES = [
  ['league=usa.1', 'header_soccer_usa.1_20260926-20261010.json'],
  ['league=nhl', 'header_hockey_nhl_20260926-20261003.json'],
];
const getJson = async (url) => {
  for (const [part, file] of ROUTES) if (url.includes(part)) return load(file);
  throw new Error(`HTTP 400 pour ${url}`);
};
const leagues = LEAGUE_PAGES.filter((l) => ['usa.1', 'nhl'].includes(l.league));
const NOW = Date.parse('2026-09-26T12:00:00Z');

await test('slugs', () => {
  eq(slugify('Paris Saint-Germain Olympique de Marseille'), 'paris-saint-germain-olympique-de-marseille', 'équipes');
  eq(slugify("Women's Super League (F)"), 'women-s-super-league-f', 'apostrophe');
  ok(leagueBySlug('ligue-1')?.league === 'fra.1', 'ligue-1');
  ok(leagueBySlug('ligue-des-champions')?.league === 'uefa.champions', 'LDC');
  ok(leagueBySlug('ligue-des-champions-feminine')?.league === 'uefa.wchampions', 'LDC F');
  eq(new Set(LEAGUE_PAGES.map((l) => l.slug)).size, LEAGUE_PAGES.length, 'slugs uniques');
});

let groups;
await test('chargement groupé par compétition', async () => {
  groups = await loadGroups({ getJson, now: NOW, leagues });
  eq(groups.map((g) => g.league.slug), ['mls', 'nhl'], 'ordre');
  for (const g of groups) {
    ok(g.matches.length > 0, `matchs ${g.league.slug}`);
    ok(g.matches.every((m) => m.status === 'scheduled' && m.startsAt > NOW), 'à venir seulement');
    ok(g.matches.every((m, i, a) => !i || a[i - 1].startsAt <= m.startsAt), 'triés');
  }
  eq(unpackGroups(JSON.parse(JSON.stringify(packGroups(groups)))).map((g) => g.matches.length), groups.map((g) => g.matches.length), 'cache aller-retour');
});

await test('pages HTML', () => {
  const [mls] = groups;
  const m = mls.matches[0];
  const hub = renderHub(groups);
  ok(hub.includes('href="/pronos/mls"') && hub.includes('<link rel="canonical" href="https://goalzz.fr/pronos">'), 'hub');
  const league = renderLeague(mls.league, mls.matches);
  ok(league.includes(`href="${matchPath(mls.league, m)}"`), 'lien match');
  ok(league.includes('<h1 class="seo-h1">Pronostics MLS'), 'titre ligue');
  const page = renderMatch(mls.league, m, mls.matches.slice(1));
  ok(page.includes('"@type":"SportsEvent"'), 'JSON-LD');
  ok(page.includes(`${m.home.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')} – `), 'équipes');
  ok(/de chances/.test(page) && /favori|serré/.test(page), 'analyse');
  ok(matchPath(mls.league, m).endsWith(`-${m.meta.eventId}`), 'id en fin de lien');
  ok(renderGone(mls.league).includes('noindex'), 'match passé non indexé');
  ok(!renderGone(mls.league).includes('canonical'), 'pas de canonical');
});

await test('plan du site', () => {
  const xml = sitemapXml(groups, NOW);
  const n = groups.reduce((s, g) => s + g.matches.length, 0);
  eq((xml.match(/<url>/g) || []).length, 3 + groups.length + n, 'nombre d\'adresses');
  ok(xml.includes('<loc>https://goalzz.fr/pronos/nhl</loc>'), 'ligue');
  ok(!/[<>&](?![a-z/!?#]|amp;)/.test(xml.replace(/<\/?[a-z?!][^>]*>/g, '')), 'XML propre');
});

print('ALL PASS');
