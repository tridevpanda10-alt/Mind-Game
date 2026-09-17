// Competitive Reasoning Arena — HTTP server.
// Server authority rules enforced here: official scores, sessions, rate
// limits, input validation, ownership checks. The client is untrusted.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, all, one, transaction, logAudit } from './db.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, newPlayerId } from './auth.js';
import { randomBytes } from 'node:crypto';
import { startMatch, submitAnswer, finishMatch, abandonMatch, buildDailyTypes, puzzlePayload, takeKey, puzzlesRemaining, hintPuzzle, skipPuzzle, freezeTime, awardDailyLoginBonus, DIAMONDS, startTournamentMatch, campaignStatus, startCampaignCase, finishCampaignCase } from './matchService.js';
import { MODES, levelProgress } from './scoring.js';
import { STARTING_LIVES } from './matchService.js';
import { isKnownSkin, getSkin, skinCatalog } from './skins.js';
import { seedFromString } from './puzzles/rng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ── env ───────────────────────────────────────────────────────────────────
function readEnvFile() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
readEnvFile();

const PORT_RAW = Number(process.env.PORT);
const PORT = Number.isInteger(PORT_RAW) && PORT_RAW > 0 ? PORT_RAW : 3000;
const DB_PATH = process.env.DB_PATH ?? join(ROOT, 'data', 'arena.db');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEV_SECRET = 'dev-only-secret-change-me';

// ── db ────────────────────────────────────────────────────────────────────
initDb(DB_PATH);

// ── app ───────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' })); // tiny payloads only; huge = 413

// security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// rate limits (env-tunable so integration tests can raise auth limits
// without weakening production defaults)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_API ?? 240), standardHeaders: 'draft-7', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.RATE_AUTH ?? 20), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } });
const submitLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.RATE_SUBMIT ?? 90), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_submissions' } });
app.use('/api/', apiLimiter);

// ── session middleware ────────────────────────────────────────────────────
function currentSession(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const h = hashToken(token);
  const row = one(
    `SELECT s.player_id, s.expires_at, p.display_name, p.is_guest, p.xp, p.rating
     FROM sessions s JOIN players p ON p.player_id = s.player_id WHERE s.token_hash = ?`,
    [h],
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    q('DELETE FROM sessions WHERE token_hash = ?', [h]);
    return null;
  }
  return row;
}

function requireAuth(req, res, next) {
  const s = currentSession(req);
  if (!s) return res.status(401).json({ error: 'auth_required' });
  req.session = s;
  next();
}

function requirePlayer(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.is_guest) return res.status(403).json({ error: 'guest_not_allowed', detail: 'Register to play competitive modes.' });
    next();
  });
}

// ── validation helpers ────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
function badString(v, min, max) {
  return typeof v !== 'string' || v.length < min || v.length > max;
}

