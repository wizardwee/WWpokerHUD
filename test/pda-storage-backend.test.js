// The PDA_storage backend.
//
// Torn PDA's native store is 10 MB per script, user-raisable, in its own
// namespace and not wiped by clearing the app's browser cache — against a
// ~5 MB localStorage budget shared with torn.com itself and evictable under
// memory pressure. A near-full store here measures 2.9 MB, so that ceiling is
// not theoretical.
//
// Nobody working on this repo can run the app, so every test below drives a
// stand-in that implements the documented contract. That proves the code does
// the right thing GIVEN the documented API; whether the API behaves as
// documented on the device is what test/pda-storage-probe.test.js's scan output
// is for. Stated plainly rather than implied — this file is not a substitute
// for a report back.
//
// The invariants that matter are the destructive ones:
//
//   - A failed load must NEVER be followed by a write. The store in memory is
//     empty and the real one is intact on the other side of the bridge.
//   - The localStorage copy is the only copy until the first native save
//     lands, so it is cleared only after that.
//   - Two flushes must not overlap, or the second builds a plan from marks the
//     first is about to clear.

const { load, runner } = require('./harness');

const t = runner('pda-storage-backend');

const KEY = 'tornPokerHUD_v1';

// A stand-in implementing TornPDA_Storage.md. Values are stored as-is —
// PDA_storage takes anything JSON-serialisable, it is not a string store.
function fakeStorage(opts = {}) {
  const map = new Map();
  const calls = { setMany: 0, delete: 0, loadAll: 0, usage: 0 };
  const api = {
    _map: map,
    _calls: calls,
    quota: opts.quota || 10 * 1024 * 1024,
    failSetMany: opts.failSetMany || false,
    failLoadAll: opts.failLoadAll || false,
    get: (k, d) => Promise.resolve(map.has(k) ? map.get(k) : d),
    getMany: (ks) => Promise.resolve(Object.fromEntries(ks.map((k) => [k, map.has(k) ? map.get(k) : null]))),
    loadAll: () => {
      calls.loadAll += 1;
      if (api.failLoadAll) return Promise.reject(new Error('bridge down'));
      return Promise.resolve(Object.fromEntries(map));
    },
    list: () => Promise.resolve(Array.from(map.keys())),
    set: (k, v) => { map.set(k, v); return Promise.resolve(); },
    setMany: (obj) => {
      calls.setMany += 1;
      if (api.failSetMany) {
        // Documented behaviour: rejects as a WHOLE, writing nothing.
        const e = new Error('quota'); e.code = 'QuotaExceeded';
        return Promise.reject(e);
      }
      Object.keys(obj).forEach((k) => map.set(k, obj[k]));
      return Promise.resolve();
    },
    delete: (k) => { calls.delete += 1; map.delete(k); return Promise.resolve(); },
    usage: () => {
      calls.usage += 1;
      let used = 0;
      map.forEach((v, k) => { used += k.length + JSON.stringify(v).length; });
      return Promise.resolve({ used, quota: api.quota });
    },
  };
  return api;
}

// Drives the real async flush and AWAITS it. Going through saveStore() here
// would not work: its debounced callback already starts a flush, so the
// explicit call coalesces into the in-flight one and returns immediately —
// awaiting a promise for work that has not been done. That saveStore routes to
// this backend at all is asserted separately below.
const flushAsync = (T) => T.flushShardsAsync();

