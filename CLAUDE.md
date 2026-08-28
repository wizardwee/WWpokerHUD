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

## Current status (v1.0.1)

Selectors, log wording, positions, stats and P/L are all **confirmed working at
a live table**. The deep scan that was the standing next task has been run and
came back clean, so the questions this section used to carry are closed. Their
history is in `CHANGELOG.md`.

**v1.0.0 broke role badges, stats and P/L for most seats, and v1.0.1 fixes it.**
Worth reading as a pattern rather than a one-off: a hardening change to
`nameToXidGuess` used a regex lookbehind (a `SyntaxError` on older iOS JSC —
see Conventions) tested against `seat.textContent` (which concatenates children
with no separator). Both faults returned the `name:` pseudo-id, which never
equals the numeric XID `renderBadges` reads off a seat, so the failure was
total and silent. The suite passed throughout, because the test re-implemented
the regex and asserted against its own copy. **A test of a copy cannot fail
when the original is wrong** — drive the real exported function.

Built: per-player stats (VPIP/PFR/AFq/3-bet/fold-to-3-bet/C-bet/WTSD), archetype
tags, plain-language tendency reports, per-opponent P/L (proportional multiway
attribution, explicitly an estimate), hand history with file export, a
tracked-players browser, coach prompts in a resizable panel, a verified Monte
Carlo equity engine, position from the seat ring, session tracking, bet-sizing
tells, showdown ranges, and optional GitHub Gist sync.

What is still unverified is called out where it lives: `POOL_SPREAD` is a
judgement call (not re-derived when `POOL_AVG` was corrected to measured
figures in v1.11.0 — see "The pool average is measured, not borrowed"), and
the v0.22.0 identity/ring markers are read out of someone else's source.

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

## Pattern ORDER is load-bearing: wins before shows (v1.4.0)

`LOG_PATTERNS` is tried in order and the first match wins, so ordering is
behaviour, not style. **Do not move `wins` back below `shows`.**

Torn writes `Bauderix won $28,500,000 Did not show hand` for a pot taken with
no reveal. The `shows` pattern is deliberately wide (show/showed/shown/reveals/
revealed/turns over, because a missed reveal loses a showdown silently) and that
width matches the bare word **"show" inside "Did not show hand"**. With `shows`
first, the winner line was consumed as a showdown: the `wins` handler never ran,
`hand.winners` stayed empty, and `applyHandResults` gates **all** of P/L on
`hand.winners.length > 0`. Every pot won without a showdown recorded no P/L.

Two reasons this survived a long hunt, both worth internalising:

- **It was intermittent in the way that defeats debugging.** A winner who
  *shows* produces `won $65,000,000 with [J J]` — no "show", parses as a win,
  P/L fine. So it worked on some hands and not others.
- **Nothing appeared in the unmatched list**, because the line *did* match. A
  clean unmatched list proves every line matched something, **not** that
  anything matched the right thing. Check what a line matches, not just that it
  matched — `LOG_PATTERNS` can be driven directly over real scan lines.

It also fed `"Bauderix won $28,500,000 Did not"` to `nameToXidGuess` as a
username, minting a `name:` pseudo-record that `logAction` counted as a player
dealt in. Store schema 3 removes those; it drops only `name:` keys whose name
fails the username pattern, because a genuine pseudo-id holds a valid username
and must survive.

### migrateStore blocks must be gated on the version migrated FROM

The schema-2 wipe used to run unconditionally — the function checked only that
*some* migration was due, then always zeroed P/L. Bumping `STORE_VERSION` to 3
would therefore have wiped the P/L of every already-migrated store as a side
effect of an unrelated change. Each block is now `if (from < N)`. Keep it that
way, and add new blocks the same way.

**Do not reference `USERNAME_RE` (or anything declared low in the file) inside
`migrateStore`.** It runs from `let STORE = loadStore()` near the top, long
before those bindings initialise; touching one throws a temporal-dead-zone
`ReferenceError` at load, and in a userscript that means nothing runs at all.
The schema-3 check inlines its pattern for exactly this reason.

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

## Equity: random hands, or a range proxy once the pot is raised (v1.0.0)

`estimateEquity(heroCards, boardCards, nOpp, raiseLevel)` took an optional 4th
argument for how many preflop raise events the hand has seen. Omitted (or 0),
opponents are still dealt a uniformly random hand from the deck — the original
behaviour, and the honest one for an unopened or limped pot. Once the pot HAS
been raised, opponents are drawn from `opponentRangeProxy(raiseLevel)` instead:
`RFI_RANGES.SHORT.CO` for a single open, `THREE_BET_RANGES.IP` for a 3-bet,
`FOUR_BET_RANGE` for a 4-bet or more — reusing chart data this file has already
sourced and combo-weighted for the coach, not new percentages invented for
this (the same idea Torn Poker Helper, GreasyFork 538541, implements with flat
35%/12%/5% figures).

**One flat proxy per tier, not conditioned on seat count or the real opener's
position.** That identity isn't threaded through to the equity call, and
adding it would mean trusting position detection (already flagged elsewhere as
imperfect) inside the equity engine too. `RFI_RANGES.SHORT.CO` (26.4%) sits
roughly in the middle of the real spread across positions (full-ring UTG
~11.6% to short BTN ~42%) — a coarse stand-in, but a materially better one
than treating every opponent as holding any two cards.

**The first implementation was ~16x too slow to ship.** Rejecting a random
guess-and-recheck loop per opponent per Monte Carlo iteration measured ~350ms
for a single call at 8 opponents against `FOUR_BET_RANGE` (vs ~20ms
unweighted) — late opponents in a full field kept missing against an
increasingly depleted narrow pool. A second attempt that enumerated every
valid pair fresh each time wasn't meaningfully better, because it did the same
amount of work regardless of match rate. The fix that actually worked:
precompute the full list of in-range card pairs **once per call**, outside the
1200-iteration loop, then just pick from that short fixed list per opponent
per iteration (retrying against a small `usedIds` Set on a collision, not
against the whole deck). That took the worst case (8 opponents, the narrowest
range) from ~350ms to ~57ms. `test/equity-ranges.test.js` asserts a budget
tight enough that the first two approaches would fail it outright.

**A range this narrow cannot supply 8 non-conflicting hands, and that's
correct, not a bug.** `FOUR_BET_RANGE` touches on the order of a dozen
physical cards; a big field falls through to a uniform-random draw for
whichever opponents the range genuinely has nothing left to give. A table
with eight live QQ+/AK hands facing a 4-bet doesn't reflect anything real
either, so silently thinning the simulated field there is the honest outcome.

`estimateEquityCached`'s cache key includes `raiseLevel` — without it, the
same hero cards/board/opponent-count would keep serving a pre-raise figure
straight through the raise that should have changed it. The UI's basis label
(`equityBasisLabel`) tracks the same tiers as `opponentRangeProxy`: "vs
random" only when it actually is; "vs open/3-bet/4-bet range" once it isn't.

## The coach's villain tip is chosen for the SPOT (v1.2.0)

`currentExploitTip()` used to take `buildExploitPlan(p)[0]` — the villain's
highest-gain leak — and print it whatever hero was facing, so a river shove
could be met with "c-bet every flop you take the lead in". It now scores
**every** entry of every candidate villain, not each player's top one. Taking
`[0]` was the whole bug; don't reintroduce it as an optimisation.

Entries carry an optional `when` list of tokens from `handContextTokens`:
`preflop` / `flop` / `turn` / `river` / `postflop` / `facing` / `lead`.
**Untagged means "applies everywhere"**, so an untouched rule behaves exactly
as before — that default is what made tagging incremental rather than a rewrite.

Three things to preserve:

- **Relevance boosts (+60), it does not filter.** A hard filter leaves the panel
  silent in spots no rule covers, and a general read beats no read. The −45
  penalty applies only to entries that *declared* a context and missed it.
- **The two numbers are pinned from both sides.** A matched rule must win a
  close call, or context is pointless; it must not bury a high-gain
  always-relevant state read like tilt (110), which applies on every street.
  `test/coach-relevance.test.js` asserts both directions — moving either number
  to satisfy one will fail the other.
- **A typo'd tag is invisible.** `entryRelevance` just returns −1 forever, so
  the rule is permanently demoted and never errors. The test scans the source
  for tokens `handContextTokens` cannot emit; that scan is the only thing that
  catches it, and it carries its own guard against matching nothing.

