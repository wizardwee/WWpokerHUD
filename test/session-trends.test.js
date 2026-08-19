// Session-over-session trends (v1.22.0) — the Trends tab on hero's own player
// panel, and the touchSession/archiveSession machinery it reads.
//
// A "session" already existed (STORE.session, touchSession, SESSION_GAP_MS) —
// it just overwrote itself in place on every gap, so the moment a session
// ended its numbers were gone for good. This adds an archive: the just-ended
// session is snapshotted into STORE.sessionHistory (bounded at
// SESSION_HISTORY_MAX, oldest dropped first) before touchSession resets the
// live counters, and the Trends tab charts win rate, VPIP, aggression and P/L
// across that archive.

const { load, runner } = require('./harness');

const t = runner('session-trends');
const T = load();
T.STORE = T.emptyStore();

// --- ensureSessionShape backfills a session written before these fields existed

{
  const s = T.ensureSessionShape({ startedAt: 5, hands: 3, net: 100 });
  t.eq('existing numeric fields survive', s.hands, 3);
  t.eq('missing lastHandAt backfilled', s.lastHandAt, 0);
  t.eq('missing vpip backfilled', s.vpip, 0);
  t.eq('missing pfr backfilled', s.pfr, 0);
  t.eq('missing aggActions backfilled', s.aggActions, 0);
  t.eq('missing passActions backfilled', s.passActions, 0);
  t.eq('missing bb backfilled', s.bb, 0);

  const repaired = T.ensureSessionShape({ hands: NaN, vpip: 'x' });
  t.eq('a NaN field is repaired', repaired.hands, 0);
  t.eq('a non-number field is repaired', repaired.vpip, 0);

  t.eq('an undefined session is created from scratch', T.ensureSessionShape(undefined).hands, 0);
}

// --- sparklineSvg: min/max/zeroLine is additive, the old 0-100 callers ------

{
  t.eq('fewer than 2 points renders nothing, same as before', T.sparklineSvg([5], {}), '');
  const basic = T.sparklineSvg([0, 50, 100], {});
  t.ok('default 0-100 range still renders a line', basic.includes('<polyline'));

  const signed = T.sparklineSvg([-10, 0, 10], { min: -20, max: 20, zeroLine: true });
  t.ok('a straddling range draws the zero line', signed.includes('<line'));

  const allPositive = T.sparklineSvg([1, 2, 3], { min: 0, max: 100, zeroLine: true });
  t.ok('zeroLine is suppressed when the range does not straddle zero', !allPositive.includes('<line'));
}

// --- touchSession archives a real gap, resets the fresh fields -------------

{
  const S = load();
  S.STORE = S.emptyStore();
  const longAgo = Date.now() - S.SESSION_GAP_MS - 60000;
  S.STORE.session = {
    startedAt: longAgo - 3600000, hands: 5, net: 2500000, lastHandAt: longAgo,
    vpip: 3, pfr: 2, aggActions: 4, passActions: 2, bb: 1000000,
  };

  S.touchSession(0, true); // the gap fires: archive the old session, start a new one at hands=1

  t.eq('exactly one session archived', S.STORE.sessionHistory.length, 1);
  const arch = S.STORE.sessionHistory[0];
  t.eq('archived hand count', arch.hands, 5);
  t.eq('archived net chips', arch.netChips, 2500000);
  t.near('netBB derived from the session\'s last-seen bb', arch.netBB, 2.5);
  t.eq('archived vpip', arch.vpip, 3);
  t.eq('archived pfr', arch.pfr, 2);
  t.eq('archived aggActions', arch.aggActions, 4);
  t.eq('archived passActions', arch.passActions, 2);
  t.eq('archived bb', arch.bb, 1000000);

  t.eq('the new session starts fresh, counting only this hand', S.STORE.session.hands, 1);
  t.eq('new session vpip reset', S.STORE.session.vpip, 0);
  t.eq('new session aggActions reset', S.STORE.session.aggActions, 0);
  t.eq('new session bb reset (not set again until a settled hand)', S.STORE.session.bb, 0);

  S.touchSession(0, true); // same session, no gap
  t.eq('no gap means no second archive', S.STORE.sessionHistory.length, 1);
  t.eq('hands accumulate within one session', S.STORE.session.hands, 2);
}

