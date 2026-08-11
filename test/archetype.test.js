// Archetype classification against the Torn pool, with shrinkage.
//
// Two things these lock down:
//
// 1. Thresholds are POOL-RELATIVE. Torn's pool plays ~51% of hands and raises
//    ~13%; thresholds written for normal live poker (nit under 15 VPIP, fish
//    over 35) put almost the entire population in one bucket, which is
//    technically true and completely uninformative.
// 2. Rates are shrunk toward the pool average before classifying, so a player
//    seen for two hands who played both does not read as a 100%-VPIP maniac.

const { load, runner } = require('./harness');

const t = runner('archetype');
const T = load();
T.STORE = T.emptyStore();

const { POOL_AVG, PRIOR_WEIGHT, A } = T;

// Build a player record with the given observed counts.
function player(o) {
  const p = T.emptyPlayer('x', 'Test');
  return Object.assign(p, o);
}

// --- Shrinkage arithmetic ---------------------------------------------------

t.near('no observations returns the pool average', T.shrunkPct(0, 0, POOL_AVG.vpip), POOL_AVG.vpip);

// A tiny sample is dominated by the prior, not by the observation.
const twoOfTwo = T.shrunkPct(2, 2, POOL_AVG.vpip);
t.ok('2/2 is pulled well below 100%', twoOfTwo < 65);
t.ok('2/2 still reads above the pool average', twoOfTwo > POOL_AVG.vpip);

// A large sample is barely touched.
const bigSample = T.shrunkPct(800, 1000, POOL_AVG.vpip);
t.ok('800/1000 stays close to the observed 80%', Math.abs(bigSample - 80) < 4);

// Shrinkage always moves toward the pool, never past it.
[[0, 10], [3, 10], [10, 10], [1, 200], [199, 200]].forEach(([made, opps]) => {
  const raw = (100 * made) / opps;
  const s = T.shrunkPct(made, opps, POOL_AVG.vpip);
  const movedToward = Math.abs(s - POOL_AVG.vpip) <= Math.abs(raw - POOL_AVG.vpip) + 1e-9;
  t.ok(`${made}/${opps} moves toward the pool, not past it`, movedToward);
});

t.eq('prior weight is stated in pseudo-observations', typeof PRIOR_WEIGHT, 'number');

// --- Classification is pool-relative ----------------------------------------

// Enough hands that shrinkage is not doing the work here.
const N = 300;
const withRates = (vpipPct, pfrPct, extra) => player(Object.assign({
  hands: N,
  vpip: Math.round((vpipPct / 100) * N),
  pfr: Math.round((pfrPct / 100) * N),
}, extra || {}));

// A player at the pool average must NOT be an extreme label — that was the
// whole failure: everyone came out "Fish".
const average = withRates(POOL_AVG.vpip, POOL_AVG.pfr);
const avgLabel = T.classifyProvisional(average);
t.ok(`pool-average player is not Nit/LAG/Maniac (got ${avgLabel})`,
  !['Nit', 'LAG', 'Maniac'].includes(avgLabel));

// Every boundary case below is expressed RELATIVE to the live A/POOL_AVG
// thresholds rather than as a hardcoded VPIP number. POOL_AVG is measured
// pool data (v1.11.0) that gets corrected as more hands accrue — a fixed
// "22% VPIP" input would silently start testing a different bucket the next
// time that correction happens (this exact thing broke once already, when
// POOL_AVG.vpip moved from 50.9 to 42.5 and a hardcoded 58 crossed from
// "Fish" into "Station" without the test itself changing at all).

// Comfortably below A.tight, weak raising.
t.eq('tight + passive is a Nit',
  T.classifyProvisional(withRates(A.tight * 0.85, A.tight * 0.85 * 0.2)), 'Nit');
// Just below A.tight, strong raising.
t.eq('tight + aggressive is a TAG',
  T.classifyProvisional(withRates(A.tight * 0.95, A.tight * 0.95 * 0.6)), 'TAG');

// Comfortably above A.loose, strong raising.
t.eq('very loose + aggressive is a LAG',
  T.classifyProvisional(withRates(A.loose * 1.3, A.loose * 1.3 * 0.6)), 'LAG');

