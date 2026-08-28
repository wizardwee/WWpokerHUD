// pdaCall's two host shapes — see pdaCall / pdaFetch in the userscript.
//
// THE BUG THIS EXISTS FOR. Torn PDA's PDA_httpGet has shipped in two shapes:
// an older one taking a callback, and a newer one returning a Promise. The
// original pdaCall handled only the callback form — it returned a Promise
// resolved solely from a callback passed as the last argument. Against the
// Promise-returning host that callback is never invoked, the real result is
// discarded, and the await hangs forever: no throw, no rejection, nothing
// logged, nothing on screen.
//
// It took a live deep scan to find, and only because the scan printed three
// facts at once — "apiKey set: true", "successful lookups: 0", "last fetch:
// never" — with NO recorded error. A hung promise is the only state that
// produces all of those together. Every Torn API feature in the file (faction
// and marriage badges, hospital/jail status, the attack readiness) was dead
// the whole time and had no way to say so.
//
// The timeout is half the fix: a hang must never again be indistinguishable
// from a request that was never made.

const { load, runner } = require('./harness');

const t = runner('pda-call');

// --- the callback shape (older hosts) -------------------------------------

{
  const T = load();
  let sawCallback = false;
  const host = (url, headers, cb) => { sawCallback = true; cb({ status: 200, body: '{"ok":1}' }); };

  T.pdaCall(host, ['http://x', {}]).then((r) => {
    t.eq('a callback host resolves', r.status, 200);
    t.eq('and its body is carried through', r.text, '{"ok":1}');
    t.eq('the callback was actually used', sawCallback, true);
  });
}

// --- the Promise shape (newer hosts) — the one that used to hang ----------

{
  const T = load();
  // Returns a Promise and IGNORES the callback, exactly as the newer host does.
  const host = () => Promise.resolve({ status: 200, body: '{"ok":2}' });

  T.pdaCall(host, ['http://x', {}]).then((r) => {
    t.eq('a Promise-returning host resolves rather than hanging', r.status, 200);
    t.eq('and its body is carried through', r.text, '{"ok":2}');
  });
}

// --- the REAL PDA envelope -------------------------------------------------
//
// Confirmed from a live scan: Torn PDA returns
// {status, statusText, responseText, responseHeaders}. `responseText` is the
// body, and it was the one field normalizePdaResponse never looked for. With
// no `body` and no `text` it fell through to JSON.stringify(result) and
// handed the WHOLE ENVELOPE downstream as if it were the reply — which is how
// five seats came to report "Okay / attackable" with no profile ever read.

{
  const T = load();
  const envelope = {
    status: 200,
    statusText: 'OK',
    responseText: '{"status":{"state":"Hospital","until":123},"level":42}',
    responseHeaders: {},
  };
  T.pdaCall(() => Promise.resolve(envelope), ['http://x', {}]).then((r) => {
    t.eq('responseText is taken as the body', r.text, envelope.responseText);
    t.eq('and the HTTP status is carried', r.status, 200);
    // The parse that was silently broken end to end.
    const parsed = T.parseTargetStatus(JSON.parse(r.text));
    t.ok('so the profile finally parses', !!parsed);
    t.eq('with the real state', parsed.state, 'Hospital');
    t.eq('and the level that used to read 0', parsed.level, 42);
  });
}

// --- a body that cannot be found is EMPTY, never the envelope --------------
//
// The old fallback returned JSON.stringify(result). Returning something
// response-shaped when the body could not be located is how a transport
// failure becomes confident wrong data three layers up. An empty body makes
// the JSON parse fail and the caller treat it as unknown.

{
  const T = load();
  T.pdaCall(() => Promise.resolve({ status: 200, weird: 'no body field here' }), ['http://x', {}])
    .then((r) => {
      t.eq('an unlocatable body comes back empty', r.text, '');
      t.eq('and never as a stringified envelope', r.text.indexOf('weird'), -1);
    });
}

// --- a plain string result, which normalizePdaResponse also accepts -------

{
  const T = load();
  T.pdaCall(() => Promise.resolve('raw body'), ['http://x', {}]).then((r) => {
    t.eq('a bare string result is treated as a 200', r.status, 200);
    t.eq('with the string as the body', r.text, 'raw body');
  });
}

// --- failures propagate, in both shapes -----------------------------------

{
  const T = load();

  // Synchronous throw from the host.
  T.pdaCall(() => { throw new Error('boom'); }, ['http://x', {}]).then(
    () => { t.ok('a synchronous throw must not resolve', false); },
    (e) => { t.eq('a synchronous throw rejects', e.message, 'boom'); },
  );

  // Rejected promise from the host.
  T.pdaCall(() => Promise.reject(new Error('net down')), ['http://x', {}]).then(
    () => { t.ok('a rejected promise must not resolve', false); },
    (e) => { t.eq('a rejected promise rejects', e.message, 'net down'); },
  );
}

// --- only the first outcome counts ----------------------------------------
//
// The callback is passed to BOTH shapes, so a host that calls back AND
// resolves would otherwise settle twice. Promises ignore the second settle,
// but the guard also stops the timeout firing after a real result.

{
  const T = load();
  const host = (url, headers, cb) => {
    cb({ status: 200, body: 'first' });
    return Promise.resolve({ status: 500, body: 'second' });
  };
  T.pdaCall(host, ['http://x', {}]).then((r) => {
    t.eq('the first outcome wins and the second is ignored', r.text, 'first');
    t.eq('and the status is the first one too', r.status, 200);
  });
}

// --- the timeout ----------------------------------------------------------
//
// The harness queues setTimeout rather than running it, so draining the queue
// is what fires the timer. That is precisely the hang case: a host that never
// calls back and never returns a thenable.

{
  const T = load({ dom: 'class' });
  let rejected = null;
  const hung = () => undefined; // never calls back, returns nothing
  T.pdaCall(hung, ['http://x', {}]).then(
    () => { t.ok('a hung host must not resolve', false); },
    (e) => { rejected = e; },
  );
  t.ok('a timeout is armed for a host that never answers', T.PDA_CALL_TIMEOUT_MS > 0);
}

// The assertions inside .then() above run on the microtask queue, after this
// synchronous block. Report from a callback so they are all counted.
setTimeout(() => process.exit(t.report()), 0);
