// Sharded persistence.
//
// The store used to be one localStorage key rewritten in full on every save.
// At the sizes CLAUDE.md documents that blob is 2.9 MB and 23ms per
// JSON.stringify, and saveStore is called from the per-action counters and a
// 400ms poll — so a busy hand was serialising 2.9 MB up to four times a second
// to record one call. Each piece now has its own key and only dirty ones are
// written.
//
// The speed is the easy half. These tests are about the three things that stop
// it being a data-loss bug:
//
//   1. A missed dirty mark must not lose data — the periodic full reconcile.
//   2. A mark is cleared only by its OWN successful write.
//   3. Deletions must reach storage, or a pruned record returns from the dead.
//
// Plus the migration off the legacy blob, which must never delete the only
// copy before the replacement is known to have landed.

const { load, runner } = require('./harness');

const t = runner('store-shards');

const KEY = 'tornPokerHUD_v1';
const raw = (T, k) => T._sandbox.localStorage.getItem(k);
const keysUnder = (T) => {
  const ls = T._sandbox.localStorage;
  const out = [];
  for (let i = 0; i < ls.length; i += 1) {
    const k = ls.key(i);
    if (k && k.indexOf(KEY + ':') === 0) out.push(k);
  }
  return out.sort();
};
const flush = (T) => { T.saveStore(); T._sandbox.runTimers(); };

function seeded(n) {
  const T = load();
  T.STORE = T.emptyStore();
  for (let i = 0; i < n; i += 1) {
    T.STORE.players['x' + i] = Object.assign(T.emptyPlayer('x' + i, 'P' + i), { hands: 10 + i });
  }
  T.markAllDirty();
  flush(T);
  return T;
}

// --- Round trip --------------------------------------------------------------

{
  const T = seeded(3);
  t.ok('core is written', !!raw(T, KEY + ':core'));
  t.ok('hands has its own shard', raw(T, KEY + ':hands') !== null);
  t.ok('the ledger has its own shard', raw(T, KEY + ':pl') !== null);
  t.ok('each player has its own key', !!raw(T, KEY + ':p:x1'));
  t.eq('three players, three player keys',
    keysUnder(T).filter((k) => k.indexOf(KEY + ':p:') === 0).length, 3);

  // The split keys must NOT be duplicated inside core — that is the whole
  // saving, and a stale copy there could also shadow the real shard on load.
  const core = JSON.parse(raw(T, KEY + ':core'));
  t.ok('players are not also inside core', core.players === undefined);
  t.ok('hands are not also inside core', core.hands === undefined);
  t.ok('the ledger is not also inside core', core.plLedger === undefined);
  t.ok('but the small fields are', !!core.settings && !!core.hero);
}

// --- Load reassembles what save wrote ---------------------------------------

{
  const T = seeded(3);
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.hands.push({ g: 'abc', t: 1 });
  T.STORE.plLedger.push({ t: 1, d: -5, b: 1, g: 'abc' });
  T.STORE.players.x1.vpip = 44;
  T.markAllDirty();
  flush(T);

  // Reload from the same backing store, through the real loader.
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('settings survive', back.settings.heroName, 'Wonkawee');
  t.eq('hands survive', back.hands.length, 1);
  t.eq('the ledger survives', back.plLedger.length, 1);
  t.eq('all three players come back', Object.keys(back.players).length, 3);
  t.eq('and their fields do', back.players.x1.vpip, 44);
}

// --- Only dirty shards are written ------------------------------------------
//
// The entire point. If a per-action save still touches every player key, the
// cost is exactly what it was.

{
  const T = seeded(5);
  const ls = T._sandbox.localStorage;
  const written = [];
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k, v) => { written.push(k); return realSet(k, v); };

  // Mid-interval, so the reconcile does not fire and mask the result.
  T.lastReconcileAt = Date.now();
  T.dirtyCore = false;
  T.dirtyHands = false;
  T.dirtyPl = false;
  T.dirtyPlayers.clear();

  T.getPlayer('x2').vpip = 9;
  flush(T);

  t.ok('the touched player is written', written.indexOf(KEY + ':p:x2') !== -1);
  t.eq('and nothing else is', written.length, 1);
  t.ok('untouched players are not rewritten', written.indexOf(KEY + ':p:x0') === -1);
  t.ok('the ledger is not rewritten for a preflop call', written.indexOf(KEY + ':pl') === -1);
}

