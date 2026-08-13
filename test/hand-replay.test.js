// The hand replayer (v1.17.0): replayStepsFor/replayPreflopRaiseLevel/
// replayStepEquity, plus recordHandHistory now persisting hand.board and the
// cardGlyph/cardsGlyphText display helpers.
//
// renderReplayPanel/openReplayHand aren't driven here — same DOM boundary as
// every other render function in this file (see name-boundary.test.js's
// header). What's tested is the actual state machine: given a stored hand,
// what does each step look like, and can equity be computed from it.

const { load, runner } = require('./harness');

const t = runner('hand-replay');

// A LIVE hand object, the shape recordHandHistory takes (currentHand-like —
// dealtInXids, not players).
function hand(T, overrides) {
  const h = T.freshHandState();
  h.pot = 4000000;
  h.dealtInXids = new Set(['A', 'B', 'H']);
  h.actions = [];
  h.winners = [];
  return Object.assign(h, overrides);
}

// A STORED hand object, the shape replayStepsFor/replayStepEquity actually
// consume (players, not dealtInXids — that rename happens inside
// recordHandHistory, which these functions run entirely after).
function storedHand(overrides) {
  return Object.assign({
    t: Date.now(),
    g: null,
    street: 'preflop',
    pot: 4000000,
    players: ['A', 'B', 'H'],
    actions: [],
    winners: [],
    shown: {},
    heroCards: null,
    board: [],
    pinned: false,
  }, overrides);
}

// --- cardGlyph / cardsGlyphText: pure display helpers -----------------------

{
  const T = load();
  t.eq('a card renders rank + suit glyph', T.cardGlyph({ rank: 'A', suit: 's' }), 'A♠');
  t.eq('each suit maps to its own glyph', [
    T.cardGlyph({ rank: '9', suit: 'h' }),
    T.cardGlyph({ rank: 'T', suit: 'd' }),
    T.cardGlyph({ rank: '2', suit: 'c' }),
  ].join(' '), '9♥ T♦ 2♣');
  t.eq('a null card renders empty, not a throw', T.cardGlyph(null), '');
  t.eq('two cards join with a space',
    T.cardsGlyphText([{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }]), 'A♠ K♥');
  t.eq('an empty list renders empty', T.cardsGlyphText([]), '');
  t.eq('undefined renders empty, not a throw', T.cardsGlyphText(undefined), '');
}

// --- recordHandHistory: board is now persisted -------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const h = hand(T, {
    actions: [{ x: 'A', a: 'raise', amt: 2000000, s: 'preflop' }],
    board: [{ rank: 'A', suit: 'h' }, { rank: '7', suit: 'd' }, { rank: '2', suit: 'c' }],
  });
  T.recordHandHistory(h);
  t.eq('the stored record carries the board', JSON.stringify(T.STORE.hands[0].board), JSON.stringify(h.board));
}

{
  const T = load();
  T.STORE = T.emptyStore();
  // Simulates a hand recorded before v1.17.0: no board property at all on the
  // stored object, distinct from a genuinely empty (preflop-only) hand.
  const h = hand(T, { actions: [{ x: 'A', a: 'fold', amt: 0, s: 'preflop' }], board: undefined });
  T.recordHandHistory(h);
  t.eq('an absent board records as an empty array, not undefined', JSON.stringify(T.STORE.hands[0].board), '[]');
}

// --- replayStepsFor: windowing by street -------------------------------------

{
  const T = load();
  t.eq('a null hand produces no steps', T.replayStepsFor(null).length, 0);
}

{
  const T = load();
  const h = storedHand({
    actions: [
      { x: 'A', a: 'raise', amt: 2000000, s: 'preflop' },
      { x: 'B', a: 'fold', amt: 0, s: 'preflop' },
      { x: 'H', a: 'call', amt: 2000000, s: 'preflop' },
    ],
  });
  const steps = T.replayStepsFor(h);
  t.eq('preflop-only actions produce exactly one step', steps.length, 1);
  t.eq('the step is tagged preflop', steps[0].street, 'preflop');
  t.eq('B folded, so live drops to A and H', JSON.stringify(steps[0].live.slice().sort()), JSON.stringify(['A', 'H']));
  t.eq('board is known but empty at preflop (0 cards dealt)', steps[0].board.length, 0);
}

{
  const T = load();
  const h = storedHand({
    board: [{ rank: 'A', suit: 'h' }, { rank: '7', suit: 'd' }, { rank: '2', suit: 'c' },
      { rank: 'K', suit: 's' }],
    actions: [
      { x: 'A', a: 'raise', amt: 2000000, s: 'preflop' },
      { x: 'H', a: 'call', amt: 2000000, s: 'preflop' },
      { x: 'A', a: 'bet', amt: 1000000, s: 'flop' },
      { x: 'H', a: 'fold', amt: 0, s: 'flop' },
    ],
  });
  const steps = T.replayStepsFor(h);
  t.eq('two streets with actions produce two steps', steps.length, 2);
  t.eq('flop step board is sliced to exactly 3 cards even though 4 are stored',
    steps[1].board.length, 3);
  t.eq('the turn card is NOT included in the flop step', steps[1].board[2].rank, '2');
  t.eq('hero folded on the flop, so live no longer includes H', steps[1].live.includes('H'), false);
  t.eq('the PREFLOP step still shows hero as live — folds apply from their own street forward',
    steps[0].live.includes('H'), true);
  t.eq('a street the hand never reached (turn/river) produces no step', steps.some((s) => s.street === 'turn'), false);
}

