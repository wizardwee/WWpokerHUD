// The stake-aware pool anchor: which pool a player gets measured against.
//
// The pool is not one pool. Measured over 442 seat-resolved opponents, VPIP
// runs 54.9 / 46.2 / 42.6 across the three tables this store spans — so a
// single POOL_AVG called the $500k pool loose almost by definition, and
// relabelled 89 of those 442 players purely on which table they chose.
//
// The invariant that matters most here is COHERENCE: a rate is shrunk toward
// an anchor and then judged against a bar, and if those two come from
// different anchors the result is worse than either alone — shrinking a $500k
// player toward 54.9 while judging them against a global bar pushes thin $500k
// players over the "loose" line, the exact opposite of the intent. That is why
// the anchor rides ON the rates object rather than being looked up separately,
// and why the assertions below check the two together rather than apart.

const { load, runner } = require('./harness');

const t = runner('pool-anchor');

function mk(T, xid, o) {
  return (T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o));
}
const near = (a, b, tol) => Math.abs(a - b) < (tol == null ? 0.05 : tol);

// --- poolAvgFor: which anchor a player gets --------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const BY = T.POOL_AVG_BY_STAKE;

  const none = mk(T, 'a', { hands: 100 });
  t.eq('a player with no table data gets the global anchor',
    T.poolAvgFor(none), T.POOL_AVG);

  const empty = mk(T, 'b', { hands: 100, tables: {} });
  t.eq('and so does one whose table map is empty',
    T.poolAvgFor(empty), T.POOL_AVG);

  const pure = mk(T, 'c', { hands: 100, tables: { 500000: 100 } });
  t.ok('a single-stake player gets that stake exactly',
    near(T.poolAvgFor(pure).vpip, BY[500000].vpip));
  t.ok('on every stake-aware stat',
    near(T.poolAvgFor(pure).foldTo3Bet, BY[500000].foldTo3Bet)
    && near(T.poolAvgFor(pure).limpShareOfVpip, BY[500000].limpShareOfVpip));
}

{
  // Volume-weighted, not winner-take-all. A 50/50 player lands on the
  // midpoint; winner-take-all would land on one end and put a cliff at 50/50,
  // which is the threshold-switching mistake blendedRates already settled.
  const T = load();
  T.STORE = T.emptyStore();
  const BY = T.POOL_AVG_BY_STAKE;
  const mid = (BY[500000].vpip + BY[2500000].vpip) / 2;

  const even = mk(T, 'a', { hands: 200, tables: { 500000: 100, 2500000: 100 } });
  t.ok('a 50/50 player sits at the midpoint of both anchors',
    near(T.poolAvgFor(even).vpip, mid), 'got ' + T.poolAvgFor(even).vpip);

  const tilted = mk(T, 'b', { hands: 200, tables: { 500000: 150, 2500000: 50 } });
  const v = T.poolAvgFor(tilted).vpip;
  t.ok('a 75/25 player sits three quarters of the way',
    near(v, BY[500000].vpip * 0.75 + BY[2500000].vpip * 0.25), 'got ' + v);

  // The property winner-take-all cannot have: no cliff at the crossover.
  const a49 = mk(T, 'c', { hands: 100, tables: { 500000: 49, 2500000: 51 } });
  const a51 = mk(T, 'd', { hands: 100, tables: { 500000: 51, 2500000: 49 } });
  const gap = Math.abs(T.poolAvgFor(a49).vpip - T.poolAvgFor(a51).vpip);
  t.ok('49/51 and 51/49 are almost the same anchor, not opposite ends',
    gap < 1, 'gap ' + gap.toFixed(2) + 'pp');
}

{
  // A stake with no measured anchor contributes the GLOBAL figure for its
  // share rather than being dropped — otherwise a player split between a
  // measured and an unmeasured table would be judged entirely on the half we
  // happen to have a figure for.
  const T = load();
  T.STORE = T.emptyStore();
  const BY = T.POOL_AVG_BY_STAKE;
  const split = mk(T, 'a', { hands: 200, tables: { 500000: 100, 10000000: 100 } });
  const want = (BY[500000].vpip + T.POOL_AVG.vpip) / 2;
  t.ok('an unmeasured stake contributes the global figure for its share',
    near(T.poolAvgFor(split).vpip, want), 'got ' + T.poolAvgFor(split).vpip);

  const allUnknown = mk(T, 'b', { hands: 100, tables: { 10000000: 100 } });
  t.ok('a player only at unmeasured stakes lands on the global figure',
    near(T.poolAvgFor(allUnknown).vpip, T.POOL_AVG.vpip));
}

