// Bluff tracking: betting or raising with nothing at all, at showdown.
//
// This was a genuine gap, not a "check whether it's already collected" case
// like board texture — noteBetTexture already categorised made (cat >= 2) and
// draw (cat < 2 with a live flush/straight draw) bets, but silently dropped
// everything else. A bet with NO pair and NO draw — genuinely nothing — was
// never counted anywhere. That gap is exactly the definition of a bluff.
//
// Two things this touches that were already flagged as unfinished elsewhere:
// - v1.21.0's changelog explicitly notes betDrawPct/betMadePct were still a
//   raw sum/count average, "out of scope for THAT pass". Adding a third
//   bucket in that same shape would have been inconsistent, so all three now
//   use a bounded window + median, same pattern as betSizes.
// - The caveat here is stronger than the usual "floor on a range" one. A
//   bluff that WORKS ends in a fold and never reaches showdown, so this
//   cannot merely be thin — it is structurally biased low by exactly the
//   bluffs good enough to take the pot uncontested. A LOW reading is
//   genuinely ambiguous (rarely bluffs, vs. bluffs a lot and it usually
//   works) and must not be read as "they don't bluff enough."

const { load, runner } = require('./harness');

const t = runner('bluff-tracking');

const T = load();
const C = (s) => ({ rank: s[0], suit: s[1] });
const cards = (s) => s.split(',').map((x) => C(x.trim()));

function handWith(street, board, extra) {
  const h = T.freshHandState();
  h.street = street;
  h.board = board;
  return Object.assign(h, extra);
}

// --- Categorisation ----------------------------------------------------------

