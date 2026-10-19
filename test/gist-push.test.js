// Gist sync must report a refused call, not stamp it as synced (v1.105.0).
//
// From a real backup: the gist had not changed in six weeks while the status
// line read "Connected. Last sync: <now>". Three faults, each pinned here:
//   1. PATCH went through PDA_httpPost, which takes no method — GitHub got a
//      POST to /gists/<id> and answered 404.
//   2. No call checked the HTTP status, so the 404 stamped lastSync anyway.
//   3. The API truncates file content at ~1MB; a multi-MB backup never parsed,
//      so the pull-and-merge silently did nothing.

const { load, runner } = require('./harness');

const t = runner('gist-push');

function rig(opts) {
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.githubToken = 'tok';
  T.STORE.settings.gistId = 'g1';
  const calls = [];
  T._sandbox.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ via: 'fetch', method, url });
    const r = opts.reply(method, url, init);
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  if (opts.pda) {
    T._sandbox.window.PDA_httpGet = (url) => {
      calls.push({ via: 'pdaGet', method: 'GET', url });
      const r = opts.reply('GET', url);
      return Promise.resolve({ status: r.status, responseText: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) });
    };
    T._sandbox.window.PDA_httpPost = (url) => {
      calls.push({ via: 'pdaPost', method: 'POST', url });
      // What GitHub does with a POST to an existing gist.
      if (/\/gists\/g1$/.test(url)) return Promise.resolve({ status: 404, responseText: '{"message":"Not Found"}' });
      const r = opts.reply('POST', url);
      return Promise.resolve({ status: r.status, responseText: JSON.stringify(r.body) });
    };
  }
  return { T, calls };
}

const gistReply = (content, extra) => ({
  status: 200,
  body: { id: 'g1', files: { 'torn-poker-hud-data.json': Object.assign({ content }, extra || {}) } },
});

