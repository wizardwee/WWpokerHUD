// Name-to-seat resolution: the substring bug, and the v1.0.0 fix that broke
// more than it fixed.
//
// HISTORY, because it dictates how this file is written now.
//
// v1.0.0 replaced nameToXidGuess's fallback `.includes(name)` with a regex
// carrying a LOOKBEHIND: `(?<![A-Za-z0-9_-])name(?![A-Za-z0-9_-])`. That fixed a
// real collision ("Al" resolving to "AlexTheGreat"'s seat) and introduced two
// worse faults:
//
//   1. `(?<!...)` is a SyntaxError at CONSTRUCTION time on JavaScriptCore before
//      Safari 16.4 — Torn PDA's WKWebView on older iOS. It threw from the
//      log-parse hot path, which has no try/catch above it.
//   2. It ran against seat.textContent, which concatenates child elements with
//      NO separator ("Bob$41,200,000Sitting out"). A boundary check then
//      correctly rejects a name glued to a following letter — correct, and still
//      a failed resolution.
//
// Both faults returned the 'name:' pseudo-id, which never equals the numeric XID
// renderBadges reads off the seat — so PFR/3B chips silently stopped rendering
// and stats/P/L landed on pseudo-records.
//
// WHY THE OLD VERSION OF THIS FILE MISSED IT: it re-implemented the regex
// locally and tested that copy, because nameToXidGuess can't be driven
// end-to-end through this harness (it walks SELECTORS.seatContainer, an
// attribute-substring selector the class-DOM stub deliberately refuses). A test
// of a copy cannot fail when the original is wrong. This file now drives the
// REAL exported containsNameToken, so a change to it is a change to what's
// tested here.

const fs = require('fs');
const path = require('path');
const { load, runner } = require('./harness');

const t = runner('name-boundary');
const T = load();

// The seam itself. If this is ever renamed, every assertion below would
// otherwise pass vacuously against `undefined`.
t.ok('containsNameToken is exported from the test seam', typeof T.containsNameToken === 'function');

const has = (text, name) => T.containsNameToken(text, name);

// --- The original bug: a short name matching inside a longer one ------------

t.eq('"Al" does not match inside "AlexTheGreat"', has('AlexTheGreat$1,000,000', 'Al'), false);
t.eq('"Joe" does not match inside "Joey"', has('Joey$500,000', 'Joe'), false);
t.eq('a plain .includes() WOULD have matched (sanity check the fixture is real)',
  'AlexTheGreat$1,000,000'.includes('Al'), true);

// --- Hyphenated usernames — why plain \b isn't enough ------------------------
//
// USERNAME_RE allows hyphens, but regex \b treats '-' as a non-word character,
// so \bAl\b still false-matches inside "Al-Qaeda". The character-class check
// is what catches this.

t.eq('"Al" does not match inside the hyphenated username "Al-Qaeda"',
  has('Al-Qaeda$2,000,000', 'Al'), false);
t.ok('confirms plain \\b WOULD have matched here (the case \\b misses)',
  /\bAl\b/.test('Al-Qaeda$2,000,000'));

// --- The match still has to work for the real player -------------------------

t.eq('"Al" matches a seat that actually is Al', has('Al$1,000,000', 'Al'), true);
t.eq('"Al-Qaeda" matches its own seat', has('Al-Qaeda$2,000,000', 'Al-Qaeda'), true);
t.eq('a name at the very start of the text matches', has('Bob folded', 'Bob'), true);
t.eq('a name at the very end of the text matches', has('Seat 3: Bob', 'Bob'), true);
t.eq('a name against the whole text and nothing else matches', has('Bob', 'Bob'), true);

// --- Real seat.textContent shapes (fault 2) ---------------------------------
//
// These are the strings the OLD fixtures never had: a seat blob with no
// separators. Everything the old file tested was helpfully delimited by '$', a
// space, or end-of-string, so it never exercised the shape that actually broke.

t.eq('name followed by the stack still matches (separator is "$")',
  has('Bob$41,200,000', 'Bob'), true);
t.eq('name, stack, then state text still matches',
  has('Bob$41,200,000Sitting out', 'Bob'), true);

// The honest limitation, asserted rather than hidden: with the name glued
// directly to a following letter there is NO boundary, so this correctly returns
// false and the fuzzy pass cannot resolve that seat. That is exactly why
// nameToXidGuess now tries seatDisplayName (the seat's own name element) BEFORE
// falling back to this. If this assertion ever flips to true, the boundary check
// has been loosened and the "Al"/"AlexTheGreat" collision is back.
t.eq('name glued to a following letter does NOT match — seatDisplayName covers it',
  has('BobSitting out', 'Bob'), false);
t.eq('name glued to following digits does not match', has('Bob123', 'Bob'), false);

// --- Degenerate input --------------------------------------------------------

t.eq('empty text is not a match', has('', 'Bob'), false);
t.eq('empty name is not a match', has('Bob$1,000,000', ''), false);
t.eq('a repeated name matches on the second, valid occurrence',
  has('Bobby and Bob', 'Bob'), true);

// --- Hero's own log lines: the one case seat-text matching can never solve --
//
// A live deep scan (v1.5.1) found heroXid resolving correctly off the seat's
// self___ marker while a `name:<username>` ghost record kept accumulating in
// parallel, almost one-for-one with hero's real hand count — heroRecord's
// vpip/pfr read far LOWER than the ghost's, the "my own VPIP looks low"
// report CLAUDE.md had open. Root cause: nothing says Torn's own seat prints
// YOUR username where these passes look for it the way it prints an
// opponent's, so a name match against your own seat can fail every hand while
// an opponent's match never does. This harness can't drive the seat-matching
// passes at all (SELECTORS.seatContainer never matches on the stub — see file
// header), which makes it the right tool for THIS assertion: with no seat able
// to match anything, the only way nameToXidGuess can return heroXid rather
// than the pseudo-id is the direct name-vs-configured-username check.
{
  const T = load();
  T.STORE.settings.heroName = 'Wonkawee';

  T.heroXid = '311421';
  t.eq('hero\'s own name resolves straight to heroXid once heroXid is known',
    T.nameToXidGuess('Wonkawee'), '311421');
  t.eq('the match is case-insensitive (Torn login is)',
    T.nameToXidGuess('wonkawee'), '311421');
  t.eq('a different name is unaffected', T.nameToXidGuess('SomeoneElse'), 'name:SomeoneElse');

  T.heroXid = null;
  t.eq('unresolved heroXid falls through to the pseudo-id, same as before this fix',
    T.nameToXidGuess('Wonkawee'), 'name:Wonkawee');

  T.heroXid = 'name:Wonkawee';
  t.eq('a pseudo heroXid does not short-circuit itself',
    T.nameToXidGuess('Wonkawee'), 'name:Wonkawee');
}

// --- Engine compatibility: no lookbehind anywhere in the script -------------
//
// The scan is the point. A lookbehind reads as ordinary modern JS and passes
// every test on Node and on Chrome-based Android WebView, then throws on iOS
// JSC below 16.4 — a device nobody working on this repo can run. A source-level
// assertion is the only thing that catches its reintroduction.

const source = fs.readFileSync(path.join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.eq('the userscript contains no regex lookbehind (breaks iOS JSC < 16.4)',
  /\(\?<[=!]/.test(source), false);

process.exit(t.report());
