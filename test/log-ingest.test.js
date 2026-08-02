// Log lines in, stats out. Drives handleLogLine with Torn's real wording.
//
// Nothing covered the parser end-to-end before this: the patterns were checked
// against sample lines in throwaway scripts, but the wiring from a line to a
// counter was not. That wiring is where limp counting and blind capture live.
//
// Names resolve to "name:<username>" pseudo-ids here because the headless DOM
// has no seats. That is the real fallback path, and it keys consistently, so
// the counters can still be asserted.

const { load, runner } = require('./harness');

const t = runner('log-ingest');

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 1;
  T.lastSeenBB = 0;
  return T;
}
const feed = (T, lines) => lines.forEach((l) => T.handleLogLine(l));
const P = (T, name) => T.STORE.players['name:' + name] || T.emptyPlayer('?', '?');

// --- Wording is parsed at all ----------------------------------------------

{
  const T = fresh();
  feed(T, [
    'Game 4f2a91 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Carol called $1,000,000',
    'Dave folded',
    'Alice raised $1,000,000 to $3,000,000',
  ]);

  t.eq('blind level captured from the log', T.lastSeenBB, 1000000);
  t.ok('a caller is recorded as voluntarily in', P(T, 'Carol').vpip >= 1);
  t.ok('a raiser is recorded as raising', P(T, 'Alice').pfr >= 1);
  t.eq('a folder puts no money in', P(T, 'Dave').vpip, 0);
}

// --- Limp counting ----------------------------------------------------------

{
  const T = fresh();
  feed(T, [
    'Game aaa111 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Carol called $1,000,000',   // limp
    'Dave called $1,000,000',    // limp
    'Alice called $500,000',     // SB completing — conventionally a limp
    'Bob checked',
  ]);

  t.eq('a call into an unraised pot is a limp', P(T, 'Carol').limpMade, 1);
  t.eq('so is the next one', P(T, 'Dave').limpMade, 1);
  t.eq('the small blind completing counts too', P(T, 'Alice').limpMade, 1);
  // The big blind has nothing to call in an unraised pot, so a "call" line from
  // them is completing, not limping. Counting it would make every BB look like
  // a habitual limper.
  t.eq('the big blind is never a limper', P(T, 'Bob').limpMade, 0);
}

{
  const T = fresh();
  feed(T, [
    'Game bbb222 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Carol raised $2,000,000 to $3,000,000',
    'Dave called $3,000,000',    // calling a RAISE — not a limp
    'Alice folded',
  ]);

  t.eq('calling a raise is not a limp', P(T, 'Dave').limpMade, 0);
  t.ok('but it is still voluntary money in', P(T, 'Dave').vpip >= 1);
  t.eq('the raiser did not limp', P(T, 'Carol').limpMade, 0);
}

// Limping twice in one hand (limp, then call a later raise) counts once.
{
  const T = fresh();
  feed(T, [
    'Game ccc333 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Carol called $1,000,000',
    'Dave raised $2,000,000 to $3,000,000',
    'Carol called $2,000,000',
  ]);
  t.eq('a limper who then calls a raise still counts once', P(T, 'Carol').limpMade, 1);
}

// --- Streets advance --------------------------------------------------------

{
  const T = fresh();
  feed(T, [
    'Game ddd444 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Carol called $1,000,000',
    'The flop:  5♣, 7♦, A♦',
    'Carol bet $2,000,000',
    'Bob folded',
  ]);

  // Postflop actions land in the right street bucket, which is what the new
  // per-street split reads.
  t.eq('a postflop bet lands on the flop', P(T, 'Carol').streetActions.flop.bet, 1);
  t.eq('a postflop fold lands on the flop', P(T, 'Bob').streetActions.flop.fold, 1);
  t.eq('nothing leaks into the turn', P(T, 'Carol').streetActions.turn.bet, 0);
}

// --- Hand settlement in both units -----------------------------------------

{
  const T = fresh();
  T.heroXid = 'name:Alice';
  feed(T, [
    'Game eee555 started',
    'Alice posted small blind $500,000',
    'Bob posted big blind $1,000,000',
    'Alice folded',
    'Bob won $1,500,000',
    'Game fff666 started',   // marker settles the previous hand
  ]);

  t.eq('hero booked the blind loss in chips', T.STORE.hero.netChips, -500000);
  t.near('and in big blinds', T.STORE.hero.netBB, -0.5);
  t.near('charged to the winner', T.STORE.players['name:Bob'].plChipsEst, -500000);
}

// --- Noise is filtered, not counted as unparsed ----------------------------

{
  const T = fresh();
  ['Alice joined the table', 'Bob left the table', 'The preflop Two cards dealt to each player']
    .forEach((l) => t.ok(`"${l.slice(0, 20)}..." is treated as noise`, T.LOG_NOISE_RE.test(l)));
}

process.exit(t.report());
