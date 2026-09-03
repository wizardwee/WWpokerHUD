// Copy/export reliability, fixed in v1.19.0 after a live report: the Copy
// button in Settings failed outright ("failed to copy to clipboard"), and the
// "Save / share file" button flipped to "Sent" while nothing was actually
// shared.
//
// Two separate bugs, one fix each:
//
//   1. navigator.clipboard.writeText is permission-gated, and an embedding
//      app frequently never grants it — there was no fallback at all, just a
//      bare `navigator.clipboard && navigator.clipboard.writeText(text)`
//      with nothing to catch a rejection. copyText() now falls back to
//      execCommand('copy') on a real, selected textarea, which has no such
//      permission gate.
//
//   2. downloadTextFile's PDA branch called
//      window.flutter_inappwebview.callHandler('shareFile', ...) and
//      returned true IMMEDIATELY, without awaiting the Promise callHandler
//      actually returns. If Torn PDA has no 'shareFile' handler registered,
//      that promise rejects — but by then the button has already been told
//      "sent", which is exactly what was reported: the label changes, the
//      file never moves. downloadTextFile now awaits it and only reports
//      success once the call has genuinely resolved.

const { load, runner } = require('./harness');

const t = runner('clipboard-export');

(async () => {
  // --- copyText: the Clipboard API path -------------------------------------

  {
    const T = load();
    T._sandbox.window.navigator.clipboard = { writeText: () => Promise.resolve() };
    const ok = await T.copyText('hello');
    t.eq('a working Clipboard API reports success', ok, true);
  }

  // --- copyText: the execCommand fallback -----------------------------------
  // The harness's default navigator.clipboard is null (no Clipboard API at
  // all — the honest default for an embedded webview) and its default
  // document.execCommand always returns false, so these exercise the exact
  // "everything is blocked" shape reported live.

  {
    const T = load();
    const ok = await T.copyText('hello');
    t.eq('with no Clipboard API and execCommand refusing, copyText is honest about failure', ok, false);
  }

  {
    const T = load();
    T._sandbox.document.execCommand = () => true;
    const ok = await T.copyText('hello');
    t.eq('with execCommand actually working, the fallback succeeds', ok, true);
  }

  {
    // A rejecting Clipboard API (permission denied, exactly the live report)
    // must fall through to execCommand rather than propagating the rejection.
    const T = load();
    T._sandbox.window.navigator.clipboard = { writeText: () => Promise.reject(new Error('denied')) };
    T._sandbox.document.execCommand = () => true;
    let threw = false;
    let ok = false;
    try { ok = await T.copyText('hello'); } catch (e) { threw = true; }
    t.ok('a rejected clipboard write does not throw out of copyText', !threw);
    t.eq('...and still succeeds via the fallback', ok, true);
  }

  // --- copyText: existingEl -------------------------------------------------
  // Passing a visible textarea (the Backup panel's, or the deep-scan
  // report's) means the fallback selects THAT element rather than an
  // invisible one — if execCommand also fails, the text is left selected and
  // visible for a manual copy instead of vanishing into a removed node.

  {
    const T = load();
    T._sandbox.document.execCommand = () => true;
    const ta = { value: '', focus() {}, select() {}, setSelectionRange() {} };
    const ok = await T.copyText('the real export text', ta);
    t.eq('copyText succeeds against the existing element', ok, true);
    t.eq('and writes the text onto it — never trusts it already matched', ta.value, 'the real export text');
  }

  {
    // Even on total failure, the existing element is left holding (and
    // having attempted to select) the text — this is the "copy it manually"
    // fallback the button messages point the user at.
    const T = load();
    const ta = { value: '', focus() {}, select() {}, setSelectionRange() {} };
    const ok = await T.copyText('manual fallback text', ta);
    t.eq('total failure is reported honestly', ok, false);
    t.eq('but the value is still on the element for a manual copy', ta.value, 'manual fallback text');
  }

  // --- downloadTextFile: the PDA bridge, AWAITED (the actual bug) -----------

  {
    // Simulates the exact failure reported live: no 'shareFile' handler
    // registered on the Torn PDA side, so callHandler's promise rejects.
    // Before this fix, the call was fired without awaiting it, so this
    // function returned true regardless — the caller's button showed "Sent"
    // while the promise rejected invisibly moments later.
    const T = load();
    T._sandbox.window.flutter_inappwebview = {
      callHandler: () => Promise.reject(new Error("No handler registered for method 'shareFile'")),
    };
    let threw = false;
    let ok = true;
    try { ok = await T.downloadTextFile('{"a":1}', 'backup.json', 'application/json'); } catch (e) { threw = true; }
    t.ok('a rejected native handler does not throw out of downloadTextFile', !threw);
    t.eq('...and is reported as a genuine failure, not "Sent"', ok, false);
  }

  {
    // The success path: the handler exists and resolves.
    const T = load();
    let called = null;
    T._sandbox.window.flutter_inappwebview = {
      callHandler: (name, fileName, b64, mime) => {
        called = { name, fileName, mime, decoded: Buffer.from(b64, 'base64').toString('utf8') };
        return Promise.resolve();
      },
    };
    const ok = await T.downloadTextFile('{"a":1}', 'backup.json', 'application/json');
    t.eq('a resolved native handler is reported as success', ok, true);
    t.eq('the right handler name is called', called && called.name, 'shareFile');
    t.eq('the filename passes through', called && called.fileName, 'backup.json');
    t.eq('the payload round-trips through base64 intact', called && called.decoded, '{"a":1}');
  }

  {
    // Not on PDA at all (no flutter_inappwebview, no PDA_http*): falls to the
    // <a download> blob path. The harness stubs neither Blob nor URL (a real
    // browser/webview has both), so this cannot assert a successful download
    // here — only that the absence of those globals is a graceful `false`,
    // never a thrown error that would take the rest of the click handler
    // (and the "Sent ✓"/"failed" label it sets) down with it.
    const T = load();
    let threw = false;
    let ok = true;
    try { ok = await T.downloadTextFile('{"a":1}', 'backup.json', 'application/json'); } catch (e) { threw = true; }
    t.ok('no PDA bridge and no browser download APIs does not throw', !threw);
    t.eq('...it reports failure instead, so the caller can fall back to copyText', ok, false);
  }


  // --- fullHistoryExport: the raw log, for offline analysis ----------------
  //
  // The per-player export answers "how does this villain play"; this one is
  // every hand in the store as readable text, which is what was actually asked
  // for ("improve the export history or hand log for my analysis").

  {
    const T = load();
    T.STORE = T.emptyStore();
    T.heroXid = 'HERO';
    T.STORE.players.HERO = T.emptyPlayer('HERO', 'Wonkawee');
    T.STORE.players.V = T.emptyPlayer('V', 'Villain');
    T.STORE.hands = [
      { t: Date.now(), pot: 5000, street: 'flop', players: ['HERO', 'V'], winners: [], shown: {}, board: [],
        actions: [{ x: 'V', a: 'raise', s: 'preflop', amt: 900 }, { x: 'HERO', a: 'call', s: 'preflop', amt: 900 }] },
    ];
    const out = T.fullHistoryExport();
    t.ok('names itself', out.indexOf('full hand log') !== -1);
    t.ok('states the hand count', out.indexOf('1 hand(s)') !== -1);
    t.ok('renders the hand through formatHand', out.indexOf('Villain raise') !== -1);
    // Hero is the focus, so the export marks YOUR actions — this is your log,
    // not a report about one opponent.
    t.ok("marks hero's own actions", out.indexOf('*Wonkawee') !== -1);
  }

  {
    // Empty store: a header and an honest line, not a crash and not a file that
    // looks like it contains something.
    const T = load();
    T.STORE = T.emptyStore();
    const out = T.fullHistoryExport();
    t.ok('an empty store still produces a header', out.indexOf('full hand log') !== -1);
    t.ok('and says there is nothing in it', out.indexOf('(no hands recorded)') !== -1);
  }

  {
    // Hero unresolved must not print "*undefined" or mark a random seat. The
    // header says so instead — the same rule heroProblem() follows.
    const T = load();
    T.STORE = T.emptyStore();
    T.heroXid = null;
    T.STORE.hands = [{ t: Date.now(), pot: 100, street: 'preflop', players: ['V'], winners: [], shown: {}, board: [],
      actions: [{ x: 'V', a: 'raise', s: 'preflop', amt: 900 }] }];
    const out = T.fullHistoryExport();
    t.ok('says hero is not identified', out.indexOf('Hero not identified') !== -1);
    t.ok('and marks nothing as yours', out.indexOf('*') === -1);
  }

  // --- openMailto: a LINK, never the payload -------------------------------
  //
  // mailto has no attachment parameter — that is the scheme, not a webview
  // limitation — and the practical body limit is a couple of thousand
  // characters against an export that runs to hundreds of kilobytes. So "can
  // we just email it" can only ever mean "email me the link to it", which is
  // why this is wired to the gist URL and never to the export itself.

  {
    const T = load({ dom: 'class' });
    const doc = T._sandbox.document;
    // Capture the anchor before it removes itself. It has to be an ANCHOR and
    // not `location.href = ...`: setting location on a scheme the webview does
    // not handle can navigate the page away, and the page is the poker table.
    let anchor = null;
    const realCreate = doc.createElement;
    doc.createElement = (tag) => {
      const el = realCreate(tag);
      if (String(tag).toLowerCase() === 'a') anchor = el;
      return el;
    };
    const ok = T.openMailto('Subject here', 'https://gist.github.com/abc');
    doc.createElement = realCreate;

    t.eq('it reports the click was dispatched', ok, true);
    t.ok('an anchor was used, not a location assignment', !!anchor);
    t.ok('it builds a mailto: URL', String(anchor.href).indexOf('mailto:?') === 0);
    t.ok('the subject is encoded', String(anchor.href).indexOf('subject=Subject%20here') !== -1);
    t.ok('the body carries the link',
      String(anchor.href).indexOf(encodeURIComponent('https://gist.github.com/abc')) !== -1);
    // The table must survive a mail link that goes nowhere.
    t.eq('the page was never navigated', T._sandbox.window.location.pathname, '/page.php');
    t.ok('and the anchor does not linger in the DOM',
      !doc.body.children.some((c) => c === anchor));
  }

  // --- GistSync.uploadSnippet: the route that actually works ---------------
  //
  // Both other routes were reported broken on the device, and both fail INSIDE
  // the webview where there is nothing left to fall back on. A gist upload is
  // an ordinary authenticated HTTPS POST through pdaFetchJson — the one
  // transport this file has confirmed working on the phone (v1.38.0-v1.39.0).

  {
    const T = load();
    T.STORE = T.emptyStore();
    T.STORE.settings.githubToken = 'tok_abc';
    T.STORE.settings.gistId = 'THE_BACKUP_GIST';
    let sent = null;
    T._sandbox.fetch = (url, init) => {
      sent = { url, method: init.method, body: JSON.parse(init.body) };
      return Promise.resolve({
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ html_url: 'https://gist.github.com/new1' })),
      });
    };
    const url = await T.GistSync.uploadSnippet('log.txt', 'hello', 'a description');
    t.eq('the URL comes back', url, 'https://gist.github.com/new1');
    t.eq('it POSTs a NEW gist', sent && sent.method, 'POST');
    t.ok('to the gists collection, not to one gist', sent.url.slice(-6) === '/gists');
    t.eq('secret, because a hand history names real players', sent.body.public, false);
    t.eq('the content is the export', sent.body.files['log.txt'].content, 'hello');
    // THE INVARIANT. settings.gistId holds the gist this HUD syncs the whole
    // store into. Writing a hand log over it would destroy the backup it exists
    // to protect — different objects, different lifetimes, and they must never
    // share an id.
    t.eq('the backup gist id is untouched', T.STORE.settings.gistId, 'THE_BACKUP_GIST');
  }

  {
    // No token: return null rather than firing an unauthenticated request that
    // GitHub answers with a 401 the caller would then have to decode.
    const T = load();
    T.STORE = T.emptyStore();
    let called = false;
    T._sandbox.fetch = () => { called = true; return Promise.reject(new Error('should not be called')); };
    t.eq('no token means no URL', await T.GistSync.uploadSnippet('log.txt', 'hello', 'd'), null);
    t.eq('and no request at all', called, false);
  }

  {
    // A failed upload returns null rather than throwing. The caller shows a
    // message; a button that takes the panel down with it is worse than one
    // that says it could not.
    const T = load();
    T.STORE = T.emptyStore();
    T.STORE.settings.githubToken = 'tok_abc';
    T._sandbox.fetch = () => Promise.reject(new Error('network down'));
    let threw = false;
    let url = 'unset';
    try { url = await T.GistSync.uploadSnippet('log.txt', 'hello', 'd'); } catch (e) { threw = true; }
    t.eq('a network failure does not throw out', threw, false);
    t.eq('and reports no URL', url, null);
  }

  {
    // A 200 carrying no html_url (a shape change at GitHub's end) must read as
    // failure, not produce a link reading "undefined".
    const T = load();
    T.STORE = T.emptyStore();
    T.STORE.settings.githubToken = 'tok_abc';
    T._sandbox.fetch = () => Promise.resolve({ status: 200, text: () => Promise.resolve('{"id":"x"}') });
    t.eq('a response with no html_url reports no URL',
      await T.GistSync.uploadSnippet('log.txt', 'hello', 'd'), null);
  }

  process.exit(t.report());
})();
