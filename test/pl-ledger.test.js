// The per-hand P/L ledger — see pushLedgerEntry / plLedgerExportCsv.
//
// Asked for directly: "I want the P/L ledger to persist past the hand history
// limit." STORE.hands keeps full per-hand detail (actions, board, players) for
// a few hundred hands because that detail is expensive; this keeps almost
// nothing per row (timestamp, delta, blind, game id) so it can outlive that
// window by roughly two orders of magnitude at the same storage cost.
//
// hero.netChips/netBB stay the permanent, exact lifetime total regardless of
// what has aged out of the ledger — the ledger is a BOUNDED AUDIT TRAIL
// layered on that number, not a replacement for it. That relationship is what
// most of this file pins.

const { load, runner } = require('./harness');

const t = runner('pl-ledger');

function fresh(heroXid) {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = heroXid;
  return T;
}

function hand(o) {
  return Object.assign({
    gameId: null,
    street: 'preflop',
    pot: 0,
    contributions: {},
    dealtInXids: new Set(),
    winners: [],
    actions: [{ x: 'x', a: 'fold', amt: 0, s: 'preflop' }],
    shown: {},
  }, o);
}

// --- pushLedgerEntry: shape and the cap ------------------------------------

{
  const T = fresh('HERO');
  T.pushLedgerEntry(1500000, 1000000, 'abc123');
  const row = T.STORE.plLedger[0];
  t.ok('a row was pushed', !!row);
  t.eq('the delta is stored', row.d, 1500000);
  t.eq('the blind level is stored', row.b, 1000000);
  t.eq('the game id is stored', row.g, 'abc123');
  t.ok('a timestamp is stamped', typeof row.t === 'number' && row.t > 0);
}

{
  const T = fresh('HERO');
  T.pushLedgerEntry(100, 0, null);
  const row = T.STORE.plLedger[0];
  t.eq('an unpriced hand stores blind 0, not undefined', row.b, 0);
  t.eq('no game id stores null, not undefined', row.g, null);
}

{
  // FIFO eviction, same shape as PRUNE_PLAYER_CAP/DEPARTED_MAX elsewhere —
  // the cap is what makes the ceiling unreachable.
  const T = fresh('HERO');
  const over = T.PL_LEDGER_CAP + 50;
  for (let i = 0; i < over; i++) T.pushLedgerEntry(i, 1000000, 'g' + i);
  t.eq('the ledger never exceeds the cap', T.STORE.plLedger.length, T.PL_LEDGER_CAP);
  t.eq('the oldest rows were evicted, not the newest',
    T.STORE.plLedger[T.STORE.plLedger.length - 1].d, over - 1);
  t.eq('eviction keeps the tail contiguous (oldest surviving row)',
    T.STORE.plLedger[0].d, over - T.PL_LEDGER_CAP);
}

// --- applyHandResults writes the SAME values it wrote to hero.netChips -----

{
  const T = fresh('HERO');
  const h = hand({
    gameId: 'g_settle1',
    dealtInXids: new Set(['HERO', 'V']),
    contributions: { HERO: 1000000, V: 2000000 },
    winners: [{ xid: 'V', amount: 3000000 }],
    bbAmount: 1000000,
  });
  T.applyHandResults(h);
  t.eq('one row was written', T.STORE.plLedger.length, 1);
  const row = T.STORE.plLedger[0];
  t.eq('the row\'s delta matches hero.netChips exactly', row.d, T.STORE.hero.netChips);
  t.eq('and it is the loss actually incurred', row.d, -1000000);
  t.eq('the blind level rides along', row.b, 1000000);
  t.eq('the game id rides along', row.g, 'g_settle1');
}

