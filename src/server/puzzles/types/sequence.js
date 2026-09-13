// Sequence Reasoning: find the next term in a numeric series.
// Difficulty scales rule complexity: arithmetic -> geometric -> alternating ->
// second-order (deltas grow) -> interleaved double series.

import { fmtNum } from '../helpers.js';
import { ensureUniqueOptions, shuffledOptions, numericDistractors } from '../options.js';

function arithmetic(rng, diff) {
  const a = 2 + Math.floor(rng() * (diff >= 3 ? 9 : 5));
  const d = 2 + Math.floor(rng() * (diff >= 4 ? 11 : 6));
  const n = 4 + (diff >= 2 ? 1 : 0);
  const seq = Array.from({ length: n + 1 }, (_, i) => a + d * i);
  return { seq, answer: a + d * n, rule: `add ${d} each step` };
}

function geometric(rng, diff) {
  const a = 2 + Math.floor(rng() * 4);
  const r = 2 + Math.floor(rng() * (diff >= 4 ? 3 : 2));
  const n = 4 + (diff >= 2 ? 1 : 0);
  const seq = Array.from({ length: n + 1 }, (_, i) => a * r ** i);
  return { seq, answer: a * r ** n, rule: `multiply by ${r} each step` };
}

function alternating(rng, diff) {
  const a = 3 + Math.floor(rng() * 6);
  const d1 = 2 + Math.floor(rng() * 5);
  const d2 = 5 + Math.floor(rng() * 8);
  const n = 4 + (diff >= 2 ? 1 : 0);
  const seq = [a];
  for (let i = 1; i <= n; i++) seq.push(seq[i - 1] + (i % 2 ? d1 : d2));
  return { seq, answer: seq[n], rule: `alternate adding ${d1} and ${d2}` };
}

function secondOrder(rng, diff) {
  const a = 1 + Math.floor(rng() * 4);
  const d0 = 2 + Math.floor(rng() * 4);
  const step = 1 + (diff >= 4 ? 2 : 1);
  const n = 4 + (diff >= 2 ? 1 : 0);
  const seq = [a];
  let d = d0;
  for (let i = 1; i <= n; i++) {
    seq.push(seq[i - 1] + d);
    d += step;
  }
  return { seq, answer: seq[n], rule: `differences grow by ${step} each step` };
}

function interleaved(rng, diff) {
  const a1 = 2 + Math.floor(rng() * 6);
  const d1 = 3 + Math.floor(rng() * 6);
  const a2 = 40 + Math.floor(rng() * 30);
  const d2 = -(3 + Math.floor(rng() * 5));
  const n = 4 + (diff >= 2 ? 1 : 0);
  const seq = [];
  let x = a1;
  let y = a2;
  for (let i = 0; i <= n; i++) {
    seq.push(x);
    seq.push(y);
    x += d1;
    y += d2;
  }
  // x now holds the next odd-position term; exclude it as a distractor so the
  // puzzle has exactly one defensible answer.
  return { seq, answer: seq[seq.length - 1], rule: `two interleaved series: odd positions +${d1}, even positions ${d2}`, exclude: [x] };
}

const FAMILIES = [arithmetic, geometric, alternating, secondOrder, interleaved];

export function generateSequence(rng, difficulty) {
  // harder difficulties draw from later (more complex) families
  const maxFam = Math.min(FAMILIES.length, 2 + Math.ceil(difficulty / 2));
  const famIdx = Math.min(maxFam - 1, Math.floor(rng() * maxFam));
  const { seq, answer, rule, exclude } = FAMILIES[famIdx](rng, difficulty);
  const shown = seq.slice(0, -1);
  if (shown.length < 4) return null;
  const spread = Math.max(3, Math.round(Math.abs(answer) * 0.12));
  const opts = ensureUniqueOptions(answer, numericDistractors(rng, answer, spread, exclude || []), fmtNum);
  if (!opts) return null;
  return {
    question: `What is the next number in the sequence? ${shown.join(', ')}, ?`,
    options: shuffledOptions(rng, opts).map(fmtNum),
    correct: fmtNum(answer),
    explanation: `The rule is: ${rule}. Terms: ${seq.map(fmtNum).join(', ')}. So the next term is ${fmtNum(answer)}.`,
    tags: ['sequence', ['arithmetic', 'geometric', 'alternating', 'second-order', 'interleaved'][famIdx]],
  };
}
