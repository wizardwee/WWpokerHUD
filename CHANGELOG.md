# Changelog

Full history for the Torn Poker HUD. The script carries only the most recent few
entries; the rest lives here, so that reading the source no longer costs sixty
kilobytes of narrative before the first line of code.

Newest first. Bump `@version` **and** `HUD_VERSION` in the same commit as any
behaviour change: nothing automates it, and userscript managers compare
`@version` to decide whether an update exists, so a stale value means a
reinstall won't see new code as newer.

## 1.5.0

Narrow resets, and a diagnostic for a split hero identity.

**Two narrower reset buttons.** "Reset all data" was the only one, so
correcting a wrong money figure meant discarding every stat, showdown
range and hand in the store — throwing away the expensive data to repair
the cheap one.

`resetProfitLoss()` zeroes every money figure and nothing else:
`plChipsEst` and `plBBEst` on every player, `hero.netChips`,
`hero.netBB`, `hero.bbHands`, `session.net`. Exactly the fields schema
2's migration wiped, for exactly the same reason — P/L is the one number
that can be wrong on its own, because an unsettled hand or a parse gap
corrupts the money while hand counts, rates, showdown ranges and history
stay good. Chips and BB are always cleared together; leaving one would
have the Stats tab quoting two disagreeing results for the same player.

`resetHeroStats()` zeroes hero's own counters and keeps every opponent
and all hand history — those hands still describe everybody else in
them. It clears **two** records: the real seat record, and any
`name:<username>` pseudo-record, which is deleted rather than emptied
since it should not exist at all and an empty one would just be pruned
later as a mystery. If name resolution ever failed for hero, actions
accrued to the pseudo record while `hands` accrued to the real one, so
clearing only one half would leave the symptom exactly where it was.

**A diagnostic for that split.** The deep scan now prints `heroRecord`,
`heroGhost` and `STORE.hero` together, and flags a disagreement between
the first and third.

This is worth having because `heroXid: ok` does **not** rule the split
out, which makes it genuinely hard to see: hero identity resolves off the
`self___` seat marker and never touches the configured username, while
hero's *log lines* still go through `nameToXidGuess`. If those resolve by
name rather than by seat id, `hands` lands on the real record and
`vpip`/`pfr` land on the pseudo one. The only symptom is "my own VPIP
looks too low" while every opponent reads correctly — so nothing points
at identity, which is where the cause actually is.

Verified without Node (still not installed here): parses clean in
JavaScriptCore via JXA; every new button confirmed to have both markup
and a bound handler, and both reset functions confirmed defined and
called. The full suite has NOT been run.

## 1.4.0

**P/L was silently lost on every pot won without a showdown.** This is the
answer to the long-standing "why does P/L sometimes not get captured"
question, and it was not any of the theories — it was found by a live
deep scan, which listed the winner lines under "reveal rows".

Torn writes `Bauderix won $28,500,000 Did not show hand` when a pot is
taken with no reveal. The `shows` pattern is deliberately wide — it
accepts show/showed/shown/reveals/revealed/turns over, because a missed
reveal costs a showdown from the Range tab silently — and that width
made it match the bare word **"show" inside "Did not show hand"**.

`shows` sat *before* `wins` in `LOG_PATTERNS`, so the line was consumed
as a showdown. The `wins` handler never ran, `hand.winners` stayed empty,
and `applyHandResults` gates the entire P/L block on
`hand.winners.length > 0`. No winner line, no P/L — not wrong figures,
none at all.

**Why it hid for so long.** It was intermittent in precisely the way that
defeats debugging: a winner who *does* show produces
`won $65,000,000 with [J J]`, which contains no "show", parsed correctly,
and recorded P/L normally. So P/L worked on some hands and vanished on
others, with nothing in the unmatched-lines list because the line *did*
match — just as the wrong thing.

**Second casualty.** `nameToXidGuess` was handed
`"Bauderix won $28,500,000 Did not"` as a username. It came back as a
`name:` pseudo-id, and `logAction` then added it to `dealtInXids` — so
every such pot minted a junk player record that counted as a player dealt
into the hand.

Fixed twice over, because the ordering alone is easy to undo by accident:
`wins` is now tested before `shows`, **and** the shows pattern carries a
negative lookahead for "did not show" so it cannot match whichever order
they end up in. Lookahead only — lookbehind is a `SyntaxError` on older
iOS JSC (see v1.0.1).

**Store schema 3** removes the junk records. Only `name:` keys whose name
is not a legal username are dropped; a genuine pseudo-id (a player first
seen before their seat rendered) holds a valid username and survives,
so this cannot simply delete every `name:` key.

**A latent data-destroying bug in `migrateStore`, found while adding
that.** The schema-2 P/L wipe ran *unconditionally* — the function
checked only whether any migration was needed, then always executed
schema 2. This very bump to version 3 would therefore have re-zeroed the
P/L of every store that had already migrated, destroying good data as a
side effect of an unrelated schema change. Blocks are now gated on the
version being migrated *from*, and the test asserts a v2 store keeps its
figures.

The schema-3 pattern is inlined rather than reusing `USERNAME_RE`:
`migrateStore` runs from `let STORE = loadStore()`, which evaluates long
before `USERNAME_RE` is initialised further down the file. Referencing it
there throws a temporal-dead-zone `ReferenceError` at load — which, in a
userscript, means nothing runs at all.

Verified without Node (still not installed here): the script parses clean
in JavaScriptCore via JXA; the three winner lines from the scan now parse
as wins with correct names and amounts; genuine reveals still register as
showdowns; and 15 migration assertions cover the gating, the junk
removal, and idempotence. `test/winner-line.test.js` is new and
`test/migration.test.js` extended. The full suite has NOT been run.

## 1.3.0

Two readability fixes, both reported from live play.

**A new player is no longer a silent seat.** `currentExploitTip()` skipped
anyone under `minHands` entirely, which meant the one opponent you know
least about was the only one the coach would say nothing at all about.
It now shows the read and marks it `new · Nh`, ranked 200 below a
well-sampled read so any solid read on another live opponent outranks it
— but never below the +1000 aggressor bonus, because the player driving
the action is still who you are deciding against however little you have
seen of them.

This is safe because the frequency rules inside `buildExploitPlan`
already carry their own sample gates (`n >= 20`, `foldToCbetOpp >= 8`,
`betSizeCount >= BET_SIZE_MIN`). A genuinely new player therefore
surfaces only the reads that *are* valid early: tilt, a stack that is
stuck, a limp-3bet, what they have shown down. The coach line puts the
marker between the name and the read, so it is seen while deciding
whether to trust the line rather than as a footnote after acting on it.
The pill uses a trailing `?` instead — it is the most width-starved
element in the HUD, and `?` is already this file's convention for a
provisional read (the badge uses it for a provisional archetype).

**The player Report was a wall of prose.** It rendered as a single
`<pre>` of full sentences, each cramming an observation and its advice
together: *"Folds to continuation bets 68% of the time (14 samples) —
c-betting into them prints; fire the flop with anything."* On a phone
that is unreadable.

It is now sectioned — Preflop / Postflop / Sizing & showdown / Your
results / Notes — and every item splits the **observation** from the
**action**. Observations are plain, actions are green, indented and
behind an arrow, so the numbers can be skimmed and the thing to do still
stands out. Section headings are small, uppercase and ruled.

`buildReportSections` is the single source. The screen gets markup and
the clipboard keeps plain text, so the copied report and the displayed
one cannot drift into two different descriptions of the same player —
the same rule the History tab already follows for `formatHand`. Every new
`tph-` class declares its own colour, because `pinTextColor` skips
`tph-` elements and an undeclared one renders dark-on-dark (the v0.18.2
bug).

The Report also picked up four reads it never had, all of which existed
elsewhere by 1.2.0: per-street fold percentages, postflop re-raise,
limp-3bet, and the 3-bet showdown range.

Verified without Node (still not installed here): parses clean in
JavaScriptCore via JXA; every text-bearing class checked for a declared
colour; the clipboard path confirmed still routed through the plain-text
renderer. The full suite has NOT been run.

## 1.2.0

The live coach now picks its line for the decision in front of you, not
just for the player.

**The problem.** `currentExploitTip()` took `buildExploitPlan(p)[0]` —
the villain's highest-gain leak overall — and printed it regardless of
what hero was facing. On the river against a shove it would still offer
"c-bet every flop you take the lead in": a true statement about the
player and a useless one about the decision. The villain-specific
machinery was all there; it just had no idea what street it was on.

