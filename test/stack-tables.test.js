// Per-player stack swing and which tables they play.
//
// Both are SESSION-scoped reads rather than lifetime ones, and that is the
// point: a lifetime stack low would just record the smallest table someone has
// ever sat at, which says nothing about anything.

const { load, runner } = require('./harness');

const t = runner('stack-tables');

// A seat whose stack element reports `amount`. readSeatStack takes the largest
// $ figure in the seat, because a seat renders stack and current bet together.
function seatWith(id, amount) {
  const moneyEl = { textContent: '$' + amount.toLocaleString('en-US') };
  return {
    tagName: 'DIV',
    id,
    className: 'opponent___q',
    classList: ['opponent___q'],
    textContent: '',
    querySelectorAll: (sel) => (/money_|potString_|detailsItem_/.test(sel) ? [moneyEl] : []),
    querySelector: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
}

function withSeats(seats) {
  const T = load();
  T.STORE = T.emptyStore();
  T._sandbox.document.querySelectorAll = (sel) => (/player-/.test(sel) ? seats : []);
  return T;
}

// --- Stack swing ------------------------------------------------------------

{
  const T = withSeats([]);
  T.lastSeenBB = 1000000;
  const doc = T._sandbox.document;

  const at = (amount) => {
    doc.querySelectorAll = (sel) => (/player-/.test(sel) ? [seatWith('player-999', amount)] : []);
    T.trackStacks();
  };

  at(200000000);
  t.eq('first sighting sets everything', T.STORE.players['999'].stack.now, 200000000);
  t.eq('low starts at the first reading', T.STORE.players['999'].stack.low, 200000000);
  t.eq('high starts there too', T.STORE.players['999'].stack.high, 200000000);

  at(320000000);
  t.eq('a rise moves the high', T.STORE.players['999'].stack.high, 320000000);
  t.eq('and leaves the low alone', T.STORE.players['999'].stack.low, 200000000);

  at(90000000);
  t.eq('a fall moves the low', T.STORE.players['999'].stack.low, 90000000);
  t.eq('and leaves the high alone', T.STORE.players['999'].stack.high, 320000000);
  t.eq('now tracks the latest', T.STORE.players['999'].stack.now, 90000000);

  // The swing is what makes it a read: 230bb off their high at a $1M blind.
  const sw = T.stackSwingBB(T.STORE.players['999']);
  t.near('down from the high, in bb', sw.downBB, 230);
  t.near('and the move from where they started', sw.upBB, -110);
}

{
  // Moving stakes starts a new sitting. A low of $40M means nothing carried
  // from a table where that was deep to one where it is four blinds.
  const T = withSeats([]);
  const doc = T._sandbox.document;
  const at = (amount, bb) => {
    T.lastSeenBB = bb;
    doc.querySelectorAll = (sel) => (/player-/.test(sel) ? [seatWith('player-999', amount)] : []);
    T.trackStacks();
  };

  at(40000000, 1000000);
  at(500000000, 2500000);
  const s = T.STORE.players['999'].stack;
  t.eq('a stake change resets the low', s.low, 500000000);
  t.eq('and the high', s.high, 500000000);
  t.eq('and records the new blind', s.bb, 2500000);
}

{
  // A gap longer than a session also starts fresh.
  const T = withSeats([]);
  T.lastSeenBB = 1000000;
  const doc = T._sandbox.document;
  doc.querySelectorAll = (sel) => (/player-/.test(sel) ? [seatWith('player-999', 40000000)] : []);
  T.trackStacks();

  const p = T.STORE.players['999'];
  p.stack.at = Date.now() - (5 * 60 * 60 * 1000); // 5h ago, past the session gap
  doc.querySelectorAll = (sel) => (/player-/.test(sel) ? [seatWith('player-999', 300000000)] : []);
  T.trackStacks();

  t.eq('a stale sitting is restarted', p.stack.low, 300000000);
}

{
  const T2 = load();
  t.eq('no stack data, no swing', T2.stackSwingBB(T2.emptyPlayer('x', 'X')), null);
}

// --- Being stuck reaches the exploit plan ----------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 20;
  const p = Object.assign(T.emptyPlayer('v', 'Stuck'), {
    hands: 300, vpip: 150, pfr: 40,
    stack: { now: 50000000, low: 50000000, high: 300000000, start: 200000000, bb: 1000000, at: Date.now() },
  });
  const entry = T.buildExploitPlan(p).find((e) => e.tag === 'Stuck');
  t.ok('being far off their high is called out', !!entry);
  t.ok('with the size of the hole', /250bb/.test(entry.text));
  t.ok('and what to do about it', /value bet/.test(entry.text));
}

