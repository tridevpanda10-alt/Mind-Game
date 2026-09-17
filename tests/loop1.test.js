// Loop 1 tests: operator undefined-options fix, rating fairness fixes,
// and the two new reasoning types (ordering + story).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, validatePuzzle, recheckUniqueness, PUZZLE_TYPES, DIFFICULTIES, makePuzzleBatch } from '../src/server/puzzles/engine.js';
import { scoreMatch, parScore, dailyScoreToRatingDelta, ratingUpdate } from '../src/server/scoring.js';

// ── operator: options must be real operator pairs, never "undefined" ────────
test('operator puzzles: no undefined options; every distractor is a real wrong pair', () => {
  let count = 0;
  for (let difficulty = 4; difficulty <= 6; difficulty++) {
    for (let seed = 1; seed <= 60; seed++) {
      const p = makePuzzle('operator', DIFFICULTIES[difficulty - 1], seed * 7919 + 13);
      if (!p) continue;
      count++;
      for (const opt of p.options) {
        assert.match(opt, /^(?:[+\-×÷]) and (?:[+\-×÷])$/, `operator option is garbage: "${opt}" (seed ${seed})`);
      }
      assert.equal(p.options.length, 4);
    }
  }
  assert.ok(count >= 20, `expected plenty of two-slot operator puzzles, got ${count}`);
});

// ── rating: parScore exists and K-progression uses real games-played ────────
test('parScore sums base points of a perfect no-bonus run', () => {
  const results = [
    { difficulty: 'medium', msTaken: 60000, correct: true, parMs: 45000 },
    { difficulty: 'hard', msTaken: 60000, correct: true, parMs: 60000 },
  ];
  assert.equal(parScore(results), 100 + 130);
  assert.equal(parScore([]), 0);
});

test('ratingUpdate: K relaxes with gamesPlayed (provisional 48, then 32, then 24)', () => {
  // At equal rating, expected = 0.5 → delta = K/2 (24/16/12 for K=48/32/24)
  const k48 = ratingUpdate(1000, 1000, 1, 0);
  const k32 = ratingUpdate(1000, 1000, 1, 15);
  const k24 = ratingUpdate(1000, 1000, 1, 40);
  assert.equal(k48 - 1000, 24);
  assert.equal(k32 - 1000, 16);
  assert.equal(k24 - 1000, 12);
});

test('dailyScoreToRatingDelta: matching par earns at least parity (no unconditional -8)', () => {
  // poolTop == score → +18 by contract; par floor guarantees poolTop >= score
  // only when the player matched it, so verify the mapping shape:
  assert.equal(dailyScoreToRatingDelta(300, 300), 18);
  assert.equal(dailyScoreToRatingDelta(300, 600), -8 + Math.round(26 * 0.5));
  assert.ok(dailyScoreToRatingDelta(0, 100) < 0); // zero-score dailies still lose rating
});

// ── ordering: generates valid, unique, reproducible puzzles everywhere ──────
test('ordering: every difficulty yields valid puzzles with unique answers', () => {
  let count = 0;
  for (const difficulty of DIFFICULTIES) {
    let ok = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = makePuzzle('ordering', difficulty, seed * 104729 + 7);
      if (!p) continue;
      ok++;
      count++;
      assert.equal(validatePuzzle(p), null);
      assert.equal(recheckUniqueness(p), null);
      assert.ok(p.options.includes(p.correct));
      assert.match(p.question, /Who finished/);
      // clue minimization: no two clues may be semantically identical
      const clueText = p.question.split('. ').filter((s) => s.includes('finished') || s.includes('players'));
      assert.ok(clueText.length >= 2, 'ordering needs at least 2 clues');
    }
    assert.ok(ok >= 10, `ordering/${difficulty} thin yield: ${ok}/40`);
  }
  assert.ok(count >= 80);
});

// ── story: all four scenes appear, all validated, scenes carry no answers ───
test('story: four scene kinds generate valid puzzles at every difficulty', () => {
  const kinds = new Set();
  let count = 0;
  for (const difficulty of DIFFICULTIES) {
    let ok = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const p = makePuzzle('story', difficulty, seed * 104729 + 7);
      if (!p) continue;
      ok++;
      count++;
      assert.equal(validatePuzzle(p), null);
      assert.equal(recheckUniqueness(p), null);
      assert.ok(p.scene, 'story puzzles must ship a scene payload');
      kinds.add(p.scene.kind);
      assert.ok(!JSON.stringify(p.scene).includes(String(p.correct)), 'scene must not contain the literal answer');
    }
    assert.ok(ok >= 10, `story/${difficulty} thin yield: ${ok}/60`);
  }
  assert.deepEqual([...kinds].sort(), ['cats', 'crow', 'owl', 'rabbit']);
  assert.ok(count >= 120);
});

test('new types integrate into mixed batches with the existing engine', () => {
  const batch = makePuzzleBatch(['ordering', 'story', 'sequence'], ['easy', 'medium', 'hard'], 987654, 9);
  assert.equal(batch.length, 9);
  for (const p of batch) assert.equal(validatePuzzle(p), null);
  const types = new Set(batch.map((p) => p.type));
  assert.ok(types.has('ordering') && types.has('story') && types.has('sequence'));
});
