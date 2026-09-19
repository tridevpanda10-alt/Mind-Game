// UI helpers: DOM shorthand, toasts, spinner, formatting, screen router.

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c);
  }
  return node;
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

let spinnerCount = 0;
export function spinner(on) {
  spinnerCount += on ? 1 : -1;
  if (spinnerCount < 0) spinnerCount = 0;
  $('#spinner').hidden = spinnerCount === 0;
}

export function fmtMs(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

export function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function pct(x) {
  return x == null ? '–' : `${Math.round(x * 100)}%`;
}

import { hydrateIcons } from './icons.js';

export function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  // The shell wraps every in-app screen; if a shell screen is being shown,
  // make sure the shell itself is unhidden (e.g. a screen shown before
  // enterApp() ran, or a page resumed in an inconsistent state).
  if ($(id).closest('#shell')) $('#shell').classList.remove('hidden');
  window.scrollTo(0, 0);
  // sync nav active states
  const map = { 'screen-home': 'home', 'screen-training': 'play', 'screen-game': 'play', 'screen-results': 'play', 'screen-campaign': 'campaign', 'screen-leaderboard': 'leaderboard', 'screen-profile': 'profile' };
  const active = map[id.replace('#', '')];
  $$('.nav-btn, .bnav').forEach((b) => b.classList.toggle('active', b.dataset.nav === active));
  // Icon hydration is idempotent; running it here covers buttons that were
  // built dynamically since the last screen change.
  hydrateIcons();
}