{
  // A small dip is not a read.
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 20;
  const p = Object.assign(T.emptyPlayer('v', 'Fine'), {
    hands: 300, vpip: 150, pfr: 40,
    stack: { now: 195000000, low: 195000000, high: 200000000, start: 200000000, bb: 1000000, at: Date.now() },
  });
  t.eq('a 5bb dip is not called being stuck',
    T.buildExploitPlan(p).filter((e) => e.tag === 'Stuck').length, 0);
}

// --- Tables played ----------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = T.emptyPlayer('v', 'Regular');
  p.tables = { 2500000: 180, 1000000: 20 };

  const tabs = T.tablesPlayed(p);
  t.eq('busiest table first', tabs[0].name, "Cat's Chance");
  t.eq('with its share', Math.round(tabs[0].share), 90);
  t.eq('and the second', tabs[1].name, 'River Wizard');
  t.eq('hands are carried through', tabs[0].hands, 180);

  // Keyed by blind level, so an unknown stake still reports rather than
  // vanishing — Torn adds tables and the ladder will go stale.
  p.tables = { 7777777: 5 };
  t.ok('an unknown stake still names itself', T.tablesPlayed(p)[0].name.includes('BB'));
}

{
  const T3 = load();
  t.eq('a player seen at no table reports nothing', T3.tablesPlayed(T3.emptyPlayer('x', 'X')).length, 0);
}

// --- Tables are recorded at settlement -------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  const settle = (bb) => T.applyHandResults({
    gameId: null, street: 'preflop', pot: 3000000, bbAmount: bb,
    contributions: { H: 500000, V: 1000000 },
    dealtInXids: new Set(['H', 'V']),
    winners: [{ xid: 'V', amount: 1500000 }],
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'preflop' }], shown: {}, shownCards: {},
  });

  settle(2500000);
  settle(2500000);
  settle(1000000);

  t.eq('hands are tallied per stake', T.STORE.players.V.tables[2500000], 2);
  t.eq('across stakes', T.STORE.players.V.tables[1000000], 1);

  // An unreadable blind must not be recorded as a table.
  settle(0);
  t.eq('an unpriced hand adds no table', Object.keys(T.STORE.players.V.tables).length, 2);
}

// --- Recent tables ----------------------------------------------------------

// "Usually plays" is a lifetime share and says nothing about movement. Someone
// who has just come down two stakes is a different proposition from a regular,
// and only the recency row shows it.

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = T.emptyPlayer('v', 'Mover');

  T.noteRecentTable(p, 2500000);
  T.noteRecentTable(p, 2500000);
  T.noteRecentTable(p, 2500000);
  t.eq('consecutive hands at one table stay one entry', p.recentTables.length, 1);

  T.noteRecentTable(p, 1000000);
  t.eq('a move adds an entry', p.recentTables.length, 2);
  t.eq('newest first', p.recentTables[0].bb, 1000000);
  t.eq('and the previous table is behind it', p.recentTables[1].bb, 2500000);

  // Returning to a table already in the list is still a move, so it appears
  // again — the row records where they have BEEN, in order.
  T.noteRecentTable(p, 2500000);
  t.eq('returning is a new entry', p.recentTables[0].bb, 2500000);
  t.eq('three moves are kept', p.recentTables.length, 3);

  T.noteRecentTable(p, 500000);
  t.eq('the list is capped', p.recentTables.length, T.RECENT_TABLES_MAX);
  t.eq('and the oldest is dropped', p.recentTables[T.RECENT_TABLES_MAX - 1].bb, 1000000);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = T.emptyPlayer('v', 'Mover');
  T.noteRecentTable(p, 1000000);
  T.noteRecentTable(p, 2500000);

  const r = T.recentTablesOf(p);
  t.eq('resolved to names, newest first', r[0].name, "Cat's Chance");
  t.eq('with where they came from', r[1].name, 'River Wizard');
  t.eq('and a relative time', r[0].ago, 'now');

  // An implausible blind cannot become a table — see the BB display-mode guard.
  p.recentTables.unshift({ bb: 3, at: Date.now() });
  t.ok('an implausible blind is filtered out', !T.recentTablesOf(p).some((e) => e.bb === 3));
}

