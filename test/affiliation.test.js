// Shared-affiliation badges (🔗 same faction, 💍 married) — see
// parseAffiliationProfile / affiliationFlags in the userscript.
//
// Deliberately NOT tested here: the actual network call (fetchAffiliation) and
// the Torn API's real response shape, which nobody working on this holds a key
// to verify live — same rule as every DOM selector in this file: unconfirmed
// until reported back from a real fetch. What IS tested is everything that
// doesn't require the network: the defensive parse of a v1 profile response,
// and the pure comparison logic that decides whether two SEATED players match.

const { load, runner } = require('./harness');

const t = runner('affiliation');

// --- parseAffiliationProfile: defensive parsing, fails to null not to a throw

{
  const T = load();

  t.eq('a well-formed profile parses faction + marriage',
    JSON.stringify(T.parseAffiliationProfile({
      faction: { faction_id: 555, faction_name: 'SMTH - Phoenix Nirvana' },
      married: { spouse_id: 42 },
    })),
    JSON.stringify({ factionId: 555, factionName: 'SMTH - Phoenix Nirvana', spouseXid: 42 }));

  t.eq('no faction, no marriage reads as all-zero, not null',
    JSON.stringify(T.parseAffiliationProfile({ faction: {}, married: { spouse_id: 0 } })),
    JSON.stringify({ factionId: 0, factionName: '', spouseXid: 0 }));

  // THE FOURTH TIME a test in this repo asserted the implementation instead of
  // the requirement. It used to claim a response with NO faction/married keys
  // "still parses (fields just read 0/empty)" — which is what the code did, and
  // was wrong. During the broken-envelope era that path ran on every call, and
  // a non-null return makes fetchAffiliation stamp affilFetchedAt, so the
  // fabricated "no faction, no spouse" got cached for a full 24 hours. A live
  // scan caught it: correct field names, every seated player reading ABSENT.
  //
  // Torn returns `faction` WITH faction_id: 0 for a genuinely factionless
  // player, so the key is present either way. That is the discriminator.
  t.eq('a response with none of faction/married/player_id refuses to parse',
    T.parseAffiliationProfile({}), null);
  t.eq('and so does an unrelated object',
    T.parseAffiliationProfile({ something: 'else' }), null);

  // The real PDA envelope, which is what was actually arriving.
  t.eq('the PDA HTTP envelope refuses, rather than reading as "no faction"',
    T.parseAffiliationProfile({ status: 200, statusText: 'OK', responseText: '{}', responseHeaders: {} }),
    null);

  // A REAL profile for a factionless, unmarried player must still parse — the
  // tightened guard has to keep telling those two cases apart.
  t.eq('a genuine profile with faction_id 0 parses as "no faction"',
    JSON.stringify(T.parseAffiliationProfile({
      player_id: 311421, faction: { faction_id: 0, faction_name: '' }, married: { spouse_id: 0 },
    })),
    JSON.stringify({ factionId: 0, factionName: '', spouseXid: 0 }));
  t.eq('and player_id alone is enough to recognise a profile',
    JSON.stringify(T.parseAffiliationProfile({ player_id: 311421 })),
    JSON.stringify({ factionId: 0, factionName: '', spouseXid: 0 }));

  t.eq('null input returns null, not a throw', T.parseAffiliationProfile(null), null);
  t.eq('undefined input returns null', T.parseAffiliationProfile(undefined), null);

  // Torn's API reports a bad/rate-limited key as {"error": {...}} rather than
  // an HTTP error code — this is the one shape that must NOT be read as "no
  // faction, no marriage", since that would silently cache a false negative.
  t.eq('an API error response returns null, not a false "no affiliation"',
    T.parseAffiliationProfile({ error: { code: 2, error: 'Incorrect key' } }), null);
}

// --- affiliationFlags: pure comparison against whoever is CURRENTLY seated --

