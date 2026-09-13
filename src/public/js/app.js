// App entry point: boot, splash, auth, navigation wiring.

import { api, setToken, getToken } from './api.js';
import { $, $$, el, showScreen, toast, spinner } from './ui.js';
import { initGame, exitMatch, getState } from './screens/game.js';
import { initHome, goHome } from './screens/home.js';
import { initTraining, goTraining } from './screens/training.js';
import { initLeaderboard, goLeaderboard } from './screens/leaderboard.js';
import { goProfile } from './screens/profile.js';

// ── splash ────────────────────────────────────────────────────────────────
function playSplash(onDone) {
  const seq = $('#splashSeq');
  seq.replaceChildren();
  const words = ['THINK.', 'ANALYZE.', 'SOLVE.'];
  words.forEach((w, i) => {
    const s = el('div', { class: 'splash-word', text: w });
    s.style.animationDelay = `${i * 1.05}s`;
    seq.append(s);
  });
  const logo = el('div', { class: 'splash-logo', text: 'COMPETITIVE REASONING ARENA' });
  logo.style.animationDelay = '3.2s';
  seq.append(logo);
  const enter = el('button', { class: 'btn primary splash-enter', text: 'ENTER THE ARENA' });
  enter.style.animationDelay = '4.1s';
  enter.addEventListener('click', onDone);
  seq.append(enter);
  // auto-advance for reduced-motion users is handled by CSS near-instant animations
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
      const out = authMode === 'login'
        ? await api('POST', '/api/auth/login', { email, password: pass })
        : await api('POST', '/api/auth/register', { email, password: pass, displayName: name });
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
}

async function enterApp() {
  $('#screen-auth').classList.add('hidden');
  $('#screen-splash').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  await goHome();
}

async function boot() {
  initAuth();
  initNav();
  initHome();
  initTraining();
  initLeaderboard();
  initGame({});
  restoreMatch();

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
