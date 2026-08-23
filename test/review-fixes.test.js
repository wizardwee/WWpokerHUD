// Regressions from the v1.25.0 code review. Four separate bugs, three of
// them in the session/sizing code that shipped across v1.21.0-v1.22.0.
//
// The fourth (a remembered 'trends' tab rendering a blank panel body when
// isSelf flips false) is fixed in renderPlayerPanel but is NOT covered here:
// driving it needs renderPlayerPanelBody's nested `.tph-tab-body` lookup
// against real parsed markup, and the harness's DOM stub matches flat single
// classes only. Same reasoning as the note in test/panel.test.js.

const { load, runner } = require('./harness');

const t = runner('review-fixes');

// --- 1. The sizing sample gate must read the window, not the lifetime count -
//
// v1.21.0 replaced betSizePctSum with betSizes but did not bump STORE_VERSION
// or add a migration, so ensurePlayerShape backfills betSizes EMPTY on every
// pre-existing record while betSizeCount keeps its full historical value.
// Gating on betSizeCount let a single new bet through BET_SIZE_MIN and then
// reported it as "median of 247 bets".

{
  const T = load();
  const p = T.getPlayer('V1');

  // Exactly the shape ensurePlayerShape leaves a pre-v1.21.0 record in.
  p.betSizeCount = 247;
  p.betSizes = [];

  t.eq('a migrated record contributes no sizing sample', T.betSizeSample(p), 0);
  t.eq('and therefore has no median to report', T.computeRates(p).medianBetPct, null);

  // One new bet lands. betSizeCount clears BET_SIZE_MIN comfortably; the
  // window does not, and the window is what the median comes from.
  T.noteBetSizing('V1', 320, 100); // a 320%-of-pot all-in shove
  t.eq('lifetime count keeps counting', p.betSizeCount, 248);
  t.eq('but the sizing sample is 1', T.betSizeSample(p), 1);
  t.eq('median is that single shove', T.computeRates(p).medianBetPct, 320);
  t.ok('the sizing sample is below the gate, even though betSizeCount is far above it',
    T.betSizeSample(p) < T.BET_SIZE_MIN && p.betSizeCount > T.BET_SIZE_MIN);

  // The actual regression: no sizing entry may be surfaced off that one bet.
  const sizing = T.buildExploitPlan(p).filter((e) => e.tag === 'Sizing');
  t.eq('no sizing read is surfaced from a one-bet sample', sizing.length, 0);
}

{
  // ...and once the window itself clears the gate, the read comes back, with
  // the count it actually used.
  const T = load();
  T.getPlayer('V2');
  for (let i = 0; i < T.BET_SIZE_MIN; i += 1) T.noteBetSizing('V2', 300, 100);
  const p = T.getPlayer('V2');
  t.eq('window now at the gate', T.betSizeSample(p), T.BET_SIZE_MIN);
  const sizing = T.buildExploitPlan(p).filter((e) => e.tag === 'Sizing');
  t.eq('a sizing read is surfaced once the window is genuinely deep enough', sizing.length, 1);
  t.ok('and it quotes the window sample, not a larger lifetime figure',
    sizing[0].text.includes(`median of ${T.BET_SIZE_MIN} bets`));
}

{
  // The window is capped, so the quoted sample must never exceed the cap even
  // when lifetime runs far past it.
  const T = load();
  T.getPlayer('V3');
  for (let i = 0; i < T.BET_SIZE_HISTORY_MAX + 25; i += 1) T.noteBetSizing('V3', 300, 100);
  const p = T.getPlayer('V3');
  t.eq('window is capped', T.betSizeSample(p), T.BET_SIZE_HISTORY_MAX);
  t.eq('lifetime keeps the true total', p.betSizeCount, T.BET_SIZE_HISTORY_MAX + 25);
}

// --- 2. An ended session must archive on READ, not only on the next hand ----
//
// archiveSession only ran from touchSession, which only runs on a settled
// hand — so a session you simply stopped playing sat unarchived and invisible
// to the Trends tab until you sat back down.

