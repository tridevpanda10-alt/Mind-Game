// Home screen: greeting, live stat chips, daily availability, mode launcher.

import { api } from '../api.js';
import { $, showScreen, toast, pct } from '../ui.js';
import { startMatch } from './game.js';

let dailyAvailable = null;

export async function goHome() {
  showScreen('#screen-home');
  try {
    const [me, daily] = await Promise.all([
      api('GET', '/api/me'),
      api('GET', '/api/daily/status'),
    ]);
    $('#greeting').textContent = `Welcome back, ${me.displayName}`;
    $('#homeSub').textContent = me.isGuest
      ? 'Guest mode — training only. Register to climb the ranks.'
      : `Level ${me.level} · ${me.rating} rating`;
    $('#chipRating').textContent = me.rating;
    $('#chipLevel').textContent = me.level;
    dailyAvailable = daily.available;

    const pill = $('#dailyPill');
    const btn = document.querySelector('[data-action="daily"]');
    if (daily.finished === 'completed') {
      pill.textContent = 'Completed today — see ranking';
      pill.className = 'pill good';
      btn.disabled = true;
    } else if (!daily.available) {
      pill.textContent = daily.finished === 'active' ? 'Attempt in progress' : 'Unavailable';
      pill.className = 'pill';
      btn.disabled = false;
    } else {
      pill.textContent = 'New challenge available';
      pill.className = 'pill good';
      btn.disabled = false;
    }

    // fetch accuracy + streak asynchronously from profile
    api('GET', '/api/profile').then((p) => {
      $('#chipAcc').textContent = pct(p.accuracy);
      $('#chipStreak').textContent = p.bestStreak ?? 0;
    }).catch(() => {
      $('#chipAcc').textContent = '–';
    });
  } catch (err) {
    toast(err.detail ?? 'Could not load home data.');
  }
}

export function initHome() {
  document.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('click', async () => {
      const action = b.dataset.action;
      if (action === 'training') {
        showScreen('#screen-training');
      } else if (action === 'quick') {
        startMatch('quick');
      } else if (action === 'daily') {
        startMatch('daily');
      }
    });
  });
}
