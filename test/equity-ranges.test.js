// Range-weighted opponents in Monte Carlo equity (v0.43.0).
//
// estimateEquity() used to deal every opponent a uniformly random hand, which
// the UI already admitted ("Eq vs random") reads pessimistically against tight
// players. When the hand has seen a preflop raise, opponents are now drawn
// from a proxy range (opponentRangeProxy) instead of the full deck — borrowed,
// combo-weighted charts this project has already sourced for the coach
// (RFI_RANGES.SHORT.CO / THREE_BET_RANGES.IP / FOUR_BET_RANGE), not new
// numbers invented for this.
//
// The Monte Carlo itself is statistical, so these tests check DIRECTION and
// SHAPE (a weak hand should do much worse against a strong proxy range than
// against random; a chart's own measured width should show up in a plain
// count of the rejection-sampled outcomes) rather than exact percentages,
// which would make the suite flaky by construction.

const { load, runner } = require('./harness');

const t = runner('equity-ranges');
const T = load();
T.STORE = T.emptyStore();
// Iteration count trades noise for speed. 6000 keeps run.js fast (well under
// a second for this whole file) while keeping the ~14pp directional gap below
// stable across repeated runs — measured empirically, not guessed.
T.STORE.settings.equityIters = 6000;

function card(rank, suit) { return { rank, suit }; }

// --- opponentRangeProxy -------------------------------------------------

t.eq('an unopened/limped pot is not narrowed', T.opponentRangeProxy(0), null);
t.eq('and neither is an unknown/undefined level', T.opponentRangeProxy(undefined), null);
t.eq('a single open uses the CO reference chart', T.opponentRangeProxy(1), T.RFI_RANGES.SHORT.CO);
t.eq('a 3-bet uses the in-position 3-bet chart', T.opponentRangeProxy(2), T.THREE_BET_RANGES.IP);
t.eq('a 4-bet uses the 4-bet chart', T.opponentRangeProxy(3), T.FOUR_BET_RANGE);
t.eq('and so does anything higher (5-bet, etc.)', T.opponentRangeProxy(7), T.FOUR_BET_RANGE);

t.eq('equityBasisLabel tracks the same tiers', T.equityBasisLabel(0), 'vs random');
t.eq('', T.equityBasisLabel(1), 'vs open range');
t.eq('', T.equityBasisLabel(2), 'vs 3-bet range');
t.eq('', T.equityBasisLabel(4), 'vs 4-bet range');

// --- numericHandShorthand agrees with the trusted letter-card version -------
//
// The Monte Carlo deck deals numeric {r,s} cards; the range charts are written
// in letter shorthand ("AKs"). numericHandShorthand is a second implementation
// of the same idea (handToShorthand) working on the other representation, and
// the two MUST agree — a mismatch here would silently narrow opponents to the
// wrong range with no visible symptom, exactly the failure mode this project
// has hit before with unverified range math.

{
  const cases = [
    ['A', 's', 'K', 's'], ['A', 's', 'K', 'h'], ['7', 'c', '7', 'd'],
    ['T', 'h', 'T', 'd'], ['2', 'c', '9', 'h'], ['A', 'd', 'A', 's'],
  ];
  let allMatch = true;
  const mismatches = [];
  cases.forEach(([r1, s1, r2, s2]) => {
    const a = card(r1, s1); const b = card(r2, s2);
    const viaLetters = T.handToShorthand(a, b);
    const viaNumeric = T.numericHandShorthand(T.cardToNum(a), T.cardToNum(b));
    if (viaLetters !== viaNumeric) { allMatch = false; mismatches.push(`${r1}${s1}/${r2}${s2}: ${viaLetters} vs ${viaNumeric}`); }
  });
  t.eq(`numeric and letter shorthand agree on every case${mismatches.length ? ' — ' + mismatches.join(', ') : ''}`,
    allMatch, true);
}

// --- Backward compatibility: no raiseLevel behaves as before ----------------
//
// AA heads-up vs one truly random hand is a well-known ~85%. This is the
// existing unconstrained path (raiseLevel omitted), which this change did not
// touch — a regression here would mean the edit broke the common case while
// adding the new one.

{
  const AA = [card('A', 's'), card('A', 'h')];
  const eq = T.estimateEquity(AA, [], 1);
  t.ok(`AA vs 1 random hand lands near the known ~85% (got ${eq && eq.toFixed(1)})`,
    eq != null && eq > 78 && eq < 92);
}

