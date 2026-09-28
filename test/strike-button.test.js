// The departure watch's fast path and its one-tap attack button (v1.96.0).
//
// Reported: the pill was "not rapid enough to notify and hit someone". Two
// changes, and each has a way to be quietly wrong:
//
//   - noteLogDeparture reads Torn's own "<name> left the table" line. It must
//     resolve the name against who WAS seated (the seat may already be gone),
//     never fire for hero, and never double-fire when the seat diff catches up.
//   - renderStrikeButton puts a live link over the table. It must appear only
//     for a leaver who positively qualifies (unknown is never "go"), ignore a
//     tap that lands in its first STRIKE_ARM_MS, and never prevent the link's
//     own navigation on a real tap.

const { load, runner } = require('./harness');

const t = runner('strike-button');

const okay = (level) => ({ state: 'Okay', until: 0, level, fetchedAt: Date.now() });
const hosp = () => ({ state: 'Hospital', until: Math.floor(Date.now() / 1000) + 600, level: 40, fetchedAt: Date.now() });

function setup(opts) {
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  T.heroXid = 'HERO';
  T.STORE.players.HERO = T.emptyPlayer('HERO', 'Wonkawee');
  ['A', 'B'].forEach((x) => { T.STORE.players[x] = T.emptyPlayer(x, x === 'A' ? 'ZeusCyborg' : 'Sdreka'); });
  T.STORE.players.A.stack = { now: (opts && opts.stack) || 2e9 };
  T.STORE.players.B.stack = { now: 2e9 };
  T.targetCache.set('A', (opts && opts.status) || okay((opts && opts.level) || 41));
  T.targetCache.set('B', okay(50));
  T.lastSeatedSnapshot = ['A', 'B', 'HERO'];
  return T;
}
const btn = (T) => T._sandbox.document.querySelector('.tph-strike');

// --- the log line: resolves against who WAS seated ---------------------------

{
  const T = setup();
  t.eq('the line resolves to the seat that just emptied',
    T.noteLogDeparture('ZeusCyborg left the table'), 'A');
  const e = T.departedWatch.get('A');
  t.ok('and records it as caught from the log', !!e && e.via === 'log');
  t.ok('as an alerted departure, with no second sweep needed', e && e.alerted === true);
  // The seat diff catches up two sweeps later. It must not record them again.
  T.noteSeatDepartures(['B', 'HERO']);
  T.noteSeatDepartures(['B', 'HERO']);
  t.eq('the seat diff does not double-record them', T.departedList().length, 1);
  t.eq('a repeated log line is ignored too', T.noteLogDeparture('ZeusCyborg left the table'), null);
}

{
  const T = setup();
  t.eq('case differences still match', T.noteLogDeparture('zeuscyborg Left The Table'), 'A');
  t.eq('a name that was not seated matches nobody', T.noteLogDeparture('Stranger left the table'), null);
  t.eq('hero leaving is never a target', T.noteLogDeparture('Wonkawee left the table'), null);
  t.eq('a joining line is not a departure', T.noteLogDeparture('Sdreka joined the table'), null);
  t.eq('so only the one departure is watched', T.departedList().length, 1);
}

{
  const T = setup();
  T.STORE.settings.departureWatch = false;
  t.eq('with the watch off the line does nothing', T.noteLogDeparture('ZeusCyborg left the table'), null);
}

// The hook sits in front of the parser's noise filter, which drops the line.
{
  const T = setup();
  T.handleLogLine('ZeusCyborg left the table');
  t.ok('handleLogLine reaches the departure path', T.departedWatch.has('A'));
}

// --- the button's gates: every one must be positively met --------------------

{
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  const el = btn(T);
  t.ok('a qualifying leaver gets the button', !!el);
  const go = el && el.children[1];
  t.ok('it is a link to their attack page', !!go && /sid=attack&user2ID=A$/.test(go.href));
  t.ok('opened in a new tab so the table keeps running', go && go.target === '_blank');
}

const reasonFor = (opts) => {
  const T = setup(opts);
  T.noteLogDeparture('ZeusCyborg left the table');
  const d = T.departedList().find((x) => x.xid === 'A');
  return { T, reason: T.strikeBlockReason(d) };
};

