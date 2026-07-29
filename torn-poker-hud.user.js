// ==UserScript==
// @name         Torn Poker HUD
// @namespace    torn-poker-hud
// @version      0.5.0
// @description  Opponent tendency HUD, GTO-inspired coach prompts, per-player P/L, and tendency reports for Torn holdem, built for Torn PDA custom scripts.
// @match        *://www.torn.com/page.php?sid=holdem*
// @match        *://torn.com/page.php?sid=holdem*
// @grant        none
// ==/UserScript==

/*
 * SECTION MAP (matches the design plan 1:1):
 *   1. PDA/browser adapter shim
 *   2. Storage layer
 *   3. GitHub Gist sync (Device Flow)
 *   4. Table state capture (DOM selectors + log parsing + hand state machine)
 *   5. Stat engine
 *   6. Archetype classifier
 *   7. HUD overlay (badges, player panel, settings panel)
 *   8. Coach prompts
 *   9. GTO-inspired strategy module
 *  10. Profit/loss tracking
 *  11. Tendency report
 *
 * CALIBRATION NOTE: Torn's poker page uses hashed/webpack-style CSS module
 * class names. The selectors in SECTION 4 are a best-effort inference from
 * public write-ups of similar scripts, not verified against the live page.
 * Turn on Calibration Mode (gear icon -> Calibration) to see what is/isn't
 * being matched, and adjust the SELECTORS / LOG_PATTERNS objects below.
 */

