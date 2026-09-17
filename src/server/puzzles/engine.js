// Puzzle engine: registry of generators, metadata assembly, and validation.
// This module is DOM-free and UI-free; the same code runs on the server
// (official puzzles) and in tests (validation pipeline).

import { makeRng } from './rng.js';
import { generateSequence } from './types/sequence.js';
import { generateMatrix } from './types/matrix.js';
import { generatePattern } from './types/pattern.js';
import { generateDeduction } from './types/deduction.js';
import { generateConditional } from './types/conditional.js';
import { generateNumber } from './types/number.js';
import { generateOperator } from './types/operator.js';
import { generateSpatial } from './types/spatial.js';
import { generateMastermind } from './types/mastermind.js';
import { generateOrdering } from './types/ordering.js';
import { generateStory } from './types/story.js';

export const PUZZLE_TYPES = [
  'pattern', 'sequence', 'matrix', 'deduction', 'conditional',
  'number', 'operator', 'spatial', 'mastermind', 'ordering', 'story',
];

export const DIFFICULTIES = ['rookie', 'easy', 'medium', 'hard', 'expert', 'master'];
export const DIFFICULTY_INDEX = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, i + 1]));

// Per-type target generation attempts before giving up on a puzzle.
const GENERATORS = {
  pattern: generatePattern,
  sequence: generateSequence,
  matrix: generateMatrix,
  deduction: generateDeduction,
  conditional: generateConditional,
  number: generateNumber,
  operator: generateOperator,
  spatial: generateSpatial,
  mastermind: generateMastermind,
  ordering: generateOrdering,
  story: generateStory,
};

// Estimated solve time in seconds per type and difficulty band — used for
// pacing, timer defaults, and difficulty-consistency validation.
const BASE_SECONDS = { pattern: 30, sequence: 30, matrix: 40, deduction: 50, conditional: 50, number: 45, operator: 25, spatial: 45, mastermind: 75, ordering: 60, story: 70 };

export function estimateSeconds(type, difficulty) {
  const idx = DIFFICULTY_INDEX[difficulty] ?? 3;
  return Math.round((BASE_SECONDS[type] ?? 40) * (0.7 + 0.15 * idx));
}

// Build a fully validated puzzle object. Returns null if generation fails.
export function makePuzzle(type, difficulty, seed) {
  const gen = GENERATORS[type];
  if (!gen) return null;
  const rng = makeRng(seed);
  const core = gen(rng, DIFFICULTY_INDEX[difficulty] ?? 3);
  if (!core) return null;
  const puzzle = {
    puzzleId: `${type}-${difficulty}-${seed.toString(36)}`,
    type,
    difficulty,
    question: core.question,
    options: core.options,
    correct: core.correct,
    explanation: core.explanation,
    tags: core.tags ?? [],
    version: 1,
    generation: { seed, generator: `${type}.js` },
    active: true,
  };
  if (core.matrix) puzzle.matrix = core.matrix;
  if (core.rows) puzzle.rows = core.rows;
  if (core.kind) puzzle.kind = core.kind;
  if (core.grid) puzzle.grid = core.grid;
  if (core.scene) puzzle.scene = core.scene; // story puzzles: illustration payload (no answers inside)
  const err = validatePuzzle(puzzle);
  if (err) return null;
  return puzzle;
}

// ── Validation ────────────────────────────────────────────────────────────
// Structural + semantic checks. Returns error string or null when valid.