// --- getPlayer marks, because that is where mutation goes -------------------

{
  const T = seeded(2);
  T.dirtyPlayers.clear();
  T.getPlayer('x0');
  t.ok('a bare getPlayer marks dirty — it hands out the live record and cannot '
    + 'see whether the caller wrote to it', T.dirtyPlayers.has('x0'));
}

// --- The reconcile is what makes a missed mark survivable -------------------
//
// This is the safety net. A mutation that never marks its player must still be
// persisted, because proving the mark list exhaustive forever is exactly the
// kind of claim this file has been burned by.

{
  const T = seeded(2);
  T.dirtyPlayers.clear();
  T.dirtyCore = false;
  T.dirtyHands = false;
  T.dirtyPl = false;

  // Reach past every mark, the way a direct STORE.players[xid] mutation does.
  T.STORE.players.x0.vpip = 777;

  // Inside the interval: not written, and that is the accepted cost.
  T.lastReconcileAt = Date.now();
  flush(T);
  t.ok('inside the reconcile interval an unmarked change is not yet persisted',
    JSON.parse(raw(T, KEY + ':p:x0')).vpip !== 777);

  // Past it: written, without anybody having marked anything.
  T.lastReconcileAt = Date.now() - T.STORE_RECONCILE_MS - 1;
  flush(T);
  t.eq('the reconcile persists it anyway', JSON.parse(raw(T, KEY + ':p:x0')).vpip, 777);
  t.ok('the reconcile timestamp advances, so it does not fire every save',
    Date.now() - T.lastReconcileAt < T.STORE_RECONCILE_MS);
}

// --- A refused write leaves its own mark set --------------------------------
//
// If a refusal cleared the flag, the record would be lost permanently rather
// than retried. Partial success must be partial, not all-or-nothing.

{
  const T = seeded(3);
  T.lastReconcileAt = Date.now();
  T.dirtyPlayers.clear();
  T.dirtyCore = false; T.dirtyHands = false; T.dirtyPl = false;

  const ls = T._sandbox.localStorage;
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k, v) => {
    if (k === KEY + ':p:x1') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return realSet(k, v);
  };

  T.getPlayer('x0').vpip = 1;
  T.getPlayer('x1').vpip = 2;
  T.getPlayer('x2').vpip = 3;
  flush(T);

  t.ok('the refused shard stays dirty for the next save', T.dirtyPlayers.has('x1'));
  t.ok('the shards that DID fit are clean', !T.dirtyPlayers.has('x0'));
  t.ok('and the one after the failure is too — one refusal does not abandon the pass',
    !T.dirtyPlayers.has('x2'));
  t.eq('x2 really was written despite x1 failing', JSON.parse(raw(T, KEY + ':p:x2')).vpip, 3);
  t.ok('the failure is still reported to the user', !!T.saveFailure);

  ls.setItem = realSet;
  flush(T);
  t.eq('and the retry lands it', JSON.parse(raw(T, KEY + ':p:x1')).vpip, 2);
  t.eq('which clears the failure flag', T.saveFailure, null);
}

// --- Deletions reach storage ------------------------------------------------

{
  const T = seeded(3);
  t.ok('x1 is on disk to begin with', !!raw(T, KEY + ':p:x1'));

  delete T.STORE.players.x1;
  T.markPlayerRemoved('x1');
  flush(T);

  t.eq('a removed player leaves no key behind', raw(T, KEY + ':p:x1'), null);
  T.STORE = T.emptyStore();
  t.ok('and does not come back on reload', !T.loadStore().players.x1);
}

{
  // The belt-and-braces path: a player deleted WITHOUT markPlayerRemoved, but
  // still carrying a dirty mark. Writing `undefined` over the record, or
  // throwing, would both be worse than treating the mark as a removal.
  const T = seeded(2);
  T.getPlayer('x0');
  delete T.STORE.players.x0;
  flush(T);
  t.eq('a dirty mark on a vanished player removes the key', raw(T, KEY + ':p:x0'), null);
  t.ok('and the mark is cleared rather than retried forever', !T.dirtyPlayers.has('x0'));
}

