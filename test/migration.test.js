// Store migrations. See migrateStore() in the storage layer.
//
// The rule these guard: every migration must be idempotent, because it runs
// inside loadStore() before the saveScheduled binding exists and therefore
// cannot call saveStore(). Persistence waits for the next natural save, so a
// page closed before then simply replays the migration on the next load.

const { load, runner } = require('./harness');

const t = runner('migration');

// --- Schema 2: wipe P/L frozen by the heroXid pseudo-id bug (v0.20.0) --------

// Through the real load path, so the loadStore -> migrateStore wiring is
// covered too, not just the function in isolation.
const v1 = {
  version: 1,
  players: {
    4118257: { xid: '4118257', name: 'RoadKillV', plChipsEst: 123456, hands: 40, vpip: 12, pfr: 5 },
    'name:Ghost': { xid: 'name:Ghost', name: 'Ghost', plChipsEst: -999, hands: 3, vpip: 1, pfr: 0 },
  },
  hands: [{ t: 1, pot: 500 }],
  hero: { hands: 0, netChips: 55555 },
  session: { startedAt: 111, hands: 9, net: -4000, lastHandAt: 222 },
  settings: { heroName: 'Wonkawee' },
};

const loaded = load({ storageSeed: JSON.stringify(v1) });
const S = loaded.STORE;

t.eq('opponent P/L zeroed', S.players['4118257'].plChipsEst, 0);
t.eq('pseudo-id record P/L zeroed', S.players['name:Ghost'].plChipsEst, 0);
t.eq('hero netChips zeroed', S.hero.netChips, 0);
t.eq('session net zeroed', S.session.net, 0);
t.eq('version stamped', S.version, loaded.STORE_VERSION);

// Wipe only what the bug corrupted. The pseudo-id bug never touched hand counts
// or rate stats, and wiping those would have destroyed 200 hands of good data.
t.eq('hand counts kept', S.players['4118257'].hands, 40);
t.eq('rate stats kept', S.players['4118257'].vpip, 12);
t.eq('session hands kept', S.session.hands, 9);
t.eq('session start kept', S.session.startedAt, 111);
t.eq('hand history kept', S.hands.length, 1);
t.eq('settings kept', S.settings.heroName, 'Wonkawee');

// --- Idempotency ------------------------------------------------------------

// The migration does not persist itself, so it re-runs on every load until some
// other write happens. Re-running must never wipe P/L earned since.
S.players['4118257'].plChipsEst = 7000;
S.hero.netChips = 7000;
S.session.net = 7000;
loaded.migrateStore(S);
t.eq('idempotent: opponent P/L survives', S.players['4118257'].plChipsEst, 7000);
t.eq('idempotent: hero netChips survives', S.hero.netChips, 7000);
t.eq('idempotent: session net survives', S.session.net, 7000);

// --- Shapes that reach migrateStore from hand-edited imports ----------------

const T = load();

const noVersion = { players: { a: { plChipsEst: 5 } }, hero: { netChips: 5 }, session: { net: 5 } };
T.migrateStore(noVersion);
t.eq('absent version treated as v1', noVersion.players.a.plChipsEst, 0);
t.eq('absent version gets stamped', noVersion.version, T.STORE_VERSION);

const nullRecord = { version: 1, players: { a: null }, hero: { netChips: 3 }, session: { net: 3 } };
T.migrateStore(nullRecord);
t.eq('null player record does not throw', nullRecord.version, T.STORE_VERSION);
t.eq('null player record still wipes hero', nullRecord.hero.netChips, 0);

const noPlayers = { version: 1, hero: { netChips: 3 }, session: { net: 3 } };
T.migrateStore(noPlayers);
t.eq('absent players map does not throw', noPlayers.session.net, 0);

// --- A fresh store is already current ---------------------------------------

t.eq('emptyStore is stamped current', T.emptyStore().version, T.STORE_VERSION);

process.exit(t.report());
