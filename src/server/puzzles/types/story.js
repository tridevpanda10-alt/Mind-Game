// Story Reasoning: classic animal situations converted into genuine logic
// puzzles. Four scenes, four DIFFERENT mechanisms:
//   crow   — constraint satisfaction over pebble plans (subset enumeration;
//            exactly one plan fits every constraint)
//   cats   — liar deduction with a greed rule (the biggest piece lies);
//            all orderings enumerated, only consistent ones survive
//   rabbit — BFS pathfinding on a grid with thorns + a wolf-exclusion zone
//   owl    — logic-grid attribute matching (who wore which scarf), brute
//            forced over all 24 permutations with minimized clues
// The scene payload (`scene`) is the presentation layer — the client renders
// it as ORIGINAL inline SVG — while the question text is fully self-describing
// so every puzzle stays solvable (and accessible) with visuals off.
// Every scene verifies uniqueness at generation time; ambiguous instances are
// rejected and the batch engine re-rolls the seed.

import { shuffledOptions } from '../options.js';
import { pick } from '../rng.js';

// ── scene A: the thirsty crow (constraint satisfaction) ───────────────────
function sceneCrow(rng, difficulty) {
  const hard = difficulty >= 3;
  const start = hard ? 3 : 2;
  const target = start + (hard ? 4 : 3);
  const larges = hard ? 2 : 1;
  const smalls = hard ? 3 : 4;
  const neck = 2;
  const LARGE_RAISE = 2;
  const SMALL_RAISE = 1;
  const needed = target - start;

  // Enumerate every plan by pebble counts (pebbles of one size are identical).
  const valid = [];
  const others = [];
  for (let L = 0; L <= larges; L++) {
    for (let S = 0; S <= smalls; S++) {
      if (L + S === 0) continue;
      const raise = L * LARGE_RAISE + S * SMALL_RAISE;
      const fits = L + S <= neck;
      const reaches = raise >= needed;
      if (fits && reaches) valid.push({ L, S });
      else others.push({ L, S });
    }
  }
  if (valid.length !== 1) return null;
  const plan = valid[0];

  const countPhrase = (L, S) => {
    const parts = [];
    if (L === 1) parts.push('the large pebble');
    else if (L === 2) parts.push('both large pebbles');
    else if (L > 2) parts.push(`${L} large pebbles`);
    if (S === 1) parts.push('one small pebble');
    else if (S > 1) parts.push(`${S} small pebbles`);
    return parts.join(' and ');
  };
  const correct = `Drop ${countPhrase(plan.L, plan.S)}`;
  // Distractors: real but failing plans (wrong raise, or too many for the neck).
  const failPool = others
    .filter((o) => o.L + o.S <= 3)
    .map((o) => ({ ...o, text: `Drop ${countPhrase(o.L, o.S)}` }));
  const distractors = [];
  for (const f of shuffledOptions(rng, failPool)) {
    if (distractors.length >= 3) break;
    if (!distractors.some((d) => d.text === f.text)) distractors.push(f);
  }
  if (distractors.length < 3) return null;

  const why = distractors
    .map((d) => {
      const raise = d.L * LARGE_RAISE + d.S * SMALL_RAISE;
      if (raise < needed) return `dropping ${countPhrase(d.L, d.S)} only raises the water ${raise} mark${raise === 1 ? '' : 's'}`;
      return `${d.L + d.S} pebbles do not fit through the neck`;
    })
    .join('; ');
  return {
    question: `A thirsty crow finds a matka (clay pot) where the water sits at mark ${start}. To drink, the water must rise to mark ${target}. Each large pebble raises the water by 2 marks and each small pebble by 1 mark. Nearby lie ${larges === 1 ? 'one large pebble' : `${larges} large pebbles`} and ${smalls} small pebbles, and the pot's narrow neck fits at most ${neck} pebbles in total. Which plan lets the crow drink?`,
    options: shuffledOptions(rng, [correct, ...distractors.map((d) => d.text)]),
    correct,
    explanation: `The water must rise ${needed} marks and at most ${neck} pebbles fit through the neck. ${plan.L + plan.S === 2 ? `The chosen plan raises exactly ${needed} marks and fits` : `The chosen plan raises ${needed} marks and fits`}. Every alternative fails: ${why}.`,
    scene: { kind: 'crow', start, target, larges, smalls, neck },
    tags: ['story', 'crow', 'constraint-satisfaction'],
  };
}