{
  const T = load();
  T.STORE = T.emptyStore();
  const mk = (xid, o) => { T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o); };

  mk('A', { factionId: 100, factionName: 'Test Faction', spouseXid: 0 });
  mk('B', { factionId: 100, factionName: 'Test Faction', spouseXid: 0 });
  mk('C', { factionId: 200, factionName: 'Other Faction', spouseXid: 0 });
  mk('D', { factionId: 0, spouseXid: 'A' });
  // A is not recorded as married to D — the check works off EITHER side's
  // spouseXid pointing at the other, so this also proves it isn't order-sensitive.

  const seated = ['A', 'B', 'C', 'D'];

  t.eq('A and B share a faction: both get the 🔗 flag',
    T.affiliationFlags('A', seated).flags, '🔗');
  t.eq('B sees the same match back', T.affiliationFlags('B', seated).flags, '🔗');
  t.eq('C shares no faction with anyone seated', T.affiliationFlags('C', seated).flags, '');
  t.ok('A\'s detail names B and the faction',
    T.affiliationFlags('A', seated).detail.indexOf('same faction') !== -1);

  t.eq('D is married to A: 💍 shows on D even though D holds the pointer, not A',
    T.affiliationFlags('D', seated).flags, '💍');
  t.ok('D\'s detail says married, not faction', T.affiliationFlags('D', seated).detail.indexOf('married') !== -1);

  // A does not carry spouseXid itself in this fixture, only D points at A —
  // the marriage is directional data (Torn reports spouse_id on the person
  // asked about), so the 💍 half only lights on the side that HAS the
  // pointer. A still shows 🔗 from the faction match with B above; the
  // assertion is that 💍 specifically is absent, not that A shows nothing.
  t.eq('A does not show 💍 back (A\'s own spouseXid was never fetched/set)',
    T.affiliationFlags('A', seated).flags.indexOf('💍'), -1);

  t.eq('a player absent from STORE.players entirely gets no flags, no throw',
    JSON.stringify(T.affiliationFlags('nobody', seated)), JSON.stringify({ flags: '', detail: '' }));

  t.eq('a player with neither factionId nor spouseXid set gets nothing',
    T.affiliationFlags('C', ['C']).flags, '');

  // Never a stored relationship: recomputing against a DIFFERENT seated list
  // changes the answer immediately, because nothing about a match is persisted.
  t.eq('A alone at a (hypothetical) table with no matching faction gets nothing',
    T.affiliationFlags('A', ['A', 'C']).flags, '');
}

// --- Both flags at once, and de-duplication -------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const mk = (xid, o) => { T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o); };
  mk('A', { factionId: 1, spouseXid: 'B' });
  mk('B', { factionId: 1, spouseXid: 0 });

  const flags = T.affiliationFlags('A', ['A', 'B']).flags;
  t.ok('both faction and marriage flags appear together', flags.indexOf('🔗') !== -1 && flags.indexOf('💍') !== -1);
  t.eq('each flag appears exactly once even though there is only one other seated player',
    flags, '🔗💍');
}

// --- refreshSeatedAffiliations: no key configured is a hard no-op ----------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.tornApiKey = '';
  // No DOM in this harness means seatedXids() already returns nothing, so the
  // real assertion is just that calling this with no key throws nothing and
  // touches no network path (there is none to stub here) before that guard.
  let threw = false;
  try { T.refreshSeatedAffiliations(); } catch (e) { threw = true; }
  t.eq('refreshSeatedAffiliations with no API key does not throw', threw, false);
}

// --- repairAffiliationCache: the poisoned 24-hour cache -------------------
//
// Fixing the parse alone was not enough. Every affilFetchedAt stamp written
// during the broken-envelope era came from a response that was never read,
// and AFFIL_REFRESH_MS is 24 HOURS — so without this the badges would stay
// dead for up to a day after the fix, reading as the fix having failed.

{
  const T = load();
  T.STORE = T.emptyStore();
  const mk = (xid, fetchedAt) => {
    T.STORE.players[xid] = T.emptyPlayer(xid, xid);
    T.STORE.players[xid].affilFetchedAt = fetchedAt;
  };
  mk('A', Date.now());
  mk('B', Date.now() - 1000);
  mk('C', 0); // never fetched — nothing to clear

  t.eq('it clears every stamped player', T.repairAffiliationCache(), 2);
  t.eq('A is cleared', T.STORE.players.A.affilFetchedAt, 0);
  t.eq('B is cleared', T.STORE.players.B.affilFetchedAt, 0);
  t.eq('C was already unstamped', T.STORE.players.C.affilFetchedAt, 0);

  // Once only: it runs from init() on every load, and re-clearing every
  // session would force a full re-fetch of every player forever.
  t.eq('a second run is a no-op', T.repairAffiliationCache(), 0);
  t.eq('and the flag records that it ran', T.STORE.affilCacheRepaired, true);

  // The player records themselves must survive — this clears a timestamp, not
  // data. Anything else would discard tracked opponents to fix a cache.
  t.ok('the player records are still there',
    !!T.STORE.players.A && !!T.STORE.players.B && !!T.STORE.players.C);
}

process.exit(t.report());
