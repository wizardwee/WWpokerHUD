// Bet sizing postflop only, short pots not sized, pots never below what was
// won, and the one-off repair of counts and sizing windows (v1.116.0).
//
// Found checking a real backup: a player's "typically bets X% of pot" was a
// median over preflop raises too, sized against the blinds (an open to 3bb
// reads 200%), so the oversized read fired for 37% of players; and counters
// taken live (VPIP, WTSD, fold-to-3-bet, fold-to-c-bet) ran ahead of the
// hands and opportunities counted at settlement whenever a hand was cut off.

const { load, runner } = require('./harness');

const t = runner('counts-sizing');
const log = (T, lines) => lines.forEach((l) => T.handleLogLine(l));
const P = (T, n) => T.STORE.players['name:' + n];

// Sizing: preflop raises stay out of the window; postflop bets go in.
{
  const T = load();
  T.STORE = T.emptyStore();
  log(T, ['Game aaaaa1 started', 'Ann posted small blind $1,000', 'Bob posted big blind $2,000',
    'Ann raised $4,000 to $6,000', 'Bob called $4,000', 'The flop:  K♠, 7♦, 2♣', 'Bob checked',
    'Ann bet $6,000']);
  t.eq('only the postflop bet is in the sizing window', P(T, 'Ann').betSizes.join(','), '50');
  const open = T.currentHand.actions.find((a) => a.a === 'raise');
  t.ok('the preflop action still carries its size for History', typeof open.p === 'number');
}

// A hand joined part way is not sized: its pot is short.
{
  const T = load();
  T.STORE = T.emptyStore();
  log(T, ['Cat called $10,000', 'The flop:  K♠, 7♦, 2♣', 'Ann bet $50,000', 'Bob called $50,000']);
  t.eq('no size from a hand whose start was not seen', (P(T, 'Ann').betSizes || []).length, 0);
  t.eq('and none on the action either', T.currentHand.actions.find((a) => a.a === 'bet').p, null);
  t.ok('handPotKnown agrees', !T.handPotKnown(T.currentHand));
  // ...and its pot is not stored below what was won from it.
  log(T, ['Ann won $180,000 Did not show hand', 'Game bbbbb2 started']);
  t.eq('a pot is never smaller than what was won from it', T.STORE.hands[0].pot, 180000);
}

// The one-off repair.
{
  const T = load();
  T.STORE = T.emptyStore();
  const rec = (x, over) => Object.assign(T.emptyPlayer(x, x), over);
  T.STORE.players = {
    a: rec('a', { hands: 0, vpip: 1, wtsd: 1, foldTo3BetMade: 2, foldTo3BetOpp: 1, foldToCbetMade: 3, foldToCbetOpp: 0,
      betSizes: [200, 250, 300, 50] }),
    b: rec('b', { hands: 50, vpip: 10, betSizes: [300] }),
  };
  const bet = (x, s, p, a) => ({ x, a: a || 'bet', amt: 1, s, p });
  T.STORE.hands = [   // newest first
    { t: 3, g: 'g3', pot: 10, winners: [{ xid: 'a', amount: 25 }], actions: [bet('a', 'turn', 80)] },
    { t: 2, g: null, pot: 1, winners: [], actions: [bet('a', 'flop', 900)] },          // start unseen
    { t: 1, g: 'g1', pot: 30, winners: [{ xid: 'a', amount: 30 }],
      actions: [bet('a', 'preflop', 200, 'raise'), bet('a', 'flop', 33), bet('b', 'river', 120, 'raise')] },
  ];
  const before = T.STORE.hands[0];
  const res = T.repairCountsAndSizing();
  const a = T.STORE.players.a;
  t.eq('hands raised to the counts taken for them', a.hands, 1);
  t.eq('fold-to-3-bet spots raised to the folds', a.foldTo3BetOpp, 2);
  t.eq('fold-to-c-bet spots raised to the folds', a.foldToCbetOpp, 3);
  t.eq('a sound record is untouched', T.STORE.players.b.hands, 50);
  t.eq('the window is rebuilt postflop-only, oldest first, from seen hands', a.betSizes.join(','), '33,80');
  t.eq('raises count too', T.STORE.players.b.betSizes.join(','), '120');
  t.eq('a stored pot below what was won is raised', T.STORE.hands[0].pot, 25);
  t.ok('as a new object, so it is rewritten', T.STORE.hands[0] !== before);
  t.eq('a sound pot is the same object', T.STORE.hands[2].pot, 30);
  t.eq('counted', `${res.players}/${res.pots}`, '1/1');
  t.eq('runs once', T.repairCountsAndSizing(), null);
}

// Saving now, for when the page goes away: no debounce, same guard.
{
  const T = load();
  T.getPlayer('z').hands = 7;
  T.flushNow();
  t.ok('flushNow writes without waiting for a timer', !!T._sandbox.localStorage.getItem('tornPokerHUD_v1:p:z'));
  T.storeLoadFailed = { at: 1, message: 'x' };
  T.getPlayer('y').hands = 1;
  T.flushNow();
  t.ok('and never after a failed load', !T._sandbox.localStorage.getItem('tornPokerHUD_v1:p:y'));
}

process.exit(t.report());