The context is deliberately coarse. SPR bands or heads-up-vs-multiway would
depend on reads already flagged as imperfect (position, and whether an all-in
was really a call), and a wrong token silently promotes wrong advice — worse
than advice that is merely general.

## The report has one source, two renderings (v1.3.0)

`buildReportSections(xid)` is the data; `buildReport` renders it to plain text
for the clipboard and `buildReportHtml` to markup for the screen. **Don't add a
third rendering that builds its own strings** — the copied report and the
displayed one describing the same player differently is exactly what this split
prevents, and it is the same rule `formatHand` follows for the History tab.

Each item carries `text` (the observation) and optional `act` (the action).
They used to be one sentence, and that is precisely what made the report an
unreadable wall on a phone: *"Folds to c-bets 68% (14 samples) — c-betting into
them prints; fire the flop with anything."* Split, the numbers skim and the
action stands out. Keep them separate when adding rules.

Every `tph-rep-*` class declares its own colour. `pinTextColor` skips `tph-`
elements, so an undeclared one renders dark-on-dark — the v0.18.2 bug, which
this tab would hit hardest because it is nearly all text.

## A thin sample is flagged, not withheld (v1.3.0)

`currentExploitTip()` used to skip any player under `minHands`, which left the
seat you know **least** about as the only one the coach said nothing about.
It now returns the read with `provisional: true` and a −200 score penalty.

Why this is safe rather than reckless: the frequency rules inside
`buildExploitPlan` carry their own sample gates (`n >= 20`, `foldToCbetOpp >= 8`,
`betSizeCount >= BET_SIZE_MIN`), so a new player surfaces only what is valid
early — tilt, a stuck stack, a limp-3bet, what they have shown down. **If you
add a rule that needs volume, gate it inside the rule**, not by reinstating the
outer gate.

−200 is chosen to sit below any solid read on another live opponent but above
the +1000 aggressor bonus: whoever is driving the action is still who you are
deciding against, however little you have seen of them. The coach marks it
`new · Nh` between name and read; the pill uses a trailing `?`, matching the
badge's existing convention for a provisional archetype.

## Review findings still open (v0.14.0)

Reviewed and deliberately left, in rough priority order. Also listed in the
script header, under the same numbers, so they're visible while editing —
change one and change the other.

Findings 1 (the pot had no cross-check) and 2 (`STORE.players` grew forever)
were closed in v0.18.0 and v0.40.0–v0.41.0, and 4 (calibration's refresh only
arming when the setting was already on at load) in v1.37.0; `CHANGELOG.md` has
the detail. The numbering below is kept as-is rather than renumbered, because
the script header and several code comments cite these by number. One residue
of #1 is still true and worth knowing: `hand.pot` (log-summed, not the DOM
figure) is what P/L falls back to when a winner line carries no amount.

3. **All-in is counted as a raise** (`preflopRaiseEvents`), so a short-stack
   all-in *call* can make the coach read the spot as facing a 3-bet. Needs the
   all-in amount compared against the current bet, which the log doesn't always
   print.
5. **`tableMax` (default 9) only drives the equity quote**, not the preflop
   charts, which read the per-hand seat count. At a 6-max table with the default
   left alone, equity reads pessimistically (quoted vs 8 opponents).

## Storage, and what it costs (v0.40.0)

Measured, not guessed:

| | Size |
|---|---|
| The script itself | 340 KB, fetched once — **not** a runtime concern |
| A fresh 1-hand player record | **562 bytes** |
| A long-tracked player record | **1,076 bytes** |
| Hand history at `historyLimit: 200` | ~266 KB, **capped** |

The number that matters: **a one-hand record costs half what a five-hundred-hand
record costs.** Any prune should therefore go after thin records before old
ones — age is the wrong primary axis, because a weekly regular is worth more
than yesterday's stranger.

`STORAGE_QUOTA_EST` (5 MB) is an **estimate**. The Storage Manager API is absent
in the PDA webview, so there is no way to ask. It renders a proportion and warns
at 75%; it must **never gate a write** — guessing low would refuse data that
would have fitted.

`saveFailure` is set when localStorage refuses a write and cleared when one
succeeds. The **first** failure's timestamp is kept, because it marks how far
back the memory-only data goes. The banner is `pointer-events: none`, same
absolute rule as the turn-cue overlay.

**The harness queues `setTimeout` now** (`sandbox.runTimers()` drains it). It
used to drop them, and `saveStore`'s write lives inside a 250ms debounce — so
any test of the save path passed vacuously.

### Pruning (v0.41.0)

`prunePlayers()` in three passes: under 10 hands *and* unseen 30 days → unseen
180 days at any sample → least-recently-seen down to `PRUNE_PLAYER_CAP` (2000).

**Rule 3 is the only invariant.** Rules 1 and 2 are heuristics that might free
nothing on the day it matters. "Delete old things and hope" bounds nothing;
the cap is what makes the ceiling unreachable. Don't drop it in favour of
"smarter" age rules.

**Thin before old, always.** The measurement above is the reason — a thin record
is half the cost and none of the read. Reversing this deletes 400-hand regulars
and keeps one-hand strangers.

Two things survive every rule, and both are load-bearing:

- **Hero's record.** The coach reads it, and it is exactly the record that looks
  most prunable after a long gap.
- **Any record with no `lastSeen`.** An unknown age is not an infinite one.
  Imports and pre-`lastSeen` records land here, and treating epoch-0 as "very
  old" would let a gist import delete a year of data on the first save after it.
  They are stamped and judged on a real timestamp next time.

Triggered from `saveStore` — writing is the only thing that makes the store
bigger — and gated on `STORAGE_WARN_PCT`, so nothing is deleted on a day it
wasn't needed. A *refused* save forces a pass and retries once; that terminates
only because the second pass finds nothing to drop and returns false.
`test/prune.test.js` asserts exactly two `setItem` attempts for that reason.

## Should this be refactored?

**Not into modules.** There is no build step and the install model is "fetch one
file whole" — splitting it would mean adding a bundler, which breaks the thing
that makes this deployable to Torn PDA at all. ~6,600 lines in one file is a
consequence of the constraint, not neglect.

**The changelog lives in `CHANGELOG.md` (v0.42.0).** It used to be 780 lines at
the top of the script — larger than this file, and ahead of the first line of
code, so anything reading the source from the top paid ~15k tokens of history
first. The script keeps the last three entries; the archive keeps everything,
and git keeps it a second time. When you bump `@version`, write the entry in
**both**: the full one in `CHANGELOG.md`, and the same text at the top of the
script, dropping the entry that falls off the end of three.

That is the only file in the repo that is prose-only. Don't start a second one:
the reason this one earns its keep is that it is never loaded unless someone
asks for it, and a doc that has to be read to be trusted belongs in CLAUDE.md
instead.

**The testability seam is built (v0.21.0).** It used to be the open item here:
every harness recovered functions by slicing the source with `indexOf`/`eval`
against literal markers, which broke on any rename and once reported false
passes because a regex matched the wrong chart. Now:

- `window.__TPH_TEST` is assigned at the end of the IIFE, gated on
  `window.__TPH_TEST_HOOKS` — a flag the harness sets **before** loading the
  file. Production cost is one falsy property read; there is no user-facing
  setting to toggle by accident.
- `test/harness.js` runs the real file in a `vm` context with a stubbed
  `window`/`document`/`localStorage` and returns that object. Nothing is sliced.
  `document.readyState = 'loading'` is what keeps `init()` from firing.
- `node test/run.js` syntax-checks the script and runs every `test/*.test.js`.

Two things to keep true. **The seam is a test surface, not an API** — add to it
freely, and update `test/` callers in the same commit when you rename something.
**`test/` never ships**: the userscript is still one file fetched whole, and the
no-build-step constraint is untouched.

`STORE` and `heroXid` are exposed as get/set accessors, not plain references,
because both are *rebound* rather than mutated — a plain reference would freeze
at whatever value existed at load and quietly test nothing.

The harness has two DOM modes. Default is inert (every selector returns empty),
which is right for pure logic. `load({ dom: 'class' })` swaps in a document that
matches single-class selectors only, enough for `renderPanel` mount/teardown.
It deliberately refuses anything more complex rather than guessing — a stub that
matches the wrong element is how the old harnesses produced false passes.

