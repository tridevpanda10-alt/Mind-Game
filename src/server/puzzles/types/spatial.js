// Spatial Reasoning: two visual families rendered by the client as SVG.
//   1. Rotation: which rotated tile matches the original L-shape?
//   2. Fold: a 3x3 paper with punched holes is folded in half; holes land on
//      their mirror position; holes landing on the SAME cell MERGE (real
//      paper!). Distractors are alternative fold outcomes from perturbed
//      hole patterns (guaranteed distinct by content check).
// Uniqueness: `correct` is the option id whose grid exactly equals the
// computed fold result; all distractor grids are verified different.

import { shuffledOptions } from '../options.js';

function rotationVariant(grid, quarterTurns) {
  const n = grid.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (quarterTurns === 0) out[r][c] = grid[r][c];
      else if (quarterTurns === 1) out[c][n - 1 - r] = grid[r][c];
      else if (quarterTurns === 2) out[n - 1 - r][n - 1 - c] = grid[r][c];
      else out[n - 1 - c][r] = grid[r][c];
    }
  }
  return out;
}

function gridsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function generateRotation(rng) {
  const n = 3;
  // L-shape with random leg lengths (non-square => all rotations distinct)
  const arm1 = 2 + Math.floor(rng() * 2); // 2..3
  const arm2 = 1 + Math.floor(rng() * 2); // 1..2
  const base = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < arm1; i++) base[0][i] = 1;
  for (let i = 0; i <= arm2; i++) base[i][0] = 1;
  const target = 1 + Math.floor(rng() * 3);
  const rotated = rotationVariant(base, target);
  const others = [0, 1, 2, 3].filter((q) => q !== target).map((q) => rotationVariant(base, q));
  const uniq = [];
  for (const g of others) {
    if (!uniq.some((u) => gridsEqual(u, g)) && !gridsEqual(g, rotated)) uniq.push(g);
  }
  if (uniq.length < 3) return null; // too symmetric -> reject
  const opts = [rotated, ...uniq.slice(0, 3)];
  const withIds = opts.map((g, i) => ({ id: String(i), grid: g }));
  const correctId = String(opts.findIndex((g) => gridsEqual(g, rotated)));
  if (correctId === '-1') return null;
  return {
    question: 'The tile on the left is rotated. Which option shows the SAME tile rotated?',
    kind: 'rotation',
    grid: base,
    options: shuffledOptions(rng, withIds),
    correct: correctId,
    explanation: `Rotating the shape ${90 * target}° clockwise matches the shown option. The others are different rotations of the same shape.`,
    tags: ['spatial', 'rotation'],
  };
}

// Fold a 3x3 hole pattern along the vertical (or horizontal) center line.
// Every hole maps to its mirror cell; overlapping holes merge into one.
function foldHoles(g, vertical) {
  const res = Array.from({ length: 3 }, () => Array(3).fill(0));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!g[r][c]) continue;
      const rr = vertical ? r : 2 - r;
      const cc = vertical ? 2 - c : c;
      res[rr][cc] = 1;
    }
  }
  return res;
}

function generateFolds(rng) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const vertical = rng() < 0.5;
    const g = Array.from({ length: 3 }, () => Array(3).fill(0));
    const holeCount = 2 + Math.floor(rng() * 3); // 2..4 holes
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push([r, c]);
    // Fisher-Yates with the seeded rng (no sort-by-random bias)
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (const [r, c] of cells.slice(0, holeCount)) g[r][c] = 1;
    const res = foldHoles(g, vertical);
    // require at least one merge or reflection so the fold is non-trivial:
    // the folded shape must differ from the original
    if (gridsEqual(res, g)) continue;

    // distractors: fold results of perturbed hole patterns (move one hole,
    // refold, keep results distinct from the true result and each other)
    const wrongs = [];
    for (const [hr, hc] of cells) {
      if (wrongs.length >= 3) break;
      if (!g[hr][hc]) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) {
        const nr = hr + dr;
        const nc = hc + dc;
        if (nr < 0 || nr > 2 || nc < 0 || nc > 2) continue;
        if (g[nr][nc]) continue;
        const g2 = g.map((row) => row.slice());
        g2[hr][hc] = 0;
        g2[nr][nc] = 1;
        const r2 = foldHoles(g2, vertical);
        if (!gridsEqual(r2, res) && !wrongs.some((w) => gridsEqual(w, r2))) {
          wrongs.push(r2);
          break;
        }
      }
    }
    if (wrongs.length < 3) continue;

    const opts = [res, ...wrongs];
    const withIds = opts.map((gr, i) => ({ id: String(i), grid: gr }));
    const correctId = String(opts.findIndex((gr) => gridsEqual(gr, res)));
    if (correctId === '-1') return null;
    return {
      question: vertical
        ? 'A paper with punched holes (left) is folded along the vertical center line, left half onto right half. Holes on top of each other merge. Which shows the folded paper?'
        : 'A paper with punched holes (left) is folded along the horizontal center line, top half onto bottom half. Holes on top of each other merge. Which shows the folded paper?',
      kind: 'fold',
      grid: g,
      options: shuffledOptions(rng, withIds),
      correct: correctId,
      explanation: 'Each hole lands on its mirror position across the fold line; holes that land together merge into one. The shown option is exactly that result.',
      tags: ['spatial', 'folding'],
    };
  }
  return null;
}

export function generateSpatial(rng, difficulty) {
  const fam = difficulty <= 2 ? (rng() < 0.6 ? 'rotation' : 'fold') : rng() < 0.5 ? 'rotation' : 'fold';
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = fam === 'rotation' ? generateRotation(rng) : generateFolds(rng);
    if (p) return p;
  }
  return null;
}
