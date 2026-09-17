// Profile: level, rating, accuracy, per-skill breakdown, achievements, recents.

import { api } from '../api.js';
import { $, el, showScreen, fmtMs, pct } from '../ui.js';
import { getScheme, toggleScheme } from '../theme.js';
import { getMusicVolume, setMusicVolume, getSfxVolume, setSfxVolume, getVibrationEnabled, setVibrationEnabled } from '../sfx.js';

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

    // settings card: color scheme shortcut (skins live in their own store)
    body.append(buildSchemeCard());

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

// Settings card: color scheme + audio sliders + vibration toggle. Music and
// SFX each get their own 0–100 volume slider (0 == off); they are fully
// independent — muting one never touches the other. Vibration stays a plain
// on/off toggle (intensity is not requested and not meaningful per-device).
function buildSchemeCard() {
  const card = el('div', { class: 'card' }, el('h3', { text: 'Settings' }));

  const schemeBtn = el('button', {
    class: 'diff-btn', type: 'button',
    text: getScheme() === 'light' ? '☀ Light mode (active)' : '☾ Dark mode (active)',
  });
  schemeBtn.addEventListener('click', () => {
    toggleScheme();
    schemeBtn.textContent = getScheme() === 'light' ? '☀ Light mode (active)' : '☾ Dark mode (active)';
  });
  card.append(el('div', { class: 'row' },
    schemeBtn,
    el('span', { class: 'sub', text: 'Skins are managed in the Skins store.' }),
  ));

  const settingsGrid = el('div', { class: 'settings-grid' });
  const slider = (label, get, set, hint) => {
    const val = el('span', { class: 'sub slider-val', text: `${get()}%` });
    const input = el('input', {
      type: 'range', min: '0', max: '100', step: '1', value: String(get()),
      'aria-label': `${label} volume`,
    });
    input.addEventListener('input', () => {
      set(Number(input.value)); // live: adjusts playback with no reload
      val.textContent = `${input.value}%`;
    });
    settingsGrid.append(
      el('div', { class: 'setting-row slider-row' },
        el('div', {},
          el('strong', { text: label }),
          el('span', { class: 'sub', text: hint }),
        ),
        el('div', { class: 'slider-controls' }, input, val),
      ),
    );
  };
  slider('Music', getMusicVolume, setMusicVolume, 'Background loop while you play — 0 is off');
  slider('Sound effects', getSfxVolume, setSfxVolume, 'Clicks and correct/incorrect cues — 0 is off');
  const toggle = (label, get, set, hint) => {
    const btn = el('button', {
      class: `diff-btn toggle${get() ? ' on' : ''}`, type: 'button',
      text: `${get() ? '✅' : '⬜'} ${label}: ${get() ? 'On' : 'Off'}`,
    });
    btn.addEventListener('click', () => {
      set(!get());
      btn.textContent = `${get() ? '✅' : '⬜'} ${label}: ${get() ? 'On' : 'Off'}`;
      btn.classList.toggle('on', get());
    });
    settingsGrid.append(
      el('div', { class: 'setting-row' },
        el('div', {},
          el('strong', { text: label }),
          el('span', { class: 'sub', text: hint }),
        ),
        btn,
      ),
    );
  };
  toggle('Vibration', getVibrationEnabled, setVibrationEnabled, 'Haptic taps on supported phones');
  card.append(settingsGrid);
  return card;
}

function cell(label, value) {
  return el('div', { class: 'chip' },
    el('span', { class: 'chip-label', text: label }),
    el('span', { class: 'chip-value', text: value }),
  );
}
