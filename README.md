# @hackatoan/leaderboard

Shared nickname leaderboard for the Hackatoa games (Postgres `leaderboards` table), with anti-cheat basics and a profanity filter.

```js
const lb = require('@hackatoan/leaderboard')({ gameId: 'battleship' }); // DATABASE_URL from env; fails soft without it

await lb.recordMatch(nameA, nameB, winnerNameOrNull, uidA, uidB, { durationMs });
await lb.recordResult(name, 'win' | 'loss' | 'draw', uid);   // N-player games
await lb.getLeaderboard(20);
await lb.claimNickname(nickname, uid, displayName);

// score-based games (opt-in)
await lb.ensureScoreTable();
await lb.recordScore(name, score, { min: 0, max: 1_000_000 });
await lb.getTopScores(20);
```

## Guards (`antiCheat` option, in-memory per process)
- **self-play** — same identity on both sides is dropped
- **pair farming** — one unordered pair can credit at most `maxPerPair` (10) results per hour
- **rate limit** — at most `maxPerName` (8) results per identity per minute
- **min duration** — `minDurationMs` drops matches shorter than that (when `durationMs` is passed)
- **score bounds** — non-finite / non-integer / out-of-range scores rejected
- **names** — NFKC, strips control/zero-width/bidi chars and `<>`, 24 char cap
- `rateLimiter({ windowMs, max })` — Express middleware for claim/submit routes

These stop the cheap attacks; they don't replace server-authoritative game logic.

## Profanity filter
Built on [`obscenity`](https://github.com/jo3-l/obscenity) (leetspeak, repeats, confusables) plus a spaced-out-letters check. A flagged nickname is stored/shown as a stable alias (`Player-3fa1`) so the player still keeps stats; existing rows are masked on read. Disable with `{ profanity: false }`.

## Install
```
npm i https://github.com/Hackatoan/game-leaderboard/archive/refs/tags/v1.0.0.tar.gz
```
(tarball URL, so Docker `node:alpine` builds don't need git). `pg` is a peer dependency.
