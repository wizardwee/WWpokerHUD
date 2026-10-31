// Core's backup copy, and a load that comes back without core (v1.115.0).
//
// On 27 Oct a load returned every player, hand and ledger key but NO core. The
// HUD took that for a fresh install and saved defaults over it: lifetime P/L
// restarted at zero, settings were lost, and the one-off backfills - whose
// flags live in core - ran a second time. A load missing core but holding
// other keys now restores core's backup copy, on both backends.

const { load, runner } = require('./harness');

const t = runner('core-backup');
const KEY = 'tornPokerHUD_v1';

function fakeNative() {
  const map = new Map();
  const api = {
    _map: map,
    loadAll: () => Promise.resolve(Object.fromEntries(map)),
    setMany: (o) => { Object.keys(o).forEach((k) => map.set(k, JSON.parse(JSON.stringify(o[k])))); return Promise.resolve(); },
    delete: (k) => { map.delete(k); return Promise.resolve(); },
    usage: () => Promise.resolve({ used: 1, quota: 10 * 1024 * 1024 }),
    get: () => Promise.resolve(null), getMany: () => Promise.resolve({}), list: () => Promise.resolve([]),
    set: (k, v) => { map.set(k, v); return Promise.resolve(); },
  };
  return api;
}

const fill = (T) => {
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.hero.hands = 900;
  T.STORE.hero.netChips = 19500000000;
  T.STORE.boardTexBackfilled = true;
  T.getPlayer('42').hands = 10;
};

(async () => {
  // localStorage
  {
    const T = load();
    fill(T);
    T.flushShards(true);
    const ls = T._sandbox.localStorage;
    t.ok('a reconcile writes the copy', !!ls.getItem(KEY + ':core~bak'));
    t.eq('and it holds core', JSON.parse(ls.getItem(KEY + ':core~bak')).hero.netChips, 19500000000);

    ls.removeItem(KEY + ':core');
    T.STORE = T.emptyStore();
    const back = T.loadStore();
    t.eq('a load missing core restores the copy', back.hero.netChips, 19500000000);
    t.eq('settings come back too', back.settings.heroName, 'Wonkawee');
    t.ok('and so do the one-off flags, so nothing re-runs', back.boardTexBackfilled === true);
    t.eq('the players load as usual', back.players['42'].hands, 10);
    t.eq('the recovery is recorded for the scan', (T.coreRecovery || {}).from, 'backup');
  }

  // localStorage, nothing to restore
  {
    const T = load();
    fill(T);
    T.flushShards(false);   // an ordinary save: no copy yet
    const ls = T._sandbox.localStorage;
    t.ok('an ordinary save does not write the copy', !ls.getItem(KEY + ':core~bak'));
    ls.removeItem(KEY + ':core');
    T.STORE = T.emptyStore();
    const back = T.loadStore();
    t.eq('with no copy, defaults', back.hero.netChips, 0);
    t.eq('said so', (T.coreRecovery || {}).from, 'none');
    T.flushShards(true);
    t.ok('and the defaults are never written as a copy', !ls.getItem(KEY + ':core~bak'));
  }

  // A fresh install is not a recovery.
  {
    const T = load();
    t.eq('a fresh install claims no recovery', T.coreRecovery, null);
  }

  // Native backend: the case that actually happened.
  {
    const pda = fakeNative();
    const T = load({ pdaStorage: pda });
    await T.storeReady;
    fill(T);
    T.markAllDirty();
    await T.flushShardsAsync(true);
    t.ok('native: the copy is written', pda._map.has(KEY + ':core~bak'));
    pda._map.delete(KEY + ':core');          // loadAll comes back without core
    const T2 = load({ pdaStorage: pda });
    await T2.storeReady;
    t.eq('native: lifetime P/L survives a load missing core', T2.STORE.hero.netChips, 19500000000);
    t.eq('native: so do settings', T2.STORE.settings.heroName, 'Wonkawee');
    t.eq('native: and the players', T2.STORE.players['42'].hands, 10);
    T2.markAllDirty();
    await T2.flushShardsAsync(true);
    t.eq('native: the next save puts core back, not defaults', pda._map.get(KEY + ':core').hero.netChips, 19500000000);
  }

  process.exit(t.report());
})();
