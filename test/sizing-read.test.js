// The live sizing read: which of a player's own showdown medians the bet in
// front of you sits nearer.
//
// Everything here drives the REAL exported functions — the v1.0.1 lesson is
// that a test asserting against its own re-implementation cannot fail when the
// original is wrong, and this one is all thresholds and comparisons, which is
// exactly the shape that silently drifts.
//
// Unlike the settings collapser (which needs a DOM the harness deliberately
// refuses to fake), this is pure logic over a hand object and a player record,
// so it is properly testable rather than needing a live report.

const { load } = require('./harness');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log('  FAIL: ' + name + (detail ? ' — ' + detail : ''));
}

const T = load();

// A player whose texture medians are whatever the test needs. Built through
// emptyPlayer so a field added to the record later shows up here too.
function playerWith({ madeSizes = [], bluffSizes = [], drawSizes = [] }) {
  const p = T.emptyPlayer('999', 'Villain');
  p.hands = 200;
  p.texture.madeSizes = madeSizes.slice();
  p.texture.bluffSizes = bluffSizes.slice();
  p.texture.drawSizes = drawSizes.slice();
  p.texture.madeBets = madeSizes.length;
  p.texture.bluffBets = bluffSizes.length;
  p.texture.drawBets = drawSizes.length;
  T.STORE.players['999'] = p;
  return p;
}

function handWith(actions, street) {
  const h = T.freshHandState();
  h.street = street || 'flop';
  actions.forEach((a) => { h.actions.push(a); });
  return h;
}

// --- lastSizedBetPct ------------------------------------------------------

{
  const h = handWith([
    { x: '999', a: 'bet', amt: 100, s: 'flop', p: 60 },
    { x: '111', a: 'call', amt: 100, s: 'flop' },
  ]);
  ok('reads the pot-relative size off the action', T.lastSizedBetPct(h, '999') === 60);
  ok('a player who has not bet reads null', T.lastSizedBetPct(h, '111') === null);
  ok('an unknown player reads null', T.lastSizedBetPct(h, 'nobody') === null);
}

{
  // The MOST RECENT sized action wins — a raise over their own earlier bet.
  const h = handWith([
    { x: '999', a: 'bet', amt: 100, s: 'flop', p: 40 },
    { x: '111', a: 'raise', amt: 300, s: 'flop', p: 120 },
    { x: '999', a: 'raise', amt: 900, s: 'flop', p: 200 },
  ]);
  ok('takes their latest sized action, not their first', T.lastSizedBetPct(h, '999') === 200);
}

{
  // A bet on a PREVIOUS street is a different decision about a different pot,
  // and must not be read as the size being faced now.
  const h = handWith([
    { x: '999', a: 'bet', amt: 100, s: 'flop', p: 75 },
    { x: '111', a: 'call', amt: 100, s: 'flop' },
    { x: '111', a: 'check', amt: 0, s: 'turn' },
  ], 'turn');
  ok('stops at the street boundary', T.lastSizedBetPct(h, '999') === null);
}

{
  // all-in carries a size too, and an unsized action must not be mistaken for one.
  const h = handWith([{ x: '999', a: 'all-in', amt: 5000, s: 'river', p: 350 }], 'river');
  ok('an all-in is a sized action', T.lastSizedBetPct(h, '999') === 350);
  const h2 = handWith([{ x: '999', a: 'bet', amt: 100, s: 'river' }], 'river');
  ok('a bet with no recorded size reads null', T.lastSizedBetPct(h2, '999') === null);
}

// --- liveSizingRead: the gates -------------------------------------------

{
  // Below TEXTURE_MIN categorised bets there are not two medians worth having.
  playerWith({ madeSizes: [100, 100], bluffSizes: [30] });
  const h = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 95 }]);
  ok('stays silent under TEXTURE_MIN categorised bets',
    T.liveSizingRead(h, '999') === null,
    'TEXTURE_MIN=' + T.TEXTURE_MIN);
}

{
  // Medians too close together: there is no separation to place a bet between.
  playerWith({ madeSizes: [60, 60, 60], bluffSizes: [55, 55, 55] });
  const h = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 100 }]);
  ok('stays silent when the two medians are inside SIZING_LIVE_MIN_GAP',
    T.liveSizingRead(h, '999') === null);
}

