// Icon library: original inline SVG, stroke-based, currentColor — no icon
// font, no external assets. Buttons declare `data-icon="name"` in their
// markup (static HTML) or `{ dataIcon: 'name' }` via ui.el() (dynamic), and
// hydrateIcons() replaces/prepends the SVG at boot so no runtime network
// fetch is involved anywhere.

// 24x24 viewBox paths, tuned for stroke rendering.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  case: '<path d="M4 8h16v12H4z"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4"/><path d="M8 21h8"/><path d="M9 18h6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 .4 18c1.6 0 2-1 1.3-2-.9-1.4.1-3 1.9-3H18a3 3 0 0 0 3-3c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="10.5" cy="7.3" r="1.3"/><circle cx="15.5" cy="7.3" r="1.3"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  logout: '<path d="M14 4h-9v16h9"/><path d="M17 8l4 4-4 4"/><path d="M21 12H10"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M9 15.5l2 2 4-4"/>',
  bolt: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M12 13.4l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.2 15.5l2-.3z"/><path d="M8.5 3h3L13 9"/><path d="M15.5 3h-3L11 9"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20.5"/><path d="M20 18v3H6.5"/>',
  folder: '<path d="M3 6h6l2 2.5h10V20H3z"/>',
  share: '<circle cx="6" cy="12" r="2.6"/><circle cx="17" cy="5.5" r="2.6"/><circle cx="17" cy="18.5" r="2.6"/><path d="M8.4 10.8l6.3-4M8.4 13.2l6.3 4"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 13 4.5a4 4 0 0 1 6 6l-2 2"/><path d="M13 17.5 11 19.5a4 4 0 0 1-6-6l2-2"/>',
  submit: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  bulb: '<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 1 3.6 10.8c-.7.6-1.1 1.3-1.1 2.2h-5c0-.9-.4-1.6-1.1-2.2A6 6 0 0 1 12 3z"/>',
  forward: '<path d="M4 5.5v13l8-6.5z"/><path d="M13 5.5v13l8-6.5z"/>',
  gem: '<path d="M7 3h10l4 6-9 12L3 9z"/><path d="M3 9h18"/><path d="M7 3l5 18L17 3"/>',
  snow: '<path d="M12 2v20"/><path d="M4 7l16 10"/><path d="M20 7 4 17"/><path d="M9.5 3.5 12 6l2.5-2.5"/><path d="M9.5 20.5 12 18l2.5 2.5"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
};

export function iconSvg(name, { size = 18 } = {}) {
  const body = ICONS[name];
  if (!body) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = body;
  return svg;
}

// Hydrate every [data-icon] element in place:
//   - Buttons/links with existing text keep it (icon-first, text follows).
//   - Icon-only elements (data-icon-only) get title + aria-label so they are
//     never unlabeled; a CSS tooltip shows the label on hover/focus.
export function hydrateIcons(root = document) {
  for (const elNode of root.querySelectorAll('[data-icon]')) {
    if (elNode.querySelector(':scope > svg.icon')) continue; // already hydrated
    const name = elNode.dataset.icon;
    const svg = iconSvg(name, { size: elNode.dataset.iconSize ? Number(elNode.dataset.iconSize) : 18 });
    if (!svg) continue;
    elNode.prepend(svg);
    if (elNode.dataset.iconOnly !== undefined) {
      if (!elNode.getAttribute('aria-label')) elNode.setAttribute('aria-label', elNode.textContent.trim());
      if (!elNode.getAttribute('title')) elNode.setAttribute('title', elNode.textContent.trim());
      elNode.classList.add('icon-only');
    } else if (elNode.tagName === 'BUTTON' || elNode.tagName === 'A') {
      // Icon-first action controls: carry the full action text in a tooltip
      // (and a matching aria-label when the element has none) per the a11y rule.
      const label = elNode.textContent.trim();
      if (label) {
        if (!elNode.getAttribute('title')) elNode.setAttribute('title', label);
        if (!elNode.getAttribute('aria-label')) elNode.setAttribute('aria-label', label);
      }
    }
  }
}

// Convenience for dynamically created buttons via ui.el():
// pass `{ dataIcon: 'name' }` then call hydrateIcons(container).
export function hasIcon(name) {
  return Boolean(ICONS[name]);
}

// Boot hydration: module scripts run after DOM parsing, so the static
// markup (sidebar, bottom nav, home CTAs) is hydratable right away.
// Dynamic buttons are covered by showScreen()'s idempotent re-hydration.
hydrateIcons();
