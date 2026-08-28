// Target status — can this seat actually be attacked once they leave the
// table. See parseTargetStatus / attackReadiness / ATTACK_BLOCKERS and
// refreshSeatedTargetStatus in the userscript.
//
// Same rule as test/affiliation.test.js, which this mirrors: the real network
// call (fetchTargetStatus) and the Torn API's actual response shape are NOT
// tested here — nobody working on this holds a key to verify one live. What
// IS tested is everything that doesn't require the network: the defensive
// parse of a v1 profile response, and the pure decision about whether a given
// status blocks an attack.
//
// The property that matters most is the ASYMMETRY of the unknown case. An
// unrecognised state must never read as "attackable": Torn can add or rename
// a state at any time, and of the two ways to be wrong, "said go when they
// were untouchable" is the one that costs the user something.

const { load, runner } = require('./harness');

const t = runner('target-status');

const soon = () => Math.floor(Date.now() / 1000) + 600;  // 10 min out
const past = () => Math.floor(Date.now() / 1000) - 600;  // 10 min ago

// --- parseTargetStatus: defensive parsing, fails to null not to a throw ----

{
  const T = load();

  t.eq('a well-formed profile parses state, description, until and level',
    JSON.stringify(T.parseTargetStatus({
      status: { state: 'Hospital', description: 'In hospital for 10 minutes', until: 12345 },
      level: 42,
    })),
    JSON.stringify({ state: 'Hospital', description: 'In hospital for 10 minutes', until: 12345, level: 42 }));

  // THE HOLE, and this assertion used to enshrine it. It asserted that a
  // response with no status key "defaults to Okay/0" — which is exactly what
  // the code did, and exactly what was wrong. Written to match the
  // implementation rather than the requirement, so it agreed with the bug and
  // the suite stayed green while five seats reported "Okay / attackable"
  // without a single profile having been read (see v1.40.0).
  //
  // Absence of a state is the LEAST evidence there is, so it has to produce
  // the least conclusive answer, not the most reassuring one.
  t.eq('a response with no status at all refuses to parse — never "Okay"',
    T.parseTargetStatus({}), null);
  t.eq('a status object with no state refuses too',
    T.parseTargetStatus({ status: {} }), null);
  t.eq('a non-string state refuses',
    T.parseTargetStatus({ status: { state: 7 } }), null);
  t.eq('an empty-string state refuses',
    T.parseTargetStatus({ status: { state: '' } }), null);

  // THE ACTUAL SHAPE THAT BROKE IT. Torn PDA's HTTP envelope is
  // {status, statusText, responseText, responseHeaders} — and the old
  // normalizePdaResponse handed that whole object downstream as if it were
  // Torn's reply. `json.status` is then an HTTP status, not Torn's status
  // object, and reading `.state` off it found nothing.
  t.eq('the PDA HTTP envelope is refused, not read as a profile',
    T.parseTargetStatus({ status: 200, statusText: 'OK', responseText: '{}', responseHeaders: {} }),
    null);

  // A real profile with only the fields we need still parses — the tightened
  // guard must not reject valid replies.
  t.eq('a status carrying only a state still parses',
    JSON.stringify(T.parseTargetStatus({ status: { state: 'Okay' } })),
    JSON.stringify({ state: 'Okay', description: '', until: 0, level: 0 }));

  t.eq('null input returns null, not a throw', T.parseTargetStatus(null), null);
  t.eq('undefined input returns null', T.parseTargetStatus(undefined), null);

  // Torn reports a bad/rate-limited key as {"error": {...}} rather than an
  // HTTP error. Reading that as "Okay" would cache a false green light.
  t.eq('an API error response returns null, not a false "Okay"',
    T.parseTargetStatus({ error: { code: 2, error: 'Incorrect key' } }), null);
}

// --- attackReadiness: blocked / ready / unknown are three answers ----------

{
  const T = load();

  // Every blocker Torn is documented to return. Driven off ATTACK_BLOCKERS
  // itself rather than a hand-copied list, so adding a state to the map
  // cannot leave an untested branch behind.
  Object.keys(T.ATTACK_BLOCKERS).forEach((state) => {
    const r = T.attackReadiness({ state, until: soon() });
    t.eq(`${state} blocks an attack`, r.blocked, true);
    t.eq(`${state} is not ready`, r.ready, false);
    t.eq(`${state} is not "unknown" — it is a state we recognise`, r.unknown, false);
    t.ok(`${state} carries an emoji for the badge`, !!r.emoji);
    t.ok(`${state} carries a human label`, !!r.label);
  });

  const okay = T.attackReadiness({ state: 'Okay', until: 0 });
  t.eq('Okay is ready', okay.ready, true);
  t.eq('Okay is not blocked', okay.blocked, false);
  t.eq('Okay is not unknown', okay.unknown, false);
  t.eq('Okay shows no badge glyph — only blockers get one', okay.emoji, '');
}

// --- an expired stay reads as clear, not as a wait already elapsed --------

{
  const T = load();
  const r = T.attackReadiness({ state: 'Hospital', until: past() });
  t.eq('a hospital stay whose until has passed is ready again', r.ready, true);
  t.eq('and is not reported as blocked', r.blocked, false);
  t.eq('and carries no leftover countdown', r.until, 0);

  // A blocker with no `until` at all (travel legs may not carry one) still
  // blocks — absence of a countdown is not evidence the state has ended.
  const travelling = T.attackReadiness({ state: 'Traveling', until: 0 });
  t.eq('a blocker with no until still blocks', travelling.blocked, true);
  t.eq('and reports no countdown rather than a bogus one', travelling.until, 0);
}