{
  // Only the three stats with a real, MONOTONIC gradient are stake-aware.
  // cbet and foldToCbet are non-monotonic across three buckets and pfr and
  // threeBet are flat, so making those stake-aware would encode noise as a
  // constant — the mistake the WTSD anchor made.
  const T = load();
  T.STORE = T.emptyStore();
  const lo = T.poolAvgFor(mk(T, 'a', { hands: 100, tables: { 500000: 100 } }));
  const hi = T.poolAvgFor(mk(T, 'b', { hands: 100, tables: { 2500000: 100 } }));

  ['vpip', 'foldTo3Bet', 'limpShareOfVpip'].forEach((k) => {
    t.ok(k + ' is stake-aware', lo[k] !== hi[k]);
  });
  ['pfr', 'threeBet', 'cbet', 'foldToCbet'].forEach((k) => {
    t.eq(k + ' is NOT stake-aware, and matches the global figure', lo[k], T.POOL_AVG[k]);
    t.eq(k + ' agrees across stakes', lo[k], hi[k]);
  });

  // The gradient runs the way the measurement said, not backwards.
  t.ok('lower stakes anchor LOOSER', lo.vpip > hi.vpip);
  t.ok('lower stakes anchor folds LESS to 3-bets', lo.foldTo3Bet < hi.foldTo3Bet);
  t.ok('lower stakes anchor limps MORE', lo.limpShareOfVpip > hi.limpShareOfVpip);
}

// --- the memo is versioned by the table mix, not just cached ---------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, 'a', { hands: 100, tables: { 500000: 100 } });
  const first = T.poolAvgFor(p).vpip;
  t.eq('a repeat call is stable', T.poolAvgFor(p).vpip, first);

  // Moving stakes must move the anchor. A cache keyed only on identity would
  // serve the old one here forever.
  p.tables[2500000] = 300;
  const after = T.poolAvgFor(p).vpip;
  t.ok('a changed table mix invalidates the memo',
    Math.abs(after - first) > 1, 'before ' + first.toFixed(1) + ' after ' + after.toFixed(1));
  t.ok('and moves toward the stake they moved to',
    after < first);
}

// --- vpipBars ---------------------------------------------------------------

{
  const T = load();
  t.ok('bars with no anchor fall back to the global figure',
    near(T.vpipBars({}).avg, T.POOL_AVG.vpip)
    && near(T.vpipBars(null).avg, T.POOL_AVG.vpip));
  t.ok('A.tight/A.loose still describe the GLOBAL anchor',
    near(T.A.tight, T.POOL_AVG.vpip * T.A.tightMul)
    && near(T.A.loose, T.POOL_AVG.vpip * T.A.looseMul));

  const bars = T.vpipBars({ anchor: { vpip: 60 } });
  t.ok('a looser anchor raises both bars', bars.tight > T.A.tight && bars.loose > T.A.loose);
  t.ok('and keeps the multipliers', near(bars.tight, 60 * T.A.tightMul) && near(bars.loose, 60 * T.A.looseMul));
}

// --- COHERENCE: shrinkage and classification use the same anchor -----------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 20;

  // The same behaviour, at two different tables. 50% VPIP is loose for
  // Cat's Chance and unremarkable for Old Folks Home, and the label must say
  // so — this is the whole point of the change.
  const at = (xid, bb) => mk(T, xid, {
    hands: 200, vpip: 100, pfr: 15, tables: { [bb]: 200 },
  });
  const cheap = at('lo', 500000);
  const dear = at('hi', 2500000);

  t.eq('the two records are otherwise identical', cheap.vpip === dear.vpip && cheap.hands === dear.hands, true);
  t.ok('the anchor differs', T.poolAvgFor(cheap).vpip > T.poolAvgFor(dear).vpip);
  t.ok('and so does the label', T.classify(cheap) !== T.classify(dear));

  // The coherence invariant, stated directly: the number a rate was shrunk
  // toward is the number its bars are derived from.
  const s = T.computeShrunkRates(cheap);
  t.eq('the rates object carries the anchor it was shrunk toward',
    s.anchor, T.poolAvgFor(cheap));
  t.eq('and the bars are derived from that same anchor',
    T.vpipBars(s).avg, T.poolAvgFor(cheap).vpip);
}

