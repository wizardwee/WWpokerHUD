#!/usr/bin/env node
// Re-measurement report over a real gist export, driven through the SAME
// functions the live HUD uses (test/harness.js), never a reimplementation.
//
// CLAUDE.md's whole rationale for the test seam applies here as much as it
// does to test/*.test.js: a report that recomputes VPIP means or archetype
// buckets itself is a COPY, and a copy can silently disagree with the real
// script the moment either one changes. This calls observedPoolAverages(),
// classifyProvisional(), computePoolTipSpread(), etc. directly, exactly as
// the app does, against whatever store you hand it — so it can be re-run
// after every export, not just this one.
//
// Usage: node analysis/pool-report.js /path/to/torn-poker-hud-data.json
//
// The only local logic here is arithmetic the real script doesn't already
// expose as a function: population SD/quantiles over an array of numbers,
// and reconciliation checks that the report's own filtering matches the
// script's (see poolQualifyingPlayers below, which is not on the test seam
// and is therefore re-derived and PROVEN identical by an assertion, not
// trusted by construction).

const fs = require('fs');
const path = require('path');
const { load } = require('../test/harness');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node analysis/pool-report.js /path/to/torn-poker-hud-data.json');
  process.exit(1);
}

const storageSeed = fs.readFileSync(path.resolve(file), 'utf8');
const T = load({ storageSeed });

const line = (s = '') => console.log(s);
const hr = (title) => { line(); line('='.repeat(70)); line(title); line('='.repeat(70)); };
const fmt1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : n.toFixed(1));
const fmtPct1 = (n) => (n == null || Number.isNaN(n) ? 'n/a' : n.toFixed(1) + '%');

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function popSd(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
function quantile(sortedArr, q) {
  if (!sortedArr.length) return null;
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedArr[base + 1] !== undefined
    ? sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base])
    : sortedArr[base];
}

// ---------------------------------------------------------------------------
hr('0. LOAD AND IDENTITY');
// ---------------------------------------------------------------------------

line(`HUD_VERSION=${T.HUD_VERSION}  STORE_VERSION(code)=${T.STORE_VERSION}  STORE.version(export)=${T.STORE.version}`);

// heroXid is never set by loadStore() itself — only by the DOM-driven
// findHeroXid() path, which the harness deliberately never runs (see
// harness.js's document.readyState='loading' comment). Left null, every
// pool function's hero-exclusion filter (heroUnresolved() || xid !== heroXid)
// degrades to "keep everyone", so hero's own 11k+-hand record would sit
// inside every pool average below. Set it explicitly from the export's own
// hero.xid before anything else runs.
T.heroXid = T.STORE.hero.xid;
if (T.heroUnresolved()) {
  console.error(`heroXid did not resolve from hero.xid=${T.STORE.hero.xid} — aborting, every figure below would be wrong.`);
  process.exit(1);
}
const heroRecord = T.STORE.players[T.heroXid];
if (!heroRecord) {
  console.error(`No players[${T.heroXid}] record for hero — aborting.`);
  process.exit(1);
}
if (heroRecord.hands !== T.STORE.hero.hands) {
  line(`WARNING: players[heroXid].hands=${heroRecord.hands} != STORE.hero.hands=${T.STORE.hero.hands} `
    + '(the v1.6.0 ghost-split bug looked exactly like this — see CLAUDE.md).');
} else {
  line(`Hero identity OK: players[${T.heroXid}].hands === STORE.hero.hands === ${heroRecord.hands}.`);
}

const allXids = Object.keys(T.STORE.players);
const pseudoXids = allXids.filter((x) => x.startsWith('name:'));
const pseudoQualifying = pseudoXids
  .map((x) => T.STORE.players[x])
  .filter((p) => p && p.hands >= 25);
line(`Players total: ${allXids.length}. Pseudo ("name:") records: ${pseudoXids.length}, `
  + `of which ${pseudoQualifying.length} have >=25 hands `
  + `(${pseudoQualifying.reduce((a, p) => a + p.hands, 0)} hands total) and DO count toward every pool `
  + 'figure below — poolQualifyingPlayers() only excludes hero, not pseudo-records.');

