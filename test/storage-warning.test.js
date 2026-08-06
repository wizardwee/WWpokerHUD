// Surfacing a full localStorage.
//
// The failure this covers is the nastiest one in the file, because it has no
// symptom. When localStorage refuses a write the HUD carries on working — every
// badge, stat and coach line reads the in-memory STORE — and then everything
// recorded since the first refusal is gone on the next reload. It used to be a
// console.warn, which on a phone is no warning at all.

const { load, runner } = require('./harness');

const t = runner('storage-warning');

// --- The meter ---------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  const stored = (s) => { T._sandbox.localStorage.setItem('tornPokerHUD_v1', s); };

  stored('x'.repeat(1024));
  let s = T.storageStats();
  t.eq('reads the size of what is actually persisted', s.chars, 1024);
  t.eq('an empty player map is zero players', s.players, 0);
  t.eq('and per-player cost is not NaN on an empty store', s.perPlayer, 0);
  t.eq('a small store is fine', s.level, 'ok');

  // Level thresholds. These drive a colour and a warning line, so the boundary
  // has to be where it claims to be.
  stored('x'.repeat(Math.ceil(T.STORAGE_QUOTA_EST * (T.STORAGE_WARN_PCT / 100)) + 10));
  t.eq('past the warn threshold it goes amber', T.storageStats().level, 'warn');

  stored('x'.repeat(Math.floor(T.STORAGE_QUOTA_EST * (T.STORAGE_WARN_PCT / 100)) - 10));
  t.eq('below it, back to ok', T.storageStats().level, 'ok');

  // A failed save outranks the meter: you can be refused below the estimate,
  // because the estimate is a guess and other origins share the budget.
  T.saveFailure = { at: Date.now(), message: 'QuotaExceededError' };
  t.eq('an actual refusal is "bad" regardless of the estimate', T.storageStats().level, 'bad');
  t.ok('and is reported as failed', T.storageStats().failed);
  T.saveFailure = null;
  t.ok('clearing it clears the flag', !T.storageStats().failed);
}

// --- Per-player cost ---------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players = { 1: {}, 2: {}, 3: {}, 4: {} };
  T._sandbox.localStorage.setItem('tornPokerHUD_v1', 'x'.repeat(4000));
  const s = T.storageStats();
  t.eq('players are counted', s.players, 4);
  t.eq('and the per-player figure divides through', s.perPlayer, 1000);
}

// --- fmtBytes ----------------------------------------------------------------

{
  const T = load();
  t.eq('bytes', T.fmtBytes(512), '512 B');
  t.eq('kilobytes', T.fmtBytes(1024 * 250), '250 KB');
  t.eq('megabytes', T.fmtBytes(1024 * 1024 * 2.5), '2.5 MB');
  // Promotes between tiers rather than printing "1024 KB".
  t.eq('promotes at the boundary', T.fmtBytes(1024 * 1024), '1.0 MB');
}

// --- The banner --------------------------------------------------------------

{
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  const body = T._sandbox.document.body;
  const banners = () => body.children.filter((c) => c.classes().includes('tph-storage-warn'));

  T.saveFailure = null;
  T.renderStorageWarning();
  t.eq('no failure, no banner', banners().length, 0);

  T.saveFailure = { at: Date.now(), message: 'QuotaExceededError' };
  T.renderStorageWarning();
  t.eq('a failure mounts one banner', banners().length, 1);

  // Called from the save path, which fires often. It must replace, not stack.
  T.renderStorageWarning();
  T.renderStorageWarning();
  t.eq('repeated calls do not stack banners', banners().length, 1);

  t.ok('the banner says saving has stopped', /nothing is being saved/i.test(banners()[0].textContent));

  // The rule from CLAUDE.md: nothing the HUD draws over the table may swallow a
  // tap. This banner sits at the top of the viewport over Torn's own chrome, so
  // it is the CSS that has to guarantee it — assert the declaration exists.
  const css = T.CSS || '';
  const rule = /\.tph-storage-warn\s*\{[^}]*\}/.exec(css);
  t.ok('the banner has a style rule', !!rule);
  t.ok('and it is pointer-events: none', !!rule && /pointer-events:\s*none/.test(rule[0]));

  // A recovered save must take the banner down again, or it becomes furniture
  // and stops meaning anything.
  T.saveFailure = null;
  T.renderStorageWarning();
  t.eq('clearing the failure removes the banner', banners().length, 0);
}

// --- The Settings section ----------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players = { 1: {}, 2: {} };
  T._sandbox.localStorage.setItem('tornPokerHUD_v1', 'x'.repeat(2048));

  T.saveFailure = null;
  let html = T.storageSettingsHtml();
  t.ok('reports the size', /2 KB/.test(html));
  t.ok('reports the player count', /2 players/.test(html));
  t.ok('says the limit is an estimate', /estimate/i.test(html));
  t.ok('and states the cleanup policy', /cleanup drops players/i.test(html));
  t.ok('including that you are never dropped', /never dropped/i.test(html));
  t.ok('no alarm when nothing is wrong', !/tph-warn/.test(html));

  T.saveFailure = { at: Date.now(), message: 'QuotaExceededError' };
  html = T.storageSettingsHtml();
  t.ok('a refusal raises the warning block', /tph-warn/.test(html));
  t.ok('it says the data is memory-only', /memory only/i.test(html));
  t.ok('and it tells you to back up first, reset second',
    html.indexOf('backup') < html.indexOf('Reset all data'));
  T.saveFailure = null;
}

// --- The save path sets and clears the flag ---------------------------------
//
// The whole point: a refusal must be recorded, and a later success must undo it.
{
  const T = load();
  T.STORE = T.emptyStore();
  const ls = T._sandbox.localStorage;
  const realSet = ls.setItem.bind(ls);

  let refuse = true;
  ls.setItem = (k, v) => {
    if (refuse) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    return realSet(k, v);
  };

  T.saveFailure = null;
  T.saveStore();
  T._sandbox.runTimers();
  t.ok('a refused save is recorded', !!T.saveFailure);
  const firstAt = T.saveFailure.at;

  // The FIRST failure's timestamp is kept — it marks how far back the
  // memory-only data goes, which is the number the user actually needs.
  T.saveStore();
  T._sandbox.runTimers();
  t.eq('a second refusal keeps the first timestamp', T.saveFailure.at, firstAt);

  refuse = false;
  T.saveStore();
  T._sandbox.runTimers();
  t.eq('a successful save clears the failure', T.saveFailure, null);
}

process.exit(t.report());
