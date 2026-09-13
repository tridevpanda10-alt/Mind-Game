# Competitive Reasoning Arena

A server-authoritative competitive mental-skill game. Pure reasoning, verified
scores, fair competition. No client can fake a result.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
npm test             # 27 automated tests (engine + integration + adversarial)
```

Optional configuration via `.env` (see `.env.example`):

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `PORT`               | HTTP port (default 3000)                              |
| `DB_PATH`            | SQLite file location (default `data/arena.db`)        |
| `DAILY_SEED_SECRET`  | Shared secret mixed into daily challenge seeds        |
| `RATE_API/RATE_AUTH/RATE_SUBMIT` | Rate-limit overrides (testing)           |
| `NODE_ENV`           | `production` enables 1h static asset caching          |

## Architecture

```
UI (vanilla ES modules)  →  Game state (screens/*)  →  Puzzle engine
        ↓                                                        ↓
   API layer (fetch)  →  Express server  →  scoring.js + matchService.js
                                                    ↓
                                          SQLite (node:sqlite)
```

- **Puzzle engine** (`src/server/puzzles/`): 9 generator types, each with a
  brute-force or construct-then-verify uniqueness guarantee. Deterministic:
  the same seed always reproduces the same puzzle, which powers daily
  challenges and reproducible tests.
- **Scoring** (`src/server/scoring.js`): difficulty base + speed bonus +
  streak multiplier − wrong-answer penalty; ELO-style rating with
  provisional K; XP/levels; achievement checks. Pure functions, unit-testable.
- **Match service** (`src/server/matchService.js`): answer keys live
  server-side only. Explanations unlock per-puzzle after submission.
  Anti-cheat: 500ms solve-time floor, duplicate-submission blocks, ownership
  checks, per-request validation, audit log of suspicious events.
- **Auth** (`src/server/auth.js`): scrypt password hashing; opaque session
  tokens, only their SHA-256 hashes stored. Guests may train but every
  ranked surface (daily, quick/ranked, leaderboards) is server-gated.

## Game modes

- **Training** — pick any of 9 reasoning types × 6 difficulties, no rating risk.
- **Quick Match / Ranked** — 5 mixed puzzles; server-computed score and rating.
- **Daily Challenge** — identical deterministic puzzle set for all players each
  day, one official attempt, global daily leaderboard.

## Testing

```bash
npm test                  # everything
npm run test:engine       # generators, validation, ≥30-puzzle quality gate
npm run test:integration  # live-server API + adversarial suite
```

The integration suite spawns a real server and attacks it: forged tokens,
other players' matches, duplicate answers, negative/absurd times, malformed
JSON, oversized payloads, replayed dailies, and rate-limit bursts.

## Production migration path

SQLite is a development store by design. The schema is flat and keyed by
stable opaque player IDs, so moving to Firebase/Firestore (or any managed
DB) is a mechanical translation of `src/server/db.js` — no redesign. The
daily seed already mixes a server-side secret, so all app servers generate
identical challenges only when they share `DAILY_SEED_SECRET`.

## Asset licensing

All visuals are original CSS and inline SVG; system font stack. No
third-party copyrighted assets are used.

## Known limitations (by design, for this phase)

- Single-process answer keys (in-memory, TTL-bounded) — move to the DB for
  multi-instance deployments.
- Ranked rating uses a fixed opponent pool (1000); seasonal/ELO matchmaking
  is intentionally deferred until core stability is proven.
- Five-tester validation program is the next milestone.
