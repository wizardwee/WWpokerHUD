// Deviation-from-pool indicators on the Stats tab and players list.
//
// The scale is the whole point: 5pp on VPIP (norm 50.9) is noise, while 5pp on
// 3-bet (norm 3.7) more than doubles it. A single shared threshold would call
// the first notable and the second typical — exactly backwards. POOL_SPREAD
// gives each stat its own scale, so "one spread away" means the same amount of
// "this player is different" regardless of which stat you are looking at.

const { load, runner } = require('./harness');

const t = runner('deviation');
const T = load();
T.STORE = T.emptyStore();

const { POOL_AVG, POOL_SPREAD, deviation } = T;

// --- Levels -----------------------------------------------------------------

const vs = POOL_SPREAD.vpip;
const vn = POOL_AVG.vpip;

t.eq('exactly at the norm is typical', deviation(vn, vn, vs).level, 'typical');
t.eq('just under one spread is typical', deviation(vn + vs * 0.9, vn, vs).level, 'typical');
t.eq('one spread is notable', deviation(vn + vs, vn, vs).level, 'notable');
t.eq('two spreads is extreme', deviation(vn + vs * 2, vn, vs).level, 'extreme');
t.eq('far below is also extreme', deviation(vn - vs * 3, vn, vs).level, 'extreme');

t.eq('above the norm reads up', deviation(vn + vs, vn, vs).dir, 'up');
t.eq('below the norm reads down', deviation(vn - vs, vn, vs).dir, 'down');
t.eq('equal reads flat', deviation(vn, vn, vs).dir, 'flat');

// --- The scale actually rescales -------------------------------------------

// The same 5pp move must mean different things on VPIP and on 3-bet.
const vpip5 = deviation(POOL_AVG.vpip + 5, POOL_AVG.vpip, POOL_SPREAD.vpip);
const threeBet5 = deviation(POOL_AVG.threeBet + 5, POOL_AVG.threeBet, POOL_SPREAD.threeBet);
t.eq('+5pp VPIP is typical', vpip5.level, 'typical');
t.eq('+5pp 3-bet is extreme', threeBet5.level, 'extreme');

// Every stat with a pool figure needs a spread, or it silently renders plain.
Object.keys(POOL_AVG).forEach((k) => {
  t.ok(`${k} has a spread defined`, POOL_SPREAD[k] > 0);
});

// --- Missing data gets no verdict, not a made-up one -----------------------

t.eq('no value means no verdict', deviation(null, 50, 10), null);
t.eq('no norm means no verdict', deviation(50, null, 10), null);
t.eq('no spread means no verdict', deviation(50, 50, 0), null);

// AFq and WTSD have no published pool figure and must stay unjudged.
t.eq('AFq has no pool figure', POOL_AVG.afq, undefined);
t.eq('WTSD has no pool figure', POOL_AVG.wtsd, undefined);

// --- Rendered row -----------------------------------------------------------

// A typical player: no arrow, no delta, and the bar still draws.
{
  const html = T.statRow('VPIP', vn, vn, 'vpip');
  t.ok('typical row carries the typical class', html.includes('tph-dev-typical'));
  t.ok('typical row has no arrow', !html.includes('▲') && !html.includes('▼'));
  t.ok('the pool norm is printed', html.includes(vn.toFixed(0) + '%'));
  t.ok('a bar is drawn', html.includes('tph-bar-fill'));
  t.ok('the norm tick is placed', html.includes('tph-bar-tick'));
}

// An extreme player: arrow, signed delta, extreme class.
{
  const html = T.statRow('VPIP', 85, 85, 'vpip');
  t.ok('extreme row is marked extreme', html.includes('tph-dev-extreme'));
  t.ok('extreme row shows an up arrow', html.includes('▲'));
  t.ok('the deviation is signed', html.includes('+34'));
}

{
  const html = T.statRow('VPIP', 15, 15, 'vpip');
  t.ok('low row shows a down arrow', html.includes('▼'));
  t.ok('the deviation is negative', html.includes('-36'));
}

// Bar geometry: the fill is the value, the tick is the norm, both on 0-100.
{
  const html = T.statRow('C-Bet', 40, 40, 'cbet');
  t.ok('fill width is the value', html.includes('width:40%'));
  t.ok('tick sits at the norm', html.includes(`left:${POOL_AVG.cbet}%`));
}

// A value outside 0-100 must not draw outside the track.
{
  const over = T.statRow('Odd', 250, 250, 'vpip');
  t.ok('an over-100 value is clamped', over.includes('width:100%'));
  const under = T.statRow('Odd', -20, -20, 'vpip');
  t.ok('a negative value is clamped', under.includes('width:0%'));
}

// No pool key: renders plain, no verdict, no tick.
{
  const html = T.statRow('AFq', 55, 55, null);
  t.ok('unjudged row has no tick', !html.includes('tph-bar-tick'));
  t.ok('unjudged row shows an em dash for the norm', html.includes('tph-stat-n">—'));
  t.ok('unjudged row still draws a bar', html.includes('tph-bar-fill'));
  t.ok('unjudged row has no arrow', !html.includes('▲') && !html.includes('▼'));
}

// Null value: no bar at all, rather than a zero-width one implying "none".
{
  const html = T.statRow('Fold to 3-Bet', null, null, 'foldTo3Bet');
  t.ok('a null stat draws no bar', !html.includes('tph-bar-fill'));
  t.ok('a null stat still names the pool norm', html.includes(POOL_AVG.foldTo3Bet.toFixed(0) + '%'));
}

// --- Colour is driven by the shrunk figure, the text by the raw one --------

// This is what stops a two-hand player lighting up the list. The row prints
// what was observed and colours by what can be believed.
{
  const html = T.statRow('VPIP', 100, vn, 'vpip'); // raw 100, shrunk to the norm
  t.ok('the raw figure is printed', html.includes('100%'));
  t.ok('but it is coloured as typical', html.includes('tph-dev-typical'));
  t.ok('and carries no arrow', !html.includes('▲'));
}

// Escaping: labels go through escapeHtml like everything else.
{
  const html = T.statRow('<script>x</script>', 50, 50, 'vpip');
  t.ok('the label is escaped', !html.includes('<script>'));
}

process.exit(t.report());