t.eq('hospitalised: no button', reasonFor({ status: hosp() }).reason, 'status');
{
  // Never checked is unknown, and unknown is never "go".
  const T = setup();
  T.targetCache.delete('A');
  T.noteLogDeparture('ZeusCyborg left the table');
  t.eq('unchecked status: no button', T.strikeBlockReason(T.departedList()[0]), 'status');
  t.ok('and nothing on screen', !btn(T));
}
t.eq('over the level cap: no button', reasonFor({ level: 81 }).reason, 'level');
t.eq('exactly at the level cap qualifies', reasonFor({ level: 80 }).reason, '');
t.eq('under the stack floor: no button', reasonFor({ stack: 499e6 }).reason, 'stack');
t.eq('exactly at the stack floor qualifies', reasonFor({ stack: 500e6 }).reason, '');
{
  const { T } = reasonFor({ level: 81 });
  T.STORE.settings.strikeMaxLevel = 0;
  t.eq('a cap of 0 means no level limit', T.strikeBlockReason(T.departedList()[0]), '');
}
{
  // An unknown level must not slip under a cap as "0".
  const T = setup();
  T.targetCache.set('A', okay(0));
  T.noteLogDeparture('ZeusCyborg left the table');
  t.eq('an unknown level fails a set cap', T.strikeBlockReason(T.departedList()[0]), 'level');
}
{
  const T = setup();
  T.STORE.settings.strikeButton = false;
  T.noteLogDeparture('ZeusCyborg left the table');
  t.ok('the setting off shows no button', !btn(T));
  t.ok('while the departure is still watched', T.departedWatch.has('A'));
}

// --- the tap: armed late, never blocks a real one -----------------------------

{
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  const go = btn(T).children[1];
  let prevented = false;
  const tap = () => (go.listeners.click || []).forEach((fn) => fn({ preventDefault() { prevented = true; } }));

  tap(); // inside STRIKE_ARM_MS of appearing
  t.ok('a tap in the first moment is swallowed', prevented);
  t.ok('and the button stays up', !!btn(T));

  prevented = false;
  T.strikeShownAt = Date.now() - T.STRIKE_ARM_MS - 1;
  tap();
  t.ok('a real tap is never prevented — the link navigates', !prevented);
  T._sandbox.runTimers();
  t.ok('and the button goes once used', !btn(T));
  T.renderStrikeButton();
  t.ok('and does not come back for them', !btn(T));
  t.ok('while they stay in the pill list', T.departedList().length === 1);
}

{
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  (btn(T).children[2].listeners.click || []).forEach((fn) => fn({}));
  T._sandbox.runTimers();
  t.ok('✕ dismisses the button', !btn(T));
}

{
  // A tap on the link must not be able to start a drag, and a drag must not
  // be able to become an attack: only the grip carries pointer handlers.
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  const [grip, go] = btn(T).children;
  t.ok('the grip drags', !!(grip.listeners.pointerdown && grip.listeners.pointerup));
  t.ok('the link does not', !go.listeners.pointerdown);
}

// --- expiry and turnover ------------------------------------------------------

{
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  T.departedWatch.get('A').leftAt = Date.now() - T.STRIKE_SHOW_MS - 1;
  T.renderStrikeButton();
  t.ok('the button expires after STRIKE_SHOW_MS', !btn(T));
  t.eq('the pill list keeps them for the full watch', T.departedList().length, 1);
}

{
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  T.departedWatch.get('A').leftAt -= 1000;
  T.noteLogDeparture('Sdreka left the table');
  const go = btn(T).children[1];
  t.ok('a newer qualifying leaver takes the button', /user2ID=B$/.test(go.href));
  t.eq('one button, never a stack of them', T._sandbox.document.querySelectorAll('.tph-strike').length, 1);
}

{
  // Hospitalised after leaving (status refreshed): the button must go.
  const T = setup();
  T.noteLogDeparture('ZeusCyborg left the table');
  T.targetCache.set('A', hosp());
  T.renderStrikeButton();
  t.ok('a status that turns blocked removes the button', !btn(T));
}

process.exit(t.report());
