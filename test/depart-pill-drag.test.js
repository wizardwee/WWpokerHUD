// The departure pill has to be movable — see renderDepartedPill.
//
// Asked for directly: the pill floats over the felt at a fixed anchor, so
// whatever it lands on is whatever it covers, permanently. The coach pill hit
// exactly this and was made draggable in v1.42.0; this one still had a bare
// click handler and no way off.
//
// WHAT THIS FILE IS REALLY FOR: "draggable" is not one property, it is four
// things that all have to be true at once — the pointer handlers exist, a tap
// still opens the panel instead of being eaten as a drag, a real drag persists
// somewhere it can be restored from, and the stored position is honoured on
// the next mount. Asserting only the first is how you ship a pill that moves
// and then jumps back the moment the watch window empties and refills.

const { load, runner } = require('./harness');

const t = runner('depart-pill-drag');

function setup() {
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  T.heroXid = 'HERO';
  T.STORE.players.HERO = T.emptyPlayer('HERO', 'Hero');
  T.STORE.players.A = T.emptyPlayer('A', 'Villain');
  T.targetCache.set('A', { state: 'Okay', until: 0, level: 50, fetchedAt: Date.now() });
  // Two sweeps, because Guard 2 needs two consecutive misses before a
  // departure counts. Driving the real path rather than poking departedWatch
  // keeps this honest about what actually puts a pill on screen.
  T.lastSeatedSnapshot = ['A', 'HERO'];
  T.noteSeatDepartures(['HERO']);
  T.noteSeatDepartures(['HERO']);
  return T;
}

// A pointer event with everything makeDraggable actually touches. _fire passes
// only { target }, which has no preventDefault — calling it would throw here
// and the failure would look like a bug in the drag code rather than in the
// stub, so these are built explicitly.
const evt = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, preventDefault() {} });
const fire = (el, name, e) => (el.listeners[name] || []).forEach((fn) => fn(e));

// --- the handlers are the drag ones, not a bare click ---------------------

{
  const T = setup();
  T.renderDepartedPill();
  const pill = T._sandbox.document.querySelector('.tph-depart-pill');
  t.ok('the pill mounts once there is something to report', !!pill);
  t.ok('it carries the drag handlers', !!(pill.listeners.pointerdown && pill.listeners.pointerup));
  // The click handler is what it REPLACED. Leaving both wired would fire the
  // panel open at the end of every drag, which is the exact behaviour that
  // makes a draggable element feel broken.
  t.ok('and no leftover click handler to double-fire', !pill.listeners.click);
}

// --- a tap still opens the panel ------------------------------------------

{
  const T = setup();
  T.renderDepartedPill();
  const pill = T._sandbox.document.querySelector('.tph-depart-pill');
  fire(pill, 'pointerdown', evt(1, 100, 100));
  fire(pill, 'pointerup', evt(1, 100, 100));
  t.ok('a tap with no movement opens the panel', T.departedPanelOpen === true);
  t.eq('and nothing was persisted for a tap', T.STORE.settings.departPillPos, null);
}

// --- a drag moves it, persists, and does NOT open the panel ----------------

{
  const T = setup();
  T.renderDepartedPill();
  const pill = T._sandbox.document.querySelector('.tph-depart-pill');
  fire(pill, 'pointerdown', evt(1, 200, 400));
  // Past DRAG_THRESHOLD_PX (6). Under it and this would read as a tap.
  fire(pill, 'pointermove', evt(1, 240, 300));
  fire(pill, 'pointerup', evt(1, 240, 300));
  t.ok('a drag does not open the panel', T.departedPanelOpen === false);
  t.ok('the position is persisted', !!T.STORE.settings.departPillPos);
  t.ok('and it is a {left, top} pair',
    typeof T.STORE.settings.departPillPos.left === 'number'
    && typeof T.STORE.settings.departPillPos.top === 'number');
  t.ok('the dragging class is cleared when the finger lifts',
    !pill.classes().includes('tph-dragging'));
}

// --- the stored position survives the pill being torn down and rebuilt -----
//
// This is the one that matters in use. The pill is removed the moment the
// alertable list empties and rebuilt when someone else leaves, which happens
// several times a session — a position that lives only on the element is a
// position you lose within minutes of setting it.

{
  const T = setup();
  T.STORE.settings.departPillPos = { left: 40, top: 120 };
  T.renderDepartedPill();
  const pill = T._sandbox.document.querySelector('.tph-depart-pill');
  t.eq('a stored left is applied on mount', pill.style.left, '40px');
  t.eq('a stored top is applied on mount', pill.style.top, '120px');
  // Anchored by left/top means the CSS bottom/right anchor has to be released,
  // or the element is pinned by both edges and the drag appears to stretch it.
  t.eq('and the CSS right anchor is released', pill.style.right, 'auto');
  t.eq('and the CSS bottom anchor is released', pill.style.bottom, 'auto');
}

// --- it does not share the coach pill's key --------------------------------
//
// Both pills can be on screen at the same time. One shared position key would
// stack them on top of each other, which is worse than the fixed anchor this
// replaced.

{
  const T = setup();
  T.STORE.settings.coachPillPos = { left: 10, top: 10 };
  T.renderDepartedPill();
  const pill = T._sandbox.document.querySelector('.tph-depart-pill');
  t.ok("the coach pill's stored position is not applied to this one",
    pill.style.left !== '10px');
}

process.exit(t.report());