{
  // A shrunk rate must be pulled toward its OWN anchor, never the global one.
  //
  // Stated as a DIFFERENCE between two otherwise-identical records, because
  // the obvious phrasing is vacuous: "shrunk value sits above the anchor" is
  // true whether it shrank toward 54.9 or 42.5 whenever the observation is
  // above both. This version caught a deliberate revert to the global anchor
  // that the first phrasing passed clean — worth remembering when writing the
  // next assertion about shrinkage.
  const T = load();
  T.STORE = T.emptyStore();
  const at = (xid, bb) => mk(T, xid, { hands: 6, vpip: 0, pfr: 0, tables: { [bb]: 6 } });
  const cheap = at('lo', 500000);
  const dear = at('hi', 2500000);

  const sLo = T.computeShrunkRates(cheap).vpip;
  const sHi = T.computeShrunkRates(dear).vpip;
  t.ok('two identical records at different stakes shrink to DIFFERENT figures',
    Math.abs(sLo - sHi) > 1, 'lo ' + sLo.toFixed(1) + ' hi ' + sHi.toFixed(1));
  t.ok('and the looser table shrinks higher',
    sLo > sHi, 'lo ' + sLo.toFixed(1) + ' hi ' + sHi.toFixed(1));

  // Both observed 0%, so each must sit strictly between 0 and its own anchor —
  // and never above the other's, which is what a global anchor would produce.
  const aLo = T.poolAvgFor(cheap).vpip;
  const aHi = T.poolAvgFor(dear).vpip;
  t.ok('each sits between the observation and its own anchor',
    sLo > 0 && sLo < aLo && sHi > 0 && sHi < aHi);
  t.ok('and the anchors themselves straddle the global figure',
    aLo > T.POOL_AVG.vpip && aHi >= T.POOL_AVG.vpip);
}

{
  // Every stake-aware stat, not just VPIP. Checking one of the three let a
  // deliberate revert of foldTo3Bet to the global anchor pass clean — the
  // three are separate lines in computeShrunkRates, so one can be reverted
  // without touching the others.
  const T = load();
  T.STORE = T.emptyStore();
  const at = (xid, bb) => mk(T, xid, {
    hands: 40, vpip: 10, pfr: 4,
    limpMade: 3,                      // denominator for limpShareOfVpip is vpip
    foldTo3BetMade: 2, foldTo3BetOpp: 6,
    tables: { [bb]: 40 },
  });
  const cheap = T.computeShrunkRates(at('lo', 500000));
  const dear = T.computeShrunkRates(at('hi', 2500000));

  [['vpip', 'higher'], ['foldTo3Bet', 'lower'], ['limpShareOfVpip', 'higher']].forEach(([k, dir]) => {
    t.ok(k + ' shrinks toward its own stake anchor',
      Math.abs(cheap[k] - dear[k]) > 0.3,
      'lo ' + cheap[k].toFixed(2) + ' hi ' + dear[k].toFixed(2));
    t.ok('and the cheaper table shrinks ' + dir + ' on ' + k,
      dir === 'higher' ? cheap[k] > dear[k] : cheap[k] < dear[k]);
  });

  // The stats that are NOT stake-aware must be identical between them —
  // otherwise something has quietly started varying that was measured flat.
  ['pfr', 'threeBet', 'cbet', 'foldToCbet'].forEach((k) => {
    t.eq(k + ' is unaffected by the stake', cheap[k], dear[k]);
  });
}

{
  // The map may only carry keys that poolAvgFor actually blends. It builds the
  // non-stake-aware fields from POOL_AVG explicitly, so a fourth key added to
  // an entry would be silently ignored — a change that looks like it landed
  // and does nothing. Deliberately NOT fixed by blending whatever it finds:
  // cbet and foldToCbet are non-monotonic across the three buckets and adding
  // them would encode noise as a constant. So the map is pinned instead.
  const T = load();
  const STAKE_AWARE = ['vpip', 'foldTo3Bet', 'limpShareOfVpip'];
  const bad = [];
  Object.keys(T.POOL_AVG_BY_STAKE).forEach((bb) => {
    Object.keys(T.POOL_AVG_BY_STAKE[bb]).forEach((k) => {
      if (STAKE_AWARE.indexOf(k) === -1) bad.push(bb + '.' + k);
    });
    STAKE_AWARE.forEach((k) => {
      if (T.POOL_AVG_BY_STAKE[bb][k] == null) bad.push(bb + ' missing ' + k);
    });
  });
  t.eq(`every stake entry carries exactly the three blended stats${bad.length ? ' — ' + bad.join(', ') : ''}`,
    bad.length, 0);
  t.ok('and the map actually has entries to check',
    Object.keys(T.POOL_AVG_BY_STAKE).length >= 3);
}

{
  // blendedRates' prior collapses to the player's own stake anchor when they
  // have no history outside the window — a new face at a $500k table is best
  // guessed at that table's figure. PFR is not stake-aware and keeps global.
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, 'a', { hands: 3, vpip: 3, pfr: 0, tables: { 500000: 3 } });
  p.recent = [1, 1, 1];
  const b = T.blendedRates(p, 15);
  t.ok('the window blend exists', !!b);
  t.ok('its VPIP prior is the stake anchor, not the global one',
    b.baseVpip > T.POOL_AVG.vpip + 5, 'baseVpip ' + (b ? b.baseVpip.toFixed(1) : 'n/a'));
  t.ok('its PFR prior stays global', near(b.basePfr, T.POOL_AVG.pfr, 0.5));
}

process.exit(t.report());