{
  // A hand hero was dealt into but with no readable blind: chips are still
  // recorded (same as hero.netChips), priced at 0 (same as hero.netBB not
  // incrementing) rather than guessing.
  const T = fresh('HERO');
  const h = hand({
    dealtInXids: new Set(['HERO', 'V']),
    contributions: { HERO: 500000 },
    winners: [{ xid: 'HERO', amount: 1000000 }],
    // no bbAmount, and lastSeenBB defaults unset — unpriced
  });
  T.applyHandResults(h);
  t.eq('the delta is still recorded', T.STORE.plLedger[0].d, 500000);
  t.eq('unpriced reads as blind 0, not a guess', T.STORE.plLedger[0].b, 0);
}

{
  // heroXid holding a name: pseudo-id nets to a harmless 0 in hero.netChips
  // (nothing in contributions/winners is keyed by a pseudo-id — see
  // pl-attribution.test.js). Tightened to !heroUnresolved() specifically for
  // the ledger, so an unresolved hero does not fill it with meaningless zero
  // rows.
  const T = fresh('name:Wonkawee');
  const h = hand({
    dealtInXids: new Set(['name:Wonkawee', 'V']),
    contributions: { 3722665: 500000, V: 1000000 },
    winners: [{ xid: 'V', amount: 1500000 }],
  });
  T.applyHandResults(h);
  t.eq('hero.netChips still no-ops to 0, unchanged from before this feature',
    T.STORE.hero.netChips, 0);
  t.eq('but no ledger row is written for an unresolved hero',
    T.STORE.plLedger.length, 0);
}

{
  // No winners recorded at all: the whole settlement block this hooks into is
  // skipped (existing behaviour, not something this feature changes) — so no
  // ledger row either. Consistent, not a new gap.
  const T = fresh('HERO');
  const h = hand({ dealtInXids: new Set(['HERO']), winners: [] });
  T.applyHandResults(h);
  t.eq('no winners means no ledger row either', T.STORE.plLedger.length, 0);
  t.eq('and hero.netChips is untouched too, same as before', T.STORE.hero.netChips, 0);
}

// --- resets clear the ledger, so it can never disagree with a zeroed total -

{
  const T = fresh('HERO');
  T.STORE.hero.netChips = 5000000;
  T.pushLedgerEntry(5000000, 1000000, 'g1');
  T.resetProfitLoss();
  t.eq('resetProfitLoss zeroes the ledger along with hero.netChips',
    T.STORE.plLedger.length, 0);
}

{
  const T = fresh('HERO');
  T.STORE.hero.netChips = 5000000;
  T.pushLedgerEntry(5000000, 1000000, 'g1');
  T.resetHeroStats();
  t.eq('resetHeroStats zeroes the ledger too — it is 100% hero data',
    T.STORE.plLedger.length, 0);
}

// --- mergeStores: local-only, same status as sessionHistory ----------------

{
  const T = fresh('HERO');
  T.STORE.plLedger = [{ t: 1, d: 100, b: 1000000, g: 'local' }];
  const remote = T.emptyStore();
  remote.plLedger = [{ t: 2, d: 200, b: 1000000, g: 'remote' }];
  remote.hero = { hands: 0, netChips: 0, netBB: 0, bbHands: 0 };
  const merged = T.mergeStores(T.STORE, remote);
  t.eq('the remote ledger is not merged in', merged.plLedger.length, 1);
  t.eq('the local ledger survives untouched', merged.plLedger[0].g, 'local');
}

// --- plLedgerExportCsv ------------------------------------------------------

{
  const T = fresh('HERO');
  const csv = T.plLedgerExportCsv();
  t.ok('an empty ledger still produces a header row', csv.indexOf('date,chips_delta') === 0);
  t.eq('and nothing else', csv.trim().split('\n').length, 1);
}

