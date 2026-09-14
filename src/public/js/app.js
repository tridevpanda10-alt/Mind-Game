// App entry point: boot, splash, auth, navigation wiring, PWA registration.

import { api, setToken, getToken, captureReferralFromUrl, getStoredReferral, clearStoredReferral } from './api.js';
import { initAds } from './ads.js';
import { $, $$, el, showScreen, toast, spinner } from './ui.js';
import { initTheme, theme } from './theme.js';
import { initGame, exitMatch, getState } from './screens/game.js';
import { initHome, goHome } from './screens/home.js';
import { initTraining, goTraining } from './screens/training.js';
import { initLeaderboard, goLeaderboard } from './screens/leaderboard.js';
import { goProfile } from './screens/profile.js';

// ── splash ────────────────────────────────────────────────────────────────
function playSplash(onDone) {
  const seq = $('#splashSeq');
  seq.replaceChildren();
  const words = theme.splash;
  words.forEach((w, i) => {
    const s = el('div', { class: 'splash-word', text: w });
    s.style.animationDelay = `${i * 1.05}s`;
    seq.append(s);
  });
  const logo = el('div', { class: 'splash-logo', text: 'MIND GAME — REASONING ARENA' });
  logo.style.animationDelay = '3.2s';
  seq.append(logo);
  const enter = el('button', { class: 'btn primary splash-enter', text: 'ENTER THE ARENA' });
  enter.style.animationDelay = '4.1s';
  enter.addEventListener('click', onDone);
  seq.append(enter);
  // auto-advance for reduced-motion users is handled by CSS near-instant animations
}

// ── service worker (PWA app shell only; API calls stay network-only) ──────
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is optional */ });
}

// ── auth screen ───────────────────────────────────────────────────────────
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $$('.tab[data-auth-tab]').forEach((t) => {
    const active = t.dataset.authTab === mode;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  $('#nameField').classList.toggle('hidden', mode === 'login');
  $('#authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  const err = $('#authError');
  err.hidden = true;
}

function initAuth() {
  captureReferralFromUrl(); // remember ?ref=CODE before it disappears
  $$('.tab[data-auth-tab]').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.authTab)));
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#authError');
    errBox.hidden = true;
    const email = $('#authEmail').value.trim();
    const pass = $('#authPass').value;
    const name = $('#authName').value.trim();
    spinner(true);
    try {
      const ref = getStoredReferral();
      const payload = authMode === 'login'
        ? { email, password: pass }
        : { email, password: pass, displayName: name, ...(ref ? { ref } : {}) };
      const out = await api('POST', authMode === 'login' ? '/api/auth/login' : '/api/auth/register', payload);
      if (authMode === 'register') clearStoredReferral();
      setToken(out.token);
      enterApp();
    } catch (err) {
      errBox.textContent = err.detail ?? err.message ?? 'Authentication failed. Please try again.';
      errBox.hidden = false;
    } finally {
      spinner(false);
    }
  });
  $('#guestBtn').addEventListener('click', async () => {
    spinner(true);
    try {
      const out = await api('POST', '/api/auth/guest');
      setToken(out.token);
      enterApp();
    } catch (err) {
      toast(err.detail ?? 'Could not start guest session.');
    } finally {
      spinner(false);
    }
  });
  setAuthMode('login');
}

// ── nav wiring ────────────────────────────────────────────────────────────
function initNav() {
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const dest = b.dataset.nav;
    if (dest === 'home') goHome();
    else if (dest === 'play') goTraining();
    else if (dest === 'leaderboard') goLeaderboard();
    else if (dest === 'profile') goProfile();
  }));
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* session may be gone */ }
    setToken(null);
    location.reload();
  });
}

// ── session restore ───────────────────────────────────────────────────────
function restoreMatch() {
  // A refresh mid-match: the server still holds the key; the client can't
  // rebuild question data (answers are never sent twice), so route home.
  sessionStorage.removeItem('cra_match');
  void getState();
}

async function enterApp() {
  $('#screen-auth').classList.add('hidden');
  $('#screen-splash').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  claimDailyLoginBonus();
  await goHome();
}

// Auto-claim the +5 diamonds daily login bonus (server decides once/day).
async function claimDailyLoginBonus() {
  try {
    const out = await api('POST', '/api/bonus/daily');
    if (out.ok) toast(`Daily bonus: +${out.amount} 💎`);
  } catch { /* bonus is best-effort */ }
}

async function boot() {
  initTheme(); // restore saved palette + labels BEFORE first paint
  initAuth();
  initNav();
  initHome();
  initTraining();
  initLeaderboard();
  initGame({});
  restoreMatch();
  registerServiceWorker();
  initAds(); // warm the ad provider (server-chosen); lazy-fallback otherwise

  const hasToken = Boolean(getToken());
  playSplash(() => {
    if (hasToken) {
      enterApp();
    } else {
      showScreen('#screen-auth');
    }
  });

  // validate token in background; drop to auth if stale
  if (hasToken) {
    try {
      await api('GET', '/api/me');
    } catch {
      setToken(null);
      showScreen('#screen-auth');
    }
  }
}

boot();
