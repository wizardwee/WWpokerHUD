// ==UserScript==
// @name         Torn Poker HUD
// @namespace    torn-poker-hud
// @version      0.18.1
// @description  Opponent tendency HUD, GTO-inspired coach prompts, per-player P/L, and tendency reports for Torn holdem, built for Torn PDA custom scripts.
// @match        *://www.torn.com/page.php?sid=holdem*
// @match        *://torn.com/page.php?sid=holdem*
// @grant        none
// ==/UserScript==

/*
 * CHANGELOG (newest first). Bump @version above in the SAME commit as any
 * behaviour change — nothing automates it, and userscript managers compare
 * @version to decide whether an update exists. A stale value means a reinstall
 * won't see new code as newer.
 *
 * 0.18.1 - Hand history text was dark-on-dark on the live page. Two class-based
 *          attempts failed (a recessed card relying on inherited colour, then a
 *          lighter card with !important in our own stylesheet) while the Stats
 *          tab in the SAME panel rendered fine — which rules out the panel and
 *          inheritance, and means a Torn rule was beating ours on specificity.
 *          Colours are now inline with !important, the highest-priority
 *          declaration in CSS, so no page stylesheet can override them. The
 *          Report tab's <pre> is pinned the same way, since bare elements like
 *          <pre> are exactly what a page stylesheet is most likely to target.
 *          Layout is unchanged — only the colours are forced.
 * 0.18.0 - Fixes from the first live deep scan (v0.17.0, 5-handed table).
 *          The coach was printing "defend roughly NaN% of your range (MDF)":
 *          minimumDefenseFrequency computed pot/(pot+bet), and BOTH were zero
 *          because the log snapshot is primed rather than parsed on attach, so
 *          hand.pot starts at 0 whenever the HUD loads mid-hand. It returns null
 *          now and the coach says the pot is unknown instead of printing NaN.
 *          Root fix: the pot is read from the table. The scan confirmed
 *          DIV.potsWrapper_ > DIV.totalPotWrap_ renders "POT:$7,000,000", so
 *          readDomPot parses it and effectivePot prefers it over the running log
 *          sum. This closes the longest-standing known gap — the pot previously
 *          had NO cross-check, and any missed amount skewed pot odds and MDF for
 *          the rest of the hand with nothing to detect it.
 *          Equity was quoted "vs 8 (9-max)" at a five-handed table because the
 *          baseline came from the tableMax setting; it now uses the seat count
 *          observed that hand. Sub-1% equity printed a flat "0%", which reads as
 *          "cannot win" rather than "under one percent" — it shows "<1%" now.
 *          Deep scan reports both pot figures and flags a mismatch, plus heroXid
 *          and why it failed to resolve.
 * 0.17.0 - Per-opponent P/L was wrong, not just badly formatted. Each opponent's
 *          share was their contribution divided by the total contributed
 *          INCLUDING hero's own, so the shares never summed to 1 — heads-up,
 *          where both players put in half the pot, a villain was credited with
 *          exactly HALF the money you won from them. It also charged your losses
 *          to opponents who folded early and lost nothing to you, while
 *          crediting nothing extra to whoever actually took the pot. Attribution
 *          now splits by each opponent's NET result: money you win comes from
 *          the players who lost, money you lose goes to the players who won.
 *          Exact heads-up, and sums to your own delta multiway.
 *          Money now goes through one formatter everywhere — "$12.5M", "$41k",
 *          "$9,999" — replacing bare digit strings with no grouping at all,
 *          which is what the P/L readouts in the Stats tab and report printed.
 *          Failure to identify hero is surfaced in Settings and the players
 *          list. With heroXid null, P/L attribution is skipped for EVERY player
 *          and a tendency badge is drawn on your own seat; those look like two
 *          separate bugs and are the same unset/misspelled username.
 * 0.16.1 - Deep scan reports the script version that produced it, via
 *          HUD_VERSION (which must be bumped alongside @version — the userscript
 *          header is a metadata comment and can't be read from JS).
 * 0.16.0 - Usernames are actually recorded. Hand history showed "#3722665"
 *          instead of names because nothing ever bound a name to an XID:
 *          getPlayer(xid, name) accepts a name and was never once called with
 *          one, so emptyPlayer() stored its "#<xid>" placeholder as the player's
 *          real name and playerDisplayName returned it forever. The name was
 *          known at the point nameToXidGuess resolved the seat and was simply
 *          discarded. Two sources now feed it: that resolution point, and
 *          harvestSeatNames, which reads the seat's own name element —
 *          SELECTORS.seatName was declared and read by nothing until now, so a
 *          player who never acted was never named either. Records already
 *          holding the placeholder repair themselves on sight, and hand history
 *          re-renders correctly because it stores XIDs, not names.
 * 0.15.0 - Position is read from HERO'S SEAT, not from the action. It used to
 *          assume "hero must be the next seat to act" whenever hero wasn't yet
 *          in the log's action rotation — true only at hero's own decision
 *          point, but the coach re-renders continuously (actionButtons matches
 *          nothing, so it falls back to "hole cards visible"), so the index grew
 *          with every opponent who acted and the label followed whoever was on
 *          action. Seats are now ordered by their on-screen geometry and rotated
 *          so the small blind is first, with the big blind fixing the direction;
 *          the log rotation is a fallback used only once hero has really acted.
 *          heroIsInPositionVs had the same flaw and silently picked the looser
 *          in-position 3-bet chart; it now uses the seat ring or returns unknown.
 *          Seat badges show a TYPE again — below the hand minimum they show the
 *          provisional archetype with a "?" instead of just "13h", which said
 *          nothing about the player. History cards and the panel now pin their
 *          own colours (!important, no inherited text colour, card LIGHTER than
 *          the panel) because Torn's stylesheet was leaving them unreadable.
 * 0.14.0 - Hand history in the player panel is rendered as one block per hand
 *          instead of up to 40 hands run together in a single monospace <pre>
 *          on the panel's own background; the tracked player's actions are
 *          coloured rather than marked with an asterisk. Clipboard output is
 *          unchanged (still plain text).
 *          Review fixes: (1) seat counting ignored the "name:" pseudo-ids that
 *          nameToXidGuess falls back to, so ONE unmatched log name inflated the
 *          table size by one and shifted every position label by a seat —
 *          exactly the drift the position notes describe; (2) cross-device hand
 *          merging deduped on timestamp, so two devices at one table recorded
 *          every shared hand twice — it now prefers Torn's game id; (3) a
 *          player record missing a street inside streetActions threw in
 *          computeRates and took the panel down, and records are now repaired at
 *          load rather than only on getPlayer access, since renderBadges and the
 *          players list read STORE.players directly.
 * 0.13.0 - Preflop charts re-grounded in published sources instead of recall,
 *          and full-ring support added. There are now TWO chart sets, picked
 *          from the seat count observed that hand: at a 9-handed table four
 *          distinct early seats used to share one "EP" label and one 6-max
 *          chart, so true UTG was opening ~17% where published full-ring UTG is
 *          ~11%. Positions at 7+ handed tables are named UTG/UTG1/LJ/HJ/CO/BTN.
 *          6-max early position widened to match sources (EP 15.5->17.3%,
 *          MP 19.5->21.0%). Every published range string was re-measured against
 *          its own published percentage before use — several disagree with
 *          themselves, usually by omitting the offsuit block. Sources cited at
 *          RFI_RANGES. "GTO baseline" relabelled "Baseline" with a provenance
 *          footnote: these are reference charts, not solver output, and the old
 *          wording claimed the authority of an equilibrium solution.
 * 0.12.0 - Preflop coach corrected. Every opening chart but the button was far
 *          too tight (EP 10.3%, MP 14.3%, CO 22.8%, SB 30.9% of hands), so it
 *          advised folding standard opens; they are now 15.5/19.5/26.4/41.8/
 *          42.1%, measured by combo weight and documented per line. The chart is
 *          now picked by SITUATION, not by whether a bet exists: unopened,
 *          limped (isolation, not RFI), facing one open, facing a re-raise, and
 *          hero-already-opened are separate cases. The out-of-position 3-bet
 *          range was defined but never used — every 3-bet call was made off the
 *          in-position chart; unknown relative position now takes the tighter
 *          one. Big blind no longer silently borrows the cutoff opening range.
 *          Facing a 3-bet is called a 4-bet decision instead of a 3-bet. Fixed
 *          the "A5s-A9s" range token, whose backreferences were on the wrong
 *          groups so it expanded to nothing without error.
 * 0.11.0 - Log ingestion reads whole-list snapshots and diffs them instead of
 *          parsing MutationObserver added-nodes. Torn rewrites the TEXT of
 *          existing <li> rows as the list shifts, so every old line was seen
 *          again on every new line and the 1.5s text dedup couldn't suppress it
 *          — one real hand landed in the history several times and every stat
 *          was inflated with it. Hand records also carry the "Game <hex>" id now
 *          and a repeated id is ignored. Seat badges moved BELOW the seat (they
 *          were covering the player name), restyled to be unobtrusive, and can
 *          be switched off in Settings. The collapsed GTO pill is draggable like
 *          the expanded panel; it previously had no drag handler at all.
 * 0.10.0 - Hand boundaries now match Torn's real "Game <hex> started" wording;
 *          before this no hand ever ended, so actionOrder accumulated across
 *          hands and every derived position was nonsense. Streets match
 *          "The flop:  5c, 7d, Ad" (definite article, double space), so the
 *          board is read from the log and the street advances. Showdowns say
 *          "reveals". Preflop position is inferred from turn order when hero
 *          hasn't acted yet, rendered as "CO?" to mark it as inferred; table
 *          size comes from the seats so a sit-out no longer shifts every label.
 *          Position-unknown now names the precondition that actually failed
 *          instead of always blaming the username.
 * 0.9.0  - Selectors calibrated against a live deep scan: log rows are read via
 *          the enclosing <li> (the actor lives in a sibling span, and reading
 *          the mutated inner span alone dropped the name, which is why no stat
 *          ever recorded). Seats identified by id="player-<XID>" rather than
 *          absent profile links. Class matching switched to a single trailing
 *          underscore, since Torn emits both name___hash and name_hash.
 *          Coach panel gained a header to drag it and a Hide toggle; equity is
 *          always quoted against a full ring plus live and heads-up counts.
 * 0.8.0  - Fix dead stats pipeline, past-tense log parsing, sync crash.
 * 0.6.0  - Equity engine, position detection, hero identity, session tracking,
 *          bet-sizing tells. (0.7.0 was never released.)
 * 0.5.1  - Never export or sync the GitHub token.
 * 0.5.0  - Hand history recording + tracked-players browser.
 * 0.4.0  - Draggable HUD button, position persisted.
 * 0.3.0  - Deep-scan DOM inspector + body-fallback log observer.
 * 0.2.0  - Initial: opponent tendency HUD, coach prompts, per-player P/L,
 *          Gist sync.
 *
 * KNOWN UNRESOLVED: actionButtons and dealerButton match nothing on the live
 * table. dealerButton is a red herring for position — it is declared in
 * SELECTORS and referenced nowhere else; position comes from the log.
 *
 * KNOWN GAPS (reviewed, deliberately not fixed — see CLAUDE.md for the reasoning):
 *  - The pot is tracked ONLY by summing parsed log amounts. SELECTORS.potDisplay
 *    resolves on the live table and is never read, so there is no cross-check:
 *    one missed or unparsed amount silently skews pot odds and MDF for the rest
 *    of the hand, with nothing to notice it.
 *  - STORE.players grows without bound. `lastSeen` is written on every access
 *    and never read, so nothing prunes players you met once. localStorage
 *    failures are caught and logged, which means hitting quota stops saving
 *    silently rather than telling you.
 *  - Calibration mode's 3s refresh only starts if the setting was already on at
 *    load; enabling it mid-session gives a panel that updates on log lines only.
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
  const HUD_VERSION = '0.18.1';

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

  /**
   * Torn PDA exposes PDA_httpGet / PDA_httpPost for cross-origin requests
   * instead of fetch/XHR. Signature isn't fully documented publicly, so this
   * adapter is the single place to patch if the real call shape differs.
   * Falls back to plain fetch so the rest of the script (and Gist sync) can
   * also be exercised in a normal desktop browser during development.
   */
  async function pdaFetch(method, url, { headers = {}, body } = {}) {
    const hasPdaGet = typeof window.PDA_httpGet === 'function';
    const hasPdaPost = typeof window.PDA_httpPost === 'function';

    if (method === 'GET' && hasPdaGet) {
      return new Promise((resolve, reject) => {
        try {
          window.PDA_httpGet(url, headers, (result) => {
            resolve(normalizePdaResponse(result));
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    if (method !== 'GET' && hasPdaPost) {
      return new Promise((resolve, reject) => {
        try {
          window.PDA_httpPost(url, headers, body, (result) => {
            resolve(normalizePdaResponse(result));
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    const resp = await fetch(url, { method, headers, body });
    const text = await resp.text();
    return { status: resp.status, text };
  }

  function normalizePdaResponse(result) {
    if (result == null) return { status: 0, text: '' };
    if (typeof result === 'string') return { status: 200, text: result };
    return { status: result.status || 200, text: result.body || result.text || JSON.stringify(result) };
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

  const DEFAULT_SETTINGS = {
    minHands: 20,
    githubClientId: '',
    githubToken: '',
    gistId: '',
    lastSync: 0,
    calibrationMode: false,
    gearPos: null, // {left, top} once you've dragged the HUD button somewhere
    coachPos: null,      // {left, top} once you've dragged the coach panel
    coachPillPos: null,  // {left, top} for the collapsed pill — tracked separately
                         // from coachPos so collapsing doesn't teleport the pill
                         // to wherever the big panel happened to be parked
    coachHidden: false,  // collapsed to a pill so it stops covering the table
    showBadges: true,    // per-seat tendency labels; off = table completely clear
    historyLimit: 200, // how many recent hands to keep for the History tab
    heroName: '',      // YOUR Torn username. Without it P/L and position can't be attributed.
    equityIters: 1200, // Monte Carlo samples per equity estimate
    tableMax: 9,       // seats at a full table — the baseline equity is always
                       // quoted against a full ring (tableMax - 1 opponents)
  };

  function emptyStore(settings) {
    return {
      version: 1,
      players: {},
      hands: [],   // newest-first ring buffer of recent hand records
      hero: { hands: 0, netChips: 0 },
      session: { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 },
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
      wtsd: 0,
      plChipsEst: 0,
      betSizePctSum: 0, // sum of bet-as-%-of-pot, for average sizing tells
      betSizeCount: 0,
      notes: '',
      lastSeen: 0,
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
      parsed.hero = parsed.hero || { hands: 0, netChips: 0 };
      parsed.session = parsed.session || { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 };
      normalizePlayers(parsed);
      return parsed;
    } catch (e) {
      console.warn('[TornPokerHUD] Corrupt storage, resetting.', e);
      return emptyStore();
    }
  }

  let STORE = loadStore();
  let saveScheduled = false;

  function saveStore() {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(() => {
      saveScheduled = false;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STORE)); } catch (e) { console.warn('[TornPokerHUD] Save failed', e); }
    }, 250);
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
    return p;
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
  const LOCAL_ONLY_SETTINGS = ['githubToken'];

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
    parsed.hero = parsed.hero || { hands: 0, netChips: 0 };
    parsed.session = parsed.session || { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 };
    normalizePlayers(parsed); // imported JSON is hand-editable and often stale
    STORE = parsed;
    saveStore();
  }

  function resetAllData() {
    STORE = emptyStore({ ...STORE.settings });
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
  function mergeHands(a, b, limit) {
    const seen = new Set();
    return a.concat(b)
      .filter((h) => {
        if (!h) return false;
        const k = h.g ? 'g:' + h.g : 't:' + h.t + ':' + (h.pot || 0);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((x, y) => y.t - x.t)
      .slice(0, limit || 200);
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
  };

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
    heroSeat: '[class*="hero_"], [class*="you_"]',
    heroCards: '[class*="hand_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    communityCards: '[class*="communityCards_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    potDisplay: '[class*="totalPotWrap_"], [class*="potsWrapper_"]',
    actionButtons: '[class*="actionButtons_"] button, [class*="controls_"] button',
    // UNUSED. Position is derived entirely from the log (blind posts + preflop
    // action order — see buildRotation), never from the dealer button. Kept only
    // as a calibration probe; resolving it fixes nothing on its own.
    dealerButton: '[class*="dealerButton_"], [class*="buttonIcon_"]',
  };

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
    // Showdowns read "_AY_  reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)".
    { type: 'shows', re: /^(.+?)\s+(?:show(?:s|ed)?|reveals?)\s+(.+)/i },
    { type: 'wins', re: /^(.+?)\s+w(?:ins?|on)\b(?:\s+the\s+pot)?(?:\s*\$?([\d,]+))?/i },
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

  let heroXid = null;
  let currentHand = null;
  const seenUnmatchedLines = []; // for calibration panel

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
      playersIn: new Set(dealtIn), // mutable — shrinks as players fold, used for opportunity counts
      winners: [],             // {xid, amount}[] — supports split pots, applied at hand end
      actions: [],             // {x,a,amt,s}[] — replayable action log for the History tab
      shown: {},               // xid -> cards revealed at showdown
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
      countedPfr: new Set(),
      countedThreeBetOpp: new Set(),
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

  function seatedXids() {
    const xids = new Set();
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (xid) xids.add(xid);
    });
    return xids;
  }

  // Identifying "you" from the DOM is unreliable (this table renders no hero
  // marker), and with heroXid null NO profit/loss is attributed at all — so a
  // username typed into Settings takes priority over any DOM guess.
  function findHeroXid() {
    const configured = (STORE.settings.heroName || '').trim();
    if (configured) return nameToXidGuess(configured);
    const heroSeat = document.querySelector(SELECTORS.heroSeat);
    if (heroSeat) {
      const xid = resolveXidFromSeat(heroSeat);
      if (xid) return xid;
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
    // a substring test alone would resolve "Joe" to a "Joey" seat, or match a
    // name that happens to appear inside a stat overlay rather than the seat's
    // own profile link.
    const seats = Array.from(document.querySelectorAll(SELECTORS.seatContainer));

    for (const seat of seats) {
      const link = seat.querySelector(SELECTORS.seatNameLink);
      if (link && (link.textContent || '').trim() === name) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    for (const seat of seats) {
      if ((seat.textContent || '').includes(name)) {
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
      if (type === 'postSB') hand.sbXid = xid; else hand.bbXid = xid;
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
      return;
    }

    if (type === 'bet') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      noteBetSizing(xid, amt, hand.pot); // pot BEFORE this bet
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'bet', hand);
      logAction(hand, xid, 'bet', amt);
      maybeCountVpip(xid, hand);
      markAggressor(xid, hand);
      maybeCountCbet(xid, hand);
      return;
    }

    if (type === 'raise') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      noteBetSizing(xid, amt, hand.pot); // pot BEFORE this raise
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'raise', hand);
      logAction(hand, xid, 'raise', amt);
      maybeCountVpip(xid, hand);
      if (hand.street === 'preflop') hand.preflopRaiseEvents += 1;
      maybeCountPfr(xid, hand);
      maybeCountThreeBet(xid, hand);
      markAggressor(xid, hand);
      return;
    }

    if (type === 'allin') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      if (amt) { noteBetSizing(xid, amt, hand.pot); addContribution(hand, xid, amt); }
      recordStreetAction(xid, 'raise', hand);
      logAction(hand, xid, 'all-in', amt);
      maybeCountVpip(xid, hand);
      if (hand.street === 'preflop') hand.preflopRaiseEvents += 1;
      maybeCountPfr(xid, hand);
      maybeCountThreeBet(xid, hand);
      markAggressor(xid, hand);
      return;
    }

    if (type === 'flop' || type === 'turn' || type === 'river') {
      hand.street = type;
      hand.streetContributions = {};
      hand.cbetOpportunity = {};
      hand.cbetFacedThisStreet = null;
      const boardCards = parseCardsFromText(m[1] || '');
      if (boardCards.length) hand.board = (type === 'flop') ? boardCards : hand.board.concat(boardCards);
      if (hand.lastAggressor) {
        hand.cbetOpportunity[hand.lastAggressor] = true;
        getPlayer(hand.lastAggressor).cbetOpp += 1;
        saveStore();
      }
      return;
    }

    if (type === 'shows') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const p = getPlayer(xid);
      p.wtsd += 1;
      hand.shown[xid] = squish(m[2], 40);
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
  // field names would multiply storage for no benefit.
  function logAction(hand, xid, action, amount) {
    hand.actions.push({ x: xid, a: action, amt: amount || 0, s: hand.street });
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

  function noteBetSizing(xid, amt, potBefore) {
    if (!amt || potBefore <= 0) return;
    const p = getPlayer(xid);
    p.betSizePctSum += (amt / potBefore) * 100;
    p.betSizeCount += 1;
  }

  function addContribution(hand, xid, amt) {
    hand.contributions[xid] = (hand.contributions[xid] || 0) + amt;
    hand.streetContributions[xid] = (hand.streetContributions[xid] || 0) + amt;
    hand.pot += amt;
  }

  function recordStreetAction(xid, action, hand) {
    if (hand.street === 'preflop') return; // preflop tallied via VPIP/PFR/3-bet counters instead
    const p = getPlayer(xid);
    if (!p.streetActions[hand.street]) return;
    p.streetActions[hand.street][action] = (p.streetActions[hand.street][action] || 0) + 1;
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

  function applyHandResultsAndReset() {
    if (currentHand) applyHandResults(currentHand);
    currentHand = freshHandState();
  }

  function applyHandResults(hand) {
    // "Hands observed" denominator uses who was dealt in at hand start, not just
    // who ended up contributing chips — someone who folds preflop with no money
    // in yet still counts as a hand where they didn't VPIP.
    hand.dealtInXids.forEach((xid) => { getPlayer(xid).hands += 1; });
    if (heroXid && hand.dealtInXids.has(heroXid)) STORE.hero.hands += 1;
    touchSession(0, heroXid && hand.dealtInXids.has(heroXid));

    if (hand.winners.length > 0) {
      // If the log didn't print an amount, split the pot we tracked. Leaving it
      // at 0 would score a WIN as losing everything the winner had contributed.
      const unknown = hand.winners.filter((w) => !w.amount).length;
      const fallbackShare = unknown ? Math.round(hand.pot / hand.winners.length) : 0;
      const wonByXid = {};
      hand.winners.forEach((w) => {
        const amt = w.amount || fallbackShare;
        wonByXid[w.xid] = (wonByXid[w.xid] || 0) + amt;
      });

      const contributors = Object.keys(hand.contributions);

      if (heroXid) {
        const heroWon = wonByXid[heroXid] || 0;
        const heroContributed = hand.contributions[heroXid] || 0;
        const heroDelta = heroWon - heroContributed;
        STORE.hero.netChips += heroDelta;
        touchSession(heroDelta, false);

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
            getPlayer(xid).plChipsEst += heroDelta * (net[xid] / poolTotal);
          }
        }
      }
    }

    recordHandHistory(hand);
    saveStore();
    finalizeHand();
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
      heroCards: hand.heroCards || null,
    });
    const limit = STORE.settings.historyLimit || 200;
    if (STORE.hands.length > limit) STORE.hands.length = limit;
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
  function heroProblem() {
    const configured = (STORE.settings.heroName || '').trim();
    if (!configured) return 'Set “Your Torn username” in Settings — until then no profit/loss is attributed to anyone.';
    if (!heroXid) {
      return `No seat matches the username “${configured}”. Check the spelling against your seat — `
        + 'until it matches, no profit/loss is attributed to anyone.';
    }
    if (String(heroXid).startsWith('name:')) {
      return `“${configured}” matched by name but not to a seat ID yet — sit at a table for this to resolve.`;
    }
    return null;
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
    const lines = [`[${when}] pot ${fmtMoney(h.pot)} — reached ${h.street}`];
    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      const acts = byStreet[street].map((a) => {
        const nm = playerDisplayName(a.x);
        const mark = (focusXid && a.x === focusXid) ? '*' : '';
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        return `${mark}${nm} ${a.a}${amt}`;
      }).join(', ');
      lines.push(`  ${street}: ${acts}`);
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

  // Same hand as formatHand, rendered as markup instead of a line of text.
  // formatHand is kept for the Copy button — clipboard output should stay plain
  // text — so the two must be changed together if the content changes.
  function formatHandHtml(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const parts = [`<div class="tph-hh-head" style="${HH.head}">${escapeHtml(when)} · pot ${fmtMoney(h.pot)}`
      + ` · reached ${escapeHtml(h.street || 'preflop')}</div>`];

    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      const acts = byStreet[street].map((a) => {
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        const txt = `${escapeHtml(playerDisplayName(a.x))} ${escapeHtml(a.a)}${amt}`;
        return (focusXid && a.x === focusXid)
          ? `<span class="tph-hh-me" style="${HH.me}">${txt}</span>` : txt;
      }).join(', ');
      parts.push(`<div class="tph-hh-row" style="${HH.row}">`
        + `<span class="tph-hh-st" style="${HH.street}">${street}</span>${acts}</div>`);
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

  function readLogRows() {
    const root = logRoot();
    if (!root || !root.querySelectorAll) return null;
    const rows = root.querySelectorAll(SELECTORS.logRow);
    if (!rows.length) return null; // uncalibrated page — caller uses the fallback
    return Array.from(rows, (row) => (row.textContent || '').trim());
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

    // Lines already on screen when the script loads are history, not events —
    // parsing them would replay an arbitrary slice of a hand already over.
    if (!logSnapshotPrimed) {
      logSnapshot = cur;
      logSnapshotPrimed = true;
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

  const ACTION_WORD_RE = /^(fold|check|call|bet|raise|all[\s-]?in)\b/i;

  // The configured selector matched nothing on the real table, which left the
  // coach permanently hidden. Fall back to finding clickable elements whose
  // label is an action word.
  function countActionControls() {
    const direct = document.querySelectorAll(SELECTORS.actionButtons);
    if (direct.length) return direct.length;
    let n = 0;
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      if (el.closest('[class^="tph-"], [class*=" tph-"]')) return;
      const t = (el.textContent || '').trim();
      if (t && t.length < 24 && ACTION_WORD_RE.test(t)) n++;
    });
    return n;
  }

  function isHeroTurn() { return countActionControls() > 0; }

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
      if (!heroXid) heroXid = findHeroXid();
      attachLogObserver();
      // Cheap, and it repairs "#<xid>" names from earlier versions as soon as
      // that player is seen at a table again.
      harvestSeatNames();
    }, 3000);
    harvestSeatNames();

    // Safety net. The snapshot scan is idempotent — a poll that finds nothing new
    // emits nothing — so it costs a textContent read per row and covers any
    // rendering path the observer doesn't see (a canvas-ish re-layout, a
    // mutation type we don't subscribe to, an observer detached by an SPA swap).
    setInterval(scanLogRows, 1000);
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

  // Percentage without the sign, for the seat badge where three "%" glyphs per
  // seat is more clutter than information.
  function fmtNum(v) {
    return v == null ? '–' : v.toFixed(0);
  }

  // Equity rounded to whole percent printed a flat "0%" for anything under 0.5,
  // which reads as "this hand cannot win" when it means "under one percent".
  // Against 8 random hands a weak holding genuinely lands there, so the
  // distinction matters.
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

  function computeRates(p) {
    const aggActions = ['flop', 'turn', 'river'].reduce((sum, s) => sum + p.streetActions[s].bet + p.streetActions[s].raise, 0);
    const passActions = ['flop', 'turn', 'river'].reduce((sum, s) => sum + p.streetActions[s].call, 0);
    return {
      vpip: pct(p.vpip, p.hands),
      pfr: pct(p.pfr, p.hands),
      afq: pct(aggActions, aggActions + passActions),
      threeBet: pct(p.threeBetMade, p.hands),
      foldTo3Bet: pct(p.foldTo3BetMade, p.foldTo3BetOpp),
      cbet: pct(p.cbetMade, p.cbetOpp),
      wtsd: pct(p.wtsd, p.hands),
      avgBetPct: p.betSizeCount ? (p.betSizePctSum / p.betSizeCount) : null,
    };
  }

  // ===========================================================================
  // 6. ARCHETYPE CLASSIFIER
  // ===========================================================================

  const ARCHETYPE_RULES = [
    { name: 'Nit', test: (r) => r.vpip != null && r.vpip < 15 },
    { name: 'Maniac', test: (r) => r.afq != null && r.afq > 60 && r.vpip > 40 },
    { name: 'LAG', test: (r) => r.vpip > 28 && r.pfr != null && r.pfr / r.vpip > 0.5 },
    { name: 'Fish', test: (r) => r.vpip > 35 && (r.pfr == null || r.pfr / r.vpip < 0.3) },
    { name: 'TAG', test: (r) => r.vpip >= 15 && r.vpip <= 24 && r.pfr != null && r.pfr / r.vpip > 0.66 },
  ];

  function classify(player) {
    if (player.hands < STORE.settings.minHands) return 'Unrated';
    return classifyProvisional(player);
  }

  // Same rules with no minimum-hands gate. The seat badge uses this so a player
  // you have only just met still gets a readable type rather than the word
  // "Unrated", which is the least useful thing a HUD can put on the felt. The
  // caller is responsible for marking it as provisional.
  function classifyProvisional(player) {
    const r = computeRates(player);
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

  // Preflop is split by SITUATION first, then by chart. Applying an opening
  // range to a limped pot, or a 3-bet range to a 4-bet decision, gives advice
  // that reads as confident and is answering a different question.
  function preflopBaseline(ctx) {
    const { position, positionInferred, heroCards, posDiag, seats,
            preflopRaises, limpers, heroInPosition, heroHasRaised } = ctx;

    // Without a known position no chart is meaningful — say so rather than
    // quietly assuming a seat and giving confidently wrong advice.
    if (!position) {
      return `Baseline: position unknown this hand (${posDiag || 'reason unclear'}) — no preflop chart applied.`;
    }
    // An inferred seat is read off whose turn it is, not off observed action.
    // Say so in the label: a misread seat changes the chart, and advice that
    // looks equally confident either way is the failure mode worth avoiding.
    const pos = positionInferred ? `${position}?` : position;
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
    const { street, heroCards, betFacing, pot } = ctx;
    if (street === 'preflop' && heroCards) return preflopBaseline(ctx);
    const mdf = minimumDefenseFrequency(betFacing, pot);
    if (mdf != null) {
      return `Baseline: defend roughly ${fmtPct(mdf * 100)} of your range here (MDF), pot ${fmtMoney(pot)}.`;
    }
    return 'Baseline: check/bet a balanced portion of your range. (Pot size unknown '
      + 'this hand — no MDF or pot odds; this happens when the HUD starts mid-hand.)';
  }

  function exploitDeviation(villainXid) {
    if (!villainXid) return null;
    const p = STORE.players[villainXid];
    if (!p || p.hands < STORE.settings.minHands) return null;
    const r = computeRates(p);

    if (r.foldTo3Bet != null && r.foldTo3Bet > 70) {
      return `This villain folds to 3-bets ${fmtPct(r.foldTo3Bet)} (${p.foldTo3BetOpp} samples) — 3-betting light is likely +EV.`;
    }
    if (r.cbet != null && r.vpip != null && r.vpip > 40 && r.pfr != null && r.pfr / (r.vpip || 1) < 0.3) {
      return `This villain is a calling station (VPIP ${fmtPct(r.vpip)}, rarely raises) — skip balanced bluffs, bet for value only.`;
    }
    if (r.afq != null && r.afq > 55) {
      return `This villain is very aggressive (AFq ${fmtPct(r.afq)}) — consider calling down lighter and letting them bluff.`;
    }
    return null;
  }

  // ===========================================================================
  // 12. CARD READING, EQUITY, POSITION, SESSION
  // ===========================================================================

  const SUIT_CHARS = ['s', 'h', 'd', 'c'];
  const RANK_WORDS = {
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', nine: '9', eight: '8',
    seven: '7', six: '6', five: '5', four: '4', three: '3', two: '2',
  };

  function normRank(raw) {
    const r = String(raw).toUpperCase();
    return r === '10' ? 'T' : r;
  }

  // Cards can come from a class name, an aria-label, or plain log text — try all.
  function parseCardEl(el) {
    const cn = typeof el.className === 'string' ? el.className : '';
    const m = CARD_CLASS_RE.exec(cn);
    if (m) return { suit: m[1][0].toLowerCase(), rank: normRank(m[2]) };
    const al = (el.getAttribute('aria-label') || '').toLowerCase();
    const am = /(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two)\s+of\s+(spades|hearts|diamonds|clubs)/.exec(al);
    if (am) return { suit: am[2][0], rank: RANK_WORDS[am[1]] };
    return null;
  }

  const SUIT_SYMBOLS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

  function parseCardsFromText(text) {
    const out = [];
    const re = /(10|[2-9TJQKA])\s*([shdc♠♥♦♣])/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const suitRaw = m[2];
      const suit = SUIT_SYMBOLS[suitRaw] || suitRaw.toLowerCase();
      if (!SUIT_CHARS.includes(suit)) continue;
      out.push({ rank: normRank(m[1]), suit });
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
  function readDomPot() {
    for (const sel of ['[class*="totalPotWrap_"]', '[class*="potsWrapper_"]']) {
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

  function readBoardCards() {
    const els = document.querySelectorAll(SELECTORS.communityCards);
    const cards = [];
    els.forEach((el) => { const c = parseCardEl(el); if (c) cards.push(c); });
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

  // Monte Carlo equity against N random hands. "Random" is deliberate and
  // stated in the UI: real opponents have ranges, so this reads pessimistically
  // against tight players and optimistically against loose ones.
  function estimateEquity(heroCards, boardCards, nOpp) {
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

    const iters = STORE.settings.equityIters || 1200;
    let win = 0;
    let tie = 0;
    for (let it = 0; it < iters; it++) {
      // Partial Fisher–Yates: only shuffle the cards this trial consumes.
      for (let i = 0; i < take; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i));
        const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
      }
      const full = board.concat(deck.slice(0, need));
      const hv = evaluate7(hero.concat(full));
      let best = null;
      for (let o = 0; o < nOpp; o++) {
        const ov = evaluate7([deck[need + 2 * o], deck[need + 2 * o + 1]].concat(full));
        if (best === null || cmpHand(ov, best) > 0) best = ov;
      }
      const c = cmpHand(hv, best);
      if (c > 0) win++; else if (c === 0) tie++;
    }
    return (100 * (win + tie * 0.5)) / iters;
  }

  // The coach panel re-renders every 1.5s; recomputing thousands of showdowns
  // each time would cook the phone. Only recompute when the situation changes.
  //
  // This is a small keyed cache rather than one slot because the panel now asks
  // for several opponent counts for the same board (full ring, live, heads-up).
  // With a single slot each lookup evicted the previous one and nothing ever hit
  // cache — every render recomputed every figure from scratch.
  const EQUITY_CACHE_MAX = 12;
  const equityCache = new Map();
  function estimateEquityCached(heroCards, boardCards, nOpp) {
    const key = heroCards.map((c) => c.rank + c.suit).join('')
      + '|' + (boardCards || []).map((c) => c.rank + c.suit).join('')
      + '|' + nOpp;
    if (equityCache.has(key)) return equityCache.get(key);
    const v = estimateEquity(heroCards, boardCards, nOpp);
    equityCache.set(key, v);
    // Board changes make old entries unreachable; cap the map so a long session
    // doesn't accumulate one entry per hand forever.
    if (equityCache.size > EQUITY_CACHE_MAX) {
      equityCache.delete(equityCache.keys().next().value);
    }
    return v;
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
  function touchSession(deltaChips, countHand) {
    const s = STORE.session;
    const now = Date.now();
    if (!s.startedAt || (s.lastHandAt && now - s.lastHandAt > SESSION_GAP_MS)) {
      s.startedAt = now; s.hands = 0; s.net = 0;
    }
    s.lastHandAt = now;
    if (countHand) s.hands += 1;
    s.net += deltaChips || 0;
  }

  // ===========================================================================
  // 8. COACH PROMPTS (advisory only — never auto-acts)
  // ===========================================================================

  function buildCoachAdvice() {
    if (!currentHand) return null;
    const hand = currentHand;
    const heroCards = readHeroCards();
    // Remember them while they're on screen — they're gone by the time the hand
    // is written to history.
    if (heroCards.length === 2) hand.heroCards = heroCards;

    // Prefer real turn detection, but this table exposes no recognisable action
    // buttons; rather than never showing advice, fall back to "your hole cards
    // are visible", which means you're in a live hand.
    if (!isHeroTurn() && heroCards.length !== 2) return null;
    const board = readBoardCards();
    const villainXid = hand.lastAggressor;
    const betFacing = villainXid ? (hand.streetContributions[villainXid] || 0) : 0;
    const pos = heroPositionLabel(hand);
    const position = pos ? pos.label : null;
    // Prefer the table's own pot over our running log sum — see readDomPot.
    const pot = effectivePot(hand);
    const out = [];

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
      const wanted = [];
      [[full, `${full + 1}-max`], [live, 'live'], [1, 'heads-up']].forEach(([n, label]) => {
        if (!wanted.some((w) => w.n === n)) wanted.push({ n, label });
      });

      const quotes = wanted
        .map((w) => ({ ...w, eq: estimateEquityCached(heroCards, board, w.n) }))
        .filter((w) => w.eq != null);

      if (quotes.length) {
        out.push('Equity (random hands): '
          + quotes.map((w) => `<b>${fmtEquity(w.eq)}</b> vs ${w.n} (${w.label})`).join(' · '));

        // Pot odds compare against the players actually still contesting the
        // pot — using the full-ring baseline here would tell you to fold
        // profitable calls in a short-handed pot.
        const liveEq = quotes.find((w) => w.n === live);
        if (betFacing > 0 && liveEq) {
          const need = (100 * betFacing) / (pot + betFacing);
          out.push(`Pot odds: need ${need.toFixed(0)}% to call — ${liveEq.eq >= need ? 'calling is +EV on raw equity' : 'folding is likely correct'}.`);
        }
      }
    } else if (betFacing > 0) {
      const need = (100 * betFacing) / (hand.pot + betFacing);
      out.push(`Pot odds: need ~${need.toFixed(0)}% equity to continue.`);
    }

    const deviation = exploitDeviation(villainXid);
    if (deviation) out.push(deviation);
    return out.filter(Boolean);
  }

  // ===========================================================================
  // 11. TENDENCY REPORT
  // ===========================================================================

  function buildReport(xid) {
    const p = STORE.players[xid];
    if (!p) return 'No data yet for this player.';
    const r = computeRates(p);
    const lines = [];
    lines.push(`${p.name} — ${p.hands} hands observed, ${classify(p)}.`);
    if (p.hands < STORE.settings.minHands) {
      lines.push(`Fewer than ${STORE.settings.minHands} hands observed — read with caution.`);
    }
    if (r.vpip != null) lines.push(`Plays ${r.vpip > 30 ? 'very wide' : r.vpip > 20 ? 'moderately wide' : 'tight'} preflop (VPIP ${fmtPct(r.vpip)}).`);
    if (r.pfr != null && r.vpip) {
      const ratio = r.pfr / r.vpip;
      lines.push(ratio > 0.6 ? 'Mostly raises rather than limps/calls preflop.' : 'Often just calls preflop rather than raising.');
    }
    if (r.cbet != null) lines.push(`Continuation-bets ${fmtPct(r.cbet)} of flop opportunities.`);
    if (r.foldTo3Bet != null) lines.push(`Folds to 3-bets ${fmtPct(r.foldTo3Bet)} of the time (${p.foldTo3BetOpp} samples) — ${r.foldTo3Bet > 65 ? 'treat continuation bets/3-bets here as close to free' : 'defends 3-bets reasonably often'}.`);
    if (r.afq != null) lines.push(`Aggression frequency postflop: ${fmtPct(r.afq)}.`);
    if (r.avgBetPct != null) {
      const sz = r.avgBetPct;
      lines.push(`Average bet/raise is ${sz.toFixed(0)}% of pot (${p.betSizeCount} sized bets) — `
        + (sz > 85 ? 'oversizes heavily; often polarised to strong hands or bluffs.'
          : sz < 45 ? 'consistently small; easy to float and take away later streets.'
            : 'fairly standard sizing.'));
    }
    if (r.wtsd != null) lines.push(`Goes to showdown ${fmtPct(r.wtsd)} of hands played.`);
    lines.push(`Your estimated chips won/lost against them: ${fmtSignedMoney(p.plChipsEst)} (estimate — positive means you're up on them).`);
    if (p.notes) lines.push(`Notes: ${p.notes}`);
    return lines.join('\n');
  }

  // ===========================================================================
  // 7. HUD OVERLAY
  // ===========================================================================

  const CSS = `
    /* Deliberately understated and anchored UNDER the seat: at 11px with a solid
       border sitting above the seat it covered the player's name, which is the
       one thing on a seat you always need to read. */
    .tph-badge { position: fixed; z-index: 99998; background: rgba(10,10,14,0.82) !important;
      color: #cfd6dd !important; border: none; border-radius: 3px; padding: 1px 4px;
      font: 10px/1.45 -apple-system, sans-serif !important;
      letter-spacing: 0.2px; white-space: nowrap; cursor: pointer; pointer-events: auto;
      max-width: 140px; overflow: hidden; }
    .tph-badge b { color: #ffc94d !important; font-weight: 700; }
    .tph-badge .tph-badge-dim { color: #9fb0bf !important; }
    /* background/color pinned: we inject into Torn's page, so an inherited or
       lower-specificity colour can be overridden by their stylesheet and leave
       dark text on a dark panel. */
    .tph-panel { position: fixed; z-index: 99999; top: 10%; left: 5%; right: 5%; max-height: 80%; overflow-y: auto;
      background: #1b1b1f !important; color: #eee !important; border: 1px solid #666; border-radius: 8px; padding: 12px;
      font: 13px/1.4 -apple-system, sans-serif; opacity: 1 !important; }
    .tph-panel h3 { margin: 0 0 8px; font-size: 15px; }
    .tph-panel textarea { width: 100%; height: 90px; background: #111; color: #ddd; border: 1px solid #444; }
    .tph-panel .tph-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
    .tph-panel .tph-tab { padding: 4px 8px; border: 1px solid #555; border-radius: 4px; cursor: pointer; }
    .tph-panel .tph-tab.active { background: #333; }
    .tph-panel button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 6px 10px; margin: 3px 4px 3px 0; font: 12px -apple-system, sans-serif; cursor: pointer; }
    .tph-ptable { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    .tph-ptable th { text-align: left; opacity: 0.6; font-weight: normal; border-bottom: 1px solid #444; padding: 3px 4px; }
    .tph-ptable td { padding: 6px 4px; border-bottom: 1px solid #2a2a2e; }
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
    .tph-close { position: absolute; top: 8px; right: 10px; cursor: pointer; }
    .tph-warn { background: #4a2c12 !important; color: #ffd9a0 !important; border: 1px solid #8a5a24;
      border-radius: 5px; padding: 7px 9px; margin: 6px 0 10px; font-size: 12px; line-height: 1.45; }
    .tph-ok { color: #7ed957 !important; font-size: 12px; margin: 2px 0 10px; }
    /* Raised well above the bottom edge so it doesn't sit under Torn PDA's own
       native controls, enlarged and labelled so it's unmistakably OUR button. */
    /* touch-action:none so dragging the button doesn't scroll the page under it */
    .tph-gear { position: fixed; z-index: 100000; bottom: 96px; right: 12px; background: #b8342e; color: #fff;
      border: 2px solid #fff; border-radius: 22px; height: 44px; min-width: 44px; padding: 0 12px;
      display: flex; align-items: center; gap: 5px; font: bold 13px/1 -apple-system, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none; }
    .tph-gear.tph-dragging { cursor: grabbing; opacity: 0.85; }
    /* Width is capped rather than left/right-anchored so the panel keeps a
       sensible size once dragging switches it to left/top positioning. */
    .tph-coach { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      width: min(420px, calc(100vw - 24px)); background: rgba(20,20,24,0.95);
      color: #cde; border: 1px solid #556; border-radius: 8px; font: 12px/1.4 -apple-system, sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
    .tph-coach-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px;
      border-bottom: 1px solid #445; cursor: grab; touch-action: none;
      user-select: none; -webkit-user-select: none; font-weight: 600; color: #9bd; }
    .tph-coach-head .tph-grip { opacity: 0.5; letter-spacing: 1px; }
    .tph-coach-head .tph-coach-hide { margin-left: auto; cursor: pointer; color: #f88;
      border: 1px solid #a44; border-radius: 4px; padding: 1px 7px; font-weight: 400; }
    .tph-coach.tph-dragging { opacity: 0.85; }
    .tph-coach.tph-dragging .tph-coach-head { cursor: grabbing; }
    .tph-coach-body { padding: 8px; }
    .tph-coach-body b { color: #fff; }
    .tph-coach-foot { padding: 0 8px 7px; font-size: 10px; line-height: 1.35;
      opacity: 0.5; border-top: 1px solid #334; padding-top: 6px; margin-top: 2px; }
    /* touch-action:none so dragging the pill moves it instead of scrolling the
       table underneath — without it the pointermove handler never gets to run. */
    .tph-coach-pill { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      background: rgba(20,20,24,0.95); color: #9bd; border: 1px solid #556; border-radius: 999px;
      padding: 7px 13px; font: 12px/1 -apple-system, sans-serif; cursor: grab;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); touch-action: none;
      user-select: none; -webkit-user-select: none; }
    .tph-coach-pill.tph-dragging { cursor: grabbing; opacity: 0.85; }
    .tph-calib { position: fixed; z-index: 99999; top: 4px; left: 4px; right: 4px; max-height: 62%; overflow-y: auto;
      background: rgba(10,10,10,0.97); color: #9f9; border: 1px solid #494; border-radius: 6px; padding: 8px;
      font: 10px/1.3 monospace; }
    .tph-calib .tph-calib-off { float: right; color: #f88; border: 1px solid #a44; border-radius: 4px;
      padding: 1px 5px; margin-left: 6px; cursor: pointer; }
    .tph-calib button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 5px 9px; margin: 4px 4px 4px 0; font: 11px -apple-system, sans-serif; cursor: pointer; }
    .tph-calib-out { width: 100%; height: 150px; background: #000; color: #9f9; border: 1px solid #494;
      font: 9px/1.25 monospace; white-space: pre; }
    .tph-banner { position: fixed; z-index: 100001; top: 8px; left: 8px; right: 8px; background: #1c6b3a;
      color: #fff; border: 2px solid #4ade80; border-radius: 8px; padding: 10px 12px;
      font: 13px/1.35 -apple-system, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.5); cursor: pointer; }
    .tph-banner b { color: #d1fae5; }
    .tph-banner .tph-banner-x { float: right; padding-left: 10px; opacity: 0.8; }
  `;

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

  function renderBadges() {
    document.querySelectorAll('.tph-badge').forEach((el) => el.remove());
    if (!STORE.settings.showBadges) return;
    const seats = document.querySelectorAll(SELECTORS.seatContainer);
    seats.forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid || xid === heroXid) return;
      const player = STORE.players[xid];
      const rect = seat.getBoundingClientRect();
      if (!rect.width && !rect.height) return; // seat not laid out (empty/hidden)
      const badge = document.createElement('div');
      badge.className = 'tph-badge';
      // Below the seat — i.e. under the name and chip stack — rather than over
      // the top of it. Clamped so a bottom-row seat doesn't push it off screen.
      const maxTop = Math.max(0, window.innerHeight - BADGE_HEIGHT_PX);
      badge.style.top = Math.min(Math.max(0, rect.bottom + 1), maxTop) + 'px';
      badge.style.left = Math.max(0, rect.left) + 'px';
      const label = player ? classify(player) : 'Unrated';
      const r = player ? computeRates(player) : {};
      // Always show a TYPE, never just a hand count. Below minHands `classify`
      // returns "Unrated", which told you nothing about the player — the read is
      // the point of the badge. Show the provisional archetype with a "?" so it
      // is visibly not yet trustworthy, and keep the numbers alongside it.
      const hands = player ? player.hands : 0;
      const type = hands === 0 ? 'new'
        : (label === 'Unrated' ? classifyProvisional(player) + '?' : label);
      badge.innerHTML = hands === 0
        ? `<b>new</b>`
        : `<b>${type}</b> <span class="tph-badge-dim">${fmtNum(r.vpip)}/${fmtNum(r.pfr)}/${fmtNum(r.afq)}</span>`;
      badge.title = `${playerDisplayName(xid)} — ${hands} hand(s) seen. VPIP/PFR/AFq.`
        + (label === 'Unrated' && hands > 0 ? ` "?" = provisional, under the ${STORE.settings.minHands}-hand minimum.` : '')
        + ' Tap for full stats.';
      badge.addEventListener('click', () => openPlayerPanel(xid));
      document.body.appendChild(badge);
    });
  }

  // How much of the coach panel must stay on screen while dragging. The panel is
  // nearly viewport-width on a phone, so it has to be allowed to hang off the
  // edges — otherwise there is nowhere for it to go. 100px keeps enough of the
  // header grabbable to drag it back.
  const COACH_KEEP_VISIBLE_PX = 100;

  // The pill is small enough to keep whole on screen, so no allowance is needed
  // beyond the default — named for symmetry with the panel above.
  const PILL_KEEP_VISIBLE_PX = 0;

  function setCoachHidden(hidden) {
    STORE.settings.coachHidden = hidden;
    saveStore();
    renderCoachPanel();
  }

  function renderCoachPanel() {
    let el = document.querySelector('.tph-coach');
    let pill = document.querySelector('.tph-coach-pill');
    const advice = buildCoachAdvice();

    // Nothing to advise on (not in a hand): tear both down rather than leaving a
    // stale panel or an orphan pill sitting over the table.
    if (!advice || advice.length === 0) {
      if (el) el.remove();
      if (pill) pill.remove();
      return;
    }

    if (STORE.settings.coachHidden) {
      if (el) el.remove();
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'tph-coach-pill';
        pill.textContent = '📊 GTO';
        pill.title = 'Tap to show the GTO coach — drag to move';
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
      el.innerHTML = '<div class="tph-coach-head"><span class="tph-grip">⠿</span>'
        + '<span>Coach</span><span class="tph-coach-hide">Hide</span></div>'
        + '<div class="tph-coach-body"></div>'
        + '<div class="tph-coach-foot">Baselines are reference charts calibrated to '
        + 'published opening frequencies — not solver output. Equity is vs random '
        + 'hands, and P/L is an estimate.</div>';
      document.body.appendChild(el);

      const head = el.querySelector('.tph-coach-head');
      const hide = el.querySelector('.tph-coach-hide');
      hide.addEventListener('click', (e) => { e.stopPropagation(); setCoachHidden(true); });
      // Drag the whole panel by its header; no tap action, so a stray tap on the
      // bar does nothing rather than firing something unexpected.
      makeDraggable(head, { posKey: 'coachPos', moveEl: el, keepVisiblePx: COACH_KEEP_VISIBLE_PX });
      applyStoredPos(el, 'coachPos', COACH_KEEP_VISIBLE_PX);
    }

    el.querySelector('.tph-coach-body').innerHTML = advice.map((line) => `<div>${line}</div>`).join('');
  }

  let openPlayerXid = null;
  let openPlayerTab = 'stats';

  function openPlayerPanel(xid) {
    openPlayerXid = xid;
    openPlayerTab = 'stats';
    renderPlayerPanel();
  }

  function renderPlayerPanel() {
    document.querySelectorAll('.tph-panel').forEach((el) => el.remove());
    if (!openPlayerXid) return;
    const p = getPlayer(openPlayerXid);
    const r = computeRates(p);
    const panel = document.createElement('div');
    panel.className = 'tph-panel';
    panel.innerHTML = `
      <span class="tph-close">✕</span>
      <h3>${escapeHtml(p.name)} — ${classify(p)}</h3>
      <div class="tph-tabs">
        <div class="tph-tab ${openPlayerTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</div>
        <div class="tph-tab ${openPlayerTab === 'report' ? 'active' : ''}" data-tab="report">Report</div>
        <div class="tph-tab ${openPlayerTab === 'history' ? 'active' : ''}" data-tab="history">History</div>
        <div class="tph-tab ${openPlayerTab === 'notes' ? 'active' : ''}" data-tab="notes">Notes</div>
      </div>
      <div class="tph-tab-body"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.tph-close').addEventListener('click', () => { openPlayerXid = null; renderPlayerPanel(); });
    panel.querySelectorAll('.tph-tab').forEach((tab) => {
      tab.addEventListener('click', () => { openPlayerTab = tab.dataset.tab; renderPlayerPanel(); });
    });

    const body = panel.querySelector('.tph-tab-body');
    if (openPlayerTab === 'stats') {
      body.innerHTML = `
        <table>
          <tr><td>Hands</td><td>${p.hands}</td></tr>
          <tr><td>VPIP</td><td>${fmtPct(r.vpip)}</td></tr>
          <tr><td>PFR</td><td>${fmtPct(r.pfr)}</td></tr>
          <tr><td>AFq</td><td>${fmtPct(r.afq)}</td></tr>
          <tr><td>3-Bet</td><td>${fmtPct(r.threeBet)}</td></tr>
          <tr><td>Fold to 3-Bet</td><td>${fmtPct(r.foldTo3Bet)}</td></tr>
          <tr><td>C-Bet</td><td>${fmtPct(r.cbet)}</td></tr>
          <tr><td>WTSD</td><td>${fmtPct(r.wtsd)}</td></tr>
          <tr><td>Avg bet size</td><td>${r.avgBetPct != null ? r.avgBetPct.toFixed(0) + '% pot' : '—'}</td></tr>
          <tr><td>Your P/L vs them</td><td>${fmtSignedMoney(p.plChipsEst)}</td></tr>
        </table>
      `;
    } else if (openPlayerTab === 'report') {
      const text = buildReport(openPlayerXid);
      body.innerHTML = `<pre style="white-space:pre-wrap;color:#f2f4f6 !important;background:transparent !important">`
        + `${escapeHtml(text)}</pre><button class="tph-copy-report">Copy report</button>`;
      body.querySelector('.tph-copy-report').addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(text);
      });
    } else if (openPlayerTab === 'history') {
      const hands = handsInvolving(openPlayerXid);
      if (!hands.length) {
        body.innerHTML = '<i>No hands recorded with this player yet.</i>';
      } else {
        const shown = hands.slice(0, 40);
        // Clipboard stays plain text; only the on-screen rendering is markup.
        const text = shown.map((h) => formatHand(h, openPlayerXid)).join('\n\n');
        body.innerHTML = `<div style="color:#c9d1d9 !important;margin-bottom:8px">${hands.length} hand(s) recorded`
          + `${hands.length > shown.length ? `, showing ${shown.length}` : ''} — `
          + `<span style="${HH.me}">their actions highlighted</span></div>`
          + shown.map((h) => formatHandHtml(h, openPlayerXid)).join('')
          + `<button class="tph-copy-hist">Copy history</button>`;
        body.querySelector('.tph-copy-hist').addEventListener('click', () => {
          navigator.clipboard && navigator.clipboard.writeText(text);
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

  function renderPlayersList() {
    document.querySelectorAll('.tph-players').forEach((el) => el.remove());
    if (!playersListOpen) return;

    const all = Object.keys(STORE.players)
      .map((xid) => ({ xid, p: STORE.players[xid] }))
      .filter(({ p }) => !playersFilter || (p.name || '').toLowerCase().includes(playersFilter.toLowerCase()))
      .sort((a, b) => (b.p.hands || 0) - (a.p.hands || 0));

    const panel = document.createElement('div');
    panel.className = 'tph-panel tph-players';
    const rows = all.length
      ? all.map(({ xid, p }) => {
        const r = computeRates(p);
        const pl = Math.round(p.plChipsEst || 0);
        return `<tr data-xid="${escapeHtml(xid)}" class="tph-prow">
            <td><b>${escapeHtml(p.name)}</b></td>
            <td>${classify(p)}</td>
            <td>${p.hands}</td>
            <td>${fmtPct(r.vpip)}/${fmtPct(r.pfr)}</td>
            <td style="color:${pl >= 0 ? '#7ed957' : '#ff6b6b'}">${fmtSignedMoney(pl)}</td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="5"><i>No players tracked yet.</i></td></tr>`;

    const problem = heroProblem();
    panel.innerHTML = `
      <span class="tph-close">✕</span>
      <h3>Tracked players (${all.length})</h3>
      ${problem ? `<div class="tph-warn">⚠ ${escapeHtml(problem)}</div>` : ''}
      <input class="tph-pfilter" placeholder="Filter by name…" value="${escapeHtml(playersFilter)}" style="width:60%">
      <table class="tph-ptable">
        <tr><th>Name</th><th>Type</th><th>Hands</th><th>VPIP/PFR</th><th>P/L</th></tr>
        ${rows}
      </table>
      <div style="opacity:.75;margin-top:10px;border-top:1px solid #444;padding-top:8px">
        <b>Session:</b> ${STORE.session.hands} hands, ${fmtSignedMoney(STORE.session.net)}
        ${STORE.session.startedAt ? ' (since ' + new Date(STORE.session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}<br>
        <b>Lifetime:</b> ${STORE.hero.hands} hands, ${fmtSignedMoney(STORE.hero.netChips)}
        &nbsp;|&nbsp; ${(STORE.hands || []).length} hands in history
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.tph-close').addEventListener('click', () => { playersListOpen = false; renderPlayersList(); });
    const filterEl = panel.querySelector('.tph-pfilter');
    filterEl.addEventListener('input', (e) => {
      playersFilter = e.target.value;
      renderPlayersList();
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
  }

  let settingsOpen = false;

  function renderSettingsPanel() {
    document.querySelectorAll('.tph-settings').forEach((el) => el.remove());
    if (!settingsOpen) return;
    const panel = document.createElement('div');
    panel.className = 'tph-panel tph-settings';
    panel.innerHTML = `
      <span class="tph-close">✕</span>
      <h3>Settings</h3>
      <button class="tph-open-players" style="width:100%;padding:9px;margin-bottom:10px">👥 View tracked players &amp; hand history</button>
      <label><b>Your Torn username:</b> <input type="text" class="tph-hero-name" value="${escapeHtml(STORE.settings.heroName)}" placeholder="required for P/L" style="width:55%"></label><br>
      <div style="opacity:.7;margin:2px 0 6px">Needed to attribute profit/loss and work out your position.</div>
      ${heroProblem() ? `<div class="tph-warn">⚠ ${escapeHtml(heroProblem())}</div>` : '<div class="tph-ok">✓ Matched to your seat — profit/loss is being attributed.</div>'}
      <label>Min hands before rating: <input type="number" class="tph-min-hands" value="${STORE.settings.minHands}" style="width:60px"></label><br><br>
      <h4>Seat labels</h4>
      <label><input type="checkbox" class="tph-badge-toggle" ${STORE.settings.showBadges ? 'checked' : ''}> Show tendency labels on seats</label>
      <div style="opacity:.7;margin:2px 0 10px">Small line under each seat: archetype and VPIP/PFR/AFq. Tap one for full stats. Turn off to leave the table completely clear.</div>
      <h4>GTO coach</h4>
      <label><input type="checkbox" class="tph-coach-toggle" ${STORE.settings.coachHidden ? '' : 'checked'}> Show coach panel</label><br>
      <label>Full table size: <input type="number" class="tph-table-max" min="2" max="10" value="${STORE.settings.tableMax}" style="width:60px"></label>
      <div style="opacity:.7;margin:2px 0 6px">Equity is always quoted against a full ring of this size, plus the live and heads-up counts.</div>
      <button class="tph-coach-reset">Reset coach position</button><br><br>
      <label><input type="checkbox" class="tph-calib-toggle" ${STORE.settings.calibrationMode ? 'checked' : ''}> Calibration mode</label><br><br>
      <h4>GitHub Gist sync</h4>
      <label>OAuth App Client ID: <input type="text" class="tph-client-id" value="${escapeHtml(STORE.settings.githubClientId)}" style="width:70%"></label><br>
      <button class="tph-connect">${GistSync.status === 'connected' ? 'Re-sync now' : 'Connect'}</button>
      <div class="tph-sync-status">${escapeHtml(syncStatusText())}</div>
      <h4>Backup</h4>
      <textarea class="tph-export" readonly></textarea>
      <button class="tph-copy-export">Copy</button>
      <textarea class="tph-import" placeholder="Paste JSON to import"></textarea>
      <button class="tph-do-import">Import</button>
      <br><br>
      <button class="tph-reset">Reset all data</button>
    `;
    document.body.appendChild(panel);
    // .value (not innerHTML) so exported JSON — which contains opponent display
    // names — can't break out of the textarea.
    panel.querySelector('.tph-export').value = exportJson();

    panel.querySelector('.tph-close').addEventListener('click', () => { settingsOpen = false; renderSettingsPanel(); });
    panel.querySelector('.tph-open-players').addEventListener('click', () => {
      settingsOpen = false;
      renderSettingsPanel();
      playersListOpen = true;
      renderPlayersList();
    });
    panel.querySelector('.tph-hero-name').addEventListener('change', (e) => {
      STORE.settings.heroName = e.target.value.trim();
      heroXid = null; // force re-resolution against the new name
      saveStore();
    });
    panel.querySelector('.tph-min-hands').addEventListener('change', (e) => {
      STORE.settings.minHands = parseInt(e.target.value, 10) || 20;
      saveStore();
    });
    panel.querySelector('.tph-badge-toggle').addEventListener('change', (e) => {
      STORE.settings.showBadges = e.target.checked;
      saveStore();
      renderBadges(); // clears them immediately rather than waiting for the tick
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
    // An escape hatch for a panel dragged somewhere unreachable — e.g. parked in
    // a corner that the other screen orientation doesn't have.
    panel.querySelector('.tph-coach-reset').addEventListener('click', () => {
      STORE.settings.coachPos = null;
      STORE.settings.coachPillPos = null; // the pill is draggable too, and can be
                                          // parked out of reach just as easily
      saveStore();
      const coach = document.querySelector('.tph-coach');
      if (coach) coach.remove(); // rebuilt at the default anchor on the next tick
      const pill = document.querySelector('.tph-coach-pill');
      if (pill) pill.remove();
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
    panel.querySelector('.tph-connect').addEventListener('click', () => {
      if (GistSync.status === 'connected') GistSync.syncNow();
      else GistSync.startDeviceFlow();
    });
    panel.querySelector('.tph-copy-export').addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(exportJson());
    });
    panel.querySelector('.tph-do-import').addEventListener('click', () => {
      const text = panel.querySelector('.tph-import').value;
      try { importJson(text); renderSettingsPanel(); } catch (e) { alert('Invalid JSON'); }
    });
    panel.querySelector('.tph-reset').addEventListener('click', () => {
      if (confirm('Reset all tracked player data? This cannot be undone.')) { resetAllData(); renderSettingsPanel(); }
    });
  }

  function syncStatusText() {
    if (GistSync.status === 'waiting-for-user') {
      return `Open ${GistSync.verificationUri} on this phone's regular browser and enter code: ${GistSync.userCode}`;
    }
    if (GistSync.status === 'polling') return 'Waiting for authorization…';
    if (GistSync.status === 'connected') return `Connected. Last sync: ${STORE.settings.lastSync ? new Date(STORE.settings.lastSync).toLocaleString() : 'never'}`;
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
    L.push('');

    L.push('--- SELECTOR ALTERNATIVES (each tested separately) ---');
    Object.entries(SELECTORS).forEach(([key, sel]) => {
      selectorAlternatives(sel).forEach((alt) => L.push(`${countSel(alt)}\t${key}\t${alt}`));
    });
    L.push('');

    L.push('--- CSS MODULE CLASS BASES (most common) ---');
    L.push(classVocab(45).join(' '));
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
    if (!STORE.settings.calibrationMode) return;
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

    const out = el.querySelector('.tph-calib-out');
    if (preserved) out.value = preserved;

    el.querySelector('.tph-calib-off').addEventListener('click', () => {
      STORE.settings.calibrationMode = false;
      saveStore();
      el.remove();
    });
    el.querySelector('.tph-deep').addEventListener('click', () => { out.value = runDeepScan(); });
    el.querySelector('.tph-deep-copy').addEventListener('click', () => {
      if (!out.value) out.value = runDeepScan();
      out.removeAttribute('readonly');
      out.select();
      out.setSelectionRange(0, out.value.length); // iOS needs the explicit range
      try { document.execCommand('copy'); } catch (e) { /* fall through */ }
      if (navigator.clipboard) navigator.clipboard.writeText(out.value).catch(() => {});
      out.setAttribute('readonly', '');
      el.querySelector('.tph-deep-copy').textContent = 'Copied ✓';
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
      if (coach && STORE.settings.coachPos) {
        const cr = coach.getBoundingClientRect();
        setFixedPos(coach, cr.left, cr.top, COACH_KEEP_VISIBLE_PX);
      }
      const pill = document.querySelector('.tph-coach-pill');
      if (pill && STORE.settings.coachPillPos) {
        const pr = pill.getBoundingClientRect();
        setFixedPos(pill, pr.left, pr.top, PILL_KEEP_VISIBLE_PX);
      }
    });
  }

  // Shown once on load. Serves two jobs: (1) proves the script actually injected
  // — if you never see this on the poker page, the script isn't running (URL/
  // enable/reload issue), not a UI one; (2) gives a big, reliable tap target
  // into Settings/Calibration without hunting for the small gear.
  function showLoadBanner() {
    if (document.querySelector('.tph-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'tph-banner';
    banner.innerHTML =
      '<span class="tph-banner-x">✕</span>' +
      '🃏 <b>Torn Poker HUD loaded.</b> Tap here to open Settings &amp; turn on Calibration mode. ' +
      '(Or tap the red ⚙ HUD button — <b>drag it</b> to move it out of your way.)';
    banner.addEventListener('click', (e) => {
      if (e.target.classList.contains('tph-banner-x')) { banner.remove(); return; }
      settingsOpen = true;
      renderSettingsPanel();
      banner.remove();
    });
    document.body.appendChild(banner);
    setTimeout(() => { const b = document.querySelector('.tph-banner'); if (b) b.remove(); }, 15000);
  }

  // ===========================================================================
  // BOOTSTRAP
  // ===========================================================================

  function init() {
    injectStyles();
    renderGear();
    showLoadBanner();
    bootstrapTableWatchers();

    setInterval(renderBadges, 4000);
    setInterval(renderCoachPanel, 1500);
    if (STORE.settings.calibrationMode) setInterval(renderCalibrationPanel, 3000);

    // Badges are anchored to seat positions via getBoundingClientRect(), which
    // goes stale on scroll/orientation change well before the 4s interval —
    // recompute on those events (frame-coalesced) instead of waiting.
    window.addEventListener('scroll', scheduleBadgeRender, { passive: true });
    window.addEventListener('resize', scheduleBadgeRender);

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
