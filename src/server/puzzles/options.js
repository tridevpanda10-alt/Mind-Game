// Distractor generation utilities. Every multiple-choice puzzle MUST call
// ensureUniqueOptions so that no two options are equal (accidental second
// correct answer = invalid puzzle, rejected by the validator).

export function ensureUniqueOptions(correct, candidates, fmt = String) {
  const opts = [correct];
  for (const c of candidates) {
    if (opts.length >= 4) break;
    const key = fmt(c);
    if (opts.some((o) => fmt(o) === key)) continue;
    opts.push(c);
  }
  return opts.length === 4 ? opts : null;
}

export function shuffledOptions(rng, opts) {
  const a = opts.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build numeric distractors around a correct value, filtered to plausible/positive.
// `exclude`: values that must never appear (e.g. a second defensible answer).
export function numericDistractors(rng, correct, spread, exclude = []) {
  const banned = new Set(exclude.map(Number).concat([correct]));
  const cands = new Set();
  for (let i = 0; i < 60 && cands.size < 10; i++) {
    const delta = Math.round((rng() * 2 - 1) * spread) || (i % 2 ? 1 : -1);
    const v = correct + delta;
    if (v > 0 && !banned.has(v)) cands.add(v);
  }
  return [...cands];
}
