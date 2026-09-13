// Pluggable theme module — all game-flavor strings live here, keyed by
// screen, so a whole theme (detective, space mission, treasure hunt…) can be
// swapped by replacing this one config object. No theme strings belong in the
// screen controllers; they import from this module.
//
// TODO(theme unlock): when a second theme ships, add its config here and wire
// POST /api/unlock-theme (stub already reserved server-side).

export const theme = {
  id: 'case-files',
  name: 'Case Files',
  tagline: 'Pure mental skill. Server-verified. Fair for everyone.',
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
      // Case verdict thresholds: >=80% solved, >=50% reopened, else unsolved.
      verdict: (acc, isTraining) => {
        if (isTraining) return 'Exercise Complete';
        if (acc >= 0.8) return 'Case Solved';
        if (acc >= 0.5) return 'Case Reopened';
        return 'Case Unsolved';
      },
      verdictClass: (acc, isTraining) => {
        if (isTraining) return 'good';
        if (acc >= 0.8) return 'good';
        if (acc >= 0.5) return 'warn';
        return 'bad';
      },
      cluesLabel: (n) => (n === 1 ? 'clue' : 'clues'),
    },
  },
};

export function matchTheme(mode) {
  return theme.matchTypes[mode] ?? theme.matchTypes.quick;
}
