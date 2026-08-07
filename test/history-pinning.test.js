// Notable-hand pinning in history storage (v0.43.0).
//
// STORE.hands used to be a flat recency cap: anything past historyLimit got
// evicted, oldest first, with no regard for what the hand actually was. That
// meant a genuinely big pot — the one hand you'd actually go looking for later
// — was exactly as disposable as three hundred min-raised folds. Two triggers
// mark a hand notable, both in BIG BLINDS since a raw chip figure means
// nothing across stakes: the pot reached NOTABLE_POT_BB_THRESHOLD, or a
// preflop raise reached NOTABLE_PREFLOP_RAISE_BB. Notable hands survive the
// recency cap — but not forever: HISTORY_PINNED_CEILING is a hard bound, same
// shape as prunePlayers' PRUNE_PLAYER_CAP, so "notable" can't grow unbounded
// either.

const { load, runner } = require('./harness');

const t = runner('history-pinning');

function hand(overrides) {
  const T = load();
  const h = T.freshHandState();
  h.bbAmount = 1000000;
  h.pot = 2000000; // 2bb — not notable by default
  h.actions = [];
  h.winners = [{ xid: 'W', amount: h.pot }];
  return Object.assign(h, overrides);
}

// --- isNotableHand: the two triggers ----------------------------------------

{
  const T = load();
  t.eq('an ordinary small pot is not notable', T.isNotableHand(hand()), false);

  const bigPot = hand({ pot: 45000000 }); // 45bb, over the 40bb threshold
  t.eq('a pot at/over the threshold is notable', T.isNotableHand(bigPot), true);

  const justUnder = hand({ pot: 39900000 }); // 39.9bb
  t.eq('just under the pot threshold is not', T.isNotableHand(justUnder), false);

  const bigRaise = hand({ actions: [{ s: 'preflop', x: 'A', a: 'raise', amt: 5000000 }] }); // 5bb
  t.eq('a preflop raise at/over the bb threshold is notable', T.isNotableHand(bigRaise), true);

  const smallRaise = hand({ actions: [{ s: 'preflop', x: 'A', a: 'raise', amt: 3000000 }] }); // 3bb
  t.eq('a preflop raise under the threshold is not', T.isNotableHand(smallRaise), false);

  const postflopBig = hand({ actions: [{ s: 'flop', x: 'A', a: 'raise', amt: 10000000 }] }); // 10bb, but postflop
  t.eq('a big POSTFLOP raise does not trigger the preflop check', T.isNotableHand(postflopBig), false);

  const callNotRaise = hand({ actions: [{ s: 'preflop', x: 'A', a: 'call', amt: 10000000 }] });
  t.eq('a big preflop CALL is not a raise', T.isNotableHand(callNotRaise), false);
}

// --- isNotableHand: an unpriceable hand is never notable --------------------
//
// Same reasoning as elsewhere in this file: an unknown size is not evidence
// of a big one. Without a plausible blind, neither check can mean anything.

{
  const T = load();
  const noBlind = hand({ bbAmount: 0, pot: 999999999 });
  t.eq('with no readable blind, a huge pot is still not notable', T.isNotableHand(noBlind), false);
  const bbDisplayMode = hand({ bbAmount: 3, pot: 500 }); // "3" fails plausibleBB
  t.eq('an implausible (BB-display-mode) blind is not notable either', T.isNotableHand(bbDisplayMode), false);
}

// --- trimHandHistory: under the limit is untouched --------------------------

{
  const T = load();
  const hands = [{ t: 3 }, { t: 2 }, { t: 1 }];
  t.eq('fewer hands than the limit pass through unchanged', T.trimHandHistory(hands, 10, 500).length, 3);
}

// --- trimHandHistory: oldest UNPINNED evicted first --------------------------

