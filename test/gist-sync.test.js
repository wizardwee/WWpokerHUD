// The Gist sync status line, extended in v1.20.0 to actually show WHERE the
// data went.
//
// Before this, "Connected. Last sync: ..." told you sync was happening but
// never surfaced the gist itself — the only way to find it was to leave the
// HUD and go hunting on github.com. That mattered more once v1.19.0 shipped:
// Copy/Save can both genuinely fail on a large export (suspected size limits
// in the clipboard and the Flutter share bridge, both far more restrictive
// than a plain HTTPS PATCH to the GitHub API), and a gist opened in the
// phone's REGULAR browser has full, unrestricted clipboard access that this
// HUD's own constrained page does not. The gist URL is the way out — so it
// has to actually be reachable from the panel that made it.

const { load, runner } = require('./harness');

const t = runner('gist-sync');

// --- gistUrl -----------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  t.eq('no gist yet — no URL to show', T.gistUrl(), null);

  T.STORE.settings.gistId = 'abc123def456';
  t.eq('resolves without needing the username — GitHub redirects on the bare id',
    T.gistUrl(), 'https://gist.github.com/abc123def456');
}

// --- syncStatusText ------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  T.GistSync.status = 'waiting-for-user';
  T.GistSync.verificationUri = 'https://github.com/login/device';
  T.GistSync.userCode = 'ABCD-1234';
  t.ok('waiting-for-user names the verification URL and code',
    T.syncStatusText().includes('ABCD-1234') && T.syncStatusText().includes('github.com/login/device'));

  T.GistSync.status = 'polling';
  t.eq('polling is a plain wait message', T.syncStatusText(), 'Waiting for authorization…');

  T.GistSync.status = 'error';
  T.GistSync.error = 'boom';
  t.eq('error surfaces the message', T.syncStatusText(), 'Error: boom');

  T.GistSync.status = 'idle';
  t.eq('idle reads as not connected', T.syncStatusText(), 'Not connected.');
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.GistSync.status = 'connected';

  // Connected but the gist hasn't actually been created yet (createGist
  // failed silently, or this is mid-flow) — must not print a broken/partial
  // URL just because the status says "connected".
  t.eq('no gistId yet: no URL text', /gist\.github\.com/.test(T.syncStatusText()), false);

  T.STORE.settings.gistId = 'deadbeef1234';
  T.STORE.settings.lastSync = 0;
  t.ok('lastSync of 0 (never) still reads as "never", not a broken date',
    T.syncStatusText().includes('never'));
  t.ok('...and the gist URL is now present',
    T.syncStatusText().includes('https://gist.github.com/deadbeef1234'));

  const stamp = Date.UTC(2026, 0, 15, 12, 0, 0);
  T.STORE.settings.lastSync = stamp;
  t.ok('a real lastSync timestamp is reflected too', T.syncStatusText().includes('Last sync:'));
  t.ok('and the gist URL still appears alongside it',
    T.syncStatusText().includes('https://gist.github.com/deadbeef1234'));
}

process.exit(t.report());
