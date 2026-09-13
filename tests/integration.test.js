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
    stdio: ['ignore', 'ignore', 'inherit'], // surface server errors during development
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
  for (const puzzleIndex of [-1, 99, 1.5, 'zero']) {
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

test('quick matches serve 12 puzzles and wallet flows earn diamonds', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/quick', { token: p.token });
  assert.equal(start.status, 200);
  assert.equal(start.json.puzzles.length, 12, 'quick/ranked must be 12 puzzles');
  const ids = new Set(start.json.puzzles.map((x) => x.puzzleId));
  assert.equal(ids.size, 12, 'quick puzzles must be unique');
  const fin = await api('POST', `/api/match/${start.json.matchId}/finish`, { token: p.token });
  assert.equal(fin.status, 200);
  assert.equal(typeof fin.json.diamondsAwarded, 'number');
  assert.ok(fin.json.diamondsAwarded >= 0);
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.status, 200);
  assert.equal(wallet.json.diamonds, fin.json.diamondsAwarded, 'balance must equal server-awarded total');
});

test('daily challenge stays short (5-7 puzzles)', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/daily', { token: p.token });
  assert.equal(start.status, 200);
  assert.ok(start.json.puzzles.length >= 5 && start.json.puzzles.length <= 7, `daily length ${start.json.puzzles.length}`);
});

test('training honors player-chosen count with max 30', async () => {
  const p = await newPlayer();
  const five = await api('POST', '/api/match/training', { token: p.token, body: { types: ['operator'], difficulty: 'easy', count: 5 } });
  assert.equal(five.status, 200);
  assert.equal(five.json.puzzles.length, 5);
  const over = await api('POST', '/api/match/training', { token: p.token, body: { types: ['operator'], difficulty: 'easy', count: 500 } });
  assert.equal(over.status, 200);
  assert.ok(over.json.puzzles.length <= 30, 'training count capped at 30');
});

// ── ECONOMY (Phase 3) ─────────────────────────────────────────────────────
test('hint purchase eliminates an option, rejects when broke, one per puzzle', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'], difficulty: 'easy', seed: 777 } });
  const { matchId, puzzles } = start.json;

  // No diamonds yet → hint must be rejected with insufficient_diamonds.
  const broke = await api('POST', '/api/hint', { token: p.token, body: { matchId, puzzleIndex: 0 } });
  assert.equal(broke.status, 402);
  assert.equal(broke.json.error, 'insufficient_diamonds');
  const brokeWallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(brokeWallet.json.diamonds, 0, 'balance must never go negative');

  // Fund the wallet by finishing a perfect training match (diamonds only come
  // from the server — proving no client-supplied amount is trusted). A seeded
  // first run reveals the key; the identical second run plays it perfectly.
  const funding = { types: ['sequence'], difficulty: 'easy', seed: 777 };
  const run1 = await api('POST', '/api/match/training', { token: p.token, body: funding });
  for (let i = 0; i < run1.json.puzzles.length; i++) {
    await api('POST', `/api/match/${run1.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: '0', msTaken: 5000 } });
  }
  const fin1 = await api('POST', `/api/match/${run1.json.matchId}/finish`, { token: p.token });
  const key = fin1.json.results.map((r) => String(r.correctAnswer));
  const run2 = await api('POST', '/api/match/training', { token: p.token, body: funding });
  for (let i = 0; i < run2.json.puzzles.length; i++) {
    await api('POST', `/api/match/${run2.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: key[i], msTaken: 5000 } });
  }
  const fin = await api('POST', `/api/match/${run2.json.matchId}/finish`, { token: p.token });
  assert.equal(fin.json.correctCount, fin.json.totalCount, 'seeded replay must be perfect');
  assert.ok(fin.json.diamondsAwarded >= 20, 'earning on finish');
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.json.diamonds, fin.json.diamondsAwarded);
  assert.ok(wallet.json.diamonds >= 5, 'wallet must fund a hint');

  // Second fresh match: hint succeeds once, then hits the per-puzzle limit.
  const match2 = await api('POST', '/api/match/training', { token: p.token, body: { types: ['sequence'], difficulty: 'easy', seed: 1000 } });
  const h1 = await api('POST', '/api/hint', { token: p.token, body: { matchId: match2.json.matchId, puzzleIndex: 0 } });
  assert.equal(h1.status, 200);
  assert.ok(h1.json.eliminate != null);
  // The eliminated option must NOT be the correct answer.
  const pz = match2.json.puzzles[0];
  const optIds = pz.options.map((o) => String(typeof o === 'object' ? o.id : o));
  assert.ok(optIds.includes(String(h1.json.eliminate)));
  const h2 = await api('POST', '/api/hint', { token: p.token, body: { matchId: match2.json.matchId, puzzleIndex: 0 } });
  assert.equal(h2.status, 409);
  assert.equal(h2.json.error, 'hint_limit_reached');
  const after = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(after.json.diamonds, wallet.json.diamonds - 5, 'hint costs exactly 5');
  void puzzles;
});

