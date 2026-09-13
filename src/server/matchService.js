// Match service: creates matches, holds the answer key server-side for the
// lifetime of the match, validates answer submissions, and finalizes scores.
// The client NEVER receives `correct` or the seed. Explanations unlock per
// puzzle after that puzzle is submitted.

import { makePuzzleBatch } from './puzzles/engine.js';
import { MODES, scoreMatch, xpForMatch, ratingUpdate, dailyScoreToRatingDelta, evaluateAchievements, levelProgress } from './scoring.js';
import { newMatchId } from './auth.js';
import { q, all, one, transaction, logAudit } from './db.js';
import { getDb } from './db.js';

// Puzzle counts per mode. Quick/ranked matches are 12 clues; the daily stays
// short (5-7) so every player can realistically finish it once per day.
export const PUZZLES_PER_MODE = { training: 10, quick: 12, daily: 6, tournament: 6 };
export const TRAINING_MAX = 30;
// Kept as an alias for backwards compatibility (tests/older callers).
export const PUZZLES_PER_MATCH = PUZZLES_PER_MODE.quick;

// In-memory answer keys. Dev-scale single process: intentional, bounded by
// the TTL sweep. Multi-instance production would move this to the DB.
const activeKeys = new Map();
const KEY_TTL_MS = 60 * 60 * 1000;
// Max 1 hint per puzzle, max 1 skip per match (Phase 3 limits).
const HINT_LIMIT_PER_PUZZLE = 1;
const SKIP_LIMIT = 1;

function storeKey(matchId, puzzles) {
  activeKeys.set(matchId, { puzzles, created: Date.now(), usedSkips: 0, hints: new Map() });
  if (activeKeys.size > 800) {
    const now = Date.now();
    for (const [k, v] of activeKeys) {
      if (now - v.created > KEY_TTL_MS) activeKeys.delete(k);
    }
  }
}

export function takeKey(matchId) {
  const entry = activeKeys.get(matchId);
  if (entry && Date.now() - entry.created > KEY_TTL_MS) {
    activeKeys.delete(matchId);
    return null;
  }
  return entry ?? null;
}

function dropKey(matchId) {
  activeKeys.delete(matchId);
}

export function buildDailyTypes(day) {
  // deterministic type mix per day; all nine types rotate over the week
  const allTypes = ['pattern', 'sequence', 'matrix', 'deduction', 'conditional', 'number', 'operator', 'spatial', 'mastermind'];
  return allTypes.slice(0, 4 + (day.length % 3));
}

// Daily keeps 5-7 puzzles: short on purpose so everyone can finish it daily.
export const DAILY_COUNT = PUZZLES_PER_MODE.daily;
export function dailyCount() {
  return DAILY_COUNT;
}

// Weekly tournament: one fixed seeded puzzle set per week (same length as a
// daily case). The caller supplies the week seed; entry costs diamonds.
export function startTournamentMatch({ playerId, seed }) {
  const allTypes = ['pattern', 'sequence', 'matrix', 'deduction', 'conditional', 'number', 'operator', 'spatial', 'mastermind'];
  return startMatch({ playerId, mode: MODES.TOURNAMENT, seed, types: allTypes, difficulty: 'medium' });
}

// Quick/ranked length: 12 clues (raised from the original flat 5).
export function puzzlesForMode(mode) {
  return PUZZLES_PER_MODE[mode] ?? PUZZLES_PER_MODE.training;
}

