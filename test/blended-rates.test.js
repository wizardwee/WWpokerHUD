// Recent form as a two-level Bayesian blend, not a mode switch.
//
//     window  ->  their history before the window  ->  POOL_AVG
//
// The badge used to pick ONE of a lifetime figure and a raw window figure,
// crossing over at 6 hands in the window. That crossover moved the badge toward
// the NOISIER of the two estimates, and could shift it 40 points on one hand.
// These tests state the properties that replace it.

const { load, runner } = require('./harness');

const t = runner('blended-rates');
const T = load();
T.STORE = T.emptyStore();

const PLAY = 1;
const RAISE = 2;
const FOLD = 0;

// A player with `hands` lifetime hands at `vpipPct`/`pfrPct`, whose last few
// hands are `codes`. codes are INCLUDED in the lifetime totals, as they are in
// the real store — blendedRates has to subtract them back out.
function player(hands, vpipPct, pfrPct, codes) {
  const p = T.emptyPlayer('p', 'Test');
  p.hands = hands;
  p.vpip = Math.round((vpipPct / 100) * hands);
  p.pfr = Math.round((pfrPct / 100) * hands);
  (codes || []).forEach((c) => T.pushRecent(p, c));
  return p;
}
const rep = (n, code) => Array(n).fill(code);

// --- The prior excludes the window -----------------------------------------
//
// The window's hands sit inside p.hands. Using lifetime directly as the prior
// would count them twice, so a long stretch of new behaviour would quietly
// reinforce the very baseline it is being measured against — the same trap
// tiltRead's baseline avoids.
{
  // 100 lifetime hands at 20% VPIP; the last 15 were ALL played. Outside the
  // window that is 5/85 = ~5.9%, not 20%.
  const p = player(100, 20, 10, rep(15, PLAY));
  const b = T.blendedRates(p, 15);
  t.ok('the baseline is computed without the window', b.baseVpip < 20);
  // Independently computed via shrunkPct (pinned separately in
  // archetype.test.js) rather than a hardcoded number, so this keeps testing
  // "the baseline is 5/85 shrunk toward the CURRENT POOL_AVG.vpip" rather
  // than one frozen figure that goes stale the next time POOL_AVG is
  // corrected — which already broke this exact assertion once, when
  // POOL_AVG.vpip moved from 50.9 to 42.5. baseVpip uses the DEFAULT prior
  // weight (blendedRates calls shrunkPct with no 4th argument there) —
  // RECENT_PRIOR_WEIGHT only applies one level up, blending the window
  // itself against this baseline.
  const expected = T.shrunkPct(5, 85, T.POOL_AVG.vpip, T.PRIOR_WEIGHT);
  t.near('and lands near the true out-of-window rate', b.baseVpip, expected, 0.5);
}

// --- No cliff: the estimate moves continuously ------------------------------
{
  // A 30% VPIP regular who starts playing everything. Watch the badge figure as
  // the window fills, one hand at a time.
  const seq = [];
  for (let k = 0; k <= 15; k += 1) {
    const p = player(100 + k, 30, 12, rep(k, PLAY));
    seq.push(T.blendedRates(p, 15));
  }

  t.eq('with an empty window there is nothing to blend', seq[0], null);

  const shown = seq.slice(1).map((b) => b.vpip);
  let maxStep = 0;
  for (let i = 1; i < shown.length; i += 1) maxStep = Math.max(maxStep, Math.abs(shown[i] - shown[i - 1]));
  t.ok(`no single hand moves VPIP more than 8 points (max ${maxStep.toFixed(1)})`, maxStep < 8);

  let monotonic = true;
  for (let i = 1; i < shown.length; i += 1) if (shown[i] < shown[i - 1] - 0.001) monotonic = false;
  t.ok('a run of played hands only ever raises the estimate', monotonic);

  t.ok('one played hand barely moves off the baseline', Math.abs(shown[0] - 30) < 12);
  t.ok('and fifteen have moved it a long way', shown[14] > 60);
}