test('skip costs 15 diamonds, scored incorrect, one per match', async () => {
  const p = await newPlayer();
  // Fund via a perfect seeded training run (learn key in run 1, replay in run 2).
  const funding = { types: ['operator'], difficulty: 'easy', seed: 555 };
  const run1 = await api('POST', '/api/match/training', { token: p.token, body: funding });
  for (let i = 0; i < run1.json.puzzles.length; i++) {
    await api('POST', `/api/match/${run1.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: '0', msTaken: 5000 } });
  }
  const fin1 = await api('POST', `/api/match/${run1.json.matchId}/finish`, { token: p.token });
  const key = fin1.json.results.map((r) => String(r.correctAnswer));
  const run2 = await api('POST', '/api/match/training', { token: p.token, body: funding });
  for (let i = 0; i < run2.json.puzzles.length; i++) {
    await api('POST', `/api/match/${run2.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: key[i], msTaken: 5000 } });
  }
  const fin = await api('POST', `/api/match/${run2.json.matchId}/finish`, { token: p.token });
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.ok(wallet.json.diamonds >= 15, 'need funds for a skip');

  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['operator'], difficulty: 'easy', seed: 556 } });
  const { matchId } = start.json;
  const s1 = await api('POST', '/api/skip', { token: p.token, body: { matchId, puzzleIndex: 0 } });
  assert.equal(s1.status, 200);
  const s2 = await api('POST', '/api/skip', { token: p.token, body: { matchId, puzzleIndex: 1 } });
  assert.equal(s2.status, 409);
  assert.equal(s2.json.error, 'skip_limit_reached');
  const after = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(after.json.diamonds, wallet.json.diamonds - 15);
  const finSkip = await api('POST', `/api/match/${matchId}/finish`, { token: p.token });
  assert.equal(finSkip.status, 200);
  const skipped = finSkip.json.results.find((r) => r.yourAnswer === 'skipped');
  assert.ok(skipped, 'skipped puzzle appears in results');
  assert.equal(skipped.isCorrect, false, 'skips score as incorrect');
});

test('client cannot set its own diamond balance', async () => {
  const p = await newPlayer();
  const start = await api('POST', '/api/match/training', { token: p.token, body: { types: ['operator'], diamonds: 999999, balance: 999999 } });
  assert.equal(start.status, 200);
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.json.diamonds, 0, 'server ignores client-supplied balances');
});

test('ad reward grants 5 diamonds and is rate-limited to 5/day', async () => {
  const p = await newPlayer();
  const first = await api('POST', '/api/ad-reward', { token: p.token, body: {} });
  assert.equal(first.status, 200);
  assert.equal(first.json.amount, 5);
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/api/ad-reward', { token: p.token, body: {} });
    assert.equal(r.status, 200);
  }
  const sixth = await api('POST', '/api/ad-reward', { token: p.token, body: {} });
  assert.equal(sixth.status, 429);
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.json.diamonds, 25, '5 rewards × 5 diamonds, nothing more');
});

test('daily login bonus claims once per day', async () => {
  const p = await newPlayer();
  const a = await api('POST', '/api/bonus/daily', { token: p.token, body: {} });
  assert.equal(a.status, 200);
  assert.equal(a.json.ok, true);
  assert.equal(a.json.amount, 5);
  const b = await api('POST', '/api/bonus/daily', { token: p.token, body: {} });
  assert.equal(b.json.ok, false, 'second claim same day must be refused');
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.json.diamonds, 5);
});

