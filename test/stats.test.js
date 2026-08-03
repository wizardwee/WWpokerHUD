// Stats added or corrected in v0.23.0: bb denomination, fold-to-c-bet,
// per-street splits, and limp frequency.
//
// The theme is that most of this was already being collected. streetActions has
// always held per-street counts that computeRates collapsed into one number,
// and foldToCbetMade/Opp were written from the day C-bets were tracked and
// displayed nowhere.

const { load, runner } = require('./harness');

const t = runner('stats');
const T = load();
T.STORE = T.emptyStore();

function player(o) {
  return Object.assign(T.emptyPlayer('x', 'Test'), o);
}
function street(o) {
  return Object.assign({ bet: 0, raise: 0, call: 0, check: 0, fold: 0 }, o);
}

// --- Big blind denomination -------------------------------------------------

t.eq('fmtBB signs a win', T.fmtBB(12.3), '+12.3bb');
t.eq('fmtBB signs a loss', T.fmtBB(-4.5), '-4.5bb');
t.eq('fmtBB drops decimals when large', T.fmtBB(250.4), '+250bb');
t.eq('fmtBB handles nothing', T.fmtBB(null), '—');

// A win rate below the noise floor must not be quoted as if it meant something.
t.ok('bb/100 withheld under the sample floor', /need \d+\+ hands/.test(T.fmtBB100(50, 10)));
t.eq('bb/100 quoted with enough hands', T.fmtBB100(50, 100), '+50.0 bb/100');
t.eq('bb/100 signs a losing rate', T.fmtBB100(-20, 200), '-10.0 bb/100');

// --- Hero shape backfill ----------------------------------------------------

// A 0.22.0 store has {hands, netChips} only. Leaving netBB undefined would make
// every `+=` produce NaN and poison the figure permanently.
const oldHero = T.ensureHeroShape({ hands: 200, netChips: 5000 });
t.eq('existing hero fields survive', oldHero.hands, 200);
t.eq('netBB backfilled to zero', oldHero.netBB, 0);
t.eq('bbHands backfilled to zero', oldHero.bbHands, 0);
t.eq('a NaN is repaired', T.ensureHeroShape({ netBB: NaN }).netBB, 0);
t.eq('a missing hero is created', T.ensureHeroShape(undefined).netChips, 0);

// --- P/L accrues in both units ----------------------------------------------

{
  const H = load();
  H.STORE = H.emptyStore();
  H.heroXid = 'H';
  H.lastSeenBB = 0;

  const hand = {
    gameId: null, street: 'preflop', pot: 3000000,
    bbAmount: 1000000,
    contributions: { H: 500000, V: 1000000 },
    dealtInXids: new Set(['H', 'V']),
    winners: [{ xid: 'V', amount: 1500000 }],
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'preflop' }],
    shown: {},
  };
  H.applyHandResults(hand);

  t.eq('chips: hero loses the small blind', H.STORE.hero.netChips, -500000);
  t.near('bb: same loss at 1M blinds is 0.5bb', H.STORE.hero.netBB, -0.5);
  t.eq('bb hand counted', H.STORE.hero.bbHands, 1);
  t.near('opponent P/L in chips', H.STORE.players.V.plChipsEst, -500000);
  t.near('opponent P/L in bb', H.STORE.players.V.plBBEst, -0.5);
}

// A hand with no readable blind must not corrupt the bb figures with NaN or
// Infinity — it simply doesn't contribute to the win rate.
{
  const H = load();
  H.STORE = H.emptyStore();
  H.heroXid = 'H';
  H.lastSeenBB = 0;

  H.applyHandResults({
    gameId: null, street: 'preflop', pot: 200, bbAmount: 0,
    contributions: { H: 100, V: 100 },
    dealtInXids: new Set(['H', 'V']),
    winners: [{ xid: 'V', amount: 200 }],
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'preflop' }],
    shown: {},
  });

  t.eq('chips still recorded without a blind', H.STORE.hero.netChips, -100);
  t.eq('bb stays exactly zero, not NaN', H.STORE.hero.netBB, 0);
  t.eq('unpriced hand excluded from the win-rate denominator', H.STORE.hero.bbHands, 0);
  t.eq('opponent bb stays zero', H.STORE.players.V.plBBEst, 0);
}

// --- Fold to c-bet, previously collected and never shown --------------------

