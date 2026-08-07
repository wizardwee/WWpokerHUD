// The substring-name bug, and where it was actually still live (v1.0.0).
//
// nameToXidGuess()'s own comment already warned "a substring test alone would
// resolve 'Joe' to a 'Joey' seat" — but that warning described the EXACT-match
// pass, which isn't the vulnerable one. The fallback pass (seat.textContent
// .includes(name)) was the real exposure, and it's the pass that actually runs
// most of the time: a live deep scan found SELECTORS.seatNameLink present on
// only 1 of 6 seats, so most name resolutions fall through to it. A false match
// there doesn't just mislabel a badge — it attributes one player's real actions
// (and stats, and P/L) to a DIFFERENT player's record, silently, for both of
// them.
//
// nameToXidGuess() can't be driven end-to-end through this harness: it walks
// document.querySelectorAll(SELECTORS.seatContainer), and SELECTORS.seatContainer
// is an attribute-substring selector ([class*="..."]), which the harness's
// class-DOM stub deliberately does not support (single ".foo" selectors only —
// see harness.js's own comment on why guessing at a richer stub is worse than
// admitting it can't). So this tests the boundary check in isolation, built the
// same way nameToXidGuess() builds it, against the exact strings that broke it.

const { load, runner } = require('./harness');

const t = runner('name-boundary');
const T = load();

// Mirrors the regex nameToXidGuess() constructs for its fallback pass.
function boundaryMatch(name, seatText) {
  const re = new RegExp('(?<![A-Za-z0-9_-])' + T.escapeRegexLiteral(name) + '(?![A-Za-z0-9_-])');
  return re.test(seatText);
}

// --- The bug: a short name matching inside a longer one ---------------------

t.eq('"Al" no longer matches inside "AlexTheGreat"', boundaryMatch('Al', 'AlexTheGreat$1,000,000'), false);
t.eq('"Joe" no longer matches inside "Joey"', boundaryMatch('Joe', 'Joey$500,000'), false);
t.eq('a plain .includes() WOULD have matched (sanity check the fixture is real)',
  'AlexTheGreat$1,000,000'.includes('Al'), true);

// --- Hyphenated usernames — why plain \b isn't enough ------------------------
//
// USERNAME_RE allows hyphens in a real username, but regex \b treats '-' as a
// non-word character — so \bAl\b still false-matches inside "Al-Qaeda" (the
// boundary sits right at the hyphen). The fix checks against the actual
// username character class instead of \w.

t.eq('"Al" does not match inside the hyphenated username "Al-Qaeda"',
  boundaryMatch('Al', 'Al-Qaeda$2,000,000'), false);
t.ok('confirms plain \\b WOULD have matched here (the case \\b misses)',
  /\bAl\b/.test('Al-Qaeda$2,000,000'));

// --- The match still has to work for the real player -------------------------

t.eq('"Al" matches a seat that actually is Al', boundaryMatch('Al', 'Al$1,000,000'), true);
t.eq('"Al-Qaeda" matches its own seat', boundaryMatch('Al-Qaeda', 'Al-Qaeda$2,000,000'), true);
t.eq('a name at the very start of the text still matches', boundaryMatch('Bob', 'Bob folded'), true);
t.eq('a name at the very end of the text still matches', boundaryMatch('Bob', 'Seat 3: Bob'), true);

// --- escapeRegexLiteral itself -----------------------------------------------
//
// USERNAME_RE forbids regex metacharacters, so a real username never needs
// this — but nameToXidGuess is also reachable with STORE.settings.heroName,
// which is free-typed in Settings and not validated at all. This is what keeps
// a stray character there from throwing (or silently building the wrong
// pattern) instead of just failing to match.

t.eq('ordinary text passes through unchanged', T.escapeRegexLiteral('Bob'), 'Bob');
t.eq('regex metacharacters are escaped', T.escapeRegexLiteral('a.b*c'), 'a\\.b\\*c');
{
  let threw = false;
  try { new RegExp(T.escapeRegexLiteral('(a+b)[c]')); } catch (e) { threw = true; }
  t.ok('a string full of metacharacters still builds a valid RegExp', !threw);
}

process.exit(t.report());