// Create a match row and hold its answer key. Returns public puzzle list.
export function startMatch({ playerId, mode, seed, types, difficulty, dailyDay = null, count = null }) {
  const matchId = newMatchId();
  const seedUsed = seed ?? ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  // Training is player-chosen (default 10, capped at 30); ranked modes use fixed per-mode counts.
  const requested = mode === MODES.TRAINING ? (Number.isInteger(count) ? Math.max(1, Math.min(TRAINING_MAX, count)) : PUZZLES_PER_MODE.training) : puzzlesForMode(mode);
  const puzzleList = makePuzzleBatch(types, difficulty, seedUsed, requested);
  if (!puzzleList || puzzleList.length === 0) return { error: 'generation_failed' };

  const now = Date.now();
  q(
    `INSERT INTO match_players (match_id, player_id, mode, seed, status, started_at, puzzle_ids)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [matchId, playerId, mode, seedUsed, now, JSON.stringify(puzzleList.map((p) => p.puzzleId))],
  );
  storeKey(matchId, puzzleList);
  logAudit(playerId, 'match_start', { matchId, mode });

  return {
    matchId,
    puzzles: puzzleList.map((p) => puzzlePayload(p)),
    parTimes: puzzleList.map((p) => parFor(p)),
  };
}

function parFor(p) {
  return estimateSecondsFor(p.type, p.difficulty) * 1000;
}

function estimateSecondsFor(type, difficulty) {
  const BASE = { pattern: 30, sequence: 30, matrix: 40, deduction: 50, conditional: 50, number: 45, operator: 25, spatial: 45, mastermind: 75 };
  const idx = { rookie: 1, easy: 2, medium: 3, hard: 4, expert: 5, master: 6 }[difficulty] ?? 3;
  return Math.round((BASE[type] ?? 40) * (0.7 + 0.15 * idx));
}

// Public shape of a puzzle (no answer, no explanation until revealed)
export function puzzlePayload(p, revealed = false) {
  const out = {
    puzzleId: p.puzzleId,
    type: p.type,
    difficulty: p.difficulty,
    question: p.question,
    options: p.options,
  };
  if (p.matrix) out.matrix = p.matrix;
  if (p.rows) out.rows = p.rows;
  if (p.grid) out.grid = p.grid;
  if (p.kind) out.kind = p.kind;
  if (revealed) {
    out.correct = p.correct;
    out.explanation = p.explanation;
  }
  return out;
}

const MIN_PLAUSIBLE_MS = 1200; // faster than this per puzzle = flagged

// Submit one answer. Validates ownership, index order, duplicates, plausibility.
export function submitAnswer({ matchId, playerId, puzzleIndex, answer, msTaken }) {
  const entry = takeKey(matchId);
  if (!entry) return { error: 'match_not_found_or_expired' };

  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp) return { error: 'not_your_match' };
  if (mp.status !== 'active') return { error: 'match_closed' };

  const idx = Number(puzzleIndex);
  if (!Number.isInteger(idx) || idx < 0) return { error: 'bad_index' };
  const dupe = one('SELECT 1 FROM answers WHERE match_id = ? AND puzzle_index = ?', [matchId, idx]);
  if (dupe) return { error: 'already_answered' };

  const ms = Number(msTaken);
  // <500ms is not a human solve: rejected outright (anti-cheat floor)
  if (!Number.isFinite(ms) || ms < 500 || ms > 30 * 60 * 1000) return { error: 'bad_time' };

  const puzzles = entry.puzzles;
  if (idx >= puzzles.length) return { error: 'bad_index' };
  const puzzle = puzzles[idx];
  const isCorrect = String(answer) === String(puzzle.correct);

  const now = Date.now();
  transaction(() => {
    q(
      `INSERT INTO answers (match_id, player_id, puzzle_index, puzzle_id, submitted, is_correct, ms_taken, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchId, playerId, idx, puzzle.puzzleId, String(answer).slice(0, 64), isCorrect ? 1 : 0, Math.round(ms), now],
    );
    // per-type aggregate
    const existing = one('SELECT * FROM match_types WHERE match_id = ? AND puzzle_type = ?', [matchId, puzzle.type]);
    if (existing) {
      q('UPDATE match_types SET correct = correct + ?, total = total + ?, ms_total = ms_total + ? WHERE match_id = ? AND puzzle_type = ?', [isCorrect ? 1 : 0, 1, Math.round(ms), matchId]);
    } else {
      q('INSERT INTO match_types (match_id, puzzle_type, correct, total, ms_total) VALUES (?, ?, ?, ?, ?)', [matchId, puzzle.type, isCorrect ? 1 : 0, 1, Math.round(ms)]);
    }
  });

  if (ms < MIN_PLAUSIBLE_MS) {
    logAudit(playerId, 'suspicious_fast_answer', { matchId, idx, ms });
  }

  return {
    correct: isCorrect,
    correctAnswer: puzzle.correct,
    explanation: puzzle.explanation,
    suspicious: ms < MIN_PLAUSIBLE_MS,
  };
}

