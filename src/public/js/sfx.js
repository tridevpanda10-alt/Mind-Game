// Game-feel audio + haptics. SFX (correct/incorrect/combo/tick) are still
// generated at runtime with the Web Audio API; the background music is a REAL
// track — "Thinking Music" by Kevin MacLeod (incompetech.com), licensed under
// CC BY 4.0, stored locally as /audio/intense-theme.mp3 and streamed via an
// <audio> element (looped, no external CDN, nothing copyrighted).
// Three independent, client-only settings (persisted in localStorage):
//   cra_music_enabled      — looping background track (default on)
//   cra_sfx_enabled        — correct/incorrect cues (default on)
//   cra_vibration_enabled  — short haptic pulses via the Vibration API (default on)
// Every API call is feature-detected and fail-silent: unsupported browsers
// (and autoplay-blocking policies) must never throw.

const MUSIC_KEY = 'cra_music_enabled';
const SFX_KEY = 'cra_sfx_enabled';
const VIBRATION_KEY = 'cra_vibration_enabled';

function stored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch { return fallback; }
}

function store(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* unavailable */ }
}

// ── settings accessors ─────────────────────────────────────────────────────
let musicOn = true;
let sfxOn = true;
let vibrationOn = true;

export function getMusicEnabled() { return musicOn; }
export function getSfxEnabled() { return sfxOn; }
export function getVibrationEnabled() { return vibrationOn; }

export function setMusicEnabled(on) {
  musicOn = Boolean(on);
  store(MUSIC_KEY, musicOn);
  if (musicOn) startMusic(); else stopMusic();
}
export function setSfxEnabled(on) { sfxOn = Boolean(on); store(SFX_KEY, sfxOn); }
export function setVibrationEnabled(on) { vibrationOn = Boolean(on); store(VIBRATION_KEY, vibrationOn); }

export function initAudioSettings() {
  musicOn = stored(MUSIC_KEY, true);
  sfxOn = stored(SFX_KEY, true);
  vibrationOn = stored(VIBRATION_KEY, true);
}

// ── audio context (lazily created; unlocked by the first user gesture) ─────
let ctx = null;
let ctxUnlocked = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

function resumeCtx() {
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === 'suspended') c.resume().catch(() => {});
  ctxUnlocked = c.state === 'running';
  return ctxUnlocked;
}

// Browsers block audio before any interaction; hook once, fail silently.
export function registerFirstGesture() {
  const unlock = () => {
    resumeCtx();
    if (ctxUnlocked && musicOn) startMusic();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

function beep({ freq = 440, dur = 0.12, type = 'sine', gain = 0.08, sweepTo = null }) {
  if (!sfxOn) return;
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur + 0.02);
  } catch { /* audio must never break gameplay */ }
}

// Phase 3 cues: bright two-note rise for correct; low fall for wrong.
export function sfxCorrect() {
  beep({ freq: 523.25, dur: 0.09, type: 'triangle', gain: 0.07 });
  setTimeout(() => beep({ freq: 783.99, dur: 0.14, type: 'triangle', gain: 0.07 }), 90);
}
export function sfxWrong() {
  beep({ freq: 220, dur: 0.22, type: 'sawtooth', gain: 0.05, sweepTo: 110 });
}
export function sfxCombo() {
  beep({ freq: 659.25, dur: 0.07, type: 'square', gain: 0.05 });
  setTimeout(() => beep({ freq: 987.77, dur: 0.1, type: 'square', gain: 0.05 }), 70);
}
// Tiny confirmation click for settings toggles.
export function playTick() {
  beep({ freq: 660, dur: 0.05, type: 'sine', gain: 0.04 });
}

// ── background music: real track, streamed + looped ────────────────────────
// "Thinking Music" — Kevin MacLeod (incompetech.com), CC BY 4.0.
const MUSIC_URL = '/audio/intense-theme.mp3';
let musicEl = null;
let musicUnavailable = false;

function startMusic() {
  if (!musicOn || musicUnavailable || typeof window === 'undefined') return;
  const c = ensureCtx();
  if (!c || c.state !== 'running') {
    // Not unlocked yet: registerFirstGesture() will call startMusic() again.
    return;
  }
  if (!musicEl) {
    try {
      musicEl = new Audio(MUSIC_URL);
      musicEl.loop = true;
      musicEl.preload = 'auto';
      musicEl.volume = 0.3;
      musicEl.addEventListener('error', () => {
        // Missing/corrupt file: give up quietly, SFX keep working.
        musicUnavailable = true;
        musicEl = null;
      }, { once: true });
    } catch {
      musicUnavailable = true;
      return;
    }
  }
  const p = musicEl.play();
  if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy; retried on the next gesture */ });
}

function stopMusic() {
  if (musicEl) {
    try { musicEl.pause(); } catch { /* noop */ }
  }
}

// Introspection helper (used by tests/verification; harmless in production):
// reports what the music element is actually doing.
export function getMusicDiagnostics() {
  return {
    enabled: musicOn,
    unavailable: musicUnavailable,
    hasElement: Boolean(musicEl),
    src: musicEl ? musicEl.src : null,
    loop: musicEl ? musicEl.loop : null,
    paused: musicEl ? musicEl.paused : null,
    currentTime: musicEl ? musicEl.currentTime : null,
    readyState: musicEl ? musicEl.readyState : null,
  };
}

// ── vibration (feature-detected; silently no-ops on desktop) ───────────────
export function vibrate(pattern) {
  if (!vibrationOn) return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try { navigator.vibrate(pattern); } catch { /* unsupported */ }
}
