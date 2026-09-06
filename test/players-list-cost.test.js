// The players list: what it computes per render, and what it shows.
//
// This exists because the list was the most expensive thing in the HUD and the
// cost was invisible — no error, no warning, just a panel that took a beat to
// open and typing that lagged behind the keyboard. Measured against a real
// 898-player export: 38-46ms in the SORT alone, against 12ms to compute and
// render every row it was sorting.
//
// Two mechanisms, and they need different kinds of proof:
//
//   1. playersSortValue ran computeRates on line one, for every column. Proved
//      here with a record computeRates cannot survive: if sorting by name
//      still touches the rates, the call throws. That drives the REAL
//      function rather than counting calls on a copy of it, which is the
//      v1.0.1 lesson.
//   2. renderPlayersList evaluated that comparator inside every comparison
//      (16.2 times per player) instead of once per player. The refactor rests
//      entirely on decorate-once producing the SAME order, so that equivalence
//      is what gets pinned — driven through the real comparator, over the real
//      compare logic the render uses.
//
// renderPlayersList itself needs a DOM the harness deliberately refuses to
// fake, so the markup and the toggle's wiring are not covered here — same
// boundary test/players-sort.test.js already draws.

const { load, runner } = require('./harness');

const t = runner('players-list-cost');

function mk(T, xid, o) {
  return (T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o));
}

// --- the comparator only computes what its column needs --------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  // A probe, not a claim that records look like this in the wild: computeRates
  // reads p.streetActions[street] unguarded, so a record without it throws.
  // That makes it a precise detector for "did this code path compute rates?"
  const probe = mk(T, 'a', { name: 'zebra', hands: 40, plChipsEst: -1 });
  delete probe.streetActions;

  let threw = false;
  try { T.computeRates(probe); } catch (e) { threw = true; }
  t.eq('the probe really does make computeRates throw', threw, true);

  const survives = (key) => {
    try { T.playersSortValue(key, 'a', probe); return true; } catch (e) { return false; }
  };
  t.ok('sorting by name does not compute rates', survives('name'));
  t.ok('sorting by hands does not compute rates', survives('hands'));
  t.ok('sorting by P/L does not compute rates', survives('pl'));

  // And the column that genuinely needs them still asks for them — otherwise
  // the assertions above would pass on a comparator that had stopped working.
  t.eq('the VPIP column still reads the rates', survives('vpip'), false);
}

// --- decorate-once sorts identically to compare-time evaluation ------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  mk(T, 'hero1', { name: 'Wonkawee', hands: 900, vpip: 300, pfr: 120, plChipsEst: 5 });
  // Names, hand counts and rates deliberately collide in places: a comparator
  // that is only correct on distinct keys is not correct.
  const spec = [
    ['a', 'Apple',  120, 60, 20, -5000],
    ['b', 'apple',  120, 30, 10,  5000],
    ['c', 'Zebra',   10,  5,  1,     0],
    ['d', 'mango',  400, 90, 45, -1000],
    ['e', 'Mango',    0,  0,  0,  9999],
    ['f', 'kiwi',    35, 17,  4, -5000],
  ];
  spec.forEach(([x, name, hands, vpip, pfr, pl]) =>
    mk(T, x, { name, hands, vpip, pfr, plChipsEst: pl }));

  const entries = Object.keys(T.STORE.players).map((xid) => ({ xid, p: T.STORE.players[xid] }));
  const cmpOf = (av, bv) => (typeof av === 'string' || typeof bv === 'string')
    ? String(av).localeCompare(String(bv)) : av - bv;

  // The shape renderPlayersList used to have.
  const compareTime = (key, dir) => entries.slice().sort((a, b) => {
    const c = cmpOf(T.playersSortValue(key, a.xid, a.p), T.playersSortValue(key, b.xid, b.p));
    return dir === 'asc' ? c : -c;
  }).map((e) => e.xid).join(',');

  // The shape it has now.
  const decorated = (key, dir) => entries
    .map((e) => ({ e, k: T.playersSortValue(key, e.xid, e.p) }))
    .sort((a, b) => { const c = cmpOf(a.k, b.k); return dir === 'asc' ? c : -c; })
    .map((d) => d.e.xid).join(',');

  let counted = 0;
  ['name', 'type', 'hands', 'vpip', 'pl'].forEach((key) => {
    ['asc', 'desc'].forEach((dir) => {
      counted++;
      t.eq(`${key}/${dir} sorts identically decorated`, decorated(key, dir), compareTime(key, dir));
    });
  });
  t.eq('and every column was actually compared', counted, 10);
}

// --- the thin-record gate --------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 20;
  T.heroXid = 'hero1';

  const hero = mk(T, 'hero1', { name: 'Wonkawee', hands: 3 });
  const thin = mk(T, 'a', { name: 'Stranger', hands: 19 });
  const atBar = mk(T, 'b', { name: 'Regular', hands: 20 });
  const deep = mk(T, 'c', { name: 'Reg2', hands: 400 });

  t.eq('under minHands is thin', T.playersRowIsThin('a', thin), true);
  t.eq('exactly at minHands is not', T.playersRowIsThin('b', atBar), false);
  t.eq('well above is not', T.playersRowIsThin('c', deep), false);

  // Hero's record is the one the coach reads, and after a long gap it is also
  // the one that looks most hideable — the same exemption it already carries
  // through every prune rule.
  t.eq('hero is never thin, however few hands', T.playersRowIsThin('hero1', hero), false);

  // The gate follows the setting rather than a number of its own, so it can
  // never disagree with the bar classify() uses to return "Unrated" — which is
  // the entire justification for hiding these rows.
  T.STORE.settings.minHands = 5;
  t.eq('the gate tracks minHands, not a constant', T.playersRowIsThin('a', thin), false);
  t.eq('and classify agrees at that bar', T.classify(thin) !== 'Unrated', true);

  T.STORE.settings.minHands = 500;
  t.eq('raising the bar hides more', T.playersRowIsThin('c', deep), true);
  t.eq('and classify agrees there too', T.classify(deep), 'Unrated');
}

// --- the toggle is off by default -------------------------------------------

{
  const T = load();
  t.eq('thin records are folded away until asked for', T.playersShowThin, false);
}

process.exit(t.report());
