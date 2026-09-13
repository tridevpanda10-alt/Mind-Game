// Training setup: pick reasoning types + difficulty, launch a session.

import { $, $$, el, showScreen } from '../ui.js';
import { startMatch } from './game.js';

const TYPES = [
  ['pattern', 'Pattern Completion'],
  ['sequence', 'Sequence Reasoning'],
  ['matrix', 'Matrix Reasoning'],
  ['deduction', 'Deduction'],
  ['conditional', 'Conditional Logic'],
  ['number', 'Number Logic'],
  ['operator', 'Operator Logic'],
  ['spatial', 'Spatial Reasoning'],
  ['mastermind', 'Mastermind Logic'],
];
const DIFFS = ['rookie', 'easy', 'medium', 'hard', 'expert', 'master'];

const selectedTypes = new Set(['sequence', 'deduction', 'operator']);
let selectedDiff = 'medium';
let selectedCount = 10;
const COUNTS = [5, 10, 15, 20, 30];

export function initTraining() {
  const crow = $('#countRow');
  crow.replaceChildren();
  for (const c of COUNTS) {
    crow.append(el('button', {
      class: `diff-btn${c === selectedCount ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        selectedCount = c;
        $$('#countRow .diff-btn').forEach((b) => b.classList.toggle('active', Number(b.textContent) === c));
      },
      text: String(c),
    }));
  }
  const grid = $('#typeGrid');
  grid.replaceChildren();
  for (const [id, label] of TYPES) {
    grid.append(el('button', {
      class: `type-btn${selectedTypes.has(id) ? ' active' : ''}`,
      type: 'button',
      'data-type': id,
      onclick: (e) => {
        if (selectedTypes.has(id)) selectedTypes.delete(id);
        else selectedTypes.add(id);
        if (selectedTypes.size === 0) selectedTypes.add(id); // never allow zero
        e.currentTarget.classList.toggle('active', selectedTypes.has(id));
      },
      text: label,
    }));
  }
  const drow = $('#diffRow');
  drow.replaceChildren();
  for (const d of DIFFS) {
    drow.append(el('button', {
      class: `diff-btn${d === selectedDiff ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        selectedDiff = d;
        $$('#diffRow .diff-btn').forEach((b) => b.classList.toggle('active', b.textContent === d));
      },
      text: d,
    }));
  }
  $('#startTraining').addEventListener('click', () => {
    startMatch('training', { body: { types: [...selectedTypes], difficulty: selectedDiff, count: selectedCount } });
  });
}

export function goTraining() {
  showScreen('#screen-training');
}
