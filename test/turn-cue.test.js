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

process.exit(t.report());
