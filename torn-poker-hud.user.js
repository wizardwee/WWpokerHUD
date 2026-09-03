// ==UserScript==
// @name         Torn Poker HUD
// @namespace    torn-poker-hud
// @version      1.55.0
// @description  Opponent tendency HUD, GTO-inspired coach prompts, per-player P/L, and tendency reports for Torn holdem, built for Torn PDA custom scripts.
// @author       wizardwee
// @license      MIT
// @match        *://www.torn.com/page.php?sid=holdem*
// @match        *://torn.com/page.php?sid=holdem*
// @updateURL    https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js
// @downloadURL  https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js
// @grant        none
// ==/UserScript==

/*
 * CHANGELOG (newest first). Bump @version above in the SAME commit as any
 * behaviour change — nothing automates it, and userscript managers compare
 * @version to decide whether an update exists. A stale value means a reinstall
 * won't see new code as newer.
 *
 * 1.55.0 - A per-hand P/L ledger that outlives the hand history cap. Asked
 *          directly: "I want the P/L ledger to persist past the hand history
 *          limit. is it possible to do that?" — designed with the user before
 *          building: grain (per-hand), cap size (20,000), reset scope (goes
 *          with everything else), export format (CSV) were all decided first.
 *            - STORE.hands keeps full detail (actions, board, players) for
 *              History, capped at historyLimit because that detail costs
 *              ~1.3KB/hand. A ledger row keeps almost nothing — timestamp,
 *              chip delta, blind level, game id — for ~35-45 bytes/entry.
 *              That buys roughly two orders of magnitude more retention at
 *              the same storage cost, which is what "past the hand history
 *              limit" actually needs.
 *            - BOUNDED, deliberately. This file already paid once for "grows
 *              with every hand forever" (STORE.players before v0.40-0.41's
 *              pruning). PL_LEDGER_CAP (20,000) tops out under 1MB — a
 *              quarter of STORAGE_QUOTA_EST — covering years of normal play.
 *              FIFO eviction, same shape as PRUNE_PLAYER_CAP/DEPARTED_MAX:
 *              the cap is what makes the ceiling unreachable.
 *            - hero.netChips/netBB remain the PERMANENT, EXACT lifetime
 *              total regardless of what has aged out of the ledger — this is
 *              a bounded audit trail layered on that number, never a
 *              replacement for it. pushLedgerEntry() is called from the exact
 *              same site in applyHandResults that already updates
 *              hero.netChips/netBB, reusing the same heroDelta/bb — never
 *              recomputed, so the two can never disagree.
 *            - Tightened to !heroUnresolved() rather than the bare `heroXid`
 *              that block was already gated on: a name: pseudo-id nets to a
 *              harmless 0 in hero.netChips (nothing in contributions/winners
 *              is keyed by a pseudo-id), which is fine as a no-op but would
 *              otherwise fill the ledger with meaningless zero rows.
 *            - NO BACKFILL. Starts empty, accrues going forward only — same
 *              "no migration needed, a missing key reads as absent"
 *              precedent as limpRaiseMade/r3/r4/lr elsewhere here.
 *            - resetProfitLoss/resetHeroStats now clear STORE.plLedger too —
 *              its rows sum to hero.netChips by construction, and leaving it
 *              behind after zeroing that total would leave a ledger whose sum
 *              silently disagreed with the number it exists to break down.
 *            - mergeStores keeps plLedger LOCAL-ONLY, same status as
 *              sessionHistory: no cross-device dedup key exists for a ledger
 *              row the way gameId serves STORE.hands, so unioning two
 *              devices' ledgers is a known gap, not solved here.
 *            - CSV export (Settings ▸ P/L ledger), through the same three-
 *              route machinery (Copy/Save/Gist+Email) every other export
 *              here now uses. The running-total column is reconstructed
 *              starting from hero.netChips MINUS the sum of rows still
 *              present, so the LAST row always lands exactly on the real
 *              lifetime total — evicted history is folded into the starting
 *              point rather than silently making the total start from 0.
 *            - 36 assertions in test/pl-ledger.test.js, checked against the
 *              old behaviour first: reverting the heroUnresolved() gate, the
 *              reset clears, or the running-total anchor each fails a
 *              specific assertion, not the whole file.
 *
 * 1.54.0 - The player Report tab and the pool-tendencies footer get the same
 *          three-route export v1.53.0 gave History and the hand log. Asked
 *          directly: "where does the analysis of pool averages or players
 *          profile exist? can we export that out too?"
 *            - Both were still on the pre-v1.53.0 path: an off-screen
 *              copyText() fallback (the same iOS selection failure History
 *              hit) and, on pool tendencies, the same overclaiming
 *              "Sent ✓" downloadTextFile result.
 *            - Both now render exportActionsHtml/wireExportActions — Copy
 *              (against a visible textarea), Save/share, and Upload to
 *              Gist + Email link, identical to History and Settings. One
 *              helper, four call sites now, so a future fix lands in all
 *              of them at once.
 *            - No new data or analysis — buildReport/buildReportSections
 *              (per-player) and poolTendencyExport/observedPoolAverages
 *              (pool-wide) already existed and already had SOME export
 *              path; this closes the gap between "has a button" and
 *              "the button works on this device."
 *            - 8 new assertions on exportActionsHtml's markup shape in
 *              test/clipboard-export.test.js. wireExportActions' click
 *              handlers run against a real DOM and are not simulated by
 *              the class-matching test stub — same limitation the stub
 *              documents for itself — so this checks the shape a renamed
 *              class would silently break instead.
 *
 * 1.53.0 - The departure pill opens again, and there is now a route for the
 *          hand log that actually leaves the phone. Both reported directly.
 *            - THE PILL BUG IS MINE, from v1.49.0. Making it draggable moved
 *              its open from a `click` handler to makeDraggable's `pointerup`,
 *              so the panel mounted BEFORE the browser dispatched that tap's
 *              compatibility click — and renderPanel's backdrop, freshly
 *              created under the finger, caught that click and closed the panel
 *              inside one frame. "Can be moved around but can't open."
 *            - The old click-only pill never hit it, because the backdrop did
 *              not exist when that event's propagation path was computed. So
 *              this is a renderPanel bug, not a pill bug: the backdrop now
 *              closes only on a click whose POINTERDOWN also landed on it,
 *              which fixes the whole class — any control opening a panel from a
 *              pointer event was otherwise swallowed the same way.
 *            - EXPORT: three routes now, because each fails differently and
 *              all of it runs inside a webview where a failed route leaves you
 *              with nothing. Shared between the History tab and Settings, so a
 *              fix lands in both.
 *            - COPY now selects a VISIBLE textarea. copyText has accepted an
 *              `existingEl` for this since v1.19.0 and the history buttons
 *              never passed one, so the fallback selected an element at
 *              left:-9999px — iOS cannot select what it has not laid out, so
 *              execCommand had nothing to copy. The failure was the off-screen
 *              element, NOT the length. A failed copy now leaves the text
 *              selected and readable for a manual long-press.
 *            - SHARE: the boolean is unchanged on purpose. Treating a null
 *              return as "handler not registered" was tried and BACKED OUT —
 *              it cannot be told apart from a registered handler returning
 *              nothing, which is what a Dart void handler does, and
 *              test/clipboard-export.test.js already pins resolve-means-sent.
 *              What changed is the CLAIM: no more "Sent ✓" as a fact, and the
 *              deep scan now reports what the bridge actually returned.
 *            - GIST is the reliable route, and the one v1.20.0 already named as
 *              the way out for a large export. GistSync.uploadSnippet() puts
 *              one text file in a NEW secret gist and hands back the URL, over
 *              pdaFetchJson — the one transport confirmed working on the phone.
 *              It must NEVER touch settings.gistId: that holds the whole-store
 *              backup, and writing a hand log over it would destroy the thing
 *              it exists to protect. Pinned by a test.
 *            - EMAIL, honestly: mailto has no attachment parameter (the scheme,
 *              not the webview) and a body limit of a couple of thousand
 *              characters against an export in the hundreds of kilobytes. So
 *              "email it" is "upload it and email the LINK", which is what the
 *              Email button does. Handed off via an anchor click, never
 *              `location.href` — setting location on an unhandled scheme can
 *              navigate the page, and the page is the table you are sitting at.
 *            - NEW: a full hand log export (Settings ▸ Hand log) — every hand
 *              in the store as readable text, hero's actions marked. The
 *              per-player export answers "how does this villain play"; this is
 *              the raw log for offline analysis, which is what was asked for.
 *              Reuses formatHand like every other rendering of a hand.
 *            - 40 assertions in test/clipboard-export.test.js and 34 in
 *              test/panel.test.js, checked against the old behaviour first —
 *              restoring the bare backdrop click handler reproduces the pill
 *              symptom exactly.
 *
 * Earlier versions: CHANGELOG.md. The full history used to sit here — 780 lines
 * of narrative above the first line of code, paid for by every read of this
 * file from the top. Three entries is enough for a fresh reader to see what
 * just changed; the archive holds the rest, and git holds it twice.
 *
 * KNOWN GAPS (reviewed, deliberately not fixed — CLAUDE.md has the reasoning,
 * and numbers the same way):
 *  3. An all-in counts as a raise in preflopRaiseEvents, so a short-stack
 *     all-in CALL can make the coach read the spot as facing a 3-bet. Fixing it
 *     needs the all-in amount compared against the current bet, which the log
 *     does not always print.
 *  5. tableMax (default 9) drives ONLY the equity quote. The preflop charts read
 *     the per-hand seat count instead, so at a 6-max table with the default left
 *     alone the equity figure reads pessimistically (quoted vs 8 opponents).
 *
 * Findings 1 (no pot cross-check) and 2 (unbounded STORE.players) were closed in
 * 0.18.0 and 0.40.0-0.41.0; 4 (calibration's refresh only arming if the setting
 * was on at load) in 1.37.0. A "KNOWN UNRESOLVED" note used to sit here claiming
 * actionButtons and the dealer button match nothing; it was stale from 0.22.0,
 * when both gained a working path, and is deleted rather than carried.
 */

/*
 * SECTION MAP — in the order they actually appear in the file. The numbering is
 * historical (it came from a design plan) and the sections are NOT in numeric
 * order; this list is the honest one, so read it top to bottom.
 *
 *   0. Shared utilities
 *   1. PDA/browser adapter shim
 *   2. Storage layer
 *   3. GitHub Gist sync (Device Flow)
 *   4. Table state capture — DOM selectors, log ingestion, hand state machine,
 *      and profit/loss attribution (there is no separate P/L section)
 *   5. Stat engine
 *   6. Archetype classifier
 *   9. GTO-inspired strategy module (preflop charts + baselines)
 *  12. Card reading, equity, position, session
 *   8. Coach prompts
 *  11. Tendency report
 *   7. HUD overlay (badges, player panel, players list, settings, calibration)
 *
 * CALIBRATION NOTE: Torn's poker page uses hashed/webpack-style CSS module
 * class names. As of 0.10.0 the selectors in SECTION 4 are calibrated against
 * real deep scans, NOT guesswork — log list, log rows, seats, seat names, fold
 * state, pot and hero cards all resolve. The exceptions are actionButtons and
 * dealerButton, which still match nothing.
 * Class names change when Torn redeploys, so if things go quiet: turn on
 * Calibration Mode (gear icon -> Calibration), run a deep scan mid-hand at a
 * live table, and adjust SELECTORS / LOG_PATTERNS from what it reports.
 */

(function () {
  'use strict';

  if (window.__tornPokerHUDLoaded) return;
  window.__tornPokerHUDLoaded = true;

  // MUST match the @version line in the userscript header above. The header is a
  // metadata comment and can't be read from JS, so this is a second place to
  // bump — it exists so a pasted deep scan says which build produced it, which
  // is otherwise unknowable when diagnosing from a phone.
  const HUD_VERSION = '1.55.0';

  // ===========================================================================
  // 0. SHARED UTILITIES
  // ===========================================================================

  // Card ranks low->high; shared by the range parser and the hand-shorthand
  // builder in the GTO module so the ordering is defined in exactly one place.
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const rankIdx = (r) => RANKS.indexOf(r);

  // Everything the HUD injects with innerHTML can contain opponent-controlled
  // text (display names) or free-text you typed (notes). Torn usernames are
  // normally alphanumeric, but a note literally containing "</textarea>" would
  // still break the panel — so escape at every interpolation into markup.
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===========================================================================
  // 1. PDA / BROWSER ADAPTER SHIM
  // ===========================================================================

  // Torn PDA is a Flutter webview, and it exposes that bridge on window. Two
  // signals rather than one: the HTTP helpers prove the userscript runtime, and
  // flutter_inappwebview proves the host app even before those are injected.
  function isPDA() {
    return typeof window.flutter_inappwebview !== 'undefined'
      || typeof window.PDA_httpGet === 'function'
      || typeof window.PDA_httpPost === 'function';
  }

  // Hand a text file to the user.
  //
  // `<a download>` silently does nothing inside PDA's webview, which is why
  // backup has only ever been copy-a-textarea. PDA exposes a native handler
  // that opens the system share sheet, so a real file can be saved or sent to
  // another app. Returns a Promise<boolean>: true if the file was handed off,
  // false if the caller should fall back to the clipboard.
  //
  // callHandler returns a Promise, and it is AWAITED here — v1.19.0 fix.
  // Before this, the call was fired and the function returned true
  // immediately, which is exactly wrong when Torn PDA has no 'shareFile'
  // handler registered at all: the promise then rejects (or the plugin
  // throws "No handler registered for method 'shareFile'"), but by the time
  // that happens this function has already told its caller "sent", and the
  // caller has already flipped the button to "Sent ✓". Reported live: the
  // button changes to "Sent" but nothing is actually shared — this is why.
  // No `<a download>` fallback is attempted after a PDA failure: it is
  // already confirmed (see above) to silently do nothing in this webview, so
  // trying it would just repeat the exact same false-positive failure mode
  // this fix exists to close. The caller falls back to copyText instead.
  // What the PDA share bridge last returned, for the deep-scan diagnostic. The
  // handler name and its contract are both unverified (see downloadTextFile),
  // and a feature that cannot say why it was quiet is undebuggable at this
  // distance — the same reasoning targetDiagnostic() exists for.
  let lastShareResult = null;

  async function downloadTextFile(text, fileName, mimeType) {
    if (isPDA() && window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
      try {
        // base64 via unescape(encodeURIComponent(...)): btoa throws on any
        // non-Latin1 character, and player names are free text.
        const b64 = btoa(unescape(encodeURIComponent(text)));
        const res = await window.flutter_inappwebview.callHandler('shareFile', fileName, b64, mimeType || 'application/json');
        // Resolving without throwing is still counted as success, and that is
        // deliberate rather than lazy.
        //
        // "The send function doesn't work" was reported live, and the obvious
        // fix — treat a null return as "handler not registered" — was tried and
        // BACKED OUT, because it cannot tell that apart from a registered
        // handler that simply returns nothing, which is what a Dart void
        // handler does. test/clipboard-export.test.js already pins the
        // resolve-means-sent case, so tightening this would have broken a path
        // that may well work in favour of a guess about a bridge nobody here
        // can call.
        //
        // What changed instead is the CLAIM: the return value is recorded for
        // the diagnostic, and the button no longer says "Sent ✓" as a fact —
        // see wireExportActions. The reliable route off the phone is the gist
        // upload, which runs over the one transport this file has confirmed.
        lastShareResult = { at: Date.now(), returned: typeof res, value: res === undefined ? 'undefined' : String(res) };
        return true;
      } catch (e) {
        lastShareResult = { at: Date.now(), returned: 'threw', value: String(e && e.message) };
        console.warn('[TornPokerHUD] PDA shareFile failed, falling back', e);
        return false;
      }
    }
    try {
      const blob = new Blob([text], { type: mimeType || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Best-effort clipboard write that does not depend on the async Clipboard
  // API being available or permitted. Reported failing outright on a real
  // Torn PDA device ("failed to copy to clipboard") — navigator.clipboard
  // exists in most webviews but writeText is gated behind a permission model
  // an embedding app frequently never wires up. execCommand('copy') is
  // deprecated but has no such permission gate: it works by actually
  // selecting real DOM text and asking the OS to copy the selection, the same
  // mechanism a manual long-press-and-copy uses — the deep-scan panel's copy
  // button already relied on exactly this before v1.19.0 generalised it here.
  //
  // `existingEl` lets a caller pass an already-visible textarea (e.g. the
  // Backup panel's) so the fallback selects the real on-screen element rather
  // than an invisible one — if execCommand ALSO fails, the text is left
  // selected and visible for a manual copy, which is strictly better than a
  // temporary off-screen element the user never sees. Returns Promise<bool>.
  async function copyText(text, existingEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // fall through to execCommand
      }
    }
    const ta = existingEl || document.createElement('textarea');
    ta.value = text; // set even on an existing element — never trust it already matches
    if (!existingEl) {
      ta.readOnly = true;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
    }
    let ok = false;
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length); // iOS needs the explicit range
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    if (!existingEl) ta.remove();
    return ok;
  }

  // Wrap a PDA_http* call — a plain (..args, callback) function — as a
  // Promise. Pulled out of pdaFetch below because GET and POST were an exact
  // copy of each other but for which function and args they called, which
  // quietly contradicted the "single place to patch" claim in pdaFetch's own
  // docstring: the real call shape would have needed patching in two places.
  // Torn PDA's PDA_httpGet/PDA_httpPost have shipped in TWO shapes: an older
  // form that takes a callback, and a newer one that returns a Promise.
  // Handling only the callback form is what silently broke every Torn API
  // feature in this file.
  //
  // Diagnosed from a live deep scan showing "apiKey set: true · successful
  // lookups: 0 · last fetch: never" AND no recorded error. Only one state
  // produces all of those at once: a promise that never settles. The old code
  // returned a Promise resolved solely from a callback passed as the last
  // argument — against the Promise-returning form that callback is never
  // invoked, the real result is dropped on the floor, and every await hangs
  // forever. No throw, no rejection, nothing to log, nothing on screen.
  //
  // Passing the callback to BOTH shapes is safe: a Promise-returning host
  // ignores the extra argument, and a callback-taking host returns undefined.
  // Whichever path produces a result first wins; `settled` makes the other a
  // no-op.
  //
  // The timeout is the other half of the fix and matters just as much. A hung
  // request must never again be indistinguishable from one that was never
  // made — that ambiguity is the entire reason this took a live scan to find.
  const PDA_CALL_TIMEOUT_MS = 15000;

  function pdaCall(fn, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(normalizePdaResponse(result));
      };
      const abort = (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      };
      timer = setTimeout(
        () => abort(new Error(`PDA request timed out after ${PDA_CALL_TIMEOUT_MS}ms`)),
        PDA_CALL_TIMEOUT_MS,
      );
      try {
        const maybe = fn(...args, finish);
        if (maybe && typeof maybe.then === 'function') maybe.then(finish, abort);
      } catch (err) {
        abort(err);
      }
    });
  }

  /**
   * Torn PDA exposes PDA_httpGet / PDA_httpPost for cross-origin requests
   * instead of fetch/XHR. Signature isn't fully documented publicly, so this
   * adapter is the single place to patch if the real call shape differs.
   * Falls back to plain fetch so the rest of the script (and Gist sync) can
   * also be exercised in a normal desktop browser during development.
   */
  async function pdaFetch(method, url, { headers = {}, body } = {}) {
    if (method === 'GET' && typeof window.PDA_httpGet === 'function') {
      return pdaCall(window.PDA_httpGet, [url, headers]);
    }
    if (method !== 'GET' && typeof window.PDA_httpPost === 'function') {
      return pdaCall(window.PDA_httpPost, [url, headers, body]);
    }

    const resp = await fetch(url, { method, headers, body });
    const text = await resp.text();
    return { status: resp.status, text };
  }

  // CONFIRMED envelope shape, from a live scan: Torn PDA hands back
  // `{status, statusText, responseText, responseHeaders}`. `responseText` is
  // the body, and it was the one field this function did not look for.
  //
  // The old fallback is what made that catastrophic rather than merely wrong.
  // With no `body` and no `text` it returned `JSON.stringify(result)` — the
  // WHOLE ENVELOPE, re-parsed downstream as if it were Torn's reply. So
  // parseTargetStatus read `json.status` (the HTTP status) as Torn's status
  // object, found no `.state` on it, and fell back to its own default of
  // 'Okay'. Every seat reported "Okay / attackable" without a single profile
  // ever having been read.
  //
  // JSON.stringify(result) is therefore GONE as a fallback. Returning
  // something shaped like a response when the body could not be found is how
  // a transport failure turns into confident wrong data three layers up; an
  // empty body makes the JSON parse fail and the caller treat it as unknown,
  // which is the honest outcome.
  function normalizePdaResponse(result) {
    if (result == null) return { status: 0, text: '' };
    if (typeof result === 'string') return { status: 200, text: result };
    const text = result.responseText != null ? result.responseText
      : (result.body != null ? result.body
        : (result.text != null ? result.text : ''));
    return { status: result.status || 200, text: String(text) };
  }

  async function pdaFetchJson(method, url, opts) {
    const { status, text } = await pdaFetch(method, url, opts);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON response */ }
    return { status, json, text };
  }

  // ===========================================================================
  // 2. STORAGE LAYER
  // ===========================================================================

  const STORAGE_KEY = 'tornPokerHUD_v1';

  // Bumped when stored data needs a one-time repair. See migrateStore().
  const STORE_VERSION = 3;

  const DEFAULT_SETTINGS = {
    minHands: 20,
    githubClientId: '',
    githubToken: '',
    gistId: '',
    lastSync: 0,
    calibrationMode: false,
    gearPos: null, // {left, top} once you've dragged the HUD button somewhere
    coachPos: null,      // {left, top} once you've dragged the coach panel
    coachSize: null,     // {w, h} once you've dragged its resize grip — the panel
                         // is meant to be parked open for a session, and one
                         // fixed size can't serve both "a thin strip out of the
                         // way" and "the whole read"
    coachPillPos: null,  // {left, top} for the collapsed pill — tracked separately
                         // from coachPos so collapsing doesn't teleport the pill
                         // to wherever the big panel happened to be parked
    coachHidden: false,  // collapsed to a pill so it stops covering the table
    showBadges: true,    // per-seat tendency labels; off = table completely clear
    historyLimit: 200, // how many recent hands to keep for the History tab
    // 'session' reads the last `sessionWindow` hands; 'lifetime' reads
    // everything. Session is the default because how someone is playing NOW
    // beats their long-run average — a nit who has just started 3-betting
    // everything is the read that matters, and a lifetime figure hides it.
    badgeMode: 'session',
    sessionWindow: 15,
    showSelfBadge: true, // badge your own seat too — see renderBadges
    badgeStats: true,  // V/P/A on the seat badge. Off leaves type + role + state
                       // emoji, which is the read; the numbers are the evidence
                       // for it and are one tap away. The escape hatch for a
                       // badge still wide enough to reach the community cards.
    showRoleBadges: true, // PFR/3B/DONK/RR chips for THIS hand — see handRoles
    turnCues: true,       // pulsing border + green gear when it's your turn
    nextToActCue: true,   // quieter amber border when you're one seat away
    // Departure watch — see noteSeatDepartures. On by default because it is
    // the whole point of the Torn API features, and it is a no-op without a
    // key. The cue/buzz/sound are separate so the alert can be softened
    // without losing the list.
    departureWatch: true,
    departureCue: true,
    // {left, top} once you've dragged the departure pill somewhere. Its own
    // key, not shared with coachPillPos: the two pills can both be on screen
    // at once, so one stored position would stack them on top of each other.
    departPillPos: null,
    departureVibrate: false, // opt-in, same as the turn cue's
    departureSound: false,   // opt-in
    turnVibrate: false, // opt-in: a short buzz on the rising edge only
    turnSound: false,   // opt-in: a synthesised two-note chime
    foldGuard: true,    // tap Fold twice to confirm — see foldGuardHandler
    heroName: '',      // YOUR Torn username. Without it P/L and position can't be attributed.
    // Monte Carlo samples per equity estimate. Exposed in Settings because
    // this is by far the most expensive thing the script does, and the phones
    // it runs on differ by an order of magnitude in how fast they get through
    // it. The work is sliced across frames so it no longer blocks the table
    // (see estimateEquitySliced), but a lower figure still makes the number
    // LAND sooner, which is what you feel on a slow device.
    //
    // 600, down from 1200 (v1.32.0) — asked for directly: approximate is fine.
    // Measured, that roughly halves the cost of every call (4 opponents:
    // 48ms -> 21ms; 8 opponents: 77ms -> 35ms) for a worst-case sampling error
    // of about +/-2 percentage points, and nearer +/-1.5 at the low equities
    // that multiway pots actually produce.
    //
    // That trade is only sound because sampling error is the SMALLER of the
    // two errors in this figure: opponents are drawn from a flat range PROXY
    // (see opponentRangeProxy), which is far coarser than anything more
    // samples could fix. Halving the samples moves the total error very
    // little. What it does NOT excuse is stating a confident call/fold verdict
    // inside the noise — see potOddsVerdict, which is the guard that makes
    // approximating here safe rather than merely cheaper.
    equityIters: 600,
    tableMax: 9,       // seats at a full table — the baseline equity is always
                       // quoted against a full ring (tableMax - 1 opponents)
    // Optional. A public-only Torn API key is enough — used solely to look up
    // faction/marriage on currently seated players (see refreshSeatedAffiliations).
    // Empty = the feature does nothing, no error, no nag. LOCAL_ONLY_SETTINGS below.
    tornApiKey: '',
    // Estimated battle stats (see the "Estimated battle stats" section below).
    // OFF by default, unlike departureWatch/affiliation above — this pulls a
    // third party's crowdsourced numbers through a third service this project
    // has no relationship with, and the integration itself is unverified.
    // Opt in deliberately; tornStatsApiKey is a SEPARATE credential from
    // tornApiKey (TornStats issues its own key) and is also
    // LOCAL_ONLY_SETTINGS below.
    battleStatsEstimate: false,
    tornStatsApiKey: '',
  };

  function emptyStore(settings) {
    return {
      version: STORE_VERSION,
      players: {},
      hands: [],   // newest-first ring buffer of recent hand records
      hero: { hands: 0, netChips: 0, netBB: 0, bbHands: 0 },
      // The CURRENT, still-open session — see touchSession/SESSION_GAP_MS.
      // vpip/pfr/aggActions/passActions are hero's own counts for THIS session
      // only, same definitions as the player-level stats (aggActions/
      // passActions specifically mirror computeRates' AFq: postflop bet+raise
      // vs call, folds and checks excluded — see the comment there for why).
      // bb is the last blind level seen this session, used to tag the session
      // by stake once archived; sessions rarely span stakes in this game, so a
      // single "last seen" value is treated as good enough rather than a full
      // per-stake breakdown.
      session: { startedAt: 0, hands: 0, net: 0, lastHandAt: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0 },
      // Archive of COMPLETED sessions, oldest first, for session-over-session
      // trend charts. Written only by archiveSession (see touchSession) and
      // capped at SESSION_HISTORY_MAX for the same reason recentTables/
      // betSizes are bounded — this is stored forever otherwise.
      sessionHistory: [],
      // Per-hand P/L ledger — see PL_LEDGER_CAP. Deliberately NOT the same
      // thing as STORE.hands: that keeps full action/board detail for a few
      // hundred hands so the History tab can render them; this keeps almost
      // nothing (a timestamp, a delta, a blind level, a game id) so it can
      // outlive that window by roughly two orders of magnitude at the same
      // storage cost. hero.netChips/netBB stay the permanent lifetime total
      // regardless of what has aged out of here — this is a bounded AUDIT
      // TRAIL layered on top of that number, not a replacement for it.
      plLedger: [],
      settings: settings || { ...DEFAULT_SETTINGS },
    };
  }

  function emptyPlayer(xid, name) {
    return {
      xid,
      name: name || ('#' + xid),
      hands: 0,
      vpip: 0,
      pfr: 0,
      threeBetMade: 0,
      foldTo3BetMade: 0,
      foldTo3BetOpp: 0,
      cbetMade: 0,
      cbetOpp: 0,
      foldToCbetMade: 0,
      foldToCbetOpp: 0,
      streetActions: {
        flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
        turn: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
        river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
      },
      // Postflop actions split by BOARD texture — see BOARD_FLAGS. Sparse on
      // purpose: a flag this player has never been observed on is absent
      // rather than a row of zeroes, because this rides on every record
      // forever (open finding #2).
      boardTex: {},
      wtsd: 0,
      // Preflop call with no raise yet. Counted per hand, and reported both
      // per-hand and as a share of VPIP — against a pool that limps ~45% of its
      // voluntary money, a habitual limper is the most exploitable seat here and
      // was previously indistinguishable from a caller.
      limpMade: 0,
      // Limped and then re-raised the SAME hand — the limp-3bet trap. Counted
      // per hand against `hands`, like limpMade. Against a pool that limps ~45%
      // of its voluntary money this is the strongest preflop signal available:
      // a habitual limper who suddenly re-raises is rarely doing it light, and
      // shownHands.lr records what they actually turned up with.
      limpRaiseMade: 0,
      // Hand class -> { seen, raised, won, r3, r4, lr }. What they have actually
      // turned up with at showdown — the only direct evidence of anyone's range.
      // Showdowns are rare, so this stays small even over thousands of hands.
      //
      // `raised` is "raised at any point preflop" and is kept as-is for the
      // existing raised/called split. r3/r4/lr are the tier breakdown added
      // later: shown down having 3-bet, 4-bet+, or limp-reraised. They are
      // written alongside `raised`, not instead of it, so old records keep
      // working and no migration is needed — a missing key reads as 0.
      shownHands: {},
      // Rolling window of the most recent hands, newest LAST. One small integer
      // per hand, used as a bitfield:
      //   bits 0-1 : 0 folded preflop, 1 played, 2 played and raised
      //   bit 2 (4): won the hand
      //
      // Deliberately not a list of hand records — this is stored for every
      // player forever, and the store already grows unboundedly (open finding
      // #2). Values written before the win bit existed are 0-2, which read
      // correctly as "did not win", so no migration is needed.
      recent: [],
      // Stack swing for the CURRENT sitting, not lifetime. Reset when the gap
      // since we last saw them exceeds a session, or when the blind level
      // changes — a low of $40M means nothing carried from a table where that
      // was a deep stack to one where it is four blinds.
      // { now, low, high, start, bb, at }
      stack: null,
      // Blind level -> hands seen at it. Bounded by the number of Torn stakes,
      // so this cannot grow without limit the way the player list can.
      tables: {},
      // The last few DISTINCT tables they were seen at, most recent first:
      // [{ bb, at }]. Consecutive hands at one table collapse into a single
      // entry whose `at` moves forward, so this records table CHANGES rather
      // than replaying the same stake three times. Capped at RECENT_TABLES_MAX.
      recentTables: [],
      // Value of `hands` the last time this player lost a big pot. "Hands ago"
      // is `hands - lastBigLossHand`, which needs no upkeep between hands.
      // -1 means never.
      lastBigLossHand: -1,
      plChipsEst: 0,
      // Same estimate as plChipsEst, in big blinds. Accumulated at hand time
      // because that is the only point the blind level is known — it cannot be
      // recovered later from plChipsEst. Starts at 0 for players tracked before
      // v0.23.0, so it lags the chip figure until they are seen again.
      plBBEst: 0,
      // Bet-as-%-of-pot, for sizing tells. betSizeCount is the LIFETIME count
      // — used for the sample-size gate and the "N bets" display. betSizes is
      // a bounded rolling window of the most recent values (see
      // BET_SIZE_HISTORY_MAX) that the sizing tell is computed from, as a
      // MEDIAN rather than a sum/count average: a single 400%-pot all-in used
      // to drag the old average up on its own, and a median barely moves for
      // one outlier sitting among the rest of the window.
      betSizeCount: 0,
      betSizes: [],
      // Bet-sizing, bluffing and slowplay split by hand strength AT THE MOMENT
      // of the action — derived only from showdowns, same evidence source and
      // same "floor on a range, never the whole of it" caveat as shownHands.
      // BLUFFS carry a caveat stronger than the usual floor, and it belongs
      // wherever bluffRate/betBluffPct is shown: a bluff that WORKS ends in a
      // fold and never reaches showdown, so this cannot merely be thin, it is
      // structurally biased low by exactly the bluffs good enough to take the
      // pot uncontested.
      //
      // drawBets/madeBets/bluffBets are bet-or-raise counts, categorised by
      // evaluate7 at showdown: madeBets = two pair or better (cat >= 2);
      // drawBets = worse than that but a flush/straight draw was live, flop or
      // turn only (the river has no draw left to hold); bluffBets = worse than
      // that with NO draw either — genuinely nothing. A lone pair with no draw
      // (cat === 1) lands in none of the three — not made by this file's own
      // bar, not zero-equity either, an honest gap left unscored rather than
      // forced into either bucket. checkMade is how often they checked when
      // they ALREADY held two pair or better instead of betting it — the
      // slowplay/trap signal.
      //
      // *Sizes (not *PctSum/*PctN) is a bounded rolling window per bucket, same
      // reasoning and same shape as betSizes: a single outsized bet must not be
      // able to drag a sum/count average around on its own, which is exactly
      // what the median of a window resists. This replaces the flagged v1.21.0
      // gap ("out of scope for THAT pass") rather than sitting inconsistently
      // beside it while adding a third bucket in the fixed shape.
      texture: {
        drawBets: 0, drawSizes: [],
        madeBets: 0, madeSizes: [],
        bluffBets: 0, bluffSizes: [],
        checkMade: 0,
      },
      notes: '',
      lastSeen: 0,
      // Cached from a Torn API profile lookup — see refreshSeatedAffiliations.
      // 0/'' means "none" AND "not fetched yet"; affilFetchedAt is what tells
      // the two apart (0 = never fetched). Small, fixed-size fields, same
      // storage profile as everything else here — no per-PAIR data is stored,
      // only per-player, so this can't grow the way a pairwise stat would.
      factionId: 0,
      factionName: '',
      spouseXid: 0,
      affilFetchedAt: 0,
    };
  }

  function loadStore() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return emptyStore();
    try {
      const parsed = JSON.parse(raw);
      parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
      parsed.players = parsed.players || {};
      parsed.hands = parsed.hands || [];
      parsed.hero = ensureHeroShape(parsed.hero);
      parsed.session = ensureSessionShape(parsed.session);
      parsed.sessionHistory = Array.isArray(parsed.sessionHistory) ? parsed.sessionHistory : [];
      parsed.plLedger = Array.isArray(parsed.plLedger) ? parsed.plLedger : [];
      normalizePlayers(parsed);
      migrateStore(parsed);
      return parsed;
    } catch (e) {
      console.warn('[TornPokerHUD] Corrupt storage, resetting.', e);
      return emptyStore();
    }
  }

  let STORE = loadStore();
  let saveScheduled = false;

  // Set when localStorage REFUSES a write, cleared when one succeeds again.
  //
  // This used to be a console.warn and nothing else, which on a phone is
  // invisible. The failure mode it hides is the worst one in the file: the HUD
  // keeps working perfectly for the rest of the session — badges, stats, coach,
  // all live off the in-memory STORE — and then everything recorded since the
  // first refusal vanishes on reload, with no symptom until it is gone.
  let saveFailure = null;

  function saveStore() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(() => {
      saveScheduled = false;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(STORE));
        if (saveFailure) { saveFailure = null; renderStorageWarning(); }
        // After the write, because the write is what made it bigger. Throttled
        // inside, and a no-op until storage is actually under pressure.
        if (maybePrune(false)) saveStore();
      } catch (e) {
        console.warn('[TornPokerHUD] Save failed', e);
        // Keep the FIRST failure's timestamp: it marks how far back the
        // in-memory-only data goes, which is what the user needs to know.
        if (!saveFailure) saveFailure = { at: Date.now(), message: (e && e.message) || String(e) };
        renderStorageWarning();
        // Emergency path: the write was REFUSED, so prune now rather than
        // waiting out the throttle, and retry. Terminates because a second
        // pass has nothing left to drop and returns false.
        if (maybePrune(true)) saveStore();
      }
    }, 250);
  }

  // Roughly what a WebView allows one origin. NOT a quota read — the Storage
  // Manager API is absent in the PDA webview, so there is no way to ask. Used
  // only to render a proportion and to warn early; never to gate a write, since
  // guessing low would refuse data that would have fitted.
  const STORAGE_QUOTA_EST = 5 * 1024 * 1024;
  const STORAGE_WARN_PCT = 75;

  function storageStats() {
    let chars = 0;
    try { chars = (localStorage.getItem(STORAGE_KEY) || '').length; } catch (e) { /* unreadable */ }
    const players = Object.keys((STORE && STORE.players) || {}).length;
    return {
      // Browsers charge localStorage in UTF-16 code units, which is what
      // String#length reports — so this is the figure the quota actually sees,
      // and it is ~1 byte per character for the ASCII this store is mostly of.
      chars,
      players,
      hands: ((STORE && STORE.hands) || []).length,
      pct: (100 * chars) / STORAGE_QUOTA_EST,
      perPlayer: players ? chars / players : 0,
      failed: !!saveFailure,
      level: saveFailure ? 'bad' : ((100 * chars) / STORAGE_QUOTA_EST >= STORAGE_WARN_PCT ? 'warn' : 'ok'),
    };
  }

  function fmtBytes(n) {
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return Math.round(n) + ' B';
  }

  // --- Pruning ---------------------------------------------------------------
  //
  // The shape here follows from a measurement, not a preference. A fresh
  // one-hand player record is 562 bytes; a five-hundred-hand one is 1,076. A
  // thin record therefore costs HALF what a thick one does for essentially none
  // of the value — under `minHands` classify() returns "Unrated" anyway, and
  // shrinkage pulls a three-hand player to the pool average regardless.
  //
  // So thin goes before old. Age is the tiebreaker, never the lead: a weekly
  // regular with 400 hands against them is worth far more than yesterday's
  // one-hand stranger, and a flat age rule deletes exactly the wrong one.
  //
  // The LRU cap is the only part that is an INVARIANT rather than a heuristic.
  // "Delete old things and hope" bounds nothing; "the store cannot hold more
  // than PRUNE_PLAYER_CAP players" does, and it is what makes the ceiling
  // unreachable rather than merely further off.
  const PRUNE_THIN_HANDS = 10;   // below this the record has never produced a read
  const PRUNE_THIN_DAYS = 30;
  const PRUNE_MAX_DAYS = 180;    // any sample: a read this old has decayed anyway
  const PRUNE_PLAYER_CAP = 2000; // ~1.6MB of players, plus a capped 266KB history
  // The check reads the whole stored string, so it is throttled rather than run
  // on every debounced save.
  const PRUNE_MIN_INTERVAL_MS = 60 * 1000;

  // Returns a report; does not save. Callers decide when to persist.
  function prunePlayers(now) {
    const t = now || Date.now();
    const players = (STORE && STORE.players) || {};
    const day = 24 * 60 * 60 * 1000;
    const r = { at: t, thin: 0, stale: 0, lru: 0, dropped: 0, kept: 0 };
    const drop = (xid, bucket) => { delete players[xid]; r[bucket] += 1; r.dropped += 1; };

    Object.keys(players).forEach((xid) => {
      const p = players[xid];
      if (!p) { delete players[xid]; return; }
      // Hero's own record is never a candidate — it holds your own tendencies
      // and the coach reads it.
      if (isHeroRecord(xid)) return;
      // A missing lastSeen is an UNKNOWN age, not an infinite one. Imported
      // records and anything written before lastSeen was maintained land here,
      // and reading epoch-0 as "very old" would let a gist import delete a
      // year of good data on the first save after it. Stamp it and let the
      // next prune judge it against a real timestamp.
      if (!p.lastSeen) { p.lastSeen = t; return; }
      const age = t - p.lastSeen;
      if ((p.hands || 0) < PRUNE_THIN_HANDS && age > PRUNE_THIN_DAYS * day) { drop(xid, 'thin'); return; }
      if (age > PRUNE_MAX_DAYS * day) drop(xid, 'stale');
    });

    // The backstop, oldest first. Hero is excluded from the candidate list, so
    // the cap is really "cap + you".
    const left = Object.keys(players).filter((xid) => !isHeroRecord(xid));
    if (left.length > PRUNE_PLAYER_CAP) {
      left.sort((a, b) => (players[a].lastSeen || 0) - (players[b].lastSeen || 0));
      left.slice(0, left.length - PRUNE_PLAYER_CAP).forEach((xid) => drop(xid, 'lru'));
    }
    r.kept = Object.keys(players).length;
    return r;
  }

  let lastPruneCheck = 0;

  // Runs off the back of a save, never on its own timer: writing is the only
  // thing that makes the store bigger.
  //
  // `force` skips the throttle and the pressure test, for the case where a save
  // has actually been refused. It cannot loop: a second pass finds nothing to
  // drop, returns false, and the caller stops re-saving.
  //
  // Returns true when something was dropped, i.e. when a re-save is worth it.
  function maybePrune(force) {
    const now = Date.now();
    // Throttle first, deliberately: the pressure test below reads the entire
    // stored string, which is not something to do on every debounced write.
    if (!force && now - lastPruneCheck < PRUNE_MIN_INTERVAL_MS) return false;
    lastPruneCheck = now;
    if (!force && storageStats().pct < STORAGE_WARN_PCT) return false;
    const r = prunePlayers(now);
    if (!r.dropped) return false;
    // Persisted so it survives a reload — "we dropped 2,900 records last
    // Tuesday" is exactly the kind of thing that must not be deniable.
    STORE.lastPrune = r;
    return true;
  }

  // The hero record gains fields too, and `hero || {...}` only helps when it is
  // absent entirely — a store from 0.22.0 has {hands, netChips} and would leave
  // netBB undefined, which turns every += into NaN and poisons the figure
  // permanently. Backfill each key instead.
  function ensureHeroShape(hero) {
    const h = hero && typeof hero === 'object' ? hero : {};
    const t = { hands: 0, netChips: 0, netBB: 0, bbHands: 0 };
    Object.keys(t).forEach((k) => { if (typeof h[k] !== 'number' || isNaN(h[k])) h[k] = t[k]; });
    // Hero's own XID, remembered across page loads — NOT a number, so it is
    // deliberately outside the numeric backfill above.
    //
    // Identity is normally read off the live `self___` seat marker, which only
    // exists while you are actually sitting down. Away from a seat that lookup
    // falls through to the "name:<username>" pseudo-id, heroUnresolved() goes
    // true, and everything gated on isHeroRecord quietly disappears — the
    // Trends tab is not rendered at all, your own record shows Exploit instead
    // of Leaks, and Settings' "View my stats" returns early on a dead tap. So
    // your own stats were unreachable exactly when you were not playing.
    //
    // Torn XIDs are permanent, so once a seat has told us who you are that
    // answer stays good. Cleared wherever the configured username changes,
    // since that is the one thing that means "different person".
    if (typeof h.xid !== 'string' || !h.xid || h.xid.startsWith('name:')) h.xid = null;
    return h;
  }

  // Same idea as ensureHeroShape, for STORE.session — a store written before
  // the session-trends fields existed has {startedAt, hands, net, lastHandAt}
  // only, and incrementing an undefined vpip/pfr/aggActions/passActions/bb
  // would poison it with NaN on the very next hand.
  function ensureSessionShape(session) {
    const s = session && typeof session === 'object' ? session : {};
    const t = { startedAt: 0, hands: 0, net: 0, lastHandAt: 0, vpip: 0, pfr: 0, aggActions: 0, passActions: 0, bb: 0 };
    Object.keys(t).forEach((k) => { if (typeof s[k] !== 'number' || isNaN(s[k])) s[k] = t[k]; });
    return s;
  }

  // Records written by an older version lack fields added since; backfill from
  // the template so new stats don't surface as NaN on long-tracked players.
  function ensurePlayerShape(p, xid) {
    const t = emptyPlayer(xid, p.name);
    Object.keys(t).forEach((k) => { if (p[k] === undefined) p[k] = t[k]; });
    // streetActions is nested, and a top-level backfill won't repair a record
    // that HAS the object but is missing a street inside it — computeRates reads
    // p.streetActions.flop.bet unguarded, so a hand-edited or partially-merged
    // import would throw there and take the whole panel down with it.
    Object.keys(t.streetActions).forEach((street) => {
      if (!p.streetActions[street] || typeof p.streetActions[street] !== 'object') {
        p.streetActions[street] = { ...t.streetActions[street] };
      } else {
        Object.keys(t.streetActions[street]).forEach((act) => {
          if (typeof p.streetActions[street][act] !== 'number') p.streetActions[street][act] = 0;
        });
      }
    });
    // Same reasoning for texture: a record written before v1.29.0 has drawBets/
    // madeBets/checkMade but the OLD drawPctSum/drawPctN/madePctSum/madePctN
    // shape, not drawSizes/madeSizes/bluffBets/bluffSizes. Backfilling only
    // top-level-missing keys would leave those old fields sitting there unused
    // (harmless — same as betSizePctSum's own leftover after v1.21.0) while
    // computeRates reads the NEW array fields as undefined. This adds what is
    // missing without touching what a hand-edited or partially-merged import
    // already has right.
    if (!p.texture || typeof p.texture !== 'object') {
      p.texture = { ...t.texture, drawSizes: [], madeSizes: [], bluffSizes: [] };
    } else {
      ['drawBets', 'madeBets', 'bluffBets', 'checkMade'].forEach((k) => {
        if (typeof p.texture[k] !== 'number') p.texture[k] = 0;
      });
      ['drawSizes', 'madeSizes', 'bluffSizes'].forEach((k) => {
        if (!Array.isArray(p.texture[k])) p.texture[k] = [];
      });
    }
    return p;
  }

  // One-time repairs to stored data, keyed off `version`. Runs at load and after
  // an import, on the parsed object BEFORE it becomes STORE.
  //
  // Deliberately does NOT call saveStore(): at load time this runs inside
  // loadStore(), before `saveScheduled` is initialised, so touching it would
  // throw on the temporal dead zone. Every migration must therefore be
  // idempotent — if the page closes before the next natural save, it simply runs
  // again on the following load.
  //
  // Schema 2 (v0.20.0): P/L was frozen at zero for any session where heroXid
  // latched onto a "name:<username>" pseudo-id. heroDelta evaluated to 0, so
  // every attributed share was `0 * weight` and hero.netChips never moved. There
  // is no way to rebuild the real figures — STORE.hands is a capped ring buffer
  // and holds only a slice of what was played — so wipe P/L and let it
  // reaccumulate. Hand counts, VPIP/PFR and the other rate stats were never
  // touched by that bug, so they are kept.
  //
  // Schema 3 (v1.4.0): remove the player records the winner-line misparse
  // invented. See LOG_PATTERNS — "Bauderix won $28,500,000 Did not show hand"
  // matched the `shows` pattern, so the whole clause was handed to
  // nameToXidGuess as a username and came back as a pseudo-id that logAction
  // then counted as a player dealt into the hand.
  function migrateStore(store) {
    const from = store.version || 1;
    if (from >= STORE_VERSION) return;

    // EVERY block below must be gated on `from`. This one used to run
    // unconditionally, which meant the next bump of STORE_VERSION — this one —
    // would have re-zeroed the P/L of every store that had already migrated,
    // destroying good data as a side effect of an unrelated schema change.
    if (from < 2) {
      Object.keys(store.players || {}).forEach((xid) => {
        if (store.players[xid]) store.players[xid].plChipsEst = 0;
      });
      store.hero.netChips = 0;
      store.session.net = 0;
    }

    if (from < 3) {
      // Only pseudo-ids whose name is NOT a valid username are dropped. A real
      // player first seen before their seat rendered also gets a `name:` key,
      // holds a legitimate username, and is merged later by noteResolvedName —
      // those must survive, so this cannot simply delete every `name:` key.
      //
      // The pattern is inlined rather than using USERNAME_RE: migrateStore runs
      // from loadStore() at `let STORE = loadStore()`, which evaluates long
      // before USERNAME_RE is initialised further down the file. Referencing it
      // here throws a temporal-dead-zone ReferenceError at load — which, in a
      // userscript, means nothing runs at all. Keep it a literal.
      Object.keys(store.players || {}).forEach((key) => {
        if (key.indexOf('name:') !== 0) return;
        if (!/^[A-Za-z0-9_\-]{1,20}$/.test(key.slice(5))) delete store.players[key];
      });
    }

    store.version = STORE_VERSION;
  }

  // Repair every record once, at load and after an import. getPlayer() also
  // repairs on access, but it is NOT the only reader — renderBadges and the
  // players list read STORE.players[xid] straight out of the object, so a
  // malformed record reaching computeRates would throw there instead.
  function normalizePlayers(store) {
    Object.keys(store.players || {}).forEach((xid) => {
      const p = store.players[xid];
      if (!p || typeof p !== 'object') { delete store.players[xid]; return; }
      ensurePlayerShape(p, xid);
    });
  }

  function getPlayer(xid, name) {
    if (!STORE.players[xid]) STORE.players[xid] = emptyPlayer(xid, name);
    else ensurePlayerShape(STORE.players[xid], xid);
    if (name) STORE.players[xid].name = name;
    STORE.players[xid].lastSeen = Date.now();
    return STORE.players[xid];
  }

  // Credentials must never leave this device. exportJson() feeds BOTH the
  // user-facing Copy button and the Gist upload, so anything left in here would
  // be written into the gist and into any exported JSON that gets pasted
  // somewhere public. Strip secrets at the single choke point.
  const LOCAL_ONLY_SETTINGS = ['githubToken', 'tornApiKey', 'tornStatsApiKey'];

  function sanitizedStore() {
    const settings = { ...STORE.settings };
    LOCAL_ONLY_SETTINGS.forEach((k) => { delete settings[k]; });
    return { ...STORE, settings };
  }

  function exportJson() {
    return JSON.stringify(sanitizedStore(), null, 2);
  }

  function importJson(text) {
    const parsed = JSON.parse(text);
    // Keep this device's own credentials — an import is data, not a re-auth.
    const preserved = {};
    LOCAL_ONLY_SETTINGS.forEach((k) => { preserved[k] = STORE.settings[k]; });
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}), ...preserved };
    parsed.players = parsed.players || {};
    parsed.hands = parsed.hands || [];
    parsed.hero = ensureHeroShape(parsed.hero);
    parsed.session = ensureSessionShape(parsed.session);
    parsed.sessionHistory = Array.isArray(parsed.sessionHistory) ? parsed.sessionHistory : [];
    parsed.plLedger = Array.isArray(parsed.plLedger) ? parsed.plLedger : [];
    normalizePlayers(parsed); // imported JSON is hand-editable and often stale
    migrateStore(parsed);     // a backup taken before 0.20.0 carries frozen P/L
    STORE = parsed;
    saveStore();
  }

  function resetAllData() {
    STORE = emptyStore({ ...STORE.settings });
    saveStore();
  }

  // Zero every profit/loss figure and NOTHING else.
  //
  // P/L is the one number that can be wrong on its own: an unsettled hand or a
  // parse gap corrupts the money while hand counts, rates, showdown ranges and
  // history stay perfectly good. Schema 2's migration wiped exactly these
  // fields for exactly this reason — "Reset all data" to fix a money figure
  // throws away the expensive data to repair the cheap one.
  //
  // Chips and BB are cleared together, always. Leaving one would leave the
  // Stats tab quoting two disagreeing results for the same player.
  function resetProfitLoss() {
    Object.keys(STORE.players || {}).forEach((xid) => {
      const p = STORE.players[xid];
      if (!p) return;
      p.plChipsEst = 0;
      p.plBBEst = 0;
    });
    STORE.hero.netChips = 0;
    STORE.hero.netBB = 0;
    STORE.hero.bbHands = 0;
    STORE.session.net = 0;
    // The ledger's rows sum to hero.netChips by construction (see
    // pushLedgerEntry's call site) — leaving it behind after zeroing that
    // total would leave a ledger whose sum silently disagreed with the very
    // number it exists to break down.
    STORE.plLedger = [];
    saveStore();
  }

  // Reset HERO's own numbers, leaving every opponent untouched.
  //
  // Clears TWO records deliberately. If name resolution ever failed, hero's
  // actions accrued to a `name:<username>` pseudo-record while `hands` accrued
  // to the real seat record — and that split is precisely what makes your own
  // VPIP read low while everyone else's looks right. Resetting one and not the
  // other would leave the wrong half in place and the symptom unchanged. The
  // pseudo-record is deleted rather than emptied: it should not exist at all,
  // and an empty one would just be pruned later as a mystery.
  //
  // Hand HISTORY is deliberately not touched. Those hands are shared with every
  // opponent in them, so discarding 500 hands that still describe everybody
  // else in order to reset one player's counters is a bad trade.
  function resetHeroStats() {
    if (!heroUnresolved() && heroXid && STORE.players[heroXid]) {
      STORE.players[heroXid] = emptyPlayer(heroXid, STORE.players[heroXid].name);
    }
    const uname = (STORE.settings.heroName || '').trim();
    if (uname && STORE.players['name:' + uname]) delete STORE.players['name:' + uname];
    // Identity is carried over, not reset: this clears your STATS, it does not
    // make you a different player. Dropping it here would silently un-reach
    // your own Stats and Trends until the next time you sat down at a table.
    STORE.hero = { hands: 0, netChips: 0, netBB: 0, bbHands: 0, xid: STORE.hero && STORE.hero.xid };
    STORE.session.hands = 0;
    STORE.session.net = 0;
    STORE.session.vpip = 0;
    STORE.session.pfr = 0;
    STORE.session.aggActions = 0;
    STORE.session.passActions = 0;
    // sessionHistory is 100% hero data (every field describes hero's own
    // play), unlike hand HISTORY above which stays because it still describes
    // opponents too — so it gets the same clean-slate treatment as STORE.hero,
    // for the same reason: a split-identity or misattributed period should not
    // linger in the Trends chart after the counters that caused it are fixed.
    STORE.sessionHistory = [];
    // Same reasoning again: the ledger is 100% hero data too, and its rows sum
    // to the hero.netChips this function just zeroed.
    STORE.plLedger = [];
    saveStore();
  }

  // Merge remote + local: per player, keep whichever record has more observed hands.
  function mergeStores(local, remote) {
    const merged = {
      version: 1,
      players: { ...local.players },
      hands: mergeHands(local.hands || [], remote.hands || [], local.settings.historyLimit),
      hero: local.hero,
      session: local.session, // session is per-device; never taken from remote
      // Same call as session, for the same reason: a "session" is a physical
      // sitting at THIS device. Unioning two devices' histories would need a
      // real dedup key (nothing here identifies "the same session" across
      // devices the way an xid does for a player), so this stays local-only
      // rather than risk a merged chart with duplicated or interleaved
      // sessions. A real cross-device merge is a known gap, not solved here.
      sessionHistory: local.sessionHistory,
      // Same call as sessionHistory, for the same reason: a "session" (or a
      // per-hand ledger row) is tied to a physical sitting at THIS device.
      // Unioning two devices' ledgers would need a real cross-device dedup
      // key — gameId alone isn't enough here the way it is for STORE.hands,
      // because a ledger row carries no way to tell "the same hand, recorded
      // twice" from "two different hands that happen to share no id" once
      // gameId is null on an older record. A real cross-device merge is a
      // known gap, not solved here — same status as sessionHistory's.
      plLedger: local.plLedger,
      settings: local.settings,
    };
    for (const xid of Object.keys(remote.players || {})) {
      const remotePlayer = remote.players[xid];
      const localPlayer = merged.players[xid];
      if (!localPlayer || (remotePlayer.hands || 0) > (localPlayer.hands || 0)) {
        merged.players[xid] = remotePlayer;
      }
    }
    if (remote.hero && (remote.hero.hands || 0) > (local.hero.hands || 0)) {
      merged.hero = remote.hero;
    }
    return merged;
  }

  // Hands are immutable once written, so a union deduped per hand is safe — this
  // keeps history from both devices rather than letting one overwrite.
  //
  // Prefer Torn's own game id: two devices at the same table record the SAME
  // hand at different local timestamps, so a timestamp key let every shared hand
  // through twice. Fall back to timestamp+pot for records written before hands
  // carried an id.
  // trimHandHistory rather than a flat slice, so a notable hand (big pot, big
  // preflop raise — see isNotableHand) pinned on one device survives an import
  // from another the same way it survives the normal recording path. A plain
  // slice(0, limit) here would silently unpin nothing — the field would still
  // say `pinned: true`, but a hand past `limit` gets cut regardless of it.
  function mergeHands(a, b, limit) {
    const seen = new Set();
    const merged = a.concat(b)
      .filter((h) => {
        if (!h) return false;
        const k = h.g ? 'g:' + h.g : 't:' + h.t + ':' + (h.pot || 0);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => y.t - x.t);
    return trimHandHistory(merged, limit || 200, HISTORY_PINNED_CEILING);
  }

  // ===========================================================================
  // 3. GITHUB GIST SYNC (Device Flow)
  // ===========================================================================

  const GIST_FILENAME = 'torn-poker-hud-data.json';
  const GITHUB_API = 'https://api.github.com';

  const GistSync = {
    status: 'idle', // idle | waiting-for-user | polling | connected | error
    userCode: null,
    verificationUri: null,
    error: null,

    async startDeviceFlow() {
      const clientId = STORE.settings.githubClientId;
      if (!clientId) { this.status = 'error'; this.error = 'No GitHub Client ID set.'; renderSettingsPanel(); return; }

      this.status = 'waiting-for-user';
      renderSettingsPanel();

      const { json } = await pdaFetchJson('POST', 'https://github.com/login/device/code', {
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${encodeURIComponent(clientId)}&scope=gist`,
      });

      if (!json || !json.device_code) {
        this.status = 'error';
        this.error = 'Could not start device flow (check Client ID / Device Flow enabled on the OAuth App).';
        renderSettingsPanel();
        return;
      }

      this.userCode = json.user_code;
      this.verificationUri = json.verification_uri;
      renderSettingsPanel();

      this.status = 'polling';
      const intervalMs = (json.interval || 5) * 1000;
      const deviceCode = json.device_code;

      const poll = async () => {
        if (this.status !== 'polling') return;
        const { json: tokenJson } = await pdaFetchJson('POST', 'https://github.com/login/oauth/access_token', {
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `client_id=${encodeURIComponent(clientId)}&device_code=${encodeURIComponent(deviceCode)}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
        });

        if (tokenJson && tokenJson.access_token) {
          STORE.settings.githubToken = tokenJson.access_token;
          this.status = 'connected';
          saveStore();
          renderSettingsPanel();
          await this.syncNow();
          return;
        }

        if (tokenJson && (tokenJson.error === 'authorization_pending' || tokenJson.error === 'slow_down')) {
          setTimeout(poll, intervalMs);
          return;
        }

        this.status = 'error';
        this.error = (tokenJson && tokenJson.error_description) || 'Authorization failed or expired.';
        renderSettingsPanel();
      };

      setTimeout(poll, intervalMs);
    },

    authHeaders() {
      return {
        Authorization: `token ${STORE.settings.githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      };
    },

    async syncNow() {
      if (!STORE.settings.githubToken) return;
      try {
        if (!STORE.settings.gistId) {
          await this.createGist();
        } else {
          await this.pullAndMerge();
          await this.pushGist();
        }
        STORE.settings.lastSync = Date.now();
        saveStore();
        renderSettingsPanel();
      } catch (e) {
        console.warn('[TornPokerHUD] Gist sync failed', e);
        this.status = 'error';
        this.error = 'Sync failed: ' + e.message;
        renderSettingsPanel();
      }
    },

    async createGist() {
      const { json } = await pdaFetchJson('POST', `${GITHUB_API}/gists`, {
        headers: this.authHeaders(),
        body: JSON.stringify({
          description: 'Torn Poker HUD data',
          public: false,
          files: { [GIST_FILENAME]: { content: exportJson() } },
        }),
      });
      if (json && json.id) STORE.settings.gistId = json.id;
    },

    async pullAndMerge() {
      const { json } = await pdaFetchJson('GET', `${GITHUB_API}/gists/${STORE.settings.gistId}`, {
        headers: this.authHeaders(),
      });
      const file = json && json.files && json.files[GIST_FILENAME];
      if (!file || !file.content) return;
      try {
        const remote = JSON.parse(file.content);
        STORE = mergeStores(STORE, remote);
      } catch (e) { /* ignore malformed remote content */ }
    },

    async pushGist() {
      await pdaFetchJson('PATCH', `${GITHUB_API}/gists/${STORE.settings.gistId}`, {
        headers: this.authHeaders(),
        body: JSON.stringify({ files: { [GIST_FILENAME]: { content: exportJson() } } }),
      });
    },

    // Put one text file in a NEW secret gist and hand back its URL.
    //
    // This is the reliable way off the phone. Both existing routes were
    // reported broken — the clipboard (a permission an embedding app often
    // never wires up) and the share sheet (a bridge handler that may not be
    // registered at all) — and both fail INSIDE the webview, where there is
    // nothing to fall back on. A gist upload is an ordinary authenticated HTTPS
    // POST through pdaFetchJson, which is the one transport this file has
    // confirmed working on the device (v1.38.0-v1.39.0).
    //
    // A NEW gist every time, and never STORE.settings.gistId: that one holds
    // the backup this HUD syncs, and writing a hand history over it would
    // destroy the store it is meant to protect. They are different objects with
    // different lifetimes and must not share an id.
    //
    // Secret (public: false), because a hand history names real players.
    // Returns the html_url, or null — callers must handle null rather than
    // showing a link that is not there.
    async uploadSnippet(fileName, content, description) {
      if (!STORE.settings.githubToken) return null;
      try {
        const { json } = await pdaFetchJson('POST', `${GITHUB_API}/gists`, {
          headers: this.authHeaders(),
          body: JSON.stringify({
            description: description || 'Torn Poker HUD export',
            public: false,
            files: { [fileName]: { content } },
          }),
        });
        return (json && json.html_url) || null;
      } catch (e) {
        console.warn('[TornPokerHUD] gist upload failed', e);
        return null;
      }
    },
  };

  // --- Shared-affiliation lookup (faction / marriage) -------------------------
  //
  // A behavioural collusion detector (raise-pattern squeezes, pairwise soft
  // play) needs pairwise stats maintained for every pair that's ever shared a
  // table — the exact O(n²) growth shape open finding #2 already burned this
  // file on once (STORE.players itself, closed in v0.40-0.41). This is the
  // cheaper alternative: faction and marriage are objective facts Torn's own
  // API already knows, not an inferred pattern, and the result is cached PER
  // PLAYER (factionId, spouseXid — a handful of scalars), not per pair. The
  // "do two players match" check itself is computed fresh at render time from
  // whoever is CURRENTLY seated, never stored — so there is no relationship
  // state to grow at all, unlike the whipsaw/soft-play designs this replaced.
  //
  // UNCONFIRMED: the v1 `selections=profile` field names below (faction.
  // faction_id/faction_name, married.spouse_id) are written from the
  // documented Torn API v1 shape, not a live response — nobody working on
  // this holds an API key to check one. Same rule as every DOM selector in
  // this file: verify against a real response before trusting it fully, and
  // report back what actually came back. parseAffiliationProfile fails
  // defensively (returns nulls) on anything it doesn't recognise rather than
  // throwing, so a wrong guess here costs a missing badge, not a crash.
  function parseAffiliationProfile(json) {
    if (!json || json.error) return null;
    // THE SAME DANGEROUS DEFAULT parseTargetStatus carried, one function over,
    // and it survived v1.40.0's fix because only the other one was looked at.
    //
    // This used to read `json.faction || {}` and manufacture
    // {factionId: 0, factionName: '', spouseXid: 0} out of a response it had
    // never understood. During the broken-envelope era that happened on EVERY
    // call — and because a non-null return makes fetchAffiliation stamp
    // affilFetchedAt, the fabricated "no faction, no spouse" was then cached
    // for AFFIL_REFRESH_MS, a full 24 hours. A live scan caught it: the field
    // names were right all along (faction{faction_id,faction_name,...},
    // married{spouse_id,...}) while every seated player read ABSENT.
    //
    // The discriminator is that Torn returns `faction` WITH faction_id: 0 for
    // a genuinely factionless player, so the key is present either way. A
    // response carrying none of faction / married / player_id is not a profile
    // at all, and refusing it is the difference between "read a profile, they
    // have no faction" and "never read a profile".
    const looksLikeProfile = Object.prototype.hasOwnProperty.call(json, 'faction')
      || Object.prototype.hasOwnProperty.call(json, 'married')
      || Object.prototype.hasOwnProperty.call(json, 'player_id');
    if (!looksLikeProfile) return null;
    const faction = json.faction || {};
    const married = json.married || {};
    return {
      factionId: faction.faction_id || 0,
      factionName: faction.faction_name || '',
      spouseXid: married.spouse_id || 0,
    };
  }

  // Faction/marriage don't change hand to hand — a day between refetches keeps
  // this to a handful of calls per session instead of one per seat per tick.
  const AFFIL_REFRESH_MS = 24 * 60 * 60 * 1000;

  // One-time repair: discard affiliation timestamps written while the
  // transport was broken.
  //
  // Fixing the parse is not enough on its own. Every affilFetchedAt stamp
  // predating v1.42.0 was written from a response that was never actually
  // read, and AFFIL_REFRESH_MS is 24 HOURS — so without this the badges stay
  // dead for up to a day after the fix lands, which would read as the fix
  // having failed. Clearing the stamp forces one re-fetch per seated player;
  // the stored fields are left alone because they are all zeros anyway and
  // affiliationFlags already shows nothing for a player with neither a
  // factionId nor a spouseXid, so behaviour is identical until the real data
  // arrives.
  //
  // Runs from init(), NOT migrateStore — the documented way to break this
  // script at load is to touch anything declared later from inside
  // loadStore(). Same placement as backfillBoardTexture, and made safe by the
  // STORE flag rather than by being idempotent.
  function repairAffiliationCache() {
    if (STORE.affilCacheRepaired) return 0;
    let cleared = 0;
    Object.keys(STORE.players).forEach((xid) => {
      const p = STORE.players[xid];
      if (p && p.affilFetchedAt) { p.affilFetchedAt = 0; cleared++; }
    });
    STORE.affilCacheRepaired = true;
    saveStore();
    return cleared;
  }

  async function fetchAffiliation(xid) {
    const key = (STORE.settings.tornApiKey || '').trim();
    if (!key) return; // no key configured — the whole feature is a no-op
    try {
      const { json } = await pdaFetchJson('GET',
        `https://api.torn.com/user/${xid}?selections=profile&key=${encodeURIComponent(key)}`);
      const parsed = parseAffiliationProfile(json);
      if (!parsed) return; // bad key, rate-limited, unknown id — try again next window
      const p = getPlayer(xid);
      p.factionId = parsed.factionId;
      p.factionName = parsed.factionName;
      p.spouseXid = parsed.spouseXid;
      p.affilFetchedAt = Date.now();
      saveStore();
    } catch (e) {
      // Network hiccup. Never blocks anything — just try again next window.
    }
  }

  // Refreshes affiliation data for currently seated opponents whose cache is
  // missing or stale. Called from the same 3s watcher tick as harvestSeatNames
  // — cheap enough to run there, and the staleness guard (AFFIL_REFRESH_MS)
  // means a fetch only actually fires once a day per player, not once a tick.
  function refreshSeatedAffiliations() {
    if (!(STORE.settings.tornApiKey || '').trim()) return;
    // includeSittingOut: renderBadges checks a sitting-out seat's data too
    // (they're still physically at the table) — fetching only for active
    // seats would leave an AFK player's cache permanently empty.
    seatedXids({ includeSittingOut: true }).forEach((xid) => {
      if (isHeroRecord(xid)) return; // hero's own affiliation isn't the question
      const p = STORE.players[xid];
      const stale = !p || !p.affilFetchedAt || (Date.now() - p.affilFetchedAt) > AFFIL_REFRESH_MS;
      if (stale) fetchAffiliation(xid);
    });
  }

  // Which shared-affiliation emoji (if any) apply to `xid`, checked against
  // every OTHER currently-seated xid — never stored, recomputed each render.
  // `detail` names who and what, for the badge tooltip; both stay empty when
  // neither field has been fetched yet (or no key is configured at all).
  function affiliationFlags(xid, seatedList) {
    const p = STORE.players[xid];
    if (!p || (!p.factionId && !p.spouseXid)) return { flags: '', detail: '' };
    let flags = '';
    const details = [];
    seatedList.forEach((other) => {
      if (String(other) === String(xid)) return;
      const o = STORE.players[other];
      if (!o) return;
      if (p.factionId && o.factionId && p.factionId === o.factionId) {
        flags = flags.indexOf('🔗') === -1 ? flags + '🔗' : flags;
        details.push(`same faction as ${playerDisplayName(other)} (${p.factionName || 'faction #' + p.factionId})`);
      }
      if (p.spouseXid && String(p.spouseXid) === String(other)) {
        flags = flags.indexOf('💍') === -1 ? flags + '💍' : flags;
        details.push(`married to ${playerDisplayName(other)}`);
      }
    });
    return { flags, detail: details.join('; ') };
  }

  // Target status — "can I actually hit this seat once they leave the table".
  // Reuses the same endpoint and the same Torn API key as the affiliation
  // lookup above, but NOTHING else about it: faction/marriage are slow facts
  // worth caching for a day, this can flip in seconds, so a value more than
  // TARGET_REFRESH_MS old is actively misleading rather than merely stale.
  // Deliberately kept OUT of STORE.players — never written to a player record
  // and never persisted to localStorage, only held in this in-memory Map, so
  // a session left open overnight can't show a hospital stay from yesterday
  // as current. That also keeps it out of Backup/Gist exports for free.
  //
  // v1.30.0 read only the hospital flag, which reported a FACT without ever
  // connecting it to the decision it exists for. Being in hospital is not
  // trivia about an opponent, it is the reason an attack won't land — and it
  // is one of several such reasons, each lasting a different length of time.
  // Reading only hospital meant a player in jail or overseas showed nothing
  // at all and looked like a clear target.
  //
  // UNCONFIRMED, same caveat as parseAffiliationProfile just above: these v1
  // `status` / `level` fields are written from Torn's documented API shape,
  // not a live response anyone working on this has seen. A wrong guess costs
  // a missing read, not a crash — see the defensive handling throughout.
  function parseTargetStatus(json) {
    if (!json || json.error) return null;
    const status = json.status || {};
    // NO DEFAULT TO 'Okay'. That default was the hole.
    //
    // When the transport handed back the wrong object (see
    // normalizePdaResponse), `status.state` was undefined on every response —
    // and this manufactured a green light out of it. A live scan showed five
    // seats all reading "Okay / attackable" without a single profile ever
    // having been read.
    //
    // v1.33.0's asymmetry — unknown is never "go" — was written for an
    // UNRECOGNISED state and simply did not cover a MISSING one. Absence of a
    // state is the least evidence there is, so it has to produce the least
    // conclusive answer rather than the most reassuring one. Refusing the
    // whole parse sends it down the same path as a bad key: not cached,
    // surfaced in the diagnostic, and read as unknown by attackReadiness.
    if (typeof status.state !== 'string' || !status.state) return null;
    return {
      state: status.state,
      // Torn's own human-readable line ("In hospital for 10 minutes",
      // "Travelling to Mexico"). Shown verbatim in the tooltip rather than
      // parsed — it is the one field guaranteed to describe whatever Torn
      // actually means, including states this file has never heard of.
      description: status.description || '',
      until: Number(status.until) || 0,
      level: Number(json.level) || 0,
    };
  }

  // States that block an attack outright. Each is a different wait: a hospital
  // stay is minutes, a flight is a fixed leg, federal jail can be days.
  //
  // 'Okay' is the ONLY state treated as clear. Anything unrecognised is
  // reported as unknown rather than assumed attackable — a new or renamed
  // Torn state must not silently read as "go", because that is the direction
  // that wastes an attack. Same principle as parseAffiliationProfile refusing
  // to read an error response as "no faction".
  const ATTACK_BLOCKERS = {
    Hospital: { emoji: '🏥', label: 'in hospital' },
    Jail: { emoji: '🚔', label: 'in jail' },
    Traveling: { emoji: '✈️', label: 'travelling' },
    Travelling: { emoji: '✈️', label: 'travelling' }, // both spellings, see below
    Abroad: { emoji: '🌍', label: 'abroad' },
    Federal: { emoji: '🚫', label: 'in federal jail' },
  };

  // Which spelling Torn returns for the in-flight state is not confirmed from
  // a live response, and the two are one letter apart. Both are listed above
  // rather than guessing, because guessing wrong here fails in the dangerous
  // direction: an unrecognised state that happens to be a real blocker.

  // Returns { ready, blocked, unknown, emoji, label, until }.
  //
  // `ready` is only ever true for a state this file positively recognises as
  // clear. `unknown` is its own answer, distinct from both — the UI says so
  // rather than picking a side.
  function attackReadiness(status) {
    if (!status) return { ready: false, blocked: false, unknown: true, emoji: '', label: 'not checked yet', until: 0 };
    const state = status.state || '';
    const blocker = ATTACK_BLOCKERS[state];
    if (blocker) {
      // An expired `until` means the stay is over and Torn simply hasn't been
      // re-asked. Treat that as clear rather than reporting a wait that has
      // already elapsed — the cache is at most TARGET_REFRESH_MS stale.
      const stillIn = !status.until || status.until * 1000 > Date.now();
      if (!stillIn) return { ready: true, blocked: false, unknown: false, emoji: '', label: 'attackable', until: 0 };
      return { ready: false, blocked: true, unknown: false, emoji: blocker.emoji, label: blocker.label, until: status.until };
    }
    if (state === 'Okay') {
      return { ready: true, blocked: false, unknown: false, emoji: '', label: 'attackable', until: 0 };
    }
    return { ready: false, blocked: false, unknown: true, emoji: '❔', label: state ? `unrecognised state "${state}"` : 'unknown', until: 0 };
  }

  // (v1.30.0's isHospitalized was removed here rather than kept "for
  // clarity": once the badge moved to attackReadiness nothing called it, and
  // test/no-orphans.test.js is what caught that. A hospital-only helper
  // sitting beside a general one is also an invitation to reintroduce the
  // exact narrowness this release exists to fix.)

  // Minutes:seconds is overkill for a "can I hit them" read — whole minutes,
  // rounded up so it never reads "0m" while still technically inside.
  function fmtStatusRemaining(until) {
    const ms = until * 1000 - Date.now();
    if (ms <= 0) return 'due out';
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  }

  // --- API probes: one shape for every keyed lookup (v1.48.0) --------------
  //
  // Every API-backed feature here needs the same five counters and the same
  // "explain your own silence" diagnostic, for the same reason: nobody
  // working on this can see the screen it runs on, so a feature that shows
  // nothing has to be able to say WHY. v1.34.0 built that for target status
  // after a live report of exactly that failure ("I don't see anything"),
  // and v1.47.0 copied the whole apparatus verbatim for the spy lookup —
  // ten parallel module-level `let`s in two identical sets, two identical
  // diagnostics, two identical fetch bodies.
  //
  // Copying it a THIRD time is what this exists to stop. The counters and
  // the diagnostic wording are the part that must never drift between
  // features: a diagnostic that reads differently for two lookups failing
  // the same way is worse than no diagnostic, because it implies a
  // distinction that isn't there.
  //
  // Deliberately NOT folded in: fetchAffiliation. It carries no counters at
  // all, and writes to STORE.players rather than to a Map — forcing it
  // through this would mean inventing state it doesn't have, which is the
  // "one abstraction too far" that makes a shared helper worse than the
  // duplication it replaced.
  function apiProbe(noLookupHint) {
    return {
      lastError: '',
      lastFetchAt: 0,
      okCount: 0,
      // Counted BEFORE the await, where lastFetchAt is only set after it.
      // The gap between the two is the diagnosis: "started 3, completed 0"
      // is a request that is hanging, "started 0" is one that was never
      // made. Not being able to tell those apart is what made the pdaCall
      // hang (v1.38.0) take a live deep scan to find.
      fetchStarted: 0,
      // TOP-LEVEL KEY NAMES from the last successful response — names only,
      // never values, because the deep scan gets pasted into chats.
      // Recorded because the v1.38.0 scan showed every cached entry with
      // level=0 while status.state parsed correctly: the response IS the
      // profile shape and `level` simply is not where parseTargetStatus
      // looks. Guessing a second field name blind is what produced the
      // first wrong guess; this makes the next scan answer it.
      lastKeys: '',
      // `gate` is whatever must be true before a lookup is even attempted
      // (a key, a toggle) — returns its own message, or '' to carry on.
      // Passed in rather than baked here because each feature is switched
      // off in a different way, and naming the exact Settings section is
      // most of what makes the message actionable.
      diagnostic(gate) {
        const blocked = gate ? gate() : '';
        if (blocked) return blocked;
        if (this.lastError) return this.lastError;
        if (this.fetchStarted && !this.lastFetchAt) {
          return `${this.fetchStarted} lookup(s) started but none have come back yet — `
            + 'if this persists, the request is hanging rather than failing.';
        }
        if (!this.lastFetchAt) return noLookupHint;
        return '';
      },
    };
  }

  // Shared body for a keyed, cached, single-player lookup. The differences
  // between two such fetches are all data: where to GET, how the service
  // words a refusal, how to read the reply, and where the result lands.
  //
  // `apiError` matters more than it looks: both services answer an auth
  // failure or a rate limit with HTTP 200 and an error BODY, so this is the
  // only place either can be noticed. Recording the message is what turns
  // "nothing is showing" into "Incorrect key".
  async function probeFetch(probe, { url, apiError, parse, cache, xid, unreachable }) {
    probe.fetchStarted++;
    try {
      const { json } = await pdaFetchJson('GET', url);
      probe.lastFetchAt = Date.now();
      const apiMsg = apiError ? apiError(json) : '';
      if (apiMsg) { probe.lastError = apiMsg; return; }
      const parsed = parse(json);
      if (!parsed) { probe.lastError = 'unrecognised API response shape'; return; }
      probe.lastError = '';
      probe.okCount++;
      try { probe.lastKeys = json ? Object.keys(json).join(',') : '(empty)'; } catch (e) { probe.lastKeys = '(unreadable)'; }
      cache.set(String(xid), Object.assign({}, parsed, { fetchedAt: Date.now() }));
      return json;
    } catch (e) {
      probe.lastError = unreachable;
    }
  }

  const targetCache = new Map(); // xid (string) -> { ...status, fetchedAt }
  const TARGET_REFRESH_MS = 30 * 1000;
  const targetProbe = apiProbe('No lookup has run yet — sit at a table with other players.');
  // NESTED key names under faction/married, from the same response. The
  // affiliation badges (v1.8.0) read faction.faction_id / faction.faction_name
  // / married.spouse_id, and those names have never been checked against a
  // real reply — the envelope bug meant no reply was ever read at all. The
  // v1.40.0 scan proved `faction` and `married` EXIST at top level; this says
  // what is inside them. Names only, never values: a faction name is fine but
  // a scan gets pasted into chats, so the rule stays absolute.
  //
  // Not part of the probe: it is captured from the target-status response but
  // describes a DIFFERENT feature's field names, and belongs to neither
  // cleanly. Left as the one-off it is rather than given a home it doesn't fit.
  let affilLastKeys = '';

  const tornApiKey = () => (STORE.settings.tornApiKey || '').trim();

  async function fetchTargetStatus(xid) {
    const key = tornApiKey();
    if (!key) return; // no key configured — the whole feature is a no-op
    const json = await probeFetch(targetProbe, {
      xid,
      url: `https://api.torn.com/user/${xid}?selections=profile&key=${encodeURIComponent(key)}`,
      apiError: (j) => (j && j.error ? 'Torn API: ' + (j.error.error || 'error code ' + j.error.code) : ''),
      parse: parseTargetStatus,
      cache: targetCache,
      unreachable: 'could not reach api.torn.com',
    });
    // Affiliation sub-keys ride along on the same response — see affilLastKeys
    // above for why they are captured here and kept out of the probe. Only on
    // a successful parse: probeFetch returns the body only when it cached one,
    // so a refused or unparseable reply can never overwrite good field names
    // with '(absent)'.
    if (!json) return;
    try {
      const fk = json.faction && typeof json.faction === 'object' ? Object.keys(json.faction).join(',') : '(absent)';
      const mk = json.married && typeof json.married === 'object' ? Object.keys(json.married).join(',') : '(absent)';
      affilLastKeys = `faction{${fk}} married{${mk}}`;
    } catch (e) { /* names are a diagnostic, never worth throwing over */ }
  }

  // Why the target feature is showing nothing — '' when it is actually working.
  //
  // v1.30.0-v1.33.0 failed SILENTLY in every mode: no key, a wrong key, a rate
  // limit, a network error and "nobody at this table is blocked" all looked
  // identical from the outside, which is exactly how it came back as a report
  // ("I don't see anything"). A feature whose field names are still unverified
  // MUST be able to say why it is quiet — nobody working on this can see the
  // screen it runs on, so silence that has five possible causes is undebuggable
  // at a distance. Same reasoning as heroProblem(), for the same class of bug.
  function targetDiagnostic() {
    return targetProbe.diagnostic(() => (tornApiKey()
      ? '' : 'No Torn API key set — Settings → Torn API features. Without one this does nothing.'));
  }

  // --- Departure watch (v1.43.0) -------------------------------------------
  //
  // "If I see a player who is not in hospital suddenly leave the table, this is
  // a trigger for me to attack. When the player leaves his info is gone and I
  // can't click into him."
  //
  // That last part is the whole problem: the seat is the only handle on a
  // player, and it vanishes at the exact moment they become worth attacking.
  // Everything needed to keep the handle alive is already here though — the
  // seat sweep knows who WAS seated, targetCache knows whether they were
  // attackable, STORE.players knows their name, and attackUrl needs nothing
  // but the xid. So the fix is to notice the disappearance and hold onto what
  // we already had.
  //
  // Runtime only, deliberately. A departure is worth acting on for minutes,
  // and a list of stale targets surviving a page reload would invite acting on
  // information that has since gone cold.
  const DEPARTED_WATCH_MS = 5 * 60 * 1000;
  const DEPARTED_MAX = 12;
  let departedWatch = new Map(); // xid -> { xid, name, leftAt, wasReady, alerted, dismissed }
  let lastSeatedSnapshot = null; // null = never populated; [] is a REAL empty table

  // Departures are computed by diffing successive seat sweeps, which means
  // every false positive comes from the sweep momentarily reading empty or
  // short. Two guards, and they matter more than the feature:
  //
  //   1. A sweep that returns NOTHING is never treated as everyone leaving.
  //      The table re-renders, the SPA swaps nodes, the page is backgrounded —
  //      all of which briefly match no seats. Reporting eight departures at
  //      once because a render blinked would be worse than reporting none.
  //   2. A player must be missing from TWO consecutive sweeps before counting.
  //      One frame of absence is a re-render; two three seconds apart is
  //      somebody who left.
  let pendingDepartures = new Map(); // xid -> first tick they went missing

  // Guard 3, and the reason for it: moving to another table is indistinguishable
  // from the whole roster walking out. Reported directly — "it should NOT
  // mistakenly count players in when I move tables. currently all the players
  // on the old table are shown as '8 left'."
  //
  // Guards 1 and 2 do not catch it. A table change is not an unreadable sweep
  // (guard 1) and the old roster stays missing for every sweep after (guard 2),
  // so both are satisfied and the entire old table fires as departures.
  //
  // There is no table identity in this layout to key off — nobody working on
  // this can inspect the DOM, so a marker cannot be confirmed and one that is
  // merely assumed would fail silently. What CAN be relied on is the shape of
  // the event: at a live table people leave one at a time, and three vanishing
  // inside one 3s sweep is a roster being replaced, not three decisions to
  // stand up. So the rule is a cap on how many departures one sweep may report.
  //
  // Deliberately asymmetric, same principle as attackReadiness: the cost of
  // being wrong here is one missed alert on a table that genuinely broke up.
  // The cost of not having it is eight false targets every time you sit down
  // somewhere else, which is the complaint.
  const DEPARTURE_BURST_MAX = 2;

  // Guard 4. A stakes change is a table change with no ambiguity at all, so it
  // does not have to be inferred from the roster — noteBlindLevel already
  // notices it (that is what nulls currentTableBB). Complements guard 3 rather
  // than replacing it: this one is certain but only fires on a CROSS-STAKE
  // move, and Torn runs more than one table at several blind levels.
  //
  // Already-watched departures are deliberately NOT cleared. Somebody who left
  // the old table a minute before you did is still sitting out there
  // attackable; the move does not make them less of a target. What is dropped
  // is only the in-flight suspicion about players who are "missing" because you
  // are the one who left.
  function noteTableChange() {
    pendingDepartures.clear();
    lastSeatedSnapshot = null; // the next readable sweep becomes a fresh baseline
  }

  // Takes the seated list rather than reading it, so the diff — which is all
  // the logic here — is drivable without a DOM. Same split shouldEscalateTurnCue
  // already uses, and it was not optional: the first version read seatedXids()
  // itself, and the test that "covered" it stubbed the seam export. That does
  // not rebind the module's own function (CLAUDE.md records the same trap for
  // STORE and heroXid), so every assertion passed against an inert DOM
  // returning no seats and Guard 1 swallowing the lot. Vacuous, and green.
  function noteSeatDepartures(seatedList) {
    const seatedNow = Array.from(seatedList || seatedXids({ includeSittingOut: true }));

    // Guard 1. An empty sweep says nothing about who left; it says the table
    // is not readable right now. Do not diff against it, and do not let it
    // become the baseline either.
    if (!seatedNow.length) return [];

    const prev = lastSeatedSnapshot;
    lastSeatedSnapshot = seatedNow;
    if (!prev) return []; // first readable sweep: nothing to compare against

    const nowSet = new Set(seatedNow.map(String));
    const fired = [];

    // Anyone previously seated and no longer there becomes a CANDIDATE.
    const gone = prev.filter((xid) => !nowSet.has(String(xid)) && !isHeroRecord(xid));

    // Guard 3. Too many at once is a roster change, not a set of departures —
    // see DEPARTURE_BURST_MAX. The pending set is cleared as well as the batch
    // dropped, because a table swap frequently renders in two steps (a couple
    // of seats blank, then the rest) and the stragglers armed by the first step
    // would otherwise fire on their own two sweeps later, which is the same bug
    // arriving late.
    if (gone.length > DEPARTURE_BURST_MAX) {
      // Only the pending set, not the snapshot — this sweep IS readable, and
      // it is the new roster, so it stays the baseline the next one diffs
      // against. (noteTableChange, which guard 4 uses, also nulls the snapshot;
      // it has no sweep in hand to replace it with.)
      pendingDepartures.clear();
      return [];
    }

    gone.forEach((xid) => {
      const key = String(xid);
      if (departedWatch.has(key)) return;
      if (!pendingDepartures.has(key)) pendingDepartures.set(key, 0);
    });

    // Guard 2 is counted over the PENDING set, not over `prev`. That
    // distinction is the whole guard: a player missing from sweep N is also
    // absent from sweep N+1's `prev` — which IS sweep N — so a version that
    // looked for them there again could never reach a second miss and would
    // never fire at all. Found by a test, after an earlier version of that
    // test stubbed the seam and passed vacuously against an inert DOM.
    Array.from(pendingDepartures.keys()).forEach((key) => {
      if (nowSet.has(key)) { pendingDepartures.delete(key); return; } // came back
      const misses = pendingDepartures.get(key) + 1;
      pendingDepartures.set(key, misses);
      if (misses < 2) return;
      pendingDepartures.delete(key);
      if (departedWatch.has(key)) return;

      const xid = key;
      const status = targetStatusFor(xid);
      const readiness = attackReadiness(status);
      departedWatch.set(key, {
        xid: key,
        name: playerDisplayName(xid),
        leftAt: Date.now(),
        // Snapshot of what we knew AS THEY LEFT. The live status keeps being
        // refreshed afterwards (see refreshDepartedTargetStatus), so the panel
        // shows current truth — this only decides whether to raise the alarm.
        wasReady: readiness.ready,
        alerted: false,
        dismissed: false,
      });
      fired.push(key);
    });

    // Oldest first, so a busy table cannot grow this without bound.
    while (departedWatch.size > DEPARTED_MAX) {
      departedWatch.delete(departedWatch.keys().next().value);
    }
    return fired;
  }

  // Live entries: not expired, not dismissed. Expiry is by wall clock rather
  // than a timer so it is correct after the phone sleeps.
  function departedList() {
    const out = [];
    departedWatch.forEach((e) => {
      if (e.dismissed) return;
      if (Date.now() - e.leftAt > DEPARTED_WATCH_MS) return;
      const status = targetStatusFor(e.xid);
      // Read-only lookup, not getPlayer(): this renders on every panel tick,
      // and getPlayer() bumps lastSeen on every call — a departed player's
      // stack would otherwise keep pruning as "recently seen" just because
      // the panel stayed open. trackStacks() already froze `.stack.now` at
      // whatever they last showed while seated, which is exactly "what they
      // walked away with" — the figure that matters for deciding whether
      // they're worth the trip.
      const rec = STORE.players[e.xid];
      const stack = rec && rec.stack && rec.stack.now > 0 ? rec.stack.now : 0;
      out.push(Object.assign({}, e, {
        readiness: attackReadiness(status),
        level: status && status.level > 0 ? status.level : 0,
        stack,
        agoMs: Date.now() - e.leftAt,
      }));
    });
    return out.sort((a, b) => b.leftAt - a.leftAt);
  }

  // Only entries that should raise the alarm: someone we positively knew was
  // attackable when they left. A player who was in hospital, or who was never
  // checked, still appears in the list — but does not buzz, flash or count
  // toward the pill. Same asymmetry as attackReadiness: unknown is never "go".
  function departedAlertable() {
    return departedList().filter((e) => e.wasReady && !e.readiness.blocked);
  }

  // A distinct chime from the turn cue: FALLING rather than rising, so it can
  // never be mistaken for "it's your turn" while you are mid-decision. Same
  // reasoning the escalation chime follows — reuse the shape, change the
  // meaning audibly.
  function playDepartureChime() {
    return playChimeNotes([[1320, 0], [880, 0.11]]);
  }

  // The screen cue for a departure. Amber, brief, and — like every overlay in
  // this file — pointer-events: none. That rule is absolute: one tap swallowed
  // on Fold or Call is worse than any cue is good, and this one fires while
  // you may well be mid-hand.
  const DEPARTURE_FLASH_MS = 2600;
  function flashDepartureCue() {
    if (!STORE.settings.departureCue) return;
    document.querySelectorAll('.tph-depart-glow').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'tph-depart-glow';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), DEPARTURE_FLASH_MS);
  }

  // Fired once per departure, never per tick — `alerted` is the latch. A cue
  // that repeats every 3s until dismissed would be the exact thing CLAUDE.md
  // warns about: something competing with the table for your attention.
  function alertDepartures(firedXids) {
    if (!STORE.settings.departureWatch) return;
    let any = false;
    firedXids.forEach((xid) => {
      const e = departedWatch.get(String(xid));
      if (!e || e.alerted || !e.wasReady) return;
      e.alerted = true;
      any = true;
    });
    if (!any) return;
    flashDepartureCue();
    if (STORE.settings.departureVibrate && navigator.vibrate) {
      try { navigator.vibrate([90, 60, 90]); } catch (e) { /* not supported here */ }
    }
    if (STORE.settings.departureSound) playDepartureChime();
    renderDepartedPill();
    renderDepartedPanel();
  }

  function dismissDeparture(xid) {
    const e = departedWatch.get(String(xid));
    if (e) e.dismissed = true;
    renderDepartedPanel();
    renderDepartedPill();
  }

  function clearDepartures() {
    departedWatch.forEach((e) => { e.dismissed = true; });
    renderDepartedPanel();
    renderDepartedPill();
  }

  // Keep checking the ones we are watching. A player who left attackable and
  // has since been hospitalised by somebody else must stop reading as a target
  // — that is the difference between a live list and a stale one.
  function refreshDepartedTargetStatus() {
    departedList().forEach((e) => { requestTargetStatus(e.xid); requestSpyStats(e.xid); });
  }

  // A `name:<username>` record for HERO, left over from before hero was bound
  // to a seat.
  //
  // Two live scans a session apart showed it frozen at 7 hands while hero's
  // real record moved 8911 -> 8924. That is the proof v1.38.0 stopped the
  // leak: it no longer grows. What it still does is sit in STORE.players,
  // skewing observedPoolAverages and occupying a prune slot.
  //
  // DROPPED, never merged. mergePseudoPlayer deliberately bails when the real
  // record already exists, and for good reason — hands and dealtInXids were
  // always counted through the seat path, so folding the ghost in would
  // double-count them. Its handful of log-derived stats are already orphaned
  // from the hands they describe; discarding them loses nothing that was not
  // already wrong.
  //
  // Guarded on the REAL record existing, so this can never delete the only
  // copy of hero's data.
  function dropStaleHeroGhost() {
    if (heroUnresolved()) return false;
    const uname = (STORE.settings.heroName || '').trim();
    if (!uname || !STORE.players[heroXid]) return false;
    const target = ('name:' + uname).toLowerCase();
    let dropped = false;
    Object.keys(STORE.players).forEach((k) => {
      if (k.toLowerCase() === target) { delete STORE.players[k]; dropped = true; }
    });
    if (dropped) saveStore();
    return dropped;
  }

  function targetStatusFor(xid) {
    return targetCache.get(String(xid)) || null;
  }

  // Torn's own attack URL. A LINK, never a click: CLAUDE.md's rule is that
  // this HUD is advisory and must never act for the user, and that applies to
  // the game's own controls most of all. The tap is always theirs.
  function attackUrl(xid) {
    return `https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(xid)}`;
  }

  function profileUrl(xid) {
    return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(xid)}`;
  }

  // The panel's target block: status, level, and the attack link.
  //
  // Unlike the seat badge this shows whatever the cache holds regardless of
  // whether the seat is sitting out right now — the panel is opened
  // deliberately rather than glanced at mid-hand. It says so, because this
  // HUD only ever fetches while a seat IS sitting out, so a player who has
  // been back in the action for a while is showing their last sit-out read,
  // not a live one.
  //
  // The attack link is shown whichever way the status reads. Offering it only
  // when "ready" would be trusting a figure that is up to TARGET_REFRESH_MS
  // stale, fetched only during sit-outs, and resting on unconfirmed field
  // names — the status is a steer, and the decision stays the user's.
  function playerTargetLine(xid) {
    const status = targetStatusFor(xid);
    const r = attackReadiness(status);
    const ageS = status ? Math.round((Date.now() - status.fetchedAt) / 1000) : 0;

    let text;
    let cls;
    if (!status) {
      cls = 'tph-target-unknown';
      text = (STORE.settings.tornApiKey || '').trim()
        ? 'Status not checked yet — read for players at your table, so it fills in once they are seated.'
        : 'Status not checked — needs a Torn API key (Settings → Torn API features).';
    } else if (r.blocked) {
      cls = 'tph-target-blocked';
      text = `${r.emoji} Can't attack — ${escapeHtml(r.label)}`
        + (r.until ? `, ${escapeHtml(fmtStatusRemaining(r.until))} left` : '') + '.';
    } else if (r.unknown) {
      cls = 'tph-target-unknown';
      text = `❔ Can't tell — ${escapeHtml(r.label)}.`;
    } else {
      cls = 'tph-target-ready';
      text = '🎯 Attackable.';
    }

    const meta = [];
    // Only when we actually have one. "level 0" is not a level, it is the
    // absence of one, and printing it asserts a fact the API never returned.
    if (status && status.level > 0) meta.push(`level ${status.level}`);
    if (status) meta.push(`checked ${ageS < 60 ? `${ageS}s` : `${Math.round(ageS / 60)}m`} ago`);

    return `<div class="tph-target ${cls}" title="${escapeHtml(status && status.description ? status.description : '')}">
      <span class="tph-target-txt">${text}</span>
      ${meta.length ? `<span class="tph-target-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
      <a class="tph-attack-link" href="${attackUrl(xid)}" target="_blank" rel="noopener">Attack ↗</a>
    </div>`;
  }

  // Every seated opponent, not just the ones sitting out.
  //
  // v1.30.0-v1.33.0 fetched ONLY for sitting-out seats, reasoning from the
  // original framing ("ready to mug them when they sit out"). That was too
  // clever by half: sitting out is a RARE state, so most of the time nothing
  // was ever fetched, the cache stayed empty, and the whole feature showed
  // nothing at all. Reported as exactly that — "I don't see anything or badges
  // on their hospital status."
  //
  // Cost is not the reason to be narrow here. At a full table this is 8
  // opponents on a 30s staleness gate — about 16 calls a minute against Torn's
  // 100/min limit, with the 3s watcher tick only firing a request when an
  // entry is actually stale. Knowing which seats are viable targets BEFORE one
  // of them stands up is also the more useful read.
  // One player, fetched only if nothing fresh is cached. The staleness gate
  // lives here rather than at each call site so every caller — the seated
  // sweep, and opening a panel — shares one definition of "fresh enough".
  function requestTargetStatus(xid) {
    if (!(STORE.settings.tornApiKey || '').trim()) return;
    if (!xid || isHeroRecord(xid)) return; // hero's own status isn't the question
    const cached = targetCache.get(String(xid));
    if (cached && (Date.now() - cached.fetchedAt) <= TARGET_REFRESH_MS) return;
    fetchTargetStatus(xid);
  }

  function refreshSeatedTargetStatus() {
    if (!(STORE.settings.tornApiKey || '').trim()) return;
    seatedXids({ includeSittingOut: true }).forEach(requestTargetStatus);
  }

  // --- Estimated battle stats (v1.47.0) -------------------------------------
  //
  // Torn's own API refuses this outright: `selections=battlestats` only ever
  // returns the KEY OWNER'S OWN stats, never a third party's, at any access
  // level. There is no way to read another player's strength/defense/speed/
  // dexterity from Torn directly — a platform limit, not something fixable
  // here. Asked for directly right after the departure panel's chips landed,
  // as the natural next question: could battle stats be added the same way.
  //
  // What third-party spy sites (TornStats, YATA) provide instead is a
  // CROWDSOURCED ESTIMATE — other players' own in-game "spy" results on a
  // target, pooled and served back. This wires in TornStats specifically:
  // one TornStats-issued API key, versus YATA's linked Torn+YATA key pair —
  // simpler to authenticate, and neither is more "correct" than the other,
  // since both are reading the same underlying spy reports.
  //
  // UNCONFIRMED, more so than anything else in this file. Every other
  // "unverified" integration here (Torn's own affiliation/target-status
  // calls) was at least checked against Torn's PUBLISHED documentation
  // before shipping. This one could not be: this environment's network
  // egress is blocked to both tornstats.com and yata.yt outright, so the
  // field names below (spy.strength/defense/speed/dexterity/total/timestamp)
  // are written from memory of TornStats' documented v2 shape, not a
  // fetched doc and not a live response. parseSpyStats fails defensively to
  // null on anything it doesn't recognise — same discipline as
  // parseAffiliationProfile and parseTargetStatus — so a wrong guess costs a
  // missing read, not a crash. This needs a report from someone holding a
  // real TornStats key before it can be trusted even as far as those two
  // currently are.
  //
  // OFF by default, unlike departureWatch/affiliation which default on: this
  // pulls a third party's crowdsourced numbers through a service this
  // project has no relationship with, and the integration is unverified.
  // Opt in deliberately.
  function parseSpyStats(json) {
    if (!json || json.error) return null;
    if (json.status === false) return null; // TornStats' own "no" for this call
    const spy = json.spy;
    // TornStats reports "never spied" as an EMPTY spy — several community
    // tools use `[]` rather than `{}` for "nothing here" wherever a
    // same-shaped object is otherwise expected. Read as "no data", not as a
    // malformed response: the request worked, there's just nothing to show.
    // Distinguishing that from a genuinely wrong field-name guess is exactly
    // what a live-key report needs to settle.
    if (Array.isArray(spy) || !spy || typeof spy !== 'object') return null;
    const total = Number(spy.total);
    // No positive total reads the same as "no data". A real spied player's
    // battle stats are essentially never all-zero past the first few levels,
    // and treating a malformed 0 as a genuine figure is the exact
    // confidently-wrong-is-worse-than-none trap this project keeps naming.
    if (!(total > 0)) return null;
    return {
      strength: Number(spy.strength) || 0,
      defense: Number(spy.defense) || 0,
      speed: Number(spy.speed) || 0,
      dexterity: Number(spy.dexterity) || 0,
      total,
      // Seconds since epoch, matching Torn's own convention (parseTargetStatus's
      // `until`) — TornStats mirrors it throughout its documented API.
      spiedAt: Number(spy.timestamp) || 0,
    };
  }

  const spyCache = new Map(); // xid (string) -> {...stats, fetchedAt}
  // A crowdsourced spy report doesn't change hand to hand — someone's battle
  // stats are stable for days at a stretch, same reasoning as
  // AFFIL_REFRESH_MS. Kept OUT of STORE.players and never persisted, unlike
  // affiliation: this is a third party's ESTIMATE rather than a fact read
  // from Torn's own API, and letting it survive a reload or ride along in a
  // Backup/Gist export risks it being read back later as more solid than it
  // is. A fresh session simply re-fetches.
  const SPY_REFRESH_MS = 24 * 60 * 60 * 1000;

  // Same probe shape as target status — see apiProbe. Sharing it is what
  // stops the two features' diagnostics drifting into wording that implies a
  // distinction between them that doesn't exist.
  const spyProbe = apiProbe('No lookup has run yet — sit at a table with other players.');
  const tornStatsKey = () => (STORE.settings.tornStatsApiKey || '').trim();

  async function fetchSpyStats(xid) {
    const key = tornStatsKey();
    if (!key) return; // no key configured — the whole feature is a no-op
    await probeFetch(spyProbe, {
      xid,
      url: `https://www.tornstats.com/api/v2/${encodeURIComponent(key)}/spy/user/${xid}`,
      apiError: (j) => (j && j.status === false ? 'TornStats: ' + (j.message || 'request refused') : ''),
      parse: parseSpyStats,
      cache: spyCache,
      unreachable: 'could not reach tornstats.com',
    });
  }

  function spyStatsFor(xid) {
    return spyCache.get(String(xid)) || null;
  }

  // Mirrors requestTargetStatus: one player, fetched only if nothing fresh
  // is cached, gated on the feature being switched on at all (unlike target
  // status and affiliation, this one has an explicit opt-in toggle on top of
  // the key check).
  function requestSpyStats(xid) {
    if (!STORE.settings.battleStatsEstimate) return;
    if (!(STORE.settings.tornStatsApiKey || '').trim()) return;
    if (!xid || isHeroRecord(xid)) return; // hero's own stats aren't the question
    const cached = spyCache.get(String(xid));
    if (cached && (Date.now() - cached.fetchedAt) <= SPY_REFRESH_MS) return;
    fetchSpyStats(xid);
  }

  function refreshSeatedSpyStats() {
    if (!STORE.settings.battleStatsEstimate) return;
    if (!(STORE.settings.tornStatsApiKey || '').trim()) return;
    seatedXids({ includeSittingOut: true }).forEach(requestSpyStats);
  }

  // Why the feature is showing nothing — '' when it's actually working. Same
  // reasoning as targetDiagnostic: a field-name guess this unverified has to
  // be able to explain its own silence.
  function spyDiagnostic() {
    return spyProbe.diagnostic(() => {
      if (!STORE.settings.battleStatsEstimate) {
        return 'Estimated battle stats is off — Settings → Estimated battle stats.';
      }
      if (!tornStatsKey()) {
        return 'No TornStats API key set — Settings → Estimated battle stats. Without one this does nothing.';
      }
      return '';
    });
  }

  // One compact line for a badge/panel — "≈3.4M BS" — or '' when there's
  // nothing to show. Same width discipline as the seat badges: the breakdown
  // and the spied-on date belong in a tooltip (spyStatsDetail), not inline.
  function spyStatsLabel(xid) {
    const s = spyStatsFor(xid);
    return s ? `≈${fmtStatNum(s.total)} BS` : '';
  }

  function fmtSpyAge(unixSecs) {
    if (!unixSecs) return '';
    const mins = Math.floor((Date.now() - unixSecs * 1000) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function spyStatsDetail(xid) {
    const s = spyStatsFor(xid);
    if (!s) return '';
    const age = s.spiedAt ? `, spied ${fmtSpyAge(s.spiedAt)}` : '';
    return `S ${fmtStatNum(s.strength)} / D ${fmtStatNum(s.defense)} / Sp ${fmtStatNum(s.speed)} / `
      + `Dx ${fmtStatNum(s.dexterity)}${age} — estimate from TornStats, not Torn's own data`;
  }

  // ===========================================================================
  // 4. TABLE STATE CAPTURE
  // ===========================================================================

  // Best-guess selectors — expect to retune these in Calibration Mode.
  // Calibrated against a real table (deep scan v0.3.0). Torn hashes CSS-module
  // names with BOTH `name___hash` and `name_hash` shapes, sometimes for the same
  // base within one render, so every selector matches on a single trailing
  // underscore — `[class*="front_"]` catches `front___zu4oW` and `front_ab12`
  // alike, where the old `front___` prefix silently missed half of them.
  const SELECTORS = {
    logContainer: '[class*="messagesList_"]',
    logRow: 'li[class*="message_"]',
    seatContainer: '[id^="player-"]',
    seatNameLink: 'a[href*="XID="]',
    seatName: '[class*="name_"]',
    seatFolded: '[class*="folded_"]',
    // Torn marks the seat currently ON ACTION with `active___`. Confirmed by a
    // live scan (`DIV#player-4034124.opponent___QQnNM.active___Xxj4V`), and it
    // is a far better turn signal than the action buttons: buttons cannot tell
    // a real turn from a queued pre-action.
    // Scoped to seats so it can't collide with `iconActive___` elsewhere.
    seatActive: '[id^="player-"][class*="active_"]',
    // Torn marks YOUR seat with `self___`, not `hero_`/`you_` — the old guesses
    // matched nothing, which is why hero identification fell back to typing a
    // username into Settings. Corroborated by a live scan: 6 seat containers,
    // `opponent___` on exactly 5 of them. The legacy guesses stay as alternates
    // in case a layout differs; resolveXidFromSeat needs only the element id.
    heroSeat: '[id^="player-"][class*="self_"], [class*="hero_"], [class*="you_"]',
    heroCards: '[class*="hand_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    // CONFIRMED WORKING (scan, v1.40.0): matched 4 with four board cards up.
    // Earlier scans showed zero, but every one of those was taken preflop or
    // between hands — with no board on the table there is nothing for it to
    // match, and "0" was read as "the selector is wrong" rather than "there
    // were no cards". It is a live first try, not a dead one; readBoardCards
    // still falls back to anyFaceUpCard, which needs no container name.
    communityCards: '[class*="communityCards_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    // Any face-up card anywhere on the table. Confirmed structure — this is the
    // same shape heroCards uses, minus the hero container.
    anyFaceUpCard: '[class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    heroHand: '[class*="hand_"]',
    potDisplay: '[class*="totalPotWrap_"], [class*="potsWrapper_"]',
    // NOT used for turn detection — see findActionButtons(), which matches on
    // the button's TEXT instead. Torn's action controls carry no stable hashed
    // container class, so this selector matched nothing for many versions and
    // took isHeroTurn() down with it. Kept as a calibration probe only.
    actionButtons: '[class*="actionButtons_"] button, [class*="controls_"] button',
    // The dealer element carries a `position-<N>___` class naming the seat
    // index it sits at, or `position-self___` when YOU have the button.
    dealerButton: '[class*="dealer_"], [class*="dealerButton_"], [class*="buttonIcon_"]',
    // Per-seat state line. Carries "Sitting out" as text; a seated player who
    // is sitting out still occupies a seat and would otherwise shift every
    // position label by one.
    seatState: '[class*="state_"]',
    // Seat ring slot. Where it carries an index (`playerPositioner-3___hash`)
    // it gives the seating order directly, with no geometry needed. A live PDA
    // scan showed the un-indexed form (`playerPositioner___hash`), so the
    // geometric fallback in seatRotationFromDom stays.
    seatPositioner: '[class*="playerPositioner"]',
    // Chip stack on a seat. Three shapes because the mobile layout nests it in
    // a detailsItem paragraph rather than exposing a money element directly.
    seatStack: '[class*="potString_"], [class*="money_"], [class*="detailsItem_"] p',
  };

  // Action controls are matched by their LABEL, not by a hashed container class
  // — `SELECTORS.actionButtons` has matched nothing on every scan taken so far.
  // Text matching also survives a Torn redeploy, since the labels are the UI.
  //
  // Prefix-anchored rather than whole-string: Torn's call button may carry the
  // amount ("Call $2,000,000"). The length guard keeps a sentence containing the
  // word "call" from counting as a button.
  const ACTION_BTN_RE = /^(fold|check|call|bet|raise|all[\s-]?in)\b/i;
  const ACTION_BTN_MAX_LEN = 24;

  // PRE-action controls, shown while waiting for someone else to act so you can
  // queue a decision: "Check / Fold", "Call Any / Check". A live scan found
  // exactly these three and no bare action buttons, which means their presence
  // is evidence you are IN the hand — not that it is your turn.
  //
  // Treating them as turn buttons made isHeroTurn true for most of the hand,
  // which is the same failure mode as the old hole-cards fallback it replaced.
  const PREACTION_BTN_RE = /\/|\bany\b/i;

  function findActionButtons() {
    const out = [];
    document.querySelectorAll('button, [role="button"]').forEach((b) => {
      if (b.closest('[class^="tph-"], [class*=" tph-"]')) return; // our own UI
      const t = (b.textContent || '').trim();
      if (!t || t.length >= ACTION_BTN_MAX_LEN || !ACTION_BTN_RE.test(t)) return;
      b.__tphPreaction = PREACTION_BTN_RE.test(t);
      out.push(b);
    });
    return out;
  }

  // Only a single-action label means it is actually your turn.
  function findTurnButtons() {
    return findActionButtons().filter((b) => !b.__tphPreaction);
  }

  const CARD_CLASS_RE = /(clubs|spades|hearts|diamonds)-([0-9TJQKA]+)/i;

  // Log line patterns. Each handler receives (match, ctx) where ctx is the
  // active HandState. Wording is a best guess (mixing past/present tense)
  // per the public "posts/posted the (small|big) blind" style referenced by
  // similar Torn scripts — add more alternates here during calibration.
  // Torn writes the log in PAST tense with status glyphs ("* ImEx called"), and
  // amounts are not always present. Every pattern therefore accepts both tenses
  // and treats the amount as optional; a missing amount costs chip accuracy but
  // still records the action. Verified against real observed wording.
  const LOG_PATTERNS = [
    { type: 'newHandMarker', re: /(dealing|starting)\s+(a\s+)?new\s+hand/i },
    // Torn marks a new hand as "Game <hex id> started". An earlier pass read the
    // id off a body-fallback fragment that had already lost the "Game " prefix
    // and anchored on the hex, so the real line never matched and hands were
    // never segmented. Prefix optional, in case the fragment form reappears.
    // The id is captured: it uniquely names one real hand, which is what lets a
    // re-read of the same marker be ignored instead of opening a second record.
    { type: 'newHandMarker', re: /^(?:game\s+)?([0-9a-f]{6,})\s+started\b/i },
    { type: 'postSB', re: /^(.+?)\s+post(?:s|ed)?\s+(?:the\s+)?small\s*blind(?:\s*\$?([\d,]+))?/i },
    { type: 'postBB', re: /^(.+?)\s+post(?:s|ed)?\s+(?:the\s+)?big\s*blind(?:\s*\$?([\d,]+))?/i },
    // A bare "Name posted $2,500,000" — a dead blind, posted when rejoining
    // after sitting out or missing a blind. Seen unparsed on a live scan.
    // MUST stay below postSB/postBB, which are more specific; it is anchored to
    // end-of-line so "posted small blind $X" cannot reach it anyway.
    //
    // The money is real and goes into the pot, so it is contributed — but it is
    // FORCED, so it must not count as VPIP or as a limp. Treating it as a call
    // would have made anyone rejoining a table look voluntarily loose.
    { type: 'postDead', re: /^(.+?)\s+post(?:s|ed)?\s+\$?([\d,]+)\s*$/i },
    { type: 'allin', re: /^(.+?)\s+(?:is\s+|goes\s+|went\s+)?all[\s-]?in(?:\s*(?:for|with)?\s*\$?([\d,]+))?/i },
    { type: 'fold', re: /^(.+?)\s+fold(?:s|ed)?\b/i },
    { type: 'check', re: /^(.+?)\s+check(?:s|ed)?\b/i },
    { type: 'call', re: /^(.+?)\s+call(?:s|ed)?\b(?:\s*\$?([\d,]+))?/i },
    // "raised $1,000,000 to $2,000,000" states the increment first and the total
    // second; the total is the number that matters for pot and bet-sizing math,
    // so match this shape ahead of the generic raise below, which would
    // otherwise capture the increment and understate every raise.
    { type: 'raise', re: /^(.+?)\s+raise[sd]?\s+\$?[\d,]+\s+to\s+\$?([\d,]+)/i },
    { type: 'raise', re: /^(.+?)\s+raise[sd]?\b(?:\s+to)?(?:\s*\$?([\d,]+))?/i },
    { type: 'bet', re: /^(.+?)\s+bet(?:s|ted)?\b(?:\s*\$?([\d,]+))?/i },
    // Torn writes "The flop:  5♣, 7♦, A♦" — the definite article and the double
    // space both defeated an anchor on the bare street name, so the board was
    // never read from the log and the street never advanced.
    { type: 'flop', re: /^(?:the\s+)?flop\b:?\s*(.+)/i },
    { type: 'turn', re: /^(?:the\s+)?turn\b:?\s*(.+)/i },
    { type: 'river', re: /^(?:the\s+)?river\b:?\s*(.+)/i },
    // WINS MUST BE TESTED BEFORE SHOWS. Do not reorder these back.
    //
    // Torn writes "Bauderix won $28,500,000 Did not show hand" for a pot taken
    // without a reveal, and the deliberately-widened `shows` pattern below
    // matches the bare word "show" inside "Did not show hand". With shows
    // first, that line was consumed as a showdown: the `wins` handler never
    // ran, hand.winners stayed empty, and applyHandResults gates ALL of P/L on
    // winners.length > 0 — so every pot won WITHOUT a showdown recorded no
    // profit or loss whatsoever. It also fed the garbage name
    // "Bauderix won $28,500,000 Did not" to nameToXidGuess, creating a `name:`
    // pseudo-record and counting it as a player dealt in.
    //
    // It was intermittent in exactly the way that hides a bug: a winner who
    // SHOWS produces "won $65,000,000 with [J J]", which contains no "show" and
    // parsed correctly, so P/L worked on some hands and vanished on others.
    // Confirmed from a live deep scan at v1.1.0.
    { type: 'wins', re: /^(.+?)\s+w(?:ins?|on)\b(?:\s+the\s+pot)?(?:\s*\$?([\d,]+))?/i },
    // Showdowns read "_AY_  reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)".
    // "reveals" was the confirmed wording, but the pattern only accepted
    // reveal/reveals — "revealed" and "turns over" fell straight through to the
    // unmatched list. A missed reveal costs a showdown from the Range tab
    // silently, so accept every form.
    //
    // The leading guard is the second half of the fix above, kept even though
    // the ordering alone is sufficient: "did not show" must never read as a
    // reveal, whichever order these end up in. Negative LOOKAHEAD only —
    // lookbehind is a SyntaxError on older iOS JSC, see containsNameToken.
    { type: 'shows', re: /^(?!.*\bdid\s+not\s+show\b)(.+?)\s+(?:show(?:s|ed|n)?|reveal(?:s|ed)?|turn(?:s|ed)?\s+over|flip(?:s|ped)?(?:\s+over)?)\s+(.+)/i },
  ];

  // Log rows are prefixed with status glyphs; left in place they'd be captured
  // as part of the player's name and never match a seat.
  const LINE_DECORATION_RE = /^[^\w$]+/;
  function cleanLogLine(t) {
    return String(t || '').replace(/[✓✔✕✖✗✘]/g, '').replace(LINE_DECORATION_RE, '').trim();
  }
  function cleanName(n) {
    return String(n || '').replace(/^[^\w]+/, '').replace(/[^\w]+$/, '').trim();
  }

  // The characters that can appear inside a real username — mirrors the class in
  // USERNAME_RE. Kept as its own constant because containsNameToken has to ask
  // "is this character part of a name?" one character at a time.
  const USERNAME_CHAR_RE = /[A-Za-z0-9_\-]/;

  // True when `name` appears in `text` as a whole token rather than buried inside
  // a longer username: "Al" occurs in "AlexTheGreat" but is not a token of it.
  //
  // Deliberately an index scan, and deliberately NOT the regex lookbehind it
  // replaces (v1.0.1). A negative-lookbehind assertion is a SyntaxError at
  // CONSTRUCTION time on JavaScriptCore before Safari 16.4 — the engine behind
  // Torn PDA's WKWebView on older iOS. This sits in the log-parse hot path with
  // no try/catch above it, so that threw the whole parse tick away rather than
  // merely failing to match. Don't reintroduce a lookaround here; the scan costs
  // nothing and runs everywhere. test/name-boundary.test.js scans the source to
  // enforce that, which is why this comment describes the syntax without
  // spelling it — the assertion cannot tell code from prose.
  //
  // Not plain `\b` either: word boundaries treat `-` as a non-word character,
  // but USERNAME_RE allows hyphens, so `\bAl\b` still false-matches inside
  // "Al-Qaeda". Testing the adjacent character against the username class is the
  // thing that actually needs to be true.
  //
  // An out-of-range charAt returns '', which tests false against the class — and
  // that is what lets a name at the very start or end of the text match.
  function containsNameToken(text, name) {
    if (!text || !name) return false;
    for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
      const before = i > 0 ? text.charAt(i - 1) : '';
      const after = text.charAt(i + name.length);
      if (!USERNAME_CHAR_RE.test(before) && !USERNAME_CHAR_RE.test(after)) return true;
    }
    return false;
  }

  let heroXid = null;
  let currentHand = null;
  const seenUnmatchedLines = []; // for calibration panel

  // Last big blind seen on any hand this session. Seeds each new hand so that a
  // hand joined mid-way, or one whose blind line scrolled out of the log before
  // the snapshot primed, still has a unit to express P/L in. Torn's blind level
  // is fixed per table, so carrying it forward is safe within a session; it
  // resets on reload rather than being persisted, because the next table may be
  // a different stake.
  let lastSeenBB = 0;

  // Torn's poker tables, by big blind. Blind levels are fixed per table, so the
  // blind read off the log identifies which table you are sitting at — with one
  // caveat below.
  //
  // Taken from HopesG's HUD (MIT, GreasyFork 569933), which carries TWO ladders:
  // a default bb->name map (used here), and a second map keyed by a CSS "table
  // texture" class HopesG reads from the DOM that we have no scan confirming on
  // this layout. Two levels are independently corroborated by scans from THIS
  // device: $1,000,000 (River Wizard) and $2,500,000 (Cat's Chance). Everything
  // else here is borrowed, not measured — same status as POOL_AVG.
  //
  // v1.0.0 folded in the rest of HopesG's default map ($5,000,000, previously
  // missing entirely) and surfaced something their SECOND map exposes that this
  // one-name-per-level shape hides: at three stakes — $100,000, $1,000,000 and
  // $5,000,000 — their texture-keyed map lists MULTIPLE distinct table names
  // sharing that same blind level (e.g. $100,000 alone covers "Old 'n Slow",
  // "Periodic", "Fourplay" and "Duel at Dawn"). Torn evidently runs more than
  // one differently-named room at some stakes, which breaks the "blind level
  // identifies the table" assumption this whole lookup rests on — just not
  // reliably enough to prove from a texture class we cannot read. The single
  // name shown for those three levels (including the confirmed "River Wizard"
  // at $1M) is therefore a best guess, not a confirmed one: if a future scan
  // lands at a $1M table that ISN'T River Wizard, this is why, and "Tripod" /
  // "Comatose Cove" are the other two names on record for that level.
  // An unknown level is reported rather than treated as an error — Torn adds
  // tables, and this list will go stale before the code does.
  const TORN_STAKES = {
    10: 'Newbie Corner', 25: 'Hobo Holdem', 50: 'Broke Jokes', 100: '8-bit',
    250: 'Sprinkles', 500: 'E-asy Street', 1000: 'Gatling Gun', 2500: 'Quickdraw',
    5000: 'Tight Knit', 10000: 'Six of the Best', 25000: 'Ballsy',
    50000: 'Boom or Bust', 100000: "Old 'n Slow", 250000: 'Pound It',
    500000: 'Old Folks Home', 1000000: 'River Wizard', 2500000: "Cat's Chance",
    5000000: 'Juan on Juan', 10000000: 'High Rollers', 25000000: 'Fire Pit',
    100000000: 'Oligarch',
  };

  // The smallest real blind on Torn. Anything below this is not a stake.
  //
  // This is the guard against Torn's BB DISPLAY MODE, which renders amounts as
  // "181.00 BB" rather than "$181,000,000". In that mode every amount parses to
  // a number six or more orders of magnitude too small, and nothing looks
  // broken — the figures are simply tiny. Refusing an implausible blind stops a
  // whole session of corrupted P/L from being written, at the cost of showing
  // no P/L for that session, which is the right trade.
  const MIN_PLAUSIBLE_BB = 10;

  // Record the blind level for a hand, and notice when it changes.
  //
  // lastSeenBB exists to price a hand whose blind line was missed. It is only
  // safe while you stay at one table — the scans from this device show play at
  // two different stakes, so a table switch is a real event, not a theoretical
  // one. Carrying $2.5M forward onto a $1M table would misprice every hand
  // until the next blind line landed.
  function noteBlindLevel(hand, amt) {
    if (!plausibleBB(amt)) {
      // Too small to be a real Torn stake. Don't store it, don't carry it, and
      // don't let it price anything.
      bbDisplayModeSuspected = true;
      return;
    }
    bbDisplayModeSuspected = false;
    if (lastSeenBB && amt !== lastSeenBB) {
      currentTableBB = null; // switched tables
      // Guard 4 on the departure watch. A different blind means a different
      // table, so the old roster is "missing" because you left, not because
      // they did. See noteTableChange.
      noteTableChange();
    }
    hand.bbAmount = amt;
    lastSeenBB = amt;
    currentTableBB = amt;
  }

  // Read a blind level out of log lines that are already on screen, WITHOUT
  // parsing them as events. See the caller in scanLogRows for why: those lines
  // are deliberately never replayed, but the blind they mention is a fact
  // about the table rather than something that happens, so taking it costs
  // nothing and inflates no stat.
  //
  // Only ever SEEDS — it returns immediately once a blind is known, so it can
  // never override a live reading or interfere with the table-switch detection
  // in noteBlindLevel. Reads the newest matching line, since the log may span
  // a table change.
  function seedBlindFromVisibleLog(rows) {
    if (lastSeenBB) return false;
    const bbPattern = LOG_PATTERNS.find((p) => p.type === 'postBB');
    if (!bbPattern) return false;
    for (let i = (rows || []).length - 1; i >= 0; i--) {
      const m = bbPattern.re.exec(rows[i] || '');
      if (!m || !m[2]) continue;
      const amt = parseAmount(m[2]);
      if (!plausibleBB(amt)) continue;
      lastSeenBB = amt;
      currentTableBB = amt;
      return true;
    }
    return false;
  }

  let currentTableBB = null;

  function tableNameForBB(bb) { return TORN_STAKES[bb] || null; }

  // "Cat's Chance ($2.5M/hand · Mid)" — or an honest label for a level that
  // isn't in the ladder, since Torn adds tables.
  function tableLabel(bb) {
    if (!plausibleBB(bb)) return null;
    const name = tableNameForBB(bb);
    const tier = stakeTierForBB(bb);
    return `${name || 'Unknown table'} · ${fmtMoney(bb)} BB${tier ? ' · ' + tier : ''}`;
  }

  function stakeTierForBB(bb) {
    if (!bb) return null;
    if (bb <= 500) return 'Nano';
    if (bb <= 50000) return 'Low';
    if (bb <= 999999) return 'Mid';
    if (bb <= 9999999) return 'High';
    return 'Elite';
  }

  // Is this a blind level we can believe? Used before anything is stored in
  // big blinds, so a display-mode session can't poison the win rate.
  function plausibleBB(bb) {
    return typeof bb === 'number' && isFinite(bb) && bb >= MIN_PLAUSIBLE_BB;
  }

  // Set when a parsed blind is too small to be real, i.e. almost certainly BB
  // display mode. Surfaced in Settings and the deep scan rather than silently
  // dropping data.
  let bbDisplayModeSuspected = false;

  // Torn game ids opened this session, newest last. Bounded because only ids
  // still visible in the log can ever be re-read, and the log holds a handful of
  // hands at most.
  const SEEN_GAME_IDS_MAX = 40;
  const seenGameIds = [];

  function freshHandState() {
    const dealtIn = seatedXids(); // snapshot of who's seated *before* any folds happen this hand
    return {
      gameId: null,            // Torn's hex id from "Game <id> started", when seen
      street: 'preflop',
      pot: 0,
      contributions: {},       // xid -> total chips this hand
      streetContributions: {}, // xid -> chips this street
      dealtInXids: dealtIn,    // immutable — used as the "hands observed" denominator
      // Pot as it stood when the current street began. SPR is conventionally
      // fixed at the start of a street; measuring it against the live pot makes
      // the number shrink while you are deciding, which is the opposite of what
      // it is for.
      potAtStreetStart: 0,
      playersIn: new Set(dealtIn), // mutable — shrinks as players fold, used for opportunity counts
      winners: [],             // {xid, amount}[] — supports split pots, applied at hand end
      actions: [],             // {x,a,amt,s}[] — replayable action log for the History tab
      shown: {},               // xid -> cards revealed at showdown, as display text
      shownVia: {},            // xid -> 'seat' | 'log', which path caught the reveal
      shownCards: {},          // xid -> parsed [{rank,suit},{rank,suit}] for range tracking
      sbXid: null,
      bbXid: null,
      actionOrder: [],         // first-to-act order preflop, used to derive positions
      board: [],               // community cards parsed out of the log
      heroCards: null,         // captured while the hand is live, for the history record
      preflopRaiseEvents: 0,   // total raise events preflop (not unique raisers) — 2nd = a 3-bet
      lastAggressor: null,
      aggressorByStreet: {},
      cbetOpportunity: {},     // xid -> bool, was preflop aggressor and street is theirs to act first
      cbetFacedThisStreet: null, // xid of the player whose c-bet is currently being faced this street
      threeBetActive: false,
      threeBettorXid: null,
      countedVpip: new Set(),
      countedLimp: new Set(),
      // WTSD is counted once per player per hand, from whichever source sees
      // the showdown first — the log's reveal line or the seats flipping over.
      countedShowdown: new Set(),
      // Blind level for THIS hand, read off the postSB/postBB lines. The only
      // point at which it is known — P/L in big blinds cannot be recovered
      // afterwards from the chip figure, so it is converted at settlement.
      bbAmount: lastSeenBB,
      sbAmount: 0,
      countedPfr: new Set(),
      countedThreeBetOpp: new Set(),
      // xid -> the raise TIER this player reached preflop this hand:
      //   1 = opened (RFI)   2 = 3-bet   3+ = 4-bet or beyond
      //
      // Read off preflopRaiseEvents at the moment they raise, so it needs no
      // separate detection and cannot drift from the 3-bet counter. Highest
      // tier wins: a player who opens and is then 4-bet back and 5-bets is
      // recorded at the top of their own range, which is the read that matters.
      //
      // This exists so a SHOWDOWN can be filed under the action that produced
      // it. shownHands.raised was set from countedPfr, which is "raised at some
      // point" — it cannot tell an open from a 3-bet, so the two ranges were
      // averaged into one that describes neither.
      preflopTier: {},
      // Limped, then re-raised the same hand — the limp-3bet trap. Held per hand
      // because it needs both halves: countedLimp records the limp, and the
      // raise that follows is what makes it a trap rather than a limp.
      limpRaised: new Set(),
    };
  }

  // Seats carry the XID directly on the element id (`<div id="player-3722665">`),
  // which the deep scan confirmed is present on every seat while profile links
  // are not — only 1 of 6 seats had an anchor. Read the id first and treat the
  // link as the fallback, not the other way round.
  function resolveXidFromSeat(seatEl) {
    const byId = /^player-(\d+)$/.exec(seatEl.id || '');
    if (byId) return byId[1];
    const link = seatEl.querySelector(SELECTORS.seatNameLink);
    if (!link) return null;
    const m = /XID=(\d+)/.exec(link.href || '');
    return m ? m[1] : null;
  }

  // Prefer a profile link, but fall back to matching the seat's text against
  // names already seen in the log — longest first, so "Joe" can't shadow "Joey".
  function resolveSeatKey(seatEl) {
    const xid = resolveXidFromSeat(seatEl);
    if (xid) return xid;
    const text = seatEl.textContent || '';
    const known = Object.keys(STORE.players)
      .map((k) => ({ key: k, name: (STORE.players[k] || {}).name || '' }))
      .filter((e) => e.name.length >= 2)
      .sort((a, b) => b.name.length - a.name.length);
    for (const e of known) { if (text.includes(e.name)) return e.key; }
    return null;
  }

  // A seated player who is sitting out is dealt no cards, but still occupies a
  // seat. Counting them shifts every position label by one and inflates the
  // "hands observed" denominator for everyone at the table.
  function isSeatSittingOut(seatEl) {
    if (!seatEl) return false;
    for (const c of (seatEl.classList || [])) {
      if (/sitOut|sittingOut|sit-out/i.test(c)) return true;
    }
    const state = seatEl.querySelector(SELECTORS.seatState);
    return !!(state && /sitting\s*out/i.test(state.textContent || ''));
  }

  // opts.includeSittingOut keeps the old behaviour for callers that want every
  // occupied seat rather than everyone actually in the hand.
  function seatedXids(opts) {
    const includeOut = !!(opts && opts.includeSittingOut);
    const xids = new Set();
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      if (!includeOut && isSeatSittingOut(seat)) return;
      const xid = resolveSeatKey(seat);
      if (xid) xids.add(xid);
    });
    return xids;
  }

  // The seat element carrying Torn's own "this is you" marker. Authoritative
  // when present: it needs no username, resolves to a real numeric XID, and is
  // available before any log line arrives.
  function heroSeatEl() {
    const seats = document.querySelectorAll(SELECTORS.heroSeat);
    for (const s of seats) { if (resolveXidFromSeat(s)) return s; }
    return seats[0] || null;
  }

  // Hero identity, best source first.
  //
  // The DOM marker now leads. It used to be the fallback, on the belief that
  // "this table renders no hero marker" — that was wrong: Torn marks your seat
  // with `self___`, and the old guesses (`hero_`, `you_`) simply never matched.
  // Preferring it means P/L works with Settings left blank, and removes the
  // window where findHeroXid returns the "name:<username>" pseudo-id.
  //
  // The configured username stays as the fallback for any layout that doesn't
  // render the marker, and still wins over a DOM element that can't be resolved
  // to a numeric XID.
  function findHeroXid() {
    const seat = heroSeatEl();
    if (seat) {
      const xid = resolveXidFromSeat(seat);
      if (xid) {
        const name = seatDisplayName(seat);
        if (name) noteResolvedName(xid, name);
        // A live seat is authoritative and overwrites the memory, not just
        // seeds it. Note this only runs while identity is still unresolved
        // (the 3s retry is gated on heroUnresolved), so a remembered value is
        // corrected on the next page load rather than mid-session.
        rememberHeroXid(xid);
        return xid;
      }
    }
    // No seat: fall back to who a seat told us we were last time. This is what
    // makes your own Stats and the Trends tab reachable while you are not
    // sitting down (see ensureHeroShape). It is also a genuine hardening of the
    // SEATED case — `self___` is read out of someone else's script and has
    // never been confirmed on the PDA layout, and when it fails to match, the
    // pseudo-id path silently freezes P/L at zero for the whole session.
    if (STORE.hero && STORE.hero.xid) return STORE.hero.xid;
    const configured = (STORE.settings.heroName || '').trim();
    if (configured) return nameToXidGuess(configured);
    return null;
  }

  // Persist a seat-confirmed hero XID. Only ever called with a real seat xid —
  // never a "name:" pseudo-id, which is the thing this exists to stop falling
  // back to. ensureHeroShape rejects a stored pseudo-id for the same reason.
  function rememberHeroXid(xid) {
    if (!xid || String(xid).startsWith('name:')) return;
    if (!STORE.hero || typeof STORE.hero !== 'object') return;
    if (STORE.hero.xid === xid) return; // no write, no needless save
    STORE.hero.xid = xid;
    saveStore();
  }

  // Chip stack showing on a seat, in chips, or null if it can't be read.
  //
  // Seat text runs names and figures together ("RoadKillV$190,866,931$500,000"
  // — stack then current bet), so this reads the stack ELEMENT rather than
  // regexing the seat's text: the first figure in that string is the stack, but
  // only by luck of ordering. Where several candidates match, the largest wins,
  // since a player's stack is bigger than the amount they've bet this street in
  // every case except an all-in, where the two are equal.
  function readSeatStack(seatEl) {
    if (!seatEl) return null;
    let best = null;
    seatEl.querySelectorAll(SELECTORS.seatStack).forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (!/^\$/.test(txt)) return; // a `name_` wrapper can match seatStack too
      const n = parseAmount(txt.replace(/^\$/, ''));
      if (n > 0 && (best === null || n > best)) best = n;
    });
    return best;
  }

  // Face-up cards showing at a seat right now, as [{rank,suit}].
  //
  // At showdown Torn flips the seat's cards over. That may be the ONLY place a
  // reveal appears — the log does not reliably carry a "reveals" line, which is
  // why range tracking that depended on one stayed empty while revealed hands
  // were plainly visible on the table.
  function readSeatFaceUpCards(seatEl) {
    if (!seatEl || !seatEl.querySelectorAll) return [];
    const out = [];
    seatEl.querySelectorAll(SELECTORS.anyFaceUpCard).forEach((el) => {
      const c = parseCardEl(el);
      if (c) out.push(c);
    });
    return out.slice(0, 2);
  }

  // Fast enough to catch a reveal before the next deal clears it — see the
  // interval that uses it for why one second was not.
  const SHOWDOWN_POLL_MS = 400;

  // Watch the seats for revealed hands and record them on the live hand.
  //
  // Runs on the poll rather than at settlement: by the time the next hand's
  // marker arrives the cards have been cleared, so a read at settlement finds
  // nothing. First sighting wins, so a hand already captured from the log (or
  // from an earlier tick) is not overwritten.
  function harvestShownCards() {
    if (!currentHand) return;
    let found = false;
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid || isHeroRecord(xid)) return;      // your own cards are always up
      if (currentHand.shownCards[xid]) return;    // already have this one
      const cards = readSeatFaceUpCards(seat);
      if (cards.length !== 2) return;
      currentHand.shownCards[xid] = cards;
      // Mirror into `shown` so the History tab shows it too — that path only
      // ever had log text, which is why History was blank as well.
      //
      // cardsGlyphText, the SAME renderer the board uses, because this and the
      // log path below both write this field and were formatting it
      // differently: one produced "KH KS" and the other "[7♥, J♦]", and a
      // reported screenshot showed both styles inside a single hand, one line
      // apart. Two writers, one field, one format.
      if (!currentHand.shown[xid]) currentHand.shown[xid] = cardsGlyphText(cards);
      // Which path caught it. Two independent sources feed this field and they
      // fail in different ways — the seat poll can miss a fast deal, the log
      // can omit a reveals line entirely — so a count of reveals is not enough
      // to tell which one to fix. Recorded per player, surfaced in the scan.
      currentHand.shownVia[xid] = currentHand.shownVia[xid] || 'seat';
      // WTSD is otherwise only counted off the log's reveal line, so a table
      // that never writes one recorded nobody as having gone to showdown.
      if (!currentHand.countedShowdown.has(xid)) {
        currentHand.countedShowdown.add(xid);
        getPlayer(xid).wtsd += 1;
      }
      found = true;
    });
    if (found) saveStore();
  }

  // Record each seated player's stack, tracking the low and high of their
  // current sitting.
  //
  // The swing is the read: a player $200M below their session high has just
  // lost a stack, which is the state tilt actually follows from. Lifetime
  // low/high would be meaningless — it would just record the smallest and
  // largest table they have ever sat at.
  //
  // Own constant, deliberately NOT the hero-session SESSION_GAP_MS (4h,
  // touchSession) — that one governs hero's own lifetime P/L session
  // boundary and changing it would be a second, unrelated behaviour change.
  // A gap this short exists because leaving and coming back within it — a
  // stake unchanged, so the bb check below never fires — otherwise carries a
  // stale `high` into a fresh buy-in, which can then read as impossibly
  // above the table's max buy-in.
  const STACK_SESSION_GAP_MS = (2 * 60 + 10) * 60 * 1000; // 2h10m
  function trackStacks() {
    const stacks = readAllStacks();
    const bb = plausibleBB(lastSeenBB) ? lastSeenBB : 0;
    const now = Date.now();
    let dirty = false;

    Object.keys(stacks).forEach((xid) => {
      const v = stacks[xid];
      if (!(v > 0)) return;
      const p = getPlayer(xid);
      const s = p.stack;
      // A gap longer than a session, or a different stake, starts a new sitting.
      const stale = !s || (now - (s.at || 0)) > STACK_SESSION_GAP_MS || (bb && s.bb && s.bb !== bb);
      if (stale) {
        p.stack = { now: v, low: v, high: v, start: v, bb: bb || null, at: now };
      } else {
        s.now = v;
        if (v < s.low) s.low = v;
        if (v > s.high) s.high = v;
        s.at = now;
        if (bb) s.bb = bb;
      }
      dirty = true;
    });
    if (dirty) saveStore();
  }

  // How far below their session high this player is sitting, in big blinds.
  // Null when there is nothing to compare against.
  function stackSwingBB(p) {
    const s = p && p.stack;
    if (!s || !s.bb || !(s.high > 0)) return null;
    return { downBB: (s.high - s.now) / s.bb, upBB: (s.now - s.start) / s.bb };
  }

  // "Stack this sitting" as one bar rather than four table rows.
  //
  // Three cash figures stacked vertically was a lot of a phone screen for a
  // question whose whole content is *where NOW sits between them*. The track
  // spans low..high for the current sitting, the fill ends at now, and the pale
  // tick marks where they sat down — so "how far off their high" and "up or
  // down since they sat" are both readable without doing the subtraction.
  //
  // Returns '' when there is no stack record, so the caller can drop the
  // heading with it.
  function stackBarHtml(p) {
    const s = p && p.stack;
    if (!s || !(s.high > 0)) return '';
    const span = s.high - s.low;
    // A player who hasn't swung yet has low === high, and a position within a
    // zero-width range means nothing — show the track full rather than dividing
    // by zero and rendering NaN%.
    const pct = (v) => (span > 0 ? Math.max(0, Math.min(100, ((v - s.low) / span) * 100)) : 100);
    const bb = (v) => (s.bb ? ` · ${(v / s.bb).toFixed(0)}bb` : '');
    const sw = stackSwingBB(p);
    const notes = [];
    if (sw && sw.downBB >= 1) {
      notes.push(`<span class="tph-stack-down">−${sw.downBB.toFixed(0)}bb off their high</span>`);
    }
    if (sw && Math.abs(sw.upBB) >= 1) {
      notes.push(`<span class="${sw.upBB >= 0 ? 'tph-stack-up' : 'tph-stack-down'}">`
        + `${sw.upBB >= 0 ? '+' : '−'}${Math.abs(sw.upBB).toFixed(0)}bb since sitting down</span>`);
    }
    // The start tick is suppressed when it would sit on top of an end cap:
    // a 2px line under the fill's own edge reads as a rendering artefact.
    const startPct = (s.start > 0 && span > 0) ? pct(s.start) : null;
    const showStart = startPct !== null && startPct > 4 && startPct < 96;
    return '<tr class="tph-stat-head"><td colspan="3"><b>Stack this sitting</b></td></tr>'
      + '<tr><td colspan="3" class="tph-stackcell">'
      + `<div class="tph-stackbar" title="Low ${fmtMoney(s.low)} → high ${fmtMoney(s.high)} this sitting.`
      + `${showStart ? ` Tick = ${fmtMoney(s.start)}, where they sat down.` : ''}">`
      + `<div class="tph-stackbar-fill" style="width:${pct(s.now).toFixed(1)}%"></div>`
      + (showStart ? `<div class="tph-stackbar-start" style="left:${startPct.toFixed(1)}%"></div>` : '')
      + `<div class="tph-stackbar-now" style="left:${pct(s.now).toFixed(1)}%"></div>`
      + '</div>'
      + '<div class="tph-stackscale">'
      + `<span>low ${fmtMoney(s.low)}</span>`
      + `<span class="tph-stack-now">${fmtMoney(s.now)}${bb(s.now)}</span>`
      + `<span>high ${fmtMoney(s.high)}</span>`
      + '</div>'
      + (notes.length ? `<div class="tph-stack-note">${notes.join(' · ')}</div>` : '')
      + '<div class="tph-stack-note">Resets when they leave for a session or move stakes.</div>'
      + '</td></tr>';
  }

  // xid -> stack, for every seat that reports one.
  function readAllStacks() {
    const out = {};
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid) return;
      const stack = readSeatStack(seat);
      if (stack !== null) out[xid] = stack;
    });
    return out;
  }

  // Smallest stack among players still in the hand — the most anyone can
  // actually win or lose, and the number SPR should be measured against.
  // Returns null when fewer than two stacks are readable.
  // Effective stack: the most that can actually change hands, which is always
  // bounded by the SHORTER of two specific stacks — yours and theirs.
  //
  // Returns { chips, vsXid, pairwise } or null. Two rules it now enforces that
  // the earlier version did not:
  //
  // 1. HERO IS ALWAYS IN IT. The old version took the minimum across live
  //    players, so if hero's own seat failed to parse it silently reported the
  //    shortest VILLAIN — a number that can be far larger than what you can
  //    actually lose, presented with no warning. Without your stack there is no
  //    honest answer, so it returns null.
  // 2. PAIRWISE WHEN THERE IS SOMEONE TO BE PAIRWISE WITH. Against a specific
  //    opponent the number is min(you, them). The table minimum is only right
  //    when you have no particular opponent in mind, and using it while facing
  //    a bet quietly understates what is at stake against the player betting.
  function effectiveStackVs(hand, villainXid) {
    const stacks = readAllStacks();
    const heroStack = heroUnresolved() ? null : stacks[heroXid];
    if (!(heroStack > 0)) return null;

    if (villainXid && villainXid !== heroXid && stacks[villainXid] > 0) {
      return { chips: Math.min(heroStack, stacks[villainXid]), vsXid: villainXid, pairwise: true };
    }

    // No specific opponent: the shortest live opponent bounds the pot.
    const live = hand ? Array.from(hand.playersIn) : Object.keys(stacks);
    const opp = live
      .filter((x) => x !== heroXid)
      .map((x) => stacks[x])
      .filter((v) => typeof v === 'number' && v > 0);
    if (!opp.length) return null;
    return { chips: Math.min(heroStack, Math.min(...opp)), vsXid: null, pairwise: false };
  }

  // Seat id holding the dealer button, or null.
  //
  // The dealer element carries a `position-<N>___` class naming the ring slot it
  // sits at, or `position-self___` when hero has the button. This was listed as
  // a red herring for a long time because the old selector (`dealerButton_`)
  // matched nothing; the real base is just `dealer_`.
  function getDealerXid() {
    const el = document.querySelector(SELECTORS.dealerButton);
    if (!el) return null;

    const classes = Array.from(el.classList || []);
    if (classes.some((c) => /^position-self[_-]/.test(c))) {
      const seat = heroSeatEl();
      return seat ? resolveXidFromSeat(seat) : null;
    }

    let slot = null;
    for (const c of classes) {
      const m = /^position-(\d+)[_-]/.exec(c);
      if (m) { slot = m[1]; break; }
    }
    if (slot === null) return null;

    // Match the dealer's slot number against the seat ring's slot numbers.
    // Only meaningful where the positioner carries an index; the un-indexed
    // form seen on PDA yields nothing here and the caller falls back.
    for (const pos of document.querySelectorAll(SELECTORS.seatPositioner)) {
      const has = Array.from(pos.classList || [])
        .some((c) => new RegExp('^playerPositioner-' + slot + '[_-]').test(c));
      if (!has) continue;
      const seat = pos.querySelector(SELECTORS.seatContainer);
      return seat ? resolveXidFromSeat(seat) : null;
    }
    return null;
  }

  function ensureHand() {
    if (!currentHand) currentHand = freshHandState();
    return currentHand;
  }

  function nameToXidGuess(name) {
    // Resolve a log line's display name to a stable numeric XID by finding the
    // matching seat. Two passes so an exact name match always beats a loose one:
    // a plain substring test would resolve "Joe" to a "Joey" seat.
    //
    // The FALLBACK pass is the one that matters here, not the exact one — a live
    // scan found SELECTORS.seatNameLink (a profile-link anchor) present on only
    // 1 of 6 seats, so most resolutions run through this second pass on most
    // tables. Until this was boundary-anchored, `.includes(name)` had the exact
    // "Joe"/"Joey" bug the comment above already warned about, just one pass
    // later than the warning implied: "Al" would match a seat whose only
    // occupant is "AlexTheGreat", misattributing every one of Al's real actions
    // (and stats, and P/L) to Alex's record, and vice versa.
    //
    // The boundary check lives in containsNameToken — see there for why it is an
    // index scan rather than a lookbehind, and why plain `\b` is not enough.
    //
    // v1.0.1 also inserted the seatDisplayName pass below, because matching
    // against seat.textContent AT ALL is fragile: textContent concatenates child
    // elements with no separator, so a seat reads as "Bob$41,200,000Sitting out".
    // A boundary check is then correct to reject a name glued to a following
    // letter — correct, and still a failed resolution. Reading the seat's own
    // name element sidesteps the blob entirely, so the fuzzy pass is now a last
    // resort rather than the path most seats take.
    //
    // Both faults returned the 'name:' pseudo-id. That is never equal to the
    // numeric XID renderBadges reads off the seat, so the PFR/3B chip silently
    // stopped rendering and stats/P/L landed on pseudo-records — the same
    // failure mode CLAUDE.md documents under "The pseudo-id is not a resolution".
    //
    // Hero's OWN log lines are a case none of the passes below can ever solve.
    // A live deep scan (v1.5.1) found heroXid resolving correctly off the
    // seat's self___ marker while a `name:<username>` ghost record kept
    // accumulating almost every hand in parallel — heroRecord.vpip/pfr read far
    // LOWER than the ghost's, which is the "my own VPIP looks low" report this
    // was tracking. Root cause: Torn's own seat does not necessarily print your
    // OWN username where every pass here looks for it (a link, the name
    // element, or the seat's text blob) the way it prints an opponent's — so a
    // name match against your own seat can fail every single hand while an
    // opponent's never does. Once heroXid is resolved by ANY means (the seat
    // marker, primarily), it is the answer for a name equal to the configured
    // username — no seat text needed at all.
    if (!heroUnresolved()) {
      const configured = (STORE.settings.heroName || '').trim();
      if (configured && name && name.toLowerCase() === configured.toLowerCase()) return heroXid;
    }
    const seats = Array.from(document.querySelectorAll(SELECTORS.seatContainer));

    for (const seat of seats) {
      const link = seat.querySelector(SELECTORS.seatNameLink);
      if (link && (link.textContent || '').trim() === name) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    // The seat's own name element, matched exactly. seatDisplayName validates
    // against USERNAME_RE, so this can't bind to a chip stack the way a raw
    // `[class*="name_"]` read can.
    for (const seat of seats) {
      if (seatDisplayName(seat) === name) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    // Last resort: the whole seat blob, token-boundary checked.
    for (const seat of seats) {
      if (containsNameToken(seat.textContent || '', name)) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    return 'name:' + name; // fallback pseudo-id if XID can't be resolved yet
  }

  // Bind a display name to a numeric XID.
  //
  // Nothing did this before: getPlayer(xid, name) accepts a name but was never
  // once called with one, so emptyPlayer() stored the "#3722665" placeholder as
  // the player's actual name and playerDisplayName happily returned it. That is
  // why hand history showed ids instead of usernames — the name was known at
  // this exact point every time and simply thrown away.
  function noteResolvedName(xid, name) {
    mergePseudoPlayer(xid, name); // must run first: it bails if the record exists
    if (!name) return;
    const p = getPlayer(xid);
    if (p.name !== name) { p.name = name; saveStore(); }
  }

  // If this player was previously tracked under a name-based pseudo-id (because
  // their seat's XID wasn't resolvable at the time), fold that record into the
  // real numeric-XID one now that it's available, instead of leaving two
  // separate, incomplete records for the same person.
  function mergePseudoPlayer(xid, name) {
    if (STORE.players[xid]) return;
    const pseudoKey = 'name:' + name;
    const pseudo = STORE.players[pseudoKey];
    if (!pseudo) return;
    pseudo.xid = xid;
    STORE.players[xid] = pseudo;
    delete STORE.players[pseudoKey];
    saveStore();
  }

  // Torn usernames are alphanumeric plus _ and -. Used to decide whether text
  // scraped off a seat is actually a name, since SELECTORS.seatName matches on
  // `name_` and could just as easily land on a wrapper holding the chip stack.
  const USERNAME_RE = /^[A-Za-z0-9_\-]{1,20}$/;

  function seatDisplayName(seat) {
    const link = seat.querySelector(SELECTORS.seatNameLink);
    const fromLink = cleanName(link ? link.textContent : '');
    if (fromLink && USERNAME_RE.test(fromLink)) return fromLink;
    const el = seat.querySelector(SELECTORS.seatName);
    if (!el) return null;
    // Take the first line only — the name element may also wrap the stack.
    const first = cleanName((el.textContent || '').split('\n')[0]);
    return first && USERNAME_RE.test(first) ? first : null;
  }

  // Read usernames straight off the seats. This is a second, independent source
  // from the log: it names a player who is sitting there but hasn't acted yet,
  // and it repairs records already stored under the "#<xid>" placeholder.
  // SELECTORS.seatName was declared and read by nothing until now.
  function harvestSeatNames() {
    let dirty = false;
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveXidFromSeat(seat);
      if (!xid) return;
      const name = seatDisplayName(seat);
      if (!name) return;
      const existing = STORE.players[xid];
      if (existing && existing.name === name) return;
      mergePseudoPlayer(xid, name);
      getPlayer(xid).name = name;
      dirty = true;
    });
    if (dirty) saveStore();
  }

  // The body-wide fallback observer sees all of Torn's page chrome, not just the
  // table — the site's rotating announcement ticker was landing in the unmatched
  // log and crowding out real lines during calibration. Drop the known chrome
  // before it reaches the patterns.
  // Real table lines that carry no action worth parsing. Filtering them keeps the
  // calibration panel's unmatched list meaningful — it should show wording we
  // failed to understand, not chatter we deliberately ignore.
  const LOG_NOISE_RE = new RegExp([
    '\\b(armoury|faction growth|merits|newspaper|classified ad)\\b', // Torn page chrome
    '\\b(joined|left)\\s+the\\s+table\\b',
    '^the\\s+preflop\\b',            // "The preflop Two cards dealt to each player"
    '\\bcards\\s+dealt\\s+to\\s+each\\s+player\\b',
  ].join('|'), 'i');

  function handleLogLine(line) {
    const trimmed = cleanLogLine(line);
    if (!trimmed) return;
    if (LOG_NOISE_RE.test(trimmed)) return;

    for (const pattern of LOG_PATTERNS) {
      const m = pattern.re.exec(trimmed);
      if (!m) continue;
      dispatchLogEvent(pattern.type, m);
      return;
    }
    seenUnmatchedLines.unshift(trimmed);
    if (seenUnmatchedLines.length > 30) seenUnmatchedLines.pop();
    if (STORE.settings.calibrationMode) renderCalibrationPanel();
  }

  function dispatchLogEvent(type, m) {
    // Blinds are always posted at the start of a hand, so use them as a robust
    // fallback hand-boundary signal in case the speculative "dealing a new
    // hand" text (below) doesn't actually match Torn's real log wording.
    if ((type === 'postSB' || type === 'postBB') && currentHand && currentHand.winners.length > 0) {
      applyHandResultsAndReset();
    }

    const hand = ensureHand();

    if (type === 'newHandMarker') {
      // Only the "Game <hex> started" pattern captures an id; the speculative
      // "dealing a new hand" one captures a verb, so hex-test before trusting it.
      const gameId = (m[1] && /^[0-9a-f]{6,}$/i.test(m[1])) ? m[1].toLowerCase() : null;
      // A marker for a hand we've already opened is a re-read of the log, not a
      // second deal. Acting on it would close the live hand early and file the
      // same hand twice. Checked against ids seen this session (covers hands
      // that ended with nothing worth recording) and against stored history
      // (covers a page reload mid-session).
      if (gameId && (seenGameIds.includes(gameId) || handAlreadyRecorded(gameId))) return;
      applyHandResultsAndReset();
      currentHand.gameId = gameId;
      if (gameId) {
        seenGameIds.push(gameId);
        if (seenGameIds.length > SEEN_GAME_IDS_MAX) seenGameIds.shift();
      }
      return;
    }

    if (type === 'postSB' || type === 'postBB') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      logAction(hand, xid, type === 'postSB' ? 'sb' : 'bb', amt);
      if (type === 'postSB') {
        hand.sbXid = xid;
        if (amt > 0) hand.sbAmount = amt;
      } else {
        hand.bbXid = xid;
        // The blind level, and the unit everything else can be expressed in.
        if (amt > 0) noteBlindLevel(hand, amt);
      }
      hand.playersIn.add(xid);
      return;
    }

    if (type === 'postDead') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      logAction(hand, xid, 'post', amt);
      // Deliberately no maybeCountVpip / maybeCountLimp: a dead blind is forced
      // money, not a voluntary decision.
      hand.playersIn.add(xid);
      return;
    }

    if (type === 'fold') {
      const xid = nameToXidGuess(cleanName(m[1]));
      recordStreetAction(xid, 'fold', hand);
      logAction(hand, xid, 'fold', 0);
      if (hand.street === 'preflop' && hand.threeBetActive && xid !== hand.threeBettorXid) {
        getPlayer(xid).foldTo3BetMade += 1;
        saveStore();
      } else if (hand.street !== 'preflop' && hand.cbetFacedThisStreet && xid !== hand.cbetFacedThisStreet) {
        getPlayer(xid).foldToCbetMade += 1;
        saveStore();
      }
      hand.playersIn.delete(xid);
      return;
    }

    if (type === 'check') {
      const xid = nameToXidGuess(cleanName(m[1]));
      recordStreetAction(xid, 'check', hand);
      logAction(hand, xid, 'check', 0);
      return;
    }

    if (type === 'call') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'call', hand);
      logAction(hand, xid, 'call', amt);
      maybeCountVpip(xid, hand);
      maybeCountLimp(xid, hand);
      return;
    }

    if (type === 'bet') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      const potBefore = hand.pot;
      noteBetSizing(xid, amt, potBefore);
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'bet', hand);
      logAction(hand, xid, 'bet', amt, { p: betSizePctOf(amt, potBefore) });
      maybeCountVpip(xid, hand);
      markAggressor(xid, hand);
      maybeCountCbet(xid, hand);
      return;
    }

    if (type === 'raise') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      const potBefore = hand.pot;
      noteBetSizing(xid, amt, potBefore);
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'raise', hand);
      logAction(hand, xid, 'raise', amt, { p: betSizePctOf(amt, potBefore) });
      markAsPreflopRaiseAction(xid, hand);
      return;
    }

    if (type === 'allin') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      const potBefore = hand.pot;
      if (amt) { noteBetSizing(xid, amt, potBefore); addContribution(hand, xid, amt); }
      recordStreetAction(xid, 'raise', hand);
      logAction(hand, xid, 'all-in', amt, { p: betSizePctOf(amt, potBefore) });
      markAsPreflopRaiseAction(xid, hand);
      return;
    }

    if (type === 'flop' || type === 'turn' || type === 'river') {
      hand.street = type;
      hand.potAtStreetStart = hand.pot; // fix SPR's denominator for this street
      hand.streetContributions = {};
      hand.cbetOpportunity = {};
      hand.cbetFacedThisStreet = null;
      const boardCards = parseCardsFromText(m[1] || '');
      // Deduped, because repairBoardFromDom may already have filled this street
      // in from the table. Without it a DOM repair followed by the log line for
      // the same street would list a card twice.
      if (boardCards.length) {
        hand.board = dedupeCards((type === 'flop') ? boardCards : hand.board.concat(boardCards));
      }
      if (hand.lastAggressor) {
        hand.cbetOpportunity[hand.lastAggressor] = true;
        getPlayer(hand.lastAggressor).cbetOpp += 1;
        saveStore();
      }
      return;
    }

    if (type === 'shows') {
      const xid = nameToXidGuess(cleanName(m[1]));
      // Guarded so the log and the seat-watcher can't both count the same
      // showdown — harvestShownCards may already have seen the cards flip.
      if (!hand.countedShowdown.has(xid)) {
        hand.countedShowdown.add(xid);
        getPlayer(xid).wtsd += 1;
      }
      // Parsed cards kept separately and banked at SETTLEMENT, not here: at this
      // point hand.winners is still empty (the "wins" lines come after the
      // reveals), so recording now would score every showdown as a loss.
      const revealed = parseCardsFromText(m[2]).slice(0, 2);
      if (revealed.length === 2) hand.shownCards[xid] = revealed;
      // Rendered through cardsGlyphText when the cards parsed, so this matches
      // what the seat-harvest path writes — see the note there. The raw log
      // text is kept only when the cards did NOT parse, where it is the only
      // evidence there is and a wrong-looking string beats no string.
      hand.shown[xid] = revealed.length === 2 ? cardsGlyphText(revealed) : squish(m[2], 40);
      hand.shownVia[xid] = hand.shownVia[xid] || 'log';
      logAction(hand, xid, 'shows', 0);
      saveStore();
      return;
    }

    if (type === 'wins') {
      // Deferred rather than settled immediately: split pots produce multiple
      // consecutive "X wins $Y" lines, and settling on the first would reset
      // hand state before the second winner's line arrives.
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      hand.winners.push({ xid, amount: amt });
      return;
    }
  }

  function parseAmount(str) {
    return parseInt(String(str).replace(/,/g, ''), 10) || 0;
  }

  // Short keys — this array is persisted for every retained hand, so verbose
  // field names would multiply storage for no benefit. `extra` merges in a
  // couple more short-keyed fields for specific action types — currently just
  // `p` (bet-as-%-of-pot, see betSizePctOf) on bet/raise/all-in — rather than
  // widening the signature every time one more is needed.
  function logAction(hand, xid, action, amount, extra) {
    hand.actions.push({ x: xid, a: action, amt: amount || 0, s: hand.street, ...(extra || {}) });
    // Seat scraping can't identify players on every table layout, and when it
    // fails dealtInXids stays empty — which would leave `hands` at zero and make
    // EVERY rate stat undefined. Treat anyone observed acting as dealt in.
    hand.dealtInXids.add(xid);
    if (action !== 'fold') hand.playersIn.add(xid);
    // Preflop action runs UTG -> ... -> BTN -> SB -> BB, so the order in which
    // players first act (blinds excluded) reconstructs the seating rotation
    // without needing to identify the dealer button in the DOM.
    if (hand.street === 'preflop' && action !== 'sb' && action !== 'bb'
        && !hand.actionOrder.includes(xid)) {
      hand.actionOrder.push(xid);
    }
  }

  // Bets needed before a sizing read is worth acting on. One 300%-pot
  // shove is not a sizing habit. The exploit plan has always gated on this;
  // the Stats tab used to print the figure with no indication of the sample.
  const BET_SIZE_MIN = 12;

  // Cap on betSizes, the rolling window the sizing median is computed from.
  // Bounded for the same reason recentTables is bounded (see emptyPlayer):
  // this is stored for every player forever, so it must not grow with hand
  // count the way the player list itself does (open finding #2). 40 is
  // comfortably above BET_SIZE_MIN and gives a stable median without turning
  // into a hand-by-hand log.
  const BET_SIZE_HISTORY_MAX = 40;

  // The sample the sizing median is ACTUALLY drawn from — betSizes, never
  // betSizeCount. Those two diverge for every record written before v1.21.0:
  // betSizes was added without a STORE_VERSION bump or a migration, so
  // ensurePlayerShape backfills it EMPTY while betSizeCount keeps its full
  // historical value. Gating on the lifetime count there let a single new bet
  // straight through BET_SIZE_MIN and then reported it as "median of 247
  // bets" — precisely the "one 300%-pot shove is not a sizing habit" case
  // that gate exists to stop, misfiring across the whole tracked pool for
  // each player's first BET_SIZE_MIN bets after the upgrade.
  //
  // So: gate on this, and report this, so the stated sample and the computed
  // figure can never describe different things again. betSizeCount survives
  // as the lifetime tally, shown separately where the distinction is useful.
  function betSizeSample(p) {
    return p && Array.isArray(p.betSizes) ? p.betSizes.length : 0;
  }

  // Same idea for the draw/made sizing split and the trap rate, but lower:
  // both are drawn from showdowns alone, which are inherently rarer than bets
  // in general (BET_SIZE_MIN's sample), so gating at the same figure would
  // mean these almost never show. Still a real floor, not "off on the first
  // occurrence" — see the "floor on a range" caveat on showdown data generally.
  const TEXTURE_MIN = 5;

  // Cap on drawSizes/madeSizes/bluffSizes, same reasoning as BET_SIZE_HISTORY_MAX
  // (rides on every player record forever). Lower than that 40, because a
  // showdown-categorised bet is already the rarer of the two samples — this is
  // a subset of the bets betSizes already sees, split three ways.
  const TEXTURE_BET_HISTORY_MAX = 25;

  // Pushes a bet-size-% sample into a bounded window, shared by all three
  // texture buckets so a size drifting out isn't three copies of the same cap
  // logic to keep in sync.
  function pushTextureSize(arr, pct) {
    if (typeof pct !== 'number') return;
    arr.push(pct);
    if (arr.length > TEXTURE_BET_HISTORY_MAX) arr.shift();
  }

  function noteBetSizing(xid, amt, potBefore) {
    const sizePct = betSizePctOf(amt, potBefore);
    if (sizePct == null) return;
    const p = getPlayer(xid);
    p.betSizeCount += 1;
    if (!Array.isArray(p.betSizes)) p.betSizes = [];
    p.betSizes.push(sizePct);
    if (p.betSizes.length > BET_SIZE_HISTORY_MAX) p.betSizes.shift();
  }

  // Same figure noteBetSizing folds into the rolling window, but kept per
  // ACTION (rounded, on the action record itself via logAction's `extra`)
  // rather than only ever summed — noteBetTexture needs to know what a
  // SPECIFIC bet cost, at settlement, without replaying the whole pot.
  function betSizePctOf(amt, potBefore) {
    return (amt && potBefore > 0) ? Math.round((amt / potBefore) * 100) : null;
  }

  function addContribution(hand, xid, amt) {
    hand.contributions[xid] = (hand.contributions[xid] || 0) + amt;
    hand.streetContributions[xid] = (hand.streetContributions[xid] || 0) + amt;
    hand.pot += amt;
  }

  // How many community cards are showing on each street. Shared, because both
  // the replayer and the board-texture collector below need to reconstruct the
  // board AS IT STOOD on a given street — hand.board is the FINAL board, so a
  // flop action has to be read against its first three cards, not all five.
  const BOARD_COUNT_FOR = { preflop: 0, flop: 3, turn: 4, river: 5 };

  function dedupeCards(cards) {
    const seen = new Set();
    return (cards || []).filter((c) => {
      const k = c.rank + c.suit;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // The log can miss a street's board line, and the flop is the one it misses.
  // Lines already on screen when the snapshot primes are deliberately NOT
  // parsed (see scanLogRows — they are a partial hand that is already over),
  // so a hand in progress at that moment loses its flop. The turn and river
  // then append to an empty board and the hand records as "reached river" with
  // two cards. Reported exactly that way, from a real hand.
  //
  // The table still has the cards, so read them off it. This only ever ADDS —
  // the log is authoritative whenever it is complete — and the result is
  // capped to what the street allows, so the board and the street can never
  // disagree. Running it live rather than only at settlement matters: board
  // TEXTURE stats are recorded per action during the hand, so a missing flop
  // would otherwise file every one of them against the wrong board.
  function repairBoardFromDom() {
    const hand = currentHand;
    if (!hand) return;
    const need = BOARD_COUNT_FOR[hand.street] || 0;
    const have = (hand.board || []).length;
    if (!need || have >= need) return;
    const dom = dedupeCards(readBoardCards());
    if (dom.length > have) hand.board = dom.slice(0, need);
  }

  // Did this hand's board ever get fully read? A stored hand that reached the
  // river with two cards is not a two-card board, it is a board this HUD only
  // partly saw — and printing it plainly reads as corruption. Callers say so
  // instead. Hands recorded before v1.17.0 have no board at all and are
  // excluded here: unknown is not the same as incomplete.
  function boardIsPartial(h) {
    const need = BOARD_COUNT_FOR[h && h.street] || 0;
    return !!(need && Array.isArray(h.board) && h.board.length && h.board.length < need);
  }

  // ===========================================================================
  // BOARD TEXTURE
  // ===========================================================================
  //
  // "Texture" already means something else in this file — `p.texture` is HAND
  // strength (made vs draw at showdown, v1.18.0). Everything here is board*/
  // boardTex* so the two can never be confused for each other.
  //
  // These are FLAGS, not one class per board. A board can be paired AND four to
  // a flush and both facts matter, so a first-match-wins list (the LOG_PATTERNS
  // / ARCHETYPE_RULES pattern used elsewhere) is wrong here: under a priority
  // order "paired" would silently come to mean "paired AND not flushy", a
  // conditional nobody reading the stat would assume, and each flag's sample
  // would be SMALLER because boards get carved away into whichever flag
  // outranks them. As flags, every paired board counts toward `pair`, full
  // stop.
  //
  // Deliberately few. Every flag is another column of an already-thin sample
  // (a four-flush board is rare), so each one has to earn its place.
  const BOARD_FLAGS = [
    { key: 'fl4', label: '4+ flush', hint: 'four or more of one suit on board' },
    { key: 'fl3', label: '3-flush', hint: 'exactly three of one suit on board' },
    { key: 'pair', label: 'paired', hint: 'the board itself is paired or better' },
    { key: 'str4', label: '4-straight', hint: 'four to a straight on board' },
    { key: 'dry', label: 'dry', hint: 'none of the above — no obvious draw or pair' },
  ];

  // Four board cards inside a five-card span, so one more card completes a
  // straight. Ace plays low as well as high, or A-2-3-4 would not register.
  // Needs four cards, so this can only ever fire on the turn or river.
  function fourToAStraight(cards) {
    const vals = cards.map((c) => rankIdx(c.rank) + 2).filter((v) => v >= 2);
    if (vals.includes(14)) vals.push(1);
    const uniq = Array.from(new Set(vals)).sort((a, b) => a - b);
    for (let i = 0; i + 3 < uniq.length; i += 1) {
      if (uniq[i + 3] - uniq[i] <= 4) return true;
    }
    return false;
  }

  // Which flags a board carries. Always returns at least one ('dry'), so every
  // observed action lands somewhere and the denominators stay comparable.
  // Returns [] for a board too short to have a texture at all.
  function boardFlags(cards) {
    const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.rank && c.suit);
    if (list.length < 3) return [];
    const flags = [];

    const bySuit = {};
    list.forEach((c) => { bySuit[c.suit] = (bySuit[c.suit] || 0) + 1; });
    const maxSuit = Math.max.apply(null, Object.keys(bySuit).map((k) => bySuit[k]));
    if (maxSuit >= 4) flags.push('fl4');
    else if (maxSuit === 3) flags.push('fl3');

    const byRank = {};
    list.forEach((c) => { byRank[c.rank] = (byRank[c.rank] || 0) + 1; });
    if (Object.keys(byRank).some((k) => byRank[k] >= 2)) flags.push('pair');

    if (fourToAStraight(list)) flags.push('str4');

    if (!flags.length) flags.push('dry');
    return flags;
  }

  // Per-flag action counters, stored SPARSELY (a flag never seen costs nothing)
  // and with one-letter keys, because this rides on every player record forever
  // and open finding #2 is about exactly that growth.
  //
  // The five counters mirror streetActions' vocabulary rather than collapsing
  // into a single aggression figure, and that split is what makes the stat
  // readable: postflop, `check` and `bet` are only possible when NOBODY has bet
  // yet, while `call`, `fold` and `raise` are only possible when facing a bet.
  // So the same five numbers answer two different questions cleanly — "do they
  // lead here" (b vs k) and "do they fold here" (f vs c+r) — the same insight
  // streetRates.rr already relies on.
  const BOARD_TEX_KEY = { bet: 'b', raise: 'r', call: 'c', check: 'k', fold: 'f' };

  function emptyBoardTexCell() {
    return { b: 0, r: 0, c: 0, k: 0, f: 0 };
  }

  function noteBoardTexture(p, action, street, board) {
    const need = BOARD_COUNT_FOR[street];
    if (!need) return;                       // preflop has no board
    const key = BOARD_TEX_KEY[action];
    if (!key) return;
    const showing = (board || []).slice(0, need);
    // A partially-parsed board would misclassify — a turn read against two
    // known cards could call a three-flush board dry. Skip rather than guess.
    if (showing.length < need) return;
    if (!p.boardTex || typeof p.boardTex !== 'object') p.boardTex = {};
    boardFlags(showing).forEach((f) => {
      const cell = p.boardTex[f] || (p.boardTex[f] = emptyBoardTexCell());
      cell[key] = (cell[key] || 0) + 1;
    });
  }

  function recordStreetAction(xid, action, hand) {
    if (hand.street === 'preflop') return; // preflop tallied via VPIP/PFR/3-bet counters instead
    const p = getPlayer(xid);
    if (!p.streetActions[hand.street]) return;
    p.streetActions[hand.street][action] = (p.streetActions[hand.street][action] || 0) + 1;
    // Same choke point, so board texture is collected for every postflop action
    // with no new call sites — and, like the board itself, with no hero gate:
    // a hand you folded preflop still runs out in the log and still tells you
    // how everyone else played that texture.
    noteBoardTexture(p, action, hand.street, hand.board);
    saveStore();
  }

  function markAggressor(xid, hand) {
    hand.lastAggressor = xid;
    hand.aggressorByStreet[hand.street] = xid;
  }

  function maybeCountVpip(xid, hand) {
    if (hand.street !== 'preflop' || hand.countedVpip.has(xid)) return;
    hand.countedVpip.add(xid);
    getPlayer(xid).vpip += 1;
    saveStore();
  }

  // A limp is a preflop CALL into an unraised pot. Counted once per hand per
  // player, off the same raise-event counter the coach uses.
  //
  // The big blind is excluded: with no raise to face they have nothing to call,
  // so a "call" line from the BB in an unraised pot is a completing action, not
  // a limp. Counting it would make every BB look like a habitual limper.
  //
  // Known imprecision, shared with the coach: preflopRaiseEvents counts an
  // all-in as a raise, so a short-stack all-in that is really a call can make a
  // genuine limp behind look like a call of a raise, and go uncounted.
  function maybeCountLimp(xid, hand) {
    if (hand.street !== 'preflop') return;
    if (hand.preflopRaiseEvents > 0) return;
    if (xid === hand.bbXid) return;
    if (hand.countedLimp.has(xid)) return;
    hand.countedLimp.add(xid);
    getPlayer(xid).limpMade += 1;
    saveStore();
  }

  function maybeCountPfr(xid, hand) {
    if (hand.street !== 'preflop' || hand.countedPfr.has(xid)) return;
    hand.countedPfr.add(xid);
    getPlayer(xid).pfr += 1;
    saveStore();
  }

  function maybeCountThreeBet(xid, hand) {
    if (hand.street !== 'preflop') return;
    // The 2nd preflop raise event is a 3-bet (blinds aren't raises). Tracked as a
    // separate event counter from PFR so a later 4-bet by the same original raiser
    // isn't mistaken for a second 3-bet.
    if (hand.preflopRaiseEvents === 2 && !hand.countedThreeBetOpp.has(xid)) {
      hand.countedThreeBetOpp.add(xid);
      getPlayer(xid).threeBetMade += 1;
      hand.threeBetActive = true;
      hand.threeBettorXid = xid;
      hand.playersIn.forEach((otherXid) => {
        if (otherXid !== xid) getPlayer(otherXid).foldTo3BetOpp += 1;
      });
      saveStore();
    }
  }

  // The bookkeeping a preflop RAISE and an ALL-IN share: both count as a raise
  // event for VPIP/PFR/3-bet purposes and both take the aggressor lead. Shared
  // by both dispatchLogEvent branches rather than duplicated, because they were
  // an exact copy of each other and the codebase's own open finding #3 is that
  // this equivalence is imprecise (a short-stack all-in CALL still counts as a
  // raise here) — one call site for that behaviour beats two that could drift
  // out of sync if it's ever fixed in only one of them.
  function markAsPreflopRaiseAction(xid, hand) {
    maybeCountVpip(xid, hand);
    if (hand.street === 'preflop') {
      hand.preflopRaiseEvents += 1;
      // Tier is read AFTER the increment, so the hand's first raise is tier 1
      // (an open), the second is 2 (a 3-bet), the third is 3 (a 4-bet). This is
      // the same counter maybeCountThreeBet keys off, so the tier recorded
      // against a showdown and the 3-bet stat can never disagree.
      const tier = hand.preflopRaiseEvents;
      if (!hand.preflopTier[xid] || tier > hand.preflopTier[xid]) hand.preflopTier[xid] = tier;
      // A raise from a player already counted as a limper THIS hand is a
      // limp-reraise. maybeCountLimp bails once preflopRaiseEvents > 0, so
      // countedLimp only ever holds players who put money in before any raise —
      // an ordinary raiser can never be in it, and this cannot false-fire.
      if (hand.countedLimp.has(xid) && !hand.limpRaised.has(xid)) {
        hand.limpRaised.add(xid);
        const lp = getPlayer(xid);
        lp.limpRaiseMade = (lp.limpRaiseMade || 0) + 1;
        saveStore();
      }
    }
    maybeCountPfr(xid, hand);
    maybeCountThreeBet(xid, hand);
    markAggressor(xid, hand);
  }

  function maybeCountCbet(xid, hand) {
    if (hand.street === 'preflop') return;
    if (hand.cbetOpportunity[xid]) {
      getPlayer(xid).cbetMade += 1;
      hand.cbetFacedThisStreet = xid;
      hand.playersIn.forEach((otherXid) => {
        if (otherXid !== xid) getPlayer(otherXid).foldToCbetOpp += 1;
      });
      saveStore();
    }
  }

  // ---- This-hand roles, for the seat badges ----------------------------------
  //
  // Who is the preflop raiser, and who has taken the betting lead off them
  // postflop. DERIVED from hand.actions on every render rather than tracked in
  // parallel state: there is nothing to keep in sync, it is correct after a
  // mid-hand re-render (badges redraw every 4s and on every log line), and it
  // empties itself at settlement because freshHandState() clears actions.
  //
  // `pfr` is the LAST preflop raiser, not the first. That is the seat everyone
  // else is playing against — in a 3-bet pot the 3-bettor holds the initiative,
  // and it is also the player c-bet tracking already treats as the aggressor.
  // hand.aggressorByStreet would give the same xid but not the raise COUNT,
  // which is what lets the tag say 3B/4B instead of a flat "PFR".
  //
  // Inherits the known imprecision noted in the header: an all-in is counted as
  // a raise, so a short-stack all-in CALL can inflate the tag by one level.
  function handRoles(hand) {
    const roles = { pfr: null, tag: null, post: {} };
    if (!hand || !hand.actions) return roles;
    let raises = 0;
    hand.actions.forEach((a) => {
      const aggressive = a.a === 'bet' || a.a === 'raise' || a.a === 'all-in';
      if (a.s === 'preflop') {
        if (aggressive) { raises += 1; roles.pfr = a.x; }
        return;
      }
      if (!aggressive || a.x === roles.pfr) return;
      // Aggression postflop from someone who was NOT the preflop raiser. Only
      // one player can open a street, so a `bet` here is a donk lead; a raise is
      // a check-raise or a raise of the c-bet. Both say the same thing — the
      // initiative has changed hands — but they are different enough reads to
      // name separately. Latest action wins, so the tag tracks the live street.
      roles.post[a.x] = (a.a === 'bet') ? 'DONK' : 'RR';
    });
    roles.tag = roles.pfr ? (raises <= 1 ? 'PFR' : (raises + 1) + 'B') : null;
    return roles;
  }

  function applyHandResultsAndReset() {
    // One last look at the table before the hand is banked, while the cards are
    // still up AND the hand is still live — the only moment both are true.
    //
    // harvestShownCards normally runs on a 1s poll, but reveals land
    // immediately BEFORE the "wins" line that settles the hand. A
    // reveal-then-settle inside a single poll gap was therefore never
    // captured: by the time the next tick came round currentHand was null and
    // the poll bailed, even though the cards sat on the table for seconds
    // afterwards. That is why a hand could reach showdown and record nobody as
    // having shown anything.
    harvestShownCards();
    repairBoardFromDom();
    if (currentHand) applyHandResults(currentHand);
    currentHand = freshHandState();
  }

  function applyHandResults(hand) {
    // "Hands observed" denominator uses who was dealt in at hand start, not just
    // who ended up contributing chips — someone who folds preflop with no money
    // in yet still counts as a hand where they didn't VPIP.
    // Defensive reads: a throw anywhere in applyHandResults loses the whole
    // hand, including the P/L. A hand from freshHandState always has these, but
    // a replayed or hand-edited record may not, and dropping a stat is a far
    // better failure than dropping the settlement.
    const inSet = (s, x) => !!(s && typeof s.has === 'function' && s.has(x));

    // Winners are needed before the per-hand window is written, so the "won"
    // bit can go in with the play state rather than needing a second pass.
    const wonByXid = {};
    if (hand.winners.length > 0) {
      const unknown = hand.winners.filter((w) => !w.amount).length;
      const fallbackShare = unknown ? Math.round(hand.pot / hand.winners.length) : 0;
      hand.winners.forEach((w) => {
        wonByXid[w.xid] = (wonByXid[w.xid] || 0) + (w.amount || fallbackShare);
      });
    }

    const settleBB = plausibleBB(hand.bbAmount || lastSeenBB) ? (hand.bbAmount || lastSeenBB) : 0;

    let heroPlayCode = null; // captured below, for the session vpip/pfr tally
    hand.dealtInXids.forEach((xid) => {
      const p = getPlayer(xid);
      p.hands += 1;
      // Which stakes this player is usually found at. Keyed by blind level
      // rather than table name so a rename in TORN_STAKES doesn't orphan the
      // stored counts.
      if (settleBB > 0) {
        if (!p.tables || typeof p.tables !== 'object') p.tables = {};
        p.tables[settleBB] = (p.tables[settleBB] || 0) + 1;
        noteRecentTable(p, settleBB);
      }
      const play = inSet(hand.countedPfr, xid) ? 2 : inSet(hand.countedVpip, xid) ? 1 : 0;
      if (xid === heroXid) heroPlayCode = play;
      pushRecent(p, play | (wonByXid[xid] > 0 ? RECENT_WON : 0));

      // A pot lost big enough to plausibly set someone off. Recorded against
      // their own hand count so "how long ago" needs no upkeep between hands.
      if (settleBB > 0) {
        const net = (wonByXid[xid] || 0) - (hand.contributions[xid] || 0);
        if (net / settleBB <= -BIG_LOSS_BB) p.lastBigLossHand = p.hands;
      }
    });
    const heroDealtIn = !!(heroXid && hand.dealtInXids.has(heroXid));
    if (heroDealtIn) STORE.hero.hands += 1;
    touchSession(0, heroDealtIn);
    // Session-level VPIP/PFR/AFq, for the Trends tab — touchSession above has
    // already rolled the session over if a gap fired, so STORE.session is
    // guaranteed to be THIS hand's session by the time these run.
    if (heroDealtIn) {
      if (settleBB > 0) STORE.session.bb = settleBB;
      if (heroPlayCode >= 1) STORE.session.vpip += 1;
      if (heroPlayCode >= 2) STORE.session.pfr += 1;
      // Same aggressive/passive split as computeRates' AFq (bet+raise+all-in
      // vs call; checks and folds excluded, see the comment on that field) —
      // tallied here from hand.actions rather than streetActions because
      // there is no per-player postflop total to read back from that machinery,
      // only the running per-street counters it writes into.
      hand.actions.forEach((a) => {
        if (a.x !== heroXid || a.s === 'preflop') return;
        if (a.a === 'bet' || a.a === 'raise' || a.a === 'all-in') STORE.session.aggActions += 1;
        else if (a.a === 'call') STORE.session.passActions += 1;
      });
    }

    if (hand.winners.length > 0) {
      // wonByXid was built above, before the per-hand window was written — it
      // carries the "did the log print an amount" fallback, which leaving at 0
      // would score a WIN as losing everything the winner had contributed.
      const contributors = Object.keys(hand.contributions);

      if (heroXid) {
        const heroWon = wonByXid[heroXid] || 0;
        const heroContributed = hand.contributions[heroXid] || 0;
        const heroDelta = heroWon - heroContributed;
        STORE.hero.netChips += heroDelta;
        touchSession(heroDelta, false);

        // Big blinds are the only comparable unit: "+$412M" says nothing about
        // whether you are beating the game, and a chip figure cannot be
        // converted afterwards because the blind level isn't stored per hand in
        // older records. Convert now, or not at all.
        // plausibleBB gates this: in BB display mode every amount parses tiny,
        // and pricing a hand off a bogus blind writes a permanently wrong
        // win rate. Better to record chips only.
        const rawBB = hand.bbAmount || lastSeenBB;
        const bb = plausibleBB(rawBB) ? rawBB : 0;
        const heroDeltaBB = bb > 0 ? heroDelta / bb : 0;
        if (bb > 0) {
          STORE.hero.netBB += heroDeltaBB;
          STORE.hero.bbHands += 1; // denominator for bb/100, only over hands we could price
        }

        // The per-hand ledger, from the exact same heroDelta/bb this just used
        // to update hero.netChips/netBB — never recomputed, so the two can
        // never disagree. Tightened to !heroUnresolved() rather than the bare
        // `heroXid` this block is already gated on: a `name:` pseudo-id always
        // nets to a harmless 0 here (nothing in hand.contributions/wonByXid is
        // keyed by a pseudo-id), which is fine as a no-op but would otherwise
        // fill the ledger with meaningless zero rows for a hero who was never
        // actually resolved to a seat.
        if (!heroUnresolved()) pushLedgerEntry(heroDelta, bb, hand.gameId || null);

        // P/L attribution, stored from HERO's perspective: positive plChipsEst
        // means you are up against that player.
        //
        // Money you win comes from the players who LOST this hand, and money you
        // lose goes to the players who WON it — so split by each opponent's net
        // result, not by what they put in. The old version divided each
        // opponent's contribution by the total contributed INCLUDING hero's own,
        // so the shares never summed to 1: heads-up each player puts in half the
        // pot, so a villain was credited with exactly HALF the money you won
        // from them. It also charged a loss to opponents who folded early and
        // lost nothing to you, while crediting nothing extra to whoever actually
        // took the pot.
        //
        // This version is exact heads-up and sums to heroDelta multiway. It is
        // still an estimate in one respect: with three or more players it cannot
        // know whose chips ended up in whose stack, only the net movement.
        const net = {};
        let poolTotal = 0;
        for (const xid of contributors) {
          if (xid === heroXid) continue;
          const oppNet = (wonByXid[xid] || 0) - hand.contributions[xid];
          // Hero won -> draw from opponents who lost. Hero lost -> credit the
          // opponents who won. Either way we want the opposite sign to hero's.
          const weight = heroDelta >= 0 ? Math.max(0, -oppNet) : Math.max(0, oppNet);
          if (weight > 0) { net[xid] = weight; poolTotal += weight; }
        }
        if (poolTotal > 0) {
          for (const xid of Object.keys(net)) {
            const share = net[xid] / poolTotal;
            getPlayer(xid).plChipsEst += heroDelta * share;
            if (bb > 0) getPlayer(xid).plBBEst += heroDeltaBB * share;
          }
        }
      }
    }

    // Banked here, after winners are known, so `won` is right and so a hand
    // that never reached settlement doesn't pollute the range.
    Object.keys(hand.shownCards || {}).forEach((xid) => {
      noteShowdown(xid, hand.shownCards[xid], hand);
      noteBetTexture(xid, hand.shownCards[xid], hand);
    });

    recordHandHistory(hand);
    saveStore();
    finalizeHand();
  }

  // A hand that survives the recency cap rather than being evicted with
  // everything else its age — see trimHandHistory. Two triggers, both in big
  // blinds since a raw chip figure means nothing across stakes:
  //   - the pot reached NOTABLE_POT_BB_THRESHOLD, a judgement call (borrowed
  //     from HopesG's HUD, GreasyFork 569933, same status as POOL_AVG — not
  //     independently measured), or
  //   - a preflop raise reached NOTABLE_PREFLOP_RAISE_BB, sized big enough
  //     that it was a real preflop decision rather than a min-raise.
  // Needs hand.bbAmount to mean anything; with no readable blind (bb <= 0)
  // neither check can fire, so an unpriceable hand is never pinned — an
  // unknown size is not evidence of a big one.
  const NOTABLE_POT_BB_THRESHOLD = 40;
  const NOTABLE_PREFLOP_RAISE_BB = 4;
  function isNotableHand(hand) {
    const bb = hand.bbAmount;
    if (!plausibleBB(bb)) return false;
    if (hand.pot / bb >= NOTABLE_POT_BB_THRESHOLD) return true;
    return (hand.actions || []).some((a) => a.s === 'preflop' && a.a === 'raise'
      && a.amt >= NOTABLE_PREFLOP_RAISE_BB * bb);
  }

  // Hard ceiling on total stored hands, pinned or not — see trimHandHistory.
  // Measured cost is ~1.3KB/hand at historyLimit's 200 (CLAUDE.md "Storage,
  // and what it costs"), so 500 tops out around 650KB — small next to the 5MB
  // estimated quota, and prunePlayers/the storage-warning banner are the
  // independent backstop if it ever isn't.
  const HISTORY_PINNED_CEILING = 500;

  // Evict oldest UNPINNED entries first once over `limit`; pinned entries
  // survive past that, up to the hard `pinnedCeiling` — beyond which even a
  // pinned hand is evicted, oldest first, same as prunePlayers' cap.
  // `hands` is newest-first throughout (recordHandHistory unshifts, mergeHands
  // sorts by t descending), so a single left-to-right walk keeps everything in
  // its original relative order without needing to re-sort.
  function trimHandHistory(hands, limit, pinnedCeiling) {
    if (hands.length <= limit) return hands;
    const kept = [];
    let unpinnedKept = 0;
    for (const h of hands) {
      if (h.pinned) { kept.push(h); continue; }
      if (unpinnedKept < limit) { kept.push(h); unpinnedKept++; }
    }
    return kept.length > pinnedCeiling ? kept.slice(0, pinnedCeiling) : kept;
  }

  // Keep one global newest-first list rather than a per-player copy: a hand
  // involves several players, and the History tab just filters this list.
  function recordHandHistory(hand) {
    if (!hand.actions.length && !hand.winners.length) return; // nothing happened
    if (hand.gameId && handAlreadyRecorded(hand.gameId)) return; // already filed
    STORE.hands.unshift({
      t: Date.now(),
      g: hand.gameId || null,
      street: hand.street,
      pot: hand.pot,
      players: Array.from(hand.dealtInXids),
      actions: hand.actions,
      winners: hand.winners,
      shown: hand.shown,
      shownVia: hand.shownVia || {},
      heroCards: hand.heroCards || null,
      // Community cards as they stood at the end of the hand — was tracked
      // live on hand.board (see the flop/turn/river log handler) but never
      // persisted until v1.17.0's replayer needed it. A hand recorded before
      // this has board: undefined; replayStepsFor treats that as "unknown"
      // rather than an empty (and misleadingly complete-looking) board.
      board: hand.board || [],
      // Blind level at the time, so a stored pot can be priced in big blinds
      // afterwards. isNotableHand already needed hand.bbAmount at record time
      // and then threw it away, which left the History tab unable to say
      // whether a pot was big without guessing from the other hands on screen.
      // Absent (0) on anything recorded before v1.35.0 — handNotability falls
      // back to a median comparison rather than treating unknown as small.
      bb: hand.bbAmount || 0,
      pinned: isNotableHand(hand),
    });
    const limit = STORE.settings.historyLimit || 200;
    STORE.hands = trimHandHistory(STORE.hands, limit, HISTORY_PINNED_CEILING);
  }

  // Has this Torn game id already been written to history? Only the newest few
  // are checked — a re-read of the log can only ever replay lines still on
  // screen, and scanning the whole ring buffer on every marker is wasted work.
  const RECORDED_LOOKBACK = 50;
  function handAlreadyRecorded(gameId) {
    if (!gameId) return false;
    const recent = STORE.hands || [];
    const n = Math.min(recent.length, RECORDED_LOOKBACK);
    for (let i = 0; i < n; i++) { if (recent[i] && recent[i].g === gameId) return true; }
    return false;
  }

  // "#<xid>" is emptyPlayer's placeholder, not a name anyone chose. Treat it as
  // absent so a stored placeholder can never shadow a real name, and so callers
  // can tell the two apart.
  // Why hero can't be identified, or null if all is well.
  //
  // This failing is not cosmetic: with heroXid null, applyHandResults skips P/L
  // attribution entirely, so EVERY opponent's P/L stays frozen at zero, and
  // renderBadges can't tell which seat is yours so it draws a tendency badge on
  // your own seat. Both look like separate bugs and are the same missing
  // setting, so say so where the numbers are read instead of failing silently.
  // "Resolved" means bound to a real seat XID. A "name:<username>" pseudo-id is
  // NOT resolved — it is what nameToXidGuess returns when no seat matched — but
  // it IS a truthy string, which is exactly how it used to defeat the `!heroXid`
  // retry guard in bootstrapTableWatchers and freeze P/L at zero. Every check
  // for hero identity goes through here so that can't be reintroduced piecemeal.
  function heroUnresolved() {
    return !heroXid || String(heroXid).startsWith('name:');
  }

  function heroProblem() {
    if (!heroUnresolved()) return null; // bound to a seat — nothing to report

    const configured = (STORE.settings.heroName || '').trim();
    if (String(heroXid).startsWith('name:')) {
      return `“${configured}” matched by name but not to a seat ID yet — sit at a table for this to resolve.`;
    }
    // Since 0.22.0 your seat is read straight from the DOM, so the username is
    // only needed on a layout that doesn't render the marker. Say that rather
    // than demanding a setting that may not be the actual problem.
    if (!configured) {
      return 'Not seated yet, or your seat could not be identified. Sit at a table — '
        + 'if this persists, set “Your Torn username” below as a fallback. '
        + 'Until it resolves, no profit/loss is attributed to anyone.';
    }
    return `No seat matches the username “${configured}”, and no seat is marked as yours. `
      + 'Check the spelling against your seat — until it matches, no profit/loss is attributed to anyone.';
  }

  function playerDisplayName(xid) {
    const p = STORE.players[xid];
    const placeholder = '#' + xid;
    if (p && p.name && p.name !== placeholder) return p.name;
    return String(xid).startsWith('name:') ? String(xid).slice(5) : placeholder;
  }

  // Render one stored hand as a compact, readable summary.
  function formatHand(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const pin = h.pinned ? ' 📌' : '';
    const lines = [`[${when}] pot ${fmtMoney(h.pot)} — reached ${h.street}${pin}`];
    // A hand recorded before v1.17.0 has board: undefined, not an empty board
    // — the replayer treats those differently ("unknown" vs "no cards fell"),
    // and so does this: silently omit the line rather than claim a known-empty
    // board for a hand this HUD never actually captured one on.
    // A board shorter than the street implies is flagged, never printed as if
    // it were the whole board — see boardIsPartial. The tab, the clipboard and
    // the file must not describe the same hand differently.
    if (Array.isArray(h.board) && h.board.length) {
      lines.push(`  board: ${cardsGlyphText(h.board)}`
        + (boardIsPartial(h) ? `  (partial — ${h.board.length} of ${BOARD_COUNT_FOR[h.street]} seen)` : ''));
    }
    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      // 'shows' is a reveal, not a betting action, and the showdown lines below
      // already report it WITH the cards. Left in, it rendered a bare
      // "JonnySince shows" mid-street — an action with no amount that reads as
      // truncated — and then said the same thing again two lines down.
      const acts = byStreet[street].filter((a) => a.a !== 'shows').map((a) => {
        const nm = playerDisplayName(a.x);
        const mark = (focusXid && a.x === focusXid) ? '*' : '';
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        return `${mark}${nm} ${a.a}${amt}`;
      }).join(', ');
      if (acts) lines.push(`  ${street}: ${acts}`);
    });
    Object.keys(h.shown || {}).forEach((xid) => {
      lines.push(`  showdown: ${playerDisplayName(xid)} shows ${h.shown[xid]}`);
    });
    (h.winners || []).forEach((w) => {
      lines.push(`  → ${playerDisplayName(w.xid)} wins ${fmtMoney(w.amount)}`);
    });
    return lines.join('\n');
  }

  // History styling is INLINE with !important, not class-based.
  //
  // Two class-based attempts were reported unreadable on the live page — first a
  // recessed card relying on inherited text colour, then a lighter card with
  // `!important` in our own stylesheet. Both lost, while the Stats tab in the
  // same panel rendered perfectly, which rules out the panel and inheritance and
  // means Torn has a rule beating ours on specificity. An inline declaration
  // marked !important is the highest-priority thing in CSS: no stylesheet can
  // override it, so this stops being a contest we can lose.
  //
  // Keep the classes on the elements too — they still carry layout, and
  // .tph-hh-me is used to colour the legend line.
  const HH = {
    card: 'background:#2a2a33 !important;color:#f2f4f6 !important;border:1px solid #3d3d48;'
      + 'border-left:3px solid #6b8cae;border-radius:5px;padding:8px 10px;margin-bottom:9px;',
    head: 'color:#a8b2bd !important;font-size:11px;margin-bottom:6px;',
    row: 'color:#f2f4f6 !important;font-size:12.5px;line-height:1.6;',
    street: 'color:#8ec5f0 !important;display:inline-block;min-width:54px;font-size:10px;'
      + 'text-transform:uppercase;letter-spacing:0.5px;',
    me: 'color:#ffc94d !important;font-weight:700;',
    showdown: 'color:#d4b3f0 !important;font-size:11.5px;margin-top:4px;',
    win: 'color:#8ce89a !important;font-size:12.5px;margin-top:4px;',
  };

  // The ACTION word, coloured by what it is. Asked for directly: "highlight any
  // betting action in the font color too."
  //
  // A street reads as a run of near-identical text — "Name call $2M, Name
  // check, Name raise $8M" — and the one thing you are scanning for is where
  // the money went in. Colour carries that without adding a single character,
  // which matters on an element already width-starved.
  //
  // Aggression is warm and separated by degree (a raise is louder than a bet),
  // continuing is cool, and declining is grey. NOT red/green: the same rule the
  // deviation indicators follow — a raise is not "bad" and a fold is not
  // "good", they are different actions, and a good/bad palette would assert a
  // judgement this file is in no position to make.
  //
  // Inline and !important like the rest of HH, and for the same reason: two
  // class-based attempts were reported unreadable because Torn's own stylesheet
  // beat ours on specificity.
  const HH_ACT = {
    raise: 'color:#ff7b5c !important;font-weight:700;',
    bet: 'color:#ffa04d !important;font-weight:700;',
    call: 'color:#7fb3e0 !important;',
    check: 'color:#98a2ac !important;',
    fold: 'color:#6e767e !important;',
    post: 'color:#6e767e !important;',
  };

  // Unknown verbs render unstyled rather than being forced into a bucket. The
  // log has surprised this file before, and a wrong colour is a confident wrong
  // answer where no colour is merely plain.
  function actionStyle(a) { return HH_ACT[a] || ''; }

  // Same hand as formatHand, rendered as markup instead of a line of text.
  // formatHand is kept for the Copy button — clipboard output should stay plain
  // text — so the two must be changed together if the content changes.
  function formatHandHtml(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    // Same 📌 formatHand prints in plain text — the tab, the clipboard and the
    // file must never drift into three descriptions of the same hand. Marks a
    // notable hand (see isNotableHand) that survives the history cap longer
    // than an ordinary one, so it not being just another card in the list.
    const pin = h.pinned ? ' <span title="Notable — kept longer than the usual cap">📌</span>' : '';
    const parts = [`<div class="tph-hh-head" style="${HH.head}">${escapeHtml(when)} · pot ${fmtMoney(h.pot)}`
      + ` · reached ${escapeHtml(h.street || 'preflop')}${pin}</div>`];
    // Same omission rule as formatHand: no line at all for a hand recorded
    // before board was persisted (v1.17.0), rather than claiming an empty one.
    if (Array.isArray(h.board) && h.board.length) {
      parts.push(`<div class="tph-hh-row" style="${HH.row}">board: <b>${escapeHtml(cardsGlyphText(h.board))}</b>`
        + (boardIsPartial(h)
          ? ` <span class="tph-hh-partial" title="The log's board line for one street was missed — most often the flop, when the hand was already running as the HUD started reading the log. The cards shown are the ones it did see.">partial: ${h.board.length} of ${BOARD_COUNT_FOR[h.street]}</span>`
          : '') + '</div>');
    }

    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      // See formatHand: 'shows' is filtered here too, and a street left with no
      // betting action is dropped rather than rendered empty. The tab and the
      // clipboard must not describe the same hand differently.
      const acts = byStreet[street].filter((a) => a.a !== 'shows').map((a) => {
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        // The NAME carries the focus highlight, the VERB carries the action
        // colour, and they are separate spans so neither overrides the other.
        // An inline colour on the inner span wins over the outer one whatever
        // !important either carries, because the outer only ever reaches the
        // inner by inheritance — which is exactly the layering wanted here:
        // gold name, coloured verb, on the same line.
        const st = actionStyle(a.a);
        const verb = st
          ? `<span class="tph-hh-act" style="${st}">${escapeHtml(a.a)}${amt}</span>`
          : `${escapeHtml(a.a)}${amt}`;
        const name = escapeHtml(playerDisplayName(a.x));
        return (focusXid && a.x === focusXid)
          ? `<span class="tph-hh-me" style="${HH.me}">${name}</span> ${verb}`
          : `${name} ${verb}`;
      }).join(', ');
      if (acts) {
        parts.push(`<div class="tph-hh-row" style="${HH.row}">`
          + `<span class="tph-hh-st" style="${HH.street}">${street}</span>${acts}</div>`);
      }
    });

    Object.keys(h.shown || {}).forEach((xid) => {
      parts.push(`<div class="tph-hh-sd" style="${HH.showdown}">showdown: ${escapeHtml(playerDisplayName(xid))}`
        + ` shows ${escapeHtml(h.shown[xid])}</div>`);
    });
    (h.winners || []).forEach((w) => {
      parts.push(`<div class="tph-hh-win" style="${HH.win}">→ ${escapeHtml(playerDisplayName(w.xid))}`
        + ` wins ${fmtMoney(w.amount)}</div>`);
    });
    return `<div class="tph-hh" style="${HH.card}">${parts.join('')}</div>`;
  }

  function handsInvolving(xid) {
    return (STORE.hands || []).filter((h) => (h.players || []).includes(xid)
      || (h.actions || []).some((a) => a.x === xid));
  }

  // --- Per-player hand notability (v1.35.0) --------------------------------
  //
  // NOT the same question as isNotableHand, and the two must not be conflated.
  // isNotableHand asks "was this hand big" about the TABLE, to decide what
  // survives the storage cap. This asks what the History tab actually needs:
  // did THIS player do anything here, and was any of it interesting? A 60bb
  // pot that two other players fought over is notable for the table and
  // completely uninteresting for the seat you are reading about.
  //
  // Reported: "I don't want it to show all hands because that includes hands
  // they fold too without any calling or raising ... I want it to highlight
  // hands that are interesting or out of blue, like big pots, or highlight
  // interesting 3bets or reraise."
  //
  // Everything below comes off h.actions, which already stores {x, a, amt, s}
  // for every action and is persisted in full. No new collection, and it works
  // RETROACTIVELY on every hand already in the store — the fifth time
  // "check whether it's already collected" has paid off in this file.

  // 'post' is a blind you had no choice about, 'check' is declining to invest,
  // 'fold' is leaving. None is money the player CHOSE to put in — which is
  // exactly the distinction the History tab was missing.
  const VOLUNTARY_ACTIONS = { call: 1, bet: 1, raise: 1 };

  // A pot this many times the median of the hands on screen counts as big.
  // Relative rather than absolute because the stored record carries no blind
  // level before v1.35.0, and because the user plays more than one stake — a
  // fixed chip figure would call every hand at the higher stake "big".
  const BIG_POT_MEDIAN_MULT = 2.5;
  // Used instead whenever the hand DOES carry a blind level, so the threshold
  // means the same thing regardless of what else is on screen.
  const BIG_POT_BB = 40;

  // Score thresholds. WON alone (10) deliberately does NOT clear the bar:
  // winning a pot everyone folded to is not an interesting hand, it is most
  // hands. Showdown does clear it — cards face-up is the only direct evidence
  // of a range this HUD ever gets.
  const NOTABLE_SCORE_MIN = 50;

  // Every tag key handNotability can emit. Declared once so a test can assert
  // each has a CSS rule: the class is built as `tph-hh-tag-${key}`, so a key
  // with no matching rule renders an unstyled grey chip and nothing errors —
  // the same silent-typo hazard CLAUDE.md records for coach relevance tokens.
  // no-orphans' literal scan cannot see a concatenated class (the prefix is in
  // its DYNAMIC_PREFIXES), so test/hand-notability.test.js covers them
  // instead — exactly the split BOARD_FLAGS already uses.
  const HAND_TAG_KEYS = ['4B', '3B', 'XR', 'RR', 'BIG', 'SD', 'WON'];

  function handNotability(h, xid, ctx) {
    const mine = (h.actions || []).filter((a) => String(a.x) === String(xid));
    const voluntary = mine.some((a) => VOLUNTARY_ACTIONS[a.a]);
    const tags = [];
    let score = 0;
    const add = (key, label, title, points) => { tags.push({ key, label, title }); score += points; };

    // Preflop raise TIER, counted by walking the street in order: the first
    // raise is an open, the second a 3-bet, the third a 4-bet. Same counting
    // maybeCountThreeBet uses, so a tier shown here can't disagree with the
    // 3-bet stat. Inherits open finding #3 — an all-in counts as a raise, so
    // a short-stack all-in CALL can read one tier high.
    let raisesSoFar = 0;
    let tier = 0;
    (h.actions || []).forEach((a) => {
      if (a.s !== 'preflop' || a.a !== 'raise') return;
      raisesSoFar++;
      if (String(a.x) === String(xid)) tier = Math.max(tier, raisesSoFar);
    });
    // OFF BY ONE IS THE TRAP HERE, and it is worth stating: the Nth raise of a
    // street is an (N+1)-bet, because the blind is the first bet. The opening
    // raise is the 1st raise, a 3-bet is the 2nd, a 4-bet the 3rd, a 5-bet the
    // 4th. An earlier draft labelled the 4th raise "4B" and the test written
    // alongside it asserted exactly that, so both agreed and both were wrong.
    //
    // The CLASS stays '4B' for anything at or above a 4-bet so the CSS rule
    // set stays finite; only the LABEL counts on.
    if (tier >= 2) {
      const betLevel = tier + 1;
      add(tier === 2 ? '3B' : '4B', `${betLevel}B`,
        `Made preflop raise number ${tier} — a ${betLevel}-bet.`,
        tier === 2 ? 80 : 100);
    }

    // Check-raise, and postflop re-raise. Checked FIRST on the same street
    // then raised is the stronger, rarer line, so the two are exclusive rather
    // than both firing on the same action.
    let checkRaised = false;
    let postflopRaise = false;
    ['flop', 'turn', 'river'].forEach((street) => {
      const onStreet = mine.filter((a) => a.s === street);
      const raiseAt = onStreet.findIndex((a) => a.a === 'raise');
      if (raiseAt === -1) return;
      postflopRaise = true;
      if (onStreet.slice(0, raiseAt).some((a) => a.a === 'check')) checkRaised = true;
    });
    if (checkRaised) add('XR', 'XR', 'Check-raised: checked, then raised the same street.', 70);
    else if (postflopRaise) add('RR', 'RR', 'Raised postflop.', 60);

    // Big pot. Prefers the hand's own blind level when it has one (v1.35.0
    // onward); otherwise relative to the other hands on screen, which needs
    // nothing stored and adapts to whatever stake is being played.
    const bigByBB = plausibleBB(h.bb) && (h.pot / h.bb) >= BIG_POT_BB;
    const bigByMedian = !plausibleBB(h.bb) && ctx && ctx.medianPot > 0
      && h.pot >= ctx.medianPot * BIG_POT_MEDIAN_MULT;
    if (bigByBB || bigByMedian) {
      add('BIG', 'BIG', bigByBB
        ? `Pot reached ${Math.round(h.pot / h.bb)} big blinds.`
        : `Pot was ${(h.pot / ctx.medianPot).toFixed(1)}x the median of the hands shown.`, 55);
    }

    if (h.shown && h.shown[xid]) {
      add('SD', 'SD', `Showed ${h.shown[xid]} at showdown — direct evidence of their range.`, 50);
    }
    if ((h.winners || []).some((w) => String(w.xid) === String(xid))) {
      const amt = (h.winners || []).filter((w) => String(w.xid) === String(xid))
        .reduce((s, w) => s + (w.amount || 0), 0);
      add('WON', 'WON', `Won ${fmtMoney(amt)}.`, 10);
    }

    return { voluntary, acted: mine.length > 0, score, tags, notable: score >= NOTABLE_SCORE_MIN };
  }

  // A hand nobody ever bet or raised in: limped or checked round preflop, then
  // checked down. Reported directly — "remove histories with no action preflop
  // and became a check down pot."
  //
  // The test is aggression by ANYONE, not by the player being read. A pot with
  // no bet in it teaches you nothing about anybody: nobody was ever put to a
  // decision, so no fold, call or raise in it carries information. That is why
  // it is one predicate over the whole hand rather than something folded into
  // handNotability, which asks a per-player question.
  //
  // An EMPTY action list is not passive, it is unknown — a hand joined mid-way,
  // or recorded before actions were persisted. Dropping those would quietly
  // delete history this HUD simply failed to capture, so they survive.
  function handHadNoAggression(h) {
    const acts = (h && h.actions) || [];
    if (!acts.length) return false;
    return !acts.some((a) => a.a === 'bet' || a.a === 'raise');
  }

  // The three History filters. 'played' is the default because a list where
  // most rows are "folded preflop, did nothing" buries the hands that carry a
  // read — which is what was reported.
  //
  // Played and Notable both drop no-aggression hands; All does not, and that
  // asymmetry is deliberate. "All" has to mean all, or the count line is
  // lying and there is no way left to see a hand the filter has an opinion
  // about. It is the escape hatch, so it stays honest.
  const HISTORY_FILTERS = {
    played: { label: 'Played', title: 'Hands where they called, bet or raised at least once. Blinds and checks alone do not count, and pots nobody ever bet in are dropped.' },
    notable: { label: 'Notable', title: 'Only hands carrying a marker — 3-bet, check-raise, postflop raise, big pot or showdown.' },
    all: { label: 'All', title: 'Every hand they were dealt into — folds, and pots that were checked down with no bet in them.' },
  };

  // The tag chips, ANDed. Every selected one must be present on the hand.
  //
  // AND rather than OR because the question these answer is "show me the spot
  // I am thinking of" — 3-bet AND showdown is a handful of hands worth reading;
  // 3-bet OR showdown is most of the list, which is what the mode chips
  // already do. Nothing selected means no tag constraint at all.
  //
  // ME is not one of handNotability's tags — it is about HERO, not about the
  // player whose panel this is — so it is defined here and applied separately.
  const HISTORY_TAG_ME = 'ME';

  // Chip tooltips. Kept beside the keys rather than derived from the tag
  // titles handNotability emits, because those are per-firing sentences
  // ("Pot reached 62 big blinds") and a filter chip has to describe the whole
  // class it selects.
  const HISTORY_TAG_TITLES = {
    '3B': 'Hands where they 3-bet preflop.',
    '4B': 'Hands where they 4-bet or more preflop.',
    XR: 'Hands where they check-raised — checked, then raised the same street.',
    RR: 'Hands where they raised postflop.',
    BIG: 'Hands where the pot got big for the stake.',
    SD: 'Hands they showed down — the only direct evidence of their range.',
    WON: 'Hands they won.',
    ME: 'Hands you played too — called, bet or raised. Blinds and checks do not count.',
  };

  // Hero played this hand voluntarily. Deliberately reuses handNotability's own
  // `voluntary` rather than a second definition of "involved": a blind you had
  // no choice about, or a check, is not tangling with this villain, and having
  // two answers to that question in one file is how they drift apart.
  function heroPlayedHand(h, ctx) {
    if (heroUnresolved()) return false;
    return handNotability(h, heroXid, ctx).voluntary;
  }

  // `tags` is a Set/array of tag keys (HAND_TAG_KEYS plus HISTORY_TAG_ME), all
  // required. Absent or empty means unconstrained.
  function filterHandsFor(hands, xid, mode, ctx, tags) {
    const want = Array.from(tags || []);
    return hands.filter((h) => {
      // Applied to Played and Notable, not All — see HISTORY_FILTERS.
      if (mode !== 'all' && handHadNoAggression(h)) return false;
      const n = handNotability(h, xid, ctx);
      // Anything that is not 'all' or 'notable' is treated as Played, so an
      // unrecognised mode falls back to the useful default rather than showing
      // nothing at all.
      if (mode === 'notable') { if (!n.notable) return false; } else if (mode !== 'all' && !n.voluntary) return false;
      if (!want.length) return true;
      const have = new Set(n.tags.map((t) => t.key));
      return want.every((k) => (k === HISTORY_TAG_ME ? heroPlayedHand(h, ctx) : have.has(k)));
    });
  }

  // --- Hand replayer (v1.17.0) -------------------------------------------
  //
  // Steps a stored hand forward one STREET at a time (not one action at a
  // time — a street is the natural unit here, since the board and the equity
  // quote only change at a street boundary, and grouping actions by street is
  // what formatHand/formatHandHtml already do). Pure and deterministic other
  // than reading module-level heroXid, same convention buildTendencyEntries
  // and friends already follow — testable by setting T.heroXid directly.
  //
  // Deliberately does NOT reconstruct a running pot per step. hand.actions
  // stores a raise's TOTAL-bet-to figure (see the 'raised $X to $Y' log
  // pattern), not the increment — summing that into a running total would
  // overcount. The final pot (h.pot, DOM-corrected at recording time — see
  // "the pot had no cross-check", closed v0.18.0) is shown once as context
  // instead of a per-step figure this file has no honest way to derive.
  function replayStepsFor(h) {
    if (!h) return [];
    const boardKnown = Array.isArray(h.board);
    const boardCountFor = BOARD_COUNT_FOR; // shared, so the two can't drift
    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });

    const live = new Set(h.players || []);
    const steps = [];
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      const acts = byStreet[street];
      if (!acts || !acts.length) return; // the hand never reached this street
      acts.forEach((a) => { if (a.a === 'fold') live.delete(a.x); });
      steps.push({
        street,
        // Sliced fresh each street rather than accumulated, so a street with
        // NO board entry at all (hero folded before a flop that later ran out
        // in the log, or an old hand with no board data) reads as unknown
        // rather than silently reusing the previous street's cards.
        board: boardKnown ? h.board.slice(0, boardCountFor[street]) : null,
        actions: acts,
        // Who is still contesting the pot AFTER this street's folds — the
        // opponent count the NEXT street's equity quote should use.
        live: Array.from(live),
      });
    });
    return steps;
  }

  // Preflop raise events across the WHOLE hand, replayed from the stored
  // action log — same "an all-in counts as a raise" rule preflopRaiseEvents
  // uses live (open finding #3), so a replayed equity quote tiers against the
  // same opponentRangeProxy the live coach panel would have used.
  function replayPreflopRaiseLevel(steps) {
    const pre = steps.find((s) => s.street === 'preflop');
    if (!pre) return 0;
    return pre.actions.filter((a) => a.a === 'raise' || a.a === 'all-in').length;
  }

  // Hero's equity as of one replay step, or null when it can't be shown:
  // hero's cards were never captured, hero has already folded by this step,
  // the board isn't known (a hand recorded before v1.17.0), or nobody is left
  // to have equity against. Uses estimateEquityCached, same range-proxy
  // tiering (see opponentRangeProxy/equityBasisLabel) the live coach uses —
  // a replayed read should look like the read you'd actually have gotten.
  function replayStepEquity(h, step, raiseLevel) {
    if (!h || !h.heroCards || h.heroCards.length !== 2 || heroUnresolved()) return null;
    if (!step.board) return null;
    if (!step.live.some((xid) => String(xid) === String(heroXid))) return null;
    const nOpp = step.live.filter((xid) => String(xid) !== String(heroXid)).length;
    if (nOpp <= 0) return null;
    return estimateEquityCached(h.heroCards, step.board, nOpp, raiseLevel);
  }

  // The whole recorded history against one player, as a plain-text file.
  //
  // EVERY hand, not the 40 the History tab renders. The on-screen cap exists
  // because scrolling hundreds of hand cards on a phone is useless; a file has
  // no such constraint, and an export that silently stopped at 40 would be the
  // exact kind of quiet loss you only discover when you go looking for a hand
  // that isn't there.
  //
  // Newest first, matching the tab and the store's own order, with the cut-off
  // stated in the header — a history file that doesn't say what it is missing
  // reads as complete.
  //
  // Plain text, and it reuses formatHand rather than reimplementing it: the
  // clipboard, the tab and the file must never drift into three descriptions of
  // the same hand.
  function playerHistoryExport(xid) {
    const hands = handsInvolving(xid);
    const p = STORE.players[xid];
    const limit = STORE.settings.historyLimit || 200;
    const header = [
      `Torn Poker HUD — hand history vs ${playerDisplayName(xid)} (xid ${xid})`,
      `Exported ${new Date().toISOString()}`,
      `${hands.length} hand(s) with this player, newest first.`,
      `Only the most recent ${limit} hands are kept overall, plus any notable ones `
        + `(big pot, or a preflop raise of ${NOTABLE_PREFLOP_RAISE_BB}bb+) kept longer — `
        + `so a specific old hand may survive even past the ${limit} figure, but anything `
        + `not notable and older than that is already gone.`,
      p ? `Seen in ${p.hands} hand(s) total; * marks their actions.` : '* marks their actions.',
      '',
    ].join('\n');
    if (!hands.length) return header + '(no hands recorded)\n';
    return header + hands.map((h) => formatHand(h, xid)).join('\n\n') + '\n';
  }

  // --- Getting an export off the phone (v1.53.0) ---------------------------
  //
  // Reported: the clipboard button "still doesn't work (maybe length issue?)"
  // and "the send function doesn't work too. Can we just email it?"
  //
  // Three routes, because each fails in a way the others do not, and all of
  // this runs inside a webview where a failed route leaves you with nothing:
  //
  //   1. COPY, against a VISIBLE textarea. copyText already accepted an
  //      `existingEl` for exactly this and the history buttons never passed
  //      one, so the fallback selected an element positioned at left:-9999px.
  //      iOS WKWebView cannot select what it has not laid out on screen, so
  //      execCommand('copy') had nothing to copy — the failure is the
  //      off-screen element, not the length. With a real on-screen box, a
  //      failed execCommand still leaves the text selected and readable for a
  //      manual long-press copy, which is the whole point of the parameter.
  //   2. SHARE SHEET, which may not exist — see downloadTextFile.
  //   3. GIST, an ordinary authenticated HTTPS POST through pdaFetchJson: the
  //      one transport confirmed working on this device. It produces a URL,
  //      and the URL is what the mail app can carry.
  //
  // One helper for both places that need it (the History tab and Settings), so
  // a fix to any route lands in both rather than in whichever was edited.
  // `key` namespaces the classes, since both can be mounted at once.
  function exportActionsHtml(key, saveLabel) {
    return `<div class="tph-exp" data-exp="${key}">`
      + `<button class="tph-exp-copy">Copy</button>`
      + `<button class="tph-exp-save">${isPDA() ? 'Save / share' : 'Download'} ${escapeHtml(saveLabel || '')}</button>`
      + `<button class="tph-exp-gist">Upload to Gist</button>`
      + `<div class="tph-exp-msg"></div>`
      + `<textarea class="tph-exp-ta" readonly placeholder="The export appears here — Copy, or long-press to select it by hand."></textarea>`
      + `</div>`;
  }

  // opts: { text: () => string, fileName: string, subject: string }
  // `text` is a THUNK, not a string: building a full history export on every
  // panel render would run formatHand over hundreds of hands for a button
  // nobody has pressed yet.
  function wireExportActions(root, key, opts) {
    const box = root.querySelector(`.tph-exp[data-exp="${key}"]`);
    if (!box) return;
    const ta = box.querySelector('.tph-exp-ta');
    const msg = box.querySelector('.tph-exp-msg');
    const say = (html) => { msg.innerHTML = html; pinTextColor(msg); };

    box.querySelector('.tph-exp-copy').addEventListener('click', async (e) => {
      const text = opts.text();
      // The visible textarea IS the fallback target — see the note above.
      const ok = await copyText(text, ta);
      e.target.textContent = ok ? 'Copied ✓' : 'Copy';
      say(ok
        ? `<span class="tph-exp-ok">Copied ${fmtBytes(text.length)}.</span>`
        : '<span class="tph-exp-bad">The clipboard refused. The text is selected in the box below — '
          + 'long-press it and choose Copy, or use Upload to Gist.</span>');
    });

    box.querySelector('.tph-exp-save').addEventListener('click', async (e) => {
      const text = opts.text();
      const ok = await downloadTextFile(text, opts.fileName, 'text/plain');
      e.target.textContent = ok ? 'Sent ✓' : e.target.textContent;
      // Says "could not confirm", not "failed": downloadTextFile cannot tell an
      // unregistered bridge handler from one that succeeded and returned null.
      // Claiming either is what made the old "Sent ✓" useless.
      // "Requested", not "Sent". The bridge resolves the same way whether it
      // opened a share sheet or was never registered at all, so claiming the
      // file arrived is a claim this code cannot support — and the old "Sent ✓"
      // is exactly what made the failure impossible to diagnose from here.
      say(ok ? '<span class="tph-exp-ok">Share sheet requested.</span> '
          + '<span class="tph-exp-bad">If nothing opened, this webview has no share bridge — '
          + 'use Upload to Gist.</span>'
        : '<span class="tph-exp-bad">The share bridge refused. Use Upload to Gist, or Copy.</span>');
    });

    box.querySelector('.tph-exp-gist').addEventListener('click', async (e) => {
      if (!STORE.settings.githubToken) {
        say('<span class="tph-exp-bad">Not connected — Settings ▸ Sync ▸ Connect first.</span>');
        return;
      }
      e.target.textContent = 'Uploading…';
      const url = await GistSync.uploadSnippet(opts.fileName, opts.text(), opts.subject);
      e.target.textContent = 'Upload to Gist';
      if (!url) {
        say('<span class="tph-exp-bad">Upload failed. Check Settings ▸ Sync is still connected.</span>');
        return;
      }
      // The link is rendered as selectable text as well as behind the buttons,
      // because both of those depend on things already reported broken here.
      say(`<span class="tph-exp-ok">Uploaded (secret gist):</span>`
        + `<div class="tph-exp-url">${escapeHtml(url)}</div>`
        + `<button class="tph-exp-copyurl">Copy link</button>`
        + `<button class="tph-exp-mail">Email link</button>`);
      const copyUrl = msg.querySelector('.tph-exp-copyurl');
      if (copyUrl) {
        copyUrl.addEventListener('click', async (ev) => {
          const ok = await copyText(url);
          ev.target.textContent = ok ? 'Copied ✓' : 'Copy the link above by hand';
        });
      }
      const mail = msg.querySelector('.tph-exp-mail');
      if (mail) {
        mail.addEventListener('click', () => {
          openMailto(opts.subject, `${opts.subject}\n\n${url}\n\n`
            + 'Secret gist — anyone with the link can read it. Delete it from '
            + 'gist.github.com when you are done.');
          // Whether a mail app opened happens outside this page, so the message
          // does not claim it did — and the link stays on screen above, which
          // is the part that matters if it didn't.
          mail.textContent = 'Mail app asked';
        });
      }
    });
  }

  // Every hand in the store, not just the ones involving one player. The
  // per-player export answers "how does this villain play"; this one is the
  // raw log for offline analysis, which is what was actually asked for.
  // Reuses formatHand like every other rendering of a hand, so the file, the
  // clipboard and the tab cannot drift into three descriptions of one hand.
  function fullHistoryExport() {
    const hands = STORE.hands || [];
    const limit = STORE.settings.historyLimit || 200;
    const header = [
      'Torn Poker HUD — full hand log',
      `Exported ${new Date().toISOString()}`,
      `${hands.length} hand(s), newest first.`,
      `Only the most recent ${limit} are kept, plus notable ones held longer.`,
      heroUnresolved() ? 'Hero not identified — no hand is marked as yours.'
        : `* marks your own actions (${playerDisplayName(heroXid)}).`,
      '',
    ].join('\n');
    if (!hands.length) return header + '(no hands recorded)\n';
    return header + hands.map((h) => formatHand(h, heroUnresolved() ? null : heroXid)).join('\n\n') + '\n';
  }

  // Hand a short piece of text to the phone's mail app.
  //
  // ONLY EVER A LINK, never the export itself. mailto has no attachment
  // parameter — that is not a webview limitation, the scheme has no such field
  // — and the practical body limit is a couple of thousand characters against
  // an export that runs to hundreds of kilobytes. So "email me the history"
  // resolves to "upload it and email the link", which is what these two
  // functions do between them.
  // Handed off through an anchor click, NOT `window.location.href = ...`.
  //
  // Setting location on a scheme the webview does not handle can navigate the
  // page — and the page is the poker table you are sitting at. CLAUDE.md's rule
  // is absolute about not coming between the user and the table, and losing
  // your seat to a mail link that failed to open would be the worst version of
  // breaking it. An unhandled anchor click does nothing instead.
  //
  // Returns whether the click was DISPATCHED, which is all this can honestly
  // know — whether a mail app actually opened happens outside the page. The
  // caller's message says so, and leaves the link on screen either way.
  function openMailto(subject, body) {
    const url = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Safe for a filename on any platform the share sheet might hand this to:
  // Torn usernames are free text, and `[` or `/` in one would either break the
  // download or be silently dropped.
  function fileSafeName(s) {
    return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'player';
  }

  function finalizeHand() {
    renderBadges();
    renderReportIfOpen();
  }

  let logObserver = null;
  let logObserverTarget = null;
  let logUsingFallback = false;

  // Any node we injected ourselves. The body-wide fallback observer below would
  // otherwise see our own badges/panels being added and try to parse them as
  // game log lines — a feedback loop.
  function isOwnNode(node) {
    if (!node || node.nodeType !== 1) return false;
    return !!(node.closest && node.closest('[class^="tph-"], [class*=" tph-"]'));
  }

  // Mutation targets are often text nodes; resolve to the owning element first
  // or every one of our own text edits reads as "not ours" and triggers a scan.
  function isOwnTarget(node) {
    if (!node) return false;
    return isOwnNode(node.nodeType === 1 ? node : node.parentElement);
  }

  // The same log line can arrive via several mutation records (once for the row,
  // once for an inner span), and the body-wide fallback makes that much more
  // likely. Suppress an identical line seen again within a short window —
  // but not longer, since "X folds" legitimately recurs across hands.
  // ONLY used by the added-nodes fallback below: the snapshot scanner already
  // guarantees a line is new, and running it through a time window there would
  // silently drop a genuine repeat that happens to arrive quickly.
  const recentLines = new Map();
  const DEDUP_MS = 1500;
  function recentlyHandled(text) {
    const now = Date.now();
    for (const [k, t] of recentLines) if (now - t > DEDUP_MS) recentLines.delete(k);
    if (recentLines.has(text)) return true;
    recentLines.set(text, now);
    return false;
  }

  // ---------------------------------------------------------------------------
  // Log ingestion by whole-list snapshot diff.
  //
  // Reading MutationObserver's addedNodes looked right and was wrong. Torn's
  // message list re-renders in place: the <li> elements persist and their TEXT
  // is rewritten as messages shift through the list, so a single new message
  // mutates every row. Every one of those rows then got re-parsed as if it had
  // just happened, and the 1.5s text dedup couldn't catch it because the lines
  // were minutes old. That replayed whole hands — the same "Game <hex> started"
  // and the same actions again and again — which is why one real hand appeared
  // several times in the history and inflated every stat with it.
  //
  // Diffing snapshots of the entire visible list is immune to that, because it
  // compares CONTENT, not node identity or arrival time: a re-render that
  // produces the same lines produces no new lines. It also survives Torn's SPA
  // swapping in a whole new log element, which node-based tracking would not.
  // ---------------------------------------------------------------------------

  let logSnapshot = [];
  let logSnapshotPrimed = false;
  let logOrientation = null; // 'append' (newest last) or 'prepend' (newest first)

  function logRoot() {
    return (logObserverTarget && logObserverTarget.isConnected) ? logObserverTarget : document.body;
  }

  // Cheap path test for the observer callback, which runs on every mutation
  // batch: stop at the first row instead of reading textContent for all of them.
  function hasLogRows() {
    const root = logRoot();
    return !!(root && root.querySelector && root.querySelector(SELECTORS.logRow));
  }

  // Text of every log row, with any card IMAGES in the row spelled out and
  // appended.
  //
  // A reveal whose cards are drawn as elements rather than glyphs leaves
  // textContent reading only "Bob reveals (Two Pairs: Nines and Sevens)" — the
  // actor and Torn's description of the made hand, but not the holding. The
  // Range tab then never fills in and nothing appears unmatched, because the
  // line DID parse; it just carried no cards.
  //
  // Card elements carry aria-labels like "9 of hearts", which parseCardsFromText
  // now understands. Appending them is stable text, so the snapshot diff in
  // scanLogRows still works exactly as before.
  function rowText(row) {
    const base = (row.textContent || '').trim();
    let labels = '';
    if (row.querySelectorAll) {
      row.querySelectorAll('[role="img"][aria-label]').forEach((img) => {
        const l = img.getAttribute('aria-label');
        if (l && !/face down/i.test(l)) labels += ' ' + l;
      });
    }
    return (base + labels).trim();
  }

  function readLogRows() {
    const root = logRoot();
    if (!root || !root.querySelectorAll) return null;
    const rows = root.querySelectorAll(SELECTORS.logRow);
    if (!rows.length) return null; // uncalibrated page — caller uses the fallback
    return Array.from(rows, rowText);
  }

  // How many of the previous lines are still present, assuming new lines land at
  // the END of the list (cur === prev.slice(k) + new). Longest overlap wins, so
  // trimming from the front of the list is handled too.
  function tailOverlap(prev, cur) {
    for (let k = 0; k <= prev.length; k++) {
      const n = prev.length - k;
      if (n > cur.length) continue;
      let ok = true;
      for (let i = 0; i < n; i++) { if (prev[k + i] !== cur[i]) { ok = false; break; } }
      if (ok) return n;
    }
    return 0;
  }

  // Same question, assuming new lines land at the START (cur === new + prev.slice(0, n)).
  function headOverlap(prev, cur) {
    for (let k = 0; k <= prev.length; k++) {
      const n = prev.length - k;
      if (n > cur.length) continue;
      const start = cur.length - n;
      let ok = true;
      for (let i = 0; i < n; i++) { if (prev[i] !== cur[start + i]) { ok = false; break; } }
      if (ok) return n;
    }
    return 0;
  }

  // Returns true if the structured path handled this tick, false if there are no
  // log rows to read and the caller should fall back to parsing added nodes.
  function scanLogRows() {
    const cur = readLogRows();
    if (!cur) return false;

    // Bind hero to a seat BEFORE parsing anything, not on the 3s watcher tick.
    //
    // v1.6.0 stopped hero's own log lines minting a `name:<username>` ghost by
    // having nameToXidGuess return heroXid directly once it is resolved. That
    // holds — but only once it IS resolved, and the retry that resolves it ran
    // on a 3s timer while the log scan runs every second. Every line parsed in
    // that opening window still fell through to the pseudo-id.
    //
    // A live scan found the residue: heroGhost(name:Wonkawee) EXISTS with 7
    // hands against a real record of 8911. Tiny, but it is a fresh split of
    // exactly the kind v1.6.0 was meant to close, and it re-accrues a little
    // every session. Resolving here costs one DOM query on the ticks where
    // hero is still unbound, and nothing at all afterwards.
    if (heroUnresolved()) heroXid = findHeroXid();

    // Lines already on screen when the script loads are history, not events —
    // parsing them would replay an arbitrary slice of a hand already over.
    if (!logSnapshotPrimed) {
      logSnapshot = cur;
      logSnapshotPrimed = true;
      // But a BLIND LEVEL is not an event, it is a fact about the table, and
      // reading one costs nothing and replays nothing. Without this the whole
      // session ran with no blind until the next hand posted its blinds: a
      // live scan showed "posted big blind $500,000" sitting right there in
      // the log while the HUD reported "blind level not read yet". That gap
      // matters — bbAmount is what prices P/L in big blinds, what decides
      // whether a hand is notable, and what the effective-stack warnings read.
      seedBlindFromVisibleLog(cur);
      return true;
    }

    const tailN = tailOverlap(logSnapshot, cur);
    const headN = headOverlap(logSnapshot, cur);

    // Which end the log grows from isn't documented and can't be checked without
    // a live table, so infer it and latch it. A tie means no usable overlap
    // (the list was replaced wholesale); reuse the direction already observed
    // rather than guessing again and replaying a hand backwards.
    let fresh;
    if (tailN > headN) {
      logOrientation = 'append';
      fresh = cur.slice(tailN);
    } else if (headN > tailN) {
      logOrientation = 'prepend';
      fresh = cur.slice(0, cur.length - headN).reverse();
    } else {
      fresh = logOrientation === 'prepend'
        ? cur.slice(0, cur.length - headN).reverse()
        : cur.slice(tailN);
    }

    // Snapshot before parsing: handleLogLine can render panels, and a re-entrant
    // scan must not see the pre-update snapshot and emit these lines twice.
    logSnapshot = cur;

    fresh.forEach((rowText) => {
      if (!rowText || rowText.length > 1000) return;
      // A row can render several lines; parse each separately or a multi-line
      // blob matches nothing at all.
      rowText.split('\n').forEach((raw) => {
        const line = raw.trim();
        if (!line || line.length > 300) return;
        handleLogLine(line);
      });
    });
    return true;
  }

  // Coalesce a burst of mutations into one scan per frame. Safe to drop extra
  // calls: the scan is snapshot-based, so one run catches everything queued.
  let logScanQueued = false;
  function scheduleLogScan() {
    if (logScanQueued) return;
    logScanQueued = true;
    requestAnimationFrame(() => { logScanQueued = false; scanLogRows(); });
  }

  function attachLogObserver() {
    const container = document.querySelector(SELECTORS.logContainer);
    // Fall back to watching the whole document when the log container selector
    // doesn't match. Less efficient, but it means action tracking still works
    // on a page whose class names we haven't calibrated yet.
    const target = container || document.body;
    if (!target) return false;

    if (logObserver && logObserverTarget === target && logObserverTarget.isConnected) return true;
    if (logObserver) logObserver.disconnect();

    logUsingFallback = !container;
    logObserverTarget = target;
    logObserver = new MutationObserver((mutations) => {
      // Ignore batches that are entirely our own DOM — otherwise rendering a
      // badge or panel re-triggers the parser on itself.
      let relevant = false;
      for (const mut of mutations) {
        if (!isOwnTarget(mut.target)) { relevant = true; break; }
      }
      if (!relevant) return;

      // Preferred path: diff the whole rendered list. Falls through only when
      // the logRow selector matches nothing, i.e. an uncalibrated page.
      if (hasLogRows()) { scheduleLogScan(); return; }
      parseAddedNodes(mutations);
    });
    // characterData too: Torn rewrites existing rows in place, so a new message
    // may arrive with no node insertion at all.
    logObserver.observe(target, { childList: true, subtree: true, characterData: true });
    // Prime the snapshot immediately, so lines already on screen aren't replayed
    // as if they had just happened the first time anything mutates.
    scanLogRows();
    return true;
  }

  // Legacy added-nodes parsing, kept ONLY for pages where the log row selector
  // doesn't match and there is nothing to snapshot. It cannot tell a re-render
  // from a new event, which is exactly the bug the snapshot scanner fixes — so
  // it is a last resort, not a parallel path.
  function parseAddedNodes(mutations) {
    for (const mut of mutations) {
      mut.addedNodes.forEach((node) => {
        if (isOwnNode(node)) return;
        // Torn builds a log row as `<li><span>Name</span><span>called $X</span></li>`
        // and mutates the inner span, so reading the added node alone yielded
        // "called $3,500,000" with no actor — which failed every name-anchored
        // pattern and was the real reason no stats were ever recorded. Climb to
        // the enclosing row so the name and the verb arrive as one line.
        const el = node.nodeType === 1 ? node : node.parentElement;
        const row = el && el.closest ? el.closest(SELECTORS.logRow) : null;
        const source = row || node;
        const text = (source.textContent || '').trim();
        if (!text || text.length > 1000) return;
        // A single inserted node can carry several rendered lines; parse each
        // separately or a multi-line blob matches nothing at all.
        text.split('\n').forEach((raw) => {
          const line = raw.trim();
          if (!line || line.length > 300) return;
          if (recentlyHandled(line)) return;
          handleLogLine(line);
        });
      });
    }
  }

  // Text matching is the primary path now, not a fallback — see
  // findActionButtons(). The hashed selector is still tried first on the chance
  // some layout does expose a stable container, but it has never matched.
  function countActionControls() {
    const direct = document.querySelectorAll(SELECTORS.actionButtons);
    if (direct.length) return direct.length;
    return findTurnButtons().length;
  }

  // The seat currently on action, or null.
  function activeSeatXid() {
    const el = document.querySelector(SELECTORS.seatActive);
    return el ? resolveSeatKey(el) : null;
  }

  // Is it hero's turn?
  //
  // The seat's own `active___` marker is authoritative and is tried first.
  // Button labels are only a fallback, because they cannot distinguish a real
  // turn from a queued pre-action: a live scan found "Call Any / Check",
  // "Check" and "Check / Fold" all on screen at once, and the bare "Check"
  // among them is a pre-action control that reads exactly like a turn button.
  // Cueing off that left the screen glowing while waiting.
  function isHeroTurn() {
    if (heroUnresolved()) return countActionControls() > 0; // no seat to compare
    const active = activeSeatXid();
    if (active) return active === heroXid;
    return countActionControls() > 0;
  }

  // Is hero the NEXT player to act — i.e. one seat after whoever is on action,
  // skipping anyone folded or sitting out?
  //
  // Worth its own state: the useful moment to look up from your phone is
  // slightly before it is your turn, not at the instant the clock starts.
  // Returns null when the ring can't be read, so the caller can stay quiet
  // rather than guess.
  function isHeroNextToAct() {
    if (heroUnresolved()) return null;
    const active = activeSeatXid();
    if (!active || active === heroXid) return false;

    const ring = seatRingXids();
    if (!ring || ring.length < 2) return null;
    const i = ring.indexOf(active);
    if (i < 0) return null;

    for (let step = 1; step < ring.length; step++) {
      const xid = ring[(i + step) % ring.length];
      if (xid === active) break;
      if (seatIsOutOfHand(xid)) continue; // folded or sitting out — skipped
      return xid === heroXid;
    }
    return false;
  }

  // Seating order as XIDs. Prefers Torn's own positioner index, which a live
  // scan confirmed exists (`playerPositioner-1___` … `-8___`); falls back to the
  // geometric ring used for position labels.
  function seatRingXids() {
    const indexed = [];
    document.querySelectorAll(SELECTORS.seatPositioner).forEach((pos) => {
      let slot = null;
      for (const c of (pos.classList || [])) {
        const m = /^playerPositioner-(\d+)[_-]/.exec(c);
        if (m) { slot = parseInt(m[1], 10); break; }
      }
      if (slot === null) return;
      const seat = pos.querySelector(SELECTORS.seatContainer);
      const xid = seat ? resolveSeatKey(seat) : null;
      if (xid) indexed.push({ slot, xid });
    });
    if (indexed.length >= 2) {
      indexed.sort((a, b) => a.slot - b.slot);
      return indexed.map((e) => e.xid);
    }
    const geo = currentHand ? seatRotationFromDom(currentHand) : null;
    return geo && geo.length >= 2 ? geo : null;
  }

  function seatIsOutOfHand(xid) {
    const seat = Array.from(document.querySelectorAll(SELECTORS.seatContainer))
      .find((s) => resolveSeatKey(s) === xid);
    if (!seat) return true;
    if (isSeatSittingOut(seat)) return true;
    return !!seat.querySelector(SELECTORS.seatFolded)
      || Array.from(seat.classList || []).some((c) => /^folded[_-]/.test(c));
  }

  // The last failure from each watcher step, by name. Surfaced in the deep
  // scan: a step that has been throwing every 3s for an hour is invisible
  // otherwise, and swallowing an error without recording it would just move
  // the silence rather than remove it.
  const tickErrors = {};

  function tickStep(name, fn) {
    try {
      fn();
      if (tickErrors[name]) delete tickErrors[name];
    } catch (e) {
      tickErrors[name] = (e && e.message) || String(e);
    }
  }

  function bootstrapTableWatchers() {
    heroXid = findHeroXid();
    const attached = attachLogObserver();
    if (!attached && STORE.settings.calibrationMode) renderCalibrationPanel();

    // Positions/seats and action buttons can render slightly after the log
    // container; keep retrying quietly rather than assuming a single load
    // order. Re-attaching unconditionally (not just when logObserver is null)
    // also recovers if the table's SPA router swaps in a new log DOM node
    // without a full page reload, which would otherwise leave the observer
    // watching a detached element forever.
    setInterval(() => {
      // heroUnresolved(), not `!heroXid`: findHeroXid() returns the truthy
      // pseudo-id "name:<username>" when hero's seat isn't readable yet, so the
      // old guard latched a failed bootstrap resolution in for the entire
      // session — defeating the very retry it guarded. Hero's own log lines
      // meanwhile re-resolve to the real seat XID as soon as seats render, so
      // contributions and winnings key under one id while heroXid holds another:
      // heroDelta reads 0, every plChipsEst gets `0 * share`, hero.netChips
      // never moves, and `xid === heroXid` stops skipping hero as their own
      // opponent. Keep retrying until it binds to a seat.
      // EACH STEP ISOLATED. These used to run bare, one after another, so a
      // throw in any of them killed every step after it — on that tick and on
      // every tick after, silently and forever. Six independent jobs sharing
      // one uncaught exception is exactly the failure mode this file keeps
      // paying for: the symptom shows up somewhere unrelated (stacks stop
      // updating, or the Torn API never fires) and points nowhere near the
      // step that actually threw.
      tickStep('resolve hero', () => { if (heroUnresolved()) heroXid = findHeroXid(); });
      tickStep('log observer', attachLogObserver);
      // Cheap, and it repairs "#<xid>" names from earlier versions as soon as
      // that player is seen at a table again.
      tickStep('seat names', harvestSeatNames);
      tickStep('stacks', trackStacks);
      // No-op with no API key configured; otherwise gated by AFFIL_REFRESH_MS
      // so this fires network calls at most once a day per seated player.
      tickStep('affiliations', refreshSeatedAffiliations);
      // Same no-op-without-a-key guard, but gated by TARGET_REFRESH_MS (30s)
      // instead of a day, and for every seated opponent — see the function for
      // why it is no longer scoped to sitting-out seats only.
      tickStep('target status', refreshSeatedTargetStatus);
      // No-op unless BOTH battleStatsEstimate is on AND a TornStats key is
      // set — this one has an explicit opt-in on top of the key check, since
      // it's a third party's estimate rather than Torn's own data.
      tickStep('battle stats', refreshSeatedSpyStats);
      // Early-returns the moment there is nothing to drop, which is every tick
      // after the first one that finds a ghost.
      tickStep('hero ghost', dropStaleHeroGhost);
      // Departure watch. Diffing the seat sweep has to come AFTER the status
      // refresh above, so a player who leaves this tick already has a fresh
      // reading to be judged on rather than one up to 30s old.
      tickStep('departures', () => {
        if (!STORE.settings.departureWatch) return;
        alertDepartures(noteSeatDepartures(Array.from(seatedXids({ includeSittingOut: true }))));
        refreshDepartedTargetStatus();
        renderDepartedPill();
        if (departedPanelOpen) renderDepartedPanel();
      });
    }, 3000);
    harvestSeatNames();

    // Safety net. The snapshot scan is idempotent — a poll that finds nothing new
    // emits nothing — so it costs a textContent read per row and covers any
    // rendering path the observer doesn't see (a canvas-ish re-layout, a
    // mutation type we don't subscribe to, an observer detached by an SPA swap).
    setInterval(scanLogRows, 1000);

    // Showdown cards live on the table for only a few seconds before the next
    // deal clears them, so this has to poll rather than read at settlement.
    // Idempotent — first sighting wins.
    //
    // 400ms, not the log scan's 1000ms. A reveal is visible for a short and
    // UNCONTROLLED window: Torn deals the next hand as soon as everyone is
    // ready, and the next hand's blinds are what settle the previous one. At
    // one second a fast table could clear the cards between two polls, and the
    // reveal was then gone for good — the settlement re-read added in v1.36.0
    // does not save it, because by then the deal has already wiped the seats.
    // Reported as villains' revealed hands missing from History.
    //
    // The cost is a handful of seat queries three times a second, which is
    // nothing beside the per-frame layout thrash removed in v1.31.0, and it
    // does no work at all once a hand's reveals are already recorded.
    setInterval(harvestShownCards, SHOWDOWN_POLL_MS);

    // Same cadence, same reason: the board can be short when the log's flop
    // line was already on screen as the snapshot primed. Repairing it LIVE
    // rather than only at settlement keeps board-texture stats — which are
    // filed per action, during the hand — from being recorded against a board
    // missing its flop.
    setInterval(repairBoardFromDom, 1000);
  }

  // ===========================================================================
  // 5. STAT ENGINE
  // ===========================================================================

  function pct(n, d) {
    if (!d) return null;
    return (100 * n) / d;
  }

  function fmtPct(v) {
    return v == null ? '—' : v.toFixed(0) + '%';
  }

  // Middle value of a list, sorted ascending; average of the two middles on an
  // even count. Used for bet sizing instead of a sum/count mean specifically
  // because that mean is one all-in shove away from being wrong — see
  // noteBetSizing / BET_SIZE_HISTORY_MAX.
  function median(arr) {
    if (!arr || !arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Percentage without the sign, for the seat badge where three "%" glyphs per
  // seat is more clutter than information.
  function fmtNum(v) {
    return v == null ? '–' : v.toFixed(0);
  }

  // A percentage for a seat badge: always at most two characters.
  //
  // 100 is clamped to 99. On a badge that floats over the community cards, the
  // third digit costs real width and buys nothing — "played 99% of hands" and
  // "played 100% of hands" are the same read, and anyone who wants the true
  // figure has the Stats tab, which prints it raw. Everywhere else keeps
  // fmtNum; this is only for the badge face.
  function badgePct(v) {
    if (v == null) return '–';
    return String(Math.min(99, Math.max(0, Math.round(v))));
  }

  // Equity rounded to whole percent printed a flat "0%" for anything under 0.5,
  // which reads as "this hand cannot win" when it means "under one percent".
  // Against 8 random hands a weak holding genuinely lands there, so the
  // distinction matters.
  // Big blinds. Signed, because every use is a result rather than a size.
  function fmtBB(v) {
    if (v == null || isNaN(v)) return '—';
    const s = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
    return (v > 0 ? '+' : '') + s + 'bb';
  }

  // Win rate in big blinds per 100 hands — the standard unit, and the only one
  // that says whether you are actually beating the game. Null below a sample
  // where it would be pure noise: over 20 hands this is a number that will
  // change sign several times before it means anything.
  const BB100_MIN_HANDS = 50;
  function fmtBB100(netBB, hands) {
    if (!hands || hands < BB100_MIN_HANDS) {
      return hands ? `(need ${BB100_MIN_HANDS}+ hands for a win rate)` : '';
    }
    const rate = (netBB / hands) * 100;
    return `${rate > 0 ? '+' : ''}${rate.toFixed(1)} bb/100`;
  }

  function fmtEquity(v) {
    if (v == null) return '–';
    if (v > 0 && v < 0.5) return '<1%';
    if (v < 100 && v >= 99.5) return '>99%';
    return v.toFixed(0) + '%';
  }

  // Torn poker runs at millions per blind, so raw digit strings are unreadable
  // and even comma-grouped ones are long. Abbreviate at millions and above,
  // comma-group below that. Several call sites printed a bare Math.round() with
  // no grouping at all, which is what made P/L figures impossible to scan.
  const MONEY_TIERS = [[1e3, 'k', 0], [1e6, 'M', 1], [1e9, 'B', 1]];
  function fmtMoney(n) {
    const v = Math.round(Number(n) || 0);
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs < 1e4) return `${sign}$${abs.toLocaleString()}`;
    for (let i = 0; i < MONEY_TIERS.length; i++) {
      const [div, suffix, dp] = MONEY_TIERS[i];
      const scaled = abs / div;
      // Promote when rounding would print 1000 of a unit: $999,999 is "$1M",
      // never "$1000k".
      const shown = dp ? Number(scaled.toFixed(dp)) : Math.round(scaled);
      if (shown >= 1000 && i < MONEY_TIERS.length - 1) continue;
      return `${sign}$${dp ? trimZero(scaled) : shown}${suffix}`;
    }
    return `${sign}$${abs.toLocaleString()}`;
  }

  // One decimal, but never a trailing ".0" — "$13M" reads better than "$13.0M".
  function trimZero(x) {
    return x.toFixed(1).replace(/\.0$/, '');
  }

  // Same, with an explicit + on gains, for anything that is a profit/loss.
  function fmtSignedMoney(n) {
    const v = Math.round(Number(n) || 0);
    return (v > 0 ? '+' : '') + fmtMoney(v);
  }

  // Same k/M/B tiering as fmtMoney, without the $ — battle stat totals are a
  // raw count, not currency, but the abbreviation rule is identical and
  // reusing it beats a second implementation of the same ladder.
  function fmtStatNum(n) {
    return fmtMoney(n).replace(/^([+-]?)\$/, '$1');
  }

  const POSTFLOP_STREETS = ['flop', 'turn', 'river'];

  // Aggression and fold frequency for ONE street.
  //
  // All of this comes out of streetActions, which has been fully populated the
  // whole time — computeRates simply collapsed the three streets into one
  // number. A player who fires flops and gives up on turns is a completely
  // different opponent from one who barrels three streets, and that was
  // invisible.
  function streetRates(sa) {
    if (!sa) return { afq: null, foldPct: null, rr: null, faced: 0, actions: 0 };
    const agg = sa.bet + sa.raise;
    const passive = sa.call;
    const total = agg + passive + sa.check + sa.fold;
    // Postflop RE-RAISE frequency, and it needs no new collection: facing a bet
    // is the ONLY state in which raise, call and fold are possible. A check or
    // a bet means nobody had bet into them yet. So raise/(raise+call+fold) is
    // exactly "how often do they raise when someone bets at them" — the
    // check-raise and raise-of-the-c-bet lines combined.
    //
    // It is not split into check-raise vs raise-of-c-bet: that needs to know
    // whether they checked first, which streetActions does not record.
    const faced = sa.raise + sa.call + sa.fold;
    return {
      afq: pct(agg, agg + passive),
      foldPct: pct(sa.fold, total),
      rr: pct(sa.raise, faced),
      faced,
      actions: total,
    };
  }

  // Sample a board-texture read needs before it is worth showing. A four-flush
  // board is rare, so this fills slowly for any one villain — which is exactly
  // why it is gated rather than shown thin. v1.26.0's headline bug was a gate
  // that let a single observation through, and the gate is checked against the
  // SAME numbers the figure is computed from, never a larger neighbouring count.
  const BOARD_TEX_MIN = 8;

  // Two independent reads off one texture cell, and they use DIFFERENT
  // denominators on purpose (see BOARD_TEX_KEY): postflop, check and bet are
  // only reachable when nobody has bet yet, while call/fold/raise are only
  // reachable when facing one. Mixing the two into a single "aggression on
  // wet boards" number would average two unrelated situations.
  //
  // Each withholds (null) rather than reporting 0% on an empty denominator —
  // "never bets a four-flush board" is a claim, and never having been given
  // the chance is no evidence for it.
  function boardTexRates(cell) {
    if (!cell) return { lead: null, leadN: 0, foldToBet: null, facedN: 0, raiseWhenBet: null };
    const b = cell.b || 0, r = cell.r || 0, c = cell.c || 0, k = cell.k || 0, f = cell.f || 0;
    const leadN = b + k;      // nobody had bet: they either led or checked
    const facedN = c + f + r; // someone bet at them: they called, folded or raised
    return {
      lead: leadN ? pct(b, leadN) : null,
      leadN,
      foldToBet: facedN ? pct(f, facedN) : null,
      facedN,
      raiseWhenBet: facedN ? pct(r, facedN) : null,
    };
  }

  // What this HUD has actually observed across the whole tracked pool, per
  // flag. Same idea and same justification as observedPoolAverages: a per-
  // villain texture read takes hundreds of shared hands to earn, but the POOL
  // figure fills quickly and is useful on its own ("nobody here folds a paired
  // board"). It is also the baseline a villain gets compared against, so the
  // Stats tab can say which direction they deviate.
  // Seed boardTex from the hand history already on disk, once.
  //
  // STORE.hands keeps up to historyLimit (200) hands, each with its final
  // `board` and its full `actions` list carrying the street each action was on
  // — everything noteBoardTexture needs. Without this the stat starts at zero
  // and a rare flag like fl4 would take weeks to say anything; with it, there
  // is something to look at immediately.
  //
  // Deliberately NOT run from migrateStore. That executes inside loadStore()
  // near the top of the file, where anything declared with const/let further
  // down is still in its temporal dead zone — the documented way to break this
  // script at load. init() runs on DOMContentLoaded with everything bound.
  //
  // Idempotent by a store flag rather than by being safe to re-run: it adds to
  // counters, so running it twice would double-count every backfilled hand.
  function backfillBoardTexture() {
    if (STORE.boardTexBackfilled) return 0;
    let seeded = 0;
    (STORE.hands || []).forEach((h) => {
      if (!h || !Array.isArray(h.board) || !h.board.length) return;
      (h.actions || []).forEach((a) => {
        if (!a || !a.x || !a.s || a.s === 'preflop') return;
        if (!BOARD_TEX_KEY[a.a]) return;
        const p = STORE.players[a.x];
        if (!p) return; // a player pruned since; nothing to attribute to
        noteBoardTexture(p, a.a, a.s, h.board);
        seeded += 1;
      });
    });
    STORE.boardTexBackfilled = true;
    saveStore();
    return seeded;
  }

  function poolBoardTexture() {
    const totals = {};
    Object.keys(STORE.players || {}).forEach((xid) => {
      const bt = STORE.players[xid] && STORE.players[xid].boardTex;
      if (!bt || typeof bt !== 'object') return;
      Object.keys(bt).forEach((flag) => {
        const cell = bt[flag];
        if (!cell) return;
        const acc = totals[flag] || (totals[flag] = emptyBoardTexCell());
        ['b', 'r', 'c', 'k', 'f'].forEach((key) => { acc[key] += cell[key] || 0; });
      });
    });
    return totals;
  }

  function computeRates(p) {
    // AFq here is (bet + raise) / (bet + raise + call). Folds are DELIBERATELY
    // excluded, and this is a settled decision — do not "fix" it.
    //
    // The commoner published definition puts folds in the denominator, which
    // makes the stat answer "how aggressive are they across every postflop
    // decision". Excluding them answers a narrower question — "when they keep
    // playing, do they lead or follow" — and that is the one worth asking
    // against this pool, where folding is separately visible in fold-to-c-bet
    // and the per-street fold percentages.
    //
    // The cost of changing it now is the real argument: every AFq already
    // banked was computed this way, so switching the denominator would silently
    // reprice thousands of stored hands and make old and new figures
    // incomparable with nothing on screen to say so. It also reads HIGHER than
    // other HUDs for players who fold a lot, which is worth knowing before
    // comparing a number here against one quoted elsewhere.
    const aggActions = POSTFLOP_STREETS.reduce((sum, s) => sum + p.streetActions[s].bet + p.streetActions[s].raise, 0);
    const passActions = POSTFLOP_STREETS.reduce((sum, s) => sum + p.streetActions[s].call, 0);
    // Postflop re-raise, summed across streets. `rrFaced` counts only actions
    // that require a bet to be facing them — see streetRates for why that makes
    // raise/(raise+call+fold) the re-raise frequency without new collection.
    const rrMade = POSTFLOP_STREETS.reduce((sum, s) => sum + p.streetActions[s].raise, 0);
    const rrFaced = POSTFLOP_STREETS.reduce((sum, s) => sum
      + p.streetActions[s].raise + p.streetActions[s].call + p.streetActions[s].fold, 0);
    const byStreet = {};
    POSTFLOP_STREETS.forEach((s) => { byStreet[s] = streetRates(p.streetActions[s]); });
    // Bet-sizing and slowplay split by hand strength, from showdowns only —
    // see the `texture` field on emptyPlayer and noteBetTexture. `tex.*` reads
    // are all `||`-guarded rather than relying on the field's presence, since a
    // caller may hand computeRates a bare literal (tests do) with no texture
    // object at all.
    const tex = p.texture || {};
    const madeSpots = (tex.checkMade || 0) + (tex.madeBets || 0);
    // The total showdown-categorised bet/raise sample across all three
    // buckets — what bluffRate is a share OF, and what its own sample gate is
    // checked against (v1.26.0's lesson: gate on the number the figure is
    // actually computed from, never a larger neighbouring count).
    const texBetSample = (tex.madeBets || 0) + (tex.drawBets || 0) + (tex.bluffBets || 0);
    return {
      vpip: pct(p.vpip, p.hands),
      pfr: pct(p.pfr, p.hands),
      afq: pct(aggActions, aggActions + passActions),
      threeBet: pct(p.threeBetMade, p.hands),
      foldTo3Bet: pct(p.foldTo3BetMade, p.foldTo3BetOpp),
      cbet: pct(p.cbetMade, p.cbetOpp),
      // Collected since the C-bet stat was added, and displayed nowhere until
      // v0.23.0. It is the most actionable postflop read there is: it says
      // directly whether c-betting this player prints.
      foldToCbet: pct(p.foldToCbetMade, p.foldToCbetOpp),
      limp: pct(p.limpMade, p.hands),
      limpShareOfVpip: pct(p.limpMade, p.vpip),
      // Limped then re-raised the same hand. Rare by nature, so it is reported
      // with its raw count beside it rather than as a bare percentage — "2%"
      // off three hands and off three hundred are different claims.
      limpRaise: pct(p.limpRaiseMade || 0, p.hands),
      limpRaiseCount: p.limpRaiseMade || 0,
      // Postflop re-raise: raises as a share of the times they faced a bet.
      // Derived from streetActions, which has always held it — see streetRates.
      postflopRR: pct(rrMade, rrFaced),
      rrSample: rrFaced,
      wtsd: pct(p.wtsd, p.hands),
      medianBetPct: median(p.betSizes),
      // Median bet/raise size as % of pot, split by what they were caught
      // holding at showdown: two pair+, a live draw, or nothing at all. A
      // median of a bounded window, same reasoning as medianBetPct above —
      // see the texture field comment on emptyPlayer.
      betDrawPct: median(tex.drawSizes),
      betMadePct: median(tex.madeSizes),
      betDrawCount: tex.drawBets || 0,
      betMadeCount: tex.madeBets || 0,
      // BLUFF = showed down with worse than a pair and no draw either, after
      // betting or raising. bluffRate is a share of texBetSample, so it reads
      // "of the times we saw what they had after a bet, how often was it
      // nothing" — and it is a FLOOR biased low, not just thin: a bluff good
      // enough to win the pot uncontested never reaches showdown and is
      // structurally invisible to this. Say so wherever this is shown.
      betBluffPct: median(tex.bluffSizes),
      betBluffCount: tex.bluffBets || 0,
      bluffRate: texBetSample ? pct(tex.bluffBets || 0, texBetSample) : null,
      bluffSample: texBetSample,
      // Slowplay/trap rate: of the times they were already sitting on two
      // pair+ (checked or bet), how often did they check it instead. Null with
      // no such spots yet — "never slowplays" needs at least one to claim.
      trapRate: madeSpots ? pct(tex.checkMade || 0, madeSpots) : null,
      trapSample: madeSpots,
      byStreet,
    };
  }

  // Two cards -> the canonical hand class used everywhere else in this file:
  // "AA", "AKs", "AKo". Higher rank first, so AK and KA are one class.
  //
  // This is what turns a showdown into a data point. Torn writes revealed cards
  // as "reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)"; parseCardsFromText
  // already handles the unicode suits, and everything after the bracket is
  // Torn's own hand description, which is ignored — it describes the made hand,
  // not the holding.
  function handClassFromCards(cards) {
    if (!cards || cards.length < 2) return null;
    const [a, b] = cards;
    const ia = RANKS.indexOf(a.rank);
    const ib = RANKS.indexOf(b.rank);
    if (ia < 0 || ib < 0) return null;
    const hi = ia >= ib ? a : b;
    const lo = ia >= ib ? b : a;
    if (hi.rank === lo.rank) return hi.rank + lo.rank;
    return hi.rank + lo.rank + (hi.suit === lo.suit ? 's' : 'o');
  }

  // Record one showdown against a player.
  //
  // `raised` splits the range by what they did preflop, which is the whole
  // point: "what do they turn up with when they RAISE" and "when they just
  // call" are two different ranges, and averaging them describes neither.
  function noteShowdown(xid, cards, hand) {
    const cls = handClassFromCards(cards);
    if (!cls) return;
    const p = getPlayer(xid);
    if (!p.shownHands || typeof p.shownHands !== 'object') p.shownHands = {};
    const e = p.shownHands[cls] || (p.shownHands[cls] = { seen: 0, raised: 0, won: 0 });
    e.seen += 1;
    if (hand && hand.countedPfr && typeof hand.countedPfr.has === 'function'
        && hand.countedPfr.has(xid)) e.raised += 1;
    if (hand && Array.isArray(hand.winners) && hand.winners.some((w) => w.xid === xid)) e.won += 1;
    // Tier breakdown. Defensive reads throughout, matching the rest of this
    // function: a replayed or imported hand may predate preflopTier entirely,
    // and losing a tier is a far better failure than losing the showdown.
    const tier = (hand && hand.preflopTier && hand.preflopTier[xid]) || 0;
    if (tier === 2) e.r3 = (e.r3 || 0) + 1;
    else if (tier >= 3) e.r4 = (e.r4 || 0) + 1;
    if (hand && hand.limpRaised && typeof hand.limpRaised.has === 'function'
        && hand.limpRaised.has(xid)) e.lr = (e.lr || 0) + 1;
  }

  // Hand category of hole+board at a given point in the hand, {r,s} numeric
  // form — reuses evaluate7 rather than a second evaluator, so "made" here
  // always means what category 2+ (two pair or better) means everywhere else
  // that number is read. Works on 5 or 6 cards (flop/turn) exactly as it does
  // on 7 (river); evaluate7 is generic over the input length.
  function categoryAt(holeCards, boardCards) {
    return evaluate7((holeCards || []).concat(boardCards || []).map(cardToNum))[0];
  }

  // Four cards toward a flush, or an open/gutshot straight, in hole+board
  // combined — a draw, not yet a made hand. Coarse on purpose, same tradeoff
  // as RFI_RANGES elsewhere in this file: it does not distinguish a gutshot
  // from a double-belly-buster, only that some single card would complete
  // something. Straight check mirrors evaluate7's own wheel handling (ace
  // also counts low) so the two never disagree about what a straight is.
  function hasDrawAt(holeCards, boardCards) {
    const nums = (holeCards || []).concat(boardCards || []).map(cardToNum);
    const suitCounts = {};
    nums.forEach((c) => { suitCounts[c.s] = (suitCounts[c.s] || 0) + 1; });
    if (Object.keys(suitCounts).some((s) => suitCounts[s] === 4)) return true;
    const ranks = new Set(nums.map((c) => c.r));
    if (ranks.has(14)) ranks.add(1);
    for (let hi = 14; hi >= 5; hi--) {
      let have = 0;
      for (let i = 0; i < 5; i++) { if (ranks.has(hi - i)) have++; }
      if (have === 4) return true;
    }
    return false;
  }

  // Only flop and turn have a draw left to hold — the river is the last card,
  // so "drawing" there is meaningless. A river bet can only be a made hand or
  // pure air, and a showdown record alone cannot tell those apart, so it is
  // scored toward madeBets when it qualifies and simply not counted otherwise.
  const TEXTURE_DRAW_STREETS = ['flop', 'turn'];

  // Bet-sizing and slowplay, split by hand strength — see the `texture` field
  // on emptyPlayer. Banked from the same showdown loop as noteShowdown, at the
  // same point (settlement, after hand.winners and hand.board are both final)
  // and for the same reason: a hand that never reaches settlement should not
  // pollute this any more than it pollutes the range.
  function noteBetTexture(xid, holeCards, hand) {
    if (!holeCards || holeCards.length !== 2) return;
    const board = (hand && hand.board) || [];
    const boardAt = { flop: board.slice(0, 3), turn: board.slice(0, 4), river: board.slice(0, 5) };
    const need = { flop: 3, turn: 4, river: 5 };
    const p = getPlayer(xid);
    if (!p.texture || typeof p.texture !== 'object') {
      p.texture = {
        drawBets: 0, drawSizes: [], madeBets: 0, madeSizes: [], bluffBets: 0, bluffSizes: [], checkMade: 0,
      };
    }
    (hand.actions || []).forEach((a) => {
      if (a.x !== xid) return;
      const bc = boardAt[a.s];
      if (!bc || bc.length < need[a.s]) return; // preflop, or a street the log never reached
      const cat = categoryAt(holeCards, bc);
      if (a.a === 'bet' || a.a === 'raise' || a.a === 'all-in') {
        if (cat >= 2) {
          p.texture.madeBets += 1;
          pushTextureSize(p.texture.madeSizes, a.p);
        } else if (TEXTURE_DRAW_STREETS.indexOf(a.s) >= 0 && hasDrawAt(holeCards, bc)) {
          // A draw has real equity — a semi-bluff, not the thing this stat
          // calls a bluff. Checked before the bluff branch below for exactly
          // that reason: a flush draw with nothing else must land here, not
          // get counted as air.
          p.texture.drawBets += 1;
          pushTextureSize(p.texture.drawSizes, a.p);
        } else if (cat === 0) {
          // Genuinely nothing: worse than two pair, and no draw either (or
          // the river, where there is no draw left to have). This is the
          // actual definition of a bluff — a bet with no current equity and
          // no equity coming. cat === 1 (a lone pair, no draw) deliberately
          // lands in NEITHER this nor madeBets — not made by this file's own
          // two-pair bar, and holding a pair is not zero equity, so it is not
          // a bluff either. Left unscored, same as the WTSD anchor: an honest
          // gap is better than forcing a middling hand into a bucket it
          // doesn't belong in.
          p.texture.bluffBets += 1;
          pushTextureSize(p.texture.bluffSizes, a.p);
        }
      } else if (a.a === 'check' && cat >= 2) {
        p.texture.checkMade += 1;
      }
    });
  }

  // Everything a player has shown down, newest counts first. Optionally split
  // by preflop action so the caller can ask "what do they raise with".
  function shownRange(p, mode) {
    const src = (p && p.shownHands) || {};
    const out = [];
    Object.keys(src).forEach((cls) => {
      const e = src[cls] || {};
      // `open` is raises that were NOT a 3-bet or 4-bet, i.e. tier 1 — derived
      // by subtraction rather than stored, so it stays consistent with `raised`
      // for records written before the tiers existed (r3/r4 absent = 0 = every
      // raise reads as an open, which is the honest reading of old data).
      //
      // `limpraise` deliberately OVERLAPS the others: a limp-reraise is also a
      // 3-bet, so it appears in both. Splitting it out of r3 would understate
      // the 3-bet range; the UI labels it as a subset instead.
      const n = mode === 'raised' ? (e.raised || 0)
        : mode === 'called' ? Math.max(0, (e.seen || 0) - (e.raised || 0))
          : mode === 'open' ? Math.max(0, (e.raised || 0) - (e.r3 || 0) - (e.r4 || 0))
            : mode === 'threebet' ? (e.r3 || 0)
              : mode === 'fourbet' ? (e.r4 || 0)
                : mode === 'limpraise' ? (e.lr || 0)
                  : (e.seen || 0);
      if (n > 0) out.push({ cls, n, won: e.won || 0, seen: e.seen || 0 });
    });
    out.sort((a, b) => b.n - a.n || a.cls.localeCompare(b.cls));
    return out;
  }

  // The window is capped above the largest sensible sessionWindow so the
  // setting can be raised without the stored history being too short to serve
  // it. Nothing reads more than sessionWindow entries.
  const RECENT_MAX = 40;

  // Bitfield layout for `recent`. See emptyPlayer.
  const RECENT_PLAY_MASK = 3; // bits 0-1: fold / play / raise
  const RECENT_WON = 4;       // bit 2

  function pushRecent(p, code) {
    if (!Array.isArray(p.recent)) p.recent = [];
    p.recent.push(code);
    if (p.recent.length > RECENT_MAX) p.recent.splice(0, p.recent.length - RECENT_MAX);
  }

  function recentWindow(p, n) {
    const w = (Array.isArray(p && p.recent) ? p.recent : []).slice(-Math.max(1, n));
    return w.length ? w : null;
  }

  // Raw VPIP/PFR over the last `n` hands. Null when there is no window at all.
  //
  // The COUNTS are returned alongside the percentages because blendedRates needs
  // them: a percentage has thrown away the sample size, which is the only thing
  // that says how much to believe it.
  function sessionRates(p, n) {
    const win = recentWindow(p, n);
    if (!win) return null;
    const played = win.filter((c) => (c & RECENT_PLAY_MASK) >= 1).length;
    const raised = win.filter((c) => (c & RECENT_PLAY_MASK) >= 2).length;
    return {
      hands: win.length,
      played,
      raised,
      vpip: (100 * played) / win.length,
      pfr: (100 * raised) / win.length,
    };
  }

  // Share of the last `n` hands this player WON.
  function sessionWinRate(p, n) {
    const win = recentWindow(p, n);
    if (!win) return null;
    const won = win.filter((c) => (c & RECENT_WON) !== 0).length;
    return { hands: win.length, won, winPct: (100 * won) / win.length };
  }

  // A rolling VPIP/PFR trend across p.recent, one point per TREND_WINDOW_HANDS
  // window, oldest first — the shape a sparkline draws.
  //
  // Deliberately its OWN window size, not STORE.settings.sessionWindow: the
  // badge's window is tuned for a single stable ESTIMATE (bigger is steadier),
  // this is tuned for a TRAJECTORY (more, noisier points beat one smooth one —
  // the point is the slope, not any single reading). Sharing sessionWindow
  // would also mean a user who raises it toward RECENT_MAX (40) loses the
  // sparkline entirely: at window==40 there is exactly one possible window,
  // i.e. zero line segments to draw.
  //
  // Returns [] rather than null with too little data — callers can render
  // "not enough data yet" off an empty array without a separate null check,
  // same as shownRange/tablesPlayed already do.
  const TREND_WINDOW_HANDS = 10;

  function recentTrendPoints(p, windowSize) {
    const w = windowSize || TREND_WINDOW_HANDS;
    const recent = Array.isArray(p && p.recent) ? p.recent : [];
    if (recent.length < w + 1) return []; // need 2+ points to draw a line
    const points = [];
    for (let end = w; end <= recent.length; end++) {
      const win = recent.slice(end - w, end);
      const played = win.filter((c) => (c & RECENT_PLAY_MASK) >= 1).length;
      const raised = win.filter((c) => (c & RECENT_PLAY_MASK) >= 2).length;
      points.push({ vpip: (100 * played) / w, pfr: (100 * raised) / w });
    }
    return points;
  }

  // A minimal inline sparkline: one polyline, no axes or labels — this sits
  // inside a stats table cell, not a chart. `values` oldest first. Returns ''
  // for fewer than 2 points, since a single point has no line to draw.
  //
  // Scale defaults to 0-100 (VPIP/PFR/AFq's own range, the only callers this
  // had until the session-trends chart). opts.min/opts.max override it for a
  // signed, unbounded metric like P/L — existing 0-100 callers are unaffected,
  // since Math.max(0, Math.min(100, v))/100 and the min/max form below agree
  // exactly when min=0, max=100. opts.zeroLine draws a faint dashed reference
  // line at v=0, only when the range actually straddles zero — useful for a
  // signed metric where "above/below the line" is the whole point of looking.
  function sparklineSvg(values, opts) {
    const o = opts || {};
    const width = o.width || 90;
    const height = o.height || 20;
    const color = o.color || '#8ec5f0';
    if (!values || values.length < 2) return '';
    const n = values.length;
    const min = typeof o.min === 'number' ? o.min : 0;
    const max = typeof o.max === 'number' ? o.max : 100;
    const range = (max - min) || 1; // guards a degenerate zero-width range
    const yOf = (v) => height - ((Math.max(min, Math.min(max, v)) - min) / range) * height;
    const stepX = width / (n - 1);
    const pts = values.map((v, i) => (i * stepX).toFixed(1) + ',' + yOf(v).toFixed(1)).join(' ');
    const zeroLine = (o.zeroLine && min < 0 && max > 0)
      ? `<line x1="0" y1="${yOf(0).toFixed(1)}" x2="${width}" y2="${yOf(0).toFixed(1)}" `
        + 'stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.35"/>'
      : '';
    // class carries tph- so pinTextColor leaves it alone (it walks .tph-panel
    // content and would otherwise force `color: inherit`, which SVG stroke
    // doesn't even read — but the skip is what the rest of this file relies on
    // for anything with its own explicit colour, so staying consistent here
    // costs nothing and avoids being the one exception to explain later).
    return `<svg class="tph-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" `
      + `preserveAspectRatio="none">${zeroLine}<polyline points="${pts}" fill="none" stroke="${color}" `
      + 'stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  // How many archived sessions the Trends chart plots. A phone-width sparkline
  // has no room for SESSION_HISTORY_MAX (60) points — this is a display limit,
  // separate from the storage cap, so it can be tuned without touching how
  // much history is kept.
  const SESSION_TREND_POINTS = 30;
  // Rows shown in the session-by-session table beneath the charts.
  const SESSION_TABLE_ROWS = 25;

  // Session-over-session trends: win rate, VPIP, aggression and P/L across
  // STORE.sessionHistory. Hero-only — see the isSelf gate in
  // renderPlayerPanelBody — a "session" is hero's own sitting, not a concept
  // that applies to any other tracked player.
  // A session's bb result, or null when it doesn't have one. Two cases land
  // here and both must read as UNKNOWN rather than as break-even: a session
  // archived after this was fixed stores netBB null, and one archived before
  // it stores 0, which is indistinguishable from a genuine flat session. The
  // bb > 0 test catches both without needing a migration — a session whose
  // blind was never readable is exactly the one with no stake recorded.
  //
  // The rest of this file already refuses to quote a bb figure it can't stand
  // behind (fmtBB100 withholds under 50 hands; hands with no readable blind
  // are kept out of bbHands so they can't distort the rate). Plotting a big
  // winning session as 0.0 bb because Torn was in BB-display mode would be
  // the opposite of that.
  function sessionNetBB(se) {
    return se && se.bb > 0 && se.netBB != null && !isNaN(se.netBB) ? se.netBB : null;
  }

  function buildSessionTrendsHtml() {
    // A session that has already ended is archived on the next SETTLED hand,
    // which never comes if you simply stopped playing — so close the gap here
    // too, or the tab silently omits the session you most want to see. See
    // maybeRollSession.
    if (maybeRollSession()) saveStore();

    const hist = Array.isArray(STORE.sessionHistory) ? STORE.sessionHistory : [];
    if (!hist.length) {
      return `<i>No completed sessions yet. A session ends after a `
        + `${(SESSION_GAP_MS / 3600000).toFixed(0)}h gap in play, and the just-finished one lands here.</i>`;
    }

    // hist is oldest-first already (see archiveSession); charts want the same
    // order, the table wants newest-first, same convention as the hand
    // history tab (newest at the top).
    const plotted = hist.slice(-SESSION_TREND_POINTS);
    const vpips = plotted.map((se) => (se.hands ? (100 * se.vpip) / se.hands : 0));
    const afqs = plotted.map((se) => {
      const total = se.aggActions + se.passActions;
      return total ? (100 * se.aggActions) / total : 0;
    });
    // Only sessions with a real blind can carry a bb figure at all, so the two
    // signed charts plot that subset. VPIP/AFq are blind-independent and keep
    // every session — the rows are separate charts, not a shared axis.
    const bbSessions = plotted.filter((se) => sessionNetBB(se) != null);
    const winRates = bbSessions.map((se) => (se.hands ? (100 * sessionNetBB(se)) / se.hands : 0));
    const pls = bbSessions.map((se) => sessionNetBB(se));
    const bbSkipped = plotted.length - bbSessions.length;

    // Signed metrics get their own range, padded 10%, so the line actually
    // uses the chart height instead of sitting flat against a fixed 0-100
    // scale built for percentages. VPIP/AFq stay on the default 0-100.
    const signedRange = (values) => {
      const lo = Math.min(0, ...values);
      const hi = Math.max(0, ...values);
      const pad = Math.max(1, (hi - lo) * 0.1);
      return { min: lo - pad, max: hi + pad };
    };

    const chartRow = (label, values, opts) => {
      const svg = sparklineSvg(values, Object.assign({ width: 150, height: 26 }, opts));
      // values can be EMPTY, not just short: the two bb charts drop sessions
      // with no readable blind, and every session in the window can be one.
      // An unguarded values[values.length - 1].toFixed here is a TypeError
      // that takes the whole tab down.
      const last = values.length ? values[values.length - 1] : null;
      return `<div class="tph-trend-row"><span class="tph-trend-l">${escapeHtml(label)}</span>`
        + `<span class="tph-trend-chart">${svg || '<i>not enough sessions yet</i>'}</span>`
        + `<span class="tph-trend-last">${last == null ? '—' : last.toFixed(1)}</span></div>`;
    };

    const charts = chartRow('Win rate, bb/100', winRates, Object.assign({ color: '#8ec5f0', zeroLine: true }, signedRange(winRates)))
      + chartRow('P/L, bb', pls, Object.assign({ color: '#7ed957', zeroLine: true }, signedRange(pls)))
      + chartRow('VPIP %', vpips, { color: '#f0c674', min: 0, max: 100 })
      + chartRow('Aggression %', afqs, { color: '#e06c75', min: 0, max: 100 });

    const rows = hist.slice().reverse().slice(0, SESSION_TABLE_ROWS).map((se) => {
      const when = new Date(se.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const stakeName = se.bb ? (tableNameForBB(se.bb) || fmtMoney(se.bb) + ' BB') : '—';
      const vpipPct = se.hands ? fmtPct((100 * se.vpip) / se.hands) : '—';
      const pfrPct = se.hands ? fmtPct((100 * se.pfr) / se.hands) : '—';
      return `<tr><td>${escapeHtml(when)}</td><td>${se.hands}</td><td>${escapeHtml(stakeName)}</td>`
        + `<td style="color:${se.netChips >= 0 ? '#7ed957' : '#ff6b6b'} !important">${fmtSignedMoney(se.netChips)}</td>`
        + `<td>${fmtBB(sessionNetBB(se))}</td><td>${vpipPct}/${pfrPct}</td></tr>`;
    }).join('');

    return `<div class="tph-trend-charts">${charts}</div>`
      + `<table class="tph-stats tph-trend-table"><thead><tr>`
      + `<th>Date</th><th>Hands</th><th>Stake</th><th>P/L</th><th>bb</th><th>V/P</th></tr></thead>`
      + `<tbody>${rows}</tbody></table>`
      + `<div class="tph-stat-legend">One row per completed session — a session ends after a `
      + `${(SESSION_GAP_MS / 3600000).toFixed(0)}h gap in play. Charts plot the most recent `
      + `${Math.min(SESSION_TREND_POINTS, hist.length)} of ${hist.length} sessions, oldest to newest, left to right. `
      + (bbSkipped ? `${bbSkipped} session${bbSkipped === 1 ? '' : 's'} had no readable blind, so `
        + `${bbSkipped === 1 ? 'it is' : 'they are'} left out of the two bb charts and show "—" in the bb `
        + `column — the chip figure is still exact. ` : '')
      + `Win rate and aggression are estimates over a single session's sample — read the trend across `
      + `several sessions, not any one point.</div>`;
  }

  // Tilt is BEHAVIOURAL: a player is tilting when they start playing differently
  // from how they normally play. It is not "they are losing" — losing money is
  // not tilt, and a player can be stuck three buy-ins and still play their game.
  // Measuring the loss would flag the wrong people.
  //
  // So this compares a player's recent window against THEIR OWN lifetime
  // baseline, not against the pool. A nit who opens up to 45% VPIP is tilting;
  // a station sitting at 70% forever is not, that is simply who they are.
  const TILT_MIN_RECENT = 10;    // below this the window is noise
  const TILT_MIN_LIFETIME = 30;  // below this there is no baseline to deviate from
  const TILT_VPIP_JUMP = 20;     // percentage points above their own norm
  // Tilt is a short-lived state. Reading it over more hands than this blends
  // the tilt stretch back into normal play and the signal disappears exactly
  // when it is most true, so the tilt window is capped independently of the
  // badge's sessionWindow setting.
  const TILT_WINDOW_MAX = 15;

  // A pot this size, lost, is the kind that actually sets someone off.
  const BIG_LOSS_BB = 75;
  // How long the sting lasts. Beyond this the loss is no longer plausibly
  // driving the next decision.
  const BIG_LOSS_MEMORY_HANDS = 20;
  // With a recent big loss as corroboration, less behavioural evidence is
  // needed to reach the same confidence — see the note in tiltRead.
  const TILT_VPIP_JUMP_AFTER_LOSS = 12;

  function tiltWindowSize() {
    return Math.min(STORE.settings.sessionWindow || TILT_WINDOW_MAX, TILT_WINDOW_MAX);
  }

  // Hands since this player last lost a pot of BIG_LOSS_BB or more, or null.
  function handsSinceBigLoss(p) {
    if (!p || typeof p.lastBigLossHand !== 'number' || p.lastBigLossHand < 0) return null;
    const ago = p.hands - p.lastBigLossHand;
    return ago >= 0 && ago <= BIG_LOSS_MEMORY_HANDS ? ago : null;
  }

  // Returns { jump, recent, baseline, hands, sinceBigLoss } or null.
  //
  // A big recent loss LOWERS the bar rather than being required on its own,
  // and that split is the whole design:
  //
  // - Losing money is not tilt. A player stuck three buy-ins who keeps playing
  //   their game is not tilting, so a big loss alone flags nothing.
  // - But a big loss raises the prior probability that a VPIP spike IS tilt
  //   rather than a run of playable cards. With that corroboration, 12 points
  //   of deviation carries the same weight 20 does without it.
  //
  // The baseline excludes the recent window, so a long tilt stretch cannot
  // quietly raise the very number it is being measured against.
  function tiltRead(p) {
    if (!p || p.hands < TILT_MIN_LIFETIME) return null;
    const win = sessionRates(p, tiltWindowSize());
    if (!win || win.hands < TILT_MIN_RECENT) return null;

    const priorHands = p.hands - win.hands;
    const priorVpip = priorHands > 0
      ? (100 * (p.vpip - (win.vpip / 100) * win.hands)) / priorHands
      : null;
    if (priorVpip == null || priorVpip < 0) return null;

    const sinceBigLoss = handsSinceBigLoss(p);
    const threshold = sinceBigLoss != null ? TILT_VPIP_JUMP_AFTER_LOSS : TILT_VPIP_JUMP;

    const jump = win.vpip - priorVpip;
    if (jump < threshold) return null;
    return { jump, recent: win.vpip, baseline: priorVpip, hands: win.hands, sinceBigLoss };
  }

  // Running hot: winning far more of the recent hands than any seat count
  // makes likely. Expectation is roughly 1/seats — about 11% nine-handed and
  // 17% six-handed — so this threshold is 2-3x expectation whichever it is.
  //
  // Not the mirror of tilt. Tilt is relative to the player's own baseline
  // because playing differently is what matters; running hot is absolute,
  // because the point is simply that they are scooping pots.
  const HEAT_MIN_RECENT = 8;
  const HEAT_WIN_PCT = 35;

  // Returns { winPct, won, hands } or null.
  function heatRead(p) {
    if (!p) return null;
    const w = sessionWinRate(p, tiltWindowSize());
    if (!w || w.hands < HEAT_MIN_RECENT) return null;
    return w.winPct >= HEAT_WIN_PCT ? w : null;
  }

  // ===========================================================================
  // 6. ARCHETYPE CLASSIFIER
  // ===========================================================================

  // Average tendencies of the TORN poker pool, in percent.
  //
  // PROVENANCE, and it matters: MEASURED (v1.11.0), not borrowed. These are
  // observedPoolAverages() output from this HUD's own store — 173 tracked
  // opponents, 25+ hands each — replacing figures published in HopesG's "Torn
  // Poker HUD - Player Profiler & Coach" userscript (MIT, GreasyFork 569933)
  // that carried this constant from v0.22.0 through v1.10.0. This is the
  // correction those versions' own comments anticipated: "if these diverge
  // over a few hundred hands, POOL_AVG is what to fix."
  //
  // The divergence was real and went in an unexpected direction: this pool is
  // TIGHTER than HopesG's figures assumed (VPIP 42.5 vs the old 50.9, PFR 9.4
  // vs 13.4), not looser — and folds to a 3-bet dramatically more often
  // (48.1% vs an old 14.9%, more than triple). Re-measure and correct again
  // via the "Download pool tendencies" button once enough new hands accrue
  // that a fresh export meaningfully diverges from these — same rule that
  // applied to the HopesG figures applies to this HUD's own.
  //
  // NOT touched by this correction, and worth knowing why: A.aggRatio (0.45)
  // and A.passiveRatio (0.20) below are independent judgement calls, not
  // values ALGEBRAICALLY derived from POOL_AVG the way A.tight/A.loose are —
  // so correcting vpip/pfr here does not automatically re-examine whether
  // those two ratios still sit at the right relative distance from the pool's
  // new PFR/VPIP ratio (was 0.264, now 0.221). Left alone rather than guessed
  // at without evidence for what the right distance actually is. Same for
  // POOL_SPREAD: still the pre-existing judgement-call thresholds, not
  // re-derived from this measurement.
  //
  // NOTE ON WTSD: an earlier pass listed `wtsd: 20.9` here. That figure was
  // HopesG's `wwsf` — won-when-saw-flop — a different statistic from
  // went-to-showdown. This HUD now measures WTSD directly (13.5% observed),
  // but it is deliberately NOT added here: POOL_SPREAD has no entry for it
  // either, and adding one is its own judgement call this correction didn't
  // set out to make. Same reasoning still applies to AFq.
  const POOL_AVG = {
    vpip: 42.5,
    pfr: 9.4,
    threeBet: 1.5,
    foldTo3Bet: 48.1,
    cbet: 38.7,
    foldToCbet: 44.9,
    // Share of a player's VPIP that is limping rather than raising.
    limpShareOfVpip: 42.4,
  };

  // Strength of the prior, in pseudo-observations.
  //
  // A rate over few hands is mostly noise: 3 hands played out of 3 is not a
  // 100% VPIP. Shrinking toward the pool average pulls small samples back
  // toward "typical" and leaves large samples essentially untouched — at 12,
  // a 6-hand read is roughly two-thirds prior, a 100-hand read about 10%.
  //
  // This replaces hiding a player behind "Unrated" entirely: an estimate that
  // says "probably around average, we've barely seen them" beats no estimate,
  // and it degrades continuously instead of flipping at a threshold.
  const PRIOR_WEIGHT = 12;

  // `weight` and `poolPct` are the prior: how many pseudo-observations of what
  // rate. Both default to the pool-level prior above; blendedRates passes a
  // player's own history instead, which is what makes the hierarchy work.
  function shrunkPct(made, opps, poolPct, weight) {
    const w = weight == null ? PRIOR_WEIGHT : weight;
    const n = opps || 0;
    if (n <= 0 && !w) return null;
    return (100 * (made + w * (poolPct / 100))) / (n + w);
  }

  // Same shape as computeRates, with every rate shrunk toward POOL_AVG.
  // computeRates stays raw: the Stats tab should show what was actually
  // observed. Classification uses these.
  function computeShrunkRates(p) {
    const raw = computeRates(p);
    return {
      vpip: shrunkPct(p.vpip, p.hands, POOL_AVG.vpip),
      pfr: shrunkPct(p.pfr, p.hands, POOL_AVG.pfr),
      threeBet: shrunkPct(p.threeBetMade, p.hands, POOL_AVG.threeBet),
      foldTo3Bet: shrunkPct(p.foldTo3BetMade, p.foldTo3BetOpp, POOL_AVG.foldTo3Bet),
      cbet: shrunkPct(p.cbetMade, p.cbetOpp, POOL_AVG.cbet),
      foldToCbet: shrunkPct(p.foldToCbetMade, p.foldToCbetOpp, POOL_AVG.foldToCbet),
      limpShareOfVpip: shrunkPct(p.limpMade, p.vpip, POOL_AVG.limpShareOfVpip),
      // No published pool figure for these, so they are left raw rather than
      // shrunk toward a number that was never measured. See the WTSD note above.
      wtsd: raw.wtsd,
      afq: raw.afq,
      medianBetPct: raw.medianBetPct,
      byStreet: raw.byStreet,
    };
  }

  // Strength of the RECENT window's prior, in pseudo-hands. Lower than
  // PRIOR_WEIGHT on purpose: the prior here is the player's own history, which
  // is a far better guess at their next hand than the pool average is, but the
  // whole point of a recent read is that it is allowed to move. At 8, a
  // 15-hand window is ~65% window / 35% history, a 6-hand window ~43%, and a
  // 1-hand window ~11% — i.e. essentially their baseline.
  const RECENT_PRIOR_WEIGHT = 8;

  // Recent form, done properly: the last `n` hands shrunk toward the player's
  // OWN baseline, which is itself shrunk toward the pool. Two levels —
  //
  //     window  ->  their history before the window  ->  POOL_AVG
  //
  // This replaces a hard switch at SESSION_BADGE_MIN hands, which had the badge
  // showing a lifetime figure at 5 hands and a *raw 6-hand* figure at 6 — a
  // jump toward the noisier of the two estimates, and one that could move the
  // number 40 points on a single hand. The blend moves continuously instead,
  // and the badge no longer has two modes to be in.
  //
  // The prior EXCLUDES the window, same as tiltRead's baseline. The window's
  // hands are inside p.hands, so using lifetime directly would count them twice
  // and make a long stretch of new behaviour quietly reinforce its own prior.
  // With no history outside the window the prior collapses to POOL_AVG, which
  // is the right answer for a player you have only just met.
  //
  // Returns null when there is no window; the caller falls back to lifetime.
  function blendedRates(p, n) {
    const win = sessionRates(p, n);
    if (!win) return null;
    // Clamped: records written before `recent` existed, or a partially merged
    // one, can leave the window holding more hands than the lifetime counters.
    const priorHands = Math.max(0, (p.hands || 0) - win.hands);
    const priorPlayed = Math.max(0, (p.vpip || 0) - win.played);
    const priorRaised = Math.max(0, (p.pfr || 0) - win.raised);
    const baseVpip = shrunkPct(priorPlayed, priorHands, POOL_AVG.vpip);
    const basePfr = shrunkPct(priorRaised, priorHands, POOL_AVG.pfr);
    return {
      hands: win.hands,
      vpip: shrunkPct(win.played, win.hands, baseVpip, RECENT_PRIOR_WEIGHT),
      pfr: shrunkPct(win.raised, win.hands, basePfr, RECENT_PRIOR_WEIGHT),
      // Kept so the tooltip can quote what was actually OBSERVED in the window
      // alongside the estimate. Same rule as the Stats tab: print raw, colour
      // and classify off the adjusted figure.
      rawVpip: win.vpip,
      rawPfr: win.pfr,
      baseVpip,
      basePfr,
    };
  }

  // What this HUD has actually observed, for players with a real sample.
  // Returned so the UI can show it next to POOL_AVG — if the two diverge over a
  // few hundred hands, POOL_AVG is the thing to correct.
  //
  // Covers every rate computeRates produces, not just VPIP/PFR (v1.9.0). Each
  // one is averaged only across players who actually had the opportunity —
  // computeRates already returns null for a stat with a zero denominator (e.g.
  // foldTo3Bet with no foldTo3BetOpp), and `mean` drops nulls before averaging
  // — rather than adding a SECOND per-stat sample-size gate on top of the
  // blanket POOL_OBS_MIN_HANDS. That is a deliberate simplification: a
  // per-player exploit read needs its own gate because one thin sample IS the
  // whole answer, but a pool AVERAGE is protected by however many players
  // qualify — noise from one player's small denominator is diluted by
  // everyone else's, not the dominant source of error the way it would be for
  // a single opponent.
  const POOL_OBS_MIN_HANDS = 25;

  // The player records a pool read is built from — hero excluded, 25+ hands
  // each. Pulled out as its own function so observedPoolAverages() and
  // poolStakesBreakdown() describe exactly the same set of players, not two
  // independently-filtered lists that could quietly drift apart.
  function poolQualifyingPlayers() {
    return Object.keys(STORE.players)
      // Hero's own record is not part of the opponent pool, and including it
      // would bias the average toward your own style.
      .filter((xid) => heroUnresolved() || String(xid) !== String(heroXid))
      .map((xid) => STORE.players[xid])
      .filter((p) => p && p.hands >= POOL_OBS_MIN_HANDS);
  }

  function observedPoolAverages() {
    const ps = poolQualifyingPlayers();
    if (ps.length < 3) return null; // too few to mean anything
    const rates = ps.map((p) => computeRates(p));
    const mean = (f) => {
      const vals = rates.map(f).filter((v) => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      players: ps.length,
      // Sum of each qualifying player's OWN lifetime hand count — the same
      // "hands observed" denominator computeRates uses, not a count of
      // actions or a hand-history length. This is "how many hands of
      // evidence sit behind this average" in the same units the rest of the
      // UI already reports per-player sample size in.
      totalHands: ps.reduce((a, p) => a + (p.hands || 0), 0),
      vpip: mean((r) => r.vpip),
      pfr: mean((r) => r.pfr),
      threeBet: mean((r) => r.threeBet),
      foldTo3Bet: mean((r) => r.foldTo3Bet),
      cbet: mean((r) => r.cbet),
      foldToCbet: mean((r) => r.foldToCbet),
      limpShareOfVpip: mean((r) => r.limpShareOfVpip),
      // No published pool figure exists for either (see POOL_AVG/POOL_SPREAD),
      // so these have nothing to be compared against — reported as observed
      // facts on their own, same as everywhere else AFq/WTSD appear.
      afq: mean((r) => r.afq),
      wtsd: mean((r) => r.wtsd),
    };
  }

  // Which stakes the pool read is actually drawn from, busiest first.
  // Answers "which stakes/rooms" for observedPoolAverages() the same way
  // tablesPlayed(p) answers it for one player — this is that same aggregation
  // summed across every qualifying player instead of just one.
  //
  // p.tables is written at hand settlement only when the blind was readable
  // (see noteBlindLevel / plausibleBB), so its sum is typically slightly
  // BELOW a player's p.hands, not equal to it — a hand with an implausible or
  // missed blind read contributes to the rate averages (computeRates doesn't
  // need a blind level) but not to this breakdown. Reported as its own total
  // rather than silently assumed equal to totalHands.
  function poolStakesBreakdown() {
    const ps = poolQualifyingPlayers();
    const byBB = {};
    ps.forEach((p) => {
      Object.keys(p.tables || {}).forEach((bb) => {
        byBB[bb] = (byBB[bb] || 0) + (p.tables[bb] || 0);
      });
    });
    const total = Object.keys(byBB).reduce((a, k) => a + byBB[k], 0);
    if (!total) return { total: 0, stakes: [] };
    const stakes = Object.keys(byBB)
      .map((k) => ({
        bb: Number(k),
        name: tableNameForBB(Number(k)) || fmtMoney(Number(k)) + ' BB',
        hands: byBB[k],
        share: (100 * byBB[k]) / total,
      }))
      .sort((a, b) => b.hands - a.hands);
    return { total, stakes };
  }

  // The full report as a downloadable/copyable file — every stat above, each
  // against POOL_AVG where a published figure exists to compare it to, with
  // the same deviation label (typical/notable/extreme) the Stats tab and
  // players list use. This is aggregate numbers across every tracked
  // opponent, not a hand-by-hand dump: STORE.hands is capped at historyLimit
  // (~200-300 with pinned notable hands), so "all hands" there would really
  // mean "whichever recent/big ones survived pruning" — a recency- and
  // size-biased sample, not the pool. The per-player counters this draws
  // from instead are never capped or pruned down, so this is the honest full
  // picture. See CLAUDE.md "Shared-affiliation badges" for the same
  // per-player-not-per-relationship storage reasoning applied elsewhere.
  function poolTendencyExport() {
    const obs = observedPoolAverages();
    const header = [
      'Torn Poker HUD — observed pool tendencies',
      `Exported ${new Date().toISOString()}`,
    ];
    if (!obs) {
      header.push(`Fewer than 3 opponents have ${POOL_OBS_MIN_HANDS}+ hands tracked yet — not enough for a pool read.`);
      return header.join('\n') + '\n';
    }
    header.push(`Averaged across ${obs.players} tracked opponent(s) with ${POOL_OBS_MIN_HANDS}+ hands each `
      + `(hero excluded), ${obs.totalHands} hand(s) of evidence total (each qualifying player's own lifetime `
      + 'hand count, summed). Each stat is a RAW average — not sample-adjusted — and only counts players who '
      + 'actually had that opportunity at all, same rule computeRates uses everywhere else in this file.');
    header.push('');
    const row = (label, key, hasPoolFigure) => {
      const v = obs[key];
      if (v == null) return `${label}: not enough data`;
      if (!hasPoolFigure) return `${label}: ${v.toFixed(1)}% (no published pool figure to compare against)`;
      const norm = POOL_AVG[key];
      const d = deviation(v, norm, POOL_SPREAD[key]);
      return `${label}: ${v.toFixed(1)}% (assumed pool ${norm.toFixed(1)}%, `
        + `${d.level}${d.dir !== 'flat' ? ' ' + d.dir : ''})`;
    };
    const lines = [
      row('VPIP', 'vpip', true),
      row('PFR', 'pfr', true),
      row('3-Bet', 'threeBet', true),
      row('Fold to 3-Bet', 'foldTo3Bet', true),
      row('C-Bet', 'cbet', true),
      row('Fold to C-Bet', 'foldToCbet', true),
      row('Limp share of VPIP', 'limpShareOfVpip', true),
      row('AFq (aggression, folds excluded)', 'afq', false),
      row('WTSD', 'wtsd', false),
    ];
    const stakesBlock = (() => {
      const sb = poolStakesBreakdown();
      if (!sb.total) {
        return ['', 'Stakes: unknown — no qualifying player has a readable blind level recorded yet.'];
      }
      const out = ['', `Stakes (${sb.total} hand(s) with a readable blind level — `
        + 'may be less than the total above; a hand whose blind couldn\'t be read still counts toward the '
        + 'rates but not toward this breakdown):'];
      sb.stakes.forEach((s) => {
        out.push(`  ${s.name} (${fmtMoney(s.bb)} BB): ${s.hands} hand(s), ${s.share.toFixed(0)}%`);
      });
      return out;
    })();
    return header.join('\n') + '\n' + lines.join('\n') + '\n' + stakesBlock.join('\n') + '\n\n'
      + 'If these diverge from the assumed pool figures over a few hundred hands, the assumed figures '
      + '(POOL_AVG in the script) are what to correct, not this observed data — see CLAUDE.md.\n';
  }

  // How far from POOL_AVG a stat has to move before it means anything, in
  // percentage points.
  //
  // These are a JUDGEMENT CALL, not a measurement. The honest thing would be the
  // population standard deviation of each stat, which nothing here has measured
  // — so they are set from how much room each stat has and how much a difference
  // changes play. The scale is what makes deviations comparable: 5pp on VPIP
  // (norm 50.9) is noise, while 5pp on 3-bet (norm 3.7) more than doubles it.
  //
  // One spread = "notable", two = "extreme". Adjust these rather than adding
  // per-stat special cases at the call sites.
  const POOL_SPREAD = {
    vpip: 10,
    pfr: 6,
    threeBet: 2,
    foldTo3Bet: 12,
    cbet: 15,
    foldToCbet: 12,
    limpShareOfVpip: 15,
  };

  // 'typical' | 'notable' | 'extreme', plus direction. Null norm means the stat
  // has no published pool figure (AFq, WTSD) — those get no verdict rather than
  // a made-up one.
  function deviation(value, norm, spread) {
    if (value == null || norm == null || !spread) return null;
    const diff = value - norm;
    const mags = Math.abs(diff) / spread;
    return {
      diff,
      level: mags >= 2 ? 'extreme' : mags >= 1 ? 'notable' : 'typical',
      dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    };
  }

  // Thresholds are POOL-RELATIVE, not absolute. Each is written as a multiple
  // of, or distance from, POOL_AVG so that correcting POOL_AVG later moves the
  // labels with it rather than silently invalidating them.
  //
  // Pool anchors (v1.11.0, measured): VPIP 42.5, PFR 9.4, PFR/VPIP 0.221.
  // aggRatio/passiveRatio are NOT re-derived from that ratio — see the
  // "NOT touched by this correction" note on POOL_AVG above.
  const A = {
    tight: POOL_AVG.vpip * 0.55,   // ~23 — well below pool, "tight" for Torn
    loose: POOL_AVG.vpip * 1.15,   // ~49 — meaningfully looser than pool
    aggRatio: 0.45,                // PFR/VPIP; pool sits at 0.221
    passiveRatio: 0.20,            // clearly below pool: raises almost nothing
  };

  // Order matters — first match wins.
  //
  // Maniac used to test ONLY afq > 60 && vpip > loose, with no PFR/VPIP shape
  // at all — so it fired for ANY loose player with high postflop aggression,
  // including a loose-PASSIVE one (a Station who happens to bet big when they
  // do wake up) and a loose-aggressive one (a LAG). Checked first, it caught
  // both before LAG or Station ever got evaluated, which is why those two
  // read as rare regardless of the actual pool: Maniac was structurally
  // absorbing most of their population, not a symptom of POOL_AVG being off.
  //
  // Fixed by giving Maniac the SAME loose+aggressive-preflop shape as LAG
  // (vpip > loose && pfr/vpip >= aggRatio) and treating afq > 60 as the extra
  // condition that promotes a LAG into a Maniac — same "shared shape, split by
  // one more condition, more specific checked first" pattern Nit/TAG already
  // use above. A loose-PASSIVE player (pfr/vpip < passiveRatio) can no longer
  // be swept into Maniac at all; they fall through to Station like they
  // should, whatever their postflop AFq happens to be.
  const ARCHETYPE_RULES = [
    { name: 'Nit', test: (r) => r.vpip != null && r.vpip < A.tight && (r.pfr == null || r.pfr / r.vpip < A.aggRatio) },
    { name: 'TAG', test: (r) => r.vpip != null && r.vpip < A.tight && r.pfr != null && r.pfr / r.vpip >= A.aggRatio },
    { name: 'Maniac', test: (r) => r.afq != null && r.afq > 60 && r.vpip != null && r.vpip > A.loose && r.pfr != null && r.pfr / r.vpip >= A.aggRatio },
    { name: 'LAG', test: (r) => r.vpip != null && r.vpip > A.loose && r.pfr != null && r.pfr / r.vpip >= A.aggRatio },
    { name: 'Station', test: (r) => r.vpip != null && r.vpip > A.loose && (r.pfr == null || r.pfr / r.vpip < A.passiveRatio) },
    { name: 'Fish', test: (r) => r.vpip != null && r.vpip > POOL_AVG.vpip && (r.pfr == null || r.pfr / r.vpip < A.aggRatio) },
  ];

  // Three-letter forms for the seat badge and the players list, where the full
  // word eats space the numbers need. Panels and reports keep the full name.
  const ARCHETYPE_SHORT = {
    Nit: 'NIT', TAG: 'TAG', LAG: 'LAG', Maniac: 'MAN',
    Station: 'STA', Fish: 'FSH', Balanced: 'BAL', Unrated: 'UNR',
  };
  function shortType(label) {
    return ARCHETYPE_SHORT[label] || String(label || '').slice(0, 3).toUpperCase();
  }

  function classify(player) {
    if (player.hands < STORE.settings.minHands) return 'Unrated';
    return classifyProvisional(player);
  }

  // Same rules with no minimum-hands gate. The seat badge uses this so a player
  // you have only just met still gets a readable type rather than the word
  // "Unrated", which is the least useful thing a HUD can put on the felt. The
  // caller is responsible for marking it as provisional.
  //
  // Shrunk rates, not raw: without them a player seen for two hands who happened
  // to play both reads as a 100%-VPIP maniac. With them they read as roughly
  // pool-average until there is evidence otherwise.
  function classifyProvisional(player) {
    const r = computeShrunkRates(player);
    for (const rule of ARCHETYPE_RULES) {
      if (rule.test(r)) return rule.name;
    }
    return 'Balanced';
  }

  // ===========================================================================
  // 9. GTO-INSPIRED STRATEGY MODULE
  // ===========================================================================

  // RFI (raise-first-in) charts, 100bb. TWO sets: Torn tables run both short and
  // full ring, and one set cannot serve both — full-ring UTG opens roughly 11%
  // where 6-max UTG opens roughly 17%, so using the 6-max chart at a 9-handed
  // table opens about half again too many hands from the worst seat at the table.
  // `rfiChartFor` picks the set from the seat count observed that hand.
  //
  // These are simplified reference charts, NOT solver output. Widths are
  // calibrated to published figures (see SOURCES below); the exact hand at each
  // range edge is a reconstruction that hits that width.
  //
  // The percentage on each line is MEASURED, not asserted: expand the range with
  // expandRangeToken and weight by combos (pair 6, suited 4, offsuit 12) out of
  // 1326. Re-measure and update the comment if you touch a range. Eyeballing a
  // range string undercounts offsuit hands 3x, which is how an earlier pass
  // shipped charts at roughly two-thirds of their intended width.
  //
  // SOURCES (frequencies cross-checked, then each published range string
  // re-measured against its own published percentage — several charts found in
  // the wild disagree with their own stated figure, usually because the offsuit
  // block is omitted, so a figure was only used when the two agreed):
  //   upswingpoker.com/charts        6-max UTG 18.5 / BTN 43.1;
  //                                  9-max UTG 10.2 / BTN 40.8
  //   pokercoaching.com/preflop-charts  6-max LJ 17.0, HJ 21.1, CO 27.8;
  //                                  full ring UTG 12.1, UTG+1 13.3, LJ 16.1, HJ 19.6
  //   preflopwizard.app/blog/preflop-charts  6-max CO 25.2, BTN 41.8;
  //                                  full ring UTG 12.5, MP 13.4, HJ 16.7, CO 22.8, BTN 40.6
  //   blog.freebetrange.com          6-max bands EP 15-17, HJ 19-22, CO 25-30,
  //                                  BTN 40-48, SB 39-47
  const RFI_RANGES = {
    // <= 6 handed.
    SHORT: {
      EP: '22+,A2s+,KTs+,QTs+,JTs,T9s,98s,ATo+,KJo+',                                    // 17.3%
      MP: '22+,A2s+,K8s+,Q8s+,J8s+,T8s+,98s,87s,76s,ATo+,KJo+,QJo',                      // 21.0%
      CO: '22+,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A8o+,KTo+,QTo+,JTo',            // 26.4%
      BTN: '22+,A2s+,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K7o+,Q9o+,J9o+,T9o', // 41.8%
      // SB is raise-or-fold with only the BB left to act, so it is wide despite
      // being out of position — it is not "one step tighter than the button".
      SB: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o', // 42.1%
    },
    // 7+ handed. Early position tightens sharply; the button barely moves, which
    // is why only the early seats really need a separate chart.
    FULL: {
      UTG: '22+,ATs+,KTs+,QTs+,JTs,AQo+,KQo',                                            // 11.6%
      UTG1: '22+,A9s+,KTs+,QTs+,JTs,T9s,AJo+,KQo',                                       // 13.1%
      LJ: '22+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+',                                       // 16.4%
      HJ: '22+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,ATo+,KTo+',                                   // 19.5%
      CO: '22+,A2s+,K7s+,Q9s+,J8s+,T8s+,97s+,87s,76s,A9o+,KTo+,QJo',                     // 23.1%
      BTN: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o', // 40.6%
      // WEAKEST NUMBER IN THE SET: no full-ring SB figure survived the
      // consistency check (published SB charts mix raising and limping, so the
      // quoted percentage covers both). Banded by analogy with the 6-max SB, one
      // notch tighter. Treat as the least trustworthy chart here.
      SB: '22+,A2s+,K3s+,Q6s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s,A2o+,K9o+,Q9o+,J9o+,T9o', // 39.1%
    },
    // No BB entry in either set, on purpose. The big blind is never raising
    // FIRST in — it is always defending or isolating, and preflopBaseline routes
    // it there. Do not add one: the code used to fall back to the CO chart for
    // any unknown label, which silently gave big-blind advice off a cutoff range.
  };

  // Seven or more players makes it a full-ring hand. Below that the short-handed
  // charts apply; Torn tables run both, so this is read per hand rather than
  // taken from the tableMax setting (which only drives the equity quote).
  const FULL_RING_SEATS = 7;
  function rfiChartFor(position, seats) {
    const set = (seats >= FULL_RING_SEATS) ? RFI_RANGES.FULL : RFI_RANGES.SHORT;
    return set[position] || null;
  }

  // 3-bet ranges facing a single open. Split by whether hero will be in position
  // postflop — the OOP chart existed before this and was never actually used,
  // so every 3-bet call was made on the in-position range.
  const THREE_BET_RANGES = {
    IP: '99+,ATs+,KJs+,QTs+,JTs,T9s,98s,A5s,A4s,A3s,AQo+,KQo',  // 9.7%
    OOP: 'TT+,AJs+,KQs,QJs,A5s,A4s,AQo+',                        // 6.2%
  };

  // Facing a 3-bet (or more). Deliberately value-heavy: this is a "continue at
  // all" reference, not a balanced 4-betting strategy.
  const FOUR_BET_RANGE = 'QQ+,AKs,AKo,A5s'; // 2.9%

  function expandRangeToken(token) {
    // Handles: pair "88", pair+ "88+", pair range "66-99",
    // suited/offsuit exact "AJs", plus "AJs+", range "A5s-A9s".
    const idx = rankIdx;
    const hands = new Set();

    const pairPlus = /^([2-9TJQKA])\1\+$/.exec(token);
    const pairRange = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(token);
    const pairExact = /^([2-9TJQKA])\1$/.exec(token);
    const suitedPlus = /^([2-9TJQKA])([2-9TJQKA])(s|o)\+$/.exec(token);
    // Both sides must share the high card and the suitedness: "A5s-A9s". The
    // backreferences used to be on the wrong groups, so this form matched
    // nothing and the token was dropped in silence — a range could lose a whole
    // chunk of hands with no error anywhere.
    const suitedRange = /^([2-9TJQKA])([2-9TJQKA])(s|o)-\1([2-9TJQKA])\3$/.exec(token);
    const suitedExact = /^([2-9TJQKA])([2-9TJQKA])(s|o)$/.exec(token);

    if (pairPlus) {
      for (let i = idx(pairPlus[1]); i < RANKS.length; i++) hands.add(RANKS[i] + RANKS[i]);
    } else if (pairRange) {
      const lo = Math.min(idx(pairRange[1]), idx(pairRange[2]));
      const hi = Math.max(idx(pairRange[1]), idx(pairRange[2]));
      for (let i = lo; i <= hi; i++) hands.add(RANKS[i] + RANKS[i]);
    } else if (pairExact) {
      hands.add(pairExact[1] + pairExact[1]);
    } else if (suitedPlus) {
      const [, hi, loStart, suited] = suitedPlus;
      for (let i = idx(loStart); i < idx(hi); i++) hands.add(hi + RANKS[i] + suited);
    } else if (suitedRange) {
      const [, hi, loA, suited, loB] = suitedRange;
      const lo = Math.min(idx(loA), idx(loB));
      const hiIdx = Math.max(idx(loA), idx(loB));
      for (let i = lo; i <= hiIdx; i++) hands.add(hi + RANKS[i] + suited);
    } else if (suitedExact) {
      hands.add(suitedExact[1] + suitedExact[2] + suitedExact[3]);
    }
    return hands;
  }

  const rangeCache = {};
  function parseRange(rangeStr) {
    if (rangeCache[rangeStr]) return rangeCache[rangeStr];
    const all = new Set();
    rangeStr.split(',').forEach((tok) => {
      expandRangeToken(tok.trim()).forEach((h) => all.add(h));
    });
    rangeCache[rangeStr] = all;
    return all;
  }

  function handToShorthand(cardA, cardB) {
    const idx = rankIdx;
    const [hi, lo] = idx(cardA.rank) >= idx(cardB.rank) ? [cardA, cardB] : [cardB, cardA];
    if (hi.rank === lo.rank) return hi.rank + lo.rank;
    return hi.rank + lo.rank + (hi.suit === lo.suit ? 's' : 'o');
  }

  function isHandInRange(cardA, cardB, rangeStr) {
    const range = parseRange(rangeStr);
    return range.has(handToShorthand(cardA, cardB));
  }

  // Range proxy for a Monte Carlo opponent, keyed by how many preflop raise
  // events the hand has seen — 0 (unopened/limped), 1 (a single open), 2 (a
  // 3-bet), 3+ (a 4-bet or more). Reuses chart data this project has already
  // sourced and combo-weighted for the coach (see "Preflop charts" in
  // CLAUDE.md) instead of inventing new percentages — the same approach
  // Torn Poker Helper (GreasyFork 538541) uses with flat 35%/12%/5% figures,
  // but grounded in ranges this repo has already verified.
  //
  // One flat proxy per tier, not conditioned on seat count or the specific
  // opener's real position — that identity isn't threaded through to the
  // equity call. RFI_RANGES.SHORT.CO (26.4%) sits roughly in the middle of the
  // real spread across positions (full-ring UTG ~11.6% to short BTN ~42%),
  // which is a materially better stand-in for "this pot was opened" than
  // treating every opponent as a uniformly random hand — the status quo this
  // replaces. Returns null for an unopened/limped pot: Torn Poker Helper only
  // narrows ranges once the pot IS raised, and there is no single "limping
  // range" chart in this file to borrow from.
  function opponentRangeProxy(raiseLevel) {
    const n = Number(raiseLevel) || 0;
    if (n <= 0) return null;
    if (n === 1) return RFI_RANGES.SHORT.CO; // ~26.4% — someone opened
    if (n === 2) return THREE_BET_RANGES.IP; // ~9.7% — someone 3-bet
    return FOUR_BET_RANGE;                    // ~2.9% — a 4-bet or more
  }

  // What the equity quote's opponents actually are, in a few words — has to
  // track opponentRangeProxy exactly, since it is describing that function's
  // choice, not the hand generically. "vs random" undersells a raised pot
  // (opponents are narrowed); anything else would oversell an unopened one.
  function equityBasisLabel(raiseLevel) {
    const n = Number(raiseLevel) || 0;
    if (n <= 0) return 'vs random';
    if (n === 1) return 'vs open range';
    if (n === 2) return 'vs 3-bet range';
    return 'vs 4-bet range';
  }

  // Fraction of the time the defender must continue. Returns null when the pot
  // isn't known: 0/(0+0) is NaN, and "defend roughly NaN% of your range" was
  // reaching the live coach panel whenever the script loaded mid-hand, because
  // the log snapshot is primed (not parsed) on attach so hand.pot starts at 0.
  function minimumDefenseFrequency(bet, pot) {
    const p = Number(pot) || 0;
    const b = Number(bet) || 0;
    if (p + b <= 0) return null;
    return p / (p + b);
  }

  // How many players limped in before any raise. An RFI chart is a raise-FIRST-in
  // chart: over limpers the spot is an isolation raise, and the old code applied
  // the opening chart to it and called the result "open-raise".
  function preflopLimperCount(hand) {
    const seen = new Set();
    for (const a of hand.actions) {
      if (a.s !== 'preflop') break;          // actions are in order; preflop is first
      if (a.a === 'raise' || a.a === 'all-in') break;
      if (a.a === 'call') seen.add(a.x);
    }
    return seen.size;
  }

  // True if hero acts after `villainXid` POSTFLOP, which is what "in position"
  // means for the 3-bet chart. Both rotations are SB-first — exactly postflop
  // order — so a later index means later to act.
  //
  // Prefer the seat ring. The log rotation only contains players who have acted,
  // and this used to fall back to "hero hasn't acted, so hero is after everyone
  // who has" — which answers a question about PREFLOP order, and quietly picked
  // the looser in-position chart whenever hero hadn't acted yet. Returning null
  // is the honest answer; the caller then uses the tighter chart and says so.
  function heroIsInPositionVs(hand, villainXid) {
    if (!heroXid || !villainXid) return null;
    const rot = seatRotationFromDom(hand) || buildRotation(hand);
    if (!rot) return null;
    const vi = rot.indexOf(villainXid);
    const hi = rot.indexOf(heroXid);
    if (vi < 0 || hi < 0) return null;
    return hi > vi;
  }

  // Position as it appears in every coach line. Always present, so you can see
  // at a glance which seat the advice is for — postflop lines used to omit it
  // entirely, which meant the one number you most need to sanity-check the
  // advice against was missing exactly when the board mattered most.
  //   CO   read from the seat ring (exact)
  //   CO?  derived from the log's action order (less certain)
  //   ?    not established this hand
  function positionTag(position, inferred) {
    if (!position) return '?';
    return inferred ? `${position}?` : position;
  }

  // Preflop is split by SITUATION first, then by chart. Applying an opening
  // range to a limped pot, or a 3-bet range to a 4-bet decision, gives advice
  // that reads as confident and is answering a different question.
  function preflopBaseline(ctx) {
    const { position, positionInferred, heroCards, posDiag, seats,
            preflopRaises, limpers, heroInPosition, heroHasRaised } = ctx;

    // Without a known position no chart is meaningful — say so rather than
    // quietly assuming a seat and giving confidently wrong advice.
    if (!position) {
      return `Baseline (?): position unknown this hand (${posDiag || 'reason unclear'}) — no preflop chart applied.`;
    }
    // A "?" marks a seat derived from the log's action order rather than read
    // off the seat ring: a misread seat changes the chart, and advice that looks
    // equally confident either way is the failure mode worth avoiding.
    const pos = positionTag(position, positionInferred);
    const inRange = (r) => isHandInRange(heroCards[0], heroCards[1], r);

    // --- facing a re-raise -------------------------------------------------
    if (preflopRaises >= 2) {
      const verb = heroHasRaised ? '4-bet or call' : 'call';
      return inRange(FOUR_BET_RANGE)
        ? `Baseline (${pos}): ${verb} — inside a standard continuing range vs a re-raise.`
        : `Baseline (${pos}): fold to the re-raise — outside a standard continuing range.`;
    }

    // --- facing a single open ----------------------------------------------
    if (preflopRaises === 1 && !heroHasRaised) {
      // Unknown relative position falls back to the TIGHTER chart. The old code
      // used the in-position range unconditionally, which is the loose one.
      const ip = heroInPosition === true;
      const chart = ip ? THREE_BET_RANGES.IP : THREE_BET_RANGES.OOP;
      const note = heroInPosition == null
        ? ', position vs the raiser unknown so the tighter out-of-position chart is used'
        : (ip ? ', in position' : ', out of position');
      return inRange(chart)
        ? `Baseline (${pos}): 3-bet — in a standard 3-bet range${note}.`
        : `Baseline (${pos}): fold, or flat if the pot odds and your reads justify it — outside a standard 3-bet range${note}.`;
    }

    // --- hero already opened and is only facing calls -----------------------
    if (heroHasRaised) {
      return `Baseline (${pos}): you are the preflop aggressor — no further preflop chart applies.`;
    }

    // --- big blind: never raise-first-in ------------------------------------
    const rfiRange = rfiChartFor(position, seats);
    if (!rfiRange) {
      return limpers > 0
        ? `Baseline (${pos}): no raise to face, ${limpers} limper(s) — isolating with the top of your range is usually right. The big blind has no RFI chart (it is never first in), so none is applied.`
        : `Baseline (${pos}): checking is free. The big blind has no RFI chart (it is never first in), so none is applied.`;
    }

    // --- limped pot: isolation, not RFI -------------------------------------
    if (limpers > 0) {
      return inRange(rfiRange)
        ? `Baseline (${pos}): raise to isolate the ${limpers} limper(s) — in your ${position} opening range (an opening chart is only a rough floor here; limpers rarely fold, so lean toward value).`
        : `Baseline (${pos}): fold — outside your ${position} opening range, and limpers make a steal less likely to get through.`;
    }

    // --- genuinely unopened: the one spot an RFI chart is for ----------------
    return inRange(rfiRange)
      ? `Baseline (${pos}): open-raise — in your ${position} RFI range.`
      : `Baseline (${pos}): fold — outside a standard ${position} opening range.`;
  }

  function gtoBaselineSuggestion(ctx) {
    const { street, heroCards, betFacing, pot, position, positionInferred, posDiag } = ctx;
    if (street === 'preflop' && heroCards) return preflopBaseline(ctx);
    // Postflop lines carry the position too. They didn't before, so the seat
    // silently disappeared from the advice the moment the flop came down.
    const tag = positionTag(position, positionInferred);
    const why = position ? '' : ` (${posDiag || 'position not established'})`;
    const mdf = minimumDefenseFrequency(betFacing, pot);
    if (mdf != null) {
      return `Baseline (${tag}): defend roughly ${fmtPct(mdf * 100)} of your range here (MDF), `
        + `pot ${fmtMoney(pot)}.${why}`;
    }
    return `Baseline (${tag}): check/bet a balanced portion of your range. (Pot size unknown `
      + `this hand — no MDF or pot odds; this happens when the HUD starts mid-hand.)${why}`;
  }


  // ===========================================================================
  // 12. CARD READING, EQUITY, POSITION, SESSION
  // ===========================================================================

  const SUIT_CHARS = ['s', 'h', 'd', 'c'];
  // Letter -> glyph, the reverse of SUIT_SYMBOLS below (glyph -> letter, for
  // PARSING). This is for DISPLAY — the replayer is the first thing in this
  // file that needs to print a {rank,suit} card back out rather than just read one.
  const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function cardGlyph(c) { return c ? c.rank + (SUIT_GLYPH[c.suit] || '') : ''; }
  function cardsGlyphText(cards) { return (cards || []).map(cardGlyph).join(' '); }

  const RANK_WORDS = {
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', nine: '9', eight: '8',
    seven: '7', six: '6', five: '5', four: '4', three: '3', two: '2',
  };

  function normRank(raw) {
    const r = String(raw).toUpperCase();
    return r === '10' ? 'T' : r;
  }

  // Cards can come from a class name, an aria-label, or plain log text — try all.
  //
  // The aria-label branch used to accept only spelled-out ranks ("nine of
  // clubs"), but a live scan shows Torn writes DIGITS — `aria-label: 9 of
  // clubs`. Every numeric card therefore failed here and only resolved when the
  // class name happened to carry it. parseCardsFromText understands both
  // spellings, so defer to it rather than keeping a second, weaker parser.
  function parseCardEl(el) {
    const cn = typeof el.className === 'string' ? el.className : '';
    const m = CARD_CLASS_RE.exec(cn);
    if (m) return { suit: m[1][0].toLowerCase(), rank: normRank(m[2]) };
    const al = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
    if (!al || /face down/i.test(al)) return null;
    const cards = parseCardsFromText(al);
    return cards.length ? cards[0] : null;
  }

  const SUIT_SYMBOLS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

  // Cards out of text, in both shapes Torn uses.
  //
  // Torn writes "9♥" in the visual log and "9 of hearts" in aria-labels and
  // screen-reader text, so both must parse. The spelled-out form matters more
  // than it looks: readLogRows appends card aria-labels to each row, which is
  // the only way a reveal renders when Torn draws the cards as elements rather
  // than text.
  //
  // The old pattern was `/(10|[2-9TJQKA])\s*([shdc♠♥♦♣])/gi` with no boundaries,
  // and case-insensitivity made it match letters INSIDE ordinary words: it read
  // "9 of hearts, 7 of spades" as "ATo" — a confidently wrong hand rather than
  // no hand, which is the worse failure. Torn's own hand descriptions ("Two
  // Pairs: Aces and Eights") are full of such traps. Hence the boundaries.
  function parseCardsFromText(text) {
    const s = String(text || '');
    const out = [];
    const seen = new Set();
    const add = (rank, suit) => {
      if (!rank || !SUIT_CHARS.includes(suit)) return;
      const key = rank + suit;
      if (seen.has(key)) return; // the same card can't appear twice
      seen.add(key);
      out.push({ rank, suit });
    };

    // "9 of hearts", "Ace of spades", "10 of clubs".
    const wordRe = new RegExp(
      '\\b(10|[2-9]|' + Object.keys(RANK_WORDS).join('|') + '|[TJQKA])\\s+of\\s+(spades?|hearts?|diamonds?|clubs?)\\b',
      'gi'
    );
    let m;
    while ((m = wordRe.exec(s))) {
      const rawRank = m[1].toLowerCase();
      add(RANK_WORDS[rawRank] || normRank(m[1]), m[2][0].toLowerCase());
    }

    // "9♥" or "9s". Bounded on BOTH sides by a non-alphanumeric, so "Ac" inside
    // "Aces" and "ad" inside "spades" can no longer be read as cards.
    const tightRe = /(?:^|[^A-Za-z0-9])(10|[2-9TJQKA])\s?([shdc♠♥♦♣])(?![A-Za-z0-9])/gi;
    while ((m = tightRe.exec(s))) {
      const suitRaw = m[2];
      add(normRank(m[1]), SUIT_SYMBOLS[suitRaw] || suitRaw.toLowerCase());
      tightRe.lastIndex -= 1; // the leading boundary can be the next card's separator
    }

    return out.slice(0, 5);
  }

  function readHeroCards() {
    const seat = document.querySelector(SELECTORS.heroSeat);
    let els = seat ? seat.querySelectorAll(SELECTORS.heroCards) : [];
    if (!els.length) els = document.querySelectorAll(SELECTORS.heroCards);
    const cards = [];
    els.forEach((el) => { const c = parseCardEl(el); if (c) cards.push(c); });
    return cards.slice(0, 2);
  }

  // Read the pot straight off the table.
  //
  // Confirmed live (v0.17.0 scan): DIV.potsWrapper_ > DIV.totalPotWrap_, whose
  // text is "POT:$7,000,000". Until now the pot was ONLY the running sum of
  // parsed log amounts, which starts at zero whenever the HUD attaches mid-hand
  // (the visible log is primed, not parsed) and drifts permanently on any amount
  // the parser misses. That silently corrupted pot odds and MDF — and produced
  // "defend roughly NaN%" on a live table.
  //
  // The DOM figure is authoritative when present; the log sum stays as fallback.
  //
  // Selectors come from SELECTORS.potDisplay, split on the comma and tried in
  // order (most specific first — the wrapper holds side pots as well as the
  // total). They used to be a hardcoded copy of that entry, which meant
  // SELECTORS.potDisplay was declared, was the obvious place to edit after a
  // Torn redeploy, and was read by nothing: updating it would have fixed
  // nothing and the failure would have been silent. That is the same trap that
  // left seatName unread for sixteen versions.
  function readDomPot() {
    for (const sel of SELECTORS.potDisplay.split(',').map((x) => x.trim())) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent || '';
      let best = null;
      const re = /\$\s*([\d,]+)/g;
      let m;
      // Side pots put several figures in the wrapper; the total is the largest.
      while ((m = re.exec(text))) {
        const v = parseAmount(m[1]);
        if (v > 0 && (best === null || v > best)) best = v;
      }
      if (best !== null) return best;
    }
    return null;
  }

  // Pot to reason with: the table's own number if we can read it, else our sum.
  function effectivePot(hand) {
    const dom = readDomPot();
    if (dom != null) return dom;
    return (hand && hand.pot) || 0;
  }

  // The board, read from the DOM.
  //
  // `communityCards_` was written up as matching ZERO on a live scan, and that
  // conclusion was wrong: a v1.40.0 scan matched 4 with four board cards up.
  // The earlier zeroes were all taken preflop or between hands, where there is
  // no board to match — "0 matches" was read as "the selector is broken" when
  // it meant "there were no cards". Worth remembering when reading any count
  // in a scan: a selector that matches nothing may simply have nothing to find.
  //
  // The structural fallback below is kept regardless, because it needs no
  // hashed container name at all and so cannot break on a Torn redeploy.
  //
  // Rather than depend on a hashed container name, derive it from structure
  // that IS confirmed: a face-up card is `[class*="front_"] > div[role="img"]`,
  // and hero's are the ones inside `[class*="hand_"]`. Everything face-up that
  // is NOT in hero's hand is the board. Done in JS because the exclusion is an
  // ancestor test, which a single CSS selector can't express portably.
  function readBoardCards() {
    const cards = [];
    const seen = new Set();
    const push = (el) => {
      const c = parseCardEl(el);
      if (!c) return;
      const key = c.rank + c.suit;
      if (seen.has(key)) return; // a card can't appear twice on one board
      seen.add(key);
      cards.push(c);
    };

    // Named container first, on the chance some layout does expose one.
    document.querySelectorAll(SELECTORS.communityCards).forEach(push);

    if (!cards.length) {
      document.querySelectorAll(SELECTORS.anyFaceUpCard).forEach((el) => {
        if (el.closest(SELECTORS.heroHand)) return;  // hero's hole cards
        if (el.closest(SELECTORS.seatContainer)) return; // an opponent's revealed cards
        push(el);
      });
    }

    if (cards.length) return cards.slice(0, 5);
    return (currentHand && currentHand.board) || []; // fall back to the log-parsed board
  }

  function cardToNum(c) {
    return { r: rankIdx(c.rank) + 2, s: SUIT_CHARS.indexOf(c.suit) };
  }

  // 7-card evaluator. Returns a comparable array: [category, tiebreakers...].
  // Category 8=straight flush … 0=high card. Verified against known hand
  // rankings and published preflop equities before porting here.
  function evaluate7(cards) {
    const ranks = cards.map((c) => c.r);
    const suits = cards.map((c) => c.s);
    const rc = {};
    const sc = {};
    ranks.forEach((r) => { rc[r] = (rc[r] || 0) + 1; });
    suits.forEach((s) => { sc[s] = (sc[s] || 0) + 1; });

    let flushSuit = -1;
    Object.keys(sc).forEach((s) => { if (sc[s] >= 5) flushSuit = +s; });

    const straightHigh = (list) => {
      const set = new Set(list);
      if (set.has(14)) set.add(1); // wheel: A counts low
      for (let hi = 14; hi >= 5; hi--) {
        let ok = true;
        for (let i = 0; i < 5; i++) { if (!set.has(hi - i)) { ok = false; break; } }
        if (ok) return hi;
      }
      return 0;
    };

    // A flush and a full house can't coexist in 7 cards, so returning here is safe.
    if (flushSuit >= 0) {
      const fr = cards.filter((c) => c.s === flushSuit).map((c) => c.r);
      const sfh = straightHigh(fr);
      if (sfh) return [8, sfh];
      return [5].concat(fr.sort((a, b) => b - a).slice(0, 5));
    }

    const sh = straightHigh(ranks);
    const groups = Object.keys(rc).map((r) => [+r, rc[r]]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const c0 = groups[0][1];
    const c1 = groups[1] ? groups[1][1] : 0;

    if (c0 === 4) {
      const q = groups[0][0];
      return [7, q, Math.max.apply(null, ranks.filter((r) => r !== q))];
    }
    if (c0 === 3 && c1 >= 2) return [6, groups[0][0], groups[1][0]];
    if (sh) return [4, sh];
    if (c0 === 3) {
      const t = groups[0][0];
      return [3, t].concat(ranks.filter((r) => r !== t).sort((a, b) => b - a).slice(0, 2));
    }
    if (c0 === 2 && c1 === 2) {
      const p1 = groups[0][0];
      const p2 = groups[1][0];
      const k = Math.max.apply(null, ranks.filter((r) => r !== p1 && r !== p2));
      return [2, Math.max(p1, p2), Math.min(p1, p2), k];
    }
    if (c0 === 2) {
      const p = groups[0][0];
      return [1, p].concat(ranks.filter((r) => r !== p).sort((a, b) => b - a).slice(0, 3));
    }
    return [0].concat(ranks.slice().sort((a, b) => b - a).slice(0, 5));
  }

  function cmpHand(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  // Same shorthand as handToShorthand, for the numeric {r,s} cards this deck
  // deals rather than the {rank,suit} letter cards the range charts are
  // written against. RANKS[r-2] inverts cardToNum's rankIdx(c.rank)+2.
  function numericHandShorthand(a, b) {
    const hi = a.r >= b.r ? a : b;
    const lo = a.r >= b.r ? b : a;
    if (hi.r === lo.r) return RANKS[hi.r - 2] + RANKS[lo.r - 2];
    return RANKS[hi.r - 2] + RANKS[lo.r - 2] + (hi.s === lo.s ? 's' : 'o');
  }

  // Monte Carlo equity against N opponents. `raiseLevel` (preflop raise events
  // this hand has seen: 0 unopened/limped, 1 an open, 2 a 3-bet, 3+ a 4-bet+)
  // is optional — omit it, or pass 0, for the original "vs N random hands"
  // behaviour, still the honest answer for an unopened pot. When a raise HAS
  // happened, opponents are drawn from opponentRangeProxy(raiseLevel) instead
  // of the full 52-card pool: a real raiser does not hold 72o, and quoting
  // equity as if they might reads pessimistically against tight players and
  // optimistically against loose ones — the exact caveat "Eq vs random" was
  // already printed on this figure to admit. The UI wording is updated
  // alongside this to say what it now means for a raised pot.
  // The Monte Carlo is split into init / step / value so the SAME loop can be
  // run either straight through (estimateEquity, just below) or a slice at a
  // time across animation frames (runEquityJob, for the live coach panel).
  //
  // ONE implementation, deliberately. A second copy of the loop for the sliced
  // path — driven by the UI but not by the tests — is precisely the trap this
  // repo has already paid for once: "a test of a copy cannot fail when the
  // original is wrong" (v1.0.1, see CLAUDE.md). Everything below drives this.
  //
  // Returns null when the situation cannot be simulated at all: bad cards, an
  // over-long board, or more opponents than the remaining deck can deal.
  function equityJobInit(heroCards, boardCards, nOpp, raiseLevel) {
    if (!heroCards || heroCards.length !== 2) return null;
    const hero = heroCards.map(cardToNum);
    const board = (boardCards || []).map(cardToNum).filter((c) => c.s >= 0 && c.r >= 2);
    if (hero.some((c) => c.s < 0 || c.r < 2)) return null;
    if (board.length > 5) return null;

    const dead = new Set(hero.concat(board).map((c) => c.r * 4 + c.s));
    const deck = [];
    for (let r = 2; r <= 14; r++) {
      for (let s = 0; s < 4; s++) { if (!dead.has(r * 4 + s)) deck.push({ r, s }); }
    }

    const need = 5 - board.length;
    const take = need + 2 * nOpp;
    if (take > deck.length) return null;

    const rangeStr = opponentRangeProxy(raiseLevel);
    const rangeSet = rangeStr ? parseRange(rangeStr) : null;

    // Every in-range pair still possible from this deck, computed ONCE per
    // call rather than rediscovered inside the iteration loop. A range like
    // FOUR_BET_RANGE only touches a handful of ranks, so this list stays
    // short (tens of combos, not hundreds) — a first version that instead
    // re-enumerated candidates from scratch for every opponent on every one
    // of 1200 iterations measured ~350ms for a single call at 8 opponents
    // (vs ~20ms unweighted), a regression that would visibly stall the coach
    // panel, which asks for two of these every render. Picking from a small
    // fixed list is what actually makes this affordable.
    let rangeCombos = null;
    if (rangeSet) {
      rangeCombos = [];
      for (let a = 0; a < deck.length; a++) {
        for (let b = a + 1; b < deck.length; b++) {
          if (rangeSet.has(numericHandShorthand(deck[a], deck[b]))) rangeCombos.push([deck[a], deck[b]]);
        }
      }
    }

    const iters = clampEquityIters(STORE.settings.equityIters);
    return { hero, board, deck, need, nOpp, rangeSet, rangeCombos, iters, i: 0, win: 0, tie: 0 };
  }

  // Runs at most `budget` further iterations, resuming exactly where the last
  // call left off, and returns true once every iteration has been run.
  //
  // `st.i` is the ONLY progress marker: the loop below both reads and advances
  // it, so a slice can never re-run or skip an iteration no matter how the
  // budget falls. test/equity-slicing.test.js pins that — an off-by-one here
  // would silently change the sample size the result is divided by, which
  // would look like a slightly wrong equity figure rather than like a bug.
  function equityJobStep(st, budget) {
    const { hero, board, deck, need, nOpp, rangeSet, rangeCombos } = st;
    const end = Math.min(st.iters, st.i + Math.max(1, budget));
    for (; st.i < end; st.i++) {
      // Board completion cards only, drawn first so range-weighted opponent
      // hands below always avoid whatever the board turned out to be.
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i));
        const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
      }
      const usedIds = new Set();
      for (let i = 0; i < need; i++) usedIds.add(deck[i].r * 4 + deck[i].s);

      // Range-weighted opponents: pick a random entry from the precomputed
      // combo list and accept it unless a card in it is already spoken for
      // (the board, or an earlier opponent this same iteration) — retried
      // against that same short list, not against the whole deck, so this
      // stays cheap even late in a full field. A range this narrow genuinely
      // cannot supply 8 non-conflicting hands (FOUR_BET_RANGE touches maybe a
      // dozen physical cards total), so some opponents in a big field will
      // legitimately fall through to the random fallback below — that is the
      // honest outcome, not a bug: a table with eight live QQ+/AK hands
      // facing a 4-bet does not reflect anything real either.
      const oppHands = new Array(nOpp).fill(null);
      if (rangeSet && rangeCombos.length) {
        for (let o = 0; o < nOpp; o++) {
          for (let attempt = 0; attempt < 40; attempt++) {
            const [a, b] = rangeCombos[Math.floor(Math.random() * rangeCombos.length)];
            const idA = a.r * 4 + a.s;
            const idB = b.r * 4 + b.s;
            if (!usedIds.has(idA) && !usedIds.has(idB)) {
              oppHands[o] = [a, b];
              usedIds.add(idA);
              usedIds.add(idB);
              break;
            }
          }
        }
      }
      // Everyone still unfilled — raiseLevel 0, or a range the field has
      // already exhausted — draws uniformly from whatever real cards are
      // left, the original behaviour and the only honest option once the
      // range has nothing left to give.
      const remaining = deck.slice(need).filter((c) => !usedIds.has(c.r * 4 + c.s));
      let ri = 0;
      for (let o = 0; o < nOpp; o++) {
        if (oppHands[o]) continue;
        const j1 = ri + Math.floor(Math.random() * (remaining.length - ri));
        const t1 = remaining[ri]; remaining[ri] = remaining[j1]; remaining[j1] = t1; ri++;
        const j2 = ri + Math.floor(Math.random() * (remaining.length - ri));
        const t2 = remaining[ri]; remaining[ri] = remaining[j2]; remaining[j2] = t2; ri++;
        oppHands[o] = [remaining[ri - 2], remaining[ri - 1]];
      }

      const full = board.concat(deck.slice(0, need));
      const hv = evaluate7(hero.concat(full));
      let best = null;
      for (let o = 0; o < nOpp; o++) {
        const ov = evaluate7(oppHands[o].concat(full));
        if (best === null || cmpHand(ov, best) > 0) best = ov;
      }
      const c = cmpHand(hv, best);
      if (c > 0) st.win++; else if (c === 0) st.tie++;
    }
    return st.i >= st.iters;
  }

  function equityJobValue(st) {
    return (100 * (st.win + st.tie * 0.5)) / st.iters;
  }

  // Blocking equity: the whole simulation, straight through. Still the right
  // shape for the hand replayer, which is user-driven one step at a time and
  // wants the number in hand before it renders, and it stays the reference
  // implementation every existing equity test drives.
  function estimateEquity(heroCards, boardCards, nOpp, raiseLevel) {
    const st = equityJobInit(heroCards, boardCards, nOpp, raiseLevel);
    if (!st) return null;
    equityJobStep(st, st.iters);
    return equityJobValue(st);
  }

  // The coach panel re-renders every 1.5s; recomputing thousands of showdowns
  // each time would cook the phone. Only recompute when the situation changes.
  //
  // This is a small keyed cache rather than one slot because the panel now asks
  // for several opponent counts for the same board (full ring, live, heads-up).
  // With a single slot each lookup evicted the previous one and nothing ever hit
  // cache — every render recomputed every figure from scratch.
  // raiseLevel is part of the key, not just an argument: the same hero cards,
  // board and opponent count mean something different once someone 3-bets, and
  // a cache keyed on the first three alone would keep serving a pre-raise
  // figure straight through the raise that should have changed it.
  const EQUITY_CACHE_MAX = 12;
  const equityCache = new Map();

  function equityCacheKey(heroCards, boardCards, nOpp, raiseLevel) {
    return heroCards.map((c) => c.rank + c.suit).join('')
      + '|' + (boardCards || []).map((c) => c.rank + c.suit).join('')
      + '|' + nOpp + '|' + (Number(raiseLevel) || 0);
  }

  function equityCacheSet(key, value) {
    equityCache.set(key, value);
    // Board changes make old entries unreachable; cap the map so a long session
    // doesn't accumulate one entry per hand forever.
    if (equityCache.size > EQUITY_CACHE_MAX) {
      equityCache.delete(equityCache.keys().next().value);
    }
    return value;
  }

  function estimateEquityCached(heroCards, boardCards, nOpp, raiseLevel) {
    const key = equityCacheKey(heroCards, boardCards, nOpp, raiseLevel);
    if (equityCache.has(key)) return equityCache.get(key);
    return equityCacheSet(key, estimateEquity(heroCards, boardCards, nOpp, raiseLevel));
  }

  // --- Sliced equity, for the live coach panel -----------------------------
  //
  // WHY this exists: the simulation is by a wide margin the most expensive
  // thing this script does. Measured on a desktop-class CPU, one call costs
  // ~45-50ms at five opponents and ~150ms at eight against a narrow range;
  // the coach asks for TWO quotes, and a phone runs this several times slower
  // again. Run straight through on the main thread that is a visible freeze of
  // the whole table, and it recurs on every fold (the live opponent count is
  // part of the cache key), every street and every raise — roughly eight to
  // ten times a hand. Every other pure-logic path in this file put together
  // measures under 2ms, so this is the only one worth restructuring.
  //
  // The fix is not to compute less, it is to stop computing it all in one go:
  // the same iterations run a few milliseconds at a time across animation
  // frames, so the table never blocks and the figure lands a beat later
  // instead. Accuracy is untouched — it is the identical loop over the
  // identical iteration count.
  const EQUITY_SLICE_MS = 6;
  // Iterations between clock checks. Small on purpose: one batch is the
  // longest this can overshoot its slice budget by, and on a slow phone a
  // single iteration is far more expensive than the Date.now() that bounds it.
  const EQUITY_BATCH = 4;
  // The coach asks for two quotes per render (the live count and the full
  // ring). Requests are QUEUED rather than the newest cancelling the current
  // one: with a single slot and cancel-on-mismatch, those two keys starve
  // each other forever — quote A starts, quote B cancels it, the next render
  // starts A again, B cancels it again, and NEITHER ever finishes. The cap is
  // what keeps genuinely stale requests (the board moved, someone folded)
  // from accumulating; oldest is dropped first, being the most likely stale.
  const EQUITY_QUEUE_MAX = 3;
  let equityJob = null;
  let equityQueue = [];

  // Bounds for the Settings input. The floor is where the error band gets wide
  // enough (~±5 points at 100 samples) that the figure stops being a usable
  // read at all; the ceiling is a guard against a typo'd 100000 leaving the
  // coach grinding for minutes with nothing on screen.
  const EQUITY_ITERS_MIN = 100;
  const EQUITY_ITERS_MAX = 5000;
  function clampEquityIters(v) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return DEFAULT_SETTINGS.equityIters;
    return Math.min(EQUITY_ITERS_MAX, Math.max(EQUITY_ITERS_MIN, n));
  }

  // Sampling error of a Monte Carlo equity figure, in percentage points.
  //
  // Bernoulli standard error on the win proportion. Ties are scored 0.5, and a
  // 0/0.5/1 draw has strictly lower variance than a 0/1 draw with the same
  // mean, so this slightly OVER-states the band — the conservative direction
  // for something whose job is to decide when to keep quiet.
  //
  // This is the error from SAMPLING ALONE, and it is the smaller of the two
  // uncertainties in any quoted equity: opponents are drawn from a flat range
  // PROXY, a far coarser approximation than more samples could ever fix. A
  // narrow band here means "the simulation has converged", never "this number
  // is right to within a point".
  function equityStdErr(eqPct, iters) {
    const n = Math.max(1, clampEquityIters(iters));
    const p = Math.min(1, Math.max(0, (eqPct || 0) / 100));
    return 100 * Math.sqrt((p * (1 - p)) / n);
  }

  // How many standard errors of margin are required before a call/fold verdict
  // is stated at all. Two is ~95%.
  const EQUITY_VERDICT_SIGMA = 2;

  // The pot-odds line used to read `eq >= need ? '✓ +EV call' : '✗ fold'` — a
  // hard verdict on an ACTION, taken from a sampled estimate, with nothing
  // between the two answers. Facing a bet needing 33% while the simulation
  // says 34%, that tick is decided by sampling noise, not by the hand: rerun
  // the same spot and it can flip to a cross. Lowering the default sample
  // count (v1.32.0) widens the noise, so this stops being a rare edge and
  // becomes a routine one.
  //
  // Inside the band, say so. "Marginal" is a real read a player can act on —
  // it moves the decision onto position, reads and implied odds, which is
  // exactly where a genuinely close spot should be decided. A confident tick
  // the HUD cannot support is the one outcome worse than no verdict.
  function potOddsVerdict(eqPct, needPct, iters) {
    const margin = eqPct - needPct;
    if (Math.abs(margin) < EQUITY_VERDICT_SIGMA * equityStdErr(eqPct, iters)) {
      return '≈ marginal';
    }
    return margin >= 0 ? '✓ +EV call' : '✗ fold';
  }

  function cancelEquityJob() {
    if (equityJob && equityJob.handle) cancelAnimationFrame(equityJob.handle);
    equityJob = null;
  }

  // Set by init() to renderCoachPanel. A hook rather than a direct call so the
  // equity engine does not reach up into the UI layer: the pump's job is to
  // compute and cache, and telling the panel is somebody else's concern. It
  // also keeps the dependency one-way, which is what makes the scheduler
  // drivable from a test — nothing here needs a DOM.
  let onEquityReady = null;

  function pumpEquityJob() {
    const job = equityJob;
    if (!job) return;
    job.handle = 0;
    const t0 = Date.now();
    let done = false;
    // Clock-bounded rather than a fixed iteration count: the whole point is to
    // fit inside a frame on a device nobody here can measure, and the same
    // iteration count costs wildly different amounts across phones.
    while (!done && Date.now() - t0 < EQUITY_SLICE_MS) {
      done = equityJobStep(job.st, EQUITY_BATCH);
    }
    if (!done) {
      job.handle = requestAnimationFrame(pumpEquityJob);
      return;
    }
    equityCacheSet(job.key, equityJobValue(job.st));
    equityJob = null;
    startNextEquityJob();
    // The number exists now, and the panel that asked for it last rendered
    // without it. Notify rather than waiting up to 1.5s for the next tick.
    // Re-entrant (that render can queue more work), but bounded: every pass
    // through here caches exactly one more key, and the panel only ever asks
    // for two.
    if (onEquityReady) onEquityReady();
  }

  function startNextEquityJob() {
    while (!equityJob && equityQueue.length) {
      const req = equityQueue.shift();
      if (equityCache.has(req.key)) continue; // filled while it waited
      const st = equityJobInit(req.heroCards, req.boardCards, req.nOpp, req.raiseLevel);
      if (!st) { equityCacheSet(req.key, null); continue; } // unsimulatable — cache it
      equityJob = { key: req.key, st, handle: 0 };
      pumpEquityJob();
    }
  }

  // Returns the equity if it is already known, null if this situation can
  // never be simulated, and undefined while a job is still queued or running.
  //
  // Callers filter on `!= null`, which is loose equality on purpose: it drops
  // undefined and null alike, so a pending figure simply doesn't render yet
  // and no call site needs to know the difference.
  function estimateEquitySliced(heroCards, boardCards, nOpp, raiseLevel) {
    const key = equityCacheKey(heroCards, boardCards, nOpp, raiseLevel);
    if (equityCache.has(key)) return equityCache.get(key);
    const known = (equityJob && equityJob.key === key)
      || equityQueue.some((r) => r.key === key);
    if (!known) {
      equityQueue.push({ key, heroCards, boardCards, nOpp, raiseLevel });
      if (equityQueue.length > EQUITY_QUEUE_MAX) equityQueue.shift();
      startNextEquityJob();
    }
    // startNextEquityJob may have finished the whole job synchronously on a
    // fast device; if so the value is cached and there is no reason to hold it
    // back for a frame.
    return equityCache.has(key) ? equityCache.get(key) : undefined;
  }

  // Reconstruct seating order from the log: SB, BB, then the order players
  // first acted preflop (UTG onward), which ends at the button.
  function buildRotation(hand) {
    if (!hand.sbXid) return null;
    const rot = [hand.sbXid];
    if (hand.bbXid && hand.bbXid !== hand.sbXid) rot.push(hand.bbXid);
    hand.actionOrder.forEach((x) => { if (!rot.includes(x)) rot.push(x); });
    return rot.length >= 2 ? rot : null;
  }

  // Position has four independent preconditions and the coach used to blame a
  // missing username for all of them, which sends you to fix a setting that is
  // already correct. Report the one that actually failed.
  function positionDiagnosis(hand) {
    const configured = (STORE.settings.heroName || '').trim();
    if (!heroXid) {
      return configured
        ? `no seat matches the username "${escapeHtml(configured)}" — check the spelling against your seat`
        : 'set your username in Settings';
    }
    if (!hand.sbXid) return 'no blind posts read from the log yet this hand';
    // The seat-layout path is preferred and needs hero's seat to be resolvable
    // in the DOM; the log path is the fallback and needs hero to have acted.
    if (!seatRotationFromDom(hand)) {
      const rot = buildRotation(hand);
      if (!rot) return 'could not order the seats on screen, and not enough action read yet';
      if (rot.indexOf(heroXid) < 0) return 'could not order the seats on screen, and you have not acted yet this hand';
      return null;
    }
    if (seatRotationFromDom(hand).indexOf(heroXid) < 0) {
      return 'your seat is not among the ones readable on screen — check the username in Settings';
    }
    return null;
  }

  // Sort seats into table order using their positions on screen. Torn lays the
  // table out as an oval, so sorting by angle around the centroid recovers the
  // seating ring regardless of DOM order.
  function orderSeatsByAngle(seats) {
    if (seats.length < 2) return null;
    const cx = seats.reduce((s, p) => s + p.cx, 0) / seats.length;
    const cy = seats.reduce((s, p) => s + p.cy, 0) / seats.length;
    return seats
      .map((p) => ({ xid: p.xid, ang: Math.atan2(p.cy - cy, p.cx - cx) }))
      .sort((a, b) => a.ang - b.ang)
      .map((p) => p.xid);
  }

  // Rotate a seating ring so the small blind is index 0, and orient it so the
  // big blind lands at index 1. The BB is what tells us which way round the
  // table the action travels — an angular sort could be either direction, and
  // getting it backwards would mirror every position.
  function rotateToBlinds(order, sbXid, bbXid) {
    if (!order || !sbXid) return null;
    const si = order.indexOf(sbXid);
    if (si < 0) return null;
    const fwd = order.slice(si).concat(order.slice(0, si));
    if (!bbXid || fwd.length === 2) return fwd; // heads-up: only one other seat
    if (fwd[1] === bbXid) return fwd;
    const rev = [fwd[0]].concat(fwd.slice(1).reverse());
    if (rev[1] === bbXid) return rev;
    return null; // direction can't be established — don't guess
  }

  function seatRotationFromDom(hand) {
    if (!hand.sbXid) return null;
    const seats = [];
    document.querySelectorAll(SELECTORS.seatContainer).forEach((el) => {
      // A player sitting out holds a seat but is dealt no cards. Leaving them
      // in the ring shifts every label past them by one — the documented
      // remaining exposure in this function, now closed.
      if (isSeatSittingOut(el)) return;
      const xid = resolveSeatKey(el);
      if (!xid) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return; // not laid out / empty seat
      seats.push({ xid, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    });
    return rotateToBlinds(orderSeatsByAngle(seats), hand.sbXid, hand.bbXid);
  }

  // Returns { label, inferred, seats } or null.
  //
  // Position is read from WHERE HERO SITS relative to the small blind, not from
  // how much action has happened. The previous version had no way to place hero
  // until hero acted, so it assumed "hero must be the next seat to act" and set
  // the index to the length of the action rotation. That is only true at hero's
  // own decision point — but the coach panel re-renders continuously (it falls
  // back to "your hole cards are visible" because actionButtons matches nothing
  // on this table), so the index grew with every opponent who acted and the
  // label tracked whoever was on action instead of hero. Do not reintroduce
  // that inference.
  function heroPositionLabel(hand) {
    if (!heroXid) return null;

    // Exact, and available from the moment the blinds are posted.
    const domRot = seatRotationFromDom(hand);
    if (domRot) {
      const i = domRot.indexOf(heroXid);
      if (i >= 0) return { label: seatLabel(i, domRot.length), inferred: false, seats: domRot.length };
    }

    // Fallback: order reconstructed from the log. Hero's index must be REAL
    // here — if hero hasn't acted yet there is no honest answer, so say so
    // rather than assume a seat.
    const rot = buildRotation(hand);
    if (!rot) return null;
    const i = rot.indexOf(heroXid);
    if (i < 0) return null;
    const n = Math.max(countSeats(hand), i + 1, rot.length);
    if (n < 2) return null;
    return { label: seatLabel(i, n), inferred: true, seats: n };
  }

  // How many players were actually at the table this hand.
  //
  // dealtInXids can hold the SAME person twice: it is seeded from the DOM (real
  // numeric XIDs) and then grown by logAction with whatever nameToXidGuess
  // returned, which falls back to a "name:Bob" pseudo-id when a log name can't
  // be matched to a seat. One unmatched name therefore inflated the seat count
  // by one, and since every position is derived from that count, it shifted
  // EVERY label by one seat in a consistent direction — the exact symptom the
  // position notes describe. Count real XIDs when there are any, and only fall
  // back to the raw size on a table where nothing resolved.
  function countSeats(hand) {
    if (!hand.dealtInXids) return 0;
    let real = 0;
    hand.dealtInXids.forEach((xid) => { if (!String(xid).startsWith('name:')) real += 1; });
    return real >= 2 ? real : hand.dealtInXids.size;
  }

  // Index in the rotation (0 = SB) to a position name. Short-handed collapses to
  // EP/MP/CO/BTN; full ring names the early seats separately, because at a
  // 9-handed table four distinct seats used to share one "EP" label and one
  // chart, and the tightest of them was being given a range meant for the
  // loosest. Measured from the BUTTON backwards, so it degrades sensibly at 7-
  // and 8-handed tables instead of assuming exactly nine.
  function seatLabel(i, n) {
    if (n === 2) return i === 0 ? 'SB' : 'BB';
    if (i === 0) return 'SB';
    if (i === 1) return 'BB';
    const fromBtn = n - 1 - i;
    if (n < FULL_RING_SEATS) {
      if (fromBtn === 0) return 'BTN';
      if (fromBtn === 1) return 'CO';
      if (fromBtn === 2) return 'MP';
      return 'EP';
    }
    if (fromBtn === 0) return 'BTN';
    if (fromBtn === 1) return 'CO';
    if (fromBtn === 2) return 'HJ';
    if (fromBtn === 3) return 'LJ';
    if (fromBtn === 4) return 'UTG1';
    return 'UTG';
  }

  // A "session" is just play separated by a gap; no explicit start/stop to forget.
  const SESSION_GAP_MS = 4 * 60 * 60 * 1000;

  // How many completed sessions to keep for the Trends chart. Bounded for the
  // same reason recentTables/betSizes are — this is written every time a
  // session ends and would otherwise grow forever. 60 is comfortably more than
  // a sparkline over a phone-width panel can usefully show at once, so the
  // chart itself decides how much of this history it actually plots.
  const SESSION_HISTORY_MAX = 60;

  // --- Per-hand P/L ledger (v1.55.0) ----------------------------------------
  //
  // "I want the P/L ledger to persist past the hand history limit."
  //
  // STORE.hands keeps full per-hand detail (actions, board, players) for
  // History's sake, capped at historyLimit (~200-300 with pinned notable
  // hands) because that detail is expensive — roughly 1.3KB/hand at that cap
  // (CLAUDE.md "Storage, and what it costs"). A ledger row is none of that:
  // a timestamp, a chip delta, a blind level, a game id — nothing needed to
  // RENDER a hand, only to say what it did to the bankroll. That buys roughly
  // two orders of magnitude more retention at the same storage cost, which is
  // what "persist past the hand history limit" actually needs.
  //
  // Bounded, not unbounded — this file has already paid once for "grows with
  // every hand forever" (STORE.players before v0.40-0.41's pruning). At
  // ~35-45 bytes/entry, PL_LEDGER_CAP (20,000) tops out under 1MB, a quarter
  // of STORAGE_QUOTA_EST, while covering years of normal play. FIFO eviction,
  // same shape as PRUNE_PLAYER_CAP/DEPARTED_MAX: the cap is what makes the
  // ceiling unreachable, not smarter age logic.
  //
  // hero.netChips/netBB remain the permanent, exact lifetime total regardless
  // of what has aged out of the ledger — an evicted row doesn't un-happen, it
  // just can't be individually audited past this window any more. The ledger
  // is a bounded audit trail layered on a number that was already permanent.
  //
  // Starts empty and accrues going forward only. No backfill from hands
  // already in STORE.hands or from hero.netChips' existing total — those
  // predate the ledger, and reconstructing per-hand deltas from stored hand
  // records risks disagreeing with the real total by whatever this file's
  // parsing has ever gotten wrong. Same "no migration needed, a missing key
  // reads as absent" precedent as limpRaiseMade/r3/r4/lr elsewhere here.
  const PL_LEDGER_CAP = 20000;

  // One-letter keys, same convention as boardTex's b/r/c/k/f — this rides on
  // every hand hero is dealt into, forever (up to the cap), so key names cost.
  //   t: timestamp (ms)
  //   d: chip delta this hand (signed)
  //   b: blind level this hand was priced at, 0 if unpriced (BB display mode,
  //      or no blind line seen) — same plausibleBB gate hero.netBB itself uses
  //   g: Torn's own game id, or null — lets a still-present hand in STORE.hands
  //      be cross-referenced while it lasts; not required once that ages out
  function pushLedgerEntry(delta, bb, gameId) {
    if (!Array.isArray(STORE.plLedger)) STORE.plLedger = [];
    STORE.plLedger.push({ t: Date.now(), d: delta, b: bb || 0, g: gameId || null });
    if (STORE.plLedger.length > PL_LEDGER_CAP) {
      STORE.plLedger.splice(0, STORE.plLedger.length - PL_LEDGER_CAP);
    }
  }

  // CSV, not the plain-text style every other export here uses — this is data
  // meant for a spreadsheet ("for my analysis"), not prose meant for reading.
  // A running total column is computed here rather than stored per-row: it
  // would cost as much as the delta itself to keep updated on every eviction,
  // and summing 20,000 numbers once per export is cheap next to that.
  //
  // The running total STARTS from hero.netChips MINUS the sum of every row
  // still present, so the LAST row's running total always lands exactly on
  // the current hero.netChips — the anchor is the permanent, exact figure;
  // the ledger fills in the shape of how it got there, not the other way
  // round. Anything evicted off the front is folded into that starting point
  // rather than silently making the running total start from 0 and disagree
  // with the real lifetime figure.
  function plLedgerExportCsv() {
    const rows = Array.isArray(STORE.plLedger) ? STORE.plLedger : [];
    const sumPresent = rows.reduce((a, r) => a + (r.d || 0), 0);
    let running = STORE.hero.netChips - sumPresent;
    const lines = ['date,chips_delta,bb_delta,running_total,blind_level,game_id'];
    rows.forEach((r) => {
      running += r.d || 0;
      const bbDelta = r.b > 0 ? (r.d / r.b).toFixed(2) : '';
      lines.push([
        new Date(r.t).toISOString(),
        r.d,
        bbDelta,
        running.toFixed(0),
        r.b || '',
        r.g || '',
      ].join(','));
    });
    return lines.join('\n') + '\n';
  }

  // Snapshot a just-ended session into STORE.sessionHistory before touchSession
  // resets it for the next one. A session with zero hands (the HUD loaded, the
  // gap fired, but nothing was ever played) leaves nothing worth charting.
  function archiveSession(s) {
    if (!s || !s.hands) return;
    if (!Array.isArray(STORE.sessionHistory)) STORE.sessionHistory = [];
    STORE.sessionHistory.push({
      startedAt: s.startedAt,
      endedAt: s.lastHandAt,
      hands: s.hands,
      netChips: s.net,
      // bb is "last stake seen this session" (see emptyStore's comment on
      // session.bb) — an estimate, same caveat as plBBEst elsewhere.
      //
      // null, NOT 0, when no blind was ever readable (Torn's BB-display mode
      // makes plausibleBB refuse every one). 0 would chart a big winning or
      // losing session as an exact break-even point. Readers go through
      // sessionNetBB, which also treats a legacy stored 0 as unknown.
      netBB: s.bb > 0 ? s.net / s.bb : null,
      vpip: s.vpip || 0,
      pfr: s.pfr || 0,
      aggActions: s.aggActions || 0,
      passActions: s.passActions || 0,
      bb: s.bb || 0,
    });
    if (STORE.sessionHistory.length > SESSION_HISTORY_MAX) STORE.sessionHistory.shift();
  }

  // Archive and clear the live session if its gap has ALREADY elapsed, and say
  // whether it did. Split out of touchSession because touchSession only runs
  // from applyHandResults — i.e. on a settled hand — which is too late for
  // anything that only reads: stop playing for the night and the session you
  // just finished sits unarchived in STORE.session, invisible to the Trends
  // tab, until you sit back down and play one more hand. The chart was
  // therefore permanently at least one session behind, and the missing one is
  // the session you are most likely looking for.
  //
  // Clearing startedAt (rather than restarting the session here) is what keeps
  // this safe to call from a render path: it leaves the store in the same
  // "no session open" state a fresh store has, and the next touchSession
  // starts one normally.
  function maybeRollSession() {
    const s = STORE.session;
    if (!s.startedAt || !s.lastHandAt) return false;
    if (Date.now() - s.lastHandAt <= SESSION_GAP_MS) return false;
    archiveSession(s);
    s.startedAt = 0; s.lastHandAt = 0; s.hands = 0; s.net = 0;
    s.vpip = 0; s.pfr = 0; s.aggActions = 0; s.passActions = 0; s.bb = 0;
    return true;
  }

  function touchSession(deltaChips, countHand) {
    const s = STORE.session;
    const now = Date.now();
    maybeRollSession();
    if (!s.startedAt) {
      s.startedAt = now; s.hands = 0; s.net = 0;
      s.vpip = 0; s.pfr = 0; s.aggActions = 0; s.passActions = 0; s.bb = 0;
    }
    s.lastHandAt = now;
    if (countHand) s.hands += 1;
    s.net += deltaChips || 0;
  }

  // ===========================================================================
  // 8. COACH PROMPTS (advisory only — never auto-acts)
  // ===========================================================================

  // Who hero is actually up against RIGHT NOW: the opponent still in the hand
  // with the biggest contribution to THIS street.
  //
  // hand.lastAggressor is deliberately not used for this. It is written on
  // every raise and NEVER cleared when that player folds, so after a villain
  // bets the flop and folds to hero's raise it still names them — and it fed
  // both the pot-odds line (quoting a bet nobody was making) and the coach's
  // +1000 aggressor bonus (spending the rest of the hand advising about a
  // player who was out of the pot). That is the whole of the "advice goes
  // stale mid-hand" report.
  //
  // Street contributions, not hand totals: calling preflop does not mean hero
  // is facing a bet on the flop. `facing` is the same test handContextTokens
  // used to run inline — one source now, so the token and the number cannot
  // disagree about whether hero is facing anything.
  //
  // Returns { xid, chips, facing } or null when there is no live opponent.
  function streetLeader(hand) {
    if (!hand || !hand.playersIn) return null;
    const contrib = hand.streetContributions || {};
    const mine = (!heroUnresolved() && contrib[heroXid]) || 0;
    let best = null;
    hand.playersIn.forEach((x) => {
      if (isHeroRecord(x)) return;
      const v = contrib[x] || 0;
      if (!best || v > best.chips) best = { xid: x, chips: v };
    });
    if (!best) return null;
    return { xid: best.xid, chips: best.chips, facing: best.chips > mine };
  }

  // The player driving the action, or null when nobody is.
  //
  // The last preflop/postflop raiser IF THEY ARE STILL IN THE HAND — they are
  // who everyone else is playing against. Once they fold there is no
  // aggressor, and the tip is chosen from the remaining live players on merit
  // rather than handed to whoever raised last and left.
  function liveAggressor(hand) {
    if (!hand || !hand.lastAggressor) return null;
    return hand.playersIn.has(hand.lastAggressor) ? hand.lastAggressor : null;
  }

  function buildCoachAdvice() {
    if (!currentHand) return null;
    const hand = currentHand;
    const heroCards = readHeroCards();
    // Remember them while they're on screen — they're gone by the time the hand
    // is written to history.
    if (heroCards.length === 2) hand.heroCards = heroCards;

    // Turn detection is by button LABEL now (findActionButtons), not by a
    // hashed container class that never matched. The hole-cards fallback stays,
    // because it is the only signal between your turns — but the two are no
    // longer equivalent, and the panel says which one is live.
    const heroTurn = isHeroTurn();
    if (!heroTurn && heroCards.length !== 2) return null;
    const board = readBoardCards();
    // The live street leader, not hand.lastAggressor — see streetLeader. Zero
    // when hero is not actually facing anything, so the pot-odds line goes
    // quiet after a villain calls rather than quoting hero's own bet back.
    const lead = streetLeader(hand);
    const villainXid = lead ? lead.xid : null;
    const betFacing = lead && lead.facing ? lead.chips : 0;
    const pos = heroPositionLabel(hand);
    const position = pos ? pos.label : null;
    // Prefer the table's own pot over our running log sum — see readDomPot.
    const pot = effectivePot(hand);
    const out = [];

    // The panel is read mid-decision on a phone, so every line has to earn its
    // place. Things deliberately NOT here any more:
    //   "▶ Your turn"  — the green border already says it, louder.
    //   Table name     — never changes a decision; it is in Settings.
    //   The footnote   — replaced by short inline markers ("vs random", "est").
    // Kept short rather than dropped: stack depth, because it decides whether
    // the baseline below is even the right chart.

    // Hero gets the same read as everyone else. Badges deliberately skip your
    // own seat, so without this the one player the HUD can never warn about is
    // you — the case where it is worth most.
    // Only TILT, not heat. Both markers are now on your own seat badge, so the
    // coach would be repeating itself — but an emoji on a badge has no room to
    // say WHY, and on a touchscreen there is no tooltip to hover. Tilt earns
    // the second mention because it is the one that should change what you do;
    // running hot is information, and 🔥 on the badge covers it.
    const self = !heroUnresolved() ? STORE.players[heroXid] : null;
    if (self) {
      const selfTilt = tiltRead(self);
      if (selfTilt) {
        out.push(`<span class="tph-self-tilt">🤮 <b>You're ${selfTilt.jump.toFixed(0)}pp looser `
          + `than your norm</b> (last ${selfTilt.hands}) — tighten up.</span>`);
      }
    }

    // Stack depth, in one line. bb is what matters, so the cash figure is gone.
    // Anchored on hero and pairwise against whoever is actually being faced —
    // see effectiveStackVs. Absent entirely when hero's own stack can't be
    // read, because there is no honest effective stack without it.
    const eff = effectiveStackVs(hand, villainXid);
    const rawBB2 = hand.bbAmount || lastSeenBB;
    const bb = plausibleBB(rawBB2) ? rawBB2 : 0;
    if (eff) {
      const effBB = bb > 0 ? eff.chips / bb : null;
      const bits = [];
      const vs = eff.pairwise ? ` v ${escapeHtml(playerDisplayName(eff.vsXid))}` : '';
      bits.push((effBB != null ? `<b>${effBB.toFixed(0)}bb</b>` : `<b>${fmtMoney(eff.chips)}</b>`) + ' eff' + vs);

      // SPR is a postflop concept, measured against the pot at the START of the
      // street — not the live pot, which shrinks the number as the betting
      // round grows it.
      if (hand.street !== 'preflop' && hand.potAtStreetStart > 0) {
        const spr = eff.chips / hand.potAtStreetStart;
        bits.push(`SPR <b>${spr.toFixed(1)}</b> ${spr < 1 ? 'committed' : spr < 3 ? 'low' : spr < 7 ? 'medium' : 'deep'}`);
      }
      // The baselines are ~100bb charts. Now that depth is readable, applying
      // them silently at 15bb would be a confidently wrong answer.
      if (effBB != null && effBB < 40) {
        bits.push(effBB < 20
          ? '<b>⚠ push/fold depth — charts don\'t model it</b>'
          : '<b>⚠ short — charts overstate calling</b>');
      }
      out.push(bits.join(' · '));
    }

    out.push(gtoBaselineSuggestion({
      street: hand.street,
      position,
      positionInferred: !!(pos && pos.inferred),
      heroCards: heroCards.length === 2 ? heroCards : null,
      betFacing,
      pot,
      posDiag: position ? null : positionDiagnosis(hand),
      // Seat count for THIS hand picks the chart set — Torn runs both short and
      // full ring, and the tableMax setting only drives the equity quote.
      seats: pos ? pos.seats : 0,
      // Which preflop spot this actually is. Without these the chart was chosen
      // from betFacing alone, which cannot tell an unopened pot from a limped
      // one, or a 3-bet from a 4-bet.
      // KNOWN IMPRECISION: preflopRaiseEvents counts an all-in as a raise, so a
      // short stack shoving what is really a CALL can push this to 2 and make
      // the coach read the spot as facing a 3-bet. Fixing it needs the all-in
      // amount compared against the current bet, which the log doesn't always
      // print.
      preflopRaises: hand.preflopRaiseEvents,
      limpers: preflopLimperCount(hand),
      heroInPosition: heroIsInPositionVs(hand, villainXid),
      heroHasRaised: !!(heroXid && hand.countedPfr.has(heroXid)),
    }));

    if (heroCards.length === 2) {
      const live = Math.max(1, hand.playersIn.size - 1);
      // Seats actually at THIS table. The tableMax setting (default 9) was
      // quoting "vs 8 (9-max)" at a five-handed table, which is a number about
      // a game you are not playing. Fall back to the setting only when the seat
      // count can't be read.
      const seatsNow = (pos && pos.seats) || countSeats(hand) || STORE.settings.tableMax || 9;
      const full = Math.max(1, seatsNow - 1);

      // Always quote the full-ring number so the figure means the same thing
      // every hand — equity against the live count alone swings wildly as people
      // fold, which makes it useless for judging whether a holding is actually
      // strong. Add the live count and the heads-up ceiling around it, so you can
      // see how much the hand gains as the field thins. Duplicates are dropped:
      // at a 3-handed pot "vs 2" and "vs 2" twice reads as a bug.
      // Two quotes, not three. The LIVE count is what the decision turns on;
      // the full-ring figure is the stable reference that means the same thing
      // every hand. The heads-up ceiling was a third number to read for a
      // situation you are usually not in — dropped unless it IS the live count.
      const wanted = [];
      [[live, 'live'], [full, `${full + 1}max`]].forEach(([n, label]) => {
        if (!wanted.some((w) => w.n === n)) wanted.push({ n, label });
      });

      // Sliced, not blocking: this is the single most expensive thing the HUD
      // does, and running it inline froze the table for a beat on every fold,
      // street and raise. A quote still being computed comes back undefined
      // and is dropped by the `!= null` filter below, exactly as an
      // unsimulatable one (null) always was.
      const asked = wanted
        .map((w) => ({ ...w, eq: estimateEquitySliced(heroCards, board, w.n, hand.preflopRaiseEvents) }));
      const quotes = asked.filter((w) => w.eq != null);
      // Say the figure is coming rather than letting the line vanish and
      // reappear a beat later — a line that flickers in and out reads as a
      // bug, and an empty space says nothing about why it is empty.
      if (!quotes.length && asked.some((w) => w.eq === undefined)) {
        out.push(`Eq ${equityBasisLabel(hand.preflopRaiseEvents)} <i>working…</i>`);
      }

      if (quotes.length) {
        // Pot odds folded into the same line rather than its own. The basis
        // label is the honesty marker now that the footnote is gone — it has
        // to change alongside the number: once a raise narrows the simulated
        // opponents (see opponentRangeProxy), quoting it as "vs random" would
        // be stating the OLD caveat about a number that no longer deserves it.
        const parts = [`Eq ${equityBasisLabel(hand.preflopRaiseEvents)} ` + quotes.map((w) => `<b>${fmtEquity(w.eq)}</b> ${w.label}`).join(' · ')];
        const liveEq = quotes.find((w) => w.n === live);
        if (betFacing > 0 && liveEq) {
          const need = (100 * betFacing) / (pot + betFacing);
          // Noise-aware, not a bare >=: inside the sampling error the sign of
          // (equity - required) is set by the dice, not the hand. See
          // potOddsVerdict.
          parts.push(`need <b>${need.toFixed(0)}%</b> `
            + potOddsVerdict(liveEq.eq, need, STORE.settings.equityIters));
        }
        out.push(parts.join(' · '));
      }
    } else if (betFacing > 0) {
      const need = (100 * betFacing) / (hand.pot + betFacing);
      out.push(`Need <b>~${need.toFixed(0)}%</b> to continue.`);
    }

    // TWO adjustments from the same synthesis the Exploit tab shows in full,
    // not one. Asked for directly, and it is the cheaper half of the fix for
    // "advice repeats too much": a second read hides the repetition without
    // touching the ranking, because the runner-up is genuine information the
    // panel was already computing and throwing away.
    //
    // The second is rendered dimmer, so the panel still has ONE thing your eye
    // lands on mid-decision. A pair of equally loud lines is two things to
    // read in a spot where there is time for one.
    currentExploitTips(COACH_TIPS_SHOWN).forEach((tip, i) => {
      // The "new" marker sits BETWEEN the name and the read, so it is seen
      // while deciding whether to trust the line rather than as a footnote
      // after it has already been acted on. Hand count included because "new"
      // alone doesn't distinguish 2 hands from 19.
      const isNew = tip.provisional
        ? `<span class="tph-tip-new">new · ${tip.hands}h</span> ` : '';
      // The runner-up gets the SHORT form. At full length two reads is a
      // paragraph on a phone, which is how the panel stops being read at all.
      const body = i === 0
        ? escapeHtml(squish(tip.entry.text, 150))
        : escapeHtml(tip.entry.short || squish(tip.entry.text, 70));
      out.push(`<span class="${i === 0 ? 'tph-tip-lead' : 'tph-tip-second'}">`
        + `${i === 0 ? '⚡' : '·'} <b>${escapeHtml(playerDisplayName(tip.xid))}</b> ${isNew}— ${body}</span>`);
    });
    return out.filter(Boolean);
  }

  // ===========================================================================
  // 11. TENDENCY REPORT
  // ===========================================================================

  // How many table CHANGES to remember. Three covers "where they came from"
  // without turning a player record into a movement log.
  const RECENT_TABLES_MAX = 3;

  // Note that this player was seen at `bb`. Consecutive hands at the same table
  // just move the timestamp forward — this records moves, not hands, so a
  // 200-hand session at one table stays a single entry.
  function noteRecentTable(p, bb) {
    if (!Array.isArray(p.recentTables)) p.recentTables = [];
    const head = p.recentTables[0];
    if (head && head.bb === bb) { head.at = Date.now(); return; }
    p.recentTables.unshift({ bb, at: Date.now() });
    if (p.recentTables.length > RECENT_TABLES_MAX) p.recentTables.length = RECENT_TABLES_MAX;
  }

  // "3m", "2h", "4d" — short enough to sit inline on a phone.
  function shortAgo(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  // The last few tables, most recent first, resolved to names.
  function recentTablesOf(p) {
    return (Array.isArray(p && p.recentTables) ? p.recentTables : [])
      .filter((e) => e && plausibleBB(e.bb))
      .slice(0, RECENT_TABLES_MAX)
      .map((e) => ({
        bb: e.bb,
        at: e.at,
        ago: shortAgo(e.at),
        name: tableNameForBB(e.bb) || fmtMoney(e.bb) + ' BB',
      }));
  }

  // Where this player is usually found, busiest first.
  // Returns [{ bb, name, hands, share }].
  function tablesPlayed(p) {
    const src = (p && p.tables) || {};
    const total = Object.keys(src).reduce((a, k) => a + (src[k] || 0), 0);
    if (!total) return [];
    return Object.keys(src)
      .map((k) => ({
        bb: Number(k),
        name: tableNameForBB(Number(k)) || fmtMoney(Number(k)) + ' BB',
        hands: src[k],
        share: (100 * src[k]) / total,
      }))
      .sort((a, b) => b.hands - a.hands);
  }

  // A ranked plan for beating one specific player, synthesised from everything
  // known about them.
  //
  // Ranked, not narrative: mid-hand you want the two or three adjustments that
  // are worth the most, not a paragraph. Each entry carries a `gain` used only
  // for ordering — the biggest edge against this pool is usually postflop
  // (they don't fold) rather than preflop, so those score higher.
  //
  // Every claim names the number it came from. An exploit you can't trace back
  // to a stat is indistinguishable from a guess, and this pool's baselines are
  // borrowed rather than measured (see POOL_AVG), so the reader needs to be
  // able to check the reasoning.
  //
  // Returns [{ gain, tag, text }], strongest first.
  // Shared detection behind BOTH buildExploitPlan (opponent-facing: how to
  // play AGAINST this player) and buildLeakPlan (self-facing: what THIS
  // player — hero — should change about their own game, DriveHUD's "MDA
  // Exploit Report"/PT4's LeakTracker in spirit). Same gates, same gain/tag/
  // when for both voices, since how much a deviation matters and which
  // situation it applies to don't change with who's asking — only the
  // phrasing does. Keeping detection in ONE place means a future threshold
  // correction (like the v1.11.0 POOL_AVG one) can't apply to one voice and
  // not the other by accident.
  //
  // `voice`: 'exploit' (default) or 'leak'. add() takes BOTH phrasings so
  // there is exactly one call site per rule, not two rules that could drift.
  function buildTendencyEntries(p, voice) {
    if (!p) return [];
    const r = computeRates(p);
    const s = computeShrunkRates(p);
    const out = [];
    // `short` is a 2-5 word action for the collapsed pill and the live line,
    // where there is no room for the full sentence. The long form stays for
    // the Exploit/Leaks tab and the tooltip.
    //
    // `when` is an optional list of context tokens (see handContextTokens): the
    // entry is treated as RELEVANT to the live decision only when every token
    // is present. Omitted means "always relevant", which is the safe default —
    // an untagged rule behaves exactly as it did before tagging existed.
    //
    // Relevance is a BOOST, never a filter. A hard filter would leave the panel
    // silent in spots no rule happens to cover, and a slightly off-target read
    // beats no read at all. See currentExploitTip.
    //
    // `edge` is an optional 0..1 saying how far past its threshold this
    // firing actually is — see spreadEdge / thresholdEdge. It separates two
    // rules carrying the same `gain`, so the read that is most unusual about
    // THIS player wins rather than whichever rule happens to have the higher
    // constant. Omitted means EXPLOIT_EDGE_NEUTRAL (0.5): neither promoted nor
    // punished, same defaulting principle as an untagged `when`. It affects
    // only the live coach ranking; the Exploit/Leaks tab still orders by gain.
    const add = (gain, tag, exploitText, leakText, exploitShort, leakShort, when, edge) => out.push({
      gain,
      tag,
      text: voice === 'leak' ? leakText : exploitText,
      short: voice === 'leak' ? leakShort : exploitShort,
      when: when || null,
      edge: typeof edge === 'number' ? edge : null,
    });
    const n = p.hands || 0;

    // --- Postflop: the biggest lever against a passive pool ------------------
    if (r.foldToCbet != null && p.foldToCbetOpp >= 8) {
      if (s.foldToCbet > POOL_AVG.foldToCbet + POOL_SPREAD.foldToCbet) {
        add(100, 'C-bet',
          `Folds to c-bets ${fmtPct(r.foldToCbet)} vs a ${POOL_AVG.foldToCbet}% pool `
            + `(${p.foldToCbetOpp} spots). C-bet every flop you take the lead in, any two cards. `
            + 'This is the single most profitable adjustment against them.',
          `You fold to c-bets ${fmtPct(r.foldToCbet)} vs a ${POOL_AVG.foldToCbet}% pool `
            + `(${p.foldToCbetOpp} spots) — you are over-folding to flop pressure. Start defending more `
            + 'of your range, especially in position; anyone paying attention is printing off you right now.',
          'fire every flop', 'defend flops more', ['flop', 'lead'],
          spreadEdge(s.foldToCbet, POOL_AVG.foldToCbet, POOL_SPREAD.foldToCbet));
      } else if (s.foldToCbet < POOL_AVG.foldToCbet - POOL_SPREAD.foldToCbet) {
        add(95, 'C-bet',
          `Folds to c-bets only ${fmtPct(r.foldToCbet)} (${p.foldToCbetOpp} spots). `
            + 'Stop bluffing flops. Bet for value and check your air — a c-bet here is lighting money on fire.',
          `You almost never fold to a c-bet (${fmtPct(r.foldToCbet)}, ${p.foldToCbetOpp} spots) — `
            + "you're not folding enough. Good players will stop bluffing you and value-bet you relentlessly "
            + 'instead; tighten what you continue with.',
          'no flop bluffs', 'fold flops more', ['flop', 'lead'],
          spreadEdge(s.foldToCbet, POOL_AVG.foldToCbet, POOL_SPREAD.foldToCbet));
      }
    }

    // Firing flops then surrendering is the most exploitable postflop pattern
    // there is, and it needs the per-street split to be visible at all.
    const f = r.byStreet.flop;
    const tn = r.byStreet.turn;
    if (f.afq != null && tn.afq != null && f.actions >= 8 && tn.actions >= 6 && f.afq - tn.afq > 20) {
      add(90, 'Turn',
        `Aggression collapses from ${fmtPct(f.afq)} on the flop to ${fmtPct(tn.afq)} on the turn. `
          + 'Float their flop bet in position and take it away on the turn when they check.',
        `Your aggression drops from ${fmtPct(f.afq)} on the flop to ${fmtPct(tn.afq)} on the turn — `
          + "you're a one-and-done bettor. Good opponents will float your flop bet and take it away on the "
          + 'turn; barrel more turns when your read says they folded weak, or check back flops you\'re not '
          + 'planning to follow through on.',
        'float, stab turn', 'follow through on turns', ['postflop'],
        thresholdEdge(f.afq - tn.afq, 20, 60));
    }
    if (tn.afq != null && tn.actions >= 6 && tn.afq > 55) {
      add(70, 'Turn',
        `Keeps firing turns (${fmtPct(tn.afq)} aggression, ${tn.actions} actions) — `
          + 'their turn bets are not automatic bluffs; call down with real hands rather than floats.',
        `You keep firing turns (${fmtPct(tn.afq)} aggression, ${tn.actions} actions) — good opponents `
          + "will start calling you down lighter, since your turn bets stop meaning as much to them. Make "
          + 'sure the second barrel has a real hand or a real plan behind it.',
        'turn bets are real', 'barrel with a plan', ['turn'],
        thresholdEdge(tn.afq, 55, 85));
    }

    // --- Preflop ------------------------------------------------------------
    if (r.foldTo3Bet != null && p.foldTo3BetOpp >= 6) {
      if (s.foldTo3Bet > POOL_AVG.foldTo3Bet + POOL_SPREAD.foldTo3Bet) {
        add(85, '3-bet',
          `Folds to 3-bets ${fmtPct(r.foldTo3Bet)} vs a ${POOL_AVG.foldTo3Bet}% pool `
            + `(${p.foldTo3BetOpp} spots). 3-bet their opens light, especially in position.`,
          `You fold to 3-bets ${fmtPct(r.foldTo3Bet)} vs a ${POOL_AVG.foldTo3Bet}% pool `
            + `(${p.foldTo3BetOpp} spots) — you're giving up your opens too easily. Good players will start `
            + '3-betting you light and taking the pot uncontested; 4-bet or continue more instead of folding.',
          '3-bet them light', 'defend your opens', ['preflop'],
          spreadEdge(s.foldTo3Bet, POOL_AVG.foldTo3Bet, POOL_SPREAD.foldTo3Bet));
      } else if (s.foldTo3Bet < POOL_AVG.foldTo3Bet - POOL_SPREAD.foldTo3Bet) {
        add(60, '3-bet',
          `Rarely folds to 3-bets (${fmtPct(r.foldTo3Bet)}). 3-bet for value only — `
            + 'a light 3-bet just builds a pot out of position with the worse hand.',
          `You rarely fold to a 3-bet (${fmtPct(r.foldTo3Bet)}) — you're probably continuing too wide when `
            + 'raised. Tighten up; calling or 4-betting light here builds a bigger pot with the worse hand, '
            + 'not a stand.',
          '3-bet value only', 'tighten vs 3-bets', ['preflop'],
          spreadEdge(s.foldTo3Bet, POOL_AVG.foldTo3Bet, POOL_SPREAD.foldTo3Bet));
      }
    }
    if (r.limpShareOfVpip != null && p.limpMade >= 5
        && s.limpShareOfVpip > POOL_AVG.limpShareOfVpip + POOL_SPREAD.limpShareOfVpip) {
      add(80, 'Isolate',
        `Limps into ${fmtPct(r.limpShareOfVpip)} of the pots they enter. `
          + 'Raise big to isolate them in position — their limping range is capped, and they will call too wide.',
        `You limp into ${fmtPct(r.limpShareOfVpip)} of the pots you enter — your limping range is capped, `
          + 'and attentive opponents will raise big to isolate you knowing they have the range edge. '
          + 'Open-raise more instead of limping.',
        'isolate their limps', 'raise instead of limp', ['preflop'],
        spreadEdge(s.limpShareOfVpip, POOL_AVG.limpShareOfVpip, POOL_SPREAD.limpShareOfVpip));
    }
    if (r.vpip != null && n >= 20) {
      if (s.vpip > POOL_AVG.vpip + POOL_SPREAD.vpip) {
        add(55, 'Range',
          `Plays ${fmtPct(r.vpip)} of hands vs a ${POOL_AVG.vpip.toFixed(0)}% pool — `
            + 'their range is wide and weak. Value bet thinner than feels comfortable and stop bluffing.',
          `You play ${fmtPct(r.vpip)} of hands vs a ${POOL_AVG.vpip.toFixed(0)}% pool — that's wide. `
            + 'Tighten your opening range, especially from early position; a wide range value-bets thinner '
            + 'but also bluffs more, and attentive opponents punish both.',
          'value bet thin', 'tighten your range', null,
          spreadEdge(s.vpip, POOL_AVG.vpip, POOL_SPREAD.vpip));
      } else if (s.vpip < POOL_AVG.vpip - POOL_SPREAD.vpip) {
        add(65, 'Range',
          `Plays only ${fmtPct(r.vpip)} of hands vs a ${POOL_AVG.vpip.toFixed(0)}% pool — `
            + 'genuinely tight for this table. Respect their raises and steal their blinds relentlessly.',
          `You play only ${fmtPct(r.vpip)} of hands vs a ${POOL_AVG.vpip.toFixed(0)}% pool — genuinely `
            + 'tight. Observant opponents will stop respecting your raises and steal your blinds relentlessly; '
            + 'widen up, especially in position and defending the blinds.',
          'steal their blinds', 'widen your range', ['preflop'],
          spreadEdge(s.vpip, POOL_AVG.vpip, POOL_SPREAD.vpip));
      }
    }
    if (r.pfr != null && r.vpip > 0 && n >= 20) {
      const gap = r.vpip - r.pfr;
      if (gap > 40) {
        add(50, 'Passive',
          `Huge VPIP/PFR gap (${fmtPct(r.vpip)}/${fmtPct(r.pfr)}) — a caller, not a raiser. `
            + 'When they DO raise, believe it.',
          `Huge gap between how often you play (${fmtPct(r.vpip)}) and how often you raise (${fmtPct(r.pfr)}) `
            + "— you're a caller, not a raiser. Sharp opponents will play back at your flat-calls and fold "
            + 'correctly to your raises since they mean so much; raise more of your continuing range instead.',
          'believe their raises', 'raise more, call less', ['facing'],
          thresholdEdge(gap, 40, 70));
      }
    }

    // --- Showdown -----------------------------------------------------------
    if (r.wtsd != null && n >= 30) {
      if (r.wtsd > 40) {
        add(75, 'Showdown',
          `Goes to showdown ${fmtPct(r.wtsd)} of hands played — a station. `
            + 'Three-street value with anything decent; never try to bluff them off a made hand.',
          `You reach showdown ${fmtPct(r.wtsd)} of hands played — you're a station. Sharp opponents will `
            + 'stop bluffing you (correctly) and value-bet you relentlessly (also correctly). Fold more when '
            + "you're beat instead of calling to find out.",
          'three-street value', 'fold more, call less', ['postflop'],
          thresholdEdge(r.wtsd, 40, 65));
      } else if (r.wtsd < 18) {
        add(60, 'Showdown',
          `Reaches showdown only ${fmtPct(r.wtsd)} of the time — they give up a lot. `
            + 'Barrel more streets; they are folding somewhere before the river.',
          `You reach showdown only ${fmtPct(r.wtsd)} of the time — you're giving up too much. Sharp `
            + 'opponents will bet you off pots relentlessly since they know you fold; call down more or '
            + 'barrel yourself rather than folding to every bet you face.',
          'barrel more', 'call down more', ['postflop'],
          thresholdEdge(18 - r.wtsd, 0, 12));
      }
    }

    // --- Board texture -------------------------------------------------------
    //
    // Each entry is tagged with the board:<flag> token it describes, so it can
    // only ever surface on that texture — see handContextTokens. Gated on the
    // SAME cell the figure is computed from (v1.26.0's lesson), and each of the
    // two reads uses its own denominator, because leading and folding happen in
    // different situations (see boardTexRates).
    BOARD_FLAGS.forEach((flag) => {
      const cell = (p.boardTex || {})[flag.key];
      if (!cell) return;
      const br = boardTexRates(cell);
      const tok = ['board:' + flag.key];

      if (br.foldToBet != null && br.facedN >= BOARD_TEX_MIN) {
        if (br.foldToBet >= 65) {
          add(85, 'Board',
            `Folds ${fmtPct(br.foldToBet)} of the time when bet into on a ${flag.label} board `
              + `(${br.facedN} spots) — bet it relentlessly, whatever you hold.`,
            `You fold ${fmtPct(br.foldToBet)} of the time when bet into on a ${flag.label} board `
              + `(${br.facedN} spots). Anyone paying attention can bet you off this texture `
              + 'with anything; call or raise more of them.',
            `folds ${flag.label}`, `fold ${flag.label} too much`, tok,
            thresholdEdge(br.foldToBet, 65, 95));
        } else if (br.foldToBet <= 25) {
          add(80, 'Board',
            `Only folds ${fmtPct(br.foldToBet)} when bet into on a ${flag.label} board `
              + `(${br.facedN} spots) — a station here. Value bet thin, do not bluff.`,
            `You only fold ${fmtPct(br.foldToBet)} when bet into on a ${flag.label} board `
              + `(${br.facedN} spots) — you are calling too wide on this texture.`,
            `calls ${flag.label}`, `too sticky on ${flag.label}`, tok,
            thresholdEdge(25 - br.foldToBet, 0, 25));
        }
      }

      if (br.lead != null && br.leadN >= BOARD_TEX_MIN) {
        if (br.lead <= 20) {
          add(70, 'Board',
            `Leads out only ${fmtPct(br.lead)} of the time on a ${flag.label} board `
              + `(${br.leadN} spots) — their check here means little, so take it away.`,
            `You lead only ${fmtPct(br.lead)} on a ${flag.label} board (${br.leadN} spots) — `
              + 'you are giving up the initiative on a texture you could be betting.',
            `checks ${flag.label}`, `bet ${flag.label} more`, tok,
            thresholdEdge(20 - br.lead, 0, 20));
        } else if (br.lead >= 60) {
          add(70, 'Board',
            `Leads out ${fmtPct(br.lead)} of the time on a ${flag.label} board `
              + `(${br.leadN} spots) — betting this texture is automatic for them, `
              + 'so their bet is far weaker than it looks.',
            `You lead ${fmtPct(br.lead)} on a ${flag.label} board (${br.leadN} spots) — `
              + 'so predictable that your bet here carries no information.',
            `auto-bets ${flag.label}`, `too predictable on ${flag.label}`, tok,
            thresholdEdge(br.lead, 60, 95));
        }
      }
    });

    // --- Sizing tells --------------------------------------------------------
    const szN = betSizeSample(p);
    if (r.medianBetPct != null && szN >= BET_SIZE_MIN) {
      if (r.medianBetPct > 85) {
        add(45, 'Sizing',
          `Typically bets ${r.medianBetPct.toFixed(0)}% of pot (median of ${szN} bets) — `
            + 'oversized. At this pool that usually means value, not a bluff.',
          `You typically bet ${r.medianBetPct.toFixed(0)}% of pot (median of ${szN} bets) — oversized. `
            + 'Observant opponents will read your big bets as value and fold correctly, costing you thin '
            + 'value and making your bluffs too expensive to profitably fire.',
          'big bet = value', 'size down', ['facing'],
          thresholdEdge(r.medianBetPct, 85, 140));
      } else if (r.medianBetPct < 40) {
        add(45, 'Sizing',
          `Typically bets only ${r.medianBetPct.toFixed(0)}% of pot (median of ${szN} bets) — `
            + 'small sizing. Raise their weak bets; they are pricing you in.',
          `You typically bet only ${r.medianBetPct.toFixed(0)}% of pot (median of ${szN} bets) — undersized. `
            + "You're pricing opponents in to call with worse hands and leaving value behind when you're "
            + 'ahead. Size up.',
          'raise their small bets', 'size up', ['facing'],
          thresholdEdge(40 - r.medianBetPct, 0, 20));
      }
    }

    // --- Sizing by hand strength, and slowplay — both from showdowns only ---
    // Never fires for hero, same shownHands gap as the range rule below: hero's
    // own cards are never harvested as a showdown, so p.texture stays empty.
    if ((r.betDrawCount + r.betMadeCount) >= TEXTURE_MIN
        && r.betDrawPct != null && r.betMadePct != null
        && Math.abs(r.betMadePct - r.betDrawPct) >= 20) {
      if (r.betMadePct > r.betDrawPct) {
        add(50, 'Sizing',
          `Sizes up with a made hand (${r.betMadePct.toFixed(0)}% pot, ${r.betMadeCount} spots) vs a `
            + `draw (${r.betDrawPct.toFixed(0)}%, ${r.betDrawCount} spots) — their bet SIZE tells you which `
            + 'one you\'re facing. A bigger-than-usual bet from them is the goods; call their small ones down '
            + 'lighter and give the big ones more respect.',
          `You size up with a made hand (${r.betMadePct.toFixed(0)}% pot, ${r.betMadeCount} spots) vs a draw `
            + `(${r.betDrawPct.toFixed(0)}%, ${r.betDrawCount} spots) — a sharp opponent can read your size `
            + 'and play accordingly. Mix your sizing so a big bet doesn\'t always mean the same thing.',
          'read their bet size', 'randomize your sizing', ['facing'],
          thresholdEdge(r.betMadePct - r.betDrawPct, 20, 60));
      } else {
        add(50, 'Sizing',
          `Sizes UP on a draw (${r.betDrawPct.toFixed(0)}% pot, ${r.betDrawCount} spots) vs down with a made `
            + `hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — backwards from the pool norm. `
            + 'A big bet from them is more likely a draw than the nuts; their small ones are where the value is.',
          `You size UP on a draw (${r.betDrawPct.toFixed(0)}% pot, ${r.betDrawCount} spots) vs down with a `
            + `made hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — backwards from the norm, and `
            + 'exploitable the same way. Even out your sizing across both.',
          'their big bet = draw', 'randomize your sizing', ['facing'],
          thresholdEdge(r.betDrawPct - r.betMadePct, 20, 60));
      }
    }

    // --- Bluff sizing and frequency, from showdowns only --------------------
    // Same evidence source and the same never-fires-for-hero gap as the block
    // above. bluffRate carries a caveat stronger than a thin sample: a working
    // bluff ends in a fold and never reaches showdown, so this is a FLOOR
    // biased low by exactly the bluffs that succeeded — never phrase it as
    // their true bluffing rate.
    if ((r.betBluffCount + r.betMadeCount) >= TEXTURE_MIN
        && r.betBluffPct != null && r.betMadePct != null
        && Math.abs(r.betMadePct - r.betBluffPct) >= 20) {
      if (r.betMadePct > r.betBluffPct) {
        add(55, 'Bluff',
          `Bets smaller when caught bluffing (${r.betBluffPct.toFixed(0)}% pot, ${r.betBluffCount} spots) `
            + `than with a made hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — a small bet `
            + 'from them leans toward air. Call their small bets down lighter and give the big ones more respect.',
          `You bet smaller bluffing (${r.betBluffPct.toFixed(0)}% pot, ${r.betBluffCount} spots) than with a `
            + `made hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — a sharp opponent can read `
            + 'your size and fold only the bluffs. Match your bluff sizing to your value sizing.',
          'their small bet = air', 'match bluff/value sizing', ['facing'],
          thresholdEdge(r.betMadePct - r.betBluffPct, 20, 60));
      } else {
        add(55, 'Bluff',
          `Bets BIGGER when caught bluffing (${r.betBluffPct.toFixed(0)}% pot, ${r.betBluffCount} spots) `
            + `than with a made hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — backwards from `
            + 'the pool norm. Their overbet is more likely to be air than the nuts; their smaller bets are where the value is.',
          `You bet BIGGER bluffing (${r.betBluffPct.toFixed(0)}% pot, ${r.betBluffCount} spots) than with a `
            + `made hand (${r.betMadePct.toFixed(0)}%, ${r.betMadeCount} spots) — backwards, and exploitable `
            + 'the same way. Even out your sizing across both.',
          'their overbet = air', 'match bluff/value sizing', ['facing'],
          thresholdEdge(r.betBluffPct - r.betMadePct, 20, 60));
      }
    }
    if (r.bluffSample >= TEXTURE_MIN) {
      if (r.bluffRate >= 35) {
        add(52, 'Bluff',
          `Shows down with nothing ${fmtPct(r.bluffRate)} of the time after betting (${r.bluffSample} spots, `
            + 'floor only — a working bluff never reaches showdown, so the true rate is higher). '
            + 'Call down lighter against their bets; they are not always there.',
          `You show down with nothing ${fmtPct(r.bluffRate)} of the time after betting (${r.bluffSample} `
            + 'spots, and that floor undercounts every bluff that actually worked). Opponents paying attention '
            + 'will start calling you down lighter — make sure your bluffs are picked, not habitual.',
          'calls too light vs their air', 'pick bluff spots, don\'t habit-bluff', ['facing'],
          thresholdEdge(r.bluffRate, 35, 70));
      } else if (r.bluffRate <= 5) {
        // Deliberately NOT the mirror of the high-rate case above. A LOW
        // showdown bluff rate is genuinely ambiguous — it could mean they
        // rarely bluff, or it could mean they bluff plenty and those bluffs
        // mostly WORK, which also keeps them out of this sample (see
        // noteBetTexture's caller: it only ever sees a hand that reached a
        // real showdown). This stat cannot tell those two apart, so it must
        // not claim to know their overall bluff frequency in either
        // direction — only what showing down with a bet actually means.
        add(52, 'Bluff',
          `Almost never shows down with nothing (${fmtPct(r.bluffRate)} of ${r.bluffSample} spots) — when `
            + 'their bet DOES reach showdown, it is essentially always real. Fold marginal hands to their '
            + 'bets rather than paying them off. This says nothing about how often they bluff overall — a '
            + 'bluff that works never shows up here either.',
          `You almost never show down with nothing (${fmtPct(r.bluffRate)} of ${r.bluffSample} spots) — `
            + "when your bet reaches showdown it's read as real, which is fine as long as your bluffs are "
            + 'winning the pot before it gets there rather than you simply not bluffing.',
          'their showdown bet = real', 'no change needed here', ['facing'],
          thresholdEdge(5 - r.bluffRate, 0, 5));
      }
    }

    if (r.trapSample >= TEXTURE_MIN) {
      if (r.trapRate > 40) {
        add(78, 'Trap',
          `Slowplays made hands — checks two pair+ instead of betting it ${fmtPct(r.trapRate)} of the time `
            + `(${r.trapSample} spots). Don't read their check as weakness; check back marginal hands rather `
            + 'than betting into a checked-through big hand, and expect a check-raise when you do bet.',
          `You slowplay made hands — check two pair+ instead of betting it ${fmtPct(r.trapRate)} of the time `
            + `(${r.trapSample} spots). It wins the occasional big pot but also lets a free card that could `
            + 'cost you the hand; make sure the trap line is actually the better line here, not just habit.',
          'their check ≠ weak', 'bet your big hands more', null,
          thresholdEdge(r.trapRate, 40, 80));
      } else if (r.trapRate < 10) {
        add(58, 'Trap',
          `Almost never slowplays — checks two pair+ only ${fmtPct(r.trapRate)} of the time `
            + `(${r.trapSample} spots). A bet from them with a big hand is close to automatic, so treat a `
            + 'check as closer to genuine weakness and bet into it more freely.',
          `You almost never slowplay (${fmtPct(r.trapRate)} of ${r.trapSample} made-hand spots) — your checks `
            + 'are read as weak because they always are. Mix in the occasional slowplay so a check doesn\'t '
            + 'give it away.',
          'their check = weak', 'mix in a slowplay', null,
          thresholdEdge(10 - r.trapRate, 0, 10));
      }
    }

    // --- What they've actually shown ----------------------------------------
    // Never fires for hero: harvestShownCards deliberately excludes hero's own
    // cards (see CLAUDE.md "Showdown ranges"), so p.shownHands stays empty.
    // The leak-voice text below is dead code on that account, not a gap.
    const shownAll = shownRange(p, 'all');
    const shownRaised = shownRange(p, 'raised');
    if (shownAll.length >= 3) {
      const total = shownAll.reduce((a, e) => a + e.n, 0);
      const top = shownAll.slice(0, 5).map((e) => e.cls).join(', ');
      add(40, 'Range',
        `Has shown down ${total} hand${total === 1 ? '' : 's'}: ${top}`
          + `${shownAll.length > 5 ? '…' : ''}. `
          + (shownRaised.length
            ? `When they raised preflop they turned up ${shownRaised.slice(0, 4).map((e) => e.cls).join(', ')}.`
            : 'None of it after a preflop raise, so their raising range is still unknown.')
          + ' Showdowns are a floor on their range, not all of it.',
        `You've shown down ${total} hand${total === 1 ? '' : 's'}: ${top}${shownAll.length > 5 ? '…' : ''}. `
          + 'Does that match how you think you play? A gap between your self-image and what you actually '
          + 'show is worth noticing.',
        'seen at showdown', 'check your self-image');
    }

    // --- Folding patterns, per street ---------------------------------------
    //
    // streetRates has computed foldPct since per-street stats were added and
    // NOTHING read it — the fourth stat in this file found already-collected
    // and merely unreported. It is also the most directly actionable thing
    // here: "folds 64% of turns" tells you which street to fire.
    //
    // Tagged to its own street, so the advice arrives on the street it is
    // about rather than whenever this player happens to be the aggressor.
    POSTFLOP_STREETS.forEach((st) => {
      const b = r.byStreet[st];
      if (!b || b.foldPct == null || b.actions < 8) return;
      if (b.foldPct > 60) {
        add(84, 'Fold',
          `Folds ${fmtPct(b.foldPct)} of their ${st} decisions (${b.actions} actions) — `
            + `they give up on the ${st} more than anyone should. Fire the ${st} whether or not you hit.`,
          `You fold ${fmtPct(b.foldPct)} of your ${st} decisions (${b.actions} actions) — you give up on `
            + `the ${st} more than you should. Bluff-catch or barrel through it more instead of folding on autopilot.`,
          `barrel the ${st}`, `stop over-folding the ${st}`, [st],
          thresholdEdge(b.foldPct, 60, 90));
      } else if (b.foldPct < 20) {
        add(74, 'Fold',
          `Almost never folds the ${st} — ${fmtPct(b.foldPct)} of ${b.actions} decisions. `
            + `Bluffing the ${st} against them does not work; bet for value and give up your air.`,
          `You almost never fold the ${st} — ${fmtPct(b.foldPct)} of ${b.actions} decisions. Sharp `
            + `opponents will stop bluffing the ${st} against you and just value-bet instead; find more folds there.`,
          `no ${st} bluffs`, `fold the ${st} more`, [st],
          thresholdEdge(20 - b.foldPct, 0, 20));
      }
    });

    // --- Do they attack a bet? ----------------------------------------------
    if (r.postflopRR != null && r.rrSample >= 8) {
      if (r.postflopRR > 18) {
        add(79, 'Re-raise',
          `Raises ${fmtPct(r.postflopRR)} of the bets they face (${r.rrSample} spots) — `
            + 'they attack bets rather than calling. Check your strong hands to induce it, and think twice '
            + 'about thin value bets that can only be raised off.',
          `You raise ${fmtPct(r.postflopRR)} of the bets you face (${r.rrSample} spots) — you attack bets `
            + 'rather than calling. Sharp opponents will start checking their strong hands to induce your '
            + 'raise, and thin-value you less since a raise can only come from strength or a well-timed bluff.',
          'they raise bets', 'raise less on autopilot', ['postflop'],
          thresholdEdge(r.postflopRR, 18, 45));
      } else if (r.postflopRR < 5) {
        add(76, 'Re-raise',
          `Almost never raises a bet — ${fmtPct(r.postflopRR)} of ${r.rrSample} spots faced. `
            + 'So when they DO raise, it is the top of their range. Fold anything marginal to it, and '
            + 'bet thinner for value knowing you will rarely be blown off the hand.',
          `You almost never raise a bet you face — ${fmtPct(r.postflopRR)} of ${r.rrSample} spots. Good `
            + "opponents will bet-then-give-up into you far less since you never punish it, and they'll "
            + 'thin-value bet you without fear. Raise more of your strong hands instead of just calling.',
          'their raise = nuts', 'raise more of your strong hands', ['facing'],
          thresholdEdge(5 - r.postflopRR, 0, 5));
      }
    }

    // --- The trap line -------------------------------------------------------
    // Gain sits above every postflop rule deliberately: this is the one read
    // that turns a routine call into a fold, and it is dirt cheap to act on.
    // Never fires for hero — same shownHands gap as the range rule above.
    if (r.limpRaiseCount >= 2) {
      add(106, 'Trap',
        `Limp-3bets — limped then re-raised on ${r.limpRaiseCount} occasions. `
          + 'Almost nobody does that light. If they limp and then come back over the top, fold everything '
          + 'but the very top of your range, regardless of what their other numbers say.',
        `You've limp-3bet — limped then re-raised — on ${r.limpRaiseCount} occasions. Almost nobody does `
          + 'that light, so sharp opponents will fold almost everything to it — meaning it only pays off '
          + 'against players who call too wide. Make sure the trap line is still the right tool against this table.',
        'limp-raise = monster', 'check who this works on', ['preflop'],
        thresholdEdge(r.limpRaiseCount, 2, 6));
    }

    // --- What they showed AFTER a 3-bet, specifically -------------------------
    // The generic "shown at showdown" rule above still covers the whole sample.
    // This one is narrower and far more useful: a 3-bet range is the read that
    // decides whether you can 4-bet or have to fold. Never fires for hero.
    const shown3 = shownRange(p, 'threebet');
    if (shown3.length >= 2) {
      const n3 = shown3.reduce((a, e) => a + e.n, 0);
      add(62, 'Range',
        `Has shown ${n3} hand${n3 === 1 ? '' : 's'} after 3-betting: `
          + `${shown3.slice(0, 5).map((e) => e.cls).join(', ')}${shown3.length > 5 ? '…' : ''}. `
          + 'That is a floor on their 3-bet range, not all of it.',
        `You've shown ${n3} hand${n3 === 1 ? '' : 's'} after 3-betting: `
          + `${shown3.slice(0, 5).map((e) => e.cls).join(', ')}${shown3.length > 5 ? '…' : ''}. `
          + 'Is that the range you meant to be 3-betting?',
        'their 3-bet range', 'check your 3-bet range', ['preflop']);
    }

    // --- Live state ----------------------------------------------------------
    // Stack swing is a state read, not a tendency: it says what just happened
    // to them, which is often a better predictor of the next hand than
    // anything in their lifetime numbers. Applies to hero too — being stuck
    // or way up is exactly when YOUR OWN game tends to drift.
    const sw = stackSwingBB(p);
    if (sw && sw.downBB >= 50) {
      add(88, 'Stuck',
        `Down ${sw.downBB.toFixed(0)}bb from their high this sitting. `
          + 'Expect them to widen and to call lighter trying to get it back — '
          + 'value bet, and stop bluffing until they settle.',
        `You're down ${sw.downBB.toFixed(0)}bb from your high this sitting — this is exactly when tilt `
          + 'creeps in. Play tighter, not looser, until you\'re back to your normal game rather than pressing '
          + 'to get even.',
        'stuck — value bet', 'stuck — tighten up', null,
        thresholdEdge(sw.downBB, 50, 200));
    } else if (sw && sw.upBB >= 100) {
      add(35, 'Winning',
        `Up ${sw.upBB.toFixed(0)}bb this sitting. A big stack covers yours, `
          + 'so pots against them are for your whole stack — pick spots accordingly.',
        `You're up ${sw.upBB.toFixed(0)}bb this sitting. A big stack means your next pot could be for a lot `
          + "— don't get cute because you're ahead; keep playing your normal game rather than loosening up.",
        'covers your stack', "don't get cute", null,
        thresholdEdge(sw.upBB, 100, 400));
    }

    const tilt = tiltRead(p);
    if (tilt) {
      add(110, 'Tilt',
        `${tiltText(tilt)} Widen your value range against them right now and `
          + 'let them do the bluffing — this fades within an orbit or two.',
        `${tiltText(tilt)} This is the moment leaks actually happen — tighten back up rather than pressing, `
          + 'and it fades within an orbit or two.',
        'tilting — widen value', 'tilting — tighten up', null,
        thresholdEdge(tilt.jump, TILT_VPIP_JUMP, TILT_VPIP_JUMP * 3));
    }

    out.sort((a, b) => b.gain - a.gain);
    return out;
  }

  function buildExploitPlan(p) { return buildTendencyEntries(p, 'exploit'); }

  // Self-facing version of buildExploitPlan — "what should I change about my
  // own game", not "how do I play against them". Same detection, same
  // thresholds, same POOL_AVG/POOL_SPREAD comparison; only the wording flips
  // from instructions about an opponent to advice about your own play. See
  // buildTendencyEntries for why the two share one detection pass.
  function buildLeakPlan(p) { return buildTendencyEntries(p, 'leak'); }

  // The single most useful exploit tip for the hand in progress.
  //
  // Prefers whoever is driving the action, since that is the player you are
  // about to make a decision against. Falls back to the most exploitable
  // opponent still in the pot, so an unraised multiway pot still gets a read
  // rather than nothing.
  //
  // Returns { xid, entry } or null.
  // Tokens describing the decision hero is ACTUALLY facing. Exploit entries
  // declare a `when` list against these — see add() in buildExploitPlan.
  //
  // Deliberately coarse. A finer context (SPR bands, heads-up vs multiway)
  // would depend on reads this file already flags as imperfect — position, and
  // whether an all-in was really a call — and a wrong token silently promotes
  // the wrong advice, which is worse than advice that is merely general. Every
  // token below is read straight off hand state that is already trusted.
  function handContextTokens(hand) {
    const ctx = new Set();
    if (!hand) return ctx;
    const street = hand.street || 'preflop';
    ctx.add(street);
    if (street !== 'preflop') ctx.add('postflop');
    // Board texture as context, so a texture read can only surface on the
    // texture it actually describes — "they fold four-flush boards" is noise
    // on a rainbow flop. Emitted before the hero check below, because the board
    // is the board whether or not hero has been identified.
    boardFlags((hand.board || []).slice(0, BOARD_COUNT_FOR[street] || 0))
      .forEach((f) => ctx.add('board:' + f));
    if (heroUnresolved()) return ctx; // no hero, no "facing" or "lead" to speak of
    // Facing a bet = an opponent STILL IN THE HAND has put more into this
    // street than hero. Delegated to streetLeader so the token and the
    // pot-odds figure read the same state — and so a player who bet and then
    // folded stops counting, which the old inline scan over every key of
    // streetContributions did not do.
    const lead = streetLeader(hand);
    if (lead && lead.facing) ctx.add('facing');
    // Hero took the preflop lead, so the c-bet is theirs to make or skip.
    if (hand.aggressorByStreet && hand.aggressorByStreet.preflop === heroXid) ctx.add('lead');
    return ctx;
  }

  // An entry is relevant when every token it declares is in the context.
  // Untagged entries are neutral rather than relevant — they apply everywhere,
  // so they should neither be promoted nor punished.
  function entryRelevance(entry, ctx) {
    if (!entry || !entry.when || !entry.when.length) return 0;
    return entry.when.every((tok) => ctx.has(tok)) ? 1 : -1;
  }

  // Deliberately modest. A large bonus would let any situational rule bury a
  // high-gain state read like tilt, which is relevant on every street; these
  // values let a matched rule win a close call without erasing the strongest
  // general reads. Tilt (110) still outranks an off-street c-bet rule (100-45).
  const EXPLOIT_RELEVANT_BONUS = 60;
  const EXPLOIT_IRRELEVANT_PENALTY = 45;

  // A read on a player under `minHands` is shown, flagged, and ranked below a
  // well-sampled one. Big enough that any solid read on another live opponent
  // outranks a thin one, small enough that it never beats the +1000 aggressor
  // bonus — the player driving the action is still who you are deciding
  // against, however little you have seen of them.
  const EXPLOIT_PROVISIONAL_PENALTY = 200;

  // How many reads the expanded coach panel carries. Two, asked for directly.
  // The collapsed pill stays at one — it is the most width-starved element in
  // the HUD and a second read there would just be an ellipsis.
  const COACH_TIPS_SHOWN = 2;

  // How far past its threshold a read actually is, as a 0..1 edge, used to
  // separate two rules that carry the same `gain`.
  //
  // WHY: `gain` is a constant per RULE, so a villain two points over the
  // fold-to-c-bet threshold and one at 80% scored identically, and whichever
  // rule had the higher constant won for everybody. Measured over 400
  // synthetic players spread around POOL_AVG by a full POOL_SPREAD — a WIDER
  // spread than the real pool — two tips covered 45% of the field and four
  // covered 63%. That is the "repeats too much across the player base" report.
  //
  // 0.5 is the neutral default, so a rule that passes no edge sits in the
  // middle of the band and is neither promoted nor punished. Same defaulting
  // principle as an untagged `when`.
  const EXPLOIT_EDGE_NEUTRAL = 0.5;
  // ±20 around neutral. Deliberately a TIEBREAKER, not a re-ranking: the gain
  // ladder encodes a real judgement (postflop reads beat preflop ones against
  // this pool), and a span wide enough to overturn it would be replacing that
  // judgement with an arbitrary one. It separates rules within a tier.
  const EXPLOIT_EDGE_SPAN = 40;

  // Edge for a stat measured against POOL_AVG: 0 at the threshold
  // (avg ± spread), 1 at two further spreads out, which is the same "one
  // spread = notable, two = extreme" scale POOL_SPREAD already defines for the
  // deviation indicators. Clamped, so a wild outlier does not run away with it.
  function spreadEdge(value, avg, spread) {
    if (value == null || !spread) return EXPLOIT_EDGE_NEUTRAL;
    const past = Math.abs(value - avg) - spread;
    return Math.max(0, Math.min(1, past / (2 * spread)));
  }

  // Edge for a rule with a bare threshold and no pool figure behind it (fold
  // percentages, re-raise frequency, trap and bluff rates). `at` is where the
  // rule starts firing, `full` where it is as extreme as it usefully gets.
  function thresholdEdge(value, at, full) {
    if (value == null || at === full) return EXPLOIT_EDGE_NEUTRAL;
    return Math.max(0, Math.min(1, (value - at) / (full - at)));
  }

  // --- Tip fatigue ---------------------------------------------------------
  //
  // Nothing remembered what it had already told you, so the same sentence
  // rendered every 1.5 seconds for a whole session. That is the other half of
  // the "advice seems stale" report, and it is not fixed by better ranking:
  // the top read genuinely IS the top read, you have simply finished reading
  // it.
  //
  // Keyed 'xid|tag', not stored on the entry — entries are rebuilt from
  // scratch on every render, so anything hung on them lives 1.5 seconds.
  //
  // Counted per SPOT (hand + street), never per render. At 1.5s a single
  // street would otherwise rack up forty showings and demote the read out of
  // the very spot it is about, before you had finished reading it once.
  //
  // PER PLAYER ONLY, deliberately. A global per-tag fatigue would fix the
  // cross-player concentration directly, but it does it by suppressing a
  // correct read on a brand-new villain purely because you saw the same read
  // on somebody else ten minutes ago — trading accuracy for variety. Asked and
  // answered: out.
  const tipFatigue = new Map(); // 'xid|tag' -> { spots, lastAt, lastSpot }
  const TIP_FATIGUE_MS = 10 * 60 * 1000;
  const TIP_FATIGUE_STEP = 18;
  // Capped BELOW EXPLOIT_RELEVANT_BONUS (60), and that relationship is the
  // invariant: between two equally-strong reads, the one that matches the spot
  // hero is actually in always wins, however many times you have seen it.
  // Fatigue rotates within a relevance class; it can never rotate a relevant
  // read out in favour of an irrelevant one. test/coach-fatigue.test.js pins
  // both directions, so moving either number fails.
  const TIP_FATIGUE_MAX = 54;

  function tipFatigueKey(xid, tag) { return xid + '|' + tag; }

  function tipFatiguePenalty(xid, tag) {
    const rec = tipFatigue.get(tipFatigueKey(xid, tag));
    if (!rec) return 0;
    if (Date.now() - rec.lastAt > TIP_FATIGUE_MS) return 0; // gone cold, reads fresh again
    return Math.min(TIP_FATIGUE_MAX, TIP_FATIGUE_STEP * rec.spots);
  }

  // One count per (hand, street), not per render — see above. Returns true when
  // this showing was a new spot, which is only useful to the tests.
  function noteTipShown(xid, tag, spot) {
    const key = tipFatigueKey(xid, tag);
    const rec = tipFatigue.get(key);
    const now = Date.now();
    if (!rec || now - rec.lastAt > TIP_FATIGUE_MS) {
      tipFatigue.set(key, { spots: 1, lastAt: now, lastSpot: spot });
      return true;
    }
    rec.lastAt = now;
    if (rec.lastSpot === spot) return false;
    rec.lastSpot = spot;
    rec.spots += 1;
    return true;
  }

  // The spot a tip is being shown IN. Torn's own game id plus the street, so
  // the same read on the same street of the same hand counts once however many
  // times the panel re-renders. No game id (a hand joined mid-way) falls back
  // to the street alone, which under-counts rather than over-counts — the safe
  // direction, since over-counting demotes a live read.
  function tipSpotKey(hand) {
    return (hand && hand.gameId ? hand.gameId : 'nogame') + '|' + ((hand && hand.street) || 'preflop');
  }

  // Up to `limit` reads for the hand in progress, best first.
  //
  // Returns [{ xid, entry, score, relevant, provisional, hands }], and RECORDS
  // each one it returns as shown (see noteTipShown) so the next spot rotates.
  // Deduped on (player, tag): two phrasings of the same read on the same
  // player is one line's worth of information taking two.
  function currentExploitTips(limit) {
    const hand = currentHand;
    if (!hand) return [];
    const ctx = handContextTokens(hand);
    const want = Math.max(1, limit || 1);
    // Only the aggressor who is STILL IN. hand.lastAggressor is never cleared
    // on a fold, so the +1000 below used to keep pointing at a player who had
    // left the pot — see liveAggressor.
    const aggressor = liveAggressor(hand);

    const order = [];
    if (aggressor) order.push(aggressor);
    hand.playersIn.forEach((x) => { if (!order.includes(x)) order.push(x); });

    const scored = [];
    for (const xid of order) {
      if (!xid || isHeroRecord(xid)) continue;
      const p = STORE.players[xid];
      if (!p) continue;
      // Under minHands the read is FLAGGED, not withheld. The frequency rules
      // in buildExploitPlan already carry their own sample gates (n >= 20,
      // foldToCbetOpp >= 8, betSizeCount >= BET_SIZE_MIN and so on), so a
      // genuinely new player surfaces only the reads that are valid early —
      // tilt, a stack that is stuck, a limp-3bet, what they have shown down.
      // Those are exactly the reads worth having on someone you have just met,
      // and the old hard gate left the seat you know LEAST about as the only
      // one the coach would say nothing at all about.
      const provisional = p.hands < STORE.settings.minHands;
      // EVERY entry, not just the highest-gain one. Taking [0] is what let the
      // panel offer "c-bet every flop you take the lead in" while hero was
      // facing a river shove: the player's biggest overall leak is frequently
      // not the most useful thing to say about the decision in front of them.
      const plan = buildExploitPlan(p);
      for (const entry of plan) {
        const rel = entryRelevance(entry, ctx);
        // The aggressor still wins outright — a stronger read on someone who
        // has already folded out of the decision is not more useful.
        const edge = typeof entry.edge === 'number' ? entry.edge : EXPLOIT_EDGE_NEUTRAL;
        const score = entry.gain
          + (rel > 0 ? EXPLOIT_RELEVANT_BONUS : rel < 0 ? -EXPLOIT_IRRELEVANT_PENALTY : 0)
          + EXPLOIT_EDGE_SPAN * (edge - EXPLOIT_EDGE_NEUTRAL)
          - tipFatiguePenalty(xid, entry.tag)
          + (provisional ? -EXPLOIT_PROVISIONAL_PENALTY : 0)
          + (xid === aggressor ? 1000 : 0);
        scored.push({ xid, entry, score, relevant: rel > 0, provisional, hands: p.hands });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const spot = tipSpotKey(hand);
    const seen = new Set();
    const out = [];
    for (const cand of scored) {
      const key = tipFatigueKey(cand.xid, cand.entry.tag);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cand);
      if (out.length >= want) break;
    }
    out.forEach((c) => noteTipShown(c.xid, c.entry.tag, spot));
    return out;
  }

  // The single best read — the collapsed pill has room for exactly one.
  function currentExploitTip() {
    return currentExploitTips(1)[0] || null;
  }

  // isSelf switches between the two voices buildTendencyEntries produces —
  // opponent-facing "Exploit" for anyone else, self-facing "Leaks" (DriveHUD's
  // MDA Exploit Report / PT4's LeakTracker, aimed at yourself instead of an
  // opponent) when the open panel is hero's own. Same markup either way; only
  // the plan source and the empty-state copy differ.
  function buildExploitHtml(p, isSelf) {
    const plan = isSelf ? buildLeakPlan(p) : buildExploitPlan(p);
    const n = p ? p.hands || 0 : 0;
    if (!plan.length) {
      return isSelf
        ? `<i>No leaks found yet${n ? ` in ${n} hands` : ''}. `
          + 'This fills in as your numbers separate from the pool average — '
          + 'no deviation means nothing worth flagging yet.</i>'
        : `<i>Nothing clearly exploitable yet${n ? ` in ${n} hands` : ''}. `
          + 'This fills in as their numbers separate from the pool average — '
          + 'no deviation means no exploit worth naming.</i>';
    }
    return `<div class="tph-plan-lead">Strongest adjustments first, each with the number it came from.</div>`
      + plan.map((e) => `<div class="tph-plan"><span class="tph-plan-tag">${escapeHtml(e.tag)}</span>`
        + `<span class="tph-plan-txt">${escapeHtml(e.text)}</span></div>`).join('');
  }

  // The report as structured SECTIONS, rendered two ways: plain text for the
  // clipboard, markup for the screen. Same split as buildExploitPlan /
  // buildExploitHtml, and for the same reason the History tab keeps it — the
  // copied text and the displayed text must not drift into two descriptions of
  // one player.
  //
  // Each item separates the OBSERVATION from the ADVICE (`act`). They used to
  // be one sentence — "Folds to c-bets 68% of the time (14 samples) — c-betting
  // into them prints; fire the flop with anything" — which is the thing that
  // made the report a wall of prose. Split, the numbers can be skimmed and the
  // actions stand out, which is how it is actually read mid-session.
  function buildReportSections(xid) {
    const p = STORE.players[xid];
    if (!p) return null;
    const r = computeRates(p);
    const secs = [];
    const sec = (title) => { const s = { title, items: [] }; secs.push(s); return s; };
    const add = (s, text, act) => { if (text) s.items.push({ text, act: act || null }); };

    const head = sec(null); // untitled lead block
    add(head, `${p.name} — ${p.hands} hands observed, ${classify(p)}.`);
    if (p.hands < STORE.settings.minHands) {
      head.items.push({
        text: `Fewer than ${STORE.settings.minHands} hands observed — read with caution.`,
        act: null,
        warn: true,
      });
    }

    const pre = sec('Preflop');
    if (r.vpip != null) {
      add(pre, `Plays ${r.vpip > 30 ? 'very wide' : r.vpip > 20 ? 'moderately wide' : 'tight'} `
        + `preflop (VPIP ${fmtPct(r.vpip)}, pool ${POOL_AVG.vpip.toFixed(0)}%).`);
    }
    if (r.pfr != null && r.vpip) {
      const ratio = r.pfr / r.vpip;
      add(pre, ratio > 0.6
        ? `Mostly raises rather than limps or calls (PFR ${fmtPct(r.pfr)}).`
        : `Often just calls preflop rather than raising (PFR ${fmtPct(r.pfr)}).`);
    }
    if (r.limpShareOfVpip != null && p.limpMade > 0) {
      const share = r.limpShareOfVpip;
      add(pre, `Limps ${fmtPct(r.limp)} of hands — ${fmtPct(share)} of the pots they enter `
        + `(pool ${POOL_AVG.limpShareOfVpip}%).`,
      share > POOL_AVG.limpShareOfVpip + 12
        ? 'Habitual limper: isolate wide in position, and expect a capped range when they only call.'
        : share < POOL_AVG.limpShareOfVpip - 15
          ? 'Rarely limps, so when they call it is a genuine calling range.'
          : null);
    }
    if (r.limpRaiseCount >= 1) {
      add(pre, `Has limp-3bet ${r.limpRaiseCount} time${r.limpRaiseCount === 1 ? '' : 's'}.`,
        r.limpRaiseCount >= 2
          ? 'Almost nobody does this light — if they limp then re-raise, fold everything marginal.'
          : null);
    }
    if (r.foldTo3Bet != null) {
      add(pre, `Folds to 3-bets ${fmtPct(r.foldTo3Bet)} (${p.foldTo3BetOpp} samples, pool ${POOL_AVG.foldTo3Bet}%).`,
        r.foldTo3Bet > 65 ? '3-bet them light — their opens are close to free money.'
          : r.foldTo3Bet < 40 ? '3-bet for value only; they will not give up their opens.' : null);
    }

    const post = sec('Postflop');
    if (r.cbet != null) add(post, `Continuation-bets ${fmtPct(r.cbet)} of flop opportunities.`);
    if (r.foldToCbet != null) {
      add(post, `Folds to c-bets ${fmtPct(r.foldToCbet)} (${p.foldToCbetOpp} samples, pool ${POOL_AVG.foldToCbet}%).`,
        r.foldToCbet > 60 ? 'C-betting into them prints — fire the flop with anything.'
          : r.foldToCbet < 40 ? 'They do not fold flops. C-bet for value, never as a bluff.' : null);
    }
    if (r.afq != null) add(post, `Aggression frequency ${fmtPct(r.afq)} (folds excluded).`);
    // Per street, because the aggregate hides the most exploitable pattern
    // there is: firing flops and giving up on turns.
    const streetLine = POSTFLOP_STREETS
      .filter((s) => r.byStreet[s].actions >= 5)
      .map((s) => `${s} ${fmtPct(r.byStreet[s].afq)}`);
    if (streetLine.length) {
      const f = r.byStreet.flop.afq;
      const t = r.byStreet.turn.afq;
      add(post, `By street — ${streetLine.join(', ')}.`,
        (f != null && t != null && r.byStreet.turn.actions >= 5 && f - t > 20)
          ? 'Fires the flop then gives up on the turn: float the flop and take it away on the turn.'
          : null);
    }
    POSTFLOP_STREETS.forEach((st) => {
      const b = r.byStreet[st];
      if (!b || b.foldPct == null || b.actions < 8) return;
      if (b.foldPct > 60) {
        add(post, `Folds ${fmtPct(b.foldPct)} of ${st} decisions (${b.actions} actions).`,
          `Barrel the ${st} — they give it up more than anyone should.`);
      } else if (b.foldPct < 20) {
        add(post, `Folds only ${fmtPct(b.foldPct)} of ${st} decisions (${b.actions} actions).`,
          `Do not bluff the ${st}; bet for value and give up your air.`);
      }
    });
    if (r.postflopRR != null && r.rrSample >= 8) {
      add(post, `Raises ${fmtPct(r.postflopRR)} of the bets they face (${r.rrSample} spots).`,
        r.postflopRR > 18 ? 'They attack bets — check strong hands to induce it.'
          : r.postflopRR < 5 ? 'When they do raise, it is the top of their range. Fold marginal hands.' : null);
    }

    const show = sec('Sizing & showdown');
    if (r.medianBetPct != null) {
      const sz = r.medianBetPct;
      add(show, `Typically bets ${sz.toFixed(0)}% of pot (median of ${betSizeSample(p)} sized bets).`,
        sz > 85 ? 'Oversized — usually polarised to strong hands or bluffs.'
          : sz < 45 ? 'Consistently small — float and take it away on a later street.' : null);
    }
    if (r.wtsd != null) {
      add(show, `Goes to showdown ${fmtPct(r.wtsd)} of hands played.`,
        r.wtsd > 40 ? 'A station — three-street value, and never try to bluff them off a made hand.'
          : r.wtsd < 18 ? 'Gives up a lot — barrel more; they fold before the river.' : null);
    }
    if ((r.betDrawCount + r.betMadeCount) >= TEXTURE_MIN) {
      add(show, `When shown down, sizes ${fmtPct(r.betDrawPct)} of pot betting a draw `
        + `(${r.betDrawCount}) vs ${fmtPct(r.betMadePct)} already made (${r.betMadeCount}).`,
        r.betDrawPct != null && r.betMadePct != null && Math.abs(r.betMadePct - r.betDrawPct) >= 20
          ? (r.betMadePct > r.betDrawPct
            ? 'Bets bigger with the goods than on a draw — a size jump is a real hand.'
            : 'Bets bigger ON draws than with a made hand — a big bet from them is more likely a draw.')
          : null);
    }
    if (r.bluffSample >= TEXTURE_MIN) {
      add(show, `Shows down with nothing (worse than a pair, no draw) after betting `
        + `${fmtPct(r.bluffRate)} of the time (${r.bluffSample} spots) — a floor, not their true rate: a `
        + 'bluff good enough to win the pot never reaches showdown at all.',
        (r.betBluffCount + r.betMadeCount) >= TEXTURE_MIN && r.betBluffPct != null && r.betMadePct != null
          && Math.abs(r.betMadePct - r.betBluffPct) >= 20
          ? (r.betMadePct > r.betBluffPct
            ? 'Bets smaller bluffing than with the goods — a small bet from them leans toward air.'
            : 'Bets BIGGER bluffing than with a made hand — their overbet leans toward air, not the nuts.')
          : null);
    }
    if (r.trapSample >= TEXTURE_MIN) {
      add(show, `Slowplays a made hand (checks two pair+ instead of betting it) `
        + `${fmtPct(r.trapRate)} of the time (${r.trapSample} spots).`,
        r.trapRate > 40 ? "Don't read their check as weakness — they trap. Check back marginal hands instead of betting into it."
          : r.trapRate < 10 ? 'Rarely slowplays — a bet from them with a big hand is close to automatic, so a check-through is closer to real weakness.' : null);
    }
    const shown3 = shownRange(p, 'threebet');
    if (shown3.length) {
      const n3 = shown3.reduce((a, e) => a + e.n, 0);
      add(show, `Shown after 3-betting (${n3}): ${shown3.slice(0, 6).map((e) => e.cls).join(', ')}`
        + `${shown3.length > 6 ? '…' : ''}. A floor on that range, not all of it.`);
    }

    const you = sec('Your results');
    add(you, `Estimated result against them: ${fmtSignedMoney(p.plChipsEst)} / ${fmtBB(p.plBBEst)}.`,
      null);
    you.items.push({ text: 'Positive means you are up on them. Multiway pots are attributed, so this is an estimate.', act: null, note: true });

    if (p.notes) {
      const nt = sec('Notes');
      add(nt, p.notes);
    }

    return secs.filter((s) => s.items.length);
  }

  // Plain text — the clipboard, and any future consumer that isn't a screen.
  function buildReport(xid) {
    const secs = buildReportSections(xid);
    if (!secs) return 'No data yet for this player.';
    const out = [];
    secs.forEach((s) => {
      if (s.title) { out.push(''); out.push(s.title.toUpperCase()); }
      s.items.forEach((it) => {
        out.push(it.text);
        if (it.act) out.push('  -> ' + it.act);
      });
    });
    return out.join('\n').trim();
  }

  function buildReportHtml(xid) {
    const secs = buildReportSections(xid);
    if (!secs) return '<i>No data yet for this player.</i>';
    return secs.map((s) => `<div class="tph-rep-sec">`
      + (s.title ? `<div class="tph-rep-h">${escapeHtml(s.title)}</div>` : '')
      + s.items.map((it) => {
        const cls = it.warn ? ' tph-rep-warn' : it.note ? ' tph-rep-note' : '';
        return `<div class="tph-rep-l${cls}">${escapeHtml(it.text)}</div>`
          + (it.act ? `<div class="tph-rep-act">${escapeHtml(it.act)}</div>` : '');
      }).join('')
      + '</div>').join('');
  }

  // ===========================================================================
  // 7. HUD OVERLAY
  // ===========================================================================

  const CSS = `
    /* Deliberately understated and anchored UNDER the seat: at 11px with a solid
       border sitting above the seat it covered the player's name, which is the
       one thing on a seat you always need to read. */
    .tph-badge { position: fixed; z-index: 99998; background: rgba(10,10,14,0.82) !important;
      color: #cfd6dd !important; border: none; border-radius: 3px; padding: 1px 3px;
      font: 10px/1.45 -apple-system, sans-serif !important;
      letter-spacing: 0; white-space: nowrap; cursor: pointer; pointer-events: auto;
      max-width: 118px; overflow: hidden; }
    /* The gap between the type and the numbers is a margin, not a space
       character: a space is ~3px of nothing at the one place the badge is
       already at its widest. Same reasoning behind the tightened padding and
       the dropped letter-spacing above — this element floats over the table,
       and at full width it reaches the community cards. */
    .tph-badge b { color: #ffc94d !important; font-weight: 700; margin-right: 2px; }
    /* Your own seat, tinted so it reads as "this one is me" at a glance rather
       than needing to be located by position. */
    .tph-badge-self { background: rgba(14,42,32,0.88) !important;
                      box-shadow: inset 0 0 0 1px rgba(53,208,127,.55); }
    .tph-badge-self b { color: #7ee0a6 !important; }
    .tph-badge .tph-badge-dim { color: #9fb0bf !important; }
    /* Emoji render wider than the 10px text around them, so they are pulled
       down a size and given the minimum gap that still keeps 🤮🔥 apart. */
    .tph-badge .tph-badge-tilt, .tph-badge .tph-badge-heat, .tph-badge .tph-badge-affil,
    .tph-badge .tph-badge-hosp {
      margin-right: 1px; font-size: 9px; }
    /* No colour declared here, same as -tilt/-heat above: this is emoji-only
       content and pinTextColor never walks badges (only .tph-panel content),
       so there is no dark-on-dark risk to guard against. */
    .tph-badge .tph-badge-affil { margin-left: 1px; }
    /* This-hand role markers. Deliberately a filled chip rather than more text
       in the badge's own voice — these describe the hand in front of you, not
       the player, and they disappear at settlement. Colour is declared here
       because pinTextColor leaves any tph- element alone, so one that declares
       none is left to Torn's own bare-element rules. */
    .tph-badge .tph-badge-role { border-radius: 2px; padding: 0 2px; margin-right: 2px;
      font-weight: 700; letter-spacing: 0; color: #0d1117 !important; }
    .tph-badge .tph-role-pre { background: #ffc94d; }
    .tph-badge .tph-role-post { background: #7fd4ff; }
    /* Must come after .tph-badge (same specificity, later wins) — without the
       extra room the role chip pushes V/P/A past the clip. */
    .tph-badge-wide { max-width: 146px; }
    .tph-state-note { color: #ffd9a0 !important; font-size: 11px; line-height: 1.35;
                      background: rgba(255,192,70,.10); border-bottom: none !important; }
    .tph-self-tilt { color: #ffb3a0 !important; display: block; }
    /* Player report. Every one of these declares its own colour: pinTextColor
       SKIPS tph- elements, so an undeclared one is left to Torn's bare rules and
       renders dark-on-dark (the v0.18.2 bug). The report used to be one <pre>
       of prose, which is why it was unreadable — the segmentation below is the
       fix, and the colour only reinforces it.
       Observation and ACTION are deliberately different colours: the whole
       point of the rewrite is that you can skim the numbers and still have the
       thing to do stand out. */
    .tph-rep-sec { margin: 0 0 10px 0; }
    .tph-rep-h { color: #8ec5f0 !important; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .06em; margin: 0 0 3px 0;
      border-bottom: 1px solid #8ec5f033; padding-bottom: 2px; }
    .tph-rep-l { color: #dfe5ea !important; font-size: 12px; line-height: 1.4; margin: 2px 0; }
    .tph-rep-act { color: #9ee6a0 !important; font-size: 12px; line-height: 1.4;
      margin: 1px 0 5px 10px; padding-left: 7px; border-left: 2px solid #9ee6a055; }
    /* Player panel header. Own colour is mandatory — pinTextColor skips
       tph- elements, and a bare <a> would otherwise pick up Torn's own link
       styling (or none) rather than something visible on the panel. */
    .tph-profile-link { color: #7fd4ff !important; text-decoration: underline; }
    /* Target block: status, level, and the attack link, on one row. Every one
       of these declares its own colour — pinTextColor skips tph- elements, so
       an undeclared one is left to Torn's bare-element rules and renders
       dark-on-dark (the v0.18.2 bug). */
    .tph-target { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: 11px; margin: -2px 0 9px; padding: 4px 6px; border-radius: 4px;
      background: rgba(255,255,255,.04); color: #cfd6dd !important; }
    .tph-target-txt { color: inherit !important; }
    /* Departure watch. The glow is pointer-events: none like every overlay
       here — that rule is absolute, and this one can fire mid-hand. */
    .tph-depart-glow { position: fixed; inset: 0; z-index: 99997; pointer-events: none;
      box-shadow: inset 0 0 0 3px rgba(255,157,138,.85); animation: tphDepart 1.3s ease-out 2; }
    @keyframes tphDepart { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
    /* touch-action:none so dragging the pill moves it instead of scrolling the
       page underneath — same requirement as .tph-coach-pill, and the thing
       that makes a draggable element actually draggable in a touch webview. */
    .tph-depart-pill { position: fixed; z-index: 99998; bottom: 96px; right: 12px;
      background: #ff9d8a !important; color: #14100f !important; font-weight: 700;
      font: 700 12px/1 -apple-system, sans-serif !important; padding: 7px 11px;
      border-radius: 13px; cursor: grab; touch-action: none; user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.45); }
    .tph-depart-pill.tph-dragging { cursor: grabbing; opacity: 0.85; }
    .tph-depart-note { color: #8d959c !important; font-size: 10.5px; margin: 0 0 8px; }
    .tph-depart-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
      padding: 6px; margin-bottom: 6px; border-radius: 4px;
      background: rgba(255,255,255,.04); color: #cfd6dd !important; font-size: 11.5px;
      border-left: 3px solid #3d3d48; }
    .tph-depart-ready { border-left-color: #7ee0a6; }
    .tph-depart-blocked { border-left-color: #ffb3a0; }
    .tph-depart-unknown { border-left-color: #f0c674; }
    .tph-depart-who { color: #f2f4f6 !important; }
    .tph-depart-meta { color: #8d959c !important; font-size: 10px; margin-left: 5px; }
    .tph-depart-state { color: #cfd6dd !important; font-size: 11px; }
    .tph-depart-ready .tph-depart-state { color: #7ee0a6 !important; }
    .tph-depart-blocked .tph-depart-state { color: #ffb3a0 !important; }
    .tph-depart-unknown .tph-depart-state { color: #f0c674 !important; }
    .tph-depart-x { margin-left: auto; color: #8d959c !important; cursor: pointer; padding: 0 4px; }
    /* History filter chips. Own colours throughout — pinTextColor skips tph-
       elements, so anything here declaring none renders dark-on-dark. */
    /* The export block. Every tph- element holding text declares its own
       colour — pinTextColor skips tph- elements, so an undeclared one renders
       dark-on-dark (the v0.18.2 bug). */
    .tph-exp { margin: 4px 0 10px; }
    .tph-exp-lead { color: #a8b2bd !important; font-size: 11px; margin: 6px 0 4px; }
    .tph-exp-msg { color: #cfd6dd !important; font-size: 11px; margin: 5px 0 0; }
    .tph-exp-ok { color: #7ee0a6 !important; }
    .tph-exp-bad { color: #f0c674 !important; }
    /* Selectable, and wrapping: a gist URL is longer than the panel is wide,
       and a link you cannot see all of is one you cannot copy by hand — which
       is the fallback this whole block exists to preserve. */
    .tph-exp-url { color: #8ec5f0 !important; font-size: 11px; word-break: break-all;
      user-select: text; -webkit-user-select: text; margin: 3px 0; }
    /* Short, because it is a fallback rather than something to read — but it
       must be ON SCREEN and laid out, or execCommand('copy') has nothing to
       select. That is the bug it fixes, not the height. */
    .tph-exp-ta { width: 100%; height: 54px; background: #111 !important; color: #ddd !important;
      border: 1px solid #444; font-size: 10px; }
    .tph-hf-bar { display: flex; gap: 5px; margin: 0 0 8px; flex-wrap: wrap; }
    .tph-hf { font-size: 11px; padding: 3px 9px; border-radius: 10px; cursor: pointer;
      border: 1px solid #3d3d48; background: rgba(255,255,255,.04);
      color: #a8b2bd !important; white-space: nowrap; }
    .tph-hf-on { background: #6b8cae !important; border-color: #6b8cae;
      color: #0d1117 !important; font-weight: 700; }
    /* The tag row. The chip is the marker itself, dimmed when off — so the
       thing you tap and the thing it matches are visibly one idea, and no
       per-key chip colour has to be maintained alongside the marker colours.
       Padding is the tap target: the marker alone is 9.5px text. */
    .tph-hf-tagbar { margin-top: -4px; }
    .tph-hft { display: inline-flex; align-items: center; padding: 4px 3px;
      border-radius: 5px; cursor: pointer; opacity: .42; }
    .tph-hft-on { opacity: 1; background: rgba(255,255,255,.10); }
    .tph-hf-clear { font-size: 10px; padding: 2px 7px; align-self: center; }
    /* Per-hand markers. Colour groups them by kind rather than decorating:
       gold = preflop aggression, blue = postflop aggression, red = a big pot,
       violet = cards seen, green = won. Matches the badge role-chip palette so
       3B means the same colour in both places. */
    .tph-hh-partial { color: #f0c674 !important; font-size: 10px; }
    .tph-hh-tags { display: flex; gap: 4px; margin-bottom: 4px; flex-wrap: wrap; }
    .tph-hh-tag { font-size: 9.5px; font-weight: 700; letter-spacing: .5px;
      padding: 1px 5px; border-radius: 3px; color: #0d1117 !important; background: #8d959c; }
    .tph-hh-tag-3B, .tph-hh-tag-4B { background: #ffc94d; }
    .tph-hh-tag-XR, .tph-hh-tag-RR { background: #7fd4ff; }
    .tph-hh-tag-BIG { background: #ff9d8a; }
    .tph-hh-tag-SD { background: #d4b3f0; }
    .tph-hh-tag-WON { background: #8ce89a; }
    /* Not a handNotability tag — a filter-only chip for "hero played this hand
       too" (HISTORY_TAG_ME). Grey rather than joining the colour scheme above,
       because those colours mean "the player you are reading did this" and
       this one is about you. */
    .tph-hh-tag-ME { background: #cfd6dd; }
    /* The notable hands are what the whole filter exists to surface, so they
       get a visible edge rather than only a chip. */
    .tph-hh-notable { border-left: 3px solid #ffc94d; padding-left: 6px;
      margin-left: -9px; }
    /* Settings diagnostic. Its own colours for the same pinTextColor reason. */
    .tph-target-diag { font-size: 11px; margin: 2px 0 6px; padding: 4px 6px;
      border-radius: 4px; background: rgba(255,255,255,.04); color: #cfd6dd !important; }
    .tph-target-diag-bad { color: #f0c674 !important; }
    .tph-target-diag-ok { color: #7ee0a6 !important; }
    .tph-target-meta { color: #8d959c !important; font-size: 10px; }
    /* State colours are read at a glance, so they carry the meaning rather
       than decorate it: red = cannot, green = can, amber = do not know. */
    .tph-target-blocked .tph-target-txt { color: #ffb3a0 !important; }
    .tph-target-ready .tph-target-txt { color: #7ee0a6 !important; }
    .tph-target-unknown .tph-target-txt { color: #f0c674 !important; }
    /* Pushed to the right so it is never adjacent to the status text it could
       be confused with, and sized as a real tap target on a phone. */
    .tph-attack-link { margin-left: auto; color: #ff9d8a !important;
      border: 1px solid #ff9d8a66; border-radius: 3px; padding: 2px 7px;
      text-decoration: none; white-space: nowrap; }
    .tph-rep-act::before { content: "→ "; }
    .tph-rep-warn { color: #f0c674 !important; }
    .tph-rep-note { color: #8d959c !important; font-size: 10px; }
    /* "new · 6h" beside a villain's name in the coach line. Amber rather than
       red: a thin sample is a caveat on the read, not a warning about the
       player. Its own colour is mandatory — pinTextColor skips tph- elements,
       so an undeclared one renders dark-on-dark (the v0.18.2 bug). */
    .tph-tip-new { color: #f0c674 !important; font-size: 10px; font-weight: 700;
      border: 1px solid #f0c67455; border-radius: 3px; padding: 0 3px; white-space: nowrap; }
    /* Two reads, one of them loud. The runner-up is real information, but the
       panel is read mid-decision and a pair of equally weighted lines is two
       things to take in where there is time for one. Both declare their own
       colour — mandatory for a tph- element that holds text, see above. */
    .tph-tip-lead { color: #e6ebf0 !important; display: block; }
    .tph-tip-second { color: #98a2ac !important; display: block; font-size: 11px; }
    /* background/color pinned: we inject into Torn's page, so an inherited or
       lower-specificity colour can be overridden by their stylesheet and leave
       dark text on a dark panel. */
    .tph-panel { position: fixed; z-index: 99999; top: 10%; left: 8%; right: 8%; max-height: 80%; overflow-y: auto;
      background: #1b1b1f !important; color: #eee !important; border: 1px solid #666; border-radius: 8px; padding: 12px;
      font: 13px/1.4 -apple-system, sans-serif; opacity: 1 !important; }
    /* Sits behind every .tph-panel, in front of the table. Tapping it fires the
       same onClose the ✕ does — see renderPanel. The panel itself is a sibling,
       not a child, so a tap inside the panel never bubbles here. left/right
       widened from 5% to 8% at the same time so there is a real margin to tap,
       not a 5%-wide sliver next to the table edge. */
    .tph-panel-backdrop { position: fixed; inset: 0; z-index: 99998;
      background: rgba(0,0,0,0.35); }
    .tph-panel h3 { margin: 0 0 8px; font-size: 15px; }
    .tph-panel textarea { width: 100%; height: 90px; background: #111; color: #ddd; border: 1px solid #444; }
    .tph-panel .tph-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
    .tph-panel .tph-tab { padding: 4px 8px; border: 1px solid #555; border-radius: 4px; cursor: pointer; }
    .tph-panel .tph-tab.active { background: #333; }
    .tph-panel button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 6px 10px; margin: 3px 4px 3px 0; font: 12px -apple-system, sans-serif; cursor: pointer; }
    /* Stats tab. Three columns: label, their figure, the pool norm + bar.
       Deviation colours are deliberately NOT red/green — high VPIP is not
       "bad", it is loose, and a good/bad palette would assert a judgement the
       HUD is in no position to make. Grey = typical, amber = notable,
       orange-red = extreme; direction comes from the arrow, not the colour. */
    /* table-layout:fixed is what guarantees the panel never scrolls sideways:
       column widths come from these percentages, not from content, so a long
       label or a wide number can no longer force the table past 100%. Without
       it the browser sizes columns to min-content and a phone overflows. */
    .tph-stats { width: 100%; max-width: 100%; table-layout: fixed;
                 border-collapse: collapse; font-size: 12px; }
    .tph-stats th { text-align: left; opacity: .55; font-weight: normal;
                    border-bottom: 1px solid #444; padding: 3px 3px; }
    .tph-stats td { padding: 3px 2px; border-bottom: 1px solid #2a2a2e;
                    vertical-align: middle; overflow-wrap: anywhere; }
    /* Explicit widths for all three columns; they must total 100%. Trimmed
       from 33/27/40 when the panel's own margin grew from 5% to 8% per side —
       the label column is short static words ("PFR", "Fold v 3B") with room to
       give up, so the reclaim goes to the value and note columns, the two that
       carry nowrap numbers and can't wrap onto a second line. */
    .tph-stat-l { width: 30%; color: #dfe5ea !important; }
    /* Explicit colours, not inherited. pinTextColor deliberately SKIPS anything
       carrying a tph- class, so a tph- cell with no colour of its own is left
       for Torn's bare td rule to darken — the v0.18.2 bug, reintroduced. Any
       new tph- element that holds text needs a colour declared right here.
       Declared BEFORE the .tph-dev-* rules so those win on equal specificity.
       (No backticks in this block: the whole stylesheet is a template literal.) */
    .tph-stat-v { width: 26%; white-space: nowrap; color: #f2f4f6 !important; }
    .tph-stat-n { width: 44%; white-space: nowrap; font-size: 11px; color: #aeb6bd !important; }
    /* Modifier for a note cell carrying a short PHRASE rather than one figure.
       The board-texture rows pair a pool reference with two sample counts, and
       that will not fit on one line of a narrow phone (reported from a Fold
       cover screen) — with the inherited nowrap it spilled out of its fixed
       column and over the label. Declared after .tph-stat-n so the white-space
       override wins on equal specificity; the colour still comes from there. */
    .tph-stat-wrap { white-space: normal !important; }
    /* The recent-form figure, shown beside the lifetime one. Declares its own
       colour so it does NOT pick up the .tph-dev-* deviation shading on the
       parent cell — that shading is computed from the lifetime figure, and
       letting it bleed onto the recent number would assert a verdict about a
       number it was not calculated from. */
    .tph-stat-rec { color: #8ec5f0 !important; font-size: 11px; font-weight: 600; }
    /* The trend sparklines' V/P labels — same blue/amber as the two polylines
       they sit beside, so the label and the line read as one thing without a
       separate legend. .tph-sparkline itself needs no colour declared: its
       stroke colour is set inline per SVG, and SVG stroke doesn't read the
       CSS colour property pinTextColor forces onto non-tph- elements. */
    .tph-trend-label-v { color: #8ec5f0 !important; font-size: 10px; font-weight: 700; margin-right: 2px; }
    .tph-trend-label-p { color: #f0c674 !important; font-size: 10px; font-weight: 700; margin: 0 2px 0 6px; }
    .tph-sparkline { vertical-align: middle; }
    /* Session-trends chart rows (Trends tab, hero-only) — label / sparkline /
       latest-value, one per metric, stacked. */
    .tph-trend-charts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .tph-trend-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
    .tph-trend-l { width: 82px; flex: 0 0 auto; color: #9fb2c4 !important; }
    .tph-trend-chart { flex: 1 1 auto; }
    .tph-trend-last { width: 40px; flex: 0 0 auto; text-align: right; font-weight: 700; }
    .tph-trend-table { font-size: 11px; }
    .tph-stat-norm { color: #8d959c !important; font-size: 10px; }
    .tph-dev-n { font-size: 10px; opacity: .85; margin-left: 2px; }
    .tph-dev-typical { color: #9fb2c4 !important; }
    .tph-dev-notable { color: #ffc046 !important; }
    .tph-dev-extreme { color: #ff7a4d !important; }
    /* A tinted row makes an outlier findable while scrolling; the value colour
       alone is easy to miss on a phone at arm's length. */
    .tph-row-notable td { background: rgba(255,192,70,.09); }
    .tph-row-extreme td { background: rgba(255,122,77,.14); }
    /* Bar track. FIXED width, not a percentage of the cell — a proportional bar
       is what pushed this table past the screen. 46px is enough to read a
       position against the tick and small enough to sit inline with the number.
       position:relative so the tick can be placed at its own percentage along
       the same 0-100 scale as the fill. */
    .tph-bar { position: relative; display: inline-block; vertical-align: middle;
               width: 46px; height: 7px; margin-right: 5px; border-radius: 3px;
               background: #2f3338; overflow: visible; }
    .tph-bar-fill { display: block; height: 100%; border-radius: 3px; background: #6b7784; }
    .tph-bar-fill.tph-dev-typical { background: #7d8b99; }
    .tph-bar-fill.tph-dev-notable { background: #ffc046; }
    .tph-bar-fill.tph-dev-extreme { background: #ff7a4d; }
    .tph-bar-tick { position: absolute; top: -2px; width: 2px; height: 11px;
                    background: #fff; opacity: .9; margin-left: -1px; }
    .tph-stat-legend { color: #8d959c !important; font-size: 10px; line-height: 1.35;
                       border-bottom: none !important; padding-top: 7px !important; }
    /* Stack this sitting, as one bar rather than three cash rows. The track is
       the low..high range for the CURRENT sitting, the fill ends at now, and
       the pale tick is where they sat down. No overflow:hidden — the now
       marker deliberately overhangs the track, and clipping it at 100% would
       hide it exactly when they are at their high. */
    .tph-stackcell { padding: 5px 2px 7px !important; }
    .tph-stackbar { position: relative; height: 8px; border-radius: 4px;
      background: rgba(255,255,255,.10); margin: 1px 0 4px; }
    .tph-stackbar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px;
      background: linear-gradient(90deg, #2f6f9e, #5aa9e6); }
    .tph-stackbar-start { position: absolute; top: 0; bottom: 0; width: 2px;
      margin-left: -1px; background: rgba(255,255,255,.5); }
    .tph-stackbar-now { position: absolute; top: -2px; bottom: -2px; width: 3px;
      margin-left: -1px; border-radius: 2px; background: #fff; }
    .tph-stackscale { display: flex; justify-content: space-between; align-items: baseline;
      gap: 6px; font-size: 10px; color: #8d959c !important; }
    .tph-stackscale .tph-stack-now { color: #e6ebf0 !important; font-size: 11px; font-weight: 700; }
    .tph-stack-note { font-size: 10px; line-height: 1.35; color: #8d959c !important; margin-top: 3px; }
    /* After .tph-stack-note, so these win on the spans inside it. */
    .tph-stack-down { color: #ff8a5b !important; }
    .tph-stack-up { color: #7ed957 !important; }
    .tph-pool-row td { color: #8d959c !important; font-size: 11px; border-bottom: 1px solid #444; }
    .tph-you { color: #9bd !important; font-size: 9px; margin-left: 4px; border: 1px solid #567;
               border-radius: 3px; padding: 0 3px; vertical-align: middle; }
    .tph-stat-head td { padding-top: 10px !important; color: #c3cad1 !important;
                        border-bottom: 1px solid #444 !important; }
    /* Secondary P/L unit under the primary one. Muted and inheriting the row's
       win/loss colour would be wrong — it is the same figure, so it takes the
       same colour, just quieter. */
    .tph-pl-sub { font-size: 10px; opacity: .7; margin-top: 1px; white-space: nowrap;
                  color: inherit !important; }
    /* Range tab. Every element here declares its own colour — pinTextColor
       skips tph- classes, so anything left unstyled gets darkened by Torn. */
    .tph-range-total { color: #f2f4f6 !important; margin-bottom: 8px; }
    .tph-range-group { margin-bottom: 10px; }
    .tph-range-group b { color: #f2f4f6 !important; }
    .tph-range-note { color: #8d959c !important; font-size: 11px; }
    .tph-range-list { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tph-range-hand { color: #cfe3ff !important; background: #26303a; border: 1px solid #3b4956;
                      border-radius: 3px; padding: 2px 5px; font-size: 12px;
                      font-family: ui-monospace, Menlo, monospace; }
    .tph-range-hand sub { color: #8fa6bd !important; font-size: 9px; margin-left: 1px; }
    /* Exploit plan. Ranked list, tag on the left so the category is scannable. */
    .tph-plan-lead { color: #8d959c !important; font-size: 10px; margin-bottom: 7px; }
    .tph-plan { display: flex; gap: 7px; align-items: flex-start; margin-bottom: 8px;
                padding-bottom: 8px; border-bottom: 1px solid #2a2a2e; }
    .tph-plan-tag { color: #cfe3ff !important; background: #26303a; border: 1px solid #3b4956;
                    border-radius: 3px; padding: 1px 5px; font-size: 10px; flex: 0 0 auto;
                    min-width: 52px; text-align: center; }
    .tph-plan-txt { color: #e6ebf0 !important; font-size: 12px; line-height: 1.4; }
    /* Recent tables, newest first. Wraps rather than scrolling — the panel
       must never scroll sideways. */
    .tph-recent { font-size: 11px; line-height: 1.6; color: #aeb6bd !important; }
    .tph-recent-t { color: #aeb6bd !important; white-space: nowrap; }
    .tph-recent-now { color: #7ee0a6 !important; }
    .tph-recent-ago { color: #8d959c !important; font-size: 9px; margin-left: 3px; }
    .tph-recent-arr { color: #5b646c !important; margin: 0 5px; }
    .tph-ptable { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    .tph-ptable th { text-align: left; opacity: 0.6; font-weight: normal; border-bottom: 1px solid #444; padding: 3px 4px; }
    .tph-ptable td { padding: 6px 4px; border-bottom: 1px solid #2a2a2e; }
    /* th, not tr — a header tap must never fall through to the row-click
       handler below (there is no row here to open), and headers aren't
       inside a .tph-prow anyway so there is nothing to conflict with. */
    .tph-sortable { cursor: pointer; white-space: nowrap; }
    .tph-sortable:active { opacity: 1; }
    .tph-prow { cursor: pointer; }
    .tph-prow:active { background: #2c2c33; }
    /* Hand history was one 11px monospace blob of up to 40 hands run together on
       the panel's own background — nothing separated one hand from the next and
       the focus player was marked only by a "*". Each hand is now its own block
       with its own surface, and their actions are coloured rather than starred. */
    /* Every colour here is explicit and !important, and nothing relies on
       inheritance or opacity. Torn's own page stylesheet is an unknown quantity
       that we are injecting into — a recessed card tinted only slightly darker
       than the panel, with inherited text colour, came out unreadable on the
       real page. A clearly LIGHTER card with pinned foreground colours does not
       depend on winning the cascade. */
    .tph-hh { background: #2a2a33 !important; color: #f2f4f6 !important;
      border: 1px solid #3d3d48; border-left: 3px solid #6b8cae;
      border-radius: 5px; padding: 8px 10px; margin-bottom: 9px; }
    .tph-hh-head { font-size: 11px; color: #a8b2bd !important; margin-bottom: 6px; }
    .tph-hh-row { font-size: 12.5px; line-height: 1.6; color: #f2f4f6 !important; }
    .tph-hh-st { display: inline-block; min-width: 54px; color: #8ec5f0 !important;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .tph-hh-me { color: #ffc94d !important; font-weight: 700; }
    .tph-hh-sd { font-size: 11.5px; color: #d4b3f0 !important; margin-top: 4px; }
    .tph-hh-win { font-size: 12.5px; color: #8ce89a !important; margin-top: 4px; }
    /* Sits right under each history card, not inside .tph-hh itself — the card
       is the RECORD, the button is an action on it, and formatHandHtml (which
       also serves the plain-text clipboard/file exports) stays untouched by
       adding it as a sibling rather than teaching that function about buttons. */
    .tph-hh-wrap { margin-bottom: 4px; }
    .tph-hh-replay { width: 100%; margin: -4px 0 9px; font-size: 11px !important;
      padding: 5px 10px !important; }
    .tph-replay-nav { display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin: 8px 0; }
    .tph-replay-step { color: #dfe5ea !important; font-size: 12px; text-transform: capitalize; }
    .tph-replay-board { color: #f2f4f6 !important; font-size: 14px; margin-bottom: 4px; }
    .tph-replay-hero { color: #dfe5ea !important; font-size: 12.5px; margin-bottom: 8px; }
    .tph-replay-acts { background: #24242b !important; border-radius: 5px; padding: 6px 9px; }
    .tph-replay-act { color: #d5dbe1 !important; font-size: 12.5px; line-height: 1.6; }
    .tph-close { position: absolute; top: 8px; right: 10px; cursor: pointer; }
    .tph-warn { background: #4a2c12 !important; color: #ffd9a0 !important; border: 1px solid #8a5a24;
      border-radius: 5px; padding: 7px 9px; margin: 6px 0 10px; font-size: 12px; line-height: 1.45; }
    .tph-ok { color: #7ed957 !important; font-size: 12px; margin: 2px 0 10px; }
    /* Raised well above the bottom edge so it doesn't sit under Torn PDA's own
       native controls, and still labelled so it's unmistakably OUR button.
       Shrunk from 44px to 32px: it floats permanently over the table, and the
       red-on-white label makes it findable without the size. It keeps its own
       colour and border rather than going icon-only, because those are what
       identify it — an unlabelled grey circle over a poker table is noise. */
    /* touch-action:none so dragging the button doesn't scroll the page under it */
    .tph-gear { position: fixed; z-index: 100000; bottom: 96px; right: 12px; background: #b8342e; color: #fff;
      border: 1px solid #fff; border-radius: 16px; height: 32px; min-width: 32px; padding: 0 9px;
      display: flex; align-items: center; gap: 4px; font: bold 11px/1 -apple-system, sans-serif;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5); cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none; }
    .tph-gear.tph-dragging { cursor: grabbing; opacity: 0.85; }
    /* Storage-full banner. pointer-events:none is NOT optional — it sits over
       the table, and a swallowed tap on Fold is worse than any warning. */
    .tph-storage-warn { position: fixed; z-index: 100001; top: 0; left: 0; right: 0;
      pointer-events: none; background: rgba(150,26,26,0.95); color: #fff !important;
      font: 600 11px/1.4 -apple-system, sans-serif; padding: 5px 8px; text-align: center;
      letter-spacing: 0.2px; }
    .tph-gear.tph-storage-bad { box-shadow: 0 0 0 2px #ffd21e; }
    /* Storage meter in Settings. */
    .tph-storebar { position: relative; height: 8px; border-radius: 4px; margin: 4px 0 3px;
      background: rgba(255,255,255,.10); }
    .tph-storebar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px;
      background: #5aa9e6; }
    .tph-storebar-fill.tph-store-warn { background: #ffc046; }
    .tph-storebar-fill.tph-store-bad { background: #ff5b4d; }
    .tph-store-line { font-size: 10px; line-height: 1.4; color: #8d959c !important; margin: 2px 0; }
    /* After .tph-store-line, so it wins on the same element. */
    .tph-store-warntext { color: #ffc046 !important; }

    /* ── "It's your turn" cues ───────────────────────────────────────────────
       Non-negotiable: pointer-events NONE on the overlay. This sits over the
       whole viewport, and a single missed tap on a fold or call button because
       the HUD swallowed it would be far worse than any cue is good. The HUD is
       advisory; it must never come between you and the table. */
    .tph-turn-glow { position: fixed; inset: 0; z-index: 99998; pointer-events: none; }
    /* Your turn: green and pulsing — act now. */
    .tph-glow-turn { box-shadow: inset 0 0 0 3px #35d07f, inset 0 0 26px rgba(53,208,127,.45);
                     animation: tph-turn-pulse 1.25s ease-in-out infinite; }
    /* Next to act: amber, thinner, and deliberately STATIC. Two pulsing states
       would compete for attention, and this one is a heads-up, not an alarm. */
    .tph-glow-next { box-shadow: inset 0 0 0 2px rgba(255,192,70,.75); }
    @keyframes tph-turn-pulse {
      0%, 100% { opacity: .35; }
      50%      { opacity: 1; }
    }
    /* The gear is the one element always on screen, so it doubles as the cue
       for anyone who has the coach panel collapsed. */
    .tph-gear.tph-turn { background: #1e7d51; animation: tph-turn-pulse 1.25s ease-in-out infinite; }
    .tph-gear.tph-next { background: #7a5a12; }
    .tph-coach-head.tph-turn { background: #1e7d51 !important; }
    /* Second-stage cue: TURN_ESCALATE_MS after the turn cue first lit up, if
       still your turn — reported as wanted after a first cue alone got missed
       with the phone set down or dimmed. Brighter border, wider glow, faster
       pulse; still green, since this never stops being "your turn", it's just
       louder about it now. Declared AFTER .tph-gear.tph-turn/.tph-coach-head.
       tph-turn above so it wins on equal specificity. */
    .tph-glow-turn.tph-glow-escalated { box-shadow: inset 0 0 0 5px #4eff9e, inset 0 0 46px rgba(53,208,127,.7);
                                         animation: tph-turn-pulse 0.6s ease-in-out infinite; }
    .tph-gear.tph-turn-escalated { box-shadow: 0 0 0 3px #4eff9e; }
    .tph-coach-head.tph-turn-escalated { box-shadow: inset 0 0 0 2px #4eff9e; }

    /* Fold misclick guard prompt. Bottom-centre and above everything, but
       pointer-events:none so it can never sit between you and the button you
       are trying to tap a second time. */
    .tph-fold-prompt { position: fixed; z-index: 100001; left: 50%; bottom: 18%;
                       transform: translateX(-50%); pointer-events: none;
                       background: #7a2f12; border: 1px solid #c9762f; border-radius: 8px;
                       padding: 9px 14px; max-width: 84vw; text-align: center;
                       box-shadow: 0 3px 14px rgba(0,0,0,.55);
                       font: 13px/1.35 -apple-system, sans-serif; color: #ffe6c9 !important; }
    .tph-fold-prompt b { color: #fff3e3 !important; display: block; }
    .tph-fold-prompt .tph-fold-sub { color: #e0b48a !important; font-size: 11px;
                                     display: block; margin-top: 2px; }
    /* Respect a user who has asked the OS for less motion — the pulse stays as
       a static highlight rather than disappearing, since it is load-bearing. */
    @media (prefers-reduced-motion: reduce) {
      .tph-turn-glow, .tph-gear.tph-turn { animation: none; opacity: 1; }
    }
    /* Width is capped rather than left/right-anchored so the panel keeps a
       sensible size once dragging switches it to left/top positioning.
       Column flex so that once a height is set by the resize grip, the body is
       what absorbs it and scrolls — the header must stay put, since it carries
       the only drag handle and the Hide button. */
    .tph-coach { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      width: min(420px, calc(100vw - 24px)); background: rgba(20,20,24,0.95);
      color: #cde; border: 1px solid #556; border-radius: 8px; font: 12px/1.4 -apple-system, sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5);
      display: flex; flex-direction: column; overflow: hidden; }
    .tph-coach-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px;
      border-bottom: 1px solid #445; cursor: grab; touch-action: none;
      user-select: none; -webkit-user-select: none; font-weight: 600; color: #9bd;
      flex: 0 0 auto; }
    .tph-coach-head .tph-grip { opacity: 0.5; letter-spacing: 1px; }
    .tph-coach-head .tph-coach-hide { margin-left: auto; cursor: pointer; color: #f88;
      border: 1px solid #a44; border-radius: 4px; padding: 1px 7px; font-weight: 400; }
    .tph-coach.tph-dragging { opacity: 0.85; }
    .tph-coach.tph-dragging .tph-coach-head { cursor: grabbing; }
    .tph-coach-body { padding: 8px; flex: 1 1 auto; min-height: 0;
      overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .tph-coach-body b { color: #fff; }
    /* Between hands. Says the panel is alive rather than leaving a blank box —
       the panel now stays mounted so it can be parked open all session. */
    .tph-coach-idle { color: #8d959c !important; font-style: italic; }
    /* Resize grip, bottom-right. A real element with pointer handlers rather
       than the CSS resize property: the native handle is mouse-only in practice
       and this only ever runs in a touch webview. Sized for a thumb, and its own
       touch-action:none so the drag resizes instead of scrolling the table. */
    .tph-coach-size { position: absolute; right: 0; bottom: 0; width: 24px; height: 24px;
      display: flex; align-items: flex-end; justify-content: flex-end; padding: 2px 3px;
      color: #7e8a99 !important; font: 11px/1 -apple-system, sans-serif;
      cursor: nwse-resize; touch-action: none; user-select: none; -webkit-user-select: none; }
    .tph-coach.tph-sizing { opacity: 0.85; }
    /* touch-action:none so dragging the pill moves it instead of scrolling the
       table underneath — without it the pointermove handler never gets to run. */
    .tph-coach-pill { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      background: rgba(20,20,24,0.95); color: #9bd; border: 1px solid #556; border-radius: 999px;
      padding: 7px 13px; font: 12px/1 -apple-system, sans-serif; cursor: grab;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); touch-action: none;
      user-select: none; -webkit-user-select: none; }
    .tph-coach-pill.tph-dragging { cursor: grabbing; opacity: 0.85; }
    /* The pill carries a live tip, so it has to be able to grow — but capped
       and ellipsised, because it floats over the table and must never become a
       banner. */
    .tph-coach-pill { max-width: 62vw; white-space: nowrap; overflow: hidden;
                      text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
    .tph-pill-icon { flex: 0 0 auto; font-size: 13px; line-height: 1; color: #e6ebf0 !important; }
    .tph-pill-tag { color: #9bd !important; font-weight: 600; flex: 0 0 auto; }
    .tph-pill-tip { color: #e6ebf0 !important; overflow: hidden; text-overflow: ellipsis; }
    .tph-calib { position: fixed; z-index: 99999; top: 4px; left: 4px; right: 4px; max-height: 62%; overflow-y: auto;
      background: rgba(10,10,10,0.97); color: #9f9; border: 1px solid #494; border-radius: 6px; padding: 8px;
      font: 10px/1.3 monospace; }
    .tph-calib .tph-calib-off { float: right; color: #f88; border: 1px solid #a44; border-radius: 4px;
      padding: 1px 5px; margin-left: 6px; cursor: pointer; }
    .tph-calib button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 5px 9px; margin: 4px 4px 4px 0; font: 11px -apple-system, sans-serif; cursor: pointer; }
    .tph-calib-out { width: 100%; height: 150px; background: #000; color: #9f9; border: 1px solid #494;
      font: 9px/1.25 monospace; white-space: pre; }
  `;

  // Force every unstyled descendant to take the panel's colour, inline and
  // !important.
  //
  // `.tph-panel { color: #eee }` only ever reached children by INHERITANCE, and
  // inheritance loses to any direct rule on the child — no !important required.
  // Torn styles bare `td` and `pre`, so the Stats table and the Report text
  // rendered dark-on-dark while the panel title and tab labels (which Torn has
  // no rule for) looked fine. That is why this presented as "only the history is
  // broken": it was every table and pre in every panel.
  //
  // Elements carrying one of our own tph- classes are skipped, so deliberate
  // colours (warnings, the history cards, winner lines) are preserved.
  function pinTextColor(root) {
    if (!root) return;
    root.querySelectorAll('td, th, pre, p, li, b, i, u, small, label, span, div').forEach((el) => {
      if (el.style && el.style.color) return;                     // already explicit
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('tph-') !== -1) return;                     // ours, already styled
      el.style.setProperty('color', 'inherit', 'important');
    });
  }

  // Mount or tear down one floating panel. Every panel in the HUD goes through
  // here; nothing else should be creating `.tph-panel` elements by hand.
  //
  // Two invariants it exists to enforce, both of which were broken by the
  // hand-written copies this replaced:
  //
  // 1. Removal is scoped to the panel's OWN marker class, never the shared
  //    `.tph-panel` base. renderPlayerPanel used to remove `.tph-panel`, which
  //    also matched the players list and the settings panel — so opening a
  //    player panel over Settings deleted it from the DOM while `settingsOpen`
  //    stayed true, and the next gear tap toggled the flag back to false and
  //    appeared to do nothing. The marker is required, so that can't recur.
  //
  // 2. pinTextColor runs AFTER wire(), because it has to walk content that
  //    wire() adds. Torn styles bare `td` and `pre`, so anything mounted after
  //    the colour walk renders dark-on-dark — the v0.18.2 bug. Callers that
  //    build tab bodies inside wire() get this ordering for free.
  //
  // A backdrop is mounted behind the panel whenever onClose is given, so a tap
  // outside the panel closes it the same way the ✕ does. It is torn down with
  // its OWN marker-derived class (`tph-backdrop-<marker>`), never `.tph-panel`
  // or the bare marker — giving it the marker class directly would make it
  // count toward that marker's "is this panel mounted" checks, which is not
  // what it is.
  //
  // Scroll position survives a close/reopen (or a tab switch) even though
  // renderPanel tears the element down and builds a fresh one every call —
  // reported as the actual friction of the close-to-act cycle: closing the
  // panel to hit fold/call and reopening it a few seconds later dumped you
  // back at the top of a long Stats/Trends/History view, so studying a
  // player cost a re-scroll on every single interruption, not just a
  // re-open. Keyed by `scrollKey` (defaults to the marker) rather than the
  // element itself, since the element is always a new one; a panel that
  // shows more than one "document" under one marker (the player panel shows
  // a different player/tab combination each time) passes a finer key so
  // switching player or tab starts that combination at the top rather than
  // inheriting some other view's position. Plain JS state, not STORE — this
  // only needs to survive within the running page, not a reload.
  let panelScrollMemory = {};

  // opts: { marker, open, html, onClose, wire, scrollKey }
  // Returns the panel element, or null when `open` is false.
  function renderPanel(opts) {
    document.querySelectorAll('.' + opts.marker).forEach((el) => {
      if (el.dataset.scrollKey) panelScrollMemory[el.dataset.scrollKey] = el.scrollTop;
      el.remove();
    });
    document.querySelectorAll('.tph-backdrop-' + opts.marker).forEach((el) => el.remove());
    if (!opts.open) return null;

    if (opts.onClose) {
      const backdrop = document.createElement('div');
      backdrop.className = 'tph-panel-backdrop tph-backdrop-' + opts.marker;
      // The backdrop closes on a tap that STARTED on it, not on any click that
      // happens to land on it.
      //
      // v1.49.0 made the departure pill draggable, which moved its open from a
      // `click` handler to makeDraggable's `pointerup`. That opened the panel
      // BEFORE the browser dispatched the tap's compatibility click — so the
      // backdrop, freshly mounted under the finger, received that click and
      // closed the panel instantly. Reported as "the pill can be moved around
      // but can't open". The old click handler never hit it, because the
      // backdrop did not exist when that event's propagation path was computed.
      //
      // Arming on pointerdown fixes the whole class rather than this one pill:
      // any control that opens a panel from a pointer event is otherwise
      // swallowed the same way, and a real outside tap always starts on the
      // backdrop.
      let armed = false;
      backdrop.addEventListener('pointerdown', () => { armed = true; });
      backdrop.addEventListener('click', (e) => {
        if (!armed) return;
        armed = false;
        opts.onClose(e);
      });
      document.body.appendChild(backdrop);
    }

    const panel = document.createElement('div');
    panel.className = 'tph-panel ' + opts.marker;
    panel.innerHTML = opts.html;
    document.body.appendChild(panel);

    const close = panel.querySelector('.tph-close');
    if (close && opts.onClose) close.addEventListener('click', opts.onClose);
    if (opts.wire) opts.wire(panel);

    // Content built inside wire() (the player panel's tab body) is what
    // actually determines scroll height, so this has to run after wire(),
    // not before — restoring against the empty shell would just clamp to 0.
    const scrollKey = opts.scrollKey || opts.marker;
    panel.dataset.scrollKey = scrollKey;
    panel.scrollTop = panelScrollMemory[scrollKey] || 0;

    pinTextColor(panel);
    return panel;
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Coalesce bursts of scroll/resize events into a single reposition per frame,
  // so dragging the table around doesn't tear down and rebuild every badge
  // dozens of times a second.
  let badgeFrameQueued = false;
  function scheduleBadgeRender() {
    if (badgeFrameQueued) return;
    badgeFrameQueued = true;
    requestAnimationFrame(() => { badgeFrameQueued = false; renderBadges(); });
  }

  // Roughly the badge's own height, used to keep it inside the viewport when a
  // seat sits right at the bottom edge.
  const BADGE_HEIGHT_PX = 14;

  // How far hero's own badge is lifted above where every other badge sits.
  // Five badge-lines: four cleared the name plate but still landed on the chip
  // figure, reported from a live table. Hero's seat is the crowded
  // one — it carries the hole cards, the stack and whatever Torn draws around
  // the acting seat — so the space that is empty on an opponent's seat is not
  // empty on yours, and the badge was landing on top of that furniture.
  const SELF_BADGE_LIFT_PX = 5 * BADGE_HEIGHT_PX;

  // Nudges off the lifted position above, reported from a live table: at the
  // full lift the badge sat over the action timer. ~10 characters right (at
  // the badge's own 10px font) clears the timer horizontally; down moved in
  // two steps — half a badge-line first (v1.7.0), then one more full line
  // (v1.14.0, "cover the name and nothing else") once that half-line still
  // left it floating over empty felt above the name rather than on it.
  const SELF_BADGE_DOWN_NUDGE_PX = 1.5 * BADGE_HEIGHT_PX;
  const SELF_BADGE_RIGHT_NUDGE_PX = 60;

  // One place each, so the badge tooltip, the players list, the Stats tab and
  // the coach all describe these the same way.
  function tiltText(t) {
    return `🤮 Tilting — playing ${t.jump.toFixed(0)}pp looser than their own norm `
      + `over the last ${t.hands} hands`
      + (t.sinceBigLoss != null
        ? `, and lost a big pot ${t.sinceBigLoss === 0 ? 'just now' : t.sinceBigLoss + ' hand(s) ago'}.`
        : '.');
  }

  function heatText(h) {
    return `🔥 Running hot — won ${h.won} of the last ${h.hands} hands (${h.winPct.toFixed(0)}%).`;
  }

  // --- "It's your turn" cues -------------------------------------------------
  //
  // On a phone the table is small and the action buttons are easy to miss,
  // especially with the coach panel collapsed. Three cues, all passive:
  // a pulsing border around the viewport, the gear turning green, and the coach
  // header doing the same.
  //
  // Turn detection is findTurnButtons(), NOT findActionButtons(): Torn shows
  // pre-action controls ("Check / Fold", "Call Any / Check") while you are
  // WAITING, and cueing on those would leave the screen glowing for most of the
  // hand — which is the same as no cue at all.
  let turnCueActive = false;
  // When the CURRENT turn-cue rising edge fired, and whether the escalation
  // (see TURN_ESCALATE_MS below) has already fired for it. Both reset on the
  // next rising edge, not on the falling edge — there is nothing to reset TO
  // between hands, and resetting here would just be dead code that runs once
  // per hand for no reason.
  let turnCueSince = 0;
  let turnCueEscalated = false;

  // How long you can sit on your own turn before the cue intensifies. A
  // second, more insistent signal at this point catches a phone that's been
  // set down or dimmed since the first one — reported as wanted after the
  // base cue alone was missed at the table. Not a repeating alarm: exactly
  // one escalation per turn, matching what was actually asked for.
  const TURN_ESCALATE_MS = 10000;

  // A short chime, synthesised rather than loaded. No asset to host, nothing to
  // fetch, and nothing for Torn PDA's webview to block.
  //
  // Browsers refuse to start audio until the user has interacted with the page,
  // so the context is created lazily and primed on the first tap anywhere —
  // see primeAudio(). Without that the first chime of a session is silently
  // dropped, which reads as "the setting doesn't work".
  let audioCtx = null;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (e) { return null; }
    return audioCtx;
  }

  // Shared note-scheduler behind both chimes below — pulled out so the
  // escalation chime is a different NOTE SEQUENCE, not a duplicated copy of
  // the oscillator/gain wiring with one array literal changed.
  function playChimeNotes(notes) {
    const ctx = ensureAudio();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    notes.forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Ramps rather than steps: an instant gain change clicks audibly.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.10);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.12);
    });
    return true;
  }

  function playTurnChime() {
    // Two short rising notes — distinct from Torn's own sounds, and quiet
    // enough not to be startling if the phone is by your ear.
    return playChimeNotes([[880, 0], [1320, 0.11]]);
  }

  // Fires once, TURN_ESCALATE_MS after playTurnChime, if it is STILL your
  // turn — see renderTurnCue. The same rising two-note shape repeated twice
  // back to back reads as more urgent without switching to an unfamiliar
  // sound that would need its own "what was that?" moment to place.
  function playTurnEscalationChime() {
    return playChimeNotes([[880, 0], [1320, 0.11], [880, 0.28], [1320, 0.39]]);
  }

  // Satisfy the autoplay policy using a tap the user was making anyway.
  function primeAudio() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // --- Fold misclick guard ---------------------------------------------------
  //
  // The one place friction is worth adding: folding is irreversible, the button
  // sits next to Call, and a phone screen is small. Tap once to arm, tap again
  // to fold.
  //
  // Deliberate design limits, because this is the only code in the HUD that
  // touches the game's own controls:
  //
  // - It NEVER folds for you. There is no synthetic click anywhere here; the
  //   second tap is your real tap, passed through untouched. The HUD stays
  //   advisory.
  // - It fails OPEN. Any error, any unrecognised button, and the click goes
  //   through as normal. A guard that swallowed a fold would be far worse than
  //   no guard.
  // - Missing the window costs nothing. Torn folds you on timeout anyway, so
  //   the worst case of hesitating is the outcome you were choosing regardless.
  const FOLD_ARM_MS = 4000;      // how long the confirm stays live
  const FOLD_MIN_GAP_MS = 250;   // a second tap sooner than this is a double-fire

  let foldArmedAt = 0;

  function isFoldControl(el) {
    if (!el || el.closest('[class^="tph-"], [class*=" tph-"]')) return false; // our own UI
    const btn = el.closest('button, [role="button"]');
    if (!btn) return null; // not a control at all
    const text = (btn.textContent || '').trim();
    if (!text || text.length >= ACTION_BTN_MAX_LEN) return false;
    // Matches "Fold" and also "Check / Fold" — a misclicked pre-action fold
    // still folds the hand, just later.
    return /\bfold\b/i.test(text) ? btn : false;
  }

  function foldGuardHandler(e) {
    try {
      if (!STORE.settings.foldGuard) return;
      const btn = isFoldControl(e.target);
      if (!btn) return;

      const now = Date.now();
      const elapsed = now - foldArmedAt;

      // Armed, and this is a deliberate second tap — let the real click through.
      if (foldArmedAt && elapsed >= FOLD_MIN_GAP_MS && elapsed <= FOLD_ARM_MS) {
        foldArmedAt = 0;
        hideFoldPrompt();
        return;
      }
      // A second tap inside FOLD_MIN_GAP_MS is a fat-finger double-fire, not a
      // confirmation. Swallow it and keep the window open.
      if (foldArmedAt && elapsed < FOLD_MIN_GAP_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // First tap: block it and arm.
      e.preventDefault();
      e.stopPropagation();
      foldArmedAt = now;
      showFoldPrompt(btn);
      setTimeout(() => {
        if (Date.now() - foldArmedAt >= FOLD_ARM_MS) { foldArmedAt = 0; hideFoldPrompt(); }
      }, FOLD_ARM_MS + 50);
    } catch (err) {
      // Fail open, always.
      foldArmedAt = 0;
      console.warn('[TornPokerHUD] fold guard error, passing the click through', err);
    }
  }

  function showFoldPrompt(btn) {
    hideFoldPrompt();
    const el = document.createElement('div');
    el.className = 'tph-fold-prompt';
    const label = (btn.textContent || 'fold').trim();
    el.innerHTML = `<b>Tap “${escapeHtml(label)}” again to confirm</b>`
      + `<span class="tph-fold-sub">misclick guard · expires in ${FOLD_ARM_MS / 1000}s</span>`;
    document.body.appendChild(el);
    pinTextColor(el);
  }

  function hideFoldPrompt() {
    document.querySelectorAll('.tph-fold-prompt').forEach((el) => el.remove());
  }

  // Pure decision, pulled out of renderTurnCue so the timing logic can be
  // tested without a DOM: escalate only on a tick where the cue was ALREADY
  // on (not this tick's own rising edge — that path resets the timer instead,
  // see renderTurnCue), hasn't escalated yet this turn, and has been running
  // at least TURN_ESCALATE_MS.
  function shouldEscalateTurnCue(isOn, wasActive, alreadyEscalated, since, now) {
    return !!(isOn && wasActive && !alreadyEscalated && (now - since) >= TURN_ESCALATE_MS);
  }

  function renderTurnCue() {
    // Two states, deliberately different in strength:
    //   'turn' — green, pulsing. Act now.
    //   'next' — amber, static. You are one seat away; look up.
    // A static "next" cue matters: two pulsing states would compete, and the
    // point of the second one is a heads-up, not an alarm.
    let state = null;
    if (STORE.settings.turnCues) {
      if (isHeroTurn()) state = 'turn';
      else if (STORE.settings.nextToActCue && isHeroNextToAct()) state = 'next';
    }

    const on = state === 'turn';
    // Checked against the OLD turnCueActive, before it is overwritten below.
    const escalateNow = shouldEscalateTurnCue(on, turnCueActive, turnCueEscalated, turnCueSince, Date.now());
    if (escalateNow) turnCueEscalated = true;

    const existing = document.querySelector('.tph-turn-glow');
    if (state) {
      const el = existing || document.createElement('div');
      el.className = 'tph-turn-glow tph-glow-' + state
        + (state === 'turn' && turnCueEscalated ? ' tph-glow-escalated' : '');
      if (!existing) document.body.appendChild(el);
    } else if (existing) {
      existing.remove();
    }

    const gear = document.querySelector('.tph-gear');
    if (gear) {
      gear.classList.toggle('tph-turn', on);
      gear.classList.toggle('tph-next', state === 'next');
      gear.classList.toggle('tph-turn-escalated', on && turnCueEscalated);
    }
    const head = document.querySelector('.tph-coach-head');
    if (head) {
      head.classList.toggle('tph-turn', on);
      head.classList.toggle('tph-turn-escalated', on && turnCueEscalated);
    }

    // Fire once on the rising edge only. A buzz or chime every poll would be
    // unusable, and the poll runs at 400ms.
    if (on && !turnCueActive) {
      turnCueSince = Date.now();
      turnCueEscalated = false;
      if (STORE.settings.turnVibrate && navigator.vibrate) {
        try { navigator.vibrate(120); } catch (e) { /* not supported here */ }
      }
      if (STORE.settings.turnSound) playTurnChime();
    } else if (escalateNow) {
      // Still your turn TURN_ESCALATE_MS later — the same two channels again,
      // stronger, plus tph-glow-escalated above for a phone that's dimmed or
      // been set down since the first cue.
      if (STORE.settings.turnVibrate && navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch (e) { /* not supported here */ }
      }
      if (STORE.settings.turnSound) playTurnEscalationChime();
    }
    turnCueActive = on;
  }

  function roleTagText(tag) {
    if (tag === 'DONK') return 'DONK = led out this street without being the preflop raiser.';
    if (tag === 'RR') return 'RR = raised postflop without being the preflop raiser (check-raise or raise of the c-bet).';
    if (tag === 'PFR') return 'PFR = made the last raise preflop, so they hold the initiative.';
    return `${tag} = made the last preflop raise, a ${tag.replace('B', '')}-bet.`;
  }

  function renderBadges() {
    document.querySelectorAll('.tph-badge').forEach((el) => el.remove());
    if (!STORE.settings.showBadges) return;
    // Computed once for the whole table, not per seat — it walks the action log.
    const roles = STORE.settings.showRoleBadges === false
      ? { pfr: null, tag: null, post: {} } : handRoles(currentHand);
    // Also once per render, not per seat — affiliationFlags compares against
    // every OTHER seated xid, so computing the list once avoids an O(seats²)
    // re-scan of the DOM inside the per-seat loop below.
    const seatedList = Array.from(seatedXids({ includeSittingOut: true }));

    // EVERY layout read happens here, before any write — the two are never
    // interleaved. getBoundingClientRect forces a synchronous reflow whenever
    // the layout is dirty, and appending a badge is exactly what dirties it,
    // so measuring and appending inside one loop made every seat pay for a
    // full page reflow. At nine seats that was nine forced layouts per render
    // — and renderBadges is rAF-driven on scroll, so nine per FRAME while the
    // table moved. That made it the worst scroll-jank offender in the file.
    const measured = [];
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid) return;
      // Hero's own seat is badged too. It used to be skipped, which made sense
      // only while heroXid was broken and hero was being tracked as their own
      // opponent — the badge would have been wrong. With identity resolved it
      // is the most useful badge on the table: your own V/P/A, your archetype,
      // and 🤮/🔥 where you are already looking, rather than only in the coach.
      const isSelf = isHeroRecord(xid);
      if (isSelf && !STORE.settings.showSelfBadge) return;
      const rect = seat.getBoundingClientRect();
      if (!rect.width && !rect.height) return; // seat not laid out (empty/hidden)
      measured.push({ xid, isSelf, rect });
    });

    // Built into a fragment and attached in ONE write, so the badges cost a
    // single layout between them rather than one apiece.
    const frag = document.createDocumentFragment();
    measured.forEach(({ xid, isSelf, rect }) => {
      const player = STORE.players[xid];
      // This-hand role marker. A player can't be both, since handRoles skips the
      // preflop raiser when it looks at postflop aggression.
      const roleTag = roles.pfr === xid ? roles.tag : (roles.post[xid] || null);
      const badge = document.createElement('div');
      badge.className = 'tph-badge' + (isSelf ? ' tph-badge-self' : '')
        + (roleTag ? ' tph-badge-wide' : '');
      // Below the seat — i.e. under the name and chip stack — rather than over
      // the top of it. Clamped so a bottom-row seat doesn't push it off screen.
      // Hero's own badge is the exception: it is lifted SELF_BADGE_LIFT_PX so it
      // sits ABOVE the name rather than under it. See the constant for why your
      // seat needs that and an opponent's doesn't.
      const maxTop = Math.max(0, window.innerHeight - BADGE_HEIGHT_PX);
      const top = rect.bottom + 1
        - (isSelf ? SELF_BADGE_LIFT_PX - SELF_BADGE_DOWN_NUDGE_PX : 0);
      badge.style.top = Math.min(Math.max(0, top), maxTop) + 'px';
      if (isSelf) {
        // Centred on the seat rather than left-aligned, so it sits over the
        // chip pile instead of hanging off toward the edge. translateX(-50%)
        // does the centring because the badge's own width isn't known until it
        // is in the DOM. SELF_BADGE_RIGHT_NUDGE_PX shifts off that centre —
        // see the constant, this is what clears the action timer.
        badge.style.left = Math.max(0, rect.left + rect.width / 2
          + SELF_BADGE_RIGHT_NUDGE_PX) + 'px';
        badge.style.transform = 'translateX(-50%)';
      } else {
        badge.style.left = Math.max(0, rect.left) + 'px';
      }
      const label = player ? classify(player) : 'Unrated';
      // In session mode V and P are the last `sessionWindow` hands blended
      // toward the player's own baseline — how they are playing NOW, weighted
      // by how much of "now" has actually been seen. There is no longer a
      // threshold at which the badge switches source: a one-hand window reads
      // as their baseline and walks toward the window's own figure as it fills.
      const sess = player && STORE.settings.badgeMode === 'session'
        ? blendedRates(player, STORE.settings.sessionWindow || 15) : null;
      const useSession = !!sess;
      const r = player ? computeRates(player) : {};
      const shown = useSession ? sess : r;
      // 🤮 tilting — playing far looser than their own norm.
      // 🔥 running hot — winning far more pots than the seat count makes likely.
      // Different questions, so both can be true at once: a player can be
      // steaming AND getting there.
      const tilt = player ? tiltRead(player) : null;
      const heat = player ? heatRead(player) : null;
      // 🔗 shares a faction, 💍 married — with another player CURRENTLY seated
      // here, never a stored relationship. Empty for both when no Torn API key
      // is configured, so this is a pure no-op absent that setting.
      const affil = affiliationFlags(xid, seatedList);
      // 🏥 hospital, 🚔 jail, ✈️ travelling — whatever is BLOCKING an attack on
      // this seat. Empty for hero (never fetched) and for anyone with no Torn
      // API key configured, so this is a pure no-op absent that setting.
      //
      // NO LONGER gated on sittingOut. It was, on the reasoning that the cache
      // went stale for a seat back in the hand — but the fetch is no longer
      // scoped to sitting-out seats either (see refreshSeatedTargetStatus), so
      // every seated opponent now carries a reading at most TARGET_REFRESH_MS
      // old and there is nothing stale to hide. The old pair of gates between
      // them meant the feature showed nothing almost all of the time.
      //
      // Only BLOCKERS get a badge glyph, never a positive "attackable" mark.
      // Most players are attackable, so a 🎯 on nearly every seat is noise,
      // and the badge is width-constrained before it is
      // information-constrained. Absence means "nothing known to be blocking";
      // the panel is where that gets stated properly, one tap away.
      const hosp = !isSelf ? targetStatusFor(xid) : null;
      const readiness = hosp ? attackReadiness(hosp) : null;
      const blockedBadge = readiness && readiness.blocked ? readiness : null;
      // Always show a TYPE, never just a hand count. Below minHands `classify`
      // returns "Unrated", which told you nothing about the player — the read is
      // the point of the badge. Show the provisional archetype with a "?" so it
      // is visibly not yet trustworthy, and keep the numbers alongside it.
      const hands = player ? player.hands : 0;
      const type = hands === 0 ? 'NEW'
        : (label === 'Unrated' ? shortType(classifyProvisional(player)) + '?' : shortType(label));
      // Numbers are LABELLED rather than slash-separated. "74/12/16" is three
      // unexplained figures on a badge with no room for a legend, and the count
      // used to change between session and lifetime mode — two numbers or three
      // depending on a setting, which is worse than either.
      //
      // But the SPACES are gone: "V35P23A67" instead of "V35 P23 A67". The
      // letters already delimit the groups, so the spaces bought nothing and
      // cost ~6px each on an element that floats over the table — a badge wide
      // enough to reach the community cards is worse than one that's dense.
      // Same reason the "15h" window marker moved to the tooltip: it says how
      // much is behind V and P, which matters when you interrogate the badge,
      // not while you are scanning six of them.
      //
      // V and P follow the selected window. A (postflop aggression) is always
      // LIFETIME: postflop samples are scarce, so a 15-hand window would be
      // mostly noise.
      // The role marker leads, and is shown even for an unseen player: someone
      // you have never met who has just 3-bet is exactly the seat you need
      // flagged, and "NEW" alone doesn't say that.
      const roleHtml = roleTag
        ? `<span class="tph-badge-role ${roles.post[xid] ? 'tph-role-post' : 'tph-role-pre'}">${roleTag}</span>`
        : '';
      // The numbers are the widest part and the first thing to go when the badge
      // still won't fit — Settings → "Numbers on seat labels". Type, role and
      // the state emoji survive, because those are the read; V/P/A are the
      // evidence for it and are one tap away in the Stats tab.
      const statsHtml = STORE.settings.badgeStats === false ? ''
        : `<span class="tph-badge-dim">V${badgePct(shown.vpip)}`
          + `P${badgePct(shown.pfr)}A${badgePct(r.afq)}</span>`;
      // Appended outside the hands===0 branch: a faction/marriage match is a
      // real read even before a single hand has been tracked on this player.
      const affilHtml = affil.flags ? `<span class="tph-badge-affil">${affil.flags}</span>` : '';
      const hospHtml = blockedBadge ? `<span class="tph-badge-hosp">${blockedBadge.emoji}</span>` : '';
      badge.innerHTML = (hands === 0
        ? `${roleHtml}${hospHtml}<b>NEW</b>`
        : roleHtml
          + hospHtml
          + `${tilt ? '<span class="tph-badge-tilt">🤮</span>' : ''}`
          + `${heat ? '<span class="tph-badge-heat">🔥</span>' : ''}<b>${type}</b>`
          + statsHtml)
        + affilHtml;
      badge.title = `${isSelf ? 'You' : playerDisplayName(xid)} — ${hands} hand(s) seen. `
        + (roleTag ? roleTagText(roleTag) + ' ' : '')
        + 'V = VPIP (hands played), P = PFR (raised preflop), A = AFq (postflop aggression). '
        + (useSession
          ? `V and P are the last ${sess.hands} hands (observed V${fmtNum(sess.rawVpip)} P${fmtNum(sess.rawPfr)}) `
            + `weighted against their own baseline (V${fmtNum(sess.baseVpip)} P${fmtNum(sess.basePfr)}), `
            + 'so a thin window reads close to the baseline and moves as it fills. A is lifetime. '
            + `Lifetime V${fmtNum(r.vpip)} P${fmtNum(r.pfr)}. `
            + 'The TYPE is lifetime — 🤮 is what flags them playing off-type right now.'
          : 'All lifetime.')
        + (label === 'Unrated' && hands > 0 ? ` "?" = provisional, under the ${STORE.settings.minHands}-hand minimum.` : '')
        + (tilt ? ` ${tiltText(tilt)}` : '')
        + (heat ? ` ${heatText(heat)}` : '')
        + (player && player.stack
          ? ` Stack ${fmtMoney(player.stack.now)} (sitting low ${fmtMoney(player.stack.low)}, high ${fmtMoney(player.stack.high)}).`
          : '')
        + (affil.detail ? ` ⚠ ${affil.detail} — a fact from Torn's own profile data, not proof of anything at this table.` : '')
        + (blockedBadge ? ` ${blockedBadge.emoji} Can't attack — ${blockedBadge.label}`
          + (blockedBadge.until ? `, ${fmtStatusRemaining(blockedBadge.until)} left` : '') + '.' : '')
        + ' Tap for full stats.';
      badge.addEventListener('click', () => openPlayerPanel(xid));
      frag.appendChild(badge);
    });
    document.body.appendChild(frag);
  }

  // How much of the coach panel must stay on screen while dragging. The panel is
  // nearly viewport-width on a phone, so it has to be allowed to hang off the
  // edges — otherwise there is nowhere for it to go. 100px keeps enough of the
  // header grabbable to drag it back.
  const COACH_KEEP_VISIBLE_PX = 100;

  // The pill is small enough to keep whole on screen, so no allowance is needed
  // beyond the default — named for symmetry with the panel above.
  const PILL_KEEP_VISIBLE_PX = 0;

  // Floors for the resize grip. Below these the panel stops being a panel: the
  // header alone is about 26px, and under ~170px wide the advice lines wrap to
  // one or two words each and become unreadable rather than merely small.
  const COACH_MIN_W = 170;
  const COACH_MIN_H = 76;

  function setCoachHidden(hidden) {
    STORE.settings.coachHidden = hidden;
    saveStore();
    renderCoachPanel();
  }

  function renderCoachPanel() {
    let el = document.querySelector('.tph-coach');
    let pill = document.querySelector('.tph-coach-pill');
    const advice = buildCoachAdvice();
    // buildCoachAdvice() returns null in two situations it cannot tell apart:
    // no hand in progress, OR hero is out of the current one — folded, so the
    // hole cards it reads off the seat are gone, and it is nobody's decision to
    // advise on. The idle line therefore can't claim "next hand" is coming; it
    // says only that there is nothing to advise right now, which is true either
    // way. (An earlier version of this line said "Waiting for the next hand" —
    // wrong on every hand hero folds early, which is most of them.)
    //
    // The panel used to be torn down entirely whenever advice was empty, which
    // meant it vanished and reappeared several times a minute — you cannot park
    // something on screen that keeps leaving. It now stays mounted and shows
    // this line instead. The reason for the original teardown still holds and
    // is honoured: what must never happen is STALE advice sitting there looking
    // current, and a neutral idle line is not that.
    const idle = !advice || advice.length === 0;

    if (STORE.settings.coachHidden) {
      if (el) el.remove();
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'tph-coach-pill';
        document.body.appendChild(pill);
        applyStoredPos(pill, 'coachPillPos', PILL_KEEP_VISIBLE_PX);
        // The expanded panel was draggable and the collapsed pill was not — it
        // only had a click handler, so there was no way to get it off whatever
        // it was covering. Tap still expands; makeDraggable's threshold keeps a
        // slightly-imprecise tap from being read as a drag.
        makeDraggable(pill, {
          onTap: () => setCoachHidden(false),
          posKey: 'coachPillPos',
          keepVisiblePx: PILL_KEEP_VISIBLE_PX,
        });
      }

      // Refreshed on every render, not just on creation. Collapsed used to mean
      // a static "GTO" label carrying no information at all — the point of
      // collapsing is to reclaim the screen, not to give up the read. The pill
      // now carries the same top exploit tip the expanded panel leads with,
      // shortened to a few words.
      // 📖 is in its own non-shrinking span rather than inside the tag text, so
      // the ellipsis that trims a long tip can never eat the thing that
      // identifies the pill as the coach.
      const icon = '<span class="tph-pill-icon">📖</span>';
      const tip = currentExploitTip();
      if (tip && tip.entry.short) {
        // Provisional is marked with a trailing "?" rather than the word "new":
        // the pill is the most width-starved element in the HUD, and "?" is
        // already this file's convention for a read that is not yet trustworthy
        // (the badge uses it for a provisional archetype). The full caveat, with
        // the hand count, is in the tooltip.
        pill.innerHTML = icon
          + `<span class="tph-pill-tag">${escapeHtml(tip.entry.tag)}${tip.provisional ? '?' : ''}</span>`
          + `<span class="tph-pill-tip">${escapeHtml(tip.entry.short)}</span>`;
        pill.title = `${playerDisplayName(tip.xid)}`
          + (tip.provisional ? ` (new — only ${tip.hands} hand${tip.hands === 1 ? '' : 's'} seen)` : '')
          + ` — ${tip.entry.text} (tap to expand, drag to move)`;
      } else {
        pill.innerHTML = icon + '<span class="tph-pill-tag">Coach</span>';
        pill.title = 'Tap to show the coach — drag to move';
      }
      return;
    }
    if (pill) pill.remove();

    // Build the chrome once. This runs every 1.5s, so rewriting the whole
    // panel's innerHTML would drop the header's drag and hide listeners on
    // every tick and make the panel impossible to move or dismiss.
    if (!el) {
      el = document.createElement('div');
      el.className = 'tph-coach';
      // The footnote is part of the chrome, not the advice, so it is written
      // once and survives the 1.5s advice refresh. "Baseline" replaced "GTO
      // baseline" throughout for the same reason it exists: these are reference
      // charts calibrated to published opening frequencies, not solver output,
      // and the old wording claimed the authority of an equilibrium solution.
      // No footnote. It was four lines of standing disclaimer read once and
      // ignored forever, on a panel that has to be scanned mid-decision. The
      // honesty it carried now rides inline where it applies and costs a word:
      // "Baseline" (never "GTO") on the chart lines, "Eq vs random" on equity,
      // and the ⚠ short-stack note when the ~100bb assumption is actually
      // broken — which is the only time that caveat changes anything.
      el.innerHTML = '<div class="tph-coach-head"><span class="tph-grip">⠿</span>'
        + '<span>Coach</span><span class="tph-coach-hide">Hide</span></div>'
        + '<div class="tph-coach-body"></div>'
        + '<div class="tph-coach-size" title="Drag to resize">◢</div>';
      document.body.appendChild(el);

      const head = el.querySelector('.tph-coach-head');
      const hide = el.querySelector('.tph-coach-hide');
      hide.addEventListener('click', (e) => { e.stopPropagation(); setCoachHidden(true); });
      // Drag the whole panel by its header; no tap action, so a stray tap on the
      // bar does nothing rather than firing something unexpected.
      makeDraggable(head, { posKey: 'coachPos', moveEl: el, keepVisiblePx: COACH_KEEP_VISIBLE_PX });
      // Size before position: setFixedPos clamps against the element's own
      // measured width and height, so a stored size has to be on the element
      // before the stored position is judged against the viewport.
      applyStoredSize(el, 'coachSize', COACH_MIN_W, COACH_MIN_H);
      applyStoredPos(el, 'coachPos', COACH_KEEP_VISIBLE_PX);
      makeResizable(el.querySelector('.tph-coach-size'), el, {
        sizeKey: 'coachSize',
        posKey: 'coachPos',
        minW: COACH_MIN_W,
        minH: COACH_MIN_H,
        keepVisiblePx: COACH_KEEP_VISIBLE_PX,
      });
    }

    const coachBody = el.querySelector('.tph-coach-body');
    coachBody.innerHTML = idle
      ? '<div class="tph-coach-idle">No read for this decision.</div>'
      : advice.map((line) => `<div>${line}</div>`).join('');
    pinTextColor(coachBody);
  }

  let openPlayerXid = null;
  let openPlayerTab = 'stats';
  // History tab filter. Defaults to 'notable' — asked for directly after
  // 'played' shipped: the hands worth reading are the ones with a marker, and
  // everything else is scrolling. The empty state names the way out when a
  // player has no notable hands yet, which is what makes this default safe.
  //
  // Session state, not a setting: it is a way of looking at one player right
  // now, not a preference worth persisting.
  let historyFilter = 'notable';
  // Tag chips, ANDed with each other and with the mode above. Session state for
  // the same reason, and NOT reset when the open player changes: "show me the
  // 3-bets" is a question you carry from one seat to the next, and having to
  // re-select it on every panel open is the friction that stops it being used.
  const historyTags = new Set();
  // Survives the panel closing (openPlayerXid itself goes null on close, so
  // it can't answer "is this the same player as before"). Reopening the same
  // player you just closed on — the close-to-act-then-reopen cycle this is
  // for — keeps whatever tab you were reading; opening a DIFFERENT player is
  // still a fresh look and starts back at Stats.
  let lastOpenPlayerXid = null;

  function openPlayerPanel(xid) {
    if (xid !== lastOpenPlayerXid) openPlayerTab = 'stats';
    lastOpenPlayerXid = xid;
    openPlayerXid = xid;
    // Opening someone's panel is a deliberate act — it is exactly the moment
    // their status is wanted. The background refresh only covers players
    // CURRENTLY seated, so without this a panel opened on someone who has left
    // the table would read "not checked" forever. Fires at most once per
    // TARGET_REFRESH_MS per player, and is a no-op with no API key.
    requestTargetStatus(xid);
    renderPlayerPanel();
  }

  // One stat row: label, value, population norm, and a bar with the norm marked.
  //
  // The bar is the point of this — a number next to another number needs
  // reading, a marker to the left or right of a tick is read at a glance.
  //
  // Colour comes from the SHRUNK value while the printed figure stays RAW. A
  // player seen for two hands who played both really did VPIP 100%, and the
  // Stats tab should say so; lighting the row up as "extreme" off two hands
  // would be reading noise as a read.
  //
  // opts.key names the POOL_AVG / POOL_SPREAD entry. Omit it for stats with no
  // published pool figure — they render plain, with no verdict.
  // The "recent" figure shown beside each lifetime stat.
  //
  // Only VPIP and PFR can be windowed at all: `player.recent` stores three bits
  // per hand (folded / played / played-and-raised), so AFq, 3-bet, c-bet, WTSD
  // and the rest have no per-hand record to look back over. Returning null for
  // those is deliberate — the cell then shows nothing, where repeating the
  // lifetime figure in a column headed "recent" would be a quiet lie.
  //
  // Returns the BLENDED figure, not the raw window, so this agrees with the
  // badge in Recent-form mode. A table saying 60 next to a badge saying 40 is a
  // worse failure than a slightly less direct number; the raw observation and
  // the sample size are both in the tooltip.
  function recentStat(p, key) {
    if (!p || (key !== 'vpip' && key !== 'pfr')) return null;
    const sess = blendedRates(p, STORE.settings.sessionWindow || 15);
    if (!sess || !sess.hands) return null;
    const raw = key === 'vpip' ? sess.rawVpip : sess.rawPfr;
    const base = key === 'vpip' ? sess.baseVpip : sess.basePfr;
    return {
      value: key === 'vpip' ? sess.vpip : sess.pfr,
      note: `Last ${sess.hands} hand${sess.hands === 1 ? '' : 's'}: observed ${fmtNum(raw)}, `
        + `weighted against their own baseline ${fmtNum(base)}. `
        + 'Same figure the badge uses in Recent-form mode.',
    };
  }

  function statRow(label, rawValue, shrunkValue, key, recent) {
    const norm = key ? POOL_AVG[key] : null;
    const dev = deviation(shrunkValue, norm, key ? POOL_SPREAD[key] : null);

    const cls = dev ? `tph-dev-${dev.level}` : '';
    const arrow = dev && dev.level !== 'typical' ? (dev.dir === 'up' ? ' ▲' : ' ▼') : '';
    const delta = dev && dev.level !== 'typical'
      ? `<span class="tph-dev-n">${dev.diff > 0 ? '+' : ''}${dev.diff.toFixed(0)}</span>` : '';

    // Bars are drawn on a 0-100 scale, which is the scale every one of these
    // stats already lives on. clamp() keeps a nonsense value inside the track.
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const bar = rawValue == null ? '' : `
      <div class="tph-bar">
        <span class="tph-bar-fill ${cls}" style="width:${clamp(rawValue)}%"></span>
        ${norm != null ? `<i class="tph-bar-tick" style="left:${clamp(norm)}%"></i>` : ''}
      </div>`;

    return `<tr class="${cls ? 'tph-row-' + dev.level : ''}">
      <td class="tph-stat-l">${escapeHtml(label)}</td>
      <td class="tph-stat-v ${cls}"><b>${fmtPct(rawValue)}</b>${arrow}${delta}${
        recent ? ` <span class="tph-stat-rec" title="${escapeHtml(recent.note || '')}">· ${fmtPct(recent.value)}</span>` : ''
      }</td>
      <td class="tph-stat-n">${bar}<span class="tph-stat-norm">${norm != null ? norm.toFixed(0) + '%' : '—'}</span></td>
    </tr>`;
  }

  // What this player has actually turned up with at showdown.
  //
  // This is the only DIRECT evidence of anyone's range in the whole HUD —
  // everything else infers a range from frequencies. It is also the sparsest:
  // showdowns are rare, so this stays honest about sample size rather than
  // drawing a confident-looking grid from four hands.
  //
  // Split by preflop action because "what they raise with" and "what they call
  // with" are different ranges, and averaging them describes neither.
  function buildRangeHtml(p) {
    const all = shownRange(p, 'all');
    if (!all.length) {
      return '<i>No showdowns yet. Fills in when they reveal at showdown.</i>';
    }
    const total = all.reduce((s, e) => s + e.n, 0);

    const group = (mode, title, note) => {
      const rows = shownRange(p, mode);
      if (!rows.length) return '';
      const n = rows.reduce((s, e) => s + e.n, 0);
      return `<div class="tph-range-group"><b>${title}</b> <span class="tph-range-note">${n} showdown${n === 1 ? '' : 's'}${note}</span><div class="tph-range-list">`
        + rows.map((e) => `<span class="tph-range-hand" title="${escapeHtml(e.cls)}: shown ${e.n}×, won ${e.won} of ${e.seen}">`
          + `${escapeHtml(e.cls)}${e.n > 1 ? `<sub>${e.n}</sub>` : ''}</span>`).join('')
        + '</div></div>';
    };

    // Split by RAISE TIER rather than the old raised/called pair. "What they
    // open with" and "what they 3-bet with" are different ranges by a wide
    // margin, and averaging them into one "raised" bucket described neither —
    // the same reasoning that split raised from called in the first place, one
    // level further down.
    //
    // open + 3-bet + 4-bet reconstructs the old "raised" group exactly, so
    // nothing is lost by dropping it.
    return `<div class="tph-range-total">${total} showdown${total === 1 ? '' : 's'}`
      + `${total < 8 ? ' — thin sample' : ''}</div>`
      + group('open', 'Opened the pot', '')
      + group('threebet', '3-bet', '')
      + group('fourbet', '4-bet or more', '')
      + group('limpraise', 'Limp-3bet', ', also counted in 3-bet above')
      + group('called', 'Called / limped', '')
      + `<div class="tph-stat-legend">Showdowns only — a floor on their range, not all of it.
        Tiers come from the raise order within each hand; showdowns recorded before tiers
        were tracked have no tier and read as "Opened".</div>`;
  }

  function renderPlayerPanel() {
    const p = openPlayerXid ? getPlayer(openPlayerXid) : null;
    const r = p ? computeRates(p) : null;          // raw — what was observed
    const s = p ? computeShrunkRates(p) : null;    // sample-adjusted — drives colour
    // Hero's own panel gets the self-facing "Leaks" voice instead of "Exploit"
    // — see buildExploitHtml/buildLeakPlan.
    const isSelf = p ? isHeroRecord(openPlayerXid) : false;
    // Trends is the one tab that isn't always available, and openPlayerTab now
    // PERSISTS across reopens of the same player (v1.25.0). Those two combine
    // badly: isSelf can flip to false under a remembered 'trends' — editing
    // the username in Settings sets heroXid = null to force re-resolution, and
    // isHeroRecord answers false for the ~3s until the watcher re-resolves it.
    // The tab bar would then omit the Trends chip AND every branch of
    // renderPlayerPanelBody's dispatch would miss, leaving the body silently
    // empty: a panel with a header, no active tab and no content, no error.
    // Normalising here (before the scrollKey is built from it) is what keeps
    // the selected tab and the rendered tab from ever disagreeing.
    if (openPlayerTab === 'trends' && !isSelf) openPlayerTab = 'stats';
    renderPanel({
      marker: 'tph-player-panel',
      open: !!openPlayerXid,
      // One marker covers every player and every tab, so the scroll key has
      // to say which of those this render actually is — otherwise reopening
      // a different player, or switching tabs on the same one, would inherit
      // whatever scroll position some other view last left behind.
      scrollKey: 'tph-player-panel:' + openPlayerXid + ':' + openPlayerTab,
      onClose: () => { openPlayerXid = null; renderPlayerPanel(); },
      html: !p ? '' : `
      <span class="tph-close">✕</span>
      <h3><a class="tph-profile-link" href="${profileUrl(openPlayerXid)}"
        target="_blank" rel="noopener">${escapeHtml(p.name)}</a> — ${classify(p)}</h3>
      ${isSelf ? '' : playerTargetLine(openPlayerXid)}
      <!-- Exploit/Leaks sits directly beside Report on purpose: they are the
           two written-out reads on the same player, one ranked and actionable,
           the other prose, and they are read together. Stats and Range are the
           raw numbers those two are derived from, so they lead. -->
      <div class="tph-tabs">
        <div class="tph-tab ${openPlayerTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</div>
        <div class="tph-tab ${openPlayerTab === 'range' ? 'active' : ''}" data-tab="range">Range</div>
        <div class="tph-tab ${openPlayerTab === 'plan' ? 'active' : ''}" data-tab="plan">${isSelf ? 'Leaks' : 'Exploit'}</div>
        <div class="tph-tab ${openPlayerTab === 'report' ? 'active' : ''}" data-tab="report">Report</div>
        <div class="tph-tab ${openPlayerTab === 'history' ? 'active' : ''}" data-tab="history">History</div>
        <div class="tph-tab ${openPlayerTab === 'notes' ? 'active' : ''}" data-tab="notes">Notes</div>
        ${isSelf ? `<div class="tph-tab ${openPlayerTab === 'trends' ? 'active' : ''}" data-tab="trends">Trends</div>` : ''}
      </div>
      <div class="tph-tab-body"></div>
    `,
      wire: (panel) => renderPlayerPanelBody(panel, p, r, s, isSelf),
    });
  }

  // Tab content, built inside renderPanel's wire step so pinTextColor still
  // runs after it — the Stats table and the Report <pre> are exactly the
  // elements Torn's own `td`/`pre` rules would otherwise darken.
  function renderPlayerPanelBody(panel, p, r, s, isSelf) {
    panel.querySelectorAll('.tph-tab').forEach((tab) => {
      tab.addEventListener('click', () => { openPlayerTab = tab.dataset.tab; renderPlayerPanel(); });
    });

    const body = panel.querySelector('.tph-tab-body');
    if (openPlayerTab === 'stats') {
      // Sample behind the sizing median, and the lifetime tally, kept apart:
      // they differ for any record predating v1.21.0 (see betSizeSample), and
      // printing the lifetime figure next to a median drawn from the window
      // is what made "— of pot · 247 bets" possible.
      const szN = betSizeSample(p);
      const szLifetime = p.betSizeCount || 0;
      body.innerHTML = `
        <table class="tph-stats">
          ${(() => {
            // Above the numbers, because a state read changes what you do right
            // now in a way a lifetime average never does.
            const tilt = tiltRead(p);
            const heat = heatRead(p);
            if (!tilt && !heat) return '';
            return '<tr><td colspan="3" class="tph-state-note">'
              + (tilt ? escapeHtml(tiltText(tilt)) : '')
              + (tilt && heat ? '<br>' : '')
              + (heat ? escapeHtml(heatText(heat)) : '')
              + '</td></tr>';
          })()}
          <tr><th>Stat</th><th>Lifetime · recent</th><th>Pool</th></tr>
          <tr><td class="tph-stat-l">Hands</td><td class="tph-stat-v"><b>${p.hands}</b></td><td class="tph-stat-n">${p.hands < STORE.settings.minHands ? '<span class="tph-stat-norm">low</span>' : ''}</td></tr>
          ${statRow('VPIP', r.vpip, s.vpip, 'vpip', recentStat(p, 'vpip'))}
          ${statRow('PFR', r.pfr, s.pfr, 'pfr', recentStat(p, 'pfr'))}
          ${(() => {
            // A shape, not a number: the blended VPIP/PFR figures above say
            // WHERE they are right now, this says whether they got there by
            // drifting up, drifting down, or bouncing around — invisible in
            // any single blended figure. TREND_WINDOW_HANDS-hand windows
            // across p.recent, oldest first.
            const trend = recentTrendPoints(p, TREND_WINDOW_HANDS);
            if (trend.length < 2) return '';
            const vpipSpark = sparklineSvg(trend.map((t) => t.vpip), { width: 58, height: 16, color: '#8ec5f0' });
            const pfrSpark = sparklineSvg(trend.map((t) => t.pfr), { width: 58, height: 16, color: '#f0c674' });
            return `<tr title="Rolling VPIP (blue) and PFR (amber), ${TREND_WINDOW_HANDS} hands per point, `
              + `oldest to newest left to right — the shape of recent play, not just where it is now.">`
              + '<td class="tph-stat-l">Trend</td>'
              + `<td class="tph-stat-v" colspan="2"><span class="tph-trend-label-v">V</span>${vpipSpark}`
              + `<span class="tph-trend-label-p">P</span>${pfrSpark}</td></tr>`;
          })()}
          ${statRow('3-Bet', r.threeBet, s.threeBet, 'threeBet')}
          ${statRow('Fold v 3B', r.foldTo3Bet, s.foldTo3Bet, 'foldTo3Bet')}
          ${statRow('C-Bet', r.cbet, s.cbet, 'cbet')}
          ${statRow('Fold v CB', r.foldToCbet, s.foldToCbet, 'foldToCbet')}
          ${statRow('Limp', r.limpShareOfVpip, s.limpShareOfVpip, 'limpShareOfVpip')}
          <tr title="Limped, then re-raised the SAME hand — the trap line. Almost nobody does this light, so treat it as the strongest preflop signal on the table. Rare by nature, which is why the raw count sits beside the percentage: 2% off three hands and off three hundred are different claims. No pool figure exists for it, so there is no tick and no verdict.">
            <td class="tph-stat-l">Limp-3bet</td>
            <td class="tph-stat-v"><b>${fmtPct(r.limpRaise)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.limpRaiseCount} hand${r.limpRaiseCount === 1 ? '' : 's'}</span></td>
          </tr>
          ${statRow('AFq', r.afq, r.afq, null)}
          <tr title="Postflop re-raise: how often they raise when someone bets into them — check-raises and raises of a c-bet combined, since the log does not say whether they checked first. The denominator is the number of times they actually faced a bet, not hands played.">
            <td class="tph-stat-l">Re-raise</td>
            <td class="tph-stat-v"><b>${fmtPct(r.postflopRR)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.rrSample} faced${r.rrSample > 0 && r.rrSample < 10 ? ', low' : ''}</span></td>
          </tr>
          ${statRow('WTSD', r.wtsd, r.wtsd, null)}
          <tr title="Median bet or raise as a percentage of the pot as it stood BEFORE that bet, over the most recent bets (see legend). 100% is a pot-sized bet. Every bet and raise on every street counts, so it is a sizing habit, not a street-specific one. A median, not an average, so one huge all-in shove does not drag the whole figure with it.">
            <td class="tph-stat-l">Bet size</td>
            <td class="tph-stat-v"><b>${r.medianBetPct != null ? r.medianBetPct.toFixed(0) + '%' : '—'}</b></td>
            <td class="tph-stat-n tph-stat-wrap"><span class="tph-stat-norm">of pot${szN ? ` · ${szN} bet${szN === 1 ? '' : 's'}` : ''}${szN && szN < BET_SIZE_MIN ? ', low' : ''}${szLifetime > szN ? ` · ${szLifetime} lifetime` : ''}</span></td>
          </tr>
          <tr title="Median bet/raise as % of pot, split by what they actually had at showdown: DRAW = no made hand yet but a four-flush or an open/gutshot straight draw on the board; MADE = two pair or better already. Flop and turn only for draw — no draw left to hold on the river. From showdowns only, a floor on their range, same caveat as the Range tab.">
            <td class="tph-stat-l">Size: draw/made</td>
            <td class="tph-stat-v"><b>${fmtPct(r.betDrawPct)}</b> / <b>${fmtPct(r.betMadePct)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.betDrawCount}d · ${r.betMadeCount}m${(r.betDrawCount + r.betMadeCount) < TEXTURE_MIN ? ', low' : ''}</span></td>
          </tr>
          <tr title="Median bet/raise as % of pot when they had NOTHING at showdown (worse than a pair, no draw either) vs when they had two pair+. A lone pair with no draw counts as neither and is excluded from both. From showdowns only, and the BLUFF side specifically is a floor biased low — a bluff good enough to win the pot never reaches a showdown to be counted here.">
            <td class="tph-stat-l">Size: bluff/made</td>
            <td class="tph-stat-v"><b>${fmtPct(r.betBluffPct)}</b> / <b>${fmtPct(r.betMadePct)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.betBluffCount}b · ${r.betMadeCount}m${(r.betBluffCount + r.betMadeCount) < TEXTURE_MIN ? ', low' : ''}</span></td>
          </tr>
          <tr title="Of the times we saw their actual cards after a bet or raise, how often it was worse than a pair with no draw either — genuinely nothing. This is a FLOOR, not their true bluffing rate: a bluff good enough to take the pot uncontested never reaches showdown, so the real rate is at least this, and probably higher.">
            <td class="tph-stat-l">Bluff freq</td>
            <td class="tph-stat-v"><b>${fmtPct(r.bluffRate)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.bluffSample} spot${r.bluffSample === 1 ? '' : 's'}${r.bluffSample < TEXTURE_MIN ? ', low' : ''}</span></td>
          </tr>
          <tr title="How often they check a hand that's already two pair or better instead of betting it — the slowplay/trap rate. From showdowns only, so a small sample is normal; the count is shown beside the percentage for that reason.">
            <td class="tph-stat-l">Slowplay</td>
            <td class="tph-stat-v"><b>${fmtPct(r.trapRate)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${r.trapSample} made-hand spot${r.trapSample === 1 ? '' : 's'}${r.trapSample < TEXTURE_MIN ? ', low' : ''}</span></td>
          </tr>
          <tr><td colspan="3" class="tph-stat-legend">Bet size = median bet/raise as a share of the pot before it, over their last ${BET_SIZE_HISTORY_MAX} sized bets; 100% is pot-sized. A median rather than an average, so a single oversized all-in shove cannot skew it the way it used to.
            Tick = pool average (reference figures, not measured here).
            The blue <span class="tph-stat-rec">· figure</span> is recent form over the last ${STORE.settings.sessionWindow || 15} hands —
            only VPIP and PFR can be windowed, so the rest show lifetime only.
            <b>Bluff freq is a floor, not a rate</b> — it can only see a bluff that got called all the way to
            showdown, so a bluff that WORKED (took the pot uncontested) is invisible to it and the true
            frequency is at least this high.</td></tr>
          <tr class="tph-stat-head"><td colspan="3"><b>By street</b> — aggr / fold</td></tr>
          ${POSTFLOP_STREETS.map((st) => `<tr><td class="tph-stat-l">${st[0].toUpperCase() + st.slice(1)}</td>`
            + `<td class="tph-stat-v">${fmtPct(r.byStreet[st].afq)} / ${fmtPct(r.byStreet[st].foldPct)}</td>`
            + `<td class="tph-stat-n"><span class="tph-stat-norm">${r.byStreet[st].actions} acts</span></td></tr>`).join('')}
          ${(() => {
            // By BOARD texture — how they act on the board in front of them,
            // not on boards in general. Flags overlap by design (a board can be
            // paired AND four-flush), so these rows do NOT sum to the hand
            // count and must not be read as a breakdown.
            //
            // Shows the pool's own observed figure alongside, because a villain
            // sample this thin is hard to judge cold: a four-flush board is
            // rare, so "lead 30%" only means something next to what everyone
            // else does there. The pool column is what this HUD has MEASURED,
            // not a published reference like POOL_AVG's tick marks.
            const pool = poolBoardTexture();
            // Villain's own two figures in the value column, the pool
            // reference in the NOTE column — the same split statRow already
            // uses for every other stat, and the reason this needed fixing:
            // four figures crammed into the 26%-wide nowrap value cell
            // overflowed it and printed over the label column on a narrow
            // screen. Slashes carry no spaces for the same reason the badge
            // sheds them: the separator already delimits.
            const rows = BOARD_FLAGS.map((flag) => {
              const cell = (p.boardTex || {})[flag.key];
              const br = boardTexRates(cell);
              if (!br.leadN && !br.facedN) return '';
              const pr = boardTexRates(pool[flag.key]);
              const dim = Math.max(br.leadN, br.facedN) < BOARD_TEX_MIN ? ' style="opacity:.55"' : '';
              const one = (v) => (v == null ? '—' : v.toFixed(0) + '%');
              const poolTxt = (pr.lead == null && pr.foldToBet == null) ? ''
                : `pool ${one(pr.lead)}/${one(pr.foldToBet)} · `;
              return `<tr title="${escapeHtml(flag.hint)}. Lead = how often they bet when nobody has bet `
                + `yet. Fold = how often they fold when someone bets at them. 'pool' is this HUD's own `
                + `measured average for the same texture. L and F are the two sample counts. Dimmed rows `
                + `are under ${BOARD_TEX_MIN} observations.">`
                + `<td class="tph-stat-l"${dim}>${escapeHtml(flag.label)}</td>`
                + `<td class="tph-stat-v"${dim}>${one(br.lead)}/${one(br.foldToBet)}</td>`
                + `<td class="tph-stat-n tph-stat-wrap"><span class="tph-stat-norm">`
                + `${poolTxt}${br.leadN}L/${br.facedN}F</span></td></tr>`;
            }).filter(Boolean).join('');
            if (!rows) return '';
            return '<tr class="tph-stat-head"><td colspan="3"><b>By board texture</b> — lead/fold</td></tr>'
              + rows
              + `<tr><td colspan="3" class="tph-stat-legend"><b>Lead</b> = how often they bet when nobody has bet into `
              + `them yet. <b>Fold</b> = how often they fold when someone does. Two different situations, so two `
              + `different denominators — the <b>L</b> and <b>F</b> counts beside each row. Flags overlap: a paired `
              + `four-flush board counts toward both, so these rows are not a breakdown and will not sum. `
              + `Dimmed = under ${BOARD_TEX_MIN} observations, shown but not worth acting on. `
              + `<i>pool</i> is this HUD's own measured average for that texture, not a published reference.</td></tr>`;
          })()}
          ${stackBarHtml(p)}
          ${(() => {
            const tabs = tablesPlayed(p);
            const recent = recentTablesOf(p);
            if (!tabs.length && !recent.length) return '';
            let html = '<tr class="tph-stat-head"><td colspan="3"><b>Usually plays</b></td></tr>'
              + tabs.slice(0, 4).map((e) => `<tr><td class="tph-stat-l">${escapeHtml(e.name)}</td>`
                + `<td class="tph-stat-v">${e.share.toFixed(0)}%</td>`
                + `<td class="tph-stat-n"><span class="tph-stat-norm">${e.hands} hands</span></td></tr>`).join('');
            // Where they have been lately, newest first. "Usually plays" is a
            // lifetime share and says nothing about movement — someone who has
            // just come down two stakes is a different proposition from a
            // regular, and only this row shows it.
            if (recent.length) {
              html += '<tr><td class="tph-stat-l">Last seen</td><td colspan="2" class="tph-recent">'
                + recent.map((e, i) => `<span class="tph-recent-t${i === 0 ? ' tph-recent-now' : ''}">`
                  + `${escapeHtml(e.name)}<span class="tph-recent-ago">${escapeHtml(e.ago)}</span></span>`).join('<span class="tph-recent-arr">←</span>')
                + '</td></tr>';
            }
            return html;
          })()}
          ${isHeroRecord(openPlayerXid) ? `
          <tr class="tph-stat-head"><td colspan="3"><b>Your results</b></td></tr>
          <tr>
            <td class="tph-stat-l">Lifetime</td>
            <td class="tph-stat-v" style="color:${STORE.hero.netChips >= 0 ? '#7ed957' : '#ff6b6b'} !important">
              <b>${fmtBB(STORE.hero.netBB)}</b></td>
            <td class="tph-stat-n" style="color:${STORE.hero.netChips >= 0 ? '#7ed957' : '#ff6b6b'} !important">${fmtSignedMoney(STORE.hero.netChips)}</td>
          </tr>
          <tr>
            <td class="tph-stat-l">Win rate</td>
            <td class="tph-stat-v" colspan="2"><b>${fmtBB100(STORE.hero.netBB, STORE.hero.bbHands)}</b></td>
          </tr>
          <tr>
            <td class="tph-stat-l">Session</td>
            <td class="tph-stat-v" style="color:${STORE.session.net >= 0 ? '#7ed957' : '#ff6b6b'} !important">
              <b>${fmtSignedMoney(STORE.session.net)}</b></td>
            <td class="tph-stat-n"><span class="tph-stat-norm">${STORE.session.hands} hands</span></td>
          </tr>
          <tr><td colspan="3" class="tph-stat-legend">The P/L column elsewhere means "your result against
            that player", so it has no meaning here — these are your own totals.</td></tr>
          ` : `
          <tr class="tph-stat-head"><td colspan="3"><b>Your P/L vs them</b></td></tr>
          <tr>
            <td class="tph-stat-l">Result</td>
            <td class="tph-stat-v" style="color:${pl0(p) >= 0 ? '#7ed957' : '#ff6b6b'} !important">
              <b>${fmtBB(p.plBBEst)}</b></td>
            <td class="tph-stat-n" style="color:${pl0(p) >= 0 ? '#7ed957' : '#ff6b6b'} !important">${fmtSignedMoney(p.plChipsEst)}</td>
          </tr>
          ${!p.plBBEst && p.plChipsEst ? '<tr><td colspan="3" class="tph-stat-legend">'
            + 'bb only tracked since v0.23.0.</td></tr>' : ''}
          `}
        </table>
      `;
    } else if (openPlayerTab === 'plan') {
      body.innerHTML = buildExploitHtml(p, isSelf);
    } else if (openPlayerTab === 'range') {
      body.innerHTML = buildRangeHtml(p);
    } else if (openPlayerTab === 'report') {
      // Screen gets the sectioned markup; the clipboard keeps the plain text,
      // both from buildReportSections so they cannot describe the same player
      // two different ways. Same rule the History tab follows.
      //
      // Same three-route export as History and the hand log (v1.54.0) — this
      // tab's Copy button was still on the pre-v1.53.0 off-screen textarea path
      // and would fail on this device the same way History's did.
      body.innerHTML = buildReportHtml(openPlayerXid) + exportActionsHtml('report', '');
      const who = playerDisplayName(openPlayerXid);
      wireExportActions(body, 'report', {
        text: () => buildReport(openPlayerXid),
        fileName: `torn-poker-hud-report-${fileSafeName(who)}-${new Date().toISOString().slice(0, 10)}.txt`,
        subject: `Torn Poker HUD — tendency report for ${who}`,
      });
    } else if (openPlayerTab === 'history') {
      const hands = handsInvolving(openPlayerXid);
      if (!hands.length) {
        body.innerHTML = '<i>No hands recorded with this player yet.</i>';
      } else {
        // Median over EVERY hand with this player, not just the filtered set —
        // otherwise filtering to Notable would recompute the median from
        // already-big pots and immediately stop calling any of them big.
        const pots = hands.map((h) => h.pot || 0).filter((p) => p > 0);
        const ctx = { medianPot: pots.length ? median(pots) : 0 };
        const filtered = filterHandsFor(hands, openPlayerXid, historyFilter, ctx, historyTags);
        const shown = filtered.slice(0, 40);
        const hiddenByFilter = hands.length - filtered.length;
        // Clipboard stays plain text; only the on-screen rendering is markup.
        const text = shown.map((h) => formatHand(h, openPlayerXid)).join('\n\n');
        const chips = Object.keys(HISTORY_FILTERS).map((k) => `<span class="tph-hf${
          historyFilter === k ? ' tph-hf-on' : ''}" data-hf="${k}" title="${
          escapeHtml(HISTORY_FILTERS[k].title)}">${HISTORY_FILTERS[k].label}</span>`).join('');
        // Second row: the tag chips, ANDed. Styled as the tags they select for,
        // so the chip you tap and the marker it matches are recognisably the
        // same thing rather than two vocabularies for one idea.
        //
        // ME is hidden entirely when hero is unresolved. A chip that silently
        // matches nothing is worse than no chip — that is the exact failure
        // heroProblem() exists to stop being silent.
        const tagKeys = HAND_TAG_KEYS.concat(heroUnresolved() ? [] : [HISTORY_TAG_ME]);
        // The chip IS the marker it selects for — same class, same colour —
        // wrapped in a tap target that carries the on/off state. One vocabulary
        // rather than two for the same idea, and it needs no per-key chip CSS.
        const tagChips = tagKeys.map((k) => `<span class="tph-hft${
          historyTags.has(k) ? ' tph-hft-on' : ''}" data-hft="${k}" title="${
          escapeHtml(HISTORY_TAG_TITLES[k] || k)}">`
          + `<span class="tph-hh-tag tph-hh-tag-${k}">${k}</span></span>`).join('');
        // Copy takes what is on screen; Export takes everything. The two buttons
        // say which is which, because "Copy history" quietly giving you 40 of
        // 300 hands is the kind of thing you only notice much later. The count
        // now has a second way to mislead — the filter — so it is stated too.
        body.innerHTML = `<div class="tph-hf-bar">${chips}</div>`
          + `<div class="tph-hf-bar tph-hf-tagbar">${tagChips}`
          + `${historyTags.size ? '<span class="tph-hf tph-hf-clear" data-hft="">clear</span>' : ''}</div>`
          + `<div style="color:#c9d1d9 !important;margin-bottom:8px">${filtered.length} of ${hands.length} hand(s)`
          + `${filtered.length > shown.length ? `, showing ${shown.length}` : ''}`
          + `${hiddenByFilter > 0 ? ` · ${hiddenByFilter} hidden by filter` : ''} — `
          + `<span style="${HH.me}">their name highlighted</span>, `
          + `<span style="${HH_ACT.raise}">raise</span> `
          + `<span style="${HH_ACT.bet}">bet</span> `
          + `<span style="${HH_ACT.call}">call</span> `
          + `<span style="${HH_ACT.check}">check</span> `
          + `<span style="${HH_ACT.fold}">fold</span></div>`
          + (shown.length ? '' : `<i>No hands match this filter. ${
            historyTags.size
              ? 'Every tag has to be present at once — clear one, or drop back to All.'
              : historyFilter === 'notable'
                ? 'Nothing they did here cleared the notable bar yet — try Played or All.'
                : 'They folded or checked down every recorded hand — try All.'}</i>`)
          + shown.map((h, i) => {
            const n = handNotability(h, openPlayerXid, ctx);
            const tagHtml = n.tags.map((t) => `<span class="tph-hh-tag tph-hh-tag-${t.key}" title="${
              escapeHtml(t.title)}">${escapeHtml(t.label)}</span>`).join('');
            return `<div class="tph-hh-wrap${n.notable ? ' tph-hh-notable' : ''}" data-idx="${i}">`
              + (tagHtml ? `<div class="tph-hh-tags">${tagHtml}</div>` : '')
              + formatHandHtml(h, openPlayerXid)
              + '<button class="tph-hh-replay">▶ Replay this hand</button></div>';
          }).join('')
          + (shown.length ? `<button class="tph-copy-hist">Copy shown (${shown.length})</button>` : '')
          + `<div class="tph-exp-lead">All ${hands.length} hand(s) with this player:</div>`
          + exportActionsHtml('hist', `(${hands.length})`);
        body.querySelectorAll('[data-hf]').forEach((chip) => {
          chip.addEventListener('click', () => {
            historyFilter = chip.dataset.hf;
            renderPlayerPanel();
          });
        });
        // Multi-select, so a tap TOGGLES rather than replacing the selection —
        // the whole point of the row. The empty data-hft is the clear chip.
        body.querySelectorAll('[data-hft]').forEach((chip) => {
          chip.addEventListener('click', () => {
            const k = chip.dataset.hft;
            if (!k) historyTags.clear();
            else if (historyTags.has(k)) historyTags.delete(k);
            else historyTags.add(k);
            renderPlayerPanel();
          });
        });
        body.querySelectorAll('.tph-hh-replay').forEach((btn, i) => {
          btn.addEventListener('click', () => openReplayHand(shown[i]));
        });
        // Guarded: the filter can empty the list, and the Copy button is not
        // rendered when there is nothing to copy. An unguarded querySelector
        // here would throw and take the whole tab body down with it.
        const copyBtn = body.querySelector('.tph-copy-hist');
        if (copyBtn) {
          copyBtn.addEventListener('click', async (e) => {
            // Selects into the visible export box rather than an off-screen
            // element — the reason the old one failed on this device. See
            // exportActionsHtml.
            const ok = await copyText(text, body.querySelector('.tph-exp-ta'));
            e.target.textContent = ok ? 'Copied ✓' : 'Copy failed — the box below is selected, copy it by hand';
          });
        }
        // The three routes, shared with Settings — see exportActionsHtml. The
        // export is built lazily: formatHand over every hand with this player
        // is not work to do for a button nobody has pressed.
        const stamp = new Date().toISOString().slice(0, 10);
        const who = playerDisplayName(openPlayerXid);
        wireExportActions(body, 'hist', {
          text: () => playerHistoryExport(openPlayerXid),
          fileName: `torn-poker-hud-history-${fileSafeName(who)}-${stamp}.txt`,
          subject: `Torn Poker HUD — hand history vs ${who}`,
        });
      }
    } else if (openPlayerTab === 'notes') {
      // Set .value (not innerHTML) so a note containing "</textarea>" or other
      // markup is treated as literal text and can't break out of the field.
      body.innerHTML = '<textarea class="tph-notes"></textarea>';
      body.querySelector('.tph-notes').value = p.notes || '';
      body.querySelector('.tph-notes').addEventListener('input', (e) => {
        p.notes = e.target.value;
        saveStore();
      });
    } else if (openPlayerTab === 'trends' && isSelf) {
      body.innerHTML = buildSessionTrendsHtml();
    }
  }

  function renderReportIfOpen() {
    if (openPlayerXid && openPlayerTab === 'report') renderPlayerPanel();
  }

  // Browse every tracked player. Seat badges depend on reading each seat's
  // profile link, which some tables don't render — this list is the reliable
  // way to reach a player's stats, report and history regardless.
  let playersListOpen = false;
  let playersFilter = '';
  // Which column the players table is sorted by, and which way. Defaults
  // match the table's original fixed order (most hands first), so turning
  // this on changed nothing about what a fresh open of the panel shows.
  let playersSortKey = 'hands';
  let playersSortDir = 'desc';

  // The value each row sorts on for a given column — kept separate from the
  // HTML the row renders so a column can sort on something other than what's
  // literally printed (e.g. the combined "VPIP/PFR" cell sorts on VPIP alone,
  // since that's the leading, more comparable of the two figures).
  //
  // Nulls (a stat with no opportunity yet) sort as -Infinity rather than 0 —
  // a player who has never faced a 3-bet is "no data", not "folds 0% of the
  // time", and should land at whichever end of the list means "unknown", not
  // get mixed in among players who genuinely never fold there.
  function playersSortValue(key, xid, p) {
    const r = computeRates(p);
    if (key === 'name') return (p.name || '').toLowerCase();
    if (key === 'type') return classify(p);
    if (key === 'hands') return p.hands || 0;
    if (key === 'vpip') return r.vpip == null ? -Infinity : r.vpip;
    // Hero's own P/L column doesn't show a number at all (see plShort/isHeroRecord
    // below) — sorting hero to the bottom on a numeric sort keeps that row from
    // landing in the middle of real P/L figures under a value nobody can see.
    if (key === 'pl') return isHeroRecord(xid) ? -Infinity : pl0(p);
    return 0;
  }

  // Archetype thresholds hang off POOL_AVG, and POOL_AVG came from a third-party
  // script rather than from anything this HUD measured. Showing both side by
  // side is how that assumption gets checked: if these drift apart over a few
  // hundred hands, POOL_AVG is what needs correcting, and every label with it.
  // P/L sign for colouring. Reads the chip figure, not the bb one: bb only
  // started accruing in 0.23.0, so a player tracked before then has real chip
  // P/L and a zero bb figure, and colouring off bb would show them as flat.
  function pl0(p) { return p.plChipsEst || 0; }

  // Is this record hero's own? Hero accumulates stats exactly like anyone else
  // (dealtInXids includes hero), so the record exists and belongs in the list —
  // it is only the P/L column that means something different for it.
  function isHeroRecord(xid) {
    return !heroUnresolved() && String(xid) === String(heroXid);
  }

  // Both units, stacked: big blinds lead because they are comparable across
  // stakes, chips underneath because that is what is actually sitting in front
  // of you and what the table shows.
  //
  // plBBEst only began accruing in 0.23.0, so a player tracked before that has
  // real chip P/L and a zero bb figure. Printing "+0.0bb" would read as "flat
  // against them" rather than "not measured yet" — so in that case the chip
  // figure is promoted to the top line and no bb figure is shown at all.
  function plShort(p) {
    const chips = fmtSignedMoney(pl0(p));
    const hasBB = p.plBBEst && Math.abs(p.plBBEst) >= 0.05;
    if (!hasBB) return `<b>${chips}</b>`;
    return `<b>${fmtBB(p.plBBEst)}</b><div class="tph-pl-sub">${chips}</div>`;
  }

  // What the coach would actually SAY across the tracked pool, busiest read
  // first.
  //
  // This exists for the same reason observedPoolAverages() does, and it is the
  // same lesson: POOL_AVG sat on borrowed figures for eleven versions until
  // something in the UI reported what this HUD had really seen, and the
  // correction became possible the moment it did. "The coaching advice repeats
  // too much across the player base" is exactly that shape of claim — checkable
  // against the store, and previously unchecked. Tuning the gain ladder or the
  // edge term without this is guessing.
  //
  // Ranked the way the LIVE coach ranks, not by gain: gain plus the edge term.
  // Relevance and fatigue are deliberately absent — both depend on a hand in
  // progress, and this is a question about the player base, not about a spot.
  // So this reports the standing bias in the rule set, which is the thing a
  // tuning pass can act on.
  // Memoised, unlike observedPoolAverages(), and that difference is deliberate
  // rather than inconsistency. Both walk every qualifying player, but this one
  // runs buildExploitPlan per player — computeRates AND computeShrunkRates AND
  // the shown-range scan AND the board-texture loop AND tiltRead, against a
  // store that holds hundreds of records. renderPlayersList() re-renders on
  // every keystroke in the filter box, so an uncached version would put that
  // whole sweep between each letter and each frame, on a phone.
  //
  // A TTL rather than a change-keyed cache because the honest invalidation key
  // does not exist: a player's numbers move without any count this function
  // could watch changing. Thirty seconds of staleness costs nothing here — it
  // is a standing property of the rule set, read while deciding whether to
  // retune, not a live read on the hand in front of you.
  const POOL_TIP_SPREAD_TTL_MS = 30 * 1000;
  let poolTipSpreadCache = null; // { at, value }

  function poolTipSpread() {
    if (poolTipSpreadCache && Date.now() - poolTipSpreadCache.at < POOL_TIP_SPREAD_TTL_MS) {
      return poolTipSpreadCache.value;
    }
    const value = computePoolTipSpread();
    poolTipSpreadCache = { at: Date.now(), value };
    return value;
  }

  function computePoolTipSpread() {
    const ps = poolQualifyingPlayers();
    if (ps.length < 3) return null;
    const counts = new Map();
    let withRead = 0;
    ps.forEach((p) => {
      const plan = buildExploitPlan(p);
      if (!plan.length) return;
      withRead += 1;
      const top = plan.slice().sort((a, b) => tipBaseScore(b) - tipBaseScore(a))[0];
      const label = top.short || top.tag;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    if (!withRead) return null;
    const rows = Array.from(counts.entries())
      .map(([label, n]) => ({ label, n, pct: (100 * n) / withRead }))
      .sort((a, b) => b.n - a.n);
    return { players: ps.length, withRead, distinct: rows.length, rows };
  }

  // Gain plus the edge term — the part of the live score that does not depend
  // on a hand being in progress. Shared so the diagnostic cannot rank by a
  // formula the coach does not use, which would make it a report about
  // something nobody sees.
  function tipBaseScore(entry) {
    const edge = typeof entry.edge === 'number' ? entry.edge : EXPLOIT_EDGE_NEUTRAL;
    return entry.gain + EXPLOIT_EDGE_SPAN * (edge - EXPLOIT_EDGE_NEUTRAL);
  }

  // Top three, with the share of the pool each one is the leading read for. The
  // headline number is the CONCENTRATION — what fraction of your tracked
  // players the single busiest read leads on. That is the figure the complaint
  // is about, and the one to watch after a tuning change.
  function tipSpreadLine() {
    const sp = poolTipSpread();
    if (!sp) return '';
    const top = sp.rows.slice(0, 3)
      .map((r) => `${escapeHtml(r.label)} ${r.pct.toFixed(0)}%`).join(' &nbsp;·&nbsp; ');
    return `<br><b>Coach:</b> ${sp.distinct} distinct lead reads over ${sp.withRead} players `
      + `&nbsp;|&nbsp; ${top}`;
  }

  function poolComparisonLine() {
    const obs = observedPoolAverages();
    if (!obs) return '';
    return `<br><b>Pool:</b> yours ${fmtPct(obs.vpip)}/${fmtPct(obs.pfr)} VPIP/PFR `
      + `over ${obs.players} tracked &nbsp;|&nbsp; assumed `
      + `${POOL_AVG.vpip.toFixed(0)}%/${POOL_AVG.pfr.toFixed(0)}%`;
  }

  // --- Hand replayer panel (v1.17.0) ------------------------------------

  let replayHand = null;
  let replayStepIndex = 0;

  function openReplayHand(h) {
    replayHand = h;
    replayStepIndex = 0;
    renderReplayPanel();
  }

  function renderReplayStepHtml(h, steps, idx) {
    if (!steps.length) {
      return '<span class="tph-close">✕</span><h3>Replay</h3><i>No actions recorded for this hand.</i>';
    }
    const step = steps[idx];
    const raiseLevel = replayPreflopRaiseLevel(steps);
    const eq = replayStepEquity(h, step, raiseLevel);
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const boardText = step.board == null ? 'unknown — recorded before replay support'
      : step.board.length ? cardsGlyphText(step.board) : '—';

    const oppCount = step.live.filter((x) => heroUnresolved() || String(x) !== String(heroXid)).length;
    const heroLine = h.heroCards && h.heroCards.length === 2
      ? `<div class="tph-replay-hero">Your cards: <b>${escapeHtml(cardsGlyphText(h.heroCards))}</b>`
        + (eq != null
          ? ` — equity <b>${eq.toFixed(0)}%</b> (${escapeHtml(equityBasisLabel(raiseLevel))}, ${oppCount} opp)`
          : '') + '</div>'
      : '';

    const actsHtml = step.actions.map((a) => {
      const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
      const isHero = !heroUnresolved() && String(a.x) === String(heroXid);
      const txt = `${escapeHtml(playerDisplayName(a.x))} ${escapeHtml(a.a)}${amt}`;
      return `<div class="tph-replay-act">${isHero ? `<span class="tph-hh-me" style="${HH.me}">${txt}</span>` : txt}</div>`;
    }).join('');

    const isLast = idx === steps.length - 1;
    const endParts = [];
    if (isLast) {
      Object.keys(h.shown || {}).forEach((xid) => {
        endParts.push(`<div class="tph-hh-sd" style="${HH.showdown}">shows ${escapeHtml(playerDisplayName(xid))}: `
          + `${escapeHtml(h.shown[xid])}</div>`);
      });
      (h.winners || []).forEach((w) => {
        endParts.push(`<div class="tph-hh-win" style="${HH.win}">→ ${escapeHtml(playerDisplayName(w.xid))} `
          + `wins ${fmtMoney(w.amount)}</div>`);
      });
    }

    // Pot-per-step is deliberately not shown — see replayStepsFor's own
    // comment: a raise's logged amount is the total bet-to figure, not the
    // increment, so summing it across steps here would overcount.
    const potNote = 'Pot-per-step is not shown — see the note in replayStepsFor.';
    return `<span class="tph-close">✕</span>
      <h3>Replay — ${escapeHtml(when)}</h3>
      <div style="opacity:.7;margin-bottom:8px" title="${escapeHtml(potNote)}">Final pot ${fmtMoney(h.pot)} `
      + `· reached ${escapeHtml(h.street || 'preflop')}</div>
      <div class="tph-replay-nav">
        <button class="tph-replay-prev"${idx === 0 ? ' disabled' : ''}>‹ Prev</button>
        <span class="tph-replay-step">${escapeHtml(step.street)} — step ${idx + 1} of ${steps.length}</span>
        <button class="tph-replay-next"${idx === steps.length - 1 ? ' disabled' : ''}>Next ›</button>
      </div>
      <div class="tph-replay-board">Board: <b>${escapeHtml(boardText)}</b></div>
      ${heroLine}
      <div class="tph-replay-acts">${actsHtml}</div>
      ${endParts.join('')}
    `;
  }

  function renderReplayPanel() {
    const h = replayHand;
    const steps = h ? replayStepsFor(h) : [];
    const idx = steps.length ? Math.max(0, Math.min(replayStepIndex, steps.length - 1)) : 0;
    renderPanel({
      marker: 'tph-replay',
      open: !!h,
      onClose: () => { replayHand = null; renderReplayPanel(); },
      html: !h ? '' : renderReplayStepHtml(h, steps, idx),
      wire: (panel) => {
        const prev = panel.querySelector('.tph-replay-prev');
        const next = panel.querySelector('.tph-replay-next');
        if (prev) prev.addEventListener('click', () => { replayStepIndex = Math.max(0, replayStepIndex - 1); renderReplayPanel(); });
        if (next) {
          next.addEventListener('click', () => {
            replayStepIndex = Math.min(steps.length - 1, replayStepIndex + 1);
            renderReplayPanel();
          });
        }
      },
    });
  }

  // The pill: a count you can see without it covering anything, and a tap
  // target to open the list. Rendered from the same 3s tick, so it appears and
  // disappears with the watch window rather than needing its own timer.
  let departedPanelOpen = false;

  function renderDepartedPill() {
    const existing = document.querySelector('.tph-depart-pill');
    const live = STORE.settings.departureWatch ? departedAlertable() : [];
    if (!live.length || departedPanelOpen) {
      if (existing) existing.remove();
      return;
    }
    const label = `🎯 ${live.length} left`;
    if (existing) {
      if (existing.textContent !== label) existing.textContent = label;
      return;
    }
    const pill = document.createElement('div');
    pill.className = 'tph-depart-pill';
    pill.textContent = label;
    pill.title = 'Players who left the table while attackable. Tap to open, drag to move.';
    document.body.appendChild(pill);
    applyStoredPos(pill, 'departPillPos', PILL_KEEP_VISIBLE_PX);
    // Same treatment the coach pill already got, and for the same reason: it
    // is a fixed-position element floating over the felt, so whatever it lands
    // on is whatever it covers until you can move it. A bare click handler
    // gave no way off. makeDraggable's DRAG_THRESHOLD_PX keeps a slightly
    // imprecise tap opening the panel rather than nudging the pill.
    makeDraggable(pill, {
      onTap: () => {
        departedPanelOpen = true;
        renderDepartedPill();
        renderDepartedPanel();
      },
      posKey: 'departPillPos',
      keepVisiblePx: PILL_KEEP_VISIBLE_PX,
    });
  }

  function renderDepartedPanel() {
    const rows = departedList();
    renderPanel({
      marker: 'tph-depart-panel',
      open: departedPanelOpen,
      scrollKey: 'tph-depart-panel',
      onClose: () => { departedPanelOpen = false; renderDepartedPanel(); renderDepartedPill(); },
      html: `
      <span class="tph-close">✕</span>
      <h3>Left the table</h3>
      <div class="tph-depart-note">Tracked for ${DEPARTED_WATCH_MS / 60000} minutes after they leave, or until you
        dismiss them. Status keeps refreshing, so someone hospitalised after leaving stops reading as a target.</div>
      ${rows.length ? '' : '<i>Nobody has left recently.</i>'}
      ${rows.map((e) => {
        const r = e.readiness;
        const cls = r.blocked ? 'tph-depart-blocked' : r.ready ? 'tph-depart-ready' : 'tph-depart-unknown';
        const state = r.blocked
          ? `${r.emoji} ${escapeHtml(r.label)}${r.until ? ', ' + escapeHtml(fmtStatusRemaining(r.until)) + ' left' : ''}`
          : r.ready ? '🎯 attackable' : `❔ ${escapeHtml(r.label)}`;
        const mins = Math.max(1, Math.round(e.agoMs / 60000));
        // '' with the feature off or unconfigured — spyStatsLabel already
        // returns '' whenever spyStatsFor has nothing cached, so this row
        // never has to know WHY, only whether there's something to show.
        const spyLbl = spyStatsLabel(e.xid);
        return `<div class="tph-depart-row ${cls}" data-xid="${escapeHtml(e.xid)}">
          <div class="tph-depart-who"><b>${escapeHtml(e.name)}</b>${e.level ? ` <span class="tph-depart-meta">lvl ${e.level}</span>` : ''}${e.stack ? ` <span class="tph-depart-meta">${fmtMoney(e.stack)} chips</span>` : ''}${spyLbl ? ` <span class="tph-depart-meta" title="${escapeHtml(spyStatsDetail(e.xid))}">${spyLbl}</span>` : ''}
            <span class="tph-depart-meta">left ${mins}m ago</span></div>
          <div class="tph-depart-state">${state}</div>
          <a class="tph-attack-link" href="${attackUrl(e.xid)}" target="_blank" rel="noopener">Attack ↗</a>
          <span class="tph-depart-x" title="Dismiss">✕</span>
        </div>`;
      }).join('')}
      ${rows.length ? '<button class="tph-depart-clear">Dismiss all</button>' : ''}
    `,
      wire: (panel) => {
        panel.querySelectorAll('.tph-depart-x').forEach((x) => {
          x.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const row = x.closest ? x.closest('.tph-depart-row') : null;
            if (row) dismissDeparture(row.dataset.xid);
          });
        });
        const clear = panel.querySelector('.tph-depart-clear');
        if (clear) clear.addEventListener('click', clearDepartures);
      },
    });
  }

  function renderPlayersList() {
    const all = !playersListOpen ? [] : Object.keys(STORE.players)
      .map((xid) => ({ xid, p: STORE.players[xid] }))
      .filter(({ p }) => !playersFilter || (p.name || '').toLowerCase().includes(playersFilter.toLowerCase()))
      .sort((a, b) => {
        const av = playersSortValue(playersSortKey, a.xid, a.p);
        const bv = playersSortValue(playersSortKey, b.xid, b.p);
        const cmp = typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : av - bv;
        return playersSortDir === 'asc' ? cmp : -cmp;
      });

    const rows = all.length
      ? all.map(({ xid, p }) => {
        const r = computeRates(p);
        const s = computeShrunkRates(p);
        // Raw figures shown, sample-adjusted figures colour them — same rule as
        // the Stats tab, so a two-hand player doesn't light up the list.
        const cell = (raw, shrunk, key) => {
          const d = deviation(shrunk, POOL_AVG[key], POOL_SPREAD[key]);
          const c = d ? `tph-dev-${d.level}` : '';
          const a = d && d.level !== 'typical' ? (d.dir === 'up' ? '▲' : '▼') : '';
          return `<span class="${c}">${fmtPct(raw)}${a}</span>`;
        };
        const tilt = tiltRead(p);
        const heat = heatRead(p);
        return `<tr data-xid="${escapeHtml(xid)}" class="tph-prow">
            <td><b>${escapeHtml(p.name)}</b>${isHeroRecord(xid) ? '<span class="tph-you">you</span>' : ''}${tilt ? ' 🤮' : ''}${heat ? ' 🔥' : ''}</td>
            <td>${shortType(classify(p))}</td>
            <td>${p.hands}</td>
            <td>${cell(r.vpip, s.vpip, 'vpip')}/${cell(r.pfr, s.pfr, 'pfr')}</td>
            <td style="color:${isHeroRecord(xid) ? '#9fb2c4' : (pl0(p) >= 0 ? '#7ed957' : '#ff6b6b')}">${
              // plChipsEst is never written for hero — it would mean your P/L
              // against yourself. Printing the resulting 0 reads as "flat",
              // which is wrong; your real result is the Lifetime line below.
              isHeroRecord(xid) ? '<span class="tph-stat-norm">see Lifetime</span>' : plShort(p)}</td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="5"><i>No players tracked yet.</i></td></tr>`;

    const problem = heroProblem();
    renderPanel({
      marker: 'tph-players',
      open: playersListOpen,
      onClose: () => { playersListOpen = false; renderPlayersList(); },
      html: `
      <span class="tph-close">✕</span>
      <h3>Tracked players (${all.length})</h3>
      ${problem ? `<div class="tph-warn">⚠ ${escapeHtml(problem)}</div>` : ''}
      <input class="tph-pfilter" placeholder="Filter by name…" value="${escapeHtml(playersFilter)}" style="width:60%">
      <table class="tph-ptable">
        <tr>${(() => {
          // ▲/▼ only on the active column — the others carry a data-sort
          // attribute but no arrow, so the affordance stays discoverable
          // without cluttering four headers that aren't currently doing anything.
          const arrow = (key) => playersSortKey === key ? (playersSortDir === 'asc' ? ' ▲' : ' ▼') : '';
          const th = (key, label) => `<th class="tph-sortable" data-sort="${key}">${label}${arrow(key)}</th>`;
          return th('name', 'Name') + th('type', 'Type') + th('hands', 'Hands')
            + th('vpip', 'VPIP/PFR') + th('pl', 'P/L');
        })()}</tr>
        <tr class="tph-pool-row"><td colspan="3"><i>Pool average</i></td>
          <td>${POOL_AVG.vpip.toFixed(0)}%/${POOL_AVG.pfr.toFixed(0)}%</td><td>—</td></tr>
        ${rows}
      </table>
      <div style="opacity:.75;margin-top:10px;border-top:1px solid #444;padding-top:8px">
        <b>Session:</b> ${STORE.session.hands} hands, ${fmtSignedMoney(STORE.session.net)}
        ${STORE.session.startedAt ? ' (since ' + new Date(STORE.session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}<br>
        <b>Lifetime:</b> ${STORE.hero.hands} hands, ${fmtSignedMoney(STORE.hero.netChips)}
        &nbsp;|&nbsp; <b>${fmtBB(STORE.hero.netBB)}</b> ${fmtBB100(STORE.hero.netBB, STORE.hero.bbHands)}
        <br>${(STORE.hands || []).length} hands in history
        &nbsp;|&nbsp; ${(() => {
          // This list is where the player count is visible, so it is the right
          // place to say what that count is costing.
          const s = storageStats();
          const cls = s.level === 'ok' ? '' : ' class="tph-store-warntext"';
          return `<span${cls}>${fmtBytes(s.chars)} stored (${s.pct.toFixed(0)}%)</span>`;
        })()}
        ${poolComparisonLine()}${tipSpreadLine()}<br>
        <div class="tph-exp-lead">Pool tendencies (observed averages across your tracked opponents):</div>
        ${exportActionsHtml('pool', '')}
      </div>
    `,
      wire: (panel) => {
        const filterEl = panel.querySelector('.tph-pfilter');
        filterEl.addEventListener('input', (e) => {
          playersFilter = e.target.value;
          renderPlayersList();
          // Re-query: the line above replaced the panel, so `filterEl` is now
          // detached and focusing it would do nothing.
          const again = document.querySelector('.tph-pfilter');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        });
        panel.querySelectorAll('.tph-prow').forEach((row) => {
          row.addEventListener('click', () => {
            playersListOpen = false;
            renderPlayersList();
            openPlayerPanel(row.dataset.xid);
          });
        });
        panel.querySelectorAll('.tph-sortable').forEach((th) => {
          th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (playersSortKey === key) {
              playersSortDir = playersSortDir === 'asc' ? 'desc' : 'asc';
            } else {
              playersSortKey = key;
              // First tap on a new column: name/type read better A-Z, the
              // numeric columns read better biggest-first (find your worst
              // matchup or your most-hands regular immediately, not last).
              playersSortDir = (key === 'name' || key === 'type') ? 'asc' : 'desc';
            }
            renderPlayersList();
          });
        });
        // Aggregate stats across every tracked player, never a hand-by-hand
        // dump — see poolTendencyExport for why that's the honest choice.
        //
        // Copy goes straight to the clipboard (via copyText — see there for
        // why that's not just navigator.clipboard.writeText any more) — no
        // PDA share-sheet detour. "Sent ✓" on the button below now means
        // downloadTextFile's native call actually resolved, not merely that
        // it was fired (v1.19.0), but a share sheet completing is still async
        // Same three-route export as History, Settings and the Report tab
        // (v1.53.0/v1.54.0) — this footer was still on the old two-button path,
        // with the same off-screen-textarea copy bug and the same overclaiming
        // "Sent ✓".
        wireExportActions(panel, 'pool', {
          text: poolTendencyExport,
          fileName: `torn-poker-hud-pool-tendencies-${new Date().toISOString().slice(0, 10)}.txt`,
          subject: 'Torn Poker HUD — observed pool tendencies',
        });
      },
    });
  }

  let settingsOpen = false;

  function renderSettingsPanel() {
    renderPanel({
      marker: 'tph-settings',
      open: settingsOpen,
      onClose: () => { settingsOpen = false; renderSettingsPanel(); },
      wire: wireSettingsPanel,
      html: !settingsOpen ? '' : `
      <span class="tph-close">✕</span>
      <h3>Settings</h3>
      <button class="tph-open-self" style="width:100%;padding:9px;margin-bottom:6px"${heroUnresolved() ? ' disabled' : ''}>📊 Your own stats${heroUnresolved() ? ' (sit at a table first)' : ''}</button>
      <button class="tph-open-players" style="width:100%;padding:9px;margin-bottom:10px">👥 View tracked players &amp; hand history</button>
      <label><b>Your Torn username:</b> <input type="text" class="tph-hero-name" value="${escapeHtml(STORE.settings.heroName)}" placeholder="required for P/L" style="width:55%"></label><br>
      <div style="opacity:.7;margin:2px 0 6px">Needed to attribute profit/loss and work out your position.</div>
      ${heroProblem() ? `<div class="tph-warn">⚠ ${escapeHtml(heroProblem())}</div>`
        : (heroSeatEl()
          ? '<div class="tph-ok">✓ Matched to your seat — profit/loss is being attributed.</div>'
          // Identity came from STORE.hero.xid, not a seat on screen (see
          // findHeroXid). Saying "matched to your seat" here would be a plain
          // lie — there is no seat — and it matters which one it is: your own
          // stats and Trends read fine either way, but nothing is being
          // attributed while you are not actually in a hand.
          : '<div class="tph-ok">✓ Remembered from a previous sitting — your own stats and Trends are readable here. Profit/loss resumes when you sit down.</div>')}
      <label>Min hands before rating: <input type="number" class="tph-min-hands" value="${STORE.settings.minHands}" style="width:60px"></label><br><br>
      ${bbDisplayModeSuspected ? '<div class="tph-warn">⚠ The blind level read from the log is too small to be a real Torn stake. '
        + 'Torn is probably set to show amounts in big blinds rather than cash — switch it back to cash, or P/L stays unrecorded '
        + 'rather than being written wrong.</div>' : ''}
      ${plausibleBB(lastSeenBB) ? `<div style="opacity:.7;margin:2px 0 8px">Table: ${escapeHtml(tableLabel(lastSeenBB))}</div>` : ''}
      <h4>Seat labels</h4>
      <label><input type="checkbox" class="tph-badge-toggle" ${STORE.settings.showBadges ? 'checked' : ''}> Show tendency labels on seats</label><br>
      <label><input type="checkbox" class="tph-selfbadge-toggle" ${STORE.settings.showSelfBadge ? 'checked' : ''}> Include your own seat (green)</label><br>
      <label><input type="checkbox" class="tph-badgestats-toggle" ${STORE.settings.badgeStats !== false ? 'checked' : ''}> Numbers (V/P/A) on the labels</label>
      <div style="opacity:.7;margin:2px 0 10px">Turn off if a label still reaches the community cards. You keep the
        type, the this-hand marker and 🤮/🔥 — the read itself. The numbers behind it are one tap away in Stats.</div>
      <label><input type="checkbox" class="tph-rolebadge-toggle" ${STORE.settings.showRoleBadges !== false ? 'checked' : ''}> Mark this hand's raiser and postflop leads</label>
      <div style="opacity:.7;margin:2px 0 10px">Gold <b>PFR</b> / <b>3B</b> / <b>4B</b> marks whoever made the last preflop raise.
        Blue <b>DONK</b> (led out) or <b>RR</b> (check-raised or raised the c-bet) marks anyone taking the lead postflop who wasn't
        that raiser. Both clear when the hand settles.</div>
      <div style="margin:6px 0">
        <label><input type="radio" name="tph-bm" class="tph-bm" value="session" ${STORE.settings.badgeMode === 'session' ? 'checked' : ''}> Recent form</label>
        &nbsp;<label><input type="radio" name="tph-bm" class="tph-bm" value="lifetime" ${STORE.settings.badgeMode !== 'session' ? 'checked' : ''}> Lifetime</label>
        &nbsp;<label>over <input type="number" class="tph-sw" min="5" max="40" value="${STORE.settings.sessionWindow}" style="width:48px"> hands</label>
      </div>
      <div style="opacity:.7;margin:2px 0 10px">Recent form shows how they are playing NOW, weighted against their own
        longer-run baseline: a window with few hands in it reads close to that baseline and moves toward what it is
        actually seeing as it fills, so the numbers never jump on one hand. The TYPE stays lifetime.
        🤮 marks a player running ${TILT_VPIP_JUMP}+ points looser than their own norm (${TILT_VPIP_JUMP_AFTER_LOSS}+ if they just lost a ${BIG_LOSS_BB}bb pot). 🔥 marks someone winning a lot of recent pots. Both apply to you too — see the coach panel.</div>
      <div style="opacity:.7;margin:2px 0 10px">Small line under each seat, e.g. <b>STA 15h V74 P12 A16</b>:
        type · window · <b>V</b>PIP (hands played) · <b>P</b>FR (raised preflop) · <b>A</b>Fq (postflop aggression).
        "15h" means V and P cover your last 15 hands; A is always lifetime, since postflop samples are too scarce
        for a short window. Types: NIT, TAG, LAG, MAN(iac), STA(tion), FSH, BAL(anced); "?" = provisional.
        Tap a badge for full stats. Turn off to leave the table completely clear.</div>
      <h4>Your turn</h4>
      <label><input type="checkbox" class="tph-turncue-toggle" ${STORE.settings.turnCues ? 'checked' : ''}> Highlight the screen when it's your turn</label><br>
      <label><input type="checkbox" class="tph-nextcue-toggle" ${STORE.settings.nextToActCue ? 'checked' : ''}> Amber warning when you're next to act</label><br>
      <label><input type="checkbox" class="tph-turnvib-toggle" ${STORE.settings.turnVibrate ? 'checked' : ''}> Also buzz once</label><br>
      <label><input type="checkbox" class="tph-turnsound-toggle" ${STORE.settings.turnSound ? 'checked' : ''}> Also play a chime</label>
      <button class="tph-test-chime">Test</button>
      <button class="tph-test-escalation">Test escalation</button>
      <div style="opacity:.7;margin:2px 0 10px">A pulsing border plus a green button. It never covers the table's
        controls — the overlay ignores taps entirely. Pre-action buttons ("Check / Fold") don't count as your turn.
        Phones block audio until you've tapped the page, so use Test to check the chime actually plays here.
        Still your turn ${TURN_ESCALATE_MS / 1000}s later, and the cue repeats louder: a brighter, faster-pulsing
        border and a second, stronger chime/buzz — for a phone that's dimmed or been set down since the first one.</div>
      <h4>Fold guard</h4>
      <label><input type="checkbox" class="tph-foldguard-toggle" ${STORE.settings.foldGuard ? 'checked' : ''}> Tap Fold twice to confirm</label>
      <div style="opacity:.7;margin:2px 0 10px">Guards against misclicking Fold next to Call. It never folds for you —
        the second tap is your own. If anything goes wrong the tap passes straight through, and missing the
        ${FOLD_ARM_MS / 1000}s window costs nothing, since Torn folds you on timeout anyway.</div>
      <h4>Coach</h4>
      <label><input type="checkbox" class="tph-coach-toggle" ${STORE.settings.coachHidden ? '' : 'checked'}> Show coach panel</label><br>
      <label>Full table size: <input type="number" class="tph-table-max" min="2" max="10" value="${STORE.settings.tableMax}" style="width:60px"></label><br>
      <label>Equity samples: <input type="number" class="tph-equity-iters" min="${EQUITY_ITERS_MIN}" max="${EQUITY_ITERS_MAX}" step="100" value="${STORE.settings.equityIters}" style="width:80px"></label>
      <div style="opacity:.7;margin:2px 0 6px">How many hands the equity engine simulates. It is spread across frames so
        it never freezes the table, but a lower number makes the figure land sooner — which is what you feel on a slow
        phone. Precision scales as 1/&radic;n: 600 is roughly &plusmn;2 points at worst, 1200 &plusmn;1.4,
        300 &plusmn;2.9 — all smaller than the error the range estimate already carries, so this is a cheap trade.
        Whatever you set, the call/fold verdict goes quiet and reads &ldquo;marginal&rdquo; when the spot is closer
        than the simulation can actually resolve.</div>
      <div style="opacity:.7;margin:2px 0 6px">Equity is always quoted against a full ring of this size, plus the live and heads-up counts.</div>
      <button class="tph-coach-reset">Reset panel positions &amp; size</button>
      <div style="opacity:.7;margin:2px 0 10px">Drag the ◢ corner to resize the coach panel — it stays where you put
        it, at the size you set, and now stays on screen between hands instead of disappearing.</div>
      <label><input type="checkbox" class="tph-calib-toggle" ${STORE.settings.calibrationMode ? 'checked' : ''}> Calibration mode</label><br><br>
      <h4>Departure watch</h4>
      <label><input type="checkbox" class="tph-depart-toggle" ${STORE.settings.departureWatch ? 'checked' : ''}> Alert when an attackable player leaves</label><br>
      <label><input type="checkbox" class="tph-departcue-toggle" ${STORE.settings.departureCue ? 'checked' : ''}> Flash the screen edge</label><br>
      <label><input type="checkbox" class="tph-departvib-toggle" ${STORE.settings.departureVibrate ? 'checked' : ''}> Also buzz</label><br>
      <label><input type="checkbox" class="tph-departsound-toggle" ${STORE.settings.departureSound ? 'checked' : ''}> Also play a chime</label>
      <div style="opacity:.7;margin:2px 0 10px">A seat vanishing is the moment they stop being reachable from the
        table, so the HUD keeps their name, level and attack link for ${DEPARTED_WATCH_MS / 60000} minutes and
        carries on checking their status — someone hospitalised after leaving stops reading as a target. Only
        players known to be attackable when they left raise the alert; anyone in hospital, or never checked, is
        listed without one. Needs a Torn API key, and the flash never intercepts a tap.</div>
      <h4>Torn API features</h4>
      <label>Torn API key: <input type="text" class="tph-torn-api-key" value="${escapeHtml(STORE.settings.tornApiKey)}" placeholder="optional, public access is enough" style="width:60%"></label>
      <div class="tph-target-diag ${targetDiagnostic() ? 'tph-target-diag-bad' : 'tph-target-diag-ok'}">${
        targetDiagnostic()
          ? '⚠ ' + escapeHtml(targetDiagnostic())
          : `✓ Torn API working — ${targetProbe.okCount} lookup${targetProbe.okCount === 1 ? '' : 's'} so far.`
      }</div>
      <div style="opacity:.7;margin:2px 0 10px">🔗 marks two seated players sharing a faction, 💍 marks two married
        to each other — both are facts from Torn's own profile data, checked only against whoever is CURRENTLY
        seated, never stored as a relationship between two players. 🏥 / 🚔 / ✈️ on a seat means something is
        blocking an attack on them (hospital, jail, travelling) — checked for every seated opponent, refreshed
        every 30s. No mark means nothing known to be blocking. Tap a seat badge to open their panel: their name
        there links to their Torn profile, and there's a direct attack link beside their status and level.
        Leave the key blank and none of this does anything; a public-only key is enough, and it never leaves this
        device (stripped from Backup/Gist exports, same as the GitHub token).</div>
      <h4>Estimated battle stats</h4>
      <label><input type="checkbox" class="tph-spy-toggle" ${STORE.settings.battleStatsEstimate ? 'checked' : ''}> Show estimated battle stats on departed players</label><br>
      <label>TornStats API key: <input type="text" class="tph-spy-api-key" value="${escapeHtml(STORE.settings.tornStatsApiKey)}" placeholder="from tornstats.com — a separate key from the one above" style="width:60%"></label>
      <div class="tph-target-diag ${spyDiagnostic() ? 'tph-target-diag-bad' : 'tph-target-diag-ok'}">${
        spyDiagnostic()
          ? '⚠ ' + escapeHtml(spyDiagnostic())
          : `✓ TornStats working — ${spyProbe.okCount} lookup${spyProbe.okCount === 1 ? '' : 's'} so far.`
      }</div>
      <div style="opacity:.7;margin:2px 0 10px">Off by default, and a separate key from the Torn API one above. Torn's
        own API only ever returns the KEY OWNER'S OWN battle stats — there is no way to read a third party's
        strength, defense, speed or dexterity from Torn directly, at any access level. What shows here instead is a
        CROWDSOURCED ESTIMATE from TornStats: other players' own in-game "spy" results on that target, pooled and
        served back — never Torn's own data, and only as fresh as the last time somebody actually spied them.
        <b>This integration is unverified</b> — nobody working on this holds a TornStats key to confirm it against a
        live response, so treat a number here as a rough guide, not a fact. Needs its own key from tornstats.com,
        never the same as your Torn API key, and never leaves this device (stripped from Backup/Gist exports too).</div>
      <h4>GitHub Gist sync</h4>
      <label>OAuth App Client ID: <input type="text" class="tph-client-id" value="${escapeHtml(STORE.settings.githubClientId)}" style="width:70%"></label><br>
      <button class="tph-connect">${GistSync.status === 'connected' ? 'Re-sync now' : 'Connect'}</button>
      <div class="tph-sync-status">${escapeHtml(syncStatusText())}</div>
      ${gistUrl() ? '<button class="tph-copy-gist-link">Copy gist link</button>' : ''}
      ${storageSettingsHtml()}
      <h4>Hand log</h4>
      <div class="tph-exp-lead">Every hand in the store as plain text, for offline analysis —
        ${(STORE.hands || []).length} hand(s). Not the JSON backup below; this is the readable log.</div>
      ${exportActionsHtml('handlog', `(${(STORE.hands || []).length})`)}
      <h4>P/L ledger</h4>
      <div class="tph-exp-lead">One row per hand's chip result, as CSV — a running total column, not just
        the day's history. Survives long after a hand ages out of the log above: ${(STORE.plLedger || []).length}
        of up to ${PL_LEDGER_CAP} row(s) kept. Your lifetime total (${fmtSignedMoney(STORE.hero.netChips)}) stays
        exact regardless of what has aged out of this file.</div>
      ${exportActionsHtml('ledger', `(${(STORE.plLedger || []).length})`)}
      <h4>Backup</h4>
      <textarea class="tph-export" readonly></textarea>
      <button class="tph-copy-export">Copy</button>
      <button class="tph-save-export">${isPDA() ? 'Save / share file' : 'Download file'}</button>
      <textarea class="tph-import" placeholder="Paste JSON to import"></textarea>
      <button class="tph-do-import">Import</button>
      <br><br>
      <!-- Narrow resets sit ABOVE the total one, and say what they keep. The
           only button here used to be "Reset all data", so fixing a wrong P/L
           figure meant discarding every stat, showdown range and hand in the
           store. -->
      <button class="tph-reset-pl">Reset P/L only</button>
      <button class="tph-reset-hero">Reset my stats</button>
      <div class="tph-stat-legend">P/L only: zeroes every money figure, keeps all stats, ranges and history.
        My stats: zeroes your own counters and P/L, keeps every opponent and all hand history.</div>
      <br>
      <button class="tph-reset">Reset all data</button>
    `,
    });
  }

  // Sits immediately above Backup on purpose: the remedy for every state this
  // can report is "copy a backup", and it should be the next thing under your
  // thumb rather than something to go looking for.
  function storageSettingsHtml() {
    const s = storageStats();
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return '<h4>Storage</h4>'
      + (s.failed
        ? '<div class="tph-warn">⚠ The last save was REFUSED — storage is full. Everything recorded since '
          + `${new Date(saveFailure.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `
          + 'is in memory only and will be lost when this page reloads. Copy a backup below now, then Reset all data.</div>'
        : '')
      + `<div class="tph-storebar"><div class="tph-storebar-fill tph-store-${s.level}" `
      + `style="width:${Math.min(100, s.pct).toFixed(1)}%"></div></div>`
      + `<div class="tph-store-line">${fmtBytes(s.chars)} of roughly ${fmtBytes(STORAGE_QUOTA_EST)} `
      + `(${s.pct.toFixed(0)}%) · ${plural(s.players, 'player')} · ${plural(s.hands, 'hand')} in history</div>`
      + (s.level === 'warn'
        ? '<div class="tph-store-line tph-store-warntext">Getting full. A cleanup runs automatically past '
          + `${STORAGE_WARN_PCT}% — copy a backup below first if you want everything kept.</div>`
        : '')
      + `<div class="tph-store-line">About ${fmtBytes(Math.round(s.perPlayer))} per player. History is capped at `
      + `${STORE.settings.historyLimit || 200} hands. Past ${STORAGE_WARN_PCT}% a cleanup drops players seen `
      + `under ${PRUNE_THIN_HANDS} hands and not in ${PRUNE_THIN_DAYS} days, then anything not seen in `
      + `${PRUNE_MAX_DAYS} days, then the least recently seen down to ${PRUNE_PLAYER_CAP}. Thin records cost `
      + 'about half what a long-tracked one does and tell you nothing, so they go first. You are never dropped. '
      + 'The limit is an estimate; the browser does not report the real one here.</div>'
      + pruneReportHtml();
  }

  function pruneReportHtml() {
    const r = STORE && STORE.lastPrune;
    if (!r || !r.dropped) return '';
    const parts = [];
    if (r.thin) parts.push(`${r.thin} thin and stale`);
    if (r.stale) parts.push(`${r.stale} over ${PRUNE_MAX_DAYS} days old`);
    if (r.lru) parts.push(`${r.lru} least recently seen`);
    return '<div class="tph-store-line tph-store-warntext">Last cleanup '
      + `${new Date(r.at).toLocaleDateString()}: dropped ${r.dropped} player record`
      + `${r.dropped === 1 ? '' : 's'}${parts.length ? ' — ' + parts.join(', ') : ''}. `
      + `${r.kept} kept.</div>`;
  }

  function wireSettingsPanel(panel) {
    // .value (not innerHTML) so exported JSON — which contains opponent display
    // names — can't break out of the textarea.
    panel.querySelector('.tph-export').value = exportJson();

    panel.querySelector('.tph-open-self').addEventListener('click', () => {
      if (heroUnresolved()) return;
      settingsOpen = false;
      renderSettingsPanel();
      openPlayerPanel(heroXid);
    });
    panel.querySelector('.tph-open-players').addEventListener('click', () => {
      settingsOpen = false;
      renderSettingsPanel();
      playersListOpen = true;
      renderPlayersList();
    });
    panel.querySelector('.tph-hero-name').addEventListener('change', (e) => {
      STORE.settings.heroName = e.target.value.trim();
      heroXid = null; // force re-resolution against the new name
      // And forget the remembered XID — a different username is the one thing
      // that genuinely means "a different person", so keeping it would resolve
      // the new name straight back to the old account's record.
      if (STORE.hero) STORE.hero.xid = null;
      saveStore();
    });
    panel.querySelector('.tph-min-hands').addEventListener('change', (e) => {
      STORE.settings.minHands = parseInt(e.target.value, 10) || 20;
      saveStore();
    });
    panel.querySelectorAll('.tph-bm').forEach((el) => {
      el.addEventListener('change', (e) => {
        STORE.settings.badgeMode = e.target.value === 'session' ? 'session' : 'lifetime';
        saveStore();
        renderBadges();
      });
    });
    panel.querySelector('.tph-sw').addEventListener('change', (e) => {
      const n = parseInt(e.target.value, 10);
      STORE.settings.sessionWindow = Math.min(RECENT_MAX, Math.max(5, isNaN(n) ? 15 : n));
      e.target.value = STORE.settings.sessionWindow;
      saveStore();
      renderBadges();
    });
    panel.querySelector('.tph-turncue-toggle').addEventListener('change', (e) => {
      STORE.settings.turnCues = e.target.checked;
      saveStore();
      renderTurnCue(); // clears the glow immediately rather than after the tick
    });
    panel.querySelector('.tph-nextcue-toggle').addEventListener('change', (e) => {
      STORE.settings.nextToActCue = e.target.checked;
      saveStore();
      renderTurnCue();
    });
    panel.querySelector('.tph-turnvib-toggle').addEventListener('change', (e) => {
      STORE.settings.turnVibrate = e.target.checked;
      saveStore();
    });
    panel.querySelector('.tph-turnsound-toggle').addEventListener('change', (e) => {
      STORE.settings.turnSound = e.target.checked;
      saveStore();
      if (e.target.checked) playTurnChime(); // confirm it works at the moment you ask for it
    });
    panel.querySelector('.tph-test-chime').addEventListener('click', (e) => {
      const ok = playTurnChime();
      e.target.textContent = ok ? 'Played' : 'No audio here';
    });
    panel.querySelector('.tph-test-escalation').addEventListener('click', (e) => {
      const ok = playTurnEscalationChime();
      e.target.textContent = ok ? 'Played' : 'No audio here';
    });
    panel.querySelector('.tph-foldguard-toggle').addEventListener('change', (e) => {
      STORE.settings.foldGuard = e.target.checked;
      saveStore();
      if (!e.target.checked) { foldArmedAt = 0; hideFoldPrompt(); }
    });
    panel.querySelector('.tph-selfbadge-toggle').addEventListener('change', (e) => {
      STORE.settings.showSelfBadge = e.target.checked;
      saveStore();
      renderBadges();
    });
    panel.querySelector('.tph-rolebadge-toggle').addEventListener('change', (e) => {
      STORE.settings.showRoleBadges = e.target.checked;
      saveStore();
      renderBadges();
    });
    panel.querySelector('.tph-badge-toggle').addEventListener('change', (e) => {
      STORE.settings.showBadges = e.target.checked;
      saveStore();
      renderBadges(); // clears them immediately rather than waiting for the tick
    });
    panel.querySelector('.tph-badgestats-toggle').addEventListener('change', (e) => {
      STORE.settings.badgeStats = e.target.checked;
      saveStore();
      renderBadges(); // the point is to see the narrower badge straight away
    });
    panel.querySelector('.tph-coach-toggle').addEventListener('change', (e) => {
      setCoachHidden(!e.target.checked);
    });
    panel.querySelector('.tph-table-max').addEventListener('change', (e) => {
      const n = parseInt(e.target.value, 10);
      STORE.settings.tableMax = Math.min(10, Math.max(2, isNaN(n) ? 9 : n));
      e.target.value = STORE.settings.tableMax;
      saveStore();
    });
    panel.querySelector('.tph-equity-iters').addEventListener('change', (e) => {
      STORE.settings.equityIters = clampEquityIters(e.target.value);
      e.target.value = STORE.settings.equityIters;
      // Every cached figure was computed at the OLD sample count. Keeping them
      // would leave the panel mixing two precisions with nothing saying which
      // is which, so drop them and let the next render ask again.
      equityCache.clear();
      equityQueue = [];
      cancelEquityJob();
      saveStore();
      renderCoachPanel();
    });
    // An escape hatch for a panel dragged somewhere unreachable — e.g. parked in
    // a corner that the other screen orientation doesn't have.
    panel.querySelector('.tph-coach-reset').addEventListener('click', () => {
      STORE.settings.coachPos = null;
      STORE.settings.coachPillPos = null; // the pill is draggable too, and can be
                                          // parked out of reach just as easily
      STORE.settings.departPillPos = null; // and so is the departure pill — one
                                           // button has to recover every floating
                                           // element, or the escape hatch has a gap
      STORE.settings.coachSize = null;    // and a panel shrunk to its floor is as
                                          // unusable as one parked off screen
      saveStore();
      const coach = document.querySelector('.tph-coach');
      if (coach) coach.remove(); // rebuilt at the default anchor on the next tick
      ['.tph-coach-pill', '.tph-depart-pill'].forEach((sel) => {
        const pill = document.querySelector(sel);
        if (pill) pill.remove(); // rebuilt at its CSS anchor on the next tick
      });
    });
    [['.tph-depart-toggle', 'departureWatch'], ['.tph-departcue-toggle', 'departureCue'],
      ['.tph-departvib-toggle', 'departureVibrate'], ['.tph-departsound-toggle', 'departureSound'],
    ].forEach(([sel, key]) => {
      const el = panel.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', (e) => {
        STORE.settings[key] = e.target.checked;
        saveStore();
        // Turning the watch off must take the pill and panel with it, not
        // leave them until the next tick.
        if (key === 'departureWatch' && !e.target.checked) {
          departedPanelOpen = false;
          renderDepartedPanel();
        }
        renderDepartedPill();
      });
    });
    panel.querySelector('.tph-calib-toggle').addEventListener('change', (e) => {
      STORE.settings.calibrationMode = e.target.checked;
      saveStore();
      if (!e.target.checked) { const c = document.querySelector('.tph-calib'); if (c) c.remove(); }
      else renderCalibrationPanel();
    });
    panel.querySelector('.tph-client-id').addEventListener('change', (e) => {
      STORE.settings.githubClientId = e.target.value.trim();
      saveStore();
    });
    panel.querySelector('.tph-torn-api-key').addEventListener('change', (e) => {
      STORE.settings.tornApiKey = e.target.value.trim();
      saveStore();
    });
    panel.querySelector('.tph-spy-toggle').addEventListener('change', (e) => {
      STORE.settings.battleStatsEstimate = e.target.checked;
      saveStore();
    });
    panel.querySelector('.tph-spy-api-key').addEventListener('change', (e) => {
      STORE.settings.tornStatsApiKey = e.target.value.trim();
      saveStore();
    });
    panel.querySelector('.tph-connect').addEventListener('click', () => {
      if (GistSync.status === 'connected') GistSync.syncNow();
      else GistSync.startDeviceFlow();
    });
    // Only rendered once a gist exists (see gistUrl() above). A ~40-char URL,
    // not the multi-hundred-KB export — copyText's execCommand fallback
    // should never have a reason to fail on something this small even on a
    // device where the full Backup copy does.
    const copyGistBtn = panel.querySelector('.tph-copy-gist-link');
    if (copyGistBtn) {
      copyGistBtn.addEventListener('click', async (e) => {
        const ok = await copyText(gistUrl());
        e.target.textContent = ok ? 'Copied ✓' : 'Copy failed — select the link in the status line above';
      });
    }
    wireExportActions(panel, 'handlog', {
      text: fullHistoryExport,
      fileName: `torn-poker-hud-handlog-${new Date().toISOString().slice(0, 10)}.txt`,
      subject: 'Torn Poker HUD — full hand log',
    });
    wireExportActions(panel, 'ledger', {
      text: plLedgerExportCsv,
      fileName: `torn-poker-hud-pl-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      subject: 'Torn Poker HUD — P/L ledger',
    });
    panel.querySelector('.tph-copy-export').addEventListener('click', async (e) => {
      // Passes the visible .tph-export textarea itself as copyText's
      // existingEl — if even execCommand fails, the JSON is left selected on
      // screen (not in some invisible off-DOM element), ready for a manual
      // long-press-copy as the last resort.
      const ok = await copyText(exportJson(), panel.querySelector('.tph-export'));
      e.target.textContent = ok ? 'Copied ✓' : 'Copy failed — the box above is selected, copy it manually';
    });
    panel.querySelector('.tph-save-export').addEventListener('click', async (e) => {
      const stamp = new Date().toISOString().slice(0, 10);
      // exportJson(), not the raw store — it is the single choke point that
      // strips githubToken and anything else in LOCAL_ONLY_SETTINGS.
      const ok = await downloadTextFile(exportJson(), `torn-poker-hud-${stamp}.json`, 'application/json');
      e.target.textContent = ok ? 'Sent ✓' : 'Not supported here — use Copy';
    });
    panel.querySelector('.tph-do-import').addEventListener('click', () => {
      const text = panel.querySelector('.tph-import').value;
      try { importJson(text); renderSettingsPanel(); } catch (e) { alert('Invalid JSON'); }
    });
    panel.querySelector('.tph-reset-pl').addEventListener('click', () => {
      if (confirm('Zero every profit/loss figure?\n\nKeeps all stats, showdown ranges and hand history. Cannot be undone.')) {
        resetProfitLoss(); renderSettingsPanel(); renderBadges();
      }
    });
    panel.querySelector('.tph-reset-hero').addEventListener('click', () => {
      if (confirm('Reset YOUR own stats and P/L?\n\nEvery opponent and all hand history is kept. Cannot be undone.')) {
        resetHeroStats(); renderSettingsPanel(); renderBadges();
      }
    });
    panel.querySelector('.tph-reset').addEventListener('click', () => {
      if (confirm('Reset all tracked player data? This cannot be undone.')) { resetAllData(); renderSettingsPanel(); }
    });
  }

  // https://gist.github.com/<id> resolves without a username prefix — one
  // less API round trip (and one less thing to cache) just to show a link.
  function gistUrl() {
    return STORE.settings.gistId ? `https://gist.github.com/${STORE.settings.gistId}` : null;
  }

  function syncStatusText() {
    if (GistSync.status === 'waiting-for-user') {
      return `Open ${GistSync.verificationUri} on this phone's regular browser and enter code: ${GistSync.userCode}`;
    }
    if (GistSync.status === 'polling') return 'Waiting for authorization…';
    if (GistSync.status === 'connected') {
      // The connect flow never surfaced the gist itself anywhere — "connected"
      // told you sync was happening but not where the data actually went.
      // Reported live: it's the only way to get a large backup off a device
      // where Copy/Save can both fail on size (v1.19.0's copyText/
      // downloadTextFile fixes only made those failures honest, not larger).
      // A gist opened in the phone's REGULAR browser has full, unrestricted
      // clipboard access, unlike the constrained page this HUD runs inside.
      const url = gistUrl();
      return `Connected. Last sync: ${STORE.settings.lastSync ? new Date(STORE.settings.lastSync).toLocaleString() : 'never'}.`
        + (url ? ` Gist: ${url}` : '');
    }
    if (GistSync.status === 'error') return `Error: ${GistSync.error}`;
    return 'Not connected.';
  }

  // --- Deep scan: dump the page's real structure ------------------------------
  // Torn's class names are hashed, so rather than keep guessing them blind this
  // reports what's actually on the page — as copyable text, since a phone has no
  // usable devtools.

  function squish(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function elSig(el) {
    if (!el || el.nodeType !== 1) return '(none)';
    const cls = (typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.');
    return el.tagName + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  }

  function ancestry(el, levels) {
    const out = [];
    let cur = el;
    for (let i = 0; i < levels && cur; i++) { out.push(elSig(cur)); cur = cur.parentElement; }
    return out.join('\n     ^ ');
  }

  function selectorAlternatives(sel) {
    return sel.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function countSel(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
  }

  // CSS-module class names look like "playerWrapper___a1B2c". The hash differs
  // per build but the base name is stable — and the base is all a
  // [class*="base___"] selector needs.
  function classVocab(limit) {
    const counts = {};
    document.querySelectorAll('body *').forEach((el) => {
      const cn = typeof el.className === 'string' ? el.className : '';
      cn.split(/\s+/).forEach((tok) => {
        const m = /^(.*?___)/.exec(tok);
        if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([k, v]) => `${k}(${v})`);
  }

  // Class bases matching a pattern, regardless of how rare they are.
  //
  // classVocab() sorts by frequency and truncates, which hides exactly the
  // one-off markers that matter most: `self___` appears once (your seat) and
  // `dealer___` once, so both fell below the top-45 cutoff and were missed for
  // many versions while `opponent___(5)` sat in plain sight.
  function classVocabMatching(re) {
    const counts = {};
    document.querySelectorAll('body *').forEach((el) => {
      const cn = typeof el.className === 'string' ? el.className : '';
      cn.split(/\s+/).forEach((tok) => {
        if (!re.test(tok)) return;
        const m = /^(.*?)[_-]{1,3}[A-Za-z0-9]*$/.exec(tok);
        const base = m ? m[1] : tok;
        counts[base] = (counts[base] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}(${v})`);
  }

  // Deepest elements containing a string, so we get the actual text node's
  // element rather than some huge outer wrapper.
  function findByText(needle, limit) {
    const out = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (out.length >= limit) break;
      if (el.closest('[class^="tph-"], [class*=" tph-"]')) continue;
      if (!(el.textContent || '').includes(needle)) continue;
      let childHas = false;
      for (const c of el.children) {
        if ((c.textContent || '').includes(needle)) { childHas = true; break; }
      }
      if (!childHas) out.push(el);
    }
    return out;
  }

  function runDeepScan() {
    const L = [];
    L.push(`=== TORN POKER HUD DEEP SCAN — script v${HUD_VERSION} ===`);
    L.push('url: ' + location.pathname + location.search);
    L.push('logObserver: ' + (logObserver ? (logUsingFallback ? 'ACTIVE (body fallback)' : 'ACTIVE (container)') : 'NOT ATTACHED'));
    // If duplicate hands ever come back, this line says which ingestion path ran.
    // "added-nodes fallback" means logRow matched nothing and the parser cannot
    // tell a re-render from a new event.
    L.push('logIngest: ' + (hasLogRows()
      ? `snapshot diff (${logSnapshot.length} rows, ${logOrientation || 'orientation not yet inferred'})`
      : 'added-nodes fallback — logRow selector matches nothing'));
    L.push('handsRecorded: ' + (STORE.hands || []).length
      + ', withGameId: ' + (STORE.hands || []).filter((h) => h && h.g).length);
    // The two pots should agree mid-hand. A DOM pot with a log pot of 0 means
    // the HUD attached mid-hand; a persistent mismatch means the parser is
    // missing amounts, which silently skews pot odds and MDF.
    const domPot = readDomPot();
    L.push('pot: dom=' + (domPot == null ? 'UNREADABLE' : fmtMoney(domPot))
      + ' log=' + fmtMoney(currentHand ? currentHand.pot : 0)
      + (domPot != null && currentHand && currentHand.pot > 0 && Math.abs(domPot - currentHand.pot) > domPot * 0.02
        ? '  <-- MISMATCH' : ''));
    L.push('heroXid: ' + (heroXid || 'NOT RESOLVED') + ' — ' + (heroProblem() || 'ok'));
    // Hero's own counters, and whether a `name:<username>` pseudo-record exists
    // beside them.
    //
    // `heroXid: ok` does NOT clear this: hero identity resolves off the self___
    // seat marker and never touches the username, while hero's LOG lines still
    // go through nameToXidGuess. If those ever resolve by name instead of by
    // seat id, `hands` accrues to the real record and vpip/pfr accrue to the
    // pseudo one. The only symptom is "my own VPIP looks too low" — every
    // opponent reads correctly, so nothing points at identity.
    //
    // A ghost line here is the whole diagnosis. Two records, one player.
    (() => {
      const uname = (STORE.settings.heroName || '').trim();
      const real = (!heroUnresolved() && heroXid) ? STORE.players[heroXid] : null;
      const ghost = uname ? STORE.players['name:' + uname] : null;
      L.push('heroRecord: ' + (real
        ? `${real.hands} hands, vpip ${real.vpip}, pfr ${real.pfr}`
        : 'NONE — hero has no seat record'));
      L.push('heroGhost(name:' + (uname || 'UNSET') + '): ' + (ghost
        ? `EXISTS — ${ghost.hands} hands, vpip ${ghost.vpip}, pfr ${ghost.pfr}   <-- SPLIT IDENTITY`
        : 'none'));
      L.push('STORE.hero: ' + STORE.hero.hands + ' hands, bbHands ' + STORE.hero.bbHands
        + (real && Math.abs(STORE.hero.hands - real.hands) > 2 ? '   <-- DISAGREES WITH heroRecord' : ''));
    })();
    L.push('');

    L.push('--- SELECTOR ALTERNATIVES (each tested separately) ---');
    Object.entries(SELECTORS).forEach(([key, sel]) => {
      selectorAlternatives(sel).forEach((alt) => L.push(`${countSel(alt)}\t${key}\t${alt}`));
    });
    L.push('');

    L.push('--- CSS MODULE CLASS BASES (most common) ---');
    L.push(classVocab(45).join(' '));
    L.push('');

    // Everything below was derived by reading a public reference script rather
    // than from a scan of THIS device. Each line either confirms it holds on
    // Torn PDA's layout or shows what to use instead. Rare markers are listed
    // in full because the frequency-sorted vocabulary above truncates them away.
    L.push('--- IDENTITY / RING MARKERS (unconfirmed on this layout) ---');
    L.push('self/opponent/dealer/position/positioner bases:');
    L.push('  ' + (classVocabMatching(/^(self|opponent|dealer|position|playerPositioner|state|sit)/i).join(' ') || '(none)'));
    const hSeat = heroSeatEl();
    L.push('heroSeat: ' + (hSeat ? elSig(hSeat) : 'NO MATCH')
      + ' -> xid ' + (hSeat ? (resolveXidFromSeat(hSeat) || 'UNRESOLVED') : '—'));
    L.push('dealerXid: ' + (getDealerXid() || 'NOT RESOLVED')
      + '  (dealer el: ' + (document.querySelector(SELECTORS.dealerButton) ? elSig(document.querySelector(SELECTORS.dealerButton)) : 'NO MATCH') + ')');
    const outNow = Array.from(document.querySelectorAll(SELECTORS.seatContainer))
      .filter(isSeatSittingOut).map((s) => s.id);
    L.push('sittingOut: ' + (outNow.length ? outNow.join(', ') : 'none right now'));

    // Torn API block. This feature's field names are unverified and it has no
    // visible output when it is working but nobody happens to be blocked, so
    // "I don't see anything" needs a place to be answered from. Prints whether
    // a key is set (NEVER the key itself — this scan gets pasted into chats),
    // whether any lookup has succeeded, the last error, and the actual cache.
    L.push('--- TORN API / TARGET STATUS ---');
    L.push('apiKey set: ' + (!!(STORE.settings.tornApiKey || '').trim())
      + '   started: ' + targetProbe.fetchStarted
      + '   successful lookups: ' + targetProbe.okCount
      + '   last fetch: ' + (targetProbe.lastFetchAt ? Math.round((Date.now() - targetProbe.lastFetchAt) / 1000) + 's ago' : 'never'));
    L.push('diagnostic: ' + (targetDiagnostic() || 'OK — working'));
    // Key NAMES only — no values. This is what identifies where `level` (and
    // anything else still reading as absent) actually lives in the response.
    L.push('last response top-level keys: ' + (targetProbe.lastKeys || '(none captured)'));
    L.push('affiliation sub-keys: ' + (affilLastKeys || '(none captured)'));
    // What parseAffiliationProfile actually stored for seated players. The
    // badge only lights when two SEATED players match, so with no faction-mate
    // at the table an empty badge proves nothing — this shows whether the
    // fields were read at all, which is the part still unverified.
    const affilRows = Array.from(seatedXids({ includeSittingOut: true }))
      .filter((x) => !isHeroRecord(x))
      .map((x) => {
        const p = STORE.players[x];
        if (!p) return x + ' -> no record';
        if (!p.affilFetchedAt) return x + ' -> never fetched';
        return x + ' -> factionId=' + (p.factionId || 'ABSENT')
          + ' factionName=' + (p.factionName ? JSON.stringify(squish(p.factionName, 24)) : 'ABSENT')
          + ' spouseXid=' + (p.spouseXid || 'ABSENT');
      });
    L.push('affiliation cache (' + affilRows.length + '):');
    affilRows.forEach((r) => L.push('  ' + r));

    // Estimated battle stats — the least verified integration in this file
    // (see the section header above parseSpyStats). No values, same rule as
    // every other credential/estimate dump here — a TornStats total is not a
    // secret, but the point of these blocks is to check FIELD NAMES, and
    // keeping the habit absolute is what makes it trustworthy elsewhere.
    L.push('--- ESTIMATED BATTLE STATS (TornStats, UNVERIFIED) ---');
    L.push('battleStatsEstimate: ' + !!STORE.settings.battleStatsEstimate
      + '   tornStatsApiKey set: ' + (!!(STORE.settings.tornStatsApiKey || '').trim())
      + '   started: ' + spyProbe.fetchStarted
      + '   successful lookups: ' + spyProbe.okCount
      + '   last fetch: ' + (spyProbe.lastFetchAt ? Math.round((Date.now() - spyProbe.lastFetchAt) / 1000) + 's ago' : 'never'));
    L.push('diagnostic: ' + (spyDiagnostic() || 'OK — working'));
    L.push('last response top-level keys: ' + (spyProbe.lastKeys || '(none captured)'));
    const spyEntries = Array.from(spyCache.keys());
    L.push('spy cache: ' + spyEntries.length + ' entr' + (spyEntries.length === 1 ? 'y' : 'ies'));
    spyEntries.forEach((k) => {
      const s = spyCache.get(k);
      L.push('  ' + k + ' -> total=' + s.total + ' spiedAt=' + (s.spiedAt ? fmtSpyAge(s.spiedAt) : 'ABSENT'));
    });

    const tickBad = Object.keys(tickErrors);
    L.push('watcher steps failing: ' + (tickBad.length
      ? tickBad.map((k) => k + ' -> ' + tickErrors[k]).join(' | ')
      : 'none'));
    const tEntries = Array.from(targetCache.keys());
    L.push('target cache: ' + tEntries.length + ' entr' + (tEntries.length === 1 ? 'y' : 'ies'));
    tEntries.forEach((k) => {
      const st = targetCache.get(k);
      const r = attackReadiness(st);
      L.push('  ' + k + ' -> state=' + JSON.stringify(st.state)
        + ' level=' + (st.level > 0 ? st.level : 'ABSENT')
        + ' ' + (r.blocked ? 'BLOCKED(' + r.label + (r.until ? ', ' + fmtStatusRemaining(r.until) : '') + ')'
          : r.unknown ? 'UNKNOWN(' + r.label + ')' : 'ATTACKABLE')
        + (st.description ? '  desc=' + JSON.stringify(squish(st.description, 40)) : ''));
    });
    L.push('seatedXids: ' + Array.from(seatedXids()).join(',')
      + '  (incl. sitting out: ' + Array.from(seatedXids({ includeSittingOut: true })).join(',') + ')');
    const btns = findActionButtons();
    L.push('actionButtons by TEXT: ' + btns.length
      + (btns.length ? ' -> ' + btns.map((b) => JSON.stringify(squish(b.textContent, 20))).join(' ') : '')
      + (btns.length ? '' : '  <-- run this scan again ON YOUR TURN'));
    L.push('activeSeat: ' + (activeSeatXid() || 'NO MATCH for ' + SELECTORS.seatActive));
    L.push('seatRing: ' + ((seatRingXids() || []).join(',') || 'UNREADABLE'));
    L.push('isHeroTurn: ' + isHeroTurn() + '  isHeroNextToAct: ' + isHeroNextToAct());
    const stacks = readAllStacks();
    L.push('stacks read: ' + Object.keys(stacks).length + ' -> '
      + (Object.keys(stacks).map((x) => x + '=' + fmtMoney(stacks[x])).join(' ') || '(none)'));
    L.push('isPDA: ' + isPDA() + '  (flutter bridge: ' + (typeof window.flutter_inappwebview !== 'undefined') + ')');
    // The share bridge is the one unverified handler left here. Its contract is
    // unknown (see downloadTextFile), so the scan reports what it actually
    // returned rather than whether we think it worked — that is the only thing
    // that can settle it from a distance.
    L.push('shareFile bridge: ' + (typeof window.flutter_inappwebview !== 'undefined'
      && window.flutter_inappwebview && typeof window.flutter_inappwebview.callHandler === 'function'
      ? 'callHandler present' : 'NO callHandler')
      + (lastShareResult
        ? `  last call: returned ${lastShareResult.returned} (${lastShareResult.value})`
        : '  (not called this session — press Save / share once, then re-scan)'));
    L.push('table: ' + (tableLabel(lastSeenBB) || 'blind level not read yet')
      + (bbDisplayModeSuspected ? '  <-- BB DISPLAY MODE SUSPECTED, P/L is being withheld' : ''));
    const withShowdowns = Object.keys(STORE.players)
      .filter((x) => STORE.players[x] && Object.keys(STORE.players[x].shownHands || {}).length).length;
    L.push('showdown ranges: ' + withShowdowns + ' player(s) with at least one shown hand');
    // A reveal that parses but carries no cards is invisible: it never reaches
    // the unmatched list, and the Range tab just stays empty. Print the raw
    // reveal rows so the wording and the card shape can both be checked.
    const revealRows = (readLogRows() || []).filter((r) => /reveal|shows?\b|turns?\s+over/i.test(r));
    // Two independent sources for a showdown. If the log carries no reveal
    // line, the seats are the only evidence — run this scan WHILE cards are
    // face up at showdown to see whether they are readable there.
    const faceUp = [];
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      const cards = readSeatFaceUpCards(seat);
      if (cards.length) {
        faceUp.push((xid || '?') + (isHeroRecord(xid) ? '(you)' : '') + '='
          + cards.map((c) => c.rank + c.suit).join(''));
      }
    });
    L.push('seats showing face-up cards: ' + (faceUp.join(' ') || 'none right now'));
    L.push('shownCards captured this hand: '
      + (currentHand ? Object.keys(currentHand.shownCards).join(',') || 'none' : 'no live hand'));
    // Reveals actually BANKED, by path, over the last few recorded hands.
    // Counting reveals alone cannot say which source to fix: the seat poll can
    // miss a fast deal, the log can omit a reveals line entirely, and they fail
    // independently. A hand showing "2 at showdown, 1 revealed" quantifies the
    // gap; the seat/log split says where it is.
    const recentHands = (STORE.hands || []).slice(0, 6);
    L.push('reveals banked, last ' + recentHands.length + ' hand(s):');
    recentHands.forEach((h) => {
      const keys = Object.keys(h.shown || {});
      const via = keys.map((k) => (h.shownVia || {})[k] || '?').join(',');
      L.push('  ' + new Date(h.t).toLocaleTimeString() + '  reached ' + (h.street || '?')
        + '  reveals=' + keys.length + (keys.length ? ' via[' + via + ']' : '')
        + '  players=' + ((h.players || []).length));
    });
    L.push('reveal rows in log: ' + revealRows.length);
    revealRows.slice(0, 4).forEach((r) => {
      const line = cleanLogLine(r);
      const pat = LOG_PATTERNS.find((p) => p.re.test(line));
      const m = pat ? pat.re.exec(line) : null;
      const parsed = m && m[2] ? parseCardsFromText(m[2]) : [];
      L.push('  ' + JSON.stringify(squish(r, 110)));
      L.push('    -> ' + (pat ? pat.type : 'UNMATCHED')
        + ' -> ' + (handClassFromCards(parsed) || 'NO CARDS PARSED'));
    });
    L.push('badgeMode: ' + STORE.settings.badgeMode + ' over ' + STORE.settings.sessionWindow + ' hands');
    L.push('');

    L.push('--- SEATS ---');
    const seats = document.querySelectorAll(SELECTORS.seatContainer);
    L.push('matched: ' + seats.length);
    Array.from(seats).slice(0, 4).forEach((s, i) => {
      L.push(`seat[${i}] ${elSig(s)}`);
      const as = s.querySelectorAll('a');
      L.push(`  anchors(${as.length}): ` + (as.length
        ? Array.from(as).slice(0, 3).map((a) => a.getAttribute('href')).join(' | ')
        : 'NONE'));
      L.push('  text: ' + squish(s.textContent, 90));
    });
    L.push('');

    L.push('--- TEXT PROBES (find the log + pot) ---');
    ['POT', 'called', 'folded', 'checked', 'raised', 'blind', 'Sitting out'].forEach((needle) => {
      const hits = findByText(needle, 2);
      L.push(`probe "${needle}": ${hits.length} hit(s)`);
      hits.forEach((h) => {
        L.push('  ' + ancestry(h, 4));
        L.push('   text: ' + squish(h.textContent, 70));
      });
    });
    L.push('');

    L.push('--- HERO CARDS ---');
    const hc = document.querySelectorAll(SELECTORS.heroCards);
    L.push('matched: ' + hc.length);
    if (hc[0]) {
      L.push('aria-label: ' + hc[0].getAttribute('aria-label'));
      L.push(ancestry(hc[0], 5));
    }
    L.push('');

    L.push('--- UNMATCHED LOG LINES (most recent first) ---');
    L.push(seenUnmatchedLines.length ? seenUnmatchedLines.slice(0, 20).join('\n') : '(none captured yet)');

    return L.join('\n');
  }

  function renderCalibrationPanel() {
    if (!STORE.settings.calibrationMode) {
      // Torn down here, not only in the Settings toggle, so switching it off
      // by ANY route removes the panel: the toggle, the panel's own ✕, or an
      // imported store that carries calibrationMode: false. The toggle and the
      // ✕ still remove it immediately as well — waiting up to 3s for a tap to
      // visibly do something is its own bug.
      const stale = document.querySelector('.tph-calib');
      if (stale) stale.remove();
      return;
    }
    let el = document.querySelector('.tph-calib');
    const existingOut = el && el.querySelector('.tph-calib-out');
    const preserved = existingOut ? existingOut.value : '';
    if (!el) {
      el = document.createElement('div');
      el.className = 'tph-calib';
      document.body.appendChild(el);
    }
    const counts = Object.entries(SELECTORS).map(([key, sel]) => `${key}: ${countSel(sel)}`).join(' | ');
    el.innerHTML =
      `<span class="tph-calib-off">✕ off</span>` +
      `<b>Selector matches</b> — ${escapeHtml(counts)}<br>` +
      `<b>Log observer:</b> ${logObserver ? (logUsingFallback ? 'body fallback' : 'container') : 'NOT ATTACHED'}` +
      ` &nbsp; <b>Lines seen:</b> ${seenUnmatchedLines.length}<hr>` +
      `<button class="tph-deep">Run deep scan</button> ` +
      `<button class="tph-deep-copy">Copy report</button><br>` +
      `<textarea class="tph-calib-out" readonly placeholder="Tap 'Run deep scan', then 'Copy report' and paste it to Claude."></textarea>`;

    pinTextColor(el);
    const out = el.querySelector('.tph-calib-out');
    if (preserved) out.value = preserved;

    el.querySelector('.tph-calib-off').addEventListener('click', () => {
      STORE.settings.calibrationMode = false;
      saveStore();
      el.remove();
    });
    el.querySelector('.tph-deep').addEventListener('click', () => { out.value = runDeepScan(); });
    el.querySelector('.tph-deep-copy').addEventListener('click', async (e) => {
      if (!out.value) out.value = runDeepScan();
      // Passes `out` itself as copyText's existingEl: if even execCommand
      // fails, the report is left selected on the visible textarea, ready
      // for a manual copy — the same reasoning the Backup Copy button uses.
      const ok = await copyText(out.value, out);
      e.target.textContent = ok ? 'Copied ✓' : 'Copy failed — the box above is selected, copy it manually';
    });
  }

  // Keep a dragged element fully on screen — also re-applied on rotate/resize so
  // it can't end up stranded off the edge in the other orientation.
  // `keepVisiblePx` switches from "keep the whole element on screen" to "keep at
  // least this much of it on screen". Full containment is right for the small
  // gear button, but it pins anything approaching the viewport width: a 366px
  // panel on a 390px screen gets 24px of horizontal travel and reads as broken.
  // Wide panels pass a keep-visible margin and may hang off the edges instead.
  function setFixedPos(el, left, top, keepVisiblePx) {
    const w = el.offsetWidth || 60;
    const h = el.offsetHeight || 44;
    const keep = keepVisiblePx ? Math.min(keepVisiblePx, w, h) : 0;
    const minL = keep ? keep - w : 0;
    const maxL = keep ? window.innerWidth - keep : Math.max(0, window.innerWidth - w);
    // Never allow a negative top: dragging the header above the viewport would
    // put the only drag handle out of reach with no way to get it back.
    const maxT = keep ? window.innerHeight - keep : Math.max(0, window.innerHeight - h);
    const L = Math.min(Math.max(minL, left), Math.max(minL, maxL));
    const T = Math.min(Math.max(0, top), Math.max(0, maxT));
    el.style.left = L + 'px';
    el.style.top = T + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  // `posKey` names the settings field the position persists to, so the gear and
  // the coach panel can each remember where they were put independently.
  function applyStoredPos(el, posKey, keepVisiblePx) {
    const p = STORE.settings[posKey];
    if (p && typeof p.left === 'number' && typeof p.top === 'number') {
      setFixedPos(el, p.left, p.top, keepVisiblePx);
    }
  }

  // Clamp a size to something usable: never smaller than the caller's floor,
  // never bigger than the viewport it has to live inside. Both ends matter —
  // dragging the grip up and left could otherwise collapse the panel to nothing
  // and take its own grip with it, leaving no way to get the size back.
  function applySize(el, w, h, minW, minH) {
    const W = Math.max(minW, Math.min(Math.round(w), window.innerWidth - 8));
    const H = Math.max(minH, Math.min(Math.round(h), window.innerHeight - 8));
    el.style.width = W + 'px';
    el.style.height = H + 'px';
    return { w: W, h: H };
  }

  function applyStoredSize(el, sizeKey, minW, minH) {
    const s = STORE.settings[sizeKey];
    if (s && typeof s.w === 'number' && typeof s.h === 'number') {
      applySize(el, s.w, s.h, minW, minH);
    }
  }

  // Drag a corner grip to resize `box`, persisting to settings[sizeKey].
  //
  // opts: { sizeKey, posKey, minW, minH, keepVisiblePx }
  //
  // Deliberately a separate handle from makeDraggable's, on a separate element:
  // a single pointer stream can't mean both, and a resize that sometimes moved
  // the panel instead would be worse than no resize at all.
  //
  // `posKey` is not optional in practice. Resizing pins the panel to left/top
  // (see below), so a resize that saved only the size would leave the element
  // sitting somewhere the store has no record of, and the next rebuild would
  // put it back at the default corner at its new size.
  //
  // Pin-and-persist only happen once real movement is seen — same threshold
  // idea as makeDraggable's DRAG_THRESHOLD_PX, applied here for a different
  // reason. The grip is a 24x24 thumb target sitting right where a hand
  // reaching for Hide or scrolling the body can brush it; a zero-movement tap
  // used to pin the panel to a fixed pixel position anyway (harmless-looking,
  // since the coordinates matched wherever it already was) and PERSIST that —
  // silently trading its "always hugs the right edge" default anchor for a
  // position that would not re-hug the edge on the next rotate. Gating both
  // the pin and the write on `moved` makes a stray tap a true no-op.
  function makeResizable(handle, box, opts) {
    const { sizeKey, posKey, minW = 160, minH = 90, keepVisiblePx } = opts || {};
    let active = false;
    let moved = false;
    let pid = null;
    let startX = 0, startY = 0, startW = 0, startH = 0, startLeft = 0, startTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      active = true;
      moved = false;
      pid = e.pointerId;
      const rect = box.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      if (handle.setPointerCapture) { try { handle.setPointerCapture(pid); } catch (err) { /* ignore */ } }
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== pid) return;
      if (!moved) {
        // Pin to left/top on the FIRST real movement, using the rect captured
        // at pointerdown (unchanged since nothing has moved yet) — not on
        // pointerdown itself. Until it has been dragged the panel is anchored
        // by right/bottom, and growing a right-anchored box from its
        // bottom-right corner pushes its left edge across the screen: the
        // corner under your finger stays put and the panel appears to slide
        // rather than grow. Pinning has to happen before the first size
        // change reaches the DOM, or that first frame still slides.
        setFixedPos(box, startLeft, startTop, keepVisiblePx);
        box.classList.add('tph-sizing');
        moved = true;
      }
      applySize(box, startW + (e.clientX - startX), startH + (e.clientY - startY), minW, minH);
      e.preventDefault();
    });

    const endSize = (e) => {
      if (!active || (e.pointerId != null && e.pointerId !== pid)) return;
      active = false;
      if (handle.releasePointerCapture && pid != null) {
        try { handle.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      }
      if (!moved) return; // a tap with no drag changes nothing
      box.classList.remove('tph-sizing');
      const rect = box.getBoundingClientRect();
      STORE.settings[sizeKey] = { w: Math.round(rect.width), h: Math.round(rect.height) };
      if (posKey) STORE.settings[posKey] = { left: rect.left, top: rect.top };
      saveStore();
    };

    handle.addEventListener('pointerup', endSize);
    handle.addEventListener('pointercancel', endSize);
  }

  // Drag to move, tap to open settings. A small movement threshold separates the
  // two, so a slightly-imprecise tap still opens the panel instead of nudging
  // the button and doing nothing.
  const DRAG_THRESHOLD_PX = 6;

  // opts: { onTap, posKey, moveEl, keepVisiblePx }
  // `moveEl` lets a small handle drag a larger element — the coach panel is
  // dragged by its header bar so the advice text underneath stays selectable
  // and an accidental touch on the body doesn't shove the panel across the table.
  // Defaults to the handle itself, which is what the gear button wants.
  function makeDraggable(el, opts) {
    const { onTap, posKey, moveEl, keepVisiblePx } = opts || {};
    const box = moveEl || el;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, pid = null;

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      pid = e.pointerId;
      const rect = box.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      if (el.setPointerCapture) { try { el.setPointerCapture(pid); } catch (err) { /* ignore */ } }
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pid) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
      if (!moved) box.classList.add('tph-dragging');
      moved = true;
      setFixedPos(box, originLeft + dx, originTop + dy, keepVisiblePx);
      e.preventDefault();
    });

    const endDrag = (e) => {
      if (!dragging || (e.pointerId != null && e.pointerId !== pid)) return;
      dragging = false;
      box.classList.remove('tph-dragging');
      if (el.releasePointerCapture && pid != null) {
        try { el.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      }
      if (moved) {
        const rect = box.getBoundingClientRect();
        STORE.settings[posKey] = { left: rect.left, top: rect.top };
        saveStore();
      } else if (onTap) {
        onTap();
      }
    };

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }

  // Loud, because silent data loss is the failure this exists to prevent — but
  // `pointer-events: none`, because it covers the top of the table and the rule
  // there is absolute: one tap swallowed on Fold or Call is worse than any
  // warning is good. Same constraint as the turn-cue overlay.
  //
  // Idempotent, so it can be called from the save path as often as that fires.
  function renderStorageWarning() {
    const existing = document.querySelector('.tph-storage-warn');
    if (existing) existing.remove();
    const gear = document.querySelector('.tph-gear');
    if (gear) gear.classList.toggle('tph-storage-bad', !!saveFailure);
    if (!saveFailure) return;
    const el = document.createElement('div');
    el.className = 'tph-storage-warn';
    el.textContent = '⚠ HUD storage is full — nothing is being saved. Settings → Storage.';
    document.body.appendChild(el);
  }

  function renderGear() {
    const gear = document.createElement('div');
    gear.className = 'tph-gear';
    gear.innerHTML = '⚙ <span>HUD</span>';
    gear.title = 'Tap to open settings — drag to move';
    document.body.appendChild(gear);
    applyStoredPos(gear, 'gearPos');
    makeDraggable(gear, {
      onTap: () => { settingsOpen = !settingsOpen; renderSettingsPanel(); },
      posKey: 'gearPos',
    });

    window.addEventListener('resize', () => {
      const rect = gear.getBoundingClientRect();
      setFixedPos(gear, rect.left, rect.top);
      const coach = document.querySelector('.tph-coach');
      if (coach) {
        // Size first, then position — a panel sized for landscape is wider than
        // a portrait viewport, and setFixedPos measures the element it is
        // clamping. Not gated on coachPos: a resized panel needs re-clamping on
        // rotate whether or not it was ever dragged.
        if (STORE.settings.coachSize) applyStoredSize(coach, 'coachSize', COACH_MIN_W, COACH_MIN_H);
        if (STORE.settings.coachPos) {
          const cr = coach.getBoundingClientRect();
          setFixedPos(coach, cr.left, cr.top, COACH_KEEP_VISIBLE_PX);
        }
      }
      // Both pills, not just the coach's. A rotate that narrows the viewport
      // can leave either of them off screen, and the departure pill is the one
      // carrying a time-limited alert — it is the worse one to lose.
      [['.tph-coach-pill', 'coachPillPos'], ['.tph-depart-pill', 'departPillPos']].forEach(([sel, key]) => {
        const pill = document.querySelector(sel);
        if (!pill || !STORE.settings[key]) return;
        const pr = pill.getBoundingClientRect();
        setFixedPos(pill, pr.left, pr.top, PILL_KEEP_VISIBLE_PX);
      });
    });
  }

  // ===========================================================================
  // TEST SEAM
  // ===========================================================================

  // Every QA harness this repo has used recovered functions by slicing the
  // source with indexOf/eval. That breaks the moment anything is renamed or a
  // const moves — several harnesses broke mid-session for exactly that reason,
  // and one silently reported false passes because a regex matched the wrong
  // chart. Harnesses import this instead: one explicit surface that renames
  // travel through, so a break is a compile error rather than a silent miss.
  //
  // Gated on a flag the harness sets BEFORE loading the file, so the live HUD
  // never carries the global and no user-facing setting exists to get toggled
  // by accident. Production cost is one falsy property read at startup.
  //
  // This is a test surface, not an API: add to it freely, and expect callers in
  // test/ to be updated in the same commit when something here is renamed.
  if (window.__TPH_TEST_HOOKS) {
    window.__TPH_TEST = {
      // --- pure logic: no DOM, no STORE ---
      downloadTextFile,
      copyText,
      exportJson,
      GistSync,
      syncStatusText,
      gistUrl,
      GIST_FILENAME,
      GITHUB_API,
      LOG_PATTERNS,
      LOG_NOISE_RE,
      cleanLogLine,
      cleanName,
      containsNameToken,
      parseAmount,
      RFI_RANGES,
      THREE_BET_RANGES,
      FOUR_BET_RANGE,
      rfiChartFor,
      expandRangeToken,
      preflopBaseline,
      evaluate7,
      estimateEquity,
      estimateEquityCached,
      equityJobInit,
      equityJobStep,
      equityJobValue,
      estimateEquitySliced,
      equityCache,
      equityCacheKey,
      clampEquityIters,
      equityStdErr,
      potOddsVerdict,
      EQUITY_VERDICT_SIGMA,
      EQUITY_ITERS_MIN,
      EQUITY_ITERS_MAX,
      DEFAULT_SETTINGS,
      get onEquityReady() { return onEquityReady; },
      set onEquityReady(v) { onEquityReady = v; },
      opponentRangeProxy,
      equityBasisLabel,
      parseAffiliationProfile,
      repairAffiliationCache,
      handNotability,
      handHadNoAggression,
      fullHistoryExport,
      pushLedgerEntry,
      plLedgerExportCsv,
      PL_LEDGER_CAP,
      openMailto,
      get lastShareResult() { return lastShareResult; },
      exportActionsHtml,
      wireExportActions,
      heroPlayedHand,
      HISTORY_TAG_ME,
      HISTORY_TAG_TITLES,
      HH_ACT,
      actionStyle,
      filterHandsFor,
      HISTORY_FILTERS,
      HAND_TAG_KEYS,
      NOTABLE_SCORE_MIN,
      BIG_POT_BB,
      BIG_POT_MEDIAN_MULT,
      parseTargetStatus,
      attackReadiness,
      ATTACK_BLOCKERS,
      fmtStatusRemaining,
      targetStatusFor,
      refreshSeatedTargetStatus,
      requestTargetStatus,
      dropStaleHeroGhost,
      streetLeader,
      liveAggressor,
      currentExploitTips,
      spreadEdge,
      thresholdEdge,
      tipFatiguePenalty,
      noteTipShown,
      tipFatigue,
      EXPLOIT_RELEVANT_BONUS,
      EXPLOIT_IRRELEVANT_PENALTY,
      EXPLOIT_PROVISIONAL_PENALTY,
      tipSpotKey,
      poolTipSpread,
      computePoolTipSpread,
      POOL_TIP_SPREAD_TTL_MS,
      tipBaseScore,
      TIP_FATIGUE_STEP,
      TIP_FATIGUE_MAX,
      TIP_FATIGUE_MS,
      EXPLOIT_EDGE_SPAN,
      EXPLOIT_EDGE_NEUTRAL,
      COACH_TIPS_SHOWN,
      noteSeatDepartures,
      noteTableChange,
      DEPARTURE_BURST_MAX,
      departedList,
      departedAlertable,
      dismissDeparture,
      clearDepartures,
      departedWatch,
      DEPARTED_WATCH_MS,
      DEPARTED_MAX,
      get lastSeatedSnapshot() { return lastSeatedSnapshot; },
      set lastSeatedSnapshot(v) { lastSeatedSnapshot = v; },
      pdaCall,
      PDA_CALL_TIMEOUT_MS,
      seedBlindFromVisibleLog,
      tickStep,
      tickErrors,
      repairBoardFromDom,
      boardIsPartial,
      dedupeCards,
      BOARD_COUNT_FOR,
      targetDiagnostic,
      targetCache,
      apiProbe,
      probeFetch,
      targetProbe,
      spyProbe,
      parseSpyStats,
      spyCache,
      spyStatsFor,
      requestSpyStats,
      refreshSeatedSpyStats,
      spyDiagnostic,
      spyStatsLabel,
      spyStatsDetail,
      fmtStatNum,
      fmtSpyAge,
      SPY_REFRESH_MS,
      attackUrl,
      profileUrl,
      numericHandShorthand,
      cardToNum,
      handToShorthand,
      parseRange,
      rotateToBlinds,
      seatLabel,
      computeRates,
      computeShrunkRates,
      streetRates,
      shownRange,
      noteShowdown,
      shrunkPct,
      POOL_AVG,
      PRIOR_WEIGHT,
      RECENT_PRIOR_WEIGHT,
      blendedRates,
      ARCHETYPE_RULES,
      POOL_SPREAD,
      deviation,
      statRow,
      plShort,
      isHeroRecord,
      playersSortValue,
      TORN_STAKES,
      MIN_PLAUSIBLE_BB,
      plausibleBB,
      tableNameForBB,
      stakeTierForBB,
      tableLabel,
      pushRecent,
      sessionRates,
      tiltRead,
      heatRead,
      sessionWinRate,
      recentTrendPoints,
      sparklineSvg,
      TREND_WINDOW_HANDS,
      handsSinceBigLoss,
      tiltWindowSize,
      tiltText,
      heatText,
      RECENT_MAX,
      RECENT_WON,
      TILT_VPIP_JUMP,
      TILT_VPIP_JUMP_AFTER_LOSS,
      TILT_WINDOW_MAX,
      BIG_LOSS_BB,
      BIG_LOSS_MEMORY_HANDS,
      HEAT_WIN_PCT,
      isFoldControl,
      foldGuardHandler,
      FOLD_ARM_MS,
      FOLD_MIN_GAP_MS,
      get foldArmedAt() { return foldArmedAt; },
      set foldArmedAt(v) { foldArmedAt = v; },
      handRoles,
      roleTagText,
      handClassFromCards,
      noteShowdown,
      noteBetTexture,
      categoryAt,
      hasDrawAt,
      pushTextureSize,
      TEXTURE_BET_HISTORY_MAX,
      betSizePctOf,
      TEXTURE_MIN,
      harvestShownCards,
      readSeatFaceUpCards,
      get currentHand() { return currentHand; },
      set currentHand(h) { currentHand = h; },
      shownRange,
      buildRangeHtml,
      buildExploitPlan,
      buildLeakPlan,
      handContextTokens,
      entryRelevance,
      buildCoachAdvice,
      trackStacks,
      stackSwingBB,
      stackBarHtml,
      BET_SIZE_MIN,
      BET_SIZE_HISTORY_MAX,
      median,
      betSizeSample,
      BOARD_FLAGS,
      BOARD_TEX_MIN,
      BOARD_COUNT_FOR,
      boardFlags,
      fourToAStraight,
      noteBoardTexture,
      boardTexRates,
      poolBoardTexture,
      backfillBoardTexture,
      noteBetSizing,
      touchSession,
      maybeRollSession,
      sessionNetBB,
      archiveSession,
      ensureSessionShape,
      SESSION_GAP_MS,
      SESSION_HISTORY_MAX,
      SESSION_TREND_POINTS,
      SESSION_TABLE_ROWS,
      buildSessionTrendsHtml,
      resetHeroStats,
      resetProfitLoss,
      resetAllData,
      mergeStores,
      loadStore,
      importJson,
      // Exposed so a test can assert a CSS invariant that only the stylesheet
      // can guarantee — e.g. the storage banner's pointer-events: none.
      CSS,
      saveStore,
      prunePlayers,
      maybePrune,
      PRUNE_THIN_HANDS,
      PRUNE_THIN_DAYS,
      PRUNE_MAX_DAYS,
      PRUNE_PLAYER_CAP,
      PRUNE_MIN_INTERVAL_MS,
      get lastPruneCheck() { return lastPruneCheck; },
      set lastPruneCheck(v) { lastPruneCheck = v; },
      storageStats,
      storageSettingsHtml,
      renderStorageWarning,
      fmtBytes,
      STORAGE_QUOTA_EST,
      STORAGE_WARN_PCT,
      get saveFailure() { return saveFailure; },
      set saveFailure(v) { saveFailure = v; },
      tablesPlayed,
      recentTablesOf,
      noteRecentTable,
      shortAgo,
      RECENT_TABLES_MAX,
      buildExploitHtml,
      currentExploitTip,
      parseCardsFromText,
      parseCardEl,
      classify,
      classifyProvisional,
      shortType,
      ARCHETYPE_SHORT,
      A,
      observedPoolAverages,
      poolStakesBreakdown,
      ACTION_BTN_RE,
      isPDA,
      playTurnChime,
      playTurnEscalationChime,
      fmtMoney,
      fmtSignedMoney,
      fmtBB,
      fmtNum,
      badgePct,
      fmtBB100,
      streetRates,
      ensureHeroShape,
      get lastSeenBB() { return lastSeenBB; },
      set lastSeenBB(v) { lastSeenBB = v; },
      STORE_VERSION,
      migrateStore,
      HUD_VERSION,
      ACTION_BTN_RE,
      PREACTION_BTN_RE,
      findActionButtons,
      findTurnButtons,
      fileSafeName,
      applySize,
      SELF_BADGE_LIFT_PX,
      BADGE_HEIGHT_PX,
      COACH_MIN_W,
      COACH_MIN_H,
      TURN_ESCALATE_MS,
      shouldEscalateTurnCue,

      // --- stateful: reads or writes module-level STORE / heroXid ---
      playerHistoryExport,
      poolTendencyExport,
      handsInvolving,
      formatHand,
      formatHandHtml,
      recordHandHistory,
      replayStepsFor,
      replayPreflopRaiseLevel,
      replayStepEquity,
      cardGlyph,
      cardsGlyphText,
      isNotableHand,
      trimHandHistory,
      mergeHands,
      NOTABLE_POT_BB_THRESHOLD,
      NOTABLE_PREFLOP_RAISE_BB,
      HISTORY_PINNED_CEILING,
      nameToXidGuess,
      heroUnresolved,
      findHeroXid,
      rememberHeroXid,
      affiliationFlags,
      refreshSeatedAffiliations,
      // Exposed as accessors because STORE and heroXid are rebound, not
      // mutated — a plain reference would freeze at whatever loaded first.
      applyHandResults,
      freshHandState,
      handleLogLine,
      getPlayer,
      emptyStore,
      emptyPlayer,

      // --- DOM-touching, exercised against the harness's minimal document ---
      renderPanel,
      renderDepartedPill,
      PILL_KEEP_VISIBLE_PX,
      get departedPanelOpen() { return departedPanelOpen; },
      set departedPanelOpen(v) { departedPanelOpen = v; },
      get STORE() { return STORE; },
      set STORE(s) { STORE = s; },
      get heroXid() { return heroXid; },
      set heroXid(x) { heroXid = x; },
    };
  }

  // ===========================================================================
  // BOOTSTRAP
  // ===========================================================================

  function init() {
    injectStyles();
    renderGear();
    // Wire the equity engine's completion hook to the panel that consumes it.
    // Done here rather than at the call site so the engine itself stays free
    // of any dependency on the UI — see onEquityReady.
    onEquityReady = renderCoachPanel;
    // Before the watchers, so the first hand of the session already has the
    // history-seeded figures behind it rather than starting from zero.
    backfillBoardTexture();
    // Discards affiliation timestamps written while the transport was broken,
    // so the badges do not stay dead for up to 24h after the fix. Once only.
    repairAffiliationCache();
    bootstrapTableWatchers();

    setInterval(renderBadges, 4000);
    setInterval(renderCoachPanel, 1500);
    // Faster than the coach panel: a turn cue that arrives 1.5s late has missed
    // a meaningful slice of the decision clock. Cheap — one button sweep.
    setInterval(renderTurnCue, 400);
    // Always armed, NOT gated on the setting being on at load — that gate was
    // open finding #4. Toggling calibration on mid-session rendered the panel
    // once and then never refreshed it, so the live selector counts (the
    // entire point of the panel) sat frozen at whatever they were the moment
    // it opened, and looked like selectors that had stopped matching.
    // renderCalibrationPanel returns immediately when the setting is off, so
    // always arming this costs one property read every 3s.
    setInterval(renderCalibrationPanel, 3000);

    // Badges are anchored to seat positions via getBoundingClientRect(), which
    // goes stale on scroll/orientation change well before the 4s interval —
    // recompute on those events (frame-coalesced) instead of waiting.
    window.addEventListener('scroll', scheduleBadgeRender, { passive: true });
    window.addEventListener('resize', scheduleBadgeRender);

    // Capture phase, so the guard sees the tap before Torn's own React handler
    // does and can stop it reaching the game. Everything it does is gated on
    // the setting and wrapped in try/catch — see foldGuardHandler.
    document.addEventListener('click', foldGuardHandler, true);
    // Any tap satisfies the browser's autoplay policy, so the first chime of a
    // session isn't silently dropped. Passive and non-capturing: this must
    // never influence a click.
    document.addEventListener('pointerdown', primeAudio, { passive: true, capture: false });

    if (STORE.settings.githubToken && STORE.settings.gistId) {
      GistSync.status = 'connected';
      GistSync.syncNow();
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  }
})();