// Comfortably above A.loose, almost never raises.
t.eq('very loose + no raising is a Station',
  T.classifyProvisional(withRates(A.loose * 1.3, A.loose * 1.3 * 0.05)), 'Station');

// Strictly between the pool average and A.loose (1.0x-1.15x), with weak
// raising — the gap the Fish rule exists to catch. 1.075x always sits
// inside that gap by construction, whatever POOL_AVG.vpip happens to be.
t.eq('above-pool + weak raising is a Fish',
  T.classifyProvisional(withRates(POOL_AVG.vpip * 1.075, POOL_AVG.vpip * 1.075 * 0.2)), 'Fish');

// --- Shrinkage changes the label for tiny samples ---------------------------

// One hand, played and raised. Raw rates say 100/100 — a LAG on any threshold.
const oneHand = player({ hands: 1, vpip: 1, pfr: 1 });
const rawOne = T.computeRates(oneHand);
const shrunkOne = T.computeShrunkRates(oneHand);

t.eq('raw VPIP over one hand is 100%', rawOne.vpip, 100);
t.ok('shrunk VPIP over one hand is near the pool average',
  Math.abs(shrunkOne.vpip - POOL_AVG.vpip) < 10);
t.ok(`one hand does not classify as an extreme (got ${T.classifyProvisional(oneHand)})`,
  !['LAG', 'Maniac', 'Nit'].includes(T.classifyProvisional(oneHand)));

// --- computeRates stays raw -------------------------------------------------

// The Stats tab must keep showing what was actually observed. Shrinkage is for
// classification, not for reporting.
const half = player({ hands: 100, vpip: 50, pfr: 20 });
t.eq('computeRates VPIP is unshrunk', T.computeRates(half).vpip, 50);
t.eq('computeRates PFR is unshrunk', T.computeRates(half).pfr, 20);
t.ok('computeShrunkRates differs from raw', T.computeShrunkRates(half).pfr !== 20);

// --- minHands gate still applies to the non-provisional path ---------------

T.STORE.settings.minHands = 20;
t.eq('under minHands is Unrated', T.classify(player({ hands: 5, vpip: 3, pfr: 1 })), 'Unrated');
t.ok('over minHands gets a real label',
  T.classify(withRates(20, 4)) !== 'Unrated');

// --- Observed pool average --------------------------------------------------

T.STORE = T.emptyStore();
t.eq('too few tracked players reports nothing', T.observedPoolAverages(), null);

for (let i = 0; i < 5; i++) {
  T.STORE.players['p' + i] = player({ xid: 'p' + i, hands: 100, vpip: 50, pfr: 15 });
}
const obs = T.observedPoolAverages();
t.eq('reports the number of players it used', obs.players, 5);
t.near('observed VPIP matches what was stored', obs.vpip, 50);
t.near('observed PFR matches what was stored', obs.pfr, 15);

// --- Short forms for the badge ---------------------------------------------

// The badge has no room for "Balanced" alongside three numbers, and the full
// word crowded them out.
Object.keys(T.ARCHETYPE_SHORT).forEach((full) => {
  const s = T.shortType(full);
  t.eq(`${full} shortens to 3 chars`, s.length, 3);
  t.eq(`${full} shortens uppercase`, s, s.toUpperCase());
});
t.eq('Balanced is BAL', T.shortType('Balanced'), 'BAL');
t.eq('Station is STA', T.shortType('Station'), 'STA');
t.eq('Maniac is MAN', T.shortType('Maniac'), 'MAN');

// Short forms must stay unique, or two different reads render identically.
{
  const shorts = Object.keys(T.ARCHETYPE_SHORT).map(T.shortType);
  t.eq('every short form is distinct', new Set(shorts).size, shorts.length);
}

// Every archetype the rules can produce needs a short form, including the
// Balanced fallback that no rule names.
{
  const produced = T.ARCHETYPE_RULES.map((r) => r.name).concat(['Balanced', 'Unrated']);
  produced.forEach((name) => {
    t.ok(`${name} has an explicit short form`, !!T.ARCHETYPE_SHORT[name]);
  });
}

// An unknown label degrades rather than throwing.
t.eq('an unknown label is truncated', T.shortType('Whatever'), 'WHA');
t.eq('an empty label does not throw', T.shortType(''), '');

process.exit(t.report());
