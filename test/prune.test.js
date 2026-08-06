// Pruning STORE.players.
//
// The shape follows a measurement: a fresh 1-hand record is 562 bytes and a
// 500-hand one is 1,076. A thin record costs HALF what a thick one does for
// essentially none of the value, so thin goes before old — age is the
// tiebreaker, never the lead. A flat "drop everything over 60 days" rule
// deletes a weekly regular with 400 hands and keeps yesterday's stranger.
//
// This deletes the user's data, so the tests are about what must SURVIVE at
// least as much as what must go.

const { load, runner } = require('./harness');

const t = runner('prune');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1750000000000;

function withPlayers(spec) {
  const T = load();
  T.STORE = T.emptyStore();
  Object.keys(spec).forEach((xid) => {
    const p = T.emptyPlayer(xid, 'P' + xid);
    p.hands = spec[xid].hands;
    p.lastSeen = spec[xid].lastSeen;
    T.STORE.players[xid] = p;
  });
  return T;
}
const ids = (T) => Object.keys(T.STORE.players).sort();

// --- Thin and stale goes first ---------------------------------------------

{
  const T = withPlayers({
    // Thin AND stale: the target. Half the cost, none of the read.
    thinOld: { hands: 3, lastSeen: NOW - 60 * DAY },
    // Thin but seen yesterday — they are probably at the table right now.
    thinNew: { hands: 3, lastSeen: NOW - 1 * DAY },
    // A regular you play monthly. A flat 60-day rule would delete this one,
    // which is the whole reason age does not lead.
    thickOld: { hands: 400, lastSeen: NOW - 60 * DAY },
    thickNew: { hands: 400, lastSeen: NOW - 2 * DAY },
  });
  const r = T.prunePlayers(NOW);
  t.eq('thin and stale is dropped', r.thin, 1);
  t.eq('and nothing else is', r.dropped, 1);
  t.eq('a recently-seen thin player survives', ids(T).includes('thinNew'), true);
  t.eq('a 400-hand regular survives 60 days away', ids(T).includes('thickOld'), true);
  t.eq('the report counts what is left', r.kept, 3);
}

// --- Very old goes regardless of sample -------------------------------------

{
  const T = withPlayers({
    ancient: { hands: 400, lastSeen: NOW - (181 * DAY) },
    old: { hands: 400, lastSeen: NOW - (179 * DAY) },
  });
  const r = T.prunePlayers(NOW);
  t.eq('past the hard age limit even a thick record goes', r.stale, 1);
  t.eq('just inside it, it stays', ids(T).join(','), 'old');
}

// --- The LRU cap is the invariant -------------------------------------------
//
// Rules 1 and 2 are heuristics that might free nothing. This is the part that
// actually bounds the store, and without it "prune" is just hope.

{
  const spec = {};
  for (let i = 0; i < T_CAP_OVERSHOOT(); i += 1) {
    // All thick, all seen today: neither age rule touches any of them.
    spec['p' + i] = { hands: 500, lastSeen: NOW - i * 1000 };
  }
  const T = withPlayers(spec);
  const cap = T.PRUNE_PLAYER_CAP;
  const r = T.prunePlayers(NOW);
  t.eq('the cap is enforced even when no age rule fires', Object.keys(T.STORE.players).length, cap);
  t.ok('and the drops are attributed to the LRU pass', r.lru > 0 && r.thin === 0 && r.stale === 0);
  // Oldest go first: p0 was seen most recently, so it must survive.
  t.ok('the most recently seen survive', !!T.STORE.players.p0);
  t.ok('the least recently seen do not', !T.STORE.players['p' + (T_CAP_OVERSHOOT() - 1)]);
}

function T_CAP_OVERSHOOT() { return 2050; }

// --- Hero is never dropped ---------------------------------------------------
//
// Hero's record holds your own tendencies and the coach reads it. It is also
// exactly the record most likely to look prunable in a long gap.

{
  const T = withPlayers({ 999: { hands: 1, lastSeen: NOW - 900 * DAY } });
  T.heroXid = '999';
  const r = T.prunePlayers(NOW);
  t.eq('your own record survives any rule', r.dropped, 0);
  t.ok('and is still there', !!T.STORE.players['999']);
}

// --- An unknown lastSeen is not an infinite age -----------------------------
//
// Imported records and anything written before lastSeen was maintained have
// lastSeen 0. Reading epoch-0 as "very old" would let a gist import delete a
// year of good data on the first save after it.

