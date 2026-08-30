// The shared API probe — see apiProbe / probeFetch in the userscript.
//
// WHY THIS FILE EXISTS. Two features (target status, estimated battle stats)
// used to carry their own copy of the same five counters, the same diagnostic
// wording and the same fetch body. v1.48.0 collapsed them onto one probe, and
// the whole value of that is the part a refactor can silently break: the
// diagnostic state machine, and the counter plumbing behind it.
//
// The counters are NOT decoration. `fetchStarted` is incremented BEFORE the
// await and `lastFetchAt` only after it, so the gap between them is what
// separates "the request is hanging" from "no request was ever made" — the
// exact distinction that made the v1.38.0 pdaCall hang take a live deep scan
// to find. With one probe now serving two features, a break there costs both.
//
// Verified non-vacuous before being committed: deleting `probe.fetchStarted++`
// from probeFetch failed nothing in the whole suite until this file existed.

const { load, runner } = require('./harness');

const t = runner('api-probe');

// --- the diagnostic state machine, in precedence order --------------------

{
  const T = load();
  const p = T.apiProbe('nothing yet');

  t.eq('a fresh probe with no gate reports the no-lookup hint', p.diagnostic(), 'nothing yet');
  t.eq('and an always-open gate is the same', p.diagnostic(() => ''), 'nothing yet');

  // The gate outranks everything: a feature switched off should say so rather
  // than complain about a lookup it was never going to make.
  p.lastError = 'some transport failure';
  t.eq('a closed gate outranks a recorded error', p.diagnostic(() => 'switched off'), 'switched off');
  t.eq('but an open gate lets the error through', p.diagnostic(() => ''), 'some transport failure');

  // An error outranks the counters — it is the most specific thing known.
  p.fetchStarted = 3;
  t.eq('an error outranks the hanging-request branch', p.diagnostic(), 'some transport failure');
}

// --- started-but-none-returned: the branch that names a HANG ---------------

{
  const T = load();
  const p = T.apiProbe('nothing yet');
  p.fetchStarted = 3;
  const d = p.diagnostic();
  t.ok(`3 started and 0 back reads as a possible hang (got: ${JSON.stringify(d)})`,
    d.indexOf('3 lookup(s) started') !== -1 && d.indexOf('hanging') !== -1);

  // Once one comes back, that branch must stop firing — otherwise a single
  // slow first request would keep claiming a hang forever.
  p.lastFetchAt = Date.now();
  t.eq('a completed lookup clears the hang reading, and reports healthy', p.diagnostic(), '');
}

// --- probeFetch: the real function, driven against a replaced dependency ---
//
// The fake here replaces `fetch` on the sandbox global — the DEPENDENCY —
// rather than stubbing probeFetch through the seam. That distinction is the
// whole lesson of test/departure-watch.test.js's header: reassigning a seam
// export does not rebind the module's own function, so a test written that
// way passes against code it never called.

function withFetch(T, impl) {
  T._sandbox.fetch = impl;
}

const okBody = (obj) => () => Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });

