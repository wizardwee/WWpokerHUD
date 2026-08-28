// Hospital status (🏥 on a sitting-out seat, "in hospital?" line on the player
// panel) — see parseHospitalStatus / isHospitalized / refreshSittingOutHospitalStatus
// in the userscript.
//
// Same rule as test/affiliation.test.js, which this mirrors: the real network
// call (fetchHospitalStatus) and the Torn API's actual response shape are NOT
// tested here — nobody working on this holds a key to verify one live. What
// IS tested is everything that doesn't require the network: the defensive
// parse of a v1 profile response, and the pure "are they currently in" check.

const { load, runner } = require('./harness');

const t = runner('hospital-status');

// --- parseHospitalStatus: defensive parsing, fails to null not to a throw --

{
  const T = load();

  t.eq('a well-formed profile parses state + until',
    JSON.stringify(T.parseHospitalStatus({ status: { state: 'Hospital', until: 12345 } })),
    JSON.stringify({ state: 'Hospital', until: 12345 }));

  t.eq('an "Okay" status parses the same way',
    JSON.stringify(T.parseHospitalStatus({ status: { state: 'Okay', until: 0 } })),
    JSON.stringify({ state: 'Okay', until: 0 }));

  t.eq('missing status key entirely still parses (defaults to Okay/0)',
    JSON.stringify(T.parseHospitalStatus({})),
    JSON.stringify({ state: 'Okay', until: 0 }));

  t.eq('null input returns null, not a throw', T.parseHospitalStatus(null), null);
  t.eq('undefined input returns null', T.parseHospitalStatus(undefined), null);

  // Same shape as parseAffiliationProfile's equivalent case — Torn reports a
  // bad/rate-limited key as {"error": {...}}, and that must not be read as a
  // false "not in the hospital".
  t.eq('an API error response returns null, not a false "Okay"',
    T.parseHospitalStatus({ error: { code: 2, error: 'Incorrect key' } }), null);
}

// --- isHospitalized: state AND a still-future release time ----------------

{
  const T = load();
  const future = Math.floor(Date.now() / 1000) + 600; // 10 min from now
  const past = Math.floor(Date.now() / 1000) - 600;    // 10 min ago

  t.eq('Hospital state with a future release reads true',
    T.isHospitalized({ state: 'Hospital', until: future }), true);
  t.eq('Hospital state with a PAST release reads false — the stay is over even if the cache is stale',
    T.isHospitalized({ state: 'Hospital', until: past }), false);
  t.eq('Okay state reads false regardless of until',
    T.isHospitalized({ state: 'Okay', until: future }), false);
  t.eq('Jail (any other state) reads false — this feature is hospital-specific, not "unavailable"',
    T.isHospitalized({ state: 'Jail', until: future }), false);
  t.eq('null status reads false, not a throw', T.isHospitalized(null), false);
  t.eq('undefined status reads false', T.isHospitalized(undefined), false);
}

// --- fmtHospitalRemaining: rounds up, never reads 0m while still in -------

{
  const T = load();
  const inMs = (ms) => Math.floor((Date.now() + ms) / 1000);

  t.eq('90 seconds out rounds UP to 2m, not down to 1m',
    T.fmtHospitalRemaining(inMs(90 * 1000)), '2m');
  t.eq('just under an hour stays in minutes',
    T.fmtHospitalRemaining(inMs(59 * 60 * 1000)), '59m');
  t.eq('over an hour switches to h/m',
    T.fmtHospitalRemaining(inMs(65 * 60 * 1000)), '1h 5m');
  t.eq('already past the release time reads "due out", not a negative duration',
    T.fmtHospitalRemaining(Math.floor(Date.now() / 1000) - 60), 'due out');
}

// --- hospitalStatusFor: reads the in-memory cache, never STORE ------------

{
  const T = load();
  t.eq('nothing cached yet returns null', T.hospitalStatusFor('999'), null);

  T.hospitalCache.set('123', { state: 'Hospital', until: 0, fetchedAt: Date.now() });
  t.eq('a cached entry comes back by xid (string)',
    T.hospitalStatusFor('123').state, 'Hospital');
  t.eq('lookup coerces a numeric xid to the same string key',
    T.hospitalStatusFor(123).state, 'Hospital');
}

// --- refreshSittingOutHospitalStatus: no key configured is a hard no-op ---

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.tornApiKey = '';
  // No DOM in this harness means the seat query already returns nothing, so
  // the real assertion is that calling this with no key throws nothing and
  // touches no network path before that guard — same shape as the
  // affiliation equivalent test.
  let threw = false;
  try { T.refreshSittingOutHospitalStatus(); } catch (e) { threw = true; }
  t.eq('refreshSittingOutHospitalStatus with no API key does not throw', threw, false);
}

process.exit(t.report());
