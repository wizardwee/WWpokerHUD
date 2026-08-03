// The fold misclick guard.
//
// This is the ONLY code in the HUD that touches the game's own controls, so the
// bar is higher than elsewhere. Three properties matter more than the feature:
//
//   1. It never folds for you. There is no synthetic click anywhere in it; the
//      second tap is the user's real tap, passed through untouched.
//   2. It fails OPEN. Anything unexpected and the click goes through. A guard
//      that swallowed a genuine fold would be worse than no guard.
//   3. It only ever intercepts FOLD. Call, Raise and Check must never be
//      delayed by a single millisecond.

const { load, runner } = require('./harness');

const t = runner('fold-guard');
const T = load();
T.STORE = T.emptyStore();

// A button element, plus the click event that would target it.
function button(text, opts = {}) {
  const el = {
    tagName: 'BUTTON',
    className: opts.className || '',
    textContent: text,
    closest(sel) {
      if (sel.includes('tph-')) return opts.isOurs ? el : null;
      if (sel.includes('button')) return el;
      return null;
    },
  };
  return el;
}

function clickEvent(target) {
  const e = { target, defaultPrevented: false, propagationStopped: false };
  e.preventDefault = () => { e.defaultPrevented = true; };
  e.stopPropagation = () => { e.propagationStopped = true; };
  return e;
}

const blocked = (e) => e.defaultPrevented && e.propagationStopped;

// --- What counts as a fold control -----------------------------------------

t.ok('a plain Fold button', !!T.isFoldControl(button('Fold')));
t.ok('lowercase', !!T.isFoldControl(button('fold')));
// A misclicked pre-action fold still folds the hand, just later.
t.ok('a Check / Fold pre-action', !!T.isFoldControl(button('Check / Fold')));

// These must never be intercepted.
['Call $2,500,000', 'Raise', 'Check', 'Bet', 'All in', 'Call Any / Check']
  .forEach((label) => {
    t.eq(`"${label}" is not a fold control`, T.isFoldControl(button(label)), false);
  });

// Our own UI must be invisible to the guard, or the settings toggle that turns
// it off would itself be guarded.
t.eq('our own buttons are ignored', T.isFoldControl(button('Fold', { isOurs: true })), false);

// A sentence containing the word is not a button label.
t.eq('a long string is not a control',
  T.isFoldControl(button('You folded on the river last hand')), false);

// --- Non-fold clicks pass through untouched --------------------------------

{
  T.STORE.settings.foldGuard = true;
  T.foldArmedAt = 0;
  ['Call $2,500,000', 'Raise', 'Check'].forEach((label) => {
    const e = clickEvent(button(label));
    T.foldGuardHandler(e);
    t.ok(`"${label}" is never delayed`, !e.defaultPrevented && !e.propagationStopped);
  });
  t.eq('and nothing gets armed by them', T.foldArmedAt, 0);
}

// --- Arm, then confirm ------------------------------------------------------

{
  T.STORE.settings.foldGuard = true;
  T.foldArmedAt = 0;

  const first = clickEvent(button('Fold'));
  T.foldGuardHandler(first);
  t.ok('the first tap is blocked', blocked(first));
  t.ok('and arms the guard', T.foldArmedAt > 0);

  // Backdate the arm so the second tap reads as deliberate rather than a
  // double-fire, without waiting in real time.
  T.foldArmedAt = Date.now() - (T.FOLD_MIN_GAP_MS + 50);

  const second = clickEvent(button('Fold'));
  T.foldGuardHandler(second);
  t.ok('the second tap passes through', !second.defaultPrevented && !second.propagationStopped);
  t.eq('and disarms', T.foldArmedAt, 0);
}

// A fat-finger double-fire is not a confirmation.
{
  T.foldArmedAt = 0;
  const first = clickEvent(button('Fold'));
  T.foldGuardHandler(first);
  const armedAt = T.foldArmedAt;

  const bounce = clickEvent(button('Fold')); // immediately, same gesture
  T.foldGuardHandler(bounce);
  t.ok('an instant second tap is swallowed', blocked(bounce));
  t.eq('and the window stays open', T.foldArmedAt, armedAt);
}

// An expired window re-arms rather than folding.
{
  T.foldArmedAt = Date.now() - (T.FOLD_ARM_MS + 1000);
  const late = clickEvent(button('Fold'));
  T.foldGuardHandler(late);
  t.ok('a tap after the window expires is blocked, not passed', blocked(late));
  t.ok('and re-arms', T.foldArmedAt > Date.now() - 1000);
}

// --- Turned off means completely absent ------------------------------------

{
  T.STORE.settings.foldGuard = false;
  T.foldArmedAt = 0;
  const e = clickEvent(button('Fold'));
  T.foldGuardHandler(e);
  t.ok('disabled: the fold goes straight through', !e.defaultPrevented && !e.propagationStopped);
  t.eq('disabled: nothing is armed', T.foldArmedAt, 0);
}

// --- Fails open -------------------------------------------------------------

// A target that throws on inspection must not block the click. The guard
// swallowing a genuine fold is the worst outcome available to it.
{
  T.STORE.settings.foldGuard = true;
  T.foldArmedAt = 0;
  const hostile = {
    tagName: 'BUTTON',
    get textContent() { throw new Error('boom'); },
    closest() { throw new Error('boom'); },
  };
  const e = clickEvent(hostile);
  let threw = false;
  try { T.foldGuardHandler(e); } catch (err) { threw = true; }
  t.ok('a throwing target does not propagate an exception', !threw);
  t.ok('and the click is not blocked', !e.defaultPrevented && !e.propagationStopped);
  t.eq('and the guard is left disarmed', T.foldArmedAt, 0);
}

// A null target is simply not a control.
{
  const e = clickEvent(null);
  T.foldGuardHandler(e);
  t.ok('a null target passes through', !e.defaultPrevented);
}

// --- The window is long enough to be usable, short enough to be safe -------

t.ok('the confirm window is at least 2s', T.FOLD_ARM_MS >= 2000);
t.ok('but well under a typical decision clock', T.FOLD_ARM_MS <= 10000);
t.ok('the double-fire guard is short enough not to feel laggy', T.FOLD_MIN_GAP_MS <= 400);

process.exit(t.report());