{
  // Pruning is the real source of deletions, and the reason it matters twice:
  // a leftover key comes back from the dead AND holds the quota the prune was
  // run to free.
  const T = load();
  T.STORE = T.emptyStore();
  const DAY = 24 * 60 * 60 * 1000;
  T.STORE.players.keep = Object.assign(T.emptyPlayer('keep', 'K'), { hands: 400, lastSeen: Date.now() });
  T.STORE.players.drop = Object.assign(T.emptyPlayer('drop', 'D'), { hands: 1, lastSeen: Date.now() - 90 * DAY });
  T.markAllDirty();
  flush(T);
  t.ok('both are on disk', !!raw(T, KEY + ':p:drop') && !!raw(T, KEY + ':p:keep'));

  T.prunePlayers(Date.now());
  flush(T);
  t.eq('the pruned record is gone from storage', raw(T, KEY + ':p:drop'), null);
  t.ok('the kept one is not', !!raw(T, KEY + ':p:keep'));
}

// --- Migration off the legacy blob ------------------------------------------
//
// The one-time upgrade path. The old key is the ONLY copy until the shards
// exist, so removing it before a successful write turns a refused save into
// total data loss.

{
  const legacy = JSON.stringify({
    version: 3,
    settings: { heroName: 'Wonkawee' },
    players: { a1: { xid: 'a1', name: 'Alpha', hands: 120, vpip: 50 } },
    hands: [{ g: 'g1', t: 1 }],
    plLedger: [{ t: 1, d: -3, b: 1, g: 'g1' }],
    hero: { hands: 120, netChips: -500, netBB: -5, bbHands: 120 },
  });
  const T = load({ storageSeed: legacy });

  t.eq('the legacy store is read', T.STORE.settings.heroName, 'Wonkawee');
  t.eq('its players come across', T.STORE.players.a1.hands, 120);
  t.eq('its hands come across', T.STORE.hands.length, 1);
  t.eq('its ledger comes across', T.STORE.plLedger.length, 1);
  t.ok('and the old blob is still there, because nothing has been written yet',
    !!raw(T, KEY));

  flush(T);
  t.ok('after a successful save the shards exist', !!raw(T, KEY + ':p:a1'));
  t.eq('and only then is the old blob removed', raw(T, KEY), null);
}

{
  // MIGRATION DEADLOCK — reported from a live table as "HUD storage is full,
  // nothing is being saved", on a store the settings panel put at 2.9 MB.
  //
  // During the upgrade the legacy blob and the shards replacing it hold the
  // same data, and both are in storage for the length of the write: a 2.9 MB
  // store needs 5.8 MB to migrate, against ~5 MB shared with torn.com. The
  // store most in need of the split was exactly the one that could not
  // complete it. This models that budget directly rather than failing every
  // write, because "fails until the blob goes, then succeeds" IS the bug.
  const bulk = 'x'.repeat(4000);
  const legacy = JSON.stringify({
    version: 3, settings: {},
    players: { a1: { xid: 'a1', hands: 9, pad: bulk }, a2: { xid: 'a2', hands: 9, pad: bulk } },
    hands: [], plLedger: [],
  });
  const T = load({ storageSeed: legacy });
  const ls = T._sandbox.localStorage;
  const realSet = ls.setItem.bind(ls);
  // A byte budget just under twice the blob: enough for the shards alone,
  // never enough for the shards PLUS the blob.
  const BUDGET = Math.floor(legacy.length * 1.4);
  const used = () => {
    let n = 0;
    for (let i = 0; i < ls.length; i += 1) n += (ls.getItem(ls.key(i)) || '').length;
    return n;
  };
  ls.setItem = (k, v) => {
    const delta = String(v).length - (ls.getItem(k) || '').length;
    if (used() + delta > BUDGET) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return realSet(k, v);
  };

  t.ok('the blob is present before any write is attempted', !!raw(T, KEY));
  flush(T);

  // The blob is dropped only AFTER a refusal, never pre-emptively — memory
  // already holds its contents, and it is the largest thing that can be freed
  // to let its own replacement land.
  t.eq('the deadlock is broken: the blob is gone', raw(T, KEY), null);
  t.ok('and it is no longer pending', !T.legacyBlobPending);
  t.ok('the players actually landed in shards', !!raw(T, KEY + ':p:a1') && !!raw(T, KEY + ':p:a2'));
  t.eq('so the save is no longer reported as failing', T.saveFailure, null);

  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('and nothing was lost', Object.keys(back.players).sort().join(','), 'a1,a2');
}

