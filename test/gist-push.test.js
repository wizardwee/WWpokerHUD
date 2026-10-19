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
    t.ok('an expired token says so', /HTTP 401/.test(T.GistSync.error) && /Bad credentials/.test(T.GistSync.error));
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

  process.exit(t.report());
})();
