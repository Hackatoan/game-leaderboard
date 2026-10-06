'use strict';
// Profanity filter for nicknames, built on `obscenity` (handles leetspeak, repeated/separated
// letters, confusable unicode). Fails OPEN with a warning if the library is missing so a packaging
// problem can never take a game's leaderboard down.
const crypto = require('crypto');
let matcher = null;
try {
  const { RegExpMatcher, englishDataset, englishRecommendedTransformers } = require('obscenity');
  matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
} catch (e) { console.warn('[leaderboard] profanity filter unavailable:', e.message); }

// obscenity matches words, not letters spread out with separators ("f u c k", "f.u.c.k"). Only when the
// whole name is single characters split by separators do we also test the joined form, so ordinary
// multi-word names ("Pen Is" etc.) aren't glued together and false-flagged.
function spacedOut(s) { const t = s.split(/[\s._\-*]+/).filter(Boolean); return t.length >= 3 && t.every((x) => [...x].length === 1) ? t.join('') : null; }
const isProfane = (s) => {
  if (!matcher || typeof s !== 'string' || !s.length) return false;
  if (matcher.hasMatch(s)) return true;
  const j = spacedOut(s); return !!j && matcher.hasMatch(j);
};
// Stable alias so a flagged player still accumulates under one (clean) name.
const aliasFor = (s) => 'Player-' + crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 4);
const safeName = (s) => (isProfane(s) ? aliasFor(s) : s);

module.exports = { isProfane, aliasFor, safeName };
