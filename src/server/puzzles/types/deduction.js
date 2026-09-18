// Deduction: knights (always truth-tellers), knaves (always liars).
//
// MATHEMATICAL NOTE (hard-won via adversarial QA): for this statement form,
// if an assignment is consistent, its GLOBAL COMPLEMENT (every knight <-> every
// knave) is also consistent — so "what type is person X?" NEVER has a unique
// answer. The well-formed question is the pairwise one: "Do X and Y have the
// same type, or different types?" — the global flip preserves same/different
// relationships. We therefore:
//   1. Construct statements consistent with a secret assignment.
//   2. Enumerate ALL consistent assignments (brute force).
//   3. Publish only if the asked pair's relationship is identical in every
//      consistent assignment (verified, not assumed).

import { LETTERS } from '../helpers.js';
import { shuffledOptions } from '../options.js';

function consistentModels(n, statements) {
  const models = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const isKnight = Array.from({ length: n }, (_, i) => Boolean((mask >> i) & 1));
    let ok = true;
    for (const st of statements) {
      const speakerTruth = isKnight[st.speaker];
      const content = isKnight[st.subject] === st.claimsTruthful;
      if (speakerTruth !== content) { ok = false; break; }
    }
    if (ok) models.push(isKnight);
  }
  return models;
}

export function generateDeduction(rng, difficulty) {
  const n = difficulty >= 3 ? 4 : 3;
  // tighter instances at high difficulty: exactly two consistent assignments
  const maxModels = difficulty >= 4 ? 2 : 4;
  for (let attempt = 0; attempt < 120; attempt++) {
    const truth = Array.from({ length: n }, () => rng() < 0.5);
    // subject must differ from speaker: self-claims are degenerate
    // (knave + "I am a knave" = liar paradox -> zero models; knight + "I am a
    // knight" is vacuous -> unconstrained variable).
    const statements = [];
    for (let i = 0; i < n; i++) {
      const others = Array.from({ length: n }, (_, j) => j).filter((j) => j !== i);
      const subject = others[Math.floor(rng() * others.length)];
      const claimsTruthful = truth[i] ? truth[subject] : !truth[subject];
      statements.push({ speaker: i, subject, claimsTruthful });
    }
    const models = consistentModels(n, statements);
    if (models.length === 0 || models.length > maxModels) continue;

    // candidate pairs whose same/different relationship holds in ALL models
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const same = models[0][i] === models[0][j];
        if (models.every((m) => (m[i] === m[j]) === same)) pairs.push([i, j, same]);
      }
    }
    if (pairs.length === 0) continue;
    const [pi, pj, same] = pairs[Math.floor(rng() * pairs.length)];
    const correct = same ? 'Same type' : 'Different types';
    const lines = statements.map((st, i) => {
      const subj = LETTERS[st.subject];
      return `${LETTERS[i]} says "${subj} is a ${st.claimsTruthful ? 'knight' : 'knave'}"`;
    });
    const options = shuffledOptions(rng, ['Same type', 'Different types']);
    const proof = models.map((m) => `(${m.map((k) => (k ? 'K' : 'N')).join('')})`).join(' or ');
    return {
      question: `Knights always tell the truth; knaves always lie. ${lines.join('; ')}. What is the relationship between ${LETTERS[pi]} and ${LETTERS[pj]}?`,
      options,
      correct,
      explanation: `Checking every possibility, the consistent assignments are ${proof} — and flipping everyone keeps every statement consistent, so both a setup and its flip appear. In each of them, ${LETTERS[pi]} and ${LETTERS[pj]} have ${same ? 'the same type' : 'different types'}.`,
      // Illustration payload: WHO speaks about WHOM (structure only — whether
      // a speaker is knight or knave is the puzzle's answer, so the art draws
      // blank K/N badges). Ambient placement derives from scene.rng; the draw
      // ledger is documented in sceneDeduction (render.js) and must stay in
      // sync: per islander x-jitter, bob, firefly x/y; then 2 tufts; 2 birds.
      scene: {
        kind: 'deduction',
        statements: statements.map((st) => ({ s: st.speaker, about: st.subject, c: st.claimsTruthful })),
        rng: Math.floor(rng() * 4294967296),
      },
      tags: ['deduction', 'knights-and-knaves', 'same-or-different'],
    };
  }
  return null;
}
