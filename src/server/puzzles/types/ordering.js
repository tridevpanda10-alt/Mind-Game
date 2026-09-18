// Ordering / Ranking: derive a full ranking from elimination clues
// ("A finished above B", "C is not second", "exactly one X between ...").
//
// Validation pipeline (same rigor as the other generators):
//   1. Construct a hidden permutation consistent with the generated clues.
//   2. Brute-force ALL permutations of the items; publish only when exactly
//      one full ranking is consistent — OR when the asked fact (who is in a
//      given position / what position someone holds) is identical across every
//      consistent ranking while the FULL order is not pinned. The second form
//      keeps mid-tier puzzles plentiful without admitting ambiguity for the
//      actual question.
//   3. Clue minimization: after reducing to a minimal clue set, re-run the
//      enumeration with each clue removed; any clue whose removal does not
//      widen the model set (i.e. taught the solver nothing) is dropped as
//      redundant. No filler clues — every published sentence carries weight.
// Difficulty scales item count and clue harshness (position bans, gaps,
// distances), never just the numbers involved.

import { LETTERS } from '../helpers.js';
import { shuffledOptions } from '../options.js';
import { pick } from '../rng.js';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const POS_LABEL = (i) => ORDINALS[i] ?? `${i + 1}th`;

// Clue kinds. Each checker takes (perm, clue) -> boolean, where perm maps
// item index -> position index (0 = first).
const CLUE_KINDS = [
  { id: 'above',    weight: [2, 4, 4, 4],  text: (c) => `${c.a} finished above ${c.b}`,                                              check: (p, c) => p[c.a] < p[c.b] },
  { id: 'direct',   weight: [4, 3, 2, 1],  text: (c) => `${c.a} finished ${POS_LABEL(c.pos)}`,                                       check: (p, c) => p[c.a] === c.pos },
  { id: 'notpos',   weight: [0, 1, 2, 3],  text: (c) => `${c.a} did not finish ${POS_LABEL(c.pos)}`,                                 check: (p, c) => p[c.a] !== c.pos },
  { id: 'adjacent', weight: [0, 1, 2, 3],  text: (c) => `${c.a} finished immediately above ${c.b}`,                                  check: (p, c) => p[c.b] === p[c.a] + 1 },
  { id: 'gap',      weight: [0, 0, 2, 3],  text: (c) => `Exactly ${c.k} ${c.k === 1 ? 'player' : 'players'} finished between ${c.a} and ${c.b}`, check: (p, c) => Math.abs(p[c.a] - p[c.b]) === c.k + 1 },
];

function modelSet(n, clues) {
  const models = [];
  const perm = Array.from({ length: n }, (_, i) => i); // position -> item
  const walk = (used) => {
    const pos = used.size; // Set: size, not length
    if (pos === n) {
      // perm is position->item; invert to item->position for the checkers
      const inv = Array(n);
      perm.forEach((item, position) => { inv[item] = position; });
      if (clues.every((cl) => cl.check(inv, cl))) models.push(inv.slice());
      return;
    }
    for (let item = 0; item < n; item++) {
      if (used.has(item)) continue;
      used.add(item);
      perm[pos] = item;
      walk(used);
      used.delete(item);
    }
  };
  walk(new Set());
  return models;
}

