// recentTrendPoints / sparklineSvg — the Stats tab's "Trend" row (v1.16.0).
//
// Both are pure functions over p.recent, the same bitfield array
// blendedRates/sessionRates already read — no new data collection, just a
// second way of looking at data already stored.

const { load, runner } = require('./harness');

const t = runner('trend-sparkline');
const T = load();

const PLAY = 1;
const RAISE = 2;
const FOLD = 0;

function player(codes) {
  const p = T.emptyPlayer('p', 'Test');
  (codes || []).forEach((c) => T.pushRecent(p, c));
  return p;
}
const rep = (n, code) => Array(n).fill(code);

// --- recentTrendPoints: windowing ------------------------------------------

{
  const p = player(rep(5, PLAY)); // fewer than TREND_WINDOW_HANDS + 1
  t.eq('too few hands for even one window returns empty, not a throw',
    T.recentTrendPoints(p, 10).length, 0);
}

{
  // Exactly window+1 hands: the minimum that can produce 2 points.
  const p = player(rep(11, PLAY));
  t.eq('window+1 hands produces exactly 2 points', T.recentTrendPoints(p, 10).length, 2);
}

{
  // A player who folded everything, then played everything — a clean step,
  // easy to hand-verify against the sliding window.
  const codes = rep(15, FOLD).concat(rep(15, PLAY));
  const p = player(codes); // 30 hands total, but pushRecent caps at RECENT_MAX (40) — fine here
  const trend = T.recentTrendPoints(p, 10);
  // 30 hands, window 10 -> 30-10+1 = 21 points.
  t.eq('point count matches recent.length - window + 1', trend.length, 21);
  t.near('the FIRST window (all folds) reads 0% VPIP', trend[0].vpip, 0);
  t.near('the LAST window (all plays) reads 100% VPIP', trend[trend.length - 1].vpip, 100);
  // The step happens between index 14 and 24 (folds end at 15, window is 10
  // wide) — somewhere in the middle the rolling window straddles the step and
  // reads a value strictly between 0 and 100.
  const middle = trend[10];
  t.ok('a window straddling the fold/play boundary reads between the two extremes',
    middle.vpip > 0 && middle.vpip < 100);
}

{
  // PFR tracked independently of VPIP within the same window.
  const codes = rep(10, RAISE).concat(rep(10, PLAY));
  const p = player(codes);
  const trend = T.recentTrendPoints(p, 10);
  t.near('a window of all-raises reads 100% VPIP', trend[0].vpip, 100);
  t.near('and 100% PFR', trend[0].pfr, 100);
  t.near('a window of all-plays (called, not raised) reads 100% VPIP', trend[trend.length - 1].vpip, 100);
  t.near('but 0% PFR', trend[trend.length - 1].pfr, 0);
}

{
  // Default window when none is passed.
  const p = player(rep(T.TREND_WINDOW_HANDS + 5, PLAY));
  t.ok('omitting windowSize falls back to TREND_WINDOW_HANDS, not a throw',
    T.recentTrendPoints(p).length > 0);
}

{
  t.eq('a player with no recent array at all returns empty', T.recentTrendPoints({}, 10).length, 0);
  t.eq('a null player returns empty, not a throw', T.recentTrendPoints(null, 10).length, 0);
}

// --- sparklineSvg: rendering -------------------------------------------------

t.eq('fewer than 2 values renders nothing', T.sparklineSvg([50], {}), '');
t.eq('zero values renders nothing', T.sparklineSvg([], {}), '');
t.eq('undefined values renders nothing', T.sparklineSvg(undefined, {}), '');

{
  const svg = T.sparklineSvg([0, 50, 100], { width: 90, height: 20, color: '#8ec5f0' });
  t.ok('renders an svg element', svg.indexOf('<svg') === 0);
  t.ok('carries the tph- marker class so pinTextColor leaves it alone', svg.indexOf('class="tph-sparkline"') !== -1);
  t.ok('uses the given width', svg.indexOf('width="90"') !== -1);
  t.ok('uses the given colour as the stroke', svg.indexOf('stroke="#8ec5f0"') !== -1);
  t.ok('draws exactly one polyline for 3 points', (svg.match(/<polyline/g) || []).length === 1);
}

{
  // A 100 value must map to y=0 (top) and a 0 value to y=height (bottom) —
  // this is what makes "trending up" actually point up on screen.
  const svg = T.sparklineSvg([100, 0], { width: 40, height: 20 });
  t.ok('a 100% point sits at the top of the track (y=0)', svg.indexOf('0.0,0.0') !== -1);
  t.ok('a 0% point sits at the bottom of the track (y=height)', svg.indexOf('40.0,20.0') !== -1);
}

{
  // Values outside 0-100 are clamped rather than drawn off the visible track
  // — same rule the Stats tab's bar fill already follows (statRow/clamp).
  const over = T.sparklineSvg([250, 50], { width: 20, height: 20 });
  t.ok('an over-100 value clamps to the top', over.indexOf('0.0,0.0') !== -1);
  const under = T.sparklineSvg([-40, 50], { width: 20, height: 20 });
  t.ok('a negative value clamps to the bottom', under.indexOf('0.0,20.0') !== -1);
}

process.exit(t.report());
