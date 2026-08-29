// Departure watch — see noteSeatDepartures / departedList / departedAlertable.
//
// Asked for directly: "If I see a player who is not in hospital, suddenly
// leave table, this is a trigger for me to attack. How can we make this here
// since when the player leaves his info is gone and I can't click into him."
//
// That last clause is the whole problem: the seat is the only handle on a
// player, and it vanishes at the exact moment they become worth attacking.
// Everything needed to keep the handle was already here — the seat sweep, the
// status cache, the stored name, and an attack URL that needs only an xid.
//
// WHAT THIS FILE IS REALLY FOR: departures are computed by diffing successive
// seat sweeps, so every false positive comes from the sweep reading empty or
// short for a moment. A HUD that announces "eight players left, attack them"
// because a re-render blinked is worse than one that says nothing. The guards
// are the feature; the list is the easy part.

const { load, runner } = require('./harness');

const t = runner('departure-watch');

// noteSeatDepartures TAKES the seated list rather than reading it, so the diff
// is drivable with no DOM. That signature exists because of this file: the
// first version read seatedXids() internally and these tests stubbed the seam
// export to fake it — which does not rebind the module's own function, so every
// assertion passed against an inert DOM returning nothing. Green, and testing
// nothing at all. Passing the list in is what makes these assertions real.

function setup(opts) {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = (opts && opts.heroXid) || 'HERO';
  T.STORE.players.HERO = T.emptyPlayer('HERO', 'Hero');
  ((opts && opts.players) || []).forEach((x) => {
    T.STORE.players[x] = T.emptyPlayer(x, 'Player' + x);
  });
  return T;
}

const okay = () => ({ state: 'Okay', until: 0, level: 50, fetchedAt: Date.now() });
const hosp = () => ({
  state: 'Hospital', until: Math.floor(Date.now() / 1000) + 600, level: 40, fetchedAt: Date.now(),
});

// --- GUARD 1: an empty sweep is never "everyone left" ----------------------

{
  const T = setup({ players: ['A', 'B', 'C'] });
  T.targetCache.set('A', okay());
  T.targetCache.set('B', okay());
  T.lastSeatedSnapshot = ['A', 'B', 'C', 'HERO'];

  // The table is not readable this tick — a re-render, an SPA swap, or the
  // page backgrounded. All of these briefly match no seats.
  t.eq('an empty sweep reports no departures', T.noteSeatDepartures([]).length, 0);
  t.eq('and nothing is being watched', T.departedList().length, 0);
  // Crucially it must not become the baseline either, or the NEXT sweep would
  // diff against nothing and the real departures would be lost.
  t.eq('the previous snapshot is left intact', T.lastSeatedSnapshot.length, 4);
}

// --- GUARD 2: one missed sweep is a re-render, two is a departure ---------

{
  const T = setup({ players: ['A', 'B'] });
  T.targetCache.set('A', okay());
  T.lastSeatedSnapshot = ['A', 'B', 'HERO'];

  t.eq('the FIRST sweep missing A reports nothing', T.noteSeatDepartures(['B', 'HERO']).length, 0);
  t.eq('and A is not yet watched', T.departedList().length, 0);

  const fired = T.noteSeatDepartures(['B', 'HERO']);
  t.eq('the SECOND consecutive miss fires', fired.length, 1);
  t.eq('and names A', fired[0], 'A');
  t.eq('A is now watched', T.departedList().length, 1);
}

{
  // The re-render case: A vanishes for one sweep and comes straight back.
  const T = setup({ players: ['A', 'B'] });
  T.targetCache.set('A', okay());
  T.lastSeatedSnapshot = ['A', 'B'];

  T.noteSeatDepartures(['B']);     // first miss — pending
  t.eq('A reappearing cancels the pending departure',
    T.noteSeatDepartures(['A', 'B']).length, 0);

  // And the pending state must be cleared, not merely ignored: a later single
  // miss should start counting again from scratch rather than fire instantly.
  t.eq('a later single miss does not fire on its own', T.noteSeatDepartures(['B']).length, 0);
}

// --- hero never counts as a departure ------------------------------------

