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

// --- "name:" pseudo-records are not players ---------------------------------
//
// A pseudo-record is a log name that never bound to a seat. It is not a thin
// sample of a real player, it is a structurally skewed one: the record only
// exists on hands where a log line named that player, so it never records the
// hands they sat out of. Measured on a real store, 27 of them cleared the
// 25-hand bar and read fold-to-3-bet 82.2% against 52.3% for seat-resolved
// records. Excluding them is a correctness fix, so there is no sample
// threshold involved and a big pseudo-record must not qualify.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  mk(T, 'hero1', { hands: 500, vpip: 250, pfr: 100 });
  mk(T, '111', { hands: 100, vpip: 40, pfr: 10 });
  mk(T, '222', { hands: 100, vpip: 40, pfr: 10 });
  mk(T, '333', { hands: 100, vpip: 40, pfr: 10 });

  const clean = T.observedPoolAverages();
  t.eq('three real opponents qualify', clean.players, 3);
  t.near('and the average is theirs', clean.vpip, 40);

  // A pseudo-record with plenty of hands and a wildly different rate. If it
  // counted, both the player total and the average would move.
  mk(T, 'name:GhostNote420', { hands: 400, vpip: 400, pfr: 0 });
  const after = T.observedPoolAverages();
  t.eq('a pseudo-record does not count toward the player total', after.players, 3);
  t.near('nor does it move the average', after.vpip, 40);
  t.eq('nor the player-hand sample', after.playerHands, clean.playerHands);

  // The bar is what the id IS, not how much of it there is.
  mk(T, 'name:Another', { hands: 5000, vpip: 5000, pfr: 0 });
  t.eq('and volume does not buy a pseudo-record its way in',
    T.observedPoolAverages().players, 3);
}

{
  // The exclusion is on the pseudo prefix, not on anything that merely looks
  // unusual — a real numeric xid with an odd rate is still a player.
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  mk(T, '111', { hands: 100, vpip: 40, pfr: 10 });
  mk(T, '222', { hands: 100, vpip: 40, pfr: 10 });
  mk(T, '999', { hands: 100, vpip: 100, pfr: 0 }); // 100% VPIP, but real
  const obs = T.observedPoolAverages();
  t.eq('a real record with an extreme rate still counts', obs.players, 3);
  t.near('and pulls the average with it', obs.vpip, 60);
}

// --- playerHands are SEAT OBSERVATIONS, not hands played --------------------
//
// This field used to be called totalHands and printed as "hands of evidence",
// and the first person to read that report took it to mean hands they had
// played. They had played 11,781; the figure said 75,721. Both were correct —
// one real hand counts once for every opponent seated in it, so at a
// seven-handed table the sum runs ~6x ahead — but the label only gets one
// test, and it failed it. These assertions pin the distinction rather than the
// spelling, so a future rename that loses it fails here.

{
  const T = load();
  T.STORE = T.emptyStore();
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'b', { hands: 250, vpip: 50, pfr: 15 });
  mk(T, 'c', { hands: 40, vpip: 50, pfr: 15 });
  // Hero and an under-sample player must not count toward the total either —
  // same qualifying set the rates themselves are averaged over.
  T.heroXid = 'hero1';
  mk(T, 'hero1', { hands: 9999, vpip: 50, pfr: 15 });
  mk(T, 'thin', { hands: 5, vpip: 50, pfr: 15 });
  T.STORE.hero.hands = 120;

  const obs = T.observedPoolAverages();
  t.eq('playerHands sums only the qualifying players', obs.playerHands, 100 + 250 + 40);
  t.eq('heroHands reports hero\'s own count, untouched', obs.heroHands, 120);
  t.ok('the two are reported separately and can differ by a lot',
    obs.playerHands > obs.heroHands * 3);
}

{
  // The average must be UNWEIGHTED across players — a long-tracked regular and
  // a barely-tracked stranger count the same. If playerHands ever started
  // weighting the mean, this is what would catch it: one player with ten times
  // the sample cannot drag the average toward their own figure.
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero1';
  mk(T, 'whale', { hands: 3000, vpip: 3000, pfr: 0 }); // VPIP 100 over a huge sample
  mk(T, 'a', { hands: 30, vpip: 0, pfr: 0 });          // VPIP 0
  mk(T, 'b', { hands: 30, vpip: 0, pfr: 0 });
  mk(T, 'c', { hands: 30, vpip: 0, pfr: 0 });

  const obs = T.observedPoolAverages();
  t.near('four players, one at 100 and three at 0, average 25', obs.vpip, 25);
  t.ok('and the player-hand figure is dominated by the whale it did NOT weight',
    obs.playerHands > 3000);
}

