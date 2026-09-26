// A gist pull must not change anything the merge has no opinion on.
//
// mergeStores used to build its result from scratch — a handful of named keys
// and a hard-coded `version: 1` — and GistSync.pullAndMerge hands that straight
// to replaceStore. Nothing failed at the time. On the NEXT load migrateStore
// read version 1 as a pre-v0.20.0 store and ran the schema-2 repair, zeroing
// every opponent's P/L, hero.netChips and the session net. The rebuild also
// dropped the two one-shot backfill flags, and those backfills ADD, so the
// following init() counted every stored hand into board texture and barrels a
// second time.
//
// So this goes through the real round trip — merge, replace, save, reload —
// because the loss happened on the reload, not in the merge.

const { load, runner } = require('./harness');

const t = runner('gist-merge-state');
const flush = (T) => { T.saveStore(); T._sandbox.runTimers(); };

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hero.netChips = 750000000;
  T.STORE.hero.hands = 900;
  T.STORE.session.net = 25000000;
  T.STORE.players.v1 = Object.assign(T.emptyPlayer('v1', 'Villain'), { hands: 50, plChipsEst: -40000000 });
  T.STORE.boardTexBackfilled = true;
  T.STORE.barrelBackfilled = true;
  T.STORE.affilCacheRepaired = true;

  const remote = T.emptyStore();
  remote.players.v2 = Object.assign(T.emptyPlayer('v2', 'Other'), { hands: 5 });

  const merged = T.mergeStores(T.STORE, remote);
  t.eq('the merge keeps the store version', merged.version, T.STORE.version);
  t.ok('and the backfill flags', merged.boardTexBackfilled && merged.barrelBackfilled && merged.affilCacheRepaired);
  t.ok('and still brings in the remote player', !!merged.players.v2);

  T.replaceStore(merged);
  flush(T);
  const back = T.loadStore();
  t.eq('lifetime P/L survives a reload after a sync', back.hero.netChips, 750000000);
  t.eq('an opponent\'s P/L survives it', back.players.v1.plChipsEst, -40000000);
  t.eq('the session net survives it', back.session.net, 25000000);
  t.ok('the board-texture backfill is not re-armed', back.boardTexBackfilled === true);
  t.ok('nor the barrel backfill', back.barrelBackfilled === true);
}

process.exit(t.report());
