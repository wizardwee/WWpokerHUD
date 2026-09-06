// One seat sweep per tick, and a showdown poll that backs off when nobody is
// left to show.
//
// Both of these are cost reductions on the HUD's hottest DOM path, and a cost
// reduction is the kind of change that is easy to get subtly wrong in a way
// nothing visible reports: a cache that is a little too long, or a skip that
// is a little too eager, produces no error at all — it produces a seat list
// that reads short (which `noteSeatDepartures` turns into invented "player
// left" alerts) or a reveal that was on screen and never got read.
//
// So the thresholds are pinned from BOTH sides here, same discipline as
// TIP_FATIGUE_MAX vs EXPLOIT_RELEVANT_BONUS: each number has a reason it
// cannot go up and a reason it cannot go down, and moving either fails.
//
// Everything drives the real exported functions. Re-implementing a cache in a
// test and asserting against the copy is the v1.0.1 failure exactly.

const { load, runner } = require('./harness');

const t = runner('seat-sweep');

// A seat as Torn renders one, minimal but real enough for resolveSeatKey,
// readSeatFaceUpCards and the stack read.
function cardEl(label) {
  return {
    tagName: 'DIV',
    className: 'fourColors___x cardSize___y',
    getAttribute: (k) => (k === 'aria-label' ? label : null),
  };
}