{
  const T = load();
  const p = T.apiProbe('nothing yet');
  const cache = new Map();
  withFetch(T, okBody({ ok: true, value: 7 }));

  return (async () => {
    await T.probeFetch(p, {
      xid: '123',
      url: 'https://example.invalid/x',
      parse: (j) => (j && j.ok ? { value: j.value } : null),
      cache,
      unreachable: 'could not reach it',
    });

    t.eq('a successful fetch counts as started', p.fetchStarted, 1);
    t.eq('and records when it came back', p.lastFetchAt > 0, true);
    t.eq('and counts as OK', p.okCount, 1);
    t.eq('and leaves no error', p.lastError, '');
    t.eq('the parsed value is cached under the xid', cache.get('123').value, 7);
    t.ok('with a fetchedAt stamp for the freshness gate', cache.get('123').fetchedAt > 0);
    t.eq('top-level key NAMES are captured for the deep scan', p.lastKeys, 'ok,value');
    t.eq('and the probe now reports healthy', p.diagnostic(), '');

    // --- an API-level refusal: HTTP 200 with an error BODY ---------------
    //
    // Both services answer a bad key or a rate limit this way, so this is the
    // only place either can be noticed. It must NOT reach the cache.
    {
      const p2 = T.apiProbe('nothing yet');
      const cache2 = new Map();
      withFetch(T, okBody({ error: { code: 2, error: 'Incorrect key' } }));
      await T.probeFetch(p2, {
        xid: '123',
        url: 'https://example.invalid/x',
        apiError: (j) => (j && j.error ? 'Svc: ' + j.error.error : ''),
        parse: () => ({ shouldNotBeUsed: true }),
        cache: cache2,
        unreachable: 'could not reach it',
      });
      t.eq('a refusal is counted as started', p2.fetchStarted, 1);
      t.eq('but never as OK', p2.okCount, 0);
      t.eq('the service message is what the diagnostic reports', p2.diagnostic(), 'Svc: Incorrect key');
      t.eq('and NOTHING is cached from a refusal', cache2.size, 0);
    }

    // --- an unparseable body ---------------------------------------------
    {
      const p3 = T.apiProbe('nothing yet');
      const cache3 = new Map();
      withFetch(T, okBody({ something: 'unexpected' }));
      await T.probeFetch(p3, {
        xid: '123',
        url: 'https://example.invalid/x',
        parse: () => null, // the defensive parsers all fail to null, never throw
        cache: cache3,
        unreachable: 'could not reach it',
      });
      t.eq('an unrecognised shape is named as such', p3.lastError, 'unrecognised API response shape');
      t.eq('and is not cached', cache3.size, 0);
      t.eq('and is not counted as OK', p3.okCount, 0);
    }

    // --- a transport failure ---------------------------------------------
    {
      const p4 = T.apiProbe('nothing yet');
      const cache4 = new Map();
      withFetch(T, () => Promise.reject(new Error('offline')));
      await T.probeFetch(p4, {
        xid: '123',
        url: 'https://example.invalid/x',
        parse: () => ({ v: 1 }),
        cache: cache4,
        unreachable: 'could not reach example.invalid',
      });
      t.eq('a thrown transport error is counted as started', p4.fetchStarted, 1);
      t.eq('and reports the caller\'s own unreachable message', p4.lastError, 'could not reach example.invalid');
      t.eq('and never reaches lastFetchAt — nothing came back', p4.lastFetchAt, 0);
      t.eq('and caches nothing', cache4.size, 0);
      // THE HANG READING, end to end: started but never returned.
      t.ok('so the probe can still distinguish a hang from a dead start',
        p4.diagnostic().indexOf('could not reach') !== -1);
    }

    // --- a recovered probe clears its own error --------------------------
    //
    // lastError is sticky by design (it survives until something works), so
    // the clear-on-success path is what stops a single old failure reading as
    // current forever.
    {
      const p5 = T.apiProbe('nothing yet');
      p5.lastError = 'stale failure from ten minutes ago';
      const cache5 = new Map();
      withFetch(T, okBody({ ok: true, value: 1 }));
      await T.probeFetch(p5, {
        xid: '9',
        url: 'https://example.invalid/x',
        parse: (j) => (j.ok ? { value: j.value } : null),
        cache: cache5,
        unreachable: 'nope',
      });
      t.eq('a later success clears the stale error', p5.lastError, '');
      t.eq('and the diagnostic goes quiet', p5.diagnostic(), '');
    }

    // --- the two live probes are genuinely separate objects --------------
    //
    // Sharing the SHAPE must not mean sharing the STATE: TornStats being down
    // has nothing to say about whether Torn's own API is reachable.
    t.ok('targetProbe and spyProbe are distinct objects', T.targetProbe !== T.spyProbe);
    T.targetProbe.lastError = 'torn is down';
    t.eq('an error on one does not appear on the other', T.spyProbe.lastError, '');

    process.exit(t.report());
  })();
}