**Context tokens.** Exploit entries take an optional `when` list, matched
against tokens read off live hand state: `preflop` / `flop` / `turn` /
`river` / `postflop` / `facing` (someone still in has put more into this
street than hero) / `lead` (hero took the preflop lead, so the c-bet is
theirs). Untagged entries apply everywhere, so an unmodified rule behaves
exactly as before. The context is deliberately coarse — a finer one (SPR
bands, heads-up vs multiway) would depend on reads this file already
flags as imperfect, and a wrong token silently promotes wrong advice,
which is worse than advice that is merely general.

**Relevance boosts, it does not filter.** +60 for a match, −45 for a
tagged-but-unmatched entry. A hard filter would leave the panel silent in
spots no rule happens to cover, and a general read beats no read. The tip
is now scored across *every* entry of every candidate villain rather than
each player's top one — taking `[0]` was the actual cause of the
off-street advice.

Those two numbers sit between two properties that pull against each
other, and `test/coach-relevance.test.js` pins both sides so a future
tweak cannot quietly break one to help the other: a matched situational
rule must win a close call, or context is pointless; and it must not bury
a high-gain always-relevant state read like tilt, which matters on every
street. The test also scans the source for `when` tags the context can
never emit — a typo'd tag is invisible, since it just returns −1 forever
and demotes the rule permanently without ever erroring.

**Per-street fold patterns, finally read.** `streetRates` has computed
`foldPct` since per-street stats were added and nothing consumed it —
the fourth already-collected-but-unreported stat found in this file. It
is also among the most actionable things here: "folds 64% of their turn
decisions" names the street to fire at, and the rule is tagged to that
street so it arrives when it applies.

**New reads from 1.1.0's data.** Postflop re-raise splits into two
opposite lines — a player who raises 18%+ of bets faced wants your strong
hands checked to induce, while one who almost never raises is showing you
the nuts when they do. Limp-3bet is a hard fold trigger at gain 106,
above every postflop rule, because it is the one read that turns a
routine call into a fold. And the 3-bet showdown range is surfaced
separately from the overall one, since that is the range that decides
whether you can 4-bet or have to fold.

Verified without Node (still not installed here): parses clean in
JavaScriptCore via JXA, and 16 assertions driving the real extracted
functions cover matching, the both-sides scoring properties, and the tag
vocabulary. The full suite has NOT been run.

## 1.1.0

Preflop ranges split by raise tier, plus two new stats and a recent-form
column.

**Ranges by raise tier.** `shownHands.raised` was set from `countedPfr`
— "raised at some point preflop" — so an open-raise and a 3-bet were
recorded identically, and the Range tab averaged them into a single
"Raised preflop" group that described neither. `hand.preflopTier` now
records the tier from `preflopRaiseEvents` at the moment a player
raises: 1 = opened, 2 = 3-bet, 3+ = 4-bet. That is the same counter
`maybeCountThreeBet` keys off, so the tier filed against a showdown and
the 3-bet stat cannot drift apart. The tab now shows Opened / 3-bet /
4-bet+ / Limp-3bet / Called separately.

`open` is derived by subtraction (`raised - r3 - r4`) rather than
stored, which gives two properties worth keeping: `open + 3bet + 4bet`
reconstructs the old `raised` group exactly, and a record written
before tiers existed has no `r3`/`r4`, so every one of its raises reads
as an open — the honest reading of data with no tier. No migration.

**Limp-3bet.** Limped, then re-raised the same hand. `maybeCountLimp`
bails once `preflopRaiseEvents > 0`, so `countedLimp` only ever holds
players who put money in before any raise — a raise from someone in it
is unambiguously the trap line and cannot false-fire on an ordinary
raiser. Against a pool that limps ~45% of its voluntary money this is
the strongest preflop signal available. Reported with its raw count
beside the percentage, because it is rare by nature: "2%" off three
hands and off three hundred are different claims. No pool figure
exists for it, so it gets no tick and no verdict.

**Postflop re-raise, with no new collection.** Facing a bet is the only
state in which raise, call and fold are possible — a check or a bet
means nobody had bet into them yet. So `raise / (raise + call + fold)`
over the existing `streetActions` is exactly "how often do they raise
when someone bets at them", check-raises and raises of a c-bet
combined. It is not split into those two, because that needs to know
whether they checked first and `streetActions` does not record it.
Withholds rather than reporting 0% when they have never faced a bet —
"never re-raises" is a claim, and no evidence supports it there.

This is the third time a stat in this file turned out to be already
collected and merely unreported. Check before adding collection.

**Recent form beside lifetime.** The Stats tab prints the recent figure
in the same cell as the lifetime one rather than adding a fourth
column: a phone panel has no width for one, and 12 `colspan="3"` sites
would have had to change — one of them in a different table that would
have broken silently. Only VPIP and PFR carry a recent figure, because
`player.recent` stores three bits per hand and nothing else can be
windowed; the other rows show lifetime alone rather than repeating it
under a "recent" heading. The figure shown is the blended one, matching
the badge in Recent-form mode — a table reading 60 beside a badge
reading 40 is a worse failure than a slightly less direct number, and
the raw observation and sample size are in the tooltip.

Verified without Node (still not installed on this machine): the script
parses clean in JavaScriptCore via JXA, and 12 assertions extracted
from the real file cover the tier split, the reconstruction invariant,
legacy records, and the re-raise denominator.
`test/preflop-tiers.test.js` states all of it permanently. The full
suite has NOT been run.

## 1.0.1

Role badges (PFR/3B/DONK/RR) — and the stats and P/L behind them —
stopped working for most seats in 1.0.0. Reported from a live table:
the chips simply never appeared, with the setting on.

