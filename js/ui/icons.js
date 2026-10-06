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
