// Board repair and partial-board honesty — see repairBoardFromDom /
// boardIsPartial / dedupeCards in the userscript.
//
// Reported from a live install, with a screenshot: a stored hand read
// "reached river · board: 5♦ 9♠". Two cards on a river board.
//
// ROOT CAUSE: the log's board line for a street can be missed, and the flop is
// the one that gets missed. Lines already on screen when the log snapshot
// primes are deliberately NOT parsed (scanLogRows treats them as a partial
// hand that is already over), so a hand in progress at that moment loses its
// flop. The turn and river then append to an empty board — 0 + 1 + 1 = 2 — and
// the street still reads "river" because the street is set by the same lines
// that were parsed. Nothing errors; the hand just records a board it only
// partly saw.
//
// Two independent fixes, and both matter: repair the board off the table while
// the cards are still there, and — where that could not happen — say the board
// is partial rather than printing two cards as though they were the whole one.

const { load, runner } = require('./harness');

const t = runner('board-repair');
const C = (rank, suit) => ({ rank, suit });

// --- dedupeCards -----------------------------------------------------------
//
// Load-bearing, not tidiness: a DOM repair fills a street in, and then the
// log line for that same street can still arrive and append. Without dedupe
// the board would list a card twice.

{
  const T = load();
  const dup = [C('5', 'd'), C('9', 's'), C('5', 'd')];
  t.eq('a repeated card is dropped', T.dedupeCards(dup).length, 2);
  t.eq('the first occurrence is the one kept', T.dedupeCards(dup)[0].rank, '5');
  t.eq('same rank, different suit is NOT a duplicate',
    T.dedupeCards([C('5', 'd'), C('5', 's')]).length, 2);
  t.eq('an empty board stays empty', T.dedupeCards([]).length, 0);
  t.eq('null does not throw', T.dedupeCards(null).length, 0);
}

// --- boardIsPartial: the display honesty check -----------------------------

{
  const T = load();

  // The reported hand, exactly.
  t.eq('two cards on a river board is partial',
    T.boardIsPartial({ street: 'river', board: [C('5', 'd'), C('9', 's')] }), true);
  t.eq('four cards on a river board is partial',
    T.boardIsPartial({ street: 'river', board: [C('5', 'd'), C('9', 's'), C('2', 'c'), C('7', 'h')] }), true);
  t.eq('five cards on a river board is complete',
    T.boardIsPartial({ street: 'river', board: [C('5', 'd'), C('9', 's'), C('2', 'c'), C('7', 'h'), C('A', 'd')] }), false);

  // The screenshot's OTHER hand: four cards, reached turn. That one was
  // correct all along, and must not be flagged.
  t.eq('four cards on a turn board is complete, not partial',
    T.boardIsPartial({ street: 'turn', board: [C('A', 'h'), C('Q', 's'), C('T', 'c'), C('8', 's')] }), false);
  t.eq('three cards on a flop board is complete',
    T.boardIsPartial({ street: 'flop', board: [C('A', 'h'), C('Q', 's'), C('T', 'c')] }), false);

  // Preflop has no board to be short of.
  t.eq('preflop is never partial', T.boardIsPartial({ street: 'preflop', board: [] }), false);

  // UNKNOWN IS NOT INCOMPLETE. A hand recorded before boards were persisted
  // (v1.17.0) has no board at all, and formatHand already omits the line
  // entirely rather than claiming an empty board. Flagging those as "partial"
  // would put a warning on hundreds of old hands that are not broken, just
  // from before the field existed.
  t.eq('a hand with no board recorded at all is not flagged partial',
    T.boardIsPartial({ street: 'river', board: [] }), false);
  t.eq('an undefined board is not flagged partial',
    T.boardIsPartial({ street: 'river' }), false);
  t.eq('an unknown street is not flagged', T.boardIsPartial({ street: 'nonsense', board: [C('5', 'd')] }), false);
}

// --- BOARD_COUNT_FOR is what both sides agree on --------------------------

{
  const T = load();
  t.eq('flop is 3', T.BOARD_COUNT_FOR.flop, 3);
  t.eq('turn is 4', T.BOARD_COUNT_FOR.turn, 4);
  t.eq('river is 5', T.BOARD_COUNT_FOR.river, 5);
  t.eq('preflop is 0', T.BOARD_COUNT_FOR.preflop, 0);
}

// --- repairBoardFromDom ----------------------------------------------------
//
// The harness DOM is inert, so readBoardCards() finds nothing. That is the
// right shape for the assertions that matter here — the guards. The repair
// must never fire when there is nothing to read, never shrink a board it
// cannot improve, and never throw with no hand in progress.

{
  const T = load();
  T.STORE = T.emptyStore();

  T.currentHand = null;
  let threw = false;
  try { T.repairBoardFromDom(); } catch (e) { threw = true; }
  t.eq('with no hand in progress it does nothing and does not throw', threw, false);

  // An inert DOM reads zero cards, so a short board must be left exactly as it
  // was. This is the guard that stops the repair DESTROYING a board it cannot
  // improve on — the log is authoritative whenever it is complete.
  T.currentHand = { street: 'river', board: [C('5', 'd'), C('9', 's')] };
  T.repairBoardFromDom();
  t.eq('a board the DOM cannot improve on is left untouched', T.currentHand.board.length, 2);
  t.eq('and its cards are unchanged', T.currentHand.board[0].rank, '5');

  // A complete board short-circuits before reading the DOM at all.
  const full = [C('5', 'd'), C('9', 's'), C('2', 'c'), C('7', 'h'), C('A', 'd')];
  T.currentHand = { street: 'river', board: full.slice() };
  T.repairBoardFromDom();
  t.eq('a complete board is never re-read', T.currentHand.board.length, 5);

  // Preflop has no board, so there is nothing to repair and no DOM read.
  T.currentHand = { street: 'preflop', board: [] };
  T.repairBoardFromDom();
  t.eq('preflop is skipped entirely', T.currentHand.board.length, 0);
}

process.exit(t.report());