Two faults in a single line, the boundary check 1.0.0 added to
nameToXidGuess's fallback pass:

  - **It was a regex lookbehind.** A negative-lookbehind assertion is
    a SyntaxError at CONSTRUCTION time on JavaScriptCore before
    Safari 16.4 — the engine behind Torn PDA's WKWebView on older
    iOS. It sits in the log-parse hot path with no try/catch above
    it, so rather than merely failing to match, it threw the entire
    parse tick away. Replaced by containsNameToken, an index scan
    over indexOf with the adjacent character tested against the
    username class: identical semantics, no engine dependency.
    Android's Chrome-based WebView was never affected, which is
    exactly what makes this the kind of bug that ships.
  - **It tested seat.textContent.** textContent concatenates child
    elements with NO separator, so a seat reads as
    "Bob$41,200,000Sitting out". A boundary check then correctly
    rejects a name glued to a following letter — correct, and still
    a failed resolution. nameToXidGuess now tries seatDisplayName
    (the seat's own name element, USERNAME_RE-validated) BEFORE the
    fuzzy pass, so the blob is a last resort rather than the path
    most seats take. The 1.0.0 collision fix it protects — "Al"
    resolving to "AlexTheGreat"'s seat — is retained in full.

Both faults returned the 'name:' pseudo-id. That never equals the
numeric XID renderBadges reads off the seat, so `roles.pfr === xid`
was never true and the chip was silently never emitted, while stats
and P/L accrued to pseudo-records. Identical failure mode to 0.20.0,
reached by a different route — see "The pseudo-id is not a
resolution" in CLAUDE.md. The fastest tell is unchanged: Lifetime
reads 0 hands / $0 while History fills up.

Why the 1.0.0 test suite passed anyway: test/name-boundary.test.js
re-implemented the regex locally and asserted against that copy,
because nameToXidGuess can't be driven end-to-end through the
harness (it walks an attribute-substring selector the class-DOM stub
refuses). **A test of a copy cannot fail when the original is
wrong.** It now drives the real exported containsNameToken, every
fixture that was helpfully delimited by '$' or a space is joined by
one that isn't, and a source-level assertion rejects any lookaround
reintroduced anywhere in the script — the only way to catch an
engine fault on a device nobody working on this repo can run.

escapeRegexLiteral is deleted. It existed solely to feed the pattern
that is now gone, and its own tests went with it.

## 1.0.0

Four ideas pulled from HopesG's HUD and Torn Poker Helper, adapted
to this file's own conventions rather than copied wholesale:
  - Equity is range-weighted once the pot is raised.
    estimateEquity() took an optional raiseLevel argument; a raised
    pot now deals opponents from opponentRangeProxy(raiseLevel) —
    RFI_RANGES.SHORT.CO / THREE_BET_RANGES.IP / FOUR_BET_RANGE,
    charts this file already sourced and combo-weighted, not new
    percentages. An unraised pot is untouched (still "vs random").
    First implementation measured ~350ms for a single 8-opponent
    call against FOUR_BET_RANGE (~20ms unweighted) — a ~16x
    regression that would have stalled the coach panel. Fixed by
    precomputing the in-range combo list ONCE per call instead of
    re-deriving it inside the 1200-iteration loop: ~57ms worst
    case. See "Equity" in CLAUDE.md for the full account.
    estimateEquityCached's key now includes raiseLevel, so a hand
    that goes from unraised to a 3-bet doesn't keep serving the
    pre-raise number. equityBasisLabel replaces the hardcoded
    "Eq vs random" text with whichever tier actually applied.
  - Notable hands survive the history cap. isNotableHand flags a
    pot at NOTABLE_POT_BB_THRESHOLD (40bb) or a preflop raise at
    NOTABLE_PREFLOP_RAISE_BB (4bb); trimHandHistory evicts oldest
    UNPINNED entries first, pinned ones surviving past the normal
    historyLimit up to a hard HISTORY_PINNED_CEILING (500) —
    "notable" still can't grow unbounded. Wired into both
    recordHandHistory and mergeHands, so a hand pinned on one
    device isn't silently unpinned by an import from another. 📌
    marks a pinned hand in the History tab and its plain-text
    export.
  - TORN_STAKES gained the $5,000,000 level, previously missing
    entirely. More consequential: HopesG's HUD carries a SECOND
    table map keyed by CSS texture class rather than blind level,
    and it reveals that three stakes ($100k, $1M, $5M) have
    MULTIPLE distinct table names sharing one blind — Torn runs
    more than one differently-named room at some stakes. The
    single name shown for those three levels (including the
    device-confirmed "River Wizard" at $1M) is a best guess, not a
    fact; documented in both the code and CLAUDE.md rather than
    claimed as more certain than it is.
  - A real substring-name bug, found while auditing for the class
    nameToXidGuess's own comment already warned about ("Joe" would
    resolve to a "Joey" seat) but hadn't actually fixed: the
    fallback pass used `.includes(name)` with no boundary at all,
    and a live scan already established that pass runs on 5 of 6
    seats (SELECTORS.seatNameLink resolves on only 1). "Al" could
    silently resolve to "AlexTheGreat"'s seat, misattributing every
    one of Al's actions — and stats, and P/L — to Alex's record.
    Fixed with a boundary check against the actual username
    character class (not regex \\b, which treats the hyphens
    USERNAME_RE allows as delimiters — \\bAl\\b still matches
    inside "Al-Qaeda"). escapeRegexLiteral added alongside it,
    since nameToXidGuess is also reachable with the free-typed
    Settings → heroName field, not just a scraped (and therefore
    already-constrained) log name.

## 0.42.3

A code review pass over 0.42.0-0.42.2, and two real bugs it found.
  - The coach's idle line claimed "Waiting for the next hand", but
    buildCoachAdvice() returns null for TWO things it can't tell
    apart: no hand at all, and hero being OUT of one still running —
    folded, so the hole cards it reads off the seat are gone. That
    is most hands, not an edge case. Now "No read for this
    decision.", true either way. test/coach-idle.test.js locks down
    that a truthy currentHand can still produce no advice.
  - makeResizable pinned the coach panel to a fixed left/top AND
    wrote coachPos/coachSize on pointerdown/pointerup regardless of
    whether the grip actually moved — so one stray tap on the
    24x24 corner (right where a hand reaching for Hide or
    scrolling the body could brush it) silently traded the panel's
    default "always hugs the right edge" anchor for a fixed pixel
    spot that would not re-hug the edge on the next rotate. Pin and
    persist now both gate on real movement, same idea as
    makeDraggable's DRAG_THRESHOLD_PX, which this never had.
Compaction, no behaviour change intended beyond the two fixes above:
  - Two dead CSS rules deleted — tph-self-heat (the coach's self-
    HEAT line it styled was removed at 0.34.0) and tph-turn-flag
    (the "▶ Your turn" text it styled was removed at 0.30.0).
    test/no-orphans.test.js now checks CSS classes the same way it
    already checks SELECTORS/DEFAULT_SETTINGS/functions — a class
    nothing applies has no symptom at all, which is exactly why
    these two survived eight and twelve versions unnoticed.
  - dispatchLogEvent's `raise` and `allin` branches shared an exact
    copy of five lines (VPIP/PFR/3-bet counting, markAggressor) —
    not incidental, it IS open finding #3 (all-in counts as a
    raise), so the two copies were one accidental edit away from
    disagreeing about their own documented imprecision. Pulled into
    markAsPreflopRaiseAction, one call site instead of two.
  - pdaFetch's GET and POST branches were a copy of each other
    wrapping different PDA_http* calls as a Promise — pulled into
    pdaCall, which also makes the docstring's "single place to
    patch" claim actually true.

## 0.42.2

The seat badge was wide enough to reach the community cards.
Reported from a live table at "3B 🤮 TAG V35 P23 A67" — ~168px, and
the flop is behind it. Everything shed is punctuation, not content:
no spaces inside V35P23A67 (the letters already delimit the groups),
the "15h" window marker moves to the tooltip, badgePct caps a figure
at two characters (100 renders 99 — same read, one less glyph), the
type/number gap is a margin not a space, and padding, letter-spacing
and the emoji size all come down. ~168px -> ~116px, 31% narrower.
The LABELLED numbers stay. "74/12/16" is three unexplained figures on
an element with no room for a legend, which is exactly why they were
labelled; width is not a reason to undo that.
Settings gained "Numbers (V/P/A) on the labels" as the escape hatch
if it still doesn't fit — 64px, 62% narrower, keeping type, role and
🤮/🔥, which are the read. The numbers are the evidence for it and
are one tap away in Stats.
SELF_BADGE_LIFT_PX 4 -> 5 badge-lines: four cleared hero's name plate
but still landed on the chip figure.

## 0.42.1

SELECTORS.potDisplay was declared and read by NOTHING — readDomPot()
carried its own hardcoded copy of the same two selectors, so the one
obvious place to edit after a Torn redeploy would have fixed nothing,
silently. Third time: seatName sat unread for twelve versions while
every player record stored "#3722665", and dealerButton was written
up as "a red herring" when the real problem was that nothing read it.
test/no-orphans.test.js now fails on any SELECTORS or
DEFAULT_SETTINGS key, or any top-level function, that nothing uses.
Verified non-vacuous against all three historical cases.
Also: the changelog moved to CHANGELOG.md (780 lines above the first
line of code, paid for by every read of this file from the top), and
heroCanPreAct, declared at 0.26.1 and never called, is deleted.

## 0.42.0

Five screen-real-estate and export changes, all requested from the
table rather than inferred:
  - Hero's own badge is lifted SELF_BADGE_LIFT_PX (four badge-lines)
    so it sits ABOVE the name instead of under it. Every other seat
    has empty felt below it; yours has the name plate, the stack and
    whatever Torn draws around the acting seat, so the one position
    that works for an opponent is the one that doesn't work for you.
  - The coach panel resizes. A real ◢ grip with pointer handlers,
    not CSS `resize: both` — the native handle is mouse-only in
    practice and this only ever runs in a touch webview. Size
    persists to settings.coachSize, is clamped on rotate, and the
    body scrolls so the header (the only drag handle, and the Hide
    button) can never be sized away.
  - The coach STAYS MOUNTED between hands, showing "Waiting for the
    next hand" instead of being torn down. You cannot park something
    on screen that disappears several times a minute. The reason for
    the original teardown is untouched and still honoured: what must
    never sit there is STALE advice looking current.
  - History tab exports. `playerHistoryExport` writes EVERY recorded
    hand against that player to a text file via the same PDA share
    handler as Backup — the tab renders 40 and Copy takes those 40,
    and an export that silently stopped at the same cap would be a
    loss you'd only find much later. Both buttons now state their
    count. Falls back to the clipboard where the share sheet isn't
    available, rather than appearing to work and producing nothing.
  - The HUD button is 32px, down from 44px. It floats over the table
    permanently; the red fill and the label are what make it
    findable, not the size.
  - Player panel tab order is Stats · Range · Exploit · Report:
    Exploit and Report are the two written-out reads on one player
    and are read together, so they sit beside each other, with the
    raw numbers they derive from leading.