// ---------------------------------------------------------------------------
hr('1. POOL AVERAGES vs ASSUMED (POOL_AVG)');
// ---------------------------------------------------------------------------

const obs = T.observedPoolAverages();
if (!obs) {
  line('Fewer than 3 qualifying opponents — no pool read possible.');
} else {
  line(`Qualifying opponents (>=25 hands, hero excluded): ${obs.players}, ${obs.totalHands} hands of evidence.`);
  line();
  ['vpip', 'pfr', 'threeBet', 'foldTo3Bet', 'cbet', 'foldToCbet', 'limpShareOfVpip'].forEach((k) => {
    const v = obs[k];
    const norm = T.POOL_AVG[k];
    const d = T.deviation(v, norm, T.POOL_SPREAD[k]);
    line(`  ${k.padEnd(16)} observed=${fmtPct1(v)}  assumed=${fmtPct1(norm)}  `
      + `${d ? d.level + ' ' + d.dir : 'n/a'}`);
  });
  line(`  ${'afq'.padEnd(16)} observed=${fmtPct1(obs.afq)}  (no published pool figure)`);
  line(`  ${'wtsd'.padEnd(16)} observed=${fmtPct1(obs.wtsd)}  (no published pool figure)`);

  line();
  const sb = T.poolStakesBreakdown();
  line(`Stakes breakdown (${sb.total} hands with a readable blind):`);
  sb.stakes.forEach((s) => line(`  ${s.name.padEnd(20)} ${T.fmtMoney(s.bb)} BB  ${s.hands} hands  ${s.share.toFixed(0)}%`));

  line();
  line('--- poolTendencyExport() verbatim (the in-app "Download pool tendencies" report) ---');
  line(T.poolTendencyExport());
}

// ---------------------------------------------------------------------------
hr('2. SPREAD MEASUREMENT (candidate POOL_SPREAD)');
// ---------------------------------------------------------------------------

// poolQualifyingPlayers() is not on the test seam (CLAUDE.md's own worked
// example of a function deliberately NOT exported to force reconciliation
// rather than a silent copy). Re-derive its filter here and PROVE it matches
// the real one by asserting the count against observedPoolAverages()'s own
// count, rather than trusting the copy.
function qualifyingPlayers(minHands) {
  return allXids
    .filter((x) => x !== T.heroXid)
    .map((x) => T.STORE.players[x])
    .filter((p) => p && p.hands >= minHands);
}
const qual25 = qualifyingPlayers(25);
if (obs && qual25.length !== obs.players) {
  line(`WARNING: local filter found ${qual25.length} qualifying players, `
    + `observedPoolAverages() used ${obs.players} — filters have diverged, treat section 2-4 with caution.`);
} else if (obs) {
  line(`Reconciliation OK: local filter and observedPoolAverages() both count ${obs.players} qualifying players.`);
}

const RATE_KEYS = ['vpip', 'pfr', 'threeBet', 'foldTo3Bet', 'cbet', 'foldToCbet', 'limpShareOfVpip'];
line();
line('Population SD per stat, at rising sample-size cutoffs. RAW = computeRates() (what poolTendencyExport');
line('prints); SHRUNK = computeShrunkRates() (what statRow() colours and buildExploitPlan() thresholds on).');
line('The between-player spread is what these converge to as the cutoff (and thus n) rises; a SHRUNK SD at a');
line('high cutoff is the least noise-inflated estimate available here. POOL_SPREAD is printed alongside for');
line('comparison — no number below is a recommendation on its own; see the note printed after the table.');
line();
[25, 50, 100, 200].forEach((cutoff) => {
  const ps = qualifyingPlayers(cutoff);
  line(`--- cutoff >= ${cutoff} hands (n=${ps.length}) ---`);
  RATE_KEYS.forEach((k) => {
    const raw = popSd(ps.map((p) => T.computeRates(p)[k]).filter((v) => v != null && !Number.isNaN(v)));
    const shrunk = popSd(ps.map((p) => T.computeShrunkRates(p)[k]).filter((v) => v != null && !Number.isNaN(v)));
    line(`  ${k.padEnd(16)} raw_sd=${fmt1(raw)}  shrunk_sd=${fmt1(shrunk)}  POOL_SPREAD=${T.POOL_SPREAD[k]}`);
  });
  line();
});
line('Read this before touching POOL_SPREAD: a stat with few opportunities per player (e.g. foldTo3Bet, ~8');
line('chances/player) carries real binomial noise even in the SHRUNK column at n=25 — the SD only settles');
line('once both the cutoff is high AND enough players remain. Prefer the highest cutoff that still leaves');
line('n>=50 for that stat.');