export function generateOrdering(rng, difficulty) {
  const n = Math.min(6, 3 + Math.floor(difficulty / 2)); // 3..6 participants
  const weights = CLUE_KINDS.map((k) => k.weight[Math.min(3, difficulty - 1)]);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const drawKind = () => {
    let r = rng() * totalW;
    for (let i = 0; i < CLUE_KINDS.length; i++) {
      r -= weights[i];
      if (r < 0) return CLUE_KINDS[i];
    }
    return CLUE_KINDS[0];
  };

  for (let attempt = 0; attempt < 150; attempt++) {
    const truth = Array.from({ length: n }, (_, i) => i); // item i at position i
    // shuffle truth with the seeded rng
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [truth[i], truth[j]] = [truth[j], truth[i]];
    }

    // candidate clue pool drawn from the hidden truth. `sig` identifies the
    // clue's SEMANTICS (kind + params) — dedupe by sig, never by the text
    // function (all clues of a kind share that function object).
    const pool = [];
    const push = (clue) => { if (clue) pool.push(clue); };
    for (let tries = 0; tries < 40 && pool.length < 10; tries++) {
      const kind = drawKind();
      const a = Math.floor(rng() * n);
      let b = Math.floor(rng() * n);
      if (a === b) b = (a + 1) % n;
      if (kind.id === 'above') push({ ...kind, a, b, sig: `above:${a}>${b}` });
      else if (kind.id === 'direct') push({ ...kind, a, pos: truth[a], sig: `direct:${a}@${truth[a]}` });
      else if (kind.id === 'notpos') push({ ...kind, a, pos: truth[a], sig: `notpos:${a}!${truth[a]}` });
      else if (kind.id === 'adjacent') push(Math.abs(truth[a] - truth[b]) === 1 ? { ...kind, a: truth[a] < truth[b] ? a : b, b: truth[a] < truth[b] ? b : a, sig: `adj:${Math.min(truth[a], truth[b])}-${Math.max(truth[a], truth[b])}` } : null);
      else if (kind.id === 'gap') push({ ...kind, a, b, k: Math.abs(truth[a] - truth[b]) - 1, sig: `gap:${Math.min(a, b)}-${Math.max(a, b)}:${Math.abs(truth[a] - truth[b]) - 1}` });
    }
    if (pool.length < 2) continue;

    // Greedy clue selection: add clues until the model set collapses to a
    // single full ranking (or, when allowed, a set that pins the asked fact).
    const chosen = [];
    let models = modelSet(n, chosen);
    for (let i = 0; chosen.length < 8 && models.length > 1 && i < pool.length; i++) {
      const cand = pool[i];
      if (chosen.some((c) => c.sig === cand.sig)) continue;
      const narrowed = modelSet(n, [...chosen, cand]);
      if (narrowed.length < models.length) {
        chosen.push(cand);
        models = narrowed;
      }
    }
    if (models.length === 0) continue;

    // Ask position -> item when the full ranking is pinned, else ask a fact
    // that holds in every surviving model (checked, never assumed).
    let questionKind = 'full';
    if (models.length > 1) {
      const pins = [];
      for (let pos = 0; pos < n; pos++) {
        const v = models[0][pos];
        if (models.every((m) => m[pos] === v)) pins.push({ pos, item: v });
      }
      if (pins.length === 0) continue;
      questionKind = 'fact';
      var pinned = pick(rng, pins);
    } else {
      var pinned = { pos: Math.floor(rng() * n), item: models[0][Math.floor(rng() * n)] };
      if (pinned.item !== truth[pinned.pos]) continue; // sanity: pinned == truth
    }

    // Minimize: drop redundant clues (removal must widen the model set).
    const minimal = [];
    for (const cl of chosen) {
      const rest = chosen.filter((c) => c !== cl);
      if (modelSet(n, rest).length > models.length) minimal.push(cl);
    }
    if (minimal.length < 2) continue; // a ranking from one sentence isn't a puzzle
    if (modelSet(n, minimal).length !== models.length) continue; // safety net

    const names = LETTERS.slice(0, n);
    const label = (idx) => names[idx];
    const clueText = minimal.map((cl) => cl.text({
      ...cl,
      a: label(cl.a),
      b: cl.b !== undefined ? label(cl.b) : undefined,
    }));

    const correct = questionKind === 'full'
      ? names[pinned.item]
      : `${label(pinned.item)}`;
    const options = shuffledOptions(rng, [...new Set([correct, ...names.filter((x) => x !== correct)])].slice(0, 4));
    const order = truth.map((item, pos) => `${pos + 1}. ${label(item)}`).join(', ');
    const explanation = questionKind === 'full'
      ? `Working through the clues eliminates every other order; the full ranking is ${order}. So ${POS_LABEL(pinned.pos)} place went to ${correct}.`
      : `The clues leave several orders possible (${models.length} to be precise), but ${POS_LABEL(pinned.pos)} place is ${correct} in every one of them. One such ranking: ${order}.`;

    return {
      question: `${n} players finished a race, one per place, with no ties. ${clueText.join('. ')}. Who finished ${POS_LABEL(pinned.pos)}?`,
      options,
      correct,
      explanation,
      // Illustration payload: clue structure + which position is asked. The
      // ranking itself is NEVER shipped — the art's podium shows only places
      // the clues state. Draw ledger documented in sceneOrdering (render.js)
      // and must stay in sync: per clue a flutter seed, per runner a flag
      // seed, then 2 tuft seeds.
      scene: {
        kind: 'ordering',
        n,
        clues: minimal.map((cl) => ({ id: cl.id, a: cl.a, b: cl.b, k: cl.k, pos: cl.pos })),
        asked: pinned.pos,
        rng: Math.floor(rng() * 4294967296),
      },
      tags: ['ordering', 'elimination', models.length === 1 ? 'unique-ranking' : 'pinned-fact'],
    };
  }
  return null;
}
