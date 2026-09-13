// Pattern Completion: grid of numbers with one missing cell.
// Rule families:
//   (a) row-relation: last column = first column + middle column (per row).
//   (b) column-arithmetic with a hidden last-row cell. In this family the
//       row-relation rule does NOT fit the visible cells in general (checked),
//       and every visible column is arithmetic by construction; the hidden
//       cell is pinned by its own column, so the intended rule is unique
//       among the rule families in play.
// Collision check: reject if the OTHER family's rule also fits all visible
// cells but predicts a different value for the hidden cell.

import { ensureUniqueOptions, shuffledOptions, numericDistractors } from '../options.js';

// Does c3 = c1 + c2 hold on every row where all three cells are visible?
function rowRelationFits(grid, size) {
  for (let r = 0; r < size; r++) {
    const row = grid[r];
    if (row[0] === null || row[1] === null || row[2] === null) continue;
    if (row[0] + row[1] !== row[2]) return false;
  }
  return true;
}

// Are all complete columns arithmetic?
function colArithFits(grid, size) {
  for (let c = 0; c < size; c++) {
    const a = grid[0][c];
    const b = grid[1][c];
    const d = b - a;
    for (let r = 2; r < size; r++) {
      if (grid[r][c] === null) continue;
      if (grid[r][c] - grid[r - 1][c] !== d) return false;
    }
  }
  return true;
}

export function generatePattern(rng, difficulty) {
  const size = difficulty >= 4 ? 4 : 3;
  for (let attempt = 0; attempt < 80; attempt++) {
    const useRowRel = rng() < 0.5;
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    let answer;
    let hidden;
    let explanation;

    if (useRowRel) {
      // rows: c3 = c1 + c2, row sums rise by k (keeps grids tidy)
      for (let r = 0; r < size; r++) {
        const a = 1 + Math.floor(rng() * 9);
        const b = 1 + Math.floor(rng() * 9);
        grid[r][0] = a;
        grid[r][1] = b;
        grid[r][2] = a + b;
      }
      if (size === 4) {
        const a = 1 + Math.floor(rng() * 9);
        grid[3][0] = a;
        grid[3][1] = 10 - a; // keeps c3 = 10 for size-4 tidiness
        grid[3][2] = 10;
      }
      hidden = [size - 1, 2];
      answer = grid[size - 1][2];
      // collision: columns arithmetic AND extension disagrees
      const probe = grid.map((row) => row.slice());
      if (colArithFits(probe, size)) {
        const d = grid[1][2] - grid[0][2];
        const colPred = grid[1][2] + d;
        if (colPred !== answer) continue;
      }
      const r = size - 1;
      explanation =
        `In each row, the third number is the sum of the first two ` +
        `(${grid[0][0]}+${grid[0][1]}=${grid[0][2]}, ${grid[1][0]}+${grid[1][1]}=${grid[1][2]}). ` +
        `So the missing value is ${grid[r][0]}+${grid[r][1]} = ${answer}.`;
    } else {
      const cols = [];
      for (let c = 0; c < size; c++) cols.push({ start: 1 + Math.floor(rng() * 9), d: 1 + Math.floor(rng() * 4) });
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) grid[r][c] = cols[c].start + r * cols[c].d;
      const hc = Math.floor(rng() * size);
      hidden = [size - 1, hc];
      answer = grid[size - 1][hc];
      // collision: row-relation must not fit visible cells with a different prediction
      const probe = grid.map((row) => row.slice());
      probe[size - 1][hc] = null;
      if (rowRelationFits(probe, size)) {
        // extension: with all visible rows satisfying c3=c1+c2, the rule pins
        // row[size-1][2]; if that disagrees with our answer -> collision
        if (size === 3 && hc !== 2) {
          const pred = grid[size - 1][0] + grid[size - 1][1];
          if (pred !== answer) continue;
        }
        // if hc === 2 the rule directly predicts the hidden cell: pred === answer
        // by construction (cols arithmetic does not generally satisfy c3=c1+c2),
        // so treat as collision only if it doesn't match:
        if (size === 3 && hc === 2) {
          const pred = grid[size - 1][0] + grid[size - 1][1];
          if (pred !== answer) continue;
        }
      }
      explanation =
        `Each column increases by a fixed step: ` +
        cols.map((col, i) => `column ${i + 1} (+${col.d})`).join(', ') +
        `. In column ${hc + 1}: ${answer - cols[hc].d} + ${cols[hc].d} = ${answer}.`;
    }

    // sanity: hidden cell must equal the computed answer
    if (grid[hidden[0]][hidden[1]] !== answer) return null;

    const spread = Math.max(3, Math.round(answer * 0.15));
    const opts = ensureUniqueOptions(answer, numericDistractors(rng, answer, spread));
    if (!opts) continue;
    const display = grid.map((row) => row.slice());
    display[hidden[0]][hidden[1]] = '?';
    return {
      question: 'Which number completes the pattern?',
      matrix: display,
      options: shuffledOptions(rng, opts),
      correct: String(answer),
      explanation,
      tags: ['pattern', useRowRel ? 'row-relation' : 'column-arithmetic'],
    };
  }
  return null;
}
