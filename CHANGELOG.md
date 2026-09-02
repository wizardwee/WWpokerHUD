# Changelog

Full history for the Torn Poker HUD. The script carries only the most recent few
entries; the rest lives here, so that reading the source no longer costs sixty
kilobytes of narrative before the first line of code.

Newest first. Bump `@version` **and** `HUD_VERSION` in the same commit as any
behaviour change: nothing automates it, and userscript managers compare
`@version` to decide whether an update exists, so a stale value means a
reinstall won't see new code as newer.

## 1.51.0

Coaching advice: a stale-target bug, a ranking that ignored how far a player
actually deviates, no memory of what it had already said, and one line where
there was room for two.

Reported directly: the advice *"seems pretty stale and [...] repeats advice too
much across player base."*

### The bug first, because it is a bug and not a tuning question

`hand.lastAggressor` is written on every raise and **never cleared when that
player folds**. It carried a `+1000` bonus in `currentExploitTip` and fed
`betFacing` in `buildCoachAdvice`. So after a villain bet the flop and folded to
hero's raise, the coach spent the rest of the hand advising about a player who
was out of the pot — and the pot-odds line went on quoting a bet nobody was
making.

Two helpers replace it:

- `streetLeader(hand)` — the biggest contributor to **this street** among
  players **still in the hand**, and whether that exceeds hero's own street
  contribution.
- `liveAggressor(hand)` — the last raiser, but only while they are still in.
  Once they fold there is no aggressor, and the read is chosen from the
  remaining live players on merit rather than handed to whoever raised last and
  left.

`handContextTokens`' `facing` test is now the same call, so the context token
and the pot-odds figure cannot disagree about whether hero is facing anything.

### Measured, not guessed

Over 400 synthetic players spread around `POOL_AVG` by a full `POOL_SPREAD` — a
*wider* spread than the real pool, so this understates it — two tips led for
**45%** of the field and four for **63%**.

The cause: `gain` is a constant per **rule**. A villain two points past the
fold-to-c-bet threshold and one at 80% scored identically, so whichever rule
carried the higher constant won for everybody.

### The `edge` term