## 0.41.0

STORE.players is bounded. Open finding #2 is CLOSED.
The shape follows a measurement, not a preference: a fresh one-hand
record is 562 bytes and a five-hundred-hand one is 1,076. A thin
record costs HALF what a thick one does for essentially none of the
value — under minHands classify() returns "Unrated" anyway, and
shrinkage pulls a three-hand player to the pool average regardless.
So thin goes before old, and age is the tiebreaker, never the lead:
a flat "drop everything over 60 days" rule deletes a weekly regular
with 400 hands and keeps yesterday's one-hand stranger.
  1. Under 10 hands AND not seen in 30 days.
  2. Not seen in 180 days, any sample.
  3. Least recently seen, down to 2000 players.
Rule 3 is the only part that is an INVARIANT rather than a
heuristic. Rules 1 and 2 might free nothing; "the store cannot hold
more than PRUNE_PLAYER_CAP" is what makes the ceiling unreachable
rather than merely further off.
Runs off the back of a save (writing is what makes it bigger), and
only past STORAGE_WARN_PCT — nothing is deleted on a day it was not
needed. A REFUSED save forces a pass immediately and retries once;
that terminates because the second pass has nothing left to drop.
Every run is reported in Settings → Storage and persisted, because
"we dropped 2,900 records last Tuesday" must not be deniable.
Two things deliberately survive everything: hero's own record, and
any record with NO lastSeen — an unknown age is not an infinite one,
and reading epoch-0 as "very old" would let a gist import delete a
year of good data on the first save after it. Those are stamped and
judged on a real timestamp next time.

## 0.40.0

A full localStorage is no longer silent. saveStore caught the quota
error and console.warn'd, which on a phone is no warning at all —
and it is the worst failure in the file precisely because it has no
symptom: the HUD keeps working perfectly off the in-memory STORE for
the rest of the session, then loses everything recorded since the
first refusal on reload.
  - A refusal now sets `saveFailure` and raises a banner. It is
    pointer-events:none, per the rule that nothing the HUD draws
    over the table may swallow a tap on Fold or Call.
  - Settings gained a Storage section: a meter, the size, the player
    and history counts, and the per-player cost. Placed directly
    above Backup, because copying one is the remedy for every state
    it can report. Amber past 75%.
  - The players list footer carries the same figure, since that is
    where the player count is visible.
A successful save clears the state; the FIRST failure's timestamp is
kept, since it marks how far back the memory-only data goes.
The quota is an ESTIMATE (5MB) — the Storage Manager API is absent
in the PDA webview. It renders a proportion and warns early; it
never gates a write, because guessing low would refuse data that
would have fitted.
test/harness.js now QUEUES setTimeout instead of dropping it, with
runTimers() to drain. saveStore's write lives inside a 250ms
debounce, so a dropped timer meant any test of it passed vacuously.
Open finding #2 is half closed: this is the "surface it" half. The
store still grows without bound.

## 0.39.0

Recent form on the badge is a two-level Bayesian blend rather than a
mode switch: the window is shrunk toward the player's OWN baseline,
which is itself shrunk toward POOL_AVG.
  window -> their history before the window -> POOL_AVG
It used to pick one of a lifetime figure and a RAW window figure,
crossing over at 6 hands (SESSION_BADGE_MIN, now deleted). That
crossover jumped toward the noisier of the two estimates and could
move the badge 40 points on a single hand. Now a 1-hand window reads
as their baseline and walks toward what it is actually seeing as it
fills — no threshold, no two modes.
The prior EXCLUDES the window, same as tiltRead's baseline: those
hands are inside p.hands, and counting them twice would let a long
stretch of new behaviour reinforce its own prior. With no history
outside the window it collapses to POOL_AVG, which is right for a
player you have only just met.
shrunkPct grew an optional 4th argument (prior weight); three-arg
callers are unchanged. RECENT_PRIOR_WEIGHT is 8, lighter than
PRIOR_WEIGHT's 12 — a player's own history predicts their next hand
better than a pool average, but a recent read has to be able to move.

Seat badges mark who holds the initiative in the hand in front of
you, not just what kind of player they are.
  - Gold PFR / 3B / 4B on whoever made the LAST preflop raise. The
    last, not the first: in a 3-bet pot the 3-bettor is the seat
    everyone else is playing against, and the level is worth naming.
  - Blue DONK (led out) or RR (check-raised, or raised the c-bet) on
    anyone taking the betting lead postflop who was NOT that raiser.
    The preflop raiser c-betting is expected and carries no read, so
    they never get a postflop chip.
Both are derived from hand.actions on every render rather than
tracked in parallel state, so they are correct after a mid-hand
re-render and clear themselves when the hand settles. Toggleable in
Settings → Seat labels.
The collapsed coach pill leads with 📖.
"Stack this sitting" is one bar instead of three cash rows. The
whole content of that read is where NOW sits between the low and the
high, which three stacked figures made you work out; the track spans
the sitting's range, the fill ends at now, and a pale tick marks
where they sat down. Four fewer rows on a phone.
"Bet size" now carries its sample ("of pot · 9 bets, low") and the
legend says what it measures — average bet/raise as a share of the
pot BEFORE it — which the row never explained. The 12-bet threshold
the exploit plan already gated on is now BET_SIZE_MIN, shared.

## 0.38.0

The collapsed pill is "Coach", and it carries a live exploit tip.
It used to read "📊 GTO" — wrong on both counts. These are reference
charts, not solver output (that word was removed everywhere else in
0.13.0 and this was the last one standing), and a static label
carries no information: collapsing the coach meant giving up the
read entirely, when the point of collapsing is to reclaim screen.
The pill now shows the same top adjustment the expanded panel leads
with, shortened to a few words — "C-bet · no flop bluffs",
"Stuck · value bet". Every plan entry gained a `short` form for
this; the full sentence stays on the tooltip and in the Exploit tab.
currentExploitTip() picks the subject, and BOTH the pill and the
live panel use it, so the two can't disagree about who matters. It
prefers whoever is driving the action — a stronger read on someone
who has already folded out of the decision is not more useful — and
falls back to the most exploitable player still in the pot, so an
unraised multiway pot still gets a read rather than nothing.
Pill content refreshes on every render rather than only at creation,
which is what made a static label the only option before.

## 0.37.1

"Last seen" row under Usually plays: the last three DISTINCT tables,
newest first, each with how long ago.
"Usually plays" is a lifetime share and says nothing about movement.
Someone who has just dropped two stakes is a different proposition
from a regular, and only a recency row shows that.
Records table CHANGES rather than hands — consecutive hands at one
stake collapse into a single entry whose timestamp moves forward, so
a 200-hand session stays one entry instead of flooding the list.
Returning to a table already listed IS a new entry, since the row is
about where they have been in order. Capped at three.

## 0.37.0

Stack swing and stake history per player.
STACK — trackStacks() records each seated player's stack on the 3s
tick, keeping the low and high of their CURRENT sitting. Session-
scoped on purpose: a lifetime low would just record the smallest
table they had ever sat at. It resets after a session-length gap or
when the blind level changes, because a $40M low carried from a
table where that was deep to one where it is four blinds is worse
than no figure.
The swing is the actual read — someone 250bb below their high has
just lost a stack, which is the state tilt follows from. It appears
in the Stats tab (now / high / low / off-high, each with a bb
figure), in the badge tooltip, and as a "Stuck" entry in the exploit
plan ranked just under tilt itself.
TABLES — p.tables counts hands per blind level at settlement, keyed
by the level rather than the table name so a rename in TORN_STAKES
cannot orphan stored counts. The Stats tab shows "Usually plays" as
a share, and an unknown stake still names itself in BB rather than
vanishing, since Torn adds tables and the ladder will go stale.

## 0.36.0

