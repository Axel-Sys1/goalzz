import { CONFIG } from '../../config.js';
import { logoSrc, teamMark } from '../logos.js';
import { clockFor, realNow } from '../../store.js';
import { escapeHtml, fmt, fmtOdds, formatKickoff, todayKey } from '../../util.js';
import { SPORT_ORDER, sportMeta } from '../../sports.js';
import { canClaimBonus } from '../../services/players.js';
import { isAwaitingKickoff, matchStatus, outcomeShort } from '../../services/matchInfo.js';
import { realFeedState } from '../../services/matches.js';
import { spotlight } from '../../services/spotlight.js';
import { coin, icons } from '../icons.js';
import { ui } from '../uiState.js';
import { inviteBanner } from './account.js';
import { cloud } from '../../services/cloud.js';

const ORDER = { 1: 0, X: 1, 2: 2 };

// Horaire court utilisé dans une liste déjà groupée par jour.
export function kickoffShort(ts, t) {
  const diff = ts - t;
  if (diff > 0 && diff < 60 * 60_000) return formatKickoff(ts, t);
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(key) {
  const today = todayKey(new Date(realNow()));
  const tomorrow = todayKey(new Date(realNow() + 86_400_000));
  if (key === today) return "Aujourd'hui";
  if (key === tomorrow) return 'Demain';
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

const teamRow = (t, winner) => `
  <div class="team ${winner ? 'is-winner' : ''}">
    ${teamMark(t)}
    <span>${escapeHtml(t.name)}</span>
    ${t.record ? `<small class="record">${escapeHtml(t.record)}</small>` : ''}
  </div>`;

function scoreBlock(m, text) {
  if (!text) return '';
  const parts = String(text).split(' - ');
  if (m.sport !== 'tennis' && parts.length === 2 && parts.every((x) => x.trim().length <= 4)) {
    return `<div class="score"><b>${escapeHtml(parts[0])}</b><b>${escapeHtml(parts[1])}</b></div>`;
  }
  return `<div class="score score-text">${escapeHtml(text)}</div>`;
}

function oddsButtons(m, status, slipPick) {
  const outcomes = Object.keys(m.odds || {}).sort((a, b) => ORDER[a] - ORDER[b]);
  return `
    <div class="odds cols-${outcomes.length}">
      ${outcomes.map((o) => {
        const selected = slipPick === o;
        const won = status === 'finished' && m.outcome === o;
        return `
        <button class="odd ${selected ? 'selected' : ''} ${won ? 'won' : ''}" type="button"
          data-action="pick" data-match="${escapeHtml(m.id)}" data-outcome="${o}"
          ${status !== 'upcoming' ? 'disabled' : ''}
          aria-pressed="${selected}" aria-label="${escapeHtml(outcomeShort(m, o))} à ${fmtOdds(m.odds[o])}">
          <span class="odd-label">${escapeHtml(outcomeShort(m, o))}</span>
          <span class="odd-val">${fmtOdds(m.odds[o])}</span>
        </button>`;
      }).join('')}
    </div>`;
}

// « À l'affiche » : carrousel des matchs les plus intéressants (derbys, gros clubs, chocs…).
function spotlightCard({ m, tag }, slipPick, first) {
  const t = clockFor(m);
  const side = (team) => `
    <div class="ft-team">
      ${teamMark(team, `logo-img ${first ? 'logo-xl' : 'logo-lg'}`)}
      <strong>${escapeHtml(team.short && team.name.length > 16 ? team.short : team.name)}</strong>
    </div>`;
  return `
  <article class="featured spot-card ${first ? 'spot-first' : ''}">
    <header class="featured-head">
      <span class="featured-tag">${escapeHtml(first && tag === m.competition ? 'Match à la une' : tag)}</span>
      <span class="kick" data-kickoff="${m.startsAt}"${m.real ? ' data-real="1"' : ''}>${formatKickoff(m.startsAt, t)}</span>
    </header>
    <div class="ft-teams">${side(m.home)}<span class="ft-vs">VS</span>${side(m.away)}</div>
    <p class="ft-comp">${sportMeta(m.sport).icon} ${escapeHtml(m.competition)}${m.round ? ` · ${escapeHtml(m.round)}` : ''}</p>
    ${oddsButtons(m, 'upcoming', slipPick)}
  </article>`;
}

function spotlightSection(list, picks) {
  if (!list.length) return '';
  return `
    <section class="spotlight" aria-label="Matchs à l'affiche">
      <div class="section-row spot-head">
        <h2 class="section-title">À l'affiche</h2>
        ${list.length > 1 ? `<span class="muted spot-hint">${list.length} gros matchs →</span>` : ''}
      </div>
      <div class="spot-track">
        ${list.map((x, i) => spotlightCard(x, picks.get(x.m.id), i === 0)).join('')}
      </div>
    </section>`;
}

function howToCard() {
  return `
    <ol class="howto">
      <li><span>1</span>Touche une cote</li>
      <li><span>2</span>Choisis ta mise</li>
      <li><span>3</span>Valide ton pari</li>
    </ol>`;
}

export function matchCard(m, { slipPick = null, grouped = false } = {}) {
  const t = clockFor(m);
  const status = matchStatus(m, t);
  const sport = sportMeta(m.sport);
  const realAttr = m.real ? ' data-real="1"' : '';

  let right = grouped
    ? `<span class="kick" data-kickoff-short="${m.startsAt}"${realAttr}>${kickoffShort(m.startsAt, t)}</span>`
    : `<span class="kick" data-kickoff="${m.startsAt}"${realAttr}>${formatKickoff(m.startsAt, t)}</span>`;
  if (status === 'live') right = isAwaitingKickoff(m, t) ? '<span class="soon-pill">PARIS FERMÉS</span>' : '<span class="live-pill">EN DIRECT</span>';
  if (status === 'finished') right = `<span class="done-pill">${m.outcome === 'void' ? 'Remboursé' : 'Terminé'}</span>`;
  if (status === 'void') right = '<span class="done-pill">Annulé</span>';

  const head = grouped
    ? `${m.round ? escapeHtml(m.round) : ''}${m.oddsSource === 'model' ? `${m.round ? ' · ' : ''}<span class="est" title="Aucune cote bookmaker disponible : cote estimée par Goalz">cotes estimées</span>` : ''}`
    : `${sport.icon} ${escapeHtml(m.competition)}${m.round ? ` · ${escapeHtml(m.round)}` : ''}`;

  let extra = '';
  if (status === 'finished' || status === 'void') extra = scoreBlock(m, m.score);
  else if (status === 'live' && m.real) extra = `${scoreBlock(m, m.liveScore)}${m.clock ? `<div class="live-clock">${escapeHtml(m.clock)}</div>` : ''}`;
  else if (status === 'live') extra = `<div class="live-clock" data-ends="${m.endsAt}"></div>`;

  return `
  <article class="match match-${status}${slipPick ? ' has-pick' : ''}">
    <header class="match-head">
      <span class="comp">${head}</span>
      ${right}
    </header>
    <div class="match-body">
      <div class="teams">
        ${teamRow(m.home, status === 'finished' && m.outcome === '1')}
        ${teamRow(m.away, status === 'finished' && m.outcome === '2')}
      </div>
      ${extra}
    </div>
    ${oddsButtons(m, status, slipPick)}
  </article>`;
}

function sportChips(list, countOf) {
  const counts = { all: 0 };
  for (const m of list) {
    if (!countOf(m)) continue;
    counts.all += 1;
    counts[m.sport] = (counts[m.sport] || 0) + 1;
  }
  const present = SPORT_ORDER.filter((k) => list.some((m) => m.sport === k));
  const extra = [...new Set(list.map((m) => m.sport))].filter((k) => !present.includes(k));
  if (ui.sport !== 'all' && !present.includes(ui.sport) && !extra.includes(ui.sport)) ui.sport = 'all';
  const chip = (key, label) => `
    <button class="chip ${ui.sport === key ? 'active' : ''}" data-action="filter-sport" data-sport="${key}" type="button">
      ${label} <span class="chip-count">${counts[key] || 0}</span>
    </button>`;
  return `
    <div class="chips" role="toolbar" aria-label="Filtrer par sport">
      ${chip('all', 'Tous')}
      ${[...present, ...extra].map((k) => chip(k, `${sportMeta(k).icon} ${sportMeta(k).label}`)).join('')}
    </div>`;
}

function modeSwitch(mode) {
  return `
    <div class="mode-switch" role="tablist" aria-label="Type de matchs">
      <button class="mode ${mode === 'real' ? 'active' : ''}" role="tab" aria-selected="${mode === 'real'}" data-action="set-mode" data-mode="real" type="button">
        <span class="mode-icon">${icons.stadium}</span><span><strong>Vrais matchs</strong><small>Résultats réels</small></span>
      </button>
      <button class="mode ${mode === 'fake' ? 'active' : ''}" role="tab" aria-selected="${mode === 'fake'}" data-action="set-mode" data-mode="fake" type="button">
        <span class="mode-icon">${icons.bolt}</span><span><strong>Matchs éclair</strong><small>Fictifs · 2 min</small></span>
      </button>
    </div>`;
}

function renderReal(s, p, picks) {
  const feed = realFeedState();
  const t = realNow();
  const all = Object.values(s.matches).filter((m) => m.real);
  const inSport = all.filter((m) => ui.sport === 'all' || m.sport === ui.sport);
  const card = (m) => matchCard(m, { slipPick: picks.get(m.id), grouped: true });

  if (!feed.configured) {
    return `<div class="empty"><p><strong>Aucune source de vrais matchs n'est configurée.</strong></p></div>`;
  }
  if (!all.length) {
    if (feed.error && !feed.loading) {
      return `
      <div class="empty feed-error">
        <p><strong>Impossible de charger les vrais matchs</strong></p>
        <p class="muted">Vérifie ta connexion internet. (${escapeHtml(feed.error)})</p>
        <button class="btn btn-ghost" data-action="refresh-real" type="button">Réessayer</button>
      </div>`;
    }
    return `
      <div class="skeletons" aria-busy="true" aria-label="Chargement des vrais matchs">
        ${'<div class="skeleton"></div>'.repeat(4)}
      </div>`;
  }

  const live = inSport.filter((m) => matchStatus(m, t) === 'live').sort((a, b) => a.startsAt - b.startsAt);
  const upcoming = inSport.filter((m) => matchStatus(m, t) === 'upcoming');
  const days = [...new Set(upcoming.map((m) => todayKey(new Date(m.startsAt))))].sort();
  if (!days.includes(ui.day)) ui.day = days[0] || null;
  const spot = spotlight(upcoming, t);
  const dayMatches = upcoming.filter((m) => todayKey(new Date(m.startsAt)) === ui.day);

  // Groupes par compétition, dans l'ordre du premier match de chaque groupe.
  const groups = new Map();
  for (const m of dayMatches.sort((a, b) => a.startsAt - b.startsAt)) {
    const key = `${m.sport}|${m.competition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const finished = inSport
    .filter((m) => m.status === 'finished' || m.status === 'void')
    .sort((a, b) => (b.finishedAt || b.startsAt) - (a.finishedAt || a.startsAt))
    .slice(0, 8);

  return `
    ${spotlightSection(spot, picks)}

    ${sportChips(all, (m) => matchStatus(m, t) === 'upcoming')}

    ${days.length ? `
      <div class="day-chips" role="toolbar" aria-label="Choisir un jour">
        ${days.map((d) => `
          <button class="day-chip ${d === ui.day ? 'active' : ''}" data-action="filter-day" data-day="${d}" type="button">${dayLabel(d)}</button>`).join('')}
      </div>
      ${[...groups.values()].map((list) => {
        const first = list[0];
        return `
        <section class="comp-group">
          <h3 class="comp-title">
            ${first.competitionLogo ? `<img class="comp-logo" src="${escapeHtml(logoSrc(first.competitionLogo))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="comp-emoji">${sportMeta(first.sport).icon}</span>`}
            <span>${escapeHtml(first.competition)}</span>
            <span class="comp-count">${list.length}</span>
          </h3>
          <div class="match-grid">${list.map(card).join('')}</div>
        </section>`;
      }).join('')}` : `
      <div class="empty"><p class="muted">Aucun match à venir pour ce sport dans les ${CONFIG.REAL_DAYS_AHEAD} prochains jours.</p></div>`}

    ${live.length ? `
      <h2 class="section-title"><span class="live-dot"></span>En cours <span class="muted section-note">paris fermés</span></h2>
      <div class="match-grid">${live.map((m) => matchCard(m, { slipPick: picks.get(m.id) })).join('')}</div>` : ''}

    ${finished.length ? `
      <h2 class="section-title">Derniers résultats</h2>
      <div class="match-grid">${finished.map((m) => matchCard(m)).join('')}</div>` : ''}

    <p class="feed-credit">
      Données : ${escapeHtml(feed.sources.join(', ') || 'sources sportives publiques')}${feed.snapshotAt
        ? ` · instantané du ${new Date(feed.snapshotAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Les résultats arrivent à chaque mise à jour de l'instantané.`
        : `${feed.lastOk ? ` · mis à jour à ${new Date(feed.lastOk).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`}
      Les cotes viennent des bookmakers quand elles sont publiées, sinon Goalz les estime.
      ${feed.snapshotAt ? '' : '<button class="link-btn" data-action="refresh-real" type="button">Actualiser</button>'}
    </p>
  `;
}

function renderFake(s, p, picks) {
  const fakes = Object.values(s.matches).filter((m) => !m.real);
  const inSport = fakes.filter((m) => ui.sport === 'all' || m.sport === ui.sport);
  const byStart = (a, b) => a.startsAt - b.startsAt;
  const live = inSport.filter((m) => matchStatus(m) === 'live').sort(byStart);
  const upcoming = inSport.filter((m) => matchStatus(m) === 'upcoming').sort(byStart);
  const finished = inSport.filter((m) => m.status === 'finished').sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 6);
  const card = (m) => matchCard(m, { slipPick: picks.get(m.id) });

  return `
    ${sportChips(fakes, (m) => matchStatus(m) === 'upcoming')}

    ${live.length ? `
      <h2 class="section-title"><span class="live-dot"></span>En direct</h2>
      <div class="match-grid">${live.map(card).join('')}</div>` : ''}

    <div class="section-row">
      <h2 class="section-title">À venir</h2>
      <button class="link-btn" data-action="fast-forward" type="button" title="Simuler le passage du temps">
        ${icons.forward} +${CONFIG.FAST_FORWARD_MIN} min
      </button>
    </div>
    ${upcoming.length
      ? `<div class="match-grid">${upcoming.map(card).join('')}</div>`
      : `<div class="empty"><p>Chargement des prochains matchs…</p></div>`}

    ${finished.length ? `
      <h2 class="section-title">Derniers résultats</h2>
      <div class="match-grid">${finished.map(card).join('')}</div>` : ''}
  `;
}

export function renderMatches(s, p) {
  const mode = s.prefs?.mode === 'fake' ? 'fake' : 'real';
  const picks = new Map(p.slip.map((x) => [x.matchId, x.outcome]));

  return `
    <section class="greeting">
      <h1>Salut <b>${escapeHtml(p.pseudo)}</b></h1>
      ${mode === 'fake' ? '<p class="muted">Des matchs fictifs de 2 minutes pour jouer tout de suite.</p>' : ''}
    </section>

    ${cloud.user ? '' : inviteBanner({ inGame: true })}

    ${canClaimBonus(p) ? `
      <button class="bonus-card" data-action="claim-bonus" type="button">
        <span class="bonus-gift">${icons.gift}</span>
        <span class="grow">
          <strong>Ton bonus du jour est prêt</strong>
          <span class="muted">Récupère +${fmt(CONFIG.DAILY_BONUS)} Goalz gratuits</span>
        </span>
        <span class="bonus-amount">+${fmt(CONFIG.DAILY_BONUS)} ${coin('coin coin-sm')}</span>
      </button>` : ''}

    ${p.stats.betsPlaced === 0 ? howToCard() : ''}

    ${modeSwitch(mode)}

    ${mode === 'real' ? renderReal(s, p, picks) : renderFake(s, p, picks)}
  `;
}
