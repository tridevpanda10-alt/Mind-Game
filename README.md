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
| `TOURNAMENT_SEED_SECRET` | Shared secret mixed into weekly tournament seeds   |
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

- **Training** — pick any of 9 reasoning types × 6 difficulties and a session
  length (5–30 puzzles, default 10). No rating risk. No diamonds earned or
  spent.
- **Quick Match / Ranked** — 12 mixed puzzles; server-computed score and
  rating.
- **Daily Challenge** — identical deterministic puzzle set (5–7 puzzles, kept
  short on purpose) for all players each day, one official attempt, global
  daily leaderboard.
- **Weekly Tournament** — one entry per player per week, entry costs 25 💎
  (diamonds only — never cash). Same seeded puzzle set for everyone that
  week. Top 3 share the prize pool (50/30/15 💎 plus a 100 💎 house base);
  payouts settle server-side the next time standings are viewed.

## Case Files theme

The game ships with the "Case Files" detective theme: matches are cases,
puzzles are clues, and each match opens with a case briefing and closes with
a verdict (Case Solved / Reopened / Unsolved). All flavor strings live in
`src/public/js/theme.js` as one pluggable config object — a future theme
(space mission, treasure hunt) swaps in by replacing that object.

## Diamonds (virtual currency — never cashable)

Diamonds exist only inside the game and have no cash value. Every balance
change is computed and validated server-side; the client never sends a
balance.

- **Earn:** +2 per correct answer, +10 perfect-match bonus, +5 daily login
  bonus (once per calendar day, auto-claimed), +5 per watched rewarded ad
  (max 5/day), +20 referral bonus when an invited friend finishes their first
  match.
- **Spend:** 5 💎 hint (eliminates one wrong option, max 1 per puzzle; disabled
  on boss cases), 15 💎 skip (one per match, scored as incorrect),
  10 💎 Freeze Time (pauses the visible countdown for 10s), 25 💎 tournament entry.
- **Ledger:** every mutation is written to an `economy_log` table for audit
  and daily-quota enforcement.

## Ads (provider abstraction; currently mocked)

`src/public/js/ads.js` exposes `showInterstitialAd()` and `showRewardedAd()`
and dispatches to a **pluggable provider**: `js/ads/mock.js` (placeholder
overlays, the default) or `js/ads/google-h5.js` (Google H5 Games Ads /
Ad Placement API adapter, wired but inert until AdSense env config exists).
The server picks the provider via `GET /api/config` (`ADS_PROVIDER`,
`ADS_CLIENT` env); `?ads=mock|google-h5|off` overrides per session. The
rewarded flow calls `POST /api/ad-reward`, which grants +5 💎 rate-limited to
5 per player per day and **fails closed** for real providers until the
server-side verification hook (`TODO(ad-ssv)` in `verifyReward()`) is
implemented. See **docs/ads-integration.md** for the full go-live plan.

## Referrals / affiliate

Every registered player gets a shareable invite link
(`https://<domain>/?ref=<code>`, copy button on Home). The referrer earns
+20 💎 **only after** the invited player finishes their first match — not at
signup — to discourage fake-account farming. An `<!-- AFFILIATE_SLOT -->`
placeholder is reserved in the home markup for a future approved affiliate
partner; none is integrated.

## Game feel (stakes, feedback, progression)

- **Lives** — competitive matches (quick/daily/tournament) start with 3
  hearts, tracked and decremented **server-side**. The third wrong answer
  ends the match immediately as `failed` (distinct from `completed`):
  no further puzzles, no score payout, results remain viewable as a
  post-mortem. Training and campaign are lives-exempt by design.
- **Combo** — a per-match live streak feeds a small server-computed bonus
  (≈+10% by a 3-streak, ≈+20% by 5, capped at +50%); one wrong answer or a
  skip resets it. The client only displays the streak the server reports.
- **Countdown + Freeze Time** — each puzzle shows a display-only countdown
  from its par time (tighter, 60%, on boss cases); real `msTaken` still
  accrues server-side. Freeze Time (10 💎, server-validated like any spend)
  pauses the visible countdown for 10 seconds.