Exploit tab: a synthesised plan for beating one specific player,
drawn from every stat plus their showdown range.
Ranked, not narrative — mid-hand you want the two or three
adjustments worth the most, not a paragraph. Ordering is by expected
gain, and against this pool postflop outranks preflop because they
do not fold: the top line for a station is "stop bluffing flops",
for a nit it is "c-bet every flop".
Every claim names the number it came from. An exploit you cannot
trace back to a stat is indistinguishable from a guess, and POOL_AVG
is borrowed rather than measured here, so the reader has to be able
to check the reasoning. Tested: every line cites a figure.
Two failure modes the tests rule out. It must not contradict itself
— independent rules can easily produce "bluff more" and "stop
bluffing" in one list. And it must stay quiet without evidence: a
pool-average player yields nothing, three fold-to-c-bet spots
produce no c-bet advice, and a new player gets an explanation rather
than a blank box.
The live coach now shows the TOP entry from the same synthesis
rather than its own separate rules — exploitDeviation is deleted.
One line is all there is room for mid-hand, and it should be the
most valuable one rather than whichever rule was checked first.
Tilt outranks everything when present, since it fades within an
orbit and the others do not.
Hero's badge is centred on the seat instead of left-aligned, so it
sits under the chip pile rather than off toward the edge. Same
vertical position as every other badge.

## 0.35.0

Showdowns are read off the SEATS, not the log. Revealed hands were
plainly visible on the table while both the Range tab and the
History tab stayed empty — and the log path had already been fixed
twice, which was the clue: this layout carries no reliable "reveals"
line at all, so the cards flipping face up is the only evidence
there is.
harvestShownCards() polls the seats every second and records any
opponent showing two face-up cards. It has to poll: the cards are
cleared by the next deal, so a read at settlement finds nothing.
First sighting wins, so the log path still works where it does and
neither source can double-count. It also fills `shown`, which is
what the History tab reads and why that was blank too, and credits
WTSD — previously counted only off the reveal line, so on this
layout nobody was ever recorded as reaching showdown.
Found while testing: parseCardEl's aria-label branch accepted only
spelled-out ranks ("nine of clubs"), but Torn writes DIGITS — the
live scan shows `aria-label: 9 of clubs`. Every numeric card failed
there and resolved only when the class name happened to carry it. It
now defers to parseCardsFromText, which understands both.
The deep scan reports face-up cards per seat and what has been
captured this hand, so the two sources can be told apart.

## 0.34.0

Your own seat gets a badge, under your name and chips like everyone
else's. There was never a good reason not to: the skip was a
leftover from when heroXid was broken and hero was being tracked as
their own opponent, so the badge would have been wrong. With
identity resolved it is the most useful badge on the table — your
own V/P/A and archetype, plus 🤮/🔥, where you are already looking.
Tinted green so it reads as yours at a glance, and tapping it opens
your stats. Toggleable separately from the others.
The coach drops its self-HEAT line, now duplicated by 🔥 on the
badge. The self-TILT line stays: an emoji has no room to say why,
and a touchscreen has no tooltip — tilt is the one that should
change what you do, so it earns the second mention.

## 0.33.0

Your own stats were reachable but not findable, and lied when found.
Hero has always accumulated stats like anyone else (dealtInXids
includes hero), so the record was sitting in the players list under
your username — with nothing marking it as yours, and a P/L column
reading $0.
That zero was the worst part: plChipsEst is never written for hero
because it would mean your P/L against yourself, so the column read
"flat" when it meant "not applicable". It now says "see Lifetime",
and opening your own panel replaces the "Your P/L vs them" block
with your actual lifetime bb/chips, bb/100 win rate and session
figures.
Added Settings → "📊 Your own stats", because hunting for your own
name in a list sorted by hand count is not a route. Disabled with a
reason until hero resolves to a seat.
Your row in the players list is now tagged "you".

## 0.32.0

Showdowns weren't reaching the Range tab. Three causes, all in the
card parsing rather than the storage — the pipeline from log line to
shownHands was fine.
- parseCardsFromText had NO word boundaries and ran case-
  insensitively, so it matched rank+suit letters inside ordinary
  words. "9 of hearts, 7 of spades" came out as "ATo": a confidently
  wrong holding, which is worse than none. Torn's own descriptions
  ("Two Pairs: Aces and Eights") are full of the same traps. Now
  bounded on both sides, and prose yields nothing.
- Only "reveal"/"reveals" were accepted. "revealed" and "turns over"
  fell through to the unmatched list. All forms now match.
- If Torn draws the reveal's cards as ELEMENTS rather than glyphs,
  the row text reads "Bob reveals (Two Pairs: ...)" — the line parses
  fine and simply carries no cards, so nothing appears unmatched and
  the Range tab stays empty with no clue why. readLogRows now
  appends card aria-labels ("9 of hearts") to each row, and the
  parser understands that spelling. Appended text is stable, so the
  snapshot diff is unaffected.
The deep scan now prints every reveal row it can see with what each
one parsed to, so a remaining failure names itself.
Worth knowing: showdowns are banked at SETTLEMENT, not when the
reveal line lands — hand.winners is still empty at that point. The
Range tab therefore fills in one hand later, by design.

## 0.31.0

Effective stack is now honest, and the badge says what it means.
EFFECTIVE STACK — effectiveStackVs(hand, villain) replaces
effectiveStack(hand), fixing two things that were quietly wrong:
  - Hero is always in the calculation. The old version took the
    minimum across live players, so if hero's own seat failed to
    parse it reported the shortest VILLAIN — a number that can be
    far larger than what you can actually lose, shown with no
    warning. Without your stack there is no honest answer, so the
    line is now absent instead.
  - Pairwise when there is someone to be pairwise with. Against a
    specific opponent the figure is min(you, them); the table
    minimum is only right with no particular opponent in mind, and
    using it while facing a bet understates what is at stake against
    the player actually betting. The line names who it is against.
SPR now uses the pot as it stood at the START of the street
(hand.potAtStreetStart) rather than the live pot, which shrank the
number while you were deciding — the opposite of what SPR is for.
Preflop it is omitted entirely; SPR is a postflop concept.
BADGE — archetypes abbreviated to three letters (BAL, STA, NIT, TAG,
LAG, MAN, FSH) so the numbers have room, and the numbers are now
LABELLED: "STA 15h V74 P12 A16". Previously they were bare figures
whose COUNT changed with the badge mode — two in session mode, three
in lifetime — which is worse than either. V and P follow the
selected window; A is always lifetime, because postflop samples are
too scarce for a 15-hand window to be anything but noise. Settings
now spells the whole format out.

## 0.30.0

Coach panel cut down. It is read mid-decision on a phone, so every
line has to earn its place; it had grown to nine.
Removed outright:
  - The standing footnote. Four lines of disclaimer read once and
    ignored forever. The honesty it carried now rides inline where
    it applies and costs a word: "Baseline" (never "GTO") on chart
    lines, "Eq vs random" on equity, and the ⚠ short-stack note when
    the ~100bb assumption is actually broken — the only time that
    caveat changes anything.
  - "▶ Your turn". The green border says it, louder.
  - The table name. It never changes a decision; it is in Settings.
Compressed:
  - Stack line is now "18bb eff · SPR 2.4 low" — the cash figure
    added nothing that bb does not.
  - Equity drops from three quotes to two. Live is what the decision
    turns on, full-ring is the stable reference; the heads-up
    ceiling was a third number for a spot you are usually not in.
    Pot odds folded onto the same line: "need 33% ✓ +EV call".
  - Self-tilt and the exploit line are one short sentence each, and
    the exploit now leads with fold-to-c-bet, which is the most
    directly actionable number the HUD has.

## 0.29.0

Tilt watches YOU too, gets a big-loss trigger, and stops borrowing
the fire emoji.
- 🤮 is now tilt. 🔥 is a separate, new read: RUNNING HOT, someone
  winning far more recent pots than the seat count makes likely.
  Both can be true at once — steaming and getting there are
  different questions.
- Self-tilt. Badges deliberately skip hero's seat, so the one player
  the HUD could never warn about was you — the case where it is
  worth most. The coach panel now carries the same read, since
  hero's record accumulates exactly like anyone else's.
- Surfacing fixed. It used to be a bare emoji on the badge with the
  explanation in a `title` tooltip, which a touchscreen cannot show.
  Now in the players list, at the top of the Stats tab, and in the
  coach — with the reason written out.
- A recent big pot loss (75bb+) LOWERS the tilt bar from 20pp to
  12pp rather than triggering on its own. Losing money is not tilt:
  a player stuck three buy-ins who keeps playing their game is not
  tilting. But a big loss raises the prior that a VPIP spike IS tilt
  rather than a run of playable cards, so less behavioural evidence
  carries the same weight. The sting expires after 20 hands.
- The tilt window is capped at 15 hands regardless of the badge's
  sessionWindow setting. Tilt is short-lived; read over 40 hands the
  stretch blends back into normal play and the signal fades exactly
  when it is truest.
