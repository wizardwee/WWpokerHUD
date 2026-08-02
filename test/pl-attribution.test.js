// Per-opponent P/L attribution. See applyHandResults().
//
// Two properties matter and are easy to break:
//   1. Attribution is by each opponent's NET result, not their contribution.
//      Money you win comes from the players who lost; money you lose goes to
//      the players who won. Exact heads-up, sums to heroDelta multiway.
//   2. heroXid must be bound to a real seat XID. A "name:<username>" pseudo-id
//      is truthy but keys nothing, which froze all P/L at zero up to v0.19.0.
//
// The first block deliberately reproduces that bug rather than only testing the
// fix: the symptom (no P/L anywhere) pointed at the attribution maths and the
// log parser for a long time, and both were fine.

const { load, runner } = require('./harness');

const t = runner('pl-attribution');

function fresh(heroXid) {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = heroXid;
  return T;
}

// Minimum viable hand record. applyHandResults reads these fields directly.
function hand(o) {
  return Object.assign({
    gameId: null,
    street: 'preflop',
    pot: 0,
    contributions: {},
    dealtInXids: new Set(),
    winners: [],
    actions: [{ x: 'x', a: 'fold', amt: 0, s: 'preflop' }], // non-empty so it files to history
    shown: {},
  }, o);
}

const pl = (T, xid) => (T.STORE.players[xid] ? T.STORE.players[xid].plChipsEst : 0);

// Everyone folds to the BB. Hero posts the SB and folds — the case the user
// first reported as "P/L does not include folded pots".
const foldedPot = () => hand({
  dealtInXids: new Set(['3722665', '2587965', '4118257']),
  contributions: { 3722665: 500000, 2587965: 1000000 },
  winners: [{ xid: '2587965', amount: 1500000 }],
  pot: 1500000,
});

// --- The v0.19.0 bug, reproduced -------------------------------------------

{
  // heroXid latched to the pseudo-id while hero's log lines resolved to the
  // real seat XID, so contributions/winnings keyed under one id and heroXid
  // held another.
  const T = fresh('name:Wonkawee');
  T.applyHandResults(foldedPot());

  t.eq('bug: hero netChips frozen', T.STORE.hero.netChips, 0);
  t.eq('bug: winner credited nothing', pl(T, '2587965'), 0);
  t.eq('bug: hero.hands never increments', T.STORE.hero.hands, 0);
  t.ok('bug: hero tracked as their own opponent', !!T.STORE.players['3722665']);
}

// --- Fixed: heroXid bound to a seat ----------------------------------------

{
  const T = fresh('3722665');
  T.applyHandResults(foldedPot());

  t.eq('hero loses the small blind', T.STORE.hero.netChips, -500000);
  t.near('loss charged to the player who took the pot', pl(T, '2587965'), -500000);
  t.near('folder who paid nothing is untouched', pl(T, '4118257'), 0);
  t.eq('hero.hands increments', T.STORE.hero.hands, 1);
  t.near('hero not credited against themself', pl(T, '3722665'), 0);
}

// Hero wins uncontested — the mirror case, and the one that makes the Lifetime
// figure flattering if it goes missing.
{
  const T = fresh('3722665');
  T.applyHandResults(hand({
    dealtInXids: new Set(['3722665', '2587965', '4118257']),
    contributions: { 3722665: 1000000, 2587965: 500000 },
    winners: [{ xid: '3722665', amount: 1500000 }],
    pot: 1500000,
  }));

  t.eq('steal: hero up by the blind taken', T.STORE.hero.netChips, 500000);
  t.near('steal: charged to the SB who paid', pl(T, '2587965'), 500000);
  t.near('steal: nothing charged to the folder', pl(T, '4118257'), 0);
}

// --- Multiway shares sum to heroDelta ---------------------------------------

{
  const T = fresh('H');
  T.applyHandResults(hand({
    dealtInXids: new Set(['H', 'A', 'B', 'C']),
    contributions: { H: 4000000, A: 4000000, B: 1000000, C: 500000 },
    winners: [{ xid: 'H', amount: 9500000 }],
    pot: 9500000,
  }));

  const total = ['A', 'B', 'C'].reduce((s, x) => s + pl(T, x), 0);
  t.eq('multiway: heroDelta is pot minus contribution', T.STORE.hero.netChips, 5500000);
  t.near('multiway: shares sum to heroDelta', total, T.STORE.hero.netChips);
  t.ok('multiway: biggest loser carries the biggest share', pl(T, 'A') > pl(T, 'B'));
}

// The invariant that caught the pre-v0.17.0 bug, where shares were divided by a
// total that included hero's own contribution and so never summed to 1.
{
  let worst = 0;
  const ids = ['H', 'A', 'B', 'C', 'D'];
  for (let i = 0; i < 500; i++) {
    const T = fresh('H');
    const seated = ids.slice(0, 2 + Math.floor(Math.random() * 4));
    const contributions = {};
    let pot = 0;
    seated.forEach((x) => {
      const c = Math.floor(Math.random() * 5e6);
      contributions[x] = c;
      pot += c;
    });
    const winner = seated[Math.floor(Math.random() * seated.length)];
    T.applyHandResults(hand({
      dealtInXids: new Set(seated),
      contributions,
      winners: [{ xid: winner, amount: pot }],
      pot,
    }));
    const total = seated.filter((x) => x !== 'H').reduce((s, x) => s + pl(T, x), 0);
    worst = Math.max(worst, Math.abs(total - T.STORE.hero.netChips));
  }
  t.near(`sweep: 500 random hands sum to heroDelta (worst drift ${worst})`, worst, 0);
}

// --- Winner line with no amount --------------------------------------------

// Torn does not always print a figure. Leaving the winner at 0 would score a
// WIN as losing everything they had contributed.
{
  const T = fresh('H');
  T.applyHandResults(hand({
    dealtInXids: new Set(['H', 'A']),
    contributions: { H: 1000000, A: 1000000 },
    winners: [{ xid: 'H', amount: 0 }],
    pot: 2000000,
  }));
  t.eq('amountless winner falls back to the tracked pot', T.STORE.hero.netChips, 1000000);
}

process.exit(t.report());
