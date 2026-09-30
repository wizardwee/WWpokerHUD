// Only what changed is written (v1.98.0).
//
// Two changes, one invariant each:
//
//   1. The 60s reconcile CHECKS every shard and writes only those whose
//      content differs from what is on disk. It used to rewrite ~3 MB every
//      minute, which on the native backend is ~3 MB across the PDA bridge —
//      the same traffic that froze scrolling in v1.76.0. The invariant it
//      must keep: a change nobody marked is still written by the reconcile.
//   2. Hands are a key each and the ledger is 500-row chunks, so settling a
//      hand writes one hand and one ledger chunk instead of ~0.5 MB + ~1.3 MB.
//      The invariant: the layout round-trips to the same store, and the old
//      single keys are read, then removed only after their replacement lands.
//
// Plus the bug found on the way: replaceStore listed persisted players from
// localStorage alone, so on the native backend "Reset all data" brought every
// player back on the next reload.

const { load, runner } = require('./harness');

const t = runner('store-delta');
const KEY = 'tornPokerHUD_v1';

const flush = (T) => { T.saveStore(); T._sandbox.runTimers(); };
const reconcileNow = (T) => { T.lastReconcileAt = 0; flush(T); };
const midInterval = (T) => { T.lastReconcileAt = Date.now(); };
const raw = (T, k) => T._sandbox.localStorage.getItem(k);
const keysUnder = (T, pre) => {
  const ls = T._sandbox.localStorage;
  const out = [];
  for (let i = 0; i < ls.length; i += 1) { const k = ls.key(i); if (k && k.indexOf(KEY + pre) === 0) out.push(k); }
  return out.sort();
};
function spyWrites(T) {
  const ls = T._sandbox.localStorage;
  const log = { set: [], removed: [] };
  const realSet = ls.setItem.bind(ls);
  const realRemove = ls.removeItem.bind(ls);
  ls.setItem = (k, v) => { log.set.push(k); return realSet(k, v); };
  ls.removeItem = (k) => { log.removed.push(k); return realRemove(k); };
  return log;
}
function seeded(players, hands, rows) {
  const T = load();
  T.STORE = T.emptyStore();
  for (let i = 0; i < players; i += 1) T.STORE.players['x' + i] = Object.assign(T.emptyPlayer('x' + i, 'P' + i), { hands: 10 });
  for (let i = 0; i < hands; i += 1) T.STORE.hands.unshift({ g: 'h' + i, t: 1000 + i, actions: [] });
  for (let i = 0; i < rows; i += 1) T.STORE.plLedger.push({ t: i, d: i, b: 1, g: 'r' + i });
  T.markAllDirty();
  reconcileNow(T);
  return T;
}

// --- 1. the reconcile checks, and writes only what changed -----------------

{
  const T = seeded(50, 20, 1200);
  const log = spyWrites(T);
  reconcileNow(T);
  t.eq('a reconcile over an unchanged store writes nothing', log.set.length, 0);
  t.ok('and says so', T.lastReconcileStats && T.lastReconcileStats.written === 0
    && T.lastReconcileStats.skipped > 70);

  // A change NOBODY marked — the case the reconcile exists for.
  T.STORE.players.x7.vpip = 99;
  midInterval(T);
  flush(T);
  t.ok('an unmarked change is not written between reconciles', log.set.indexOf(KEY + ':p:x7') === -1);
  reconcileNow(T);
  t.eq('the reconcile writes it — and only it', log.set.join(','), KEY + ':p:x7');
  t.eq('with the new value', JSON.parse(raw(T, KEY + ':p:x7')).vpip, 99);
}

{
  // A reload knows what is on disk, so its first save writes nothing either.
  // It used to be markAllDirty() and a full rewrite on every page load.
  const T = seeded(30, 5, 10);
  // Twice: the first load normalises a store written by a test fixture (it
  // adds hero.xid), and that normalisation is a real change to write once.
  T.STORE = T.emptyStore();
  T.loadStore();
  reconcileNow(T);
  T.STORE = T.emptyStore();
  T.loadStore();
  const log = spyWrites(T);
  reconcileNow(T);
  t.eq('the first save after a reload writes nothing when nothing changed', log.set.length, 0);
}

// --- 2. a hand is one key, and the ledger changes one chunk ----------------