// --- the asymmetry: unknown is never "go" ---------------------------------

{
  const T = load();

  const weird = T.attackReadiness({ state: 'Fallen', until: 0 });
  t.eq('an unrecognised state is not ready', weird.ready, false);
  t.eq('an unrecognised state is not claimed as blocked either', weird.blocked, false);
  t.eq('it is reported as unknown — its own answer', weird.unknown, true);
  t.ok('and names the state it did not recognise', weird.label.indexOf('Fallen') !== -1);

  const none = T.attackReadiness(null);
  t.eq('no status at all is not ready', none.ready, false);
  t.eq('no status at all is unknown', none.unknown, true);
  t.eq('no status at all is not blocked', none.blocked, false);

  // Both travel spellings are covered, because which one Torn returns is not
  // confirmed and the two are one letter apart — an unrecognised REAL blocker
  // is the dangerous direction.
  t.eq('"Traveling" is recognised as a blocker',
    T.attackReadiness({ state: 'Traveling', until: soon() }).blocked, true);
  t.eq('"Travelling" is recognised as a blocker too',
    T.attackReadiness({ state: 'Travelling', until: soon() }).blocked, true);
}

// --- fmtStatusRemaining: rounds up, never reads 0m while still in ---------

{
  const T = load();
  const inMs = (ms) => Math.floor((Date.now() + ms) / 1000);

  t.eq('90 seconds out rounds UP to 2m, not down to 1m',
    T.fmtStatusRemaining(inMs(90 * 1000)), '2m');
  t.eq('just under an hour stays in minutes',
    T.fmtStatusRemaining(inMs(59 * 60 * 1000)), '59m');
  t.eq('over an hour switches to h/m',
    T.fmtStatusRemaining(inMs(65 * 60 * 1000)), '1h 5m');
  // Federal jail runs to days, where "73h 12m" is harder to read than "3d 1h".
  t.eq('over a day switches to d/h',
    T.fmtStatusRemaining(inMs(73 * 60 * 60 * 1000)), '3d 1h');
  t.eq('already past the release time reads "due out", not a negative',
    T.fmtStatusRemaining(Math.floor(Date.now() / 1000) - 60), 'due out');
}

// --- the links -------------------------------------------------------------
//
// Links only, never a click: CLAUDE.md's rule is that this HUD is advisory
// and must never act for the user, which goes double for the game's own
// controls. These just build URLs.

{
  const T = load();
  t.eq('the attack URL is Torn\'s own loader form',
    T.attackUrl('3722665'), 'https://www.torn.com/loader.php?sid=attack&user2ID=3722665');
  t.eq('the profile URL is Torn\'s own profile form',
    T.profileUrl('3722665'), 'https://www.torn.com/profiles.php?XID=3722665');
  // XIDs come from a DOM element id, so they are encoded rather than trusted
  // into a URL verbatim.
  t.ok('an xid with URL-significant characters is encoded',
    T.attackUrl('a&b=c').indexOf('a%26b%3Dc') !== -1);
}

// --- targetStatusFor / the cache ------------------------------------------

{
  const T = load();
  t.eq('nothing cached yet returns null', T.targetStatusFor('999'), null);

  T.targetCache.set('123', { state: 'Jail', until: soon(), level: 30, fetchedAt: Date.now() });
  t.eq('a cached entry comes back by xid (string)', T.targetStatusFor('123').state, 'Jail');
  t.eq('lookup coerces a numeric xid to the same string key',
    T.targetStatusFor(123).state, 'Jail');
  t.eq('and it drives the readiness answer',
    T.attackReadiness(T.targetStatusFor('123')).blocked, true);
}

// --- refreshSeatedTargetStatus: no key configured is a hard no-op ---------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.tornApiKey = '';
  // No DOM in this harness means the seat query already returns nothing, so
  // the real assertion is that calling this with no key throws nothing and
  // touches no network path before that guard — same shape as the
  // affiliation equivalent test.
  let threw = false;
  try { T.refreshSeatedTargetStatus(); } catch (e) { threw = true; }
  t.eq('refreshSeatedTargetStatus with no API key does not throw', threw, false);
}

// --- targetDiagnostic: the feature must be able to explain its own silence -
//
// This is the whole point of the v1.34.0 fix. v1.30.0-v1.33.0 had FIVE
// distinct reasons to show nothing — no key, wrong key, rate limit, network
// failure, and "nobody here is blocked" — and every one of them looked
// identical from the outside. It came back as a live report of exactly that.
// Nobody working on this can see the screen, so a feature resting on
// unverified field names has to be able to say why it is quiet.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.tornApiKey = '';
  const d = T.targetDiagnostic();
  t.ok('with no key, the diagnostic says so', d.indexOf('No Torn API key') !== -1);
  t.ok('and points at where to set one', d.indexOf('Settings') !== -1);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.tornApiKey = 'abc123';
  // A key is set but nothing has been fetched yet — distinct from both "no
  // key" and "working fine", and the commonest state when first switching on.
  const d = T.targetDiagnostic();
  t.ok(`with a key but no lookup yet, it says so (got: ${JSON.stringify(d)})`,
    d.indexOf('No lookup') !== -1);
  t.ok('and does not claim a missing key', d.indexOf('No Torn API key') === -1);
  // The key itself must never appear in a diagnostic — it is a credential,
  // and this string is shown in Settings and printed into the deep scan that
  // gets pasted into a chat.
  t.eq('the diagnostic never leaks the key', d.indexOf('abc123'), -1);
}


process.exit(t.report());