`recent` now packs a "won" bit alongside the play state. Values
written before it existed are 0-2 and read correctly as "did not
win", so no migration was needed.

## 0.28.0

Stats panel fits the screen, and the turn cue knows whose turn it is.
WIDTH — the Stats table now uses table-layout:fixed with explicit
column widths, so a long label or a wide number can no longer push
it past 100%; without it the browser sizes columns to min-content
and a phone scrolls sideways. Bars are a FIXED 46px rather than a
percentage of the cell — the proportional bar was the main culprit.
Labels shortened (Fold v 3B, Fold v CB, Limp), and the disclaimer
cut from five lines to one. Outlier rows now carry a tinted
background as well as a coloured value, since colour on one number
is easy to miss at arm's length.
TURN DETECTION — was: "any single-action button is on screen". The
live scan showed why that is wrong: "Call Any / Check", "Check" and
"Check / Fold" were all present WHILE WAITING, and the bare "Check"
survives the pre-action filter and reads exactly like a turn button.
The screen was glowing for most of the hand.
Seats carry `active___` marking who is on action (confirmed in the
same scan). isHeroTurn now compares that against hero's seat and
falls back to buttons only when no active seat can be read.
Added a second, quieter state: an amber STATIC border when you are
the next player to act, walking the seat ring from the active seat
and skipping anyone folded or sitting out. Static on purpose — two
pulsing states compete, and this one is a heads-up, not an alarm.

## 0.27.0

Fold misclick guard, and a chime to go with the buzz.
FOLD GUARD (on by default) — tap Fold once to arm, again to confirm.
This is the only code in the HUD that touches the game's own
controls, so it is built to three rules, all covered by tests:
  1. It NEVER folds for you. There is no synthetic click anywhere in
     it; the second tap is your real tap, passed through untouched.
  2. It FAILS OPEN. Any error, any unrecognised element, and the
     click goes through — a guard that swallowed a genuine fold
     would be worse than no guard.
  3. It only ever intercepts Fold. Call, Raise and Check are never
     delayed, and neither are the HUD's own buttons.
A second tap within 250ms is treated as a fat-finger double-fire and
swallowed rather than accepted as confirmation. Missing the 4s
window costs nothing: Torn folds you on timeout anyway, so hesitating
produces the outcome you were choosing regardless. "Check / Fold" is
guarded too — a misclicked pre-action fold still folds the hand.
TURN CHIME — synthesised with Web Audio, so there is no asset to host
and nothing for the webview to block. Phones refuse audio until the
page has been tapped, so the context is primed on the first tap
anywhere; without that the first chime of a session is silently
dropped and the setting looks broken. Settings has a Test button
because webview audio is unreliable enough to need one.
(Vibrate already shipped in 0.26.1 — same section.)

## 0.26.1

Hard-to-miss "it's your turn" cues: a pulsing border around the
viewport, the gear button turning green, and the coach header with
it. On a phone the action buttons are small and easy to miss,
especially with the coach collapsed.
The overlay is pointer-events:none, and that is not optional — it
covers the whole viewport, and one tap swallowed on a fold or call
would be far worse than any cue is good. The HUD stays advisory: it
must never come between you and the table.
Driven by findTurnButtons(), not findActionButtons(). Torn shows
pre-action controls while you are WAITING, so cueing on those would
leave the screen glowing for most of the hand — the same as no cue.
Polled at 400ms rather than on the coach's 1.5s tick: a cue that
arrives late has already eaten part of the decision clock. Optional
single buzz on the rising edge, off by default. Honours
prefers-reduced-motion by holding the highlight static rather than
dropping it, since it is load-bearing.

## 0.26.0

Four features adopted from HopesG's HUD, plus the guard that makes
one of them safe.
RANGE TAB — what a player has actually SHOWN DOWN, split by whether
  they raised or called preflop. This is the only direct evidence of
  anyone's range in the HUD; everything else infers one from
  frequencies. The raw material was already being captured and
  thrown away: hand.shown held the revealed cards and nothing ever
  read it. Showdowns are banked at SETTLEMENT, not when the reveal
  line lands — at that point hand.winners is still empty, so every
  showdown would have scored as a loss.
RECENT FORM — badges now read the last N hands (default 15) rather
  than lifetime, falling back to lifetime while the window is thin.
  A nit who has just started playing every hand is the read that
  matters, and a lifetime average hides it. Stored as one digit per
  hand per player, not hand records — the store already grows
  unboundedly.
TILT — 🔥 on a player whose recent VPIP is 20+ points above THEIR OWN
  baseline. Tilt is behavioural, not financial: a player stuck three
  buy-ins who keeps playing their game is not tilting, and a station
  who always plays 70% is not either. The baseline excludes the
  recent window, so a long tilt stretch can't quietly raise the very
  number it is measured against.
STAKES LADDER — blind level identifies the table, so the coach names
  it and the tier. Two levels are corroborated by scans from this
  device: $1M River Wizard and $2.5M Cat's Chance. Since you play
  both, lastSeenBB now notices a table switch instead of carrying a
  stale blind across.
The ladder also gates a real hazard it revealed. Torn can render
  amounts as "181.00 BB" rather than "$181,000,000", and in that mode
  every figure parses six orders of magnitude too small with nothing
  looking broken. A blind under $10 is refused: P/L is withheld for
  that session rather than written wrong, and Settings and the deep
  scan say so.
applyHandResults now reads its sets defensively. A throw there loses
  the entire hand including the P/L, so dropping one stat is by far
  the better failure.

## 0.25.1

P/L shows both units everywhere. The players list column leads with
big blinds and carries the chip figure underneath; the Stats tab has
one P/L row with bb in the value column and chips in the pool column.
A player tracked before 0.23.0 has real chip P/L and a zero bb
figure, so there the chip figure is promoted to the top line and no
bb figure is shown — "+0.0bb" reads as "flat against them" rather
than "not measured yet", which is the opposite of the truth.
Also fixes two rows left over from the 3-column Stats table: the
"By street" and P/L headings still used colspan="2", so they and the
per-street rows were short a cell.

## 0.25.0

Stats are now read at a glance instead of being read. Every
percentage in the Stats tab renders as a bar with a tick marking the
pool average, plus a "Pool" column and ▲▼ when the deviation is worth
acting on. The players list colours VPIP/PFR the same way and carries
a pool-average reference row.
POOL_SPREAD gives each stat its own scale, which is the whole point:
5pp on VPIP (norm 51) is noise, 5pp on 3-bet (norm 3.7) more than
doubles it. One shared threshold would call the first notable and the
second typical — exactly backwards. It is a judgement call, not a
measurement, and says so.
Colour comes from the SHRUNK figure while the printed number stays
RAW: a two-hand player really did VPIP 100% and the tab should say
so, but lighting the row up as extreme off two hands is reading noise
as a read. Colours are grey/amber/orange, never red/green — high VPIP
is not "bad", it is loose, and a good/bad palette asserts a judgement
the HUD is in no position to make. Direction comes from the arrow.
The players list P/L column now shows big blinds, falling back to
chips for players tracked before 0.23.0 — printing "+0.0bb" there
would read as "flat against them" rather than "not measured yet".
Note for anyone adding UI: pinTextColor deliberately SKIPS elements
carrying a tph- class, so a new tph- cell with no colour of its own
is left for Torn's bare td rule to darken. That is the 0.18.2 bug,
and these rows hit it — every tph- element holding text now declares
its own colour.

## 0.24.0

Fixes from the first live scan of the 0.22.0 work. Most of it held:
`self___` resolved hero to a real XID (heroXid: 311421, P/L bound at
last), `dealer___`+`position-2___` resolved the button, all 9 stacks
read, the PDA bridge is present, and the action buttons were found
by text. `playerPositioner-<N>___` DOES exist on PDA after all — the
earlier "no index on mobile" reading was the top-45 truncation
hiding eight count-1 classes, the same way it hid `self___`.
Three real problems, none of them in the new code:
- THE BOARD HAS NEVER BEEN READ. `communityCards_` matched zero with
  five cards face-up, so every postflop equity number came from the
  log-parsed fallback or nothing at all — and a preflop-looking
  equity number is entirely plausible, so it never surfaced.
  readBoardCards now derives the board from confirmed structure: any
  face-up card not inside hero's hand and not inside a seat.