{
  const T = load();
  const s = T.STORE.session;
  s.startedAt = Date.now() - (T.SESSION_GAP_MS + 60000) * 2;
  s.lastHandAt = Date.now() - (T.SESSION_GAP_MS + 60000);
  s.hands = 42;
  s.net = 5000000;
  s.bb = 1000000;

  t.eq('nothing archived yet', T.STORE.sessionHistory.length, 0);
  t.eq('the gap has elapsed, so a read rolls it', T.maybeRollSession(), true);
  t.eq('the finished session is now in the archive', T.STORE.sessionHistory.length, 1);
  t.eq('with its hands intact', T.STORE.sessionHistory[0].hands, 42);
  t.eq('and the live session is cleared', T.STORE.session.hands, 0);
  t.eq('startedAt cleared, so the next hand opens a fresh session', T.STORE.session.startedAt, 0);

  // Idempotent: a second read must not archive an empty session on top.
  t.eq('a second roll does nothing', T.maybeRollSession(), false);
  t.eq('and does not duplicate the entry', T.STORE.sessionHistory.length, 1);
}

{
  // A session still inside its gap is left completely alone.
  const T = load();
  const s = T.STORE.session;
  s.startedAt = Date.now() - 60000;
  s.lastHandAt = Date.now() - 1000;
  s.hands = 7;
  t.eq('a live session does not roll', T.maybeRollSession(), false);
  t.eq('and is not archived', T.STORE.sessionHistory.length, 0);
  t.eq('and keeps its hands', T.STORE.session.hands, 7);
}

{
  // The Trends tab itself must trigger that roll — this is the user-visible
  // half of the bug: open Trends the morning after and last night is missing.
  const T = load();
  const s = T.STORE.session;
  s.startedAt = Date.now() - (T.SESSION_GAP_MS + 60000) * 2;
  s.lastHandAt = Date.now() - (T.SESSION_GAP_MS + 60000);
  s.hands = 30;
  s.net = -2000000;
  s.bb = 1000000;

  const html = T.buildSessionTrendsHtml();
  t.eq('rendering Trends archived the finished session', T.STORE.sessionHistory.length, 1);
  t.ok('so the tab renders it rather than the empty-state message',
    !html.includes('No completed sessions yet'));
}

// --- 3. A session with no readable blind is UNKNOWN in bb, not break-even ---
//
// Torn's BB-display mode makes plausibleBB refuse every blind, so session.bb
// stays 0. Storing netBB 0 there charted a big winning or losing session as an
// exact flat point.

{
  const T = load();
  t.eq('no blind means no bb figure', T.sessionNetBB({ bb: 0, netBB: 0, hands: 50 }), null);
  t.eq('a legacy row storing 0 with no blind is also unknown, no migration needed',
    T.sessionNetBB({ bb: 0, netBB: 0 }), null);
  t.eq('an explicit null is unknown', T.sessionNetBB({ bb: 1000000, netBB: null }), null);
  t.eq('a real figure survives', T.sessionNetBB({ bb: 1000000, netBB: -12.5 }), -12.5);
  t.eq('a genuine break-even session with a known blind is still 0, not unknown',
    T.sessionNetBB({ bb: 1000000, netBB: 0 }), 0);
}

{
  // archiveSession must write null, not 0, for a blind it never read.
  const T = load();
  T.archiveSession({ startedAt: 1, lastHandAt: 2, hands: 60, net: 900000000, bb: 0,
    vpip: 20, pfr: 10, aggActions: 5, passActions: 5 });
  const rec = T.STORE.sessionHistory[0];
  t.eq('netBB is null, not a fabricated 0', rec.netBB, null);
  t.eq('the chip figure is still exact', rec.netChips, 900000000);
  t.eq('and it reads back as unknown', T.sessionNetBB(rec), null);
}

{
  // The whole window being blind-less must not throw — the bb charts end up
  // with an EMPTY series, which an unguarded values[values.length-1].toFixed
  // would turn into a TypeError that takes the tab down.
  const T = load();
  for (let i = 0; i < 3; i += 1) {
    T.archiveSession({ startedAt: i + 1, lastHandAt: i + 2, hands: 20, net: 5000000, bb: 0,
      vpip: 5, pfr: 2, aggActions: 3, passActions: 3 });
  }
  let html = null;
  try { html = T.buildSessionTrendsHtml(); } catch (e) { html = 'THREW: ' + e.message; }
  t.ok('a window with no readable blind anywhere still renders', html && !html.startsWith('THREW'));
  t.ok('and says why the bb charts are empty', html.includes('no readable blind'));
  t.ok('while still reporting the chip result', html.includes('$'));
}

process.exit(t.report());
