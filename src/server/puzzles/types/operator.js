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

// All operator pairs (o1, o2) such that "a o1 b o2 c" evaluates to d with
// normal precedence (×,÷ before +,-).
function solutions2(a, b, c, d) {
  const ops = ['+', '-', '*', '/'];
  const found = [];
  for (const o1 of ops) {
    for (const o2 of ops) {
      const hi1 = o1 === '*' || o1 === '/';
      const hi2 = o2 === '*' || o2 === '/';
      let lhs;
      if (hi1 || !hi2) {
        const v1 = applyOp(a, o1, b);
        lhs = applyOp(v1, o2, c);
      } else {
        const v2 = applyOp(b, o2, c);
        lhs = applyOp(a, o1, v2);
      }
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
      const sym = ['+', '-', '×', '÷'].filter((s) => s !== display(o1) && s !== display(o2));
      const opts = [correct, `${sym[0]} and ${sym[1]}`, `${sym[2]} and ${sym[0]}`, `${display(o1)} and ${sym[3]}`];
      if (new Set(opts).size !== 4) continue;
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
