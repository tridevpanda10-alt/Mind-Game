// Small shared helpers for puzzle generators.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  // avoid floating point noise in displayed values
  return String(Math.round(n * 1000) / 1000);
}

export function lettersToNums(str) {
  // "A B C" or "ABC" -> [0,1,2]
  return str
    .replace(/[^A-Za-z0-9]/g, '')
    .split('')
    .map((c) => LETTERS.indexOf(c.toUpperCase()))
    .filter((i) => i >= 0);
}

export function letterAnswerFromIndex(idx) {
  return LETTERS[idx] ?? String(idx);
}

export function timed(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { result, ms };
}