{
  const T = fresh('HERO');
  T.STORE.hero.netChips = 3000000; // the anchor this reconstructs FROM
  T.STORE.plLedger = [
    { t: 1000, d: 1000000, b: 1000000, g: 'g1' },
    { t: 2000, d: -2000000, b: 1000000, g: 'g2' },
    { t: 3000, d: 4000000, b: 1000000, g: null },
  ];
  const csv = T.plLedgerExportCsv();
  const lines = csv.trim().split('\n');
  t.eq('one header plus one row per entry', lines.length, 4);

  // The running total must reconstruct FROM hero.netChips backward, so the
  // LAST row lands exactly on the real lifetime total — the anchor is the
  // permanent figure; the ledger fills in the shape, not the other way round.
  const lastRow = lines[3].split(',');
  t.eq('the last row\'s running total equals hero.netChips exactly',
    Number(lastRow[3]), T.STORE.hero.netChips);

  // Row-by-row: starts at netChips - sum(present) = 3,000,000 - 3,000,000 = 0
  const rows = lines.slice(1).map((l) => l.split(','));
  t.eq('row 1 running total', Number(rows[0][3]), 1000000);
  t.eq('row 2 running total', Number(rows[1][3]), -1000000);
  t.eq('row 3 running total', Number(rows[2][3]), 3000000);

  t.eq('bb delta is derived from delta/blind', rows[0][2], '1.00');
  t.eq('a null game id renders as an empty field, not the string "null"', rows[2][5], '');
}

{
  // Some entries aged out of the ledger (evicted by the cap) but their chips
  // are still baked into hero.netChips. The starting point must fold that
  // history in rather than pretending the ledger's own sum IS the lifetime
  // total — that is exactly the case an evicted-but-real history creates.
  const T = fresh('HERO');
  T.STORE.hero.netChips = 10000000; // includes rows no longer present
  T.STORE.plLedger = [{ t: 1, d: 500000, b: 1000000, g: 'g_only_survivor' }];
  const csv = T.plLedgerExportCsv();
  const row = csv.trim().split('\n')[1].split(',');
  t.eq('the surviving row still lands on the real lifetime total', Number(row[3]), 10000000);
}

// --- Settings shows the row count and the cap, not a bare export button ----

{
  const T = fresh('HERO');
  t.ok('PL_LEDGER_CAP is a real, sane number', T.PL_LEDGER_CAP >= 1000);
}

// --- A hand hero merely WATCHED is not a hand hero played -------------------
//
// Reported from a live table: the deep scan printed STORE.hero as
// "17940 hands, bbHands 18584". bbHands exceeding hands is impossible by
// construction — hero.hands increments on heroDealtIn, and bbHands is supposed
// to be the subset of those that carried a readable blind.
//
// Cause: the whole block is gated on `heroXid` being set, not on hero being IN
// the hand. Everything financial nets to 0 for a spectator (nothing in
// contributions or wonByXid is keyed to them), so the MONEY was always right —
// but bbHands and the ledger are counts, and both were counting hands hero sat
// out. 644 of them: a pure denominator dragging bb/100 ~3.5% toward zero, and
// 644 zero rows evicting real ones from a FIFO ledger.

{
  const T = fresh('HERO');
  T.lastSeenBB = 1000000;
  T.applyHandResults(hand({
    gameId: 'watched', bbAmount: 1000000,
    contributions: { A: 10000000, B: 10000000 },
    dealtInXids: new Set(['A', 'B']),
    winners: [{ xid: 'A', amount: 20000000 }],
  }));

  t.eq('a hand hero was not in does not count toward hands', T.STORE.hero.hands, 0);
  t.eq('nor toward the bb/100 denominator', T.STORE.hero.bbHands, 0);
  t.eq('and files no ledger row', T.STORE.plLedger.length, 0);
  t.eq('the money is untouched either way', T.STORE.hero.netChips, 0);
}

{
  // The half that must NOT be lost: dealt in and folded preflop for nothing is
  // a real played hand. Money moved neither way, so a money-only test would
  // drop it from the denominator and overstate bb/100.
  const T = fresh('HERO');
  T.lastSeenBB = 1000000;
  T.applyHandResults(hand({
    gameId: 'folded', bbAmount: 1000000,
    contributions: { A: 10000000, B: 10000000 },
    dealtInXids: new Set(['HERO', 'A', 'B']),
    winners: [{ xid: 'A', amount: 20000000 }],
  }));

  t.eq('dealt in counts toward hands', T.STORE.hero.hands, 1);
  t.eq('and toward the denominator even at zero cost', T.STORE.hero.bbHands, 1);
  t.eq('and files its row', T.STORE.plLedger.length, 1);
}

