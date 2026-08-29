// Estimated battle stats (TornStats) — see parseSpyStats / spyStatsFor /
// spyDiagnostic / requestSpyStats in the userscript.
//
// Same rule as test/affiliation.test.js and test/target-status.test.js, which
// this mirrors — but the caveat is stronger here. Those two integrations were
// at least checked against Torn's own PUBLISHED API documentation before
// shipping. This one could not be: this project's environment blocks network
// egress to both tornstats.com and yata.yt, so the field names parseSpyStats
// looks for are written from memory of TornStats' documented v2 shape, not a
// fetched doc and not a live response. What IS tested is everything that
// doesn't require the network: the defensive parse (which must fail to null,
// not throw, on anything it doesn't recognise) and the pure formatting/cache
// logic built on top of it.
//
// The property that matters most, same as target-status: a wrong guess here
// must cost a MISSING read, never a crash and never a confidently wrong one.

const { load, runner } = require('./harness');

const t = runner('spy-stats');

// --- parseSpyStats: defensive parsing, fails to null not to a throw --------

{
  const T = load();

  t.eq('a well-formed spy response parses all four stats, total and timestamp',
    JSON.stringify(T.parseSpyStats({
      status: true,
      spy: { strength: 1000000, defense: 900000, speed: 800000, dexterity: 700000, total: 3400000, timestamp: 1690000000 },
    })),
    JSON.stringify({ strength: 1000000, defense: 900000, speed: 800000, dexterity: 700000, total: 3400000, spiedAt: 1690000000 }));

  // "Never spied" — several community spy tools use `[]` rather than `{}` for
  // "nothing here" wherever a same-shaped object is otherwise expected.
  t.eq('an empty-array spy (never spied) refuses to parse, not a false zero',
    T.parseSpyStats({ status: true, spy: [] }), null);

  t.eq('a missing spy key refuses', T.parseSpyStats({ status: true }), null);
  t.eq('status:false refuses, even with a spy-shaped body',
    T.parseSpyStats({ status: false, message: 'no data', spy: { total: 1 } }), null);

  // A malformed 0 total must not be read as a genuine figure — a real spied
  // player's battle stats are essentially never all-zero past the first few
  // levels, so this is the same "confidently wrong is worse than none" guard
  // as the other two parsers in this file.
  t.eq('a zero total refuses rather than reporting an all-zero player',
    T.parseSpyStats({ status: true, spy: { strength: 0, defense: 0, speed: 0, dexterity: 0, total: 0 } }), null);
  t.eq('a negative or non-numeric total refuses',
    T.parseSpyStats({ status: true, spy: { total: 'not a number' } }), null);

  // The same PDA HTTP envelope shape that broke parseTargetStatus and
  // parseAffiliationProfile before their v1.40.0/v1.42.0 fixes — refused
  // outright, never misread as "no data".
  t.eq('the PDA HTTP envelope refuses, not read as a profile',
    T.parseSpyStats({ status: 200, statusText: 'OK', responseText: '{}', responseHeaders: {} }),
    null);

  // A real response missing some fields still parses — only `total` is
  // required; the rest default to 0 rather than failing the whole read.
  t.eq('missing individual stat fields default to 0 rather than failing the parse',
    JSON.stringify(T.parseSpyStats({ status: true, spy: { total: 5000000 } })),
    JSON.stringify({ strength: 0, defense: 0, speed: 0, dexterity: 0, total: 5000000, spiedAt: 0 }));

  t.eq('null input returns null, not a throw', T.parseSpyStats(null), null);
  t.eq('undefined input returns null', T.parseSpyStats(undefined), null);

  // Torn-API-style error envelope, in case TornStats ever proxies one through.
  t.eq('an {error:...} response returns null, not a false read',
    T.parseSpyStats({ error: { code: 2, error: 'Incorrect key' } }), null);
}

// --- spyStatsFor / the cache -------------------------------------------------

{
  const T = load();
  t.eq('nothing cached yet returns null', T.spyStatsFor('999'), null);

  T.spyCache.set('123', { strength: 1e6, defense: 9e5, speed: 8e5, dexterity: 7e5, total: 3.4e6, spiedAt: 1690000000, fetchedAt: Date.now() });
  t.eq('a cached entry comes back by xid (string)', T.spyStatsFor('123').total, 3.4e6);
  t.eq('lookup coerces a numeric xid to the same string key', T.spyStatsFor(123).total, 3.4e6);
}

