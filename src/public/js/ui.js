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

// ── Roving-tabindex keyboard navigation for the icon-only nav groups ──────
// Icon-only buttons no longer announce their position by text, so each nav
// group behaves as one composite widget (WAI-ARIA roving tabindex): a single
// Tab stop for the group, then Arrow keys move between items. Vertical
// (sidebar) and horizontal (bottom nav) groups share the same handler; both
// arrow axes work in both groups since the glyphs give no directional cue.
const NAV_ARROW = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

function navButtons(group) {
  return [...group.querySelectorAll('button')];
}

// Point the group's single Tab stop at its active button (or the first one).
export function rovingSync(group) {
  const btns = navButtons(group);
  if (!btns.length) return;
  const current = btns.find((b) => b.classList.contains('active')) ?? btns[0];
  for (const b of btns) b.tabIndex = b === current ? 0 : -1;
}

function rovingFocus(group, index) {
  const btns = navButtons(group);
  const i = ((index % btns.length) + btns.length) % btns.length; // wrapped
  for (const b of btns) b.tabIndex = b === btns[i] ? 0 : -1;
  btns[i].focus();
}

function setupRovingNav() {
  for (const group of document.querySelectorAll('.sidebar nav, .bottom-nav')) {
    if (group.dataset.roving) continue;
    group.dataset.roving = '1';
    rovingSync(group);
    group.addEventListener('keydown', (e) => {
      if (NAV_ARROW[e.key]) {
        e.preventDefault();
        const from = navButtons(group).indexOf(e.target.closest('button'));
        rovingFocus(group, from + NAV_ARROW[e.key]);
      } else if (e.key === 'Home') {
        e.preventDefault();
        rovingFocus(group, 0);
      } else if (e.key === 'End') {
        e.preventDefault();
        rovingFocus(group, navButtons(group).length - 1);
      }
    });
    // Clicking (or activating) an item makes it the group's Tab stop.
    group.addEventListener('click', (e) => {
      if (e.target.closest('button')) rovingSync(group);
    });
  }
}

export function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
  // The shell wraps every in-app screen; if a shell screen is being shown,
  // make sure the shell itself is unhidden (e.g. a screen shown before
  // enterApp() ran, or a page resumed in an inconsistent state).
  if ($(id).closest('#shell')) $('#shell').classList.remove('hidden');
  window.scrollTo(0, 0);
  // sync nav active states
  const map = { 'screen-home': 'home', 'screen-training': 'play', 'screen-game': 'play', 'screen-results': 'play', 'screen-campaign': 'campaign', 'screen-leaderboard': 'leaderboard', 'screen-profile': 'profile', 'screen-skins': 'skins' };
  const active = map[id.replace('#', '')];
  $$('.nav-btn, .bnav').forEach((b) => b.classList.toggle('active', b.dataset.nav === active));
  // Keep each nav group's roving Tab stop on the now-active page button.
  for (const group of document.querySelectorAll('.sidebar nav, .bottom-nav')) rovingSync(group);
  // Icon hydration is idempotent; running it here covers buttons that were
  // built dynamically since the last screen change.
  hydrateIcons();
}

// Boot: icon-only nav exists in static markup, so wiring it at module load
// (after DOM parse) is enough; groups are guarded against double-setup.
setupRovingNav();
