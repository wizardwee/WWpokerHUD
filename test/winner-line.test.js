// The winner line must beat the showdown pattern (v1.4.0).
//
// Torn writes "Bauderix won $28,500,000 Did not show hand" for a pot taken
// without a reveal. The `shows` pattern is deliberately wide — it accepts
// show/showed/shown/reveals/revealed/turns over, because a missed reveal costs
// a showdown from the Range tab silently — and that width made it match the
// bare word "show" inside "Did not show hand".
//
// `shows` sat BEFORE `wins`, so the line was consumed as a showdown:
//   - the `wins` handler never ran, so hand.winners stayed empty
//   - applyHandResults gates ALL of P/L on `hand.winners.length > 0`
//   - therefore every pot won WITHOUT a showdown recorded no P/L at all
//   - and nameToXidGuess was handed "Bauderix won $28,500,000 Did not" as a
//     username, producing a `name:` pseudo-record that logAction counted as a
//     player dealt into the hand
//
// It hid because it was intermittent in the worst way: a winner who DOES show
// produces "won $65,000,000 with [J J]", which contains no "show", parsed
// correctly, and recorded P/L normally. Fixtures below are verbatim from the
// live deep scan that found it.

const { load, runner } = require('./harness');

const t = runner('winner-line');
const T = load();

function matchOf(line) {
  const text = T.cleanLogLine(line);
  for (const p of T.LOG_PATTERNS) {
    const m = p.re.exec(text);
    if (m) return { type: p.type, name: T.cleanName(m[1] || ''), amount: m[2] };
  }
  return null;
}

// --- the exact lines from the scan ------------------------------------------

{
  const m = matchOf('Bauderix won $28,500,000 Did not show hand');
  t.eq('a no-showdown win is a WIN, not a showdown', m && m.type, 'wins');
  t.eq('...and the winner is named correctly', m && m.name, 'Bauderix');
  t.eq('...and the amount survives', m && m.amount, '28,500,000');
}
{
  const m = matchOf('Bahn won $44,468,060 Did not show hand');
  t.eq('second scan line also reads as a win', m && m.type, 'wins');
  t.eq('...with its amount', m && m.amount, '44,468,060');
}

// The case that always worked, which is why the bug was intermittent.
{
  const m = matchOf('wonkawee won $65,000,000 with [J J]');
  t.eq('a win WITH a shown hand is still a win', m && m.type, 'wins');
  t.eq('...named correctly', m && m.name, 'wonkawee');
  t.eq('...with its amount', m && m.amount, '65,000,000');
}

// --- a genuine reveal must still register as a showdown ---------------------
//
// The fix must not buy P/L back by breaking range tracking.

t.eq('a real reveal is still a showdown',
  (matchOf('_AY_ reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)') || {}).type, 'shows');
t.eq('"showed" is still a showdown', (matchOf('Bob showed [A♠, K♦]') || {}).type, 'shows');
t.eq('"turns over" is still a showdown', (matchOf('Bob turns over [A♠, K♦]') || {}).type, 'shows');

// --- the guard, independent of ordering -------------------------------------
//
// Ordering alone fixes the scan's lines. The negative lookahead is the second
// half, so "did not show" can never read as a reveal whichever order these end
// up in. Asserted directly against the shows pattern rather than through the
// list, which the ordering would otherwise mask.

{
  const shows = T.LOG_PATTERNS.filter((p) => p.type === 'shows');
  t.eq('there is exactly one shows pattern', shows.length, 1);
  t.eq('"did not show" does not match the shows pattern even in isolation',
    shows[0].re.test('Bauderix won $28,500,000 Did not show hand'), false);
  t.ok('a real reveal still matches it in isolation',
    shows[0].re.test('_AY_ reveals [9♥, 7♠]'));
}

// --- ordering is the load-bearing part, so assert it directly ---------------

{
  const iWins = T.LOG_PATTERNS.findIndex((p) => p.type === 'wins');
  const iShows = T.LOG_PATTERNS.findIndex((p) => p.type === 'shows');
  t.ok('both patterns are present', iWins >= 0 && iShows >= 0);
  t.ok('wins is tested BEFORE shows', iWins < iShows);
}

process.exit(t.report());
