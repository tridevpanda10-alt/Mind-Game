// Pluggable theme registry — all game-flavor strings live here, keyed by
// screen, so a whole theme (detective, space mission, treasure hunt…) swaps
// at runtime via setTheme(). No theme strings belong in the screen
// controllers; they import from this module.
//
// Every theme must implement the SAME shape (see caseFilesTheme below):
//   id, name, appName, tagline, palette (css data-theme value),
//   home{...}, match{...}, matchTypes{quick,daily,tournament,training},
//   screens{game,results}
// `theme` is a live ESM binding: importers see the active theme immediately
// after setTheme() — no re-import or reload needed.

const STORAGE_KEY = 'mindgame:theme';

// Case-verdict threshold: score% at or above this reads the "solved" verdict.
// Shared by both themes (a module constant — arrows in object literals don't
// bind `this` to the object).
export const SOLVED_THRESHOLD_PCT = 60;

// ── Case Files (detective) ────────────────────────────────────────────────
const caseFilesTheme = {
  id: 'case-files',
  name: 'Case Files',
  appName: 'Mind Game — Case Files',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
  // Value applied to <html data-theme>; style.css keys the palette off it.
  palette: 'detective',
  // Splash sequence words + logo line (read by app.js playSplash).
  splash: ['THINK.', 'ANALYZE.', 'SOLVE.'],
  // Home screen: card titles + bodies are rendered by home.js from here,
  // never hardcoded in index.html.
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
  // Match screen labels: progress wording + per-mode display name + intro.
  match: {
    progressLabel: (current, total) => `Clue ${current} of ${total}`,
    modeLabel: { daily: "Today's Case", quick: 'Field Case', ranked: 'Ranked Casework', tournament: 'Weekly Investigation', training: 'Training File' },
    caseIntroTitle: (caseNumber) => `Case #${String(caseNumber).padStart(3, '0')}`,
    caseIntroFlavor: 'A new case has landed on your desk. Study the clues, trust your reasoning, and crack it.',
    beginButton: 'Begin Investigation',
  },
  matchTypes: {
    quick: {
      title: 'Case 001: The Vanishing Pattern',
      flavor: 'A trail of broken sequences leads across the city. Follow the logic before it goes cold.',
      begin: 'Begin Investigation',
      noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    daily: {
      title: 'Case 002: The Midnight Ledger',
      flavor: 'Every detective in the precinct gets the same evidence today. One shot at the truth.',
      begin: 'Begin Investigation',
      noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    tournament: {
      title: 'Case 003: The Symposium Heist',
      flavor: 'This week all detectives work the same dossier. The sharpest mind takes the bounty.',
      begin: 'Join the Investigation',
      noun: 'clue',
      outro: { solved: 'Case Solved', partial: 'Case Reopened', unsolved: 'Case Unsolved' },
    },
    training: {
      title: 'Field Exercise',
      flavor: 'The range is open. Sharpen your reasoning — no rating on the line.',
      begin: 'Start Exercise',
      noun: 'exercise',
      outro: { solved: 'Exercise Complete', partial: 'Exercise Complete', unsolved: 'Exercise Complete' },
    },
  },
  screens: {
    game: {
      progress: (i, n) => `Clue ${i} of ${n}`,
      hintButton: 'Use Hint',
      hintCost: 5,
      hintTooltip: 'Eliminate one wrong option (does not reveal the answer)',
      skipButton: 'Skip Clue',
      skipCost: 15,
    },
    results: {
      solvedTitle: 'Case Solved',
      unsolvedTitle: 'Case Unsolved',
      solvedThresholdPct: SOLVED_THRESHOLD_PCT, // solvedTitle shown if score% >= this, else unsolvedTitle
      summaryLine: (correct, total) => `You cracked ${correct} of ${total} clues.`,
      // Case verdict from threshold above (training always completes).
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
};

// ── Space Mission ─────────────────────────────────────────────────────────
const spaceMissionTheme = {
  id: 'space-mission',
  name: 'Space Mission',
  appName: 'Mind Game — Space Mission',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
  palette: 'space',
  splash: ['COMPUTE.', 'NAVIGATE.', 'SOLVE.'],
  home: {
    welcomeBack: (name) => `Welcome back, Commander ${name}`,
    welcomeBackGuest: (name) => `Welcome back, ${name}`,
    dailyTitle: 'Daily Transmission',
    dailyBody: 'Every crew member receives the same transmission today. One official decode attempt.',
    tournamentTitle: 'Weekly Expedition',
    tournamentBody: (entry = 25) => `This week's expedition. Entry costs ${entry} 💎. Top commanders share the prize pool.`,
    quickMatchTitle: 'Sortie',
    quickMatchBody: '12 mixed diagnostics. Ranked. Beat your average.',
    rankedTitle: 'Ranked Flight Log',
    rankedBody: 'Sorties move your rating. Climb the board.',
    trainingTitle: 'Simulator Deck',
    trainingBody: 'Pick a system and difficulty. No rating risk in the sim.',
  },
  match: {
    progressLabel: (current, total) => `Diagnostic ${current} of ${total}`,
    modeLabel: { daily: 'Daily Transmission', quick: 'Sortie', ranked: 'Ranked Flight Log', tournament: 'Weekly Expedition', training: 'Simulator Run' },
    caseIntroTitle: (missionNumber) => `Mission #${String(missionNumber).padStart(3, '0')}`,
    caseIntroFlavor: 'A new mission has arrived on your console. Read the diagnostics, trust your reasoning, and bring the ship home.',
    beginButton: 'Begin Mission',
  },
  matchTypes: {
    quick: {
      title: 'Sortie 001: The Silent Array',
      flavor: 'The sensor array went dark mid-orbit. Trace the patterns before the window closes.',
      begin: 'Begin Mission',
      noun: 'diagnostic',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    daily: {
      title: 'Transmission 002: The Drifting Signal',
      flavor: 'Every crew member decodes the same signal today. One window. Make it count.',
      begin: 'Begin Mission',
      noun: 'diagnostic',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    tournament: {
      title: 'Expedition 003: The Kuiper Gauntlet',
      flavor: 'This week every commander flies the same gauntlet. The sharpest mind takes the bounty.',
      begin: 'Join the Expedition',
      noun: 'diagnostic',
      outro: { solved: 'Mission Complete', partial: 'Mission Extended', unsolved: 'Mission Failed' },
    },
    training: {
      title: 'Simulation',
      flavor: 'The sim deck is warm. Sharpen your systems — nothing on the line but skill.',
      begin: 'Start Simulation',
      noun: 'exercise',
      outro: { solved: 'Simulation Complete', partial: 'Simulation Complete', unsolved: 'Simulation Complete' },
    },
  },
  screens: {
    game: {
      progress: (i, n) => `Diagnostic ${i} of ${n}`,
      hintButton: 'Use Assist',
      hintCost: 5,
      hintTooltip: 'Onboard computer eliminates one wrong reading (never the answer)',
      skipButton: 'Abort Diagnostic',
      skipCost: 15,
    },
    results: {
      solvedTitle: 'Mission Complete',
      unsolvedTitle: 'Mission Failed',
      solvedThresholdPct: SOLVED_THRESHOLD_PCT,
      summaryLine: (correct, total) => `You cleared ${correct} of ${total} diagnostics.`,
      verdict: (acc, isTraining) => {
        if (isTraining) return 'Simulation Complete';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'Mission Complete' : 'Mission Failed';
      },
      verdictClass: (acc, isTraining) => {
        if (isTraining) return 'good';
        return acc * 100 >= SOLVED_THRESHOLD_PCT ? 'good' : 'bad';
      },
      cluesLabel: (n) => (n === 1 ? 'diagnostic' : 'diagnostics'),
    },
  },
};

// ── Registry + active-theme plumbing ──────────────────────────────────────
export const THEMES = {
  'case-files': caseFilesTheme,
  'space-mission': spaceMissionTheme,
};

// Deep-copy that shares function references (themes hold functions, which
// structuredClone rejects but which are immutable and safe to share).
function deepCopy(t) {
  if (Array.isArray(t)) return t.map(deepCopy);
  if (t && typeof t === 'object') {
    const out = {};
    for (const k of Object.keys(t)) out[k] = deepCopy(t[k]);
    return out;
  }
  return t;
}

// Live binding; mutated in place by setTheme(). Starts as a COPY so a theme
// swap can never mutate the registry entries themselves.
export const theme = deepCopy(caseFilesTheme);

export function getThemeId() {
  return theme.id;
}

export function listThemes() {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, tagline: t.tagline }));
}

// Swap the active theme at runtime: updates the live `theme` binding, the
// <html data-theme> palette hook, and localStorage, then fires a
// `theme:change` event so on-screen views can re-render their labels.
export function setTheme(id) {
  const next = THEMES[id];
  if (!next) return false;
  if (theme.id === id) return true;
  Object.assign(theme, deepCopy(next)); // copy: never mutate the registry
  // Drop keys the previous theme had but this one doesn't (defensive —
  // both current themes share a shape, but a future theme may slim down).
  for (const k of Object.keys(theme)) {
    if (!(k in next) && k !== 'id') delete theme[k];
  }
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* unavailable */ }
  if (typeof document !== 'undefined') applyThemeDocument(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('theme:change', { detail: { id } }));
  return true;
}

// Apply the palette + document title for a theme. Safe to call before the
// app shell renders (boot) — it only touches <html> and <title>.
export function applyThemeDocument(t) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t.palette;
  document.title = t.appName;
}

// Boot-time restore: read the stored preference and activate it BEFORE any
// screen renders (prevents a flash of the default theme). Returns the theme.
export function initTheme() {
  let id = 'case-files';
  try { id = localStorage.getItem(STORAGE_KEY) ?? id; } catch { /* private mode */ }
  const t = THEMES[id] ?? caseFilesTheme;
  Object.assign(theme, deepCopy(t));
  applyThemeDocument(t);
  return t;
}

export function matchTheme(mode) {
  return theme.matchTypes[mode] ?? theme.matchTypes.quick;
}
