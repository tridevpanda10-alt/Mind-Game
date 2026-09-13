// Engine tests: determinism, structural validation, and the quality gate
// (>=30 validated puzzles across all types and difficulties).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, makePuzzleBatch, validatePuzzle, recheckUniqueness, PUZZLE_TYPES, DIFFICULTIES, estimateSeconds } from '../src/server/puzzles/engine.js';
import { makeRng, seedFromString } from '../src/server/puzzles/rng.js';
import { scoreGuess } from '../src/server/puzzles/types/mastermind.js';

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