{
  const T = seeded(3, 5, 1200);
  t.eq('each hand has its own key', keysUnder(T, ':h:').length, 5);
  t.eq('the ledger is chunked by LEDGER_CHUNK_ROWS', keysUnder(T, ':L:').length,
    Math.ceil(1200 / T.LEDGER_CHUNK_ROWS));

  const log = spyWrites(T);
  midInterval(T);
  T.STORE.hands.unshift({ g: 'new1', t: 5000, actions: [] });
  T.dirtyHands = true;
  T.pushLedgerEntry(10, 1, 'new1');
  flush(T);
  const handWrites = log.set.filter((k) => k.indexOf(KEY + ':h:') === 0);
  const ledgerWrites = log.set.filter((k) => k.indexOf(KEY + ':L:') === 0);
  t.eq('a new hand writes one hand key', handWrites.join(','), KEY + ':h:gnew1');
  t.eq('and one ledger chunk — the newest', ledgerWrites.join(','), KEY + ':L:2');

  log.set.length = 0;
  T.STORE.hands.pop(); // the oldest trimmed away
  T.dirtyHands = true;
  flush(T);
  t.eq('a trimmed hand is one removal', log.removed.filter((k) => k.indexOf(':h:') > 0).join(','), KEY + ':h:gh0');
  t.eq('and rewrites no other hand', log.set.filter((k) => k.indexOf(':h:') > 0).length, 0);
}

{
  // At the cap every row pushes one out at the front. Numbered by absolute
  // row, that changes the OLDEST and NEWEST chunks only — numbered by
  // position it would shift and rewrite every one.
  const T = seeded(1, 0, 0);
  const CAP = T.PL_LEDGER_CAP;
  for (let i = 0; i < CAP; i += 1) T.STORE.plLedger.push({ t: i, d: 1, b: 1, g: 'r' + i });
  T.dirtyPl = true;
  reconcileNow(T);
  const log = spyWrites(T);
  midInterval(T);
  T.pushLedgerEntry(1, 1, 'over');
  flush(T);
  const touched = log.set.concat(log.removed).filter((k) => k.indexOf(':L:') > 0);
  t.ok('an eviction at the cap touches at most two chunks', touched.length <= 2 && touched.length >= 1);
  t.eq('the ledger is still capped', T.STORE.plLedger.length, CAP);

  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('and reloads whole', back.plLedger.length, CAP);
  t.eq('in order, oldest evicted', back.plLedger[0].g + '..' + back.plLedger[CAP - 1].g, 'r1..over');
}

{
  // The chunk cache assumes ledger rows are never edited. If one ever is,
  // the reconcile must still catch it — it hashes every chunk rather than
  // trusting the cache, which is the whole reason the cache is safe to have.
  const T = seeded(1, 0, 1200);
  midInterval(T);
  T.pushLedgerEntry(1, 1, 'warm'); // primes the cache for every chunk
  flush(T);
  T.STORE.plLedger[3].d = 777; // edited in place, chunk 0, nobody marks it
  reconcileNow(T);
  const chunk0 = JSON.parse(raw(T, KEY + ':L:0'));
  t.eq('an in-place edit the cache cannot see is written by the reconcile', chunk0.r[3].d, 777);
}

{
  const T = seeded(2, 12, 1234);
  const before = JSON.stringify({ h: T.STORE.hands, l: T.STORE.plLedger });
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('hands and ledger round-trip exactly, order included',
    JSON.stringify({ h: back.hands, l: back.plLedger }), before);
}

{
  // Two hands with no game id and the same timestamp must not share a key.
  const T = load();
  const e = T.handShardEntries([{ t: 5 }, { t: 5 }, { g: 'ab' }, { g: 'ab' }]);
  t.eq('colliding hands get distinct keys', new Set(e.map((x) => x.key)).size, 4);
}

// --- the pre-v1.98.0 single keys -------------------------------------------

{
  const T = load({
    seedKeys: {
      [KEY + ':core']: JSON.stringify({ version: 3, settings: {} }),
      [KEY + ':hands']: JSON.stringify([{ g: 'o1', t: 2 }, { g: 'o2', t: 1 }]),
      [KEY + ':pl']: JSON.stringify([{ t: 1, d: 5, b: 1, g: 'o1' }]),
    },
  });
  t.eq('old-layout hands load', T.STORE.hands.map((h) => h.g).join(','), 'o1,o2');
  t.eq('old-layout ledger loads', T.STORE.plLedger.length, 1);
  t.ok('and the old keys are pending removal', T.legacySectionsPending);
  flush(T);
  t.ok('after a save the new keys hold them', !!raw(T, KEY + ':h:go1') && !!raw(T, KEY + ':L:0'));
  t.ok('and only then are the old keys removed', raw(T, KEY + ':hands') === null && raw(T, KEY + ':pl') === null);
  t.ok('no longer pending', !T.legacySectionsPending);
}