(function () {
  'use strict';

  if (window.__tornPokerHUDLoaded) return;
  window.__tornPokerHUDLoaded = true;

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
    historyLimit: 200, // how many recent hands to keep for the History tab
  };

  function emptyStore(settings) {
    return {
      version: 1,
      players: {},
      hands: [],   // newest-first ring buffer of recent hand records
      hero: { hands: 0, netChips: 0 },
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

  function getPlayer(xid, name) {
    if (!STORE.players[xid]) STORE.players[xid] = emptyPlayer(xid, name);
    if (name) STORE.players[xid].name = name;
    STORE.players[xid].lastSeen = Date.now();
    return STORE.players[xid];
  }

  function exportJson() {
    return JSON.stringify(STORE, null, 2);
  }

  function importJson(text) {
    const parsed = JSON.parse(text);
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
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

  // Hands are immutable once written, so a union deduped by timestamp is safe —
  // this keeps history from both devices rather than letting one overwrite.
  function mergeHands(a, b, limit) {
    const seen = new Set();
    return a.concat(b)
      .filter((h) => { const k = h.t + ':' + (h.pot || 0); if (seen.has(k)) return false; seen.add(k); return true; })
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
  const SELECTORS = {
    logContainer: '[class*="messageLog___"], [class*="chatLog___"], [class*="log___"]',
    seatContainer: '[class*="playerWrapper___"], [class*="opponent___"], [id*="player-"]',
    seatNameLink: 'a[href*="XID="]',
    heroSeat: '[class*="hero___"], [class*="you___"]',
    heroCards: '[class*="hand___"] [class*="front___"] > div[role="img"]:not([aria-label="card face down"])',
    communityCards: '[class*="communityCards___"] [class*="front___"] > div[role="img"]:not([aria-label="card face down"])',
    potDisplay: '[class*="pot___"]',
    actionButtons: '[class*="actionButtons___"] button, [class*="controls___"] button',
    dealerButton: '[class*="dealerButton___"], [class*="buttonIcon___"]',
  };

  const CARD_CLASS_RE = /(clubs|spades|hearts|diamonds)-([0-9TJQKA]+)/i;

  // Log line patterns. Each handler receives (match, ctx) where ctx is the
  // active HandState. Wording is a best guess (mixing past/present tense)
  // per the public "posts/posted the (small|big) blind" style referenced by
  // similar Torn scripts — add more alternates here during calibration.
  const LOG_PATTERNS = [
    { type: 'newHandMarker', re: /dealing (a )?new hand/i },
    { type: 'postSB', re: /^(.+?) posts?(?:ed)? the small blind \$?([\d,]+)/i },
    { type: 'postBB', re: /^(.+?) posts?(?:ed)? the big blind \$?([\d,]+)/i },
    { type: 'fold', re: /^(.+?) folds?/i },
    { type: 'check', re: /^(.+?) checks?/i },
    { type: 'call', re: /^(.+?) calls? \$?([\d,]+)/i },
    { type: 'bet', re: /^(.+?) bets? \$?([\d,]+)/i },
    { type: 'raise', re: /^(.+?) raises? to \$?([\d,]+)/i },
    // NOTE: all-in intentionally NOT matched here yet. Torn's real wording and
    // (crucially) whether it includes a dollar amount are unknown — matching it
    // to a no-op handler would silently drop the chips/aggression from an all-in.
    // Leaving it unmatched surfaces the true wording in the calibration panel so
    // a correct handler (with amount capture) can be written. See README.
    { type: 'flop', re: /^flop:?\s*(.+)/i },
    { type: 'turn', re: /^turn:?\s*(.+)/i },
    { type: 'river', re: /^river:?\s*(.+)/i },
    { type: 'shows', re: /^(.+?) shows? (.+)/i },
    { type: 'wins', re: /^(.+?) wins? \$?([\d,]+)/i },
  ];

  let heroXid = null;
  let currentHand = null;
  const seenUnmatchedLines = []; // for calibration panel

  function freshHandState() {
    const dealtIn = seatedXids(); // snapshot of who's seated *before* any folds happen this hand
    return {
      street: 'preflop',
      pot: 0,
      contributions: {},       // xid -> total chips this hand
      streetContributions: {}, // xid -> chips this street
      dealtInXids: dealtIn,    // immutable — used as the "hands observed" denominator
      playersIn: new Set(dealtIn), // mutable — shrinks as players fold, used for opportunity counts
      winners: [],             // {xid, amount}[] — supports split pots, applied at hand end
      actions: [],             // {x,a,amt,s}[] — replayable action log for the History tab
      shown: {},               // xid -> cards revealed at showdown
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

  function resolveXidFromSeat(seatEl) {
    const link = seatEl.querySelector(SELECTORS.seatNameLink);
    if (!link) return null;
    const m = /XID=(\d+)/.exec(link.href || '');
    return m ? m[1] : null;
  }

  function seatedXids() {
    const xids = new Set();
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveXidFromSeat(seat);
      if (xid) xids.add(xid);
    });
    return xids;
  }

  function findHeroXid() {
    const heroSeat = document.querySelector(SELECTORS.heroSeat);
    if (heroSeat) {
      const xid = resolveXidFromSeat(heroSeat);
      if (xid) return xid;
    }
    return null;
  }

  function parseCardsFromContainer(container) {
    if (!container) return [];
    const cardEls = container.querySelectorAll(SELECTORS.heroCards || '');
    const cards = [];
    cardEls.forEach((el) => {
      const m = CARD_CLASS_RE.exec(el.className || '');
      if (m) cards.push({ suit: m[1][0].toLowerCase(), rank: m[2].toUpperCase() });
    });
    return cards;
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
        if (xid) { mergePseudoPlayer(xid, name); return xid; }
      }
    }
    for (const seat of seats) {
      if ((seat.textContent || '').includes(name)) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { mergePseudoPlayer(xid, name); return xid; }
      }
    }
    return 'name:' + name; // fallback pseudo-id if XID can't be resolved yet
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

  function handleLogLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

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
      applyHandResultsAndReset();
      return;
    }

    if (type === 'postSB' || type === 'postBB') {
      const xid = nameToXidGuess(m[1].trim());
      const amt = parseAmount(m[2]);
      addContribution(hand, xid, amt);
      logAction(hand, xid, type === 'postSB' ? 'sb' : 'bb', amt);
      hand.playersIn.add(xid);
      return;
    }

    if (type === 'fold') {
      const xid = nameToXidGuess(m[1].trim());
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
      const xid = nameToXidGuess(m[1].trim());
      recordStreetAction(xid, 'check', hand);
      logAction(hand, xid, 'check', 0);
      return;
    }

    if (type === 'call') {
      const xid = nameToXidGuess(m[1].trim());
      const amt = parseAmount(m[2]);
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'call', hand);
      logAction(hand, xid, 'call', amt);
      maybeCountVpip(xid, hand);
      return;
    }

    if (type === 'bet') {
      const xid = nameToXidGuess(m[1].trim());
      const amt = parseAmount(m[2]);
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'bet', hand);
      logAction(hand, xid, 'bet', amt);
      maybeCountVpip(xid, hand);
      markAggressor(xid, hand);
      maybeCountCbet(xid, hand);
      return;
    }

    if (type === 'raise') {
      const xid = nameToXidGuess(m[1].trim());
      const amt = parseAmount(m[2]);
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

    if (type === 'flop' || type === 'turn' || type === 'river') {
      hand.street = type;
      hand.streetContributions = {};
      hand.cbetOpportunity = {};
      hand.cbetFacedThisStreet = null;
      if (hand.lastAggressor) {
        hand.cbetOpportunity[hand.lastAggressor] = true;
        getPlayer(hand.lastAggressor).cbetOpp += 1;
        saveStore();
      }
      return;
    }

    if (type === 'shows') {
      const xid = nameToXidGuess(m[1].trim());
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
      const xid = nameToXidGuess(m[1].trim());
      const amt = parseAmount(m[2]);
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

    if (hand.winners.length > 0) {
      const wonByXid = {};
      hand.winners.forEach((w) => { wonByXid[w.xid] = (wonByXid[w.xid] || 0) + w.amount; });

      const contributors = Object.keys(hand.contributions);
      const totalContributed = contributors.reduce((sum, xid) => sum + hand.contributions[xid], 0) || 1;

      if (heroXid) {
        const heroWon = wonByXid[heroXid] || 0;
        const heroContributed = hand.contributions[heroXid] || 0;
        const heroDelta = heroWon - heroContributed;
        STORE.hero.netChips += heroDelta;

        // Proportional P/L attribution, stored from HERO's perspective:
        // positive plChipsEst means you're up against that player. Split the
        // pot's net swing to/from hero across contributing opponents in
        // proportion to their contribution (an estimate for multiway pots,
        // exact when it's just hero + one villain).
        for (const xid of contributors) {
          if (xid === heroXid) continue;
          const share = hand.contributions[xid] / totalContributed;
          getPlayer(xid).plChipsEst += heroDelta * share;
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
    STORE.hands.unshift({
      t: Date.now(),
      street: hand.street,
      pot: hand.pot,
      players: Array.from(hand.dealtInXids),
      actions: hand.actions,
      winners: hand.winners,
      shown: hand.shown,
      heroCards: hand.heroCardsAtShowdown || null,
    });
    const limit = STORE.settings.historyLimit || 200;
    if (STORE.hands.length > limit) STORE.hands.length = limit;
  }

  function playerDisplayName(xid) {
    const p = STORE.players[xid];
    if (p && p.name) return p.name;
    return String(xid).startsWith('name:') ? String(xid).slice(5) : '#' + xid;
  }

  // Render one stored hand as a compact, readable summary.
  function formatHand(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const lines = [`[${when}] pot $${(h.pot || 0).toLocaleString()} — reached ${h.street}`];
    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      const acts = byStreet[street].map((a) => {
        const nm = playerDisplayName(a.x);
        const mark = (focusXid && a.x === focusXid) ? '*' : '';
        const amt = a.amt ? ` $${a.amt.toLocaleString()}` : '';
        return `${mark}${nm} ${a.a}${amt}`;
      }).join(', ');
      lines.push(`  ${street}: ${acts}`);
    });
    Object.keys(h.shown || {}).forEach((xid) => {
      lines.push(`  showdown: ${playerDisplayName(xid)} shows ${h.shown[xid]}`);
    });
    (h.winners || []).forEach((w) => {
      lines.push(`  → ${playerDisplayName(w.xid)} wins $${(w.amount || 0).toLocaleString()}`);
    });
    return lines.join('\n');
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

  // The same log line can arrive via several mutation records (once for the row,
  // once for an inner span), and the body-wide fallback makes that much more
  // likely. Suppress an identical line seen again within a short window —
  // but not longer, since "X folds" legitimately recurs across hands.
  const recentLines = new Map();
  const DEDUP_MS = 1500;
  function recentlyHandled(text) {
    const now = Date.now();
    for (const [k, t] of recentLines) if (now - t > DEDUP_MS) recentLines.delete(k);
    if (recentLines.has(text)) return true;
    recentLines.set(text, now);
    return false;
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
      for (const mut of mutations) {
        mut.addedNodes.forEach((node) => {
          if (isOwnNode(node)) return;
          const text = (node.textContent || '').trim();
          if (!text || text.length > 300) return;
          if (recentlyHandled(text)) return;
          handleLogLine(text);
        });
      }
    });
    logObserver.observe(target, { childList: true, subtree: true });
    return true;
  }

  function isHeroTurn() {
    const buttons = document.querySelectorAll(SELECTORS.actionButtons);
    return buttons.length > 0;
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
      if (!heroXid) heroXid = findHeroXid();
      attachLogObserver();
    }, 3000);
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
    const r = computeRates(player);
    for (const rule of ARCHETYPE_RULES) {
      if (rule.test(r)) return rule.name;
    }
    return 'Balanced';
  }

  // ===========================================================================
  // 9. GTO-INSPIRED STRATEGY MODULE
  // ===========================================================================

  // Simplified, approximate RFI (raise-first-in) charts, 6-max 100bb style —
  // heuristic reference points, not solver output. Standard range notation.
  const RFI_RANGES = {
    EP: '77+,ATs+,KTs+,QTs+,JTs,AJo+,KQo',
    MP: '66+,A9s+,K9s+,QTs+,JTs,T9s,A9o+,KJo+',
    CO: '44+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,A7o+,KTo+,QJo',
    BTN: '22+,A2s+,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,A2o+,K7o+,Q9o+,J9o+,T9o',
    SB: '22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,A5o+,K9o+,QTo+,JTo',
  };

  // Approximate 3-bet ranges vs. an EP/MP-style open, in position vs out of position.
  const THREE_BET_RANGES = {
    IP: 'QQ+,AKs,AKo,A5s,A4s,KQs',
    OOP: 'QQ+,AKs,AKo',
  };

  function expandRangeToken(token) {
    // Handles: pair "88", pair+ "88+", pair range "66-99",
    // suited/offsuit exact "AJs", plus "AJs+", range "A5s-A9s".
    const idx = rankIdx;
    const hands = new Set();

    const pairPlus = /^([2-9TJQKA])\1\+$/.exec(token);
    const pairRange = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(token);
    const pairExact = /^([2-9TJQKA])\1$/.exec(token);
    const suitedPlus = /^([2-9TJQKA])([2-9TJQKA])(s|o)\+$/.exec(token);
    const suitedRange = /^([2-9TJQKA])([2-9TJQKA])(s|o)-([2-9TJQKA])\2(s|o)$/.exec(token);
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

  function parseRange(rangeStr) {
    const all = new Set();
    rangeStr.split(',').forEach((tok) => {
      expandRangeToken(tok.trim()).forEach((h) => all.add(h));
    });
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

  function minimumDefenseFrequency(bet, pot) {
    return pot / (pot + bet); // fraction of the time defender must continue
  }

  function optimalBluffRatio(bet, pot) {
    return bet / (pot + bet); // bluff-combo fraction that keeps a bettor's range balanced
  }

  function gtoBaselineSuggestion(ctx) {
    const { street, position, heroCards, betFacing, pot } = ctx;
    if (street === 'preflop' && heroCards) {
      const rfiRange = RFI_RANGES[position] || RFI_RANGES.CO;
      if (!betFacing) {
        return isHandInRange(heroCards[0], heroCards[1], rfiRange)
          ? 'GTO baseline: open-raise (in your RFI range).'
          : 'GTO baseline: fold (outside standard opening range).';
      }
      return isHandInRange(heroCards[0], heroCards[1], THREE_BET_RANGES.IP)
        ? 'GTO baseline: 3-bet (in a standard 3-bet range).'
        : 'GTO baseline: fold/flat depending on pot odds (outside standard 3-bet range).';
    }
    if (betFacing != null && pot != null) {
      const mdf = minimumDefenseFrequency(betFacing, pot);
      return `GTO baseline: defend roughly ${fmtPct(mdf * 100)} of your range here (MDF).`;
    }
    return 'GTO baseline: check/bet a balanced portion of your range.';
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
  // 8. COACH PROMPTS (advisory only — never auto-acts)
  // ===========================================================================

  function buildCoachAdvice() {
    if (!isHeroTurn() || !currentHand) return null;
    const heroCards = parseCardsFromContainer(document.querySelector(SELECTORS.heroSeat));
    const villainXid = currentHand.lastAggressor;
    const ctx = {
      street: currentHand.street,
      position: 'CO', // position detection needs dealer-button calibration; defaults conservatively
      heroCards: heroCards.length === 2 ? heroCards : null,
      betFacing: villainXid ? (currentHand.streetContributions[villainXid] || 0) : 0,
      pot: currentHand.pot,
    };
    const baseline = gtoBaselineSuggestion(ctx);
    const deviation = exploitDeviation(villainXid);
    const potOdds = ctx.betFacing ? `Pot odds: need ~${fmtPct(optimalBluffRatio(ctx.betFacing, ctx.pot) * 100)} equity to continue.` : null;
    return [baseline, deviation, potOdds].filter(Boolean);
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
    if (r.wtsd != null) lines.push(`Goes to showdown ${fmtPct(r.wtsd)} of hands played.`);
    lines.push(`Your estimated chips won/lost against them: ${p.plChipsEst >= 0 ? '+' : ''}${Math.round(p.plChipsEst)} (est., proportional multiway attribution — positive means you're up).`);
    if (p.notes) lines.push(`Notes: ${p.notes}`);
    return lines.join('\n');
  }

  // ===========================================================================
  // 7. HUD OVERLAY
  // ===========================================================================

  const CSS = `
    .tph-badge { position: fixed; z-index: 99998; background: rgba(20,20,24,0.92); color: #eee;
      border: 1px solid #555; border-radius: 6px; padding: 3px 6px; font: 11px/1.3 -apple-system, sans-serif;
      cursor: pointer; pointer-events: auto; max-width: 150px; }
    .tph-badge b { color: #ffd166; }
    .tph-panel { position: fixed; z-index: 99999; top: 10%; left: 5%; right: 5%; max-height: 80%; overflow-y: auto;
      background: #1b1b1f; color: #eee; border: 1px solid #666; border-radius: 8px; padding: 12px;
      font: 13px/1.4 -apple-system, sans-serif; }
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
    .tph-close { position: absolute; top: 8px; right: 10px; cursor: pointer; }
    /* Raised well above the bottom edge so it doesn't sit under Torn PDA's own
       native controls, enlarged and labelled so it's unmistakably OUR button. */
    /* touch-action:none so dragging the button doesn't scroll the page under it */
    .tph-gear { position: fixed; z-index: 100000; bottom: 96px; right: 12px; background: #b8342e; color: #fff;
      border: 2px solid #fff; border-radius: 22px; height: 44px; min-width: 44px; padding: 0 12px;
      display: flex; align-items: center; gap: 5px; font: bold 13px/1 -apple-system, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none; }
    .tph-gear.tph-dragging { cursor: grabbing; opacity: 0.85; }
    .tph-coach { position: fixed; z-index: 99998; bottom: 150px; right: 12px; left: 12px; background: rgba(20,20,24,0.95);
      color: #cde; border: 1px solid #556; border-radius: 8px; padding: 8px; font: 12px/1.4 -apple-system, sans-serif; }
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

  function renderBadges() {
    document.querySelectorAll('.tph-badge').forEach((el) => el.remove());
    const seats = document.querySelectorAll(SELECTORS.seatContainer);
    seats.forEach((seat) => {
      const xid = resolveXidFromSeat(seat);
      if (!xid || xid === heroXid) return;
      const player = STORE.players[xid];
      const rect = seat.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'tph-badge';
      badge.style.top = Math.max(0, rect.top - 20) + 'px';
      badge.style.left = rect.left + 'px';
      const label = player ? classify(player) : 'Unrated';
      const r = player ? computeRates(player) : {};
      badge.innerHTML = `<b>${label}</b> ${fmtPct(r.vpip)}/${fmtPct(r.pfr)} AFq${fmtPct(r.afq)}`;
      badge.addEventListener('click', () => openPlayerPanel(xid));
      document.body.appendChild(badge);
    });
  }

  function renderCoachPanel() {
    let el = document.querySelector('.tph-coach');
    const advice = buildCoachAdvice();
    if (!advice || advice.length === 0) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'tph-coach';
      document.body.appendChild(el);
    }
    el.innerHTML = advice.map((line) => `<div>${line}</div>`).join('');
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
          <tr><td>Your P/L vs them</td><td>${p.plChipsEst >= 0 ? '+' : ''}${Math.round(p.plChipsEst)}</td></tr>
        </table>
      `;
    } else if (openPlayerTab === 'report') {
      const text = buildReport(openPlayerXid);
      body.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre><button class="tph-copy-report">Copy report</button>`;
      body.querySelector('.tph-copy-report').addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(text);
      });
    } else if (openPlayerTab === 'history') {
      const hands = handsInvolving(openPlayerXid);
      if (!hands.length) {
        body.innerHTML = '<i>No hands recorded with this player yet.</i>';
      } else {
        const text = hands.slice(0, 40).map((h) => formatHand(h, openPlayerXid)).join('\n\n');
        body.innerHTML = `<div style="opacity:.7;margin-bottom:6px">${hands.length} hand(s) recorded — their actions marked *</div>`
          + `<pre style="white-space:pre-wrap;font:11px/1.35 monospace">${escapeHtml(text)}</pre>`
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
            <td style="color:${pl >= 0 ? '#7ed957' : '#ff6b6b'}">${pl >= 0 ? '+' : ''}${pl.toLocaleString()}</td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="5"><i>No players tracked yet.</i></td></tr>`;

    panel.innerHTML = `
      <span class="tph-close">✕</span>
      <h3>Tracked players (${all.length})</h3>
      <input class="tph-pfilter" placeholder="Filter by name…" value="${escapeHtml(playersFilter)}" style="width:60%">
      <table class="tph-ptable">
        <tr><th>Name</th><th>Type</th><th>Hands</th><th>VPIP/PFR</th><th>P/L</th></tr>
        ${rows}
      </table>
      <div style="opacity:.7;margin-top:8px">Total hands recorded: ${(STORE.hands || []).length} &nbsp;|&nbsp; Your net: ${STORE.hero.netChips >= 0 ? '+' : ''}${Math.round(STORE.hero.netChips).toLocaleString()}</div>
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
      <label>Min hands before rating: <input type="number" class="tph-min-hands" value="${STORE.settings.minHands}" style="width:60px"></label><br><br>
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
    panel.querySelector('.tph-min-hands').addEventListener('change', (e) => {
      STORE.settings.minHands = parseInt(e.target.value, 10) || 20;
      saveStore();
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
    L.push('=== TORN POKER HUD DEEP SCAN v0.3.0 ===');
    L.push('url: ' + location.pathname + location.search);
    L.push('logObserver: ' + (logObserver ? (logUsingFallback ? 'ACTIVE (body fallback)' : 'ACTIVE (container)') : 'NOT ATTACHED'));
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

  // Keep the button fully on screen — also re-applied on rotate/resize so it
  // can't end up stranded off the edge in the other orientation.
  function setGearPos(el, left, top) {
    const w = el.offsetWidth || 60;
    const h = el.offsetHeight || 44;
    const L = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
    const T = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - h));
    el.style.left = L + 'px';
    el.style.top = T + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function applyGearPosition(el) {
    const p = STORE.settings.gearPos;
    if (p && typeof p.left === 'number' && typeof p.top === 'number') setGearPos(el, p.left, p.top);
  }

  // Drag to move, tap to open settings. A small movement threshold separates the
  // two, so a slightly-imprecise tap still opens the panel instead of nudging
  // the button and doing nothing.
  const DRAG_THRESHOLD_PX = 6;

  function makeDraggable(el, onTap) {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, pid = null;

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      pid = e.pointerId;
      const rect = el.getBoundingClientRect();
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
      if (!moved) el.classList.add('tph-dragging');
      moved = true;
      setGearPos(el, originLeft + dx, originTop + dy);
      e.preventDefault();
    });

    const endDrag = (e) => {
      if (!dragging || (e.pointerId != null && e.pointerId !== pid)) return;
      dragging = false;
      el.classList.remove('tph-dragging');
      if (el.releasePointerCapture && pid != null) {
        try { el.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      }
      if (moved) {
        const rect = el.getBoundingClientRect();
        STORE.settings.gearPos = { left: rect.left, top: rect.top };
        saveStore();
      } else {
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
    applyGearPosition(gear);
    makeDraggable(gear, () => { settingsOpen = !settingsOpen; renderSettingsPanel(); });

    window.addEventListener('resize', () => {
      const rect = gear.getBoundingClientRect();
      setGearPos(gear, rect.left, rect.top);
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
