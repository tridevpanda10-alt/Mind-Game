// Ad-hoc generator QA: every type × every difficulty × 60 seeds.
// Checks: puzzle validates, determinism (regen identical), correct among
// options, story scenes renderable + answer-leak-free.
import { makePuzzle, validatePuzzle, recheckUniqueness, PUZZLE_TYPES, DIFFICULTIES, makePuzzleBatch } from '../src/server/puzzles/engine.js';

let made = 0;
let failed = [];
const sceneShapes = new Set();
for (const type of PUZZLE_TYPES) {
  for (const difficulty of DIFFICULTIES) {
    let ok = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const p = makePuzzle(type, difficulty, seed * 104729 + 7);
      if (!p) continue;
      const err = validatePuzzle(p);
      if (err) failed.push(`${type}/${difficulty}/seed${seed}: ${err}`);
      if (recheckUniqueness(p) !== null) failed.push(`${type}/${difficulty}/seed${seed}: not reproducible`);
      if (!p.options.map((o) => (typeof o === 'object' ? o.id : o)).map(String).includes(String(p.correct))) failed.push(`${type}/${difficulty}/seed${seed}: correct missing`);
      made++;
      ok++;
      if (p.scene) {
        sceneShapes.add(`${p.scene.kind}`);
        const keys = Object.keys(p.scene).sort().join(',');
        if (JSON.stringify(p.scene).includes(JSON.stringify(p.correct)) && type === 'story') {
          // direct literal leak of a string answer (crow/cats/owl answers are strings)
          failed.push(`${type}/${difficulty}/seed${seed}: scene payload leaks answer`);
        }
      }
    }
    if (ok === 0) failed.push(`${type}/${difficulty}: ZERO puzzles in 60 seeds`);
    else if (ok < 12) failed.push(`${type}/${difficulty}: thin yield (${ok}/60)`);
  }
}
console.log(`made=${made} sceneKinds=${[...sceneShapes].join('|') || 'none'}`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed.slice(0, 40)) console.log(' -', f);
  process.exit(1);
}
console.log('QA OK');
