// observedPoolAverages' full stat set (v1.9.0 — grew from VPIP/PFR only), and
// the poolTendencyExport() report built on top of it.
//
// Deliberately aggregate-only: this draws from the per-player counters in
// STORE.players, which are never capped or pruned, rather than STORE.hands
// (capped at historyLimit plus pinned notable hands — a recency/size-biased
// sample, not the pool). See CLAUDE.md "Shared-affiliation badges" for the
// same reasoning applied to a different feature.

const { load, runner } = require('./harness');

const t = runner('pool-tendency');

function mk(T, xid, o) {
  return (T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o));
}

// --- observedPoolAverages: full stat set ------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  // 5 qualifying players (hands >= POOL_OBS_MIN_HANDS), each with a full,
  // consistent stat line so the expected mean is easy to hand-verify.
  for (let i = 0; i < 5; i++) {
    mk(T, 'p' + i, {
      hands: 100,
      vpip: 50,
      pfr: 15,
      threeBetMade: 4,
      foldTo3BetMade: 6,
      foldTo3BetOpp: 10,
      cbetMade: 40,
      cbetOpp: 100,
      foldToCbetMade: 50,
      foldToCbetOpp: 100,
      limpMade: 20,
      wtsd: 22,
    });
  }

  const obs = T.observedPoolAverages();
  t.eq('reports the qualifying player count', obs.players, 5);
  t.near('vpip', obs.vpip, 50);
  t.near('pfr', obs.pfr, 15);
  t.near('threeBet', obs.threeBet, 4);
  t.near('foldTo3Bet', obs.foldTo3Bet, 60); // 6/10
  t.near('cbet', obs.cbet, 40);
  t.near('foldToCbet', obs.foldToCbet, 50);
  t.near('limpShareOfVpip', obs.limpShareOfVpip, 40); // 20/50
  t.near('wtsd', obs.wtsd, 22);
  // afq comes from streetActions, left at emptyPlayer's zeroed default here —
  // 0 bet/raise and 0 call means computeRates' afq denominator is 0, so it's
  // null for every player and the pool mean is null too, not 0 or NaN.
  t.eq('afq is null when nobody has any postflop actions recorded', obs.afq, null);
}

// --- Per-stat null-exclusion: a zero-opportunity player doesn't skew a stat -

{
  const T = load();
  T.STORE = T.emptyStore();
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15, foldTo3BetMade: 8, foldTo3BetOpp: 10 }); // 80%
  mk(T, 'b', { hands: 100, vpip: 50, pfr: 15, foldTo3BetMade: 2, foldTo3BetOpp: 10 }); // 20%
  // Never faced a 3-bet at all — foldTo3BetOpp stays 0, so computeRates.foldTo3Bet
  // is null for this player (pct() returns null on a zero denominator).
  mk(T, 'c', { hands: 100, vpip: 50, pfr: 15 });

  const obs = T.observedPoolAverages();
  t.eq('all three players still count toward vpip/pfr', obs.players, 3);
  t.near('vpip unaffected by c having no 3-bet opportunities', obs.vpip, 50);
  // Averaged over only a and b (80+20)/2 = 50 — c's null is dropped, not
  // treated as 0%, which would have pulled this down to 33.3.
  t.near('foldTo3Bet averages only players who actually faced one', obs.foldTo3Bet, 50);
}

// --- Fewer than 3 qualifying players: null, not a partial/misleading report -

{
  const T = load();
  T.STORE = T.emptyStore();
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'b', { hands: 100, vpip: 50, pfr: 15 });
  t.eq('two qualifying players is still not enough', T.observedPoolAverages(), null);
}

// --- Hero excluded from the pool --------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  mk(T, 'hero1', { hands: 500, vpip: 90, pfr: 80 }); // would badly skew the pool if counted
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'b', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'c', { hands: 100, vpip: 50, pfr: 15 });

  const obs = T.observedPoolAverages();
  t.eq('hero does not count toward the player total', obs.players, 3);
  t.near('hero\'s own extreme numbers do not pull the average', obs.vpip, 50);
}

// --- poolTendencyExport: report shape ---------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  for (let i = 0; i < 5; i++) {
    mk(T, 'p' + i, {
      hands: 100,
      vpip: 50,
      pfr: 15,
      foldTo3BetMade: 8,
      foldTo3BetOpp: 10, // 80% — well above POOL_AVG.foldTo3Bet, should read "extreme up" regardless of its exact value
    });
  }
  const text = T.poolTendencyExport();
  t.ok('names the player count', text.indexOf('5 tracked opponent') !== -1);
  t.ok('reports VPIP', text.indexOf('VPIP: 50.0%') !== -1);
  t.ok('reports a deviation label against the assumed pool figure', text.indexOf('extreme up') !== -1);
  t.ok('AFq is reported without a pool comparison', text.indexOf('AFq') !== -1
    && text.indexOf('AFq (aggression, folds excluded): not enough data') !== -1);
  t.ok('WTSD says no published figure exists, not a fabricated one',
    text.indexOf('WTSD') !== -1 && !/WTSD: [\d.]+% \(assumed/.test(text));
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const text = T.poolTendencyExport();
  t.ok('too few players still produces a file, not an error',
    text.indexOf('not enough for a pool read') !== -1);
}

process.exit(t.report());
