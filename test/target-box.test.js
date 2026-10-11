// Seat boxes (v1.87.0, reworked v1.101.0): green round fish to TARGET, red
// dashed round TAG / LAG / Nit to AVOID. Driven through the real
// exploitTargetKind and classify, with fixtures built from the live POOL_AVG
// bars so a future anchor correction does not need this file touched.

const { load, runner } = require('./harness');

const t = runner('target-box');
const T = load();
T.STORE = T.emptyStore();
T.STORE.settings.minHands = 20;

const N = 400;
const pct = (x) => Math.round((x / 100) * N);
const avg = T.POOL_AVG.vpip;
// A player at the given VPIP and PFR share of it, with enough postflop
// aggression to keep a loose-aggressive one a LAG rather than a Maniac.
const mk = (name, vpip, pfrShare, afq) => {
  const p = Object.assign(T.emptyPlayer(name.toLowerCase(), name), {
    hands: N, vpip: pct(vpip), pfr: pct(vpip * pfrShare), limpMade: pct(vpip * (1 - pfrShare) * 0.5),
  });
  const agg = Math.round((afq || 40) / 2);
  p.streetActions.flop = { bet: agg, raise: 0, call: 50 - agg, check: 10, fold: 10 };
  return p;
};
const players = {
  station: mk('Station', avg * T.A.looseMul + 15, 0.08),
  fish: mk('Fish', avg + 4, 0.15),
  nit: mk('Nit', avg * T.A.tightMul - 8, 0.15),
  tag: mk('Tag', avg * T.A.tightMul - 8, 0.8),
  lag: mk('Lag', avg * T.A.looseMul + 10, 0.8, 30),
  maniac: mk('Maniac', avg * T.A.looseMul + 10, 0.8, 90),
};
// Each fixture must read as the type it is named for, or the box assertions
// below test the wrong thing.
const want = { station: 'Station', fish: 'Fish', nit: 'Nit', tag: 'TAG', lag: 'LAG', maniac: 'Maniac' };
Object.keys(want).forEach((k) => t.eq(`fixture ${k} classifies as ${want[k]}`, T.classify(players[k]), want[k]));

t.eq('a station is a fish to target', T.exploitTargetKind(players.station), 'fish');
t.eq('a fish is a fish to target', T.exploitTargetKind(players.fish), 'fish');
t.eq('a TAG is one to avoid', T.exploitTargetKind(players.tag), 'avoid');
t.eq('a LAG is one to avoid', T.exploitTargetKind(players.lag), 'avoid');
t.eq('a Nit is one to avoid', T.exploitTargetKind(players.nit), 'avoid');
t.eq('a Maniac gets no box', T.exploitTargetKind(players.maniac), null);

// A player who folds to c-bets but is otherwise ordinary used to get the
// dashed "bluff" box. That box is gone.
{
  const folder = mk('Folder', avg, 0.25);
  Object.assign(folder, { foldToCbetMade: 30, foldToCbetOpp: 34 });
  t.eq('the folder fixture is Balanced', T.classify(folder), 'Balanced');
  t.eq('folding to aggression no longer draws a box', T.exploitTargetKind(folder), null);
}

// Manual tags: 📞 is a fish whatever the type; 🚪/🤥/🐍 rule out the fish box
// only, so an avoid read from the archetype still shows.
const tagged = (k, tag) => Object.assign(Object.assign({}, players[k]), { tag });
t.eq('📞 on a TAG: fish (your read wins)', T.exploitTargetKind(tagged('tag', 'station')), 'fish');
t.eq('🚪 on a station: no fish box', T.exploitTargetKind(tagged('station', 'folds')), null);
t.eq('🤥 on a fish: no fish box', T.exploitTargetKind(tagged('fish', 'bluff')), null);
t.eq('🐍 on a TAG: still avoid', T.exploitTargetKind(tagged('tag', 'trap')), 'avoid');

// Rated players only, on the setting — a 📞 tag still counts below it.
const thin = Object.assign(Object.assign({}, players.tag), { hands: 10 });
t.eq('under minHands: no box from stats', T.exploitTargetKind(thin), null);
t.eq('...but 📞 still draws one', T.exploitTargetKind(Object.assign(thin, { tag: 'station' })), 'fish');
t.eq('no record, no box', T.exploitTargetKind(null), null);

t.ok('the Nit tooltip says why', /Nit/.test(T.targetBoxText('avoid', 'Nit')));
t.ok('the TAG tooltip names the type', /TAG/.test(T.targetBoxText('avoid', 'TAG')));
t.ok('the fish tooltip says value bet', /value bet/.test(T.targetBoxText('fish', 'Fish')));

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('the box never takes a tap', /\.tph-target-box \{[^}]*pointer-events: none/.test(src));
t.ok('hero is never boxed', /const target = !isSelf && /.test(src));
t.ok('boxes are cleared with the badges', /querySelectorAll\('\.tph-badge, \.tph-target-box'\)/.test(src));
t.ok('fish and avoid differ in colour', /\.tph-target-fish \{[^}]*border-color: #3ddc84/.test(src)
  && /\.tph-target-avoid \{[^}]*border-color: #ff3b3b/.test(src));
t.ok('...and in line style, for red/green colour blindness', /\.tph-target-avoid \{[^}]*border-style: dashed/.test(src)
  && !/\.tph-target-fish \{[^}]*dashed/.test(src));
t.ok('nothing marks fold reads any more', !/\.folds = true/.test(src));

process.exit(t.report());