// --- poolStakesBreakdown: which stakes the pool read is drawn from ---------

{
  const T = load();
  T.STORE = T.emptyStore();
  // River Wizard ($1M BB) and Cat's Chance ($2.5M BB) are both confirmed
  // TORN_STAKES entries (see CLAUDE.md "Stakes, and the BB-display hazard").
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15, tables: { 1000000: 70, 2500000: 30 } });
  mk(T, 'b', { hands: 100, vpip: 50, pfr: 15, tables: { 1000000: 30 } });
  mk(T, 'c', { hands: 100, vpip: 50, pfr: 15 }); // no readable blind ever

  const sb = T.poolStakesBreakdown();
  t.eq('total is the sum of every qualifying player\'s tables entries', sb.total, 70 + 30 + 30);
  t.eq('two distinct stakes reported', sb.stakes.length, 2);
  t.eq('busiest stake first', sb.stakes[0].name, 'River Wizard');
  t.eq('River Wizard hands are summed across both players', sb.stakes[0].hands, 100);
  t.near('River Wizard share', sb.stakes[0].share, 100 / 130 * 100);
  t.eq('second stake is Cat\'s Chance', sb.stakes[1].name, "Cat's Chance");

  // Below POOL_OBS_MIN_HANDS — excluded from the qualifying set, so an
  // enormous tables entry here must not appear in the breakdown.
  mk(T, 'thin', { hands: 5, tables: { 100000000: 99999 } });
  const sb2 = T.poolStakesBreakdown();
  t.eq('an under-sample player\'s stakes are excluded, not just their rates',
    sb2.total, 130);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  mk(T, 'a', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'b', { hands: 100, vpip: 50, pfr: 15 });
  mk(T, 'c', { hands: 100, vpip: 50, pfr: 15 });
  const sb = T.poolStakesBreakdown();
  t.eq('no readable blind anywhere reads as an empty breakdown, not an error', sb.total, 0);
  t.eq('and an empty stakes list', sb.stakes.length, 0);
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
      tables: { 1000000: 100 },
    });
  }
  const text = T.poolTendencyExport();
  t.ok('names the player count', text.indexOf('5 tracked opponent') !== -1);
  // Both figures, and the word that stops them being conflated. "500 hands of
  // evidence" was the old line, and it read as 500 hands played.
  t.ok('names the player-hand figure as PLAYER-hands', text.indexOf('500 PLAYER-hands') !== -1);
  t.ok('and says what it was observed across', text.indexOf('hand(s) you were dealt into') !== -1);
  t.ok('and states outright that the two are not the same number',
    text.indexOf('not the same number') !== -1);
  t.ok('the old conflating wording is gone', text.indexOf('hand(s) of evidence total') === -1);
  t.ok('reports VPIP', text.indexOf('VPIP: 50.0%') !== -1);
  t.ok('reports a deviation label against the assumed pool figure', text.indexOf('extreme up') !== -1);
  t.ok('AFq is reported without a pool comparison', text.indexOf('AFq') !== -1
    && text.indexOf('AFq (aggression, folds excluded): not enough data') !== -1);
  t.ok('WTSD says no published figure exists, not a fabricated one',
    text.indexOf('WTSD') !== -1 && !/WTSD: [\d.]+% \(assumed/.test(text));
  t.ok('names the stake', text.indexOf('River Wizard') !== -1);
  t.ok('reports the stakes hand count and share', text.indexOf('500 hand(s), 100%') !== -1);
}

{
  // No qualifying player has a readable blind level at all — the stakes
  // section says so explicitly rather than rendering an empty/blank block.
  const T = load();
  T.STORE = T.emptyStore();
  for (let i = 0; i < 3; i++) mk(T, 'p' + i, { hands: 100, vpip: 50, pfr: 15 });
  const text = T.poolTendencyExport();
  t.ok('stakes are reported as unknown, not silently omitted',
    text.indexOf('Stakes: unknown') !== -1);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const text = T.poolTendencyExport();
  t.ok('too few players still produces a file, not an error',
    text.indexOf('not enough for a pool read') !== -1);
}

process.exit(t.report());
