// Visual puzzle renderers. Pure functions: build DOM/SVG from puzzle data.
// No scoring, no state — presentation only (architecture rule 44).

import { el } from './ui.js';

const TYPE_LABELS = {
  pattern: 'Pattern Completion',
  sequence: 'Sequence Reasoning',
  matrix: 'Matrix Reasoning',
  deduction: 'Deduction',
  conditional: 'Conditional Logic',
  number: 'Number Logic',
  operator: 'Operator Logic',
  spatial: 'Spatial Reasoning',
  mastermind: 'Mastermind Logic',
};

export function typeLabel(t) {
  return TYPE_LABELS[t] ?? t;
}

// One SVG cell showing either a number or hole state
function svgCell(value, opts = {}) {
  const size = opts.size ?? 54;
  const cls = opts.q ? 'matrix-cell q' : 'matrix-cell';
  if (opts.holeGridCell !== undefined) {
    // spatial grids: 1 = punched hole (filled square), 0 = paper
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 2);
    rect.setAttribute('y', 2);
    rect.setAttribute('width', size - 4);
    rect.setAttribute('height', size - 4);
    rect.setAttribute('rx', 8);
    rect.setAttribute('fill', opts.holeGridCell ? 'rgba(76,201,240,0.55)' : 'rgba(255,255,255,0.04)');
    rect.setAttribute('stroke', 'rgba(255,255,255,0.18)');
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.append(rect);
    return s;
  }
  const div = el('div', { class: cls, text: String(value) });
  return div;
}

function numberGrid(grid) {
  const n = grid.length;
  const wrap = el('div', { class: 'matrix-grid' });
  wrap.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  for (const row of grid) {
    for (const v of row) {
      wrap.append(v === '?' ? svgCell('?', { q: true }) : svgCell(v));
    }
  }
  return wrap;
}

function holeGrid(grid, size = 54) {
  const n = grid.length;
  const wrap = el('div', { class: 'matrix-grid' });
  wrap.style.gridTemplateColumns = `repeat(${n}, ${size}px)`;
  for (const row of grid) {
    for (const v of row) wrap.append(svgCell(0, { holeGridCell: v, size }));
  }
  return wrap;
}

export function renderQuestion(puzzle) {
  const parts = [];
  if (puzzle.matrix) parts.push(numberGrid(puzzle.matrix));
  if (puzzle.rows) {
    for (const row of puzzle.rows) {
      parts.push(el('div', { class: 'mm-row' },
        el('span', { class: 'mm-guess', text: row.guess }),
        el('span', { class: 'mm-score' },
          el('span', { class: 'mm-exact', text: `${row.exact} exact` }),
          ' · ',
          el('span', { class: 'mm-partial', text: `${row.partial} partial` }),
        ),
      ));
    }
  }
  if (puzzle.grid) {
    if (puzzle.kind === 'rotation') {
      parts.push(el('div', { class: 'rot-grid' }, holeGrid(puzzle.grid, 46)));
    } else {
      parts.push(el('div', { class: 'fold-grid' }, holeGrid(puzzle.grid, 46)));
    }
  }
  return parts;
}

export function renderOption(puzzle, option, index) {
  if (typeof option === 'object' && option !== null && option.grid) {
    return holeGrid(option.grid, 46);
  }
  return el('span', { text: String(option) });
}

export function needsTextInput(puzzle) {
  return false; // all current types are multiple choice (mastermind picks a code)
}