{
  const T = withPlayers({ imported: { hands: 400, lastSeen: 0 } });
  const r = T.prunePlayers(NOW);
  t.eq('a record with no timestamp is not dropped', r.dropped, 0);
  t.eq('it is stamped instead', T.STORE.players.imported.lastSeen, NOW);

  // ...and judged normally next time round.
  const r2 = T.prunePlayers(NOW + 200 * DAY);
  t.eq('so the following prune can act on a real age', r2.stale, 1);
}

// --- Idempotence -------------------------------------------------------------
//
// It runs off the back of every save. A second pass immediately after a first
// must find nothing, or the save path re-saves forever.

{
  const T = withPlayers({
    a: { hands: 1, lastSeen: NOW - 90 * DAY },
    b: { hands: 1, lastSeen: NOW - 91 * DAY },
    c: { hands: 300, lastSeen: NOW - 1 * DAY },
  });
  t.eq('first pass drops the thin stale pair', T.prunePlayers(NOW).dropped, 2);
  t.eq('second pass drops nothing', T.prunePlayers(NOW).dropped, 0);
}

// --- The trigger -------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.old = Object.assign(T.emptyPlayer('old', 'O'), { hands: 1, lastSeen: Date.now() - 90 * DAY });

  // Below the pressure threshold nothing is deleted, however prunable it looks.
  // The user chose "auto past 75%", and deleting on a day it was not needed is
  // exactly what that rules out.
  T._sandbox.localStorage.setItem('tornPokerHUD_v1', 'x'.repeat(1024));
  T.lastPruneCheck = 0;
  t.eq('no pressure, no prune', T.maybePrune(false), false);
  t.ok('and the prunable record is untouched', !!T.STORE.players.old);

  // Over the threshold it runs.
  T._sandbox.localStorage.setItem('tornPokerHUD_v1',
    'x'.repeat(Math.ceil(T.STORAGE_QUOTA_EST * (T.STORAGE_WARN_PCT / 100)) + 1000));
  T.lastPruneCheck = 0;
  t.eq('under pressure it prunes', T.maybePrune(false), true);
  t.ok('the record is gone', !T.STORE.players.old);
  t.ok('and the run is reported', !!T.STORE.lastPrune && T.STORE.lastPrune.dropped === 1);

  // Throttled: the pressure test reads the whole stored string, so it must not
  // run on every debounced save.
  T.STORE.players.old2 = Object.assign(T.emptyPlayer('old2', 'O2'), { hands: 1, lastSeen: Date.now() - 90 * DAY });
  t.eq('a second call inside the interval is skipped', T.maybePrune(false), false);
  t.ok('so the record is still there', !!T.STORE.players.old2);

  // force skips both the throttle and the pressure test — the save-refused path.
  t.eq('force runs anyway', T.maybePrune(true), true);
  t.ok('and drops it', !T.STORE.players.old2);

  // Termination: the save path re-saves whenever this returns true, so a forced
  // second pass with nothing left MUST return false or that loops forever.
  t.eq('a forced pass with nothing to drop returns false', T.maybePrune(true), false);
}

// --- The emergency path, end to end -----------------------------------------
//
// A refused save must prune and retry immediately rather than waiting out the
// 60s throttle — the data being lost is accruing right now. And it must STOP:
// saveStore re-saves whenever maybePrune returns true, so an unbounded retry
// here would spin the phone.

{
  const T = load();
  T.STORE = T.emptyStore();
  for (let i = 0; i < 5; i += 1) {
    T.STORE.players['x' + i] = Object.assign(T.emptyPlayer('x' + i, 'X'),
      { hands: 1, lastSeen: Date.now() - 90 * DAY });
  }

  const ls = T._sandbox.localStorage;
  let attempts = 0;
  ls.setItem = () => {
    attempts += 1;
    const e = new Error('QuotaExceededError');
    e.name = 'QuotaExceededError';
    throw e;
  };

  T.lastPruneCheck = 0;
  T.saveFailure = null;
  T.saveStore();
  T._sandbox.runTimers();

  t.ok('the refusal is recorded', !!T.saveFailure);
  t.eq('a prune ran despite the throttle being fresh', T.STORE.lastPrune.dropped, 5);
  // One retry after the prune, then it gives up because the second prune has
  // nothing to drop. Any more than 2 means the loop is not terminating.
  t.eq('exactly one retry, then it stops', attempts, 2);
}

process.exit(t.report());