function newReferralCode() {
  return randomBytes(5).toString('base64url').replace(/[-_]/g, 'A').slice(0, 8); // short, URL-safe, unique per UNIQUE constraint
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dailySeed(day) {
  return seedFromString(process.env.DAILY_SEED_SECRET ?? DEV_SECRET + ':' + day);
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password, displayName, ref } = req.body ?? {};
  if (badString(email, 5, 255) || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'bad_email' });
  if (badString(password, 8, 128)) return res.status(400).json({ error: 'bad_password', detail: 'Password must be 8-128 characters.' });
  if (badString(displayName, 2, 24)) return res.status(400).json({ error: 'bad_display_name' });
  const name = displayName.trim();
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) return res.status(400).json({ error: 'bad_display_name' });

  const existing = one('SELECT player_id FROM players WHERE email = ?', [email.toLowerCase()]);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  // Referral: store the code only if it actually belongs to another player.
  let referredBy = null;
  if (typeof ref === 'string' && ref.length >= 4 && ref.length <= 16) {
    const referrer = one('SELECT player_id FROM players WHERE referral_code = ?', [ref]);
    if (referrer && referrer.player_id !== null) referredBy = ref;
  }

  const { salt, hash } = hashPassword(password);
  const playerId = newPlayerId();
  const now = Date.now();
  let referralCode = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    referralCode = newReferralCode();
    try {
      q(
        `INSERT INTO players (player_id, email, password_hash, salt, display_name, is_guest, created_at, last_active_at, referral_code, referred_by)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [playerId, email.toLowerCase(), hash, salt, name, now, now, referralCode, referredBy],
      );
      break;
    } catch (e) {
      if (attempt === 4) return res.status(500).json({ error: 'registration_failed' });
    }
  }
  const token = createSession(playerId);
  logAudit(playerId, 'register', referredBy ? { referredBy } : null);
  res.json({ token, playerId, displayName: name, isGuest: false, referralCode, diamonds: 0 });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body ?? {};
  if (badString(email, 5, 255) || badString(password, 1, 128)) return res.status(400).json({ error: 'bad_credentials' });
  const player = one('SELECT * FROM players WHERE email = ?', [String(email).toLowerCase()]);
  if (!player || !player.password_hash) {
    logAudit(null, 'login_failed', { email: String(email).slice(0, 64) });
    return res.status(401).json({ error: 'bad_credentials' });
  }
  if (!verifyPassword(password, player.salt, player.password_hash)) {
    logAudit(player.player_id, 'login_failed');
    return res.status(401).json({ error: 'bad_credentials' });
  }
  const token = createSession(player.player_id);
  q('UPDATE players SET last_active_at = ? WHERE player_id = ?', [Date.now(), player.player_id]);
  logAudit(player.player_id, 'login');
  res.json({ token, playerId: player.player_id, displayName: player.display_name, isGuest: false, referralCode: player.referral_code ?? null, diamonds: player.diamonds ?? 0 });
});

function createSession(playerId) {
  const token = newSessionToken();
  q('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [hashToken(token), playerId, Date.now(), Date.now() + SESSION_TTL_MS]);
  return token;
}

app.post('/api/auth/guest', authLimiter, (req, res) => {
  const playerId = newPlayerId();
  const now = Date.now();
  q(
    `INSERT INTO players (player_id, display_name, is_guest, created_at, last_active_at) VALUES (?, ?, 1, ?, ?)`,
    [playerId, 'Guest-' + playerId.slice(2, 6).toUpperCase(), now, now],
  );
  const token = createSession(playerId);
  logAudit(playerId, 'guest_session');
  res.json({ token, playerId, displayName: 'Guest', isGuest: true, referralCode: null, diamonds: 0 });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization ?? '';
  q('DELETE FROM sessions WHERE token_hash = ?', [hashToken(header.slice(7))]);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const p = one('SELECT player_id, display_name, is_guest, xp, rating, diamonds, referral_code, created_at, first_match_at FROM players WHERE player_id = ?', [req.session.player_id]);
  if (!p) return res.status(404).json({ error: 'no_player' });
  const prog = levelProgress(p.xp);
  const achievements = all('SELECT achievement, unlocked_at FROM achievements WHERE player_id = ? ORDER BY unlocked_at DESC', [p.player_id]);
  res.json({
    playerId: p.player_id,
    displayName: p.display_name,
    isGuest: Boolean(p.is_guest),
    xp: p.xp,
    rating: p.rating,
    level: prog.level,
    levelProgress: prog,
    diamonds: p.diamonds ?? 0,
    referralCode: p.referral_code ?? null,
    firstMatchAt: p.first_match_at ?? null,
    achievements,
  });
});

// ── MATCH ROUTES ──────────────────────────────────────────────────────────
const ALL_TYPES = ['pattern', 'sequence', 'matrix', 'deduction', 'conditional', 'number', 'operator', 'spatial', 'mastermind'];
const DIFFS = ['rookie', 'easy', 'medium', 'hard', 'expert', 'master'];

function validTypes(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 9) return null;
  const set = new Set(v);
  return v.every((t) => ALL_TYPES.includes(t)) ? [...set] : null;
}

app.post('/api/match/training', requireAuth, (req, res) => {
  const { types, difficulty, seed, count } = req.body ?? {};
  const t = validTypes(types) ?? ALL_TYPES;
  const d = DIFFS.includes(difficulty) ? difficulty : 'medium';
  const s = Number.isInteger(seed) && seed > 0 ? seed >>> 0 : undefined; // training only
  const n = Number.isInteger(count) && count > 0 ? Math.min(30, count) : undefined; // player-chosen, max 30
  const out = startMatch({ playerId: req.session.player_id, mode: MODES.TRAINING, seed: s, types: t, difficulty: d, count: n });
  if (out.error) return res.status(500).json(out);
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes, lives: out.lives });
});

app.post('/api/match/quick', requirePlayer, (req, res) => {
  const out = startMatch({ playerId: req.session.player_id, mode: MODES.QUICK, types: ALL_TYPES, difficulty: 'medium' });
  if (out.error) return res.status(500).json(out);
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes, lives: out.lives });
});

app.get('/api/daily/status', requireAuth, (req, res) => {
  const day = todayKey();
  const used = one('SELECT * FROM daily_usage WHERE day = ? AND player_id = ?', [day, req.session.player_id]);
  res.json({
    day,
    available: !used,
    finished: used ? used.status : null,
    matchId: used?.match_id ?? null,
  });
});

app.post('/api/match/daily', requirePlayer, (req, res) => {
  const day = todayKey();
  const used = one('SELECT * FROM daily_usage WHERE day = ? AND player_id = ?', [day, req.session.player_id]);
  if (used) {
    if (used.status === 'active') {
      const entry = takeKey(used.match_id);
      if (entry) {
        return res.json({
          matchId: used.match_id,
          resumed: true,
          puzzles: entry.puzzles.map((p) => puzzlePayload(p)),
          parTimes: entry.puzzles.map((p) => 0),
        });
      }
    }
    return res.status(409).json({ error: 'daily_already_played', detail: 'The daily challenge allows one official attempt.' });
  }
  const seed = dailySeed(day);
  const types = buildDailyTypes(day);
  const out = startMatch({ playerId: req.session.player_id, mode: MODES.DAILY, seed, types, difficulty: 'medium', dailyDay: day });
  if (out.error) return res.status(500).json(out);
  q('INSERT INTO daily_usage (day, player_id, match_id, status) VALUES (?, ?, ?, ?)', [day, req.session.player_id, out.matchId, 'active']);
  logAudit(req.session.player_id, 'daily_start', { day });
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes, lives: out.lives });
});

app.post('/api/match/:matchId/answer', submitLimiter, requireAuth, (req, res) => {
  const { puzzleIndex, answer, msTaken } = req.body ?? {};
  const out = submitAnswer({ matchId: req.params.matchId, playerId: req.session.player_id, puzzleIndex, answer, msTaken });
  if (out.error) {
    const code = { not_your_match: 403, match_closed: 409, already_answered: 409, match_not_found_or_expired: 404 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  res.json(out);
});

app.post('/api/match/:matchId/finish', submitLimiter, requireAuth, (req, res) => {
  const out = finishMatch({ matchId: req.params.matchId, playerId: req.session.player_id });
  if (out.error) {
    const code = { not_your_match: 403, already_finished: 409, match_not_found_or_expired: 404, no_player: 404 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  // Campaign progress: any completed finish advances the unlock pointer and
  // marks the case played (failed attempts are recorded too — retry allowed).
  let campaign = null;
  if (out.mode === 'campaign') campaign = finishCampaignCase({ matchId: req.params.matchId, playerId: req.session.player_id, status: 'completed' });
  // Referral reward: the referrer earns diamonds only after the invited
  // player finishes their FIRST match (not on signup — that would invite
  // fake-account farming). Guest sessions never count.
  const referral = maybePayReferrer(req.session.player_id);
  res.json({ ...out, mode: out.mode ?? undefined, campaign, referralBonus: referral });
});

// Failed-match results: full post-mortem (no score payout, no wallet/rating
// side effects — the match was already finalized as 'failed' by lives).
app.get('/api/match/:matchId/results', requireAuth, (req, res) => {
  const mp = one('SELECT * FROM match_players WHERE match_id = ? AND player_id = ?', [req.params.matchId, req.session.player_id]);
  if (!mp) return res.status(404).json({ error: 'match_not_found' });
  if (mp.status !== 'failed') return res.status(409).json({ error: 'not_a_failed_match' });
  const answers = all('SELECT * FROM answers WHERE match_id = ? ORDER BY puzzle_index', [req.params.matchId]);
  const rows = all('SELECT puzzle_ids FROM match_players WHERE match_id = ? AND player_id = ?', [req.params.matchId, req.session.player_id]);
  let ids = [];
  try { ids = JSON.parse(rows[0]?.puzzle_ids ?? '[]'); } catch { ids = []; }
  const results = answers.map((a, i) => ({
    puzzleId: ids[a.puzzle_index] ?? `p${a.puzzle_index}`,
    difficulty: null,
    yourAnswer: a.submitted,
    isCorrect: Boolean(a.is_correct),
    msTaken: a.ms_taken,
  }));
  res.json({ status: 'failed', mode: mp.mode, livesLeft: 0, correctCount: answers.filter((a) => a.is_correct).length, totalCount: ids.length, results });
});

function maybePayReferrer(playerId) {
  const out = transaction(() => {
    const p = one('SELECT is_guest, referred_by, first_match_at FROM players WHERE player_id = ?', [playerId]);
    if (!p || p.is_guest || !p.referred_by || p.first_match_at) return { paid: false };
    const referrer = one('SELECT player_id FROM players WHERE referral_code = ?', [p.referred_by]);
    if (!referrer) return { paid: false };
    q('UPDATE players SET first_match_at = ? WHERE player_id = ?', [Date.now(), playerId]);
    q('UPDATE players SET diamonds = diamonds + ? WHERE player_id = ?', [DIAMONDS.referralBonus, referrer.player_id]);
    q('INSERT INTO economy_log (at, player_id, kind, amount, day, detail) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), referrer.player_id, 'referral', DIAMONDS.referralBonus, todayKey(), `invited:${playerId}`]);
    logAudit(referrer.player_id, 'referral_reward', { invited: playerId, amount: DIAMONDS.referralBonus });
    return { paid: true, amount: DIAMONDS.referralBonus };
  });
  return out;
}

// ── TOURNAMENT PRIZES (diamonds only; settled lazily on leaderboard read) ──
const TOURNAMENT_PAYOUTS = [
  { position: 1, diamonds: 50 },
  { position: 2, diamonds: 30 },
  { position: 3, diamonds: 15 },
];
const TOURNAMENT_PRIZE_BASE = 100; // extra diamonds added to the pool from house

function settleTournamentPayouts(week) {
  const prizePool = TOURNAMENT_PRIZE_BASE + one('SELECT COUNT(*) AS n FROM tournament_entries WHERE week = ?', [week]).n * DIAMONDS.tournamentEntry;
  const settled = one('SELECT COUNT(*) AS n FROM tournament_payouts WHERE week = ?', [week]).n > 0;
  if (!settled) {
    transaction(() => {
      const rows = all(
        `SELECT te.player_id, mp.score, mp.elapsed_ms
         FROM tournament_entries te JOIN match_players mp ON mp.match_id = te.match_id AND mp.player_id = te.player_id
         WHERE te.week = ? AND mp.status = 'completed'
         ORDER BY mp.score DESC, mp.elapsed_ms ASC`,
        [week],
      );
      for (const payout of TOURNAMENT_PAYOUTS) {
        const winner = rows[payout.position - 1];
        if (!winner) continue;
        q('UPDATE players SET diamonds = diamonds + ? WHERE player_id = ?', [payout.diamonds, winner.player_id]);
        q('UPDATE tournament_entries SET paid_out = 1 WHERE week = ? AND player_id = ?', [week, winner.player_id]);
        q('INSERT INTO economy_log (at, player_id, kind, amount, day, detail) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), winner.player_id, 'tournament_prize', payout.diamonds, todayKey(), `week:${week} pos:${payout.position}`]);
        logAudit(winner.player_id, 'tournament_prize', { week, position: payout.position, amount: payout.diamonds });
      }
      q('INSERT INTO tournament_payouts (week, settled_at) VALUES (?, ?)', [week, Date.now()]);
    });
  }
  return { prizePool, schedule: TOURNAMENT_PAYOUTS };
}

app.post('/api/match/:matchId/abandon', requireAuth, (req, res) => {
  res.json(abandonMatch(req.params.matchId, req.session.player_id));
});

// How many puzzles are left in an active match (used by "practice the rest").
app.get('/api/match/:matchId/remaining', requireAuth, (req, res) => {
  const out = puzzlesRemaining({ matchId: req.params.matchId, playerId: req.session.player_id });
  if (!out) return res.status(404).json({ error: 'match_not_found_or_expired' });
  res.json(out);
});

// ── ECONOMY ROUTES (all server-validated; client never sends a balance) ───
function diamondsOf(playerId) {
  const p = one('SELECT diamonds FROM players WHERE player_id = ?', [playerId]);
  return p ? p.diamonds : 0;
}

app.get('/api/wallet', requireAuth, (req, res) => {
  res.json({ diamonds: diamondsOf(req.session.player_id) });
});

// Daily login bonus: +5 diamonds once per calendar day, auto-claimed on load.
app.post('/api/bonus/daily', requireAuth, (req, res) => {
  const out = awardDailyLoginBonus(req.session.player_id);
  res.json({ ok: out.ok, diamonds: diamondsOf(req.session.player_id), amount: out.ok ? out.amount : 0 });
});

// Buy a hint: eliminates one incorrect option on the current puzzle.
// Max 1 per puzzle. Does NOT reveal the answer.
app.post('/api/hint', submitLimiter, requireAuth, (req, res) => {
  const { matchId, puzzleIndex } = req.body ?? {};
  if (typeof matchId !== 'string' || matchId.length > 64) return res.status(400).json({ error: 'bad_match_id' });
  const out = hintPuzzle({ matchId, playerId: req.session.player_id, puzzleIndex });
  if (out.error) {
    const code = { insufficient_diamonds: 402, hint_limit_reached: 409, hints_forbidden_boss: 409, already_answered: 409, match_closed: 409, not_your_match: 403, match_not_found_or_expired: 404, bad_index: 400 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  res.json(out);
});

// Skip the current puzzle: scored as incorrect, lets the player move on.
// Max 1 per match.
app.post('/api/skip', submitLimiter, requireAuth, (req, res) => {
  const { matchId, puzzleIndex } = req.body ?? {};
  if (typeof matchId !== 'string' || matchId.length > 64) return res.status(400).json({ error: 'bad_match_id' });
  const out = skipPuzzle({ matchId, playerId: req.session.player_id, puzzleIndex });
  if (out.error) {
    const code = { insufficient_diamonds: 402, skip_limit_reached: 409, already_answered: 409, match_closed: 409, not_your_match: 403, match_not_found_or_expired: 404, bad_index: 400 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  res.json(out);
});

// ── GAME FEEL: freeze-time powerup + campaign ──────────────────────────
// Freeze Time (10 💎): pauses the visible countdown for 10s. Actual msTaken
// still accrues — pressure relief, not score advantage.
app.post('/api/freeze', submitLimiter, requireAuth, (req, res) => {
  const { matchId, puzzleIndex } = req.body ?? {};
  if (typeof matchId !== 'string' || matchId.length > 64) return res.status(400).json({ error: 'bad_match_id' });
  const out = freezeTime({ matchId, playerId: req.session.player_id, puzzleIndex });
  if (out.error) {
    const code = { insufficient_diamonds: 402, match_closed: 409, not_your_match: 403, match_not_found_or_expired: 404, bad_index: 400, no_player: 404 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  res.json(out);
});

app.get('/api/campaign', requireAuth, (req, res) => {
  res.json(campaignStatus(req.session.player_id));
});

app.post('/api/campaign/start', submitLimiter, requireAuth, (req, res) => {
  const caseNumber = req.body?.caseNumber;
  const out = startCampaignCase({ playerId: req.session.player_id, caseNumber });
  if (out.error) {
    const code = { bad_case: 400, case_locked: 403, generation_failed: 500 }[out.error] ?? 400;
    return res.status(code).json(out);
  }
  res.json(out);
});
function weekKey(now = new Date()) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - day);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function tournamentSeed(week) {
  return seedFromString((process.env.TOURNAMENT_SEED_SECRET ?? DEV_SECRET) + ':week:' + week);
}

app.get('/api/tournament/status', requireAuth, (req, res) => {
  const week = weekKey();
  const usage = one('SELECT * FROM tournament_entries WHERE week = ? AND player_id = ?', [week, req.session.player_id]);
  const pool = one('SELECT COUNT(*) AS n FROM tournament_entries WHERE week = ?', [week]);
  res.json({
    week,
    entered: Boolean(usage),
    finished: usage ? usage.status : null,
    entryCost: DIAMONDS.tournamentEntry,
    prizePool: pool.n * DIAMONDS.tournamentEntry + TOURNAMENT_PRIZE_BASE,
    entrants: pool.n,
    matchId: usage?.match_id ?? null,
  });
});

app.post('/api/tournament/enter', submitLimiter, requirePlayer, (req, res) => {
  const week = weekKey();
  const existing = one('SELECT * FROM tournament_entries WHERE week = ? AND player_id = ?', [week, req.session.player_id]);
  if (existing && existing.status !== 'active') return res.status(409).json({ error: 'tournament_already_played', detail: 'One tournament entry per player per week.' });
  if (existing && existing.status === 'active') {
    const entry = takeKey(existing.match_id);
    if (entry) {
      return res.json({ matchId: existing.match_id, resumed: true, puzzles: entry.puzzles.map((p) => puzzlePayload(p)), parTimes: entry.puzzles.map(() => 0), lives: STARTING_LIVES });
    }
  }
  const out = transaction(() => {
    const p = one('SELECT diamonds FROM players WHERE player_id = ?', [req.session.player_id]);
    if (!p) return { error: 'no_player' };
    if (p.diamonds < DIAMONDS.tournamentEntry) return { error: 'insufficient_diamonds' };
    const started = startTournamentMatch({ playerId: req.session.player_id, seed: tournamentSeed(week) });
    if (started.error) return started;
    q('UPDATE players SET diamonds = diamonds - ? WHERE player_id = ? AND diamonds >= ?', [DIAMONDS.tournamentEntry, req.session.player_id, DIAMONDS.tournamentEntry]);
    q('INSERT INTO tournament_entries (week, player_id, match_id, status) VALUES (?, ?, ?, ?)', [week, req.session.player_id, started.matchId, 'active']);
    q('INSERT INTO economy_log (at, player_id, kind, amount, day, detail) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), req.session.player_id, 'tournament_entry', -DIAMONDS.tournamentEntry, todayKey(), week]);
    logAudit(req.session.player_id, 'tournament_enter', { week });
    return started;
  });
  if (out.error) {
    const code = { insufficient_diamonds: 402, no_player: 404 }[out.error] ?? 500;
    return res.status(code).json(out);
  }
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes, lives: out.lives });
});

app.get('/api/leaderboard/tournament', requireAuth, (req, res) => {
  const week = weekKey();
  const payouts = settleTournamentPayouts(week);
  const rows = all(
    `SELECT p.display_name, mp.score, mp.correct_count, mp.total_count, mp.elapsed_ms, te.paid_out
     FROM tournament_entries te
     JOIN match_players mp ON mp.match_id = te.match_id AND mp.player_id = te.player_id
     JOIN players p ON p.player_id = te.player_id
     WHERE te.week = ? AND mp.status = 'completed'
     ORDER BY mp.score DESC, mp.elapsed_ms ASC LIMIT 50`,
    [week],
  );
  res.json({
    week,
    prizePool: payouts.prizePool,
    payouts: payouts.schedule.map((s) => ({ position: s.position, diamonds: s.diamonds })),
    entries: rows.map((r, i) => ({
      position: i + 1,
      displayName: r.display_name,
      score: r.score,
      correct: r.correct_count,
      total: r.total_count,
      elapsedMs: r.elapsed_ms,
      paidOut: Boolean(r.paid_out),
    })),
  });
});

// ── PROFILE & LEADERBOARD ─────────────────────────────────────────────────
app.get('/api/profile', requireAuth, (req, res) => {
  const p = one('SELECT * FROM players WHERE player_id = ?', [req.session.player_id]);
  if (!p) return res.status(404).json({ error: 'no_player' });
  const typeStats = all('SELECT puzzle_type, correct, total, ms_total FROM player_type_stats WHERE player_id = ?', [p.player_id]);
  const recent = all(
    `SELECT match_id, mode, status, started_at, finished_at, score, correct_count, total_count, elapsed_ms, xp_awarded, rating_before, rating_after
     FROM match_players WHERE player_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 10`,
    [p.player_id],
  );
  const totals = one(
    `SELECT COUNT(*) AS games,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
            AVG(CASE WHEN status='completed' THEN score END) AS avg_score
     FROM match_players WHERE player_id = ? AND mode != 'training'`,
    [p.player_id],
  );
  const ach = all('SELECT achievement, unlocked_at FROM achievements WHERE player_id = ?', [p.player_id]);
  const prog = levelProgress(p.xp);
  res.json({
    playerId: p.player_id,
    displayName: p.display_name,
    isGuest: Boolean(p.is_guest),
    createdAt: p.created_at,
    xp: p.xp,
    level: prog.level,
    levelProgress: prog,
    rating: p.rating,
    totalCorrect: p.total_correct,
    totalAnswered: p.total_answered,
    accuracy: p.total_answered ? p.total_correct / p.total_answered : null,
    fastestMs: p.fastest_ms,
    bestStreak: p.best_streak,
    dailiesDone: p.dailies_done,
    typeStats: typeStats.map((t) => ({
      type: t.puzzle_type,
      correct: t.correct,
      total: t.total,
      accuracy: t.total ? t.correct / t.total : 0,
      avgMs: t.correct ? Math.round(t.ms_total / t.total) : null,
    })),
    recent,
    achievements: ach,
    totals: { games: totals.games, completed: totals.completed ?? 0, avgScore: totals.avg_score ? Math.round(totals.avg_score) : null },
  });
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const board = ['rating', 'xp'].includes(req.query.board) ? req.query.board : 'rating';
  const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
  const perPage = 25;
  const order = board === 'xp' ? 'xp DESC' : 'rating DESC, xp DESC';
  const rows = all(
    `SELECT display_name, rating, xp, total_answered, dailies_done FROM players WHERE is_guest = 0 ORDER BY ${order} LIMIT ? OFFSET ?`,
    [perPage + 1, (page - 1) * perPage],
  );
  const hasMore = rows.length > perPage;
  const list = rows.slice(0, perPage).map((r, i) => ({
    position: (page - 1) * perPage + i + 1,
    displayName: r.display_name,
    rating: r.rating,
    xp: r.xp,
    answered: r.total_answered,
  }));
  const me = one('SELECT rating, xp FROM players WHERE player_id = ?', [req.session.player_id]);
  let myPosition = null;
  if (me) {
    const col = board === 'xp' ? 'xp' : 'rating';
    const better = one(`SELECT COUNT(*) + 1 AS pos FROM players WHERE is_guest = 0 AND ${col} > ?`, [board === 'xp' ? me.xp : me.rating]);
    myPosition = better.pos;
  }
  res.json({ board, page, hasMore, entries: list, myPosition });
});

// AFFILIATE_SLOT: reserved banner/ad slot for a future approved external
// affiliate partner. Intentionally left empty — no fabricated partner URLs.

// daily leaderboard: completed daily matches for today
app.get('/api/leaderboard/daily', requireAuth, (req, res) => {
  const day = todayKey();
  const rows = all(
    `SELECT p.display_name, mp.score, mp.correct_count, mp.total_count, mp.elapsed_ms
     FROM match_players mp JOIN players p ON p.player_id = mp.player_id
     JOIN daily_usage d ON d.match_id = mp.match_id AND d.player_id = mp.player_id
     WHERE d.day = ? AND mp.status = 'completed'
     ORDER BY mp.score DESC, mp.elapsed_ms ASC LIMIT 50`,
    [day],
  );
  res.json({ day, entries: rows.map((r, i) => ({ position: i + 1, displayName: r.display_name, score: r.score, correct: r.correct_count, total: r.total_count, elapsedMs: r.elapsed_ms })) });
});

// ── ADS CONFIG (client reads provider selection from here) ───────────────
// Single source of truth for which ad provider the client loads. Switching
// networks is an env change + deploy — never a client release.
// See docs/ads-integration.md for the go-live checklist.
const ADS_PROVIDER = ['mock', 'google-h5', 'off'].includes(process.env.ADS_PROVIDER)
  ? process.env.ADS_PROVIDER
  : 'mock';
const ADS_CLIENT = process.env.ADS_CLIENT?.trim() || null;      // e.g. ca-pub-…
const ADS_REWARD_SECRET = process.env.ADS_REWARD_SECRET?.trim() || null;

app.get('/api/config', (req, res) => {
  res.json({
    ads: {
      provider: ADS_PROVIDER,
      // Public publisher id — safe to expose (it ships in the ad tag anyway).
      adClient: ADS_PROVIDER === 'google-h5' ? ADS_CLIENT : null,
    },
  });
});

// ── SKINS (world skins; ownership server-validated, diamonds only) ──────
// The client's skin registry is presentation; THIS list is the trusted
// price/ownership source. A skin unlock is an economy mutation like any
// other: validated against the DB, deducted atomically, fully logged.
function unlockedSkinsOf(playerId) {
  const row = one('SELECT unlocked_skins FROM players WHERE player_id = ?', [playerId]);
  try { return JSON.parse(row?.unlocked_skins ?? '[]'); } catch { return ['detective']; }
}

app.get('/api/skins', requireAuth, (req, res) => {
  res.json({ unlocked: unlockedSkinsOf(req.session.player_id), skins: skinCatalog() });
});

app.post('/api/skins/unlock', submitLimiter, requireAuth, (req, res) => {
  const skinId = typeof req.body?.skinId === 'string' ? req.body.skinId.slice(0, 32) : '';
  const skin = getSkin(skinId);
  if (!isKnownSkin(skinId) || !skin) return res.status(400).json({ error: 'unknown_skin' });
  if (skin.free) return res.status(400).json({ error: 'skin_is_free', detail: 'This skin is free for everyone; nothing to unlock.' });
  const owned = unlockedSkinsOf(req.session.player_id);
  if (owned.includes(skinId)) {
    return res.status(409).json({ error: 'already_unlocked', detail: 'You already own this skin.', unlocked: owned, diamonds: diamondsOf(req.session.player_id) });
  }
  const balance = diamondsOf(req.session.player_id);
  if (balance < skin.priceInDiamonds) {
    return res.status(402).json({ error: 'insufficient_diamonds', detail: `This skin costs ${skin.priceInDiamonds} 💎. You have ${balance} 💎.` });
  }
  transaction(() => {
    q('UPDATE players SET diamonds = diamonds - ? WHERE player_id = ?', [skin.priceInDiamonds, req.session.player_id]);
    const next = JSON.stringify([...owned, skinId]);
    q('UPDATE players SET unlocked_skins = ? WHERE player_id = ?', [next, req.session.player_id]);
    q('INSERT INTO economy_log (at, player_id, kind, amount, day) VALUES (?, ?, ?, ?, ?)', [Date.now(), req.session.player_id, 'skin_unlock', -skin.priceInDiamonds, todayKey()]);
  });
  logAudit(req.session.player_id, 'skin_unlock', { skinId, price: skin.priceInDiamonds });
  res.json({ ok: true, skinId, diamonds: diamondsOf(req.session.player_id), unlocked: unlockedSkinsOf(req.session.player_id) });
});

// ── AD REWARDS (server-enforced quota; provider-verifiable) ───────────────
// The client's "ad watched" signal is trusted only as far as this quota.
// VERIFIER (extension point): when a real network is connected, verify the
// reward server-side before paying — e.g. Google's Server-Side Verification
// (SSV) callbacks, or a signed receipt from the provider. Wire it by filling
// verifyReward() below and setting ADS_REWARD_SECRET; until then rewards are
// capped hard by quota AND disabled for real providers without a verifier.
const AD_REWARD_DAILY_LIMIT = 5;

async function verifyReward({ provider }) {
  if (provider !== 'google-h5') return true; // mock: nothing to verify
  // TODO(ad-ssv): confirm the rewarded completion against the ad network
  // (SSV callback keyed by ADS_REWARD_SECRET, or provider receipt API).
  return Boolean(ADS_REWARD_SECRET); // fail closed until this is implemented
}

app.post('/api/ad-reward', submitLimiter, requireAuth, async (req, res) => {
  const provider = typeof req.body?.provider === 'string' ? req.body.provider.slice(0, 32) : 'mock';
  if (!['mock', 'google-h5'].includes(provider)) return res.status(400).json({ error: 'bad_provider' });
  if (!(await verifyReward({ provider }))) {
    return res.status(403).json({ error: 'ad_reward_unverified', detail: 'Reward verification is not configured for this ad provider.' });
  }
  const day = todayKey();
  const used = one("SELECT COUNT(*) AS n FROM economy_log WHERE player_id = ? AND kind = 'ad_reward' AND day = ?", [req.session.player_id, day]);
  if (used.n >= AD_REWARD_DAILY_LIMIT) return res.status(429).json({ error: 'ad_reward_limit_reached', detail: `Rewarded ads are limited to ${AD_REWARD_DAILY_LIMIT} per day.` });
  transaction(() => {
    q('UPDATE players SET diamonds = diamonds + ? WHERE player_id = ?', [DIAMONDS.adReward, req.session.player_id]);
    q('INSERT INTO economy_log (at, player_id, kind, amount, day) VALUES (?, ?, ?, ?, ?)', [Date.now(), req.session.player_id, 'ad_reward', DIAMONDS.adReward, day]);
  });
  logAudit(req.session.player_id, 'ad_reward', { amount: DIAMONDS.adReward, provider });
  res.json({ ok: true, diamonds: diamondsOf(req.session.player_id), amount: DIAMONDS.adReward, remainingToday: AD_REWARD_DAILY_LIMIT - used.n - 1 });
});

// ── REFERRAL (affiliate slot reserved; diamonds only, no cash value) ──────
app.get('/api/me/referral', requireAuth, (req, res) => {
  const p = one('SELECT referral_code FROM players WHERE player_id = ?', [req.session.player_id]);
  const code = p?.referral_code ?? null;
  const invited = code ? one('SELECT COUNT(*) AS n FROM players WHERE referred_by = ?', [code]).n : 0;
  const rewarded = code ? one('SELECT COUNT(*) AS n FROM players WHERE referred_by = ? AND first_match_at IS NOT NULL', [code]).n : 0;
  res.json({ referralCode: code, invited, rewarded });
});

// ── static frontend ───────────────────────────────────────────────────────
const PUBLIC = join(ROOT, 'src', 'public');
const IS_PROD = process.env.NODE_ENV === 'production';
app.use(express.static(PUBLIC, {
  index: 'index.html',
  maxAge: IS_PROD ? '1h' : 0, // dev: never cache; stale modules mask bugs
  etag: true,
}));

// JSON 404 for unknown API paths; SPA fallback for everything else
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((req, res) => res.sendFile(join(PUBLIC, 'index.html')));

// error handler: no stack leaks
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  console.error(`[server_error] ${req?.method} ${req?.path}:`, err?.stack ?? err);
  logAudit(null, 'server_error', { message: String(err?.message ?? err).slice(0, 200) });
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Competitive Reasoning Arena listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});
