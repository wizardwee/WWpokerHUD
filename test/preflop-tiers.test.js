// Preflop raise TIERS, and the ranges built on them (v1.1.0).
//
// shownHands.raised was set from countedPfr — "raised at some point preflop".
// It cannot tell an open from a 3-bet, so the two were averaged into one range
// that describes neither. The tier is now read off preflopRaiseEvents at the
// moment a player raises, which is the same counter maybeCountThreeBet keys
// off, so the tier filed against a showdown and the 3-bet stat cannot disagree.
//
// The invariants worth stating, all asserted below:
//   - open + 3bet + 4bet reconstructs `raised` EXACTLY (open is derived by
//     subtraction, so a drift here means the tiers and `raised` disagree)
//   - a record written before tiers existed reads wholly as "opened", which is
//     the honest reading of data that has no tier
//   - limp-3bet deliberately OVERLAPS 3-bet rather than being carved out of it

const { load, runner } = require('./harness');

const t = runner('preflop-tiers');
const T = load();

t.ok('shownRange is exported', typeof T.shownRange === 'function');
t.ok('streetRates is exported', typeof T.streetRates === 'function');

// AA: 4 showdowns — 1 open, 2 three-bets, 1 four-bet, of which 1 was a limp-3bet
// KK: 2 showdowns — both 3-bets, both limp-3bets
// T9s: 3 showdowns, never raised
// QQ: a LEGACY record — raised, but written before tiers existed
const p = {
  shownHands: {
    AA: { seen: 4, raised: 4, won: 3, r3: 2, r4: 1, lr: 1 },
    KK: { seen: 2, raised: 2, won: 1, r3: 2, lr: 2 },
    T9s: { seen: 3, raised: 0, won: 0 },
    QQ: { seen: 1, raised: 1, won: 1 },
  },
};
const n = (mode, cls) => {
  const hit = T.shownRange(p, mode).find((e) => e.cls === cls);
  return hit ? hit.n : 0;
};
const total = (mode) => T.shownRange(p, mode).reduce((s, e) => s + e.n, 0);

// --- the tier split ---------------------------------------------------------

t.eq('AA opened once (raised 4 - r3 2 - r4 1)', n('open', 'AA'), 1);
t.eq('AA 3-bet twice', n('threebet', 'AA'), 2);
t.eq('AA 4-bet once', n('fourbet', 'AA'), 1);
t.eq('KK never opened — every raise was a 3-bet', n('open', 'KK'), 0);
t.eq('KK 3-bet twice', n('threebet', 'KK'), 2);

// --- the reconstruction invariant -------------------------------------------
//
// If this fails, `open` (derived by subtraction) has drifted from the tier
// counters, which means a showdown is being double-counted or lost.

t.eq('open + 3bet + 4bet === raised',
  total('open') + total('threebet') + total('fourbet'), total('raised'));

// --- old records must not vanish --------------------------------------------

t.eq('a legacy record with no tiers reads as an open', n('open', 'QQ'), 1);
t.eq('...and is not double-counted into 3-bet', n('threebet', 'QQ'), 0);

// --- called/limped is untouched by any of this ------------------------------

t.eq('never-raised hands stay in called', n('called', 'T9s'), 3);
t.eq('never-raised hands are absent from open', n('open', 'T9s'), 0);
t.eq('raised hands are absent from called', n('called', 'AA'), 0);

// --- limp-3bet overlaps 3-bet on purpose ------------------------------------
//
// A limp-reraise IS a 3-bet. Carving it out of r3 would understate the 3-bet
// range, so both report it and the UI labels it as a subset.

t.eq('KK limp-3bet twice', n('limpraise', 'KK'), 2);
t.ok('limp-3bet is a subset of 3-bet, not a sibling', n('limpraise', 'KK') <= n('threebet', 'KK'));

// --- postflop re-raise, derived from streetActions --------------------------
//
// Facing a bet is the only state in which raise/call/fold are possible, so
// raise/(raise+call+fold) is the re-raise frequency with no new collection.
// check and bet must NOT reach the denominator.

{
  const sr = T.streetRates({ bet: 3, raise: 2, call: 6, check: 5, fold: 2 });
  t.eq('faced = raise + call + fold, excluding check and bet', sr.faced, 10);
  t.eq('re-raise = 2/10 = 20%', Math.round(sr.rr), 20);
}
t.eq('a null street is safe', T.streetRates(null).rr, null);
t.eq('no postflop action reads null, not NaN',
  T.streetRates({ bet: 0, raise: 0, call: 0, check: 0, fold: 0 }).rr, null);
{
  // A player who only ever bets into an empty pot has faced nothing, so the
  // stat must withhold rather than report 0% — "never re-raises" is a claim,
  // and there is no evidence for it here.
  const sr = T.streetRates({ bet: 5, raise: 0, call: 0, check: 4, fold: 0 });
  t.eq('betting and checking alone yields no re-raise figure', sr.rr, null);
}

process.exit(t.report());
