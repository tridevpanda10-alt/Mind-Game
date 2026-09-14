// Skins store: world-skin catalog with server-verified ownership.
// Unlocking is a server economy mutation; selecting an owned skin is
// local-only (validated against the server list at boot).

import { api, getDiamonds, setDiamonds } from '../api.js';
import { $, el, showScreen, toast, spinner } from '../ui.js';
import { THEMES, getActiveSkinId, setActiveSkin, applySkinDocument } from '../theme.js';

let cache = null; // { unlocked, skins } — refreshed on every goSkins()

export async function goSkins() {
  showScreen('#screen-skins');
  const body = $('#skinsBody');
  body.replaceChildren(el('p', { class: 'sub', text: 'Loading skins…' }));
  try {
    cache = await api('GET', '/api/skins');
    render();
  } catch (err) {
    body.replaceChildren(el('p', { class: 'sub', text: err.detail ?? 'Could not load skins.' }));
  }
}

function render() {
  const body = $('#skinsBody');
  const active = getActiveSkinId();
  body.replaceChildren();
  for (const s of cache.skins) {
    const owned = cache.unlocked.includes(s.id);
    const t = THEMES[s.id];
    body.append(skinCard({ ...s, owned, isActive: s.id === active, flavor: t?.home?.quickMatchBody ?? '' }));
  }
}

function skinCard(s) {
  const balance = getDiamonds();
  const affordable = balance >= s.priceInDiamonds;
  const swatchClass = { detective: 'sw-detective', space: 'sw-space', treasure: 'sw-treasure' }[s.id] ?? 'sw-detective';

  let action;
  if (s.owned && s.isActive) {
    action = el('div', { class: 'row' },
      el('button', { class: 'btn', type: 'button', disabled: true, text: 'Active' }),
      el('span', { class: 'skin-badge active', text: 'Active' }),
    );
  } else if (s.owned) {
    action = el('button', {
      class: 'btn primary', type: 'button', text: 'Select',
      onclick: async () => {
        if (!setActiveSkin(s.id)) return;
        toast(`Skin applied: ${s.label}`);
        render(); // re-render badges in place, no reload
      },
    });
  } else if (affordable) {
    action = el('button', {
      class: 'btn primary', type: 'button', text: `Unlock for ${s.priceInDiamonds} 💎`,
      onclick: () => unlock(s.id),
    });
  } else {
    action = el('button', {
      class: 'btn', type: 'button', disabled: true,
      text: `Need ${s.priceInDiamonds} 💎 (you have ${balance} 💎)`,
    });
  }

  return el('article', { class: `card skin-card${s.isActive ? ' active' : ''}` },
    el('div', { class: `skin-swatch ${swatchClass}`, 'aria-hidden': 'true' }),
    el('div', { class: 'row' },
      el('strong', { text: s.label }),
      s.owned ? el('span', { class: 'skin-badge owned', text: s.free ? 'Free — Owned' : 'Unlocked' }) : null,
    ),
    el('p', { class: 'sub', text: s.flavor }),
    el('div', { class: 'row' },
      s.free ? el('span', { class: 'skin-badge', text: 'Free' }) : el('span', { class: 'skin-price', text: `${s.priceInDiamonds} 💎` }),
      action,
    ),
  );
}

async function unlock(skinId) {
  spinner(true);
  try {
    const out = await api('POST', '/api/skins/unlock', { skinId });
    setDiamonds(out.diamonds); // header balance updates immediately
    cache = { unlocked: out.unlocked, skins: cache.skins };
    setActiveSkin(skinId); // auto-select on success (Phase D)
    applySkinDocument(getActiveTheme());
    toast('Skin unlocked and applied!');
    render();
  } catch (err) {
    if (err.code === 'insufficient_diamonds') toast(err.detail ?? 'Not enough diamonds.');
    else if (err.code === 'already_unlocked') { toast('Already owned — selecting it.'); render(); }
    else toast(err.detail ?? 'Could not unlock the skin.');
  } finally {
    spinner(false);
  }
}

function getActiveTheme() { return THEMES[getActiveSkinId()] ?? THEMES.detective; }
