// buildLeakPlan — the self-facing twin of buildExploitPlan (v1.15.0). Same
// idea as DriveHUD's "MDA Exploit Report" or PT4's LeakTracker: run the exact
// same population-deviation detection against HERO's own stats instead of an
// opponent's, and phrase the advice as "fix this" rather than "exploit this".
//
// Both voices come out of one shared detection pass, buildTendencyEntries —
// the property worth locking down is that the two voices AGREE on what fired
// and how much it matters (gain/tag/when), and disagree only on wording. If
// they ever drifted apart on detection, a future threshold correction could
// silently apply to one voice and not the other.

const { load, runner } = require('./harness');

const t = runner('leak-plan');
const T = load();
T.STORE = T.emptyStore();
T.STORE.settings.minHands = 20;

const N = 300;
const pct = (x) => Math.round((x / 100) * N);
const streets = (o) => Object.assign({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
}, o);

// Same "station" fixture exploit-plan.test.js uses, so this exercises the
// same real detections — very loose, passive, folds a lot to c-bets.
const station = () => Object.assign(T.emptyPlayer('h', 'Hero'), {
  hands: N, vpip: pct(74), pfr: pct(6), limpMade: pct(52),
  foldTo3BetMade: 1, foldTo3BetOpp: 9,
  cbetMade: 12, cbetOpp: 40, foldToCbetMade: 9, foldToCbetOpp: 55,
  wtsd: pct(44), betSizes: Array(40).fill(90), betSizeCount: 60,
  streetActions: streets({
    flop: { bet: 28, raise: 2, call: 40, check: 12, fold: 9 },
    turn: { bet: 3, raise: 1, call: 28, check: 20, fold: 6 },
    river: { bet: 2, raise: 0, call: 19, check: 14, fold: 5 },
  }),
});

// --- Parity: same detection, different words --------------------------------

{
  const p = station();
  const exploit = T.buildExploitPlan(p);
  const leak = T.buildLeakPlan(p);

  t.ok('both voices produce entries for the same player', exploit.length > 0 && leak.length > 0);
  t.eq('both voices fire the same NUMBER of entries', exploit.length, leak.length);

  exploit.forEach((e, i) => {
    const l = leak[i];
    t.eq(`entry ${i} (${e.tag}): same gain in both voices`, l.gain, e.gain);
    t.eq(`entry ${i} (${e.tag}): same tag in both voices`, l.tag, e.tag);
    t.eq(`entry ${i} (${e.tag}): same relevance tagging in both voices`,
      JSON.stringify(l.when), JSON.stringify(e.when));
    t.ok(`entry ${i} (${e.tag}): the WORDING actually differs between voices`, l.text !== e.text);
    t.ok(`entry ${i} (${e.tag}): the short label actually differs between voices`, l.short !== e.short);
  });
}

// --- The wording is genuinely self-directed, not just present ---------------

{
  // This fixture is a station — loose and passive, so it trips the LOW
  // fold-to-c-bet branch (almost never folds), not the high one.
  const p = station();
  const leak = T.buildLeakPlan(p);
  const cbetEntry = leak.find((e) => e.tag === 'C-bet');
  t.ok('the leak text speaks to the reader ("You"), not about a third party',
    !!cbetEntry && cbetEntry.text.indexOf('You almost never fold to a c-bet') !== -1);
  t.ok('the leak text does not carry over the opponent-facing instruction',
    !!cbetEntry && cbetEntry.text.indexOf('Stop bluffing flops') === -1);

  const exploit = T.buildExploitPlan(p);
  const exploitCbet = exploit.find((e) => e.tag === 'C-bet');
  t.ok('the exploit text is unchanged: still third-person, about them',
    !!exploitCbet && exploitCbet.text.indexOf('Folds to c-bets only') !== -1);
}

// --- Rules that can never fire for hero stay silent, not broken -------------
//
// harvestShownCards deliberately never records hero's own cards (see
// CLAUDE.md "Showdown ranges"), so a hero record can never accumulate
// shownHands. The rule still exists in buildTendencyEntries for the leak
// voice (dead code by construction, not a special-cased skip) — this just
// confirms it doesn't produce garbage when the precondition can't be met.
{
  const p = station(); // no shownHands set at all
  const leak = T.buildLeakPlan(p);
  t.eq('no "shown at showdown" entry fires with no shown hands',
    leak.filter((e) => e.short === 'seen at showdown' || e.short === 'check your self-image').length, 0);
}

// --- Tilt and stack-swing DO apply to hero — these aren't opponent-only -----

{
  const p = station();
  p.recent = Array(15).fill(2); // raised every one of the last 15 — well off a 6%-ish norm
  p.stack = { now: 50000000, low: 40000000, high: 100000000, start: 100000000, bb: 1000000, at: Date.now() };
  const leak = T.buildLeakPlan(p);
  const stuck = leak.find((e) => e.tag === 'Stuck');
  t.ok('a stuck stack still generates a self-facing entry for hero',
    !!stuck && stuck.text.indexOf("You're down") !== -1);
}

// --- buildExploitHtml: the empty state and the tab voice match isSelf -------

{
  const T2 = load();
  T2.STORE = T2.emptyStore();
  const fresh = Object.assign(T2.emptyPlayer('h2', 'Fresh'), { hands: 5 });
  T2.STORE.players.h2 = fresh;

  const selfHtml = T2.buildExploitHtml(fresh, true);
  t.ok('empty leak state says "leaks", not "exploitable"', selfHtml.indexOf('No leaks found') !== -1);

  const oppHtml = T2.buildExploitHtml(fresh, false);
  t.ok('empty exploit state keeps its original wording', oppHtml.indexOf('Nothing clearly exploitable') !== -1);
}

{
  const p = station();
  const html = T.buildExploitHtml(p, true);
  t.ok('a populated leak report renders the same markup shape as the exploit report',
    html.indexOf('tph-plan-lead') !== -1 && html.indexOf('tph-plan-tag') !== -1);
  t.ok('leak text made it into the rendered HTML', html.indexOf('You almost never fold to a c-bet') !== -1);
}

process.exit(t.report());
