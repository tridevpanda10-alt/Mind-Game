// Profile: level, rating, accuracy, per-skill breakdown, achievements, recents.

import { api } from '../api.js';
import { $, el, showScreen, fmtMs, pct } from '../ui.js';
import { listThemes, setTheme, getThemeId } from '../theme.js';

const TYPE_NAMES = {
  pattern: 'Pattern', sequence: 'Sequence', matrix: 'Matrix', deduction: 'Deduction',
  conditional: 'Conditional', number: 'Number', operator: 'Operator', spatial: 'Spatial',
  mastermind: 'Mastermind',
};

export async function goProfile() {
  showScreen('#screen-profile');
  const body = $('#profileBody');
  body.replaceChildren(el('p', { class: 'sub', text: 'Loading profile…' }));
  try {
    const p = await api('GET', '/api/profile');
    body.replaceChildren();

    // overview card
    const overview = el('div', { class: 'card' },
      el('h3', { text: p.displayName + (p.isGuest ? ' (guest)' : '') }),
      el('div', { class: 'score-hero' },
        cell('Level', `${p.level} · ${p.levelProgress.into}/${p.levelProgress.needed} XP`),
        cell('Rating', String(p.rating)),
        cell('Accuracy', pct(p.accuracy)),
        cell('Best streak', String(p.bestStreak ?? 0)),
        cell('Fastest correct', fmtMs(p.fastestMs)),
        cell('Dailies done', String(p.dailiesDone ?? 0)),
      ),
    );
    body.append(overview);

    // settings card: theme picker (swaps labels + palette at runtime)
    body.append(buildThemeCard());

    // skills card
    const skills = el('div', { class: 'card' },
      el('h3', { text: 'Reasoning skills' }),
    );
    if (!p.typeStats.length) {
      skills.append(el('p', { class: 'sub', text: 'No data yet — play a training session or quick match to build your skill breakdown.' }));
    } else {
      for (const t of p.typeStats) {
        const acc = t.total ? t.correct / t.total : 0;
        skills.append(el('div', { class: 'skill-row' },
          el('span', { text: TYPE_NAMES[t.type] ?? t.type }),
          el('div', { class: 'skill-bar' }, el('div', { class: 'skill-fill', style: `width:${Math.round(acc * 100)}%` })),
          el('span', { class: 'skill-val', text: `${t.correct}/${t.total}` }),
        ));
      }
    }
    body.append(skills);

    // achievements card
    const unlocked = new Set(p.achievements.map((a) => a.achievement));
    const achCard = el('div', { class: 'card' }, el('h3', { text: 'Achievements' }));
    const ACHES = [
      ['first_blood', 'First Blood'], ['flawless', 'Flawless'], ['streak_5', 'In the Zone'],
      ['streak_10', 'Unstoppable'], ['daily_done', 'Daily Devotee'], ['xp_1000', 'Dedicated'],
      ['rating_1100', 'Rising Star'], ['rating_1300', 'Contender'], ['speed_demon', 'Speed Demon'],
      ['all_types', 'Polymath'],
    ];
    const achList = el('div', { class: 'ach-list' });
    for (const [id, label] of ACHES) {
      achList.append(el('span', { class: `ach${unlocked.has(id) ? ' unlocked' : ''}`, text: label }));
    }
    achCard.append(achList);
    body.append(achCard);

    // recent matches card
    const rec = el('div', { class: 'card' }, el('h3', { text: 'Recent matches' }));
    if (!p.recent.length) {
      rec.append(el('p', { class: 'sub', text: 'No matches yet. Your history will appear here.' }));
    } else {
      for (const m of p.recent) {
        rec.append(el('div', { class: 'result-row' },
          el('span', { class: 'res-icon', text: m.score > 0 ? '📈' : '📉' }),
          el('div', { class: 'res-body' },
            el('div', {}, el('strong', { text: `${m.mode} · ${m.correct_count}/${m.total_count} correct` })),
            el('div', { class: 'res-questions', text: `score ${m.score} · ${new Date(m.started_at).toLocaleDateString()}` }),
          ),
        ));
      }
    }
    body.append(rec);
  } catch (err) {
    body.replaceChildren(el('p', { class: 'sub', text: err.detail ?? 'Could not load profile.' }));
  }
}

// Theme picker: one button per registered theme; click swaps the whole UI
// (labels, flavor text, palette) instantly via the theme module.
function buildThemeCard() {
  const card = el('div', { class: 'card' }, el('h3', { text: 'Theme' }));
  const active = getThemeId();
  const row = el('div', { class: 'theme-row', role: 'group', 'aria-label': 'UI theme' });
  for (const t of listThemes()) {
    row.append(el('button', {
      class: `diff-btn${t.id === active ? ' active' : ''}`,
      type: 'button',
      'data-theme-id': t.id,
      onclick: (e) => {
        if (!setTheme(t.id)) return;
        document.querySelectorAll('.theme-row .diff-btn').forEach((b) =>
          b.classList.toggle('active', b.dataset.themeId === t.id));
      },
    }, `${t.name}`));
  }
  card.append(row);
  return card;
}

function cell(label, value) {
  return el('div', { class: 'chip' },
    el('span', { class: 'chip-label', text: label }),
    el('span', { class: 'chip-value', text: value }),
  );
}
