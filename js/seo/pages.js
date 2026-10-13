// Pages publiques de pronostics, rendues côté serveur (Cloudflare Pages Functions) pour que Google
// les lise sans JavaScript : /pronos (compétitions), /pronos/<compétition> (prochains matchs et
// cotes), /pronos/<compétition>/<équipes>-<id> (un match). Fonctions pures : données en entrée, HTML
// en sortie ; le chargement des matchs est dans seo/data.js.
import { LEAGUES } from '../providers/espn/teamSports.js';
import { sportMeta } from '../sports.js';
import { devig } from '../providers/odds.js';

export const SITE = 'https://goalzz.fr';

export const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/&/g, 'et').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Compétitions avec une page : celles des sports collectifs suivis par l'appli.
export const LEAGUE_PAGES = LEAGUES.map((cfg) => ({ ...cfg, slug: slugify(cfg.name.replace(/\(F\)/, 'feminine')) }));
export const leagueBySlug = (slug) => LEAGUE_PAGES.find((l) => l.slug === slug) || null;

export const eventId = (m) => String(m.meta?.eventId || m.id.split(':').pop());
export const matchPath = (league, m) => `/pronos/${league.slug}/${slugify(`${m.home.name} ${m.away.name}`)}-${eventId(m)}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const odds2 = (o) => (o ? o.toFixed(2).replace('.', ',') : '–');
const pct = (p) => `${Math.round(p * 100)} %`;
const TZ = 'Europe/Paris';
const dateLong = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dateShort = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short' });
const hour = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

const LABEL = (m, o) => (o === 'X' ? 'Match nul' : o === '1' ? m.home.name : m.away.name);

// Lecture des cotes : probabilités sans marge, favori et phrase d'analyse.
export function analysis(m) {
  const probs = devig(m.odds) || {};
  const outcomes = Object.keys(m.odds).sort((a, b) => ({ 1: 0, X: 1, 2: 2 }[a] - { 1: 0, X: 1, 2: 2 }[b]));
  const fav = outcomes.filter((o) => o !== 'X').sort((a, b) => (probs[b] || 0) - (probs[a] || 0))[0];
  const gap = Math.abs((probs['1'] || 0) - (probs['2'] || 0));
  let verdict;
  if (gap < 0.08) verdict = `Match très serré : les cotes ne départagent presque pas ${m.home.name} et ${m.away.name}.`;
  else if (probs[fav] > 0.6) verdict = `${LABEL(m, fav)} part grand favori (${pct(probs[fav])} de chances selon les cotes).`;
  else verdict = `${LABEL(m, fav)} est légèrement favori (${pct(probs[fav])} de chances selon les cotes).`;
  if (probs.X > 0.28) verdict += ' Le match nul est une vraie option.';
  return { probs, outcomes, fav, verdict };
}

function layout({ title, description, path, body, jsonLd = null, noindex = false }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#08122a">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE}${path}">`}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Goalzz">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${SITE}${path}">
  <meta property="og:image" content="${SITE}/icons/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;0,800;1,800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
  <header class="seo-top">
    <a class="logo" href="/" aria-label="Goalzz, jouer"><span>GOAL<b>ZZ</b></span></a>
    <a class="btn btn-primary" href="/">Jouer gratuitement</a>
  </header>
  <main class="seo-page">
${body}
    <section class="card seo-cta">
      <strong>Pronostique gratuitement sur Goalzz</strong>
      <span class="muted">Le jeu de pronos sportifs avec une monnaie 100 % virtuelle : cotes en direct, rangs de Fer à Radiant, défis du jour et ligues entre potes. Gratuit, sans argent réel.</span>
      <a class="btn btn-primary btn-lg" href="/">Je joue maintenant</a>
    </section>
    <footer class="seo-foot">
      <a href="/pronos">Tous les pronostics</a> · <a href="/">Jouer</a> · <a href="/legal">Mentions légales</a>
      <p class="muted">Jeu gratuit, sans argent réel. Les cotes sont indicatives (bookmakers via ESPN, ou estimées par Goalzz) et ne sont pas des conseils de pari.</p>
    </footer>
  </main>
