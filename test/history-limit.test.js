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
  t.eq('default is 2000 (v1.104.0)', T.historyLimitOf({}), 2000);
  t.eq('a fresh store carries the default', T.emptyStore().settings.historyLimit, 2000);
  t.eq('a stored choice is read', T.historyLimitOf({ historyLimit: 500 }), 500);
  t.eq('clamped above the largest choice', T.historyLimitOf({ historyLimit: 99999 }), 5000);
  t.eq('garbage reads as the default', T.historyLimitOf({ historyLimit: 'x' }), 2000);
  t.eq('the ceiling at 200 is the old 500', T.historyCeiling(200), T.HISTORY_PINNED_CEILING);
  t.eq('pinned keep the same headroom at 2000', T.historyCeiling(2000), 2300);
  // Pinned against literals — a constant compared with itself proves nothing.
  t.eq('largest choice is 5000', Math.max(...T.HISTORY_LIMIT_CHOICES), 5000);
  t.ok('the reconcile slice stays bounded', T.HAND_RECONCILE_SLICE <= 500);
}

// --- Choices depend on the backend -------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  t.ok('localStorage stops at the local max',
    Math.max(...T.historyLimitChoices()) === T.HISTORY_LIMIT_LOCAL_MAX);
  T.pdaBackend = {};
  t.ok('native storage offers 5000', T.historyLimitChoices().indexOf(5000) >= 0);
  t.eq('native: the default applies as stored', T.effectiveHistoryLimit(), 2000);
  T.pdaBackend = null;
  t.eq('localStorage: the 2000 default is held to the local max',
    T.effectiveHistoryLimit(), T.HISTORY_LIMIT_LOCAL_MAX);
  t.ok('an unlisted value is refused', !T.setHistoryLimit(2000));
  T.pdaBackend = {};
  T.STORE.settings.historyLimit = 300; // an odd value from an import
  t.ok('the current value is always listed', T.historyLimitChoices().indexOf(300) >= 0);
}

// --- The old default is raised once, a real choice is not ---------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.historyLimit = 200;
  t.ok('200 is raised', T.raiseHistoryDefault());
  t.eq('to the new default', T.STORE.settings.historyLimit, 2000);
  T.STORE.settings.historyLimit = 200; // put back by hand afterwards
  t.ok('and only once', !T.raiseHistoryDefault());
  t.eq('so a later 200 stays', T.STORE.settings.historyLimit, 200);
  const U = load();
  U.STORE = U.emptyStore();
  U.STORE.settings.historyLimit = 1000;
  U.raiseHistoryDefault();
  t.eq('any other choice is left alone', U.STORE.settings.historyLimit, 1000);
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

  // The reconcile ignores the memo for its slice: an in-place edit nobody
  // marked is written on the pass whose slice reaches it.
  T.STORE.hands[100].pot = 123;
  const full = T.buildFlushPlan(true);
  t.ok('reconcile catches an unmarked in-place edit',
    full.writes.some((w) => w.key.endsWith('g' + 99)));
}

// --- At 5000, the reconcile covers every hand within ceil(n / slice) passes ----
{
  const T = load();
  T.pdaBackend = null;
  storeWith(T, 5000);
  T.flushShards(true);
  const passes = Math.ceil(5000 / T.HAND_RECONCILE_SLICE);
  // Edit one hand in each slice-width band, unmarked.
  const edited = [];
  for (let i = 250; i < 5000; i += T.HAND_RECONCILE_SLICE) { T.STORE.hands[i].pot = 7; edited.push(T.STORE.hands[i].g); }
  const seen = new Set();
  let hashed = 0;
  const J = require('vm').runInContext('JSON', T._sandbox);
  const orig = J.stringify;
  J.stringify = function (v) {
    if (v && typeof v === 'object' && Array.isArray(v.actions) && 'pot' in v) hashed += 1;
    return orig.apply(this, arguments);
  };
  let maxPerPass = 0;
  for (let k = 0; k < passes; k++) {
    hashed = 0;
    const plan = T.buildFlushPlan(true);
    // A write is stringified twice (hash, then payload), so allow for those.
    maxPerPass = Math.max(maxPerPass, hashed - 2 * plan.writes.filter((w) => w.key.indexOf(':h:') >= 0).length);
    plan.writes.forEach((w) => { const m = /:h:g(.+)$/.exec(w.key); if (m) seen.add(m[1]); });
  }
  J.stringify = orig;
  t.ok('every unmarked edit is caught within ' + passes + ' passes',
    edited.every((g) => seen.has(g)));
  t.ok('each pass hashes about one slice, not 5000 (' + maxPerPass + ')',
    maxPerPass <= T.HAND_RECONCILE_SLICE);
}

process.exit(t.report());
