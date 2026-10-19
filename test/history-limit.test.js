// History length is a setting (v1.103.0), and a long history must not make
// every save re-serialise all of it.

const { load, runner } = require('./harness');

const t = runner('history-limit');

function storeWith(T, n) {
  T.STORE = T.emptyStore();
  const hs = [];
  for (let i = 0; i < n; i++) {
    hs.push({ t: 1e12 + n - i, g: 'g' + i, pot: 0, players: [], actions: [{ x: 'a', a: 'fold', s: 'preflop' }],
      winners: [], shown: {}, board: [], bb: 0, pinned: i % 10 === 0 });
  }
  T.STORE.hands = hs;
}

// --- The clamp and the ceiling ----------------------------------------------
{
  const T = load();
  t.eq('default is 200', T.historyLimitOf({}), 200);
  t.eq('a stored choice is read', T.historyLimitOf({ historyLimit: 2000 }), 2000);
  t.eq('clamped above the largest choice', T.historyLimitOf({ historyLimit: 99999 }), 2000);
  t.eq('garbage reads as the default', T.historyLimitOf({ historyLimit: 'x' }), 200);
  t.eq('the ceiling at 200 is the old 500', T.historyCeiling(200), T.HISTORY_PINNED_CEILING);
  t.eq('pinned keep the same headroom at 2000', T.historyCeiling(2000), 2300);
  // Pinned against a literal — a constant compared with itself proves nothing.
  t.ok('largest choice stays at or under 2000 (reconcile cost)',
    Math.max(...T.HISTORY_LIMIT_CHOICES) <= 2000);
}

// --- Choices depend on the backend -------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  t.ok('localStorage stops at the local max',
    Math.max(...T.historyLimitChoices()) === T.HISTORY_LIMIT_LOCAL_MAX);
  T.pdaBackend = {};
  t.ok('native storage offers 2000', T.historyLimitChoices().indexOf(2000) >= 0);
  T.pdaBackend = null;
  T.STORE.settings.historyLimit = 1000; // carried over from the other backend
  t.ok('the current value is always listed', T.historyLimitChoices().indexOf(1000) >= 0);
  t.ok('an unlisted value is refused', !T.setHistoryLimit(2000));
}

// --- Raising keeps more, lowering trims now ----------------------------------
{
  const T = load();
  T.pdaBackend = {};
  storeWith(T, 1500);
  t.ok('raise to 2000 accepted', T.setHistoryLimit(2000));
  t.eq('nothing dropped on a raise', T.STORE.hands.length, 1500);
  const h = T.freshHandState();
  h.actions = [{ x: 'a', a: 'fold', amt: 0, s: 'preflop' }];
  h.dealtInXids = new Set(['a']);
  T.recordHandHistory(h);
  t.eq('a new hand is kept past the old 500 cap', T.STORE.hands.length, 1501);
  t.ok('lower to 200 accepted', T.setHistoryLimit(200));
  t.ok('trimmed at once to the ceiling', T.STORE.hands.length <= T.historyCeiling(200));
  t.ok('pinned hands still ride past the limit', T.STORE.hands.length > 200);
}

// --- Per-hand saves do not re-serialise the history --------------------------
{
  const T = load();
  T.pdaBackend = null;
  storeWith(T, 500);
  T.flushShards(true);
  // Count JSON.stringify calls on hand records during a non-full plan.
  // The script's JSON is the vm context's own intrinsic, not a sandbox property.
  const J = require('vm').runInContext('JSON', T._sandbox);
  const orig = J.stringify;
  let handCalls = 0;
  J.stringify = function (v) {
    if (v && typeof v === 'object' && Array.isArray(v.actions) && 'pot' in v) handCalls += 1;
    return orig.apply(this, arguments);
  };
  T.STORE.hands.unshift({ t: 2e12, g: 'new', pot: 0, players: [], actions: [], winners: [], shown: {}, board: [], bb: 0 });
  T.STORE.hands[5].fav = true; // a star toggle edits in place
  T.dirtyHands = true;
  const plan = T.buildFlushPlan(false);
  J.stringify = orig;
  const keys = plan.writes.map((w) => w.key);
  t.ok('the new hand is written', keys.some((k) => /gnew$/.test(k)));
  t.ok('the starred hand is written', keys.some((k) => k.endsWith('g' + 4)));
  t.ok('nothing else is', plan.writes.filter((w) => w.key.indexOf(':h:') >= 0).length === 2);
  t.ok('hashing touched only the changed hands, not all 501 (' + handCalls + ')', handCalls <= 4);

  // The reconcile ignores the memo: an in-place edit nobody marked is written.
  T.STORE.hands[100].pot = 123;
  const full = T.buildFlushPlan(true);
  t.ok('reconcile catches an unmarked in-place edit',
    full.writes.some((w) => w.key.endsWith('g' + 99)));
}

process.exit(t.report());