// --- requestSpyStats / refreshSeatedSpyStats: gated behind BOTH the toggle
// and the key, on top of the no-DOM no-op every other refresher here has ----

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.battleStatsEstimate = false;
  T.STORE.settings.tornStatsApiKey = 'abc123';
  let threw = false;
  try { T.requestSpyStats('123'); T.refreshSeatedSpyStats(); } catch (e) { threw = true; }
  t.eq('the feature toggle off is a hard no-op even with a key set', threw, false);
  t.eq('and nothing gets cached', T.spyStatsFor('123'), null);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.battleStatsEstimate = true;
  T.STORE.settings.tornStatsApiKey = '';
  let threw = false;
  try { T.requestSpyStats('123'); T.refreshSeatedSpyStats(); } catch (e) { threw = true; }
  t.eq('the toggle on with no key is still a no-op, and does not throw', threw, false);
}

// --- spyDiagnostic: must explain its own silence, same as targetDiagnostic -

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.battleStatsEstimate = false;
  const d = T.spyDiagnostic();
  t.ok('with the feature off, the diagnostic says so', d.indexOf('off') !== -1);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.battleStatsEstimate = true;
  T.STORE.settings.tornStatsApiKey = '';
  const d = T.spyDiagnostic();
  t.ok('feature on but no key says so', d.indexOf('No TornStats API key') !== -1);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.battleStatsEstimate = true;
  T.STORE.settings.tornStatsApiKey = 'abc123';
  const d = T.spyDiagnostic();
  t.ok(`feature on, key set, nothing fetched yet says so (got: ${JSON.stringify(d)})`,
    d.indexOf('No lookup') !== -1);
  // The key itself must never appear in a diagnostic — it's a credential,
  // shown in Settings and printed into the deep scan pasted into chats.
  t.eq('the diagnostic never leaks the key', d.indexOf('abc123'), -1);
}

// --- spyStatsLabel / spyStatsDetail: compact line + tooltip breakdown ------

{
  const T = load();
  t.eq('no cached stats renders nothing', T.spyStatsLabel('999'), '');
  t.eq('and the detail tooltip is empty too', T.spyStatsDetail('999'), '');

  T.spyCache.set('123', {
    strength: 1000000, defense: 900000, speed: 800000, dexterity: 700000, total: 3400000,
    spiedAt: Math.floor(Date.now() / 1000) - 3600, fetchedAt: Date.now(),
  });
  t.eq('the compact label shows an abbreviated total, marked as an estimate',
    T.spyStatsLabel('123'), '≈3.4M BS');
  const detail = T.spyStatsDetail('123');
  t.ok('the tooltip breaks down all four stats', /S 1M.*D 900k.*Sp 800k.*Dx 700k/.test(detail));
  t.ok('and says how long ago it was spied', detail.indexOf('1h ago') !== -1);
  t.ok('and states plainly this is not Torn\'s own data',
    detail.indexOf("not Torn's own data") !== -1);
}

// --- fmtStatNum: same k/M/B ladder as fmtMoney, without the $ --------------

{
  const T = load();
  t.eq('a small number reads as a bare integer', T.fmtStatNum(500), '500');
  t.eq('thousands abbreviate', T.fmtStatNum(41000), '41k');
  t.eq('millions abbreviate with one decimal, trimmed', T.fmtStatNum(3400000), '3.4M');
  t.eq('an exact million has no trailing .0', T.fmtStatNum(1000000), '1M');
  t.eq('no leading $', T.fmtStatNum(1000000).indexOf('$'), -1);
}

// --- fmtSpyAge: elapsed time, not a countdown -------------------------------

{
  const T = load();
  const secsAgo = (n) => Math.floor(Date.now() / 1000) - n;
  t.eq('no timestamp at all renders nothing', T.fmtSpyAge(0), '');
  t.eq('under a minute reads "just now"', T.fmtSpyAge(secsAgo(10)), 'just now');
  t.eq('minutes read as Nm ago', T.fmtSpyAge(secsAgo(5 * 60)), '5m ago');
  t.eq('hours read as Nh ago', T.fmtSpyAge(secsAgo(3 * 3600)), '3h ago');
  t.eq('days read as Nd ago', T.fmtSpyAge(secsAgo(2 * 86400 + 3600)), '2d ago');
}

process.exit(t.report());