{
  const T = load();
  t.eq('never seen anywhere reports nothing', T.recentTablesOf(T.emptyPlayer('x', 'X')).length, 0);
  t.eq('a missing timestamp does not throw', T.shortAgo(0), '');
  t.eq('just now', T.shortAgo(Date.now()), 'now');
  t.eq('minutes', T.shortAgo(Date.now() - 5 * 60 * 1000), '5m');
  t.eq('hours', T.shortAgo(Date.now() - 3 * 3600 * 1000), '3h');
  t.eq('days', T.shortAgo(Date.now() - 2 * 86400 * 1000), '2d');
}

// Recorded through the real settlement path, not just the helper.
{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  const settle = (bb) => T.applyHandResults({
    gameId: null, street: 'preflop', pot: 3000000, bbAmount: bb,
    contributions: { H: 500000, V: 1000000 },
    dealtInXids: new Set(['H', 'V']),
    winners: [{ xid: 'V', amount: 1500000 }],
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'preflop' }], shown: {}, shownCards: {},
  });

  settle(2500000);
  settle(2500000);
  settle(1000000);

  const r = T.recentTablesOf(T.STORE.players.V);
  t.eq('settlement records the move', r.length, 2);
  t.eq('newest table first', r[0].name, 'River Wizard');
  t.eq('previous table behind it', r[1].name, "Cat's Chance");
}

// --- The stack bar ----------------------------------------------------------
//
// Three cash rows collapsed into one bar. The whole content of the read is
// where NOW sits between the low and the high, so that position has to be
// right, and the degenerate cases have to render something rather than NaN.

{
  const T = load();
  const pct = (html, cls) => {
    const m = new RegExp(`class="${cls}" style="(?:width|left):([\\d.]+)%`).exec(html);
    return m ? parseFloat(m[1]) : null;
  };

  const p = (stack) => ({ stack, hands: 0 });

  {
    const html = T.stackBarHtml(p({ now: 150, low: 100, high: 300, start: 200, bb: 10, at: 0 }));
    t.near('the fill ends a quarter along the low..high range', pct(html, 'tph-stackbar-fill'), 25);
    t.near('the now marker sits at the same point', pct(html, 'tph-stackbar-now'), 25);
    t.near('the start tick sits where they sat down', pct(html, 'tph-stackbar-start'), 50);
    t.ok('the low is labelled', /low \$100/.test(html));
    t.ok('the high is labelled', /high \$300/.test(html));
    t.ok('down from the high is called out', /off their high/.test(html));
    t.ok('and so is the move since sitting', /since sitting down/.test(html));
    t.ok('a loss since sitting is coloured as a loss', /tph-stack-down">−5bb since sitting/.test(html));
  }

  {
    // Just sat down: low === high, so the position of `now` in the range is
    // undefined. A full track is the honest rendering; NaN% is not.
    const html = T.stackBarHtml(p({ now: 200, low: 200, high: 200, start: 200, bb: 10, at: 0 }));
    t.eq('a player who has not swung yet gets a full track', pct(html, 'tph-stackbar-fill'), 100);
    t.ok('and no start tick, which would sit under the end cap', !/tph-stackbar-start/.test(html));
    t.ok('and no swing notes', !/off their high|since sitting/.test(html));
  }

  {
    const html = T.stackBarHtml(p({ now: 400, low: 100, high: 400, start: 100, bb: 10, at: 0 }));
    t.eq('at their high the fill is full', pct(html, 'tph-stackbar-fill'), 100);
    t.ok('no "off high" note when they are at it', !/off their high/.test(html));
    t.ok('up since sitting is coloured as a gain', /tph-stack-up">\+30bb/.test(html));
  }

  {
    // No blind level known: the bb conversions must drop out, not print NaN.
    const html = T.stackBarHtml(p({ now: 150, low: 100, high: 300, start: 200, bb: 0, at: 0 }));
    t.ok('renders without a blind level', /tph-stackbar/.test(html));
    t.ok('and prints no NaN', !/NaN/.test(html));
  }

  t.eq('no stack record renders nothing at all', T.stackBarHtml({ hands: 0, stack: null }), '');
  t.eq('nor does a null player', T.stackBarHtml(null), '');
}

process.exit(t.report());