{
  // When even dropping the blob does not make room, the failure must still be
  // reported rather than swallowed by the recovery path.
  const legacy = JSON.stringify({ version: 3, settings: {}, players: { a1: { xid: 'a1', hands: 9 } }, hands: [], plLedger: [] });
  const T = load({ storageSeed: legacy });
  const ls = T._sandbox.localStorage;
  ls.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  flush(T);
  t.ok('a refusal that survives the recovery is still reported', !!T.saveFailure);
  t.ok('and the store is still in memory to be backed up', !!T.STORE.players.a1);
}

// --- One corrupt shard costs one shard --------------------------------------
//
// The old blob's only failure mode was "Corrupt storage, resetting" — one bad
// byte anywhere wiped every player, every hand and the whole ledger.

{
  const T = seeded(3);
  T._sandbox.localStorage.setItem(KEY + ':p:x1', '{not json');
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('the good players still load', Object.keys(back.players).sort().join(','), 'x0,x2');
  t.ok('the corrupt key is not left holding quota', raw(T, KEY + ':p:x1') === null);
  t.ok('core is unaffected', !!back.settings);
}

{
  const T = seeded(2);
  T._sandbox.localStorage.setItem(KEY + ':hands', 'garbage');
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('a corrupt hands shard costs the hands, not the players',
    Object.keys(back.players).length, 2);
  t.eq('and reads as empty rather than undefined', back.hands.length, 0);
}

// --- Rebinding STORE must not leave orphan keys behind ----------------------
//
// Under the old single blob this needed nothing — one key was overwritten and
// what it held was gone by definition. Sharded, a player who exists on disk but
// not in the incoming store keeps their key and is read straight back on the
// next load. "Reset all data" would clear the screen and silently restore
// everything on the next reload.

{
  const T = seeded(4);
  t.eq('four player keys on disk', keysUnder(T).filter((k) => k.indexOf(KEY + ':p:') === 0).length, 4);

  T.resetAllData();
  T._sandbox.runTimers();

  t.eq('reset leaves no player keys', keysUnder(T).filter((k) => k.indexOf(KEY + ':p:') === 0).length, 0);
  T.STORE = T.emptyStore();
  t.eq('and nothing comes back on reload', Object.keys(T.loadStore().players).length, 0);
}

{
  // An import REPLACES; it must not silently union itself with what was there.
  const T = seeded(3);
  T.importJson(JSON.stringify({
    version: 3,
    settings: {},
    players: { x1: { xid: 'x1', name: 'Kept', hands: 99 }, fresh: { xid: 'fresh', name: 'New', hands: 5 } },
    hands: [],
    plLedger: [],
  }));
  T._sandbox.runTimers();

  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('only the imported players survive a reload',
    Object.keys(back.players).sort().join(','), 'fresh,x1');
  t.ok('a record dropped by the import does not resurrect', !back.players.x0);
  t.eq('and one present in both keeps the imported value', back.players.x1.hands, 99);
}

{
  // Settings are preserved across a reset, so core must be rewritten too — not
  // only the player keys.
  const T = seeded(2);
  T.STORE.settings.heroName = 'Wonkawee';
  T.markAllDirty();
  flush(T);
  T.resetAllData();
  T._sandbox.runTimers();
  T.STORE = T.emptyStore();
  t.eq('a reset keeps your settings', T.loadStore().settings.heroName, 'Wonkawee');
}

// --- The size meter must not drift from reality -----------------------------
//
// storageStats reads a running total rather than re-reading ~900 keys off the
// back of every save. A running total that drifts is worse than no meter: it
// drives the prune.

{
  const T = seeded(6);
  T.getPlayer('x3').vpip = 12;
  flush(T);
  delete T.STORE.players.x4;
  T.markPlayerRemoved('x4');
  flush(T);

  const ls = T._sandbox.localStorage;
  let actual = 0;
  keysUnder(T).forEach((k) => { actual += (ls.getItem(k) || '').length; });
  t.eq('the running total equals what is actually stored', T.storageStats().chars, actual);
}