- "JDWV posted $2,500,000" was unparsed — a dead blind posted on
  rejoining. Real money into the pot, previously invisible. Added as
  `postDead`: contributed, but NOT counted as VPIP or a limp, since
  it is forced.
- The buttons found were "Check / Fold" and "Call Any / Check" —
  PRE-action controls shown while waiting, not turn buttons. Counting
  them made isHeroTurn true for most of the hand, the same failure
  as the hole-cards fallback it replaced. Only single-action labels
  count now; heroCanPreAct() reports the rest.
HUD_VERSION had been stuck at 0.19.0 since 0.19.0, so every deep scan
from four releases reported the wrong version in its header — the
first line anyone reads when debugging. test/version.test.js now
fails if it drifts from @version, or if a release has no changelog
entry. The file header already carried that rule in prose; prose was
not enough.

## 0.23.0

Everything is expressible in big blinds, and three stats that were
already being collected are finally visible.
CORRECTION: 0.22.0 set POOL_AVG.wtsd = 20.9, taken from the source's
`wwsf` (won when saw flop) — a different statistic from went-to-
showdown. WTSD is now left UNSHRUNK, like AFq, rather than anchored
to an unrelated number. The correctly-mapped foldToCbet (56.1) and
limpShareOfVpip (44.8) are added in its place.
- hand.bbAmount is read off the postBB line, with a session-level
  last-seen fallback for hands joined mid-way. hero.netBB and
  plBBEst accrue alongside the chip figures, converted AT SETTLEMENT
  because the blind level cannot be recovered afterwards. The
  players list shows a bb/100 win rate, withheld under 50 hands
  where it would be pure noise.
- Fold-to-c-bet has been collected since C-bets were added and
  displayed nowhere. Now in the Stats tab and the report, with a
  read attached: over 60% and c-betting them prints.
- streetActions has always held per-street counts that computeRates
  collapsed into one AFq. Split out, plus fold-frequency per street.
  A player who fires flops and gives up on turns was invisible.
- Limp frequency, tracked per player and reported as a share of
  VPIP against the pool's 44.8%. Against a pool this passive the
  habitual limper is the most exploitable seat, and was previously
  indistinguishable from a caller.
The coach now warns when effective stack is under 40bb that the
  baselines are ~100bb charts, and under 20bb that the real decision
  is push-or-fold. That assumption was previously only in a footnote,
  which was defensible while depth was unknown and is not now.
ensureHeroShape backfills the new hero fields: a 0.22.0 store has
  only {hands, netChips}, and an undefined netBB would make every
  += produce NaN and poison the figure permanently.

## 0.22.0

Adopted findings from HopesG's public Torn poker HUD (MIT, GreasyFork
569933), read as a reference. Selector work here is UNCONFIRMED on
Torn PDA's layout — every addition degrades to the old path rather
than replacing it, and the deep scan now reports on each one.
- Hero's seat is marked `self___`, not `hero_`/`you_`. findHeroXid
  now reads the DOM marker FIRST, so P/L works with the Settings
  username left blank and the "name:" pseudo-id window closes.
- Action buttons are matched by LABEL, not by a hashed container
  class that has never matched. isHeroTurn works, and the coach says
  "Your turn" when it is.
- The dealer button is real: `dealer___` carries `position-<N>___`,
  or `position-self___` when you hold it. getDealerXid reads it.
- "Sitting out" is detectable via the seat's `state___` text. Those
  seats are dropped from the position ring and the hands
  denominator, closing a documented off-by-one in every label.
- Stacks are read off the seats, so the coach reports real effective
  stack and SPR instead of leaving commitment unmodelled.
- PDA is detectable via window.flutter_inappwebview, which also
  exposes a native share handler. Backup can now save a real file
  instead of only filling a textarea.
Archetypes are recalibrated to the TORN pool (VPIP ~51 / PFR ~13,
against ~25/18 for live poker). The old thresholds classified almost
the whole population as "Fish" — accurate and useless. Thresholds
are now written as multiples of POOL_AVG so correcting the anchor
moves the labels with it, and rates are shrunk toward the pool
average with a 12-observation prior before classifying, so two hands
played out of two no longer reads as a 100% VPIP maniac. Added a
"Station" archetype for the very loose and very passive.
POOL_AVG is BORROWED, not measured here — the players list now shows
your own observed pool average beside it so the assumption can be
checked as hands accrue.

## 0.21.0

Testability seam, and the panel bug it immediately caught.
Opening a player panel while Settings was up made the next gear tap
do nothing. renderPlayerPanel tore down `.tph-panel` — the class
EVERY panel carries — rather than its own marker, so it deleted the
settings panel from the DOM while `settingsOpen` stayed true; the
gear then toggled the flag back to false and rendered nothing.
All three panels now go through renderPanel(), which requires a
marker class, scopes teardown to it, and runs pinTextColor AFTER
the caller's wire() step so late-mounted content can't render
dark-on-dark the way it did in 0.18.2.
Added window.__TPH_TEST, exposed only when a harness sets
window.__TPH_TEST_HOOKS before load, plus test/ (harness + three
test files, run with `node test/run.js`). Harnesses used to recover
functions by slicing this file with indexOf/eval against literal
markers, which broke on every rename. Nothing about the install
model changes: still one file, still no build step, and test/ never
ships.

## 0.20.0

P/L was frozen at zero for everyone, and the cause was one truthy
string. findHeroXid() returns the pseudo-id "name:<username>" when it
can't find hero's seat, and the 3s retry was guarded by `if
(!heroXid)` — a pseudo-id is truthy, so the failed bootstrap
resolution latched in for the whole session. That retry exists
precisely because seats render after the log container, so it was
defeating its own reason for being there.
The damage was silent and total. Hero's own log lines re-run
nameToXidGuess every time and DO resolve once seats render, so
contributions/winnings keyed under the real seat XID while heroXid
still held "name:...". heroWon and heroContributed both read 0,
heroDelta came out 0, and every plChipsEst got `0 * share`.
hero.netChips never moved, hero.hands never incremented (dealtInXids
holds real XIDs), and `xid === heroXid` failed to skip hero — so you
were tracked as your own opponent and badged on your own seat.
Retry now tests heroUnresolved() instead. Stored P/L can't be
rebuilt from partial history, so a one-time store migration (schema
2) zeroes every plChipsEst, hero.netChips and session.net. Hand
counts and rate stats were never affected by this and are kept.

## 0.19.0

