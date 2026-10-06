'use strict';
// Anti-cheat basics for nickname leaderboards. Pure, in-memory, no DB — unit-testable.
// These stop the cheap attacks (self-play, win-trading between two names, spamming results,
// absurd scores, name tricks); they are NOT a substitute for server-authoritative game logic.

// Normalize a nickname: NFKC, strip control/format/private/unassigned chars (zero-width, bidi
// overrides, etc.) and angle brackets, collapse whitespace, cap at 24 chars. '' if nothing left.
function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function createGuard(opts = {}) {
  const o = {
    pairWindowMs: 60 * 60 * 1000, // window for the same two identities
    maxPerPair: 10,               // max credited results per unordered pair per window
    nameWindowMs: 60 * 1000,
    maxPerName: 8,                // max credited results per identity per nameWindow
    minDurationMs: 0,             // ignore matches shorter than this (only if durationMs is supplied)
    now: Date.now,
    ...opts,
  };
  const pairs = new Map(), names = new Map();
  const hit = (map, key, windowMs, max) => {
    const t = o.now(), arr = (map.get(key) || []).filter(x => t - x < windowMs);
    if (arr.length >= max) { map.set(key, arr); return false; }
    arr.push(t); map.set(key, arr);
    if (map.size > 5000) for (const [k, v] of map) if (!v.length || t - v[v.length - 1] > windowMs) map.delete(k);
    return true;
  };
  const idKey = (name, uid) => (uid ? 'u:' + uid : 'n:' + name.toLowerCase());
  return {
    cleanName,
    idKey,
    // Two-player result. Returns { ok:true } or { ok:false, reason }.
    checkMatch(a, b, { uidA = null, uidB = null, durationMs } = {}) {
      const ka = idKey(a, uidA), kb = idKey(b, uidB);
      if (ka === kb) return { ok: false, reason: 'self-play' };
      if (o.minDurationMs && typeof durationMs === 'number' && durationMs < o.minDurationMs) return { ok: false, reason: 'too-short' };
      if (!hit(pairs, [ka, kb].sort().join('|'), o.pairWindowMs, o.maxPerPair)) return { ok: false, reason: 'pair-limit' };
      for (const k of [ka, kb]) if (!hit(names, k, o.nameWindowMs, o.maxPerName)) return { ok: false, reason: 'rate-limit' };
      return { ok: true };
    },
    // Single-identity result (N-player games).
    checkResult(name, uid = null) {
      return hit(names, idKey(name, uid), o.nameWindowMs, o.maxPerName) ? { ok: true } : { ok: false, reason: 'rate-limit' };
    },
    // Score sanity: finite number, optionally integer, inside [min,max].
    checkScore(score, { min = 0, max = Infinity, integer = true } = {}) {
      if (typeof score !== 'number' || !Number.isFinite(score)) return { ok: false, reason: 'not-a-number' };
      if (integer && !Number.isInteger(score)) return { ok: false, reason: 'not-an-integer' };
      if (score < min || score > max) return { ok: false, reason: 'out-of-bounds' };
      return { ok: true };
    },
  };
}

// Tiny per-IP fixed-window limiter for Express routes (claim/submit endpoints).
function rateLimiter({ windowMs = 60000, max = 30, now = Date.now } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const k = req.ip || (req.socket && req.socket.remoteAddress) || 'x', t = now(), e = hits.get(k);
    if (!e || t - e.start >= windowMs) hits.set(k, { start: t, n: 1 });
    else if (++e.n > max) return res.status(429).json({ error: 'rate limited' });
    if (hits.size > 5000) for (const [kk, v] of hits) if (t - v.start >= windowMs) hits.delete(kk);
    next();
  };
}

module.exports = { cleanName, createGuard, rateLimiter };