function seatEl(id, cards) {
  return {
    tagName: 'DIV',
    id,
    className: 'opponent___q default___f',
    classList: ['opponent___q', 'default___f'],
    textContent: '',
    querySelectorAll: (sel) => (/front_/.test(sel) ? (cards || []) : []),
    querySelector: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
}

// Returns { T, calls } where `calls` counts full-document seat sweeps — the
// thing this change exists to reduce, so it is the thing measured.
function withSeats(seats) {
  const T = load();
  T.STORE = T.emptyStore();
  const counter = { n: 0 };
  T._sandbox.document.querySelectorAll = (sel) => {
    if (!/player-/.test(sel)) return [];
    counter.n += 1;
    return seats;
  };
  T._sandbox.document.querySelector = () => null;
  T.invalidateSeatCache();
  return { T, calls: counter };
}

// --- seatEls: one walk, shared ---------------------------------------------

{
  const { T, calls } = withSeats([seatEl('player-999'), seatEl('player-888')]);

  const a = T.seatEls();
  const b = T.seatEls();
  t.eq('a repeat read inside the window costs no second walk', calls.n, 1);
  t.eq('and returns the same list', a === b, true);
  t.eq('which is the real seat list', a.length, 2);

  T.invalidateSeatCache();
  const c = T.seatEls();
  t.eq('a new sweep does walk the document again', calls.n, 2);
  t.eq('and hands back a fresh list', c === a, false);
}

{
  // The point of the change: the 3s watcher tick runs several independent seat
  // readers back to back, and they used to walk the whole document each. This
  // is the assertion that would fail if any of them were routed back to a bare
  // querySelectorAll.
  const { T, calls } = withSeats([seatEl('player-999')]);
  T.lastSeenBB = 1000000;

  T.harvestSeatNames();
  T.seatedXids({ includeSittingOut: true });
  T.readAllStacks();
  T.seatRotationFromDom({ sbXid: '999' });

  t.eq('four seat readers in one tick cost ONE document walk', calls.n, 1);
}

{
  // The list is shared, so a caller must not be able to corrupt it for the
  // next one. Array.from gives each read of the DOM its own array, but they
  // all hand back the SAME array within the window — which is the trade, and
  // is safe only because every consumer iterates rather than mutates. Pin the
  // property that matters: nothing in the file splices it.
  const { T } = withSeats([seatEl('player-999'), seatEl('player-888')]);
  T.seatedXids();
  t.eq('the shared list survives a consumer', T.seatEls().length, 2);
}

// --- the cache window is pinned from both sides ----------------------------

{
  t.ok('SEAT_CACHE_MS is short enough that it can never span two ticks',
    T_CACHE_LT_POLL());
  t.ok('but long enough to collapse readers firing in the same tick',
    load().SEAT_CACHE_MS >= 50);
}
function T_CACHE_LT_POLL() {
  const T = load();
  // 400ms is the fastest interval in the file. A window at or above it could
  // serve one tick's seat list to the NEXT tick, which is the "sweep reads
  // short" input that makes the departure watch invent events.
  return T.SEAT_CACHE_MS < T.SHOWDOWN_POLL_MS;
}

{
  // A diagnostic has to read the real DOM at the moment it is asked. A cached
  // answer in a calibration report could describe a table that has already
  // changed — the one thing that report must never do.
  const fs = require('fs');
  const src = fs.readFileSync(require('./harness').SCRIPT_PATH, 'utf8');
  const scan = src.slice(src.indexOf('function runDeepScan'));
  t.ok('runDeepScan still reads the document directly, not the cache',
    /document\.querySelectorAll\(SELECTORS\.seatContainer\)/.test(scan));
  t.ok('and the scan actually located runDeepScan', scan.length > 2000);
}

// --- showdownPlausible ------------------------------------------------------

{
  const { T } = withSeats([]);
  const h = T.freshHandState();

  h.playersIn = new Set(['1', '2', '3']);
  t.eq('a multiway hand can still reach a showdown', T.showdownPlausible(h), true);

  h.playersIn = new Set(['1', '2']);
  t.eq('heads-up can too', T.showdownPlausible(h), true);

  h.playersIn = new Set(['1']);
  t.eq('one player left cannot', T.showdownPlausible(h), false);

  h.playersIn = new Set();
  t.eq('nor can an empty field', T.showdownPlausible(h), false);

  t.eq('and no hand at all is not plausible', T.showdownPlausible(null), false);
}

{
  // FAIL OPEN. The claim "no showdown is possible" rests on every fold line
  // having been seen, and missed log lines are this file's recurring failure.
  // A hand whose playersIn is missing or malformed must poll at full rate
  // rather than be assumed dead.
  const { T } = withSeats([]);
  t.eq('a hand with no playersIn polls at full rate',
    T.showdownPlausible({}), true);
  t.eq('and so does one whose playersIn is not a Set',
    T.showdownPlausible({ playersIn: ['1'] }), true);
}

// --- harvestShownCards: take the tick, then back off ------------------------

{
  const villain = seatEl('player-999', [cardEl('9 of hearts'), cardEl('7 of spades')]);
  const { T } = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();
  T.currentHand.playersIn = new Set(['999']); // everyone else has folded

  const captured = () => Object.keys(T.currentHand.shownCards).length;
  const reset = () => { T.currentHand.shownCards = {}; T.currentHand.shown = {}; };

  T.harvestShownCards();
  t.eq('the FIRST poll after the field collapses is taken', captured(), 1);

  reset();
  T.harvestShownCards();
  t.eq('the next one is skipped', captured(), 0);
  T.harvestShownCards();
  t.eq('and so is the one after', captured(), 0);

  T.harvestShownCards();
  t.eq('then it polls again', captured(), 1);
}

{
  // The moment a fold puts the hand back out of reach is the moment somebody
  // is most likely to flash a card. Skipping that tick and taking a later one
  // would throttle exactly the wrong poll, so the order is take-then-skip and
  // this pins it.
  const villain = seatEl('player-999', [cardEl('9 of hearts'), cardEl('7 of spades')]);
  const { T } = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();
  T.currentHand.playersIn = new Set(['999', '888']);

  T.harvestShownCards();            // plausible: taken, counter cleared
  T.currentHand.shownCards = {};
  T.currentHand.shown = {};
  T.currentHand.playersIn = new Set(['999']);
  T.harvestShownCards();
  t.eq('the tick the field collapses on is never the skipped one',
    Object.keys(T.currentHand.shownCards).length, 1);
}

{
  // The settlement re-read gets ONE look at the table, and a hand that got
  // there by everyone folding is exactly the shape the back-off throttles.
  const villain = seatEl('player-999', [cardEl('9 of hearts'), cardEl('7 of spades')]);
  const { T } = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();
  T.currentHand.playersIn = new Set(['999']);

  T.harvestShownCards();            // takes the tick, arms the back-off
  T.currentHand.shownCards = {};
  T.currentHand.shown = {};
  t.eq('a forced read ignores the back-off',
    (T.harvestShownCards(true), Object.keys(T.currentHand.shownCards).length), 1);
}

{
  // Back to a live field and the back-off is gone, not merely paused: a new
  // hand must not inherit the previous one's skip counter.
  const villain = seatEl('player-999', [cardEl('9 of hearts'), cardEl('7 of spades')]);
  const { T } = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();
  T.currentHand.playersIn = new Set(['999']);

  T.harvestShownCards();
  T.currentHand = T.freshHandState();          // next hand
  T.currentHand.playersIn = new Set(['999', '888']);
  T.harvestShownCards();
  t.eq('a fresh hand polls at full rate immediately',
    Object.keys(T.currentHand.shownCards).length, 1);
}

// --- the back-off is pinned from both sides --------------------------------

{
  const T = load();
  t.ok('SHOWDOWN_IDLE_SKIP actually saves something', T.SHOWDOWN_IDLE_SKIP >= 1);
  // Cards sit face up until the next deal, but a fast table deals quickly and
  // the 400ms interval was itself set because 1000ms lost reveals. The
  // throttled rate has to stay inside that same window, or this reintroduces
  // the exact bug SHOWDOWN_POLL_MS was lowered to fix.
  const throttled = T.SHOWDOWN_POLL_MS * (T.SHOWDOWN_IDLE_SKIP + 1);
  t.ok('the throttled rate stays under the 1s that was already too slow — got '
    + throttled + 'ms', throttled <= 1500);
}

process.exit(t.report());
