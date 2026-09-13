// Mastermind Logic: deduce the hidden color code from scored guesses.
// Validation: enumerate ALL possible codes; the puzzle is valid only if
// exactly one code is consistent with every guess feedback row. Difficulty
// scales the palette size and the number of revealed rows.

import { pick } from '../rng.js';

const COLORS = ['R', 'G', 'B', 'Y', 'P', 'O'];
const COLOR_NAMES = { R: 'red', G: 'green', B: 'blue', Y: 'yellow', P: 'purple', O: 'orange' };

export function scoreGuess(secret, guess) {
  let exact = 0;
  const sLeft = [];
  const gLeft = [];
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      sLeft.push(secret[i]);
      gLeft.push(guess[i]);
    }
  }
  let partial = 0;
  const pool = new Map();
  for (const c of sLeft) pool.set(c, (pool.get(c) ?? 0) + 1);
  for (const c of gLeft) {
    const n = pool.get(c) ?? 0;
    if (n > 0) {
      partial++;
      pool.set(c, n - 1);
    }
  }
  return { exact, partial };
}

function codeFromNum(num, codeLen, palette) {
  const code = [];
  let n = num;
  for (let i = 0; i < codeLen; i++) {
    code.push(palette[n % palette.length]);
    n = Math.floor(n / palette.length);
  }
  return code;
}

export function generateMastermind(rng, difficulty) {
  const codeLen = difficulty <= 2 ? 3 : 4;
  const paletteSize = Math.min(COLORS.length, 3 + Math.ceil(difficulty / 2));
  const palette = COLORS.slice(0, paletteSize);
  const revealedRows = 2 + Math.floor(difficulty / 2);
  const total = paletteSize ** codeLen;
  if (total > 1296) return null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const secret = Array.from({ length: codeLen }, () => pick(rng, palette));
    const guesses = [];
    for (let i = 0; i < revealedRows; i++) {
      let g;
      let guard = 0;
      do {
        g = Array.from({ length: codeLen }, () => pick(rng, palette));
      } while (guesses.some((prev) => prev.guess.join('') === g.join('')) && guard++ < 30);
      guesses.push({ guess: g, score: scoreGuess(secret, g) });
    }
    if (!guesses.some(({ guess }) => guess.some((c, i) => c === secret[i]))) continue;

    // enumerate all codes: consistent with all rows, or not
    const consistent = [];
    const inconsistent = [];
    for (let num = 0; num < total; num++) {
      const code = codeFromNum(num, codeLen, palette);
      const ok = guesses.every(({ guess, score }) => {
        const s = scoreGuess(code, guess);
        return s.exact === score.exact && s.partial === score.partial;
      });
      if (ok) consistent.push(code.join(''));
      else inconsistent.push(code.join(''));
    }
    if (consistent.length !== 1) continue;
    const answer = consistent[0];
    // distractors: codes that look plausible but contradict at least one row
    const distractorCodes = [];
    for (const code of inconsistent) {
      if (distractorCodes.length >= 3) break;
      if (!distractorCodes.includes(code)) distractorCodes.push(code);
    }
    if (distractorCodes.length < 3) continue;
    const rows = guesses.map(({ guess, score }) => ({
      guess: guess.join(' '),
      exact: score.exact,
      partial: score.partial,
    }));
    const options = [answer, ...distractorCodes];
    // deterministic shuffle for stable option order
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return {
      question: `A hidden code of ${codeLen} colors was chosen from ${palette.map((c) => COLOR_NAMES[c]).join(', ')} (repeats allowed). Each row shows a guess and its feedback: "exact" = right color in the right spot, "partial" = right color in the wrong spot. What is the hidden code?`,
      rows,
      options,
      correct: answer,
      explanation: `Only ${answer.split('').join(' ')} is consistent with every feedback row; every other code contradicts at least one row.`,
      tags: ['mastermind', `palette-${paletteSize}`],
    };
  }
  return null;
}