{
  // Both layouts at once — an interrupted migration. Union, never loss.
  const T = load({
    seedKeys: {
      [KEY + ':core']: JSON.stringify({ version: 3, settings: {} }),
      [KEY + ':hands']: JSON.stringify([{ g: 'o1', t: 2 }, { g: 'o2', t: 1 }]),
      [KEY + ':h:gn1']: JSON.stringify({ g: 'n1', t: 3 }),
      [KEY + ':h:go1']: JSON.stringify({ g: 'o1', t: 2, fav: true }),
      [KEY + ':pl']: JSON.stringify([{ t: 1, d: 5, b: 1, g: 'a' }, { t: 2, d: 6, b: 1, g: 'b' }]),
      [KEY + ':L:0']: JSON.stringify({ s: 0, r: [{ t: 1, d: 5, b: 1, g: 'a' }] }),
    },
  });
  t.eq('hands are the union, newest first', T.STORE.hands.map((h) => h.g).join(','), 'n1,o1,o2');
  t.ok('the new copy wins a hand both hold', T.STORE.hands[1].fav === true);
  t.eq('the ledger takes the side with more rows', T.STORE.plLedger.length, 2);
}

{
  // A refused write must not cost the old keys: they are the only copy of
  // whatever did not land. Every new-layout write is refused here.
  const T = load({
    seedKeys: {
      [KEY + ':core']: JSON.stringify({ version: 3, settings: {} }),
      [KEY + ':hands']: JSON.stringify([{ g: 'o1', t: 2 }]),
    },
  });
  const ls = T._sandbox.localStorage;
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k, v) => {
    if (k.indexOf(':h:') > 0) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return realSet(k, v);
  };
  T.saveStore();
  T._sandbox.runTimers();
  t.eq('the hand never reached a new key', raw(T, KEY + ':h:go1'), null);
  t.eq('so it is still in memory', T.STORE.hands.length, 1);
  t.ok('and the hands section is marked to retry', T.dirtyHands);
}

// --- the native backend ----------------------------------------------------

// A stand-in for PDA_storage's documented contract, as in
// pda-storage-backend.test.js. `hold` parks setMany calls so a test can act
// while a write is in flight.
function fakeNative() {
  const map = new Map();
  const api = {
    _map: map, calls: 0, held: [], hold: false,
    loadAll: () => Promise.resolve(Object.fromEntries(map)),
    setMany: (o) => {
      api.calls += 1;
      const apply = () => Object.keys(o).forEach((k) => map.set(k, JSON.parse(JSON.stringify(o[k]))));
      if (api.hold) return new Promise((res) => api.held.push(() => { apply(); res(); }));
      apply();
      return Promise.resolve();
    },
    delete: (k) => { map.delete(k); return Promise.resolve(); },
    usage: () => Promise.resolve({ used: 1, quota: 10 * 1024 * 1024 }),
    get: () => Promise.resolve(null), getMany: () => Promise.resolve({}), list: () => Promise.resolve([]),
    set: (k, v) => { map.set(k, v); return Promise.resolve(); },
  };
  return api;
}

(async () => {
  {
    const pda = fakeNative();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    T.getPlayer('555').vpip = 3;
    T.getPlayer('666').vpip = 4;
    T.markAllDirty();
    await T.flushShardsAsync(true);
    t.ok('both players are on the native store', pda._map.has(KEY + ':p:555') && pda._map.has(KEY + ':p:666'));

    T.replaceStore(T.emptyStore()); // what "Reset all data" does
    await T.flushShardsAsync();
    const T2 = load({ pdaStorage: pda });
    await T2.storeReady;
    t.eq('Reset on the native backend does not bring players back on reload',
      Object.keys(T2.STORE.players).length, 0);
  }

  {
    const pda = fakeNative();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    for (let i = 0; i < 200; i += 1) T.getPlayer('p' + i).hands = 5;
    for (let i = 0; i < 30; i += 1) T.pushLedgerEntry(i, 1, 'g' + i);
    T.markAllDirty();
    await T.flushShardsAsync(true);
    const before = pda.calls;
    await T.flushShardsAsync(true);
    t.eq('a reconcile over an unchanged store makes no bridge call at all', pda.calls - before, 0);

    const T2 = load({ pdaStorage: pda });
    await T2.storeReady;
    const b2 = pda.calls;
    await T2.flushShardsAsync(true);
    t.ok('nor does the first reconcile after a reload (beyond load normalisation)', pda.calls - b2 <= 1);
  }

  {
    // A hand recorded WHILE a write is in flight. Marks used to be cleared
    // when the write landed, which wiped a mark set in the meantime; the
    // follow-up pass then skipped the hand until the next reconcile.
    const pda = fakeNative();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    T.markAllDirty();
    await T.flushShardsAsync(true);
    T.lastReconcileAt = Date.now();

    pda.hold = true;
    T.getPlayer('a1').vpip = 1;
    const first = T.flushShardsAsync();
    T.STORE.hands.unshift({ g: 'mid', t: 9, actions: [] });
    T.dirtyHands = true;
    T.flushShardsAsync(); // coalesced into a follow-up
    pda.hold = false;
    pda.held.splice(0).forEach((go) => go());
    await first;
    await new Promise((r) => setTimeout(r, 0));
    t.ok('a hand recorded during an in-flight write is written by the follow-up',
      pda._map.has(KEY + ':h:gmid'));
  }

  process.exit(t.report());
})();
