// Keyboard shortcuts: F folds, C calls or checks (v1.108.0).
//
// The one place the HUD presses a game button, by the owner's decision. What
// must hold, each pinned here against the REAL handler and the REAL fold
// guard (a test of a copy cannot fail when the original is wrong):
//   - one keystroke, at most one press; auto-repeat presses nothing
//   - the fold guard applies: first F arms, second F folds
//   - your turn only: pre-action queue buttons are never pressed
//   - never while typing, never with a modifier, off by default

const { load, runner } = require('./harness');

const t = runner('key-shortcuts');

// A Torn-shaped button whose click goes through the document's capture
// listener — the fold guard — the way a real click event would. `presses`
// records clicks the guard let through to the game.
function table(labels) {
  const T = load();
  T.STORE = T.emptyStore();
  const presses = [];
  const btns = labels.map((text) => {
    const el = {
      tagName: 'BUTTON', textContent: text, className: '',
      closest(sel) { return /tph-/.test(sel) ? null : (/button/.test(sel) ? el : null); },
      getAttribute() { return null; },
      click() {
        const e = { target: el, defaultPrevented: false };
        e.preventDefault = () => { e.defaultPrevented = true; };
        e.stopPropagation = () => {};
        T.foldGuardHandler(e);
        if (!e.defaultPrevented) presses.push(text);
      },
    };
    return el;
  });
  const doc = T._sandbox.document;
  doc.querySelectorAll = (sel) => (/button/.test(sel) ? btns : []);
  return { T, presses };
}

function key(k, extra) {
  const e = Object.assign({ key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false,
    defaultPrevented: false, target: { tagName: 'BODY' } }, extra || {});
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
}

// --- Off by default -----------------------------------------------------------
{
  const { T, presses } = table(['Fold', 'Call $1.5M', 'Raise to $3.5M']);
  t.eq('the setting defaults off', !!T.STORE.settings.keyShortcuts, false);
  T.shortcutKeyHandler(key('c'));
  t.eq('so C does nothing', presses.length, 0);
}

// --- C calls, or checks --------------------------------------------------------
{
  const { T, presses } = table(['Fold', 'Call $1.5M', 'Raise to $3.5M']);
  T.STORE.settings.keyShortcuts = true;
  const e = key('c');
  T.shortcutKeyHandler(e);
  t.eq('C presses Call', presses.join(), 'Call $1.5M');
  t.ok('and claims the key', e.defaultPrevented);
  T.shortcutKeyHandler(key('C'));
  t.eq('upper case works too', presses.length, 2);
}
{
  const { T, presses } = table(['Fold', 'Check', 'Bet']);
  T.STORE.settings.keyShortcuts = true;
  T.shortcutKeyHandler(key('c'));
  t.eq('with no bet to call, C checks', presses.join(), 'Check');
}

// --- F goes through the fold guard ---------------------------------------------
{
  const { T, presses } = table(['Fold', 'Call $1.5M']);
  T.STORE.settings.keyShortcuts = true;
  T.STORE.settings.foldGuard = true;
  T.shortcutKeyHandler(key('f'));
  t.eq('the first F only arms the guard', presses.length, 0);
  // Past the double-fire gap, inside the confirm window.
  // The script's Date is the vm context's own intrinsic.
  const D = require('vm').runInContext('Date', T._sandbox);
  const realNow = D.now;
  D.now = () => realNow() + 1000;
  T.shortcutKeyHandler(key('f'));
  D.now = realNow;
  t.eq('the second F folds', presses.join(), 'Fold');
}
{
  const { T, presses } = table(['Fold', 'Call $1.5M']);
  T.STORE.settings.keyShortcuts = true;
  T.STORE.settings.foldGuard = true;
  T.shortcutKeyHandler(key('f'));
  // Auto-repeat keeps firing for as long as the key is held — well past the
  // guard's 250ms double-fire gap — so the repeat flag is the only thing
  // standing between a held F and a confirmed fold.
  const D = require('vm').runInContext('Date', T._sandbox);
  const realNow = D.now;
  D.now = () => realNow() + 1000;
  T.shortcutKeyHandler(key('f', { repeat: true }));
  D.now = realNow;
  t.eq('a held F (auto-repeat) cannot confirm its own fold', presses.length, 0);
}
{
  const { T, presses } = table(['Fold', 'Call $1.5M']);
  T.STORE.settings.keyShortcuts = true;
  T.STORE.settings.foldGuard = false;
  T.shortcutKeyHandler(key('f'));
  t.eq('with the guard off, one F folds', presses.join(), 'Fold');
}

// --- Your turn only ------------------------------------------------------------
{
  const { T, presses } = table(['Check / Fold', 'Call Any / Check']);
  T.STORE.settings.keyShortcuts = true;
  T.STORE.settings.foldGuard = false;
  T.shortcutKeyHandler(key('f'));
  T.shortcutKeyHandler(key('c'));
  t.eq('pre-action queue buttons are never pressed', presses.length, 0);
}

// --- Never while typing, never with a modifier, nothing for other keys ----------
{
  const { T, presses } = table(['Fold', 'Call $1.5M']);
  T.STORE.settings.keyShortcuts = true;
  T.STORE.settings.foldGuard = false;
  T.shortcutKeyHandler(key('c', { target: { tagName: 'INPUT' } }));
  T.shortcutKeyHandler(key('c', { target: { tagName: 'TEXTAREA' } }));
  T.shortcutKeyHandler(key('c', { target: { tagName: 'DIV', isContentEditable: true } }));
  t.eq('typing in a box presses nothing', presses.length, 0);
  T.shortcutKeyHandler(key('c', { ctrlKey: true }));
  T.shortcutKeyHandler(key('c', { metaKey: true }));
  T.shortcutKeyHandler(key('f', { altKey: true }));
  t.eq('Ctrl/Cmd/Alt combinations press nothing', presses.length, 0);
  const other = key('r');
  T.shortcutKeyHandler(other);
  t.ok('other keys are left alone', presses.length === 0 && !other.defaultPrevented);
}

// --- One keystroke, at most one press --------------------------------------------
{
  const { T, presses } = table(['Fold', 'Call $1.5M', 'Check']);
  T.STORE.settings.keyShortcuts = true;
  T.shortcutKeyHandler(key('c'));
  t.eq('C presses exactly one button even with Call and Check both showing', presses.length, 1);
}

// --- No button, no action, no error ------------------------------------------------
{
  const { T, presses } = table([]);
  T.STORE.settings.keyShortcuts = true;
  const e = key('c');
  T.shortcutKeyHandler(e);
  t.ok('not your turn: nothing pressed, key not claimed', presses.length === 0 && !e.defaultPrevented);
}

// --- The Settings switch is rendered --------------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  t.ok('Settings carries the switch', /tph-keys-toggle/.test(T.settingsPanelHtml()));
}

process.exit(t.report());