- **Campaign** — 50 numbered cases unlocking strictly in order
  (`GET /api/campaign`, `POST /api/campaign/start`). Only *finishing* a case
  advances the pointer; failed attempts burn an attempt but never unlock the
  next case (completed cases stay replayable). Difficulty ramps by case
  (rookie → master), and every 10th case is a **boss case**: hints forbidden
  (server-enforced `hints_forbidden_boss`), tighter countdowns, distinct
  visual treatment.
- **Juice** — correct/incorrect flashes with pop/shake animations, Web-Audio
  sound cues, a floating combo popup, results score count-up, and a pure-CSS
  confetti burst on solved verdicts — all disabled-under-motion via
  `prefers-reduced-motion` (colors stay, movement drops).
- **Share card** — the results screen renders a canvas score card in the
  active skin's palette and shares it via the Web Share API (image where
  supported, text fallback, copy-to-clipboard last resort) — fully
  client-side, no server endpoint.
- **Audio & haptics** — a real background track, "Thinking Music" by
  Kevin MacLeod (incompetech.com), licensed CC BY 4.0, stored at
  `src/public/audio/intense-theme.mp3` and looped via `<audio>`; Web-Audio
  sound cues and Vibration-API taps each with their own persisted toggle
  (music / SFX / vibration) in Profile → Settings.
- **Intro animation** — "Magnifying Glass" by faisal qureshi, a free Lottie
  animation (Lottie Simple License) stored at
  `src/public/animations/intro.json`, played by the vendored lottie-web
  library (`src/public/vendor/lottie-light.min.js`, MIT). Hidden under
  `prefers-reduced-motion`; the skippable word sequence still plays.
- **Per-difficulty backgrounds** — the match screen's backdrop shifts tone
  and motion with puzzle difficulty (calm greens at rookie → intense reds at
  master), layered *under* the active world-skin flourish so both compose.

## Installable app (PWA)

`manifest.json` + a minimal service worker make the game installable via
"Add to Home Screen" with its own icon and full-screen standalone display.
The service worker caches only the static app shell; all API/match/score
requests stay network-only.

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

## Skins, themes, and color scheme

Two independent systems:

- **Color scheme (free, client-only):** dark (default) / light via the ☾/☀
  toggle in the sidebar or bottom nav. Persists in localStorage
  (`cra_color_scheme`); works for guests; no server call.
- **World skins (server-validated ownership):** the story layer — Case Files
  (detective, free), Deep Space Mission and Treasure Hunt (120 💎 each).
  `GET /api/skins` returns the catalog + the player's unlocked list;
  `POST /api/skins/unlock` deducts diamonds atomically and rejects unknown
  ids, free skins, double unlocks (409), and insufficient balances (402).
  The active skin is stored locally (`cra_active_skin`) and re-validated
  against server ownership at boot (stale ids fall back to detective).
  Purchasing a skin is diamonds only — no cash value, consistent with the
  rest of the economy.

**Pricing note (Phase E reference):** skins cost 120 💎. If/when real-money
diamond packs ship, the ladder should include ₹100 → 120 💎 ("one pack = one
skin unlock", badged as best value), alongside smaller packs (e.g. ₹20 → 20 💎,
₹50 → 55 💎). No purchase flow exists yet; this note keeps the future pricing
consistent with the skin economy.

## Known limitations (by design, at this phase)

- **Ads remain a mock by default.** The provider abstraction and a Google
  H5 adapter ship, but no network is connected (no account/approval); server-
  side reward verification (`TODO(ad-ssv)`) is still a stub. See
  docs/ads-integration.md.
- **Diamonds are not cashable** and there is no payment integration —
  deliberately. Tournament entry, skin unlocks, and all prizes are diamonds
  only (see the pricing note above for the planned pack ladder).
- Single-process answer keys (in-memory, TTL-bounded) — move to the DB for
  multi-instance deployments. Tournament prize settlement is lazy (computed
  on leaderboard read) rather than a background cron.
- Ranked rating uses a fixed opponent pool (1000); seasonal/ELO matchmaking
  is intentionally deferred until core stability is proven.
- Ad-reward rate limiting is per-player per-day via the economy ledger, not
  per-IP; a real ad SDK would bring its own fraud controls.
