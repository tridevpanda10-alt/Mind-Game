// Scoring engine (server-only). The client may ESTIMATE, but the server
// computes the official result. Anti-cheat rules (impossible speed, expired
// challenges) are enforced where these functions are called, not here —
// this module stays pure and unit-testable.

export const MODES = { TRAINING: 'training', QUICK: 'quick', DAILY: 'daily', TOURNAMENT: 'tournament', CAMPAIGN: 'campaign' };

export const XP_PER_LEVEL = 500;
export function levelForXp(xp) {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}
export function levelProgress(xp) {
  const lvl = levelForXp(xp);
  const into = xp - (lvl - 1) * XP_PER_LEVEL;
  return { level: lvl, into, needed: XP_PER_LEVEL };
}

const BASE_POINTS = { rookie: 60, easy: 80, medium: 100, hard: 130, expert: 170, master: 220 };
const TIME_BONUS_MAX = 50;
const PAR_MULTIPLIER = 0.8; // fraction of par time at which bonus hits zero

export function pointsForPuzzle(difficulty, msTaken, parMs) {
  if (msTaken < 0) return 0;
  const base = BASE_POINTS[difficulty] ?? 100;
  if (!Number.isFinite(msTaken) || msTaken > 10 * 60 * 1000) return Math.round(base * 0.6); // slow floor
  const speed = Math.max(0, 1 - msTaken / (parMs * (1 + PAR_MULTIPLIER)));
  const bonus = Math.round(TIME_BONUS_MAX * speed);
  return base + bonus;
}

// Streak multiplier: 1.0 + 0.05 per consecutive correct, capped at +50%.
export function streakMultiplier(streak) {
  return Math.min(1.5, 1 + 0.05 * Math.max(0, streak));
}

export function scoreMatch(results, opts = {}) {
  // results: [{ difficulty, msTaken, correct, parMs }]
  // opts.combo (game-feel pack): when true, per-puzzle points ride the live
  // streak multiplier — 3-streak ≈ ×1.1, 5-streak ≈ ×1.2, capped at ×1.5.
  // A modest spice on top of the base scale; it can never dominate it.
  let score = 0;
  let streak = 0;
  for (const r of results) {
    if (!r.correct) {
      score -= 20; // wrong-answer penalty
      streak = 0;
      continue;
    }
    streak++;
    const pts = pointsForPuzzle(r.difficulty, r.msTaken, r.parMs);
    score += Math.round(pts * streakMultiplier(streak - 1));
  }
  if (!opts.combo) return Math.max(0, score);
  return Math.max(0, score + comboBonus(results));
}

// Combo bonus: small additive share of base points per correct answer that
// scales with how deep the run is — roughly +10% by a 3-streak, +20% by 5.
function comboBonus(results) {
  let streak = 0;
  let bonus = 0;
  for (const r of results) {
    if (!r.correct) {
      streak = 0;
      continue;
    }
    streak++;
    if (streak >= 2) bonus += Math.round((BASE_POINTS[r.difficulty] ?? 100) * Math.min(0.5, 0.05 * (streak - 1)));
  }
  return bonus;
}

export function xpForMatch(results, mode) {
  const correct = results.filter((r) => r.correct).length;
  const base = correct * 20;
  const modeBonus = mode === MODES.DAILY ? 50 : mode === MODES.QUICK ? 25 : 0;
  return base + modeBonus;
}

// Rating: ELO-style, provisional players get a larger K.
export function ratingUpdate(rating, opponentPoolAvg, scoreRatio, gamesPlayed) {
  const K = gamesPlayed < 10 ? 48 : gamesPlayed < 30 ? 32 : 24;
  const expected = 1 / (1 + 10 ** ((opponentPoolAvg - rating) / 400));
  const actual = Math.max(0, Math.min(1, scoreRatio));
  return Math.round(rating + K * (actual - expected));
}

// Daily challenge placement points (fixed pool scoring, server-side only).
export function dailyScoreToRatingDelta(dailyScore, poolTop) {
  if (dailyScore <= 0) return -8;
  if (poolTop > 0 && dailyScore >= poolTop) return +18;
  const ratio = poolTop > 0 ? dailyScore / poolTop : 0;
  return Math.round(-8 + 26 * ratio);
}

export const ACHIEVEMENTS = {
  FIRST_BLOOD: { id: 'first_blood', name: 'First Blood', desc: 'Complete your first competitive match', check: (s) => s.games >= 1 },
  FLAWLESS: { id: 'flawless', name: 'Flawless', desc: 'Finish a match with 100% accuracy', check: (s) => s.games >= 1 && s.lastAccuracy === 1 },
  STREAK_5: { id: 'streak_5', name: 'In the Zone', desc: '5 correct answers in a row', check: (s) => s.bestStreak >= 5 },
  STREAK_10: { id: 'streak_10', name: 'Unstoppable', desc: '10 correct answers in a row', check: (s) => s.bestStreak >= 10 },
  DAILY_DONE: { id: 'daily_done', name: 'Daily Devotee', desc: 'Complete a daily challenge', check: (s) => s.dailies >= 1 },
  XP_1000: { id: 'xp_1000', name: 'Dedicated', desc: 'Earn 1000 XP', check: (s) => s.xp >= 1000 },
  RATING_1100: { id: 'rating_1100', name: 'Rising Star', desc: 'Reach 1100 rating', check: (s) => s.rating >= 1100 },
  RATING_1300: { id: 'rating_1300', name: 'Contender', desc: 'Reach 1300 rating', check: (s) => s.rating >= 1300 },
  SPEED_DEMON: { id: 'speed_demon', name: 'Speed Demon', desc: 'Correct answer in under 5 seconds', check: (s) => s.fastestMs !== null && s.fastestMs < 5000 },
  ALL_TYPES: { id: 'all_types', name: 'Polymath', desc: 'Correct answer in every reasoning category', check: (s) => s.typesCorrect.size >= 9 },
};

export function evaluateAchievements(stats) {
  return Object.values(ACHIEVEMENTS).filter((a) => a.check(stats)).map((a) => a.id);
}
