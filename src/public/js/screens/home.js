// Home screen: greeting, live stat chips, daily availability, mode launcher,
// diamonds wallet, tournament status, and the referral invite card.

import { api, getDiamonds, setDiamonds, referralLink } from '../api.js';
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
    setDiamonds(me.diamonds);
    renderDiamonds();
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

    if (!me.isGuest) refreshTournament();
    refreshReferral(me);
    void dailyAvailable;
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

function renderDiamonds() {
  const chip = $('#chipDiamonds');
  if (chip) chip.textContent = String(getDiamonds());
}

async function refreshTournament() {
  try {
    const st = await api('GET', '/api/tournament/status');
    const pill = $('#tournamentPill');
    const btn = document.querySelector('[data-action="tournament"]');
    if (!pill || !btn) return;
    if (st.finished === 'completed') {
      pill.textContent = `Played this week · pool ${st.prizePool} 💎`;
      pill.className = 'pill good';
      btn.disabled = true;
    } else if (st.entered) {
      pill.textContent = `Entry in progress · pool ${st.prizePool} 💎`;
      pill.className = 'pill';
      btn.disabled = false;
    } else {
      pill.textContent = `Entry ${st.entryCost} 💎 · pool ${st.prizePool} 💎 · ${st.entrants} entered`;
      pill.className = 'pill good';
      btn.disabled = false;
    }
  } catch {
    const pill = $('#tournamentPill');
    if (pill) pill.textContent = 'Tournament unavailable';
  }
}

async function refreshReferral(me) {
  const card = document.querySelector('.invite-card');
  if (!card) return;
  const input = $('#referralLink');
  const copyBtn = $('#copyReferral');
  const stats = $('#referralStats');
  if (me.isGuest) {
    input.value = 'Register to get your invite link.';
    copyBtn.disabled = true;
    stats.textContent = '';
    return;
  }
  try {
    const r = await api('GET', '/api/me/referral');
    input.value = r.referralCode ? referralLink(r.referralCode) : 'Link unavailable.';
    copyBtn.disabled = !r.referralCode;
    stats.textContent = `${r.invited} invited · ${r.rewarded} rewarded`;
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Invite link copied!');
      } catch {
        input.select();
        toast('Press Ctrl+C to copy the link.');
      }
    };
  } catch {
    input.value = 'Link unavailable.';
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
      } else if (action === 'tournament') {
        startMatch('tournament');
      }
    });
  });
}