{
  // The other half: money moved but dealtInXids never saw hero — a hand joined
  // mid-way. A dealt-in-only test would drop a hand hero actually paid for.
  const T = fresh('HERO');
  T.lastSeenBB = 1000000;
  T.applyHandResults(hand({
    gameId: 'joined', bbAmount: 1000000,
    contributions: { HERO: 5000000, A: 5000000 },
    dealtInXids: new Set(['A']),
    winners: [{ xid: 'A', amount: 10000000 }],
  }));

  t.eq('a hand hero paid into counts toward the denominator', T.STORE.hero.bbHands, 1);
  t.eq('and is filed', T.STORE.plLedger.length, 1);
  t.eq('with the real loss', (T.STORE.plLedger[0] || {}).d, -5000000);

  // This block used to stop at the line above, and that omission WAS the bug
  // that survived v1.71.0: hero.hands stayed on the narrow dealtInXids test
  // while bbHands moved to the wide one, so this exact hand produced bbHands 1
  // against hands 0 — the invariant asserted twelve lines further down,
  // violated by its own neighbour, because nothing here looked at hands.
  t.eq('and the SAME hand counts toward hero.hands', T.STORE.hero.hands, 1);
  t.ok('so bbHands does not exceed hands', T.STORE.hero.bbHands <= T.STORE.hero.hands);
}

{
  // The invariant the scan violated, stated directly.
  const T = fresh('HERO');
  T.lastSeenBB = 1000000;
  for (let i = 0; i < 12; i += 1) {
    const heroIn = i % 3 !== 0; // hero sits out a third of them
    T.applyHandResults(hand({
      gameId: 'g' + i, bbAmount: 1000000,
      contributions: heroIn ? { HERO: 1000000, A: 1000000 } : { A: 1000000, B: 1000000 },
      dealtInXids: new Set(heroIn ? ['HERO', 'A'] : ['A', 'B']),
      winners: [{ xid: 'A', amount: 2000000 }],
    }));
  }
  t.eq('hands counts only what hero was in', T.STORE.hero.hands, 8);
  t.ok('bbHands can never exceed hands', T.STORE.hero.bbHands <= T.STORE.hero.hands);
  t.eq('and here they agree exactly, every hand being priced', T.STORE.hero.bbHands, 8);
}

{
  // The same invariant over a MIXED field, which is what the live store
  // actually is: hero fully in, hero joined mid-way (money but no dealt-in
  // record), and hero not in the hand at all. The loop above cannot catch a
  // one-sided predicate because every hand in it is all-or-nothing on both
  // tests at once — the two only disagree on the middle case.
  const T = fresh('HERO');
  T.lastSeenBB = 1000000;
  let expected = 0;
  for (let i = 0; i < 15; i += 1) {
    const mode = i % 3; // 0 = fully in, 1 = joined mid-way, 2 = not in it
    if (mode !== 2) expected += 1;
    T.applyHandResults(hand({
      gameId: 'm' + i,
      bbAmount: 1000000,
      contributions: mode === 2 ? { A: 1000000, B: 1000000 } : { HERO: 1000000, A: 1000000 },
      dealtInXids: new Set(mode === 0 ? ['HERO', 'A'] : ['A', 'B']),
      winners: [{ xid: 'A', amount: 2000000 }],
    }));
  }
  t.eq('hands counts every hand hero took part in, however it was seen',
    T.STORE.hero.hands, expected);
  t.eq('and the priced denominator matches it exactly',
    T.STORE.hero.bbHands, expected);
  t.ok('bbHands never exceeds hands across a mixed field',
    T.STORE.hero.bbHands <= T.STORE.hero.hands);
  t.eq('the ledger files one row per hand hero took part in',
    T.STORE.plLedger.length, expected);
}

process.exit(t.report());