// Finish a match: compute official score, XP, rating, achievements.
// Reveal one INCORRECT option to eliminate on the current puzzle. Never
// reveals the answer. Costs diamonds (server-validated), max 1 per puzzle.
export function hintPuzzle({ matchId, playerId, puzzleIndex }) {
  const entry = takeKey(matchId);
  if (!entry) return { error: 'match_not_found_or_expired' };
  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp) return { error: 'not_your_match' };
  if (mp.status !== 'active') return { error: 'match_closed' };
  const idx = Number(puzzleIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= entry.puzzles.length) return { error: 'bad_index' };
  const dup = one('SELECT 1 FROM answers WHERE match_id = ? AND puzzle_index = ?', [matchId, idx]);
  if (dup) return { error: 'already_answered' };
  const used = entry.hints.get(idx) ?? 0;
  if (used >= HINT_LIMIT_PER_PUZZLE) return { error: 'hint_limit_reached' };

  const puzzle = entry.puzzles[idx];
  const eliminate = pickElimination(puzzle, entry, idx);
  const now = Date.now();
  const out = transaction(() => {
    const p = one('SELECT diamonds FROM players WHERE player_id = ?', [playerId]);
    if (!p) return { error: 'no_player' };
    if (p.diamonds < DIAMONDS.hint) return { error: 'insufficient_diamonds' };
    q('UPDATE players SET diamonds = diamonds - ? WHERE player_id = ? AND diamonds >= ?', [DIAMONDS.hint, playerId, DIAMONDS.hint]);
    q('INSERT INTO hints (match_id, player_id, puzzle_index, eliminated, created_at) VALUES (?, ?, ?, ?, ?)', [matchId, playerId, idx, String(eliminate).slice(0, 64), now]);
    entry.hints.set(idx, used + 1);
    return { ok: true, eliminate, cost: DIAMONDS.hint, diamondsLeft: p.diamonds - DIAMONDS.hint };
  });
  if (out.ok) logAudit(playerId, 'hint_used', { matchId, idx, cost: DIAMONDS.hint });
  return out;
}

// Deterministically choose an incorrect option to eliminate (never the answer).
function pickElimination(puzzle, entry, idx) {
  const correct = String(puzzle.correct);
  const ids = puzzle.options.map((o) => String(typeof o === 'object' && o !== null ? o.id : o));
  const wrong = ids.filter((id) => id !== correct);
  if (!wrong.length) return null;
  wrong.sort();
  const slot = (entry.hints.get(idx) ?? 0) % wrong.length;
  return wrong[slot];
}

