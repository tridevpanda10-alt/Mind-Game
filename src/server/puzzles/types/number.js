// Number Logic: digit-constraint problems ("two-digit number where ...").
// ADVERSARIAL QA NOTE: naive value ranges almost never admit a unique
// solution (digit sum s has many solutions; reverse-diff 9k needs the tens
// digit pair gap k AND a fixed digit sum). So we PRECOMPUTE, for each
// constraint kind, exactly which values yield exactly one two-digit solution,
// and only build puzzles from that provably-unique pool. Two constraints are
// then intersected via brute force as before.

import { shuffledOptions } from '../options.js';

function digitSum(x) { return Math.floor(x / 10) + (x % 10); }
function digitProduct(x) { return Math.floor(x / 10) * (x % 10); }
function reversed(x) { return (x % 10) * 10 + Math.floor(x / 10); }

function solutionsFor(test) {
  const out = [];
  for (let x = 10; x <= 99; x++) if (test(x)) out.push(x);
  return out;
}

const TESTS = {
  sum: (v) => (x) => digitSum(x) === v,
  product: (v) => (x) => digitProduct(x) === v,
  revdiff: (v) => (x) => reversed(x) - x === v,
  revsum: (v) => (x) => x - reversed(x) === v,
};

const TEXT = {
  sum: (v) => `the sum of its digits is ${v}`,
  product: (v) => `the product of its digits is ${v}`,
  revdiff: (v) => `reversing its digits gives a number ${v} larger`,
  revsum: (v) => `reversing its digits gives a number ${v} smaller`,
};

export function generateNumber(rng, difficulty) {
  const useTwo = difficulty >= 3;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (useTwo) {
      // intersect two constraint kinds; keep only value pairs with exactly
      // one common solution, computed by brute force
      const kinds = ['sum', 'product', 'revdiff', 'revsum'];
      const k1 = kinds[Math.floor(rng() * kinds.length)];
      let k2 = kinds[Math.floor(rng() * kinds.length)];
      if (k2 === k1) k2 = kinds[(kinds.indexOf(k1) + 1) % kinds.length];
      // pick value for k1 from values with 2..6 solutions (so intersection
      // can be exactly 1), then find k2 values pinning it
      const v1 = 3 + Math.floor(rng() * 17);
      const s1 = solutionsFor(TESTS[k1](v1));
      if (s1.length < 2 || s1.length > 6) continue;
      const v2s = [];
      for (let v2 = 1; v2 <= 81; v2++) {
        const inter = s1.filter((x) => TESTS[k2](v2)(x));
        if (inter.length === 1) v2s.push(v2);
      }
      if (v2s.length === 0) continue;
      const v2 = v2s[Math.floor(rng() * v2s.length)];
      const answer = s1.filter((x) => TESTS[k2](v2)(x))[0];
      const clue = `${TEXT[k1](v1)} and ${TEXT[k2](v2)}`;
      const spread = Math.max(4, Math.round(answer * 0.2));
      const distractors = new Set();
      let guard = 0;
      while (distractors.size < 6 && guard++ < 60) {
        const delta = (Math.floor(rng() * 2) * 2 - 1) * (1 + Math.floor(rng() * spread));
        const v = answer + delta;
        if (v >= 10 && v <= 99) distractors.add(v);
      }
      const opts = [answer, ...distractors].slice(0, 4);
      if (opts.length < 4) continue;
      return {
        question: `I am a two-digit number. ${clue[0].toUpperCase()}${clue.slice(1)}. What number am I?`,
        options: shuffledOptions(rng, opts).map(String),
        correct: String(answer),
        explanation: `Only ${answer} satisfies both conditions; every other two-digit number fails at least one.`,
        tags: ['number', k1, k2],
      };
    }
    // single constraint: only values with EXACTLY ONE solution are eligible
    const kindKeys = ['sum', 'product', 'revdiff', 'revsum'];
    const kind = kindKeys[Math.floor(rng() * kindKeys.length)];
    const uniqueValues = [];
    for (let v = 1; v <= 81; v++) {
      if (solutionsFor(TESTS[kind](v)).length === 1) uniqueValues.push(v);
    }
    if (uniqueValues.length === 0) continue;
    const value = uniqueValues[Math.floor(rng() * uniqueValues.length)];
    const answer = solutionsFor(TESTS[kind](value))[0];
    const clue = TEXT[kind](value);
    const spread = Math.max(4, Math.round(answer * 0.2));
    const distractors = new Set();
    let guard = 0;
    while (distractors.size < 6 && guard++ < 60) {
      const delta = (Math.floor(rng() * 2) * 2 - 1) * (1 + Math.floor(rng() * spread));
      const v = answer + delta;
      if (v >= 10 && v <= 99) distractors.add(v);
    }
    const opts = [answer, ...distractors].slice(0, 4);
    if (opts.length < 4) continue;
    return {
      question: `I am a two-digit number. ${clue[0].toUpperCase()}${clue.slice(1)}. What number am I?`,
      options: shuffledOptions(rng, opts).map(String),
      correct: String(answer),
      explanation: `Only ${answer} satisfies the condition; every other two-digit number fails it.`,
      tags: ['number', kind],
    };
  }
  return null;
}
