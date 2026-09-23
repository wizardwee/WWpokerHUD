// The turn-cue escalation added in this version: a second, stronger signal
// TURN_ESCALATE_MS after the first one, if it's still your turn.
//
// renderTurnCue() itself isn't driven here — it reads document.querySelector
// for the gear/coach-head/glow elements and isHeroTurn()/isHeroNextToAct(),
// none of which this harness can fake reliably (see name-boundary.test.js's
// header for the same boundary). What's testable, and what actually matters
// most here, is shouldEscalateTurnCue: the pure timing decision pulled out of
// renderTurnCue for exactly this reason.

const { load, runner } = require('./harness');

const t = runner('turn-cue');
const T = load();

// --- shouldEscalateTurnCue: pure timing decision ----------------------------

const MS = T.TURN_ESCALATE_MS;

t.eq('does not escalate before the threshold', T.shouldEscalateTurnCue(true, true, false, 0, MS - 1), false);
t.eq('escalates exactly AT the threshold', T.shouldEscalateTurnCue(true, true, false, 0, MS), true);
t.eq('escalates well past the threshold', T.shouldEscalateTurnCue(true, true, false, 0, MS * 3), true);

t.eq('never escalates if the cue is currently off', T.shouldEscalateTurnCue(false, true, false, 0, MS * 3), false);

// This is the rising-edge case: the cue just turned on THIS tick, so
// wasActive (the OLD turnCueActive) is false. That path resets the timer in
// renderTurnCue instead of escalating — escalation is only for a cue that
// was ALREADY running.
t.eq('does not escalate on the rising edge, even past the threshold',
  T.shouldEscalateTurnCue(true, false, false, 0, MS * 3), false);

t.eq('does not escalate twice for the same turn', T.shouldEscalateTurnCue(true, true, true, 0, MS * 5), false);

t.eq('boundary: one millisecond short of the threshold is still false',
  T.shouldEscalateTurnCue(true, true, false, 1000, 1000 + MS - 1), false);

// --- The chimes fail safely with no AudioContext (this harness has none) ---

t.eq('playTurnChime returns false rather than throwing with no AudioContext',
  T.playTurnChime(), false);
t.eq('playTurnEscalationChime returns false rather than throwing with no AudioContext',
  T.playTurnEscalationChime(), false);

// --- The constant itself is what was actually asked for --------------------

t.eq('escalation fires at 10 seconds', T.TURN_ESCALATE_MS, 10000);

// --- The ring isHeroNextToAct walks must be able to CONTAIN hero ------------
//
// A live scan showed 8 `playerPositioner` elements against 9 seated players,
// and the ring listed the 8 opponents with hero absent — Torn lays your own
// seat out separately, below the felt beside your cards.
//
// isHeroNextToAct walks that ring looking for hero. With hero structurally
// absent the loop completes, finds nothing, and returns a confident `false`,
// so "you are next to act" could NEVER be true. Silent, because `false` is
// also the correct answer almost all of the time.
//
// Driving this through the DOM is not possible here: SELECTORS.seatPositioner
// is an attribute selector and the harness's class-matching document refuses
// anything it cannot match exactly, deliberately — a stub that matches the
// wrong element is how earlier harnesses in this repo produced false passes.
// So this is a source scan for the guard, and the LIVE verification is the
// deep scan, which now prints whether hero is in the ring rather than leaving
// it to be inferred from counting XIDs.

