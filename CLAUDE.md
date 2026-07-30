# Torn Poker HUD — working context

Context for Claude Code sessions on this repo. Read before changing anything.

## What this is

A single-file userscript (`torn-poker-hud.user.js`) for **Torn PDA**, the mobile
companion app for Torn (a browser MMORPG). It tracks opponent tendencies in
Torn's in-game Texas Hold'em room. Not a real-money poker site.

Installed on the phone **by URL**, not by pasting:
`https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js`

Update loop: edit → **bump `@version`** → commit → push → re-fetch the script in
Torn PDA (Manage scripts → update). GitHub's raw CDN caches for a few minutes.

Nothing automates the version bump — there is no build step and no hook, just a
single hand-edited file. Userscript managers compare `@version` to decide
whether an update exists, so leaving it stale means a reinstall elsewhere won't
see new code as newer. Bump it in the same commit as the change.

## Current status (v0.9.0)

Feature-complete on paper, **not yet confirmed working against the live page.**
The blocking task is a calibration pass — see below.

Built: per-player stats (VPIP/PFR/AFq/3-bet/fold-to-3-bet/C-bet/WTSD), archetype
tags, plain-language tendency reports, per-opponent P/L (proportional multiway
attribution, explicitly an estimate), hand history, a tracked-players browser,
GTO-inspired coach prompts, a verified Monte Carlo equity engine, position
inference, session tracking, bet-sizing tells, and optional GitHub Gist sync.

## The critical constraint

**Nobody working on this can log into Torn or inspect the live poker DOM.**
Torn uses hashed CSS-module class names. Every selector in `SELECTORS` is
inference, not observation. Do not assume they work.

A **deep scan v0.3.0 from a live table** has now replaced guesswork for most of
this. Observed structure (trust this over inference):

| Thing | Real DOM |
|---|---|
| Log list | `UL[class*="messagesList_"]` |
| Log row | `LI[class*="message_"]`, with `old_`/`current_` state modifiers |
| Seat | `DIV[id="player-<XID>"]` + `opponent_` / `default_` / `folded_` classes |
| Pot | `DIV[class*="totalPotWrap_"]` inside `potsWrapper_` |
| Hero cards | `hand_` → `flipperWrap_` → `flipper_` → `front_` → `spades-5_` |

Two findings that overturn earlier notes:

1. **Identity is by XID after all.** Seats have no profile links (1 of 6), but
   the XID is on the element id — `id="player-3722665"`. `resolveXidFromSeat`
   reads the id first and only falls back to the anchor.
2. **Hashes come in both `name___hash` and `name_hash` shapes**, sometimes for
   the same base. Match on a single trailing underscore (`[class*="front_"]`);
   the old `___` prefixes missed roughly half the elements.

Log wording is **past tense, no glyphs, and the row splits the actor from the
verb**: `<li><span>Name</span><span>called $3,500,000</span></li>`. The observer
climbs to the enclosing `logRow` before parsing — reading the mutated inner span
alone yielded `"called $3,500,000"` with no name, which failed every
name-anchored pattern. That, not the selectors, was why no stat ever recorded.

Other real wording: hand boundary is `<hex id> started`; raises read
`raised $1,000,000 to $2,000,000` where the **second** figure is the total.

## Next task

Re-run calibration and confirm actions now attribute to seats. Still unresolved
by the scan — no data was captured for either, so both remain inference:
**`actionButtons`** and **`dealerButton`**. Without `dealerButton`, position
inference has no anchor, so positional stats stay unreliable.

An unexploited find worth considering: `SPAN[class*="srOnly_"]` carries the full
sentence in plain text — `"GhostNote420 checked The river: 4 of hearts"` — with
spelled-out card names. It is a cleaner parse target than the visual log, but
feeding both sources into the parser risks double-counting actions, so it needs
dedup by (actor, action, street) rather than by raw text.

Also unset by default and required for profit/loss to work at all:
**Settings → Your Torn username.** With it blank, `heroXid` is null and no P/L
is attributed.

## Conventions

- **No build step.** One file, pasted/fetched whole. No imports, no bundler.
- **Torn PDA runtime is limited**: no `GM_xmlhttpRequest`, no IndexedDB. Use the
  `pdaFetch` adapter (`PDA_httpGet`/`PDA_httpPost`, falling back to `fetch`).
- **No JS runtime on the dev machine.** There's no `node`. Verify with the
  regex/template-aware bracket checker, and prototype tricky algorithms in
  Python first — the equity evaluator was validated that way against published
  preflop equities before porting.
- **Secrets never leave the device.** `exportJson()` feeds both the Copy button
  and the Gist upload; anything added to settings that is a credential must go
  in `LOCAL_ONLY_SETTINGS`.
- **The coach is advisory only.** It must never click, auto-act, or play. Keep
  it text-only.
- **Say when a number is an estimate.** Multiway P/L is modelled, not exact, and
  equity is vs random hands rather than real ranges. The UI says so; keep it
  that way.

## Data

`localStorage["tornPokerHUD_v1"]` inside the Torn PDA webview — device-local,
no server. Optional secret-Gist mirror. Clearing the app's browser data wipes it.
