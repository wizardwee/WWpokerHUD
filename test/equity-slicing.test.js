// Frame-sliced equity — see equityJobInit / equityJobStep / equityJobValue and
// estimateEquitySliced in the userscript.
//
// WHY this exists: the Monte Carlo is by a wide margin the most expensive
// thing the script does (~45-50ms at five opponents, ~150ms at eight against a
// narrow range, measured on a desktop-class CPU; a phone is several times
// slower again). Run straight through on the main thread it froze the whole
// table on every fold, street and raise. Slicing it across animation frames
// fixes that WITHOUT changing the arithmetic — and this file's job is to hold
// that "without" to account.
//
// The load-bearing property is that `st.i` is the single progress marker, both
// read and advanced by the loop. An off-by-one there would change the sample
// count the result is divided by, which surfaces as a slightly wrong equity
// percentage rather than as an error — invisible without a test like this one.

const { load, runner } = require('./harness');

const t = runner('equity-slicing');
const card = (rank, suit) => ({ rank, suit });

// --- equityJobStep: every iteration runs exactly once ---------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.equityIters = 200;

  const st = T.equityJobInit([card('A', 's'), card('K', 'd')], [], 3, 0);
  t.ok('equityJobInit returns a job state for a simulatable spot', !!st);
  t.eq('the job starts at iteration zero', st.i, 0);
  t.eq('the job carries the configured iteration count', st.iters, 200);

  // Drive it in deliberately awkward slices — a budget that does not divide
  // the total evenly is exactly where an off-by-one would show up.
  let slices = 0;
  let done = false;
  while (!done && slices < 1000) { done = T.equityJobStep(st, 7); slices++; }

  t.eq('the job reports done', done, true);
  t.eq('exactly iters iterations ran — no double-counting, none dropped', st.i, 200);
  t.eq('a 200-iteration job at budget 7 takes ceil(200/7) slices', slices, Math.ceil(200 / 7));
  t.ok('wins and ties never exceed the iterations actually run', st.win + st.tie <= st.i);
}

// --- a budget larger than the job, and stepping past the end --------------

{
  const T = load();
  T.STORE = T.emptyStore();
  // EQUITY_ITERS_MIN, not an arbitrary small number: equityJobInit routes the
  // stored setting through clampEquityIters, so anything under the floor comes
  // back as the floor. (This assertion was originally written with 50 and
  // failed for exactly that reason — the clamp working, not a slicing bug.)
  const ITERS = T.EQUITY_ITERS_MIN;
  T.STORE.settings.equityIters = ITERS;

  const st = T.equityJobInit([card('A', 's'), card('A', 'h')], [], 1, 0);
  t.eq('one slice with an oversized budget finishes the whole job', T.equityJobStep(st, 999), true);
  t.eq('and stops exactly at iters, not at the budget', st.i, ITERS);

  // The pump calls step() in a loop and only stops on `true`; stepping an
  // already-finished job must be a no-op rather than running more iterations.
  const winBefore = st.win;
  const tieBefore = st.tie;
  t.eq('stepping a finished job still reports done', T.equityJobStep(st, 10), true);
  t.eq('and runs nothing further', st.i, ITERS);
  t.eq('leaving the win tally untouched', st.win, winBefore);
  t.eq('leaving the tie tally untouched', st.tie, tieBefore);

  // A zero/negative budget is floored to 1 rather than looping forever: the
  // pump's `while (!done && withinBudget)` would spin at zero progress.
  const st2 = T.equityJobInit([card('A', 's'), card('A', 'h')], [], 1, 0);
  T.equityJobStep(st2, 0);
  t.ok('a zero budget still advances (never a zero-progress spin)', st2.i >= 1);
}

// --- sliced and unsliced agree ---------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  // AA against one opponent is ~85% and tightly concentrated, so a modest
  // sample is enough for the two paths to land close together. This is a
  // statistical agreement, not bit-equality: both paths draw from Math.random,
  // so identical answers were never on offer — what matters is that slicing
  // doesn't bias or truncate the sample.
  T.STORE.settings.equityIters = 4000;
  const hand = [card('A', 's'), card('A', 'h')];

  const blocking = T.estimateEquity(hand, [], 1, 0);

  const st = T.equityJobInit(hand, [], 1, 0);
  let done = false;
  while (!done) done = T.equityJobStep(st, 13);
  const sliced = T.equityJobValue(st);

  t.ok(`blocking AA vs 1 is in the right region (${blocking.toFixed(1)}%)`,
    blocking > 80 && blocking < 90);
  t.ok(`sliced AA vs 1 lands in the same region (${sliced.toFixed(1)}%)`,
    sliced > 80 && sliced < 90);
  t.ok(`the two agree within 3 points (${Math.abs(blocking - sliced).toFixed(1)})`,
    Math.abs(blocking - sliced) < 3);
}

// --- equityJobInit refuses what it cannot simulate --------------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  t.eq('no hero cards -> null', T.equityJobInit(null, [], 2, 0), null);
  t.eq('one hero card -> null', T.equityJobInit([card('A', 's')], [], 2, 0), null);
  t.eq('a six-card board -> null',
    T.equityJobInit([card('A', 's'), card('K', 'd')],
      [card('2', 'c'), card('3', 'c'), card('4', 'c'), card('5', 'c'), card('6', 'c'), card('7', 'c')], 2, 0),
    null);
  // 2 hero + 5 board + 2*23 opponents cannot come out of 52 cards.
  t.eq('more opponents than the deck can deal -> null',
    T.equityJobInit([card('A', 's'), card('K', 'd')], [], 23, 0), null);
}

