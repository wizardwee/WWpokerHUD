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
2. **`STORE.players` grows forever.** `lastSeen` is written on every access and
   never read; nothing prunes. `saveStore` catches quota errors and logs, so
   hitting the localStorage ceiling stops persistence *silently*. Surface a save
   failure in the UI before adding pruning — silent data loss is the worse half.
3. **All-in is counted as a raise** (`preflopRaiseEvents`), so a short-stack
   all-in *call* can make the coach read the spot as facing a 3-bet. Needs the
   all-in amount compared against the current bet, which the log doesn't always
   print.
4. **Calibration's 3s refresh only starts if the setting was on at load.**
   Enabling it mid-session gives a panel that updates on log lines only.
5. **`tableMax` (default 9) only drives the equity quote**, not the preflop
   charts, which read the per-hand seat count. At a 6-max table with the default
   left alone, equity reads pessimistically (quoted vs 8 opponents).

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
