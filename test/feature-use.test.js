// Feature-use counters (v1.92.0): what gets counted, what doesn't, and that
// the answer survives the store's own round trips.
//
// Asked for as "which features are more commonly used". Nobody working on this
// can see the phone, so the counts are the only evidence there will ever be —
// a counter that silently counts the wrong thing (every re-render as an open,
// a player id per key) would answer the question wrongly with full confidence.

const { load, runner } = require('./harness');

const t = runner('feature-use');
const flush = (T) => { T.saveStore(); T._sandbox.runTimers(); };

// A stand-in element: just enough of closest()/className/dataset for the key.
function el(tag, className, dataset, parentTph = true, extra = {}) {
  const e = Object.assign({ tagName: tag.toUpperCase(), className, dataset: dataset || {}, textContent: '' }, extra);
  e.closest = (sel) => {
    if (sel === '[class*="tph-"]') return parentTph || /\btph-/.test(className) ? e : null;
    return e; // every stand-in IS the control
  };
  return e;
}

// --- tap keys --------------------------------------------------------------

{
  const T = load();
  t.eq('a button is named by its own class', T.usageTapKey(el('button', 'tph-exp-gist')), 'tap:exp-gist');
  t.eq('a tab carries which tab', T.usageTapKey(el('div', 'tph-tab active', { tab: 'history' })), 'tap:tab:history');
  t.eq('a chip drops its on/off modifier and keeps its key',
    T.usageTapKey(el('span', 'tph-hf tph-hf-on', { hf: 'notable' })), 'tap:hf:notable');
  t.eq('a radio carries its value', T.usageTapKey(el('input', 'tph-bm', {}, true, { type: 'radio', value: 'session' })), 'tap:bm:session');
  t.eq('a player row is counted WITHOUT the player id',
    T.usageTapKey(el('tr', 'tph-prow', { xid: '3722665' })), 'tap:prow');
  t.eq('a settings section header carries its name',
    T.usageTapKey(el('h4', 'tph-set-h', {}, true, { textContent: '  Coach  ' })), 'tap:set-h:Coach');
  t.eq('Torn\'s own controls are never counted', T.usageTapKey(el('button', 'btn___x1', {}, false)), null);
  t.eq('nothing to tap is nothing counted', T.usageTapKey(null), null);
}

// --- counting, and the cap -------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.noteUse('a'); T.noteUse('a'); T.noteUse('b');
  t.eq('counts accumulate', T.STORE.usage.n.a, 2);
  t.ok('and record when counting began', T.STORE.usage.since > 0);

  for (let i = 0; i < T.USAGE_KEYS_MAX + 20; i++) T.noteUse('k' + i);
  t.eq('distinct keys are capped', Object.keys(T.STORE.usage.n).length, T.USAGE_KEYS_MAX);
  T.noteUse('a');
  t.eq('a key already counted keeps counting at the cap', T.STORE.usage.n.a, 3);
}

// --- a panel open is counted once, not per render --------------------------

{
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  T.renderPanel({ marker: 'tph-players', open: true, html: 'l' });
  T.renderPanel({ marker: 'tph-players', open: true, html: 'l2' }); // a keystroke re-render
  T.renderPanel({ marker: 'tph-players', open: true, html: 'l3' });
  t.eq('re-renders are not opens', T.STORE.usage.n['open:players'], 1);
  T.renderPanel({ marker: 'tph-players', open: false, html: '' });
  T.renderPanel({ marker: 'tph-players', open: true, html: 'l' });
  t.eq('closing and reopening is a second open', T.STORE.usage.n['open:players'], 2);
  T.renderPanel({ marker: 'tph-player-panel', open: true, html: 'p' });
  t.eq('the player panel is open:player', T.STORE.usage.n['open:player'], 1);
}

// --- the report names what was NOT used ------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const controls = T.settingsControlKeys();
  t.ok('settings controls are read from the real markup', controls.indexOf('tap:targetbox-toggle') >= 0);
  t.ok('including buttons', controls.indexOf('tap:reset') >= 0);

  T.noteUse('tap:targetbox-toggle');
  T.noteUse('open:settings'); T.noteUse('open:settings');
  T.noteUse('tap:bm:session');
  const lines = T.usageReportLines();
  const unused = lines.find((l) => l.indexOf('never used') === 0);
  t.ok('a used control is not listed as unused', unused.indexOf('targetbox-toggle') < 0);
  t.ok('an untouched one is', unused.indexOf('tap:foldguard-toggle') >= 0);
  t.ok('a radio group counts as used from any of its values', !/tap:bm\b/.test(unused));
  t.ok('an untouched radio group is listed', /tap:vl\b/.test(unused));
  t.ok('an untouched panel is', unused.indexOf('open:players') >= 0);
  t.ok('counts print most-used first', lines[1].indexOf('open:settings') > 0 && /\b2\b/.test(lines[1]));
}

// --- settings that differ from default, secrets redacted --------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.coachHidden = true;
  T.STORE.settings.tornApiKey = 'SECRETKEY123';
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.settings.gearPos = { left: 3, top: 4 };
  const line = T.usageReportLines().find((l) => l.indexOf('settings changed') === 0);
  t.ok('a changed toggle is listed', line.indexOf('coachHidden=true') >= 0);
  t.ok('an API key is only "set"', line.indexOf('tornApiKey=set') >= 0 && line.indexOf('SECRETKEY123') < 0);
  t.ok('the username is not printed', line.indexOf('Wonkawee') < 0 && line.indexOf('heroName=set') >= 0);
  t.ok('positions are left out', line.indexOf('gearPos') < 0);
  t.ok('an unchanged default is left out', line.indexOf('showBadges') < 0);
}

// --- passive features: hands played with them showing ---------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'hero';
  T.STORE.settings.coachHidden = true;
  T.applyHandResults({
    gameId: null, street: 'preflop', pot: 0, contributions: {}, dealtInXids: new Set(['hero']),
    winners: [], actions: [{ x: 'hero', a: 'fold', amt: 0, s: 'preflop' }], shown: {},
  });
  t.eq('a hand hero played is counted', T.STORE.usage.n.hand, 1);
  t.eq('with the badges showing', T.STORE.usage.n['hand:badges-on'], 1);
  t.ok('and not as coach-open while the coach was hidden', !T.STORE.usage.n['hand:coach-open']);
}

// --- round trips -----------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.noteUse('open:settings');
  flush(T);
  t.eq('counters survive a reload', T.loadStore().usage.n['open:settings'], 1);

  const remote = T.emptyStore();
  remote.usage = { since: 1, n: { 'open:settings': 500, 'tap:other-device': 9 } };
  const merged = T.mergeStores(T.STORE, remote);
  t.eq('a gist merge keeps this device\'s counts', merged.usage.n['open:settings'], 1);
  t.ok('and takes nothing from the other device', !merged.usage.n['tap:other-device']);
}

process.exit(t.report());