Two cheap things already done rather than deferred: the section map at the top
now lists sections **in file order** (they are not in numeric order, and there is
no section 10 — P/L lives inside section 4), and the known gaps above are in the
header where an editor will see them.

## Panels go through renderPanel (v0.21.0)

Nothing should create a `.tph-panel` element by hand. `renderPanel({ marker,
open, html, onClose, wire })` mounts and tears down all three, and exists to
enforce two invariants the hand-written copies had already drifted from:

1. **Teardown is scoped to the panel's own marker class, never `.tph-panel`.**
   `renderPlayerPanel` used to remove the shared base class, which also matched
   the players list and the settings panel. Opening a player panel over Settings
   deleted it from the DOM while `settingsOpen` stayed `true`, so the next gear
   tap flipped the flag to `false` and appeared to do nothing — one dead tap, no
   error, easy to write off as a mis-tap on a phone.
2. **`pinTextColor` runs after `wire()`, not before.** It has to walk content
   that `wire()` adds. Torn styles bare `td` and `pre`, so anything mounted after
   the colour walk renders dark-on-dark — the v0.18.2 bug. The player panel
   builds its tab bodies inside `wire()` for exactly this reason.

`test/panel.test.js` covers both, and the mini-DOM was checked against the *old*
behaviour first to confirm the test isn't vacuous: passing `marker: 'tph-panel'`
still wipes the other panels, which is what the assertions rule out.

The calibration panel is deliberately left outside this. It is not a
`.tph-panel`, and it preserves its textarea contents across re-renders, so it
has a genuinely different lifecycle.

Leave alone: the numbered section scheme itself (renumbering churns the whole
file for no behavioural gain), and the single-file structure.

## Screen real estate (v0.42.0)

Three things the phone forced, all reported from a live table.

**Hero's seat is not shaped like an opponent's.** Badges sit at `rect.bottom + 1`
— under the name, on empty felt. That space is *not* empty under your own seat:
it carries the name plate, the stack and whatever Torn draws around the acting
seat. Hero's badge alone is lifted `SELF_BADGE_LIFT_PX` (five badge-lines, after
four was reported as still landing on the chip figure) so it clears them. Don't
unify the two positions; the asymmetry is the point.

**The badge is width-constrained, not information-constrained.** It floats over
the table, and at full width — role chip, 🤮, 🔥, type, three numbers — it
reached the community cards. Everything shed to fix that was punctuation, not
content: no spaces inside `V35P23A67` (the letters already delimit), no `15h`
window marker on the face (it is in the tooltip), `badgePct` caps at two
characters, and the type/number gap is a margin rather than a space. **The
labelled numbers stay** — `74/12/16` is three unexplained figures on an element
with no room for a legend, which is why they were labelled in the first place.
`badgeStats: false` drops the numbers entirely and is the escape hatch if it
still doesn't fit; type, role and state emoji survive it because those are the
read, and the numbers are one tap away in Stats.

**The coach panel resizes, and stays mounted between hands.**

- The grip is a real element (`.tph-coach-size`) with pointer handlers, **not**
  CSS `resize`. The native handle is mouse-only in practice, and this only ever
  runs in a touch webview.
- Resizing **pins the panel to left/top first**. While it is still anchored by
  right/bottom (its default), growing from the bottom-right corner pushes the
  left edge across the screen — the corner under your finger stays put and the
  panel appears to slide rather than grow. `makeResizable` therefore persists
  `coachPos` as well as `coachSize`; saving only the size would leave the
  element somewhere the store has no record of.
- `applySize` clamps at **both** ends. The grip lives inside the panel, so a
  panel draggable to nothing takes its own grip with it.
- The panel used to be torn down whenever there was no advice — i.e. several
  times a minute. You cannot park something on screen that keeps leaving. It now
  shows an idle line instead. **The original reason for the teardown still
  stands**: what must never sit there is *stale* advice looking current. An idle
  line is not that; restoring last hand's advice would be.
- `.tph-coach` is a flex column with the body as the scrolling child, so the
  header — the only drag handle, and the Hide button — can't be sized away.

**The gear is 32px, down from 44.** The red fill and the "HUD" label are what
make it findable, not the size. It floats over the table permanently, so it is
also the one element that always costs screen.

## Exporting the history (v0.42.0)

`playerHistoryExport(xid)` writes **every** recorded hand against a player, not
the 40 the History tab renders. The tab's cap exists because scrolling hundreds
of hand cards on a phone is useless; a file has no such constraint, and an
export that quietly inherited the display cap is a loss you find months later
looking for a hand that was never in it. Both buttons state their count for the
same reason, and the header names the store-wide `historyLimit` so the file
can't read as complete when it isn't.

It reuses `formatHand`, deliberately — the tab, the clipboard and the file must
not drift into three descriptions of the same hand. Delivery is
`downloadTextFile` (PDA share sheet, falling back to `<a download>`, falling
back to the clipboard); a button that appears to work and produces no file is
worse than one that says it can't.

## P/L attribution, and why hero identity matters (v0.17.0)

Per-opponent P/L lives on the **opponent**, from hero's perspective:
`plChipsEst > 0` means you are up against that player. Your own record's field
is never written (it would mean your P/L against yourself); your real total is
`STORE.hero.netChips`, shown as the Lifetime line.

Attribution splits hero's net result for the hand by each opponent's **net
result**, not by what they contributed: money you win comes from the players who
lost, money you lose goes to the players who won. That is exact heads-up and
sums to `heroDelta` multiway.

The previous version divided each opponent's contribution by the total
contributed *including hero's own*, so the shares never summed to 1 — heads-up,
where both players put in half the pot, a villain was credited with exactly half
the money won from them. It also charged hero's losses to players who folded
early and lost nothing to hero. Verified with worked hands plus a 500-hand
random sweep asserting the attributed total equals `heroDelta`.

Still an estimate in one respect, and the UI should keep saying so: with three or
more players it knows only the net movement, not whose chips ended up where.

**`heroXid` being null is not cosmetic.** `applyHandResults` guards the whole
attribution block on it, so with hero unidentified *every* opponent's P/L stays
frozen at zero, and `renderBadges` can't tell which seat is hero's so it draws a
tendency badge on hero's own seat. Those present as two unrelated bugs and are
one unset or misspelled username. `heroProblem()` returns the reason, surfaced in
Settings (with a green confirmation when it resolves) and at the top of the
players list. Don't let this fail silently again.

### The pseudo-id is not a resolution (v0.20.0)

`findHeroXid` → `nameToXidGuess` returns **`'name:' + username`** when no seat
matches. That is a truthy string, and it froze P/L at zero for every session up
to v0.19.0 because the 3s retry read `if (!heroXid) heroXid = findHeroXid()`.
Bootstrap runs before the seats render, so it always took the pseudo path, and
the guard then latched that failure in permanently — defeating the exact
late-render case the retry was written for.

The failure was silent and total, and it presents as several unrelated bugs:

- Hero's *log lines* re-run `nameToXidGuess` unlatched, so they bind to the real
  seat XID as soon as seats render. `hand.contributions` and `wonByXid` are then
  keyed under the seat XID while `heroXid` still holds `name:...`, so `heroWon`
  and `heroContributed` both read 0 and **`heroDelta` is 0**.
- Every `plChipsEst += heroDelta * share` is therefore `0 * share`. Opponent P/L
  never moves — from *any* pot, not just the folded ones where it was noticed.
- `hand.dealtInXids` holds real XIDs, so `STORE.hero.hands` never increments and
  the Lifetime line reads `0 hands, $0` while History fills up. **That mismatch
  is the fastest way to spot this.**
- `xid === heroXid` stops skipping hero, so hero is tracked as their own opponent
  and badged on their own seat.

Use `heroUnresolved()` for every hero-identity check. `!heroXid` is wrong: null
and `name:...` are both "not bound to a seat", and only the helper says so.

The reason this survived so long is that the symptom (no P/L) points at the
attribution maths or the log parser, and both were fine — the deep scan showed
zero unmatched lines. `heroXid: name:Wonkawee` was printed at the top of that
same scan. **Read the scan header before theorising about the log patterns.**

## Stakes, and the BB-display hazard (v0.26.0)

