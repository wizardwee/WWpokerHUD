// v1.87.0: a red box round seats worth exploiting. Two kinds, because they
// call for opposite plays: 'value' (calls too much — never bluff) and 'bluff'
// (folds to aggression). Driven through the real exploitTargetKind, which reads
// buildExploitPlan's own fold marks rather than re-testing thresholds.

const { load, runner } = require('./harness');

const t = runner('target-box');
const T = load();
T.STORE = T.emptyStore();
T.STORE.settings.minHands = 20;

const N = 200;
const pct = (x) => Math.round((x / 100) * N);
const streets = (o) => Object.assign({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
}, o);

// Loose and passive: a station/fish by archetype, and never folds a flop.
const station = () => Object.assign(T.emptyPlayer('v', 'Station'), {
  hands: N, vpip: pct(74), pfr: pct(6), limpMade: pct(52),
  foldTo3BetMade: 1, foldTo3BetOpp: 9, foldToCbetMade: 9, foldToCbetOpp: 55,
  streetActions: streets({ flop: { bet: 2, raise: 1, call: 40, check: 12, fold: 9 } }),
});
// Ordinary preflop, but folds to c-bets far past the pool.
const folder = () => Object.assign(T.emptyPlayer('f', 'Folder'), {
  hands: N, vpip: pct(40), pfr: pct(10), limpMade: pct(15),
  foldToCbetMade: 30, foldToCbetOpp: 34,
  streetActions: streets({ flop: { bet: 10, raise: 2, call: 10, check: 12, fold: 30 } }),
});
// Ordinary everywhere: no box.
const plain = () => Object.assign(T.emptyPlayer('p', 'Plain'), {
  hands: N, vpip: pct(40), pfr: pct(10), limpMade: pct(15),
  foldToCbetMade: 15, foldToCbetOpp: 34,
  streetActions: streets({ flop: { bet: 10, raise: 2, call: 14, check: 12, fold: 15 } }),
});

t.ok('the station fixture reads as soft', ['Fish', 'Station'].includes(T.classify(station())));
t.eq('a fish/station gets the value box', T.exploitTargetKind(station()), 'value');
t.ok('the folder fixture fires the plan\'s fold-to-c-bet read',
  T.buildExploitPlan(folder()).some((e) => e.folds && e.tag === 'C-bet'));
t.eq('a player who folds to c-bets gets the bluff box', T.exploitTargetKind(folder()), 'bluff');
t.eq('an ordinary player gets no box', T.exploitTargetKind(plain()), null);

// The fold marks sit on the FOLDING branches only — a station's "rarely folds
// to c-bets" entry shares the tag and must not be marked.
t.ok('a non-folding c-bet read is not marked as folding',
  !T.buildExploitPlan(station()).some((e) => e.folds));

// Only the entry that IS a fold read gets the mark: a player who never folds
// to a c-bet but folds to 3-bets has a non-fold c-bet entry ahead of the
// fold-to-3-bet one.
{
  const mixed = Object.assign(station(), { foldTo3BetMade: 17, foldTo3BetOpp: 18 });
  const plan = T.buildExploitPlan(mixed);
  t.ok('the fold-to-3-bet read is marked', plan.some((e) => e.folds && e.tag === '3-bet'));
  t.ok('the c-bet read beside it is not', plan.some((e) => e.tag === 'C-bet') && !plan.some((e) => e.folds && e.tag === 'C-bet'));
}

// Manual tags win, both ways, and the cautionary ones suppress the box.
const tagged = (mk, tag) => Object.assign(mk(), { tag });
t.eq('📞 on an ordinary player: value', T.exploitTargetKind(tagged(plain, 'station')), 'value');
t.eq('🚪 on a station: bluff (your read wins)', T.exploitTargetKind(tagged(station, 'folds')), 'bluff');
t.eq('🐍 suppresses the box', T.exploitTargetKind(tagged(station, 'trap')), null);
t.eq('🤥 suppresses the box', T.exploitTargetKind(tagged(folder, 'bluff')), null);

// Rated players only, on the setting — and a manual tag still counts below it.
// A folder's fold read has its own spot gate (8+), which 34 spots clears — so
// only the minHands gate can keep this thin record unboxed.
const thin = Object.assign(folder(), { hands: 10 });
t.ok('the thin fixture still fires the fold read', T.buildExploitPlan(thin).some((e) => e.folds));
t.eq('under minHands: no box from stats', T.exploitTargetKind(thin), null);
t.eq('...but your tag still draws one', T.exploitTargetKind(Object.assign(thin, { tag: 'station' })), 'value');
T.STORE.settings.minHands = 5;
t.eq('the gate reads the setting', T.exploitTargetKind(Object.assign(station(), { hands: 10 })), 'value');
t.eq('no record, no box', T.exploitTargetKind(null), null);

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('the box never takes a tap', /\.tph-target-box \{[^}]*pointer-events: none/.test(src));
t.ok('hero is never boxed', /const target = !isSelf && /.test(src));
t.ok('boxes are cleared with the badges', /querySelectorAll\('\.tph-badge, \.tph-target-box'\)/.test(src));

process.exit(t.report());