export function puzzlesRemaining({ matchId, playerId }) {
  const entry = takeKey(matchId);
  if (!entry) return null;
  const mp = one('SELECT status, started_at FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp || mp.status !== 'active') return null;
  const answered = one('SELECT COUNT(*) AS n FROM answers WHERE match_id = ?', [matchId]).n;
  return { remaining: Math.max(0, entry.puzzles.length - answered) };
}

export function finishMatch({ matchId, playerId }) {
  const entry = takeKey(matchId);
  if (!entry) return { error: 'match_not_found_or_expired' };
  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp) return { error: 'not_your_match' };
  if (mp.status !== 'active') return { error: 'already_finished' };

  const answers = all('SELECT * FROM answers WHERE match_id = ?', [matchId]);
  const puzzles = entry.puzzles;
  const byIndex = new Map(answers.map((a) => [a.puzzle_index, a]));
  const results = puzzles.map((p, i) => {
    const a = byIndex.get(i);
    return {
      difficulty: p.difficulty,
      msTaken: a ? a.ms_taken : 0,
      correct: a ? Boolean(a.is_correct) : false,
      parMs: estimateSecondsFor(p.type, p.difficulty) * 1000,
    };
  });

  const score = scoreMatch(results);
  const correctCount = results.filter((r) => r.correct).length;
  const totalCount = puzzles.length;
  const elapsed = results.reduce((acc, r) => acc + r.msTaken, 0);
  const xp = xpForMatch(results, mp.mode);
  const now = Date.now();

  const out = transaction(() => {
    const player = one('SELECT * FROM players WHERE player_id = ?', [playerId]);
    if (!player) return { error: 'no_player' };

    const ratingBefore = player.rating;
    let ratingAfter = ratingBefore;
    if (mp.mode === 'quick') {
      ratingAfter = ratingUpdate(ratingBefore, 1000, correctCount / totalCount, /*gamesPlayed*/ 0);
    } else if (mp.mode === 'daily') {
      ratingAfter = ratingBefore + dailyScoreToRatingDelta(score, 0);
    }

    q(
      `UPDATE match_players SET status='completed', finished_at=?, score=?, correct_count=?, total_count=?, elapsed_ms=?, xp_awarded=?, rating_before=?, rating_after=? WHERE match_id=? AND player_id=?`,
      [now, score, correctCount, totalCount, elapsed, xp, ratingBefore, ratingAfter, matchId, playerId],
    );
    q('UPDATE players SET xp = xp + ?, rating = ?, total_correct = total_correct + ?, total_answered = total_answered + ?, last_active_at = ?, diamonds = diamonds + ? WHERE player_id = ?', [xp, ratingAfter, correctCount, totalCount, now, earnedDiamonds(correctCount, totalCount), playerId]);
    if (mp.mode === 'daily') {
      q('UPDATE players SET dailies_done = dailies_done + 1 WHERE player_id = ?', [playerId]);
      q("UPDATE daily_usage SET status = 'completed' WHERE match_id = ? AND player_id = ?", [matchId, playerId]);
    }
    if (mp.mode === 'tournament') {
      q("UPDATE tournament_entries SET status = 'completed' WHERE match_id = ? AND player_id = ?", [matchId, playerId]);
    }

    // aggregate per-type stats
    const typeRows = all('SELECT * FROM match_types WHERE match_id = ?', [matchId]);
    for (const t of typeRows) {
      const ps = one('SELECT * FROM player_type_stats WHERE player_id = ? AND puzzle_type = ?', [playerId, t.puzzle_type]);
      if (ps) {
        q('UPDATE player_type_stats SET correct = correct + ?, total = total + ?, ms_total = ms_total + ? WHERE player_id = ? AND puzzle_type = ?', [t.correct, t.total, t.ms_total, playerId, t.puzzle_type]);
      } else {
        q('INSERT INTO player_type_stats (player_id, puzzle_type, correct, total, ms_total) VALUES (?, ?, ?, ?, ?)', [playerId, t.puzzle_type, t.correct, t.total, t.ms_total]);
      }
    }

    // persist fastest correct answer and best streak on the player record
    const correctMs = answers.filter((a) => a.is_correct).map((a) => a.ms_taken);
    if (correctMs.length) {
      const matchFastest = Math.min(...correctMs);
      q('UPDATE players SET fastest_ms = ? WHERE player_id = ? AND (fastest_ms IS NULL OR fastest_ms > ?)', [matchFastest, playerId, matchFastest]);
    }
    const matchBestStreak = computeStreak(puzzles, byIndex);
    q('UPDATE players SET best_streak = MAX(best_streak, ?) WHERE player_id = ?', [matchBestStreak, playerId]);

    // achievements
    const agg = one('SELECT COUNT(*) AS games FROM match_players WHERE player_id = ? AND status = ? AND mode != ?', [playerId, 'completed', 'training']);
    const fastest = one('SELECT MIN(ms_taken) AS f FROM answers WHERE player_id = ? AND is_correct = 1', [playerId]);
    const typesCorrect = all('SELECT puzzle_type FROM player_type_stats WHERE player_id = ? AND correct > 0', [playerId]).map((r) => r.puzzle_type);
    const stats = {
      games: agg.games,
      lastAccuracy: totalCount ? correctCount / totalCount : 0,
      bestStreak: computeStreak(puzzles, byIndex),
      dailies: mp.mode === 'daily' ? (player.dailies_done ?? 0) + 1 : player.dailies_done ?? 0,
      xp: (player.xp ?? 0) + xp,
      rating: ratingAfter,
      fastestMs: fastest?.f ?? null,
      typesCorrect: new Set(typesCorrect),
    };
    const earned = evaluateAchievements(stats);
    for (const id of earned) {
      q('INSERT OR IGNORE INTO achievements (player_id, achievement, unlocked_at) VALUES (?, ?, ?)', [playerId, id, now]);
    }
    logAudit(playerId, 'match_finish', { matchId, score });

    return {
      score,
      correctCount,
      totalCount,
      elapsedMs: elapsed,
      xpAwarded: xp,
      diamondsAwarded: earnedDiamonds(correctCount, totalCount),
      ratingBefore,
      ratingAfter,
      newLevel: levelProgress((player.xp ?? 0) + xp).level,
      newAchievements: earned,
      results: puzzles.map((p, i) => {
        const a = byIndex.get(i);
        return {
          puzzleId: p.puzzleId,
          type: p.type,
          difficulty: p.difficulty,
          yourAnswer: a ? a.submitted : null,
          correctAnswer: p.correct,
          explanation: p.explanation,
          isCorrect: a ? Boolean(a.is_correct) : false,
          msTaken: a ? a.ms_taken : 0,
        };
      }),
    };
  });
  dropKey(matchId);
  return out;
}