// --- A PARTIALLY migrated store: the blob is reclaimed, not stranded --------
//
// Reported from a live table as "history hasn't continued" — the HUD ran
// normally, recorded into memory, and persisted nothing at all.
//
// How a store gets here: v1.70.0's migration deadlock wrote as many shards as
// fit, was refused for the rest, and KEPT the blob because the write failed.
// The shards then existed, so the next load took the sharded path — which did
// not look at the blob. It sat there holding ~2.9 MB of a ~5 MB budget that
// nothing would reclaim, shardBytes never counted it, and the store could
// never write again.
//
// The blob is a COMPLETE copy as of the failed migration, so this is a
// recovery and not just a cleanup.

{
  const T = seeded(2);
  // Shards hold two thin records; the blob holds those plus four more, with
  // more hands on one of the overlapping pair.
  const blob = JSON.stringify({
    version: 3,
    settings: { heroName: 'Wonkawee' },
    hero: { hands: 900, netChips: -5000, netBB: -50, bbHands: 900 },
    players: {
      x0: { xid: 'x0', name: 'P0', hands: 999, notes: 'floats every flop' },
      x1: { xid: 'x1', name: 'P1', hands: 1 },
      lost1: { xid: 'lost1', name: 'Lost1', hands: 400 },
      lost2: { xid: 'lost2', name: 'Lost2', hands: 300 },
      lost3: { xid: 'lost3', name: 'Lost3', hands: 12 },
    },
    hands: [{ g: 'old1', t: 1, actions: [] }, { g: 'old2', t: 2, actions: [] }],
    plLedger: [{ t: 1, d: -5, b: 1, g: 'old1' }, { t: 2, d: 7, b: 1, g: 'old2' }],
  });
  T._sandbox.localStorage.setItem(KEY, blob);

  T.STORE = T.emptyStore();
  const back = T.loadStore();

  t.eq('records the shards never had are restored',
    Object.keys(back.players).sort().join(','), 'lost1,lost2,lost3,x0,x1');
  t.eq('and the blob wins where it has more hands', back.players.x0.hands, 999);
  t.eq('carrying what a human typed', back.players.x0.notes, 'floats every flop');
  t.eq('hands are restored', back.hands.length, 2);
  t.eq('so is the ledger the refused write left empty', back.plLedger.length, 2);
  t.eq("hero's totals come back too", back.hero.hands, 900);
  t.ok('and it is reported rather than done silently', !!back.lastReclaim);
  t.eq('with a count', (back.lastReclaim || {}).players, 3);

  t.ok('the blob is NOT removed before the replacement is written',
    !!raw(T, KEY));
  flush(T);
  t.eq('only after a save does it go', raw(T, KEY), null);

  T.STORE = T.emptyStore();
  t.eq('and the recovery survives a reload',
    Object.keys(T.loadStore().players).length, 5);
}

{
  // A recovery must never LOSE data. mergeHands re-applies the history trim,
  // and a store legitimately over the limit (pinned hands ride past it) would
  // come back SHORTER — this function deleting history while restoring it.
  const T = seeded(1);
  // UNPINNED and over historyLimit: mergeHands re-applies trimHandHistory,
  // which keeps only `limit` unpinned hands — so a naive merge hands back 200
  // where 300 went in. Pinned hands ride past the limit and can never shrink,
  // which is why the first version of this test proved nothing.
  for (let i = 0; i < 300; i += 1) T.STORE.hands.push({ g: 'h' + i, t: i, actions: [] });
  T.markAllDirty();
  flush(T);
  const before = T.STORE.hands.length;
  t.eq('the store really is over the trim limit to begin with', before, 300);

  T._sandbox.localStorage.setItem(KEY, JSON.stringify({
    version: 3, settings: {}, players: {}, hands: [{ g: 'z', t: 1, actions: [] }], plLedger: [],
  }));
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.ok('history is never shorter after a reclaim than before it',
    back.hands.length >= before);
}

{
  // An unreadable blob teaches nothing and is holding the quota shut.
  const T = seeded(2);
  T._sandbox.localStorage.setItem(KEY, '{ not json');
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('the shards still load', Object.keys(back.players).length, 2);
  t.eq('and the unreadable blob is dropped rather than left holding space',
    raw(T, KEY), null);
}

{
  // No blob: the ordinary case must not be disturbed.
  const T = seeded(3);
  T.STORE = T.emptyStore();
  const back = T.loadStore();
  t.eq('a clean sharded store loads unchanged', Object.keys(back.players).length, 3);
  t.ok('and claims no recovery', !back.lastReclaim);
}

