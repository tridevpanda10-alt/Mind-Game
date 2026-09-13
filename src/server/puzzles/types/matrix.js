// Matrix Reasoning: 3x3 grid of numbers, last cell missing.
// Rows follow "cell_{k+1} = cell_k + d_r" where d_r itself advances by a fixed
// step across rows. A collision check rejects candidates where another simple
// rule (column arithmetic, arithmetic row sums) also fits all 8 visible cells
// but yields a different missing value.

import { fmtNum } from '../helpers.js';
import { ensureUniqueOptions, shuffledOptions, numericDistractors } from '../options.js';

function collides(visible, answer) {
  // visible: 3 rows of 3 cells, missing cell replaced by `answer`
  // Alternative rule 1: columns are arithmetic
  let colOk = true;
  for (let c = 0; c < 3; c++) {
    const d = visible[1][c] - visible[0][c];
    if (visible[2][c] - visible[1][c] !== d) { colOk = false; break; }
  }
  if (colOk) {
    const colPred = visible[2][1] + (visible[2][1] - visible[2][0]);
    if (colPred !== answer) return true;
  }
  // Alternative rule 2: row sums form an arithmetic sequence
  const sums = visible.map((r) => r[0] + r[1] + r[2]);
  if (sums[1] - sums[0] === sums[2] - sums[1]) {
    const sumPred = sums[2] + (sums[2] - sums[1]) - visible[2][0] - visible[2][1];
    if (sumPred !== answer) return true;
  }
  return false;
}

export function generateMatrix(rng, difficulty) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const step = 1 + Math.floor(rng() * (1 + difficulty)); // advance of d across rows
    const d0 = 1 + Math.floor(rng() * 5);
    const base = 2 + Math.floor(rng() * 12);
    const row1 = [base, base + d0, base + 2 * d0];
    const d1 = d0 + step;
    const row2start = row1[2] + 1 + Math.floor(rng() * 6);
    const row2 = [row2start, row2start + d1, row2start + 2 * d1];
    const d2 = d1 + step;
    const row3start = row2[2] + 1 + Math.floor(rng() * 6);
    const row3 = [row3start, row3start + d2];
    const answer = row3start + 2 * d2;
    const visible = [row1, row2, [row3[0], row3[1], answer]];
    if (collides(visible, answer)) continue;
    const spread = Math.max(4, Math.round(answer * 0.1));
    const opts = ensureUniqueOptions(answer, numericDistractors(rng, answer, spread), fmtNum);
    if (!opts) continue;
    return {
      question: 'Which number completes the matrix?',
      matrix: [[row1[0], row1[1], row1[2]], [row2[0], row2[1], row2[2]], [row3[0], row3[1], '?']],
      options: shuffledOptions(rng, opts).map(fmtNum),
      correct: fmtNum(answer),
      explanation: `Each row increases by a constant difference, and that difference grows by ${step} from row to row: row 1 diff ${d0}, row 2 diff ${d1}, row 3 diff ${d2}. Missing value = ${row3[1]} + ${d2} = ${answer}.`,
      tags: ['matrix', 'row-arithmetic'],
    };
  }
  return null;
}
