// Operator Logic: replace @ with one of +, -, ×, ÷ so that the equation
// holds, using exact rational-free arithmetic (integer division only when
// exact). Difficulty adds a second operator slot at higher levels.

import { shuffledOptions } from '../options.js';

function applyOp(x, op, y) {
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/':
      if (y === 0 || x % y !== 0) return NaN; // exact division only
      return x / y;
  }
}

function display(op) {
  return op === '*' ? '×' : op === '/' ? '÷' : op;
}

// Evaluate "a o1 b o2 c" with normal precedence (×,÷ before +,-).
// NaN means the expression is undefined (non-exact division or ÷0).
function evalPair(a, o1, b, o2, c) {
  const hi1 = o1 === '*' || o1 === '/';
  const hi2 = o2 === '*' || o2 === '/';
  if (hi1 || !hi2) {
    const v1 = applyOp(a, o1, b);
    return applyOp(v1, o2, c);
  }
  const v2 = applyOp(b, o2, c);
  return applyOp(a, o1, v2);
}

// All operator pairs (o1, o2) such that "a o1 b o2 c" evaluates to d.
function solutions2(a, b, c, d) {
  const found = [];
  for (const o1 of ['+', '-', '*', '/']) {
    for (const o2 of ['+', '-', '*', '/']) {
      const lhs = evalPair(a, o1, b, o2, c);
      if (!Number.isNaN(lhs) && lhs === d) found.push([o1, o2]);
    }
  }
  return found;
}

export function generateOperator(rng, difficulty) {
  const twoSlot = difficulty >= 4;
  for (let attempt = 0; attempt < 100; attempt++) {
    const a = 2 + Math.floor(rng() * 12);
    const b = 2 + Math.floor(rng() * 12);
    const c = 2 + Math.floor(rng() * 12);

    if (twoSlot) {
      const candidates = [];
      for (const o1 of ['+', '-', '*', '/']) {
        for (const o2 of ['+', '-', '*', '/']) {
          const v1 = applyOp(a, o1, b);
          if (Number.isNaN(v1)) continue;
          const v2 = applyOp(v1, o2, c);
          if (Number.isNaN(v2) || v2 <= 0 || v2 > 144) continue;
          candidates.push([o1, o2, v2]);
        }
      }
      if (candidates.length === 0) continue;
      const [o1, o2, d] = candidates[Math.floor(rng() * candidates.length)];
      if (solutions2(a, b, c, d).length !== 1) continue;
      const correct = `${display(o1)} and ${display(o2)}`;
      // Distractors: three OTHER operator pairs, each provably wrong — the
      // uniqueness check above guarantees no other pair evaluates to d.
      // (The previous builder indexed a 2-element array with [2] and [3] and
      // shipped literal "undefined" as an option — twice per puzzle.) Prefer
      // pairs that evaluate to a real number (clean wrong answers) over
      // division-NaN pairs, and never show the same pair twice.
      const wrongPairs = [];
      for (const p1 of ['+', '-', '*', '/']) {
        for (const p2 of ['+', '-', '*', '/']) {
          const label = `${display(p1)} and ${display(p2)}`;
          if (label === correct) continue;
          wrongPairs.push({ label, value: evalPair(a, p1, b, p2, c) });
        }
      }
      const opts = [correct];
      for (const wp of shuffledOptions(rng, wrongPairs).sort((x, y) => Number(Number.isFinite(y.value)) - Number(Number.isFinite(x.value)))) {
        if (opts.length >= 4) break;
        if (opts.includes(wp.label)) continue;
        opts.push(wp.label);
      }
      if (opts.length < 4) continue;
      return {
        question: `Replace @ and # with operators to make this true: ${a} @ ${b} # ${c} = ${d}. Which pair works?`,
        options: shuffledOptions(rng, opts),
        correct,
        explanation: `Working left to right with normal precedence: ${a} ${display(o1)} ${b} = ${applyOp(a, o1, b)}, then ${applyOp(a, o1, b)} ${display(o2)} ${c} = ${d}. No other operator pair yields ${d}.`,
        tags: ['operator', 'two-slot'],
      };
    }

    // single slot: a @ b = c, exactly one operator must work
    const sols = ['+', '-', '*', '/'].filter((op) => applyOp(a, op, b) === c);
    if (sols.length !== 1) continue;
    const correct = display(sols[0]);
    const others = ['+', '-', '×', '÷'].filter((s) => s !== correct);
    return {
      question: `Replace @ with an operator to make this true: ${a} @ ${b} = ${c}. Which operator works?`,
      options: shuffledOptions(rng, [correct, ...others]),
      correct,
      explanation: `${a} ${correct} ${b} = ${c}. The other operators give different results.`,
      tags: ['operator', 'single-slot'],
    };
  }
  return null;
}