{
  const T = setup({ players: ['A'] });
  T.lastSeatedSnapshot = ['A', 'HERO'];
  T.noteSeatDepartures(['A']);
  const fired = T.noteSeatDepartures(['A']);
  t.eq('hero leaving their own table is not a target', fired.indexOf('HERO'), -1);
  t.eq('nothing is watched', T.departedList().length, 0);
}

// --- the first readable sweep has nothing to compare against -------------

{
  const T = setup({ players: ['A', 'B'] });
  T.lastSeatedSnapshot = null;
  t.eq('the first sweep reports no departures', T.noteSeatDepartures(['A', 'B']).length, 0);
  t.ok('but it does become the baseline', T.lastSeatedSnapshot.length === 2);
}

// --- alertable vs merely listed: unknown is never "go" -------------------
//
// The same asymmetry attackReadiness enforces. Someone in hospital when they
// left, or never checked at all, still appears in the list — you may want to
// see them — but must not buzz, flash, or count toward the pill.

{
  const T = setup({ players: ['READY', 'HOSP', 'UNKNOWN'] });
  T.targetCache.set('READY', okay());
  T.targetCache.set('HOSP', hosp());
  // UNKNOWN deliberately has no cache entry.
  T.lastSeatedSnapshot = ['READY', 'HOSP', 'UNKNOWN', 'HERO'];

  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);

  t.eq('all three are listed', T.departedList().length, 3);
  const alert = T.departedAlertable();
  t.eq('only the known-attackable one raises the alarm', alert.length, 1);
  t.eq('and it is the right one', alert[0].xid, 'READY');
}

// --- a live status change demotes someone after they left ----------------

{
  const T = setup({ players: ['A'] });
  T.targetCache.set('A', okay());
  T.lastSeatedSnapshot = ['A', 'HERO'];
  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);
  t.eq('A left attackable and is alertable', T.departedAlertable().length, 1);

  // Somebody else hospitalises them while we are watching.
  T.targetCache.set('A', hosp());
  t.eq('A is still listed', T.departedList().length, 1);
  t.eq('but no longer alertable', T.departedAlertable().length, 0);
  t.eq('and the row reads as blocked', T.departedList()[0].readiness.blocked, true);
}

// --- expiry and dismissal ------------------------------------------------

{
  const T = setup({ players: ['A'] });
  T.targetCache.set('A', okay());
  T.lastSeatedSnapshot = ['A', 'HERO'];
  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);
  t.eq('A is watched', T.departedList().length, 1);

  // Expiry is by wall clock, not a timer, so it stays correct after the phone
  // sleeps. Backdate the entry past the window.
  T.departedWatch.get('A').leftAt = Date.now() - T.DEPARTED_WATCH_MS - 1000;
  t.eq('an entry past the watch window drops out', T.departedList().length, 0);

  // Dismissal, on a fresh entry.
  T.departedWatch.get('A').leftAt = Date.now();
  t.eq('and is back inside the window', T.departedList().length, 1);
  T.dismissDeparture('A');
  t.eq('a dismissed entry is gone', T.departedList().length, 0);
  t.eq('dismissing is idempotent', (T.dismissDeparture('A'), T.departedList().length), 0);
  t.eq('dismissing an unknown xid does not throw',
    (T.dismissDeparture('NOPE'), T.departedList().length), 0);
}

// --- the list is bounded -------------------------------------------------

{
  const T = setup({});
  const many = [];
  for (let i = 0; i < T.DEPARTED_MAX + 6; i++) {
    const x = 'P' + i;
    many.push(x);
    T.STORE.players[x] = T.emptyPlayer(x, x);
    T.targetCache.set(x, okay());
  }
  T.lastSeatedSnapshot = many.concat(['HERO']);
  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);
  t.ok(`the watch is capped at DEPARTED_MAX (${T.departedWatch.size})`,
    T.departedWatch.size <= T.DEPARTED_MAX);
}

// --- clearDepartures ------------------------------------------------------

{
  const T = setup({ players: ['A', 'B'] });
  T.targetCache.set('A', okay());
  T.targetCache.set('B', okay());
  T.lastSeatedSnapshot = ['A', 'B', 'HERO'];
  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);
  t.eq('both are watched', T.departedList().length, 2);
  T.clearDepartures();
  t.eq('dismiss all empties the list', T.departedList().length, 0);
}

process.exit(t.report());