`TORN_STAKES` maps blind level to table name, so the blind read off the log
identifies the table. Two entries are corroborated by scans from this device —
$1M River Wizard, $2.5M Cat's Chance — and **the user plays both**, so a table
switch is a real event: `noteBlindLevel` notices a change rather than letting
`lastSeenBB` carry a stale level onto a different table.

**The ladder assumes blind level identifies the table, and that assumption is
not solid (v1.0.0).** HopesG's HUD carries a second map keyed by a CSS
"table texture" class instead of blind level, and that map lists **multiple
distinct table names at the same blind** for three levels: $100k, $1M and
$5M — e.g. $1M alone covers "River Wizard", "Tripod" and "Comatose Cove".
Torn evidently runs more than one differently-named room at some stakes. We
have no scan confirming a texture selector on this layout, so `TORN_STAKES`
still shows one name per level (including the confirmed "River Wizard"), but
that name is a best guess at three specific levels, not a fact — worth
knowing before trusting "Usually plays" at exactly $100k, $1M or $5M. A scan
that lands at a $1M table that ISN'T River Wizard is this, not a bug.

**The hazard the ladder exists to catch:** Torn can render amounts as
`181.00 BB` instead of `$181,000,000`. In that mode every parsed figure is six
or more orders of magnitude too small and **nothing looks broken** — the numbers
are simply tiny. `plausibleBB` refuses a blind under $10, so P/L is withheld for
that session rather than written wrong, and `bbDisplayModeSuspected` surfaces it
in Settings and the deep scan. Withholding is the right trade: a gap in the data
is recoverable, a silently wrong win rate is not.

## Session reads and tilt (v0.26.0)