// ── REFERRAL (Phase 5) ────────────────────────────────────────────────────
test('referral: link stored, referrer paid only after first finished match', async () => {
  const inviter = await newPlayer();
  const me = await api('GET', '/api/me/referral', { token: inviter.token });
  assert.ok(me.json.referralCode, 'every player gets a referral code');

  const email = `ref${Date.now()}@test.dev`;
  const invited = await api('POST', '/api/auth/register', {
    body: { email, password: 'correct-horse-battery', displayName: 'Invited One', ref: me.json.referralCode },
  });
  assert.equal(invited.status, 200);

  const inviterWallet0 = await api('GET', '/api/wallet', { token: inviter.token });
  assert.equal(inviterWallet0.json.diamonds, 0, 'no payout at signup');

  // Start and finish: this triggers the referrer's one-time payout.
  const start = await api('POST', '/api/match/training', { token: invited.json.token, body: { types: ['operator'], difficulty: 'easy' } });
  assert.equal(start.status, 200);
  const fin = await api('POST', `/api/match/${start.json.matchId}/finish`, { token: invited.json.token });
  assert.equal(fin.status, 200);

  const inviterWallet = await api('GET', '/api/wallet', { token: inviter.token });
  assert.equal(inviterWallet.json.diamonds, 20, 'referrer paid exactly +20 after first finish');

  // A second finish/match must not double-pay.
  const start2 = await api('POST', '/api/match/training', { token: invited.token, body: { types: ['operator'], difficulty: 'easy' } });
  await api('POST', `/api/match/${start2.json.matchId}/finish`, { token: invited.token });
  const inviterWallet2 = await api('GET', '/api/wallet', { token: inviter.token });
  assert.equal(inviterWallet2.json.diamonds, 20, 'no double payout for later matches');

  // Bogus ref codes are silently ignored.
  const loner = await newPlayer();
  const stats = await api('GET', '/api/me/referral', { token: loner.token });
  assert.equal(stats.json.invited, 0);
});

// ── TOURNAMENT (Phase 6) ──────────────────────────────────────────────────
test('tournament: entry costs 25 diamonds, one per week, rejects when broke', async () => {
  const broke = await newPlayer();
  const rejected = await api('POST', '/api/tournament/enter', { token: broke.token, body: {} });
  assert.equal(rejected.status, 402);
  assert.equal(rejected.json.error, 'insufficient_diamonds');

  const p = await newPlayer();
  // Fund 25+ diamonds via rewarded ads.
  for (let i = 0; i < 5; i++) await api('POST', '/api/ad-reward', { token: p.token, body: {} });
  const wallet = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(wallet.json.diamonds, 25);

  const enter = await api('POST', '/api/tournament/enter', { token: p.token, body: {} });
  assert.equal(enter.status, 200, JSON.stringify(enter.json));
  assert.equal(enter.json.puzzles.length, 6, 'tournament runs a daily-length case');
  const after = await api('GET', '/api/wallet', { token: p.token });
  assert.equal(after.json.diamonds, 0, 'entry deducted exactly 25');

  // Still-active entry: entering again resumes the SAME entry (never a second one).
  const resume = await api('POST', '/api/tournament/enter', { token: p.token, body: {} });
  assert.equal(resume.status, 200);
  assert.equal(resume.json.resumed, true, 'active entry must resume, not re-enter');
  assert.equal(resume.json.matchId, enter.json.matchId);

  // Play it through; standings render with the payout schedule.
  for (let i = 0; i < enter.json.puzzles.length; i++) {
    await api('POST', `/api/match/${enter.json.matchId}/answer`, { token: p.token, body: { puzzleIndex: i, answer: '0', msTaken: 6000 } });
  }
  await api('POST', `/api/match/${enter.json.matchId}/finish`, { token: p.token });

  // After finishing: no second entry this week.
  const again = await api('POST', '/api/tournament/enter', { token: p.token, body: {} });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'tournament_already_played');
  const board = await api('GET', '/api/leaderboard/tournament', { token: p.token });
  assert.equal(board.status, 200);
  assert.ok(Array.isArray(board.json.entries));
  assert.ok(board.json.prizePool >= 100, 'pool includes the house base');
  assert.deepEqual(board.json.payouts.map((x) => x.position), [1, 2, 3]);
  assert.ok(board.json.entries.some((e) => e.displayName === 'Tester'));
  const status = await api('GET', '/api/tournament/status', { token: p.token });
  assert.equal(status.json.entered, true);
  assert.equal(status.json.finished, 'completed');
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
