'use strict';
const test = require('node:test'), assert = require('node:assert');
const createLeaderboard = require('..');
const { createGuard, cleanName } = require('../guards');
const { isProfane, aliasFor } = require('../profanity');

const fakePool = () => { const q = []; return { q, query: async (sql, p) => { q.push({ sql, p }); return { rows: [] }; }, connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }; };

test('cleanName strips control/zero-width/bidi chars and brackets, caps at 24', () => {
  assert.strictEqual(cleanName('  Bo​b<script>  ‮x '), 'Bobscript x');
  assert.strictEqual(cleanName('a'.repeat(40)).length, 24);
  assert.strictEqual(cleanName(42), '');
});
test('guard: self-play, pair farming, per-name rate limit', () => {
  let t = 0; const g = createGuard({ now: () => t, maxPerPair: 3, maxPerName: 100 });
  assert.strictEqual(g.checkMatch('A', 'a').reason, 'self-play');
  for (let i = 0; i < 3; i++) assert.ok(g.checkMatch('A', 'B').ok);
  assert.strictEqual(g.checkMatch('B', 'A').reason, 'pair-limit'); // unordered pair
  t += 61 * 60 * 1000; assert.ok(g.checkMatch('A', 'B').ok); // window rolled over
  const r = createGuard({ now: () => t, maxPerName: 2 }); r.checkResult('x'); r.checkResult('x');
  assert.strictEqual(r.checkResult('x').reason, 'rate-limit');
});
test('guard: min duration and score bounds', () => {
  const g = createGuard({ minDurationMs: 5000 });
  assert.strictEqual(g.checkMatch('A', 'B', { durationMs: 1000 }).reason, 'too-short');
  assert.ok(g.checkMatch('A', 'B', { durationMs: 9000 }).ok);
  assert.strictEqual(g.checkScore(1e15, { max: 1e6 }).reason, 'out-of-bounds');
  assert.strictEqual(g.checkScore(-1, {}).reason, 'out-of-bounds');
  assert.strictEqual(g.checkScore(NaN).reason, 'not-a-number');
  assert.strictEqual(g.checkScore(1.5).reason, 'not-an-integer');
});
test('profanity: detects evasions, leaves normal names alone, alias is stable', () => {
  assert.ok(isProfane('fuck'));
  assert.ok(isProfane('f u c k'));
  assert.ok(isProfane('f.u.c.k'));
  assert.ok(!isProfane('A B C'));
  assert.ok(isProfane('fvck'.replace('v', 'u')));
  assert.ok(!isProfane('Classic'));
  assert.ok(!isProfane('Scunthorpe') && !isProfane('Assassin'));
  assert.strictEqual(aliasFor('X'), aliasFor('x'));
  assert.match(aliasFor('x'), /^Player-[0-9a-f]{4}$/);
});
test('recordMatch masks profane names before writing, drops self-play', async () => {
  const pool = fakePool(), lb = createLeaderboard({ gameId: 'g', pool, log() {} });
  assert.strictEqual((await lb.recordMatch('Sam', 'sam', 'Sam')).reason, 'self-play');
  assert.strictEqual(pool.q.length, 0);
  assert.deepStrictEqual(await lb.recordMatch('fuck', 'Bob', 'Bob'), { recorded: true });
  const written = pool.q.map((x) => x.p[1]);
  assert.ok(written.includes('Bob') && !written.includes('fuck') && written.some((n) => /^Player-/.test(n)));
});
test('profanity can be disabled; getLeaderboard masks pre-existing rows', async () => {
  const pool = { query: async () => ({ rows: [{ player: 'shit', wins: 3, losses: 0, draws: 0, games_played: 3 }, { player: 'Ann', wins: 1, losses: 0, draws: 0, games_played: 1 }] }) };
  const rows = await createLeaderboard({ gameId: 'g', pool }).getLeaderboard();
  assert.match(rows[0].player, /^Player-/); assert.strictEqual(rows[1].player, 'Ann');
  assert.strictEqual((await createLeaderboard({ gameId: 'g', pool, profanity: false }).getLeaderboard())[0].player, 'shit');
});
test('recordScore rejects out-of-bounds', async () => {
  const lb = createLeaderboard({ gameId: 'g', pool: fakePool(), log() {} });
  assert.strictEqual((await lb.recordScore('Ann', 9e15, { max: 1000 })).reason, 'out-of-bounds');
  assert.deepStrictEqual(await lb.recordScore('Ann', 500, { max: 1000 }), { recorded: true });
});
