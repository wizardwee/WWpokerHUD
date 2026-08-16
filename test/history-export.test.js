// Exporting a player's hand history, plus the two small helpers the panel
// chrome added alongside it.
//
// The property that matters: the History TAB is capped at 40 hands and the Copy
// button takes what the tab is showing, but the EXPORT must take everything.
// An export that silently inherited the display cap would be the kind of loss
// you only discover months later, looking for a hand that was never in the file.

const { load, runner } = require('./harness');

const t = runner('history-export');

// A hand as the parser stores it: `players` is who was dealt in, `actions`
// carry the actor xid, and handsInvolving matches on either.
function hand(i, players, actions) {
  return {
    t: 1700000000000 + i * 60000,
    pot: 7000000,
    street: 'river',
    players,
    actions: actions || [],
    winners: [],
    shown: {},
  };
}

// --- Everything, not the shown 40 --------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players['555'] = T.emptyPlayer('555', 'Villain');
  T.STORE.players['777'] = T.emptyPlayer('777', 'Hero');

  // 120 hands: comfortably past the tab's 40-card render cap.
  for (let i = 0; i < 120; i++) {
    T.STORE.hands.push(hand(i, ['555', '777'], [{ s: 'preflop', x: '555', a: 'called', amt: 1000000 }]));
  }

  const out = T.playerHistoryExport('555');
  t.eq('every hand is exported, not the 40 the tab renders',
    T.handsInvolving('555').length, 120);
  // Each hand's body starts with its bracketed timestamp line.
  t.eq('and all 120 appear in the file', (out.match(/\n?\[/g) || []).length, 120);
  t.ok('the header names the player', out.includes('Villain'));
  t.ok('and the xid, since names can be re-used or unknown', out.includes('555'));
  t.ok('the header states the store-wide cap so the file cannot read as complete',
    /most recent 200 hands/.test(out));
  t.ok('their own actions are marked', out.includes('*Villain called'));
}

// --- Hands they were not in are excluded -------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players['555'] = T.emptyPlayer('555', 'Villain');
  T.STORE.hands.push(hand(1, ['555', '777']));
  T.STORE.hands.push(hand(2, ['888', '777']));
  T.STORE.hands.push(hand(3, ['888', '777'], [{ s: 'flop', x: '555', a: 'bet', amt: 5 }]));

  const out = T.playerHistoryExport('555');
  t.eq('only hands they were dealt into or acted in', (out.match(/\n?\[/g) || []).length, 2);
  t.ok('the count in the header agrees', out.includes('2 hand(s) with this player'));
}

// --- No hands is a file, not a crash -----------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const out = T.playerHistoryExport('999');
  t.ok('an unknown player still produces a readable file', out.includes('(no hands recorded)'));
  t.ok('with a header', out.includes('Torn Poker HUD'));
}

// --- fileSafeName ------------------------------------------------------------
//
// Torn usernames are free text and this ends up in a filename handed to the
// system share sheet. A `/` or a `[` either breaks the save or is dropped.

{
  const T = load();
  t.eq('ordinary names pass through', T.fileSafeName('Wonkawee'), 'Wonkawee');
  t.eq('path separators cannot survive', T.fileSafeName('a/b\\c'), 'a_b_c');
  t.eq('brackets and spaces collapse', T.fileSafeName('[Big Boss]'), 'Big_Boss');
  t.eq('a name of nothing but junk still yields a filename', T.fileSafeName('///'), 'player');
  t.eq('the placeholder id form is usable', T.fileSafeName('#3722665'), '3722665');
  t.ok('and it is bounded', T.fileSafeName('x'.repeat(200)).length <= 40);
}

// --- applySize ---------------------------------------------------------------
//
// The coach panel's resize floor is not cosmetic: the grip lives INSIDE the
// panel, so a panel that could be dragged to nothing would take away the only
// means of getting its size back.

{
  const T = load();
  const el = { style: {} };
  const W = T._sandbox.window.innerWidth;   // 390
  const H = T._sandbox.window.innerHeight;  // 844

  let s = T.applySize(el, 300, 400, T.COACH_MIN_W, T.COACH_MIN_H);
  t.eq('a sensible size is left alone (w)', s.w, 300);
  t.eq('a sensible size is left alone (h)', s.h, 400);
  t.eq('and is written to the element', el.style.width, '300px');

  s = T.applySize(el, 10, 10, T.COACH_MIN_W, T.COACH_MIN_H);
  t.eq('shrinking past the floor stops at the floor (w)', s.w, T.COACH_MIN_W);
  t.eq('shrinking past the floor stops at the floor (h)', s.h, T.COACH_MIN_H);

  s = T.applySize(el, 9999, 9999, T.COACH_MIN_W, T.COACH_MIN_H);
  t.ok('growing past the viewport is clamped to it (w)', s.w <= W);
  t.ok('growing past the viewport is clamped to it (h)', s.h <= H);
  t.ok('with a margin, so it is not flush to the edge', s.w < W && s.h < H);
}

// --- The board, in the hand history (v1.18.0) --------------------------------
//
// hand.board has been persisted since v1.17.0's replayer, but formatHand and
// formatHandHtml never printed it — the actual cards run out were the one
// thing missing from a hand's history entry, next to the bet sizes already
// there. A hand recorded before v1.17.0 has board: undefined, which must
// render as no line at all, not a misleadingly-empty "board: " line.

{
  const T = load();
  const withBoard = { t: 1700000000000, pot: 7000000, street: 'river', pinned: false,
    board: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }, { rank: '2', suit: 'd' }],
    actions: [], winners: [], shown: {} };
  const noBoard = { t: 1700000000000, pot: 7000000, street: 'preflop', pinned: false,
    actions: [], winners: [], shown: {} };

  t.ok('the board appears in the plain-text form',
    T.formatHand(withBoard, null).includes('board: A♠ K♥ 2♦'));
  t.ok('...and in the markup form',
    T.formatHandHtml(withBoard, null).includes('board: <b>A♠ K♥ 2♦</b>'));
  t.eq('a hand with no board data at all gets no board line (plain text)',
    /board:/.test(T.formatHand(noBoard, null)), false);
  t.eq('...and none in markup either', /board:/.test(T.formatHandHtml(noBoard, null)), false);
}

// --- Hero's badge lift -------------------------------------------------------

{
  const T = load();
  t.ok('hero\'s badge is lifted clear of the seat, not nudged',
    T.SELF_BADGE_LIFT_PX >= 3 * T.BADGE_HEIGHT_PX);
}

process.exit(t.report());
