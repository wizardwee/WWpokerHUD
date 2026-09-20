// Every way the store can be loaded, exercised AT MODULE EVALUATION TIME.
//
// This file exists because of a shipped bug that took the entire HUD off the
// screen, and because the rest of the suite could not have caught it.
//
// `bootStore()` runs while the file is still evaluating. Anything the load path
// reaches must therefore be declared ABOVE it — a `const`/`let` below is still
// in its temporal dead zone, and reading one throws at module scope. In a
// userscript that is total: no gear, no badges, no HUD, no error anyone sees.
// CLAUDE.md documents this as the documented way to break this script at load.
//
// v1.72.0's reclaimLegacyBlob reached mergeHands -> trimHandHistory ->
// HISTORY_PINNED_CEILING, which was declared ~3,600 lines below bootStore().
// Every existing test passed, because `load()` seeds EMPTY storage: the
// sharded path never ran during evaluation, and tests that call loadStore()
// explicitly run afterwards, when every binding is already initialised. The
// seam masked it perfectly.
//
// So these tests assert one thing each: the script LOADS. The storage is
// arranged before evaluation so the boot takes a different path each time.

const { load, runner } = require('./harness');

const t = runner('boot-paths');

const KEY = 'tornPokerHUD_v1';

const blob = (extra) => JSON.stringify(Object.assign({
  version: 3,
  settings: { heroName: 'Wonkawee' },
  hero: { hands: 900, netChips: -5000, netBB: -50, bbHands: 900 },
  players: { a1: { xid: 'a1', name: 'Alpha', hands: 120 } },
  hands: [{ g: 'g1', t: 1, actions: [] }],
  plLedger: [{ t: 1, d: -3, b: 1, g: 'g1' }],
}, extra || {}));

const shards = (over) => Object.assign({
  [KEY + ':core']: JSON.stringify({ version: 3, settings: { heroName: 'Wonkawee' }, hero: { hands: 5, netChips: 0, netBB: 0, bbHands: 0 } }),
  [KEY + ':hands']: JSON.stringify([{ g: 's1', t: 9, actions: [] }]),
  [KEY + ':pl']: JSON.stringify([{ t: 9, d: 1, b: 1, g: 's1' }]),
  [KEY + ':p:b1']: JSON.stringify({ xid: 'b1', name: 'Bravo', hands: 40 }),
}, over || {});

function boots(name, opts, check) {
  let T = null;
  let threw = null;
  try { T = load(opts); } catch (e) { threw = e; }
  t.eq(name + ' — the script loads', threw ? `${threw.constructor.name}: ${threw.message}` : 'ok', 'ok');
  if (T && check) check(T);
  return T;
}

// --- 1. Fresh install --------------------------------------------------------

boots('fresh install', {}, (T) => {
  t.eq('starts empty', Object.keys(T.STORE.players).length, 0);
  t.ok('with default settings', !!T.STORE.settings);
});

// --- 2. Legacy blob only: the first-time migration ---------------------------

boots('legacy blob only', { storageSeed: blob() }, (T) => {
  t.eq('the blob is read', T.STORE.players.a1.hands, 120);
  t.ok('and held until a save lands', T.legacyBlobPending);
});

// --- 3. Shards only: the ordinary path ---------------------------------------

boots('sharded store', { seedKeys: shards() }, (T) => {
  t.eq('the shards are read', T.STORE.players.b1.hands, 40);
  t.ok('with no reclaim claimed', !T.STORE.lastReclaim);
});

// --- 4. Shards AND blob: the path that broke ---------------------------------
//
// The state v1.70.0's deadlock left on a real phone. This is the one that
// threw at module scope and took the HUD down.

boots('part-migrated: shards AND legacy blob', { storageSeed: blob(), seedKeys: shards() }, (T) => {
  t.eq('both sides are present', Object.keys(T.STORE.players).sort().join(','), 'a1,b1');
  t.ok('the recovery is recorded', !!T.STORE.lastReclaim);
  t.eq('hero comes from whichever has more hands', T.STORE.hero.hands, 900);
  t.eq('the ledger the shards were missing is restored', T.STORE.plLedger.length, 1);
});

// --- 5. Corrupt inputs must not throw at load either -------------------------

boots('corrupt legacy blob', { storageSeed: '{ not json', seedKeys: shards() });
boots('corrupt player shard', { seedKeys: shards({ [KEY + ':p:b1']: '{ nope' }) });
boots('corrupt core shard', { seedKeys: shards({ [KEY + ':core']: 'garbage' }) });
boots('corrupt everything', { storageSeed: 'xxx', seedKeys: { [KEY + ':core']: 'yyy', [KEY + ':p:z']: 'zzz' } });

// --- 6. The native backend boots too ----------------------------------------
//
// A different loader (loadStoreAsync), reached from the same bootStore(), so
// it can strand a binding in exactly the same way.

boots('native backend, empty', { pdaStorage: {
  loadAll: () => Promise.resolve({}), setMany: () => Promise.resolve(),
  get: () => Promise.resolve(), set: () => Promise.resolve(),
  delete: () => Promise.resolve(), list: () => Promise.resolve([]),
  getMany: () => Promise.resolve({}), usage: () => Promise.resolve({ used: 0, quota: 1 }),
} });

boots('native backend falling back to a legacy blob', {
  storageSeed: blob(),
  pdaStorage: {
    loadAll: () => Promise.resolve({}), setMany: () => Promise.resolve(),
    get: () => Promise.resolve(), set: () => Promise.resolve(),
    delete: () => Promise.resolve(), list: () => Promise.resolve([]),
    getMany: () => Promise.resolve({}), usage: () => Promise.resolve({ used: 0, quota: 1 }),
  },
});

process.exit(t.report());