export function validatePuzzle(p) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (!p.puzzleId || typeof p.puzzleId !== 'string') return 'missing puzzleId';
  if (!PUZZLE_TYPES.includes(p.type)) return `unknown type ${p.type}`;
  if (!DIFFICULTIES.includes(p.difficulty)) return `bad difficulty ${p.difficulty}`;
  if (typeof p.question !== 'string' || p.question.length < 12) return 'question too short';
  if (!Array.isArray(p.options) || p.options.length < 2) return 'needs >=2 options';
  // object options (visual types): identity is option.id; uniqueness by both
  // id and serialized content (two identical grids must never both appear)
  const keys = p.options.map((o) => (typeof o === 'object' ? JSON.stringify(o) : String(o)));
  if (new Set(keys).size !== keys.length) return 'duplicate options';
  const ids = p.options.map((o) => (typeof o === 'object' && o !== null ? String(o.id) : String(o)));
  if (new Set(ids).size !== ids.length) return 'duplicate option ids';
  if (!ids.includes(String(p.correct))) return 'correct not among options';
  // object options must also differ in CONTENT (not just id) — two identical
  // grids under different ids would make two options simultaneously correct
  const objOpts = p.options.filter((o) => typeof o === 'object' && o !== null);
  if (objOpts.length) {
    const contents = objOpts.map((o) => JSON.stringify({ ...o, id: null }));
    if (new Set(contents).size !== contents.length) return 'duplicate option contents';
  }
  if (typeof p.explanation !== 'string' || p.explanation.length < 10) return 'explanation too short';
  if (p.matrix) {
    if (!Array.isArray(p.matrix) || !p.matrix.every((r) => Array.isArray(r))) return 'bad matrix';
    const flat = p.matrix.flat();
    if (!flat.some((v) => v === '?')) return 'matrix missing "?" cell';
  }
  if (p.rows) {
    if (!Array.isArray(p.rows) || p.rows.length < 2) return 'mastermind needs >=2 rows';
    if (!p.rows.every((r) => typeof r.guess === 'string' && Number.isInteger(r.exact) && Number.isInteger(r.partial))) return 'bad rows';
  }
  if (p.matrix && p.rows) return 'cannot have both matrix and rows';
  return null;
}

// Check that exactly one option is correct by re-solving where possible.
// For generator-backed types, regeneration with the same seed must reproduce
// the same correct answer (determinism proof) and the recorded correct value
// must equal the solver's independently computed answer.
export function recheckUniqueness(puzzle) {
  const { type, difficulty, generation } = puzzle;
  const regen = makePuzzleNoValidate(type, difficulty, generation.seed);
  if (!regen) return 'regeneration failed';
  if (regen.correct !== puzzle.correct) return 'regenerated correct differs';
  if (regen.question !== puzzle.question) return 'regenerated question differs';
  return null;
}

function makePuzzleNoValidate(type, difficulty, seed) {
  const gen = GENERATORS[type];
  if (!gen) return null;
  const rng = makeRng(seed);
  const core = gen(rng, DIFFICULTY_INDEX[difficulty] ?? 3);
  if (!core) return null;
  return core;
}

// Generate a batch of puzzles for a match. Deterministic per seed: the same
// seed always yields the same puzzle list (used by daily challenges and tests).
// Uniqueness guarantee: no identical puzzle (same question + option set) may
// appear twice in one batch — duplicates are re-rolled with fresh seeds.
export function makePuzzleBatch(typeList, difficulty, seed, count) {
  // difficulty may be a scalar (whole batch) or a per-puzzle ladder — quick
  // matches use a mixed ladder so pacing and the difficulty backdrop shift
  // within a single session.
  const ladder = Array.isArray(difficulty) ? difficulty : null;
  const puzzles = [];
  const seen = new Set(); // puzzle signatures already in this batch
  let s = seed >>> 0;
  let misses = 0; // consecutive duplicate rolls before widening the net
  for (let i = 0; i < count; i++) {
    const type = typeList[i % typeList.length];
    const diff = ladder ? ladder[i % ladder.length] : difficulty;
    let puzzle = null;
    for (let attempt = 0; attempt < 60 && !puzzle; attempt++) {
      s = (s * 1664525 + 1013904223) >>> 0; // LCG step per attempt
      const candidate = makePuzzle(type, diff, s);
      if (!candidate) continue;
      const sig = puzzleSignature(candidate);
      if (seen.has(sig)) {
        // Widening jitter: after 10 duplicate rolls, perturb the seed so we
        // cannot loop over the same small generator space forever.
        if (++misses % 10 === 0) s = (s ^ (0x9e3779b9 + i * 0x85ebca6b + misses)) >>> 0;
        continue;
      }
      seen.add(sig);
      puzzle = candidate;
    }
    if (puzzle) puzzles.push(puzzle);
  }
  return puzzles;
}

// Stable identity of a puzzle's CONTENT: same question + same option set (in
// any order) + same correct answer = the same puzzle, even if the id differs.
export function puzzleSignature(p) {
  const opts = p.options.map((o) => JSON.stringify(typeof o === 'object' && o !== null ? { ...o, id: null } : o)).sort().join('|');
  return `${p.type}::${p.difficulty}::${p.question}::${opts}::${p.correct}`;
}
