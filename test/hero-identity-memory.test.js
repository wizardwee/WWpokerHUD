// Hero identity survives not being sat down.
//
// Identity was read only off the live `self___` seat marker, which exists only
// while you are actually sitting. Away from a seat, findHeroXid fell through to
// the "name:<username>" pseudo-id, heroUnresolved() went true, and everything
// gated on isHeroRecord vanished: the Trends tab was not rendered at all, hero's
// own record showed Exploit instead of Leaks, and Settings' "Your own stats"
// button was disabled. So your own numbers were unreachable exactly when you
// were not playing — which is when you actually want to read them.
//
// STORE.hero.xid remembers what a seat once told us. The harness's DOM is inert
// (every selector returns empty), which makes it precisely a "no seat on screen"
// environment — the state under test.

const { load, runner } = require('./harness');

const t = runner('hero-identity-memory');

// --- With nothing remembered, a seatless lookup still can't identify hero ----

{
  const T = load();
  T.STORE.settings.heroName = 'Wonkawee';
  const xid = T.findHeroXid();
  t.ok('no seat and no memory falls back to the pseudo-id', String(xid).startsWith('name:'));
  T.heroXid = xid;
  t.eq('which is what heroUnresolved is for', T.heroUnresolved(), true);
  t.eq('so hero cannot be recognised by record', T.isHeroRecord('3722665'), false);
}

// --- Once a seat has told us, the answer survives having no seat ------------

{
  const T = load();
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.hero.xid = '3722665'; // as rememberHeroXid would have written it

  const xid = T.findHeroXid();
  t.eq('the remembered xid is used instead of the pseudo-id', xid, '3722665');
  T.heroXid = xid;
  t.eq('hero counts as resolved with no seat on screen', T.heroUnresolved(), false);
  t.eq('and hero is recognised by record', T.isHeroRecord('3722665'), true);
  t.eq('while someone else is not', T.isHeroRecord('999'), false);
}

// --- rememberHeroXid: only ever stores a real seat xid ----------------------

{
  const T = load();
  T.rememberHeroXid('3722665');
  t.eq('a real xid is remembered', T.STORE.hero.xid, '3722665');

  T.rememberHeroXid('name:Wonkawee');
  t.eq('a pseudo-id is refused — it is the thing being fixed, not an answer',
    T.STORE.hero.xid, '3722665');

  T.rememberHeroXid(null);
  t.eq('null is refused', T.STORE.hero.xid, '3722665');

  T.rememberHeroXid('4444');
  t.eq('a later real seat overwrites it', T.STORE.hero.xid, '4444');
}

// --- ensureHeroShape: a stored pseudo-id must never come back as identity ---

{
  const T = load();
  t.eq('a stored pseudo-id is rejected on load', T.ensureHeroShape({ xid: 'name:Wonkawee' }).xid, null);
  t.eq('a non-string is rejected', T.ensureHeroShape({ xid: 12345 }).xid, null);
  t.eq('an empty string is rejected', T.ensureHeroShape({ xid: '' }).xid, null);
  t.eq('a real xid survives', T.ensureHeroShape({ xid: '3722665' }).xid, '3722665');
  t.eq('a store with no xid at all is fine', T.ensureHeroShape({}).xid, null);
  // The numeric backfill must still work alongside the new non-numeric field.
  t.eq('numeric fields still backfill', T.ensureHeroShape({}).hands, 0);
  t.eq('and a real hand count survives', T.ensureHeroShape({ hands: 275 }).hands, 275);
}

// --- Resetting stats must not make you a stranger --------------------------

{
  const T = load();
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.hero.xid = '3722665';
  T.STORE.hero.hands = 275;
  T.STORE.hero.netChips = 50000000;
  T.heroXid = '3722665';

  T.resetHeroStats();
  t.eq('the stats are cleared', T.STORE.hero.hands, 0);
  t.eq('the money is cleared', T.STORE.hero.netChips, 0);
  t.eq('but identity is kept — this resets your stats, not who you are',
    T.STORE.hero.xid, '3722665');
  t.eq('so your own stats stay reachable straight after a reset',
    T.findHeroXid(), '3722665');
}

// --- A remembered xid must not survive into a different account ------------

{
  // The username-change handler nulls STORE.hero.xid alongside heroXid;
  // asserted here at the level the harness can drive, since the handler itself
  // is wired to a DOM input.
  const T = load();
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.hero.xid = '3722665';

  T.STORE.settings.heroName = 'SomeoneElse';
  T.STORE.hero.xid = null; // what the change handler does
  T.heroXid = null;

  const xid = T.findHeroXid();
  t.ok('a new username resolves fresh, not back to the old account',
    String(xid).startsWith('name:SomeoneElse'));
  T.heroXid = xid;
  t.eq('and is correctly reported as unresolved until a seat confirms it',
    T.heroUnresolved(), true);
}

process.exit(t.report());
