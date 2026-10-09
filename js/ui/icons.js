const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  ball: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5l-2.5 4M8 10L3.5 8.5"/>'),
  ticket: svg('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 5v2M13 11v2M13 17v2"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  gift: svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  forward: svg('<path d="M4 6l8 6-8 6zM12 6l8 6-8 6z"/>', 'fill="currentColor"'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  stadium: svg('<ellipse cx="12" cy="8" rx="9" ry="3"/><path d="M3 8v8c0 1.7 4 3 9 3s9-1.3 9-3V8"/><path d="M8 11v8M16 11v8"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>', 'stroke-width="3"'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="3"'),
  clock: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', 'stroke-width="3"'),
  undo: svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>', 'stroke-width="3"'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  cloud: svg('<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  // Badges
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  flame: svg('<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3 0-3-1-5 0-8z"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  diamond: svg('<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  glove: svg('<path d="M7 11V7a3 3 0 0 1 3-3h4a4 4 0 0 1 4 4v5a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-1a2 2 0 0 1 2-2h3"/><path d="M8 21h8"/>'),
  chart: svg('<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  crown: svg('<path d="M4 18h16M4 18L3 7l5 4 4-6 4 6 5-4-1 11"/>'),
  coins: svg('<ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.4c.8 1.2 2.8 2.1 5 2.1 2.8 0 5-1.1 5-2.5v-4c0-1.4-2.2-2.5-5-2.5"/>'),
};

export const coin = (cls = 'coin') => `
<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="11" fill="#e79a00"/>
  <circle cx="12" cy="11.2" r="10" fill="#ffc83d"/>
  <circle cx="12" cy="11.2" r="7.4" fill="none" stroke="#e79a00" stroke-width="1.3"/>
  <path d="M14.6 8.3a3.6 3.6 0 1 0 .4 5.2V11.6h-2.6" fill="none" stroke="#a86400" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Emblème de rang : une gemme à la couleur du rang, des ailes à partir d'Or, une couronne à
// partir d'Ascendant, un éclat pour Radiant ; les petits losanges en bas indiquent la division.
export function rankEmblem(rank, cls = 'rank-emblem') {
  const level = rank.id === 'radiant' ? 8 : ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal'].indexOf(rank.id);
  const g = `rk-${rank.id}`;
  const wings = level >= 3 ? '<path d="M5 9L1 7l2 6 3 1zM19 9l4-2-2 6-3 1z" fill="currentColor" opacity=".7"/>' : '';
  const crown = level >= 6 ? '<path d="M8 4l1-3 2 2 1-2 1 2 2-2 1 3z" fill="currentColor"/>' : '';
  const burst = level === 8
    ? '<g stroke="currentColor" stroke-width="1.2" opacity=".8"><path d="M12 0v3M2 3l2.5 2M22 3l-2.5 2M0 13h3M24 13h-3"/></g>' : '';
  const pips = rank.division
    ? Array.from({ length: rank.division }, (_, i) => {
      const x = 12 + (i - (rank.division - 1) / 2) * 4;
      return `<path d="M${x} 23.5l1.5 1.5-1.5 1.5-1.5-1.5z" fill="currentColor"/>`;
    }).join('') : '';
  return `
<svg class="${cls}" viewBox="0 0 24 27" style="color:${rank.color}" role="img" aria-label="${rank.label}">
  <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${rank.color}"/><stop offset="1" stop-color="${rank.color}" stop-opacity=".45"/>
  </linearGradient></defs>
  ${burst}${wings}${crown}
  <path d="M12 3l7 7-7 11-7-11z" fill="url(#${g})" stroke="currentColor" stroke-width="1"/>
  <path d="M12 6.5l3.5 3.5L12 16l-3.5-6z" fill="#fff" opacity=".28"/>
  ${pips}
</svg>`;
}
