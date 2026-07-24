# Torn Poker HUD

Opponent-tendency HUD for Torn's holdem room, built for Torn PDA's custom-script
runtime. Tracks per-player stats (VPIP/PFR/aggression/3-bet/C-bet/WTSD), tags an
archetype (Nit/TAG/LAG/Fish/Maniac), shows advisory GTO-inspired coach prompts on
your own turn, estimates profit/loss per opponent, and generates a plain-language
tendency report per player — with optional GitHub Gist sync so data follows you
across devices.

This is a from-scratch build for Torn PDA's constraints (no `GM_xmlhttpRequest`,
no IndexedDB, no full-browser-tab OAuth) — not a port of any existing desktop
Tampermonkey script.

**The coach panel is advisory only.** It never clicks buttons or acts for you —
it just prints suggested reads. You make every decision.

## Install

Paste `torn-poker-hud.user.js` into Torn PDA's custom scripts (Settings →
Advanced Browser Settings → Custom Scripts) the way you normally add a script.
It activates on `torn.com/page.php?sid=holdem`.

## First run: expect one calibration pass

Torn's poker page uses hashed CSS class names that change on redeploys, and I
built the DOM selectors (`SELECTORS` near the top of the file) from public
write-ups of similar scripts rather than the live page — I have no way to log
into Torn and inspect it directly. So the first time you open the holdem table:

1. Tap the gear icon → check **Calibration mode**.
2. A panel appears at the top of the screen showing how many elements each
   selector currently matches, plus any action-log lines the parser didn't
   recognize.
3. If `seatContainer`, `logContainer`, or others read `0`, or unmatched lines
   pile up, send me (or paste back into this conversation) what the calibration
   panel shows — actual class names, actual log line wording — and I'll adjust
   `SELECTORS` / `LOG_PATTERNS` at the top of the file to match.
4. Turn calibration mode off once things look right; it's just a debug aid.

The `pdaFetch` adapter (used for Gist sync) has the same caveat: Torn PDA's
`PDA_httpGet`/`PDA_httpPost` call signature isn't fully documented, so if sync
calls fail, that function (top of the file, Section 1) is the one place to
patch.

## Setting up GitHub Gist sync (optional)

This lets your tracked stats follow you across devices/reinstalls. Skip this
section if you only want on-device tracking — everything else works without it.

1. On github.com (a normal browser, not needed inside PDA): **Settings → Developer
   settings → OAuth Apps → New OAuth App**. Any name/homepage URL works; the
   callback URL field can be anything since Device Flow doesn't use it.
2. After creating it, open the app's settings and enable **"Enable Device Flow"**.
3. Copy the **Client ID** (not a secret — Device Flow doesn't need one) and
   paste it into the HUD's Settings panel → GitHub Gist sync → Client ID field.
4. Tap **Connect**. The panel shows a code and a URL
   (`github.com/login/device`) — open that URL in your phone's regular browser
   (not the Torn PDA webview, since it's a full OAuth login page) and enter the
   code.
5. Once authorized, the HUD creates a secret Gist (`torn-poker-hud-data.json`)
   and syncs your tracked data to it. On future loads it pulls the Gist and
   merges by keeping whichever side (local vs. remote) has more observed hands
   for each player — so reinstalling or switching devices doesn't lose data.

You can also just use **Backup → Copy** / **Import** in Settings for a manual
JSON copy-paste backup, no GitHub account needed.

## Scope notes (deliberate, not oversights)

- **GTO guidance is heuristic, not a solver.** Preflop range checks use static,
  approximate range charts; postflop uses minimum-defense-frequency and
  balanced-bluff-ratio formulas. It's a reference point, then nudged by the
  specific opponent's tracked stats — not a true equilibrium solve.
- **Per-opponent P/L in multiway pots is a proportional estimate**, not an
  exact ledger — a pot's net swing is split across involved opponents by their
  share of the pot's contributions. It's labeled "(est.)" in the UI for that
  reason.
- **No hole-card equity solver, no auto-play.** The coach module reasons from
  pot odds, range charts, and tracked opponent tendencies — it doesn't compute
  hand-vs-range equity, and it never acts on your behalf.
