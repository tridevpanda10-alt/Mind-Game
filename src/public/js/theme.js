// ── Mind Game: skins (story worlds) + color scheme (dark/light) ───────────
// Two INDEPENDENT systems:
//   1. Color scheme: dark (default) / light — pure palette, free, client-only,
//      persisted as `cra_color_scheme` (works for guests; no server call).
//   2. World skins: story content + accent flourish + optional palette tint.
//      Ownership is SERVER-validated (POST /api/skins/unlock); the active skin
//      id is stored locally as `cra_active_skin` and re-validated against the
//      server's ownership list at boot (fallback: detective).
//
// Every skin must implement the SAME shape. `theme` is a live ESM binding:
// importers see the active skin immediately after setActiveSkin().

const SKIN_KEY = 'cra_active_skin';
const LEGACY_SKIN_KEY = 'mindgame:theme'; // pre-registry preference; migrated once
export const DEFAULT_SKIN = 'detective';

// Case-verdict threshold: score% at or above this reads the "solved" verdict.
// (Module constant — arrows in object literals don't bind `this`.)
export const SOLVED_THRESHOLD_PCT = 60;

// ── detective (free, default) ─────────────────────────────────────────────
const detective = {
  id: 'detective',
  label: 'Case Files',
  free: true,
  priceInDiamonds: 0,
  appName: 'Mind Game — Case Files',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
  palette: 'detective',
  splash: ['THINK.', 'ANALYZE.', 'SOLVE.'],
  home: {
    welcomeBack: (name) => `Welcome back, Detective ${name}`,
    welcomeBackGuest: (name) => `Welcome back, ${name}`,
    dailyTitle: "Today's Case",
    dailyBody: 'Every detective faces the same case today. One official attempt.',
    tournamentTitle: 'Weekly Investigation',
    tournamentBody: (entry = 25) => `This week's case. Entry costs ${entry} 💎. Top detectives share the prize pool.`,
    quickMatchTitle: 'Field Case',
    quickMatchBody: '12 mixed clues. Ranked. Beat your average.',
    rankedTitle: 'Ranked Casework',
    rankedBody: 'Ranked cases move your rating. Climb the board.',
    trainingTitle: 'Training Files',
    trainingBody: 'Pick a reasoning skill and difficulty. No rating risk.',
  },
  match: {
    progressLabel: (current, total) => `Clue ${current} of ${total}`,
    modeLabel: { daily: "Today's Case", quick: 'Field Case', ranked: 'Ranked Casework', tournament: 'Weekly Investigation', training: 'Training File' },
    caseIntroTitle: (n) => `Case #${String(n).padStart(3, '0')}`,
    caseIntroFlavor: 'A new case has landed on your desk. Study the clues, trust your reasoning, and crack it.',
    beginButton: 'Begin Investigation',
  },
  matchTypes: {
    quick: {
      title: 'Case 001: The Vanishing Pattern',
      flavor: 'A trail of broken sequences leads across the city. Follow the logic before it goes cold.',
      begin: 'Begin Investigation', noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    daily: {
      title: 'Case 002: The Midnight Ledger',
      flavor: 'Every detective in the precinct gets the same evidence today. One shot at the truth.',
      begin: 'Begin Investigation', noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    tournament: {
      title: 'Case 003: The Symposium Heist',
      flavor: 'This week all detectives work the same dossier. The sharpest mind takes the bounty.',
      begin: 'Join the Investigation', noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    training: {
      title: 'Field Exercise',
      flavor: 'The range is open. Sharpen your reasoning — no rating on the line.',
      begin: 'Start Exercise', noun: 'exercise',
      outro: { solved: 'Exercise Complete', partial: 'Exercise Complete', unsolved: 'Exercise Complete' },
    },
  },
  screens: {
    game: {
      progress: (i, n) => `Clue ${i} of ${n}`,
      hintButton: 'Use Hint', hintCost: 5,
      hintTooltip: 'Eliminate one wrong option (does not reveal the answer)',
      skipButton: 'Skip Clue', skipCost: 15,
    },
    results: {
      solvedTitle: 'Case Solved',
      unsolvedTitle: 'Case Unsolved',
      solvedThresholdPct: SOLVED_THRESHOLD_PCT,
      summaryLine: (c, t) => `You cracked ${c} of ${t} clues.`,
      verdict: (acc, isTraining) => {
        if (isTraining) return 'Exercise Complete';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'Case Solved' : 'Case Unsolved';
      },
      verdictClass: (acc, isTraining) => {
        if (isTraining) return 'good';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'good' : 'bad';
      },
      cluesLabel: (n) => (n === 1 ? 'clue' : 'clues'),
    },
  },
  accentClass: 'skin-detective',
};

// ── space (paid) ──────────────────────────────────────────────────────────
const space = {
  id: 'space',
  label: 'Deep Space Mission',
  free: false,
  priceInDiamonds: 120,
  appName: 'Mind Game — Deep Space Mission',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
  palette: 'space',
  splash: ['COMPUTE.', 'NAVIGATE.', 'SOLVE.'],
  home: {
    welcomeBack: (name) => `Welcome back, Commander ${name}`,
    welcomeBackGuest: (name) => `Welcome back, ${name}`,
    dailyTitle: "Today's Transmission",
    dailyBody: 'Every crew member decodes the same transmission today. One official attempt.',
    tournamentTitle: 'Weekly Deep-Space Run',
    tournamentBody: (entry = 25) => `This week's mission. Entry costs ${entry} 💎. Top navigators share the prize pool.`,
    quickMatchTitle: 'Field Mission',
    quickMatchBody: '12 mixed signals. Ranked. Beat your average.',
    rankedTitle: 'Ranked Missions',
    rankedBody: 'Ranked missions move your rating. Climb the board.',
    trainingTitle: 'Simulation Bay',
    trainingBody: 'Pick a reasoning skill and difficulty. No rating risk.',
  },
  match: {
    progressLabel: (c, t) => `Signal ${c} of ${t}`,
    modeLabel: { daily: "Today's Transmission", quick: 'Field Mission', ranked: 'Ranked Mission', tournament: 'Weekly Deep-Space Run', training: 'Simulation' },
    caseIntroTitle: (n) => `Mission #${String(n).padStart(3, '0')}`,
    caseIntroFlavor: 'Deep space control has a new transmission. Decode it before the signal decays.',
    beginButton: 'Launch Mission',
  },
  matchTypes: {
    quick: {
      title: 'Sortie 001: The Silent Array',
      flavor: 'The sensor array went dark mid-orbit. Trace the signals before the window closes.',
      begin: 'Launch Mission', noun: 'signal',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    daily: {
      title: 'Transmission 002: The Drifting Signal',
      flavor: 'Every crew member decodes the same signal today. One window. Make it count.',
      begin: 'Launch Mission', noun: 'signal',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    tournament: {
      title: 'Expedition 003: The Kuiper Gauntlet',
      flavor: 'This week every navigator flies the same gauntlet. The sharpest mind takes the bounty.',
      begin: 'Join the Run', noun: 'signal',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    training: {
      title: 'Simulation Bay',
      flavor: 'The sim is warm. Sharpen your systems — nothing on the line but skill.',
      begin: 'Start Simulation', noun: 'exercise',
      outro: { solved: 'Simulation Complete', partial: 'Simulation Complete', unsolved: 'Simulation Complete' },
    },
  },
  screens: {
    game: {
      progress: (i, n) => `Signal ${i} of ${n}`,
      hintButton: 'Use Assist', hintCost: 5,
      hintTooltip: 'Onboard computer eliminates one wrong reading (never the answer)',
      skipButton: 'Abort Signal', skipCost: 15,
    },
    results: {
      solvedTitle: 'Mission Complete',
      unsolvedTitle: 'Mission Failed',
      solvedThresholdPct: SOLVED_THRESHOLD_PCT,
      summaryLine: (c, t) => `You decoded ${c} of ${t} signals.`,
      verdict: (acc, isTraining) => {
        if (isTraining) return 'Simulation Complete';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'Mission Complete' : 'Mission Failed';
      },
      verdictClass: (acc, isTraining) => {
        if (isTraining) return 'good';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'good' : 'bad';
      },
      cluesLabel: (n) => (n === 1 ? 'signal' : 'signals'),
    },
  },
  accentClass: 'skin-space',
};

// ── treasure (paid) ───────────────────────────────────────────────────────
const treasure = {
  id: 'treasure',
  label: 'Treasure Hunt',
  free: false,
  priceInDiamonds: 120,
  appName: 'Mind Game — Treasure Hunt',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
  palette: 'treasure',
  splash: ['CHART.', 'DECIPHER.', 'DISCOVER.'],
  home: {
    welcomeBack: (name) => `Ahoy, Captain ${name}`,
    welcomeBackGuest: (name) => `Welcome back, ${name}`,
    dailyTitle: "Today's Map",
    dailyBody: 'Every crew reads the same map today. One official attempt.',
    tournamentTitle: 'Weekly Expedition',
    tournamentBody: (entry = 25) => `This week's hunt. Entry costs ${entry} 💎. Top captains share the treasure.`,
    quickMatchTitle: 'Field Expedition',
    quickMatchBody: '12 mixed riddles. Ranked. Beat your average.',
    rankedTitle: 'Ranked Expeditions',
    rankedBody: 'Ranked expeditions move your rating. Climb the board.',
    trainingTitle: 'Training Cove',
    trainingBody: 'Pick a reasoning skill and difficulty. No rating risk.',
  },
  match: {
    progressLabel: (c, t) => `Riddle ${c} of ${t}`,
    modeLabel: { daily: "Today's Map", quick: 'Field Expedition', ranked: 'Ranked Expedition', tournament: 'Weekly Expedition', training: 'Training' },
    caseIntroTitle: (n) => `Map #${String(n).padStart(3, '0')}`,
    caseIntroFlavor: 'A weathered map has surfaced. Follow the clues before the tide turns.',
    beginButton: 'Set Sail',
  },
  matchTypes: {
    quick: {
      title: 'Chart 001: The Sunken Ledger',
      flavor: 'A ledger from a wrecked merchantman lists what was never found. Read it well.',
      begin: 'Set Sail', noun: 'riddle',
      outro: { solved: 'Treasure Found', partial: 'Current Shift', unsolved: 'Treasure Lost' },
    },
    daily: {
      title: 'Chart 002: The Gilded Buoy',
      flavor: 'Every crew reads the same chart today. One tide. Make it count.',
      begin: 'Set Sail', noun: 'riddle',
      outro: { solved: 'Treasure Found', partial: 'Current Shift', unsolved: 'Treasure Lost' },
    },
    tournament: {
      title: 'Expedition 003: The Corsair Cache',
      flavor: 'This week every captain hunts the same cache. The sharpest mind takes the prize.',
      begin: 'Join the Expedition', noun: 'riddle',
      outro: { solved: 'Treasure Found', partial: 'Current Shift', unsolved: 'Treasure Lost' },
    },
    training: {
      title: 'Training Cove',
      flavor: 'Calm waters, no current. Sharpen your wits — no gold on the line.',
      begin: 'Enter the Cove', noun: 'exercise',
      outro: { solved: 'Cove Cleared', partial: 'Cove Cleared', unsolved: 'Cove Cleared' },
    },
  },
  screens: {
    game: {
      progress: (i, n) => `Riddle ${i} of ${n}`,
      hintButton: 'Use Hint', hintCost: 5,
      hintTooltip: 'The first mate crosses out one wrong answer (never the right one)',
      skipButton: 'Skip Riddle', skipCost: 15,
    },
    results: {
      solvedTitle: 'Treasure Found',
      unsolvedTitle: 'Treasure Lost',
      solvedThresholdPct: SOLVED_THRESHOLD_PCT,
      summaryLine: (c, t) => `You uncovered ${c} of ${t} riddles.`,
      verdict: (acc, isTraining) => {
        if (isTraining) return 'Cove Cleared';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'Treasure Found' : 'Treasure Lost';
      },
      verdictClass: (acc, isTraining) => {
        if (isTraining) return 'good';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'good' : 'bad';
      },
      cluesLabel: (n) => (n === 1 ? 'riddle' : 'riddles'),
    },
  },
  accentClass: 'skin-treasure',
};

// ── registry + lookup ─────────────────────────────────────────────────────
export const THEMES = {
  detective,
  space,
  treasure,
};

export function getTheme(id) {
  return THEMES[id] ?? THEMES.detective;
}

// Deep-copy that shares function references (skins hold functions; clone is
// defensive so a skin swap can never mutate registry entries).
function deepCopy(t) {
  if (Array.isArray(t)) return t.map(deepCopy);
  if (t && typeof t === 'object') {
    const out = {};
    for (const k of Object.keys(t)) out[k] = deepCopy(t[k]);
    return out;
  }
  return t;
}

// Live binding; mutated in place by setActiveSkin().
export const theme = deepCopy(detective);

export function getActiveSkinId() {
  return theme.id;
}

// Apply palette + title + body accent class for a skin. Safe pre-paint.
export function applySkinDocument(t) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t.palette;
  document.title = t.appName;
  document.body.classList.remove('skin-detective', 'skin-space', 'skin-treasure');
  document.body.classList.add(t.accentClass);
}

// Swap the active skin locally (NO purchase here — ownership is enforced by
// POST /api/skins/unlock and re-checked at boot). Fires `skin:change`.
export function setActiveSkin(id) {
  const next = getTheme(id);
  if (next.id !== id) return false; // unknown id → refused, state unchanged
  Object.assign(theme, deepCopy(next));
  for (const k of Object.keys(theme)) {
    if (!(k in next) && k !== 'id') delete theme[k];
  }
  try { localStorage.setItem(SKIN_KEY, id); } catch { /* unavailable */ }
  applySkinDocument(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('skin:change', { detail: { id } }));
  return true;
}

// Boot-time restore. `unlockedIds` (optional) is the server's ownership list;
// when absent we apply optimistically and re-validate later via
// validateActiveSkin().
export function initTheme(unlockedIds = null) {
  let id = DEFAULT_SKIN;
  try {
    id = localStorage.getItem(SKIN_KEY) ?? localStorage.getItem(LEGACY_SKIN_KEY) ?? id;
    if (localStorage.getItem(LEGACY_SKIN_KEY) != null) {
      localStorage.removeItem(LEGACY_SKIN_KEY); // one-time migration
      localStorage.setItem(SKIN_KEY, id);
    }
  } catch { /* unavailable */ }
  // 'case-files' was the pre-registry id for the detective skin.
  if (id === 'case-files') id = DEFAULT_SKIN;
  if (Array.isArray(unlockedIds) && !unlockedIds.includes(id)) id = DEFAULT_SKIN;
  const t = getTheme(id);
  Object.assign(theme, deepCopy(t));
  applySkinDocument(t);
  return t;
}

// Re-validate the locally stored choice against server ownership; falls back
// to the default skin (and re-applies) on mismatch. Returns the active id.
export function validateActiveSkin(unlockedIds) {
  if (!Array.isArray(unlockedIds) || !unlockedIds.length) return theme.id;
  if (!unlockedIds.includes(theme.id)) {
    setActiveSkin(DEFAULT_SKIN);
    try { localStorage.setItem(SKIN_KEY, DEFAULT_SKIN); } catch { /* unavailable */ }
  }
  return theme.id;
}

// ── color scheme (independent of skins) ───────────────────────────────────
const SCHEME_KEY = 'cra_color_scheme';

export function getScheme() {
  return document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark';
}

// Flip dark ↔ light. Entirely client-side; works for guests; persists.
export function toggleScheme() {
  const next = getScheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.scheme = next;
  try { localStorage.setItem(SCHEME_KEY, next); } catch { /* unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('scheme:change', { detail: { scheme: next } }));
  return next;
}

// Boot-time restore — call BEFORE first paint to avoid a scheme flash.
export function initScheme() {
  if (typeof document === 'undefined') return 'dark';
  let scheme = 'dark';
  try { scheme = localStorage.getItem(SCHEME_KEY) ?? scheme; } catch { /* unavailable */ }
  document.documentElement.dataset.scheme = scheme === 'light' ? 'light' : 'dark';
  return scheme;
}

// Compatibility exports (older call sites): matchTheme(mode) etc.
export function matchTheme(mode) {
  return theme.matchTypes[mode] ?? theme.matchTypes.quick;
}
