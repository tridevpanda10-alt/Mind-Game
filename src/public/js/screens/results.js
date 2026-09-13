// Results screen: honest post-match summary straight from server payload.

import { $, el, showScreen, fmtMs, pct } from '../ui.js';

export function showResults(out, mode) {
  const acc = out.totalCount ? out.correctCount / out.totalCount : 0;
  const ratingDelta = out.ratingAfter - out.ratingBefore;

  const hero = el('div', { class: 'card' },
    el('div', { class: 'score-hero' },
      cell('Score', String(out.score), true),
      cell('Accuracy', pct(acc)),
      cell('Avg time', fmtMs(out.elapsedMs ? out.elapsedMs / Math.max(1, out.totalCount) : null)),
      mode === 'training' ? cell('XP earned', `+${out.xpAwarded}`) : cell('Rating', `${out.ratingAfter}`, false, ratingDelta),
    ),
  );

  const list = el('div', { class: 'card' });
  for (const r of out.results) {
    list.append(el('div', { class: 'result-row' },
      el('span', { class: 'res-icon', text: r.isCorrect ? '✓' : '✗' }),
      el('div', { class: 'res-body' },
        el('div', {}, el('strong', { text: `${r.type} · ${r.difficulty}` }), el('span', { class: 'res-questions', text: `  ${fmtMs(r.msTaken)}` })),
        el('div', { class: 'res-questions', text: `Your answer: ${r.yourAnswer ?? '—'} · Correct: ${r.correctAnswer}` }),
        el('div', { class: 'res-questions', text: r.explanation }),
      ),
    ));
  }

  const extras = el('div', { class: 'card' });
  if (out.newAchievements?.length) {
    extras.append(el('div', {}, el('strong', { text: `Achievement${out.newAchievements.length > 1 ? 's' : ''} unlocked!` })));
    for (const a of out.newAchievements) extras.append(el('span', { class: 'ach unlocked', text: a }));
  }
  if (out.newLevel) {
    extras.append(el('p', { class: 'sub', text: `You reached level ${out.newLevel}.` }));
  }

  const body = $('#resultsBody');
  body.replaceChildren(hero, list, extras);

  const deltaEl = document.querySelector('.delta-inline');
  if (deltaEl && mode !== 'training') {
    deltaEl.textContent = ratingDelta === 0 ? '±0' : `${ratingDelta > 0 ? '+' : ''}${ratingDelta}`;
    deltaEl.className = ratingDelta >= 0 ? 'delta-up' : 'delta-down';
  }

  showScreen('#screen-results');
}

function cell(label, value, big = false, delta) {
  const c = el('div', { class: 'chip' },
    el('span', { class: 'chip-label', text: label }),
    el('span', { class: big ? 'score-big' : 'chip-value', text: value }),
  );
  if (delta !== undefined) {
    c.append(el('span', {
      class: delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'sub',
      text: delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${delta}`,
    }));
  }
  return c;
}
