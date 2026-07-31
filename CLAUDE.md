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

## Current status (v0.13.0)

Selectors and log wording are **calibrated against real scans**. Parsing is
believed working — action rows no longer appear unmatched — but no stat or
position output has been confirmed correct at a live table yet. Treat behaviour
as plausible, not verified.

**Stats gathered before v0.11.0 are inflated and should be reset.** Log ingestion
used to read MutationObserver `addedNodes`; the user reported one real hand
appearing several times in the History tab, which means old lines were being
re-parsed as new events every time Torn re-rendered the list. Everything derived
from those lines — hand counts, VPIP, PFR, P/L — was over-counted by the same
mechanism, so the existing numbers can't be repaired, only discarded
(Settings → Reset all data).

Built: per-player stats (VPIP/PFR/AFq/3-bet/fold-to-3-bet/C-bet/WTSD), archetype
tags, plain-language tendency reports, per-opponent P/L (proportional multiway
attribution, explicitly an estimate), hand history, a tracked-players browser,
GTO-inspired coach prompts, a verified Monte Carlo equity engine, position
inference, session tracking, bet-sizing tells, and optional GitHub Gist sync.

## The critical constraint

**Nobody working on this can log into Torn or inspect the live poker DOM.**
Torn uses hashed CSS-module class names, and they change on redeploy. Selectors
can only be confirmed by asking the user to run a deep scan and paste it back —
never assume a change works because it looks right.

Two **deep scans from a live table (latest v0.4.0)** have replaced guesswork for
most of this. Observed structure (trust this over inference):

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
verb**: `<li><span>Name</span><span>called $3,500,000</span></li>`. Rows are read
whole, never from the mutated inner span — that alone yielded
`"called $3,500,000"` with no name, which failed every name-anchored pattern.
That, not the selectors, was why no stat ever recorded.

## Log ingestion: read snapshots, never mutation records (v0.11.0)

`scanLogRows()` reads the text of **every** `logRow` in DOM order and diffs that
list against the previous snapshot; only lines absent from the previous snapshot
are parsed. Do not "simplify" this back to reading `MutationObserver`
`addedNodes` — that is the bug it exists to fix.

Torn's message list **re-renders in place**: the `<li>` elements persist and
their text is rewritten as messages shift through the list (consistent with the
`old_`/`current_` state modifiers on rows). One new message therefore mutates
every row, and a node-based parser re-parsed the whole visible log as if it had
just happened. The 1.5s text dedup could not catch it, because the replayed lines
were minutes old. Symptom: one real hand recorded several times in History, and
every stat inflated with it.

Consequences worth knowing before touching this code:

- Content diffing, not node identity, so it survives the SPA swapping in a whole
  new log element. **Don't reset the snapshot when the observer re-attaches** —
  that would silently drop real lines.
- Which end the list grows from is **not known** (no live DOM access). Both
  directions are tried per tick, the longer overlap wins, and the result is
  latched in `logOrientation` for ties.
- Lines already on screen at load prime the snapshot and are deliberately **not**
  parsed — they are a partial hand that is already over.
- The scan is idempotent, which is why a 1s poll backs up the observer. Any new
  wake-up path can just call `scanLogRows()`.
- `parseAddedNodes` survives only for pages where `logRow` matches nothing. It
  cannot tell a re-render from an event; it is a last resort, not a second path.
- Second layer: hands carry Torn's `Game <hex>` id (`hand.gameId`, stored as `g`).
  A marker whose id is already open or already recorded is ignored.

Both the diff and the log patterns were validated with throwaway node scripts
against the real wording — including newest-first and newest-last lists, capped
lists, mid-session joins and a log cleared between hands.

Other real wording, all confirmed in v0.4.0:

- Hand boundary is `Game <hex id> started` — **with** the "Game " prefix. An
  earlier pattern read it off a body-fallback fragment that had lost the prefix
  and anchored on the hex, so no hand ever ended and `actionOrder` accumulated
  across hands, corrupting every derived position.
- Streets are `The flop:  5♣, 7♦, A♦` — definite article, double space, unicode
  suits. Anchoring on the bare street name meant the board was never read.
- Showdowns say `reveals`, not `shows`.
- Raises read `raised $1,000,000 to $2,000,000` where the **second** figure is
  the total.
- `joined/left the table` and `The preflop Two cards dealt to each player` are
  filtered as noise, so the unmatched list only shows genuinely unparsed wording.

## Preflop charts: measure them, don't eyeball them (v0.12.0)

The ranges in `RFI_RANGES` / `THREE_BET_RANGES` / `FOUR_BET_RANGE` carry a
measured percentage in a trailing comment. It is combo-weighted (pair 6, suited
4, offsuit 12, out of 1326), not hand-count — eyeballing a range string
underestimates offsuit hands by 3x, which is how the originals ended up at
roughly two-thirds of their intended width and told you to fold standard opens.