// --- A zero-hand session leaves nothing worth archiving ---------------------

{
  const S = load();
  S.STORE = S.emptyStore();
  const longAgo = Date.now() - S.SESSION_GAP_MS - 60000;
  S.STORE.session = { startedAt: longAgo, hands: 0, net: 0, lastHandAt: longAgo,
    vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0 };
  S.touchSession(0, true);
  t.eq('an empty session is not archived', S.STORE.sessionHistory.length, 0);
}

// --- SESSION_HISTORY_MAX caps the archive, oldest dropped first ------------

{
  const S = load();
  S.STORE = S.emptyStore();
  for (let i = 0; i < S.SESSION_HISTORY_MAX; i++) {
    S.STORE.sessionHistory.push({
      startedAt: i, endedAt: i, hands: 1, netChips: 0, netBB: 0,
      vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0,
    });
  }
  const longAgo = Date.now() - S.SESSION_GAP_MS - 60000;
  S.STORE.session = { startedAt: longAgo, hands: 9, net: 0, lastHandAt: longAgo,
    vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0 };
  S.touchSession(0, true);
  t.eq('history stays capped at SESSION_HISTORY_MAX', S.STORE.sessionHistory.length, S.SESSION_HISTORY_MAX);
  t.eq('the newest entry landed at the end', S.STORE.sessionHistory[S.STORE.sessionHistory.length - 1].hands, 9);
  t.eq('the oldest (startedAt: 0) entry was the one dropped', S.STORE.sessionHistory[0].startedAt, 1);
}

// --- applyHandResults end-to-end: session vpip/pfr/afq/bb from real hands --

{
  const H = load();
  H.STORE = H.emptyStore();
  H.heroXid = 'H';
  H.lastSeenBB = 0;

  const hand = {
    gameId: null, street: 'river', bbAmount: 1000000,
    contributions: { H: 3000000, V: 3000000 },
    dealtInXids: new Set(['H', 'V']),
    countedVpip: new Set(['H', 'V']),
    countedPfr: new Set(['H']),
    winners: [{ xid: 'H', amount: 6000000 }],
    actions: [
      { x: 'H', a: 'raise', amt: 300000, s: 'preflop' },
      { x: 'H', a: 'bet', amt: 1000000, s: 'flop' },
      { x: 'V', a: 'call', amt: 1000000, s: 'flop' },
      { x: 'H', a: 'bet', amt: 1500000, s: 'turn' },
      { x: 'V', a: 'call', amt: 1500000, s: 'turn' },
      { x: 'H', a: 'all-in', amt: 200000, s: 'river' },
      { x: 'V', a: 'call', amt: 200000, s: 'river' },
    ],
    shown: {},
  };
  H.applyHandResults(hand);

  t.eq('session hands counted for hero', H.STORE.session.hands, 1);
  t.eq('session vpip counted (hero played)', H.STORE.session.vpip, 1);
  t.eq('session pfr counted (hero raised preflop)', H.STORE.session.pfr, 1);
  t.eq('session bb captured off the settled hand', H.STORE.session.bb, 1000000);
  // Postflop: bet, bet, all-in — three aggressive actions, zero calls.
  t.eq('aggActions counts bet/raise/all-in postflop', H.STORE.session.aggActions, 3);
  t.eq('passActions has nothing to count yet', H.STORE.session.passActions, 0);

  const hand2 = {
    gameId: null, street: 'flop', bbAmount: 1000000,
    contributions: { H: 500000, V: 1000000 },
    dealtInXids: new Set(['H', 'V']),
    countedVpip: new Set(['H']),
    countedPfr: new Set(),
    winners: [{ xid: 'V', amount: 1500000 }],
    actions: [
      { x: 'H', a: 'call', amt: 500000, s: 'preflop' }, // must not count toward afq
      { x: 'V', a: 'bet', amt: 500000, s: 'flop' },
      { x: 'H', a: 'call', amt: 500000, s: 'flop' },
      { x: 'H', a: 'fold', amt: 0, s: 'turn' }, // must not count toward afq
    ],
    shown: {},
  };
  H.applyHandResults(hand2);
  t.eq('session hands now 2', H.STORE.session.hands, 2);
  t.eq('session vpip now 2 (played both hands)', H.STORE.session.vpip, 2);
  t.eq('session pfr stays 1 (no raise in hand 2)', H.STORE.session.pfr, 1);
  t.eq('a postflop call increments passActions', H.STORE.session.passActions, 1);
  t.eq('a preflop call and a fold leave aggActions untouched', H.STORE.session.aggActions, 3);
}