`player.recent` is a capped array of one digit per hand — `0` folded, `1`
played, `2` played and raised. Deliberately **not** hand records: this is stored
for every player forever and the store already grows unboundedly (open finding
#2). Three states is all `sessionRates` needs.

Badges default to `badgeMode: 'session'` over `sessionWindow: 15`. How someone
is playing *now* beats their long-run average — a nit who has just started
3-betting everything is the read that matters, and lifetime figures actively
hide it.

### The window is blended, not switched to (v0.39.0)

`blendedRates(p, n)` is a two-level hierarchy:

    window  ->  their history before the window  ->  POOL_AVG

The badge used to *pick* one of a lifetime figure and a **raw** window figure,
crossing over at `SESSION_BADGE_MIN = 6` hands. **Don't reintroduce a
threshold.** That crossover moved the badge toward the *noisier* of the two
estimates at exactly the moment it claimed to know more, and could shift it 40
points on one hand. The blend moves continuously and the badge has no modes.

Two invariants:

- **The prior excludes the window.** Those hands are inside `p.hands`, so using
  lifetime directly double-counts them and lets a long stretch of new behaviour
  quietly reinforce the baseline it is being measured against. Same reasoning as
  `tiltRead`'s baseline. With no history outside the window the prior collapses
  to `POOL_AVG` — right for a player you have only just met.
- **`RECENT_PRIOR_WEIGHT` (8) is lighter than `PRIOR_WEIGHT` (12)** on purpose.
  A player's own history predicts their next hand far better than a pool average
  does, but the whole point of a recent read is that it is allowed to move.

Only VPIP and PFR can be windowed at all, because `player.recent` stores three
bits per hand. AFq on the badge is therefore always lifetime, and the archetype
**type** stays lifetime too — 🤮 is what flags someone playing off-type right
now. Widening `recent` would buy windowed 3-bet/c-bet at the cost of feeding
open finding #2.

`test/blended-rates.test.js` states the properties, including a max-step-per-hand
assertion the old switching code fails.

**`tiltRead` is behavioural, not financial.** It compares a player's recent VPIP
against *their own* prior baseline, never against the pool and never against
money lost. A player stuck three buy-ins who keeps playing their game is not
tilting; a station who has always played 70% is not either. The baseline
**excludes the recent window**, so a long tilt stretch can't quietly raise the
number it is being measured against.

## This-hand roles on the badges (v0.39.0)

`handRoles(hand)` marks who holds the initiative in the hand *in front of you* —
gold `PFR`/`3B`/`4B` on the preflop raiser, blue `DONK`/`RR` on anyone taking the
betting lead postflop who wasn't that raiser.

**It is derived from `hand.actions` on every render, not tracked in parallel
state.** There is nothing to keep in sync, it is correct after a mid-hand
re-render (badges redraw every 4s), and it empties itself at settlement because
`freshHandState()` clears `actions`. Don't "optimise" it into counters updated
from the parse path — that is a second copy of state that can drift.

Three choices worth preserving:

- **The LAST preflop raiser, not the first.** In a 3-bet pot the 3-bettor is the
  seat everyone else is playing against. `aggressorByStreet.preflop` gives the
  same xid but not the raise *count*, which is what lets the chip say `3B`.
- **The preflop raiser never gets a postflop chip.** Their c-bet is expected; a
  marker on nearly every hand carries no information.
- Inherits open finding #3 — an all-in counts as a raise, so an all-in *call*
  can inflate the tag one level.

## Bluff tracking (v1.29.0)

**This one was a genuine gap, not a "check first" win.** `noteBetTexture`
already categorised a showdown bet as `made` (two pair+) or `draw` (a live
flush/straight draw, flop/turn only) — but a bet with `cat < 2` and no draw
either was silently dropped, counted nowhere. That gap is the exact definition
of a bluff, so the third bucket (`bluffBets`/`bluffSizes`) was new work, not
recovered data. `p.texture.checkMade` (the slowplay/trap signal) is unaffected.

**A lone pair with no draw (`cat === 1`) still lands in none of the three
buckets, on purpose.** It is not made by this file's own two-pair bar, and
holding a pair is not zero equity, so it is not a bluff either. Forcing it into
either would be a domain error a poker player would catch immediately (a
top-pair value bet is not a "bluff"). Left unscored — the same honest-gap
principle as the unshrunk WTSD anchor.

**Fixed the flagged v1.21.0 gap on the way in, rather than sitting beside it.**
`betDrawPct`/`betMadePct` were still a raw sum/count average — the v1.21.0
changelog names this outright as "out of scope for THAT pass." Adding a third
bucket in that same fragile shape while the fix for the other two sat right
there would have been actively inconsistent. All three (`drawSizes`,
`madeSizes`, `bluffSizes`) are now bounded windows read via `median()`, same
shape as `betSizes`, via a shared `pushTextureSize` helper.

**Migrated properly this time — v1.26.0's exact lesson, applied going in
rather than fixed after a live bug.** `betSizePctSum` → `betSizes` in v1.21.0
shipped with no migration, and the resulting count/sample mismatch was the
headline finding of the v1.26.0 review. `ensurePlayerShape` now has an explicit
nested backfill for `p.texture` (same pattern the `streetActions` backfill
already used): a record with the old `drawPctSum`/`drawPctN` shape gets the new
array fields added fresh (empty, not synthesised from the old average — a
median seeded from a potentially-skewed mean would carry that skew into the
very stat built to resist it), while the old fields are left alone, unused —
same harmless-dead-weight precedent as `betSizePctSum` itself.

**`bluffRate`'s caveat is stronger than the standard "floor on a range," and it
is asymmetric.** `noteBetTexture` only ever runs on `hand.shownCards[xid]` —
cards revealed at a REAL showdown. A bluff good enough to take the pot
uncontested never reaches that sample and is structurally invisible. This
makes a HIGH reading safe to act on (the true rate is at least this, likely
higher — "call down lighter" holds regardless). It makes a LOW reading
genuinely ambiguous: it could mean they rarely bluff, or it could mean they
bluff plenty and it usually works, and this stat cannot tell those apart. The
low-rate exploit-plan entry deliberately does NOT mirror the high-rate one —
no "bluff more" framing, because that claim needs the overall bluff frequency,
which is exactly what's unknowable here. `test/bluff-tracking.test.js` pins
this by checking the actual copy text, not just that an entry fires — and it
had to be extended to check `buildLeakPlan` as well as `buildExploitPlan`
after an overclaim was caught in review sitting in the LEAK (hero's own voice)
text specifically, with the villain-voice text already correct throughout. The
two are built from separate `exploitText`/`leakText` arguments to the same
`add()` call, so a fix landing in one and not the other is an easy, silent
mistake — checking only one voice would have shipped it.

## Board texture (v1.28.0) — and the name collision to avoid

**`texture` already meant something else.** `p.texture` is HAND strength (made
vs draw at showdown, v1.18.0). Board texture is `p.boardTex` / `boardFlags` /
`BOARD_*` throughout, and the two must not be conflated.

**The fourth time "check whether it's already collected" paid off.** Everything
needed already existed: `hand.board` is parsed from the log (with **no hero
gate**, so hands you folded preflop still contribute), every action carries its
street, `BOARD_COUNT_FOR` reconstructs the board as it stood on that street, and
`STORE.hands` held 200 past hands to backfill from. Only the classifier and the
per-flag counters were new. Check before adding collection.

### Flags, not one class per board

A board can be paired AND four-to-a-flush, and both facts matter. A
first-match-wins list (the `LOG_PATTERNS`/`ARCHETYPE_RULES` pattern) would make
`pair` silently mean "paired AND not flushy" — a conditional nobody reading the
stat would assume — and would make each flag's sample *smaller* by carving
boards away into whichever flag outranked them. As flags, every paired board
counts toward `pair`, full stop.

Consequence the UI must keep stating: **these rows do not sum** and are not a
breakdown of hands.

### Two rates, two denominators

`boardTexRates` returns `lead` (b/(b+k)) and `foldToBet` (f/(f+c+r)) and they
are deliberately not combined. Postflop, check and bet are only reachable when
nobody has bet yet; call/fold/raise only when facing one — the same insight
`streetRates.rr` already relies on. One blended "aggression on wet boards"
figure would average two unrelated situations. Both withhold (null) rather than
report 0% on an empty denominator.

### The sample is thin, and that is the whole design problem

A four-flush board is rare, so a per-villain read takes hundreds of shared
hands. Hence three layers: the live board read (works on hand one, no storage),
the **pool** baseline (`poolBoardTexture`, fills fast, shown beside the villain
figure), and the per-villain figure gated at `BOARD_TEX_MIN = 8` — checked
against the *same* cell the figure comes from, which is v1.26.0's lesson.
Under-sample rows render dimmed rather than hidden.

### Backfill runs at init(), NOT in migrateStore

`migrateStore` executes inside `loadStore()` near the top of the file, where
anything declared later with `const`/`let` is still in its temporal dead zone —
the documented way to break this script at load. `backfillBoardTexture` runs
from `init()` instead. It **adds** to counters, so it is made safe by the
`STORE.boardTexBackfilled` flag, not by being idempotent; re-running without
the flag would double-count every hand.

### Storage, measured (not guessed)

| | Size |
|---|---|
| `boardTex` on a fresh record | **2 bytes** (sparse — unseen flags are absent) |
| Worst case, all five flags seen | **198 bytes** |
| At `PRUNE_PLAYER_CAP` (2000) | ~387 KB, under 8% of `STORAGE_QUOTA_EST` |

One-letter keys (`b`/`r`/`c`/`k`/`f`) and sparse storage are why. This rides on
every player record forever, which is open finding #2's exact growth shape.

### Surfacing goes through the existing context tokens

`handContextTokens` emits `board:<flag>`, and entries tag `when: ['board:fl4']`,
so a texture read can only appear on the texture it describes. Tags are
**generated from `BOARD_FLAGS`**, so the typo'd-token failure mode CLAUDE.md
warns about (`entryRelevance` returns −1 forever, silently) is structurally
impossible here — but that also means `test/coach-relevance.test.js`'s literal
source scan does not cover them; `test/board-texture.test.js` does.

## Showdown ranges (v0.26.0)

`player.shownHands` maps hand class → `{seen, raised, won}`. It is the only
**direct** evidence of anyone's range in the file; every other stat infers one
from frequencies.

The raw material was already being captured and discarded — `hand.shown` held
the revealed cards and nothing ever read them. Before adding a data source,
check whether it is already in the store; that is now twice this has happened.

**The seats are the primary source, not the log (v0.35.0).** This layout carries
no reliable `reveals` line — revealed hands were visible on the table while both
the Range and History tabs stayed empty, after the log path had already been
fixed twice. `harvestShownCards()` polls the seats every second and records any
opponent showing two face-up cards.

It **has** to poll: the cards are cleared by the next deal, so reading at
settlement finds nothing. First sighting wins, so the log path still works where
it does and the two sources can't double-count — `hand.countedShowdown` guards
WTSD for the same reason.

Three things to preserve:

- **Bank at settlement, not at the reveal.** `hand.winners` is still empty when
  a showdown is first seen, so recording the result there scores every showdown
  as a loss. Capture early, score late.
- **Split by preflop action.** "What they raise with" and "what they call with"
  are different ranges; averaging them describes neither.
- **Exclude hero.** Your own cards are face up all hand, so harvesting them
  would record a showdown every single hand.

Card text arrives in two spellings and both must parse: `9♥` in the visual log,
`9 of clubs` in aria-labels. `parseCardsFromText` handles both and is bounded on
**both sides** — an earlier unbounded, case-insensitive version read letters
inside ordinary words, turning `"9 of hearts, 7 of spades"` into `ATo`. A
confidently wrong holding is worse than none, and Torn's own hand descriptions
("Two Pairs: Aces and Eights") are full of those traps.

The UI must keep saying showdowns are a **floor** on a range, never the whole of
it — a pot that ends in a fold reveals nothing.

### Split by raise TIER, not just raised/called (v1.1.0)

`hand.preflopTier[xid]` records 1 = opened, 2 = 3-bet, 3+ = 4-bet, read off
`preflopRaiseEvents` **at the moment the player raises**. That is the same
counter `maybeCountThreeBet` keys off, so a tier filed against a showdown can
never disagree with the 3-bet stat — don't give it independent detection.

`shownHands[cls]` gained `r3`/`r4`/`lr` alongside the existing `raised`. Two
properties depend on `open` being derived by subtraction rather than stored:
`open + 3bet + 4bet` reconstructs `raised` exactly, and a pre-v1.1.0 record has
no `r3`/`r4` so its raises read as opens — the honest reading of data with no
tier, and why no migration was needed. `test/preflop-tiers.test.js` asserts both.

**Limp-3bet overlaps 3-bet on purpose.** A limp-reraise *is* a 3-bet; carving it
out of `r3` would understate the 3-bet range. The UI labels it a subset instead.

**`limpRaised` cannot false-fire.** `maybeCountLimp` bails once
`preflopRaiseEvents > 0`, so `countedLimp` only ever holds players who acted
before any raise — an ordinary raiser is never in it.

### Postflop re-raise was already collected (v1.1.0)

`streetRates.rr` is `raise / (raise + call + fold)`, and needs no new storage:
postflop, facing a bet is the **only** state in which those three are possible,
because a check or a bet means nobody had bet yet. So that ratio is exactly "how
often do they raise when bet into". It withholds (null) rather than reporting 0%
when the denominator is empty — "never re-raises" is a claim, and never having
faced a bet is no evidence for it.

Not split into check-raise vs raise-of-c-bet: that needs to know whether they
checked first, which `streetActions` does not record.

**That is the third stat in this file found already-collected and merely
unreported** (after fold-to-c-bet and per-street aggression). Check before
adding collection — the rule keeps paying.

### Recent form sits in the lifetime cell, not a fourth column (v1.1.0)

The Stats tab prints recent form beside the lifetime figure **in the same cell**.
A fourth column would need width a phone panel doesn't have, and would mean
changing 12 `colspan="3"` sites — one of which is in the *players list* table,
where a bulk replace would have broken it silently.

Only VPIP and PFR get one, because `player.recent` stores three bits per hand.
Everything else shows lifetime alone rather than repeating it under a "recent"
heading, which would be a quiet lie. The value shown is the **blended** figure,
matching the badge in Recent-form mode — a table reading 60 next to a badge
reading 40 is a worse failure than a slightly less direct number. Raw
observation and sample size are in the tooltip.

`.tph-stat-rec` declares its own colour so it does **not** inherit the
`.tph-dev-*` shading on the parent cell: that shading is computed from the
lifetime figure, and letting it bleed onto the recent number would assert a
verdict about a number it wasn't calculated from.

## Money formatting (v0.17.0)

`fmtMoney` / `fmtSignedMoney` are the only places money is rendered. Torn poker
runs at millions per blind, so figures abbreviate at `$12.5M` / `$1.2B`, use
`$41k` from ten thousand, and comma-group below that. Rounding promotes between
tiers, so `$999,999` reads `$1M` rather than `$1000k`.

Several call sites previously printed a bare `Math.round()` with no grouping
whatsoever — the Stats tab's "Your P/L vs them" and the tendency report both did.
Route new money output through these rather than adding another ad-hoc format.

## Names must be bound explicitly (v0.16.0)

`emptyPlayer(xid, name)` falls back to `'#' + xid` when no name is given, and
that placeholder is stored in `.name` — where it is indistinguishable from a
real name. For a long time **nothing ever passed a name**: `getPlayer(xid, name)`
was never once called with the second argument, so every record was created
holding `#3722665` and the hand history rendered ids instead of usernames.

Two sources feed names now, and both must keep working:

1. `noteResolvedName(xid, name)` at the point `nameToXidGuess` matches a log name
   to a seat — the name was already in hand there and was being thrown away. It
   merges any `name:` pseudo-record *first* (that function bails when the real
   record already exists) and then writes the name.
2. `harvestSeatNames()` reads the seat's own name element on the 3s watcher tick.
   `SELECTORS.seatName` had been declared and read by nothing. This names players
   who are sitting there but haven't acted, and repairs records stored under the
   placeholder by earlier versions.

`seatDisplayName` validates against `USERNAME_RE` before believing scraped text,
because `[class*="name_"]` can just as easily land on a wrapper holding the chip
stack — "$41,200,000" must not become someone's name.

`playerDisplayName` treats `'#' + xid` as *absent*, not as a name, so a stored
placeholder can never shadow a real one. Hand records store XIDs rather than
names, so history renders correctly retroactively once a name is learned.

## Position comes from the seat ring (v0.15.0)

`heroPositionLabel` reads **where hero sits**, via `seatRotationFromDom`: collect
every resolvable seat's centre from `getBoundingClientRect`, sort by angle around
the centroid (Torn's table is an oval, so that recovers the seating ring
regardless of DOM order), rotate so `sbXid` is index 0, and use `bbXid` to fix
the direction — an angular sort could run either way, and mirroring the table
would mirror every position. If the BB is not adjacent to the SB in either
direction, `rotateToBlinds` returns null rather than guessing.

**Do not reintroduce the old inference.** It set hero's index to
`buildRotation(hand).length` — "hero must be the next seat to act". That holds
only at hero's own decision point, but the coach panel re-renders continuously
(`isHeroTurn()` can't work because `actionButtons` matches nothing, so it falls
back to "your hole cards are visible"). The index therefore grew with every
opponent who acted, and the reported position walked around the table following
the action instead of naming hero's seat. This was reported from a live table.

`heroIsInPositionVs` had the same bug in a quieter form — with hero not yet in
the rotation it concluded hero was in position vs the raiser, which is a claim
about preflop order, not postflop, and it silently selected the looser
in-position 3-bet chart. It now uses the seat ring, or returns null so the caller
takes the tighter chart and says so.

The log rotation survives only as a fallback, and only when hero's index in it is
real. Known remaining exposure: a seated player who is sitting out still occupies
a seat in the ring, which would shift labels by one.

## Adopted from HopesG's HUD (v0.22.0) — and what's unconfirmed

Findings read out of HopesG's *Torn Poker HUD - Player Profiler & Coach* (MIT,
GreasyFork 569933, ~20k lines). Attribution matters here: several of these
resolve unknowns this repo had carried for many versions.

| Finding | Was | Now |
|---|---|---|
| Hero's seat | `hero_` / `you_`, matched nothing | `[id^="player-"][class*="self_"]` |
| Action buttons | hashed container class, never matched | matched by button **label** |
| Dealer button | `dealerButton_`, called a red herring | `dealer_` + `position-<N>___` |
| Sitting out | undetectable, shifted every label | `state___` text "Sitting out" |
| Stacks | unread, "~100bb assumed" | read per seat, real SPR |
| PDA detection | none | `window.flutter_inappwebview` |

**None of the selectors are confirmed on Torn PDA's layout.** They were read out
of someone else's source, not from a scan of this device, and that script has
explicit mobile/desktop branches — so the two layouts demonstrably differ. Every
addition is written to degrade to the previous path rather than replace it, and
the deep scan has an `IDENTITY / RING MARKERS (unconfirmed on this layout)`
block that reports on each. **Run one scan and read that block before trusting
any of it.**

One concrete disagreement already: HopesG reads `playerPositioner-<N>___` and
notes the index makes direction detection unnecessary. The live PDA scan shows
`playerPositioner___` with **no index**. The geometric ring in
`seatRotationFromDom` therefore stays as the primary, and `getDealerXid` returns
null on that layout rather than guessing.

`classVocabMatching()` exists because of how these were missed: `classVocab`
sorts by frequency and truncates at 45, and `self___` appears exactly once (your
seat), `dealer___` once. Both sat below the cutoff for the entire life of the
project while `opponent___(5)` was visible the whole time. The new probe lists
rare markers in full.

### The pool average is measured, not borrowed (corrected v1.11.0)

`POOL_AVG` used to be VPIP 50.9, PFR 13.4, 3-bet 3.7, fold-to-3-bet 14.9,
C-bet 40.3, fold-to-C-bet 56.1, limp-share 44.8 — lifted from HopesG's script
and never independently verified. This is the correction that section always
said was coming: 173 tracked opponents, 25+ hands each, pulled via "Download
pool tendencies" in the players list and fed back in. Current figures: **VPIP
42.5, PFR 9.4, 3-bet 1.5, fold-to-3-bet 48.1, C-bet 38.7, fold-to-C-bet 44.9,
limp-share 42.4.**

The divergence went a direction worth knowing about: this pool is **tighter**
than HopesG's figures assumed (42.5/9.4 vs the old 50.9/13.4), not looser —
and folds to a 3-bet more than three times as often (48.1% vs 14.9%). Whether
that's a genuine difference between player pools, a difference in which
stakes got tracked, or something else isn't known; it's just what got
measured.

Two rules for anything downstream of this, both already proven out by this
correction actually landing cleanly:

- **Thresholds are written as multiples of `POOL_AVG`** (`A.tight`, `A.loose`),
  never as bare numbers. Correcting the anchor moved every label with it
  automatically — no separate archetype-boundary edit was needed. `A.aggRatio`
  and `A.passiveRatio` are the exception: they're independent judgement calls,
  not algebraic functions of `POOL_AVG`, so correcting VPIP/PFR here did NOT
  re-examine whether they still sit at the right distance from the pool's new
  PFR/VPIP ratio (was 0.264, now 0.221) — left alone rather than guessed at.
  `POOL_SPREAD` is the same story: still the original judgement-call spreads,
  not re-derived from this measurement.
- **`observedPoolAverages()` reports what this HUD has actually seen**, and the
  players list footer shows it beside the assumed figure — this is what made
  the correction possible, and is exactly how the NEXT one should happen too,
  once new hands accrue that meaningfully diverge from these.

One migration cost worth knowing: a handful of tests hardcoded expected values
computed from the OLD anchor (an exact classification boundary, a rendered
delta string, a shrinkage arithmetic result) instead of computing them from
the live `POOL_AVG`/`A` — see `test/archetype.test.js`, `test/deviation.test.js`,
`test/exploit-plan.test.js`, `test/blended-rates.test.js`, `test/stats.test.js`
for the fixes. All now compute their expectations from `POOL_AVG`/`A` directly
(the test seam exports `A` for exactly this), so the NEXT correction shouldn't
need to touch test code at all.

### The WTSD anchor was wrong (corrected in v0.23.0)

v0.22.0 set `POOL_AVG.wtsd = 20.9`, lifted from the source's `wwsf` — **won when
saw flop**, which is not went-to-showdown (typically ~25–30% vs ~45%). No pool
figure for WTSD exists, so WTSD is now left **unshrunk**, same as AFq. Don't
reinstate it without a source. The correctly-mapped `foldToCbet` (56.1) and
`limpShareOfVpip` (44.8) took its place.

The general rule this produced: **only shrink toward a figure that measures the
same thing the stat measures.** An anchor that is merely plausible is worse than
no anchor, because shrinkage makes it invisible.

### AFq excludes folds, on purpose (settled v1.1.0)

`afq` is `(bet + raise) / (bet + raise + call)`. The commoner published
definition puts folds in the denominator. **This was raised, reviewed and kept
— don't "fix" it.**

Excluding folds asks the narrower question "when they keep playing, do they lead
or follow", which is the useful one here: folding is already separately visible
in fold-to-c-bet and the per-street fold percentages, so putting it in AFq too
would double-count it into a single blended number.

The stronger argument is the cost of changing it. Every AFq already stored was
computed this way, so moving the denominator would silently reprice thousands of
banked hands and leave old and new figures incomparable with nothing on screen
saying so. Consequence worth knowing: **this AFq reads higher than other HUDs'**
for players who fold a lot, so don't compare it against a figure quoted
elsewhere.

## Big blinds are the unit (v0.23.0)

`hand.bbAmount` is read off the `postBB` line, seeded from a session-level
`lastSeenBB` so a hand joined mid-way still has a unit. `hero.netBB`,
`hero.bbHands` and each opponent's `plBBEst` accrue **at settlement**, in
`applyHandResults`, because that is the only point the blind level is known —
a chip figure cannot be converted afterwards.

- `plBBEst` starts at 0 for players tracked before this, so it lags `plChipsEst`
  until they're seen again. That is deliberate: wiping the chip figures to make
  them agree would destroy good data to fix a cosmetic mismatch.
- Hands with no readable blind still record chips, and are excluded from
  `bbHands` so they can't distort the win rate. Guard the division — an
  unguarded `heroDelta / 0` poisons `netBB` with Infinity permanently.
- `fmtBB100` withholds a win rate under 50 hands. Below that it changes sign
  repeatedly and quoting it invites reading noise as a result.

**Effective stack in bb is a correctness matter, not decoration.** The preflop
charts are 100bb charts. While depth was unreadable, saying so in a footnote was
honest; now that `effectiveStack()` works, the coach warns under 40bb and says
outright under 20bb that the real decision is push-or-fold.

## Stats that were collected but never shown (v0.23.0)

Two were pure display gaps — no new collection, the data was already there:

- **Fold-to-c-bet.** `foldToCbetMade`/`foldToCbetOpp` were written from the day
  C-bets were added and appeared in neither `computeRates` nor the Stats tab.
- **Per-street aggression and fold frequency.** `streetActions` has always held
  per-street counts; `computeRates` collapsed all three into one AFq, hiding the
  most exploitable postflop pattern there is — firing flops, giving up on turns.

**Before adding a stat, check whether it is already being collected.** Two of
the four items in this batch were.

One was genuinely new: **limp frequency** (`limpMade`), counted as a preflop
call with `preflopRaiseEvents === 0`. The big blind is excluded — with no raise
to face they have nothing to call, and counting it would make every BB look like
a habitual limper. It inherits the known imprecision that an all-in is counted
as a raise.

### Deviation indicators (v0.25.0)

`POOL_SPREAD` says how far a stat must move from `POOL_AVG` before it means
anything. Each stat gets its own scale, and that is the entire point: 5pp on
VPIP (norm ~42) is noise, 5pp on 3-bet (norm ~1.5) more than triples it. A
single shared threshold calls the first notable and the second typical — exactly
backwards. One spread = notable, two = extreme.

Like `POOL_AVG`, the spreads are a **judgement call, not a measurement**. The
honest version would be the population standard deviation of each stat, which
nothing here has measured.

Three rules the rendering follows, all of which exist for a reason:

- **Print raw, colour shrunk.** `statRow(label, raw, shrunk, key)` prints the
  observed figure and colours by the sample-adjusted one. A two-hand player
  really did VPIP 100% and the Stats tab should say so — but lighting the row up
  as "extreme" off two hands is reading noise as a read.
- **Never red/green.** Grey → amber → orange-red by *magnitude*; direction comes
  from the ▲▼ arrow. High VPIP is not "bad", it is loose. A good/bad palette
  asserts a judgement the HUD is in no position to make, and it breaks outright
  on fold-type stats where "more" is passive rather than worse.
- **No pool figure, no verdict.** AFq and WTSD render plain, with a bar and no
  tick. Inventing an anchor to have something to compare against is how the WTSD
  mis-anchor happened.

### Adding UI? `pinTextColor` skips your element

`pinTextColor` walks a panel and forces `color: inherit !important` on
everything that does **not** carry a `tph-` class. So a new `tph-` element that
holds text and declares no colour of its own is left for Torn's bare `td`/`pre`
rules to darken — the v0.18.2 bug, and these stat rows hit it during
development.

**Every `tph-` element that holds text must declare its own colour**, and
declare it *before* any modifier class that overrides it, since both are single
class selectors with `!important` and the later rule wins.

The stylesheet is a template literal. **No backticks in CSS comments** — one in
the word `td` terminated the string and broke the parse.

### Shrinkage replaced the hard sample gate

`computeShrunkRates` pulls every rate toward `POOL_AVG` with a
`PRIOR_WEIGHT = 12` pseudo-observation prior; `classifyProvisional` uses it.
A player seen for two hands who played both used to read as a 100%-VPIP maniac
on the badge. `computeRates` stays **raw** — the Stats tab must show what was
observed, and shrinkage is for classification only. AFq is deliberately left
unshrunk because no published pool figure exists for it.

## Shared-affiliation badges, not a behavioural collusion detector (v1.8.0)

HopesG's HUD (see below) does real behavioural collusion detection — raise
"whipsaw" squeezes between a pair, soft-play read against a pair's *own*
baseline. Both need **pairwise** stats maintained for every pair of players
that's ever shared a table. That is the exact O(n²) growth shape open finding
#2 already burned this file on once, in a worse form than the original: this
one grows with the number of distinct *pairs* seen, not the number of players.

What shipped instead: 🔗 (same faction) and 💍 (married) on seats, from
Torn's own API rather than an inferred pattern. The load-bearing design
choice is **where the state lives**. Faction ID and spouse XID are cached
**per player** — `factionId`, `factionName`, `spouseXid`, `affilFetchedAt`,
the same handful-of-scalars shape every other player field already has.
Whether two players *match* is computed fresh at render time from whoever is
**currently seated**, via `affiliationFlags(xid, seatedList)`, and is never
itself stored. There is no relationship state to grow, prune, or migrate —
if a behavioural detector is ever built on top of this, it should keep that
same discipline: cache facts per player, compute relationships live.

**Needs an optional Torn API key** (Settings → "Shared-affiliation badges") —
public access is enough, same tier HopesG's script asks for. This is the
script's first credential besides the GitHub token and follows the identical
rule: added to `LOCAL_ONLY_SETTINGS`, stripped from Backup/Gist exports,
empty key = the feature is a silent no-op. `refreshSeatedAffiliations()` piggybacks
on the existing 3s watcher tick (same one as `harvestSeatNames`), gated by a
24-hour per-player staleness check so it costs a handful of API calls per
session rather than one per seat per tick.

**Unconfirmed, same as any DOM selector in this file.** The parsed field
names (`faction.faction_id`/`faction_name`, `married.spouse_id`) are written
from Torn's documented API v1 profile shape, not a response anyone working on
this has actually seen — nobody holds a key to check one live yet.
`parseAffiliationProfile` fails to `null` on anything it doesn't recognise
rather than throwing, including Torn's `{"error": {...}}` shape for a bad or
rate-limited key — reading that as "no faction, no marriage" would cache a
false negative that then sits for a full `AFFIL_REFRESH_MS` window. **Needs a
report from someone who has actually set a key and sat at a table with a
known faction-mate or spouse**, the same way every selector here got
confirmed: try it, paste back what the badge (or its absence) actually showed.

## Next task

**A live deep scan (v1.5.1, from the actual table) closed all three of the
open live-verification items.** Keep the scan itself as the record:

1. **The v1.4.0 P/L fix is confirmed.** The scan's "reveal rows in log"
   section shows both no-showdown win lines ("X won $Y Did not show hand")
   parsed as `-> wins`, not `-> shows`. That is the fix working: before it,
   these lines were consumed by `shows` and `hand.winners` stayed empty, so
   P/L was skipped on every pot won without a showdown.
2. **`SELECTORS.seatState` is confirmed.** The scan was taken with a real
   player sitting out (`sittingOut: player-2587965`), and the `"Sitting out"`
   text probe matched nested under `DIV.state___K_BXh` inside that exact
   seat. `[class*="state_"]` is the right selector on this layout; sitting-out
   players are correctly excluded from the "hands observed" denominator.
3. **Hero's own VPIP WAS split across two records — root cause found and
   fixed in v1.6.0.** The scan printed `heroGhost(name:Wonkawee): EXISTS`
   with 2174 hands against `heroRecord`'s 2571 — tracking almost 1-for-1 with
   hero's real hand count, so this was an ACTIVE ongoing split, not stale
   history. `heroRecord.vpip`/`.pfr` (166/89) read far lower than the
   ghost's (1198/662): nearly every one of hero's own voluntary preflop
   actions was landing on the ghost.
   - **Root cause:** `nameToXidGuess` resolves a log line's actor name to a
     seat by matching seat TEXT — a profile link, the seat's own name
     element, or (last resort) the whole seat blob. `heroXid` itself resolves
     correctly, but by a completely different path: the seat's `self___`
     marker (v0.22.0), which never looks at the username at all. Nothing
     guarantees Torn's own seat prints the sitting player's OWN username
     where these text-matching passes look for it — an opponent's seat
     reliably does, hero's evidently does not on this layout. So every one of
     hero's own log lines ("Wonkawee called $X") failed all three passes and
     fell through to the `name:Wonkawee` pseudo-id, forever, while
     `dealtInXids`/`STORE.hero.hands` (both seat-xid-based, not name-based)
     kept accruing correctly on the real record — hence the split being
     visible only in the log-driven stats (VPIP/PFR/etc.), never in hand
     counts.
   - **Fix:** `nameToXidGuess` now checks, before touching any seat, whether
     `heroXid` is already resolved (`!heroUnresolved()`) and the name matches
     the configured username (case-insensitively) — if so it returns
     `heroXid` directly, no seat text involved. `test/name-boundary.test.js`
     pins this: the harness can't drive the seat-matching passes at all (see
     that file's header), which makes it the right tool to prove this exact
     path is what resolves hero's name now.
   - **The historical ghost data is not merged.** `mergePseudoPlayer` bails
     when the real record already exists (by design — see "Names must be
     bound explicitly"), so the 2174 already-corrupted hands sit in
     `name:Wonkawee` untouched. Reconciling them into the real record risks
     double-counting (the real record's `hands` is already complete via the
     seat-xid path). **Recommend "Reset my stats"** (v1.5.0) to the user to
     clear both once this fix is live — going forward hero's own log lines
     resolve correctly, so the numbers won't re-split.
   - **Confirmed holding, from a scan taken after the user did exactly that.**
     `heroGhost(name:Wonkawee): none` — no ghost record at all — and
     `heroRecord`'s 275 hands match `STORE.hero`'s 275 exactly, a clean 1-for-1
     with no drift. The fix is not just theoretically correct; it has now been
     observed working across a real session.

**Screen real estate got three more fixes in v1.7.0**, all reported from a live
table rather than reasoned about: hero's badge was nudged down and right to
clear the action timer (`SELF_BADGE_DOWN_NUDGE_PX` / `SELF_BADGE_RIGHT_NUDGE_PX`),
every panel now closes on an outside tap and got a wider margin to tap in, and
the Stats tab's "By street" section moved above "Stack this sitting". The
badge floats over the felt at a fixed size and the table does not — a badge
that fits at six-handed reaches the community cards at nine — so this is still
not "done", just the latest report acted on. `badgeStats: false` remains the
escape hatch, and nobody working on this can see the layout, so **each
adjustment still needs one report back before the next one.**

**`SELF_BADGE_DOWN_NUDGE_PX` moved again in v1.14.0**, still unconfirmed. The
v1.7.0 half-line nudge solved the timer collision but, per the next report,
left the badge floating over empty felt above the name rather than sitting on
it — now 1.5 badge-lines down (was 0.5), aiming to cover the name and nothing
else. Same rule: this is a guess informed by the last report, not a fact
until the next one confirms it landed right.

**New in v1.8.0, and needs a live check the same way a selector does:**
shared-affiliation badges (🔗/💍, see the section above) need a Torn API key
set in Settings and a real fetch to confirm `parseAffiliationProfile`'s field
names actually match what `api.torn.com/user/{id}?selections=profile`
returns. Nobody working on this holds a key. If you set one, the fastest
check is sitting at a table with someone in your own faction (or your spouse,
if they play) and confirming the badge lights up — or, failing that, pasting
back one raw API response so the field names can be checked directly.

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
- **Target an old JS engine, not Node's.** Torn PDA is a Flutter
  `inappwebview`: a Chrome-based WebView on Android, but WKWebView →
  **JavaScriptCore** on iOS, capped at whatever Safari the phone is running.
  Regex **lookbehind** is the one that has already bitten (v1.0.0 → v1.0.1):
  JSC gained it only in Safari 16.4, and an unsupported lookbehind is a
  `SyntaxError` at **construction** time — so it throws from wherever the
  pattern is built rather than quietly failing to match. In a hot path with no
  `try/catch` above it, that takes the whole tick down.
  `test/name-boundary.test.js` scans the entire script for lookarounds and
  fails if one comes back. **A feature test passing locally proves nothing**:
  Node runs everything, Android runs everything, and the device that broke is
  the one nobody here can run.
- **Commit and push immediately, every time.** Don't leave finished work sitting
  in the working tree waiting to be asked about. The install model is "Torn PDA
  re-fetches the raw file from GitHub `main`", so an uncommitted change is a
  change that does not exist as far as the phone is concerned — there is no
  local build to test against. Sequence: `node test/run.js`, bump `@version` and
  `HUD_VERSION` together, commit, push. One commit per change, message naming
  what changed for the user, not the diff.
- **Verify before pushing.** `node` IS available (this claim used to say
  otherwise). Run **`node test/run.js`** on every edit — it syntax-checks the
  script and runs the suite. Add a `test/*.test.js` for anything with an
  invariant worth stating; prototype the rest as a throwaway script, then port
  it onto `test/harness.js` rather than leaving it in /tmp. Log patterns and the
  position mapping were both validated that way against real scan lines before
  pushing, and the equity evaluator was validated in Python against published
  preflop equities before porting.
- **Secrets never leave the device.** `exportJson()` feeds both the Copy button
  and the Gist upload; anything added to settings that is a credential must go
  in `LOCAL_ONLY_SETTINGS`.
- **The coach is advisory only.** It must never click, auto-act, or play. Keep
  it text-only.
- **Never come between the user and the table.** The turn-cue overlay covers the
  whole viewport and is `pointer-events: none` — one tap swallowed on a fold or
  call button is worse than any cue is good. The fold guard is the single
  exception that touches game controls, and it earns it by never acting for the
  user (no synthetic clicks — the confirming tap is theirs), failing open on any
  error, and intercepting nothing but Fold. Any future feature near the game's
  controls has to meet the same three rules, and `test/fold-guard.test.js` is
  the shape of the evidence required.
- **Say when a number is an estimate.** Multiway P/L is modelled, not exact,
  and equity is vs a range PROXY once the pot is raised, still vs random
  hands otherwise — see "Equity" below. The UI says which one it is; keep it
  that way.

## Data

`localStorage["tornPokerHUD_v1"]` inside the Torn PDA webview — device-local,
no server. Optional secret-Gist mirror. Clearing the app's browser data wipes it.

`store.version` (currently `STORE_VERSION = 2`) drives one-time repairs in
`migrateStore`, run from both `loadStore` and `importJson`. Two rules:

- **Every migration must be idempotent.** It deliberately does not call
  `saveStore()` — at load it runs inside `loadStore()`, before the `saveScheduled`
  binding exists, so touching it throws on the temporal dead zone. Persistence
  therefore waits for the next natural save, and a page closed before then just
  replays the migration.
- **Wipe only what the bug corrupted.** Schema 2 zeroes `plChipsEst`,
  `hero.netChips` and `session.net` and nothing else, because the pseudo-id bug
  never touched hand counts or rate stats. Wiping those too would have destroyed
  200 hands of good data for no reason.
