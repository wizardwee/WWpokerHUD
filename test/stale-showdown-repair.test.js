// The one-off repair of showdowns recorded twice (v1.113.0).
//
// Until v1.113.0 the seat poll read the previous hand's showdown, still face
// up as the next hand opened, into that next hand. repairStaleShowdowns takes
// those reveals out of History and gives back every counter they reached.
//
// The buggy stored shape is produced by the REAL settlement path, not written
// by hand: hand 2's seat goes face down between hands (which clears the live
// guard) and then shows the same pair again, which is exactly what the old
// code banked. The repaired record is then compared against a control run in
// which hand 2 never showed anything — so the test asserts "as if it never
// happened", not a copy of the undo arithmetic.

const { load, runner } = require('./harness');

const t = runner('stale-showdown-repair');

function cardEl(label) {
  return { tagName: 'DIV', className: 'c', getAttribute: (k) => (k === 'aria-label' ? label : null) };
}
// A seat whose name element carries the player's name, so the log's actor
// names resolve to the same xid the seat poll reads off the element id.
function seatEl(id, name) {
  const el = {
    tagName: 'DIV', id, className: 'opponent___q', classList: ['opponent___q'], textContent: name,
    cards: [],
    querySelector: (sel) => (/name_/.test(sel) ? { textContent: name } : null),
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
  el.querySelectorAll = (sel) => (/front_/.test(sel) ? el.cards : []);
  return el;
}

const VIL = '111';      // shows in hand 1, repeated into hand 2 where they folded
const WIN = '222';      // wins hand 2 uncontested, the repeat credited as a win

// Two hands through the real log parser and seat poll. `stale` decides
// whether hand 2 carries the repeated reveals the pre-v1.113.0 poll recorded.
function scenario(stale) {
  const vil = seatEl('player-' + VIL, 'Vilma');
  const win = seatEl('player-' + WIN, 'Winsome');
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = '311421';
  T.STORE.hero.xid = '311421';
  const doc = T._sandbox.document;
  doc.querySelectorAll = (sel) => (/player-/.test(sel) ? [vil, win] : []);
  doc.querySelector = () => null;
  const show = () => {
    vil.cards = [cardEl('ace of diamonds'), cardEl('ace of spades')];
    win.cards = [cardEl('king of hearts'), cardEl('7 of hearts')];
  };
  const hide = () => { vil.cards = []; win.cards = []; };
  const log = (lines) => lines.forEach((l) => T.handleLogLine(l));

  // Hand 1: a 3-bet pot to the river, both show, Vilma wins.
  log(['Game aaaaa1 started', 'Winsome posted small blind $1,000', 'Vilma posted big blind $2,000',
    'Winsome raised $4,000 to $6,000', 'Vilma raised $12,000 to $18,000', 'Winsome called $12,000',
    'The flop:  K♠, 7♦, 2♣', 'Vilma bet $20,000', 'Winsome called $20,000',
    'The turn:  3♥', 'Vilma checked', 'Winsome checked',
    'The river:  4♣', 'Vilma checked', 'Winsome checked']);
  show();
  T.harvestShownCards(true);
  log(['Vilma won $76,000']);

  // Hand 2 opens with those cards still up; the deal turns them face down.
  log(['Game aaaaa2 started']);
  hide();
  T.harvestShownCards(true);
  // Vilma opens, Winsome 3-bets, Vilma calls, then folds to the flop bet.
  log(['Vilma posted small blind $1,000', 'Winsome posted big blind $2,000',
    'Vilma raised $4,000 to $6,000', 'Winsome raised $12,000 to $18,000', 'Vilma called $12,000',
    'The flop:  K♣, 7♠, 9♦', 'Vilma checked', 'Winsome bet $20,000', 'Vilma folded']);
  // The pre-v1.113.0 poll: the same pairs read into this hand.
  if (stale) { show(); T.harvestShownCards(true); hide(); }
  log(['Winsome won $56,000 Did not show hand', 'Game aaaaa3 started']);
  return T;
}

const pick = (p) => JSON.parse(JSON.stringify({
  shownHands: p.shownHands, sdRecent: p.sdRecent, wtsd: p.wtsd, texture: p.texture,
}));

{
  const bad = scenario(true);
  const ctl = scenario(false);
  t.eq('the fixture really reproduces the bug: hand 2 stored two reveals',
    Object.keys(bad.STORE.hands[0].shown).length, 2);
  t.ok('and banked them: the AA counted twice', bad.STORE.players[VIL].shownHands.AA.seen === 2);
  t.ok('and the winner scored a win at showdown in a hand nobody showed',
    bad.STORE.players[WIN].shownHands.K7s.won === 1);

  t.eq('and the repeat was banked at hand 2\'s tier, a 3-bet', bad.STORE.players[WIN].shownHands.K7s.r3, 1);

  const oldHand = bad.STORE.hands[0];
  const res = bad.repairStaleShowdowns();
  t.eq('both reveals found', res.reveals, 2);
  t.eq('in one hand', res.hands, 1);
  t.eq('History no longer shows them', Object.keys(bad.STORE.hands[0].shown).length, 0);
  t.eq('or where they came from', Object.keys(bad.STORE.hands[0].shownVia).length, 0);
  t.ok('the hand is a new object, so the saved copy is rewritten', bad.STORE.hands[0] !== oldHand);
  t.eq('the showdown hand itself is untouched', Object.keys(bad.STORE.hands[1].shown).length, 2);
  t.eq('the fixture really ran the log: hand 1 is a 3-bet pot', bad.STORE.players[VIL].shownHands.AA.r3, 1);

  [VIL, WIN].forEach((x) => {
    t.eq(`${x}: record is as if the repeat never happened`,
      JSON.stringify(pick(bad.STORE.players[x])), JSON.stringify(pick(ctl.STORE.players[x])));
  });
  t.ok('the fixture reached bet texture (else the comparison above is vacuous there)',
    scenario(true).STORE.players[WIN].texture.madeBets > ctl.STORE.players[WIN].texture.madeBets);
  t.ok('and the recent-showdown window (else vacuous there too)',
    scenario(true).STORE.players[VIL].sdRecent.length === 2);
  t.eq('runs once', bad.repairStaleShowdowns(), null);
}

// What it must leave alone.
{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hero.xid = '311421';
  const mk = (t0, shown, via) => ({ t: t0, g: null, actions: [], winners: [], players: [], shown, shownVia: via, board: [] });
  T.STORE.hands = [
    mk(3000, { 5: 'A♦ A♠', 6: 'K♥ Q♥', 311421: 'J♣ J♦', 7: '9♣ 9♦' }, { 5: 'log', 6: 'seat', 311421: 'seat', 7: 'seat' }),
    mk(2000, { 5: 'A♠ A♦', 6: 'K♥ Q♦', 311421: 'J♦ J♣' }, { 5: 'seat', 6: 'seat', 311421: 'seat' }),
  ];
  const res = T.repairStaleShowdowns();
  t.eq('a log-caught repeat, different cards, hero, and a new player are all kept', res.reveals, 0);
  t.eq('so nothing in History changes', Object.keys(T.STORE.hands[0].shown).length, 4);
}

// Same-millisecond hands: STORE.hands is newest first, so the tie goes to the
// higher index as the older hand.
{
  const T = load();
  T.STORE = T.emptyStore();
  const mk = (shown) => ({ t: 5000, g: null, actions: [], winners: [], players: [], shown, shownVia: { 5: 'seat' }, board: [] });
  T.STORE.hands = [mk({ 5: 'A♦ A♠' }), mk({ 5: 'A♦ A♠' })];
  T.repairStaleShowdowns();
  t.eq('the newer of two same-time hands loses the repeat', Object.keys(T.STORE.hands[0].shown).length, 0);
  t.eq('the older keeps it', Object.keys(T.STORE.hands[1].shown).length, 1);
}

process.exit(t.report());
