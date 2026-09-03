// Panel mounting and teardown. See renderPanel().
//
// The bug this locks down: renderPlayerPanel used to tear down `.tph-panel` —
// the class EVERY panel carries — instead of its own marker. Opening a player
// panel over Settings therefore deleted the settings panel from the DOM while
// `settingsOpen` stayed true, so the next gear tap flipped the flag back to
// false and appeared to do nothing. One dead tap, no error, easy to dismiss as
// a mis-tap on a phone.
//
// These run against the harness's minimal class-matching document, which is
// enough for mount/teardown and nothing else. Markup, styling and event
// delegation are out of scope here on purpose.

const { load, runner } = require('./harness');

const t = runner('panel');

const T = load({ dom: 'class' });
const body = T._sandbox.document.body;
const mountedWith = (marker) => body.children.filter((c) => c.classes().includes(marker));

// --- Mounting ---------------------------------------------------------------

const p = T.renderPanel({ marker: 'tph-alpha', open: true, html: '<h3>A</h3>' });
t.ok('open:true returns the panel', !!p);
t.eq('mounted on body', mountedWith('tph-alpha').length, 1);
t.ok('carries the shared base class', p.classes().includes('tph-panel'));
t.ok('carries its own marker', p.classes().includes('tph-alpha'));
t.eq('html is applied', p.innerHTML, '<h3>A</h3>');

// Re-rendering replaces rather than stacking — every caller re-renders on each
// state change, so a duplicate would pile up invisibly behind the first.
T.renderPanel({ marker: 'tph-alpha', open: true, html: '<h3>A2</h3>' });
t.eq('re-render replaces, does not stack', mountedWith('tph-alpha').length, 1);
t.eq('re-render applies new html', mountedWith('tph-alpha')[0].innerHTML, '<h3>A2</h3>');

// --- Teardown ---------------------------------------------------------------

t.eq('open:false returns null', T.renderPanel({ marker: 'tph-alpha', open: false, html: 'x' }), null);
t.eq('open:false unmounts', mountedWith('tph-alpha').length, 0);

// --- The regression: panels must not tear each other down -------------------

T.renderPanel({ marker: 'tph-settings', open: true, html: 's' });
T.renderPanel({ marker: 'tph-players', open: true, html: 'l' });
t.eq('settings mounted', mountedWith('tph-settings').length, 1);

// This is the exact sequence that used to break: open a player panel while
// Settings is up.
T.renderPanel({ marker: 'tph-player-panel', open: true, html: 'p' });

t.eq('player panel mounted', mountedWith('tph-player-panel').length, 1);
t.eq('settings panel survives a player panel opening', mountedWith('tph-settings').length, 1);
t.eq('players list survives a player panel opening', mountedWith('tph-players').length, 1);

// And closing the player panel leaves the others alone.
T.renderPanel({ marker: 'tph-player-panel', open: false, html: '' });
t.eq('closing the player panel unmounts only itself', mountedWith('tph-player-panel').length, 0);
t.eq('settings still mounted after player panel closes', mountedWith('tph-settings').length, 1);

// --- Every panel marker is distinct from the base class ---------------------

// A marker equal to the base class would silently restore the old bug, since
// removal would match every panel again.
['tph-player-panel', 'tph-players', 'tph-settings'].forEach((m) => {
  t.ok(`${m} is not the shared base class`, m !== 'tph-panel');
});

// --- Backdrop: tap outside a panel closes it the same way ✕ does -----------

{
  T.renderPanel({ marker: 'tph-alpha', open: true, html: 'x' });
  t.eq('backdrop is NOT created when onClose is omitted',
    mountedWith('tph-backdrop-tph-alpha').length, 0);
  T.renderPanel({ marker: 'tph-alpha', open: false, html: '' });
}

{
  let closed = false;
  T.renderPanel({ marker: 'tph-beta', open: true, html: 'x', onClose: () => { closed = true; } });
  const backdrops = mountedWith('tph-backdrop-tph-beta');
  t.eq('backdrop IS created when onClose is given', backdrops.length, 1);
  t.ok('backdrop carries the shared backdrop class', backdrops[0].classes().includes('tph-panel-backdrop'));
  t.ok('the panel itself is not swept up by the backdrop marker',
    !mountedWith('tph-beta').some((el) => el.classes().includes('tph-panel-backdrop')));

  // A REAL tap fires pointerdown then click. The backdrop arms on pointerdown
  // and only closes on a click that follows one, so both have to be fired here
  // — see the regression case below for why that matters.
  backdrops[0]._fire('pointerdown');
  backdrops[0]._fire('click');
  t.eq('tapping the backdrop fires onClose', closed, true);

  // Teardown is scoped to this backdrop's OWN marker, same invariant as the
  // panel itself — opening one panel's backdrop must not disturb another's.
  T.renderPanel({ marker: 'tph-gamma', open: true, html: 'y', onClose: () => {} });
  T.renderPanel({ marker: 'tph-beta', open: true, html: 'x2', onClose: () => {} });
  t.eq('a second panel\'s backdrop survives a third panel opening',
    mountedWith('tph-backdrop-tph-gamma').length, 1);

  T.renderPanel({ marker: 'tph-beta', open: false, html: '' });
  t.eq('closing a panel removes its own backdrop', mountedWith('tph-backdrop-tph-beta').length, 0);
  t.eq('and leaves an unrelated backdrop alone', mountedWith('tph-backdrop-tph-gamma').length, 1);
  T.renderPanel({ marker: 'tph-gamma', open: false, html: '' });
}