const cb = player({ hands: 100, cbetMade: 40, cbetOpp: 100, foldToCbetMade: 30, foldToCbetOpp: 50 });
t.eq('fold-to-c-bet is now computed', T.computeRates(cb).foldToCbet, 60);
t.ok('and is shrunk toward the pool for classification',
  T.computeShrunkRates(cb).foldToCbet !== 60);
t.eq('no opportunities reports nothing', T.computeRates(player({})).foldToCbet, null);

// --- Per-street splits ------------------------------------------------------

const splitter = player({
  hands: 100,
  streetActions: {
    flop: street({ bet: 40, call: 5, check: 5, fold: 0 }),   // very aggressive
    turn: street({ bet: 2, call: 8, check: 10, fold: 20 }),  // gives up
    river: street({ bet: 1, call: 1, check: 2, fold: 6 }),
  },
});
const sr = T.computeRates(splitter);

t.near('flop aggression is high', sr.byStreet.flop.afq, (100 * 40) / 45);
t.near('turn aggression is low', sr.byStreet.turn.afq, (100 * 2) / 10);
t.ok('the split reveals a gap the aggregate hides', sr.byStreet.flop.afq - sr.byStreet.turn.afq > 20);
t.eq('flop action count', sr.byStreet.flop.actions, 50);
t.near('turn fold frequency', sr.byStreet.turn.foldPct, 50);

// The aggregate that used to be the only number available.
t.ok('aggregate AFq sits between the streets',
  sr.afq < sr.byStreet.flop.afq && sr.afq > sr.byStreet.turn.afq);

t.eq('a street with no actions reports nothing', T.streetRates(street({})).afq, null);
t.eq('missing street data does not throw', T.streetRates(null).afq, null);

// --- Limp frequency ---------------------------------------------------------

const limper = player({ hands: 100, vpip: 60, pfr: 5, limpMade: 40 });
const lr = T.computeRates(limper);
t.eq('limp per hand', lr.limp, 40);
t.near('limp as a share of VPIP', lr.limpShareOfVpip, (100 * 40) / 60);

const raiser = player({ hands: 100, vpip: 30, pfr: 28, limpMade: 1 });
t.ok('a raiser limps a far smaller share of their VPIP',
  T.computeRates(raiser).limpShareOfVpip < lr.limpShareOfVpip);

// --- P/L shown in both units ------------------------------------------------

// Big blinds lead because they're comparable across stakes; chips go underneath
// because that's what's actually in front of you.
{
  const both = T.plShort(player({ plChipsEst: 41000000, plBBEst: 16.4 }));
  t.ok('big blinds lead', both.indexOf('16.4bb') < both.indexOf('$41M'));
  t.ok('chips are shown too', both.includes('$41M'));
  t.ok('the chip figure is the quiet one', both.includes('tph-pl-sub'));
}

// A player tracked before 0.23.0 has real chip P/L and a zero bb figure.
// "+0.0bb" would read as "flat against them" rather than "not measured yet",
// so the chip figure is promoted and no bb figure is shown at all.
{
  const legacy = T.plShort(player({ plChipsEst: -12500000, plBBEst: 0 }));
  t.ok('chips are promoted when there is no bb data', legacy.includes('-$12.5M'));
  t.ok('no misleading zero-bb figure', !legacy.includes('bb'));
  t.ok('and no second line', !legacy.includes('tph-pl-sub'));
}

// A genuinely tiny bb figure is treated as absent for the same reason.
{
  const tiny = T.plShort(player({ plChipsEst: 5000, plBBEst: 0.01 }));
  t.ok('a rounding-error bb figure is not shown', !tiny.includes('bb'));
}

// --- The WTSD anchor is gone ------------------------------------------------

// It was mapped from the source's `wwsf` (won when saw flop), a different stat.
// WTSD is now left unshrunk rather than pulled toward an unrelated number.
t.eq('POOL_AVG carries no WTSD figure', T.POOL_AVG.wtsd, undefined);
t.eq('POOL_AVG carries fold-to-c-bet instead', T.POOL_AVG.foldToCbet, 56.1);
t.ok('POOL_AVG carries the limp share', T.POOL_AVG.limpShareOfVpip > 0);

const wt = player({ hands: 100, wtsd: 30 });
t.eq('WTSD is reported raw', T.computeRates(wt).wtsd, 30);
t.eq('and stays raw when shrunk rates are taken', T.computeShrunkRates(wt).wtsd, 30);

process.exit(t.report());
