// The players-list table's sortable column headers — playersSortValue is the
// per-column comparator input; renderPlayersList's own sort/click wiring
// isn't exercised here (needs a real DOM), same boundary every other UI-only
// piece in this file draws.

const { load, runner } = require('./harness');

const t = runner('players-sort');

function mk(T, xid, o) {
  return (T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o));
}

{
  const T = load();
  T.STORE = T.emptyStore();
  mk(T, 'a', { name: 'zebra', hands: 10 });
  mk(T, 'b', { name: 'Apple', hands: 200 });

  t.eq('name sorts case-insensitively', T.playersSortValue('name', 'a', T.STORE.players.a), 'zebra');
  t.eq('and lowercases mixed-case names for comparison',
    T.playersSortValue('name', 'b', T.STORE.players.b), 'apple');
  t.eq('hands is the raw count', T.playersSortValue('hands', 'b', T.STORE.players.b), 200);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, 'a', { hands: 50, vpip: 25 }); // 50% VPIP
  t.eq('vpip sorts on the computed rate, not the raw count',
    T.playersSortValue('vpip', 'a', p), 50);

  const untested = mk(T, 'b', { hands: 0 });
  t.eq('a player with zero hands has no VPIP rate — sorts as -Infinity, not 0',
    T.playersSortValue('vpip', 'b', untested), -Infinity);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, 'a', { plChipsEst: -5000000 });
  t.eq('pl sorts on the chip estimate', T.playersSortValue('pl', 'a', p), -5000000);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  const hero = mk(T, 'hero1', { plChipsEst: 999999999 }); // would sort first if not excluded
  t.eq('hero\'s P/L sorts as -Infinity regardless of any plChipsEst value on the record',
    T.playersSortValue('pl', 'hero1', hero), -Infinity);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, 'a', { hands: 50 }); // unrated below minHands
  t.eq('type sorts on the archetype label', T.playersSortValue('type', 'a', p), T.classify(p));
}

process.exit(t.report());