Nothing opens itself on load any more. The green "HUD loaded" banner
is gone entirely — the red gear button already proves the script
injected, and it doesn't cover the table for 15 seconds to do it.
(Calibration mode still opens its panel when the setting is on; that
is the point of it, so switch it off when you're done scanning.)
Every coach line now names the position, on every street. Postflop
lines omitted it entirely, so the seat vanished from the advice the
moment the flop came down — exactly when you most want to check the
advice against where you're sitting. The tag distinguishes how the
seat was derived: "CO" read from the seat ring, "CO?" derived from
the log's action order, "?" not established (with the reason).

## 0.18.2

The dark-on-dark text was never specific to the hand history: the
Stats table and the Report <pre> were unreadable too, in the same
panel, which a screenshot of the Stats tab made obvious. Cause:
`.tph-panel { color: #eee }` only reached its children by
INHERITANCE, and inheritance loses to any direct rule on the child —
no !important needed. Torn styles bare `td` and `pre`, so exactly
those went dark while the panel title and tab labels (which Torn has
no rule for) stayed fine. pinTextColor() now walks each panel after
render and sets `color: inherit !important` inline on every element
that isn't one of ours, which no stylesheet can override. Elements
carrying a tph- class are skipped so warnings and history colours
survive.

## 0.18.1

Hand history text was dark-on-dark on the live page. Two class-based
attempts failed (a recessed card relying on inherited colour, then a
lighter card with !important in our own stylesheet) while the Stats
tab in the SAME panel rendered fine — which rules out the panel and
inheritance, and means a Torn rule was beating ours on specificity.
Colours are now inline with !important, the highest-priority
declaration in CSS, so no page stylesheet can override them. The
Report tab's <pre> is pinned the same way, since bare elements like
<pre> are exactly what a page stylesheet is most likely to target.
Layout is unchanged — only the colours are forced.

## 0.18.0

Fixes from the first live deep scan (v0.17.0, 5-handed table).
The coach was printing "defend roughly NaN% of your range (MDF)":
minimumDefenseFrequency computed pot/(pot+bet), and BOTH were zero
because the log snapshot is primed rather than parsed on attach, so
hand.pot starts at 0 whenever the HUD loads mid-hand. It returns null
now and the coach says the pot is unknown instead of printing NaN.
Root fix: the pot is read from the table. The scan confirmed
DIV.potsWrapper_ > DIV.totalPotWrap_ renders "POT:$7,000,000", so
readDomPot parses it and effectivePot prefers it over the running log
sum. This closes the longest-standing known gap — the pot previously
had NO cross-check, and any missed amount skewed pot odds and MDF for
the rest of the hand with nothing to detect it.
Equity was quoted "vs 8 (9-max)" at a five-handed table because the
baseline came from the tableMax setting; it now uses the seat count
observed that hand. Sub-1% equity printed a flat "0%", which reads as
"cannot win" rather than "under one percent" — it shows "<1%" now.
Deep scan reports both pot figures and flags a mismatch, plus heroXid
and why it failed to resolve.

## 0.17.0

Per-opponent P/L was wrong, not just badly formatted. Each opponent's
share was their contribution divided by the total contributed
INCLUDING hero's own, so the shares never summed to 1 — heads-up,
where both players put in half the pot, a villain was credited with
exactly HALF the money you won from them. It also charged your losses
to opponents who folded early and lost nothing to you, while
crediting nothing extra to whoever actually took the pot. Attribution
now splits by each opponent's NET result: money you win comes from
the players who lost, money you lose goes to the players who won.
Exact heads-up, and sums to your own delta multiway.
Money now goes through one formatter everywhere — "$12.5M", "$41k",
"$9,999" — replacing bare digit strings with no grouping at all,
which is what the P/L readouts in the Stats tab and report printed.
Failure to identify hero is surfaced in Settings and the players
list. With heroXid null, P/L attribution is skipped for EVERY player
and a tendency badge is drawn on your own seat; those look like two
separate bugs and are the same unset/misspelled username.

## 0.16.1

Deep scan reports the script version that produced it, via
HUD_VERSION (which must be bumped alongside @version — the userscript
header is a metadata comment and can't be read from JS).

## 0.16.0

Usernames are actually recorded. Hand history showed "#3722665"
instead of names because nothing ever bound a name to an XID:
getPlayer(xid, name) accepts a name and was never once called with
one, so emptyPlayer() stored its "#<xid>" placeholder as the player's
real name and playerDisplayName returned it forever. The name was
known at the point nameToXidGuess resolved the seat and was simply
discarded. Two sources now feed it: that resolution point, and
harvestSeatNames, which reads the seat's own name element —
SELECTORS.seatName was declared and read by nothing until now, so a
player who never acted was never named either. Records already
holding the placeholder repair themselves on sight, and hand history
re-renders correctly because it stores XIDs, not names.

## 0.15.0

Position is read from HERO'S SEAT, not from the action. It used to
assume "hero must be the next seat to act" whenever hero wasn't yet
in the log's action rotation — true only at hero's own decision
point, but the coach re-renders continuously (actionButtons matches
nothing, so it falls back to "hole cards visible"), so the index grew
with every opponent who acted and the label followed whoever was on
action. Seats are now ordered by their on-screen geometry and rotated
so the small blind is first, with the big blind fixing the direction;
the log rotation is a fallback used only once hero has really acted.
heroIsInPositionVs had the same flaw and silently picked the looser
in-position 3-bet chart; it now uses the seat ring or returns unknown.
Seat badges show a TYPE again — below the hand minimum they show the
provisional archetype with a "?" instead of just "13h", which said
nothing about the player. History cards and the panel now pin their
own colours (!important, no inherited text colour, card LIGHTER than
the panel) because Torn's stylesheet was leaving them unreadable.

## 0.14.0

Hand history in the player panel is rendered as one block per hand
instead of up to 40 hands run together in a single monospace <pre>
on the panel's own background; the tracked player's actions are
coloured rather than marked with an asterisk. Clipboard output is
unchanged (still plain text).
Review fixes: (1) seat counting ignored the "name:" pseudo-ids that
nameToXidGuess falls back to, so ONE unmatched log name inflated the
table size by one and shifted every position label by a seat —
exactly the drift the position notes describe; (2) cross-device hand
merging deduped on timestamp, so two devices at one table recorded
every shared hand twice — it now prefers Torn's game id; (3) a
player record missing a street inside streetActions threw in
computeRates and took the panel down, and records are now repaired at
load rather than only on getPlayer access, since renderBadges and the
players list read STORE.players directly.

## 0.13.0

Preflop charts re-grounded in published sources instead of recall,
and full-ring support added. There are now TWO chart sets, picked
from the seat count observed that hand: at a 9-handed table four
distinct early seats used to share one "EP" label and one 6-max
chart, so true UTG was opening ~17% where published full-ring UTG is
~11%. Positions at 7+ handed tables are named UTG/UTG1/LJ/HJ/CO/BTN.
6-max early position widened to match sources (EP 15.5->17.3%,
MP 19.5->21.0%). Every published range string was re-measured against
its own published percentage before use — several disagree with
themselves, usually by omitting the offsuit block. Sources cited at
RFI_RANGES. "GTO baseline" relabelled "Baseline" with a provenance
footnote: these are reference charts, not solver output, and the old
wording claimed the authority of an equilibrium solution.

## 0.12.0

Preflop coach corrected. Every opening chart but the button was far
too tight (EP 10.3%, MP 14.3%, CO 22.8%, SB 30.9% of hands), so it
advised folding standard opens; they are now 15.5/19.5/26.4/41.8/
42.1%, measured by combo weight and documented per line. The chart is
now picked by SITUATION, not by whether a bet exists: unopened,
limped (isolation, not RFI), facing one open, facing a re-raise, and
hero-already-opened are separate cases. The out-of-position 3-bet
range was defined but never used — every 3-bet call was made off the
in-position chart; unknown relative position now takes the tighter
one. Big blind no longer silently borrows the cutoff opening range.
Facing a 3-bet is called a 4-bet decision instead of a 3-bet. Fixed
the "A5s-A9s" range token, whose backreferences were on the wrong
groups so it expanded to nothing without error.

## 0.11.0

Log ingestion reads whole-list snapshots and diffs them instead of
parsing MutationObserver added-nodes. Torn rewrites the TEXT of
existing <li> rows as the list shifts, so every old line was seen
again on every new line and the 1.5s text dedup couldn't suppress it
— one real hand landed in the history several times and every stat
was inflated with it. Hand records also carry the "Game <hex>" id now
and a repeated id is ignored. Seat badges moved BELOW the seat (they
were covering the player name), restyled to be unobtrusive, and can
be switched off in Settings. The collapsed GTO pill is draggable like
the expanded panel; it previously had no drag handler at all.

## 0.10.0

Hand boundaries now match Torn's real "Game <hex> started" wording;
before this no hand ever ended, so actionOrder accumulated across
hands and every derived position was nonsense. Streets match
"The flop:  5c, 7d, Ad" (definite article, double space), so the
board is read from the log and the street advances. Showdowns say
"reveals". Preflop position is inferred from turn order when hero
hasn't acted yet, rendered as "CO?" to mark it as inferred; table
size comes from the seats so a sit-out no longer shifts every label.
Position-unknown now names the precondition that actually failed
instead of always blaming the username.

## 0.9.0

Selectors calibrated against a live deep scan: log rows are read via
the enclosing <li> (the actor lives in a sibling span, and reading
the mutated inner span alone dropped the name, which is why no stat
ever recorded). Seats identified by id="player-<XID>" rather than
absent profile links. Class matching switched to a single trailing
underscore, since Torn emits both name___hash and name_hash.
Coach panel gained a header to drag it and a Hide toggle; equity is
always quoted against a full ring plus live and heads-up counts.

## 0.8.0

Fix dead stats pipeline, past-tense log parsing, sync crash.

## 0.6.0

Equity engine, position detection, hero identity, session tracking,
bet-sizing tells. (0.7.0 was never released.)

## 0.5.1

Never export or sync the GitHub token.

## 0.5.0

Hand history recording + tracked-players browser.

## 0.4.0

Draggable HUD button, position persisted.

## 0.3.0

Deep-scan DOM inspector + body-fallback log observer.

## 0.2.0

Initial: opponent tendency HUD, coach prompts, per-player P/L,
Gist sync.
