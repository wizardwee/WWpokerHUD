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

## Current status (v0.20.0)

Selectors and log wording are **calibrated against real scans**. A live deep scan
at v0.18.2 confirmed the log parser is working: 40 rows read, zero unmatched
lines, action/blind/raise wording all landing. Positions and stat *values* have
still not been confirmed correct at a live table.

**P/L produced nothing at all up to v0.19.0**, and the same scan proved it. See
the hero-identity section below — the cause was a truthy pseudo-id defeating a
retry guard, not the log parsing. v0.20.0 wipes P/L once (store schema 2) and
lets it reaccumulate.

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

## Review findings still open (v0.14.0)

Reviewed and deliberately left, in rough priority order. Also listed in the
script header so they're visible while editing.

1. ~~**The pot has no cross-check.**~~ **CLOSED in v0.18.0.** The live scan
   showed `DIV.potsWrapper_ > DIV.totalPotWrap_` rendering `POT:$7,000,000`, so
   `readDomPot()` parses it and `effectivePot()` prefers it over the running log
   sum. The deep scan prints both and flags a mismatch over 2%. Remaining
   exposure: `hand.pot` (log-summed) is still what P/L falls back to when a
   winner line carries no amount.
2. ~~**`STORE.players` grows forever.**~~ **CLOSED across v0.40.0–v0.41.0.**
   The silent half went first (a refused save raises a banner and fills a
   Storage section in Settings), then the growth itself — `prunePlayers` bounds
   the map at `PRUNE_PLAYER_CAP`. See "Storage, and what it costs" below.
3. **All-in is counted as a raise** (`preflopRaiseEvents`), so a short-stack
   all-in *call* can make the coach read the spot as facing a 3-bet. Needs the
   all-in amount compared against the current bet, which the log doesn't always
   print.
4. **Calibration's 3s refresh only starts if the setting was on at load.**
   Enabling it mid-session gives a panel that updates on log lines only.
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
that makes this deployable to Torn PDA at all. 3000 lines in one file is a
consequence of the constraint, not neglect.

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

### The pool average is borrowed, not measured

`POOL_AVG` (VPIP 50.9, PFR 13.4, 3-bet 3.7, fold-to-3-bet 14.9, C-bet 40.3, WTSD
20.9) comes from that same script. Nothing here has verified it.

It matters because the correction is enormous: Torn's pool plays roughly twice
the hands of a live low-stakes game and raises less. The old thresholds (nit
under 15 VPIP, fish over 35) put essentially the whole population in one bucket
— technically correct, and useless, since a label every seat shares carries no
information.

Two rules for anything downstream of this:

- **Thresholds are written as multiples of `POOL_AVG`** (`A.tight`, `A.loose`,
  `A.aggRatio`), never as bare numbers. Correcting the anchor then moves every
  label with it instead of silently invalidating them.
- **`observedPoolAverages()` reports what this HUD has actually seen**, and the
  players list footer shows it beside the assumed figure. If they diverge over a
  few hundred hands, `POOL_AVG` is what to fix.

### The WTSD anchor was wrong (corrected in v0.23.0)

v0.22.0 set `POOL_AVG.wtsd = 20.9`, lifted from the source's `wwsf` — **won when
saw flop**, which is not went-to-showdown (typically ~25–30% vs ~45%). No pool
figure for WTSD exists, so WTSD is now left **unshrunk**, same as AFq. Don't
reinstate it without a source. The correctly-mapped `foldToCbet` (56.1) and
`limpShareOfVpip` (44.8) took its place.

The general rule this produced: **only shrink toward a figure that measures the
same thing the stat measures.** An anchor that is merely plausible is worse than
no anchor, because shrinkage makes it invisible.

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
VPIP (norm 50.9) is noise, 5pp on 3-bet (norm 3.7) more than doubles it. A
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

## Next task

**One deep scan settles most of the open questions.** Run it at a live table,
**on your turn** so the action buttons are on screen, and read the new
`IDENTITY / RING MARKERS` block. It reports, in order: whether `self___` found
your seat and which XID it resolved to, whether `dealer___` resolved, who is
sitting out, how many action buttons matched by text and what they say, whether
stacks were read, and whether the PDA bridge is present. Every v0.22.0 claim
above is confirmed or refuted by that one block.

Then confirm at a live table that **P/L moves at all** (v0.20.0). The check is in
the players list footer: `Lifetime: N hands, $X` with N tracking History rather
than sitting at `0 hands, $0`. If it still reads zero, read the `heroXid:` line
in the scan first — it should show a bare numeric XID, not `name:...`.

Then confirm that stats populate and that positions are right now that they come
from the seat ring rather than the action.

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
- **Say when a number is an estimate.** Multiway P/L is modelled, not exact, and
  equity is vs random hands rather than real ranges. The UI says so; keep it
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
