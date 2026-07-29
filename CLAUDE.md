# Torn Poker HUD — working context

Context for Claude Code sessions on this repo. Read before changing anything.

## What this is

A single-file userscript (`torn-poker-hud.user.js`) for **Torn PDA**, the mobile
companion app for Torn (a browser MMORPG). It tracks opponent tendencies in
Torn's in-game Texas Hold'em room. Not a real-money poker site.

Installed on the phone **by URL**, not by pasting:
`https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js`

Update loop: edit → commit → push → re-fetch the script in Torn PDA
(Manage scripts → update). GitHub's raw CDN caches for a few minutes.

## Current status (v0.8.0)

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

What one real calibration run has already told us (trust this over guesses):

| Selector | Result | Implication |
|---|---|---|
| `seatContainer` | 9 ✅ | seat detection works |
| `heroCards` | 2 ✅ | hole cards readable |
| `logContainer` | **0** ❌ | action log NOT found — body-fallback observer added |
| `seatNameLink` | **1** ❌ | seats have **no profile links** → identity is by display name, not XID |
| `communityCards`, `potDisplay`, `actionButtons`, `dealerButton` | 0 ❌ | all unresolved |

Log wording is **past tense with status glyphs**: `"✔ ImEx called"`. Patterns
must accept both tenses and treat amounts as optional — an earlier version
required present tense and matched literally nothing.

## Next task

Get a **deep scan** from a live table: in the HUD, ⚙ button → Calibration mode →
"Run deep scan" → "Copy report". That dumps real class names, seat contents, and
element ancestry as pasteable text. Use it to fix `SELECTORS` / `LOG_PATTERNS`.
Until then, treat empty stats as expected, not as a new bug.

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
