// Leaderboard: daily / tournament / rating / xp tabs, server-paginated.

import { api } from '../api.js';
import { $, $$, el, showScreen } from '../ui.js';

let currentBoard = 'daily';

export async function goLeaderboard(board) {
  if (board) currentBoard = board;
  showScreen('#screen-leaderboard');
  $$('#lbTabs .tab').forEach((t) => {
    const active = t.dataset.lb === currentBoard;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  const body = $('#lbBody');
  body.replaceChildren(el('p', { class: 'sub', text: 'Loading ranking…' }));
  try {
    if (currentBoard === 'daily') {
      const out = await api('GET', '/api/leaderboard/daily');
      renderRows(out.entries.map((e) => ({
        position: e.position,
        displayName: e.displayName,
        stat: `${e.score} pts · ${e.correct}/${e.total} · ${Math.round(e.elapsedMs / 1000)}s`,
      })), 'No daily results yet today. Be the first to play the Daily Challenge!');
    } else if (currentBoard === 'tournament') {
      const out = await api('GET', '/api/leaderboard/tournament');
      const payoutByPos = new Map((out.payouts ?? []).map((p) => [p.position, p.diamonds]));
      const head = el('p', { class: 'sub', text: `Week of ${out.week} · prize pool ${out.prizePool} 💎 · payouts: ${out.payouts.map((p) => `#${p.position} ${p.diamonds}💎`).join(' · ')}` });
      const bodyEl = $('#lbBody');
      bodyEl.replaceChildren(head);
      const rows = out.entries.map((e) => ({
        position: e.position,
        displayName: e.displayName,
        stat: `${e.score} pts · ${e.correct}/${e.total}${payoutByPos.has(e.position) ? ` · won ${payoutByPos.get(e.position)} 💎` : ''}`,
      }));
      bodyEl.append(el('div', { class: 'lb' }));
      renderRows(rows, 'No tournament entries settled yet this week. Entry costs 25 💎 — top 3 share the pool!');
      return;
    } else {
      const out = await api('GET', `/api/leaderboard?board=${currentBoard}`);
      renderRows(out.entries.map((e) => ({
        position: e.position,
        displayName: e.displayName,
        stat: currentBoard === 'xp' ? `${e.xp} XP` : `${e.rating} rating`,
        me: e.position === out.myPosition,
      })), out.myPosition && out.entries.every((e) => e.position !== out.myPosition)
        ? `You are ranked #${out.myPosition}. Play ranked matches to climb!`
        : 'No ranked players yet. Register and play a Quick Match to claim #1!');
    }
  } catch (err) {
    body.replaceChildren(el('p', { class: 'sub', text: err.detail ?? 'Could not load the leaderboard. Pull to retry from the menu.' }));
  }
}

function renderRows(rows, emptyText) {
  const body = $('#lbBody');
  body.replaceChildren();
  if (!rows.length) {
    body.append(el('div', { class: 'lb-empty' },
      el('p', { text: emptyText ?? 'Nothing here yet.' }),
    ));
    return;
  }
  const list = el('div', { class: 'lb-list' });
  for (const r of rows) {
    list.append(el('div', { class: `lb-row${r.me ? ' me' : ''}` },
      el('span', { class: `lb-pos${r.position <= 3 ? ' top' : ''}`, text: `#${r.position}` }),
      el('span', { class: 'lb-name', text: r.displayName }),
      el('span', { class: 'lb-stat', text: r.stat }),
    ));
  }
  body.append(list);
}

export function initLeaderboard() {
  $$('#lbTabs .tab').forEach((t) => t.addEventListener('click', () => goLeaderboard(t.dataset.lb)));
}
