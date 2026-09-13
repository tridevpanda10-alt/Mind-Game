// Engine tests: determinism, structural validation, and the quality gate
// (>=30 validated puzzles across all types and difficulties).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, makePuzzleBatch, validatePuzzle, recheckUniqueness, PUZZLE_TYPES, DIFFICULTIES, estimateSeconds, puzzleSignature } from '../src/server/puzzles/engine.js';
import { makeRng, seedFromString } from '../src/server/puzzles/rng.js';
import { scoreGuess } from '../src/server/puzzles/types/mastermind.js';
import { PUZZLES_PER_MODE, PUZZLES_PER_MATCH, puzzlesForMode, dailyCount, buildDailyTypes } from '../src/server/matchService.js';

test('seeded RNG is deterministic', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.deepEqual(seqA, seqB);
  const s1 = seedFromString('daily-2026-09-11');
  const s2 = seedFromString('daily-2026-09-11');
  assert.equal(s1, s2);
});

test('seedFromString spreads different inputs', () => {
  const a = seedFromString('daily-2026-09-11');
  const b = seedFromString('daily-2026-09-12');
  assert.notEqual(a, b);
});

test('estimateSeconds scales with difficulty', () => {
  assert.ok(estimateSeconds('sequence', 'rookie') < estimateSeconds('sequence', 'master'));
  assert.ok(estimateSeconds('sequence', 'rookie') > 10);
});

test('validatePuzzle rejects malformed puzzles', () => {
  assert.ok(validatePuzzle(null));
  assert.ok(validatePuzzle({ puzzleId: 'x', type: 'sequence', difficulty: 'easy' }));
  assert.ok(validatePuzzle({
    puzzleId: 'x', type: 'sequence', difficulty: 'easy', question: 'A perfectly valid question here',
    options: ['1', '2', '3', '4'], correct: '5', explanation: 'An explanation long enough.',
  }));
  const p = makePuzzle('sequence', 'easy', 999);
  assert.ok(p);
  assert.equal(validatePuzzle(p), null);
});

test('every type generates a valid puzzle at every difficulty', () => {
  for (const type of PUZZLE_TYPES) {
    for (const difficulty of DIFFICULTIES) {
      let found = null;
      for (let seed = 1; seed <= 50 && !found; seed++) {
        found = makePuzzle(type, difficulty, seed * 7919);
      }
      assert.ok(found, `${type}/${difficulty} produced no valid puzzle in 50 seeds`);
      assert.equal(validatePuzzle(found), null);
      assert.equal(recheckUniqueness(found), null, `${type}/${difficulty} determinism`);
    }
  }
});

test('quality gate: at least 30 validated puzzles with 4 unique options each', () => {
  let count = 0;
  const seen = new Set();
  for (const type of PUZZLE_TYPES) {
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 1; seed <= 30; seed++) {
        const p = makePuzzle(type, difficulty, seed * 104729);
        if (!p) continue;
        count++;
        seen.add(p.question);
        assert.ok(new Set(p.options).size === p.options.length, 'duplicate options');
        const optIds = p.options.map((o) => (typeof o === 'object' && o !== null ? String(o.id) : String(o)));
        assert.ok(optIds.includes(String(p.correct)), 'correct among options');
      }
    }
  }
  assert.ok(count >= 30, `only ${count} validated puzzles`);
  assert.ok(seen.size >= 30, `only ${seen.size} distinct questions`);
});

test('makePuzzleBatch is deterministic and validated', () => {
  const types = ['sequence', 'matrix', 'deduction', 'number', 'operator'];
  const a = makePuzzleBatch(types, 'medium', 424242, 6);
  const b = makePuzzleBatch(types, 'medium', 424242, 6);
  assert.equal(a.length, 6, `expected 6 puzzles, got ${a.length}`);
  assert.deepEqual(a.map((p) => p.puzzleId), b.map((p) => p.puzzleId));
  for (const p of a) assert.equal(validatePuzzle(p), null);
});

test('mastermind scoreGuess is correct', () => {
  assert.deepEqual(scoreGuess(['R', 'G', 'B'], ['R', 'B', 'G']), { exact: 1, partial: 2 });
  assert.deepEqual(scoreGuess(['R', 'R', 'G'], ['R', 'R', 'R']), { exact: 2, partial: 0 });
  assert.deepEqual(scoreGuess(['R', 'G', 'B'], ['G', 'R', 'Y']), { exact: 0, partial: 2 });
});

// ── Phase 1: per-mode pacing ──────────────────────────────────────────────
test('per-mode puzzle counts: quick 12, daily 5-7, training default 10 max 30', () => {
  assert.equal(PUZZLES_PER_MODE.quick, 12);
  assert.equal(PUZZLES_PER_MODE.daily, dailyCount());
  assert.ok(PUZZLES_PER_MODE.daily >= 5 && PUZZLES_PER_MODE.daily <= 7, `daily count ${PUZZLES_PER_MODE.daily} must be 5-7`);
  assert.equal(PUZZLES_PER_MODE.training, 10);
  assert.equal(puzzlesForMode('quick'), 12);
  assert.equal(PUZZLES_PER_MATCH, 12, 'back-compat alias tracks quick');
});

test('quick batches return 12 unique validated puzzles', () => {
  const allTypes = ['pattern', 'sequence', 'matrix', 'deduction', 'conditional', 'number', 'operator', 'spatial', 'mastermind'];
  const batch = makePuzzleBatch(allTypes, 'medium', 20260914, PUZZLES_PER_MODE.quick);
  assert.equal(batch.length, 12);
  const sigs = new Set(batch.map(puzzleSignature));
  assert.equal(sigs.size, 12, 'no identical puzzle twice in one match');
  for (const p of batch) assert.equal(validatePuzzle(p), null);
});

test('daily batches stay short and unique for the day type mix', () => {
  const day = '2026-09-14';
  const types = buildDailyTypes(day);
  const batch = makePuzzleBatch(types, 'medium', seedFromString('seed:' + day), PUZZLES_PER_MODE.daily);
  assert.ok(batch.length >= 5 && batch.length <= 7);
  const sigs = new Set(batch.map(puzzleSignature));
  assert.equal(sigs.size, batch.length, 'daily puzzles must be unique');
});

test('batch uniqueness holds even with a single narrow type', () => {
  const batch = makePuzzleBatch(['operator'], 'easy', 424242, 12);
  assert.equal(batch.length, 12);
  assert.equal(new Set(batch.map(puzzleSignature)).size, 12, 'same type 12x must still be 12 distinct puzzles');
});

test('same seed still reproduces the same batch (determinism preserved)', () => {
  const types = ['sequence', 'matrix', 'deduction', 'number', 'operator'];
  const a = makePuzzleBatch(types, 'medium', 424242, 6);
  const b = makePuzzleBatch(types, 'medium', 424242, 6);
  assert.deepEqual(a.map((p) => p.puzzleId), b.map((p) => p.puzzleId));
});