Each rule can now pass a 0..1 `edge` saying how far past its threshold this
firing actually is — `spreadEdge` for the `POOL_AVG`-anchored stats (0 at
`avg ± spread`, 1 at two further spreads, the same "one spread = notable, two =
extreme" scale the deviation indicators already use), `thresholdEdge` for rules
with a bare cutoff. Omitted means neutral (0.5): neither promoted nor punished,
the same defaulting principle as an untagged `when`, which is what made the
annotation incremental instead of all-or-nothing.

Scored at **±20** around neutral. This is a **tiebreaker, not a re-ranking**:
the gain ladder encodes a real judgement (postflop reads beat preflop ones
against this pool), and a span wide enough to overturn it would be replacing
that judgement with an arbitrary one.

Effect, measured both ways:

- cross-player concentration **45% → 41%** — small, and exactly as flagged
  before building;
- but it changes the **lead read for 29%** of players who have more than one,
  which is where a within-player tiebreaker was always going to matter.

### Tip fatigue — the actual fix for repetition

Nothing remembered what it had already told you, so the same sentence rendered
every 1.5 seconds for a whole session. Better ranking does not fix that: the top
read genuinely *is* the top read, you have simply finished reading it.

Counted per `(player, tag)` per **spot** — Torn's game id plus the street —
never per render. At 1.5s a single street would otherwise rack up forty showings
and demote the read out of the very spot it is about, before you had read it
once. Decays after 10 minutes, and restarts from one step rather than resuming.

**The invariant:** `TIP_FATIGUE_MAX` (54) is capped below
`EXPLOIT_RELEVANT_BONUS` (60). Between two equally-strong reads, the one
matching the spot hero is actually in wins however many times it has been seen.
Rotation happens *within* a relevance class; it can never rotate a relevant read
out for an irrelevant one. `test/coach-fatigue.test.js` pins this from both
sides — the cap must stay under the bonus, and stay big enough to reorder within
a tier — so moving either number fails.

### Per player only

Asked and answered before building. A **global** per-tag fatigue would flatten
the cross-player concentration directly, but it does it by suppressing a correct
read on a brand-new villain purely because you saw the same read on somebody
else ten minutes ago. That is accuracy traded for variety. Out.

### Two reads, one loud

The panel carries `COACH_TIPS_SHOWN` (2) reads, deduped on `(player, tag)` so
two phrasings of one read cannot take two lines. The runner-up renders dimmer
and in its **short** form — at full length two reads is a paragraph on a phone,
which is how a panel stops being read at all. The collapsed pill stays at one;
it is the most width-starved element in the HUD.

The runner-up was already being computed and thrown away, so this is the cheaper
half of the repetition fix: it hides the repetition without touching the
ranking.

### A diagnostic, so the next pass is measured

The players list footer now reports how many **distinct lead reads** the coach
produces across your tracked pool, and the top three with their shares. Same
reason `observedPoolAverages()` exists, and the same lesson: `POOL_AVG` sat on
borrowed figures for eleven versions until something in the UI reported what
this HUD had actually seen, and the correction became possible the moment it
did. Tuning the gain ladder without this is guessing.

It ranks the way the live coach ranks (gain plus edge, via a shared
`tipBaseScore`), so it cannot become a report about a formula nobody sees.
Relevance and fatigue are deliberately absent — both need a hand in progress,
and this is a question about the player base, not about a spot.

Memoised behind a 30-second TTL, unlike `observedPoolAverages()`, and the
difference is deliberate: this one runs `buildExploitPlan` **per player** —
`computeRates` and `computeShrunkRates` and the shown-range scan and the
board-texture loop and `tiltRead` — while `renderPlayersList()` re-renders on
every keystroke in the filter box. A TTL rather than a change-keyed cache
because the honest invalidation key does not exist: a player's numbers move
without any count this function could watch.

### Tests

56 assertions in `test/coach-fatigue.test.js`, checked against the old behaviour
first: reverting the aggressor guard or zeroing the fatigue step fails four of
them. `EXPLOIT_RELEVANT_BONUS`, `EXPLOIT_IRRELEVANT_PENALTY` and the fatigue
constants joined the test seam so the invariant is asserted as a relationship
between the real values rather than against copies.

## 1.50.0

Moving tables no longer reports the whole old table as departures.

Reported directly: *"it should NOT mistakenly count players in when I move
tables. currently all the players on the old table are shown as '8 left'."*

### Why the existing guards could not catch it

The departure watch already had two guards, and neither applies:

1. An **empty** sweep is never treated as everyone leaving — but a table change
   produces a perfectly readable sweep, just of different people.
2. A player must be missing from **two consecutive** sweeps — but the old roster
   stays missing on every sweep after the move, so this is satisfied
   immediately.

Both guards pass, and the entire old table fires.

### There is no table identity to key off

Nobody working on this can inspect the live DOM, so a table-id selector cannot
be confirmed, and one that is merely assumed fails silently — the standing
constraint on everything in this file. What *can* be relied on is the shape of
the event: at a live table people leave one at a time, and several vanishing
inside one 3-second sweep is a roster being replaced, not several decisions to
stand up.

### Guard 3 — a burst cap

More than `DEPARTURE_BURST_MAX` (2) players missing between two readable sweeps
is read as a table change. The batch is dropped **and** the pending set is
cleared: a table swap frequently renders in two steps (a couple of seats blank,
then the rest), and stragglers armed by the first step would otherwise fire on
their own two sweeps later — the same bug, arriving late.

The new roster still becomes the baseline. Dropping the batch must not also drop
the sweep, or the next person to leave the *new* table would be missed.

Deliberately asymmetric, the same principle `attackReadiness` follows. Being
wrong here costs one missed alert on a table that genuinely broke up. *Not*
having it costs eight false targets every time you sit down somewhere else,
which is the complaint.

### Guard 4 — a blind change

`noteBlindLevel` already detects a stakes switch (it is what nulls
`currentTableBB` so a $2.5M blind can't misprice a $1M table). It now also
disarms the departure watch, via `noteTableChange()`.

This one is *certain* rather than inferred, but it only fires on a **cross-stake**
move — Torn runs more than one differently-named table at several blind levels —
so it complements guard 3 rather than replacing it.

### Already-watched departures survive both

Somebody who left the old table a minute before you did is still sitting out
there and still attackable; your moving tables does not make them less of a
target. Only the *in-flight suspicion* — players "missing" because you are the
one who left — is dropped.

### Tests

47 assertions in `test/departure-watch.test.js`, up from 33. Checked against the
old behaviour first, which is the part that matters: with the cap lifted the
roster-swap case reports exactly the **8** the report described, and the
half-rendered-swap case reports 6. The new assertions are not vacuous.

The existing multi-player tests had to be restaged through a `leaveOneAtATime`
helper — they dropped three and eighteen players in a single sweep, which guard
3 now (correctly) reads as a table change. Staging them one at a time is how a
table actually empties anyway.

## 1.49.0

The departure pill is movable now.

Asked directly: *"the pill attack/hospital counter should be moveable."*

### It floats over the felt at a fixed anchor

`.tph-depart-pill` sat at `bottom: 96px; right: 12px` with a bare `click`
handler, so whatever it landed on is whatever it covered — permanently. The
coach pill hit exactly this problem and was made draggable in v1.42.0; this one
never was.

### Nothing new was built

`makeDraggable` / `applyStoredPos` / `setFixedPos` already do all of it,
including the `DRAG_THRESHOLD_PX` (6px) that separates a tap from a drag — so a
slightly imprecise tap still opens the panel rather than nudging the pill and
appearing to do nothing.

The click handler was **replaced**, not supplemented. Leaving both wired would
fire the panel open at the end of every drag, which is the exact behaviour that
makes a draggable element feel broken.

### Its own settings key

`departPillPos`, not shared with `coachPillPos`. Both pills can be on screen at
the same time, so a single shared position would stack them on top of each
other — worse than the fixed anchor it replaces.

### touch-action: none

Same requirement as `.tph-coach-pill`, and the thing that makes a draggable
element actually draggable in a touch webview: without it, a drag scrolls the
page underneath instead of moving the element.

### The escape hatch covers both pills

Settings' reset button is relabelled **"Reset panel positions & size"** and now
clears `departPillPos` too, and the rotate handler re-clamps both pills rather
than just the coach's. An escape hatch with a gap in it is not an escape hatch,
and the departure pill is the one carrying a time-limited alert — the worse of
the two to lose off-screen.

### Tests

14 assertions in `test/depart-pill-drag.test.js`. "Draggable" is not one
property, it is four things that all have to hold at once, and the file asserts
each:

- a tap opens the panel and persists nothing;
- a drag persists a `{left, top}` and does **not** open the panel;
- the stored position is re-applied on the next **mount** — the pill is torn
  down whenever the alertable list empties and rebuilt when someone else
  leaves, several times a session, so a position living only on the element is
  lost within minutes of being set;
- the coach pill's key is not read for it.

`classDom()` in `test/harness.js` gained a `classList` backed by `className`,
because `makeDraggable` toggles `.tph-dragging` and would otherwise throw on the
first `pointermove`. Backed by `className` rather than kept beside it, so
`classes()` and the `.foo` selector matching always agree with what `classList`
did.

## 1.48.0

Refactor, no behaviour change: one API probe instead of three copies of the
same one.

Asked directly: *"refactor and compact?"*

### The big one is off the table, and stays off

Splitting into modules needs a bundler, and the install model is "Torn PDA
fetches one file whole" — that's the constraint the single file exists to
satisfy, not neglect. Unchanged from what CLAUDE.md already says.

### What was actually wrong

v1.34.0 built the "explain your own silence" apparatus for target status,
after a live report of exactly that failure (*"I don't see anything"*).
v1.47.0 then copied the whole thing **verbatim** for the spy lookup: ten
parallel module-level `let`s in two identical sets, two identical
diagnostics, two identical fetch bodies. Both of those are mine, one commit
apart — this is cleaning up after myself, not inherited debt.

`apiProbe()` now owns the five counters and the diagnostic state machine;
`probeFetch()` owns the fetch/parse/cache body. The wording is the part that
must never drift between two features: a diagnostic that reads differently
for two lookups failing the same way is worse than no diagnostic, because it
implies a distinction that isn't there.

### It did not compact anything

**+5 net code lines.** Saying otherwise would be false. The parameter surface
of a shared helper costs about what the duplication did; the file grew 48
total lines, and all of it is the comment explaining why the shared thing
exists.

The win is not size. It's that a *third* copy is now cheap, and the two
existing ones can no longer drift apart.

### Where it deliberately stopped

- `requestTargetStatus` / `refreshSeatedTargetStatus` and their spy
  equivalents are four short, obvious functions differing only by gate,
  cache, refresh window and fetcher. Folding them would trade six readable
  lines for a four-parameter factory you have to go read first. The +5 result
  above is the warning that at this granularity the abstraction costs what it
  saves.
- `fetchAffiliation` stays out entirely: no counters, and it writes to
  `STORE.players` rather than a Map. Forcing it through would mean inventing
  state it doesn't have.

### A real hole, found while checking the refactor was covered

Deleting `probe.fetchStarted++` failed **nothing** in the entire suite.

That counter is what separates "the request is hanging" from "no request was
ever made" — the exact distinction that made the v1.38.0 `pdaCall` hang take
a live deep scan to find, and it is now shared by two features, so a break
there costs both.

`test/api-probe.test.js` covers it: 31 assertions driving the real
`probeFetch` against a replaced `fetch` on the sandbox global — the
**dependency**, not a seam stub. That distinction is this repo's most
repeated lesson: reassigning a seam export does not rebind the module's own
function, so a test written that way passes against code it never called.

Verified non-vacuous against two sabotages before committing: removing
`fetchStarted++` fails 3 assertions, removing the clear-on-success fails 2,
both with messages naming what was expected.

## 1.47.0

Estimated battle stats on the departure panel, via TornStats.

Asked directly, right after the chips fix: whether battle stats could be
added the same way.

### The answer first

Torn's own API refuses this outright. `selections=battlestats` only ever
returns the **key owner's own stats**, never a third party's, at any access
level. There is no way to read someone else's strength, defense, speed or
dexterity from Torn directly — that's a platform limit, not a missing
feature this file could add.

### What shipped instead

A **crowdsourced estimate** from TornStats: other players' own in-game "spy"
results on a target, pooled and served back through TornStats' v2 API.

This is **off by default** — unlike departure watch and the affiliation
badges, which default on. It pulls a third party's numbers through a service
this project has no relationship with, and (see below) the integration
itself is unverified. Needs its own TornStats API key, kept entirely
separate from the Torn API key already in Settings, and stripped from
Backup/Gist exports the same way that one is.

### More unverified than anything else in this file

Every other "unconfirmed" API integration here — the faction/marriage
badges, target status — was at least checked against Torn's own published
API documentation before shipping. This one couldn't be: this project's
environment blocks network egress to both `tornstats.com` and `yata.yt`
outright, so `parseSpyStats`' field names
(`spy.strength`/`defense`/`speed`/`dexterity`/`total`/`timestamp`) are
written from memory of TornStats' documented v2 shape, not a fetched doc and
not a live response.

`parseSpyStats` fails defensively to `null` on anything it doesn't
recognise — same discipline as `parseAffiliationProfile` and
`parseTargetStatus` — so a wrong guess costs a missing read, not a crash.
But this needs a report from someone holding a real TornStats key before it
can be trusted even as far as those two integrations currently are. Two
specific defensive choices worth flagging for whoever does that check:

- An **empty-array `spy`** is read as "never spied", not a malformed
  response — several community spy tools use `[]` rather than `{}` for
  "nothing here" wherever a same-shaped object would otherwise appear.
- A **zero `total`** is refused rather than reported. A real spied player's
  battle stats are essentially never all-zero past the first few levels, so
  reading a malformed 0 as a genuine figure would be the exact
  confidently-wrong-is-worse-than-none trap this project keeps naming.

### Cached differently from affiliation, on purpose

`spyCache` is in-memory only — never written to `STORE.players`, never
persisted. That's a deliberate departure from how faction/marriage are
cached: those are facts read from Torn's own API, worth keeping for a day.
This is a third party's *estimate*, and letting a stale one survive a
reload, or ride along inside a Backup/Gist export, risked it being read back
later as more solid than it actually is. A fresh session just re-fetches.

### Rendering

Shows as `≈3.4M BS` beside chips and level on the departure panel row,
through the same `fmtMoney` k/M/B ladder (a new `fmtStatNum` — same tiering,
no `$` prefix, since a battle-stat total isn't currency). The tooltip breaks
down all four stats individually, says how long ago the underlying spy was
actually taken, and states plainly that this is "not Torn's own data" — the
UI has to keep saying that, the same rule CLAUDE.md holds for every other
estimate in this file.

### Diagnostics

Full `spyDiagnostic()` + deep-scan block, same shape as target status:
feature off, no key, key set but nothing fetched yet, and the last error are
all distinguishable messages rather than one undifferentiated silence —
because an integration this unverified has to be able to explain why it's
showing nothing, the same reasoning `targetDiagnostic()` was built on.

37 assertions in `test/spy-stats.test.js`.

## 1.46.0

Departure panel: show the stack ("chips") they left with, not just level.

Reported directly: *"current departure panel pill does not show chips."*

### The data already existed

`trackStacks()` (v0.42.0-era) already freezes `p.stack.now` the instant a
seat stops reporting someone — `readAllStacks()` only sees who is still
seated, so once a player leaves the table their record's stack simply stops
being updated and sits at whatever they last showed. The departure list had
nothing to snapshot itself; it only needed to read what `trackStacks` had
already frozen.

The same "check whether it's already collected" pattern that has paid off
repeatedly in this file — fold-to-c-bet, per-street aggression, postflop
re-raise, board texture were all the same shape: data already landing in the
store, simply never surfaced.

### Read-only, on purpose

The lookup is a plain `STORE.players[xid]`, not `getPlayer(xid, name)`.
`getPlayer` bumps `lastSeen` on every call, and the departure panel calls
`departedList()` on every render tick while it's open. Going through
`getPlayer` would have turned *viewing* the panel into a write — a
long-departed player would keep reading as "recently seen" purely because
someone left the panel open, which is exactly backwards for a feature whose
whole point is tracking who's no longer around.

### Rendering

Shows as `$41.2M chips` beside the existing `lvl 42`, through `fmtMoney`
like every other money figure in this file. No stack ever recorded — the
seat's stack selector never matched this player before they left — renders
nothing rather than `$0 chips`, so an unknown reads as absent, not as
"they had nothing."

9 new assertions in `test/departure-watch.test.js`, including one that pins
the `getPlayer`/`STORE.players[xid]` distinction directly: reading the list
must not move `lastSeen`.

## 1.45.0

Villains' revealed hands going missing from History. One gap closed, and the
diagnostic to find the rest.

Reported: *"I want it to show other villains hands who revealed too."*

**Be clear about the shape of this release.** It fixes one gap I could
positively identify. It does *not* claim to have solved "reveals are missing"
outright, because a rendered hand cannot tell me which reveals were lost or
why — and guessing at that is exactly what this project keeps paying for.

### The gap I could identify: a timing race

Reveals reach `hand.shown` by two independent paths — `harvestShownCards`
polling the seats, and the log's `reveals` line. The seat poll ran once a
second.

A reveal is visible for a short and **uncontrolled** window. Torn deals the
next hand as soon as everyone is ready, and it is the *next* hand's blinds
that settle the previous one. On a fast table the cards could be cleared
between two polls, and the reveal was then gone for good.

The settlement re-read added in v1.36.0 doesn't rescue it either: by the time
settlement fires, the new deal has already wiped the seats.

The poll is now 400ms. That costs a handful of seat queries three times a
second — nothing beside the per-frame layout thrash removed in v1.31.0 — and
it does no work at all once a hand's reveals are already recorded.

### The diagnostic, because a count isn't actionable

The two paths fail *independently*: the seat poll can miss a fast deal, the
log can omit a reveals line entirely. So knowing that a hand banked one
reveal instead of two says nothing about which source to fix.

`hand.shownVia` now records **which path caught each player's reveal** —
`seat` or `log` — is persisted with the hand, and the deep scan prints the
last six recorded hands:

```
reveals banked, last 6 hand(s):
  20:21:14  reached river  reveals=2 via[log,seat]  players=4
  20:19:02  reached river  reveals=1 via[log]       players=5
```

A hand reading `reached river, reveals=1, players=5` quantifies the gap. The
`via` split says where it is.

This is the same diagnostic-first move that found the `pdaCall` hang
(v1.38.0), the PDA envelope (v1.40.0) and the poisoned affiliation cache
(v1.42.0). Each of those times a guess would have been wrong and the
diagnostic was right.

**What would settle the rest:** a scan taken shortly after a multi-way
showdown where you *saw* two or more villains reveal. The block above will
say how many were captured, and by which path.

### On the tests

27 assertions in `test/hand-render.test.js` — `freshHandState` declaring both
maps (so the writers can't create them ad hoc on some paths and not others),
both reveals surviving the round trip into stored history with their paths
intact, both rendering, and a pre-v1.45.0 hand with no `shownVia` still
rendering rather than throwing.

Verified non-vacuous by dropping `shownVia` from `recordHandHistory` — at
which point the check **crashed the file** rather than failing cleanly. That
is worth a line: a crash names a line number and nothing else, where a failed
assertion names what was expected and what arrived. Readable failure output
is most of what a test is for, so the assertion now reads defensively and
reports properly.

### Still open

Carried forward from v1.44.0 unchanged and not re-investigated: the river
"raise" with nothing to raise, and the illegal preflop raise sequence that
hints at missed street headers.

## 1.44.0

Two rendering bugs from one History tab screenshot, both the same class: one
fact written or shown twice, differently.

### Two formats for the same cards, one line apart

The screenshot had this, inside a single hand:

```
showdown: JonnySince shows [7♥, J♦]
showdown: Jaywattsdj shows KH KS
```

`hand.shown` has **two writers**, and they disagreed. `harvestShownCards`
built its own string from parsed cards — `KH KS`. The log's reveal handler
stored the raw log text instead — `[7♥, J♦]`. Neither was wrong on its own;
together they made one hand look like two different programs had written it.

Both now go through `cardsGlyphText`, the same renderer the board already
uses, so the two writers cannot diverge. The raw log text survives only when
the cards fail to parse — there it is the only evidence there is, and a
odd-looking string beats no string.

### A bare "shows" mid-street

`logAction` records `shows` as an action, so the street list rendered
`JonnySince shows` inline — an action with no amount, reading as truncated —
and then the showdown line said the same thing two lines below, that time
with the cards.

Visible twice in the screenshot: once trailing the river line of the big
hand, and once as an entire street in the hand beneath it
(`RIVER   HaVoC_HeLL shows`).

A reveal is not a betting action. It is now filtered out of the street list,
and a street left with no betting action at all is dropped rather than
rendered empty.

Applied to `formatHand` **and** `formatHandHtml`. The clipboard and the
screen must not describe the same hand differently — which is the entire
reason those two exist as a pair, and exactly where a fix lands in one and
not the other.

Verified against the hand from the screenshot: the river now reads
`Jaywattsdj raise $165.8M, JonnySince call $165.8M` with nothing trailing,
and the two showdowns read `7♥ J♦` and `K♥ K♠` in one style.

### Still open, and not claimed as fixed

The same screenshot shows something I could not root-cause, so it is recorded
rather than guessed at.

The river reads `Jaywattsdj raise $165.8M` — but the turn was check/check, so
nobody had bet. **A raise with nothing to raise.** Two candidate
explanations, and a rendered hand cannot tell them apart: either an opening
river *bet* by the other player was missed (the same missed-log-line family
as the lost flop in v1.36.0), or Torn words some opening bets as "raised".

The hand below it shows a related oddity — `HaVoC_HeLL raise $56.5M` recorded
*after* `Wilkee_ raise $67.4M` on the same preflop line, which is not a legal
raise sequence. That hints the flop and turn street headers were missed and
their actions filed under preflop, which would be the same cause again.

What would settle it: the raw log wording of a river where this happens. The
deep scan's `raised` probe prints it verbatim.

16 assertions in `test/hand-render.test.js`, every one checking both
renderers. Both fixes proven non-vacuous by reverting each and watching the
right assertions fail.

## 1.43.0

Departure watch: the seat vanishes, the target doesn't.

Asked for directly: *"If I see a player who is not in hospital, suddenly
leave table, this is a trigger for me to attack. How can we make this here
since when the player leaves his info is gone and I can't click into him to
attack."*

That last clause is the whole problem. The seat is the only handle on a
player, and it disappears at exactly the moment they become worth attacking.

Everything needed to keep that handle was already here: the seat sweep knows
who *was* seated, `targetCache` knows whether they were attackable,
`STORE.players` knows their name, and `attackUrl` needs nothing but an xid.
So the work is noticing the disappearance and holding on to what was already
in hand.

### The guards are the feature

Departures are a diff of successive seat sweeps, which means every false
positive comes from a sweep reading empty or short for a moment. A HUD that
announces *"eight players left, go attack them"* because a re-render blinked
is worse than one that says nothing at all.

**An empty sweep is never "everyone left."** The table re-renders, the SPA
swaps nodes, the page backgrounds — all of which briefly match no seats. And
it must not become the baseline either, or the next sweep would diff against
nothing and lose the real departures.

**A player must be missing from two consecutive sweeps.** One frame of
absence is a re-render; two, three seconds apart, is somebody who left.

All three variants were proven by deleting them and watching the right
assertions fail.

**And the same asymmetry `attackReadiness` enforces:** only someone
*positively known* attackable when they left raises the alarm. Anyone in
hospital, or never checked, is still listed — you may want to see them — but
does not buzz, flash, or count toward the pill. Unknown is never "go".

### What you get

A `🎯 N left` pill bottom-right, tapping into a panel with each player's
name, level, live status, an attack link, and per-row dismiss. An amber
screen-edge flash, and opt-in buzz and chime.

The chime **falls** where the turn chime rises, so it can't be mistaken for
"it's your turn" while you're mid-decision. The flash is `pointer-events:
none` like every overlay here — an absolute rule, and this one can fire
mid-hand.

It alerts **once** per departure, latched, never per tick. A cue repeating
every three seconds until dismissed is precisely what the
never-come-between-you-and-the-table rule exists to prevent.

Status keeps refreshing for the five minutes someone is watched, so a player
hospitalised *after* leaving stops reading as a target — the difference
between a live list and a stale one. Runtime only, deliberately: a stale
target list surviving a page reload would invite acting on cold information.

### Two things I got wrong, and they're the same lesson twice

**The test was vacuous.** It stubbed the seam export (`T.seatedXids = ...`)
to fake the sweep — which does not rebind the module's own function. That is
exactly the trap already recorded in CLAUDE.md, the reason `STORE` and
`heroXid` are exposed as get/set accessors rather than plain references. With
an inert DOM returning no seats, every assertion sailed through the
empty-sweep guard and tested nothing. Green, and worthless. Fifth instance in
this project of a test agreeing with itself.

**And the vacuous test was hiding a real bug.** The second-miss guard counted
by iterating `prev` — but a player missing from sweep N is also absent from
sweep N+1's `prev`, which *is* sweep N. The second miss could never be
reached. **The feature would never have fired once in production.** Fixed by
counting over the pending set instead.

The fix for both is the same, and it is the pattern this repo already uses
for `shouldEscalateTurnCue`: `noteSeatDepartures` now *takes* the seated list
rather than reading it, so the diff — which is all the logic — is drivable
with no DOM. Worth stating plainly that pulling the pure decision out was not
a tidiness choice. It is what made the bug findable at all.

### Settings

`departureWatch` (on by default, a no-op without an API key), plus separate
`departureCue`, `departureVibrate` and `departureSound` so the alert can be
softened without losing the list. Switching the watch off takes the pill and
panel down immediately rather than at the next tick.

30 assertions in `test/departure-watch.test.js`, covering both guards, the
re-render cancel, hero never counting as a target, the first sweep having no
baseline, alertable-versus-merely-listed, the live demotion, wall-clock
expiry (correct after the phone sleeps), dismissal idempotence, the cap, and
dismiss-all.

## 1.42.0

The field names were right. The bug was a day-long cache holding data from
when the transport was broken.

### The diagnostic did its job

v1.41.0 added the nested key names rather than guessing again. One scan
later:

```
affiliation sub-keys: faction{position,faction_id,days_in_faction,
  faction_name,faction_tag,faction_tag_image}
  married{spouse_id,spouse_name,duration}

affiliation cache (5):
  3157771 -> factionId=ABSENT factionName=ABSENT spouseXid=ABSENT
  ... all five the same
```

`faction_id`, `faction_name`, `spouse_id` — all present, exactly as
`parseAffiliationProfile` expects. **The v1.8.0 guesses were correct all
along.** And the cache line only prints when `affilFetchedAt` *is* set
(otherwise it reads "never fetched"), so the fetch completed and stored
nothing.

### The same dangerous default, one function over

`parseAffiliationProfile` read `json.faction || {}` and manufactured
`{factionId: 0, factionName: '', spouseXid: 0}` out of a response it had
never understood.

This is the identical shape v1.40.0 fixed in `parseTargetStatus` — and it
survived that release because only the one function got looked at. During
the broken-envelope era it ran on *every* call, and since a non-null return
makes `fetchAffiliation` stamp `affilFetchedAt`, the fabricated "no faction,
no spouse" was cached for `AFFIL_REFRESH_MS`: **a full 24 hours.**

The badges weren't dead because the field names were wrong. They were dead
because a day-long cache was holding invented data.

Two fixes, both needed:

**The parse refuses** a response carrying none of `faction` / `married` /
`player_id`. The discriminator is worth stating: Torn returns `faction`
*with* `faction_id: 0` for a genuinely factionless player, so the key is
present either way — which is exactly what separates "read a profile, they
have no faction" from "never read a profile". A factionless real profile
still parses.

**`repairAffiliationCache()` clears every `affilFetchedAt` stamp once**, at
init. Fixing the parse alone was not enough: without this the badges stay
dead for up to a day after the fix lands, which would read as the fix having
failed. It clears the timestamp only, never the records — a cache repair,
not a data purge. Runs from `init()` rather than `migrateStore` per the
documented temporal-dead-zone hazard, and is made safe by a store flag
rather than by being idempotent, the same way `backfillBoardTexture` is.

### Four times now

`test/affiliation.test.js` asserted *"missing faction/married keys entirely
still parses (fields just read 0/empty)"*. Written from the implementation
instead of the requirement, so it agreed with the bug and kept the suite
green.

That is the fourth instance in this project, and all four are the same
mistake in the same hands:

| | |
|---|---|
| v1.0.1 | a test re-implemented the regex and asserted against its own copy |
| v1.35.0 | asserted the 4th raise was a "4B" — it's a 5-bet |
| v1.40.0 | asserted `"defaults to Okay/0"` |
| v1.42.0 | asserted `"fields just read 0/empty"` |

Worth naming plainly rather than filing as repo folklore: writing the test
after the code, from the code, produces a test that can only ever agree with
it. The tell is a test name that *describes an implementation detail* —
"defaults to", "still parses", "fields just read" — instead of stating a
requirement. All four read that way.

Replaced with assertions that the parse **refuses**, including the real PDA
envelope shape, plus two proving a genuine factionless profile still parses.

### A flaky test of my own

`test/equity-slicing.test.js` ran its directional assertion — *more
opponents is worse for a drawing hand* — at `EQUITY_ITERS_MIN`, 100 samples.
Two independent runs at that size carry roughly ±5pp each, enough to invert
the comparison occasionally. It failed once during this session.

Raised to 3000 for that block, matching the precedent already in
`test/equity-ranges.test.js`, where directional checks run well above the
production default. A test that fails one run in twenty teaches nothing
except to ignore it. The starvation assertions in the same block are
untouched — they only need both quotes to resolve.

### Also confirmed

**Two** hospitalised opponents detected at once, with different countdowns
(18m and 44m) and matching descriptions — a stronger version of the
varied-data proof than last release. `pot: dom=$8.5M log=$8.5M` agrees for
the second scan running. `communityCards` matched 3 with a flop on the
board, the v1.40.0 correction still holding. `heroGhost: none`,
`watcher steps failing: none`, three reveal rows all parsed.

And `srOnly` confirmed a fourth time (`"Wilkee checked"`), still unexploited
for the reason already recorded.

## 1.41.0

A clean scan. This is a confirmation release, not a fix.

### What the fourth scan proves

The Torn API returns **real data**, for the first time since v1.8.0:

```
last response top-level keys: rank,level,honor,gender,property,signup,awards,
  friends,enemies,forum_posts,karma,age,role,donator,player_id,name,
  property_id,revivable,profile_image,life,status,job,faction,married,
  basicicons,states,last_action,competition
```

That is Torn's actual profile shape, and **`level` is at top level** — so
`json.level` was right all along. It only ever read 0 because the envelope
was being parsed instead of the body.

The proof it has stopped fabricating is not that it succeeds, it's that the
answers now **vary**:

```
2495718 -> state="Hospital" level=43 BLOCKED(in hospital, 23m)
                                     desc="In hospital for 22 mins"
2299671 -> state="Okay" level=85 ATTACKABLE
2277713 -> state="Okay" level=79 ATTACKABLE
3651864 -> state="Okay" level=45 ATTACKABLE
3157771 -> state="Okay" level=89 ATTACKABLE
```

A genuinely hospitalised opponent, detected and counting down, beside four
players who really are fine — against v1.39.0's uniform wall of five
invented "Okay"s. 10 lookups started, 10 succeeded.

### The pot mismatch, diagnosed by its absence

```
pot: dom=$1.8M log=$1.8M
```

No mismatch. Nothing was changed to achieve that, and it is worth recording
precisely because of it: v1.39.0 reasoned the gap was the blinds, whose log
lines were on screen at load and so never counted. This scan was taken on a
hand watched from the start — and the two figures agree exactly.

That turns a hypothesis into a confirmed diagnosis, and reclassifies the
mismatch from a persistent defect into a known joined-mid-hand condition.

Also holding: `heroGhost: none`, `watcher steps failing: none`, and the
table named correctly. And `communityCards: 0` again — which this time is
**correct**, because the scan was taken preflop with no board on the table.
Exactly the reading v1.40.0 corrected, behaving as corrected.

### The one change: the last unverified feature

The 🔗 faction and 💍 marriage badges from v1.8.0 are now the only thing left
that has never been confirmed — and they were broken by the same envelope
bug for their entire existence, so their field names have never once been
checked against a real reply.

The scan proves `faction` and `married` exist at top level. It says nothing
about what is *inside* them, which is what `parseAffiliationProfile` actually
reads (`faction.faction_id`, `faction.faction_name`, `married.spouse_id`).

So the deep scan now records the **nested** key names under both, taken from
the response `fetchTargetStatus` already retrieves, plus an affiliation cache
block showing what was actually stored per seated player — or `ABSENT` /
`never fetched`.

This matters because the badge only lights when two *seated* players match.
With no faction-mate at the table, an absent badge proves nothing at all; the
cache block distinguishes "read correctly, nobody matches" from "never read".
Names only, never values — a scan gets pasted into chats, and that rule
stays absolute.

Same diagnostic-first move that found the hang in v1.38.0 and the envelope in
v1.40.0, pointed at the one thing still unknown.

### Also noted

`SPAN.srOnly___` carrying `"Donut called $500,000"` — actor, verb *and*
amount in a single element, where the visual log splits actor from verb
across two spans. Confirmed a third time now, still not acted on for the
same reason: it needs dedup by (actor, action, street) against the visual
log, and the snapshot scanner doesn't solve that — it dedups a source
against its own history, not two sources against each other.

Findings #3 (an all-in counted as a raise) and #5 (`tableMax` driving only
the equity quote) remain open and untouched.

No new tests. This adds output to `runDeepScan`, which the harness cannot
drive — inert DOM, no network. Said plainly rather than padded with an
assertion that would pass without exercising anything.

## 1.40.0

Every seat was reported "attackable" without a single profile ever being
read. The diagnostic said everything was fine.

### The line that solved it

v1.39.0 added the response's top-level key names to the deep scan rather
than guessing a field name a second time. One scan later:

```
last response top-level keys: status,statusText,responseText,responseHeaders
```

That is not Torn's profile response. **That is Torn PDA's HTTP envelope.**
The HUD had never been reading Torn's reply at all — only the wrapper
around it.

### Bug one: the transport

`normalizePdaResponse` looked for `result.body`, then `result.text`. PDA
returns **`responseText`**. Neither field it checked existed, so it fell
through to its last resort — `JSON.stringify(result)` — and handed the
*entire envelope* downstream as though it were the body. `pdaFetchJson`
dutifully parsed that back, so `json.status` was the HTTP status `200`
rather than Torn's status object.

`responseText` is now read first. And **the `JSON.stringify` fallback is
gone**: returning something response-shaped when the body cannot be located
is exactly how a transport failure becomes confident wrong data three layers
up. An unlocatable body now comes back empty, the JSON parse fails, and the
caller treats it as unknown — which is true.

### Bug two: mine, and the one that actually did the damage

`parseTargetStatus` **defaulted `state` to `'Okay'`**.

With `json.status` being an HTTP number, `.state` was undefined on every
single response — and that default manufactured a green light out of
nothing. Five seats, all reading `state="Okay"` and `ATTACKABLE`, none of
them ever checked.

It fails in the dangerous direction, which is the whole point of the
asymmetry v1.33.0 introduced: *unknown is never "go"*. But that rule was
written for an **unrecognised** state and never covered a **missing** one.
Absence of a state is the least evidence there is, so it has to produce the
least conclusive answer, not the most reassuring one.

The parse now refuses outright when `status.state` isn't a non-empty string
— the same path a bad key takes: not cached, surfaced in the diagnostic,
read as unknown.

### How badly this presented

Worth stating plainly, because it is the real lesson:

```
apiKey set: true   started: 5   successful lookups: 5   last fetch: 17s ago
diagnostic: OK — working
watcher steps failing: none
```

Every health signal green. Full cache. No errors anywhere. And every answer
fabricated. **A feature that reports success is not the same as a feature
that is correct** — and this is the second time in three releases that the
Torn API looked fine and wasn't. The first time it was hanging silently; this
time it was answering confidently with nothing behind it.

### The test agreed with the bug

`test/target-status.test.js` asserted *"missing status/level keys still parse
(defaults to Okay/0)"*. Written to match the implementation instead of the
requirement, so it agreed with the bug and kept the suite green. Had it been
written from the requirement, it would have caught this before it ever
shipped.

Same trap as the 4B/5B off-by-one in v1.35.0, and the third instance of the
pattern CLAUDE.md already records from v1.0.1. Replaced with assertions that
the parse **refuses**: no status, a status with no state, a non-string state,
an empty state, and the real PDA envelope shape — plus one that a minimal
valid profile still parses, so the tightened guard can't reject real replies.

### Also confirmed, and one claim corrected

`heroGhost: none` — v1.39.0's cleanup worked.

And `communityCards` matched **4**, where every previous scan showed 0 and
the code said so in a comment: *"matched ZERO on a live scan"*. That
conclusion was wrong. The earlier scans were all taken preflop or between
hands, where there is no board to match — "0 matches" was read as "the
selector is broken" when it meant "there were no cards". Corrected in both
places it was written down. Worth remembering when reading any count in a
scan: a selector matching nothing may simply have nothing to find. The
structural fallback stays regardless, since it depends on no hashed name and
so can't break on a Torn redeploy.

### Still open

The pot mismatch, now `dom=$10.5M log=$5M`. Unchanged, and the cause is
already recorded in v1.39.0 — the blind lines were on screen at load and so
were never counted. Not touched here.

Verified non-vacuous by restoring **both** original bugs and confirming eight
assertions fail; the failure output reproduces the live symptom exactly —
`state: Okay`, `level: 0`, from an envelope that was never opened.

## 1.39.0

A second scan, and this time it confirms rather than condemns.

### What v1.38.0 fixed, verified

Three things shipped blind last release are now observed working on the
device:

```
apiKey set: true   started: 8   successful lookups: 4   last fetch: 13s ago
diagnostic: OK — working
watcher steps failing: none
table: Old Folks Home · $500k BB · Mid
```

**The Torn API is alive for the first time since v1.8.0** — four opponents
fetched and cached, where the previous scan read "successful lookups: 0 ·
last fetch: never". The `pdaCall` dual-shape fix landed. The watcher steps
are isolated and none are failing. And the blind level reads as a named
table where the last scan said "blind level not read yet".

### The hero ghost, dropped

The scan proves v1.38.0 closed the leak rather than merely narrowing it: the
ghost is **frozen at 7 hands**, identical to the previous scan, while hero's
real record moved 8911 → 8924. It is not growing. Thirteen new hands, zero
new ghost hands.

What remains is orphaned residue that still skews `observedPoolAverages` and
occupies a prune slot, so `dropStaleHeroGhost()` removes it.

**Dropped, never merged.** Hands and `dealtInXids` were always counted
through the seat path, so folding the ghost into the real record would
double-count them — the same reason `mergePseudoPlayer` bails when the real
record already exists. Its log-derived stats are already orphaned from the
hands they describe.

Two guards, both proven by deleting them and watching the tests fail:

- It refuses when there is **no real record**, so it can never delete hero's
  only copy of their own data.
- It treats a **pseudo-id `heroXid` as unresolved** — the v0.20.0 lesson.
  `name:Wonkawee` is truthy but is not "bound to a seat", and deleting then
  would remove the very record hero is currently being tracked under.

Only ever hero's own ghost. Another player's `name:` record is a genuine
tracked opponent this HUD has simply never matched to a seat, and survives.

### `level` is not where the parser looks

All four cached entries read `level=0` while `status.state` parsed correctly
as `"Okay"`. So the response *is* the profile shape, and `json.level` is
simply the wrong path.

Guessing a second field name blind is exactly what produced the first wrong
guess. Instead the deep scan now records the **top-level key names** of the
last successful response — names only, never values, since scans get pasted
into chats. The next scan will say where `level` actually lives.

Meanwhile the UI stops asserting a level it doesn't have: the panel omits it
when absent, and the scan prints `level=ABSENT` rather than `level=0`. Zero
is not a level, it is the absence of one.

### The pot mismatch, root-caused but NOT fixed

Both scans flagged it: `dom=$3M log=$2.3M`, then `dom=$4.5M log=$3.8M`. The
gap is ~$0.7M **both times**, and this table's blinds are $250k + $500k =
$750k.

The blind lines were marked `old___` in both scans — already on screen when
the snapshot primed, therefore deliberately never parsed as events, therefore
their contributions never reached the log-summed pot. That is the *same*
missed-old-lines root cause as the lost flop (v1.36.0) and the unread blind
level (v1.38.0), surfacing a third time in a third place.

v1.38.0's `seedBlindFromVisibleLog` seeds the *level* only, not the
contributions. **This is not fixed here** — synthesising contributions for
lines the HUD deliberately does not replay needs more care than a same-day
patch, and getting it wrong would inflate every pot rather than one. Recorded
properly so the next attempt starts from the answer instead of the symptom.
Residue of closed finding #1.

### Also confirmed, still unexploited

The scan re-confirms the `srOnly` find: `SPAN.srOnly___DZLhV` carrying
`"JonnySince folded"` — the **actor's name and the verb in one element**,
where the visual log splits them across two spans. Confirmed twice on this
layout now. Still not acted on, for the reason already recorded: it needs
dedup by (actor, action, street) against the visual log, and the snapshot
scanner does not solve that — it dedups a source against its own history,
not two sources against each other.

17 assertions in `test/hero-ghost-cleanup.test.js`, verified non-vacuous by
removing both guards and confirming four fail.

## 1.38.0

**The Torn API had never worked. Not once, since v1.8.0.**

Found by reading a live deep scan pasted back from the phone — the exact
thing the scan exists for, and the first time it has caught something this
large.

### A promise that never settled

`pdaCall` wrapped `PDA_httpGet` in a Promise that resolved **only** from a
callback passed as the last argument. Newer Torn PDA returns a *Promise*
from `PDA_httpGet` rather than taking a callback. So the callback was never
invoked, the real result was discarded, and every request hung forever.

No throw. No rejection. Nothing logged. Nothing on screen.

Every feature depending on it was dead the entire time: the 🔗 faction and
💍 marriage badges from v1.8.0, hospital/jail/travel status, attack
readiness. Fifteen versions of features that had literally never run once,
each shipped with the honest caveat that its field names were unconfirmed —
while the actual problem was one layer below, in the transport.

The comment above `pdaFetch` had already named the risk: the signature
"isn't fully documented publicly", and this adapter is "the single place to
patch if the real call shape differs". It was exactly that.

### How the scan caught it

Three facts printed together, and a fourth by omission:

```
apiKey set: true   successful lookups: 0   last fetch: never
diagnostic: No lookup has run yet
```

`targetLastFetchAt` is set only *after* the await, and the "no lookup yet"
branch requires `targetLastError` to be empty. A promise that never settles
is the **only** state that produces all four at once — a wrong key, a rate
limit, a network failure or an uncalled function each produce a different
combination.

That diagnostic block only existed because v1.34.0 added it after a report
of "I don't see anything". Without it this scan would have shown a blank
section and nothing to reason from.

`pdaCall` now handles **both** host shapes: it passes the callback *and*
adopts the returned thenable if there is one, with a `settled` guard so the
first outcome wins. Plus a 15-second timeout — that is half the fix, because
a hang must never again be indistinguishable from a request that was never
made. The scan now also prints `started: N` alongside the success count,
counted *before* the await: the gap between the two is the diagnosis.

### One throw was killing five other jobs

The 3-second watcher ran six jobs bare, one after another. A throw in any of
them killed every job after it — on that tick, and on every tick after,
silently and forever.

Six independent jobs sharing one uncaught exception is a failure mode where
the symptom appears nowhere near the cause: stacks quietly stop updating
because seat-name harvesting threw. Each step is now isolated, records its
failure by name, and the deep scan prints `watcher steps failing:`.

### The blind that was sitting right there

The scan read `table: blind level not read yet` while
`posted big blind $500,000` sat in the log two sections above it — marked
`old___`, so already on screen when the snapshot primed, and therefore
deliberately never parsed. ($500,000 *is* in the ladder: Old Folks Home.)

Not parsing those lines as events is correct and stays. But a **blind level
is a fact about the table, not an event** — reading one replays nothing and
inflates no stat. `seedBlindFromVisibleLog` now takes it at prime time. It
only ever *seeds*, returning immediately once a blind is known, so it can
never override a live reading or interfere with the table-switch detection
in `noteBlindLevel`.

This one mattered quietly: `bbAmount` prices P/L in big blinds, decides
whether a hand is notable, feeds the `bb` v1.35.0 started storing, and
drives the effective-stack warnings.

### The hero ghost, again

`heroGhost(name:Wonkawee) EXISTS — 7 hands` against a real record of 8911.

v1.6.0's fix holds — `nameToXidGuess` returns `heroXid` once resolved — but
only once it *is* resolved, and the retry ran on the 3-second watcher while
the log scan runs every second. Lines parsed in that opening window still
fell through to the pseudo-id, re-accruing a little every session.
`scanLogRows` now binds hero before parsing anything.

### Fifteen versions of "unconfirmed", settled

The scan confirms every v0.22.0 marker at once, and `CLAUDE.md`'s block for
them is rewritten from "none of these are confirmed" to a table of evidence:
hero's seat (`self___`), action buttons matched by label (3 of them), the
dealer button (`dealer___` + `position-6___`, with `dealerXid` resolving),
sitting-out (`state___`), stacks, and the PDA bridge.

**And it disproves something that file asserted.** The note claiming the
live layout showed `playerPositioner___` with *no index*, so `getDealerXid`
had to return null, was wrong: the scan shows `playerPositioner-4`, `-6`,
`-1` and `position-6___`, and the dealer resolves. HopesG's reading was
right all along. The geometric ring stays primary — it needs no marker and
is proven — but the indexed path is a real corroborating source rather than
a dead one.

### Still open

`pot: dom=$3M log=$2.3M` is flagged by the scan and is known residue of
closed finding #1 (`hand.pot` is log-summed, not the DOM figure). Not
investigated this pass, and not claimed as fixed.

12 assertions in `test/pda-call.test.js` — both host shapes, string results,
synchronous throws, rejected promises, first-outcome-wins, and the timeout
being armed. Verified non-vacuous by restoring the original callback-only
`pdaCall` and confirming the suite fails loudly.

## 1.37.0

Calibration mode's live counts were frozen. Open finding #4, closed.

Asked: *"Should we do a calibration mode too?"* — it already exists, under
Settings → Calibration mode: live selector match counts, the log observer's
state, and the **Run deep scan** / **Copy report** buttons that produce the
report this project has used to confirm every DOM selector it has.

But the question surfaced that it shipped with a bug anyone turning it on
would hit immediately.

### The bug

`init()` had:

```js
if (STORE.settings.calibrationMode) setInterval(renderCalibrationPanel, 3000);
```

The 3-second refresh was only armed if the setting was **already on when the
page loaded**. Toggling calibration on mid-session — which is how anyone
actually turns it on — rendered the panel exactly once and then never
refreshed it.

So the live selector match counts, which are the entire point of the panel,
sat frozen at whatever they happened to be the moment it opened. That is
worse than the panel simply not updating: **a frozen count looks exactly
like a selector that has stopped matching**, which is the precise failure
the panel exists to diagnose. It could report a problem that wasn't there,
or hide one that was.

The interval is now always armed. `renderCalibrationPanel` returns
immediately when the setting is off, so the cost of that is one property
read every three seconds — the same "production cost is one falsy property
read" trade the `__TPH_TEST` seam already makes.

### Teardown moved with it

Removing the panel now lives in `renderCalibrationPanel`'s off-branch rather
than only in the Settings toggle, so switching calibration off by *any*
route takes the panel down: the toggle, the panel's own ✕, or an imported
store carrying `calibrationMode: false`. The toggle and the ✕ still remove
it immediately as well — waiting up to three seconds for a tap to visibly do
something is its own bug.

### Bookkeeping

Finding 4 is removed from the `KNOWN GAPS` block in the script header and
from the open-findings list in `CLAUDE.md`, with both closing lines updated
to cite v1.37.0 alongside the existing closures of 1 and 2. The numbering is
deliberately **not** renumbered — 3 and 5 keep their numbers, because the
header and several code comments cite them by number, a convention both
files already state.

No new tests. This is a wiring fix to an `init()` interval and a DOM
teardown branch, and the harness can drive neither: `setInterval` is a no-op
in the sandbox and the default DOM is inert. Said plainly rather than
padded with an assertion that would pass without exercising anything.

## 1.36.0

Two hands that couldn't have happened, and both had the same cause.

Reported with a screenshot: *"Default view should be notable hands. Also how
can board reached river but not show all 5 community cards, and not show
player reveal cards."*

### The board that lost its flop

A stored hand read **"reached river · board: 5♦ 9♠"**. Two cards on a river
board.

The log's board line for a street can be missed — and the flop is the one
that gets missed. Lines already on screen when the log snapshot primes are
deliberately *not* parsed: `scanLogRows` treats them as a partial hand that
is already over, which is correct and is what stops old lines being replayed
as new events. But a hand in progress at that moment loses its flop line.
The turn and river then append to an empty board — 0 + 1 + 1 = 2 — while the
street still reads "river", because the street is set by the same lines that
*did* parse.

Nothing errors. The hand simply records a board it only partly saw.

Worth noting the other hand in the same screenshot — "reached turn", four
cards — was correct all along: three flop cards plus the turn. It must not
be flagged, and isn't.

Two fixes, because one alone isn't enough:

**Repair it live.** `repairBoardFromDom()` reads the board off the table.
`readBoardCards` already existed and was already trusted for the coach's
live equity, so this needed no new DOM guesswork. It only ever *adds*, and
is capped to what the street allows so the board and the street can never
disagree. It runs on the 1s poll as well as at settlement, and running it
live is the part that matters: board-texture stats are filed per action
*during* the hand, so a missing flop was quietly filing every one of them
against the wrong board.

**Say so when it's too late to repair.** A hand already recorded short can't
be fixed retroactively, so `boardIsPartial()` marks it — the tab, the
clipboard and the export now read "partial — 2 of 5 seen" instead of
printing two cards as though they were the whole board.

**Unknown is not incomplete.** Hands recorded before v1.17.0 have no board
at all, and are deliberately *not* flagged. Otherwise hundreds of old
records would carry a warning about a field that didn't exist when they were
written.

`dedupeCards()` is load-bearing rather than tidiness: a DOM repair fills a
street in, and the log line for that same street can still arrive afterwards
and append. Without it the board would list a card twice.

### The reveals that were never captured

The same shape of bug, one function over.

`harvestShownCards` bails on `if (!currentHand) return;` and runs on a 1s
poll. But reveals land immediately *before* the "wins" line that settles the
hand. A reveal-then-settle inside a single poll gap was therefore never
captured: by the time the next tick came round `currentHand` was null and
the poll bailed — even though the cards sit on the table for several seconds
afterwards.

`applyHandResultsAndReset` now takes one last look before banking the hand.
That is the only moment when the cards are up *and* the hand is still live.

### Notable by default

The History tab now opens on **Notable** rather than Played. Asked for
directly. It's safe as a default because the empty state names the way out
when a player has no notable hands yet.

### And a stale sentence

The target-status line still read "is only read while they sit out" —
untrue since v1.34.0 widened the fetch to every seated opponent. Rewritten,
and it now distinguishes "no key" from "not checked yet".

Opening a player panel also fetches their status now, via a new
`requestTargetStatus`. The background sweep only covers players *currently
seated*, so a panel opened on someone who had left the table read "not
checked" forever. The staleness gate moved inside that function so the
seated sweep and the panel share one definition of fresh enough.

23 assertions in `test/board-repair.test.js`, including the exact hand from
the screenshot, the turn hand that was always correct, and the
unknown-is-not-incomplete case — verified non-vacuous by reintroducing the
bug and watching it fail.

## 1.35.0

The History tab stops burying the interesting hands under the folds.

Asked for directly: *"I don't want it to show all hands because that
includes hands they fold too without any calling or raising ... I want it
to highlight hands that are interesting or out of blue, like big pots, or
highlight interesting 3bets or reraise."*

### Two different questions about the same hand

`isNotableHand` already existed — but it asks about the **table**: was this
pot big, for deciding what survives the storage cap. The History tab needs
the other question entirely: did **this player** do anything here, and was
any of it interesting?

A 60bb pot that two other players fought over is notable for the table and
completely worthless as a read on the seat you are looking at. Conflating
the two would put every big hand in every player's list. So
`handNotability(hand, xid, ctx)` is a separate function with a separate
name, kept distinct the same way `p.texture` (hand strength) and
`p.boardTex` (board texture) are.

### Nothing new is collected

Everything derives from `h.actions`, which already stores `{x, a, amt, s}`
for every action and is persisted in full. So this works **retroactively**
on all 200 stored hands — open a player you have history with and the
markers are already there. That is the fifth time checking before adding
collection has paid off in this file.

The action vocabulary turned out to answer the question exactly:
`post` / `fold` / `check` / `call` / `bet` / `raise`. Voluntary is
`call`/`bet`/`raise` only — a `post` is a blind you had no choice about, a
`check` is declining to invest, a `fold` is leaving. That is precisely the
"folded without any calling or raising" the report named.

### The markers

| tag | meaning |
|---|---|
| **3B / 4B+** | preflop raise tier |
| **XR** | check-raise — checked, then raised the *same* street |
| **RR** | raised postflop (exclusive with XR, never both) |
| **BIG** | big pot |
| **SD** | showed cards at showdown |
| **WON** | won the pot |

Colour-grouped by kind and matched to the badge's role chips, so `3B` is
the same colour wherever you see it. Each carries a title explaining
itself — an unexplained two-letter chip is noise.

Notable is a score of 50+. **WON alone deliberately does not clear it**:
winning an uncontested pot is most hands, not a read. **SD does** — cards
face-up is the only direct evidence of a range this HUD ever gets.

### Big pots, two ways

`recordHandHistory` now stores `bb`. The blind level was already being
computed at record time for `isNotableHand` and then thrown away, which
left the History tab unable to price a pot at all. With it, "big" means
40bb+ and means the same thing regardless of what else is on screen.

Hands recorded before this have `bb: 0` and fall back to 2.5× the median
pot of that player's hands — *relative*, because more than one stake gets
played here and a fixed chip figure would call every hand at the higher
stake big. An unknown blind is never read as small *or* big, and an
implausible one (the BB-display-mode hazard) falls through to the median
path rather than being believed.

The median is computed over **all** the player's hands, not the filtered
set. Otherwise filtering to Notable would recompute the median from
already-big pots and immediately stop calling any of them big.

### The filter

Three chips — **Played** (default), **Notable**, **All** — each with a
title stating what it hides. The count now reads "N of M … K hidden by
filter": it already had one way to mislead (the 40-row display cap) and the
filter is a second. The empty state differs per filter and names the way
out.

`historyFilter` is session state, not a setting. A persisted "Notable"
would silently show an empty tab the next time you opened a player who
happened to have none.

### A bug I wrote, and the test that agreed with it

The Nth raise of a street is an **(N+1)-bet**, because the blind is the
first bet: an open is the 1st raise, a 3-bet the 2nd, a 4-bet the 3rd, a
5-bet the 4th.

The first draft labelled the 4th raise "4B" — and the assertion written
alongside it asserted exactly that. Both agreed, both were wrong, and the
suite was green. It only surfaced from checking the arithmetic against
poker rather than against the code. The label now counts `tier + 1`; the
CSS *class* stays `4B` for anything at or above a 4-bet so the rule set
stays finite. Verified by reintroducing the bug and confirming five
assertions fail.

This is the same shape as the v1.0.1 lesson already in CLAUDE.md — a test
that mirrors the implementation cannot catch the implementation being
wrong.

### Keeping the lint honest

`tph-hh-tag-*` is built as `` `tph-hh-tag-${key}` ``, so `no-orphans`'
literal scan cannot see it and it goes in `DYNAMIC_PREFIXES`. But that
exemption is not left as a hole: a new `HAND_TAG_KEYS` constant declares
every key, and `test/hand-notability.test.js` asserts each one has a CSS
rule *and* that nothing emits an undeclared key. A key with no rule renders
an unstyled grey chip and throws nothing — the same silent-typo failure
CLAUDE.md records for coach relevance tokens. Same split `BOARD_FLAGS`
already uses.

74 assertions in `test/hand-notability.test.js`.

## 1.34.0

The target status now actually appears, and can explain itself when it
doesn't.

Reported from a live install: *"How does the profile clicker work? I don't
see anything or badges on their hospital status."* Both halves of that
turned out to be real problems with v1.30.0–v1.33.0, not a
misunderstanding.

### Why nothing showed

The lookup only ever ran for seats that were **sitting out**.

That came from the original framing — "ready to mug them when they sit out"
— and it was too clever by half. Sitting out is a *rare* state. Most of the
time nobody at the table is, so nothing was ever fetched, the cache stayed
empty, and the feature displayed nothing at all. `renderBadges` then applied
the *same* gate again on the display side, so it was double-gated: even a
cached reading wouldn't render unless that seat happened to be sitting out
at that moment.

It now fetches for **every seated opponent**, and the badge shows a blocker
whenever one is known.

Cost was never a good reason to be narrow here. At a full table that is
eight opponents on a 30-second staleness gate — about 16 calls a minute
against Torn's 100/minute limit, and the 3-second watcher only fires a
request when an entry is actually stale. Knowing which seats are viable
targets *before* one of them stands up is also simply the more useful read.

### Why it couldn't be diagnosed

Worse than the bug: the feature failed **silently in every mode**.

`if (!parsed) return;` swallowed no key, a wrong key, a rate limit, a
network error and an unrecognised response shape — identically. Torn
compounds this by answering auth failures and rate limits with HTTP 200 and
an error *body*, so nothing upstream caught them either. Five distinct
causes, one indistinguishable symptom: nothing on screen.

That is exactly how it came back as a report, and it is not a debuggable
state — nobody working on this can see the screen it runs on, and the field
names are still unverified, so "I see nothing" had five possible meanings
and no way to tell them apart.

`targetDiagnostic()` now names the reason, surfaced in two places:

- **Settings**, under the API key: a green `✓ Torn API working — N lookups`
  or an amber line saying precisely what is wrong.
- **The deep scan**, in a new `--- TORN API / TARGET STATUS ---` block:
  whether a key is set, how many lookups have succeeded, how long ago the
  last one ran, the diagnostic, and the full contents of the target cache
  with each entry's state, level, readiness and Torn's own description.

The scan prints whether a key is set as a **boolean, never the key** — deep
scans get pasted into chats, and the diagnostic string is asserted in the
tests to never contain it either.

This is the same reasoning `heroProblem()` already follows for the same
class of bug: a feature that can fail invisibly must be able to say why it
is quiet.

### Where the profile link actually is

It is in the **player panel**, not on the seat badge. Tap a seat badge, and
the player's name at the top of the panel is the link — with the attack
link, their status and their level on the row beneath it.

There is deliberately no link on the badge itself: a tappable link floating
over the felt is what CLAUDE.md's "never come between the user and the
table" rule exists to prevent, since one tap swallowed on Fold or Call
costs more than the shortcut saves. The Settings help text now says all of
this, having previously described only the old sitting-out-only behaviour
and never mentioned where the link was at all.

### Also

Removed the now-unused `sittingOut` read from `renderBadges` — a
`querySelector` per seat per render, on the exact path v1.31.0 had just
finished optimising for layout thrash.

68 assertions in `test/target-status.test.js`, including the new diagnostic
cases and the assertion that it never leaks the key.

## 1.33.0

The mugging workflow, finished: an attack link, and a straight answer on
whether an attack would even land.

Asked for directly, following v1.30.0: *"How about the other features like
player profile attack hospital."*

### What v1.30.0 got wrong

It read the hospital flag and reported it as a fact — and then stopped. But
being in hospital isn't trivia about an opponent. It is *the reason an
attack won't land*, and it is one of several such reasons, each lasting a
different length of time.

Reading only hospital meant a player in jail, or on a plane, or in federal
jail showed **nothing at all** and looked like a clear target. The one
state the HUD checked was the one it happened to have been asked about, not
the one the decision needed.

### Three answers, not two

`parseTargetStatus` now reads `status.state`, `status.until`, `level`, and
`status.description` — Torn's own human-readable line ("Travelling to
Mexico"), kept verbatim for the tooltip because it is the one field
guaranteed to describe a state this file has never heard of.

`attackReadiness` returns **ready**, **blocked**, or **unknown**:

| state | badge | panel |
|---|---|---|
| Okay | — | 🎯 Attackable |
| Hospital | 🏥 | Can't attack — in hospital, 12m left |
| Jail | 🚔 | Can't attack — in jail, 45m left |
| Traveling / Travelling | ✈️ | Can't attack — travelling |
| Abroad | 🌍 | Can't attack — abroad |
| Federal | 🚫 | Can't attack — in federal jail, 2d 1h left |
| anything else | — | ❔ Can't tell — unrecognised state "…" |

Both spellings of the travel state are listed because which one Torn
returns isn't confirmed and they are one letter apart. Guessing wrong there
fails in the dangerous direction: a real blocker that goes unrecognised.

### Unknown is never "go"

The load-bearing decision. **`Okay` is the only state treated as clear.**
Anything unrecognised reports as unknown — not as attackable.

Torn can add or rename a state whenever it likes, and of the two ways to be
wrong here, *"said go when they were untouchable"* is the one that costs
the user something. This is the same principle that already stops
`parseAffiliationProfile` reading an API error as "no faction": when the
answer isn't known, say so rather than picking the convenient side.

Two related cases: an `until` that has already passed reads as clear again,
rather than reporting a wait that has elapsed (the cache is at most 30s
stale). And a blocker carrying no `until` at all — travel legs may not —
still blocks, because the absence of a countdown is not evidence the state
has ended.

### The attack link, and where it deliberately isn't

The player panel gets a direct link to Torn's own attack loader, beside a
colour-coded status line, their level, and how long ago the check was made.

It is **not on the seat badge**, and that is not an oversight. A tappable
attack link floating over the felt is exactly what CLAUDE.md's "never come
between the user and the table" rule forbids — one tap swallowed on Fold or
Call is worse than any convenience is good. It is also a *link*, never a
click: this HUD is advisory and never acts for the user, which goes double
for anything touching the game's own controls.

The link shows whichever way the status reads. Offering it only when
"ready" would mean trusting a figure that is up to 30 seconds stale,
fetched only during sit-outs, and resting on unconfirmed field names. The
status is a steer; the decision stays the user's.

The badge shows **blockers only**, never a positive "attackable" mark. Most
sitting-out players are attackable, so a 🎯 on nearly every one of them is
noise, and the badge is width-constrained before it is
information-constrained. Absence means "nothing known to be blocking", and
the panel is one tap away to say it properly.

### Removed rather than kept

`isHospitalized` is gone. It was kept as "a named helper because the badge
asks specifically about hospital" — and then the badge moved to
`attackReadiness` and nothing called it. `test/no-orphans.test.js` caught
that, which is precisely what that lint exists for. A hospital-only helper
sitting beside a general one is also a standing invitation to reintroduce
the exact narrowness this release fixes.

`fmtStatusRemaining` (was `fmtHospitalRemaining`) gained a days tier, since
federal jail runs long enough that "73h 12m" is worse to read than "3d 1h".

### Still unconfirmed, and what would confirm it

Every field here is written from Torn's documented API v1 shape, not a live
response — nobody working on this holds a key, the same caveat v1.8.0 and
v1.30.0 shipped with. A wrong guess costs a missing or unknown read, never
a crash.

The fastest live check: set a key, sit at a table, and wait for someone to
sit out while hospitalised. If the badge lights up 🏥 and the panel counts
down, the field names are right. Pasting back one raw
`api.torn.com/user/{id}?selections=profile` response would settle all of
them at once — including whether Torn spells it "Traveling" or
"Travelling".

60 assertions in `test/target-status.test.js` (renamed from
`hospital-status`). The blocker cases are generated from `ATTACK_BLOCKERS`
itself rather than a hand-copied list, so adding a state to the map cannot
leave an untested branch behind it.

## 1.32.0

Equity is cheaper to compute, and the call/fold verdict now admits when it
can't tell.

Asked for directly, following v1.31.0: *"I don't mind non exact equity
counts too, we can approximate."*

### Half the samples, twice the speed

`equityIters` drops from 1200 to 600. Measured, per call:

| | 1200 | 600 |
|---|---|---|
| 2 opponents | 30.7 ms | **14.2 ms** |
| 4 opponents | 46.1 ms | **21.8 ms** |
| 6 opponents | 62.6 ms | **28.6 ms** |
| 8 opponents | 68.3 ms | **34.5 ms** |

Worst-case sampling error goes to about ±2 percentage points, and nearer
±1.5 at the low equities multiway pots actually produce.

That trade is sound for a specific reason worth keeping in mind: **sampling
error is the smaller of the two errors in this figure.** Opponents are drawn
from a flat range *proxy* (`opponentRangeProxy`), a far coarser
approximation than any number of samples could fix. Halving the samples
moves the total error very little. v1.31.0 made the work non-blocking; this
makes the answer arrive twice as fast.

### What halving the samples does NOT excuse

The pot-odds line read `eq >= need ? '✓ +EV call' : '✗ fold'` — a hard
verdict on an **action**, taken from a sampled estimate, with nothing
between the two answers. Facing a bet needing 33% while the simulation says
34%, that tick is decided by sampling noise rather than by the hand: rerun
the same spot and it flips to a cross.

Widening the noise turns that from a rare edge into a routine one. So the
guard ships *with* the cheaper default, not after someone acts on a tick
that was a coin flip.

`potOddsVerdict` now returns `≈ marginal` when the margin falls inside two
standard errors (~95%). At 600 samples, facing a bet needing 33%:

| equity | now | before |
|---|---|---|
| 28% | ✗ fold | ✗ fold |
| 31% | **≈ marginal** | ✗ fold |
| 33% | **≈ marginal** | ✓ +EV call |
| 35% | **≈ marginal** | ✓ +EV call |
| 40% | ✓ +EV call | ✓ +EV call |

It withholds only where the simulation genuinely cannot resolve the spot —
28% still folds and 40% still calls. And "marginal" is a real read a player
can act on: it moves the decision onto position, reads and implied odds,
which is exactly where a close spot belongs. A confident tick the HUD can't
support is the one outcome worse than no verdict at all.

`equityStdErr` is the Bernoulli standard error on the win proportion. Ties
score 0.5, and a 0/0.5/1 draw has strictly lower variance than a 0/1 draw
with the same mean, so the band is very slightly over-stated — the
conservative direction for something whose job is deciding when to keep
quiet.

The band tracks the sample count, so Settings → Equity samples now buys
**resolution** as well as precision: 2pp of margin is unresolvable at 100
samples and decidable at 5000. The help text says so.

### Two small things

`clampEquityIters` falls back to `DEFAULT_SETTINGS.equityIters` rather than
a hardcoded 1200 — the default now lives in exactly one place.

And a test written in v1.31.0 hardcoded `1200` and broke the moment the
default moved. It now reads `DEFAULT_SETTINGS.equityIters`, per the lesson
the `POOL_AVG` correction already recorded: expectations are computed from
the live constant, so changing it needs no test edit.

18 new assertions in `test/equity-slicing.test.js` (60 in the file), covering
the verdict in both directions, the band tracking the sample count, and
`equityStdErr`'s degenerate inputs — a NaN band would make every comparison
false and silently restore the old confident verdict in precisely the
situations the guard exists for, so that case is pinned by name.

## 1.31.0

The table no longer freezes mid-hand. Reported as lag on the phone, with the
reasonable guess that the single 524 KB file had simply grown too big to run
well.

It hadn't. The file is fetched once and parsed once; it costs nothing per
frame, and splitting it would need a bundler, which is the one thing the
"install by URL, fetch one file whole" model can't have. The lag was
something else entirely, and measuring found it immediately.

### What it actually was

`estimateEquity` is, by a wide margin, the most expensive thing this script
does. Measured on a desktop-class CPU at the production default of 1200
iterations:

| | |
|---|---|
| 5 opponents | ~45–50 ms |
| 8 opponents vs `FOUR_BET_RANGE` | **~212 ms** |
| every other pure-logic path in the file, combined | **under 2 ms** |

The coach asks for two quotes per render, and a phone is several times
slower again. All of it ran inline on the main thread, so each recompute
froze the whole table — the badges, the log, the game's own controls.

And it recomputed constantly. The live opponent count is part of the cache
key, so **every fold misses the cache**, as does every street and every
raise: on the order of eight to ten freezes per hand.

That is also why "the script is too big" was such a reasonable guess. The
symptom is indistinguishable from a heavy page — it just stutters — and
nothing about it points at one function.

### Sliced, not shrunk

The Monte Carlo is now split into `equityJobInit` / `equityJobStep` /
`equityJobValue`, and runs about 6 ms at a time across animation frames.
Measured on the worst case above: the longest uninterrupted block goes from
**212 ms to 6.6 ms, a 32× cut**, spread over 26 frames, with all 1200
iterations still run. The arithmetic is untouched — the figure simply lands
a beat later instead of freezing the table to arrive on time.

There is deliberately **one** implementation of the loop. `estimateEquity`
is now built on the same three functions, so the blocking path every
existing test drives (and the hand replayer, where blocking briefly is
correct) cannot drift from the sliced one. A second copy driven by the UI
but not the tests is precisely the trap v1.0.1 already paid for: a test of
a copy cannot fail when the original is wrong.

`st.i` is the single progress marker, both read and advanced by the loop.
An off-by-one there would change the sample count the result is divided by
— which surfaces as a slightly wrong percentage, not an error. That is what
`test/equity-slicing.test.js` exists to pin.

### The starvation bug, caught before it shipped

The first version of the scheduler had one job slot and cancelled it
whenever a new key was requested. The coach asks for two quotes per render,
so quote A started, quote B cancelled it, the next render restarted A, B
cancelled it again — and **neither ever finished**. It would have presented
as the equity line simply never appearing.

Requests are queued instead, capped at three with the oldest dropped first
(the most likely stale after a fold or a new street). The regression is
pinned by name in the test file.

### Two smaller things the measuring turned up

**`renderBadges` was thrashing layout.** It called
`seat.getBoundingClientRect()` and `document.body.appendChild()` inside the
same loop — a layout read immediately after the write that dirties layout,
which forces a synchronous reflow every iteration. Nine seats meant nine
forced reflows per render, and since badges re-render on scroll through
`requestAnimationFrame`, nine per *frame* while the table moved. It is now
two passes: every read first, then the badges built into a
`DocumentFragment` and attached in one write.

**The equity engine was reaching up into the UI.** The pump called
`renderCoachPanel` directly to show the finished figure. It now notifies
through an `onEquityReady` hook that `init()` binds, which keeps the
dependency one-way and is what makes the whole scheduler testable without a
DOM.

### An escape hatch, since the device can't be measured from here

Settings → Coach now exposes **Equity samples** (100–5000, default 1200).
Slicing means it no longer blocks whatever the value, but on a slow phone a
lower number makes the figure *land* sooner. Precision scales as 1/√n —
1200 is roughly ±1.4 points, 600 ±2, 300 ±2.9, all comfortably inside the
error the range proxy already carries, which is what makes turning it down
a real trade rather than a corner cut. Changing it clears the cache, so two
precisions can't sit on screen at once with nothing saying which is which.

`clampEquityIters` is applied inside `equityJobInit`, not just at the input,
so a hand-edited or imported store can't hand the coach a value that leaves
it grinding.

The coach now says `Eq … working…` while a figure is pending, rather than
letting the line vanish and reappear a beat later — a line that flickers
reads as a bug, and an empty space says nothing about why it's empty.

### Also fixed: a test that flagged the CPU, not the code

`test/equity-ranges.test.js` asserted a wall-clock budget (`ms < 150`) on
the very call this release restructures. It was measured on one machine and
failed intermittently on anything slower — confirmed against unchanged code
before touching it, so this was pre-existing and not caused by the work
above.

It now asserts a **ratio**: range-weighted sampling against unweighted on
the same call, capped at 6×. That still catches the ~16× regression the
test exists for, is hardware-independent, and — unlike an absolute budget —
doesn't quietly stop testing anything at all when the machine gets faster.

42 new assertions in `test/equity-slicing.test.js`. `test/harness.js` gained
`createDocumentFragment` in both DOM modes, and `requestAnimationFrame` /
`cancelAnimationFrame` as bare globals: they existed only on `window`
before, so any code path reaching one threw `ReferenceError` under the
harness instead of running.

## 1.30.0

Player names now link to their Torn profile, and a new 🏥 hospital-status
read.

Asked for directly: "Can we make the players name clickable to their
profile? Intent is to be ready to mug them when they sit out. Do show if
they are in hospital or not."

### The name

The player panel's header name is now a link straight to
`https://www.torn.com/profiles.php?XID=<xid>`, opened in a new tab. No API
key required — the XID this HUD already resolves reliably (identity has been
by XID since the v0.4.0 deep scan) is all a profile link needs.

### The hospital read, and why it's scoped so tightly

🏥 appears on a seat only while that seat is **sitting out** and is
**currently in the hospital**. That double condition is deliberate, not
timid — it's the exact moment the user's own framing makes the question
real ("ready to mug them when they sit out"), and an active seat is neither
fetched for this nor shown it.

It reuses the same optional Torn API key and the same
`user/{id}?selections=profile` endpoint the shared-affiliation badges
(v1.8.0) already use — no new setting to add. What it does **not** reuse is
that feature's cache. Faction and marriage are day-stable facts, worth
caching for 24 hours (`AFFIL_REFRESH_MS`). Hospital status can flip in
seconds, so it gets its own 30-second staleness window
(`HOSPITAL_REFRESH_MS`), and — to keep this cheap even at a full table — is
only ever fetched for seats that are actually sitting out right now, never
for the whole table on every tick.

### Kept out of the store entirely

Unlike faction ID and spouse XID, hospital status is **not** written to
`STORE.players` and never touches `localStorage`. It lives only in a
runtime `hospitalCache` Map. A player record surviving across sessions is
the whole point of the store; a "was in the hospital" read surviving across
sessions is just wrong the moment the page reloads. This also keeps it out
of Backup/Gist exports for free, with no addition to `LOCAL_ONLY_SETTINGS`
needed.

### The render is gated the same way the fetch is

`renderBadges` checks `isSeatSittingOut` again before showing 🏥, not just
at fetch time. Without that second gate, a player who returns from the
hospital and keeps playing would carry a stale 🏥 forever — nothing
refreshes the cache for an active seat, so an ungated render would just
keep showing whatever was last fetched.

The player panel's own hospital line is looser on purpose: it shows
whatever is cached regardless of the seat's current state, because the
panel is opened deliberately rather than glanced at mid-hand, and it says
outright that the read was only ever taken while the seat was sitting out.

### Unconfirmed, same as every Torn API field in this file

`status.state` / `status.until` are written from Torn's documented API v1
profile shape, not a live response anyone working on this has actually
seen — same caveat v1.8.0 shipped with for `faction.faction_id` and
`married.spouse_id`, and still true: nobody working on this holds a key to
check one live. `parseHospitalStatus` fails to `null` on anything it
doesn't recognise rather than throwing, same defensive shape as
`parseAffiliationProfile`. Needs a live report: sit at a table with someone
who sits out while actually in the hospital, and confirm the badge lights
up (or paste back a raw API response so the field names can be checked
directly).

The Settings section this lives under was renamed "Shared-affiliation
badges" → "Torn API features", since one key now drives two features.

20 new assertions in `test/hospital-status.test.js`, mirroring
`test/affiliation.test.js`'s shape: the pure parse and pure "are they in"
check are tested directly; the real network call and Torn's actual response
shape are not, for the same reason neither is tested there.

## 1.29.0

Track how often, and how much, villains bluff.

Asked for directly, and unlike board texture (v1.28.0), this one genuinely
wasn't sitting there already collected.

### A real gap, not recovered data

`noteBetTexture` already categorised a showdown bet as `made` (two pair or
better) or `draw` (worse than that, but a live flush or straight draw, flop or
turn only). A bet with neither — worse than a pair, and no draw — was silently
dropped, counted nowhere. That gap *is* the definition of a bluff, so the new
`bluffBets`/`bluffSizes` bucket is genuinely new collection, not something
this file had been sitting on.

One deliberate exclusion: a lone pair with no draw lands in **none** of the
three buckets. It isn't made by this file's own two-pair bar, and holding a
pair isn't zero equity, so calling it a bluff would be a domain error — the
kind of thing a poker player would catch immediately (nobody calls a
top-pair value bet a "bluff"). Left unscored, on the same honest-gap
principle the unshrunk WTSD anchor already follows.

### Fixed the flagged v1.21.0 issue on the way in

`betDrawPct`/`betMadePct` were still a raw sum/count average — the v1.21.0
entry above names this outright as "out of scope for THAT pass," the exact
skew risk a single outsized shove creates. Adding a third bucket in that same
fragile shape, while the fix for the other two sat one bucket away, would
have been actively inconsistent. All three (`drawSizes`, `madeSizes`,
`bluffSizes`) now read through `median()` off a bounded window, the same
shape `betSizes` already uses, via a shared `pushTextureSize` helper.

### Migrated properly this time

v1.21.0's `betSizePctSum` → `betSizes` shipped with no migration, and the
resulting count/sample mismatch was the headline finding of the v1.26.0
review — a player's sizing "median" could be computed from a single bet while
the sample label quoted a lifetime count in the hundreds. Not repeating that:
`ensurePlayerShape` now has an explicit nested backfill for `p.texture` (the
same pattern the `streetActions` backfill already used). A record in the old
`drawPctSum`/`drawPctN` shape gets the new array fields added **empty** —
deliberately not synthesised from the old average, which would carry that
average's own skew into the very stat built to resist skew — while the old
fields are left alone, unused, the same harmless-dead-weight precedent
`betSizePctSum` itself already set.

### The caveat is stronger than the usual floor, and it doesn't run both ways

`noteBetTexture` only ever runs on a hand that reached a **real** showdown. A
bluff good enough to take the pot uncontested never reaches that sample and is
structurally invisible to it — not thin, *systematically excluded*. That makes
a **high** `bluffRate` safe to act on: the true rate is at least this high, so
"call down lighter" holds regardless. It makes a **low** reading genuinely
ambiguous — it could mean they rarely bluff, or it could mean they bluff
plenty and it usually works, and this stat cannot distinguish the two. The
low-rate advice deliberately does not mirror the high-rate one; there is no
"bluff more" framing, because that claim needs to know their overall
frequency, which is exactly what's unknowable here.

An earlier draft got this wrong in exactly the way the caveat warns about —
an overclaim ("leaving fold equity on the table... bluff more") sitting in the
**leak** voice (hero's own read on themself), while the villain-voice text was
already correct throughout. Both come from the same `add()` call via separate
`exploitText`/`leakText` arguments, which is precisely how a fix lands in one
and not the other without anyone noticing. `test/bluff-tracking.test.js`
checks both `buildExploitPlan` and `buildLeakPlan` output for this reason —
checking only one voice would have shipped it.

New Stats tab rows (`Size: bluff/made`, `Bluff freq`) and two exploit-plan
entries — a sizing tell (bet smaller or bigger bluffing than with the goods)
and a frequency tell. 48 new assertions in `test/bluff-tracking.test.js`.

## 1.28.1

The By-board-texture rows printed over the stat labels to their left.

Reported live from a Galaxy Fold cover screen — a genuinely narrow one, which
is where this class of bug surfaces first.

### Structural, not cosmetic

`.tph-stats` is `table-layout: fixed`, and `.tph-stat-v` is pinned to **26%**
with **`white-space: nowrap`**. Both are deliberate, and the comment above them
says why: fixed widths stop a long label forcing the table past 100%, and the
value column carries numbers that must not break onto a second line.

v1.28.0 then put *four* figures in that cell — `30% / 45% · 60% / 52%` — where
every other row puts one. With nowrap it could not wrap and with a fixed 26% it
could not grow, so it spilled straight out of its column onto the label beside
it.

It also ignored this file's own convention. `statRow` already puts the greyed
pool reference in the 44% **note** column, not the value column; the new rows
should have followed that from the start. They do now: the villain's own
`30%/60%` in the value cell, `pool 45%/52% · 12L/9F` in the note cell. Slashes
lost their surrounding spaces for the same reason the seat badge sheds
punctuation — the separator already delimits.

### A modifier for note cells that carry a phrase

New `.tph-stat-wrap` unsets the inherited nowrap for a note cell holding a short
phrase rather than a single figure. Declared **after** `.tph-stat-n` so the
`white-space` override wins on equal specificity; the colour still comes from
`.tph-stat-n`, per the standing rule that every `tph-` element holding text
declares its own.

### The other rows were measured, not assumed

Rather than fixing only the row that was reported, all of them were measured
against the real column width (~108px for the note column on a ~245px panel).
That turned up a **worse** offender that had not been reported yet: the Bet size
note gained `· N lifetime` in v1.26.0, taking it to ~31 characters (~167px) in
that ~108px column. Same fix applied there.

7 new assertions in `test/board-texture.test.js` pin the column split and the
modifier's declaration order, so a future edit can't quietly put the pool figure
back into the fixed-width cell.

## 1.28.0

Board texture: how a villain plays a four-flush, three-flush, paired,
four-straight or dry board.

Asked for directly — "villain's betting pattern based on board texture, e.g. if
there is a 4 card flush on the board."

### Almost all of it was already being collected

The fourth time that has been true in this repo, and the rule keeps paying.
`hand.board` was already parsed out of the log — with **no hero gate**, so a
hand you folded preflop still runs out and still tells you how everyone else
played that texture. Every action already carried its street. The replayer
already reconstructed the board as it stood on a given street. And `STORE.hands`
already held 200 past hands to seed from. The only genuinely new parts were the
classifier and the per-flag counters.

One name collision worth knowing about: `p.texture` **already meant something
else** — hand strength, made vs draw at showdown, from v1.18.0. Board texture is
`p.boardTex` / `boardFlags` / `BOARD_*` throughout so the two can never be
mistaken for each other.

### Flags, not one class per board

A board can be paired *and* four to a flush, and both facts matter. Filing each
board under a single first-match-wins class (the `LOG_PATTERNS` /
`ARCHETYPE_RULES` pattern used elsewhere) would have made `pair` quietly mean
"paired **and not** flushy" — a conditional nobody reading the stat would assume
— and would have made each flag's sample *smaller*, by carving boards away into
whichever flag outranked them. As flags, every paired board counts toward
`pair`, full stop.

The cost is that the rows overlap and do not sum to anything. The Stats tab says
so rather than letting it read as a breakdown.

### Two rates, two denominators

`lead` is bets over bet+check; `foldToBet` is folds over call+fold+raise. They
are deliberately not blended into one "aggression on wet boards" number, because
postflop, check and bet are only reachable when nobody has bet yet, while
call/fold/raise are only reachable when facing one — the same insight
`streetRates.rr` already relies on. Blending them would average two unrelated
situations. Both withhold rather than report 0% on an empty denominator: never
having been given the chance to bet a four-flush board is not evidence that they
never do.

### The sample is thin, and the design is built around that

A four-flush board is rare, so a read on one specific villain takes hundreds of
shared hands. So this ships in three layers:

- **Live board read** — costs no storage and works on hand one. The board in
  front of you is classified and fed into the coach.
- **Pool baseline** — `poolBoardTexture()` aggregates every tracked player and
  is shown beside the villain's own figure, because "leads 30%" means nothing
  cold. This is measured here, unlike `POOL_AVG`'s published reference figures.
- **Per-villain** — gated at `BOARD_TEX_MIN` (8), checked against the *same*
  cell the figure is computed from. That is v1.26.0's lesson applied on the way
  in rather than after the fact. Under-sample rows render dimmed rather than
  hidden.

Reads reach the coach through the existing context-token machinery:
`handContextTokens` emits `board:<flag>` and entries tag
`when: ['board:fl4']`, so a texture read can only ever surface on the texture it
actually describes. The tags are generated from `BOARD_FLAGS`, which makes the
typo'd-token failure mode (`entryRelevance` silently returning −1 forever)
structurally impossible here.

### Backfill runs at init(), not in migrateStore

`migrateStore` executes inside `loadStore()` near the top of the file, where
anything declared later with `const`/`let` is still in its temporal dead zone —
the documented way to break this script at load. `backfillBoardTexture` runs
from `init()` instead. It **adds** to counters, so `STORE.boardTexBackfilled`
is what makes it safe; re-running it without that flag would double-count every
seeded hand.

### Storage, measured

| | Size |
|---|---|
| `boardTex` on a fresh record | 2 bytes (sparse — unseen flags are absent) |
| Worst case, all five flags seen | 198 bytes |
| At `PRUNE_PLAYER_CAP` (2000 players) | ~387 KB, under 8% of `STORAGE_QUOTA_EST` |

One-letter counter keys and sparse storage are why. This rides on every player
record forever, which is open finding #2's exact growth shape.

63 new assertions in `test/board-texture.test.js`.

## 1.27.0

Your own stats and the Trends tab are reachable when you are not sitting down.

Asked for directly: "being able to look at my stats and trends sessions etc,
even when I'm not sitting down at the table."

Most of the HUD already worked away from a seat, which made the gap easy to
miss. `init()` has no "am I seated" check, so on the poker page the gear
renders, Settings opens, the players list works, and every *opponent's*
Stats/Range/Report/History tab reads fine — all of it comes from localStorage,
not the live table. What did not work was your own record, which was the whole
point of the request.

### Root cause

Hero identity came only from the live `self___` seat marker, and that marker
exists only while you are actually sitting. Away from a seat, `findHeroXid`
fell through to the `name:<username>` pseudo-id, `heroUnresolved()` went true,
and everything gated on `isHeroRecord` quietly disappeared:

- the Trends tab was not rendered **at all** (it is `isSelf`-gated)
- your own record showed "Exploit" instead of "Leaks"
- Settings' "Your own stats" button sat disabled, reading "(sit at a table
  first)"

### The fix

`STORE.hero.xid` now remembers what a seat once told us. Torn XIDs are
permanent, so once a seat has identified you that answer stays good.
`findHeroXid` prefers a live seat, falls back to the remembered value, and only
then to the pseudo-id.

Three rules keep that memory honest:

- **Cleared when the username changes.** That is the one thing that genuinely
  means "a different person"; keeping it would resolve a new name straight back
  to the old account's record. Handled where the change handler already nulls
  `heroXid`.
- **Preserved through `resetHeroStats`.** That resets your stats, not who you
  are — and it replaced the whole `STORE.hero` object, so the xid needed
  carrying across explicitly or a reset would un-reach your own stats until the
  next time you sat down.
- **A stored pseudo-id is refused on load.** `ensureHeroShape` rejects anything
  starting with `name:`, since that value is the bug being fixed, not an answer.

### It also hardens the seated case

`self___` is read out of HopesG's script and has never been confirmed on the
PDA layout. When it fails to match, the pseudo-id path silently freezes P/L at
zero for an entire session — the v0.20.0 failure, which presents as several
unrelated bugs. A remembered XID gives that case a correct answer too, and
resolves identity immediately at load instead of waiting for the seats to
render.

### What was audited

"Resolved" no longer implies "seated", so every `!heroUnresolved()` site was
checked. `isHeroTurn` and `isHeroNextToAct` both still return false with hero
absent from the seat ring, so the turn cue stays quiet rather than firing at
someone who is not playing; `effectiveStackVs` returns null; P/L is untouched
because attribution needs hero in `dealtInXids`, which needs an actual dealt
hand. Settings' status line now distinguishes "matched to your seat" from
"remembered from a previous sitting", since claiming the former with no seat on
screen would simply be false.

24 new assertions in `test/hero-identity-memory.test.js`, each checked against
the pre-fix code first to confirm it genuinely fails there.

## 1.26.0

Four bugs found reviewing v1.25.0 — three of them in the session and sizing
code that shipped across v1.21.0–v1.22.0, one introduced by v1.25.0 itself.

### The bet-sizing sample gate counted the wrong thing

v1.21.0 moved the sizing tell onto a median of `betSizes`, a 40-bet rolling
window, but did not bump `STORE_VERSION` or add a migration block. So
`ensurePlayerShape` backfilled `betSizes: []` on every record that already
existed, while `betSizeCount` kept its full historical value — and the gate
was still reading `betSizeCount`.

A tracked opponent with 247 lifetime bets and an empty window therefore
cleared `BET_SIZE_MIN` on their very next bet. One 320%-of-pot all-in shove
surfaced as *"Typically bets 320% of pot (median of 248 bets) — oversized. At
this pool that usually means value, not a bluff."* That is precisely the case
`BET_SIZE_MIN`'s own comment describes ("One 300%-pot shove is not a sizing
habit"), and with 173+ tracked opponents it was misfiring across the entire
pool for each player's first twelve bets after the upgrade.

New `betSizeSample(p)` returns the length of the window the median is actually
drawn from, and is now both what gates the read and what the read reports — so
the stated sample and the computed figure can no longer describe different
things. `betSizeCount` survives as the lifetime tally, shown separately on the
Stats tab where the distinction is informative rather than misleading.

### The Trends tab was always one session behind

`archiveSession` was reachable only from `touchSession`'s rollover branch, and
`touchSession` runs only from `applyHandResults` — on a settled hand. A session
you simply stopped playing was never archived at the gap boundary; it sat live
in `STORE.session`, invisible to the chart, until you sat back down and played
one more hand.

So: play tonight, open Trends tomorrow morning, and last night is missing —
while the legend claims "One row per completed session". The rollover is now
`maybeRollSession`, called from `touchSession` as before and also when the
Trends tab renders, so the session you most want to see is there when you look.

### A remembered tab could render a blank panel

v1.25.0 made `openPlayerTab` persist across reopens of the same player. Trends
is the one tab that isn't always available, and `isSelf` can flip to false
underneath a remembered `'trends'`: editing the username in Settings sets
`heroXid = null` to force re-resolution, and `isHeroRecord` answers false for
the ~3s until the watcher re-resolves it.

The tab bar then omitted the Trends chip *and* every branch of the dispatch
missed, leaving `.tph-tab-body` never written — a panel with a header, no
active tab, and no content, with no error. `renderPlayerPanel` now normalises
the tab before the `scrollKey` is built from it, so the selected tab and the
rendered tab cannot disagree.

### A session with no readable blind charted as break-even

In Torn's BB-display mode `plausibleBB` refuses every blind, so `session.bb`
stays 0 for the whole session and `archiveSession` stored `netBB: 0` — which
the charts plotted as a genuine zero, making a big winning or losing session
an exact flat point and dragging the trend line toward it.

It stores `null` now. `sessionNetBB` treats a legacy stored 0 with no recorded
stake as unknown as well, so no migration is needed; the two bb charts plot
only the sessions that have a real figure, and the legend says how many were
left out and why. The chip P/L is unaffected and still exact. This is the same
withhold-rather-than-guess rule `fmtBB100` and `bbHands` already follow.

36 new assertions in `test/review-fixes.test.js`, each one checked against the
pre-fix code first to confirm it genuinely fails there.

## 1.25.0

The player panel forgot where you were every time you had to close it.

Reported directly, and specific about the mechanism: the whole reason to open
Stats or the new Trends tab mid-hand is the few seconds available before it's
your turn — but closing the panel to hit fold/call/raise and reopening it
seconds later always landed back at the top of whatever you'd been reading.
`renderPanel` tears its element down and rebuilds a fresh one on literally
every call (open, close, tab switch), so there was never anywhere for a
scroll position to survive.

- `renderPanel` now accepts an optional `scrollKey`. Before removing an
  outgoing panel it saves that element's `scrollTop` under the key stamped in
  its own `dataset` when it was created; once the replacement is built —
  after `wire()` runs, since that's what actually determines how tall the
  content is — it restores whatever was saved under *its* key. This is plain
  JS state, not `STORE`: it only has to survive within the running page, not
  a reload.
- Defaults to the marker itself, which is enough for a panel that only ever
  shows one "document" (Settings, the players list). The player panel passes
  `marker:xid:tab`, because one marker there covers every player and every
  tab, and each of those combinations needs its own remembered spot rather
  than inheriting whatever some other view last left behind.
- `openPlayerPanel` also stopped force-resetting to the Stats tab on every
  open — now only when the player actually changes. Reopening the *same*
  player you just closed on lands back on whichever tab you were reading;
  opening a different player still starts fresh at Stats, which is the right
  default for a player you weren't just looking at.

4 new assertions in `test/panel.test.js`, against `renderPanel` directly —
the harness's minimal DOM stub doesn't parse HTML into a real tree, so the
full player-panel wiring (`renderPlayerPanelBody`'s nested `.tph-tab-body`
lookup) isn't something a test can drive end-to-end without a much bigger
change to the harness than this fix justifies.

## 1.24.0

The Trends tab was already keeping 60 sessions of history and only showing a
fraction of it.

Follow-up to v1.22.0's session tracker, asked for directly: the "last 10 or
more" sessions with room stakes was already built — `STORE.sessionHistory`
holds up to `SESSION_HISTORY_MAX` (60) completed sessions — but the Trends
tab's display limits were set well below that: 12 rows in the table, 20
points on the sparkline charts.

`SESSION_TABLE_ROWS` 12 → 25, `SESSION_TREND_POINTS` 20 → 30. Both are pure
display limits, separate from `SESSION_HISTORY_MAX`, which is unchanged —
raising them surfaces more of what was already being stored, it doesn't
store anything new. `sparklineSvg` plots through an SVG `viewBox`, not a
fixed pixel-per-point layout, so widening the point count doesn't need any
other change to render correctly at the same on-screen width.

## 1.23.0

Maniac was silently absorbing most of LAG and Station's population.

Reported directly: most tracked players read as Maniac or Balanced, almost
never Station or LAG, regardless of what the pool actually looked like.

The Maniac rule tested only `afq > 60 && vpip > loose`, with no PFR/VPIP
shape at all — so it fired for any loose player with high postflop
aggression, including a loose-PASSIVE one (a Station who bets big the one
time they wake up) as well as a loose-aggressive one (an actual LAG). Checked
first in `ARCHETYPE_RULES` ("order matters, first match wins"), it caught
both before LAG or Station were ever evaluated.

Worth being precise about what this was and wasn't: the thresholds ARE
pool-relative by design — `A.tight`/`A.loose` are multiples of
`POOL_AVG.vpip`, not hardcoded numbers, so correcting `POOL_AVG` does move
them. This was not that. It was a rule-ordering and rule-shape bug that
reproduces on any pool, whatever `POOL_AVG` happens to be set to.

Fixed by giving Maniac the same loose+aggressive-preflop shape LAG already
tests (`vpip > loose && pfr/vpip >= aggRatio`), with `afq > 60` as the one
extra condition that promotes a LAG into a Maniac — the same "shared shape,
split by one more condition, more specific checked first" pattern Nit/TAG
already used one rule up. A loose-passive player can no longer reach Maniac
at all, whatever their postflop AFq is; they now correctly reach Station.

4 new assertions in `test/archetype.test.js`, including the regression case
directly: loose + passive + 80% AFq now classifies Station, not Maniac.

## 1.22.0

Session-over-session trends: win rate, VPIP, aggression, and P/L charted
across your completed sessions.

A "session" already existed — `STORE.session`, `touchSession`,
`SESSION_GAP_MS`'s 4-hour gap — it just overwrote itself in place every time
the gap fired, so the moment a session ended its numbers were gone for good.
There was no way to see whether last Tuesday's session was better or worse
than tonight's.

The just-ended session is now snapshotted into `STORE.sessionHistory`
(`archiveSession`, called from `touchSession` right before it resets the live
counters) — hands played, net chips and bb, VPIP/PFR/AFq counts, and the last
stake seen. Bounded at `SESSION_HISTORY_MAX` (60 sessions), oldest dropped
first, same reasoning as `recentTables`/`betSizes`: this is written every time
a session ends and would otherwise grow forever.

A new "Trends" tab appears on hero's own player panel — same `isSelf` gate
that already swaps Exploit for Leaks, since a session is hero's own sitting,
not something that applies to any other tracked player. It shows four
sparkline charts (win rate in bb/100, P/L in bb, VPIP%, aggression%) over the
most recent sessions, plus a table of the last 12. `sparklineSvg` gained
optional `min`/`max`/`zeroLine` options so it can plot a signed, unbounded
metric — P/L and win rate can be negative and have no natural ceiling — right
alongside the 0-100% metrics it already drew; every existing caller is
unaffected, since the new min/max form agrees exactly with the old hardcoded
0-100 one when no options are passed.

`resetHeroStats` now also clears `sessionHistory`. Hand history stays on that
reset because it still describes opponents too, but every field in
`sessionHistory` describes hero's own play alone, so it gets the same
clean-slate treatment `STORE.hero` does.

## 1.21.0

Bet size is a median now, not a sum/count average.

Reported directly: the "Bet size" sizing tell was a running `sum / count`
average, and one enormous all-in shove could drag it a long way on its own.
A player who bets around 50% of pot all day, after a single 500%-pot shove,
read as an "oversized" bettor to the exploit plan, the leak plan, and the
Stats tab — exactly backwards, since a shove forced by stack depth says
nothing about voluntary sizing habits.

`betSizePctSum` / `betSizeCount` (a running total, divided on read) is
replaced by `betSizes`, a bounded rolling window of the most recent
bet-as-%-of-pot values. `BET_SIZE_HISTORY_MAX` (40) caps it — same reasoning
as `recentTables`: this is stored for every player forever, so it must not
grow with hand count the way the player list itself does (open finding #2).
The sizing tell is now `median(p.betSizes)` rather than a mean: one outlier
sitting among 40 ordinary bets moves a median by very little, however far
outside the pot it was. `betSizeCount` is kept as the LIFETIME count,
unaffected by the window, so the sample-size gate (`BET_SIZE_MIN`) and the
"N bets" display still describe everything ever observed, not just the
window the median is drawn from.

Every surfaced line changed wording along with the number: "Averages X% of
pot" is now "Typically bets X% of pot (median of N bets)" in the exploit
plan, the leak plan, the player report, and the Stats tab legend — so the UI
does not claim to be reporting a mean it no longer computes.

Untouched, on purpose: v1.18.0's draw-vs-made `texture` sizing split
(`betDrawPct`/`betMadePct`) is the same shape of sum/count average and
carries the same latent skew risk from an all-in caught at showdown. Out of
scope for this pass — flagged, not fixed.

## 1.20.0

The Gist sync status line now shows the gist itself — reported live, right
after v1.19.0 shipped: Copy and Save/share *still* both failed on a large
Backup export, exactly the same as before that fix. That's expected, not a
regression: v1.19.0 only stopped both buttons lying about success, it never
made either path capable of carrying more data. The follow-up question was
"could this be the export's size?" — plausible, since both the clipboard and
Flutter's app-bridge have real, low payload ceilings in a mobile webview, and
neither was ever built to move a multi-hundred-KB blob.

The fix isn't to fight those two paths further. This HUD already has GitHub
Gist sync built — a plain HTTPS `PATCH` to the GitHub API, which doesn't share
either limit — for exactly this reason. What was missing was any way to
actually **find** the result: the Settings panel said "Connected. Last sync:
..." once sync was working, but never surfaced the gist itself. The only way
to get the data afterward was to leave the HUD entirely and go hunting on
github.com.

- New `gistUrl()` — the bare `https://gist.github.com/<id>` form, which
  resolves without needing the username and so costs no extra API call — is
  folded into `syncStatusText()` once a gist exists, and a new **"Copy gist
  link"** button appears alongside it.
- That link is about 40 characters, nothing like the full export. `copyText`'s
  `execCommand` fallback (from v1.19.0) has no size-related reason to fail on
  something this small, even on a device where the full Backup copy does.
- The actual point of having the URL: opened in the phone's **regular
  browser** — not Torn PDA's constrained in-app page — a gist has full,
  unrestricted clipboard access. That's the way out of this entire class of
  bug for an export too large to move through this webview at all.

11 new assertions in `test/gist-sync.test.js`.

## 1.19.0

Copy and Save/share, actually working — reported live, right after 1.18.0
shipped, by the user trying to use the Backup export to pull data out for
analysis: the Settings Copy button failed outright ("failed to copy to
clipboard"), and Save/share flipped its label to "Sent" while nothing was
ever actually shared.

**Bug 1: Save/share claimed success it never checked for.**
`downloadTextFile`'s PDA branch called
`window.flutter_inappwebview.callHandler('shareFile', ...)` — a call into a
native handler Torn PDA is expected to register on the Flutter side — and
returned `true` immediately, without awaiting the Promise `callHandler`
actually returns. If Torn PDA has no `'shareFile'` handler registered at all
(as reported), that promise rejects — but by then this function had already
told its caller "sent", and the caller had already flipped the button to
"Sent ✓". `downloadTextFile` is now `async` and awaits the call, only
reporting success once it has genuinely resolved. No `<a download>` fallback
is attempted after a PDA failure: that path is already documented (in the
function's own comment, from an earlier report) as silently doing nothing
inside this webview, so trying it would just reproduce the exact same
false-positive this fix exists to close.

**Bug 2: no fallback at all when the Clipboard API is blocked.** Every Copy
button was a bare `navigator.clipboard && navigator.clipboard.writeText(...)`
with nothing catching a rejection. `navigator.clipboard.writeText` is
permission-gated, and an embedding app frequently never wires up that grant —
which is exactly what "failed to copy to clipboard" looks like. A new
`copyText(text, existingEl)` replaces all 7 call sites: it tries the
Clipboard API first, and on rejection or absence falls back to
`execCommand('copy')` against a real, selected textarea — deprecated, but
with no permission gate, and the mechanism the deep-scan panel's copy button
already relied on before this change generalised it. Passing an
already-visible textarea (Backup's `.tph-export`, the deep-scan report's) as
`existingEl` means that even total failure leaves the text selected on
screen, ready for a manual long-press-copy, instead of vanishing into an
invisible removed node.

Every Copy/Save button across Settings, the player History tab, the Report
tab, and the pool-tendency export now reports what actually happened instead
of assuming success — including "Copy report" on the Report tab, which
previously gave no feedback of any kind, success or failure.

17 new assertions in `test/clipboard-export.test.js`: a rejecting
`callHandler` is asserted to report failure (not "Sent"), and `copyText` is
driven through a working Clipboard API, a rejecting one, and an
execCommand-only path, including that the text lands on a passed-in existing
element even when every path fails. Needed `btoa`/`atob` added to the test
harness's sandbox — Node has both as real globals, but a `vm` context doesn't
inherit them from the outer process, and nothing had exercised
`downloadTextFile`'s PDA branch (the only user of `btoa` in this file) before
this test.

## 1.18.0

Two additions, both closing gaps the History tab and the coach had carried
since showdown tracking was added — the first from user feedback ("hand
history for players only includes bet sizes, not the actual cards run out";
"I need to know the way players bet or call pot sizes... do they like to bet
draws, or tend to be trappy").

**The board is now printed in a hand's history entry.** The tab, the Copy
button and the file export all go through `formatHand`/`formatHandHtml`, so
all three gained it in one change. `hand.board` has been persisted since
v1.17.0's replayer; nothing had ever printed it, so a hand's history showed
every bet size but never the cards that actually fell — exactly the thing
needed to read whether a bet was into a wet or dry board. Omitted entirely
(not a blank "board:" line) for a hand recorded before v1.17.0, which has
`board: undefined` rather than a known-empty board — same distinction the
replayer already makes.

**Bet-sizing and slowplay, split by hand strength AT THE MOMENT of the
action.** A new `texture` field per player, banked at settlement alongside
`noteShowdown` from the same showdown evidence — same "floor on a range,
never the whole of it" caveat as `shownHands`, because a showdown is the only
point this file ever learns what a player was actually holding mid-hand.

- `categoryAt` reuses `evaluate7` rather than a second evaluator, so "made"
  here always means what category 2+ (two pair or better) means everywhere
  else that number is read.
- `hasDrawAt` is coarse on purpose, the same tradeoff `RFI_RANGES` already
  makes elsewhere in this file: a four-flush or an open/gutshot straight draw
  counts, without distinguishing a gutshot from a double-belly-buster.
- Both are evaluated against hole+board at each flop/turn/river action a
  shown-down player took, and split two things out of it: their average bet
  size as % of pot while still only drawing vs. already holding two pair+
  (does their bet SIZE tell you what they have), and how often they check a
  hand that's already made instead of betting it — the slowplay/trap rate.
- All of it surfaces in three places: the Stats tab (a "Size: draw/made" row
  and a "Slowplay" row), the tendency report ("Sizing & showdown" section),
  and two new entry types in the coach's exploit plan (`Sizing`, `Trap`) with
  the usual leak-voice mirror for the Leaks tab. Everything is gated at
  `TEXTURE_MIN` (5) — a showdown sample is inherently small, smaller than the
  general bet-size sample `BET_SIZE_MIN` already gates on.
- `logAction` gained an optional `extra` param so bet/raise/all-in actions can
  carry their own `.p` (bet-as-%-of-pot, `betSizePctOf`) on the stored action
  record itself — settlement-time code needs to know what a SPECIFIC
  showdown-street bet cost, and there is no honest way to recover that later
  by replaying the pot (a raise's logged amount is a total-bet-to figure, not
  an increment — the same fact that already rules out a per-step pot in the
  v1.17.0 replayer).

31 new assertions in `test/bet-texture.test.js`, including an end-to-end run
through `handleLogLine` with real log wording rather than a hand-built `hand`
object — this project's own stated reason for preferring that: "a test of a
copy cannot fail when the original is wrong."

## 1.17.1

"Stack this sitting"'s staleness gap cut from 4h to 2h10m, and split into its
own `STACK_SESSION_GAP_MS` — `trackStacks` no longer shares `SESSION_GAP_MS`
with `touchSession` (hero's own lifetime-session tracker, still 4h,
untouched).

Reported from a live table at River Wizard: the stack bar's "high" read well
above the table's own max buy-in. The staleness check already resets a
sitting on a gap OR a stake change, but the stake check compares `bb`
(the blind level), which does not change if a player leaves and re-buys
smaller at the *same* table — so a return inside the old 4h window silently
carried the previous buy-in's high into the new one, alongside the new
(smaller) low/start. 2h10m is a judgement call, not a measurement: long
enough that an ordinary break doesn't manufacture a false "new sitting" (and
lose the low/high context that makes the bar useful), short enough to catch
a genuine cash-out-and-rebuy before it corrupts the range.

## 1.17.0

A hand replayer, Poker Copilot-style. Every stored hand in the History tab
now has a "▶ Replay this hand" button that steps it forward one **street** at
a time — not one action at a time, since the board and the equity quote only
change at a street boundary, and grouping actions by street is what
`formatHand`/`formatHandHtml` already do — showing the board as it was dealt
and, when hero's cards were captured, hero's equity at that point using the
same Monte Carlo engine and range-proxy tiering the live coach panel uses.

**`recordHandHistory` now persists `hand.board`.** The board was tracked live
the whole time — the flop/turn/river log handler has always accumulated it —
but never written into the stored hand record, so there was nothing for a
replayer to read. A hand recorded before this version has `board: undefined`
on the stored object, which `replayStepsFor` reads as genuinely **unknown**
(shown as "unknown — recorded before replay support") rather than an empty
array that would misleadingly look like a hand that ended preflop.

**`replayStepsFor`/`replayPreflopRaiseLevel`/`replayStepEquity`** are pure
functions over the stored hand object (module-level `heroXid` aside, the same
convention `buildTendencyEntries` already follows — testable by setting
`T.heroXid` directly). The equity call reuses `estimateEquityCached` with
`opponentRangeProxy`, counting preflop raise events (all-ins included, same
"an all-in counts as a raise" rule `preflopRaiseEvents` uses live — open
finding #3) from the stored action log, so a replayed read looks like the
read you'd actually have gotten in the moment, not a naive "equity vs random"
figure that ignores whether the pot got raised.

**No per-step pot, on purpose.** `hand.actions` stores a raise's logged
amount as the **total** bet-to figure ("raised $1,000,000 to $2,000,000" —
the second number), not the increment over the previous bet. Summing that
across steps would overcount the pot at every street after the first raise.
Rather than ship a subtly-wrong running total, the replayer shows the final
pot once as context (already DOM-corrected at recording time — see "the pot
had no cross-check", closed v0.18.0) and leaves per-step pot out entirely.

`cardGlyph`/`cardsGlyphText` are new, small display helpers (`{rank:'A',
suit:'s'}` → `"A♠"`) — the first place in this file that needed to print a
card back out rather than only read one.

31 new assertions in `test/hand-replay.test.js`, most of them the honest-null
cases for equity: no hero cards captured, hero already folded by that step,
board unknown, or nobody left to have equity against.

## 1.16.0

A recent-form sparkline on the Stats tab — rolling VPIP (blue) and PFR
(amber), `TREND_WINDOW_HANDS` (10) hands per point, oldest to newest left to
right. The blended VPIP/PFR figure already on that row says *where* a
player's numbers are right now; this says *how they got there* — drifting
looser, drifting tighter, or just bouncing around a stable number — which is
invisible in any single blended figure. No new data collection: `p.recent`
is the exact same bitfield array `blendedRates`/`sessionRates` already read
for the badge's "recent form" mode.

**Its own window size, deliberately not `STORE.settings.sessionWindow`.**
That setting is tuned for one stable *estimate* — bigger is steadier. A trend
needs the opposite: many noisier points to show a shape, not one smooth
number. Sharing the setting would also have a real failure mode: a user who
raises `sessionWindow` toward `RECENT_MAX` (40) would watch their sparkline
disappear entirely, since a window equal to the whole buffer has exactly one
possible reading — zero line segments to draw.

**`recentTrendPoints`/`sparklineSvg` are pure functions**, deliberately kept
DOM-free — the arithmetic (rolling VPIP/PFR over a sliding window) and the
SVG string output are both directly testable, rather than only reachable
through a render pass this test harness can't drive. 25 new assertions in
`test/trend-sparkline.test.js`, including the one that actually matters for
whether this reads correctly at a glance: a 100% point plots at the *top* of
the track (`y=0`), so "trending up" on the stat actually points up on screen.

One near-miss worth recording: an early draft of the CSS comment explaining
why `.tph-sparkline` needs no declared colour used backticks around the word
"color" — inside the stylesheet's own template literal, which is exactly the
"no backticks in CSS comments" trap this file has been bitten by once already
(v0.25.0, the word `td`). Caught by `node --check` before it shipped.

## 1.15.0

A self leak-finder — what DriveHUD calls its "MDA Exploit Report" and
PokerTracker 4 calls LeakTracker, except aimed at your own game instead of an
opponent's. Both are genuinely mainstream HUD features and both do the same
underlying thing this file already does for opponents: compare a player's
rates to a population baseline and rank the deviations. The only real gap was
that this file only ever pointed that comparison at someone else.

**`buildTendencyEntries(p, voice)`** is the detection pass extracted from the
old `buildExploitPlan` — same rules, same `POOL_AVG`/`POOL_SPREAD` gates, same
`gain`/`tag`/`when` relevance tagging. `buildExploitPlan(p)` is now a thin
wrapper calling it with `'exploit'`; the new `buildLeakPlan(p)` calls it with
`'leak'`. Every rule's `add()` call carries **both** phrasings side by side,
so there is exactly one call site per rule rather than two independent copies
that could quietly disagree about a threshold after the next `POOL_AVG`
correction (see 1.11.0 for why that's not a hypothetical risk in this file).

**Hero's own player panel shows a "Leaks" tab** in the same slot the "Exploit"
tab occupies for anyone else — `buildExploitHtml` gained an `isSelf` flag that
switches both the plan source and the empty-state copy ("No leaks found yet"
vs "Nothing clearly exploitable yet"). Two things worth knowing about which
rules actually fire for hero:

- **Tilt and stack-swing entries DO fire for hero.** Being stuck 50bb or up
  100bb this sitting is exactly when a player's own game tends to drift, hero
  included — these aren't opponent-only reads.
- **Shown-hand range entries never fire for hero**, because `harvestShownCards`
  deliberately excludes hero's own cards (see "Showdown ranges" — recording
  them would count a showdown every single hand). The leak-voice text for
  those rules exists in the source as dead code by construction, not a gap
  someone forgot to special-case.

71 new assertions in `test/leak-plan.test.js`. Most of them are a parity
check, which matters more here than any individual sentence: given the same
player, both voices must produce identical `gain`/`tag`/`when` and genuinely
different wording. A leak-finder that silently disagreed with the exploit
plan it was built from would be worse than not having one.

## 1.14.0

Hero's badge nudged down one more line, reported from a live table. The
v1.7.0 half-badge-line nudge cleared the action timer, but that only solved
the collision — it left the badge floating over empty felt above the name
rather than sitting on it. `SELF_BADGE_DOWN_NUDGE_PX` moves from half a
badge-line to 1.5 (one more full line down), so the badge now covers the
name specifically and nothing else. `SELF_BADGE_RIGHT_NUDGE_PX` (the
horizontal clearance from the timer) is untouched.

Same as every other screen-real-estate adjustment in this file: nobody
working on this can see the layout, so this is the latest report acted on,
not a claim that it's now exactly right — needs one more look at the table
to confirm.

## 1.13.0

The turn cue escalates. Still your turn `TURN_ESCALATE_MS` (10 seconds) after
the first chime/buzz/glow, and it fires a second, stronger signal on all
three channels — asked for directly, after the base cue alone got missed
with the phone dimmed or set down. This is **not** a repeating alarm: exactly
one escalation per turn, then it stays at that strength until the turn ends.

**Sound.** `playTurnEscalationChime` repeats the same rising two-note shape
`playTurnChime` already used, twice back to back, rather than introducing an
unfamiliar sound that would need its own "what was that?" moment to place.
Both now share `playChimeNotes`, pulled out of the original `playTurnChime`
so the escalation chime is a different *note sequence*, not a duplicated copy
of the oscillator/gain wiring with one array literal changed.

**Vibration** escalates too — `[120, 80, 120]` instead of a single 120ms
buzz.

**Visual.** `tph-glow-escalated` brightens the border, widens the glow, and
speeds the pulse from 1.25s to 0.6s. Still green: this never stops being
"your turn," it just gets louder about saying so. The gear and the coach
header pick up a matching highlight, same as the base cue already does for
anyone with the panel collapsed.

**The timing decision is a pure function on purpose.** `shouldEscalateTurnCue`
was pulled out of `renderTurnCue` specifically so it has real test coverage —
`renderTurnCue` itself can't be driven through this harness (it needs live
seat/action-button DOM, the same boundary `name-boundary.test.js`'s header
already documents for a different function), which is exactly why the timing
logic living *inside* it, untested, was the wrong place for it. 10 new
assertions in `test/turn-cue.test.js` cover the threshold boundary exactly,
the rising-edge case (escalation must NOT fire on the same tick the cue turns
on — that tick resets the timer instead), not double-firing within one turn,
and that both chime functions fail to `false` rather than throwing when no
`AudioContext` exists (true of this test harness, and of any browser that
doesn't support it).

Settings gained a "Test escalation" button beside the existing chime test,
and the description text states the 10-second delay by reading the live
`TURN_ESCALATE_MS` constant rather than a hardcoded copy that could drift
out of sync with it.

## 1.12.0

Pool tendencies export now says **how many hands** and **which stakes** it's
drawn from — asked directly after the 1.11.0 `POOL_AVG` correction landed.
The export already named the player count (173 tracked opponents) but not
the hand count behind it or which rooms it spanned, which matters for
judging how much confidence to place in a correction like that one.

**`observedPoolAverages()` gains `totalHands`**: the sum of each qualifying
player's own lifetime hand count — the same "hands observed" denominator
`computeRates` already uses everywhere else, not a count of logged actions or
a hand-history length.

**New `poolStakesBreakdown()`** aggregates `p.tables` (blind level → hands
seen there, already used per-player by "Usually plays" in the Stats tab)
across every qualifying player, ranked busiest first with a share percentage.
`poolQualifyingPlayers()` was pulled out as its own function so this and
`observedPoolAverages()` are guaranteed to describe the exact same set of
players — two independently-filtered lists that could quietly drift apart
was the failure mode worth avoiding here.

One honesty detail in the export text: `p.tables` is only incremented when a
hand's blind level was actually readable (see `noteBlindLevel`/`plausibleBB`),
so its total typically runs slightly *below* `totalHands` — a hand with an
unreadable blind still counts toward the rate averages (`computeRates`
doesn't need a blind level) but not toward the stakes breakdown. The report
says so explicitly rather than implying the two totals should match.

14 new assertions in `test/pool-tendency.test.js` cover `totalHands`
excluding hero and under-sample players, the stakes breakdown's aggregation
and sorting, an under-sample player's stakes being excluded from the
breakdown the same way their rates already were, and the "no readable blind
anywhere" and "no qualifying players" empty-report cases.

## 1.11.0

`POOL_AVG` is measured now, not borrowed. Corrected from `observedPoolAverages()`
output over 173 tracked opponents (25+ hands each), replacing the figures
this file carried since v0.22.0 straight from HopesG's "Torn Poker HUD -
Player Profiler & Coach" script and never independently verified — the
correction those versions' own comments always said was coming: "if these
diverge over a few hundred hands, POOL_AVG is what to fix."

**Old → new:** VPIP 50.9 → 42.5, PFR 13.4 → 9.4, 3-bet 3.7 → 1.5,
fold-to-3-bet 14.9 → 48.1 (more than **tripled**), C-bet 40.3 → 38.7,
fold-to-C-bet 56.1 → 44.9, limp-share 44.8 → 42.4.

The divergence went a direction worth knowing: this pool is **tighter** than
HopesG's figures assumed, not looser, and folds to a 3-bet dramatically more
often than assumed. Whether that reflects a genuinely different player pool,
different stakes getting tracked, or something else isn't known — it's just
what got measured.

**Archetype thresholds moved automatically, and that's the point of how they
were built.** `A.tight`/`A.loose` are algebraic functions of `POOL_AVG.vpip`
(`* 0.55` / `* 1.15`), so correcting the anchor moved the Nit/TAG/LAG/Station
boundaries with it — no separate edit needed, confirming the "thresholds are
pool-relative, not absolute" design decision from v0.22.0 actually holds.
`A.aggRatio`/`A.passiveRatio` and every `POOL_SPREAD` entry are different:
independent judgement calls, not values derived from `POOL_AVG`, so this
correction deliberately left them alone rather than guessing at a new
"correct" distance without evidence.

**A handful of tests turned out to hardcode expectations computed from the
OLD anchor** — an exact classification boundary that happened to sit right at
old-but-not-new thresholds, a rendered delta string, a shrinkage-arithmetic
result — instead of computing them from the live `POOL_AVG`/`A`. Fixed across
`test/archetype.test.js`, `test/deviation.test.js`, `test/exploit-plan.test.js`,
`test/blended-rates.test.js`, and `test/stats.test.js`, all now deriving their
expectations dynamically. `A` is exported to the test seam for exactly this.
The next correction (and there will be one — `observedPoolAverages()` and the
export button that surfaces it aren't going anywhere) shouldn't need to touch
test code at all.

**Also confirmed by a fresh deep scan**, unrelated to this correction but
worth recording: the v1.6.0 hero-identity-split fix is holding under real
play. `heroGhost(name:Wonkawee): none` — no ghost record — and `heroRecord`
tracks `STORE.hero` exactly, 275 hands both sides, no drift.

## 1.10.0

Two players-list fixes, both reported straight after 1.9.0 shipped.

**"Save / share pool tendencies" only calls PDA's native share handler** — an
async, OS-level share sheet this webview has no visibility into once it's
launched. The button's "Sent ✓" state only ever meant "the handler was
called without throwing," never "a share actually completed," and on a real
device that read as the button silently doing nothing. Added a plain **Copy**
button beside it that writes straight to the clipboard, no share-sheet
detour — the same two-button split (Copy vs Save/share) the per-player
History export has always had; pool tendencies just shipped without it.

**The players list table is now sortable.** Tap any header — Name, Type,
Hands, VPIP/PFR, P/L — to sort by it, tap again to flip direction.
`playersSortValue()` is the one place that decides what each column actually
sorts on, and three choices there are worth knowing:

- The combined "VPIP/PFR" header sorts on VPIP alone, since it's the leading
  and more directly comparable of the two figures.
- A stat with no data (a player who's never faced a 3-bet, say) sorts as
  `-Infinity`, not `0` — "unknown" and "always calls it" are different claims,
  and treating the former as the latter would bury real 0%-fold players in a
  crowd of players who simply haven't been observed there yet.
- Hero's own P/L cell doesn't show a number at all (it prints "see Lifetime"
  instead — plChipsEst is never written for hero, since that would mean P/L
  against yourself). Sorting hero to the bottom of that column keeps the row
  from landing in the middle of real figures under a value nobody can see.

## 1.9.0

Pool tendencies, exportable. `observedPoolAverages()` grew from VPIP/PFR only
to every rate `computeRates` produces — 3-bet, fold-to-3-bet, C-bet,
fold-to-C-bet, limp share of VPIP, AFq, WTSD — and a new "Download pool
tendencies" button in the players list turns it into a readable file.

**Deliberately aggregate, not a hand-by-hand dump.** `STORE.hands` is capped
at `historyLimit` (roughly 200-300 hands once pinned notable ones are
counted), so an "export all hands" feature there would really mean "whichever
recent or big pots survived pruning" — a recency- and size-biased sample, not
an honest picture of the pool. The per-player counters this draws from
instead (`p.vpip`, `p.foldTo3BetMade`, etc.) are never capped or pruned down,
so summing across every tracked player is the actually-complete dataset.

**Each stat is averaged only across players who had the opportunity at all.**
`computeRates` already returns `null` for a stat with a zero denominator (a
player who's never faced a 3-bet has no `foldTo3Bet` figure to contribute),
and the pool mean drops nulls rather than reading them as 0% — a player who's
never seen a spot doesn't get scored as playing it perfectly tight. No second
per-stat sample-size gate was added on top of the existing 25-hand floor:
that distinction matters for a single opponent, where one thin sample IS the
whole answer, but a pool *average* is already protected by however many
players qualify for it — one player's noisy denominator gets diluted by
everyone else's, not amplified.

**AFq and WTSD are reported without a comparison**, exactly like everywhere
else in this file that shows them: no published pool figure exists for
either, so inventing one to compare against would be worse than leaving the
row honest about not having one.

22 new assertions in `test/pool-tendency.test.js` cover the full stat set,
the null-exclusion behavior, hero being excluded from the pool, and the
export's handling of both the normal case and "fewer than 3 players tracked."

## 1.8.0

Shared-affiliation badges: 🔗 marks two seated players in the same faction,
💍 marks two married to each other.

**Deliberately not a behavioural collusion detector.** The other design on the
table — raise-pattern squeeze detection, pairwise soft-play reads — needs
pairwise stats maintained for every pair of players that's ever shared a
table. That is the exact O(n²) growth shape open finding #2 already burned
this file on once (`STORE.players` itself, closed in v0.40–0.41). Faction and
marriage sidestep it entirely: they're objective facts Torn's own API already
knows, not an inferred pattern, and the result is cached **per player** —
`factionId`, `factionName`, `spouseXid`, `affilFetchedAt`, a handful of
scalars, the same storage shape every other player field already has. Whether
two players *match* is computed fresh at render time from whoever is
currently seated and is never itself stored, so there is no relationship
state to grow at all.

**Needs an optional Torn API key** (Settings → "Shared-affiliation badges") —
a public-access key is enough. This is the script's first credential besides
the GitHub token, and follows the identical rule: added to
`LOCAL_ONLY_SETTINGS`, stripped from Backup/Gist exports, and an empty key
makes the whole feature a silent no-op — no error, no nag, nothing fetched.
Requests go through the existing `pdaFetchJson` adapter, so no new `@grant` is
needed.

`refreshSeatedAffiliations()` runs on the same 3s watcher tick as
`harvestSeatNames`, gated by a 24-hour per-player staleness check —
faction and marriage don't change hand to hand, so in practice this costs a
handful of API calls per session, not one per seat per tick.

**Unconfirmed, flagged in the code:** the parsed field names
(`faction.faction_id`/`faction_name`, `married.spouse_id`) are written from
Torn's documented API v1 profile shape, not a response anyone working on this
has actually seen — nobody holds a key to check one live. Same rule as every
DOM selector in this file: trust it once it's been reported back from a real
fetch, not before. `parseAffiliationProfile` fails to `null` rather than
throwing on anything it doesn't recognise, so a wrong guess here costs a
missing badge, not a crash — and also correctly rejects Torn's `{"error":
{...}}` shape for a bad/rate-limited key, rather than reading it as "no
faction, no marriage" and caching a false negative.

19 new assertions in `test/affiliation.test.js` cover the parser (well-formed
response, missing fields, null/undefined input, the API-error shape) and the
pure seated-comparison logic (`affiliationFlags`) — matching faction pairs,
directional marriage data (only the side whose `spouseXid` was fetched shows
💍), de-duplication when both flags apply, and that nothing about a match is
persisted between two different seated-list snapshots.

## 1.7.0

Three screen-real-estate fixes, all reported from a live table.

**Hero's own badge was blocking the action timer.** At its full lift
(`SELF_BADGE_LIFT_PX`, five badge-lines, existing since 0.42.0) it cleared the
name plate and chip figure but sat over the timer. Nudged half a badge-line
down and ~10 characters right (`SELF_BADGE_DOWN_NUDGE_PX` /
`SELF_BADGE_RIGHT_NUDGE_PX`, at the badge's own 10px font) — enough to clear
the timer without giving back enough of the lift to land back on the chip
figure it exists to avoid.

**Tapping outside a panel now closes it.** `renderPanel` mounts a dim backdrop
behind the panel whenever `onClose` is given — covers the player panel, the
players list and Settings, since all three already pass one. A tap fires the
same `onClose` the ✕ does. The backdrop is torn down with its own
`tph-backdrop-<marker>` class, never `.tph-panel` or the bare marker, so it
follows the exact per-panel teardown isolation the panels themselves already
had (see "Panels go through renderPanel", CLAUDE.md) — one backdrop being
mounted must not disturb another panel's.

The panel's own outer margin grew from 5% to 8% a side at the same time, so
there is a real margin to tap outside rather than a 5%-wide sliver against the
table edge. Paid for by trimming the Stats table's cell padding (4px 3px ->
3px 2px) and rebalancing its column widths (33/27/40 -> 30/26/44): the label
column is short static words with room to give up, so the reclaim goes to the
value and note columns — the two that carry nowrap numbers and can't wrap onto
a second line.

**The Stats tab's "By street — aggr/fold" section moved above "Stack this
sitting."** It's read far more often and used to sit below the stack bar,
tables-played and last-seen sections, requiring a scroll to reach.

8 new assertions in `test/panel.test.js` cover backdrop creation, the
click-closes behaviour, and that one panel's backdrop survives another panel
opening and closing — the same isolation property the original panel teardown
tests lock down for the panels themselves.

## 1.6.0

Hero's own VPIP really was split across two records. Root cause found from a
live deep scan that printed `heroGhost(name:Wonkawee): EXISTS` with 2174 hands
tracking almost 1-for-1 against `heroRecord`'s 2571 — an active, ongoing split,
not stale history left over from before identity resolution worked. The
ghost's raw vpip/pfr counts (1198/662) were far higher than the real record's
(166/89): nearly every one of hero's own voluntary preflop actions was landing
on the ghost instead.

**Root cause.** `nameToXidGuess` resolves a log line's actor name to a seat by
matching seat TEXT — a profile link, the seat's own name element, or, as a
last resort, the whole seat blob. `heroXid` itself resolves by a completely
different path: the seat's `self___` marker (0.22.0), which never looks at the
username at all. Nothing guarantees Torn's own seat prints the sitting
player's OWN username where the text-matching passes look for it the way it
reliably prints an opponent's — evidently it does not, on this layout. So
every one of hero's own log lines ("Wonkawee called $X") failed all three
passes and fell through to the `name:Wonkawee` pseudo-id, every time, while
`dealtInXids` and `STORE.hero.hands` — both keyed off the seat's numeric XID,
never off a name — kept accruing correctly on the real record. That is why the
split was invisible in hand counts and visible only in the log-driven rate
stats.

**The fix.** `nameToXidGuess` now checks, before touching any seat, whether
`heroXid` is already resolved and the name being resolved matches the
configured username (case-insensitively, since Torn login is). If so it
returns `heroXid` directly — no seat text involved for the one player whose
real XID is already known by another, more reliable means.
`test/name-boundary.test.js` pins this. The harness cannot drive the
seat-matching passes at all (`SELECTORS.seatContainer` never matches against
the stub DOM — see that file's own header), which makes it the right tool for
this exact assertion: with no seat able to match anything, the only way
`nameToXidGuess` can return `heroXid` rather than the pseudo-id is the new
direct check.

**The historical ghost data is not merged automatically.** `mergePseudoPlayer`
bails once the real record already exists — by design, see "Names must be
bound explicitly" — so the 2174 already-split hands stay in `name:Wonkawee`,
untouched. Reconciling them into the real record risks double-counting, since
the real record's hand count is already complete via the seat-XID path.
Recommend "Reset my stats" (1.5.0) to clear both once this fix is live; going
forward hero's own log lines resolve correctly, so the numbers will not
re-split.

**Two other open items closed by the same scan, no code changes needed.** The
1.4.0 P/L fix is confirmed: both no-showdown win lines in the scan parsed as
`-> wins`, not `-> shows`. And `SELECTORS.seatState` is confirmed: the scan
was taken with a real player sitting out, and the "Sitting out" text probe
matched nested inside that exact seat.

## 1.5.1

Ran `node test/run.js` for the first time since 1.0.0 — every version from
1.0.1 through 1.5.0 shipped verified only by a JXA parse-check, per their own
commit messages ("the full N-file suite has NOT been run"). It crashed
outright before a single assertion executed: the test-only export block
(gated on `window.__TPH_TEST_HOOKS`, zero production effect) referenced
`recordShownHand`, a name that was never a real function. 1.1.0 added that
export line, but the showdown recorder had always been `noteShowdown` — a
copy-paste mismatch, not a rename that missed a call site. That one bad
reference took down all 27 test files at once, including the 26 that had
nothing to do with showdown ranges.

Two more failures were real once the suite could run at all, and both were the
same shape: an intentional behaviour change shipped without Node to check it,
and the test's expectation was never updated to match.

- `buildRangeHtml`'s group titles moved from one combined "raised" bucket to
  per-tier ones (Opened / 3-bet / 4-bet+ / Limp-3bet / Called) in 1.1.0.
  `test/reads.test.js` still searched the rendered HTML for the old title,
  "Raised preflop", which no longer exists anywhere in the file.
- `currentExploitTip` stopped returning `null` for a player under `minHands`
  and started returning a flagged, provisional read instead — the entire
  point of 1.3.0's "coach speaks up about new players" change. The test still
  asserted the pre-1.3.0 behaviour (`null`).

Both tests are updated to match the shipped, intentional behaviour; neither
required a code change. Net effect: none of 1.0.1 through 1.5.0's actual
runtime behaviour was wrong. The suite was just unable to say so, for want of
one correct identifier in a block that never ships to a player's phone.

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