{
  // Bet sits near the midpoint — the poles are equally close, so the honest
  // answer is nothing rather than a coin flip dressed as a read.
  playerWith({ madeSizes: [100, 100, 100], bluffSizes: [20, 20, 20] });
  const h = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 60 }]);
  ok('stays silent on a bet at the midpoint', T.liveSizingRead(h, '999') === null);
}

// --- liveSizingRead: the verdicts ----------------------------------------

{
  playerWith({ madeSizes: [100, 100, 100], bluffSizes: [20, 20, 20] });
  const big = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 95 }]);
  const r1 = T.liveSizingRead(big, '999');
  ok('a bet near the made median reads as value', r1 && r1.looksMade === true);
  ok('the read carries the size it judged', r1 && r1.pct === 95);
  ok('the read carries both medians', r1 && r1.made === 100 && r1.bluff === 20);
  ok('the read carries both sample counts', r1 && r1.madeN === 3 && r1.bluffN === 3);

  const small = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 25 }]);
  const r2 = T.liveSizingRead(small, '999');
  ok('a bet near the bluff median reads as air', r2 && r2.looksMade === false);
}

{
  // REVERSE tell: bigger when bluffing. The nearest-pole rule has to handle
  // this with no special case, or the read is backwards for exactly the
  // players it matters most against.
  playerWith({ madeSizes: [40, 40, 40], bluffSizes: [110, 110, 110] });
  const big = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 105 }]);
  const r = T.liveSizingRead(big, '999');
  ok('on a reverse tell a BIG bet reads as air', r && r.looksMade === false);
  const small = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 45 }]);
  const r2 = T.liveSizingRead(small, '999');
  ok('on a reverse tell a SMALL bet reads as value', r2 && r2.looksMade === true);
  ok('the gap carries the direction', r && r.gap < 0);
}

{
  // An overbet shove past both poles still resolves to the nearer one.
  playerWith({ madeSizes: [100, 100, 100], bluffSizes: [20, 20, 20] });
  const shove = handWith([{ x: '999', a: 'all-in', amt: 1, s: 'river', p: 600 }], 'river');
  const r = T.liveSizingRead(shove, '999');
  ok('an overbet past both medians reads as value', r && r.looksMade === true);
}

{
  // No sized bet on this street at all.
  playerWith({ madeSizes: [100, 100, 100], bluffSizes: [20, 20, 20] });
  const h = handWith([{ x: '999', a: 'check', amt: 0, s: 'flop' }]);
  ok('stays silent with no sized bet to read', T.liveSizingRead(h, '999') === null);
}


{
  // A lone bluff observation is not a median. TEXTURE_MIN gates the SUM, so
  // seven made bets and one bluff clears it while half the comparison rests
  // on a single bet — the v1.26.0 "gate on the number the figure is computed
  // from" lesson, applied to the pole rather than the pair.
  playerWith({ madeSizes: [100, 100, 100, 100, 100, 100, 100], bluffSizes: [20] });
  const h = handWith([{ x: '999', a: 'bet', amt: 1, s: 'flop', p: 95 }]);
  ok('stays silent when one pole rests on a single observation',
    T.liveSizingRead(h, '999') === null,
    'SIZING_LIVE_MIN_POLE=' + T.SIZING_LIVE_MIN_POLE);

  // The same player with a second bluff observation becomes readable.
  playerWith({ madeSizes: [100, 100, 100, 100, 100, 100, 100], bluffSizes: [20, 20] });
  const r = T.liveSizingRead(h, '999');
  ok('a second observation on the thin pole makes it readable', r && r.looksMade === true);
  ok('and the read reports that pole\'s real count', r && r.bluffN === 2);
}

// --- the thresholds are pinned from both sides ---------------------------

{
  ok('SIZING_LIVE_MIN_GAP matches the standing tell bar in buildTendencyEntries',
    T.SIZING_LIVE_MIN_GAP === 20,
    'got ' + T.SIZING_LIVE_MIN_GAP);
  ok('SIZING_LIVE_MARGIN leaves a real dead band but not most of the range',
    T.SIZING_LIVE_MARGIN > 0 && T.SIZING_LIVE_MARGIN < 0.5,
    'got ' + T.SIZING_LIVE_MARGIN);
  ok('SIZING_LIVE_MIN_POLE demands more than one observation per side',
    T.SIZING_LIVE_MIN_POLE >= 2, 'got ' + T.SIZING_LIVE_MIN_POLE);
}

console.log(`sizing-read: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
