// Per-street fold reads are fold-to-a-BET (v1.103.0).
//
// The rule used to read fold / every action on the street, checks and bets
// included. A real opponent who folded 37% of the turn bets they faced read
// "folds 14% of turn decisions", and the exploit plan said never to bluff
// them. These are that opponent's real counters, from a backup.

const { load, runner } = require('./harness');

const t = runner('street-fold');
const T = load();
T.STORE = T.emptyStore();

function playerWith(streetActions) {
  const p = T.emptyPlayer('4390971');
  Object.assign(p, { hands: 1654, vpip: 559, pfr: 230, streetActions });
  return p;
}

const real = playerWith({
  flop: { bet: 130, raise: 20, call: 104, check: 282, fold: 152 },
  turn: { bet: 105, raise: 22, call: 79, check: 148, fold: 59 },
  river: { bet: 35, raise: 22, call: 32, check: 119, fold: 50 },
});
const r = T.computeRates(real);
t.near('turn: 59 folds of 160 bets faced', r.byStreet.turn.foldPct, (100 * 59) / 160);
t.near('river: 50 of 104', r.byStreet.river.foldPct, (100 * 50) / 104);

const plan = T.buildExploitPlan(real);
t.ok('no "no turn bluffs" for a 37% turn folder', !plan.some((e) => e.short === 'no turn bluffs'));
t.ok('no "no river bluffs" for a 48% river folder', !plan.some((e) => e.short === 'no river bluffs'));

// Genuinely sticky, and genuinely fold-happy, still fire.
const sticky = playerWith({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 10, raise: 5, call: 30, check: 40, fold: 5 },   // 5 / 40 = 12.5%
  river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
});
t.ok('a 12% turn folder gets "no turn bluffs"',
  T.buildExploitPlan(sticky).some((e) => e.short === 'no turn bluffs'));
const folder = playerWith({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  river: { bet: 5, raise: 1, call: 4, check: 50, fold: 20 },  // 20 / 25 = 80%
});
t.ok('an 80% river folder gets "barrel the river"',
  T.buildExploitPlan(folder).some((e) => e.short === 'barrel the river'));

// Below the sample gate nothing fires, however extreme.
const thin = playerWith({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 0, raise: 0, call: 0, check: 60, fold: T.STREET_FOLD_MIN - 1 },
  river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
});
t.ok('under STREET_FOLD_MIN bets faced, no read',
  !T.buildExploitPlan(thin).some((e) => e.tag === 'Fold'));

// The bars are measured (pool ~50-57% on every street, SD ~13). Pinned
// against literals so a nudge has to be argued for here.
t.eq('high bar', T.STREET_FOLD_HIGH, 70);
t.eq('low bar', T.STREET_FOLD_LOW, 35);
t.ok('the low bar is above a half-pot bluff\'s break-even (33%)', T.STREET_FOLD_LOW > 100 / 3);

// The old wording described the old denominator; it must not come back.
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('no "decisions" fold wording left', !/of (their |your )?\$\{st\} decisions/.test(src));

process.exit(t.report());
