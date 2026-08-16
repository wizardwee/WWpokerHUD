// Bet-sizing and slowplay, split by hand strength AT THE MOMENT of the action
// — the two "things to improve" this feature answers: what does a bet SIZE
// mean from this player (draw vs made hand), and do they trap (check a big
// hand instead of betting it)? Both are derived only from showdowns, same
// evidence source and same "floor on a range, never the whole of it" caveat
// as shownHands/the Range tab — there is no other way to know what a player
// was actually holding mid-hand.
//
// categoryAt/hasDrawAt are tested directly first (pure logic, no log parsing),
// then the whole pipeline is driven through handleLogLine end to end — real
// blind/bet/check/reveal wording in, p.texture out — because a test of a hand
// built by hand cannot catch the wiring between a parsed bet and the `.p`
// field noteBetTexture actually reads (see CLAUDE.md: "a test of a copy
// cannot fail when the original is wrong").

const { load, runner } = require('./harness');

const t = runner('bet-texture');
const T = load();

const c = (rank, suit) => ({ rank, suit });

// --- categoryAt: delegates to evaluate7, doesn't reinvent it ----------------

t.eq('two pair on the flop already',
  T.categoryAt([c('9', 'd'), c('7', 'd')], [c('9', 'c'), c('7', 's'), c('2', 'h')]), 2);
t.eq('high card, nothing made yet',
  T.categoryAt([c('A', 's'), c('K', 's')], [c('2', 's'), c('7', 's'), c('9', 'd')]), 0);
t.eq('a made flush once the 5th suited card lands',
  T.categoryAt([c('A', 's'), c('K', 's')], [c('2', 's'), c('7', 's'), c('9', 'd'), c('T', 'd'), c('3', 's')]), 5);
t.eq('works on 5 cards (flop) the same as 7 (river) — generic over length',
  T.categoryAt([c('A', 'h'), c('A', 'c')], [c('A', 's'), c('K', 'd'), c('2', 'c')]), 3);

// --- hasDrawAt ---------------------------------------------------------------

t.ok('a 4-flush with no pair is a draw',
  T.hasDrawAt([c('A', 's'), c('K', 's')], [c('2', 's'), c('7', 's'), c('9', 'd')]));
t.ok('an open-ended straight draw is a draw',
  T.hasDrawAt([c('6', 'd'), c('5', 'c')], [c('8', 's'), c('7', 'h'), c('2', 'c')]));
t.ok('a gutshot counts too — coarse on purpose, same tradeoff as RFI_RANGES',
  T.hasDrawAt([c('9', 'd'), c('6', 'c')], [c('8', 's'), c('7', 'h'), c('2', 'c')]));
t.eq('nothing connects: not a draw',
  T.hasDrawAt([c('2', 'd'), c('9', 'c')], [c('K', 's'), c('5', 'h'), c('J', 'c')]), false);
t.eq('a COMPLETED flush is not a "draw" — 5 suited, not 4',
  T.hasDrawAt([c('A', 's'), c('K', 's')], [c('2', 's'), c('7', 's'), c('9', 's')]), false);

// --- betSizePctOf --------------------------------------------------------

t.eq('half pot', T.betSizePctOf(500000, 1000000), 50);
t.eq('a pot-sized bet', T.betSizePctOf(1000000, 1000000), 100);
t.eq('no bet, no percentage', T.betSizePctOf(0, 1000000), null);
t.eq('no pot to size against', T.betSizePctOf(500000, 0), null);
t.eq('an undefined pot does not throw', T.betSizePctOf(500000, undefined), null);

// --- computeRates is safe with no texture object at all ---------------------
// A bare literal, same shape other tests hand computeRates (e.g.
// preflop-tiers.test.js) — must not throw and must read as "nothing yet".

{
  const r = T.computeRates({
    hands: 0, vpip: 0, pfr: 0, threeBetMade: 0, foldTo3BetMade: 0, foldTo3BetOpp: 0,
    cbetMade: 0, cbetOpp: 0, foldToCbetMade: 0, foldToCbetOpp: 0, wtsd: 0,
    limpMade: 0, betSizeCount: 0, betSizePctSum: 0,
    streetActions: { flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
      turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
      river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 } },
  });
  t.eq('no draw sizing yet', r.betDrawPct, null);
  t.eq('no made sizing yet', r.betMadePct, null);
  t.eq('no trap sample yet', r.trapRate, null);
  t.eq('sample sits at zero, not undefined', r.trapSample, 0);
}

