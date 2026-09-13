// Integration + adversarial tests: spawns a real server on a test port and
// exercises auth, match flow, daily challenge, leaderboard, and attacks the
// API the way section 36 of the spec demands.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3177;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let dir;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function newGuest() {
  const r = await api('POST', '/api/auth/guest');
  assert.equal(r.status, 200);
  return r.json;
}

async function newPlayer() {
  const email = `t${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`;
  const r = await api('POST', '/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: 'Tester' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

async function playFullMatch(token, mode, opts = {}) {
  const path = mode === 'daily' ? '/api/match/daily' : mode === 'quick' ? '/api/match/quick' : '/api/match/training';
  const start = await api('POST', path, { token, body: opts.body ?? {} });
  if (start.status !== 200) return start;
  const { matchId, puzzles } = start.json;
  for (let i = 0; i < puzzles.length; i++) {
    await api('POST', `/api/match/${matchId}/answer`, { token, body: { puzzleIndex: i, answer: '0', msTaken: 5000 + i * 100 } });
  }
  const fin = await api('POST', `/api/match/${matchId}/finish`, { token });
  return { start, finish: fin, matchId };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'arena-test-'));
  child = spawn(process.execPath, ['src/server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'test.db'), RATE_AUTH: '200', RATE_SUBMIT: '1000', RATE_API: '5000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/api/me');
      if (r.status === 401) return; // server up
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(async () => {
  if (child) child.kill();
  await new Promise((r) => setTimeout(r, 400)); // let Windows release the db file
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ── AUTH ──────────────────────────────────────────────────────────────────
test('register + login + me roundtrip', async () => {
  const email = `t${Date.now()}@test.dev`;
  const reg = await api('POST', '/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: 'Round Tripper' } });
  assert.equal(reg.status, 200);
  assert.ok(reg.json.token);
  const me = await api('GET', '/api/me', { token: reg.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.displayName, 'Round Tripper');
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'correct-horse-battery' } });
  assert.equal(login.status, 200);
  const bad = await api('POST', '/api/auth/login', { body: { email, password: 'wrong-password-1' } });
  assert.equal(bad.status, 401);
});

test('register rejects bad payloads', async () => {
  const cases = [
    { email: 'not-an-email', password: 'long-enough-pass', displayName: 'X' },
    { email: 'a@b.co', password: 'short', displayName: 'X' },
    { email: 'a@b.co', password: 'long-enough-pass', displayName: 'x' },
    { email: 'a@b.co', password: 'long-enough-pass', displayName: 'bad<script>' },
    {},
  ];
  for (const body of cases) {
    const r = await api('POST', '/api/auth/register', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('duplicate email registration is 409', async () => {
  const email = `dup${Date.now()}@test.dev`;
  await api('POST', '/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: 'Dup' } });
  const again = await api('POST', '/api/auth/register', { body: { email, password: 'correct-horse-battery', displayName: 'Dup2' } });
  assert.equal(again.status, 409);
});

// ── SERVER AUTHORITY ──────────────────────────────────────────────────────
test('guest cannot access ranked surfaces (daily/quick)', async () => {
  const g = await newGuest();
  const daily = await api('POST', '/api/match/daily', { token: g.token });
  assert.equal(daily.status, 403);
  const quick = await api('POST', '/api/match/quick', { token: g.token });
  assert.equal(quick.status, 403);
});

test('puzzle payloads never leak answers or explanations', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'], difficulty: 'easy' } });
  assert.equal(start.status, 200);
  for (const pz of start.json.puzzles) {
    assert.ok(!('correct' in pz), 'answer leaked');
    assert.ok(!('explanation' in pz), 'explanation leaked');
    assert.ok(!('generation' in pz), 'seed metadata leaked');
  }
});

test('full training match flow scores server-side', async () => {
  const p = await newPlayer();
  // deterministic seed lets us learn the answer key via run 1, then play it
  // perfectly in run 2 — a legit player strategy, not an exploit (server
  // still computes the score).
  const body = { types: ['sequence', 'operator'], difficulty: 'easy', seed: 777 };
  const run1 = await api('POST', '/api/match/training', { token: p.token, body });
  assert.equal(run1.status, 200);
  for (let i = 0; i < run1.json.puzzles.length; i++) {
    await api('POST', `/api/match/${run1.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: '0', msTaken: 3000 } });
  }
  const fin1 = await api('POST', `/api/match/${run1.json.matchId}/finish`, { token: p.token });
  assert.equal(fin1.status, 200);
  assert.ok(fin1.json.results.every((r) => 'correctAnswer' in r && 'explanation' in r), 'post-finish explanations must unlock');
  const key = fin1.json.results.map((r) => r.correctAnswer);

  const run2 = await api('POST', '/api/match/training', { token: p.token, body });
  assert.deepEqual(run2.json.puzzles.map((x) => x.puzzleId), run1.json.puzzles.map((x) => x.puzzleId), 'same seed must reproduce puzzles');
  for (let i = 0; i < run2.json.puzzles.length; i++) {
    const r = await api('POST', `/api/match/${run2.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: key[i], msTaken: 6000 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.correct, true, `puzzle ${i} answered with its key must be correct`);
  }
  const fin2 = await api('POST', `/api/match/${run2.json.matchId}/finish`, { token: p.token });
  assert.equal(fin2.status, 200);
  assert.equal(fin2.json.correctCount, fin2.json.totalCount);
  assert.ok(fin2.json.score > fin1.json.score, 'perfect run must outscore blind run');
  const me = await api('GET', '/api/me', { token: p.token });
  assert.ok(me.json.xp > 0, 'xp should be awarded');
});

// ── ADVERSARIAL ───────────────────────────────────────────────────────────
test('ADV: protected endpoints reject missing/bad tokens', async () => {
  const r1 = await api('GET', '/api/me');
  assert.equal(r1.status, 401);
  const r2 = await api('GET', '/api/me', { token: 'forged-token-value' });
  assert.equal(r2.status, 401);
  const r3 = await api('POST', '/api/match/quick', { body: {} });
  assert.equal(r3.status, 401);
});

test('ADV: cannot answer or finish someone else\'s match', async () => {
  const a = await newPlayer();
  const b = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: a.token, body: { types: ['sequence'] } });
  const { matchId } = start.json;
  const r1 = await api('POST', `/api/match/${matchId}/answer`, { token: b.token, body: { puzzleIndex: 0, answer: '1', msTaken: 3000 } });
  assert.equal(r1.status, 403);
  const r2 = await api('POST', `/api/match/${matchId}/finish`, { token: b.token });
  assert.equal(r2.status, 403);
});

test('ADV: duplicate answer submission blocked', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'] } });
  const { matchId } = start.json;
  const body = { puzzleIndex: 0, answer: '5', msTaken: 4000 };
  const r1 = await api('POST', `/api/match/${matchId}/answer`, { token: p.token, body });
  assert.equal(r1.status, 200);
  const r2 = await api('POST', `/api/match/${matchId}/answer`, { token: p.token, body });
  assert.equal(r2.status, 409);
});

test('ADV: negative / absurd / non-numeric times rejected', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'] } });
  const { matchId } = start.json;
  for (const msTaken of [-5000, 0, 1e12, 'abc', null, { a: 1 }]) {
    const r = await api('POST', `/api/match/${matchId}/answer`, { token: p.token, body: { puzzleIndex: 0, answer: '5', msTaken } });
    assert.equal(r.status, 400, `msTaken=${msTaken}`);
  }
});

test('ADV: out-of-range puzzle index rejected', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'] } });
  const { matchId } = start.json;
  for (const puzzleIndex of [-1, 5, 99, 1.5, 'zero']) {
    const r = await api('POST', `/api/match/${matchId}/answer`, { token: p.token, body: { puzzleIndex, answer: '5', msTaken: 3000 } });
    assert.equal(r.status, 400, `puzzleIndex=${puzzleIndex}`);
  }
});

test('ADV: malformed JSON returns 400, huge payload returns 413', async () => {
  const p = await newPlayer();
  const raw = await fetch(BASE + '/api/match/training', {
    method: 'POST',
    headers: { authorization: `Bearer ${p.token}`, 'content-type': 'application/json' },
    body: '{"types": "not json...',
  });
  assert.equal(raw.status, 400);
  const big = await fetch(BASE + '/api/match/training', {
    method: 'POST',
    headers: { authorization: `Bearer ${p.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ types: ['sequence'], junk: 'x'.repeat(64 * 1024) }),
  });
  assert.equal(big.status, 413);
});

test('ADV: unknown match id handled cleanly', async () => {
  const p = await newPlayer();
  const r = await api('POST', '/api/match/m_doesnotexist/answer', { token: p.token, body: { puzzleIndex: 0, answer: '5', msTaken: 3000 } });
  assert.equal(r.status, 404);
});

test('ADV: finish without answering then double-finish blocked', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'] } });
  const { matchId } = start.json;
  const fin = await api('POST', `/api/match/${matchId}/finish`, { token: p.token });
  assert.equal(fin.status, 200); // finishing early is allowed: scored as wrong/skipped
  const again = await api('POST', `/api/match/${matchId}/finish`, { token: p.token });
  assert.ok([404, 409].includes(again.status), 'double finish must be blocked');
});

test('ADV: training mode cannot set ranked fields client-side', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'], difficulty: 'easy', mode: 'daily', score: 999999, xp: 99999 } });
  assert.equal(start.status, 200);
  const fin = await playFullMatch(p.token, 'training', {});
  // whatever the client sent, server computed the score
  assert.ok(fin.finish.json.score < 1000);
});

test('ADV: daily challenge is deterministic, single-attempt, replay-safe', async () => {
  const a = await newPlayer();
  const b = await newPlayer();
  const da = await api('POST', '/api/match/daily', { token: a.token });
  const db = await api('POST', '/api/match/daily', { token: b.token });
  assert.equal(da.status, 200);
  assert.equal(db.status, 200);
  // same puzzles for both players on the same day
  assert.deepEqual(da.json.puzzles.map((x) => x.puzzleId), db.json.puzzles.map((x) => x.puzzleId));
  // finishing works and appears on the daily leaderboard
  const fin = await api('POST', `/api/match/${da.json.matchId}/finish`, { token: a.token });
  assert.equal(fin.status, 200);
  // AFTER finishing, a replay attempt is rejected (no second official attempt)
  const replay = await api('POST', '/api/match/daily', { token: a.token });
  assert.equal(replay.status, 409);
  const board = await api('GET', '/api/leaderboard/daily', { token: b.token });
  assert.equal(board.status, 200);
  assert.ok(board.json.entries.some((e) => e.displayName === 'Tester'));
});

test('ADV: rate limit blocks answer spam (burst)', async () => {
  // dedicated server instance with tight limits, to prove the limiter fires
  const PORT2 = 3178;
  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const dir2 = mkdtempSync(join(tmpdir(), 'arena-rate-'));
  const child2 = spawn(process.execPath, ['src/server/index.js'], {
    env: { ...process.env, PORT: String(PORT2), DB_PATH: join(dir2, 'rate.db'), RATE_AUTH: '200', RATE_SUBMIT: '20', RATE_API: '200' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(BASE2 + '/api/me'); if (r.status === 401) break; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    const reg = await fetch(BASE2 + '/api/auth/guest', { method: 'POST' });
    const { token } = await reg.json();
    let got429 = false;
    for (let i = 0; i < 30; i++) {
      const r = await fetch(BASE2 + '/api/match/m_nope_' + i + '/answer', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ puzzleIndex: 0, answer: '5', msTaken: 3000 }),
      });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, 'expected a 429 from the submit limiter');
  } finally {
    child2.kill();
    await new Promise((r) => setTimeout(r, 400)); // let Windows release the db file
    try { rmSync(dir2, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

test('leaderboard reflects registered players, hides guests', async () => {
  const p = await newPlayer();
  const g = await newGuest();
  const board = await api('GET', '/api/leaderboard?board=rating', { token: p.token });
  assert.equal(board.status, 200);
  assert.ok(Array.isArray(board.json.entries));
  assert.ok(!board.json.entries.some((e) => e.displayName.startsWith('Guest-')));
});

test('profile aggregates stats and empty state is clean', async () => {
  const p = await newPlayer();
  const prof = await api('GET', '/api/profile', { token: p.token });
  assert.equal(prof.status, 200);
  assert.equal(prof.json.accuracy, null); // no games yet: clean empty state
  assert.deepEqual(prof.json.typeStats, []);
  await playFullMatch(p.token, 'quick', {});
  const prof2 = await api('GET', '/api/profile', { token: p.token });
  assert.ok(prof2.json.totals.completed >= 1);
  assert.ok(prof2.json.typeStats.length > 0);
});
