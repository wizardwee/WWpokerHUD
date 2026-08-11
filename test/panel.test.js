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

process.exit(t.report());