(async () => {
  // --- The backend is chosen, and never mixed ------------------------------

  {
    const T = load();
    t.eq('with no native store the backend is null', T.pdaBackend, null);
    await T.storeReady;
    t.ok('and the store is loaded synchronously, as before', !!T.STORE.settings);
  }

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    t.ok('a usable native store is adopted', T.pdaBackend === pda);
    t.eq('and it was read in ONE loadAll round trip, not per key', pda._calls.loadAll, 1);
  }

  {
    // Partial injection: get/set but no loadAll/setMany. The batch calls are
    // what the whole design rests on, so this must fall back rather than
    // half-adopt a store it cannot read or write efficiently.
    const T = load({ pdaStorage: { get: () => {}, set: () => {} } });
    t.eq('a partial injection is not adopted as a backend', T.pdaBackend, null);
    await T.storeReady;
    t.ok('and localStorage carries the store instead', !!T.STORE.settings);
  }

  // --- Round trip through the native store ---------------------------------

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    await T.storeReady;

    T.STORE.settings.heroName = 'Wonkawee';
    T.getPlayer('555').vpip = 31;
    T.STORE.hands.push({ g: 'g1', t: 1 });
    T.markAllDirty();
    await flushAsync(T);

    t.ok('core lands in the native store', !!pda._map.get(KEY + ':core'));
    t.ok('the player lands under their own key', !!pda._map.get(KEY + ':p:555'));
    t.eq('and is stored as an OBJECT, not a JSON string — a pre-stringified '
      + 'value would be encoded twice by the bridge and roughly double what '
      + 'each record costs', typeof pda._map.get(KEY + ':p:555'), 'object');
    // Bounded chunks, not one call per key and NOT one call for everything.
    // core, hands and the ledger each take a call of their own (they are large
    // single values), and every player in this pass shares one chunk — so a
    // one-player pass is four calls, not one and not five.
    t.eq('sections write separately, players share a chunk', pda._calls.setMany, 4);

    // Read it back through the real loader.
    const T2 = load({ pdaStorage: pda });
    await T2.storeReady;
    t.eq('settings survive the round trip', T2.STORE.settings.heroName, 'Wonkawee');
    t.eq('players do', T2.STORE.players['555'].vpip, 31);
    t.eq('hands do', T2.STORE.hands.length, 1);
  }

  // --- A BIG store must not cross the bridge in one call -------------------
  //
  // Reported from a live table right after the native backend first became
  // reachable: the page stopped scrolling. applyPlanAsync put every dirty
  // write into ONE setMany, so a 1,200-player store was a multi-megabyte
  // payload marshalled across the flutter bridge in a single call — and the
  // 60s reconcile marks everything dirty, so it repeated every minute forever.
  //
  // On localStorage that same reconcile costs 23ms, which is why this never
  // surfaced until the probe actually found PDA_storage.

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    for (let i = 0; i < 600; i += 1) T.getPlayer('p' + i).hands = 10;
    for (let i = 0; i < 50; i += 1) T.STORE.hands.push({ g: 'h' + i, actions: [] });
    T.markAllDirty();

    const sizes = [];
    const realSetMany = pda.setMany;
    pda.setMany = (o) => { sizes.push(Object.keys(o).length); return realSetMany(o); };

    await T.flushShardsAsync();

    // Asserted against a LITERAL ceiling, not against PDA_WRITE_CHUNK itself —
    // `n <= PDA_WRITE_CHUNK` is vacuous, and passes cleanly with the constant
    // raised to 100000, which is the bug. Caught by mutation.
    const HARD_CAP = 128;
    t.ok('the whole store does not go in one call', sizes.length > 1);
    t.ok('no single call carries an unbounded slice of the store',
      Math.max.apply(null, sizes) <= HARD_CAP);
    t.ok('and the number of calls scales with the store, rather than collapsing '
      + 'back to one giant payload', sizes.length >= 600 / HARD_CAP);
    t.ok('the constant agrees with the ceiling this pins',
      T.PDA_WRITE_CHUNK <= HARD_CAP);
    t.eq('with nothing dropped — every key still written',
      sizes.reduce((a, b) => a + b, 0), 603); // 600 players + core + hands + pl
    t.ok('all 600 players landed', !!pda._map.get(KEY + ':p:p599'));
    t.ok('and so did the section shards',
      !!pda._map.get(KEY + ':hands') && !!pda._map.get(KEY + ':core'));
    t.ok('no marks left over', T.dirtyPlayers.size === 0);
  }

  {
    // The section shards are single values of their own (hundreds of KB each)
    // and cannot be split, so each takes a call rather than tripling a chunk
    // it rides along in.
    const T = load({ pdaStorage: fakeStorage() });
    await T.storeReady;
    const writes = [
      { key: KEY + ':core', value: {}, mark: { kind: 'core' } },
      { key: KEY + ':hands', value: [], mark: { kind: 'hands' } },
      { key: KEY + ':pl', value: [], mark: { kind: 'pl' } },
    ].concat(Array.from({ length: 5 }, (_, i) => (
      { key: KEY + ':p:x' + i, value: {}, mark: { kind: 'dirty', xid: 'x' + i } }
    )));
    const chunks = T.chunkWrites(writes);
    t.eq('core, hands and ledger each get their own call, players share one',
      chunks.map((c) => c.length).join(','), '1,1,1,5');
  }

  {
    // Order is preserved, so removals-then-writes and the section-before-player
    // ordering the plan builds still hold across chunking.
    const T = load({ pdaStorage: fakeStorage() });
    await T.storeReady;
    const writes = Array.from({ length: 100 }, (_, i) => (
      { key: KEY + ':p:n' + i, value: {}, mark: { kind: 'dirty', xid: 'n' + i } }
    ));
    const flat = [].concat(...T.chunkWrites(writes));
    t.eq('chunking preserves order', flat.map((w) => w.key).join(','),
      writes.map((w) => w.key).join(','));
    t.eq('and loses nothing', flat.length, 100);
  }

  // --- A failed load must never be followed by a write ---------------------
  //
  // The destructive one. Carrying on with an empty store and saving it would
  // write nothing over data that is perfectly intact behind a slow bridge.

  {
    const pda = fakeStorage({ failLoadAll: true });
    pda._map.set(KEY + ':p:999', { xid: '999', name: 'Precious', hands: 4000 });
    const T = load({ pdaStorage: pda });
    await T.storeReady;

    t.ok('a failed load is recorded', !!T.storeLoadFailed);
    t.eq('the in-memory store is empty, as it must be', Object.keys(T.STORE.players).length, 0);

    pda._calls.setMany = 0;
    T.getPlayer('123').vpip = 1;
    T.saveStore();
    T._sandbox.runTimers();
    // The flush would run in a MICROTASK, so asserting synchronously here
    // passes whether or not the guard exists. Let the queue drain first.
    await new Promise((r) => setTimeout(r, 0));

    t.eq('and NOTHING is written', pda._calls.setMany, 0);
    // Direct too, in case a future saveStore stops being the only entry point.
    await T.flushShardsAsync().catch(() => {});
    t.eq('not even when the flush is driven directly', pda._calls.setMany, 0);
    t.ok('so the real record is untouched', !!pda._map.get(KEY + ':p:999'));
    t.eq('and still has its hands', pda._map.get(KEY + ':p:999').hands, 4000);
  }

  // --- Migration off localStorage ------------------------------------------

  {
    const legacy = JSON.stringify({
      version: 3,
      settings: { heroName: 'Wonkawee' },
      players: { a1: { xid: 'a1', name: 'Alpha', hands: 120 } },
      hands: [], plLedger: [],
    });
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda, storageSeed: legacy });
    await T.storeReady;

    t.eq('an empty native store falls back to what localStorage holds',
      T.STORE.players.a1.hands, 120);
    t.ok('and the localStorage copy is still there, because nothing has been '
      + 'written natively yet', !!T._sandbox.localStorage.getItem(KEY));
    t.ok('flagged as pending', T.legacyLocalPending);

    await flushAsync(T);
    t.ok('after the native write the record is in the native store',
      !!pda._map.get(KEY + ':p:a1'));
    t.eq('and only then is the localStorage copy cleared',
      T._sandbox.localStorage.getItem(KEY), null);
    t.ok('the pending flag is cleared too', !T.legacyLocalPending);
  }

  {
    // The direction that matters: a REFUSED native write must leave the
    // localStorage copy alone. It is the only copy.
    const legacy = JSON.stringify({ version: 3, settings: {}, players: { a1: { xid: 'a1', hands: 9 } }, hands: [], plLedger: [] });
    const pda = fakeStorage({ failSetMany: true });
    const T = load({ pdaStorage: pda, storageSeed: legacy });
    await T.storeReady;
    await flushAsync(T);

    t.ok('a refused native write keeps the localStorage copy',
      !!T._sandbox.localStorage.getItem(KEY));
    t.ok('and stays pending for the next attempt', T.legacyLocalPending);
    t.ok('the failure is surfaced to the user', !!T.saveFailure);
  }

  // --- setMany is all-or-nothing, and the marks follow it ------------------

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    T.markAllDirty();
    await flushAsync(T);

    pda.failSetMany = true;
    T.lastReconcileAt = Date.now();
    T.dirtyPlayers.clear();
    T.getPlayer('777').vpip = 5;
    await flushAsync(T);

    t.ok('a rejected batch leaves the mark set for the next save',
      T.dirtyPlayers.has('777'));
    t.ok('and reports the failure', !!T.saveFailure);

    pda.failSetMany = false;
    await flushAsync(T);
    t.ok('the retry lands it', !!pda._map.get(KEY + ':p:777'));
    t.ok('and clears the mark', !T.dirtyPlayers.has('777'));
    t.eq('and the failure flag', T.saveFailure, null);
  }

  // --- Deletions reach the native store ------------------------------------

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    T.getPlayer('a').hands = 1;
    T.getPlayer('b').hands = 1;
    T.markAllDirty();
    await flushAsync(T);
    t.ok('both are stored', !!pda._map.get(KEY + ':p:a') && !!pda._map.get(KEY + ':p:b'));

    delete T.STORE.players.a;
    T.markPlayerRemoved('a');
    await flushAsync(T);
    t.ok('a removed player is deleted natively', !pda._map.get(KEY + ':p:a'));
    t.ok('and the other is untouched', !!pda._map.get(KEY + ':p:b'));

    const T2 = load({ pdaStorage: pda });
    await T2.storeReady;
    t.ok('it does not come back on the next load', !T2.STORE.players.a);
  }

  // --- Overlapping flushes are coalesced, not raced ------------------------
  //
  // An async write is in flight for an unknown time. A second pass starting
  // inside that window would build its plan from marks the first pass is about
  // to clear — clearing marks for writes that had not landed when it was built.

  {
    const pda = fakeStorage();
    let release;
    const gate = new Promise((r) => { release = r; });
    const realSetMany = pda.setMany;
    // Record every batch. WHAT the second batch contains is the only thing that
    // separates a coalesced follow-up from a genuinely overlapping pass —
    // flushInFlight is set by both, so asserting on it proves nothing.
    const batches = [];

    const T = load({ pdaStorage: pda });
    await T.storeReady;
    T.markAllDirty();
    // Settle the initial full write BEFORE the gate goes on — gating it would
    // deadlock this await, since nothing releases until further down.
    await T.flushShardsAsync();

    pda.setMany = (obj) => { batches.push(Object.keys(obj)); return gate.then(() => realSetMany(obj)); };

    T.lastReconcileAt = Date.now();
    T.dirtyPlayers.clear();
    T.dirtyCore = false; T.dirtyHands = false; T.dirtyPl = false;
    T.getPlayer('p1').vpip = 1;

    const first = T.flushShardsAsync();
    t.ok('a flush is in flight', T.flushInFlight);

    T.getPlayer('p2').vpip = 2;
    const second = T.flushShardsAsync();

    release();
    await Promise.all([first, second]);

    t.eq('exactly two batches: the in-flight one and one coalesced follow-up',
      batches.length, 2);
    t.eq('the first carries only what was dirty when it started',
      batches[0].join(','), KEY + ':p:p1');
    t.ok('and the follow-up does NOT re-send it — a pass that built its plan '
      + 'while the first was in flight would still see p1 marked dirty',
      batches[1].indexOf(KEY + ':p:p1') === -1);
    t.ok('but does carry what arrived during the first',
      batches[1].indexOf(KEY + ':p:p2') !== -1);
    t.ok('the first pass landed', !!pda._map.get(KEY + ':p:p1'));
    t.ok('and so did the follow-up', !!pda._map.get(KEY + ':p:p2'));
    t.ok('with no marks left over', !T.dirtyPlayers.has('p1') && !T.dirtyPlayers.has('p2'));
  }

  // --- saveStore routes to the native backend ------------------------------

  {
    const pda = fakeStorage();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    pda._calls.setMany = 0;
    T.getPlayer('routed').vpip = 3;
    T.saveStore();
    T._sandbox.runTimers();
    // The debounced callback starts the async flush; let it settle.
    await new Promise((r) => setTimeout(r, 0));
    t.ok('a debounced save reaches the native store', pda._calls.setMany > 0);
    t.ok('and writes the record', !!pda._map.get(KEY + ':p:routed'));
  }

  // --- The meter reports real bytes, not a proportion of a guess -----------

  {
    const pda = fakeStorage({ quota: 10 * 1024 * 1024 });
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    for (let i = 0; i < 20; i += 1) T.getPlayer('q' + i).hands = 10;
    T.markAllDirty();
    await flushAsync(T);
    await T.probePdaStorageUsage();

    const s = T.storageStats();
    t.eq('the quota is the real one, not STORAGE_QUOTA_EST', s.quota, 10 * 1024 * 1024);
    t.ok('which is larger than the localStorage estimate', s.quota > T.STORAGE_QUOTA_EST);
    t.ok('and it is not flagged as an estimate', !s.estimated);
    t.ok('the backend is reported as native', s.native);
    t.ok('used is a real figure', s.chars > 0);
  }

  {
    // Without a usage() answer it must fall back to the estimate rather than
    // reporting 0 bytes — a meter reading empty is worse than one reading
    // "roughly", because it silently disables the prune threshold.
    const T = load({ pdaStorage: fakeStorage() });
    await T.storeReady;
    T.pdaStorageUsage = null;
    const s = T.storageStats();
    t.eq('falls back to the estimate', s.quota, T.STORAGE_QUOTA_EST);
    t.ok('and says so', s.estimated);
  }

  process.exit(t.report());
})();
