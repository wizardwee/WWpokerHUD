// What each log line puts in the pot, and which hands count at all.
//
// Found by an end-to-end fuzz (random legal hands fed through handleLogLine in
// Chromium, hero's P/L checked against the hand's own arithmetic), not by
// review: every assertion elsewhere fed hands where nobody raised twice on a
// street, and that is the only shape these two faults show in.
//
//   1. "raised $X to $Y" states the raiser's TOTAL for the street. The parser
//      added all of $Y, so anything they already had in — a blind, a limp, the
//      open they were 4-betting over — was charged twice. Hero's P/L and every
//      opponent's net moved with it; the fuzz read -$25M for a hand hero lost
//      $22.5M in.
//   2. The first "Game <hex> started" after a page load settled the empty
//      placeholder hand, counting a hand — as a fold — for everyone seated.
//
// Names resolve to "name:<username>" pseudo-ids (the harness has no seats);
// they key consistently, so the per-player sums can be asserted.

const { load, runner } = require('./harness');

const t = runner('contributions');

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = 0;
  return T;
}
const feed = (T, lines) => lines.forEach((l) => T.handleLogLine(l));
const C = (T, name) => T.currentHand.contributions['name:' + name] || 0;
const M = 1000000;

// --- a raise adds only what is new on the street -----------------------------

{
  const T = fresh();
  feed(T, [
    'Game 7c7c7c started',
    'Alice posted small blind $1,250,000',
    'Bob posted big blind $2,500,000',
    'Carol raised $5,000,000 to $7,500,000',
    'Alice folded',
    'Bob raised $15,000,000 to $22,500,000',   // squeeze from the big blind
    'Carol raised $37,500,000 to $60,000,000', // the opener 4-bets
    'Bob called $37,500,000',
  ]);
  t.eq('the big blind\'s raise to 22.5M costs 22.5M, not blind + 22.5M', C(T, 'Bob'), 60 * M);
  t.eq('the opener\'s 4-bet to 60M costs 60M in all, not open + 60M', C(T, 'Carol'), 60 * M);
  t.eq('the pot is the sum of what went in', T.currentHand.pot, 121.25 * M);
}

{
  // Postflop: bet, raise, re-raise by the original bettor.
  const T = fresh();
  feed(T, [
    'Game 8d8d8d started',
    'Alice posted small blind $1,250,000',
    'Bob posted big blind $2,500,000',
    'Alice called $1,250,000',
    'Bob checked',
    'The flop:  5♣, 7♦, A♦',
    'Alice bet $5,000,000',
    'Bob raised $10,000,000 to $15,000,000',
    'Alice raised $30,000,000 to $45,000,000',
  ]);
  t.eq('street totals restart on the flop: bettor\'s re-raise to 45M costs 45M on the street',
    C(T, 'Alice'), 2.5 * M + 45 * M);
  t.eq('a first raise with nothing in yet costs the full figure', C(T, 'Bob'), 2.5 * M + 15 * M);
}

{
  // Settled through P/L, so the fix reaches the number the user reads.
  const T = fresh();
  T.heroXid = 'name:Hero';
  feed(T, [
    'Game 9e9e9e started',
    'Villain posted small blind $1,250,000',
    'Hero posted big blind $2,500,000',
    'Villain raised $5,000,000 to $7,500,000',
    'Hero raised $15,000,000 to $22,500,000',
    'Villain folded',
    'Hero won $30,000,000 Did not show hand',
    'Game 9e9e9f started',
  ]);
  t.eq('hero nets exactly what villain put in', T.STORE.hero.netChips, 7.5 * M);
}

// --- a hand nothing was seen in is not a hand --------------------------------

{
  const T = fresh();
  T.heroXid = 'hero';
  // What ensureHand() builds at the first marker after a page load: seats
  // snapshot, no actions, no winner.
  const h = T.freshHandState();
  ['hero', 'v1', 'v2'].forEach((x) => { h.dealtInXids.add(x); h.playersIn.add(x); });
  T.currentHand = h;
  T.handleLogLine('Game abcdef started');

  t.eq('hero is not credited a hand nothing was seen in', T.STORE.hero.hands, 0);
  t.eq('nor is anyone seated', (T.STORE.players.v1 || { hands: 0 }).hands, 0);
  t.ok('and the new hand is open', T.currentHand && T.currentHand.gameId === 'abcdef');
}

{
  // The guard must not swallow a hand that WAS observed.
  const T = fresh();
  T.heroXid = 'hero';
  const h = T.freshHandState();
  ['hero', 'v1'].forEach((x) => { h.dealtInXids.add(x); h.playersIn.add(x); });
  h.actions.push({ x: 'v1', a: 'fold', amt: 0, s: 'preflop' });
  T.currentHand = h;
  T.handleLogLine('Game abcdee started');
  t.eq('a hand with an action is still counted', T.STORE.hero.hands, 1);
  t.eq('for everyone dealt in', T.STORE.players.v1.hands, 1);
}

{
  // A reveal harvested from the seats is an observation too.
  const T = fresh();
  const h = T.freshHandState();
  h.dealtInXids.add('v1');
  h.shownCards.v1 = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }];
  T.currentHand = h;
  T.handleLogLine('Game abcded started');
  t.eq('a hand seen only through a reveal is counted', T.STORE.players.v1.hands, 1);
}

process.exit(t.report());
