// Competitive Reasoning Arena — HTTP server.
// Server authority rules enforced here: official scores, sessions, rate
// limits, input validation, ownership checks. The client is untrusted.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, all, one, logAudit } from './db.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, newPlayerId } from './auth.js';
import { startMatch, submitAnswer, finishMatch, abandonMatch, buildDailyTypes, puzzlePayload, takeKey } from './matchService.js';
import { MODES, levelProgress } from './scoring.js';
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dailySeed(day) {
  return seedFromString(process.env.DAILY_SEED_SECRET ?? DEV_SECRET + ':' + day);
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  if (badString(email, 5, 255) || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'bad_email' });
  if (badString(password, 8, 128)) return res.status(400).json({ error: 'bad_password', detail: 'Password must be 8-128 characters.' });
  if (badString(displayName, 2, 24)) return res.status(400).json({ error: 'bad_display_name' });
  const name = displayName.trim();
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) return res.status(400).json({ error: 'bad_display_name' });

  const existing = one('SELECT player_id FROM players WHERE email = ?', [email.toLowerCase()]);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const { salt, hash } = hashPassword(password);
  const playerId = newPlayerId();
  const now = Date.now();
  try {
    q(
      `INSERT INTO players (player_id, email, password_hash, salt, display_name, is_guest, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [playerId, email.toLowerCase(), hash, salt, name, now, now],
    );
  } catch {
    return res.status(500).json({ error: 'registration_failed' });
  }
  const token = createSession(playerId);
  logAudit(playerId, 'register');
  res.json({ token, playerId, displayName: name, isGuest: false });
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
  res.json({ token, playerId: player.player_id, displayName: player.display_name, isGuest: false });
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
  res.json({ token, playerId, displayName: 'Guest', isGuest: true });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization ?? '';
  q('DELETE FROM sessions WHERE token_hash = ?', [hashToken(header.slice(7))]);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const p = one('SELECT player_id, display_name, is_guest, xp, rating, created_at FROM players WHERE player_id = ?', [req.session.player_id]);
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
  const { types, difficulty, seed } = req.body ?? {};
  const t = validTypes(types) ?? ALL_TYPES;
  const d = DIFFS.includes(difficulty) ? difficulty : 'medium';
  const s = Number.isInteger(seed) && seed > 0 ? seed >>> 0 : undefined; // training only
  const out = startMatch({ playerId: req.session.player_id, mode: MODES.TRAINING, seed: s, types: t, difficulty: d });
  if (out.error) return res.status(500).json(out);
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes });
});

app.post('/api/match/quick', requirePlayer, (req, res) => {
  const out = startMatch({ playerId: req.session.player_id, mode: MODES.QUICK, types: ALL_TYPES, difficulty: 'medium' });
  if (out.error) return res.status(500).json(out);
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes });
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
  res.json({ matchId: out.matchId, puzzles: out.puzzles, parTimes: out.parTimes });
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
  res.json(out);
});

app.post('/api/match/:matchId/abandon', requireAuth, (req, res) => {
  res.json(abandonMatch(req.params.matchId, req.session.player_id));
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
  logAudit(null, 'server_error', { message: String(err?.message ?? err).slice(0, 200) });
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Competitive Reasoning Arena listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});