function computeStreak(puzzles, byIndex) {
  let best = 0;
  let cur = 0;
  for (let i = 0; i < puzzles.length; i++) {
    const a = byIndex.get(i);
    if (a && a.is_correct) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
}

// ── Diamonds economy (server-side only; client never sends a balance) ─────
export const DIAMONDS = { perCorrect: 2, perfectBonus: 10, hint: 5, skip: 15, dailyLogin: 5, adReward: 5, tournamentEntry: 25, referralBonus: 20 };

export function earnedDiamonds(correctCount, totalCount) {
  if (!totalCount) return 0;
  return correctCount * DIAMONDS.perCorrect + (correctCount === totalCount ? DIAMONDS.perfectBonus : 0);
}

// Skip the current puzzle: scored as incorrect, costs diamonds. One per match.
// The answer key entry keeps the authoritative skip/hint state per puzzle.
export function skipPuzzle({ matchId, playerId, puzzleIndex }) {
  const entry = takeKey(matchId);
  if (!entry) return { error: 'match_not_found_or_expired' };
  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp) return { error: 'not_your_match' };
  if (mp.status !== 'active') return { error: 'match_closed' };
  const idx = Number(puzzleIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= entry.puzzles.length) return { error: 'bad_index' };
  const dup = one('SELECT 1 FROM answers WHERE match_id = ? AND puzzle_index = ?', [matchId, idx]);
  if (dup) return { error: 'already_answered' };
  if (entry.usedSkips >= SKIP_LIMIT) return { error: 'skip_limit_reached' };

  const puzzle = entry.puzzles[idx];
  const now = Date.now();
  const out = transaction(() => {
    const p = one('SELECT diamonds FROM players WHERE player_id = ?', [playerId]);
    if (!p) return { error: 'no_player' };
    if (p.diamonds < DIAMONDS.skip) return { error: 'insufficient_diamonds' };
    q('UPDATE players SET diamonds = diamonds - ? WHERE player_id = ? AND diamonds >= ?', [DIAMONDS.skip, playerId, DIAMONDS.skip]);
    q(
      `INSERT INTO answers (match_id, player_id, puzzle_index, puzzle_id, submitted, is_correct, ms_taken, answered_at)
       VALUES (?, ?, ?, ?, 'skipped', 0, 0, ?)`,
      [matchId, playerId, idx, puzzle.puzzleId, now],
    );
    const existing = one('SELECT * FROM match_types WHERE match_id = ? AND puzzle_type = ?', [matchId, puzzle.type]);
    if (existing) {
      q('UPDATE match_types SET total = total + ? WHERE match_id = ? AND puzzle_type = ?', [1, matchId]);
    } else {
      q('INSERT INTO match_types (match_id, puzzle_type, correct, total, ms_total) VALUES (?, ?, 0, 1, 0)', [matchId, puzzle.type]);
    }
    entry.usedSkips++;
    return { ok: true, cost: DIAMONDS.skip, diamondsLeft: p.diamonds - DIAMONDS.skip };
  });
  if (out.ok) logAudit(playerId, 'skip_puzzle', { matchId, idx, cost: DIAMONDS.skip });
  return out;
}

// Daily login bonus: +5 diamonds once per calendar day (server-side guard
// against double-claiming via the players.last_login_bonus_at column).
export function awardDailyLoginBonus(playerId) {
  const today = new Date().toISOString().slice(0, 10);
  const out = transaction(() => {
    const p = one('SELECT last_login_bonus_at FROM players WHERE player_id = ?', [playerId]);
    if (!p) return { ok: false };
    if (p.last_login_bonus_at === today) return { ok: false, reason: 'already_claimed' };
    q('UPDATE players SET diamonds = diamonds + ?, last_login_bonus_at = ? WHERE player_id = ?', [DIAMONDS.dailyLogin, today, playerId]);
    q('INSERT INTO economy_log (at, player_id, kind, amount, day) VALUES (?, ?, ?, ?, ?)', [Date.now(), playerId, 'login_bonus', DIAMONDS.dailyLogin, today]);
    return { ok: true, amount: DIAMONDS.dailyLogin };
  });
  if (out.ok) logAudit(playerId, 'login_bonus', { amount: DIAMONDS.dailyLogin });
  return out;
}

// Abandon: mark closed without scoring (used on explicit exit)
export function abandonMatch(matchId, playerId) {
  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  if (!mp || mp.status !== 'active') return { ok: false };
  q(`UPDATE match_players SET status='abandoned', finished_at=? WHERE match_id=? AND player_id=?`, [Date.now(), matchId, playerId]);
  dropKey(matchId);
  logAudit(playerId, 'match_abandon', { matchId });
  return { ok: true };
}