{
  const T = load();
  const h = storedHand({ actions: [{ x: 'A', a: 'fold', amt: 0, s: 'preflop' }], board: undefined });
  const steps = T.replayStepsFor(h);
  t.eq('board undefined on the stored hand reads as unknown (null), not an empty array',
    steps[0].board, null);
}

{
  const T = load();
  t.eq('a hand with no actions at all produces no steps', T.replayStepsFor(storedHand({ actions: [] })).length, 0);
}

// --- replayPreflopRaiseLevel: an all-in counts as a raise, same as live -----

{
  const T = load();
  const noRaise = T.replayStepsFor(storedHand({
    actions: [{ x: 'A', a: 'call', amt: 1000000, s: 'preflop' }],
  }));
  t.eq('a limped pot has zero preflop raise events', T.replayPreflopRaiseLevel(noRaise), 0);

  const oneRaise = T.replayStepsFor(storedHand({
    actions: [{ x: 'A', a: 'raise', amt: 2000000, s: 'preflop' }],
  }));
  t.eq('one open counts as one raise event', T.replayPreflopRaiseLevel(oneRaise), 1);

  const threeBetAllin = T.replayStepsFor(storedHand({
    actions: [
      { x: 'A', a: 'raise', amt: 2000000, s: 'preflop' },
      { x: 'B', a: 'all-in', amt: 50000000, s: 'preflop' },
    ],
  }));
  t.eq('an all-in counts toward the raise level, same as preflopRaiseEvents live',
    T.replayPreflopRaiseLevel(threeBetAllin), 2);

  t.eq('a hand with no preflop step at all reads as zero raise events',
    T.replayPreflopRaiseLevel([{ street: 'flop', actions: [] }]), 0);
}

// --- replayStepEquity: the honest-null cases ---------------------------------

const heroCards = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }];
const flopBoard = [{ rank: '2', suit: 'h' }, { rank: '7', suit: 'd' }, { rank: '9', suit: 'c' }];

{
  const T = load();
  T.heroXid = 'H';
  const h = storedHand({ heroCards: null, board: flopBoard });
  const steps = T.replayStepsFor(storedHand({
    board: flopBoard,
    actions: [{ x: 'A', a: 'bet', amt: 1000000, s: 'flop' }],
  }));
  t.eq('no hero cards captured on this hand -> null, not a throw',
    T.replayStepEquity(h, steps[0], 0), null);
}

{
  const T = load();
  // heroXid never resolved.
  const h = storedHand({ heroCards });
  const steps = T.replayStepsFor(storedHand({
    board: flopBoard,
    actions: [{ x: 'A', a: 'bet', amt: 1000000, s: 'flop' }],
  }));
  t.eq('heroXid unresolved -> null', T.replayStepEquity(h, steps[0], 0), null);
}

{
  const T = load();
  T.heroXid = 'H';
  const h = storedHand({ heroCards });
  const steps = T.replayStepsFor(storedHand({
    board: flopBoard,
    actions: [
      { x: 'A', a: 'bet', amt: 1000000, s: 'flop' },
      { x: 'H', a: 'fold', amt: 0, s: 'flop' },
    ],
  }));
  t.eq('hero folded by this step -> null (nothing to have equity FOR)',
    T.replayStepEquity(h, steps[0], 0), null);
}

{
  const T = load();
  T.heroXid = 'H';
  const h = storedHand({ heroCards, board: undefined });
  const steps = T.replayStepsFor(storedHand({
    board: undefined,
    actions: [{ x: 'A', a: 'bet', amt: 1000000, s: 'flop' }],
  }));
  t.eq('board unknown (pre-v1.17.0 hand) -> null rather than a guessed equity',
    T.replayStepEquity(h, steps[0], 0), null);
}

{
  const T = load();
  T.heroXid = 'H';
  const h = storedHand({ heroCards, players: ['H'], board: flopBoard });
  const steps = T.replayStepsFor(storedHand({
    players: ['H'],
    board: flopBoard,
    actions: [{ x: 'H', a: 'check', amt: 0, s: 'flop' }],
  }));
  t.eq('nobody left to have equity against -> null', T.replayStepEquity(h, steps[0], 0), null);
}

{
  const T = load();
  T.heroXid = 'H';
  const h = storedHand({ heroCards, board: flopBoard });
  const steps = T.replayStepsFor(storedHand({
    board: flopBoard,
    actions: [
      { x: 'A', a: 'bet', amt: 1000000, s: 'flop' },
      { x: 'H', a: 'call', amt: 1000000, s: 'flop' },
    ],
  }));
  const eq = T.replayStepEquity(h, steps[0], 0);
  t.ok('a valid step with hero still live returns a real equity number',
    typeof eq === 'number' && eq >= 0 && eq <= 100);
}

process.exit(t.report());