{
  const fs = require('fs');
  const { SCRIPT_PATH } = require('./harness');
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

  const fn = src.slice(src.indexOf('function seatRingXids()'));
  const body = fn.slice(0, fn.indexOf('\n  }') + 4);

  t.ok('seatRingXids returns the indexed ring only when it can contain hero',
    /heroUnresolved\(\)\s*\|\|\s*ring\.indexOf\(heroXid\)\s*!==\s*-1/.test(body));
  t.ok('and falls through to the geometric ring otherwise',
    /seatRotationFromDom/.test(body));
  t.ok('the guard sits on the early return, not after it',
    body.indexOf('ring.indexOf(heroXid)') < body.indexOf('seatRotationFromDom'));

  // Guard against the scan matching nothing — the failure mode a literal
  // source test is most prone to.
  t.ok('the scan actually found the function', body.indexOf('playerPositioner') !== -1);
  t.ok('and isHeroNextToAct is still the consumer',
    /function isHeroNextToAct\(\)[\s\S]{0,600}seatRingXids\(\)/.test(src));

  // The deep scan must say whether hero is in the ring, since that is the only
  // way this gets confirmed on a device nobody here can see.
  t.ok('the deep scan reports hero ring membership',
    /hero\s*\n?\s*\+\s*\(heroUnresolved|ABSENT — isHeroNextToAct cannot fire/.test(src));
}

// --- Vibration strength and repeat (v1.80.0) --------------------------------
//
// Reported: the buzz was sometimes missed. Light must keep the original
// numbers EXACTLY (it is the escape hatch back to the old behaviour); strong
// must actually be stronger, measured as total vibrating time, not just a
// different array.

{
  const sum = (p) => p.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  t.eq('light first cue is the original single 120ms pulse',
    JSON.stringify(T.turnVibratePattern('light', 'first')), '[120]');
  t.eq('light escalation is the original double pulse',
    JSON.stringify(T.turnVibratePattern('light', 'again')), '[120,80,120]');
  t.ok('strong first cue vibrates for longer than light',
    sum(T.turnVibratePattern('strong', 'first')) > sum(T.turnVibratePattern('light', 'first')));
  t.ok('strong escalation vibrates for longer than light',
    sum(T.turnVibratePattern('strong', 'again')) > sum(T.turnVibratePattern('light', 'again')));
  t.ok('escalation is stronger than the first cue, at each level',
    sum(T.turnVibratePattern('strong', 'again')) > sum(T.turnVibratePattern('strong', 'first')));
  t.eq('an unknown level falls back to STRONG, never the weaker one',
    JSON.stringify(T.turnVibratePattern('bogus', 'first')), JSON.stringify(T.turnVibratePattern('strong', 'first')));
  t.eq('the default setting is strong', T.DEFAULT_SETTINGS.turnVibrateLevel, 'strong');
  t.eq('repeat is opt-in', T.DEFAULT_SETTINGS.turnVibrateRepeat, false);
}

{
  const R = T.TURN_REBUZZ_MS;
  t.eq('repeats once the escalation has fired and the interval has passed',
    T.shouldRebuzzTurn(true, true, true, 0, 0, R), true);
  t.eq('not before the interval', T.shouldRebuzzTurn(true, true, true, 0, 0, R - 1), false);
  t.eq('not before the escalation has fired', T.shouldRebuzzTurn(true, true, false, 0, 0, R * 5), false);
  t.eq('not with the setting off', T.shouldRebuzzTurn(true, false, true, 0, 0, R * 5), false);
  t.eq('not once the turn is over', T.shouldRebuzzTurn(false, true, true, 0, 0, R * 5), false);
  t.eq('stops at the cap', T.shouldRebuzzTurn(true, true, true, 0, T.TURN_REBUZZ_MAX, R * 50), false);
  t.ok('one below the cap still repeats', T.shouldRebuzzTurn(true, true, true, 0, T.TURN_REBUZZ_MAX - 1, R));
  // Pinned against LITERALS, not the constants themselves — a bound checked
  // against its own constant passes with the constant set to anything.
  t.ok('the repeat is bounded to a sane total (<= 60s of repeats)', T.TURN_REBUZZ_MAX * T.TURN_REBUZZ_MS <= 60000);
  t.ok('and never faster than every 3s', T.TURN_REBUZZ_MS >= 3000);
}

process.exit(t.report());