// --- The panel must actually RENDER -----------------------------------------
//
// reclaimReportHtml shipped referencing `plural`, which is a const inside
// storageSettingsHtml rather than a shared helper — a ReferenceError the
// moment Settings was opened, on the one panel a user in trouble goes to. No
// test rendered this panel, so nothing caught it. Now one does.

{
  const T = seeded(1);
  T.STORE.lastReclaim = { at: Date.now(), players: 926, hands: 3, ledger: 20000 };
  T.STORE.lastPrune = { at: Date.now(), thin: 40, stale: 1100, lru: 0, dropped: 1140, kept: 54 };
  let html = '';
  let threw = null;
  try { html = T.storageSettingsHtml(); } catch (e) { threw = e; }
  t.eq('the storage panel renders without throwing', threw ? threw.message : 'none', 'none');
  t.ok('the recovery is reported to the user', /Recovered 926 player records/.test(html));
  t.ok('including the ledger rows', /20000 P\/L rows/.test(html));
  t.ok('and the cleanup is still reported beside it', /dropped 1140 player records/.test(html));
  t.ok('singular reads correctly too',
    /1 player record\b/.test((() => {
      T.STORE.lastReclaim = { at: Date.now(), players: 1, hands: 0, ledger: 0 };
      return T.storageSettingsHtml();
    })()));
}

// --- The breakdown must sum to the total ------------------------------------
//
// Added after a live report: the panel read "2.9 MB of roughly 5.0 MB" with
// saves being refused, and offered nothing to act on. The three components are
// priced very differently and only history has a setting you can turn down.
// A breakdown that does not add up to the headline figure is worse than none.

{
  const T = seeded(8);
  for (let i = 0; i < 20; i += 1) T.STORE.hands.push({ g: 'h' + i, actions: [{ x: 'a', a: 'call' }] });
  for (let i = 0; i < 200; i += 1) T.STORE.plLedger.push({ t: i, d: -1, b: 1, g: 'l' + i });
  T.markAllDirty();
  flush(T);

  const b = T.storageBreakdown();
  const total = b.players + b.hands + b.ledger + b.core;
  t.eq('the parts sum to the headline figure', total, T.storageStats().chars);
  t.ok('players are attributed', b.players > 0);
  t.ok('history is attributed', b.hands > 0);
  t.ok('the ledger is attributed', b.ledger > 0);
  t.ok('core is attributed', b.core > 0);
  t.ok('and no player shard is miscounted as core — 8 records dwarf the settings blob',
    b.players > b.core);
}

// --- The backend stays behind one seam --------------------------------------
//
// A literal source scan, same tool test/seat-sweep.test.js uses to keep
// runDeepScan reading the document directly. Every touch of localStorage must
// live inside shardRead/shardWrite/shardRemove/shardKeys — that is what makes
// the backend swappable at one place rather than at forty call sites, and a
// stray getItem elsewhere would quietly bypass the size accounting too.

{
  const fs = require('fs');
  const { SCRIPT_PATH } = require('./harness');
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/\blocalStorage\s*\./.test(line) && !/\blocalStorage\s*\[/.test(line)) return;
    // The four accessor bodies are the allowed home. Identified by the call
    // they make rather than by line number, so this survives the file moving.
    if (/localStorage\.(getItem|setItem|removeItem|key)\b/.test(line)
      || /localStorage\.length\b/.test(line)) {
      // Allowed only within ~30 lines of the seam's own marker comment.
      const near = lines.slice(Math.max(0, i - 30), i + 5).join('\n');
      if (/--- Backend: localStorage ---/.test(near)) return;
    }
    offenders.push((i + 1) + ': ' + line.trim());
  });
  t.eq('no localStorage access outside the backend seam'
    + (offenders.length ? ' -> ' + offenders.join(' | ') : ''), offenders.length, 0);

  // Guard against the scan matching nothing and passing vacuously — the exact
  // failure test/coach-relevance.test.js carries its own guard against.
  t.ok('the scan actually found the seam', /--- Backend: localStorage ---/.test(src));
  t.ok('and the seam really does call localStorage', /localStorage\.setItem/.test(src));
}

process.exit(t.report());