{
  const T = load();
  // Newest first: t=5..1. Limit 3, no pinned entries — the oldest two (t=2,1)
  // must go, leaving the newest 3 in their original order.
  const hands = [{ t: 5 }, { t: 4 }, { t: 3 }, { t: 2 }, { t: 1 }];
  const kept = T.trimHandHistory(hands, 3, 500);
  t.eq('exactly `limit` survive with nothing pinned', kept.length, 3);
  t.eq('newest-first order is preserved', kept.map((h) => h.t).join(','), '5,4,3');
}

// --- trimHandHistory: pinned entries survive past the limit -----------------

{
  const T = load();
  // t=5 is pinned and OLDEST of all — it must survive anyway, past a limit of
  // 3, while the unpinned t=2 and t=1 (also old) are still evicted.
  const hands = [
    { t: 5, pinned: true }, { t: 4 }, { t: 3 }, { t: 2 }, { t: 1 },
  ];
  const kept = T.trimHandHistory(hands, 3, 500);
  t.eq('the pinned hand survives even though it is the oldest', kept.some((h) => h.t === 5), true);
  t.eq('3 unpinned hands were still allowed (the limit), plus the 1 pinned one', kept.length, 4);
  t.eq('relative newest-first order holds across the pinned/unpinned mix',
    kept.map((h) => h.t).join(','), '5,4,3,2');
}

// --- trimHandHistory: the hard ceiling still applies to pinned hands --------

{
  const T = load();
  // 10 pinned hands, ceiling of 4: even pinned hands get evicted once the
  // absolute ceiling is hit, oldest first — "notable" cannot grow unbounded.
  const hands = [];
  for (let i = 10; i >= 1; i--) hands.push({ t: i, pinned: true });
  const kept = T.trimHandHistory(hands, 3, 4);
  t.eq('capped at the hard ceiling even though everything is pinned', kept.length, 4);
  t.eq('the newest ones are what survive', kept.map((h) => h.t).join(','), '10,9,8,7');
}

// --- recordHandHistory: pinning happens where the hand is actually recorded -

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.historyLimit = 200;

  const big = T.freshHandState();
  big.bbAmount = 1000000;
  big.pot = 50000000; // 50bb
  big.actions = [{ s: 'preflop', x: 'A', a: 'raise', amt: 2000000 }];
  big.winners = [{ xid: 'A', amount: big.pot }];
  big.dealtInXids = new Set(['A', 'B']);
  T.recordHandHistory(big);

  t.eq('one hand recorded', T.STORE.hands.length, 1);
  t.eq('a hand over the pot threshold is stored pinned', T.STORE.hands[0].pinned, true);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.historyLimit = 200;

  const small = T.freshHandState();
  small.bbAmount = 1000000;
  small.pot = 3000000; // 3bb
  small.actions = [{ s: 'preflop', x: 'A', a: 'call', amt: 1000000 }];
  small.winners = [{ xid: 'A', amount: small.pot }];
  small.dealtInXids = new Set(['A', 'B']);
  T.recordHandHistory(small);

  t.eq('an ordinary hand is stored unpinned', T.STORE.hands[0].pinned, false);
}

// --- mergeHands: pinning is respected across an import, not just a live save

{
  const T = load();
  // Device A has one huge-pot hand from long ago; device B has 5 ordinary
  // recent hands. Merged with a small limit, the notable hand from A must
  // still make it through — a flat slice(0, limit) would have dropped it.
  const notable = { t: 1, g: 'g-old', pot: 50000000, pinned: true };
  const a = [notable];
  const b = [];
  for (let i = 2; i <= 6; i++) b.push({ t: i, g: 'g' + i, pot: 1000000, pinned: false });

  const merged = T.mergeHands(a, b, 3);
  t.eq('the old notable hand survives the merge despite a limit of 3',
    merged.some((h) => h.g === 'g-old'), true);
  t.eq('3 unpinned hands (the limit) plus the 1 pinned one', merged.length, 4);
}

process.exit(t.report());