// ── scene B: the cats and the roti (liar deduction, greed rule) ───────────
// Parties: Cat A, Cat B, and the monkey who judged their fight. Whoever got
// the biggest piece lied; the other two told the truth. Each claim combo is
// verified by enumerating all 6 size orderings; only a unique surviving
// ordering (or a pinned asked fact) is published.
const CAT_COMBOS = [
  {
    claims: [
      { s: 0, text: 'The monkey\u2019s piece is bigger than mine', truth: (ord) => ord[0] === 2 || ord[1] === 2 ? ord.indexOf(2) < ord.indexOf(0) : false }, // M bigger than A
      { s: 1, text: 'My piece is bigger than Cat A\u2019s', truth: (ord) => ord.indexOf(1) < ord.indexOf(0) },                                                // B bigger than A
      { s: 2, text: 'Cat A\u2019s piece is bigger than mine', truth: (ord) => ord.indexOf(0) < ord.indexOf(2) },                                              // A bigger than M
    ],
  },
  {
    claims: [
      { s: 0, text: 'My piece is bigger than Cat B\u2019s', truth: (ord) => ord.indexOf(0) < ord.indexOf(1) },  // A bigger than B
      { s: 1, text: 'The monkey\u2019s piece is bigger than mine', truth: (ord) => ord.indexOf(2) < ord.indexOf(1) }, // M bigger than B
      { s: 2, text: 'Cat B\u2019s piece is bigger than Cat A\u2019s', truth: (ord) => ord.indexOf(1) < ord.indexOf(0) }, // B bigger than A
    ],
  },
];
// ord: permutation where ord[p] = party holding the p-th biggest piece
// (0 = Cat A, 1 = Cat B, 2 = monkey). "truth" = is the statement TRUE here.

function consistentCatOrderings(combo) {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const ord of perms) {
    const biggest = ord[0];
    const ok = combo.claims.every((c) => {
      const truthfulSpeaker = c.s !== biggest; // biggest lies, others truth
      return c.truth(ord) === truthfulSpeaker;
    });
    if (ok) out.push(ord);
  }
  return out;
}

function sceneCats(rng, difficulty) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const combo = pick(rng, CAT_COMBOS);
    const orderings = consistentCatOrderings(combo);
    if (orderings.length !== 1) continue; // uniqueness is verified, never assumed
    // The consistent ordering is unique, so any rank is a fair ask. Randomize
    // it so consecutive puzzles don't share an answer.
    const askSmallest = rng() < 0.5;
    const pos = askSmallest ? 2 : 0;
    const who = orderings[0][pos];

    const NAMES = ['Cat A', 'Cat B', 'The monkey'];
    const correct = NAMES[who];
    const options = shuffledOptions(rng, NAMES);
    const rankText = (o) => `${NAMES[o[0]]} (biggest), then ${NAMES[o[1]]}, then ${NAMES[o[2]]} (smallest)`;
    const claimsText = combo.claims
      .map((c) => `${['Cat A', 'Cat B', 'The monkey'][c.s]} says: \u201C${c.text}.\u201D`)
      .join(' ');
    return {
      question: `Two cats fought over a roti, and a monkey was called to judge — he split it into three unequal pieces, one for each of them. Whoever got the biggest piece lied about the split; the other two told the truth. ${claimsText} Who got the ${askSmallest ? 'smallest' : 'biggest'} piece?`,
      options,
      correct,
      explanation: `Testing all six arrangements, only one fits the rule: ${rankText(orderings[0])}. (Flip any two and someone's statement clashes with the rule.) So the ${askSmallest ? 'smallest' : 'biggest'} piece went to ${correct}.`,
      scene: { kind: 'cats', askSmallest },
      tags: ['story', 'cats', 'liar-deduction'],
    };
  }
  return null;
}

