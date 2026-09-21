// The PDA_storage availability probe.
//
// Torn PDA offers a native per-script key/value store (PDA_storage) that is
// SQLite-backed on the app side rather than the webview's localStorage. It is
// worth moving to — a near-full store here measures 2.9 MB against a ~5 MB
// localStorage budget SHARED with torn.com itself, and the native store is
// 10 MB private, user-raisable, and survives a browser-cache clear.
//
// But nobody working on this repo can run the app, so whether it is injected
// at all on the user's version is exactly the kind of question this file has
// always answered with a deep scan and a report back — same rule as any
// selector. These tests pin the probe that produces that report.
//
// The case that matters most is the THIRD state. Present/absent is easy; a
// PARTIAL injection (an older app that exposes some methods) is the one a
// plain boolean would silently read as "present" and then fail on at runtime.

const { load, runner } = require('./harness');

const t = runner('pda-storage-probe');

const FULL = {
  get: () => {}, getMany: () => {}, loadAll: () => {}, list: () => {},
  set: () => {}, setMany: () => {}, delete: () => {}, usage: () => {},
};

// --- Absent: the default, and what runs in a desktop userscript manager -----

{
  const T = load();
  t.eq('no PDA_storage global -> pdaStorage() is null', T.pdaStorage(), null);
  const lines = T.pdaStorageScanLines().join('\n');
  t.ok('scan says ABSENT', /PDA_storage: ABSENT/.test(lines));
  t.ok('scan reports BOTH probes so a report can be read literally',
    /bare identifier: undefined, window\.PDA_storage: undefined/.test(lines));
  t.ok('no method line when there is no object at all', !/methods:/.test(lines));
  t.ok('no usage line when there is nothing to ask', !/usage\(\)/.test(lines));
}

// --- Present and complete ---------------------------------------------------

{
  const T = load({ pdaStorage: FULL });
  t.ok('a complete injection is usable', T.pdaStorage() !== null);
  const lines = T.pdaStorageScanLines().join('\n');
  t.ok('scan says PRESENT', /PDA_storage: PRESENT\b/.test(lines));
  t.ok('every documented method is listed', /methods: get,getMany,loadAll,list,set,setMany,delete,usage/.test(lines));
  t.ok('nothing reported missing', !/MISSING/.test(lines));
  t.ok('usage is reported as unanswered before the async call lands',
    /usage\(\): not answered yet/.test(lines));
}

// --- Partial: the state a boolean would get wrong ---------------------------

{
  // get/set present, so pdaStorage() considers it usable — but the batch and
  // introspection methods the real migration depends on are not there.
  const T = load({ pdaStorage: { get: () => {}, set: () => {} } });
  const lines = T.pdaStorageScanLines().join('\n');
  t.ok('a partial injection still names what IS there', /methods: get,set\b/.test(lines));
  t.ok('and names every method that is NOT', /MISSING: getMany,loadAll,list,setMany,delete,usage/.test(lines));
}

{
  // No get/set at all: an object under the name that cannot serve as a store.
  // Reported as its own state, because "ABSENT" would send someone looking for
  // an app upgrade when the object is right there.
  const T = load({ pdaStorage: { list: () => {} } });
  t.eq('unusable shape is not handed back as a store', T.pdaStorage(), null);
  const lines = T.pdaStorageScanLines().join('\n');
  t.ok('reported as present-but-unusable, not as absent',
    /PRESENT BUT UNUSABLE/.test(lines));
  t.ok('and still lists what it does have', /methods: list\b/.test(lines));
}

// --- usage(): the real measurement STORAGE_QUOTA_EST has only ever guessed ---

(async () => {
  {
    const T = load({ pdaStorage: { ...FULL, usage: () => Promise.resolve({ used: 1536, quota: 10485760 }) } });
    const u = await T.probePdaStorageUsage();
    t.eq('used is captured', u.used, 1536);
    t.eq('quota is captured', u.quota, 10485760);
    const lines = T.pdaStorageScanLines().join('\n');
    t.ok('and rendered through fmtBytes, not as raw bytes',
      /usage\(\): 2 KB of 10\.0 MB/.test(lines));
  }

  {
    // A rejected promise must not escape. This is called from init(), where an
    // unhandled throw takes the rest of bootstrap with it — the exact failure
    // mode CLAUDE.md documents for a userscript.
    const T = load({ pdaStorage: { ...FULL, usage: () => Promise.reject(new Error('bridge down')) } });
    const u = await T.probePdaStorageUsage();
    t.eq('a rejection is captured, not thrown', u.error, 'bridge down');
    t.ok('and surfaced in the scan', /usage\(\): ERROR bridge down/.test(T.pdaStorageScanLines().join('\n')));
  }

  {
    // Older/partial injections could return a plain value or throw outright
    // rather than returning a promise. Both are defended, on both sides.
    const T = load({ pdaStorage: { ...FULL, usage: () => { throw new Error('sync boom'); } } });
    const u = await T.probePdaStorageUsage();
    t.eq('a synchronous throw is captured too', u.error, 'sync boom');
  }

  {
    const T = load({ pdaStorage: { ...FULL, usage: () => Promise.resolve({ nope: 1 }) } });
    const u = await T.probePdaStorageUsage();
    t.ok('an unrecognised shape is reported as such, never read as 0 bytes',
      /unrecognised shape/.test(u.error));
  }

  {
    // No usage() at all: resolves null rather than throwing, so init() is safe
    // on an app version that injects the store without the introspection call.
    const T = load({ pdaStorage: { get: () => {}, set: () => {} } });
    t.eq('missing usage() resolves null', await T.probePdaStorageUsage(), null);
  }

  {
    const T = load();
    t.eq('absent PDA_storage resolves null', await T.probePdaStorageUsage(), null);
  }

  // --- It must be found as a BARE IDENTIFIER, not only on window -------------
//
// The original probe read window.PDA_storage alone, on the reasoning that it
// is "injected as a bare global like PDA_httpGet". A live scan then reported
// ABSENT on a device where the HTTP helpers work perfectly.
//
// Torn PDA's own test script probes `typeof PDA_storage === "undefined"`, NOT
// window.PDA_storage — a strong hint it may be a scoped binding in whatever
// wrapper the app builds around a userscript. Our IIFE would reach that by
// closure while a window lookup found nothing, which is exactly the symptom.

{
  const T = load({ pdaStorageBare: FULL });
  t.ok('a store reachable only as a bare identifier is found', T.pdaStorage() !== null);
  t.ok('and pdaStorageRaw hands it back', T.pdaStorageRaw() === FULL);
  const lines = T.pdaStorageScanLines().join('\n');
  t.ok('the scan says PRESENT', /PDA_storage: PRESENT\b/.test(lines));
  t.ok('and names WHICH probe found it, so the next report settles it',
    /bare identifier: object, window\.PDA_storage: undefined/.test(lines));
}

{
  // Still found the old way, for an app build that does put it on window.
  const T = load({ pdaStorage: FULL });
  t.ok('a window property is still found', T.pdaStorage() !== null);
  t.ok('and the scan says so',
    /bare identifier: undefined, window\.PDA_storage: object/.test(T.pdaStorageScanLines().join('\n')));
}

{
  // Neither: the honest ABSENT, with both probes shown.
  const T = load();
  t.eq('neither route finds anything', T.pdaStorage(), null);
  t.ok('and both are reported',
    /ABSENT.*bare identifier: undefined, window\.PDA_storage: undefined/.test(T.pdaStorageScanLines().join('\n')));
}

process.exit(t.report());
})();
