'use strict';
// @hackatoan/leaderboard — shared nickname leaderboard for the Hackatoa games.
// Results are keyed on (game, player) in the shared `leaderboards` table. Fails soft: with no
// DATABASE_URL / unreachable DB the game still runs and writes no-op / reads return [].
const { cleanName, createGuard, rateLimiter } = require('./guards');
const { isProfane, safeName } = require('./profanity');

function createLeaderboard(opts = {}) {
  const GAME = opts.gameId || process.env.GAME_ID;
  if (!GAME) throw new Error('createLeaderboard: gameId (or GAME_ID env) is required');
  let pool = opts.pool || null;
  if (!pool) {
    const cs = opts.connectionString !== undefined ? opts.connectionString : process.env.DATABASE_URL;
    if (cs) {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: cs, max: opts.max || 4 });
      pool.on('error', (err) => console.error('[leaderboard] pool error:', err.message));
    } else console.warn('[leaderboard] DATABASE_URL not set — leaderboard disabled');
  }
  const guard = createGuard(opts.antiCheat);
  const filterOn = opts.profanity !== false;
  const mask = (n) => (filterOn ? safeName(n) : n); // flagged -> stable 'Player-xxxx' alias
  const log = opts.log || ((...a) => console.warn('[leaderboard]', ...a));

  // Single-identity result. `uid` (Firebase) becomes the row key so signed-in rows can't collide
  // with an anonymous player's identical nickname; display_name carries what is shown.
  async function recordResult(player, outcome, uid = null, { skipGuard = false } = {}) {
    if (!pool) return { recorded: false, reason: 'db-unavailable' };
    const name = cleanName(player);
    if (!name) return { recorded: false, reason: 'missing-name' };
    if (!skipGuard) { const v = guard.checkResult(name, uid); if (!v.ok) { log('dropped result for', name, v.reason); return { recorded: false, reason: v.reason }; } }
    const wins = outcome === 'win' ? 1 : 0, losses = outcome === 'loss' ? 1 : 0, draws = outcome === 'draw' ? 1 : 0;
    try {
      await pool.query(
        `INSERT INTO leaderboards (game, player, display_name, wins, losses, draws, games_played, updated_at, firebase_uid)
         VALUES ($1, $2, $3, $4, $5, $6, 1, now(), $7)
         ON CONFLICT (game, player) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           wins         = leaderboards.wins   + EXCLUDED.wins,
           losses       = leaderboards.losses + EXCLUDED.losses,
           draws        = leaderboards.draws  + EXCLUDED.draws,
           games_played = leaderboards.games_played + 1,
           updated_at   = now()`,
        [GAME, uid || mask(name), uid ? mask(name) : null, wins, losses, draws, uid]);
      return { recorded: true };
    } catch (err) { console.error('[leaderboard] recordResult failed:', err.message); return { recorded: false, reason: 'db-error' }; }
  }

  // Two-player match. winnerName === null means a draw. meta.durationMs enables the min-duration guard.
  async function recordMatch(nameA, nameB, winnerName, uidA = null, uidB = null, meta = {}) {
    const a = cleanName(nameA), b = cleanName(nameB);
    if (!a || !b) return { recorded: false, reason: 'missing-name' };
    const v = guard.checkMatch(a, b, { uidA, uidB, durationMs: meta.durationMs });
    if (!v.ok) { log(`dropped match ${a} vs ${b}:`, v.reason); return { recorded: false, reason: v.reason }; }
    if (winnerName === null) {
      await Promise.all([recordResult(a, 'draw', uidA, { skipGuard: true }), recordResult(b, 'draw', uidB, { skipGuard: true })]);
    } else {
      const w = cleanName(winnerName), aWon = w === a;
      const [wUid, lUid] = aWon ? [uidA, uidB] : [uidB, uidA];
      await Promise.all([recordResult(w, 'win', wUid, { skipGuard: true }), recordResult(aWon ? b : a, 'loss', lUid, { skipGuard: true })]);
    }
    return { recorded: true };
  }

  // Merge an anonymous nickname row into a signed-in account's row ("was this your nickname?" flow).
  async function claimNickname(nickname, uid, displayName) {
    if (!pool) return { ok: false, reason: 'db unavailable' };
    const name = cleanName(nickname);
    if (!name || !uid) return { ok: false, reason: 'invalid input' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT wins, losses, draws, games_played FROM leaderboards WHERE game = $1 AND player = $2 AND firebase_uid IS NULL FOR UPDATE`, [GAME, name]);
      if (!rows.length) { await client.query('ROLLBACK'); return { ok: false, reason: 'no unclaimed row for that nickname' }; }
      const old = rows[0];
      await client.query(
        `INSERT INTO leaderboards (game, player, display_name, wins, losses, draws, games_played, updated_at, firebase_uid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
         ON CONFLICT (game, player) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           wins         = leaderboards.wins   + EXCLUDED.wins,
           losses       = leaderboards.losses + EXCLUDED.losses,
           draws        = leaderboards.draws  + EXCLUDED.draws,
           games_played = leaderboards.games_played + EXCLUDED.games_played,
           updated_at   = now()`,
        [GAME, uid, mask(cleanName(displayName) || name), old.wins, old.losses, old.draws, old.games_played, uid]);
      await client.query('DELETE FROM leaderboards WHERE game = $1 AND player = $2 AND firebase_uid IS NULL', [GAME, name]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) { await client.query('ROLLBACK'); console.error('[leaderboard] claimNickname failed:', err.message); return { ok: false, reason: 'internal error' }; }
    finally { client.release(); }
  }

  async function getLeaderboard(limit = 20) {
    if (!pool) return [];
    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(display_name, player) AS player, wins, losses, draws, games_played
           FROM leaderboards WHERE game = $1 ORDER BY wins DESC, games_played ASC, updated_at ASC LIMIT $2`,
        [GAME, Math.min(Math.max(+limit || 20, 1), 100)]);
      return rows.map((r) => ({ ...r, player: mask(r.player) })); // also hides pre-filter rows
    } catch (err) { console.error('[leaderboard] getLeaderboard failed:', err.message); return []; }
  }

  // ---- score-based games (opt-in; call ensureScoreTable() once at startup) ----
  async function ensureScoreTable() {
    if (!pool) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS leaderboard_scores (
      game text NOT NULL, player text NOT NULL, best_score bigint NOT NULL, plays integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (game, player))`);
  }
  // bounds: { min, max, integer } — scores outside are rejected (a client claiming 9e15 is a cheater).
  async function recordScore(player, score, bounds = opts.scoreBounds || {}) {
    if (!pool) return { recorded: false, reason: 'db-unavailable' };
    const name = cleanName(player);
    if (!name) return { recorded: false, reason: 'missing-name' };
    const s = guard.checkScore(score, bounds); if (!s.ok) { log(`rejected score from ${name}:`, s.reason); return { recorded: false, reason: s.reason }; }
    const r = guard.checkResult(name); if (!r.ok) return { recorded: false, reason: r.reason };
    try {
      await pool.query(
        `INSERT INTO leaderboard_scores (game, player, best_score) VALUES ($1, $2, $3)
         ON CONFLICT (game, player) DO UPDATE SET best_score = GREATEST(leaderboard_scores.best_score, EXCLUDED.best_score),
           plays = leaderboard_scores.plays + 1, updated_at = now()`, [GAME, mask(name), score]);
      return { recorded: true };
    } catch (err) { console.error('[leaderboard] recordScore failed:', err.message); return { recorded: false, reason: 'db-error' }; }
  }
  async function getTopScores(limit = 20) {
    if (!pool) return [];
    try { return (await pool.query(`SELECT player, best_score, plays FROM leaderboard_scores WHERE game = $1 ORDER BY best_score DESC, updated_at ASC LIMIT $2`, [GAME, Math.min(Math.max(+limit || 20, 1), 100)])).rows.map((r) => ({ ...r, player: mask(r.player) })); }
    catch (err) { console.error('[leaderboard] getTopScores failed:', err.message); return []; }
  }

  return { GAME, cleanName, isProfane, safeName: mask, recordResult, recordMatch, claimNickname, getLeaderboard, ensureScoreTable, recordScore, getTopScores, guard };
}

module.exports = createLeaderboard;
module.exports.createLeaderboard = createLeaderboard;
module.exports.cleanName = cleanName;
module.exports.createGuard = createGuard;
module.exports.rateLimiter = rateLimiter;
module.exports.isProfane = isProfane;
module.exports.safeName = safeName;
