// App entry point: boot, splash, auth, navigation wiring, PWA registration.

import { api, setToken, getToken, captureReferralFromUrl, getStoredReferral, clearStoredReferral } from './api.js';
import { $, $$, el, showScreen, toast, spinner } from './ui.js';
import { initAds } from './ads.js';
import { initTheme, initScheme, toggleScheme, validateActiveSkin, theme } from './theme.js';
import { initAudioSettings, registerFirstGesture, vibrate } from './sfx.js';
import { initGame, exitMatch, getState } from './screens/game.js';
import { initHome, goHome } from './screens/home.js';
import { initTraining, goTraining } from './screens/training.js';
import { initLeaderboard, goLeaderboard } from './screens/leaderboard.js';
import { goProfile } from './screens/profile.js';
import { goSkins } from './screens/skins.js';
import { goCampaign } from './screens/campaign.js';

// ── splash ────────────────────────────────────────────────────────────────
// Real intro animation: "Magnifying Glass" by faisal qureshi, a free
// Lottie animation (Lottie Simple License) stored locally as
// /animations/intro.json and played by lottie-web (vendored, MIT). Any tap
// still skips straight into the app.
const INTRO_JSON_URL = '/animations/intro.json';
let introAnim = null;

function destroyIntroAnim() {
  if (!introAnim) return;
  try { introAnim.destroy(); } catch { /* already gone */ }
  introAnim = null;
}

function playIntro(onDone) {
  const seq = $('#splashSeq');
  seq.replaceChildren();

  // Lottie host: create + play the magnifying-glass animation once.
  const host = $('#lottieStage');
  host.replaceChildren();
  try {
    if (window.lottie) {
      introAnim = window.lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        path: INTRO_JSON_URL,
      });
      introAnim.addEventListener('DOMLoaded', () => introAnim.goToAndPlay(0, true));
    }
  } catch { /* fail-open: the word sequence still plays without it */ }
  if (!introAnim) host.classList.add('hidden');

  const words = theme.splash;
  words.forEach((w, i) => {
    const s = el('div', { class: 'splash-word', text: w });
    s.style.animationDelay = `${0.9 + i * 0.75}s`;
    seq.append(s);
  });
  const logo = el('div', { class: 'splash-logo', text: 'MIND GAME — REASONING ARENA' });
  logo.style.animationDelay = `${0.9 + words.length * 0.75}s`;
  seq.append(logo);
  const enter = el('button', { class: 'btn primary splash-enter', text: 'ENTER THE ARENA' });
  enter.style.animationDelay = `${0.9 + words.length * 0.75 + 0.5}s`;
  enter.addEventListener('click', () => { cleanup(); onDone(); });
  seq.append(enter);

  // Skip: any tap/click on the intro (not on the enter button itself) jumps
  // straight to the app; keyboard users can press Enter.
  const skip = (e) => {
    if (e.target === enter || enter.contains(e.target)) return;
    cleanup();
    onDone();
  };
  const keySkip = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      cleanup();
      onDone();
    }
  };
  function cleanup() {
    $('#screen-splash').removeEventListener('click', skip);
    window.removeEventListener('keydown', keySkip);
    destroyIntroAnim();
    $('#lottieStage').replaceChildren();
  }
  $('#screen-splash').addEventListener('click', skip);
  window.addEventListener('keydown', keySkip);
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
    vibrate(15);
    if (dest === 'home') goHome();
    else if (dest === 'play') goTraining();
    else if (dest === 'campaign') goCampaign();
    else if (dest === 'leaderboard') goLeaderboard();
    else if (dest === 'skins') goSkins();
    else if (dest === 'profile') goProfile();
  }));
  // Color-scheme toggle (dark/light): client-only, works for guests.
  const syncToggles = () => {
    const light = document.documentElement.dataset.scheme === 'light';
    for (const btn of $$('#schemeToggle, #schemeToggleM')) btn.textContent = light ? '☀' : '☾';
  };
  for (const btn of $$('#schemeToggle, #schemeToggleM')) {
    btn.addEventListener('click', () => { toggleScheme(); syncToggles(); });
  }
  syncToggles();
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
  // Re-validate the locally stored skin against server ownership; fall back
  // to the default skin if localStorage holds a stale/tampered id.
  try {
    const skins = await api('GET', '/api/skins');
    validateActiveSkin(skins.unlocked);
  } catch { /* offline: keep local choice until next boot */ }
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
  initScheme(); // dark/light restored BEFORE first paint (no scheme flash)
  initTheme(); // restore saved skin locally; ownership re-checked below
  initAudioSettings(); // music/sfx/vibration preferences
  initAuth();
  initNav();
  initHome();
  initTraining();
  initLeaderboard();
  initGame({});
  restoreMatch();
  registerServiceWorker();
  initAds(); // warm the ad provider (server-chosen); lazy-fallback otherwise
  registerFirstGesture(); // audio unlock on first tap (autoplay policy)

  const hasToken = Boolean(getToken());
  playIntro(() => {
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
