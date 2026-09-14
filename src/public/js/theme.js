// Pluggable theme module — all game-flavor strings live here, keyed by
// screen, so a whole theme (detective, space mission, treasure hunt…) can be
// swapped by replacing this one config object. No theme strings belong in the
// screen controllers; they import from this module.
//
// TODO(theme unlock): when a second theme ships, add its config here and wire
// POST /api/unlock-theme (stub already reserved server-side).

// Case-verdict threshold: score% at or above this reads "Case Solved".
// (A module constant rather than `this.` references — arrows inside an object
// literal do not bind to the object.)
export const SOLVED_THRESHOLD_PCT = 60;

export const theme = {
  id: 'case-files',
  name: 'Case Files',
  appName: 'Mind Game — Case Files',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
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

export function matchTheme(mode) {
  return theme.matchTypes[mode] ?? theme.matchTypes.quick;
}