// ── scene C: the rabbit and the wolf (BFS pathfinding) ────────────────────
function sceneRabbit(rng, difficulty) {
  const size = difficulty >= 4 ? 5 : 4;
  const wolfZone = difficulty >= 3;
  for (let attempt = 0; attempt < 60; attempt++) {
    const grid = Array.from({ length: size }, () => Array(size).fill('.'));
    // thorns
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if ((r === 0 && c === 0) || (r === size - 1 && c === size - 1)) continue;
        if (rng() < 0.28) grid[r][c] = '#';
      }
    }
    // wolf: interior cell, not start/exit/thorn
    const spots = [];
    for (let r = 1; r < size - 1; r++) {
      for (let c = 1; c < size - 1; c++) {
        if (grid[r][c] === '.') spots.push([r, c]);
      }
    }
    if (!spots.length) continue;
    const [wr, wc] = pick(rng, spots);
    grid[wr][wc] = 'W';
    const blocked = (r, c) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return true;
      if (grid[r][c] === '#') return true;
      if (grid[r][c] === 'W') return true;
      if (wolfZone && Math.abs(r - wr) + Math.abs(c - wc) === 1) return true;
      return false;
    };
    // BFS from (0,0) to (size-1, size-1)
    const dist = Array.from({ length: size }, () => Array(size).fill(-1));
    const parent = Array.from({ length: size }, () => Array(size).fill(null));
    dist[0][0] = 0;
    const queue = [[0, 0]];
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (blocked(nr, nc) || dist[nr][nc] !== -1) continue;
        dist[nr][nc] = dist[r][c] + 1;
        parent[nr][nc] = [r, c];
        queue.push([nr, nc]);
      }
    }
    const answer = dist[size - 1][size - 1];
    if (answer < size) continue; // too short to be interesting
    // rebuild one shortest path for the explanation
    const moves = [];
    let cur = [size - 1, size - 1];
    while (cur && (cur[0] !== 0 || cur[1] !== 0)) {
      const p = parent[cur[0]][cur[1]];
      moves.push(cur[1] > p[1] ? 'right' : cur[1] < p[1] ? 'left' : cur[0] > p[0] ? 'down' : 'up');
      cur = p;
    }
    moves.reverse();
    const rows = grid.map((row) => row.join('')).join(' / ');
    const opts = [answer - 1, answer, answer + 1, answer + 2].filter((v) => v >= 2);
    const uniq = [...new Set(opts)];
    if (uniq.length < 4 || answer - 1 < 2) continue;
    return {
      question: `A rabbit must reach its burrow on the far side of the forest, a ${size}\u00D7${size} grid of clearings. The rabbit hops up, down, left or right (never diagonally). Thorn bushes (#) cannot be entered, and the rabbit cannot hop onto the wolf (W) or onto any clearing directly beside it. Rows from top to bottom (R = rabbit, B = burrow): ${rows}. What is the fewest number of hops needed to reach the burrow?`,
      options: shuffledOptions(rng, uniq).map(String),
      correct: String(answer),
      explanation: `The shortest safe route takes ${answer} hops — for example: ${moves.join(', ')}. Every route must dodge the thorns${wolfZone ? ' and the cells next to the wolf' : ''}, and no shorter route exists (checked exhaustively).`,
      scene: { kind: 'rabbit', size, grid: grid.map((r) => r.slice()), wolf: [wr, wc], wolfZone },
      tags: ['story', 'rabbit', 'pathfinding'],
    };
  }
  return null;
}

// ── scene D: the owl's moonlight meeting (logic grid) ─────────────────────
const OWL_ANIMALS = ['the Fox', 'the Elephant', 'the Turtle', 'the Deer'];
const OWL_COLORS = ['red', 'blue', 'green', 'yellow'];

function owlConsistentCount(animals, colors, clues) {
  // clues: [{ kind, a, b, c }] over indexes; returns list of consistent perms
  const perms = [];
  const walk = (used, acc) => {
    if (acc.length === animals) {
      const assign = Array(animals); // assign[animal] = color index
      acc.forEach((color, animal) => { assign[animal] = color; });
      if (clues.every((cl) => owlClueHolds(cl, assign))) perms.push(assign);
      return;
    }
    for (let color = 0; color < colors; color++) {
      if (used.has(color)) continue;
      used.add(color);
      acc.push(color);
      walk(used, acc);
      acc.pop();
      used.delete(color);
    }
  };
  walk(new Set(), []);
  return perms;
}
function owlClueHolds(cl, assign) {
  switch (cl.kind) {
    case 'direct': return assign[cl.a] === cl.c;
    case 'not': return assign[cl.a] !== cl.c;
    case 'either': return assign[cl.a] === cl.c || assign[cl.a] === cl.d;
    case 'different': return assign[cl.a] !== assign[cl.b];
    default: return true;
  }
}