(async () => {
  // --- 1. On PDA, the update is a real PATCH, not a POST ------------------------
  {
    const { T, calls } = rig({ pda: true, reply: (m) => (m === 'PATCH' ? { status: 200, body: { id: 'g1' } } : gistReply('')) });
    await T.GistSync.syncNow();
    const patch = calls.find((c) => /\/gists\/g1$/.test(c.url) && c.method !== 'GET');
    t.ok('the update goes out as PATCH', patch && patch.method === 'PATCH');
    t.ok('and not through the POST-only bridge', patch && patch.via === 'fetch');
    t.eq('a confirmed update reads connected', T.GistSync.status, 'connected');
    t.ok('and stamps lastSync', T.STORE.settings.lastSync > 0);
  }

  // --- 2. A refused update is an error, not a sync ------------------------------
  {
    const { T } = rig({ reply: (m) => (m === 'PATCH' ? { status: 422, body: { message: 'Validation Failed' } } : gistReply('')) });
    await T.GistSync.syncNow();
    t.eq('a 422 reads as an error', T.GistSync.status, 'error');
    t.ok('naming the status and GitHub\'s reason', /HTTP 422/.test(T.GistSync.error) && /Validation Failed/.test(T.GistSync.error));
    t.eq('and lastSync is NOT stamped', T.STORE.settings.lastSync || 0, 0);
  }
  {
    const { T } = rig({ reply: (m) => (m === 'PATCH' ? { status: 200, body: { message: 'odd' } } : gistReply('')) });
    await T.GistSync.syncNow();
    t.eq('a 2xx without the gist back is not trusted', T.GistSync.status, 'error');
  }
  {
    const { T } = rig({ reply: () => ({ status: 401, body: { message: 'Bad credentials' } }) });
    await T.GistSync.syncNow();
    t.ok('an expired token says so', /HTTP 401/.test(T.GistSync.error) && /Connect/.test(T.GistSync.error));
    // v1.107.0: the dead token is dropped, so the button offers a fresh sign-in.
    t.ok('the rejected token is dropped', !T.STORE.settings.githubToken);
    t.ok('and the button reads Connect again', /tph-connect">Connect/.test(T.settingsPanelHtml()));
  }
  {
    // Recovery: a later good sync clears the error.
    let fail = true;
    const { T } = rig({ reply: (m) => (m === 'PATCH' ? (fail ? { status: 500, body: {} } : { status: 200, body: { id: 'g1' } }) : gistReply('')) });
    await T.GistSync.syncNow();
    fail = false;
    await T.GistSync.syncNow();
    t.eq('a good sync after a bad one reads connected', T.GistSync.status, 'connected');
  }

  // --- 3. A truncated gist file is fetched whole --------------------------------
  {
    const remote = T0 => JSON.stringify(Object.assign(T0.emptyStore(), {
      players: { 777: Object.assign(T0.emptyPlayer('777', 'Remote'), { hands: 50 }) },
    }));
    const T0 = load();
    const full = remote(T0);
    const { T, calls } = rig({
      reply: (m, url) => {
        if (/raw/.test(url)) return { status: 200, body: full };
        if (m === 'PATCH') return { status: 200, body: { id: 'g1' } };
        return gistReply(full.slice(0, 100), { truncated: true, raw_url: 'https://gist.githubusercontent.com/raw/x' });
      },
    });
    await T.GistSync.syncNow();
    t.ok('the raw file is fetched', calls.some((c) => /raw/.test(c.url)));
    t.ok('and merged', !!T.STORE.players['777']);
    t.eq('the sync completes', T.GistSync.status, 'connected');
  }

  // --- createGist: no id back is an error ---------------------------------------
  {
    const { T } = rig({ reply: () => ({ status: 201, body: {} }) });
    T.STORE.settings.gistId = '';
    await T.GistSync.syncNow();
    t.eq('a create with no id is an error', T.GistSync.status, 'error');
  }

  // --- Sign-in (v1.106.0): survives a reload, and the button follows the token -
  const flush = async (T) => {
    for (let i = 0; i < 6; i++) { T._sandbox.runTimers(); await new Promise((r) => setImmediate(r)); }
  };
  {
    let approved = false;
    const { T } = rig({ reply: (m, url) => {
      if (/device\/code/.test(url)) return { status: 200, body: { device_code: 'dc', user_code: 'UC-1', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 } };
      if (/access_token/.test(url)) return { status: 200, body: approved ? { access_token: 'newtok' } : { error: 'authorization_pending' } };
      if (m === 'PATCH') return { status: 200, body: { id: 'g1' } };
      return gistReply('');
    } });
    T.STORE.settings.githubToken = '';
    T.STORE.settings.githubClientId = 'cid';
    await T.GistSync.startDeviceFlow();
    t.eq('the pending flow is stored', T.STORE.settings.githubPending && T.STORE.settings.githubPending.userCode, 'UC-1');
    t.ok('and never exported', !T.exportJson().includes('"dc"'));
    // The page reloads while you approve: the in-memory poll is gone, and a
    // fresh GistSync resumes from the stored flow.
    T.GistSync.pollToken = null;
    T.GistSync.status = 'idle';
    approved = true;
    t.ok('resume picks the flow up', T.GistSync.resumeDeviceFlow());
    await flush(T);
    t.eq('the token is collected after the reload', T.STORE.settings.githubToken, 'newtok');
    t.ok('the pending flow is cleared', !T.STORE.settings.githubPending);
    t.eq('and the first sync runs', T.GistSync.status, 'connected');
  }
  {
    const { T } = rig({ reply: () => ({ status: 200, body: { error: 'authorization_pending' } }) });
    T.STORE.settings.githubToken = '';
    T.STORE.settings.githubClientId = 'cid';
    T.STORE.settings.githubPending = { deviceCode: 'x', userCode: 'U', uri: 'u', interval: 5, expiresAt: Date.now() - 1 };
    t.ok('an expired flow does not resume', !T.GistSync.resumeDeviceFlow());
    t.ok('and is cleared', !T.STORE.settings.githubPending);
  }
  {
    // A signed-in device whose sync failed is offered Re-sync, not Connect.
    const { T } = rig({ reply: () => ({ status: 500, body: {} }) });
    await T.GistSync.syncNow();
    t.eq('status is error', T.GistSync.status, 'error');
    t.ok('but the button still reads Re-sync now', /tph-connect">Re-sync now/.test(T.settingsPanelHtml()));
    T.STORE.settings.githubToken = '';
    t.ok('with no token it reads Connect', /tph-connect">Connect/.test(T.settingsPanelHtml()));
  }

  process.exit(t.report());
})();