// --- End to end: real log wording in, p.texture out -------------------------
//
// Carol holds A♠K♠. Flop pairs neither hole card but gives her a 4-flush —
// she bets it (a DRAW bet, pot-sized). Turn misses the flush — she checks (no
// pair yet, so this must NOT count as a slowplay). River completes the flush
// — she bets it (a MADE-hand bet, half pot). One clean, fully-determined
// sample of each category.

function fresh() {
  const H = load();
  H.STORE = H.emptyStore();
  H.STORE.settings.minHands = 1;
  H.lastSeenBB = 0;
  return H;
}
const feed = (H, lines) => lines.forEach((l) => H.handleLogLine(l));

{
  const H = fresh();
  feed(H, [
    'Game 111abc started',
    'Alice posted small blind $500,000',
    'Carol posted big blind $1,000,000',
    'Alice called $500,000',
    'The flop:  2♠, 7♠, 9♦',
    'Carol bet $2,000,000',      // pot before = 2,000,000 -> 100% pot, a draw
    'Alice called $2,000,000',
    'The turn: T♦',
    'Carol checked',             // still no pair — must NOT count as slowplay
    'Alice checked',
    'The river: 3♠',
    'Carol bet $3,000,000',      // pot before = 6,000,000 -> 50% pot, now made
    'Alice called $3,000,000',
    'Carol reveals [A♠, K♠] (Flush: Ace High)',
    'Carol won $15,000,000',
    'Game 222def started',       // settles the hand above
  ]);

  const p = H.STORE.players['name:Carol'];
  t.ok('the player record exists', !!p);
  t.eq('one draw bet (the flop)', p.texture.drawBets, 1);
  t.eq('one made-hand bet (the completed river flush)', p.texture.madeBets, 1);
  t.eq('the drawless turn check does not register as a slowplay', p.texture.checkMade, 0);

  const r = H.computeRates(p);
  t.eq('drew sized at 100% of pot', r.betDrawPct, 100);
  t.eq('made hand sized at 50% of pot', r.betMadePct, 50);
  t.eq('one made-hand spot, zero of them checked', r.trapRate, 0);
  t.eq('...out of exactly one sample', r.trapSample, 1);
}

// --- Slowplay: checking a hand that is ALREADY two pair+ -------------------
//
// Dave flops two pair immediately (no draw involved) and checks it, checks it
// again on the river after betting the turn with it. Two checked-made spots,
// one bet-made spot: a 2-in-3 trap rate.

{
  const H = fresh();
  feed(H, [
    'Game 333abc started',
    'Alice posted small blind $500,000',
    'Dave posted big blind $1,000,000',
    'Alice called $500,000',
    'The flop:  9♣, 7♠, 2♥',
    'Dave checked',               // already two pair — slowplay #1
    'Alice checked',
    'The turn: 4♦',
    'Dave bet $2,000,000',        // still two pair — bet it this time
    'Alice called $2,000,000',
    'The river: K♠',
    'Dave checked',               // still two pair — slowplay #2
    'Alice checked',
    'Dave reveals [9♦, 7♦] (Two Pairs: Nines and Sevens)',
    'Dave won $9,000,000',
    'Game 444def started',        // valid hex id — the marker pattern requires [0-9a-f]{6,}
  ]);

  const p = H.STORE.players['name:Dave'];
  t.eq('two checked-made spots', p.texture.checkMade, 2);
  t.eq('one bet-made spot', p.texture.madeBets, 1);
  t.eq('no draw bets — this was never a draw', p.texture.drawBets, 0);

  const r = H.computeRates(p);
  t.eq('trap sample is all three made-hand spots', r.trapSample, 3);
  t.near('checks 2 of 3 made-hand spots — a real trap tendency', r.trapRate, 66.67, 0.1);
}

process.exit(t.report());
