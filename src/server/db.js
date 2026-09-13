// Database layer: SQLite via node:sqlite (no external deps).
// Schema is deliberately simple and flat so migrating to Firestore or another
// production datastore later is a mechanical translation, not a redesign.
// All access uses prepared statements (injection-safe).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  player_id      TEXT PRIMARY KEY,
  email          TEXT UNIQUE,
  password_hash  TEXT,
  salt           TEXT,
  display_name   TEXT NOT NULL,
  is_guest       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  xp             INTEGER NOT NULL DEFAULT 0,
  rating         INTEGER NOT NULL DEFAULT 1000,
  best_streak    INTEGER NOT NULL DEFAULT 0,
  total_correct  INTEGER NOT NULL DEFAULT 0,
  total_answered INTEGER NOT NULL DEFAULT 0,
  fastest_ms     INTEGER,
  dailies_done   INTEGER NOT NULL DEFAULT 0,
  settings_json  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_players_rating ON players(rating DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(player_id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

CREATE TABLE IF NOT EXISTS match_players (            -- one row per participant per match
  match_id       TEXT NOT NULL,
  player_id      TEXT NOT NULL REFERENCES players(player_id),
  mode           TEXT NOT NULL,                       -- training|quick|daily
  seed           INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',      -- active|completed|abandoned|expired
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  puzzle_ids     TEXT NOT NULL,                       -- JSON array (server-side only)
  score          INTEGER,
  correct_count  INTEGER,
  total_count    INTEGER,
  elapsed_ms     INTEGER,
  xp_awarded     INTEGER,
  rating_before  INTEGER,
  rating_after   INTEGER,
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_id, started_at DESC);

CREATE TABLE IF NOT EXISTS answers (                  -- one row per submitted answer
  match_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(player_id),
  puzzle_index INTEGER NOT NULL,
  puzzle_id   TEXT NOT NULL,
  submitted   TEXT NOT NULL,
  is_correct  INTEGER NOT NULL,
  ms_taken    INTEGER NOT NULL,
  answered_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, puzzle_index),
  FOREIGN KEY (match_id, player_id) REFERENCES match_players(match_id, player_id)
);

CREATE TABLE IF NOT EXISTS match_types (              -- per-type stats per match
  match_id   TEXT NOT NULL,
  puzzle_type TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  ms_total   INTEGER NOT NULL,
  PRIMARY KEY (match_id, puzzle_type)
);

CREATE TABLE IF NOT EXISTS player_type_stats (
  player_id   TEXT NOT NULL REFERENCES players(player_id),
  puzzle_type TEXT NOT NULL,
  correct     INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  ms_total    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, puzzle_type)
);

CREATE TABLE IF NOT EXISTS achievements (
  player_id    TEXT NOT NULL REFERENCES players(player_id),
  achievement  TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, achievement)
);

CREATE TABLE IF NOT EXISTS daily_usage (              -- one official attempt per player per day
  day         TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(player_id),
  match_id    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (day, player_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  player_id   TEXT,
  action      TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_player ON audit_log(player_id, at DESC);
`;

let db = null;

export function initDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// small helpers so route code never touches SQL strings directly
export function q(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function one(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function logAudit(playerId, action, detail = null) {
  try {
    q('INSERT INTO audit_log (at, player_id, action, detail) VALUES (?, ?, ?, ?)', [Date.now(), playerId, action, detail ? JSON.stringify(detail).slice(0, 500) : null]);
  } catch {
    // audit must never break the request
  }
}
