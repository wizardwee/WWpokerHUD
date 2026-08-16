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

  process.exit(t.report());
})();