</body>
</html>`;
}

const crumbs = (items) => `
    <nav class="seo-crumbs" aria-label="Fil d'Ariane">${items.map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(' › ')}</nav>`;

function oddsRow(m) {
  const { outcomes, probs } = analysis(m);
  return `<span class="seo-odds">${outcomes.map((o) => `<span><small>${o === 'X' ? 'N' : o}</small><b>${odds2(m.odds[o])}</b><i>${probs[o] ? pct(probs[o]) : ''}</i></span>`).join('')}</span>`;
}

function matchRow(league, m) {
  return `
      <li class="seo-match">
        <a href="${matchPath(league, m)}">
          <span class="seo-when">${esc(dateShort(m.startsAt))} · ${esc(hour(m.startsAt))}</span>
          <span class="seo-teams"><b>${esc(m.home.name)}</b> – <b>${esc(m.away.name)}</b></span>
          ${oddsRow(m)}
        </a>
      </li>`;
}

// /pronos : toutes les compétitions qui ont des matchs à venir.
export function renderHub(groups) {
  const list = groups.filter((g) => g.matches.length);
  const body = `${crumbs([['Goalzz', '/'], ['Pronostics', null]])}
    <h1 class="seo-h1">Pronostics et cotes des prochains matchs</h1>
    <p class="seo-lead">Les cotes et les favoris de tous les matchs à venir : football (Ligue 1, Premier League, Ligue des champions…), NBA, NHL, NFL et rugby. Choisis une compétition pour voir les affiches de la semaine.</p>
    <div class="seo-grid">
      ${list.map((g) => `
      <a class="card seo-league" href="/pronos/${g.league.slug}">
        <span class="seo-league-name">${sportMeta(g.league.sport).icon} ${esc(g.league.name)}</span>
        <span class="muted">${g.matches.length} match${g.matches.length > 1 ? 's' : ''} à venir · prochain le ${esc(dateShort(g.matches[0].startsAt))}</span>
      </a>`).join('') || '<p class="muted">Aucun match à venir pour le moment.</p>'}
    </div>`;
  return layout({
    title: 'Pronostics et cotes des prochains matchs · Goalzz',
    description: 'Cotes, favoris et pronostics des prochains matchs de foot, NBA, NHL, NFL et rugby. Pronostique gratuitement avec une monnaie virtuelle sur Goalzz.',
    path: '/pronos', body,
  });
}

// /pronos/<compétition> : les prochains matchs, par jour.
export function renderLeague(league, matches) {
  const days = new Map();
  for (const m of matches) {
    const k = dateLong(m.startsAt);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(m);
  }
  const name = league.name;
  const body = `${crumbs([['Goalzz', '/'], ['Pronostics', '/pronos'], [name, null]])}
    <h1 class="seo-h1">Pronostics ${esc(name)} : cotes des prochains matchs</h1>
    <p class="seo-lead">Toutes les affiches de ${esc(name)} des 7 prochains jours avec leurs cotes 1N2 et les chances de victoire de chaque équipe. Clique sur un match pour l'analyse, puis pronostique-le gratuitement sur Goalzz.</p>
    ${[...days].map(([day, list]) => `
    <h2 class="seo-day">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</h2>
    <ul class="seo-matches">${list.map((m) => matchRow(league, m)).join('')}</ul>`).join('') || '<p class="muted">Pas de match prévu dans les 7 prochains jours. Reviens bientôt !</p>'}`;
  return layout({
    title: `Pronostics ${name} et cotes des prochains matchs · Goalzz`,
    description: `Cotes et pronostics ${name} : ${matches.slice(0, 3).map((m) => `${m.home.name} – ${m.away.name}`).join(', ') || 'les prochaines affiches'}. Pronostique gratuitement sur Goalzz.`,
    path: `/pronos/${league.slug}`, body,
  });
}

// /pronos/<compétition>/<équipes>-<id> : un match.
export function renderMatch(league, m, others = []) {
  const { outcomes, probs, verdict } = analysis(m);
  const title = `${m.home.name} – ${m.away.name} : cotes et pronostic (${league.name}, ${dateShort(m.startsAt)})`;
  const path = matchPath(league, m);
  const body = `${crumbs([['Goalzz', '/'], ['Pronostics', '/pronos'], [league.name, `/pronos/${league.slug}`], [`${m.home.name} – ${m.away.name}`, null]])}
    <h1 class="seo-h1">${esc(m.home.name)} – ${esc(m.away.name)} : cotes et pronostic</h1>
    <p class="seo-lead">${esc(league.name)}${m.round ? ` · ${esc(m.round)}` : ''} · ${esc(dateLong(m.startsAt))} à ${esc(hour(m.startsAt))}</p>
    <section class="card seo-match-card">
      <div class="seo-vs"><b>${esc(m.home.name)}</b><span>VS</span><b>${esc(m.away.name)}</b></div>
      ${m.home.record || m.away.record ? `<p class="muted seo-records">Bilans : ${esc(m.home.name)} ${esc(m.home.record || '–')} · ${esc(m.away.name)} ${esc(m.away.record || '–')}</p>` : ''}
      <div class="seo-odds-big">${outcomes.map((o) => `
        <div><small>${esc(LABEL(m, o))}</small><b>${odds2(m.odds[o])}</b><i>${probs[o] ? `${pct(probs[o])} de chances` : ''}</i></div>`).join('')}
      </div>
      <p class="seo-verdict">${esc(verdict)}</p>
      <p class="muted">${m.oddsSource === 'bookmaker' ? 'Cotes des bookmakers (via ESPN), ramenées à la marge Goalzz.' : 'Cotes estimées par Goalzz à partir des classements et bilans.'} Sur Goalzz, tu peux aussi parier ce match en direct, avec des cotes qui bougent pendant le match.</p>
      <a class="btn btn-primary btn-lg" href="/">Pronostiquer ${esc(m.home.name)} – ${esc(m.away.name)}</a>
    </section>
    ${others.length ? `
    <h2 class="seo-day">Autres matchs de ${esc(league.name)}</h2>
    <ul class="seo-matches">${others.slice(0, 8).map((x) => matchRow(league, x)).join('')}</ul>` : ''}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${m.home.name} – ${m.away.name}`,
    startDate: new Date(m.startsAt).toISOString(),
    sport: sportMeta(m.sport).label,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: league.name },
    homeTeam: { '@type': 'SportsTeam', name: m.home.name },
    awayTeam: { '@type': 'SportsTeam', name: m.away.name },
    superEvent: { '@type': 'SportsEvent', name: league.name },
    url: `${SITE}${path}`,
  };
  return layout({
    title: `${title} · Goalzz`,
    description: `${verdict} Cotes ${outcomes.map((o) => `${o === 'X' ? 'nul' : LABEL(m, o)} ${odds2(m.odds[o])}`).join(', ')}. Pronostique gratuitement sur Goalzz.`,
    path, body, jsonLd,
  });
}

export function renderGone(league) {
  return layout({
    title: 'Match terminé ou introuvable · Goalzz',
    description: 'Ce match n\'est plus à venir.',
    path: '/pronos', noindex: true,
    body: `${crumbs([['Goalzz', '/'], ['Pronostics', '/pronos'], ...(league ? [[league.name, `/pronos/${league.slug}`]] : [])])}
    <h1 class="seo-h1">Ce match n'est plus à venir</h1>
    <p class="seo-lead">Il est terminé, reporté ou introuvable. ${league ? `<a href="/pronos/${league.slug}">Voir les prochains matchs de ${esc(league.name)}</a>.` : '<a href="/pronos">Voir tous les pronostics</a>.'}</p>`,
  });
}

// Plan du site : pages fixes, compétitions et matchs à venir.
export function sitemapXml(groups, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const url = (loc, freq, prio) => `  <url><loc>${SITE}${loc}</loc><lastmod>${day}</lastmod><changefreq>${freq}</changefreq><priority>${prio}</priority></url>`;
  const lines = [url('/', 'daily', '1.0'), url('/pronos', 'daily', '0.9')];
  for (const g of groups) {
    if (!g.matches.length) continue;
    lines.push(url(`/pronos/${g.league.slug}`, 'daily', '0.8'));
    for (const m of g.matches) lines.push(url(matchPath(g.league, m), 'daily', '0.6'));
  }
  lines.push(url('/legal', 'monthly', '0.2'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}
