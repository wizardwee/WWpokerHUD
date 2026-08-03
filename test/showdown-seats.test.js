// Reading showdowns off the SEATS rather than the log.
//
// Why this exists: revealed hands were plainly visible on the table while the
// Range tab and the History tab both stayed empty. The log path had been fixed
// twice by then, which was the clue — the log carries no reliable "reveals"
// line on this layout, so the seat flip is the only evidence there is.
//
// The DOM here is hand-built rather than using the harness's class-matching
// document, because this needs nested descendant selectors that the minimal
// stub deliberately refuses to guess at.

const { load, runner } = require('./harness');

const t = runner('showdown-seats');

// A card element as Torn renders one: an aria-labelled img inside a "front_"
// wrapper. parseCardEl reads either the class or the label.
function cardEl(label, faceDown) {
  return {
    tagName: 'DIV',
    className: 'fourColors___x cardSize___y',
    getAttribute: (k) => (k === 'aria-label' ? (faceDown ? 'card face down' : label) : null),
  };
}

function seatEl(id, cards) {
  const el = {
    tagName: 'DIV',
    id,
    className: 'opponent___q default___f',
    classList: ['opponent___q', 'default___f'],
    textContent: '',
    querySelectorAll: (sel) => (/front_/.test(sel) ? cards.filter((c) => !c.__down) : []),
    querySelector: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
  return el;
}

function withSeats(seats) {
  const T = load();
  T.STORE = T.emptyStore();
  const doc = T._sandbox.document;
  doc.querySelectorAll = (sel) => (/player-/.test(sel) ? seats : []);
  doc.querySelector = () => null;
  return T;
}

const up = (label) => cardEl(label, false);
const down = () => { const c = cardEl('x', true); c.__down = true; return c; };

// --- Reading a seat ---------------------------------------------------------

{
  const T = withSeats([]);
  const seat = seatEl('player-999', [up('9 of hearts'), up('7 of spades')]);
  const cards = T.readSeatFaceUpCards(seat);
  t.eq('two face-up cards are read', cards.length, 2);
  t.eq('and form the right class', T.handClassFromCards(cards), '97o');
}

{
  const T = withSeats([]);
  // Face-down cards are excluded by the selector, so a seat still in the hand
  // reads as nothing rather than as a partial hand.
  const seat = seatEl('player-999', [down(), down()]);
  t.eq('face-down cards are not a showdown', T.readSeatFaceUpCards(seat).length, 0);
}

{
  const T = withSeats([]);
  const seat = seatEl('player-999', [up('ace of spades')]);
  t.eq('a single card is not a hand', T.readSeatFaceUpCards(seat).length, 1);
}

// --- Harvesting into the live hand -----------------------------------------

{
  const villain = seatEl('player-999', [up('9 of hearts'), up('7 of spades')]);
  const T = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();

  T.harvestShownCards();

  t.eq('the villain\'s hand is captured', !!T.currentHand.shownCards['999'], true);
  t.eq('as the right class', T.handClassFromCards(T.currentHand.shownCards['999']), '97o');
  // History reads `shown`, which only ever held log text — which is why the
  // History tab was blank too.
  t.ok('and mirrored for the History tab', !!T.currentHand.shown['999']);
  t.eq('WTSD is credited', T.STORE.players['999'].wtsd, 1);

  // Idempotent: the poll runs every second while the cards sit face up.
  T.harvestShownCards();
  T.harvestShownCards();
  t.eq('repeated polls do not double-count WTSD', T.STORE.players['999'].wtsd, 1);
  t.eq('and do not duplicate the capture', Object.keys(T.currentHand.shownCards).length, 1);
}

// Hero's own cards are face up for the whole hand, so they must never be
// harvested as a showdown.
{
  const me = seatEl('player-311421', [up('ace of spades'), up('king of clubs')]);
  const T = withSeats([me]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();

  T.harvestShownCards();
  t.eq('hero is never captured as a showdown', Object.keys(T.currentHand.shownCards).length, 0);
  t.eq('and gets no WTSD from it', (T.STORE.players['311421'] || {}).wtsd || 0, 0);
}

// No live hand: nothing to record onto, and it must not throw.
{
  const villain = seatEl('player-999', [up('9 of hearts'), up('7 of spades')]);
  const T = withSeats([villain]);
  T.currentHand = null;
  let threw = false;
  try { T.harvestShownCards(); } catch (e) { threw = true; }
  t.ok('no live hand does not throw', !threw);
}

// --- The captured hand reaches the range at settlement ---------------------

{
  const villain = seatEl('player-999', [up('ace of clubs'), up('king of diamonds')]);
  const T = withSeats([villain]);
  T.heroXid = '311421';
  T.currentHand = T.freshHandState();
  T.harvestShownCards();

  const hand = T.currentHand;
  hand.dealtInXids = new Set(['311421', '999']);
  hand.contributions = { 311421: 1000000, 999: 1000000 };
  hand.winners = [{ xid: '999', amount: 2000000 }];
  hand.pot = 2000000;
  hand.actions = [{ x: '999', a: 'call', amt: 0, s: 'preflop' }];
  T.applyHandResults(hand);

  const p = T.STORE.players['999'];
  t.eq('the showdown is banked to the range', p.shownHands.AKo.seen, 1);
  t.eq('and scored as a win', p.shownHands.AKo.won, 1);
  t.eq('the hand history keeps the reveal', (T.STORE.hands[0].shown || {})['999'] !== undefined, true);
}

process.exit(t.report());
