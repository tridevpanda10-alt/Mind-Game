// Campaign map: numbered cases with lock/completion state and boss styling.
// Visual language deliberately mirrors the skins store (locked/unlocked
// cards, badges, gradient swatches) instead of inventing a new pattern.

import { api } from '../api.js';
import { $, el, showScreen, toast, spinner } from '../ui.js';
import { campaignTheme } from '../theme.js';
import { startMatch } from './game.js';
import { iconSvg } from '../icons.js';

export async function goCampaign() {
  showScreen('#screen-campaign');
  const body = $('#campaignBody');
  body.replaceChildren(el('p', { class: 'sub', text: 'Loading the case board…' }));
  const c = campaignTheme();
  $('#campaignTitle').textContent = c.mapTitle;
  try {
    const data = await api('GET', '/api/campaign');
    render(data);
  } catch (err) {
    body.replaceChildren(el('p', { class: 'sub', text: err.detail ?? 'Could not load campaign progress.' }));
  }
}

function render(data) {
  const body = $('#campaignBody');
  const c = campaignTheme();
  $('#campaignSub').textContent = `${c.mapBody} (${data.cases.filter((x) => x.completed).length}/${data.totalCases} closed)`;
  body.replaceChildren();

  const grid = el('div', { class: 'campaign-grid' });
  for (const cs of data.cases) {
    grid.append(caseCard(cs, c));
  }
  body.append(grid);
}

function caseCard(cs, c) {
  const diffClass = `diff-${cs.difficulty ?? 'medium'}`;
  let action;
  if (cs.unlocked) {
    action = el('button', {
      class: 'btn primary', type: 'button',
      text: cs.completed ? 'Replay' : (cs.boss ? c.beginButton : c.beginButton),
      onclick: async () => {
        spinner(true);
        try {
          await startMatch('campaign', { caseNumber: cs.caseNumber });
        } finally {
          spinner(false);
        }
      },
    });
    { const svg = iconSvg(cs.completed ? 'forward' : 'play'); if (svg) action.prepend(svg); }
  } else {
    action = el('button', { class: 'btn', type: 'button', disabled: true, text: '🔒 Locked' });
  }

  return el('article', { class: `card campaign-card${cs.unlocked ? '' : ' locked'}${cs.boss ? ' boss' : ''}` },
    el('div', { class: `campaign-swatch ${diffClass}`, 'aria-hidden': 'true' },
      el('span', { class: 'campaign-num', text: String(cs.caseNumber) }),
      cs.boss ? el('span', { class: 'boss-crown', text: '👑' }) : null,
    ),
    el('div', { class: 'row' },
      el('strong', { text: c.caseLabel(cs.caseNumber) }),
      cs.boss ? el('span', { class: 'skin-badge boss', text: c.bossLabel }) : null,
      cs.completed ? el('span', { class: 'skin-badge owned', text: `✓ ${cs.bestScore ?? 0}` }) : null,
    ),
    el('p', { class: 'sub', text: cs.unlocked ? (cs.boss ? c.bossBody : `Difficulty ≈ ${cs.difficulty} · ${cs.attempts} attempt${cs.attempts === 1 ? '' : 's'}`) : 'Finish the previous case to unlock.' }),
    el('div', { class: 'row' }, action),
  );
}