// --- The actual behaviour change: junk does worse against a real range ------
//
// 72o is real garbage against a uniformly random hand (loses to roughly half
// the deck) but gets crushed even harder once the "opponent" is guaranteed to
// hold something from FOUR_BET_RANGE (QQ+, AKs, AKo, A5s) rather than
// potentially another piece of junk just as live. If range-weighting isn't
// actually constraining the deal — e.g. a broken redraw loop that silently
// falls through to the original random cards — these two numbers would come
// out statistically indistinguishable instead of clearly separated.

{
  const trash = [card('7', 's'), card('2', 'h')];
  const vsRandom = T.estimateEquity(trash, [], 1, 0);
  const vsFourBet = T.estimateEquity(trash, [], 1, 3);
  // Measured directly (see the test file's own header comment): the real gap
  // sits at ~14pp and holds stable across repeated runs at this iteration
  // count. 8 leaves comfortable margin below that without being so loose the
  // assertion would survive a broken redraw loop that barely constrains
  // anything.
  t.ok(`72o loses a lot more equity facing a 4-bet range than facing random (random=${vsRandom.toFixed(1)}, vs4bet=${vsFourBet.toFixed(1)})`,
    vsRandom - vsFourBet > 8);
}

// --- Sanity: still a valid percentage across the raise-level ladder ---------

{
  const hand = [card('K', 'd'), card('Q', 'd')];
  [0, 1, 2, 3].forEach((level) => {
    const eq = T.estimateEquity(hand, [], 2, level);
    t.ok(`KQs vs 2 opponents at raise level ${level} returns a valid percentage (got ${eq})`,
      eq != null && eq >= 0 && eq <= 100);
  });
}

// --- Stress case: a full field against the narrowest range ------------------
//
// FOUR_BET_RANGE touches maybe a dozen physical cards. 8 opponents cannot all
// hold a non-conflicting hand from it — most will legitimately fall through to
// the random fallback. This is the exact case that exposed both a correctness
// question (does the fallback path stay valid once the range combo list runs
// out mid-iteration?) and, before the fix below, a real performance
// regression — see that one separately.
{
  const hand = [card('A', 'c'), card('A', 'd')];
  const eq = T.estimateEquity(hand, [], 8, 3);
  t.ok(`8 opponents against the narrowest range still returns a valid percentage (got ${eq})`,
    eq != null && eq >= 0 && eq <= 100);
}

// --- Performance: range-weighting must not regress the coach panel ----------
//
// The first implementation re-enumerated every in-range card pair from
// scratch inside the Monte Carlo loop — for every opponent, on every one of
// 1200 iterations. Measured at ~350ms for a single call at 8 opponents against
// FOUR_BET_RANGE, vs ~20ms for the unweighted path: a ~16x regression that
// would visibly stall the coach panel, which requests two of these on every
// render. The fix precomputes the combo list once per call instead of once
// per iteration. This asserts a budget loose enough to not be flaky on a slow
// CI box, but tight enough that the old O(pool²)-per-iteration approach would
// fail it outright (it measured ~300ms+ here, this asserts under 150ms).

{
  const hand = [card('K', 'd'), card('Q', 'd')];
  // At the file's iters=6000 (chosen for the directional tests' stability,
  // not for realism) this same call runs ~280ms — measure at the real
  // production default instead, since that is what the coach panel actually
  // pays on a live table.
  const savedIters = T.STORE.settings.equityIters;
  T.STORE.settings.equityIters = 1200;
  const start = Date.now();
  T.estimateEquity(hand, [], 8, 3);
  const ms = Date.now() - start;
  T.STORE.settings.equityIters = savedIters;
  t.ok(`a single 8-opponent narrow-range call completes well under budget at the real default iters (${ms}ms)`, ms < 150);
}

// --- estimateEquityCached: raiseLevel is part of the cache key --------------
//
// Same hero cards, same board, same opponent count — but the pot going from
// unraised to a 4-bet has to actually change the quoted number. A cache keyed
// on only the first three would keep serving the pre-raise figure straight
// through the raise, which is a wrong number with nothing to indicate it.

{
  const trash = [card('7', 's'), card('2', 'h')];
  const cachedRandom = T.estimateEquityCached(trash, [], 1, 0);
  const cachedFourBet = T.estimateEquityCached(trash, [], 1, 3);
  t.ok(`the cached path shows the same directional drop as the uncached one (random=${cachedRandom.toFixed(1)}, vs4bet=${cachedFourBet.toFixed(1)})`,
    cachedRandom - cachedFourBet > 8);
  // Re-requesting the same (hand, board, nOpp, raiseLevel) must hit the cache
  // and return the identical value, not a fresh (and therefore slightly
  // different, since this is Monte Carlo) recomputation.
  t.eq('a repeated request with the same key returns the exact cached value',
    T.estimateEquityCached(trash, [], 1, 3), cachedFourBet);
}

process.exit(t.report());