If you change a range, re-measure and update the comment. Keep the invariants:
each later seat's opening range contains the earlier one, each 3-bet/4-bet range
fits inside the opening range of a seat that would make it, and every full-ring
chart is at least as tight as its short-handed equivalent.

### Where the numbers come from (v0.13.0)

Widths are calibrated to published charts, cited in a block comment above
`RFI_RANGES`. The hand at each range *edge* is still a reconstruction that hits
that width — the sources publish charts as images, so the compositions could not
be lifted verbatim.

**Verify a published chart before believing it.** A range string and its stated
percentage are two independent claims, and they frequently disagree: of 23
position charts pulled from three sites, 8 failed a re-measure, usually because
the offsuit block was missing — a "43.5%" button range that weighs 22% with zero
offsuit combos. Only figures where the string matched its own percentage within
3pp were used. Do the same for anything added later.

Weakest number in the set, flagged in the code too: **full-ring SB**. No source
survived the check, because published SB charts mix raising and limping, so the
quoted percentage covers both. It is banded by analogy with the 6-max SB.

### Two chart sets, chosen per hand

Torn runs both short and full ring, so `rfiChartFor(position, seats)` picks
`RFI_RANGES.SHORT` (≤6 handed) or `.FULL` (7+). The seat count comes from the
hand's own `dealtInXids`, **not** from the `tableMax` setting — that setting only
drives the equity quote. `seatLabel` names positions from the button backwards so
it degrades sensibly at 7- and 8-handed tables rather than assuming exactly nine.

This mattered a lot: at 9-handed, four distinct early seats previously collapsed
onto one `EP` label and got the 6-max chart, so true UTG was being told to open
~17% when published full-ring UTG is ~11%.

### Say what the advice is

User-facing lines say **"Baseline"**, not "GTO baseline", and the coach panel
carries a footnote naming these as reference charts rather than solver output.
Don't restore the old wording — it claimed the authority of an equilibrium
solution for hand-built charts.

Two failure modes worth knowing:

- **Silent token drops.** `expandRangeToken` returns an empty set for anything it
  doesn't recognise, with no error. `A5s-A9s` was unparseable for several
  versions because its backreferences were on the wrong groups. A range can lose
  a whole chunk of hands and still look fine in the source.
- **Right chart, wrong spot.** The chart is chosen by *situation* in
  `preflopBaseline`: unopened / limped / facing one open / facing a re-raise /
  hero already opened / big blind. It used to be chosen by `betFacing` alone,
  which cannot tell an unopened pot from a limped one, or a 3-bet from a 4-bet.
  The big blind deliberately has no RFI entry — an unknown label used to fall
  back to the cutoff chart, which is a confident wrong answer.

Both the widths and the situation routing were validated with throwaway node
scripts driving the real functions out of the file.

Still approximate on purpose, and the UI should keep saying so: heuristic charts
rather than solver output, no ante/straddle modelling, ~100bb assumed. One known
routing hazard is noted in the code — `preflopRaiseEvents` counts an all-in as a
raise, so a short-stack all-in *call* can make the coach read the spot as facing
a 3-bet.

## Next task

Confirm at a live table that stats populate and that inferred positions ("CO?")
are actually right. The position inference assumes every seat between the BB and
hero has acted; if Torn silently skips a seat (already all-in, or timed out
without a log line) the labels drift by one in a consistent direction.

Still unresolved, and both remain inference: **`actionButtons`** and
**`dealerButton`**.

`dealerButton` is a red herring for position — it is declared in `SELECTORS` and
referenced nowhere else. Position comes entirely from the log: `buildRotation`
needs a parsed `postSB` line for `sbXid`, then orders the table by preflop
action. **Position therefore depends on log parsing working, not on finding the
dealer button.** Fixing that selector would not move position on its own.

An unexploited find worth considering: `SPAN[class*="srOnly_"]` carries the full
sentence in plain text — `"GhostNote420 checked The river: 4 of hearts"` — with
spelled-out card names. It is a cleaner parse target than the visual log, but
feeding both sources into the parser risks double-counting actions, so it needs
dedup by (actor, action, street) rather than by raw text. Note the snapshot
scanner does **not** solve this: it dedups a source against its own history, not
two sources against each other.

Also unset by default and required for profit/loss to work at all:
**Settings → Your Torn username.** With it blank, `heroXid` is null and no P/L
is attributed.

## Conventions

- **No build step.** One file, pasted/fetched whole. No imports, no bundler.
- **Torn PDA runtime is limited**: no `GM_xmlhttpRequest`, no IndexedDB. Use the
  `pdaFetch` adapter (`PDA_httpGet`/`PDA_httpPost`, falling back to `fetch`).
- **Verify before pushing.** `node` IS available (this claim used to say
  otherwise): run `node --check torn-poker-hud.user.js` on every edit, and
  prototype tricky logic as a throwaway script — log patterns and the position
  mapping were both validated that way against real scan lines before pushing.
  The equity evaluator was validated in Python against published preflop
  equities before porting.
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
