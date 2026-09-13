// Conditional Logic: given conditional rules and facts, deduce what follows.
// The world has n people, each wearing one of 2 colors. Acceptance requires:
//   1. At least one consistent state exists (facts + rules satisfiable).
//   2. The queried person's color is IDENTICAL across every consistent state
//      (unique answer, proven by brute-force enumeration).
//   3. The queried color is reachable by forward chaining from the facts,
//      so the explanation is a clean derivable chain.

import { LETTERS } from '../helpers.js';
import { shuffledOptions } from '../options.js';

function consistentStates(n, rules, facts) {
  const states = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const state = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
    if (facts.some(([p, c]) => state[p] !== c)) continue;
    if (rules.every(([p, a, q, b]) => state[p] !== a || state[q] === b)) states.push(state);
  }
  return states;
}

function forwardChain(n, rules, facts) {
  const state = Array(n).fill(-1);
  for (const [p, c] of facts) state[p] = c;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [p, a, q, b] of rules) {
      if (state[p] === a && state[q] === -1) {
        state[q] = b;
        changed = true;
      }
    }
  }
  return state;
}

export function generateConditional(rng, difficulty) {
  const n = difficulty >= 4 ? 4 : 3;
  const colors = ['red', 'blue'];
  for (let attempt = 0; attempt < 80; attempt++) {
    // rules: distinct (antecedent person, color) pairs, target != antecedent person
    const rules = [];
    const usedAnte = new Set();
    const ruleCount = 2 + Math.floor(rng() * 2) + (difficulty >= 3 ? 1 : 0);
    let guard = 0;
    while (rules.length < ruleCount && guard++ < 40) {
      const p = Math.floor(rng() * n);
      const q = Math.floor(rng() * n);
      const a = Math.floor(rng() * 2);
      const b = Math.floor(rng() * 2);
      if (p === q) continue;
      const key = `${p},${a}`;
      if (usedAnte.has(key)) continue;
      usedAnte.add(key);
      rules.push([p, a, q, b]);
    }
    if (rules.length === 0) continue;
    const fp = Math.floor(rng() * n);
    const facts = [[fp, Math.floor(rng() * 2)]];
    const states = consistentStates(n, rules, facts);
    if (states.length === 0) continue; // contradictory world -> reject
    const chained = forwardChain(n, rules, facts);
    // candidate targets: determined by chaining, not the fact person
    const targets = [];
    for (let p = 0; p < n; p++) {
      if (p !== fp && chained[p] !== -1) targets.push(p);
    }
    if (targets.length === 0) continue;
    const qp = targets[Math.floor(rng() * targets.length)];
    const answerColor = colors[chained[qp]];
    // uniqueness across ALL consistent states
    if (!states.every((s) => colors[s[qp]] === answerColor)) continue;

    // explanation: shortest rule chain from fact to target
    const chain = [];
    let cur = fp;
    const visited = new Set([fp]);
    while (cur !== qp) {
      const next = rules.find(([p, , q]) => p === cur && !visited.has(q));
      if (!next) break;
      chain.push(`${LETTERS[next[0]]} wears ${colors[next[1]]} -> ${LETTERS[next[2]]} wears ${colors[next[3]]}`);
      visited.add(next[2]);
      cur = next[2];
    }
    if (cur !== qp) continue; // no clean chain -> skip for explanation quality

    const rulesText = rules
      .map(([p, a, q, b]) => `If ${LETTERS[p]} wears ${colors[a]}, then ${LETTERS[q]} wears ${colors[b]}.`)
      .join(' ');
    const options = shuffledOptions(rng, [answerColor, ...['green', 'yellow', 'white']]);
    return {
      question: `${LETTERS[fp]} wears ${colors[facts[0][1]]}. ${rulesText} What color does ${LETTERS[qp]} wear?`,
      options,
      correct: answerColor,
      explanation: `Apply the rules in order: ${chain.join('; ')}.`,
      tags: ['conditional', 'forward-chaining'],
    };
  }
  return null;
}