// ---------------------------------------------------------------------------
hr('3. ARCHETYPES');
// ---------------------------------------------------------------------------

line(`A (thresholds): tight=${T.A.tight.toFixed(1)} loose=${T.A.loose.toFixed(1)} `
  + `aggRatio=${T.A.aggRatio} passiveRatio=${T.A.passiveRatio}`);
line(`STORE.settings.minHands (gates classify(), not classifyProvisional()) = ${T.STORE.settings.minHands}`);
line();

const provCounts = {};
const gatedCounts = {};
qual25.forEach((p) => {
  const prov = T.classifyProvisional(p);
  const gated = T.classify(p);
  provCounts[prov] = (provCounts[prov] || 0) + 1;
  gatedCounts[gated] = (gatedCounts[gated] || 0) + 1;
});
line('classifyProvisional() distribution (no minHands gate, what the seat badge uses), n=' + qual25.length + ':');
Object.entries(provCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  line(`  ${k.padEnd(10)} ${v}  (${((100 * v) / qual25.length).toFixed(0)}%)`);
});
line();
line('classify() distribution (gated on minHands=' + T.STORE.settings.minHands + '), n=' + qual25.length + ':');
Object.entries(gatedCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  line(`  ${k.padEnd(10)} ${v}  (${((100 * v) / qual25.length).toFixed(0)}%)`);
});

line();
const ratios = qual25
  .map((p) => T.computeShrunkRates(p))
  .filter((r) => r.vpip != null && r.vpip > 0 && r.pfr != null)
  .map((r) => r.pfr / r.vpip)
  .sort((a, b) => a - b);
line(`PFR/VPIP ratio (shrunk rates), n=${ratios.length} — where A.aggRatio=${T.A.aggRatio} and `
  + `A.passiveRatio=${T.A.passiveRatio} sit in the real distribution:`);
[0.1, 0.25, 0.5, 0.75, 0.9].forEach((q) => {
  line(`  p${(q * 100).toFixed(0).padStart(2)} = ${quantile(ratios, q).toFixed(3)}`);
});
line('(v1.11.0 measured pool PFR/VPIP = 0.221 and left aggRatio/passiveRatio untouched as independent');
line('judgement calls — see CLAUDE.md "The pool average is measured, not borrowed" — this is that same check.)');

// ---------------------------------------------------------------------------
hr('4. COACH TIP SPREAD (CLAUDE.md "Next task" #3)');
// ---------------------------------------------------------------------------