// --- estimateEquitySliced: cache, pending, and the starvation guard --------
//
// The harness runs requestAnimationFrame callbacks SYNCHRONOUSLY, so a job
// started here finishes before the call returns. That makes the scheduler's
// bookkeeping testable (queue handling, cache population, the null path) but
// not its frame-by-frame pacing — the slicing itself is covered above, by
// driving equityJobStep directly.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.equityIters = 100;
  const hand = [card('A', 's'), card('K', 'd')];

  const first = T.estimateEquitySliced(hand, [], 2, 0);
  t.ok(`a completed job returns a percentage (${first})`,
    typeof first === 'number' && first >= 0 && first <= 100);

  const key = T.equityCacheKey(hand, [], 2, 0);
  t.ok('the result is in the shared cache', T.equityCache.has(key));
  t.eq('a second ask is served from cache, identical', T.estimateEquitySliced(hand, [], 2, 0), first);

  // The blocking path shares the same cache, so the replayer and the coach
  // can never disagree about the same spot.
  t.eq('estimateEquityCached hits the same entry', T.estimateEquityCached(hand, [], 2, 0), first);

  // An unsimulatable spot is cached as null so it isn't retried every render.
  const bad = T.estimateEquitySliced(hand, [], 23, 0);
  t.eq('an unsimulatable spot returns null', bad, null);
  t.ok('and is cached, so it is not retried forever',
    T.equityCache.has(T.equityCacheKey(hand, [], 23, 0)));
}

// --- two different quotes both complete (the starvation regression) --------
//
// The first version of the scheduler had ONE job slot and cancelled it on any
// key mismatch. The coach asks for two quotes per render, so quote A started,
// quote B cancelled it, the next render restarted A, B cancelled it again —
// and NEITHER ever finished. The queue is what fixes that; this pins it.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.equityIters = 100;
  const hand = [card('Q', 's'), card('J', 's')];

  const live = T.estimateEquitySliced(hand, [], 2, 0);
  const ring = T.estimateEquitySliced(hand, [], 8, 0);

  t.ok('the live-count quote resolves', typeof live === 'number');
  t.ok('the full-ring quote also resolves — neither starves the other', typeof ring === 'number');
  t.ok('both are cached',
    T.equityCache.has(T.equityCacheKey(hand, [], 2, 0))
    && T.equityCache.has(T.equityCacheKey(hand, [], 8, 0)));
  t.ok('more opponents is worse for a drawing hand', ring < live);
}

// --- the completion hook ---------------------------------------------------
//
// The pump notifies through `onEquityReady` rather than calling
// renderCoachPanel directly. That keeps the dependency one-way — the equity
// engine never reaches up into the UI — and it is why this whole scheduler is
// drivable without a DOM at all. init() is what binds the hook to the panel;
// init() never runs under the harness, so it stays null here unless a test
// sets it.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.equityIters = 100;

  t.eq('the hook is unbound until init() wires it', T.onEquityReady, null);

  let fired = 0;
  T.onEquityReady = () => { fired++; };
  const v = T.estimateEquitySliced([card('7', 'h'), card('2', 'c')], [], 2, 0);
  t.ok('the job still completes with a hook attached', typeof v === 'number');
  t.ok(`the hook fired when the figure landed (${fired}x)`, fired >= 1);

  // A cache hit must NOT re-notify: the panel already has the number, and a
  // notify per render would put the coach in a render loop.
  const before = fired;
  T.estimateEquitySliced([card('7', 'h'), card('2', 'c')], [], 2, 0);
  t.eq('a cache hit does not re-notify', fired, before);
}

// --- clampEquityIters: the Settings escape hatch ---------------------------

{
  const T = load();
  t.eq('a sane value passes through', T.clampEquityIters(600), 600);
  t.eq('below the floor clamps up', T.clampEquityIters(1), T.EQUITY_ITERS_MIN);
  t.eq('above the ceiling clamps down', T.clampEquityIters(999999), T.EQUITY_ITERS_MAX);
  t.eq('a non-number falls back to the default', T.clampEquityIters('abc'), 1200);
  t.eq('an empty string falls back to the default', T.clampEquityIters(''), 1200);
  // The input is a text field in a webview; a string of digits is what a
  // change event actually hands over, not a number.
  t.eq('a numeric string is accepted', T.clampEquityIters('800'), 800);

  // equityJobInit must route through the clamp too — a store hand-edited (or
  // imported) with a wild value would otherwise hang the coach, and settings
  // arrive from importJson as well as from the panel.
  T.STORE = T.emptyStore();
  T.STORE.settings.equityIters = 999999;
  const st = T.equityJobInit([card('A', 's'), card('K', 'd')], [], 2, 0);
  t.eq('equityJobInit clamps a wild stored value', st.iters, T.EQUITY_ITERS_MAX);
}

process.exit(t.report());
