// Game-feel audio + haptics. Background music is a REAL track — "Thinking
// Music" by Kevin MacLeod (incompetech.com), CC BY 4.0, stored locally as
// /audio/intense-theme.mp3 and streamed via an <audio> element (looped). The
// UI click is Mixkit's free "Select click" (Mixkit License) stored as
// /audio/click.mp3; the remaining cues are synthesized with the Web Audio API.
// Volume model (all client-only, persisted in localStorage):
//   cra_music_volume  — 0..100 background-music level (0 == off); migrating
//                       from the old boolean cra_music_enabled (true → 70)
//   cra_sfx_volume    — 0..100 for ALL short UI sounds: click, correct,
//                       incorrect, combo, tick (0 == off)
//   cra_vibration_enabled — short haptic pulses via the Vibration API (bool)
// The two volumes are fully independent: muting one never affects the other.
// Every API call is feature-detected and fail-silent: unsupported browsers
// (and autoplay-blocking policies) must never throw.

const MUSIC_VOLUME_KEY = 'cra_music_volume';
const LEGACY_MUSIC_KEY = 'cra_music_enabled'; // pre-slider boolean; migrated once
const SFX_VOLUME_KEY = 'cra_sfx_volume';
const VIBRATION_KEY = 'cra_vibration_enabled';
const MUSIC_URL = '/audio/intense-theme.mp3';
const CLICK_URL = '/audio/click.mp3';

function storedNumber(key, fallback, { legacyBoolKey = null, legacyTrue = fallback, legacyFalse = 0 } = {}) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.min(100, Math.max(0, Math.round(n)));
    }
    // Migration: an older session stored a boolean instead of a level.
    if (legacyBoolKey) {
      const old = localStorage.getItem(legacyBoolKey);
      if (old !== null) return old === '1' ? legacyTrue : legacyFalse;
    }
  } catch { /* storage unavailable */ }
  return fallback;
}

function storeNumber(key, value) {
  try { localStorage.setItem(key, String(Math.min(100, Math.max(0, Math.round(value))))); } catch { /* unavailable */ }
}

function storedBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch { return fallback; }
}

function storeBool(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* unavailable */ }
}

// ── settings state ──────────────────────────────────────────────────────────
let musicVolume = 70; // 0..100
let sfxVolume = 70;   // 0..100
let vibrationOn = true;

export function getMusicVolume() { return musicVolume; }
export function getSfxVolume() { return sfxVolume; }
export function getVibrationEnabled() { return vibrationOn; }

export function setMusicVolume(level) {
  musicVolume = Math.min(100, Math.max(0, Math.round(Number(level) || 0)));
  storeNumber(MUSIC_VOLUME_KEY, musicVolume);
  applyMusicVolume();
  if (musicVolume > 0) startMusic(); else stopMusic();
}

export function setSfxVolume(level) {
  sfxVolume = Math.min(100, Math.max(0, Math.round(Number(level) || 0)));
  storeNumber(SFX_VOLUME_KEY, sfxVolume);
  if (clickEl) clickEl.volume = (sfxVolume / 100) * CLICK_GAIN;
}

// Back-compat boolean shims (legacy callers/third-party probes): true == >0.
export function getMusicEnabled() { return musicVolume > 0; }
export function getSfxEnabled() { return sfxVolume > 0; }
export function setMusicEnabled(on) { setMusicVolume(on ? (musicVolume > 0 ? musicVolume : 70) : 0); }
export function setSfxEnabled(on) { setSfxVolume(on ? (sfxVolume > 0 ? sfxVolume : 70) : 0); }

export function setVibrationEnabled(on) { vibrationOn = Boolean(on); storeBool(VIBRATION_KEY, vibrationOn); }

export function initAudioSettings() {
  musicVolume = storedNumber(MUSIC_VOLUME_KEY, 70, {
    legacyBoolKey: LEGACY_MUSIC_KEY, legacyTrue: 70, legacyFalse: 0,
  });
  sfxVolume = storedNumber(SFX_VOLUME_KEY, 70);
  vibrationOn = storedBool(VIBRATION_KEY, true);
  // Migration done: drop the legacy boolean so it can't resurface later.
  try { localStorage.removeItem(LEGACY_MUSIC_KEY); } catch { /* noop */ }
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
    if (ctxUnlocked && musicVolume > 0) startMusic();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

// ── short synthesized cues (gated by the SFX volume) ───────────────────────
function beep({ freq = 440, dur = 0.12, type = 'sine', gain = 0.08, sweepTo = null }) {
  if (sfxVolume <= 0) return;
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain * (sfxVolume / 100), c.currentTime);
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

// ── UI click: real sample (Mixkit "Select click"), replayable ──────────────
let clickEl = null;
let clickUnavailable = false;
const CLICK_GAIN = 0.5; // headroom so the sample never clips at 100%

export function playClick() {
  if (sfxVolume <= 0 || clickUnavailable || typeof window === 'undefined') return;
  const c = ensureCtx();
  if (!c || c.state !== 'running') return; // pre-gesture: stay silent, never throw
  try {
    if (!clickEl) {
      clickEl = new Audio(CLICK_URL);
      clickEl.preload = 'auto';
      clickEl.addEventListener('error', () => {
        clickUnavailable = true;
        clickEl = null;
      }, { once: true });
    }
    clickEl.volume = (sfxVolume / 100) * CLICK_GAIN;
    clickEl.currentTime = 0; // restart even if the previous play is tailing off
    const p = clickEl.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* fail silent */ });
  } catch { /* never break a click */ }
}

// Kept for the earlier settings UI: a tick is now the synthesized combo blip.
export function playTick() {
  beep({ freq: 660, dur: 0.05, type: 'sine', gain: 0.04 });
}

// ── background music: real track, streamed + looped, volume-scaled ─────────
let musicEl = null;
let musicUnavailable = false;

function applyMusicVolume() {
  if (musicEl) musicEl.volume = musicVolume / 100;
}

function startMusic() {
  if (musicVolume <= 0 || musicUnavailable || typeof window === 'undefined') return;
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
  applyMusicVolume();
  const p = musicEl.play();
  if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay policy; retried on the next gesture */ });
}

function stopMusic() {
  if (musicEl) {
    try { musicEl.pause(); } catch { /* noop */ }
  }
}

// ── vibration (feature-detected; silently no-ops on desktop) ───────────────
export function vibrate(pattern) {
  if (!vibrationOn) return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try { navigator.vibrate(pattern); } catch { /* unsupported */ }
}

// Introspection helper (used by verification; harmless in production).
export function getMusicDiagnostics() {
  return {
    musicVolume,
    sfxVolume,
    unavailable: musicUnavailable,
    hasElement: Boolean(musicEl),
    src: musicEl ? musicEl.src : null,
    loop: musicEl ? musicEl.loop : null,
    paused: musicEl ? musicEl.paused : null,
    volume: musicEl ? musicEl.volume : null,
    currentTime: musicEl ? musicEl.currentTime : null,
    readyState: musicEl ? musicEl.readyState : null,
  };
}
