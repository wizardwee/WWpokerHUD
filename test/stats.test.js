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

// --- Hero's own record ------------------------------------------------------

// Hero accumulates stats exactly like anyone else (dealtInXids includes hero),
// so the record exists and belongs in the players list. Only the P/L column
// means something different for it: plChipsEst is never written for hero,
// because it would be your P/L against yourself, and printing the resulting 0
// reads as "flat" rather than "not applicable".
{
  const H = load();
  H.STORE = H.emptyStore();
  H.heroXid = '311421';
  t.eq('hero\'s own record is recognised', H.isHeroRecord('311421'), true);
  t.eq('an opponent is not', H.isHeroRecord('999'), false);
  // A pseudo-id is not bound to a seat, so nothing should be labelled "you".
  H.heroXid = 'name:Wonkawee';
  t.eq('an unresolved hero labels nothing', H.isHeroRecord('name:Wonkawee'), false);
  H.heroXid = null;
  t.eq('no hero labels nothing', H.isHeroRecord('311421'), false);
}

// The real figures live on STORE.hero, not on hero's player record.
{
  const H = load();
  H.STORE = H.emptyStore();
  H.heroXid = 'H';
  H.applyHandResults({
    gameId: null, street: 'preflop', pot: 3000000, bbAmount: 1000000,
    contributions: { H: 500000, V: 1000000 },
    dealtInXids: new Set(['H', 'V']),
    winners: [{ xid: 'V', amount: 1500000 }],
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'preflop' }], shown: {}, shownCards: {},
  });
  t.eq('hero gets a player record', !!H.STORE.players.H, true);
  t.eq('with hands counted', H.STORE.players.H.hands, 1);
  t.eq('but no P/L against themself', H.STORE.players.H.plChipsEst, 0);
  t.eq('the real result is on STORE.hero', H.STORE.hero.netChips, -500000);
  t.near('in big blinds too', H.STORE.hero.netBB, -0.5);
}

// --- The WTSD anchor is gone ------------------------------------------------

// It was mapped from the source's `wwsf` (won when saw flop), a different stat.
// WTSD is now left unshrunk rather than pulled toward an unrelated number.
t.eq('POOL_AVG carries no WTSD figure', T.POOL_AVG.wtsd, undefined);
// Not pinned to a literal figure: POOL_AVG.foldToCbet is measured pool data
// (v1.11.0) rather than a fixed constant, and gets corrected as more hands
// accrue — the test only needs to know the slot is populated, same as the
// limp-share assertion right below it.
t.ok('POOL_AVG carries a fold-to-c-bet figure', T.POOL_AVG.foldToCbet > 0);
t.ok('POOL_AVG carries the limp share', T.POOL_AVG.limpShareOfVpip > 0);

const wt = player({ hands: 100, wtsd: 30 });
t.eq('WTSD is reported raw', T.computeRates(wt).wtsd, 30);
t.eq('and stays raw when shrunk rates are taken', T.computeShrunkRates(wt).wtsd, 30);

// --- badgePct (v0.42.2) ------------------------------------------------------
//
// The seat badge floats over the table and a wide one reaches the community
// cards, so its numbers are capped at two characters. This is a DISPLAY cap for
// the badge face only — the Stats tab must keep printing the observed figure,
// which is why fmtNum is untouched and this is a separate function.

t.eq('an ordinary figure is unchanged', T.badgePct(35), '35');
t.eq('and is rounded, not truncated', T.badgePct(34.7), '35');
t.eq('100 is clamped to two characters', T.badgePct(100), '99');
t.eq('as is anything above it', T.badgePct(140), '99');
t.eq('a negative can never render', T.badgePct(-5), '0');
t.eq('and null is still the dash', T.badgePct(null), '–');
t.ok('nothing on the badge face is ever 3 chars',
  [0, 1, 49.5, 99, 99.6, 100].every((v) => T.badgePct(v).length <= 2));
// fmtNum is what the tooltip and the panels use, and it must NOT clamp — the
// Stats tab saying "99%" for a player who really played every hand would be a
// display cap silently becoming a wrong number.
t.eq('fmtNum still tells the truth at 100', T.fmtNum(100), '100');

// --- Bet sizing is a median now, not a sum/count average (v1.21.0) ----------
//
// The old figure was a running sum/count average, which one enormous all-in
// shove could drag a long way on its own — a player who bets ~50% of pot all
// day looked like a big-bet merchant after a single 500%-pot shove. A median
// of the recent window barely moves for one outlier sitting among the rest.

t.eq('median of an odd-length list is the middle value', T.median([1, 5, 9]), 5);
t.eq('median of an even-length list averages the two middles', T.median([1, 2, 3, 4]), 2.5);
t.eq('median of nothing is null', T.median([]), null);
t.eq('median of a missing list is null', T.median(undefined), null);

{
  const S = load();
  S.STORE = S.emptyStore();

  // Sixteen ordinary half-pot bets, then one 500%-pot shove.
  for (let i = 0; i < 16; i++) S.noteBetSizing('sz', 50, 100); // 50% of pot each
  S.noteBetSizing('sz', 500, 100); // one shove at 500% of pot

  const p = S.STORE.players.sz;
  t.eq('every sized bet is counted, all-ins included', p.betSizeCount, 17);
  t.eq('median sizing barely moves off the ordinary bet', S.computeRates(p).medianBetPct, 50);

  const meanWouldHaveBeen = (16 * 50 + 500) / 17;
  t.ok(`the old average (${meanWouldHaveBeen.toFixed(0)}%) would have called this an oversized player; the median does not`,
    meanWouldHaveBeen > 75 && S.computeRates(p).medianBetPct < 75);
}

{
  // The rolling window is bounded (BET_SIZE_HISTORY_MAX), same reasoning as
  // recentTables: this is stored for every player forever and must not grow
  // with hand count.
  const S = load();
  S.STORE = S.emptyStore();
  for (let i = 0; i < S.BET_SIZE_HISTORY_MAX + 10; i++) S.noteBetSizing('w', 100, 100);
  const p = S.STORE.players.w;
  t.eq('betSizes is capped at BET_SIZE_HISTORY_MAX', p.betSizes.length, S.BET_SIZE_HISTORY_MAX);
  t.eq('betSizeCount keeps the true lifetime total past the cap', p.betSizeCount, S.BET_SIZE_HISTORY_MAX + 10);
}

t.eq('no sized bets yields no sizing figure', T.computeRates(player({ hands: 50 })).medianBetPct, null);

process.exit(t.report());
