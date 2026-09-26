// v1.89.0: "Session" is this SITTING. It used to end only after a 4h gap, so
// it summed every table since the last long break — reported as +$5.1B over
// 617 hands straight after sitting down. It now also ends when you move
// tables, decided by the same roster check as the "New table" message.
// v1.91.0: only straight after play. After any break, time decides.

const { load, runner } = require('./harness');

const t = runner('sitting-session');

// --- sittingChanged, pure ------------------------------------------------------
{
  const T = load();
  const A = ['1', '2', '3', '4'];
  const B = ['5', '6', '7', '8'];
  const JUST = 30000; // last hand 30s ago
  t.eq('"changed" (half the seats turned over) is the same table', T.sittingChanged('changed', false, A, B, JUST), false);
  t.eq('no announcement, no change', T.sittingChanged(null, false, A, B, JUST), false);
  t.eq('a new roster straight after play: moved', T.sittingChanged('new', false, A, B, JUST), true);
  t.eq('a blind change: moved, whatever the roster', T.sittingChanged('new', true, A, A, JUST), true);
  t.eq('...even after a break', T.sittingChanged('new', true, A, A, 3600000), true);
  t.eq('same table (a reload): kept', T.sittingChanged('new', false, A, ['1', '2', '3', '9'], JUST), false);
  t.eq('first roster ever (nothing stored): kept', T.sittingChanged('new', false, undefined, B, JUST), false);
  // v1.91.0: after a break, time decides — turnover is not a move.
  const W = T.TABLE_MOVE_WINDOW_MS;
  t.eq('full turnover after a break past the window: kept', T.sittingChanged('new', false, A, B, W + 1000), false);
  t.eq('full turnover just inside the window: moved', T.sittingChanged('new', false, A, B, W - 1000), true);
  t.eq('no hand played this sitting (unknown recency): kept', T.sittingChanged('new', false, A, B, -1), false);
  t.ok('the window is short next to the 2-hour gap', W > 0 && W * 6 <= T.SESSION_GAP_MS);
}

// --- the flow: a session rolls when you move, and survives a same-table read --
{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.session.startedAt = Date.now() - 1000;
  T.STORE.session.lastHandAt = Date.now() - 500;
  T.STORE.session.hands = 617;
  T.STORE.session.net = 5.1e9;

  // A pre-v1.89.0 session (no roster) spans tables by construction: closed once.
  const A = ['1', '2', '3', '4'];
  T.noteTableForAnnounce(A); T.noteTableForAnnounce(A);
  t.eq('a legacy session is closed on the first settled roster', T.STORE.session.hands, 0);
  t.eq('...and archived', T.STORE.sessionHistory.length, 1);
  // Sitting here now.
  T.STORE.session.startedAt = Date.now() - 1000;
  T.STORE.session.lastHandAt = Date.now() - 500;
  T.STORE.session.hands = 617;
  T.STORE.session.net = 5.1e9;
  t.eq('...and is stored with it', T.STORE.session.roster.join(','), A.join(','));

  const B = ['5', '6', '7', '8'];
  T.noteTableForAnnounce(B); T.noteTableForAnnounce(B);
  t.eq('moving tables ends the session', T.STORE.session.hands, 0);
  t.eq('...and archives it', T.STORE.sessionHistory.length, 2);
  t.eq('...with its result', T.STORE.sessionHistory[1].netChips, 5.1e9);
  t.eq('the new roster is kept for the next check', T.STORE.session.roster.join(','), B.join(','));
}

// A fresh store's first roster ends nothing (no hands yet).
{
  const T = load();
  T.STORE = T.emptyStore();
  T.noteTableForAnnounce(['1', '2', '3']); T.noteTableForAnnounce(['1', '2', '3']);
  t.eq('a fresh store archives nothing', (T.STORE.sessionHistory || []).length, 0);
}

// A reload at the same table: the stored roster says it is the same sitting.
{
  const T = load();
  T.STORE = T.emptyStore();
  Object.assign(T.STORE.session, { startedAt: Date.now() - 1000, lastHandAt: Date.now(), hands: 12, net: 5, roster: ['1', '2', '3', '4'] });
  T.noteTableForAnnounce(['1', '2', '3', '4']); T.noteTableForAnnounce(['1', '2', '3', '4']);
  t.eq('a reload at the same table keeps the session', T.STORE.session.hands, 12);
}

// v1.90.0: refreshes and short disconnects are the same sitting; the break
// that ends one is Torn's own 2-hour same-table rule.
{
  const T = load();
  t.ok('the gap is Torn\'s 2-hour rule (with a small margin)',
    T.SESSION_GAP_MS >= 2 * 3600000 && T.SESSION_GAP_MS <= 2.5 * 3600000);

  // A reload after a 15-minute drop, three of eight seats changed meanwhile.
  const before = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const after = ['1', '2', '3', '4', '5', '9', '10', '11'];
  T.STORE = T.emptyStore();
  Object.assign(T.STORE.session, {
    startedAt: Date.now() - 3600000, lastHandAt: Date.now() - 15 * 60000, hands: 80, net: 1, roster: before,
  });
  T.noteTableForAnnounce(after); T.noteTableForAnnounce(after);
  t.eq('back after 15 minutes with some new faces: same sitting', T.STORE.session.hands, 80);
  t.eq('...and nothing archived', (T.STORE.sessionHistory || []).length, 0);

  // v1.91.0: back after 15 minutes to a table that turned over COMPLETELY.
  // Still under Torn's 2 hours at that table, so still the same sitting.
  const others = ['21', '22', '23', '24', '25', '26', '27', '28'];
  T.STORE.session.lastHandAt = Date.now() - 15 * 60000;
  T.noteTableForAnnounce(others); T.noteTableForAnnounce(others);
  t.eq('back after 15 minutes to all new faces: same sitting', T.STORE.session.hands, 80);
  t.eq('...still nothing archived', (T.STORE.sessionHistory || []).length, 0);

  // Idle past the gap: the next check closes it.
  Object.assign(T.STORE.session, { lastHandAt: Date.now() - T.SESSION_GAP_MS - 60000 });
  t.ok('a break longer than the gap ends the sitting', T.maybeRollSession());
  t.eq('...and archives it', T.STORE.sessionHistory.length, 1);

  // Just inside the gap it does not.
  T.STORE = T.emptyStore();
  Object.assign(T.STORE.session, {
    startedAt: Date.now() - 3600000, lastHandAt: Date.now() - (T.SESSION_GAP_MS - 60000), hands: 5, net: 1,
  });
  t.eq('a break just inside the gap keeps it', T.maybeRollSession(), false);
}

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('the panel calls it this sitting', /tph-stat-l">This sitting</.test(src));

process.exit(t.report());