{
  // Genuinely nothing: worse than a pair, no draw. The core case.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('2h, 5h'); // no pair, no flush/straight draw on this board
  const h = handWith('flop', cards('Kc, 9d, 3s'), {
    actions: [{ x: 'V', a: 'bet', s: 'flop', p: 33 }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('a bet with nothing is counted as a bluff', p.texture.bluffBets, 1);
  t.eq('not as made', p.texture.madeBets, 0);
  t.eq('not as a draw', p.texture.drawBets, 0);
  t.eq('and its size is recorded', p.texture.bluffSizes[0], 33);
}

{
  // A draw has real equity — a semi-bluff, not the thing this stat calls a
  // bluff. Must land in drawBets, never bluffBets.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('Ah, Kh'); // nut flush draw, no pair
  const h = handWith('flop', cards('7h, 2h, 9s'), {
    actions: [{ x: 'V', a: 'bet', s: 'flop', p: 50 }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('a live draw is counted as a draw', p.texture.drawBets, 1);
  t.eq('never as a bluff', p.texture.bluffBets, 0);
}

{
  // A lone pair with no draw: not made (this file's bar is two pair+), not a
  // bluff (a pair is not zero equity). Deliberately uncounted — an honest gap,
  // not a bug, same principle as WTSD's unshrunk treatment.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('Kh, 2d'); // pairs the board, no draw
  const h = handWith('flop', cards('Kc, 9d, 3s'), {
    actions: [{ x: 'V', a: 'bet', s: 'flop', p: 50 }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('a lone pair is not counted as made', p.texture.madeBets, 0);
  t.eq('not as a draw', p.texture.drawBets, 0);
  t.eq('and not as a bluff either', p.texture.bluffBets, 0);
}

{
  // The river has no draw left to hold — TEXTURE_DRAW_STREETS excludes it —
  // so nothing on the river with no pair must fall straight through to bluff,
  // never getting a chance at the draw bucket by mistake.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('2h, 5c');
  const h = handWith('river', cards('Kc, 9d, 3s, 7h, Qd'), {
    actions: [{ x: 'V', a: 'bet', s: 'river', p: 75 }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('a river bet with nothing is a bluff', p.texture.bluffBets, 1);
  t.eq('never counted as a draw (none exists by the river)', p.texture.drawBets, 0);
}

{
  // A made hand still counts as made even where a draw was ALSO technically
  // possible on the board — made is checked first, and correctly wins.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('9h, 9c'); // trips with the board pair
  const h = handWith('flop', cards('9d, 2h, 7h'), {
    actions: [{ x: 'V', a: 'bet', s: 'flop', p: 66 }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('trips is made, not a draw', p.texture.madeBets, 1);
  t.eq('and not a bluff', p.texture.bluffBets, 0);
}

{
  // raise and all-in must count exactly like bet — not just literal 'bet'.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('2h, 5c');
  const h = handWith('turn', cards('Kc, 9d, 3s, 7h'), {
    actions: [
      { x: 'V', a: 'raise', s: 'turn', p: 100 },
      { x: 'V', a: 'all-in', s: 'turn', p: 400 },
    ],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('raise and all-in both count toward bluffBets', p.texture.bluffBets, 2);
}

{
  // Checking with nothing is not interesting and must not be counted as
  // anything — only checkMade (checking a MADE hand, the slowplay signal)
  // is tracked at all.
  const X = load();
  const p = X.getPlayer('V');
  const hole = cards('2h, 5c');
  const h = handWith('flop', cards('Kc, 9d, 3s'), {
    actions: [{ x: 'V', a: 'check', s: 'flop' }],
  });
  X.noteBetTexture('V', hole, h);
  t.eq('a check is not counted as a bluff', p.texture.bluffBets, 0);
  t.eq('nor anywhere else', p.texture.madeBets + p.texture.drawBets + p.texture.checkMade, 0);
}

// --- The rolling window ------------------------------------------------------

{
  const arr = [];
  for (let i = 0; i < T.TEXTURE_BET_HISTORY_MAX + 10; i += 1) T.pushTextureSize(arr, i);
  t.eq('the window is capped', arr.length, T.TEXTURE_BET_HISTORY_MAX);
  t.eq('oldest values are dropped first', arr[0], 10);

  const before = [1, 2, 3];
  T.pushTextureSize(before, 'not a number');
  t.eq('a non-number is silently ignored, not pushed', before.length, 3);
}

// --- Derived rates ------------------------------------------------------------

const bareStreets = () => ({
  flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
  river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
});

{
  const bare = { streetActions: bareStreets() };
  t.eq('no texture at all yields nulls, not a throw', T.computeRates(bare).betBluffPct, null);
  t.eq('and no bluff rate either', T.computeRates(bare).bluffRate, null);
  t.eq('with a zero sample', T.computeRates(bare).bluffSample, 0);
}

{
  const p = {
    streetActions: bareStreets(),
    texture: {
      madeBets: 8, madeSizes: [70, 80, 90],
      drawBets: 2, drawSizes: [40],
      bluffBets: 4, bluffSizes: [10, 20, 30],
      checkMade: 0,
    },
  };
  const r = T.computeRates(p);
  t.eq('betBluffPct is the median of the bluff window', r.betBluffPct, 20);
  t.eq('betBluffCount is the lifetime bluffBets count, not the window length', r.betBluffCount, 4);
  t.eq('bluffSample sums all three showdown-categorised buckets', r.bluffSample, 14);
  t.eq('bluffRate is bluffBets over that total', Math.round(r.bluffRate * 100) / 100,
    Math.round((100 * 4 / 14) * 100) / 100);
}

// --- Exploit plan: sizing tell -------------------------------------------------

{
  // Bets small when bluffing, big when they have it — the classic tell, and
  // exactly the "how much" half of what was asked for.
  const X = load();
  const v = X.getPlayer('V');
  v.hands = 60;
  for (let i = 0; i < 8; i += 1) T.pushTextureSize(v.texture.bluffSizes, 20);
  v.texture.bluffBets = 8;
  for (let i = 0; i < 8; i += 1) T.pushTextureSize(v.texture.madeSizes, 80);
  v.texture.madeBets = 8;

  const plan = X.buildExploitPlan(v).filter((e) => e.tag === 'Bluff');
  const sizing = plan.find((e) => e.short === 'their small bet = air');
  t.ok('the sizing tell fires when bluff and made sizing genuinely diverge', !!sizing);
  t.ok('it states the actual figures', sizing.text.includes('20% pot') && sizing.text.includes('80%'));
}

{
  // Below TEXTURE_MIN, nothing fires — same sample discipline as every other
  // gated stat in this file, checked against the SAME numbers the figure
  // comes from (v1.26.0's lesson).
  const X = load();
  const v = X.getPlayer('V');
  v.hands = 60;
  T.pushTextureSize(v.texture.bluffSizes, 20);
  v.texture.bluffBets = 1;
  T.pushTextureSize(v.texture.madeSizes, 80);
  v.texture.madeBets = 1;
  const plan = X.buildExploitPlan(v).filter((e) => e.tag === 'Bluff');
  t.eq('a one-observation sample surfaces nothing', plan.length, 0);
}

// --- Exploit plan: frequency, and the asymmetric caveat -----------------------

{
  const X = load();
  const v = X.getPlayer('V');
  v.hands = 60;
  // 6 bluffs, 4 made, out of a total of 10 — 60% bluff rate, well over the
  // high-rate threshold.
  for (let i = 0; i < 6; i += 1) T.pushTextureSize(v.texture.bluffSizes, 30);
  v.texture.bluffBets = 6;
  for (let i = 0; i < 4; i += 1) T.pushTextureSize(v.texture.madeSizes, 70);
  v.texture.madeBets = 4;

  const plan = X.buildExploitPlan(v).filter((e) => e.tag === 'Bluff');
  const freq = plan.find((e) => e.short === 'calls too light vs their air');
  t.ok('a high bluff rate surfaces a frequency read', !!freq);
  t.ok('and states the floor caveat', freq.text.includes('floor'));

  // Same read in hero's own voice (buildLeakPlan) must carry the same caveat —
  // this is the ONLY thing distinguishing the two calls (voice: 'exploit' vs
  // 'leak' picks text vs leakText inside add()), so it is easy for a fix to
  // land in one and not the other, exactly as happened below.
  const leakPlan = X.buildLeakPlan(v).filter((e) => e.tag === 'Bluff');
  const leakFreq = leakPlan.find((e) => e.short === "pick bluff spots, don't habit-bluff");
  t.ok('the leak-voice entry exists too', !!leakFreq);
  t.ok('and it also states the floor caveat', leakFreq.text.includes('floor'));
}

{
  const X = load();
  const v = X.getPlayer('V');
  v.hands = 60;
  // 1 bluff, 29 made — a genuinely low showdown bluff rate (~3%).
  T.pushTextureSize(v.texture.bluffSizes, 30);
  v.texture.bluffBets = 1;
  for (let i = 0; i < 29; i += 1) T.pushTextureSize(v.texture.madeSizes, 70);
  v.texture.madeBets = 29;

  const plan = X.buildExploitPlan(v).filter((e) => e.tag === 'Bluff');
  const freq = plan.find((e) => e.short === 'their showdown bet = real');
  t.ok('a low bluff rate still surfaces a read', !!freq);
  // The actual point of this test: a LOW rate must not be read as "they don't
  // bluff enough", because a working bluff is invisible to this stat and a
  // low reading is equally consistent with "bluffs a lot and it usually
  // works". Asserting the exact opposite framing never shipped.
  t.ok('it does not claim they should bluff more', !/bluff more/i.test(freq.text));
  t.ok('and it does not assert a fold-equity claim this data cannot support',
    !/leaving fold equity/i.test(freq.text));

  // The overclaim this guards against was actually caught here, in draft, in
  // the LEAK (hero's own voice) text specifically — buildExploitPlan's villain
  // text was fine throughout. Checking only .text (the exploit-voice field, the
  // default) would have missed it entirely, so both voices are asserted.
  const leakPlan = X.buildLeakPlan(v).filter((e) => e.tag === 'Bluff');
  const leakFreq = leakPlan.find((e) => e.short === 'no change needed here');
  t.ok('the leak-voice entry exists too', !!leakFreq);
  t.ok('it also does not claim hero should bluff more', !/bluff more/i.test(leakFreq.text));
  t.ok('and does not assert an unsupported fold-equity claim',
    !/leaving fold equity/i.test(leakFreq.text));
}

// --- ensurePlayerShape: backfilling the old sum/count shape -------------------

{
  // A record written before this shipped has drawPctSum/drawPctN/madePctSum/
  // madePctN, not drawSizes/madeSizes/bluffBets/bluffSizes. The old fields are
  // left alone (harmless dead weight, same precedent as betSizePctSum after
  // v1.21.0) while the new ones are added so computeRates never reads
  // undefined.
  const X = load();
  X.STORE.players.OLD = {
    name: 'Old',
    texture: { drawBets: 5, drawPctSum: 250, drawPctN: 5, madeBets: 3, madePctSum: 210, madePctN: 3, checkMade: 1 },
  };
  const p = X.getPlayer('OLD');
  t.eq('old counts survive', p.texture.drawBets, 5);
  t.eq('old checkMade survives', p.texture.checkMade, 1);
  t.ok('new array fields are added', Array.isArray(p.texture.drawSizes));
  t.eq('starting empty, not synthesised from the old sum', p.texture.drawSizes.length, 0);
  t.eq('bluffBets is backfilled to zero', p.texture.bluffBets, 0);
  t.ok('bluffSizes is backfilled as an array', Array.isArray(p.texture.bluffSizes));
  // computeRates must not throw or silently misread the leftover old fields.
  const r = X.computeRates(p);
  t.eq('betDrawPct reads the (empty) new window, not the stale old average', r.betDrawPct, null);
}

{
  // No texture object at all — an even older record, or a bare test literal.
  const X = load();
  X.STORE.players.BARE = { name: 'Bare' };
  const p = X.getPlayer('BARE');
  t.ok('a missing texture object is created fresh', p.texture && typeof p.texture === 'object');
  t.ok('with array fields ready to use', Array.isArray(p.texture.bluffSizes));
}

process.exit(t.report());
