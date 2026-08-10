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

// --- Schema 3: drop records invented by the winner-line misparse (v1.4.0) ---
//
// "Bauderix won $28,500,000 Did not show hand" used to match the `shows`
// pattern, so the whole clause reached nameToXidGuess as a username and came
// back as a pseudo-id that logAction counted as a player dealt in. Those keys
// are removable precisely because the name is not a legal username — a genuine
// pseudo-id (a player seen before their seat rendered) holds a valid one and
// must survive, so this cannot just delete every `name:` key.

{
  const s = {
    version: 2,
    players: {
      311421: { plChipsEst: 5000, hands: 200 },
      'name:Bauderix': { plChipsEst: 10, hands: 3 },
      'name:Al-Qaeda': { plChipsEst: 1, hands: 1 },
      'name:Bauderix won $28,500,000 Did not': { plChipsEst: 0, hands: 7 },
      'name:Bahn won $44,468,060 Did not': { plChipsEst: 0, hands: 2 },
    },
    hero: { netChips: 999999 },
    session: { net: 4242 },
  };
  T.migrateStore(s);
  t.eq('junk pseudo-record dropped', s.players['name:Bauderix won $28,500,000 Did not'], undefined);
  t.eq('second junk pseudo-record dropped', s.players['name:Bahn won $44,468,060 Did not'], undefined);
  t.ok('a legitimate pseudo-record survives', !!s.players['name:Bauderix']);
  t.ok('a hyphenated username survives (USERNAME_RE allows -)', !!s.players['name:Al-Qaeda']);
  t.ok('a real numeric record survives', !!s.players['311421']);

  // THE REGRESSION THIS SECTION EXISTS FOR. The schema-2 wipe used to run
  // unconditionally, so bumping STORE_VERSION to 3 would have re-zeroed the P/L
  // of every store that had already migrated — destroying good data as a side
  // effect of an unrelated schema change. Every block must be gated on `from`.
  t.eq('a v2 store is NOT re-wiped: hero netChips survives', s.hero.netChips, 999999);
  t.eq('a v2 store is NOT re-wiped: session net survives', s.session.net, 4242);
  t.eq('a v2 store is NOT re-wiped: opponent P/L survives', s.players['311421'].plChipsEst, 5000);
}

// --- A fresh store is already current ---------------------------------------

t.eq('emptyStore is stamped current', T.emptyStore().version, T.STORE_VERSION);

process.exit(t.report());