// --- Scroll position survives close/reopen and tab switches ----------------
//
// Reported as the actual friction of the close-to-act cycle: closing the
// panel to hit fold/call and reopening it a few seconds later dumped the
// user back at the top of whatever they were reading, so every interruption
// cost a re-scroll, not just a re-open.

{
  const p1 = T.renderPanel({ marker: 'tph-delta', open: true, html: 'x', scrollKey: 'tph-delta:1:stats' });
  p1.scrollTop = 42;

  // The close call itself doesn't need to know the scrollKey — capture reads
  // it off the outgoing element's own dataset, stamped when IT was created.
  T.renderPanel({ marker: 'tph-delta', open: false, html: '' });

  const p2 = T.renderPanel({ marker: 'tph-delta', open: true, html: 'x', scrollKey: 'tph-delta:1:stats' });
  t.eq('reopening the same scrollKey restores the scroll position', p2.scrollTop, 42);

  p2.scrollTop = 7;
  const p3 = T.renderPanel({ marker: 'tph-delta', open: true, html: 'x', scrollKey: 'tph-delta:1:trends' });
  t.eq('a different scrollKey (e.g. switching tabs) starts fresh, not inheriting another key\'s position', p3.scrollTop, 0);

  const p4 = T.renderPanel({ marker: 'tph-delta', open: true, html: 'x', scrollKey: 'tph-delta:1:stats' });
  t.eq('switching back to the earlier key restores its own remembered position', p4.scrollTop, 7);

  T.renderPanel({ marker: 'tph-delta', open: false, html: '' });
}

{
  // No scrollKey given falls back to the marker itself — the right default
  // for a panel that only ever shows one "document" (Settings, the players
  // list), where the marker alone already identifies what's on screen.
  const p1 = T.renderPanel({ marker: 'tph-epsilon', open: true, html: 'x' });
  p1.scrollTop = 15;
  T.renderPanel({ marker: 'tph-epsilon', open: false, html: '' });
  const p2 = T.renderPanel({ marker: 'tph-epsilon', open: true, html: 'x' });
  t.eq('default scrollKey (the marker) also survives close/reopen', p2.scrollTop, 15);
  T.renderPanel({ marker: 'tph-epsilon', open: false, html: '' });
}

// --- a click the backdrop did not START must not close the panel ----------
//
// v1.49.0 made the departure pill draggable, which moved its open from a
// `click` handler to makeDraggable's `pointerup`. The panel therefore mounted
// BEFORE the browser dispatched that tap's compatibility click — so the
// backdrop, freshly created under the finger, received the click and closed
// the panel instantly. Reported as "the pill can be moved around but can't
// open", and it looked like a broken pill rather than a panel that had opened
// and shut inside one frame.
//
// The old click-only pill never hit it: the backdrop did not exist when that
// event's propagation path was computed. So this is not a pill bug at all, and
// fixing it in the pill would leave the next pointer-driven control to
// rediscover it.

{
  let closed = false;
  T.renderPanel({ marker: 'tph-gamma', open: true, html: 'x', onClose: () => { closed = true; } });
  const backdrop = mountedWith('tph-backdrop-tph-gamma')[0];
  t.ok('the backdrop is there to be clicked', !!backdrop);

  // The stray click: no pointerdown on the backdrop, because the gesture
  // started on a pill that no longer exists.
  backdrop._fire('click');
  t.eq('a click with no pointerdown on the backdrop does NOT close', closed, false);

  // ...and a genuine outside tap still does, so the fix has not simply
  // disabled the backdrop.
  backdrop._fire('pointerdown');
  backdrop._fire('click');
  t.eq('a real tap on the backdrop still closes', closed, true);

  // Arming is consumed, not sticky: a second stray click after a real tap must
  // not close a panel the user has since reopened.
  closed = false;
  backdrop._fire('click');
  t.eq('the arming does not persist past the tap that used it', closed, false);

  T.renderPanel({ marker: 'tph-gamma', open: false, html: '' });
}

process.exit(t.report());