const sp = T.computePoolTipSpread();
if (!sp) {
  line('Fewer than 3 qualifying players with a plan — no tip-spread read possible.');
} else {
  line(`players=${sp.players}  withRead=${sp.withRead}  distinct leading reads=${sp.distinct}  `
    + `(no read at all: ${sp.players - sp.withRead})`);
  line();
  line('Leading-read concentration (this is the number the v1.51.0 tuning pass was reasoning about from a');
  line('400-player SYNTHETIC pool — 45% pre-edge-term, 41% post — here measured on the real tracked pool):');
  sp.rows.forEach((r) => line(`  ${r.label.padEnd(24)} ${r.n.toString().padStart(4)}  ${r.pct.toFixed(1)}%`));

  // State reads (tilt/stuck/winning-type signals) vs tendency reads, by tag.
  const STATE_TAGS = new Set(['Tilt', 'Stuck', 'Winning', 'Aggressor']);
  const stateN = sp.rows.filter((r) => STATE_TAGS.has(r.label)).reduce((a, r) => a + r.n, 0);
  line();
  line(`Rows matching a state-read tag {${[...STATE_TAGS].join(', ')}}: ${stateN} of ${sp.withRead} `
    + `(${((100 * stateN) / sp.withRead).toFixed(0)}%) lead reads. Remainder are tendency-frequency reads.`);

  // Gain-ladder table: walk every qualifying player's plan (not just the
  // winner) to see the full ladder's shape, not just who leads.
  line();
  line('Gain ladder, from every entry buildExploitPlan() produced (not just leaders):');
  const ladder = new Map(); // short -> {gain, tag, fires, leads, edges: []}
  qual25.forEach((p) => {
    const plan = T.buildExploitPlan(p);
    if (!plan.length) return;
    const sorted = plan.slice().sort((a, b) => T.tipBaseScore(b) - T.tipBaseScore(a));
    const leaderLabel = sorted[0].short || sorted[0].tag;
    plan.forEach((entry) => {
      const label = entry.short || entry.tag;
      if (!ladder.has(label)) ladder.set(label, { gain: entry.gain, tag: entry.tag, fires: 0, leads: 0, edges: [] });
      const row = ladder.get(label);
      row.fires += 1;
      if (label === leaderLabel) row.leads += 1;
      if (typeof entry.edge === 'number') row.edges.push(entry.edge);
    });
  });
  const ladderRows = Array.from(ladder.entries()).sort((a, b) => b[1].gain - a[1].gain);
  line('  ' + 'label'.padEnd(24) + 'gain'.padStart(6) + 'fires'.padStart(8) + 'leads'.padStart(8) + 'medEdge'.padStart(10));
  ladderRows.forEach(([label, row]) => {
    const edges = row.edges.slice().sort((a, b) => a - b);
    const medEdge = edges.length ? quantile(edges, 0.5) : null;
    line('  ' + label.padEnd(24) + String(row.gain).padStart(6) + String(row.fires).padStart(8)
      + String(row.leads).padStart(8) + (medEdge == null ? 'n/a'.padStart(10) : medEdge.toFixed(2).padStart(10)));
  });
}

// ---------------------------------------------------------------------------
hr('5. HERO THROUGH THE REAL RULES');
// ---------------------------------------------------------------------------

line(`Archetype (provisional): ${T.classifyProvisional(heroRecord)}`);
const heroRates = T.computeRates(heroRecord);
RATE_KEYS.concat(['afq', 'wtsd']).forEach((k) => {
  line(`  ${k.padEnd(16)} ${fmtPct1(heroRates[k])}`);
});
line();
const leaks = T.buildLeakPlan(heroRecord).slice().sort((a, b) => T.tipBaseScore(b) - T.tipBaseScore(a));
line(`Leak plan (${leaks.length} entries, highest gain first):`);
leaks.forEach((e) => line(`  [${e.gain}] ${e.text}`));

// ---------------------------------------------------------------------------
hr('6. ARTIFACT CROSS-CHECK');
// ---------------------------------------------------------------------------

line('Figures the pool-analyzer.html artifact should reproduce exactly from the same export:');
if (obs) {
  line(`  qualifying opponents (>=25 hands, hero excluded): ${obs.players}`);
  RATE_KEYS.forEach((k) => line(`  pool mean ${k}: ${fmt1(obs[k])}`));
}
line(`  hero raw vpip: ${fmt1(heroRates.vpip)}   hero raw pfr: ${fmt1(heroRates.pfr)}`);
const plSum = Object.values(T.STORE.players)
  .filter((p) => p.xid !== T.heroXid)
  .reduce((a, p) => a + (p.plChipsEst || 0), 0);
line(`  sum(opponent plChipsEst): ${Math.round(plSum).toLocaleString()}  (hero.netChips: `
  + `${T.STORE.hero.netChips.toLocaleString()})`);
line('If the artifact disagrees with any line above on the same export file, the artifact has a bug.');

// ---------------------------------------------------------------------------
hr('7. WHAT THIS EXPORT CANNOT ANSWER');
// ---------------------------------------------------------------------------

line('CLAUDE.md "Next task" #1 (DEPARTURE_BURST_MAX) and #2 (departure-pill drag) both need consecutive');
line('live seat sweeps and real touch input. STORE.departedWatch / lastSeatedSnapshot are in-memory only and');
line('are never part of the exported store — nothing in this export bears on either question. Both still');
line('need a live-table report, same as any DOM selector in this file.');