// --- The window is believed in proportion to its size -----------------------
{
  // Same behaviour in the window, different amounts of it. More evidence must
  // mean more movement, always.
  const at = (k) => T.blendedRates(player(100 + k, 20, 8, rep(k, PLAY)), 15).vpip;
  const one = at(1);
  const six = at(6);
  const fifteen = at(15);
  t.ok('1 hand < 6 hands < 15 hands of the same signal', one < six && six < fifteen);
  // The old code crossed over at exactly 6, jumping from a lifetime figure to a
  // raw 100% one. Nothing like that survives.
  t.ok('and 6 hands is nowhere near the raw window figure of 100%', six < 70);
}

// --- A brand-new player falls back to the pool, not to nothing --------------
{
  // Every hand they have is in the window, so there is no history to prior on.
  const p = player(3, 100, 0, rep(3, PLAY));
  const b = T.blendedRates(p, 15);
  t.near('the baseline collapses to the pool average', b.baseVpip, T.POOL_AVG.vpip, 0.01);
  t.ok('so three loose hands read as slightly loose, not as a 100% maniac', b.vpip > T.POOL_AVG.vpip && b.vpip < 75);
}

// --- Raw window figures are preserved for display ---------------------------
//
// Same rule as the Stats tab: print what was observed, classify off the
// adjusted number. The tooltip quotes both.
{
  const p = player(50, 30, 10, [PLAY, FOLD, RAISE, FOLD]);
  const b = T.blendedRates(p, 15);
  t.eq('the window size is reported', b.hands, 4);
  t.near('raw window VPIP is 2 of 4', b.rawVpip, 50);
  t.near('raw window PFR is 1 of 4', b.rawPfr, 25);
  t.ok('the blended figure is not the raw one', Math.abs(b.vpip - b.rawVpip) > 5);
}

// --- Degenerate stores must not produce nonsense ----------------------------
{
  // A record from before `recent` existed can hold more window hands than
  // lifetime hands. The subtraction has to clamp rather than go negative.
  const p = T.emptyPlayer('p', 'Test');
  p.hands = 2;
  p.vpip = 0;
  p.pfr = 0;
  rep(10, PLAY).forEach((c) => T.pushRecent(p, c));
  const b = T.blendedRates(p, 15);
  t.ok('a window longer than the lifetime still yields a number', b.vpip > 0 && b.vpip <= 100);
  t.ok('and the baseline stays in range', b.baseVpip >= 0 && b.baseVpip <= 100);

  t.eq('a player with no recent history blends nothing', T.blendedRates(T.emptyPlayer('q', 'Q'), 15), null);
}

// --- PFR tracks VPIP's treatment -------------------------------------------
{
  const p = player(100, 40, 35, rep(12, RAISE));
  const b = T.blendedRates(p, 15);
  t.ok('a raising spree lifts PFR', b.pfr > b.basePfr);
  t.ok('and RAISE counts as played, so VPIP moves too', b.vpip > b.baseVpip);
  t.ok('PFR never exceeds VPIP on the same window', b.pfr <= b.vpip + 0.001);
}

// --- The weight is deliberately lighter than the pool prior -----------------
//
// The prior here is the player's own history, which predicts their next hand
// far better than a pool average does — but the whole point of a recent read is
// that it is allowed to move.
t.ok('the recent prior is lighter than the pool prior',
  T.RECENT_PRIOR_WEIGHT < T.PRIOR_WEIGHT);

// --- shrunkPct's default is unchanged ---------------------------------------
//
// blendedRates generalised it with a 4th argument. Every existing caller passes
// three, and must behave exactly as before.
{
  t.near('three arguments still use PRIOR_WEIGHT', T.shrunkPct(10, 20, 50),
    (100 * (10 + T.PRIOR_WEIGHT * 0.5)) / (20 + T.PRIOR_WEIGHT));
  t.near('an explicit weight overrides it', T.shrunkPct(10, 20, 50, 0), 50);
}

process.exit(t.report());
