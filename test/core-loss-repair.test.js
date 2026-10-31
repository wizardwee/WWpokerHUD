// Repairing a store whose core record was lost (v1.115.0).
//
// On 27 Oct a load came back without core; the HUD saved defaults over it.
// Hero's lifetime totals restarted at zero while the P/L ledger kept every
// row (20,000 rows, +$19.5B, against "297 hands, -$126M"), and the one-off
// backfills - their flags live in core - ran again over every stored hand.
// The double count is produced here by the REAL backfills run twice, and the
// repair must land exactly on the store where they ran once.

const { load, runner } = require('./harness');

const t = runner('core-loss-repair');
const C = (s) => ({ rank: s[0], suit: s[1] });
const BOARD = ['Ks', '7s', '2s', '9d', '4c'].map(C);
// A barrel spot on a three-flush board: A opens, bets flop and turn, B calls
// the flop and folds the turn.
const spot = (t0, g) => ({
  t: t0, g, players: ['A', 'B'], board: BOARD, winners: [{ xid: 'A', amount: 10 }], shown: {},
  actions: [
    { x: 'A', a: 'raise', amt: 3, s: 'preflop' }, { x: 'B', a: 'call', amt: 3, s: 'preflop' },
    { x: 'A', a: 'bet', amt: 4, s: 'flop' }, { x: 'B', a: 'call', amt: 4, s: 'flop' },
    { x: 'A', a: 'bet', amt: 8, s: 'turn' }, { x: 'B', a: 'fold', amt: 0, s: 'turn' },
  ],
});

function build(doubled) {
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players = { A: T.emptyPlayer('A', 'Ay'), B: T.emptyPlayer('B', 'Bee') };
  const before = [spot(100, 'g1'), spot(200, 'g2')];
  const after = spot(900, 'g3');
  T.STORE.hands = [after].concat(before.slice().reverse());   // newest first
  T.STORE.boardTexBackfilled = false;
  T.STORE.barrelBackfilled = false;
  T.backfillBoardTexture();
  T.backfillBarrels();
  if (doubled) {
    // The load that lost core: the flags were gone, and the backfills ran
    // again over the hands stored at the time.
    const all = T.STORE.hands;
    T.STORE.hands = all.filter((h) => h.t < 900);
    T.STORE.boardTexBackfilled = false;
    T.STORE.barrelBackfilled = false;
    T.backfillBoardTexture();
    T.backfillBarrels();
    T.STORE.hands = all;
  }
  T.STORE.plLedger = [
    { t: 100, d: 1000, b: 100, g: 'g1' }, { t: 200, d: -200, b: 100, g: 'g2' }, { t: 900, d: 50, b: 100, g: 'g3' },
  ];
  // Totals as the lost core left them: one hand played since.
  T.STORE.hero = { hands: 1, netChips: 50, netBB: 0.5, bbHands: 1, xid: 'H' };
  return T;
}

const counts = (T) => JSON.stringify(['A', 'B'].map((x) => [T.STORE.players[x].boardTex, T.STORE.players[x].barrel]));

{
  const bad = build(true);
  const good = build(false);
  t.ok('the fixture really doubles the counts', counts(bad) !== counts(good));
  t.eq('the signature is found', !!bad.coreLossSignature(), true);
  t.eq('and dates the loss to the first hand counted since', bad.coreLossSignature().at, 900);
  const res = bad.repairCoreLoss();
  t.ok('repaired', res && res.found);
  t.eq('board texture and barrels are as if the backfills ran once', counts(bad), counts(good));
  t.eq('hero totals are rebuilt from the ledger',
    JSON.stringify([bad.STORE.hero.hands, bad.STORE.hero.netChips, bad.STORE.hero.bbHands, bad.STORE.hero.netBB]),
    JSON.stringify([3, 850, 3, 8.5]));
  t.eq('identity is kept', bad.STORE.hero.xid, 'H');
  t.eq('runs once', bad.repairCoreLoss(), null);
}

// Healthy stores must never match.
{
  const T = build(false);
  T.STORE.hero = { hands: 3, netChips: 850, netBB: 8.5, bbHands: 3, xid: 'H' };
  t.eq('a ledger no longer than hero\'s hands is healthy', T.coreLossSignature(), null);
  T.STORE.hero = { hands: 2, netChips: 9999, netBB: 0, bbHands: 2, xid: 'H' };
  t.eq('a ledger a little wider than the hands (pre-v1.78.0) is healthy when its tail does not sum to the total',
    T.coreLossSignature(), null);
  const before = counts(T);
  T.repairCoreLoss();
  t.eq('so nothing is touched', counts(T) + T.STORE.hero.netChips, before + 9999);
  t.eq('and the check is not repeated', T.repairCoreLoss(), null);
}

process.exit(t.report());