function sceneOwl(rng, difficulty) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const secret = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [secret[i], secret[j]] = [secret[j], secret[i]];
    } // secret[animal] = color index
    // candidate clue pool derived from the secret solution
    const pool = [];
    for (let a = 0; a < 4; a++) {
      pool.push({ kind: 'direct', a, c: secret[a], weight: difficulty >= 3 ? 1 : 3 });
      for (let c = 0; c < 4; c++) {
        if (c !== secret[a]) pool.push({ kind: 'not', a, c, weight: 2 });
        for (let d = c + 1; d < 4; d++) {
          if (c === secret[a] || d === secret[a]) pool.push({ kind: 'either', a, c, d, weight: 2 });
        }
      }
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) pool.push({ kind: 'different', a, b, weight: 1 });
    const weighted = [];
    for (const cl of pool) for (let i = 0; i < cl.weight; i++) weighted.push(cl);
    // deterministic shuffle via rng
    const order = [];
    const seenIdx = new Set();
    while (order.length < weighted.length) {
      const i = Math.floor(rng() * weighted.length);
      if (seenIdx.has(i)) continue;
      seenIdx.add(i);
      order.push(weighted[i]);
    }
    // greedy: add clues until the model set collapses to the secret
    const chosen = [];
    let models = owlConsistentCount(4, 4, chosen);
    for (const cl of order) {
      if (models.length === 1) break;
      if (chosen.some((c) => JSON.stringify(c) === JSON.stringify(cl))) continue;
      const narrowed = owlConsistentCount(4, 4, [...chosen, cl]);
      if (narrowed.length < models.length) {
        chosen.push(cl);
        models = narrowed;
      }
    }
    if (models.length !== 1) continue;
    // minimize: drop redundant clues
    const minimal = [];
    for (const cl of chosen) {
      const rest = chosen.filter((c) => c !== cl);
      if (owlConsistentCount(4, 4, rest).length > 1) minimal.push(cl);
    }
    if (minimal.length < 3) continue;
    if (owlConsistentCount(4, 4, minimal).length !== 1) continue;

    const clueText = minimal.map((cl) => {
      switch (cl.kind) {
        case 'direct': return `${OWL_ANIMALS[cl.a]} wore the ${OWL_COLORS[cl.c]} scarf`;
        case 'not': return `${OWL_ANIMALS[cl.a]} did not wear the ${OWL_COLORS[cl.c]} scarf`;
        case 'either': return `${OWL_ANIMALS[cl.a]} wore a ${OWL_COLORS[cl.c]} or ${OWL_COLORS[cl.d]} scarf`;
        case 'different': return `${OWL_ANIMALS[cl.a]} and ${OWL_ANIMALS[cl.b]} wore different colors`;
        default: return '';
      }
    });
    const asked = Math.floor(rng() * 4);
    const correct = OWL_COLORS[secret[asked]];
    const options = shuffledOptions(rng, OWL_COLORS);
    const mapping = secret.map((c, a) => `${OWL_ANIMALS[a]} \u2192 ${OWL_COLORS[c]}`).join(', ');
    return {
      question: `One moonlit night, ${OWL_ANIMALS.join(', ')}, and the Owl met under the old neem tree. Each of the four friends wore a scarf \u2014 one red, one blue, one green, one yellow, every color used exactly once. ${clueText.join('. ')}. What color scarf did ${OWL_ANIMALS[asked]} wear?`,
      options,
      correct,
      explanation: `Working through the clues eliminates every other arrangement: ${mapping}. So ${OWL_ANIMALS[asked]} wore ${correct}.`,
      // No colors in the payload: the scarf color is the ANSWER, and the
      // painter draws neutral scarves. Only the asked animal index is needed.
      scene: { kind: 'owl', animals: OWL_ANIMALS.map((a) => a.replace('the ', '')), asked },
      tags: ['story', 'owl', 'logic-grid'],
    };
  }
  return null;
}

const SCENES = [sceneCrow, sceneCats, sceneRabbit, sceneOwl];

export function generateStory(rng, difficulty) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const scene = SCENES[Math.floor(rng() * SCENES.length)];
    const p = scene(rng, difficulty);
    if (p) return p;
  }
  return null;
}