// --- buildSessionTrendsHtml -------------------------------------------------

{
  const S = load();
  S.STORE = S.emptyStore();
  const empty = S.buildSessionTrendsHtml();
  t.ok('no history explains itself rather than rendering a blank chart', empty.includes('No completed sessions'));

  S.STORE.sessionHistory = [
    { startedAt: Date.now() - 200000, endedAt: Date.now() - 100000, hands: 40, netChips: -2000000, netBB: -2, vpip: 10, pfr: 6, aggActions: 12, passActions: 8, bb: 1000000 },
    { startedAt: Date.now() - 50000, endedAt: Date.now() - 10000, hands: 60, netChips: 6000000, netBB: 6, vpip: 18, pfr: 9, aggActions: 20, passActions: 10, bb: 1000000 },
  ];
  const html = S.buildSessionTrendsHtml();
  t.ok('renders the session table', html.includes('tph-trend-table'));
  t.ok('renders the chart rows', html.includes('tph-trend-row'));
  t.ok('shows a money figure', html.includes('$'));
}

// --- resetHeroStats clears the in-progress session AND the archive ---------

{
  const S = load();
  S.STORE = S.emptyStore();
  S.heroXid = 'H';
  S.STORE.session = { startedAt: 1, hands: 10, net: 5000, lastHandAt: 1, vpip: 4, pfr: 2, aggActions: 6, passActions: 3, bb: 1000000 };
  S.STORE.sessionHistory = [{ startedAt: 1, endedAt: 2, hands: 5, netChips: 0, netBB: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0 }];
  S.resetHeroStats();
  t.eq('session hands zeroed', S.STORE.session.hands, 0);
  t.eq('session vpip zeroed', S.STORE.session.vpip, 0);
  t.eq('session pfr zeroed', S.STORE.session.pfr, 0);
  t.eq('session aggActions zeroed', S.STORE.session.aggActions, 0);
  t.eq('session passActions zeroed', S.STORE.session.passActions, 0);
  // sessionHistory is 100% hero data (every field describes hero's own play),
  // unlike hand HISTORY which resetHeroStats deliberately leaves alone because
  // it still describes opponents too — see the comment on resetHeroStats.
  t.eq('sessionHistory is cleared entirely, unlike hand history', S.STORE.sessionHistory.length, 0);
}

// --- Storage round-trip: a pre-v1.22.0 store loads without NaN --------------

{
  const seed = JSON.stringify({
    version: 3,
    players: {},
    hands: [],
    hero: { hands: 10, netChips: 500, netBB: 2, bbHands: 8 },
    session: { startedAt: 1, hands: 3, net: 100, lastHandAt: 1 }, // no vpip/pfr/aggActions/passActions/bb
    settings: {},
  });
  const S = load({ storageSeed: seed });
  t.eq('an old session object keeps its real fields', S.STORE.session.hands, 3);
  t.eq('a missing vpip backfills to zero, not NaN', S.STORE.session.vpip, 0);
  t.ok('sessionHistory backfills to an array', Array.isArray(S.STORE.sessionHistory));
  t.eq('backfilled sessionHistory starts empty', S.STORE.sessionHistory.length, 0);

  // The exact bug this guards against: incrementing an undefined field.
  S.STORE.session.vpip += 1;
  t.eq('incrementing the backfilled field works, not NaN', S.STORE.session.vpip, 1);
}

process.exit(t.report());
