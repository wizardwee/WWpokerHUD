// ==UserScript==
// @name         Torn Poker HUD
// @namespace    torn-poker-hud
// @version      0.31.0
// @description  Opponent tendency HUD, GTO-inspired coach prompts, per-player P/L, and tendency reports for Torn holdem, built for Torn PDA custom scripts.
// @match        *://www.torn.com/page.php?sid=holdem*
// @match        *://torn.com/page.php?sid=holdem*
// @updateURL    https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js
// @downloadURL  https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js
// @grant        none
// ==/UserScript==

/*
 * CHANGELOG (newest first). Bump @version above in the SAME commit as any
 * behaviour change — nothing automates it, and userscript managers compare
 * @version to decide whether an update exists. A stale value means a reinstall
 * won't see new code as newer.
 *
 * 0.31.0 - Effective stack is now honest, and the badge says what it means.
 *          EFFECTIVE STACK — effectiveStackVs(hand, villain) replaces
 *          effectiveStack(hand), fixing two things that were quietly wrong:
 *            - Hero is always in the calculation. The old version took the
 *              minimum across live players, so if hero's own seat failed to
 *              parse it reported the shortest VILLAIN — a number that can be
 *              far larger than what you can actually lose, shown with no
 *              warning. Without your stack there is no honest answer, so the
 *              line is now absent instead.
 *            - Pairwise when there is someone to be pairwise with. Against a
 *              specific opponent the figure is min(you, them); the table
 *              minimum is only right with no particular opponent in mind, and
 *              using it while facing a bet understates what is at stake against
 *              the player actually betting. The line names who it is against.
 *          SPR now uses the pot as it stood at the START of the street
 *          (hand.potAtStreetStart) rather than the live pot, which shrank the
 *          number while you were deciding — the opposite of what SPR is for.
 *          Preflop it is omitted entirely; SPR is a postflop concept.
 *          BADGE — archetypes abbreviated to three letters (BAL, STA, NIT, TAG,
 *          LAG, MAN, FSH) so the numbers have room, and the numbers are now
 *          LABELLED: "STA 15h V74 P12 A16". Previously they were bare figures
 *          whose COUNT changed with the badge mode — two in session mode, three
 *          in lifetime — which is worse than either. V and P follow the
 *          selected window; A is always lifetime, because postflop samples are
 *          too scarce for a 15-hand window to be anything but noise. Settings
 *          now spells the whole format out.
 * 0.30.0 - Coach panel cut down. It is read mid-decision on a phone, so every
 *          line has to earn its place; it had grown to nine.
 *          Removed outright:
 *            - The standing footnote. Four lines of disclaimer read once and
 *              ignored forever. The honesty it carried now rides inline where
 *              it applies and costs a word: "Baseline" (never "GTO") on chart
 *              lines, "Eq vs random" on equity, and the ⚠ short-stack note when
 *              the ~100bb assumption is actually broken — the only time that
 *              caveat changes anything.
 *            - "▶ Your turn". The green border says it, louder.
 *            - The table name. It never changes a decision; it is in Settings.
 *          Compressed:
 *            - Stack line is now "18bb eff · SPR 2.4 low" — the cash figure
 *              added nothing that bb does not.
 *            - Equity drops from three quotes to two. Live is what the decision
 *              turns on, full-ring is the stable reference; the heads-up
 *              ceiling was a third number for a spot you are usually not in.
 *              Pot odds folded onto the same line: "need 33% ✓ +EV call".
 *            - Self-tilt and the exploit line are one short sentence each, and
 *              the exploit now leads with fold-to-c-bet, which is the most
 *              directly actionable number the HUD has.
 * 0.29.0 - Tilt watches YOU too, gets a big-loss trigger, and stops borrowing
 *          the fire emoji.
 *          - 🤮 is now tilt. 🔥 is a separate, new read: RUNNING HOT, someone
 *            winning far more recent pots than the seat count makes likely.
 *            Both can be true at once — steaming and getting there are
 *            different questions.
 *          - Self-tilt. Badges deliberately skip hero's seat, so the one player
 *            the HUD could never warn about was you — the case where it is
 *            worth most. The coach panel now carries the same read, since
 *            hero's record accumulates exactly like anyone else's.
 *          - Surfacing fixed. It used to be a bare emoji on the badge with the
 *            explanation in a `title` tooltip, which a touchscreen cannot show.
 *            Now in the players list, at the top of the Stats tab, and in the
 *            coach — with the reason written out.
 *          - A recent big pot loss (75bb+) LOWERS the tilt bar from 20pp to
 *            12pp rather than triggering on its own. Losing money is not tilt:
 *            a player stuck three buy-ins who keeps playing their game is not
 *            tilting. But a big loss raises the prior that a VPIP spike IS tilt
 *            rather than a run of playable cards, so less behavioural evidence
 *            carries the same weight. The sting expires after 20 hands.
 *          - The tilt window is capped at 15 hands regardless of the badge's
 *            sessionWindow setting. Tilt is short-lived; read over 40 hands the
 *            stretch blends back into normal play and the signal fades exactly
 *            when it is truest.
 *          `recent` now packs a "won" bit alongside the play state. Values
 *          written before it existed are 0-2 and read correctly as "did not
 *          win", so no migration was needed.
 * 0.28.0 - Stats panel fits the screen, and the turn cue knows whose turn it is.
 *          WIDTH — the Stats table now uses table-layout:fixed with explicit
 *          column widths, so a long label or a wide number can no longer push
 *          it past 100%; without it the browser sizes columns to min-content
 *          and a phone scrolls sideways. Bars are a FIXED 46px rather than a
 *          percentage of the cell — the proportional bar was the main culprit.
 *          Labels shortened (Fold v 3B, Fold v CB, Limp), and the disclaimer
 *          cut from five lines to one. Outlier rows now carry a tinted
 *          background as well as a coloured value, since colour on one number
 *          is easy to miss at arm's length.
 *          TURN DETECTION — was: "any single-action button is on screen". The
 *          live scan showed why that is wrong: "Call Any / Check", "Check" and
 *          "Check / Fold" were all present WHILE WAITING, and the bare "Check"
 *          survives the pre-action filter and reads exactly like a turn button.
 *          The screen was glowing for most of the hand.
 *          Seats carry `active___` marking who is on action (confirmed in the
 *          same scan). isHeroTurn now compares that against hero's seat and
 *          falls back to buttons only when no active seat can be read.
 *          Added a second, quieter state: an amber STATIC border when you are
 *          the next player to act, walking the seat ring from the active seat
 *          and skipping anyone folded or sitting out. Static on purpose — two
 *          pulsing states compete, and this one is a heads-up, not an alarm.
 * 0.27.0 - Fold misclick guard, and a chime to go with the buzz.
 *          FOLD GUARD (on by default) — tap Fold once to arm, again to confirm.
 *          This is the only code in the HUD that touches the game's own
 *          controls, so it is built to three rules, all covered by tests:
 *            1. It NEVER folds for you. There is no synthetic click anywhere in
 *               it; the second tap is your real tap, passed through untouched.
 *            2. It FAILS OPEN. Any error, any unrecognised element, and the
 *               click goes through — a guard that swallowed a genuine fold
 *               would be worse than no guard.
 *            3. It only ever intercepts Fold. Call, Raise and Check are never
 *               delayed, and neither are the HUD's own buttons.
 *          A second tap within 250ms is treated as a fat-finger double-fire and
 *          swallowed rather than accepted as confirmation. Missing the 4s
 *          window costs nothing: Torn folds you on timeout anyway, so hesitating
 *          produces the outcome you were choosing regardless. "Check / Fold" is
 *          guarded too — a misclicked pre-action fold still folds the hand.
 *          TURN CHIME — synthesised with Web Audio, so there is no asset to host
 *          and nothing for the webview to block. Phones refuse audio until the
 *          page has been tapped, so the context is primed on the first tap
 *          anywhere; without that the first chime of a session is silently
 *          dropped and the setting looks broken. Settings has a Test button
 *          because webview audio is unreliable enough to need one.
 *          (Vibrate already shipped in 0.26.1 — same section.)
 * 0.26.1 - Hard-to-miss "it's your turn" cues: a pulsing border around the
 *          viewport, the gear button turning green, and the coach header with
 *          it. On a phone the action buttons are small and easy to miss,
 *          especially with the coach collapsed.
 *          The overlay is pointer-events:none, and that is not optional — it
 *          covers the whole viewport, and one tap swallowed on a fold or call
 *          would be far worse than any cue is good. The HUD stays advisory: it
 *          must never come between you and the table.
 *          Driven by findTurnButtons(), not findActionButtons(). Torn shows
 *          pre-action controls while you are WAITING, so cueing on those would
 *          leave the screen glowing for most of the hand — the same as no cue.
 *          Polled at 400ms rather than on the coach's 1.5s tick: a cue that
 *          arrives late has already eaten part of the decision clock. Optional
 *          single buzz on the rising edge, off by default. Honours
 *          prefers-reduced-motion by holding the highlight static rather than
 *          dropping it, since it is load-bearing.
 * 0.26.0 - Four features adopted from HopesG's HUD, plus the guard that makes
 *          one of them safe.
 *          RANGE TAB — what a player has actually SHOWN DOWN, split by whether
 *            they raised or called preflop. This is the only direct evidence of
 *            anyone's range in the HUD; everything else infers one from
 *            frequencies. The raw material was already being captured and
 *            thrown away: hand.shown held the revealed cards and nothing ever
 *            read it. Showdowns are banked at SETTLEMENT, not when the reveal
 *            line lands — at that point hand.winners is still empty, so every
 *            showdown would have scored as a loss.
 *          RECENT FORM — badges now read the last N hands (default 15) rather
 *            than lifetime, falling back to lifetime while the window is thin.
 *            A nit who has just started playing every hand is the read that
 *            matters, and a lifetime average hides it. Stored as one digit per
 *            hand per player, not hand records — the store already grows
 *            unboundedly.
 *          TILT — 🔥 on a player whose recent VPIP is 20+ points above THEIR OWN
 *            baseline. Tilt is behavioural, not financial: a player stuck three
 *            buy-ins who keeps playing their game is not tilting, and a station
 *            who always plays 70% is not either. The baseline excludes the
 *            recent window, so a long tilt stretch can't quietly raise the very
 *            number it is measured against.
 *          STAKES LADDER — blind level identifies the table, so the coach names
 *            it and the tier. Two levels are corroborated by scans from this
 *            device: $1M River Wizard and $2.5M Cat's Chance. Since you play
 *            both, lastSeenBB now notices a table switch instead of carrying a
 *            stale blind across.
 *          The ladder also gates a real hazard it revealed. Torn can render
 *            amounts as "181.00 BB" rather than "$181,000,000", and in that mode
 *            every figure parses six orders of magnitude too small with nothing
 *            looking broken. A blind under $10 is refused: P/L is withheld for
 *            that session rather than written wrong, and Settings and the deep
 *            scan say so.
 *          applyHandResults now reads its sets defensively. A throw there loses
 *            the entire hand including the P/L, so dropping one stat is by far
 *            the better failure.
 * 0.25.1 - P/L shows both units everywhere. The players list column leads with
 *          big blinds and carries the chip figure underneath; the Stats tab has
 *          one P/L row with bb in the value column and chips in the pool column.
 *          A player tracked before 0.23.0 has real chip P/L and a zero bb
 *          figure, so there the chip figure is promoted to the top line and no
 *          bb figure is shown — "+0.0bb" reads as "flat against them" rather
 *          than "not measured yet", which is the opposite of the truth.
 *          Also fixes two rows left over from the 3-column Stats table: the
 *          "By street" and P/L headings still used colspan="2", so they and the
 *          per-street rows were short a cell.
 * 0.25.0 - Stats are now read at a glance instead of being read. Every
 *          percentage in the Stats tab renders as a bar with a tick marking the
 *          pool average, plus a "Pool" column and ▲▼ when the deviation is worth
 *          acting on. The players list colours VPIP/PFR the same way and carries
 *          a pool-average reference row.
 *          POOL_SPREAD gives each stat its own scale, which is the whole point:
 *          5pp on VPIP (norm 51) is noise, 5pp on 3-bet (norm 3.7) more than
 *          doubles it. One shared threshold would call the first notable and the
 *          second typical — exactly backwards. It is a judgement call, not a
 *          measurement, and says so.
 *          Colour comes from the SHRUNK figure while the printed number stays
 *          RAW: a two-hand player really did VPIP 100% and the tab should say
 *          so, but lighting the row up as extreme off two hands is reading noise
 *          as a read. Colours are grey/amber/orange, never red/green — high VPIP
 *          is not "bad", it is loose, and a good/bad palette asserts a judgement
 *          the HUD is in no position to make. Direction comes from the arrow.
 *          The players list P/L column now shows big blinds, falling back to
 *          chips for players tracked before 0.23.0 — printing "+0.0bb" there
 *          would read as "flat against them" rather than "not measured yet".
 *          Note for anyone adding UI: pinTextColor deliberately SKIPS elements
 *          carrying a tph- class, so a new tph- cell with no colour of its own
 *          is left for Torn's bare td rule to darken. That is the 0.18.2 bug,
 *          and these rows hit it — every tph- element holding text now declares
 *          its own colour.
 * 0.24.0 - Fixes from the first live scan of the 0.22.0 work. Most of it held:
 *          `self___` resolved hero to a real XID (heroXid: 311421, P/L bound at
 *          last), `dealer___`+`position-2___` resolved the button, all 9 stacks
 *          read, the PDA bridge is present, and the action buttons were found
 *          by text. `playerPositioner-<N>___` DOES exist on PDA after all — the
 *          earlier "no index on mobile" reading was the top-45 truncation
 *          hiding eight count-1 classes, the same way it hid `self___`.
 *          Three real problems, none of them in the new code:
 *          - THE BOARD HAS NEVER BEEN READ. `communityCards_` matched zero with
 *            five cards face-up, so every postflop equity number came from the
 *            log-parsed fallback or nothing at all — and a preflop-looking
 *            equity number is entirely plausible, so it never surfaced.
 *            readBoardCards now derives the board from confirmed structure: any
 *            face-up card not inside hero's hand and not inside a seat.
 *          - "JDWV posted $2,500,000" was unparsed — a dead blind posted on
 *            rejoining. Real money into the pot, previously invisible. Added as
 *            `postDead`: contributed, but NOT counted as VPIP or a limp, since
 *            it is forced.
 *          - The buttons found were "Check / Fold" and "Call Any / Check" —
 *            PRE-action controls shown while waiting, not turn buttons. Counting
 *            them made isHeroTurn true for most of the hand, the same failure
 *            as the hole-cards fallback it replaced. Only single-action labels
 *            count now; heroCanPreAct() reports the rest.
 *          HUD_VERSION had been stuck at 0.19.0 since 0.19.0, so every deep scan
 *          from four releases reported the wrong version in its header — the
 *          first line anyone reads when debugging. test/version.test.js now
 *          fails if it drifts from @version, or if a release has no changelog
 *          entry. The file header already carried that rule in prose; prose was
 *          not enough.
 * 0.23.0 - Everything is expressible in big blinds, and three stats that were
 *          already being collected are finally visible.
 *          CORRECTION: 0.22.0 set POOL_AVG.wtsd = 20.9, taken from the source's
 *          `wwsf` (won when saw flop) — a different statistic from went-to-
 *          showdown. WTSD is now left UNSHRUNK, like AFq, rather than anchored
 *          to an unrelated number. The correctly-mapped foldToCbet (56.1) and
 *          limpShareOfVpip (44.8) are added in its place.
 *          - hand.bbAmount is read off the postBB line, with a session-level
 *            last-seen fallback for hands joined mid-way. hero.netBB and
 *            plBBEst accrue alongside the chip figures, converted AT SETTLEMENT
 *            because the blind level cannot be recovered afterwards. The
 *            players list shows a bb/100 win rate, withheld under 50 hands
 *            where it would be pure noise.
 *          - Fold-to-c-bet has been collected since C-bets were added and
 *            displayed nowhere. Now in the Stats tab and the report, with a
 *            read attached: over 60% and c-betting them prints.
 *          - streetActions has always held per-street counts that computeRates
 *            collapsed into one AFq. Split out, plus fold-frequency per street.
 *            A player who fires flops and gives up on turns was invisible.
 *          - Limp frequency, tracked per player and reported as a share of
 *            VPIP against the pool's 44.8%. Against a pool this passive the
 *            habitual limper is the most exploitable seat, and was previously
 *            indistinguishable from a caller.
 *          The coach now warns when effective stack is under 40bb that the
 *            baselines are ~100bb charts, and under 20bb that the real decision
 *            is push-or-fold. That assumption was previously only in a footnote,
 *            which was defensible while depth was unknown and is not now.
 *          ensureHeroShape backfills the new hero fields: a 0.22.0 store has
 *            only {hands, netChips}, and an undefined netBB would make every
 *            += produce NaN and poison the figure permanently.
 * 0.22.0 - Adopted findings from HopesG's public Torn poker HUD (MIT, GreasyFork
 *          569933), read as a reference. Selector work here is UNCONFIRMED on
 *          Torn PDA's layout — every addition degrades to the old path rather
 *          than replacing it, and the deep scan now reports on each one.
 *          - Hero's seat is marked `self___`, not `hero_`/`you_`. findHeroXid
 *            now reads the DOM marker FIRST, so P/L works with the Settings
 *            username left blank and the "name:" pseudo-id window closes.
 *          - Action buttons are matched by LABEL, not by a hashed container
 *            class that has never matched. isHeroTurn works, and the coach says
 *            "Your turn" when it is.
 *          - The dealer button is real: `dealer___` carries `position-<N>___`,
 *            or `position-self___` when you hold it. getDealerXid reads it.
 *          - "Sitting out" is detectable via the seat's `state___` text. Those
 *            seats are dropped from the position ring and the hands
 *            denominator, closing a documented off-by-one in every label.
 *          - Stacks are read off the seats, so the coach reports real effective
 *            stack and SPR instead of leaving commitment unmodelled.
 *          - PDA is detectable via window.flutter_inappwebview, which also
 *            exposes a native share handler. Backup can now save a real file
 *            instead of only filling a textarea.
 *          Archetypes are recalibrated to the TORN pool (VPIP ~51 / PFR ~13,
 *          against ~25/18 for live poker). The old thresholds classified almost
 *          the whole population as "Fish" — accurate and useless. Thresholds
 *          are now written as multiples of POOL_AVG so correcting the anchor
 *          moves the labels with it, and rates are shrunk toward the pool
 *          average with a 12-observation prior before classifying, so two hands
 *          played out of two no longer reads as a 100% VPIP maniac. Added a
 *          "Station" archetype for the very loose and very passive.
 *          POOL_AVG is BORROWED, not measured here — the players list now shows
 *          your own observed pool average beside it so the assumption can be
 *          checked as hands accrue.
 * 0.21.0 - Testability seam, and the panel bug it immediately caught.
 *          Opening a player panel while Settings was up made the next gear tap
 *          do nothing. renderPlayerPanel tore down `.tph-panel` — the class
 *          EVERY panel carries — rather than its own marker, so it deleted the
 *          settings panel from the DOM while `settingsOpen` stayed true; the
 *          gear then toggled the flag back to false and rendered nothing.
 *          All three panels now go through renderPanel(), which requires a
 *          marker class, scopes teardown to it, and runs pinTextColor AFTER
 *          the caller's wire() step so late-mounted content can't render
 *          dark-on-dark the way it did in 0.18.2.
 *          Added window.__TPH_TEST, exposed only when a harness sets
 *          window.__TPH_TEST_HOOKS before load, plus test/ (harness + three
 *          test files, run with `node test/run.js`). Harnesses used to recover
 *          functions by slicing this file with indexOf/eval against literal
 *          markers, which broke on every rename. Nothing about the install
 *          model changes: still one file, still no build step, and test/ never
 *          ships.
 * 0.20.0 - P/L was frozen at zero for everyone, and the cause was one truthy
 *          string. findHeroXid() returns the pseudo-id "name:<username>" when it
 *          can't find hero's seat, and the 3s retry was guarded by `if
 *          (!heroXid)` — a pseudo-id is truthy, so the failed bootstrap
 *          resolution latched in for the whole session. That retry exists
 *          precisely because seats render after the log container, so it was
 *          defeating its own reason for being there.
 *          The damage was silent and total. Hero's own log lines re-run
 *          nameToXidGuess every time and DO resolve once seats render, so
 *          contributions/winnings keyed under the real seat XID while heroXid
 *          still held "name:...". heroWon and heroContributed both read 0,
 *          heroDelta came out 0, and every plChipsEst got `0 * share`.
 *          hero.netChips never moved, hero.hands never incremented (dealtInXids
 *          holds real XIDs), and `xid === heroXid` failed to skip hero — so you
 *          were tracked as your own opponent and badged on your own seat.
 *          Retry now tests heroUnresolved() instead. Stored P/L can't be
 *          rebuilt from partial history, so a one-time store migration (schema
 *          2) zeroes every plChipsEst, hero.netChips and session.net. Hand
 *          counts and rate stats were never affected by this and are kept.
 * 0.19.0 - Nothing opens itself on load any more. The green "HUD loaded" banner
 *          is gone entirely — the red gear button already proves the script
 *          injected, and it doesn't cover the table for 15 seconds to do it.
 *          (Calibration mode still opens its panel when the setting is on; that
 *          is the point of it, so switch it off when you're done scanning.)
 *          Every coach line now names the position, on every street. Postflop
 *          lines omitted it entirely, so the seat vanished from the advice the
 *          moment the flop came down — exactly when you most want to check the
 *          advice against where you're sitting. The tag distinguishes how the
 *          seat was derived: "CO" read from the seat ring, "CO?" derived from
 *          the log's action order, "?" not established (with the reason).
 * 0.18.2 - The dark-on-dark text was never specific to the hand history: the
 *          Stats table and the Report <pre> were unreadable too, in the same
 *          panel, which a screenshot of the Stats tab made obvious. Cause:
 *          `.tph-panel { color: #eee }` only reached its children by
 *          INHERITANCE, and inheritance loses to any direct rule on the child —
 *          no !important needed. Torn styles bare `td` and `pre`, so exactly
 *          those went dark while the panel title and tab labels (which Torn has
 *          no rule for) stayed fine. pinTextColor() now walks each panel after
 *          render and sets `color: inherit !important` inline on every element
 *          that isn't one of ours, which no stylesheet can override. Elements
 *          carrying a tph- class are skipped so warnings and history colours
 *          survive.
 * 0.18.1 - Hand history text was dark-on-dark on the live page. Two class-based
 *          attempts failed (a recessed card relying on inherited colour, then a
 *          lighter card with !important in our own stylesheet) while the Stats
 *          tab in the SAME panel rendered fine — which rules out the panel and
 *          inheritance, and means a Torn rule was beating ours on specificity.
 *          Colours are now inline with !important, the highest-priority
 *          declaration in CSS, so no page stylesheet can override them. The
 *          Report tab's <pre> is pinned the same way, since bare elements like
 *          <pre> are exactly what a page stylesheet is most likely to target.
 *          Layout is unchanged — only the colours are forced.
 * 0.18.0 - Fixes from the first live deep scan (v0.17.0, 5-handed table).
 *          The coach was printing "defend roughly NaN% of your range (MDF)":
 *          minimumDefenseFrequency computed pot/(pot+bet), and BOTH were zero
 *          because the log snapshot is primed rather than parsed on attach, so
 *          hand.pot starts at 0 whenever the HUD loads mid-hand. It returns null
 *          now and the coach says the pot is unknown instead of printing NaN.
 *          Root fix: the pot is read from the table. The scan confirmed
 *          DIV.potsWrapper_ > DIV.totalPotWrap_ renders "POT:$7,000,000", so
 *          readDomPot parses it and effectivePot prefers it over the running log
 *          sum. This closes the longest-standing known gap — the pot previously
 *          had NO cross-check, and any missed amount skewed pot odds and MDF for
 *          the rest of the hand with nothing to detect it.
 *          Equity was quoted "vs 8 (9-max)" at a five-handed table because the
 *          baseline came from the tableMax setting; it now uses the seat count
 *          observed that hand. Sub-1% equity printed a flat "0%", which reads as
 *          "cannot win" rather than "under one percent" — it shows "<1%" now.
 *          Deep scan reports both pot figures and flags a mismatch, plus heroXid
 *          and why it failed to resolve.
 * 0.17.0 - Per-opponent P/L was wrong, not just badly formatted. Each opponent's
 *          share was their contribution divided by the total contributed
 *          INCLUDING hero's own, so the shares never summed to 1 — heads-up,
 *          where both players put in half the pot, a villain was credited with
 *          exactly HALF the money you won from them. It also charged your losses
 *          to opponents who folded early and lost nothing to you, while
 *          crediting nothing extra to whoever actually took the pot. Attribution
 *          now splits by each opponent's NET result: money you win comes from
 *          the players who lost, money you lose goes to the players who won.
 *          Exact heads-up, and sums to your own delta multiway.
 *          Money now goes through one formatter everywhere — "$12.5M", "$41k",
 *          "$9,999" — replacing bare digit strings with no grouping at all,
 *          which is what the P/L readouts in the Stats tab and report printed.
 *          Failure to identify hero is surfaced in Settings and the players
 *          list. With heroXid null, P/L attribution is skipped for EVERY player
 *          and a tendency badge is drawn on your own seat; those look like two
 *          separate bugs and are the same unset/misspelled username.
 * 0.16.1 - Deep scan reports the script version that produced it, via
 *          HUD_VERSION (which must be bumped alongside @version — the userscript
 *          header is a metadata comment and can't be read from JS).
 * 0.16.0 - Usernames are actually recorded. Hand history showed "#3722665"
 *          instead of names because nothing ever bound a name to an XID:
 *          getPlayer(xid, name) accepts a name and was never once called with
 *          one, so emptyPlayer() stored its "#<xid>" placeholder as the player's
 *          real name and playerDisplayName returned it forever. The name was
 *          known at the point nameToXidGuess resolved the seat and was simply
 *          discarded. Two sources now feed it: that resolution point, and
 *          harvestSeatNames, which reads the seat's own name element —
 *          SELECTORS.seatName was declared and read by nothing until now, so a
 *          player who never acted was never named either. Records already
 *          holding the placeholder repair themselves on sight, and hand history
 *          re-renders correctly because it stores XIDs, not names.
 * 0.15.0 - Position is read from HERO'S SEAT, not from the action. It used to
 *          assume "hero must be the next seat to act" whenever hero wasn't yet
 *          in the log's action rotation — true only at hero's own decision
 *          point, but the coach re-renders continuously (actionButtons matches
 *          nothing, so it falls back to "hole cards visible"), so the index grew
 *          with every opponent who acted and the label followed whoever was on
 *          action. Seats are now ordered by their on-screen geometry and rotated
 *          so the small blind is first, with the big blind fixing the direction;
 *          the log rotation is a fallback used only once hero has really acted.
 *          heroIsInPositionVs had the same flaw and silently picked the looser
 *          in-position 3-bet chart; it now uses the seat ring or returns unknown.
 *          Seat badges show a TYPE again — below the hand minimum they show the
 *          provisional archetype with a "?" instead of just "13h", which said
 *          nothing about the player. History cards and the panel now pin their
 *          own colours (!important, no inherited text colour, card LIGHTER than
 *          the panel) because Torn's stylesheet was leaving them unreadable.
 * 0.14.0 - Hand history in the player panel is rendered as one block per hand
 *          instead of up to 40 hands run together in a single monospace <pre>
 *          on the panel's own background; the tracked player's actions are
 *          coloured rather than marked with an asterisk. Clipboard output is
 *          unchanged (still plain text).
 *          Review fixes: (1) seat counting ignored the "name:" pseudo-ids that
 *          nameToXidGuess falls back to, so ONE unmatched log name inflated the
 *          table size by one and shifted every position label by a seat —
 *          exactly the drift the position notes describe; (2) cross-device hand
 *          merging deduped on timestamp, so two devices at one table recorded
 *          every shared hand twice — it now prefers Torn's game id; (3) a
 *          player record missing a street inside streetActions threw in
 *          computeRates and took the panel down, and records are now repaired at
 *          load rather than only on getPlayer access, since renderBadges and the
 *          players list read STORE.players directly.
 * 0.13.0 - Preflop charts re-grounded in published sources instead of recall,
 *          and full-ring support added. There are now TWO chart sets, picked
 *          from the seat count observed that hand: at a 9-handed table four
 *          distinct early seats used to share one "EP" label and one 6-max
 *          chart, so true UTG was opening ~17% where published full-ring UTG is
 *          ~11%. Positions at 7+ handed tables are named UTG/UTG1/LJ/HJ/CO/BTN.
 *          6-max early position widened to match sources (EP 15.5->17.3%,
 *          MP 19.5->21.0%). Every published range string was re-measured against
 *          its own published percentage before use — several disagree with
 *          themselves, usually by omitting the offsuit block. Sources cited at
 *          RFI_RANGES. "GTO baseline" relabelled "Baseline" with a provenance
 *          footnote: these are reference charts, not solver output, and the old
 *          wording claimed the authority of an equilibrium solution.
 * 0.12.0 - Preflop coach corrected. Every opening chart but the button was far
 *          too tight (EP 10.3%, MP 14.3%, CO 22.8%, SB 30.9% of hands), so it
 *          advised folding standard opens; they are now 15.5/19.5/26.4/41.8/
 *          42.1%, measured by combo weight and documented per line. The chart is
 *          now picked by SITUATION, not by whether a bet exists: unopened,
 *          limped (isolation, not RFI), facing one open, facing a re-raise, and
 *          hero-already-opened are separate cases. The out-of-position 3-bet
 *          range was defined but never used — every 3-bet call was made off the
 *          in-position chart; unknown relative position now takes the tighter
 *          one. Big blind no longer silently borrows the cutoff opening range.
 *          Facing a 3-bet is called a 4-bet decision instead of a 3-bet. Fixed
 *          the "A5s-A9s" range token, whose backreferences were on the wrong
 *          groups so it expanded to nothing without error.
 * 0.11.0 - Log ingestion reads whole-list snapshots and diffs them instead of
 *          parsing MutationObserver added-nodes. Torn rewrites the TEXT of
 *          existing <li> rows as the list shifts, so every old line was seen
 *          again on every new line and the 1.5s text dedup couldn't suppress it
 *          — one real hand landed in the history several times and every stat
 *          was inflated with it. Hand records also carry the "Game <hex>" id now
 *          and a repeated id is ignored. Seat badges moved BELOW the seat (they
 *          were covering the player name), restyled to be unobtrusive, and can
 *          be switched off in Settings. The collapsed GTO pill is draggable like
 *          the expanded panel; it previously had no drag handler at all.
 * 0.10.0 - Hand boundaries now match Torn's real "Game <hex> started" wording;
 *          before this no hand ever ended, so actionOrder accumulated across
 *          hands and every derived position was nonsense. Streets match
 *          "The flop:  5c, 7d, Ad" (definite article, double space), so the
 *          board is read from the log and the street advances. Showdowns say
 *          "reveals". Preflop position is inferred from turn order when hero
 *          hasn't acted yet, rendered as "CO?" to mark it as inferred; table
 *          size comes from the seats so a sit-out no longer shifts every label.
 *          Position-unknown now names the precondition that actually failed
 *          instead of always blaming the username.
 * 0.9.0  - Selectors calibrated against a live deep scan: log rows are read via
 *          the enclosing <li> (the actor lives in a sibling span, and reading
 *          the mutated inner span alone dropped the name, which is why no stat
 *          ever recorded). Seats identified by id="player-<XID>" rather than
 *          absent profile links. Class matching switched to a single trailing
 *          underscore, since Torn emits both name___hash and name_hash.
 *          Coach panel gained a header to drag it and a Hide toggle; equity is
 *          always quoted against a full ring plus live and heads-up counts.
 * 0.8.0  - Fix dead stats pipeline, past-tense log parsing, sync crash.
 * 0.6.0  - Equity engine, position detection, hero identity, session tracking,
 *          bet-sizing tells. (0.7.0 was never released.)
 * 0.5.1  - Never export or sync the GitHub token.
 * 0.5.0  - Hand history recording + tracked-players browser.
 * 0.4.0  - Draggable HUD button, position persisted.
 * 0.3.0  - Deep-scan DOM inspector + body-fallback log observer.
 * 0.2.0  - Initial: opponent tendency HUD, coach prompts, per-player P/L,
 *          Gist sync.
 *
 * KNOWN UNRESOLVED: actionButtons and dealerButton match nothing on the live
 * table. dealerButton is a red herring for position — it is declared in
 * SELECTORS and referenced nowhere else; position comes from the log.
 *
 * KNOWN GAPS (reviewed, deliberately not fixed — see CLAUDE.md for the reasoning):
 *  - The pot is tracked ONLY by summing parsed log amounts. SELECTORS.potDisplay
 *    resolves on the live table and is never read, so there is no cross-check:
 *    one missed or unparsed amount silently skews pot odds and MDF for the rest
 *    of the hand, with nothing to notice it.
 *  - STORE.players grows without bound. `lastSeen` is written on every access
 *    and never read, so nothing prunes players you met once. localStorage
 *    failures are caught and logged, which means hitting quota stops saving
 *    silently rather than telling you.
 *  - Calibration mode's 3s refresh only starts if the setting was already on at
 *    load; enabling it mid-session gives a panel that updates on log lines only.
 */

/*
 * SECTION MAP — in the order they actually appear in the file. The numbering is
 * historical (it came from a design plan) and the sections are NOT in numeric
 * order; this list is the honest one, so read it top to bottom.
 *
 *   0. Shared utilities
 *   1. PDA/browser adapter shim
 *   2. Storage layer
 *   3. GitHub Gist sync (Device Flow)
 *   4. Table state capture — DOM selectors, log ingestion, hand state machine,
 *      and profit/loss attribution (there is no separate P/L section)
 *   5. Stat engine
 *   6. Archetype classifier
 *   9. GTO-inspired strategy module (preflop charts + baselines)
 *  12. Card reading, equity, position, session
 *   8. Coach prompts
 *  11. Tendency report
 *   7. HUD overlay (badges, player panel, players list, settings, calibration)
 *
 * CALIBRATION NOTE: Torn's poker page uses hashed/webpack-style CSS module
 * class names. As of 0.10.0 the selectors in SECTION 4 are calibrated against
 * real deep scans, NOT guesswork — log list, log rows, seats, seat names, fold
 * state, pot and hero cards all resolve. The exceptions are actionButtons and
 * dealerButton, which still match nothing.
 * Class names change when Torn redeploys, so if things go quiet: turn on
 * Calibration Mode (gear icon -> Calibration), run a deep scan mid-hand at a
 * live table, and adjust SELECTORS / LOG_PATTERNS from what it reports.
 */

(function () {
  'use strict';

  if (window.__tornPokerHUDLoaded) return;
  window.__tornPokerHUDLoaded = true;

  // MUST match the @version line in the userscript header above. The header is a
  // metadata comment and can't be read from JS, so this is a second place to
  // bump — it exists so a pasted deep scan says which build produced it, which
  // is otherwise unknowable when diagnosing from a phone.
  const HUD_VERSION = '0.31.0';

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

  // Torn PDA is a Flutter webview, and it exposes that bridge on window. Two
  // signals rather than one: the HTTP helpers prove the userscript runtime, and
  // flutter_inappwebview proves the host app even before those are injected.
  function isPDA() {
    return typeof window.flutter_inappwebview !== 'undefined'
      || typeof window.PDA_httpGet === 'function'
      || typeof window.PDA_httpPost === 'function';
  }

  // Hand a text file to the user.
  //
  // `<a download>` silently does nothing inside PDA's webview, which is why
  // backup has only ever been copy-a-textarea. PDA exposes a native handler
  // that opens the system share sheet, so a real file can be saved or sent to
  // another app. Returns true if the file was handed off, false if the caller
  // should fall back to the clipboard.
  function downloadTextFile(text, fileName, mimeType) {
    if (isPDA() && window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
      try {
        // base64 via unescape(encodeURIComponent(...)): btoa throws on any
        // non-Latin1 character, and player names are free text.
        const b64 = btoa(unescape(encodeURIComponent(text)));
        window.flutter_inappwebview.callHandler('shareFile', fileName, b64, mimeType || 'application/json');
        return true;
      } catch (e) {
        console.warn('[TornPokerHUD] PDA shareFile failed, falling back', e);
        return false;
      }
    }
    try {
      const blob = new Blob([text], { type: mimeType || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

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

  // Bumped when stored data needs a one-time repair. See migrateStore().
  const STORE_VERSION = 2;

  const DEFAULT_SETTINGS = {
    minHands: 20,
    githubClientId: '',
    githubToken: '',
    gistId: '',
    lastSync: 0,
    calibrationMode: false,
    gearPos: null, // {left, top} once you've dragged the HUD button somewhere
    coachPos: null,      // {left, top} once you've dragged the coach panel
    coachPillPos: null,  // {left, top} for the collapsed pill — tracked separately
                         // from coachPos so collapsing doesn't teleport the pill
                         // to wherever the big panel happened to be parked
    coachHidden: false,  // collapsed to a pill so it stops covering the table
    showBadges: true,    // per-seat tendency labels; off = table completely clear
    historyLimit: 200, // how many recent hands to keep for the History tab
    // 'session' reads the last `sessionWindow` hands; 'lifetime' reads
    // everything. Session is the default because how someone is playing NOW
    // beats their long-run average — a nit who has just started 3-betting
    // everything is the read that matters, and a lifetime figure hides it.
    badgeMode: 'session',
    sessionWindow: 15,
    turnCues: true,       // pulsing border + green gear when it's your turn
    nextToActCue: true,   // quieter amber border when you're one seat away
    turnVibrate: false, // opt-in: a short buzz on the rising edge only
    turnSound: false,   // opt-in: a synthesised two-note chime
    foldGuard: true,    // tap Fold twice to confirm — see foldGuardHandler
    heroName: '',      // YOUR Torn username. Without it P/L and position can't be attributed.
    equityIters: 1200, // Monte Carlo samples per equity estimate
    tableMax: 9,       // seats at a full table — the baseline equity is always
                       // quoted against a full ring (tableMax - 1 opponents)
  };

  function emptyStore(settings) {
    return {
      version: STORE_VERSION,
      players: {},
      hands: [],   // newest-first ring buffer of recent hand records
      hero: { hands: 0, netChips: 0, netBB: 0, bbHands: 0 },
      session: { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 },
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
      // Preflop call with no raise yet. Counted per hand, and reported both
      // per-hand and as a share of VPIP — against a pool that limps ~45% of its
      // voluntary money, a habitual limper is the most exploitable seat here and
      // was previously indistinguishable from a caller.
      limpMade: 0,
      // Hand class -> { seen, raised, won }. What they have actually turned up
      // with at showdown, which is the only direct evidence of anyone's range.
      // Showdowns are rare, so this stays small even over thousands of hands.
      shownHands: {},
      // Rolling window of the most recent hands, newest LAST. One small integer
      // per hand, used as a bitfield:
      //   bits 0-1 : 0 folded preflop, 1 played, 2 played and raised
      //   bit 2 (4): won the hand
      //
      // Deliberately not a list of hand records — this is stored for every
      // player forever, and the store already grows unboundedly (open finding
      // #2). Values written before the win bit existed are 0-2, which read
      // correctly as "did not win", so no migration is needed.
      recent: [],
      // Value of `hands` the last time this player lost a big pot. "Hands ago"
      // is `hands - lastBigLossHand`, which needs no upkeep between hands.
      // -1 means never.
      lastBigLossHand: -1,
      plChipsEst: 0,
      // Same estimate as plChipsEst, in big blinds. Accumulated at hand time
      // because that is the only point the blind level is known — it cannot be
      // recovered later from plChipsEst. Starts at 0 for players tracked before
      // v0.23.0, so it lags the chip figure until they are seen again.
      plBBEst: 0,
      betSizePctSum: 0, // sum of bet-as-%-of-pot, for average sizing tells
      betSizeCount: 0,
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
      parsed.hero = ensureHeroShape(parsed.hero);
      parsed.session = parsed.session || { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 };
      normalizePlayers(parsed);
      migrateStore(parsed);
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

  // The hero record gains fields too, and `hero || {...}` only helps when it is
  // absent entirely — a store from 0.22.0 has {hands, netChips} and would leave
  // netBB undefined, which turns every += into NaN and poisons the figure
  // permanently. Backfill each key instead.
  function ensureHeroShape(hero) {
    const h = hero && typeof hero === 'object' ? hero : {};
    const t = { hands: 0, netChips: 0, netBB: 0, bbHands: 0 };
    Object.keys(t).forEach((k) => { if (typeof h[k] !== 'number' || isNaN(h[k])) h[k] = t[k]; });
    return h;
  }

  // Records written by an older version lack fields added since; backfill from
  // the template so new stats don't surface as NaN on long-tracked players.
  function ensurePlayerShape(p, xid) {
    const t = emptyPlayer(xid, p.name);
    Object.keys(t).forEach((k) => { if (p[k] === undefined) p[k] = t[k]; });
    // streetActions is nested, and a top-level backfill won't repair a record
    // that HAS the object but is missing a street inside it — computeRates reads
    // p.streetActions.flop.bet unguarded, so a hand-edited or partially-merged
    // import would throw there and take the whole panel down with it.
    Object.keys(t.streetActions).forEach((street) => {
      if (!p.streetActions[street] || typeof p.streetActions[street] !== 'object') {
        p.streetActions[street] = { ...t.streetActions[street] };
      } else {
        Object.keys(t.streetActions[street]).forEach((act) => {
          if (typeof p.streetActions[street][act] !== 'number') p.streetActions[street][act] = 0;
        });
      }
    });
    return p;
  }

  // One-time repairs to stored data, keyed off `version`. Runs at load and after
  // an import, on the parsed object BEFORE it becomes STORE.
  //
  // Deliberately does NOT call saveStore(): at load time this runs inside
  // loadStore(), before `saveScheduled` is initialised, so touching it would
  // throw on the temporal dead zone. Every migration must therefore be
  // idempotent — if the page closes before the next natural save, it simply runs
  // again on the following load.
  //
  // Schema 2 (v0.20.0): P/L was frozen at zero for any session where heroXid
  // latched onto a "name:<username>" pseudo-id. heroDelta evaluated to 0, so
  // every attributed share was `0 * weight` and hero.netChips never moved. There
  // is no way to rebuild the real figures — STORE.hands is a capped ring buffer
  // and holds only a slice of what was played — so wipe P/L and let it
  // reaccumulate. Hand counts, VPIP/PFR and the other rate stats were never
  // touched by that bug, so they are kept.
  function migrateStore(store) {
    if ((store.version || 1) >= STORE_VERSION) return;
    Object.keys(store.players || {}).forEach((xid) => {
      if (store.players[xid]) store.players[xid].plChipsEst = 0;
    });
    store.hero.netChips = 0;
    store.session.net = 0;
    store.version = STORE_VERSION;
  }

  // Repair every record once, at load and after an import. getPlayer() also
  // repairs on access, but it is NOT the only reader — renderBadges and the
  // players list read STORE.players[xid] straight out of the object, so a
  // malformed record reaching computeRates would throw there instead.
  function normalizePlayers(store) {
    Object.keys(store.players || {}).forEach((xid) => {
      const p = store.players[xid];
      if (!p || typeof p !== 'object') { delete store.players[xid]; return; }
      ensurePlayerShape(p, xid);
    });
  }

  function getPlayer(xid, name) {
    if (!STORE.players[xid]) STORE.players[xid] = emptyPlayer(xid, name);
    else ensurePlayerShape(STORE.players[xid], xid);
    if (name) STORE.players[xid].name = name;
    STORE.players[xid].lastSeen = Date.now();
    return STORE.players[xid];
  }

  // Credentials must never leave this device. exportJson() feeds BOTH the
  // user-facing Copy button and the Gist upload, so anything left in here would
  // be written into the gist and into any exported JSON that gets pasted
  // somewhere public. Strip secrets at the single choke point.
  const LOCAL_ONLY_SETTINGS = ['githubToken'];

  function sanitizedStore() {
    const settings = { ...STORE.settings };
    LOCAL_ONLY_SETTINGS.forEach((k) => { delete settings[k]; });
    return { ...STORE, settings };
  }

  function exportJson() {
    return JSON.stringify(sanitizedStore(), null, 2);
  }

  function importJson(text) {
    const parsed = JSON.parse(text);
    // Keep this device's own credentials — an import is data, not a re-auth.
    const preserved = {};
    LOCAL_ONLY_SETTINGS.forEach((k) => { preserved[k] = STORE.settings[k]; });
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}), ...preserved };
    parsed.players = parsed.players || {};
    parsed.hands = parsed.hands || [];
    parsed.hero = ensureHeroShape(parsed.hero);
    parsed.session = parsed.session || { startedAt: 0, hands: 0, net: 0, lastHandAt: 0 };
    normalizePlayers(parsed); // imported JSON is hand-editable and often stale
    migrateStore(parsed);     // a backup taken before 0.20.0 carries frozen P/L
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
      session: local.session, // session is per-device; never taken from remote
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

  // Hands are immutable once written, so a union deduped per hand is safe — this
  // keeps history from both devices rather than letting one overwrite.
  //
  // Prefer Torn's own game id: two devices at the same table record the SAME
  // hand at different local timestamps, so a timestamp key let every shared hand
  // through twice. Fall back to timestamp+pot for records written before hands
  // carried an id.
  function mergeHands(a, b, limit) {
    const seen = new Set();
    return a.concat(b)
      .filter((h) => {
        if (!h) return false;
        const k = h.g ? 'g:' + h.g : 't:' + h.t + ':' + (h.pot || 0);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
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
  // Calibrated against a real table (deep scan v0.3.0). Torn hashes CSS-module
  // names with BOTH `name___hash` and `name_hash` shapes, sometimes for the same
  // base within one render, so every selector matches on a single trailing
  // underscore — `[class*="front_"]` catches `front___zu4oW` and `front_ab12`
  // alike, where the old `front___` prefix silently missed half of them.
  const SELECTORS = {
    logContainer: '[class*="messagesList_"]',
    logRow: 'li[class*="message_"]',
    seatContainer: '[id^="player-"]',
    seatNameLink: 'a[href*="XID="]',
    seatName: '[class*="name_"]',
    seatFolded: '[class*="folded_"]',
    // Torn marks the seat currently ON ACTION with `active___`. Confirmed by a
    // live scan (`DIV#player-4034124.opponent___QQnNM.active___Xxj4V`), and it
    // is a far better turn signal than the action buttons: buttons cannot tell
    // a real turn from a queued pre-action.
    // Scoped to seats so it can't collide with `iconActive___` elsewhere.
    seatActive: '[id^="player-"][class*="active_"]',
    // Torn marks YOUR seat with `self___`, not `hero_`/`you_` — the old guesses
    // matched nothing, which is why hero identification fell back to typing a
    // username into Settings. Corroborated by a live scan: 6 seat containers,
    // `opponent___` on exactly 5 of them. The legacy guesses stay as alternates
    // in case a layout differs; resolveXidFromSeat needs only the element id.
    heroSeat: '[id^="player-"][class*="self_"], [class*="hero_"], [class*="you_"]',
    heroCards: '[class*="hand_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    // Matched ZERO on a live scan with five board cards face-up. Kept as a
    // first try only; readBoardCards derives the board from anyFaceUpCard.
    communityCards: '[class*="communityCards_"] [class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    // Any face-up card anywhere on the table. Confirmed structure — this is the
    // same shape heroCards uses, minus the hero container.
    anyFaceUpCard: '[class*="front_"] > div[role="img"]:not([aria-label="card face down"])',
    heroHand: '[class*="hand_"]',
    potDisplay: '[class*="totalPotWrap_"], [class*="potsWrapper_"]',
    // NOT used for turn detection — see findActionButtons(), which matches on
    // the button's TEXT instead. Torn's action controls carry no stable hashed
    // container class, so this selector matched nothing for many versions and
    // took isHeroTurn() down with it. Kept as a calibration probe only.
    actionButtons: '[class*="actionButtons_"] button, [class*="controls_"] button',
    // The dealer element carries a `position-<N>___` class naming the seat
    // index it sits at, or `position-self___` when YOU have the button.
    dealerButton: '[class*="dealer_"], [class*="dealerButton_"], [class*="buttonIcon_"]',
    // Per-seat state line. Carries "Sitting out" as text; a seated player who
    // is sitting out still occupies a seat and would otherwise shift every
    // position label by one.
    seatState: '[class*="state_"]',
    // Seat ring slot. Where it carries an index (`playerPositioner-3___hash`)
    // it gives the seating order directly, with no geometry needed. A live PDA
    // scan showed the un-indexed form (`playerPositioner___hash`), so the
    // geometric fallback in seatRotationFromDom stays.
    seatPositioner: '[class*="playerPositioner"]',
    // Chip stack on a seat. Three shapes because the mobile layout nests it in
    // a detailsItem paragraph rather than exposing a money element directly.
    seatStack: '[class*="potString_"], [class*="money_"], [class*="detailsItem_"] p',
  };

  // Action controls are matched by their LABEL, not by a hashed container class
  // — `SELECTORS.actionButtons` has matched nothing on every scan taken so far.
  // Text matching also survives a Torn redeploy, since the labels are the UI.
  //
  // Prefix-anchored rather than whole-string: Torn's call button may carry the
  // amount ("Call $2,000,000"). The length guard keeps a sentence containing the
  // word "call" from counting as a button.
  const ACTION_BTN_RE = /^(fold|check|call|bet|raise|all[\s-]?in)\b/i;
  const ACTION_BTN_MAX_LEN = 24;

  // PRE-action controls, shown while waiting for someone else to act so you can
  // queue a decision: "Check / Fold", "Call Any / Check". A live scan found
  // exactly these three and no bare action buttons, which means their presence
  // is evidence you are IN the hand — not that it is your turn.
  //
  // Treating them as turn buttons made isHeroTurn true for most of the hand,
  // which is the same failure mode as the old hole-cards fallback it replaced.
  const PREACTION_BTN_RE = /\/|\bany\b/i;

  function findActionButtons() {
    const out = [];
    document.querySelectorAll('button, [role="button"]').forEach((b) => {
      if (b.closest('[class^="tph-"], [class*=" tph-"]')) return; // our own UI
      const t = (b.textContent || '').trim();
      if (!t || t.length >= ACTION_BTN_MAX_LEN || !ACTION_BTN_RE.test(t)) return;
      b.__tphPreaction = PREACTION_BTN_RE.test(t);
      out.push(b);
    });
    return out;
  }

  // Only a single-action label means it is actually your turn.
  function findTurnButtons() {
    return findActionButtons().filter((b) => !b.__tphPreaction);
  }

  const CARD_CLASS_RE = /(clubs|spades|hearts|diamonds)-([0-9TJQKA]+)/i;

  // Log line patterns. Each handler receives (match, ctx) where ctx is the
  // active HandState. Wording is a best guess (mixing past/present tense)
  // per the public "posts/posted the (small|big) blind" style referenced by
  // similar Torn scripts — add more alternates here during calibration.
  // Torn writes the log in PAST tense with status glyphs ("* ImEx called"), and
  // amounts are not always present. Every pattern therefore accepts both tenses
  // and treats the amount as optional; a missing amount costs chip accuracy but
  // still records the action. Verified against real observed wording.
  const LOG_PATTERNS = [
    { type: 'newHandMarker', re: /(dealing|starting)\s+(a\s+)?new\s+hand/i },
    // Torn marks a new hand as "Game <hex id> started". An earlier pass read the
    // id off a body-fallback fragment that had already lost the "Game " prefix
    // and anchored on the hex, so the real line never matched and hands were
    // never segmented. Prefix optional, in case the fragment form reappears.
    // The id is captured: it uniquely names one real hand, which is what lets a
    // re-read of the same marker be ignored instead of opening a second record.
    { type: 'newHandMarker', re: /^(?:game\s+)?([0-9a-f]{6,})\s+started\b/i },
    { type: 'postSB', re: /^(.+?)\s+post(?:s|ed)?\s+(?:the\s+)?small\s*blind(?:\s*\$?([\d,]+))?/i },
    { type: 'postBB', re: /^(.+?)\s+post(?:s|ed)?\s+(?:the\s+)?big\s*blind(?:\s*\$?([\d,]+))?/i },
    // A bare "Name posted $2,500,000" — a dead blind, posted when rejoining
    // after sitting out or missing a blind. Seen unparsed on a live scan.
    // MUST stay below postSB/postBB, which are more specific; it is anchored to
    // end-of-line so "posted small blind $X" cannot reach it anyway.
    //
    // The money is real and goes into the pot, so it is contributed — but it is
    // FORCED, so it must not count as VPIP or as a limp. Treating it as a call
    // would have made anyone rejoining a table look voluntarily loose.
    { type: 'postDead', re: /^(.+?)\s+post(?:s|ed)?\s+\$?([\d,]+)\s*$/i },
    { type: 'allin', re: /^(.+?)\s+(?:is\s+|goes\s+|went\s+)?all[\s-]?in(?:\s*(?:for|with)?\s*\$?([\d,]+))?/i },
    { type: 'fold', re: /^(.+?)\s+fold(?:s|ed)?\b/i },
    { type: 'check', re: /^(.+?)\s+check(?:s|ed)?\b/i },
    { type: 'call', re: /^(.+?)\s+call(?:s|ed)?\b(?:\s*\$?([\d,]+))?/i },
    // "raised $1,000,000 to $2,000,000" states the increment first and the total
    // second; the total is the number that matters for pot and bet-sizing math,
    // so match this shape ahead of the generic raise below, which would
    // otherwise capture the increment and understate every raise.
    { type: 'raise', re: /^(.+?)\s+raise[sd]?\s+\$?[\d,]+\s+to\s+\$?([\d,]+)/i },
    { type: 'raise', re: /^(.+?)\s+raise[sd]?\b(?:\s+to)?(?:\s*\$?([\d,]+))?/i },
    { type: 'bet', re: /^(.+?)\s+bet(?:s|ted)?\b(?:\s*\$?([\d,]+))?/i },
    // Torn writes "The flop:  5♣, 7♦, A♦" — the definite article and the double
    // space both defeated an anchor on the bare street name, so the board was
    // never read from the log and the street never advanced.
    { type: 'flop', re: /^(?:the\s+)?flop\b:?\s*(.+)/i },
    { type: 'turn', re: /^(?:the\s+)?turn\b:?\s*(.+)/i },
    { type: 'river', re: /^(?:the\s+)?river\b:?\s*(.+)/i },
    // Showdowns read "_AY_  reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)".
    { type: 'shows', re: /^(.+?)\s+(?:show(?:s|ed)?|reveals?)\s+(.+)/i },
    { type: 'wins', re: /^(.+?)\s+w(?:ins?|on)\b(?:\s+the\s+pot)?(?:\s*\$?([\d,]+))?/i },
  ];

  // Log rows are prefixed with status glyphs; left in place they'd be captured
  // as part of the player's name and never match a seat.
  const LINE_DECORATION_RE = /^[^\w$]+/;
  function cleanLogLine(t) {
    return String(t || '').replace(/[✓✔✕✖✗✘]/g, '').replace(LINE_DECORATION_RE, '').trim();
  }
  function cleanName(n) {
    return String(n || '').replace(/^[^\w]+/, '').replace(/[^\w]+$/, '').trim();
  }

  let heroXid = null;
  let currentHand = null;
  const seenUnmatchedLines = []; // for calibration panel

  // Last big blind seen on any hand this session. Seeds each new hand so that a
  // hand joined mid-way, or one whose blind line scrolled out of the log before
  // the snapshot primed, still has a unit to express P/L in. Torn's blind level
  // is fixed per table, so carrying it forward is safe within a session; it
  // resets on reload rather than being persisted, because the next table may be
  // a different stake.
  let lastSeenBB = 0;

  // Torn's poker tables, by big blind. Blind levels are fixed per table, so the
  // blind read off the log identifies which table you are sitting at.
  //
  // Taken from HopesG's HUD (MIT, GreasyFork 569933), which carries the ladder
  // as data. Not independently verified, but two levels are corroborated by
  // scans from this device: $1,000,000 (River Wizard) and $2,500,000 (Cat's
  // Chance). An unknown level is reported rather than treated as an error —
  // Torn adds tables, and this list will go stale before the code does.
  const TORN_STAKES = {
    10: 'Newbie Corner', 25: 'Hobo Holdem', 50: 'Broke Jokes', 100: '8-bit',
    250: 'Sprinkles', 500: 'E-asy Street', 1000: 'Gatling Gun', 2500: 'Quickdraw',
    5000: 'Tight Knit', 10000: 'Six of the Best', 25000: 'Ballsy',
    50000: 'Boom or Bust', 100000: "Old 'n Slow", 250000: 'Pound It',
    500000: 'Old Folks Home', 1000000: 'River Wizard', 2500000: "Cat's Chance",
    10000000: 'High Rollers', 25000000: 'Fire Pit', 100000000: 'Oligarch',
  };

  // The smallest real blind on Torn. Anything below this is not a stake.
  //
  // This is the guard against Torn's BB DISPLAY MODE, which renders amounts as
  // "181.00 BB" rather than "$181,000,000". In that mode every amount parses to
  // a number six or more orders of magnitude too small, and nothing looks
  // broken — the figures are simply tiny. Refusing an implausible blind stops a
  // whole session of corrupted P/L from being written, at the cost of showing
  // no P/L for that session, which is the right trade.
  const MIN_PLAUSIBLE_BB = 10;

  // Record the blind level for a hand, and notice when it changes.
  //
  // lastSeenBB exists to price a hand whose blind line was missed. It is only
  // safe while you stay at one table — the scans from this device show play at
  // two different stakes, so a table switch is a real event, not a theoretical
  // one. Carrying $2.5M forward onto a $1M table would misprice every hand
  // until the next blind line landed.
  function noteBlindLevel(hand, amt) {
    if (!plausibleBB(amt)) {
      // Too small to be a real Torn stake. Don't store it, don't carry it, and
      // don't let it price anything.
      bbDisplayModeSuspected = true;
      return;
    }
    bbDisplayModeSuspected = false;
    if (lastSeenBB && amt !== lastSeenBB) currentTableBB = null; // switched tables
    hand.bbAmount = amt;
    lastSeenBB = amt;
    currentTableBB = amt;
  }

  let currentTableBB = null;

  function tableNameForBB(bb) { return TORN_STAKES[bb] || null; }

  // "Cat's Chance ($2.5M/hand · Mid)" — or an honest label for a level that
  // isn't in the ladder, since Torn adds tables.
  function tableLabel(bb) {
    if (!plausibleBB(bb)) return null;
    const name = tableNameForBB(bb);
    const tier = stakeTierForBB(bb);
    return `${name || 'Unknown table'} · ${fmtMoney(bb)} BB${tier ? ' · ' + tier : ''}`;
  }

  function stakeTierForBB(bb) {
    if (!bb) return null;
    if (bb <= 500) return 'Nano';
    if (bb <= 50000) return 'Low';
    if (bb <= 999999) return 'Mid';
    if (bb <= 9999999) return 'High';
    return 'Elite';
  }

  // Is this a blind level we can believe? Used before anything is stored in
  // big blinds, so a display-mode session can't poison the win rate.
  function plausibleBB(bb) {
    return typeof bb === 'number' && isFinite(bb) && bb >= MIN_PLAUSIBLE_BB;
  }

  // Set when a parsed blind is too small to be real, i.e. almost certainly BB
  // display mode. Surfaced in Settings and the deep scan rather than silently
  // dropping data.
  let bbDisplayModeSuspected = false;

  // Torn game ids opened this session, newest last. Bounded because only ids
  // still visible in the log can ever be re-read, and the log holds a handful of
  // hands at most.
  const SEEN_GAME_IDS_MAX = 40;
  const seenGameIds = [];

  function freshHandState() {
    const dealtIn = seatedXids(); // snapshot of who's seated *before* any folds happen this hand
    return {
      gameId: null,            // Torn's hex id from "Game <id> started", when seen
      street: 'preflop',
      pot: 0,
      contributions: {},       // xid -> total chips this hand
      streetContributions: {}, // xid -> chips this street
      dealtInXids: dealtIn,    // immutable — used as the "hands observed" denominator
      // Pot as it stood when the current street began. SPR is conventionally
      // fixed at the start of a street; measuring it against the live pot makes
      // the number shrink while you are deciding, which is the opposite of what
      // it is for.
      potAtStreetStart: 0,
      playersIn: new Set(dealtIn), // mutable — shrinks as players fold, used for opportunity counts
      winners: [],             // {xid, amount}[] — supports split pots, applied at hand end
      actions: [],             // {x,a,amt,s}[] — replayable action log for the History tab
      shown: {},               // xid -> cards revealed at showdown, as display text
      shownCards: {},          // xid -> parsed [{rank,suit},{rank,suit}] for range tracking
      sbXid: null,
      bbXid: null,
      actionOrder: [],         // first-to-act order preflop, used to derive positions
      board: [],               // community cards parsed out of the log
      heroCards: null,         // captured while the hand is live, for the history record
      preflopRaiseEvents: 0,   // total raise events preflop (not unique raisers) — 2nd = a 3-bet
      lastAggressor: null,
      aggressorByStreet: {},
      cbetOpportunity: {},     // xid -> bool, was preflop aggressor and street is theirs to act first
      cbetFacedThisStreet: null, // xid of the player whose c-bet is currently being faced this street
      threeBetActive: false,
      threeBettorXid: null,
      countedVpip: new Set(),
      countedLimp: new Set(),
      // Blind level for THIS hand, read off the postSB/postBB lines. The only
      // point at which it is known — P/L in big blinds cannot be recovered
      // afterwards from the chip figure, so it is converted at settlement.
      bbAmount: lastSeenBB,
      sbAmount: 0,
      countedPfr: new Set(),
      countedThreeBetOpp: new Set(),
    };
  }

  // Seats carry the XID directly on the element id (`<div id="player-3722665">`),
  // which the deep scan confirmed is present on every seat while profile links
  // are not — only 1 of 6 seats had an anchor. Read the id first and treat the
  // link as the fallback, not the other way round.
  function resolveXidFromSeat(seatEl) {
    const byId = /^player-(\d+)$/.exec(seatEl.id || '');
    if (byId) return byId[1];
    const link = seatEl.querySelector(SELECTORS.seatNameLink);
    if (!link) return null;
    const m = /XID=(\d+)/.exec(link.href || '');
    return m ? m[1] : null;
  }

  // Prefer a profile link, but fall back to matching the seat's text against
  // names already seen in the log — longest first, so "Joe" can't shadow "Joey".
  function resolveSeatKey(seatEl) {
    const xid = resolveXidFromSeat(seatEl);
    if (xid) return xid;
    const text = seatEl.textContent || '';
    const known = Object.keys(STORE.players)
      .map((k) => ({ key: k, name: (STORE.players[k] || {}).name || '' }))
      .filter((e) => e.name.length >= 2)
      .sort((a, b) => b.name.length - a.name.length);
    for (const e of known) { if (text.includes(e.name)) return e.key; }
    return null;
  }

  // A seated player who is sitting out is dealt no cards, but still occupies a
  // seat. Counting them shifts every position label by one and inflates the
  // "hands observed" denominator for everyone at the table.
  function isSeatSittingOut(seatEl) {
    if (!seatEl) return false;
    for (const c of (seatEl.classList || [])) {
      if (/sitOut|sittingOut|sit-out/i.test(c)) return true;
    }
    const state = seatEl.querySelector(SELECTORS.seatState);
    return !!(state && /sitting\s*out/i.test(state.textContent || ''));
  }

  // opts.includeSittingOut keeps the old behaviour for callers that want every
  // occupied seat rather than everyone actually in the hand.
  function seatedXids(opts) {
    const includeOut = !!(opts && opts.includeSittingOut);
    const xids = new Set();
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      if (!includeOut && isSeatSittingOut(seat)) return;
      const xid = resolveSeatKey(seat);
      if (xid) xids.add(xid);
    });
    return xids;
  }

  // The seat element carrying Torn's own "this is you" marker. Authoritative
  // when present: it needs no username, resolves to a real numeric XID, and is
  // available before any log line arrives.
  function heroSeatEl() {
    const seats = document.querySelectorAll(SELECTORS.heroSeat);
    for (const s of seats) { if (resolveXidFromSeat(s)) return s; }
    return seats[0] || null;
  }

  // Hero identity, best source first.
  //
  // The DOM marker now leads. It used to be the fallback, on the belief that
  // "this table renders no hero marker" — that was wrong: Torn marks your seat
  // with `self___`, and the old guesses (`hero_`, `you_`) simply never matched.
  // Preferring it means P/L works with Settings left blank, and removes the
  // window where findHeroXid returns the "name:<username>" pseudo-id.
  //
  // The configured username stays as the fallback for any layout that doesn't
  // render the marker, and still wins over a DOM element that can't be resolved
  // to a numeric XID.
  function findHeroXid() {
    const seat = heroSeatEl();
    if (seat) {
      const xid = resolveXidFromSeat(seat);
      if (xid) {
        const name = seatDisplayName(seat);
        if (name) noteResolvedName(xid, name);
        return xid;
      }
    }
    const configured = (STORE.settings.heroName || '').trim();
    if (configured) return nameToXidGuess(configured);
    return null;
  }

  // Chip stack showing on a seat, in chips, or null if it can't be read.
  //
  // Seat text runs names and figures together ("RoadKillV$190,866,931$500,000"
  // — stack then current bet), so this reads the stack ELEMENT rather than
  // regexing the seat's text: the first figure in that string is the stack, but
  // only by luck of ordering. Where several candidates match, the largest wins,
  // since a player's stack is bigger than the amount they've bet this street in
  // every case except an all-in, where the two are equal.
  function readSeatStack(seatEl) {
    if (!seatEl) return null;
    let best = null;
    seatEl.querySelectorAll(SELECTORS.seatStack).forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (!/^\$/.test(txt)) return; // a `name_` wrapper can match seatStack too
      const n = parseAmount(txt.replace(/^\$/, ''));
      if (n > 0 && (best === null || n > best)) best = n;
    });
    return best;
  }

  // xid -> stack, for every seat that reports one.
  function readAllStacks() {
    const out = {};
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid) return;
      const stack = readSeatStack(seat);
      if (stack !== null) out[xid] = stack;
    });
    return out;
  }

  // Smallest stack among players still in the hand — the most anyone can
  // actually win or lose, and the number SPR should be measured against.
  // Returns null when fewer than two stacks are readable.
  // Effective stack: the most that can actually change hands, which is always
  // bounded by the SHORTER of two specific stacks — yours and theirs.
  //
  // Returns { chips, vsXid, pairwise } or null. Two rules it now enforces that
  // the earlier version did not:
  //
  // 1. HERO IS ALWAYS IN IT. The old version took the minimum across live
  //    players, so if hero's own seat failed to parse it silently reported the
  //    shortest VILLAIN — a number that can be far larger than what you can
  //    actually lose, presented with no warning. Without your stack there is no
  //    honest answer, so it returns null.
  // 2. PAIRWISE WHEN THERE IS SOMEONE TO BE PAIRWISE WITH. Against a specific
  //    opponent the number is min(you, them). The table minimum is only right
  //    when you have no particular opponent in mind, and using it while facing
  //    a bet quietly understates what is at stake against the player betting.
  function effectiveStackVs(hand, villainXid) {
    const stacks = readAllStacks();
    const heroStack = heroUnresolved() ? null : stacks[heroXid];
    if (!(heroStack > 0)) return null;

    if (villainXid && villainXid !== heroXid && stacks[villainXid] > 0) {
      return { chips: Math.min(heroStack, stacks[villainXid]), vsXid: villainXid, pairwise: true };
    }

    // No specific opponent: the shortest live opponent bounds the pot.
    const live = hand ? Array.from(hand.playersIn) : Object.keys(stacks);
    const opp = live
      .filter((x) => x !== heroXid)
      .map((x) => stacks[x])
      .filter((v) => typeof v === 'number' && v > 0);
    if (!opp.length) return null;
    return { chips: Math.min(heroStack, Math.min(...opp)), vsXid: null, pairwise: false };
  }

  // Seat id holding the dealer button, or null.
  //
  // The dealer element carries a `position-<N>___` class naming the ring slot it
  // sits at, or `position-self___` when hero has the button. This was listed as
  // a red herring for a long time because the old selector (`dealerButton_`)
  // matched nothing; the real base is just `dealer_`.
  function getDealerXid() {
    const el = document.querySelector(SELECTORS.dealerButton);
    if (!el) return null;

    const classes = Array.from(el.classList || []);
    if (classes.some((c) => /^position-self[_-]/.test(c))) {
      const seat = heroSeatEl();
      return seat ? resolveXidFromSeat(seat) : null;
    }

    let slot = null;
    for (const c of classes) {
      const m = /^position-(\d+)[_-]/.exec(c);
      if (m) { slot = m[1]; break; }
    }
    if (slot === null) return null;

    // Match the dealer's slot number against the seat ring's slot numbers.
    // Only meaningful where the positioner carries an index; the un-indexed
    // form seen on PDA yields nothing here and the caller falls back.
    for (const pos of document.querySelectorAll(SELECTORS.seatPositioner)) {
      const has = Array.from(pos.classList || [])
        .some((c) => new RegExp('^playerPositioner-' + slot + '[_-]').test(c));
      if (!has) continue;
      const seat = pos.querySelector(SELECTORS.seatContainer);
      return seat ? resolveXidFromSeat(seat) : null;
    }
    return null;
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
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    for (const seat of seats) {
      if ((seat.textContent || '').includes(name)) {
        const xid = resolveXidFromSeat(seat);
        if (xid) { noteResolvedName(xid, name); return xid; }
      }
    }
    return 'name:' + name; // fallback pseudo-id if XID can't be resolved yet
  }

  // Bind a display name to a numeric XID.
  //
  // Nothing did this before: getPlayer(xid, name) accepts a name but was never
  // once called with one, so emptyPlayer() stored the "#3722665" placeholder as
  // the player's actual name and playerDisplayName happily returned it. That is
  // why hand history showed ids instead of usernames — the name was known at
  // this exact point every time and simply thrown away.
  function noteResolvedName(xid, name) {
    mergePseudoPlayer(xid, name); // must run first: it bails if the record exists
    if (!name) return;
    const p = getPlayer(xid);
    if (p.name !== name) { p.name = name; saveStore(); }
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

  // Torn usernames are alphanumeric plus _ and -. Used to decide whether text
  // scraped off a seat is actually a name, since SELECTORS.seatName matches on
  // `name_` and could just as easily land on a wrapper holding the chip stack.
  const USERNAME_RE = /^[A-Za-z0-9_\-]{1,20}$/;

  function seatDisplayName(seat) {
    const link = seat.querySelector(SELECTORS.seatNameLink);
    const fromLink = cleanName(link ? link.textContent : '');
    if (fromLink && USERNAME_RE.test(fromLink)) return fromLink;
    const el = seat.querySelector(SELECTORS.seatName);
    if (!el) return null;
    // Take the first line only — the name element may also wrap the stack.
    const first = cleanName((el.textContent || '').split('\n')[0]);
    return first && USERNAME_RE.test(first) ? first : null;
  }

  // Read usernames straight off the seats. This is a second, independent source
  // from the log: it names a player who is sitting there but hasn't acted yet,
  // and it repairs records already stored under the "#<xid>" placeholder.
  // SELECTORS.seatName was declared and read by nothing until now.
  function harvestSeatNames() {
    let dirty = false;
    document.querySelectorAll(SELECTORS.seatContainer).forEach((seat) => {
      const xid = resolveXidFromSeat(seat);
      if (!xid) return;
      const name = seatDisplayName(seat);
      if (!name) return;
      const existing = STORE.players[xid];
      if (existing && existing.name === name) return;
      mergePseudoPlayer(xid, name);
      getPlayer(xid).name = name;
      dirty = true;
    });
    if (dirty) saveStore();
  }

  // The body-wide fallback observer sees all of Torn's page chrome, not just the
  // table — the site's rotating announcement ticker was landing in the unmatched
  // log and crowding out real lines during calibration. Drop the known chrome
  // before it reaches the patterns.
  // Real table lines that carry no action worth parsing. Filtering them keeps the
  // calibration panel's unmatched list meaningful — it should show wording we
  // failed to understand, not chatter we deliberately ignore.
  const LOG_NOISE_RE = new RegExp([
    '\\b(armoury|faction growth|merits|newspaper|classified ad)\\b', // Torn page chrome
    '\\b(joined|left)\\s+the\\s+table\\b',
    '^the\\s+preflop\\b',            // "The preflop Two cards dealt to each player"
    '\\bcards\\s+dealt\\s+to\\s+each\\s+player\\b',
  ].join('|'), 'i');

  function handleLogLine(line) {
    const trimmed = cleanLogLine(line);
    if (!trimmed) return;
    if (LOG_NOISE_RE.test(trimmed)) return;

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
      // Only the "Game <hex> started" pattern captures an id; the speculative
      // "dealing a new hand" one captures a verb, so hex-test before trusting it.
      const gameId = (m[1] && /^[0-9a-f]{6,}$/i.test(m[1])) ? m[1].toLowerCase() : null;
      // A marker for a hand we've already opened is a re-read of the log, not a
      // second deal. Acting on it would close the live hand early and file the
      // same hand twice. Checked against ids seen this session (covers hands
      // that ended with nothing worth recording) and against stored history
      // (covers a page reload mid-session).
      if (gameId && (seenGameIds.includes(gameId) || handAlreadyRecorded(gameId))) return;
      applyHandResultsAndReset();
      currentHand.gameId = gameId;
      if (gameId) {
        seenGameIds.push(gameId);
        if (seenGameIds.length > SEEN_GAME_IDS_MAX) seenGameIds.shift();
      }
      return;
    }

    if (type === 'postSB' || type === 'postBB') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      logAction(hand, xid, type === 'postSB' ? 'sb' : 'bb', amt);
      if (type === 'postSB') {
        hand.sbXid = xid;
        if (amt > 0) hand.sbAmount = amt;
      } else {
        hand.bbXid = xid;
        // The blind level, and the unit everything else can be expressed in.
        if (amt > 0) noteBlindLevel(hand, amt);
      }
      hand.playersIn.add(xid);
      return;
    }

    if (type === 'postDead') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      logAction(hand, xid, 'post', amt);
      // Deliberately no maybeCountVpip / maybeCountLimp: a dead blind is forced
      // money, not a voluntary decision.
      hand.playersIn.add(xid);
      return;
    }

    if (type === 'fold') {
      const xid = nameToXidGuess(cleanName(m[1]));
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
      const xid = nameToXidGuess(cleanName(m[1]));
      recordStreetAction(xid, 'check', hand);
      logAction(hand, xid, 'check', 0);
      return;
    }

    if (type === 'call') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'call', hand);
      logAction(hand, xid, 'call', amt);
      maybeCountVpip(xid, hand);
      maybeCountLimp(xid, hand);
      return;
    }

    if (type === 'bet') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      noteBetSizing(xid, amt, hand.pot); // pot BEFORE this bet
      addContribution(hand, xid, amt);
      recordStreetAction(xid, 'bet', hand);
      logAction(hand, xid, 'bet', amt);
      maybeCountVpip(xid, hand);
      markAggressor(xid, hand);
      maybeCountCbet(xid, hand);
      return;
    }

    if (type === 'raise') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      noteBetSizing(xid, amt, hand.pot); // pot BEFORE this raise
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

    if (type === 'allin') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
      if (amt) { noteBetSizing(xid, amt, hand.pot); addContribution(hand, xid, amt); }
      recordStreetAction(xid, 'raise', hand);
      logAction(hand, xid, 'all-in', amt);
      maybeCountVpip(xid, hand);
      if (hand.street === 'preflop') hand.preflopRaiseEvents += 1;
      maybeCountPfr(xid, hand);
      maybeCountThreeBet(xid, hand);
      markAggressor(xid, hand);
      return;
    }

    if (type === 'flop' || type === 'turn' || type === 'river') {
      hand.street = type;
      hand.potAtStreetStart = hand.pot; // fix SPR's denominator for this street
      hand.streetContributions = {};
      hand.cbetOpportunity = {};
      hand.cbetFacedThisStreet = null;
      const boardCards = parseCardsFromText(m[1] || '');
      if (boardCards.length) hand.board = (type === 'flop') ? boardCards : hand.board.concat(boardCards);
      if (hand.lastAggressor) {
        hand.cbetOpportunity[hand.lastAggressor] = true;
        getPlayer(hand.lastAggressor).cbetOpp += 1;
        saveStore();
      }
      return;
    }

    if (type === 'shows') {
      const xid = nameToXidGuess(cleanName(m[1]));
      const p = getPlayer(xid);
      p.wtsd += 1;
      hand.shown[xid] = squish(m[2], 40);
      // Parsed cards kept separately and banked at SETTLEMENT, not here: at this
      // point hand.winners is still empty (the "wins" lines come after the
      // reveals), so recording now would score every showdown as a loss.
      const revealed = parseCardsFromText(m[2]).slice(0, 2);
      if (revealed.length === 2) hand.shownCards[xid] = revealed;
      logAction(hand, xid, 'shows', 0);
      saveStore();
      return;
    }

    if (type === 'wins') {
      // Deferred rather than settled immediately: split pots produce multiple
      // consecutive "X wins $Y" lines, and settling on the first would reset
      // hand state before the second winner's line arrives.
      const xid = nameToXidGuess(cleanName(m[1]));
      const amt = m[2] ? parseAmount(m[2]) : 0;
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
    // Seat scraping can't identify players on every table layout, and when it
    // fails dealtInXids stays empty — which would leave `hands` at zero and make
    // EVERY rate stat undefined. Treat anyone observed acting as dealt in.
    hand.dealtInXids.add(xid);
    if (action !== 'fold') hand.playersIn.add(xid);
    // Preflop action runs UTG -> ... -> BTN -> SB -> BB, so the order in which
    // players first act (blinds excluded) reconstructs the seating rotation
    // without needing to identify the dealer button in the DOM.
    if (hand.street === 'preflop' && action !== 'sb' && action !== 'bb'
        && !hand.actionOrder.includes(xid)) {
      hand.actionOrder.push(xid);
    }
  }

  function noteBetSizing(xid, amt, potBefore) {
    if (!amt || potBefore <= 0) return;
    const p = getPlayer(xid);
    p.betSizePctSum += (amt / potBefore) * 100;
    p.betSizeCount += 1;
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

  // A limp is a preflop CALL into an unraised pot. Counted once per hand per
  // player, off the same raise-event counter the coach uses.
  //
  // The big blind is excluded: with no raise to face they have nothing to call,
  // so a "call" line from the BB in an unraised pot is a completing action, not
  // a limp. Counting it would make every BB look like a habitual limper.
  //
  // Known imprecision, shared with the coach: preflopRaiseEvents counts an
  // all-in as a raise, so a short-stack all-in that is really a call can make a
  // genuine limp behind look like a call of a raise, and go uncounted.
  function maybeCountLimp(xid, hand) {
    if (hand.street !== 'preflop') return;
    if (hand.preflopRaiseEvents > 0) return;
    if (xid === hand.bbXid) return;
    if (hand.countedLimp.has(xid)) return;
    hand.countedLimp.add(xid);
    getPlayer(xid).limpMade += 1;
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
    // Defensive reads: a throw anywhere in applyHandResults loses the whole
    // hand, including the P/L. A hand from freshHandState always has these, but
    // a replayed or hand-edited record may not, and dropping a stat is a far
    // better failure than dropping the settlement.
    const inSet = (s, x) => !!(s && typeof s.has === 'function' && s.has(x));

    // Winners are needed before the per-hand window is written, so the "won"
    // bit can go in with the play state rather than needing a second pass.
    const wonByXid = {};
    if (hand.winners.length > 0) {
      const unknown = hand.winners.filter((w) => !w.amount).length;
      const fallbackShare = unknown ? Math.round(hand.pot / hand.winners.length) : 0;
      hand.winners.forEach((w) => {
        wonByXid[w.xid] = (wonByXid[w.xid] || 0) + (w.amount || fallbackShare);
      });
    }

    const settleBB = plausibleBB(hand.bbAmount || lastSeenBB) ? (hand.bbAmount || lastSeenBB) : 0;

    hand.dealtInXids.forEach((xid) => {
      const p = getPlayer(xid);
      p.hands += 1;
      const play = inSet(hand.countedPfr, xid) ? 2 : inSet(hand.countedVpip, xid) ? 1 : 0;
      pushRecent(p, play | (wonByXid[xid] > 0 ? RECENT_WON : 0));

      // A pot lost big enough to plausibly set someone off. Recorded against
      // their own hand count so "how long ago" needs no upkeep between hands.
      if (settleBB > 0) {
        const net = (wonByXid[xid] || 0) - (hand.contributions[xid] || 0);
        if (net / settleBB <= -BIG_LOSS_BB) p.lastBigLossHand = p.hands;
      }
    });
    if (heroXid && hand.dealtInXids.has(heroXid)) STORE.hero.hands += 1;
    touchSession(0, heroXid && hand.dealtInXids.has(heroXid));

    if (hand.winners.length > 0) {
      // wonByXid was built above, before the per-hand window was written — it
      // carries the "did the log print an amount" fallback, which leaving at 0
      // would score a WIN as losing everything the winner had contributed.
      const contributors = Object.keys(hand.contributions);

      if (heroXid) {
        const heroWon = wonByXid[heroXid] || 0;
        const heroContributed = hand.contributions[heroXid] || 0;
        const heroDelta = heroWon - heroContributed;
        STORE.hero.netChips += heroDelta;
        touchSession(heroDelta, false);

        // Big blinds are the only comparable unit: "+$412M" says nothing about
        // whether you are beating the game, and a chip figure cannot be
        // converted afterwards because the blind level isn't stored per hand in
        // older records. Convert now, or not at all.
        // plausibleBB gates this: in BB display mode every amount parses tiny,
        // and pricing a hand off a bogus blind writes a permanently wrong
        // win rate. Better to record chips only.
        const rawBB = hand.bbAmount || lastSeenBB;
        const bb = plausibleBB(rawBB) ? rawBB : 0;
        const heroDeltaBB = bb > 0 ? heroDelta / bb : 0;
        if (bb > 0) {
          STORE.hero.netBB += heroDeltaBB;
          STORE.hero.bbHands += 1; // denominator for bb/100, only over hands we could price
        }

        // P/L attribution, stored from HERO's perspective: positive plChipsEst
        // means you are up against that player.
        //
        // Money you win comes from the players who LOST this hand, and money you
        // lose goes to the players who WON it — so split by each opponent's net
        // result, not by what they put in. The old version divided each
        // opponent's contribution by the total contributed INCLUDING hero's own,
        // so the shares never summed to 1: heads-up each player puts in half the
        // pot, so a villain was credited with exactly HALF the money you won
        // from them. It also charged a loss to opponents who folded early and
        // lost nothing to you, while crediting nothing extra to whoever actually
        // took the pot.
        //
        // This version is exact heads-up and sums to heroDelta multiway. It is
        // still an estimate in one respect: with three or more players it cannot
        // know whose chips ended up in whose stack, only the net movement.
        const net = {};
        let poolTotal = 0;
        for (const xid of contributors) {
          if (xid === heroXid) continue;
          const oppNet = (wonByXid[xid] || 0) - hand.contributions[xid];
          // Hero won -> draw from opponents who lost. Hero lost -> credit the
          // opponents who won. Either way we want the opposite sign to hero's.
          const weight = heroDelta >= 0 ? Math.max(0, -oppNet) : Math.max(0, oppNet);
          if (weight > 0) { net[xid] = weight; poolTotal += weight; }
        }
        if (poolTotal > 0) {
          for (const xid of Object.keys(net)) {
            const share = net[xid] / poolTotal;
            getPlayer(xid).plChipsEst += heroDelta * share;
            if (bb > 0) getPlayer(xid).plBBEst += heroDeltaBB * share;
          }
        }
      }
    }

    // Banked here, after winners are known, so `won` is right and so a hand
    // that never reached settlement doesn't pollute the range.
    Object.keys(hand.shownCards || {}).forEach((xid) => {
      noteShowdown(xid, hand.shownCards[xid], hand);
    });

    recordHandHistory(hand);
    saveStore();
    finalizeHand();
  }

  // Keep one global newest-first list rather than a per-player copy: a hand
  // involves several players, and the History tab just filters this list.
  function recordHandHistory(hand) {
    if (!hand.actions.length && !hand.winners.length) return; // nothing happened
    if (hand.gameId && handAlreadyRecorded(hand.gameId)) return; // already filed
    STORE.hands.unshift({
      t: Date.now(),
      g: hand.gameId || null,
      street: hand.street,
      pot: hand.pot,
      players: Array.from(hand.dealtInXids),
      actions: hand.actions,
      winners: hand.winners,
      shown: hand.shown,
      heroCards: hand.heroCards || null,
    });
    const limit = STORE.settings.historyLimit || 200;
    if (STORE.hands.length > limit) STORE.hands.length = limit;
  }

  // Has this Torn game id already been written to history? Only the newest few
  // are checked — a re-read of the log can only ever replay lines still on
  // screen, and scanning the whole ring buffer on every marker is wasted work.
  const RECORDED_LOOKBACK = 50;
  function handAlreadyRecorded(gameId) {
    if (!gameId) return false;
    const recent = STORE.hands || [];
    const n = Math.min(recent.length, RECORDED_LOOKBACK);
    for (let i = 0; i < n; i++) { if (recent[i] && recent[i].g === gameId) return true; }
    return false;
  }

  // "#<xid>" is emptyPlayer's placeholder, not a name anyone chose. Treat it as
  // absent so a stored placeholder can never shadow a real name, and so callers
  // can tell the two apart.
  // Why hero can't be identified, or null if all is well.
  //
  // This failing is not cosmetic: with heroXid null, applyHandResults skips P/L
  // attribution entirely, so EVERY opponent's P/L stays frozen at zero, and
  // renderBadges can't tell which seat is yours so it draws a tendency badge on
  // your own seat. Both look like separate bugs and are the same missing
  // setting, so say so where the numbers are read instead of failing silently.
  // "Resolved" means bound to a real seat XID. A "name:<username>" pseudo-id is
  // NOT resolved — it is what nameToXidGuess returns when no seat matched — but
  // it IS a truthy string, which is exactly how it used to defeat the `!heroXid`
  // retry guard in bootstrapTableWatchers and freeze P/L at zero. Every check
  // for hero identity goes through here so that can't be reintroduced piecemeal.
  function heroUnresolved() {
    return !heroXid || String(heroXid).startsWith('name:');
  }

  function heroProblem() {
    if (!heroUnresolved()) return null; // bound to a seat — nothing to report

    const configured = (STORE.settings.heroName || '').trim();
    if (String(heroXid).startsWith('name:')) {
      return `“${configured}” matched by name but not to a seat ID yet — sit at a table for this to resolve.`;
    }
    // Since 0.22.0 your seat is read straight from the DOM, so the username is
    // only needed on a layout that doesn't render the marker. Say that rather
    // than demanding a setting that may not be the actual problem.
    if (!configured) {
      return 'Not seated yet, or your seat could not be identified. Sit at a table — '
        + 'if this persists, set “Your Torn username” below as a fallback. '
        + 'Until it resolves, no profit/loss is attributed to anyone.';
    }
    return `No seat matches the username “${configured}”, and no seat is marked as yours. `
      + 'Check the spelling against your seat — until it matches, no profit/loss is attributed to anyone.';
  }

  function playerDisplayName(xid) {
    const p = STORE.players[xid];
    const placeholder = '#' + xid;
    if (p && p.name && p.name !== placeholder) return p.name;
    return String(xid).startsWith('name:') ? String(xid).slice(5) : placeholder;
  }

  // Render one stored hand as a compact, readable summary.
  function formatHand(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const lines = [`[${when}] pot ${fmtMoney(h.pot)} — reached ${h.street}`];
    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      const acts = byStreet[street].map((a) => {
        const nm = playerDisplayName(a.x);
        const mark = (focusXid && a.x === focusXid) ? '*' : '';
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        return `${mark}${nm} ${a.a}${amt}`;
      }).join(', ');
      lines.push(`  ${street}: ${acts}`);
    });
    Object.keys(h.shown || {}).forEach((xid) => {
      lines.push(`  showdown: ${playerDisplayName(xid)} shows ${h.shown[xid]}`);
    });
    (h.winners || []).forEach((w) => {
      lines.push(`  → ${playerDisplayName(w.xid)} wins ${fmtMoney(w.amount)}`);
    });
    return lines.join('\n');
  }

  // History styling is INLINE with !important, not class-based.
  //
  // Two class-based attempts were reported unreadable on the live page — first a
  // recessed card relying on inherited text colour, then a lighter card with
  // `!important` in our own stylesheet. Both lost, while the Stats tab in the
  // same panel rendered perfectly, which rules out the panel and inheritance and
  // means Torn has a rule beating ours on specificity. An inline declaration
  // marked !important is the highest-priority thing in CSS: no stylesheet can
  // override it, so this stops being a contest we can lose.
  //
  // Keep the classes on the elements too — they still carry layout, and
  // .tph-hh-me is used to colour the legend line.
  const HH = {
    card: 'background:#2a2a33 !important;color:#f2f4f6 !important;border:1px solid #3d3d48;'
      + 'border-left:3px solid #6b8cae;border-radius:5px;padding:8px 10px;margin-bottom:9px;',
    head: 'color:#a8b2bd !important;font-size:11px;margin-bottom:6px;',
    row: 'color:#f2f4f6 !important;font-size:12.5px;line-height:1.6;',
    street: 'color:#8ec5f0 !important;display:inline-block;min-width:54px;font-size:10px;'
      + 'text-transform:uppercase;letter-spacing:0.5px;',
    me: 'color:#ffc94d !important;font-weight:700;',
    showdown: 'color:#d4b3f0 !important;font-size:11.5px;margin-top:4px;',
    win: 'color:#8ce89a !important;font-size:12.5px;margin-top:4px;',
  };

  // Same hand as formatHand, rendered as markup instead of a line of text.
  // formatHand is kept for the Copy button — clipboard output should stay plain
  // text — so the two must be changed together if the content changes.
  function formatHandHtml(h, focusXid) {
    const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const parts = [`<div class="tph-hh-head" style="${HH.head}">${escapeHtml(when)} · pot ${fmtMoney(h.pot)}`
      + ` · reached ${escapeHtml(h.street || 'preflop')}</div>`];

    const byStreet = {};
    (h.actions || []).forEach((a) => { (byStreet[a.s] = byStreet[a.s] || []).push(a); });
    ['preflop', 'flop', 'turn', 'river'].forEach((street) => {
      if (!byStreet[street]) return;
      const acts = byStreet[street].map((a) => {
        const amt = a.amt ? ` ${fmtMoney(a.amt)}` : '';
        const txt = `${escapeHtml(playerDisplayName(a.x))} ${escapeHtml(a.a)}${amt}`;
        return (focusXid && a.x === focusXid)
          ? `<span class="tph-hh-me" style="${HH.me}">${txt}</span>` : txt;
      }).join(', ');
      parts.push(`<div class="tph-hh-row" style="${HH.row}">`
        + `<span class="tph-hh-st" style="${HH.street}">${street}</span>${acts}</div>`);
    });

    Object.keys(h.shown || {}).forEach((xid) => {
      parts.push(`<div class="tph-hh-sd" style="${HH.showdown}">showdown: ${escapeHtml(playerDisplayName(xid))}`
        + ` shows ${escapeHtml(h.shown[xid])}</div>`);
    });
    (h.winners || []).forEach((w) => {
      parts.push(`<div class="tph-hh-win" style="${HH.win}">→ ${escapeHtml(playerDisplayName(w.xid))}`
        + ` wins ${fmtMoney(w.amount)}</div>`);
    });
    return `<div class="tph-hh" style="${HH.card}">${parts.join('')}</div>`;
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

  // Mutation targets are often text nodes; resolve to the owning element first
  // or every one of our own text edits reads as "not ours" and triggers a scan.
  function isOwnTarget(node) {
    if (!node) return false;
    return isOwnNode(node.nodeType === 1 ? node : node.parentElement);
  }

  // The same log line can arrive via several mutation records (once for the row,
  // once for an inner span), and the body-wide fallback makes that much more
  // likely. Suppress an identical line seen again within a short window —
  // but not longer, since "X folds" legitimately recurs across hands.
  // ONLY used by the added-nodes fallback below: the snapshot scanner already
  // guarantees a line is new, and running it through a time window there would
  // silently drop a genuine repeat that happens to arrive quickly.
  const recentLines = new Map();
  const DEDUP_MS = 1500;
  function recentlyHandled(text) {
    const now = Date.now();
    for (const [k, t] of recentLines) if (now - t > DEDUP_MS) recentLines.delete(k);
    if (recentLines.has(text)) return true;
    recentLines.set(text, now);
    return false;
  }

  // ---------------------------------------------------------------------------
  // Log ingestion by whole-list snapshot diff.
  //
  // Reading MutationObserver's addedNodes looked right and was wrong. Torn's
  // message list re-renders in place: the <li> elements persist and their TEXT
  // is rewritten as messages shift through the list, so a single new message
  // mutates every row. Every one of those rows then got re-parsed as if it had
  // just happened, and the 1.5s text dedup couldn't catch it because the lines
  // were minutes old. That replayed whole hands — the same "Game <hex> started"
  // and the same actions again and again — which is why one real hand appeared
  // several times in the history and inflated every stat with it.
  //
  // Diffing snapshots of the entire visible list is immune to that, because it
  // compares CONTENT, not node identity or arrival time: a re-render that
  // produces the same lines produces no new lines. It also survives Torn's SPA
  // swapping in a whole new log element, which node-based tracking would not.
  // ---------------------------------------------------------------------------

  let logSnapshot = [];
  let logSnapshotPrimed = false;
  let logOrientation = null; // 'append' (newest last) or 'prepend' (newest first)

  function logRoot() {
    return (logObserverTarget && logObserverTarget.isConnected) ? logObserverTarget : document.body;
  }

  // Cheap path test for the observer callback, which runs on every mutation
  // batch: stop at the first row instead of reading textContent for all of them.
  function hasLogRows() {
    const root = logRoot();
    return !!(root && root.querySelector && root.querySelector(SELECTORS.logRow));
  }

  function readLogRows() {
    const root = logRoot();
    if (!root || !root.querySelectorAll) return null;
    const rows = root.querySelectorAll(SELECTORS.logRow);
    if (!rows.length) return null; // uncalibrated page — caller uses the fallback
    return Array.from(rows, (row) => (row.textContent || '').trim());
  }

  // How many of the previous lines are still present, assuming new lines land at
  // the END of the list (cur === prev.slice(k) + new). Longest overlap wins, so
  // trimming from the front of the list is handled too.
  function tailOverlap(prev, cur) {
    for (let k = 0; k <= prev.length; k++) {
      const n = prev.length - k;
      if (n > cur.length) continue;
      let ok = true;
      for (let i = 0; i < n; i++) { if (prev[k + i] !== cur[i]) { ok = false; break; } }
      if (ok) return n;
    }
    return 0;
  }

  // Same question, assuming new lines land at the START (cur === new + prev.slice(0, n)).
  function headOverlap(prev, cur) {
    for (let k = 0; k <= prev.length; k++) {
      const n = prev.length - k;
      if (n > cur.length) continue;
      const start = cur.length - n;
      let ok = true;
      for (let i = 0; i < n; i++) { if (prev[i] !== cur[start + i]) { ok = false; break; } }
      if (ok) return n;
    }
    return 0;
  }

  // Returns true if the structured path handled this tick, false if there are no
  // log rows to read and the caller should fall back to parsing added nodes.
  function scanLogRows() {
    const cur = readLogRows();
    if (!cur) return false;

    // Lines already on screen when the script loads are history, not events —
    // parsing them would replay an arbitrary slice of a hand already over.
    if (!logSnapshotPrimed) {
      logSnapshot = cur;
      logSnapshotPrimed = true;
      return true;
    }

    const tailN = tailOverlap(logSnapshot, cur);
    const headN = headOverlap(logSnapshot, cur);

    // Which end the log grows from isn't documented and can't be checked without
    // a live table, so infer it and latch it. A tie means no usable overlap
    // (the list was replaced wholesale); reuse the direction already observed
    // rather than guessing again and replaying a hand backwards.
    let fresh;
    if (tailN > headN) {
      logOrientation = 'append';
      fresh = cur.slice(tailN);
    } else if (headN > tailN) {
      logOrientation = 'prepend';
      fresh = cur.slice(0, cur.length - headN).reverse();
    } else {
      fresh = logOrientation === 'prepend'
        ? cur.slice(0, cur.length - headN).reverse()
        : cur.slice(tailN);
    }

    // Snapshot before parsing: handleLogLine can render panels, and a re-entrant
    // scan must not see the pre-update snapshot and emit these lines twice.
    logSnapshot = cur;

    fresh.forEach((rowText) => {
      if (!rowText || rowText.length > 1000) return;
      // A row can render several lines; parse each separately or a multi-line
      // blob matches nothing at all.
      rowText.split('\n').forEach((raw) => {
        const line = raw.trim();
        if (!line || line.length > 300) return;
        handleLogLine(line);
      });
    });
    return true;
  }

  // Coalesce a burst of mutations into one scan per frame. Safe to drop extra
  // calls: the scan is snapshot-based, so one run catches everything queued.
  let logScanQueued = false;
  function scheduleLogScan() {
    if (logScanQueued) return;
    logScanQueued = true;
    requestAnimationFrame(() => { logScanQueued = false; scanLogRows(); });
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
      // Ignore batches that are entirely our own DOM — otherwise rendering a
      // badge or panel re-triggers the parser on itself.
      let relevant = false;
      for (const mut of mutations) {
        if (!isOwnTarget(mut.target)) { relevant = true; break; }
      }
      if (!relevant) return;

      // Preferred path: diff the whole rendered list. Falls through only when
      // the logRow selector matches nothing, i.e. an uncalibrated page.
      if (hasLogRows()) { scheduleLogScan(); return; }
      parseAddedNodes(mutations);
    });
    // characterData too: Torn rewrites existing rows in place, so a new message
    // may arrive with no node insertion at all.
    logObserver.observe(target, { childList: true, subtree: true, characterData: true });
    // Prime the snapshot immediately, so lines already on screen aren't replayed
    // as if they had just happened the first time anything mutates.
    scanLogRows();
    return true;
  }

  // Legacy added-nodes parsing, kept ONLY for pages where the log row selector
  // doesn't match and there is nothing to snapshot. It cannot tell a re-render
  // from a new event, which is exactly the bug the snapshot scanner fixes — so
  // it is a last resort, not a parallel path.
  function parseAddedNodes(mutations) {
    for (const mut of mutations) {
      mut.addedNodes.forEach((node) => {
        if (isOwnNode(node)) return;
        // Torn builds a log row as `<li><span>Name</span><span>called $X</span></li>`
        // and mutates the inner span, so reading the added node alone yielded
        // "called $3,500,000" with no actor — which failed every name-anchored
        // pattern and was the real reason no stats were ever recorded. Climb to
        // the enclosing row so the name and the verb arrive as one line.
        const el = node.nodeType === 1 ? node : node.parentElement;
        const row = el && el.closest ? el.closest(SELECTORS.logRow) : null;
        const source = row || node;
        const text = (source.textContent || '').trim();
        if (!text || text.length > 1000) return;
        // A single inserted node can carry several rendered lines; parse each
        // separately or a multi-line blob matches nothing at all.
        text.split('\n').forEach((raw) => {
          const line = raw.trim();
          if (!line || line.length > 300) return;
          if (recentlyHandled(line)) return;
          handleLogLine(line);
        });
      });
    }
  }

  // Text matching is the primary path now, not a fallback — see
  // findActionButtons(). The hashed selector is still tried first on the chance
  // some layout does expose a stable container, but it has never matched.
  function countActionControls() {
    const direct = document.querySelectorAll(SELECTORS.actionButtons);
    if (direct.length) return direct.length;
    return findTurnButtons().length;
  }

  // The seat currently on action, or null.
  function activeSeatXid() {
    const el = document.querySelector(SELECTORS.seatActive);
    return el ? resolveSeatKey(el) : null;
  }

  // Is it hero's turn?
  //
  // The seat's own `active___` marker is authoritative and is tried first.
  // Button labels are only a fallback, because they cannot distinguish a real
  // turn from a queued pre-action: a live scan found "Call Any / Check",
  // "Check" and "Check / Fold" all on screen at once, and the bare "Check"
  // among them is a pre-action control that reads exactly like a turn button.
  // Cueing off that left the screen glowing while waiting.
  function isHeroTurn() {
    if (heroUnresolved()) return countActionControls() > 0; // no seat to compare
    const active = activeSeatXid();
    if (active) return active === heroXid;
    return countActionControls() > 0;
  }

  // Is hero the NEXT player to act — i.e. one seat after whoever is on action,
  // skipping anyone folded or sitting out?
  //
  // Worth its own state: the useful moment to look up from your phone is
  // slightly before it is your turn, not at the instant the clock starts.
  // Returns null when the ring can't be read, so the caller can stay quiet
  // rather than guess.
  function isHeroNextToAct() {
    if (heroUnresolved()) return null;
    const active = activeSeatXid();
    if (!active || active === heroXid) return false;

    const ring = seatRingXids();
    if (!ring || ring.length < 2) return null;
    const i = ring.indexOf(active);
    if (i < 0) return null;

    for (let step = 1; step < ring.length; step++) {
      const xid = ring[(i + step) % ring.length];
      if (xid === active) break;
      if (seatIsOutOfHand(xid)) continue; // folded or sitting out — skipped
      return xid === heroXid;
    }
    return false;
  }

  // Seating order as XIDs. Prefers Torn's own positioner index, which a live
  // scan confirmed exists (`playerPositioner-1___` … `-8___`); falls back to the
  // geometric ring used for position labels.
  function seatRingXids() {
    const indexed = [];
    document.querySelectorAll(SELECTORS.seatPositioner).forEach((pos) => {
      let slot = null;
      for (const c of (pos.classList || [])) {
        const m = /^playerPositioner-(\d+)[_-]/.exec(c);
        if (m) { slot = parseInt(m[1], 10); break; }
      }
      if (slot === null) return;
      const seat = pos.querySelector(SELECTORS.seatContainer);
      const xid = seat ? resolveSeatKey(seat) : null;
      if (xid) indexed.push({ slot, xid });
    });
    if (indexed.length >= 2) {
      indexed.sort((a, b) => a.slot - b.slot);
      return indexed.map((e) => e.xid);
    }
    const geo = currentHand ? seatRotationFromDom(currentHand) : null;
    return geo && geo.length >= 2 ? geo : null;
  }

  function seatIsOutOfHand(xid) {
    const seat = Array.from(document.querySelectorAll(SELECTORS.seatContainer))
      .find((s) => resolveSeatKey(s) === xid);
    if (!seat) return true;
    if (isSeatSittingOut(seat)) return true;
    return !!seat.querySelector(SELECTORS.seatFolded)
      || Array.from(seat.classList || []).some((c) => /^folded[_-]/.test(c));
  }

  // In the hand but not on action: pre-action controls are showing.
  function heroCanPreAct() {
    return findActionButtons().some((b) => b.__tphPreaction);
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
      // heroUnresolved(), not `!heroXid`: findHeroXid() returns the truthy
      // pseudo-id "name:<username>" when hero's seat isn't readable yet, so the
      // old guard latched a failed bootstrap resolution in for the entire
      // session — defeating the very retry it guarded. Hero's own log lines
      // meanwhile re-resolve to the real seat XID as soon as seats render, so
      // contributions and winnings key under one id while heroXid holds another:
      // heroDelta reads 0, every plChipsEst gets `0 * share`, hero.netChips
      // never moves, and `xid === heroXid` stops skipping hero as their own
      // opponent. Keep retrying until it binds to a seat.
      if (heroUnresolved()) heroXid = findHeroXid();
      attachLogObserver();
      // Cheap, and it repairs "#<xid>" names from earlier versions as soon as
      // that player is seen at a table again.
      harvestSeatNames();
    }, 3000);
    harvestSeatNames();

    // Safety net. The snapshot scan is idempotent — a poll that finds nothing new
    // emits nothing — so it costs a textContent read per row and covers any
    // rendering path the observer doesn't see (a canvas-ish re-layout, a
    // mutation type we don't subscribe to, an observer detached by an SPA swap).
    setInterval(scanLogRows, 1000);
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

  // Percentage without the sign, for the seat badge where three "%" glyphs per
  // seat is more clutter than information.
  function fmtNum(v) {
    return v == null ? '–' : v.toFixed(0);
  }

  // Equity rounded to whole percent printed a flat "0%" for anything under 0.5,
  // which reads as "this hand cannot win" when it means "under one percent".
  // Against 8 random hands a weak holding genuinely lands there, so the
  // distinction matters.
  // Big blinds. Signed, because every use is a result rather than a size.
  function fmtBB(v) {
    if (v == null || isNaN(v)) return '—';
    const s = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
    return (v > 0 ? '+' : '') + s + 'bb';
  }

  // Win rate in big blinds per 100 hands — the standard unit, and the only one
  // that says whether you are actually beating the game. Null below a sample
  // where it would be pure noise: over 20 hands this is a number that will
  // change sign several times before it means anything.
  const BB100_MIN_HANDS = 50;
  function fmtBB100(netBB, hands) {
    if (!hands || hands < BB100_MIN_HANDS) {
      return hands ? `(need ${BB100_MIN_HANDS}+ hands for a win rate)` : '';
    }
    const rate = (netBB / hands) * 100;
    return `${rate > 0 ? '+' : ''}${rate.toFixed(1)} bb/100`;
  }

  function fmtEquity(v) {
    if (v == null) return '–';
    if (v > 0 && v < 0.5) return '<1%';
    if (v < 100 && v >= 99.5) return '>99%';
    return v.toFixed(0) + '%';
  }

  // Torn poker runs at millions per blind, so raw digit strings are unreadable
  // and even comma-grouped ones are long. Abbreviate at millions and above,
  // comma-group below that. Several call sites printed a bare Math.round() with
  // no grouping at all, which is what made P/L figures impossible to scan.
  const MONEY_TIERS = [[1e3, 'k', 0], [1e6, 'M', 1], [1e9, 'B', 1]];
  function fmtMoney(n) {
    const v = Math.round(Number(n) || 0);
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs < 1e4) return `${sign}$${abs.toLocaleString()}`;
    for (let i = 0; i < MONEY_TIERS.length; i++) {
      const [div, suffix, dp] = MONEY_TIERS[i];
      const scaled = abs / div;
      // Promote when rounding would print 1000 of a unit: $999,999 is "$1M",
      // never "$1000k".
      const shown = dp ? Number(scaled.toFixed(dp)) : Math.round(scaled);
      if (shown >= 1000 && i < MONEY_TIERS.length - 1) continue;
      return `${sign}$${dp ? trimZero(scaled) : shown}${suffix}`;
    }
    return `${sign}$${abs.toLocaleString()}`;
  }

  // One decimal, but never a trailing ".0" — "$13M" reads better than "$13.0M".
  function trimZero(x) {
    return x.toFixed(1).replace(/\.0$/, '');
  }

  // Same, with an explicit + on gains, for anything that is a profit/loss.
  function fmtSignedMoney(n) {
    const v = Math.round(Number(n) || 0);
    return (v > 0 ? '+' : '') + fmtMoney(v);
  }

  const POSTFLOP_STREETS = ['flop', 'turn', 'river'];

  // Aggression and fold frequency for ONE street.
  //
  // All of this comes out of streetActions, which has been fully populated the
  // whole time — computeRates simply collapsed the three streets into one
  // number. A player who fires flops and gives up on turns is a completely
  // different opponent from one who barrels three streets, and that was
  // invisible.
  function streetRates(sa) {
    if (!sa) return { afq: null, foldPct: null, actions: 0 };
    const agg = sa.bet + sa.raise;
    const passive = sa.call;
    const total = agg + passive + sa.check + sa.fold;
    return {
      afq: pct(agg, agg + passive),
      foldPct: pct(sa.fold, total),
      actions: total,
    };
  }

  function computeRates(p) {
    const aggActions = POSTFLOP_STREETS.reduce((sum, s) => sum + p.streetActions[s].bet + p.streetActions[s].raise, 0);
    const passActions = POSTFLOP_STREETS.reduce((sum, s) => sum + p.streetActions[s].call, 0);
    const byStreet = {};
    POSTFLOP_STREETS.forEach((s) => { byStreet[s] = streetRates(p.streetActions[s]); });
    return {
      vpip: pct(p.vpip, p.hands),
      pfr: pct(p.pfr, p.hands),
      afq: pct(aggActions, aggActions + passActions),
      threeBet: pct(p.threeBetMade, p.hands),
      foldTo3Bet: pct(p.foldTo3BetMade, p.foldTo3BetOpp),
      cbet: pct(p.cbetMade, p.cbetOpp),
      // Collected since the C-bet stat was added, and displayed nowhere until
      // v0.23.0. It is the most actionable postflop read there is: it says
      // directly whether c-betting this player prints.
      foldToCbet: pct(p.foldToCbetMade, p.foldToCbetOpp),
      limp: pct(p.limpMade, p.hands),
      limpShareOfVpip: pct(p.limpMade, p.vpip),
      wtsd: pct(p.wtsd, p.hands),
      avgBetPct: p.betSizeCount ? (p.betSizePctSum / p.betSizeCount) : null,
      byStreet,
    };
  }

  // Two cards -> the canonical hand class used everywhere else in this file:
  // "AA", "AKs", "AKo". Higher rank first, so AK and KA are one class.
  //
  // This is what turns a showdown into a data point. Torn writes revealed cards
  // as "reveals [9♥, 7♠] (Two Pairs: Nines and Sevens)"; parseCardsFromText
  // already handles the unicode suits, and everything after the bracket is
  // Torn's own hand description, which is ignored — it describes the made hand,
  // not the holding.
  function handClassFromCards(cards) {
    if (!cards || cards.length < 2) return null;
    const [a, b] = cards;
    const ia = RANKS.indexOf(a.rank);
    const ib = RANKS.indexOf(b.rank);
    if (ia < 0 || ib < 0) return null;
    const hi = ia >= ib ? a : b;
    const lo = ia >= ib ? b : a;
    if (hi.rank === lo.rank) return hi.rank + lo.rank;
    return hi.rank + lo.rank + (hi.suit === lo.suit ? 's' : 'o');
  }

  // Record one showdown against a player.
  //
  // `raised` splits the range by what they did preflop, which is the whole
  // point: "what do they turn up with when they RAISE" and "when they just
  // call" are two different ranges, and averaging them describes neither.
  function noteShowdown(xid, cards, hand) {
    const cls = handClassFromCards(cards);
    if (!cls) return;
    const p = getPlayer(xid);
    if (!p.shownHands || typeof p.shownHands !== 'object') p.shownHands = {};
    const e = p.shownHands[cls] || (p.shownHands[cls] = { seen: 0, raised: 0, won: 0 });
    e.seen += 1;
    if (hand && hand.countedPfr && typeof hand.countedPfr.has === 'function'
        && hand.countedPfr.has(xid)) e.raised += 1;
    if (hand && Array.isArray(hand.winners) && hand.winners.some((w) => w.xid === xid)) e.won += 1;
  }

  // Everything a player has shown down, newest counts first. Optionally split
  // by preflop action so the caller can ask "what do they raise with".
  function shownRange(p, mode) {
    const src = (p && p.shownHands) || {};
    const out = [];
    Object.keys(src).forEach((cls) => {
      const e = src[cls] || {};
      const n = mode === 'raised' ? (e.raised || 0)
        : mode === 'called' ? Math.max(0, (e.seen || 0) - (e.raised || 0))
          : (e.seen || 0);
      if (n > 0) out.push({ cls, n, won: e.won || 0, seen: e.seen || 0 });
    });
    out.sort((a, b) => b.n - a.n || a.cls.localeCompare(b.cls));
    return out;
  }

  // The window is capped above the largest sensible sessionWindow so the
  // setting can be raised without the stored history being too short to serve
  // it. Nothing reads more than sessionWindow entries.
  const RECENT_MAX = 40;

  // Bitfield layout for `recent`. See emptyPlayer.
  const RECENT_PLAY_MASK = 3; // bits 0-1: fold / play / raise
  const RECENT_WON = 4;       // bit 2

  function pushRecent(p, code) {
    if (!Array.isArray(p.recent)) p.recent = [];
    p.recent.push(code);
    if (p.recent.length > RECENT_MAX) p.recent.splice(0, p.recent.length - RECENT_MAX);
  }

  function recentWindow(p, n) {
    const w = (Array.isArray(p && p.recent) ? p.recent : []).slice(-Math.max(1, n));
    return w.length ? w : null;
  }

  // VPIP/PFR over the last `n` hands only. Null when the window is too thin to
  // say anything — the caller falls back to lifetime rather than showing a
  // number built from three hands.
  function sessionRates(p, n) {
    const win = recentWindow(p, n);
    if (!win) return null;
    const played = win.filter((c) => (c & RECENT_PLAY_MASK) >= 1).length;
    const raised = win.filter((c) => (c & RECENT_PLAY_MASK) >= 2).length;
    return {
      hands: win.length,
      vpip: (100 * played) / win.length,
      pfr: (100 * raised) / win.length,
    };
  }

  // Share of the last `n` hands this player WON.
  function sessionWinRate(p, n) {
    const win = recentWindow(p, n);
    if (!win) return null;
    const won = win.filter((c) => (c & RECENT_WON) !== 0).length;
    return { hands: win.length, won, winPct: (100 * won) / win.length };
  }

  // Tilt is BEHAVIOURAL: a player is tilting when they start playing differently
  // from how they normally play. It is not "they are losing" — losing money is
  // not tilt, and a player can be stuck three buy-ins and still play their game.
  // Measuring the loss would flag the wrong people.
  //
  // So this compares a player's recent window against THEIR OWN lifetime
  // baseline, not against the pool. A nit who opens up to 45% VPIP is tilting;
  // a station sitting at 70% forever is not, that is simply who they are.
  const TILT_MIN_RECENT = 10;    // below this the window is noise
  const TILT_MIN_LIFETIME = 30;  // below this there is no baseline to deviate from
  const TILT_VPIP_JUMP = 20;     // percentage points above their own norm
  // Tilt is a short-lived state. Reading it over more hands than this blends
  // the tilt stretch back into normal play and the signal disappears exactly
  // when it is most true, so the tilt window is capped independently of the
  // badge's sessionWindow setting.
  const TILT_WINDOW_MAX = 15;

  // A pot this size, lost, is the kind that actually sets someone off.
  const BIG_LOSS_BB = 75;
  // How long the sting lasts. Beyond this the loss is no longer plausibly
  // driving the next decision.
  const BIG_LOSS_MEMORY_HANDS = 20;
  // With a recent big loss as corroboration, less behavioural evidence is
  // needed to reach the same confidence — see the note in tiltRead.
  const TILT_VPIP_JUMP_AFTER_LOSS = 12;

  function tiltWindowSize() {
    return Math.min(STORE.settings.sessionWindow || TILT_WINDOW_MAX, TILT_WINDOW_MAX);
  }

  // Hands since this player last lost a pot of BIG_LOSS_BB or more, or null.
  function handsSinceBigLoss(p) {
    if (!p || typeof p.lastBigLossHand !== 'number' || p.lastBigLossHand < 0) return null;
    const ago = p.hands - p.lastBigLossHand;
    return ago >= 0 && ago <= BIG_LOSS_MEMORY_HANDS ? ago : null;
  }

  // Returns { jump, recent, baseline, hands, sinceBigLoss } or null.
  //
  // A big recent loss LOWERS the bar rather than being required on its own,
  // and that split is the whole design:
  //
  // - Losing money is not tilt. A player stuck three buy-ins who keeps playing
  //   their game is not tilting, so a big loss alone flags nothing.
  // - But a big loss raises the prior probability that a VPIP spike IS tilt
  //   rather than a run of playable cards. With that corroboration, 12 points
  //   of deviation carries the same weight 20 does without it.
  //
  // The baseline excludes the recent window, so a long tilt stretch cannot
  // quietly raise the very number it is being measured against.
  function tiltRead(p) {
    if (!p || p.hands < TILT_MIN_LIFETIME) return null;
    const win = sessionRates(p, tiltWindowSize());
    if (!win || win.hands < TILT_MIN_RECENT) return null;

    const priorHands = p.hands - win.hands;
    const priorVpip = priorHands > 0
      ? (100 * (p.vpip - (win.vpip / 100) * win.hands)) / priorHands
      : null;
    if (priorVpip == null || priorVpip < 0) return null;

    const sinceBigLoss = handsSinceBigLoss(p);
    const threshold = sinceBigLoss != null ? TILT_VPIP_JUMP_AFTER_LOSS : TILT_VPIP_JUMP;

    const jump = win.vpip - priorVpip;
    if (jump < threshold) return null;
    return { jump, recent: win.vpip, baseline: priorVpip, hands: win.hands, sinceBigLoss };
  }

  // Running hot: winning far more of the recent hands than any seat count
  // makes likely. Expectation is roughly 1/seats — about 11% nine-handed and
  // 17% six-handed — so this threshold is 2-3x expectation whichever it is.
  //
  // Not the mirror of tilt. Tilt is relative to the player's own baseline
  // because playing differently is what matters; running hot is absolute,
  // because the point is simply that they are scooping pots.
  const HEAT_MIN_RECENT = 8;
  const HEAT_WIN_PCT = 35;

  // Returns { winPct, won, hands } or null.
  function heatRead(p) {
    if (!p) return null;
    const w = sessionWinRate(p, tiltWindowSize());
    if (!w || w.hands < HEAT_MIN_RECENT) return null;
    return w.winPct >= HEAT_WIN_PCT ? w : null;
  }

  // ===========================================================================
  // 6. ARCHETYPE CLASSIFIER
  // ===========================================================================

  // Average tendencies of the TORN poker pool, in percent.
  //
  // PROVENANCE, and it matters: these are the figures published in HopesG's
  // "Torn Poker HUD - Player Profiler & Coach" userscript (MIT, GreasyFork
  // 569933). They were NOT measured by this HUD, and no independent
  // confirmation exists. They are used because the alternative — standard live
  // poker norms — is demonstrably wrong here, not because they are certain.
  //
  // The correction is large. Torn's pool plays roughly 51% of hands and raises
  // 13%, where a live low-stakes game is nearer 25% / 18%. Thresholds written
  // for normal poker therefore classified almost the entire Torn population as
  // "Fish", which is accurate on paper and useless in practice: a label that
  // every seat shares carries no information.
  //
  // observedPoolAverages() below reports what THIS HUD has actually seen, and
  // the players list shows both, so the two can be compared as data accrues.
  // NOTE ON WTSD: an earlier pass listed `wtsd: 20.9` here. That figure is the
  // source's `wwsf` — won-when-saw-flop — which is a different statistic from
  // went-to-showdown (typically ~25-30% vs ~45% in normal poker). No pool figure
  // for WTSD exists, so WTSD is left UNSHRUNK rather than anchored to an
  // unrelated number. Same reasoning as AFq. Don't reinstate it without a source.
  const POOL_AVG = {
    vpip: 50.9,
    pfr: 13.4,
    threeBet: 3.7,
    foldTo3Bet: 14.9,
    cbet: 40.3,
    foldToCbet: 56.1,
    // Share of a player's VPIP that is limping rather than raising. The pool's
    // defining trait: with VPIP 50.9 and PFR 13.4, most voluntary money goes in
    // without a raise.
    limpShareOfVpip: 44.8,
  };

  // Strength of the prior, in pseudo-observations.
  //
  // A rate over few hands is mostly noise: 3 hands played out of 3 is not a
  // 100% VPIP. Shrinking toward the pool average pulls small samples back
  // toward "typical" and leaves large samples essentially untouched — at 12,
  // a 6-hand read is roughly two-thirds prior, a 100-hand read about 10%.
  //
  // This replaces hiding a player behind "Unrated" entirely: an estimate that
  // says "probably around average, we've barely seen them" beats no estimate,
  // and it degrades continuously instead of flipping at a threshold.
  const PRIOR_WEIGHT = 12;

  function shrunkPct(made, opps, poolPct) {
    const n = opps || 0;
    if (n <= 0 && !PRIOR_WEIGHT) return null;
    return (100 * (made + PRIOR_WEIGHT * (poolPct / 100))) / (n + PRIOR_WEIGHT);
  }

  // Same shape as computeRates, with every rate shrunk toward POOL_AVG.
  // computeRates stays raw: the Stats tab should show what was actually
  // observed. Classification uses these.
  function computeShrunkRates(p) {
    const raw = computeRates(p);
    return {
      vpip: shrunkPct(p.vpip, p.hands, POOL_AVG.vpip),
      pfr: shrunkPct(p.pfr, p.hands, POOL_AVG.pfr),
      threeBet: shrunkPct(p.threeBetMade, p.hands, POOL_AVG.threeBet),
      foldTo3Bet: shrunkPct(p.foldTo3BetMade, p.foldTo3BetOpp, POOL_AVG.foldTo3Bet),
      cbet: shrunkPct(p.cbetMade, p.cbetOpp, POOL_AVG.cbet),
      foldToCbet: shrunkPct(p.foldToCbetMade, p.foldToCbetOpp, POOL_AVG.foldToCbet),
      limpShareOfVpip: shrunkPct(p.limpMade, p.vpip, POOL_AVG.limpShareOfVpip),
      // No published pool figure for these, so they are left raw rather than
      // shrunk toward a number that was never measured. See the WTSD note above.
      wtsd: raw.wtsd,
      afq: raw.afq,
      avgBetPct: raw.avgBetPct,
      byStreet: raw.byStreet,
    };
  }

  // What this HUD has actually observed, for players with a real sample.
  // Returned so the UI can show it next to POOL_AVG — if the two diverge over a
  // few hundred hands, POOL_AVG is the thing to correct.
  const POOL_OBS_MIN_HANDS = 25;
  function observedPoolAverages() {
    const ps = Object.keys(STORE.players)
      // Hero's own record is not part of the opponent pool, and including it
      // would bias the average toward your own style.
      .filter((xid) => heroUnresolved() || String(xid) !== String(heroXid))
      .map((xid) => STORE.players[xid])
      .filter((p) => p && p.hands >= POOL_OBS_MIN_HANDS);
    if (ps.length < 3) return null; // too few to mean anything
    const mean = (f) => {
      const vals = ps.map(f).filter((v) => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      players: ps.length,
      vpip: mean((p) => pct(p.vpip, p.hands)),
      pfr: mean((p) => pct(p.pfr, p.hands)),
    };
  }

  // How far from POOL_AVG a stat has to move before it means anything, in
  // percentage points.
  //
  // These are a JUDGEMENT CALL, not a measurement. The honest thing would be the
  // population standard deviation of each stat, which nothing here has measured
  // — so they are set from how much room each stat has and how much a difference
  // changes play. The scale is what makes deviations comparable: 5pp on VPIP
  // (norm 50.9) is noise, while 5pp on 3-bet (norm 3.7) more than doubles it.
  //
  // One spread = "notable", two = "extreme". Adjust these rather than adding
  // per-stat special cases at the call sites.
  const POOL_SPREAD = {
    vpip: 10,
    pfr: 6,
    threeBet: 2,
    foldTo3Bet: 12,
    cbet: 15,
    foldToCbet: 12,
    limpShareOfVpip: 15,
  };

  // 'typical' | 'notable' | 'extreme', plus direction. Null norm means the stat
  // has no published pool figure (AFq, WTSD) — those get no verdict rather than
  // a made-up one.
  function deviation(value, norm, spread) {
    if (value == null || norm == null || !spread) return null;
    const diff = value - norm;
    const mags = Math.abs(diff) / spread;
    return {
      diff,
      level: mags >= 2 ? 'extreme' : mags >= 1 ? 'notable' : 'typical',
      dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    };
  }

  // Thresholds are POOL-RELATIVE, not absolute. Each is written as a multiple
  // of, or distance from, POOL_AVG so that correcting POOL_AVG later moves the
  // labels with it rather than silently invalidating them.
  //
  // Pool anchors: VPIP 50.9, PFR 13.4, PFR/VPIP 0.26.
  const A = {
    tight: POOL_AVG.vpip * 0.55,   // ~28 — well below pool, "tight" for Torn
    loose: POOL_AVG.vpip * 1.15,   // ~59 — meaningfully looser than pool
    aggRatio: 0.45,                // PFR/VPIP; pool sits at 0.26
    passiveRatio: 0.20,            // clearly below pool: raises almost nothing
  };

  // Order matters — first match wins.
  const ARCHETYPE_RULES = [
    { name: 'Nit', test: (r) => r.vpip != null && r.vpip < A.tight && (r.pfr == null || r.pfr / r.vpip < A.aggRatio) },
    { name: 'TAG', test: (r) => r.vpip != null && r.vpip < A.tight && r.pfr != null && r.pfr / r.vpip >= A.aggRatio },
    { name: 'Maniac', test: (r) => r.afq != null && r.afq > 60 && r.vpip != null && r.vpip > A.loose },
    { name: 'LAG', test: (r) => r.vpip != null && r.vpip > A.loose && r.pfr != null && r.pfr / r.vpip >= A.aggRatio },
    { name: 'Station', test: (r) => r.vpip != null && r.vpip > A.loose && (r.pfr == null || r.pfr / r.vpip < A.passiveRatio) },
    { name: 'Fish', test: (r) => r.vpip != null && r.vpip > POOL_AVG.vpip && (r.pfr == null || r.pfr / r.vpip < A.aggRatio) },
  ];

  // Three-letter forms for the seat badge and the players list, where the full
  // word eats space the numbers need. Panels and reports keep the full name.
  const ARCHETYPE_SHORT = {
    Nit: 'NIT', TAG: 'TAG', LAG: 'LAG', Maniac: 'MAN',
    Station: 'STA', Fish: 'FSH', Balanced: 'BAL', Unrated: 'UNR',
  };
  function shortType(label) {
    return ARCHETYPE_SHORT[label] || String(label || '').slice(0, 3).toUpperCase();
  }

  function classify(player) {
    if (player.hands < STORE.settings.minHands) return 'Unrated';
    return classifyProvisional(player);
  }

  // Same rules with no minimum-hands gate. The seat badge uses this so a player
  // you have only just met still gets a readable type rather than the word
  // "Unrated", which is the least useful thing a HUD can put on the felt. The
  // caller is responsible for marking it as provisional.
  //
  // Shrunk rates, not raw: without them a player seen for two hands who happened
  // to play both reads as a 100%-VPIP maniac. With them they read as roughly
  // pool-average until there is evidence otherwise.
  function classifyProvisional(player) {
    const r = computeShrunkRates(player);
    for (const rule of ARCHETYPE_RULES) {
      if (rule.test(r)) return rule.name;
    }
    return 'Balanced';
  }

  // ===========================================================================
  // 9. GTO-INSPIRED STRATEGY MODULE
  // ===========================================================================

  // RFI (raise-first-in) charts, 100bb. TWO sets: Torn tables run both short and
  // full ring, and one set cannot serve both — full-ring UTG opens roughly 11%
  // where 6-max UTG opens roughly 17%, so using the 6-max chart at a 9-handed
  // table opens about half again too many hands from the worst seat at the table.
  // `rfiChartFor` picks the set from the seat count observed that hand.
  //
  // These are simplified reference charts, NOT solver output. Widths are
  // calibrated to published figures (see SOURCES below); the exact hand at each
  // range edge is a reconstruction that hits that width.
  //
  // The percentage on each line is MEASURED, not asserted: expand the range with
  // expandRangeToken and weight by combos (pair 6, suited 4, offsuit 12) out of
  // 1326. Re-measure and update the comment if you touch a range. Eyeballing a
  // range string undercounts offsuit hands 3x, which is how an earlier pass
  // shipped charts at roughly two-thirds of their intended width.
  //
  // SOURCES (frequencies cross-checked, then each published range string
  // re-measured against its own published percentage — several charts found in
  // the wild disagree with their own stated figure, usually because the offsuit
  // block is omitted, so a figure was only used when the two agreed):
  //   upswingpoker.com/charts        6-max UTG 18.5 / BTN 43.1;
  //                                  9-max UTG 10.2 / BTN 40.8
  //   pokercoaching.com/preflop-charts  6-max LJ 17.0, HJ 21.1, CO 27.8;
  //                                  full ring UTG 12.1, UTG+1 13.3, LJ 16.1, HJ 19.6
  //   preflopwizard.app/blog/preflop-charts  6-max CO 25.2, BTN 41.8;
  //                                  full ring UTG 12.5, MP 13.4, HJ 16.7, CO 22.8, BTN 40.6
  //   blog.freebetrange.com          6-max bands EP 15-17, HJ 19-22, CO 25-30,
  //                                  BTN 40-48, SB 39-47
  const RFI_RANGES = {
    // <= 6 handed.
    SHORT: {
      EP: '22+,A2s+,KTs+,QTs+,JTs,T9s,98s,ATo+,KJo+',                                    // 17.3%
      MP: '22+,A2s+,K8s+,Q8s+,J8s+,T8s+,98s,87s,76s,ATo+,KJo+,QJo',                      // 21.0%
      CO: '22+,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A8o+,KTo+,QTo+,JTo',            // 26.4%
      BTN: '22+,A2s+,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K7o+,Q9o+,J9o+,T9o', // 41.8%
      // SB is raise-or-fold with only the BB left to act, so it is wide despite
      // being out of position — it is not "one step tighter than the button".
      SB: '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o', // 42.1%
    },
    // 7+ handed. Early position tightens sharply; the button barely moves, which
    // is why only the early seats really need a separate chart.
    FULL: {
      UTG: '22+,ATs+,KTs+,QTs+,JTs,AQo+,KQo',                                            // 11.6%
      UTG1: '22+,A9s+,KTs+,QTs+,JTs,T9s,AJo+,KQo',                                       // 13.1%
      LJ: '22+,A7s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+',                                       // 16.4%
      HJ: '22+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,ATo+,KTo+',                                   // 19.5%
      CO: '22+,A2s+,K7s+,Q9s+,J8s+,T8s+,97s+,87s,76s,A9o+,KTo+,QJo',                     // 23.1%
      BTN: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o', // 40.6%
      // WEAKEST NUMBER IN THE SET: no full-ring SB figure survived the
      // consistency check (published SB charts mix raising and limping, so the
      // quoted percentage covers both). Banded by analogy with the 6-max SB, one
      // notch tighter. Treat as the least trustworthy chart here.
      SB: '22+,A2s+,K3s+,Q6s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s,A2o+,K9o+,Q9o+,J9o+,T9o', // 39.1%
    },
    // No BB entry in either set, on purpose. The big blind is never raising
    // FIRST in — it is always defending or isolating, and preflopBaseline routes
    // it there. Do not add one: the code used to fall back to the CO chart for
    // any unknown label, which silently gave big-blind advice off a cutoff range.
  };

  // Seven or more players makes it a full-ring hand. Below that the short-handed
  // charts apply; Torn tables run both, so this is read per hand rather than
  // taken from the tableMax setting (which only drives the equity quote).
  const FULL_RING_SEATS = 7;
  function rfiChartFor(position, seats) {
    const set = (seats >= FULL_RING_SEATS) ? RFI_RANGES.FULL : RFI_RANGES.SHORT;
    return set[position] || null;
  }

  // 3-bet ranges facing a single open. Split by whether hero will be in position
  // postflop — the OOP chart existed before this and was never actually used,
  // so every 3-bet call was made on the in-position range.
  const THREE_BET_RANGES = {
    IP: '99+,ATs+,KJs+,QTs+,JTs,T9s,98s,A5s,A4s,A3s,AQo+,KQo',  // 9.7%
    OOP: 'TT+,AJs+,KQs,QJs,A5s,A4s,AQo+',                        // 6.2%
  };

  // Facing a 3-bet (or more). Deliberately value-heavy: this is a "continue at
  // all" reference, not a balanced 4-betting strategy.
  const FOUR_BET_RANGE = 'QQ+,AKs,AKo,A5s'; // 2.9%

  function expandRangeToken(token) {
    // Handles: pair "88", pair+ "88+", pair range "66-99",
    // suited/offsuit exact "AJs", plus "AJs+", range "A5s-A9s".
    const idx = rankIdx;
    const hands = new Set();

    const pairPlus = /^([2-9TJQKA])\1\+$/.exec(token);
    const pairRange = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(token);
    const pairExact = /^([2-9TJQKA])\1$/.exec(token);
    const suitedPlus = /^([2-9TJQKA])([2-9TJQKA])(s|o)\+$/.exec(token);
    // Both sides must share the high card and the suitedness: "A5s-A9s". The
    // backreferences used to be on the wrong groups, so this form matched
    // nothing and the token was dropped in silence — a range could lose a whole
    // chunk of hands with no error anywhere.
    const suitedRange = /^([2-9TJQKA])([2-9TJQKA])(s|o)-\1([2-9TJQKA])\3$/.exec(token);
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

  const rangeCache = {};
  function parseRange(rangeStr) {
    if (rangeCache[rangeStr]) return rangeCache[rangeStr];
    const all = new Set();
    rangeStr.split(',').forEach((tok) => {
      expandRangeToken(tok.trim()).forEach((h) => all.add(h));
    });
    rangeCache[rangeStr] = all;
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

  // Fraction of the time the defender must continue. Returns null when the pot
  // isn't known: 0/(0+0) is NaN, and "defend roughly NaN% of your range" was
  // reaching the live coach panel whenever the script loaded mid-hand, because
  // the log snapshot is primed (not parsed) on attach so hand.pot starts at 0.
  function minimumDefenseFrequency(bet, pot) {
    const p = Number(pot) || 0;
    const b = Number(bet) || 0;
    if (p + b <= 0) return null;
    return p / (p + b);
  }

  // How many players limped in before any raise. An RFI chart is a raise-FIRST-in
  // chart: over limpers the spot is an isolation raise, and the old code applied
  // the opening chart to it and called the result "open-raise".
  function preflopLimperCount(hand) {
    const seen = new Set();
    for (const a of hand.actions) {
      if (a.s !== 'preflop') break;          // actions are in order; preflop is first
      if (a.a === 'raise' || a.a === 'all-in') break;
      if (a.a === 'call') seen.add(a.x);
    }
    return seen.size;
  }

  // True if hero acts after `villainXid` POSTFLOP, which is what "in position"
  // means for the 3-bet chart. Both rotations are SB-first — exactly postflop
  // order — so a later index means later to act.
  //
  // Prefer the seat ring. The log rotation only contains players who have acted,
  // and this used to fall back to "hero hasn't acted, so hero is after everyone
  // who has" — which answers a question about PREFLOP order, and quietly picked
  // the looser in-position chart whenever hero hadn't acted yet. Returning null
  // is the honest answer; the caller then uses the tighter chart and says so.
  function heroIsInPositionVs(hand, villainXid) {
    if (!heroXid || !villainXid) return null;
    const rot = seatRotationFromDom(hand) || buildRotation(hand);
    if (!rot) return null;
    const vi = rot.indexOf(villainXid);
    const hi = rot.indexOf(heroXid);
    if (vi < 0 || hi < 0) return null;
    return hi > vi;
  }

  // Position as it appears in every coach line. Always present, so you can see
  // at a glance which seat the advice is for — postflop lines used to omit it
  // entirely, which meant the one number you most need to sanity-check the
  // advice against was missing exactly when the board mattered most.
  //   CO   read from the seat ring (exact)
  //   CO?  derived from the log's action order (less certain)
  //   ?    not established this hand
  function positionTag(position, inferred) {
    if (!position) return '?';
    return inferred ? `${position}?` : position;
  }

  // Preflop is split by SITUATION first, then by chart. Applying an opening
  // range to a limped pot, or a 3-bet range to a 4-bet decision, gives advice
  // that reads as confident and is answering a different question.
  function preflopBaseline(ctx) {
    const { position, positionInferred, heroCards, posDiag, seats,
            preflopRaises, limpers, heroInPosition, heroHasRaised } = ctx;

    // Without a known position no chart is meaningful — say so rather than
    // quietly assuming a seat and giving confidently wrong advice.
    if (!position) {
      return `Baseline (?): position unknown this hand (${posDiag || 'reason unclear'}) — no preflop chart applied.`;
    }
    // A "?" marks a seat derived from the log's action order rather than read
    // off the seat ring: a misread seat changes the chart, and advice that looks
    // equally confident either way is the failure mode worth avoiding.
    const pos = positionTag(position, positionInferred);
    const inRange = (r) => isHandInRange(heroCards[0], heroCards[1], r);

    // --- facing a re-raise -------------------------------------------------
    if (preflopRaises >= 2) {
      const verb = heroHasRaised ? '4-bet or call' : 'call';
      return inRange(FOUR_BET_RANGE)
        ? `Baseline (${pos}): ${verb} — inside a standard continuing range vs a re-raise.`
        : `Baseline (${pos}): fold to the re-raise — outside a standard continuing range.`;
    }

    // --- facing a single open ----------------------------------------------
    if (preflopRaises === 1 && !heroHasRaised) {
      // Unknown relative position falls back to the TIGHTER chart. The old code
      // used the in-position range unconditionally, which is the loose one.
      const ip = heroInPosition === true;
      const chart = ip ? THREE_BET_RANGES.IP : THREE_BET_RANGES.OOP;
      const note = heroInPosition == null
        ? ', position vs the raiser unknown so the tighter out-of-position chart is used'
        : (ip ? ', in position' : ', out of position');
      return inRange(chart)
        ? `Baseline (${pos}): 3-bet — in a standard 3-bet range${note}.`
        : `Baseline (${pos}): fold, or flat if the pot odds and your reads justify it — outside a standard 3-bet range${note}.`;
    }

    // --- hero already opened and is only facing calls -----------------------
    if (heroHasRaised) {
      return `Baseline (${pos}): you are the preflop aggressor — no further preflop chart applies.`;
    }

    // --- big blind: never raise-first-in ------------------------------------
    const rfiRange = rfiChartFor(position, seats);
    if (!rfiRange) {
      return limpers > 0
        ? `Baseline (${pos}): no raise to face, ${limpers} limper(s) — isolating with the top of your range is usually right. The big blind has no RFI chart (it is never first in), so none is applied.`
        : `Baseline (${pos}): checking is free. The big blind has no RFI chart (it is never first in), so none is applied.`;
    }

    // --- limped pot: isolation, not RFI -------------------------------------
    if (limpers > 0) {
      return inRange(rfiRange)
        ? `Baseline (${pos}): raise to isolate the ${limpers} limper(s) — in your ${position} opening range (an opening chart is only a rough floor here; limpers rarely fold, so lean toward value).`
        : `Baseline (${pos}): fold — outside your ${position} opening range, and limpers make a steal less likely to get through.`;
    }

    // --- genuinely unopened: the one spot an RFI chart is for ----------------
    return inRange(rfiRange)
      ? `Baseline (${pos}): open-raise — in your ${position} RFI range.`
      : `Baseline (${pos}): fold — outside a standard ${position} opening range.`;
  }

  function gtoBaselineSuggestion(ctx) {
    const { street, heroCards, betFacing, pot, position, positionInferred, posDiag } = ctx;
    if (street === 'preflop' && heroCards) return preflopBaseline(ctx);
    // Postflop lines carry the position too. They didn't before, so the seat
    // silently disappeared from the advice the moment the flop came down.
    const tag = positionTag(position, positionInferred);
    const why = position ? '' : ` (${posDiag || 'position not established'})`;
    const mdf = minimumDefenseFrequency(betFacing, pot);
    if (mdf != null) {
      return `Baseline (${tag}): defend roughly ${fmtPct(mdf * 100)} of your range here (MDF), `
        + `pot ${fmtMoney(pot)}.${why}`;
    }
    return `Baseline (${tag}): check/bet a balanced portion of your range. (Pot size unknown `
      + `this hand — no MDF or pot odds; this happens when the HUD starts mid-hand.)${why}`;
  }

  function exploitDeviation(villainXid) {
    if (!villainXid) return null;
    const p = STORE.players[villainXid];
    if (!p || p.hands < STORE.settings.minHands) return null;
    const r = computeRates(p);

    // One line, and only the single strongest read — a stack of exploits is a
    // paragraph nobody finishes mid-decision. Ordered by how much the
    // adjustment is worth, most actionable first.
    const who = playerDisplayName(villainXid);

    // Fold-to-c-bet is the most directly actionable postflop number there is:
    // it says whether c-betting them prints. It was collected for versions
    // before anything read it.
    if (r.foldToCbet != null && p.foldToCbetOpp >= 8) {
      if (r.foldToCbet > 60) return `⚡ ${who} folds to c-bets ${fmtPct(r.foldToCbet)} — fire the flop.`;
      if (r.foldToCbet < 30) return `⚡ ${who} won't fold flops (${fmtPct(r.foldToCbet)}) — value only, no bluffs.`;
    }
    if (r.foldTo3Bet != null && r.foldTo3Bet > 70) {
      return `⚡ ${who} folds to 3-bets ${fmtPct(r.foldTo3Bet)} — 3-bet light.`;
    }
    if (r.vpip != null && r.vpip > 40 && r.pfr != null && r.pfr / (r.vpip || 1) < 0.3) {
      return `⚡ ${who} is a station (VPIP ${fmtPct(r.vpip)}) — value bet, don't bluff.`;
    }
    if (r.afq != null && r.afq > 55) {
      return `⚡ ${who} is very aggressive (AFq ${fmtPct(r.afq)}) — call down lighter.`;
    }
    return null;
  }

  // ===========================================================================
  // 12. CARD READING, EQUITY, POSITION, SESSION
  // ===========================================================================

  const SUIT_CHARS = ['s', 'h', 'd', 'c'];
  const RANK_WORDS = {
    ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', nine: '9', eight: '8',
    seven: '7', six: '6', five: '5', four: '4', three: '3', two: '2',
  };

  function normRank(raw) {
    const r = String(raw).toUpperCase();
    return r === '10' ? 'T' : r;
  }

  // Cards can come from a class name, an aria-label, or plain log text — try all.
  function parseCardEl(el) {
    const cn = typeof el.className === 'string' ? el.className : '';
    const m = CARD_CLASS_RE.exec(cn);
    if (m) return { suit: m[1][0].toLowerCase(), rank: normRank(m[2]) };
    const al = (el.getAttribute('aria-label') || '').toLowerCase();
    const am = /(ace|king|queen|jack|ten|nine|eight|seven|six|five|four|three|two)\s+of\s+(spades|hearts|diamonds|clubs)/.exec(al);
    if (am) return { suit: am[2][0], rank: RANK_WORDS[am[1]] };
    return null;
  }

  const SUIT_SYMBOLS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

  function parseCardsFromText(text) {
    const out = [];
    const re = /(10|[2-9TJQKA])\s*([shdc♠♥♦♣])/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const suitRaw = m[2];
      const suit = SUIT_SYMBOLS[suitRaw] || suitRaw.toLowerCase();
      if (!SUIT_CHARS.includes(suit)) continue;
      out.push({ rank: normRank(m[1]), suit });
    }
    return out.slice(0, 5);
  }

  function readHeroCards() {
    const seat = document.querySelector(SELECTORS.heroSeat);
    let els = seat ? seat.querySelectorAll(SELECTORS.heroCards) : [];
    if (!els.length) els = document.querySelectorAll(SELECTORS.heroCards);
    const cards = [];
    els.forEach((el) => { const c = parseCardEl(el); if (c) cards.push(c); });
    return cards.slice(0, 2);
  }

  // Read the pot straight off the table.
  //
  // Confirmed live (v0.17.0 scan): DIV.potsWrapper_ > DIV.totalPotWrap_, whose
  // text is "POT:$7,000,000". Until now the pot was ONLY the running sum of
  // parsed log amounts, which starts at zero whenever the HUD attaches mid-hand
  // (the visible log is primed, not parsed) and drifts permanently on any amount
  // the parser misses. That silently corrupted pot odds and MDF — and produced
  // "defend roughly NaN%" on a live table.
  //
  // The DOM figure is authoritative when present; the log sum stays as fallback.
  function readDomPot() {
    for (const sel of ['[class*="totalPotWrap_"]', '[class*="potsWrapper_"]']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent || '';
      let best = null;
      const re = /\$\s*([\d,]+)/g;
      let m;
      // Side pots put several figures in the wrapper; the total is the largest.
      while ((m = re.exec(text))) {
        const v = parseAmount(m[1]);
        if (v > 0 && (best === null || v > best)) best = v;
      }
      if (best !== null) return best;
    }
    return null;
  }

  // Pot to reason with: the table's own number if we can read it, else our sum.
  function effectivePot(hand) {
    const dom = readDomPot();
    if (dom != null) return dom;
    return (hand && hand.pot) || 0;
  }

  // The board, read from the DOM.
  //
  // `communityCards_` matched ZERO on a live scan while 5 board cards were
  // face-up — so the board has never once been read from the DOM, and every
  // postflop equity number came from the log-parsed fallback (or nothing, if a
  // street line was missed). That is the quietest failure in the file: equity
  // simply reads as a preflop number and looks plausible.
  //
  // Rather than guess another hashed container name, derive it from structure
  // that IS confirmed: a face-up card is `[class*="front_"] > div[role="img"]`,
  // and hero's are the ones inside `[class*="hand_"]`. Everything face-up that
  // is NOT in hero's hand is the board. Done in JS because the exclusion is an
  // ancestor test, which a single CSS selector can't express portably.
  function readBoardCards() {
    const cards = [];
    const seen = new Set();
    const push = (el) => {
      const c = parseCardEl(el);
      if (!c) return;
      const key = c.rank + c.suit;
      if (seen.has(key)) return; // a card can't appear twice on one board
      seen.add(key);
      cards.push(c);
    };

    // Named container first, on the chance some layout does expose one.
    document.querySelectorAll(SELECTORS.communityCards).forEach(push);

    if (!cards.length) {
      document.querySelectorAll(SELECTORS.anyFaceUpCard).forEach((el) => {
        if (el.closest(SELECTORS.heroHand)) return;  // hero's hole cards
        if (el.closest(SELECTORS.seatContainer)) return; // an opponent's revealed cards
        push(el);
      });
    }

    if (cards.length) return cards.slice(0, 5);
    return (currentHand && currentHand.board) || []; // fall back to the log-parsed board
  }

  function cardToNum(c) {
    return { r: rankIdx(c.rank) + 2, s: SUIT_CHARS.indexOf(c.suit) };
  }

  // 7-card evaluator. Returns a comparable array: [category, tiebreakers...].
  // Category 8=straight flush … 0=high card. Verified against known hand
  // rankings and published preflop equities before porting here.
  function evaluate7(cards) {
    const ranks = cards.map((c) => c.r);
    const suits = cards.map((c) => c.s);
    const rc = {};
    const sc = {};
    ranks.forEach((r) => { rc[r] = (rc[r] || 0) + 1; });
    suits.forEach((s) => { sc[s] = (sc[s] || 0) + 1; });

    let flushSuit = -1;
    Object.keys(sc).forEach((s) => { if (sc[s] >= 5) flushSuit = +s; });

    const straightHigh = (list) => {
      const set = new Set(list);
      if (set.has(14)) set.add(1); // wheel: A counts low
      for (let hi = 14; hi >= 5; hi--) {
        let ok = true;
        for (let i = 0; i < 5; i++) { if (!set.has(hi - i)) { ok = false; break; } }
        if (ok) return hi;
      }
      return 0;
    };

    // A flush and a full house can't coexist in 7 cards, so returning here is safe.
    if (flushSuit >= 0) {
      const fr = cards.filter((c) => c.s === flushSuit).map((c) => c.r);
      const sfh = straightHigh(fr);
      if (sfh) return [8, sfh];
      return [5].concat(fr.sort((a, b) => b - a).slice(0, 5));
    }

    const sh = straightHigh(ranks);
    const groups = Object.keys(rc).map((r) => [+r, rc[r]]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const c0 = groups[0][1];
    const c1 = groups[1] ? groups[1][1] : 0;

    if (c0 === 4) {
      const q = groups[0][0];
      return [7, q, Math.max.apply(null, ranks.filter((r) => r !== q))];
    }
    if (c0 === 3 && c1 >= 2) return [6, groups[0][0], groups[1][0]];
    if (sh) return [4, sh];
    if (c0 === 3) {
      const t = groups[0][0];
      return [3, t].concat(ranks.filter((r) => r !== t).sort((a, b) => b - a).slice(0, 2));
    }
    if (c0 === 2 && c1 === 2) {
      const p1 = groups[0][0];
      const p2 = groups[1][0];
      const k = Math.max.apply(null, ranks.filter((r) => r !== p1 && r !== p2));
      return [2, Math.max(p1, p2), Math.min(p1, p2), k];
    }
    if (c0 === 2) {
      const p = groups[0][0];
      return [1, p].concat(ranks.filter((r) => r !== p).sort((a, b) => b - a).slice(0, 3));
    }
    return [0].concat(ranks.slice().sort((a, b) => b - a).slice(0, 5));
  }

  function cmpHand(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  // Monte Carlo equity against N random hands. "Random" is deliberate and
  // stated in the UI: real opponents have ranges, so this reads pessimistically
  // against tight players and optimistically against loose ones.
  function estimateEquity(heroCards, boardCards, nOpp) {
    if (!heroCards || heroCards.length !== 2) return null;
    const hero = heroCards.map(cardToNum);
    const board = (boardCards || []).map(cardToNum).filter((c) => c.s >= 0 && c.r >= 2);
    if (hero.some((c) => c.s < 0 || c.r < 2)) return null;
    if (board.length > 5) return null;

    const dead = new Set(hero.concat(board).map((c) => c.r * 4 + c.s));
    const deck = [];
    for (let r = 2; r <= 14; r++) {
      for (let s = 0; s < 4; s++) { if (!dead.has(r * 4 + s)) deck.push({ r, s }); }
    }

    const need = 5 - board.length;
    const take = need + 2 * nOpp;
    if (take > deck.length) return null;

    const iters = STORE.settings.equityIters || 1200;
    let win = 0;
    let tie = 0;
    for (let it = 0; it < iters; it++) {
      // Partial Fisher–Yates: only shuffle the cards this trial consumes.
      for (let i = 0; i < take; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i));
        const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
      }
      const full = board.concat(deck.slice(0, need));
      const hv = evaluate7(hero.concat(full));
      let best = null;
      for (let o = 0; o < nOpp; o++) {
        const ov = evaluate7([deck[need + 2 * o], deck[need + 2 * o + 1]].concat(full));
        if (best === null || cmpHand(ov, best) > 0) best = ov;
      }
      const c = cmpHand(hv, best);
      if (c > 0) win++; else if (c === 0) tie++;
    }
    return (100 * (win + tie * 0.5)) / iters;
  }

  // The coach panel re-renders every 1.5s; recomputing thousands of showdowns
  // each time would cook the phone. Only recompute when the situation changes.
  //
  // This is a small keyed cache rather than one slot because the panel now asks
  // for several opponent counts for the same board (full ring, live, heads-up).
  // With a single slot each lookup evicted the previous one and nothing ever hit
  // cache — every render recomputed every figure from scratch.
  const EQUITY_CACHE_MAX = 12;
  const equityCache = new Map();
  function estimateEquityCached(heroCards, boardCards, nOpp) {
    const key = heroCards.map((c) => c.rank + c.suit).join('')
      + '|' + (boardCards || []).map((c) => c.rank + c.suit).join('')
      + '|' + nOpp;
    if (equityCache.has(key)) return equityCache.get(key);
    const v = estimateEquity(heroCards, boardCards, nOpp);
    equityCache.set(key, v);
    // Board changes make old entries unreachable; cap the map so a long session
    // doesn't accumulate one entry per hand forever.
    if (equityCache.size > EQUITY_CACHE_MAX) {
      equityCache.delete(equityCache.keys().next().value);
    }
    return v;
  }

  // Reconstruct seating order from the log: SB, BB, then the order players
  // first acted preflop (UTG onward), which ends at the button.
  function buildRotation(hand) {
    if (!hand.sbXid) return null;
    const rot = [hand.sbXid];
    if (hand.bbXid && hand.bbXid !== hand.sbXid) rot.push(hand.bbXid);
    hand.actionOrder.forEach((x) => { if (!rot.includes(x)) rot.push(x); });
    return rot.length >= 2 ? rot : null;
  }

  // Position has four independent preconditions and the coach used to blame a
  // missing username for all of them, which sends you to fix a setting that is
  // already correct. Report the one that actually failed.
  function positionDiagnosis(hand) {
    const configured = (STORE.settings.heroName || '').trim();
    if (!heroXid) {
      return configured
        ? `no seat matches the username "${escapeHtml(configured)}" — check the spelling against your seat`
        : 'set your username in Settings';
    }
    if (!hand.sbXid) return 'no blind posts read from the log yet this hand';
    // The seat-layout path is preferred and needs hero's seat to be resolvable
    // in the DOM; the log path is the fallback and needs hero to have acted.
    if (!seatRotationFromDom(hand)) {
      const rot = buildRotation(hand);
      if (!rot) return 'could not order the seats on screen, and not enough action read yet';
      if (rot.indexOf(heroXid) < 0) return 'could not order the seats on screen, and you have not acted yet this hand';
      return null;
    }
    if (seatRotationFromDom(hand).indexOf(heroXid) < 0) {
      return 'your seat is not among the ones readable on screen — check the username in Settings';
    }
    return null;
  }

  // Sort seats into table order using their positions on screen. Torn lays the
  // table out as an oval, so sorting by angle around the centroid recovers the
  // seating ring regardless of DOM order.
  function orderSeatsByAngle(seats) {
    if (seats.length < 2) return null;
    const cx = seats.reduce((s, p) => s + p.cx, 0) / seats.length;
    const cy = seats.reduce((s, p) => s + p.cy, 0) / seats.length;
    return seats
      .map((p) => ({ xid: p.xid, ang: Math.atan2(p.cy - cy, p.cx - cx) }))
      .sort((a, b) => a.ang - b.ang)
      .map((p) => p.xid);
  }

  // Rotate a seating ring so the small blind is index 0, and orient it so the
  // big blind lands at index 1. The BB is what tells us which way round the
  // table the action travels — an angular sort could be either direction, and
  // getting it backwards would mirror every position.
  function rotateToBlinds(order, sbXid, bbXid) {
    if (!order || !sbXid) return null;
    const si = order.indexOf(sbXid);
    if (si < 0) return null;
    const fwd = order.slice(si).concat(order.slice(0, si));
    if (!bbXid || fwd.length === 2) return fwd; // heads-up: only one other seat
    if (fwd[1] === bbXid) return fwd;
    const rev = [fwd[0]].concat(fwd.slice(1).reverse());
    if (rev[1] === bbXid) return rev;
    return null; // direction can't be established — don't guess
  }

  function seatRotationFromDom(hand) {
    if (!hand.sbXid) return null;
    const seats = [];
    document.querySelectorAll(SELECTORS.seatContainer).forEach((el) => {
      // A player sitting out holds a seat but is dealt no cards. Leaving them
      // in the ring shifts every label past them by one — the documented
      // remaining exposure in this function, now closed.
      if (isSeatSittingOut(el)) return;
      const xid = resolveSeatKey(el);
      if (!xid) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return; // not laid out / empty seat
      seats.push({ xid, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    });
    return rotateToBlinds(orderSeatsByAngle(seats), hand.sbXid, hand.bbXid);
  }

  // Returns { label, inferred, seats } or null.
  //
  // Position is read from WHERE HERO SITS relative to the small blind, not from
  // how much action has happened. The previous version had no way to place hero
  // until hero acted, so it assumed "hero must be the next seat to act" and set
  // the index to the length of the action rotation. That is only true at hero's
  // own decision point — but the coach panel re-renders continuously (it falls
  // back to "your hole cards are visible" because actionButtons matches nothing
  // on this table), so the index grew with every opponent who acted and the
  // label tracked whoever was on action instead of hero. Do not reintroduce
  // that inference.
  function heroPositionLabel(hand) {
    if (!heroXid) return null;

    // Exact, and available from the moment the blinds are posted.
    const domRot = seatRotationFromDom(hand);
    if (domRot) {
      const i = domRot.indexOf(heroXid);
      if (i >= 0) return { label: seatLabel(i, domRot.length), inferred: false, seats: domRot.length };
    }

    // Fallback: order reconstructed from the log. Hero's index must be REAL
    // here — if hero hasn't acted yet there is no honest answer, so say so
    // rather than assume a seat.
    const rot = buildRotation(hand);
    if (!rot) return null;
    const i = rot.indexOf(heroXid);
    if (i < 0) return null;
    const n = Math.max(countSeats(hand), i + 1, rot.length);
    if (n < 2) return null;
    return { label: seatLabel(i, n), inferred: true, seats: n };
  }

  // How many players were actually at the table this hand.
  //
  // dealtInXids can hold the SAME person twice: it is seeded from the DOM (real
  // numeric XIDs) and then grown by logAction with whatever nameToXidGuess
  // returned, which falls back to a "name:Bob" pseudo-id when a log name can't
  // be matched to a seat. One unmatched name therefore inflated the seat count
  // by one, and since every position is derived from that count, it shifted
  // EVERY label by one seat in a consistent direction — the exact symptom the
  // position notes describe. Count real XIDs when there are any, and only fall
  // back to the raw size on a table where nothing resolved.
  function countSeats(hand) {
    if (!hand.dealtInXids) return 0;
    let real = 0;
    hand.dealtInXids.forEach((xid) => { if (!String(xid).startsWith('name:')) real += 1; });
    return real >= 2 ? real : hand.dealtInXids.size;
  }

  // Index in the rotation (0 = SB) to a position name. Short-handed collapses to
  // EP/MP/CO/BTN; full ring names the early seats separately, because at a
  // 9-handed table four distinct seats used to share one "EP" label and one
  // chart, and the tightest of them was being given a range meant for the
  // loosest. Measured from the BUTTON backwards, so it degrades sensibly at 7-
  // and 8-handed tables instead of assuming exactly nine.
  function seatLabel(i, n) {
    if (n === 2) return i === 0 ? 'SB' : 'BB';
    if (i === 0) return 'SB';
    if (i === 1) return 'BB';
    const fromBtn = n - 1 - i;
    if (n < FULL_RING_SEATS) {
      if (fromBtn === 0) return 'BTN';
      if (fromBtn === 1) return 'CO';
      if (fromBtn === 2) return 'MP';
      return 'EP';
    }
    if (fromBtn === 0) return 'BTN';
    if (fromBtn === 1) return 'CO';
    if (fromBtn === 2) return 'HJ';
    if (fromBtn === 3) return 'LJ';
    if (fromBtn === 4) return 'UTG1';
    return 'UTG';
  }

  // A "session" is just play separated by a gap; no explicit start/stop to forget.
  const SESSION_GAP_MS = 4 * 60 * 60 * 1000;
  function touchSession(deltaChips, countHand) {
    const s = STORE.session;
    const now = Date.now();
    if (!s.startedAt || (s.lastHandAt && now - s.lastHandAt > SESSION_GAP_MS)) {
      s.startedAt = now; s.hands = 0; s.net = 0;
    }
    s.lastHandAt = now;
    if (countHand) s.hands += 1;
    s.net += deltaChips || 0;
  }

  // ===========================================================================
  // 8. COACH PROMPTS (advisory only — never auto-acts)
  // ===========================================================================

  function buildCoachAdvice() {
    if (!currentHand) return null;
    const hand = currentHand;
    const heroCards = readHeroCards();
    // Remember them while they're on screen — they're gone by the time the hand
    // is written to history.
    if (heroCards.length === 2) hand.heroCards = heroCards;

    // Turn detection is by button LABEL now (findActionButtons), not by a
    // hashed container class that never matched. The hole-cards fallback stays,
    // because it is the only signal between your turns — but the two are no
    // longer equivalent, and the panel says which one is live.
    const heroTurn = isHeroTurn();
    if (!heroTurn && heroCards.length !== 2) return null;
    const board = readBoardCards();
    const villainXid = hand.lastAggressor;
    const betFacing = villainXid ? (hand.streetContributions[villainXid] || 0) : 0;
    const pos = heroPositionLabel(hand);
    const position = pos ? pos.label : null;
    // Prefer the table's own pot over our running log sum — see readDomPot.
    const pot = effectivePot(hand);
    const out = [];

    // The panel is read mid-decision on a phone, so every line has to earn its
    // place. Things deliberately NOT here any more:
    //   "▶ Your turn"  — the green border already says it, louder.
    //   Table name     — never changes a decision; it is in Settings.
    //   The footnote   — replaced by short inline markers ("vs random", "est").
    // Kept short rather than dropped: stack depth, because it decides whether
    // the baseline below is even the right chart.

    // Hero gets the same read as everyone else. Badges deliberately skip your
    // own seat, so without this the one player the HUD can never warn about is
    // you — the case where it is worth most.
    const self = !heroUnresolved() ? STORE.players[heroXid] : null;
    if (self) {
      const selfTilt = tiltRead(self);
      const selfHeat = heatRead(self);
      if (selfTilt) {
        out.push(`<span class="tph-self-tilt">🤮 <b>You're ${selfTilt.jump.toFixed(0)}pp looser `
          + `than your norm</b> (last ${selfTilt.hands}) — tighten up.</span>`);
      } else if (selfHeat) {
        out.push(`<span class="tph-self-heat">🔥 Won ${selfHeat.won}/${selfHeat.hands} recent — `
          + 'not a reason to widen.</span>');
      }
    }

    // Stack depth, in one line. bb is what matters, so the cash figure is gone.
    // Anchored on hero and pairwise against whoever is actually being faced —
    // see effectiveStackVs. Absent entirely when hero's own stack can't be
    // read, because there is no honest effective stack without it.
    const eff = effectiveStackVs(hand, villainXid);
    const rawBB2 = hand.bbAmount || lastSeenBB;
    const bb = plausibleBB(rawBB2) ? rawBB2 : 0;
    if (eff) {
      const effBB = bb > 0 ? eff.chips / bb : null;
      const bits = [];
      const vs = eff.pairwise ? ` v ${escapeHtml(playerDisplayName(eff.vsXid))}` : '';
      bits.push((effBB != null ? `<b>${effBB.toFixed(0)}bb</b>` : `<b>${fmtMoney(eff.chips)}</b>`) + ' eff' + vs);

      // SPR is a postflop concept, measured against the pot at the START of the
      // street — not the live pot, which shrinks the number as the betting
      // round grows it.
      if (hand.street !== 'preflop' && hand.potAtStreetStart > 0) {
        const spr = eff.chips / hand.potAtStreetStart;
        bits.push(`SPR <b>${spr.toFixed(1)}</b> ${spr < 1 ? 'committed' : spr < 3 ? 'low' : spr < 7 ? 'medium' : 'deep'}`);
      }
      // The baselines are ~100bb charts. Now that depth is readable, applying
      // them silently at 15bb would be a confidently wrong answer.
      if (effBB != null && effBB < 40) {
        bits.push(effBB < 20
          ? '<b>⚠ push/fold depth — charts don\'t model it</b>'
          : '<b>⚠ short — charts overstate calling</b>');
      }
      out.push(bits.join(' · '));
    }

    out.push(gtoBaselineSuggestion({
      street: hand.street,
      position,
      positionInferred: !!(pos && pos.inferred),
      heroCards: heroCards.length === 2 ? heroCards : null,
      betFacing,
      pot,
      posDiag: position ? null : positionDiagnosis(hand),
      // Seat count for THIS hand picks the chart set — Torn runs both short and
      // full ring, and the tableMax setting only drives the equity quote.
      seats: pos ? pos.seats : 0,
      // Which preflop spot this actually is. Without these the chart was chosen
      // from betFacing alone, which cannot tell an unopened pot from a limped
      // one, or a 3-bet from a 4-bet.
      // KNOWN IMPRECISION: preflopRaiseEvents counts an all-in as a raise, so a
      // short stack shoving what is really a CALL can push this to 2 and make
      // the coach read the spot as facing a 3-bet. Fixing it needs the all-in
      // amount compared against the current bet, which the log doesn't always
      // print.
      preflopRaises: hand.preflopRaiseEvents,
      limpers: preflopLimperCount(hand),
      heroInPosition: heroIsInPositionVs(hand, villainXid),
      heroHasRaised: !!(heroXid && hand.countedPfr.has(heroXid)),
    }));

    if (heroCards.length === 2) {
      const live = Math.max(1, hand.playersIn.size - 1);
      // Seats actually at THIS table. The tableMax setting (default 9) was
      // quoting "vs 8 (9-max)" at a five-handed table, which is a number about
      // a game you are not playing. Fall back to the setting only when the seat
      // count can't be read.
      const seatsNow = (pos && pos.seats) || countSeats(hand) || STORE.settings.tableMax || 9;
      const full = Math.max(1, seatsNow - 1);

      // Always quote the full-ring number so the figure means the same thing
      // every hand — equity against the live count alone swings wildly as people
      // fold, which makes it useless for judging whether a holding is actually
      // strong. Add the live count and the heads-up ceiling around it, so you can
      // see how much the hand gains as the field thins. Duplicates are dropped:
      // at a 3-handed pot "vs 2" and "vs 2" twice reads as a bug.
      // Two quotes, not three. The LIVE count is what the decision turns on;
      // the full-ring figure is the stable reference that means the same thing
      // every hand. The heads-up ceiling was a third number to read for a
      // situation you are usually not in — dropped unless it IS the live count.
      const wanted = [];
      [[live, 'live'], [full, `${full + 1}max`]].forEach(([n, label]) => {
        if (!wanted.some((w) => w.n === n)) wanted.push({ n, label });
      });

      const quotes = wanted
        .map((w) => ({ ...w, eq: estimateEquityCached(heroCards, board, w.n) }))
        .filter((w) => w.eq != null);

      if (quotes.length) {
        // Pot odds folded into the same line rather than its own. "vs random"
        // stays as the honesty marker now that the footnote is gone.
        const parts = ['Eq vs random ' + quotes.map((w) => `<b>${fmtEquity(w.eq)}</b> ${w.label}`).join(' · ')];
        const liveEq = quotes.find((w) => w.n === live);
        if (betFacing > 0 && liveEq) {
          const need = (100 * betFacing) / (pot + betFacing);
          parts.push(`need <b>${need.toFixed(0)}%</b> ${liveEq.eq >= need ? '✓ +EV call' : '✗ fold'}`);
        }
        out.push(parts.join(' · '));
      }
    } else if (betFacing > 0) {
      const need = (100 * betFacing) / (hand.pot + betFacing);
      out.push(`Need <b>~${need.toFixed(0)}%</b> to continue.`);
    }

    const deviation = exploitDeviation(villainXid);
    if (deviation) out.push(deviation);
    return out.filter(Boolean);
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
    if (r.limpShareOfVpip != null && p.limpMade > 0) {
      const share = r.limpShareOfVpip;
      lines.push(`Limps into ${fmtPct(r.limp)} of hands — ${fmtPct(share)} of the pots they enter `
        + `(pool average ${POOL_AVG.limpShareOfVpip}%). `
        + (share > POOL_AVG.limpShareOfVpip + 12
          ? 'A habitual limper: isolate them wide in position, and expect a capped range when they just call.'
          : share < POOL_AVG.limpShareOfVpip - 15
            ? 'Rarely limps — when they enter, they raise, so their calling range is genuinely a calling range.'
            : 'About average for this pool.'));
    }
    if (r.cbet != null) lines.push(`Continuation-bets ${fmtPct(r.cbet)} of flop opportunities.`);
    if (r.foldToCbet != null) {
      lines.push(`Folds to continuation bets ${fmtPct(r.foldToCbet)} of the time (${p.foldToCbetOpp} samples) — `
        + (r.foldToCbet > 60 ? 'c-betting into them prints; fire the flop with anything.'
          : r.foldToCbet < 40 ? 'they do not fold flops — c-bet for value, not as a bluff.'
            : 'defends flops at roughly a normal rate.'));
    }
    if (r.foldTo3Bet != null) lines.push(`Folds to 3-bets ${fmtPct(r.foldTo3Bet)} of the time (${p.foldTo3BetOpp} samples) — ${r.foldTo3Bet > 65 ? 'treat continuation bets/3-bets here as close to free' : 'defends 3-bets reasonably often'}.`);
    if (r.afq != null) lines.push(`Aggression frequency postflop: ${fmtPct(r.afq)}.`);
    // Per street, because the aggregate hides the most exploitable pattern
    // there is: firing flops and giving up on turns.
    const streetLine = POSTFLOP_STREETS
      .filter((s) => r.byStreet[s].actions >= 5)
      .map((s) => `${s} ${fmtPct(r.byStreet[s].afq)}`);
    if (streetLine.length) {
      lines.push(`  by street — ${streetLine.join(', ')} (aggression).`);
      const f = r.byStreet.flop.afq;
      const t = r.byStreet.turn.afq;
      if (f != null && t != null && r.byStreet.turn.actions >= 5 && f - t > 20) {
        lines.push('  Fires the flop and gives up on the turn — floating the flop and taking it away on the turn is the counter.');
      }
    }
    if (r.avgBetPct != null) {
      const sz = r.avgBetPct;
      lines.push(`Average bet/raise is ${sz.toFixed(0)}% of pot (${p.betSizeCount} sized bets) — `
        + (sz > 85 ? 'oversizes heavily; often polarised to strong hands or bluffs.'
          : sz < 45 ? 'consistently small; easy to float and take away later streets.'
            : 'fairly standard sizing.'));
    }
    if (r.wtsd != null) lines.push(`Goes to showdown ${fmtPct(r.wtsd)} of hands played.`);
    lines.push(`Your estimated result against them: ${fmtSignedMoney(p.plChipsEst)} / ${fmtBB(p.plBBEst)} `
      + '(estimate — positive means you are up on them).');
    if (p.notes) lines.push(`Notes: ${p.notes}`);
    return lines.join('\n');
  }

  // ===========================================================================
  // 7. HUD OVERLAY
  // ===========================================================================

  const CSS = `
    /* Deliberately understated and anchored UNDER the seat: at 11px with a solid
       border sitting above the seat it covered the player's name, which is the
       one thing on a seat you always need to read. */
    .tph-badge { position: fixed; z-index: 99998; background: rgba(10,10,14,0.82) !important;
      color: #cfd6dd !important; border: none; border-radius: 3px; padding: 1px 4px;
      font: 10px/1.45 -apple-system, sans-serif !important;
      letter-spacing: 0.2px; white-space: nowrap; cursor: pointer; pointer-events: auto;
      max-width: 140px; overflow: hidden; }
    .tph-badge b { color: #ffc94d !important; font-weight: 700; }
    .tph-badge .tph-badge-dim { color: #9fb0bf !important; }
    .tph-badge .tph-badge-tilt, .tph-badge .tph-badge-heat { margin-right: 2px; }
    .tph-state-note { color: #ffd9a0 !important; font-size: 11px; line-height: 1.35;
                      background: rgba(255,192,70,.10); border-bottom: none !important; }
    .tph-self-tilt { color: #ffb3a0 !important; display: block; }
    .tph-self-heat { color: #ffd98a !important; display: block; }
    /* background/color pinned: we inject into Torn's page, so an inherited or
       lower-specificity colour can be overridden by their stylesheet and leave
       dark text on a dark panel. */
    .tph-panel { position: fixed; z-index: 99999; top: 10%; left: 5%; right: 5%; max-height: 80%; overflow-y: auto;
      background: #1b1b1f !important; color: #eee !important; border: 1px solid #666; border-radius: 8px; padding: 12px;
      font: 13px/1.4 -apple-system, sans-serif; opacity: 1 !important; }
    .tph-panel h3 { margin: 0 0 8px; font-size: 15px; }
    .tph-panel textarea { width: 100%; height: 90px; background: #111; color: #ddd; border: 1px solid #444; }
    .tph-panel .tph-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
    .tph-panel .tph-tab { padding: 4px 8px; border: 1px solid #555; border-radius: 4px; cursor: pointer; }
    .tph-panel .tph-tab.active { background: #333; }
    .tph-panel button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 6px 10px; margin: 3px 4px 3px 0; font: 12px -apple-system, sans-serif; cursor: pointer; }
    /* Stats tab. Three columns: label, their figure, the pool norm + bar.
       Deviation colours are deliberately NOT red/green — high VPIP is not
       "bad", it is loose, and a good/bad palette would assert a judgement the
       HUD is in no position to make. Grey = typical, amber = notable,
       orange-red = extreme; direction comes from the arrow, not the colour. */
    /* table-layout:fixed is what guarantees the panel never scrolls sideways:
       column widths come from these percentages, not from content, so a long
       label or a wide number can no longer force the table past 100%. Without
       it the browser sizes columns to min-content and a phone overflows. */
    .tph-stats { width: 100%; max-width: 100%; table-layout: fixed;
                 border-collapse: collapse; font-size: 12px; }
    .tph-stats th { text-align: left; opacity: .55; font-weight: normal;
                    border-bottom: 1px solid #444; padding: 3px 3px; }
    .tph-stats td { padding: 4px 3px; border-bottom: 1px solid #2a2a2e;
                    vertical-align: middle; overflow-wrap: anywhere; }
    /* Explicit widths for all three columns; they must total 100%. */
    .tph-stat-l { width: 33%; color: #dfe5ea !important; }
    /* Explicit colours, not inherited. pinTextColor deliberately SKIPS anything
       carrying a tph- class, so a tph- cell with no colour of its own is left
       for Torn's bare td rule to darken — the v0.18.2 bug, reintroduced. Any
       new tph- element that holds text needs a colour declared right here.
       Declared BEFORE the .tph-dev-* rules so those win on equal specificity.
       (No backticks in this block: the whole stylesheet is a template literal.) */
    .tph-stat-v { width: 27%; white-space: nowrap; color: #f2f4f6 !important; }
    .tph-stat-n { width: 40%; white-space: nowrap; font-size: 11px; color: #aeb6bd !important; }
    .tph-stat-norm { color: #8d959c !important; font-size: 10px; }
    .tph-dev-n { font-size: 10px; opacity: .85; margin-left: 2px; }
    .tph-dev-typical { color: #9fb2c4 !important; }
    .tph-dev-notable { color: #ffc046 !important; }
    .tph-dev-extreme { color: #ff7a4d !important; }
    /* A tinted row makes an outlier findable while scrolling; the value colour
       alone is easy to miss on a phone at arm's length. */
    .tph-row-notable td { background: rgba(255,192,70,.09); }
    .tph-row-extreme td { background: rgba(255,122,77,.14); }
    /* Bar track. FIXED width, not a percentage of the cell — a proportional bar
       is what pushed this table past the screen. 46px is enough to read a
       position against the tick and small enough to sit inline with the number.
       position:relative so the tick can be placed at its own percentage along
       the same 0-100 scale as the fill. */
    .tph-bar { position: relative; display: inline-block; vertical-align: middle;
               width: 46px; height: 7px; margin-right: 5px; border-radius: 3px;
               background: #2f3338; overflow: visible; }
    .tph-bar-fill { display: block; height: 100%; border-radius: 3px; background: #6b7784; }
    .tph-bar-fill.tph-dev-typical { background: #7d8b99; }
    .tph-bar-fill.tph-dev-notable { background: #ffc046; }
    .tph-bar-fill.tph-dev-extreme { background: #ff7a4d; }
    .tph-bar-tick { position: absolute; top: -2px; width: 2px; height: 11px;
                    background: #fff; opacity: .9; margin-left: -1px; }
    .tph-stat-legend { color: #8d959c !important; font-size: 10px; line-height: 1.35;
                       border-bottom: none !important; padding-top: 7px !important; }
    .tph-pool-row td { color: #8d959c !important; font-size: 11px; border-bottom: 1px solid #444; }
    .tph-stat-head td { padding-top: 10px !important; color: #c3cad1 !important;
                        border-bottom: 1px solid #444 !important; }
    /* Secondary P/L unit under the primary one. Muted and inheriting the row's
       win/loss colour would be wrong — it is the same figure, so it takes the
       same colour, just quieter. */
    .tph-pl-sub { font-size: 10px; opacity: .7; margin-top: 1px; white-space: nowrap;
                  color: inherit !important; }
    /* Range tab. Every element here declares its own colour — pinTextColor
       skips tph- classes, so anything left unstyled gets darkened by Torn. */
    .tph-range-total { color: #f2f4f6 !important; margin-bottom: 8px; }
    .tph-range-group { margin-bottom: 10px; }
    .tph-range-group b { color: #f2f4f6 !important; }
    .tph-range-note { color: #8d959c !important; font-size: 11px; }
    .tph-range-list { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tph-range-hand { color: #cfe3ff !important; background: #26303a; border: 1px solid #3b4956;
                      border-radius: 3px; padding: 2px 5px; font-size: 12px;
                      font-family: ui-monospace, Menlo, monospace; }
    .tph-range-hand sub { color: #8fa6bd !important; font-size: 9px; margin-left: 1px; }
    .tph-ptable { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    .tph-ptable th { text-align: left; opacity: 0.6; font-weight: normal; border-bottom: 1px solid #444; padding: 3px 4px; }
    .tph-ptable td { padding: 6px 4px; border-bottom: 1px solid #2a2a2e; }
    .tph-prow { cursor: pointer; }
    .tph-prow:active { background: #2c2c33; }
    /* Hand history was one 11px monospace blob of up to 40 hands run together on
       the panel's own background — nothing separated one hand from the next and
       the focus player was marked only by a "*". Each hand is now its own block
       with its own surface, and their actions are coloured rather than starred. */
    /* Every colour here is explicit and !important, and nothing relies on
       inheritance or opacity. Torn's own page stylesheet is an unknown quantity
       that we are injecting into — a recessed card tinted only slightly darker
       than the panel, with inherited text colour, came out unreadable on the
       real page. A clearly LIGHTER card with pinned foreground colours does not
       depend on winning the cascade. */
    .tph-hh { background: #2a2a33 !important; color: #f2f4f6 !important;
      border: 1px solid #3d3d48; border-left: 3px solid #6b8cae;
      border-radius: 5px; padding: 8px 10px; margin-bottom: 9px; }
    .tph-hh-head { font-size: 11px; color: #a8b2bd !important; margin-bottom: 6px; }
    .tph-hh-row { font-size: 12.5px; line-height: 1.6; color: #f2f4f6 !important; }
    .tph-hh-st { display: inline-block; min-width: 54px; color: #8ec5f0 !important;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .tph-hh-me { color: #ffc94d !important; font-weight: 700; }
    .tph-hh-sd { font-size: 11.5px; color: #d4b3f0 !important; margin-top: 4px; }
    .tph-hh-win { font-size: 12.5px; color: #8ce89a !important; margin-top: 4px; }
    .tph-close { position: absolute; top: 8px; right: 10px; cursor: pointer; }
    .tph-warn { background: #4a2c12 !important; color: #ffd9a0 !important; border: 1px solid #8a5a24;
      border-radius: 5px; padding: 7px 9px; margin: 6px 0 10px; font-size: 12px; line-height: 1.45; }
    .tph-ok { color: #7ed957 !important; font-size: 12px; margin: 2px 0 10px; }
    /* Raised well above the bottom edge so it doesn't sit under Torn PDA's own
       native controls, enlarged and labelled so it's unmistakably OUR button. */
    /* touch-action:none so dragging the button doesn't scroll the page under it */
    .tph-gear { position: fixed; z-index: 100000; bottom: 96px; right: 12px; background: #b8342e; color: #fff;
      border: 2px solid #fff; border-radius: 22px; height: 44px; min-width: 44px; padding: 0 12px;
      display: flex; align-items: center; gap: 5px; font: bold 13px/1 -apple-system, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none; }
    .tph-gear.tph-dragging { cursor: grabbing; opacity: 0.85; }

    /* ── "It's your turn" cues ───────────────────────────────────────────────
       Non-negotiable: pointer-events NONE on the overlay. This sits over the
       whole viewport, and a single missed tap on a fold or call button because
       the HUD swallowed it would be far worse than any cue is good. The HUD is
       advisory; it must never come between you and the table. */
    .tph-turn-glow { position: fixed; inset: 0; z-index: 99998; pointer-events: none; }
    /* Your turn: green and pulsing — act now. */
    .tph-glow-turn { box-shadow: inset 0 0 0 3px #35d07f, inset 0 0 26px rgba(53,208,127,.45);
                     animation: tph-turn-pulse 1.25s ease-in-out infinite; }
    /* Next to act: amber, thinner, and deliberately STATIC. Two pulsing states
       would compete for attention, and this one is a heads-up, not an alarm. */
    .tph-glow-next { box-shadow: inset 0 0 0 2px rgba(255,192,70,.75); }
    @keyframes tph-turn-pulse {
      0%, 100% { opacity: .35; }
      50%      { opacity: 1; }
    }
    /* The gear is the one element always on screen, so it doubles as the cue
       for anyone who has the coach panel collapsed. */
    .tph-gear.tph-turn { background: #1e7d51; animation: tph-turn-pulse 1.25s ease-in-out infinite; }
    .tph-gear.tph-next { background: #7a5a12; }
    .tph-coach-head.tph-turn { background: #1e7d51 !important; }
    .tph-turn-flag { color: #d6ffe9 !important; font-weight: bold; }

    /* Fold misclick guard prompt. Bottom-centre and above everything, but
       pointer-events:none so it can never sit between you and the button you
       are trying to tap a second time. */
    .tph-fold-prompt { position: fixed; z-index: 100001; left: 50%; bottom: 18%;
                       transform: translateX(-50%); pointer-events: none;
                       background: #7a2f12; border: 1px solid #c9762f; border-radius: 8px;
                       padding: 9px 14px; max-width: 84vw; text-align: center;
                       box-shadow: 0 3px 14px rgba(0,0,0,.55);
                       font: 13px/1.35 -apple-system, sans-serif; color: #ffe6c9 !important; }
    .tph-fold-prompt b { color: #fff3e3 !important; display: block; }
    .tph-fold-prompt .tph-fold-sub { color: #e0b48a !important; font-size: 11px;
                                     display: block; margin-top: 2px; }
    /* Respect a user who has asked the OS for less motion — the pulse stays as
       a static highlight rather than disappearing, since it is load-bearing. */
    @media (prefers-reduced-motion: reduce) {
      .tph-turn-glow, .tph-gear.tph-turn { animation: none; opacity: 1; }
    }
    /* Width is capped rather than left/right-anchored so the panel keeps a
       sensible size once dragging switches it to left/top positioning. */
    .tph-coach { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      width: min(420px, calc(100vw - 24px)); background: rgba(20,20,24,0.95);
      color: #cde; border: 1px solid #556; border-radius: 8px; font: 12px/1.4 -apple-system, sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
    .tph-coach-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px;
      border-bottom: 1px solid #445; cursor: grab; touch-action: none;
      user-select: none; -webkit-user-select: none; font-weight: 600; color: #9bd; }
    .tph-coach-head .tph-grip { opacity: 0.5; letter-spacing: 1px; }
    .tph-coach-head .tph-coach-hide { margin-left: auto; cursor: pointer; color: #f88;
      border: 1px solid #a44; border-radius: 4px; padding: 1px 7px; font-weight: 400; }
    .tph-coach.tph-dragging { opacity: 0.85; }
    .tph-coach.tph-dragging .tph-coach-head { cursor: grabbing; }
    .tph-coach-body { padding: 8px; }
    .tph-coach-body b { color: #fff; }
    /* touch-action:none so dragging the pill moves it instead of scrolling the
       table underneath — without it the pointermove handler never gets to run. */
    .tph-coach-pill { position: fixed; z-index: 99998; bottom: 150px; right: 12px;
      background: rgba(20,20,24,0.95); color: #9bd; border: 1px solid #556; border-radius: 999px;
      padding: 7px 13px; font: 12px/1 -apple-system, sans-serif; cursor: grab;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); touch-action: none;
      user-select: none; -webkit-user-select: none; }
    .tph-coach-pill.tph-dragging { cursor: grabbing; opacity: 0.85; }
    .tph-calib { position: fixed; z-index: 99999; top: 4px; left: 4px; right: 4px; max-height: 62%; overflow-y: auto;
      background: rgba(10,10,10,0.97); color: #9f9; border: 1px solid #494; border-radius: 6px; padding: 8px;
      font: 10px/1.3 monospace; }
    .tph-calib .tph-calib-off { float: right; color: #f88; border: 1px solid #a44; border-radius: 4px;
      padding: 1px 5px; margin-left: 6px; cursor: pointer; }
    .tph-calib button { background: #234; color: #cfe; border: 1px solid #567; border-radius: 4px;
      padding: 5px 9px; margin: 4px 4px 4px 0; font: 11px -apple-system, sans-serif; cursor: pointer; }
    .tph-calib-out { width: 100%; height: 150px; background: #000; color: #9f9; border: 1px solid #494;
      font: 9px/1.25 monospace; white-space: pre; }
  `;

  // Force every unstyled descendant to take the panel's colour, inline and
  // !important.
  //
  // `.tph-panel { color: #eee }` only ever reached children by INHERITANCE, and
  // inheritance loses to any direct rule on the child — no !important required.
  // Torn styles bare `td` and `pre`, so the Stats table and the Report text
  // rendered dark-on-dark while the panel title and tab labels (which Torn has
  // no rule for) looked fine. That is why this presented as "only the history is
  // broken": it was every table and pre in every panel.
  //
  // Elements carrying one of our own tph- classes are skipped, so deliberate
  // colours (warnings, the history cards, winner lines) are preserved.
  function pinTextColor(root) {
    if (!root) return;
    root.querySelectorAll('td, th, pre, p, li, b, i, u, small, label, span, div').forEach((el) => {
      if (el.style && el.style.color) return;                     // already explicit
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('tph-') !== -1) return;                     // ours, already styled
      el.style.setProperty('color', 'inherit', 'important');
    });
  }

  // Mount or tear down one floating panel. Every panel in the HUD goes through
  // here; nothing else should be creating `.tph-panel` elements by hand.
  //
  // Two invariants it exists to enforce, both of which were broken by the
  // hand-written copies this replaced:
  //
  // 1. Removal is scoped to the panel's OWN marker class, never the shared
  //    `.tph-panel` base. renderPlayerPanel used to remove `.tph-panel`, which
  //    also matched the players list and the settings panel — so opening a
  //    player panel over Settings deleted it from the DOM while `settingsOpen`
  //    stayed true, and the next gear tap toggled the flag back to false and
  //    appeared to do nothing. The marker is required, so that can't recur.
  //
  // 2. pinTextColor runs AFTER wire(), because it has to walk content that
  //    wire() adds. Torn styles bare `td` and `pre`, so anything mounted after
  //    the colour walk renders dark-on-dark — the v0.18.2 bug. Callers that
  //    build tab bodies inside wire() get this ordering for free.
  //
  // opts: { marker, open, html, onClose, wire }
  // Returns the panel element, or null when `open` is false.
  function renderPanel(opts) {
    document.querySelectorAll('.' + opts.marker).forEach((el) => el.remove());
    if (!opts.open) return null;

    const panel = document.createElement('div');
    panel.className = 'tph-panel ' + opts.marker;
    panel.innerHTML = opts.html;
    document.body.appendChild(panel);

    const close = panel.querySelector('.tph-close');
    if (close && opts.onClose) close.addEventListener('click', opts.onClose);
    if (opts.wire) opts.wire(panel);

    pinTextColor(panel);
    return panel;
  }

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

  // Roughly the badge's own height, used to keep it inside the viewport when a
  // seat sits right at the bottom edge.
  const BADGE_HEIGHT_PX = 14;

  // Below this the session window is too thin to prefer over lifetime.
  const SESSION_BADGE_MIN = 6;

  // One place each, so the badge tooltip, the players list, the Stats tab and
  // the coach all describe these the same way.
  function tiltText(t) {
    return `🤮 Tilting — playing ${t.jump.toFixed(0)}pp looser than their own norm `
      + `over the last ${t.hands} hands`
      + (t.sinceBigLoss != null
        ? `, and lost a big pot ${t.sinceBigLoss === 0 ? 'just now' : t.sinceBigLoss + ' hand(s) ago'}.`
        : '.');
  }

  function heatText(h) {
    return `🔥 Running hot — won ${h.won} of the last ${h.hands} hands (${h.winPct.toFixed(0)}%).`;
  }

  // --- "It's your turn" cues -------------------------------------------------
  //
  // On a phone the table is small and the action buttons are easy to miss,
  // especially with the coach panel collapsed. Three cues, all passive:
  // a pulsing border around the viewport, the gear turning green, and the coach
  // header doing the same.
  //
  // Turn detection is findTurnButtons(), NOT findActionButtons(): Torn shows
  // pre-action controls ("Check / Fold", "Call Any / Check") while you are
  // WAITING, and cueing on those would leave the screen glowing for most of the
  // hand — which is the same as no cue at all.
  let turnCueActive = false;

  // A short chime, synthesised rather than loaded. No asset to host, nothing to
  // fetch, and nothing for Torn PDA's webview to block.
  //
  // Browsers refuse to start audio until the user has interacted with the page,
  // so the context is created lazily and primed on the first tap anywhere —
  // see primeAudio(). Without that the first chime of a session is silently
  // dropped, which reads as "the setting doesn't work".
  let audioCtx = null;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (e) { return null; }
    return audioCtx;
  }

  function playTurnChime() {
    const ctx = ensureAudio();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Two short rising notes — distinct from Torn's own sounds, and quiet
    // enough not to be startling if the phone is by your ear.
    [[880, 0], [1320, 0.11]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Ramps rather than steps: an instant gain change clicks audibly.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.10);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.12);
    });
    return true;
  }

  // Satisfy the autoplay policy using a tap the user was making anyway.
  function primeAudio() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // --- Fold misclick guard ---------------------------------------------------
  //
  // The one place friction is worth adding: folding is irreversible, the button
  // sits next to Call, and a phone screen is small. Tap once to arm, tap again
  // to fold.
  //
  // Deliberate design limits, because this is the only code in the HUD that
  // touches the game's own controls:
  //
  // - It NEVER folds for you. There is no synthetic click anywhere here; the
  //   second tap is your real tap, passed through untouched. The HUD stays
  //   advisory.
  // - It fails OPEN. Any error, any unrecognised button, and the click goes
  //   through as normal. A guard that swallowed a fold would be far worse than
  //   no guard.
  // - Missing the window costs nothing. Torn folds you on timeout anyway, so
  //   the worst case of hesitating is the outcome you were choosing regardless.
  const FOLD_ARM_MS = 4000;      // how long the confirm stays live
  const FOLD_MIN_GAP_MS = 250;   // a second tap sooner than this is a double-fire

  let foldArmedAt = 0;

  function isFoldControl(el) {
    if (!el || el.closest('[class^="tph-"], [class*=" tph-"]')) return false; // our own UI
    const btn = el.closest('button, [role="button"]');
    if (!btn) return null; // not a control at all
    const text = (btn.textContent || '').trim();
    if (!text || text.length >= ACTION_BTN_MAX_LEN) return false;
    // Matches "Fold" and also "Check / Fold" — a misclicked pre-action fold
    // still folds the hand, just later.
    return /\bfold\b/i.test(text) ? btn : false;
  }

  function foldGuardHandler(e) {
    try {
      if (!STORE.settings.foldGuard) return;
      const btn = isFoldControl(e.target);
      if (!btn) return;

      const now = Date.now();
      const elapsed = now - foldArmedAt;

      // Armed, and this is a deliberate second tap — let the real click through.
      if (foldArmedAt && elapsed >= FOLD_MIN_GAP_MS && elapsed <= FOLD_ARM_MS) {
        foldArmedAt = 0;
        hideFoldPrompt();
        return;
      }
      // A second tap inside FOLD_MIN_GAP_MS is a fat-finger double-fire, not a
      // confirmation. Swallow it and keep the window open.
      if (foldArmedAt && elapsed < FOLD_MIN_GAP_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // First tap: block it and arm.
      e.preventDefault();
      e.stopPropagation();
      foldArmedAt = now;
      showFoldPrompt(btn);
      setTimeout(() => {
        if (Date.now() - foldArmedAt >= FOLD_ARM_MS) { foldArmedAt = 0; hideFoldPrompt(); }
      }, FOLD_ARM_MS + 50);
    } catch (err) {
      // Fail open, always.
      foldArmedAt = 0;
      console.warn('[TornPokerHUD] fold guard error, passing the click through', err);
    }
  }

  function showFoldPrompt(btn) {
    hideFoldPrompt();
    const el = document.createElement('div');
    el.className = 'tph-fold-prompt';
    const label = (btn.textContent || 'fold').trim();
    el.innerHTML = `<b>Tap “${escapeHtml(label)}” again to confirm</b>`
      + `<span class="tph-fold-sub">misclick guard · expires in ${FOLD_ARM_MS / 1000}s</span>`;
    document.body.appendChild(el);
    pinTextColor(el);
  }

  function hideFoldPrompt() {
    document.querySelectorAll('.tph-fold-prompt').forEach((el) => el.remove());
  }

  function renderTurnCue() {
    // Two states, deliberately different in strength:
    //   'turn' — green, pulsing. Act now.
    //   'next' — amber, static. You are one seat away; look up.
    // A static "next" cue matters: two pulsing states would compete, and the
    // point of the second one is a heads-up, not an alarm.
    let state = null;
    if (STORE.settings.turnCues) {
      if (isHeroTurn()) state = 'turn';
      else if (STORE.settings.nextToActCue && isHeroNextToAct()) state = 'next';
    }

    const existing = document.querySelector('.tph-turn-glow');
    if (state) {
      const el = existing || document.createElement('div');
      el.className = 'tph-turn-glow tph-glow-' + state;
      if (!existing) document.body.appendChild(el);
    } else if (existing) {
      existing.remove();
    }

    const on = state === 'turn';
    const gear = document.querySelector('.tph-gear');
    if (gear) {
      gear.classList.toggle('tph-turn', on);
      gear.classList.toggle('tph-next', state === 'next');
    }
    const head = document.querySelector('.tph-coach-head');
    if (head) head.classList.toggle('tph-turn', on);

    // Fire once on the rising edge only. A buzz or chime every poll would be
    // unusable, and the poll runs at 400ms.
    if (on && !turnCueActive) {
      if (STORE.settings.turnVibrate && navigator.vibrate) {
        try { navigator.vibrate(120); } catch (e) { /* not supported here */ }
      }
      if (STORE.settings.turnSound) playTurnChime();
    }
    turnCueActive = on;
  }

  function renderBadges() {
    document.querySelectorAll('.tph-badge').forEach((el) => el.remove());
    if (!STORE.settings.showBadges) return;
    const seats = document.querySelectorAll(SELECTORS.seatContainer);
    seats.forEach((seat) => {
      const xid = resolveSeatKey(seat);
      if (!xid || xid === heroXid) return;
      const player = STORE.players[xid];
      const rect = seat.getBoundingClientRect();
      if (!rect.width && !rect.height) return; // seat not laid out (empty/hidden)
      const badge = document.createElement('div');
      badge.className = 'tph-badge';
      // Below the seat — i.e. under the name and chip stack — rather than over
      // the top of it. Clamped so a bottom-row seat doesn't push it off screen.
      const maxTop = Math.max(0, window.innerHeight - BADGE_HEIGHT_PX);
      badge.style.top = Math.min(Math.max(0, rect.bottom + 1), maxTop) + 'px';
      badge.style.left = Math.max(0, rect.left) + 'px';
      const label = player ? classify(player) : 'Unrated';
      // In session mode the badge shows the last `sessionWindow` hands, which is
      // how they are playing NOW. It falls back to lifetime whenever the window
      // is too thin to mean anything, so a player you have just sat down with
      // still reads off everything you know about them.
      const sess = player && STORE.settings.badgeMode === 'session'
        ? sessionRates(player, STORE.settings.sessionWindow || 15) : null;
      const useSession = !!(sess && sess.hands >= SESSION_BADGE_MIN);
      const r = player ? computeRates(player) : {};
      const shown = useSession ? sess : r;
      // 🤮 tilting — playing far looser than their own norm.
      // 🔥 running hot — winning far more pots than the seat count makes likely.
      // Different questions, so both can be true at once: a player can be
      // steaming AND getting there.
      const tilt = player ? tiltRead(player) : null;
      const heat = player ? heatRead(player) : null;
      // Always show a TYPE, never just a hand count. Below minHands `classify`
      // returns "Unrated", which told you nothing about the player — the read is
      // the point of the badge. Show the provisional archetype with a "?" so it
      // is visibly not yet trustworthy, and keep the numbers alongside it.
      const hands = player ? player.hands : 0;
      const type = hands === 0 ? 'NEW'
        : (label === 'Unrated' ? shortType(classifyProvisional(player)) + '?' : shortType(label));
      // Numbers are LABELLED rather than slash-separated. "74/12/16" is three
      // unexplained figures on a badge with no room for a legend, and the count
      // used to change between session and lifetime mode — two numbers or three
      // depending on a setting, which is worse than either.
      //
      // V and P follow the selected window. A (postflop aggression) is always
      // LIFETIME: postflop samples are scarce, so a 15-hand window would be
      // mostly noise. The window marker ("15h") sits before V and P only.
      badge.innerHTML = hands === 0
        ? `<b>NEW</b>`
        : `${tilt ? '<span class="tph-badge-tilt">🤮</span>' : ''}`
          + `${heat ? '<span class="tph-badge-heat">🔥</span>' : ''}<b>${type}</b> `
          + `<span class="tph-badge-dim">${useSession ? sess.hands + 'h ' : ''}`
          + `V${fmtNum(shown.vpip)} P${fmtNum(shown.pfr)} A${fmtNum(r.afq)}</span>`;
      badge.title = `${playerDisplayName(xid)} — ${hands} hand(s) seen. `
        + 'V = VPIP (hands played), P = PFR (raised preflop), A = AFq (postflop aggression). '
        + (useSession
          ? `V and P cover the last ${sess.hands} hands; A is lifetime. `
            + `Lifetime V${fmtNum(r.vpip)} P${fmtNum(r.pfr)}.`
          : 'All lifetime.')
        + (label === 'Unrated' && hands > 0 ? ` "?" = provisional, under the ${STORE.settings.minHands}-hand minimum.` : '')
        + (tilt ? ` ${tiltText(tilt)}` : '')
        + (heat ? ` ${heatText(heat)}` : '')
        + ' Tap for full stats.';
      badge.addEventListener('click', () => openPlayerPanel(xid));
      document.body.appendChild(badge);
    });
  }

  // How much of the coach panel must stay on screen while dragging. The panel is
  // nearly viewport-width on a phone, so it has to be allowed to hang off the
  // edges — otherwise there is nowhere for it to go. 100px keeps enough of the
  // header grabbable to drag it back.
  const COACH_KEEP_VISIBLE_PX = 100;

  // The pill is small enough to keep whole on screen, so no allowance is needed
  // beyond the default — named for symmetry with the panel above.
  const PILL_KEEP_VISIBLE_PX = 0;

  function setCoachHidden(hidden) {
    STORE.settings.coachHidden = hidden;
    saveStore();
    renderCoachPanel();
  }

  function renderCoachPanel() {
    let el = document.querySelector('.tph-coach');
    let pill = document.querySelector('.tph-coach-pill');
    const advice = buildCoachAdvice();

    // Nothing to advise on (not in a hand): tear both down rather than leaving a
    // stale panel or an orphan pill sitting over the table.
    if (!advice || advice.length === 0) {
      if (el) el.remove();
      if (pill) pill.remove();
      return;
    }

    if (STORE.settings.coachHidden) {
      if (el) el.remove();
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'tph-coach-pill';
        pill.textContent = '📊 GTO';
        pill.title = 'Tap to show the GTO coach — drag to move';
        document.body.appendChild(pill);
        applyStoredPos(pill, 'coachPillPos', PILL_KEEP_VISIBLE_PX);
        // The expanded panel was draggable and the collapsed pill was not — it
        // only had a click handler, so there was no way to get it off whatever
        // it was covering. Tap still expands; makeDraggable's threshold keeps a
        // slightly-imprecise tap from being read as a drag.
        makeDraggable(pill, {
          onTap: () => setCoachHidden(false),
          posKey: 'coachPillPos',
          keepVisiblePx: PILL_KEEP_VISIBLE_PX,
        });
      }
      return;
    }
    if (pill) pill.remove();

    // Build the chrome once. This runs every 1.5s, so rewriting the whole
    // panel's innerHTML would drop the header's drag and hide listeners on
    // every tick and make the panel impossible to move or dismiss.
    if (!el) {
      el = document.createElement('div');
      el.className = 'tph-coach';
      // The footnote is part of the chrome, not the advice, so it is written
      // once and survives the 1.5s advice refresh. "Baseline" replaced "GTO
      // baseline" throughout for the same reason it exists: these are reference
      // charts calibrated to published opening frequencies, not solver output,
      // and the old wording claimed the authority of an equilibrium solution.
      // No footnote. It was four lines of standing disclaimer read once and
      // ignored forever, on a panel that has to be scanned mid-decision. The
      // honesty it carried now rides inline where it applies and costs a word:
      // "Baseline" (never "GTO") on the chart lines, "Eq vs random" on equity,
      // and the ⚠ short-stack note when the ~100bb assumption is actually
      // broken — which is the only time that caveat changes anything.
      el.innerHTML = '<div class="tph-coach-head"><span class="tph-grip">⠿</span>'
        + '<span>Coach</span><span class="tph-coach-hide">Hide</span></div>'
        + '<div class="tph-coach-body"></div>';
      document.body.appendChild(el);

      const head = el.querySelector('.tph-coach-head');
      const hide = el.querySelector('.tph-coach-hide');
      hide.addEventListener('click', (e) => { e.stopPropagation(); setCoachHidden(true); });
      // Drag the whole panel by its header; no tap action, so a stray tap on the
      // bar does nothing rather than firing something unexpected.
      makeDraggable(head, { posKey: 'coachPos', moveEl: el, keepVisiblePx: COACH_KEEP_VISIBLE_PX });
      applyStoredPos(el, 'coachPos', COACH_KEEP_VISIBLE_PX);
    }

    const coachBody = el.querySelector('.tph-coach-body');
    coachBody.innerHTML = advice.map((line) => `<div>${line}</div>`).join('');
    pinTextColor(coachBody);
  }

  let openPlayerXid = null;
  let openPlayerTab = 'stats';

  function openPlayerPanel(xid) {
    openPlayerXid = xid;
    openPlayerTab = 'stats';
    renderPlayerPanel();
  }

  // One stat row: label, value, population norm, and a bar with the norm marked.
  //
  // The bar is the point of this — a number next to another number needs
  // reading, a marker to the left or right of a tick is read at a glance.
  //
  // Colour comes from the SHRUNK value while the printed figure stays RAW. A
  // player seen for two hands who played both really did VPIP 100%, and the
  // Stats tab should say so; lighting the row up as "extreme" off two hands
  // would be reading noise as a read.
  //
  // opts.key names the POOL_AVG / POOL_SPREAD entry. Omit it for stats with no
  // published pool figure — they render plain, with no verdict.
  function statRow(label, rawValue, shrunkValue, key) {
    const norm = key ? POOL_AVG[key] : null;
    const dev = deviation(shrunkValue, norm, key ? POOL_SPREAD[key] : null);

    const cls = dev ? `tph-dev-${dev.level}` : '';
    const arrow = dev && dev.level !== 'typical' ? (dev.dir === 'up' ? ' ▲' : ' ▼') : '';
    const delta = dev && dev.level !== 'typical'
      ? `<span class="tph-dev-n">${dev.diff > 0 ? '+' : ''}${dev.diff.toFixed(0)}</span>` : '';

    // Bars are drawn on a 0-100 scale, which is the scale every one of these
    // stats already lives on. clamp() keeps a nonsense value inside the track.
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const bar = rawValue == null ? '' : `
      <div class="tph-bar">
        <span class="tph-bar-fill ${cls}" style="width:${clamp(rawValue)}%"></span>
        ${norm != null ? `<i class="tph-bar-tick" style="left:${clamp(norm)}%"></i>` : ''}
      </div>`;

    return `<tr class="${cls ? 'tph-row-' + dev.level : ''}">
      <td class="tph-stat-l">${escapeHtml(label)}</td>
      <td class="tph-stat-v ${cls}"><b>${fmtPct(rawValue)}</b>${arrow}${delta}</td>
      <td class="tph-stat-n">${bar}<span class="tph-stat-norm">${norm != null ? norm.toFixed(0) + '%' : '—'}</span></td>
    </tr>`;
  }

  // What this player has actually turned up with at showdown.
  //
  // This is the only DIRECT evidence of anyone's range in the whole HUD —
  // everything else infers a range from frequencies. It is also the sparsest:
  // showdowns are rare, so this stays honest about sample size rather than
  // drawing a confident-looking grid from four hands.
  //
  // Split by preflop action because "what they raise with" and "what they call
  // with" are different ranges, and averaging them describes neither.
  function buildRangeHtml(p) {
    const all = shownRange(p, 'all');
    if (!all.length) {
      return '<i>No showdowns yet. Fills in when they reveal at showdown.</i>';
    }
    const total = all.reduce((s, e) => s + e.n, 0);

    const group = (mode, title, note) => {
      const rows = shownRange(p, mode);
      if (!rows.length) return '';
      const n = rows.reduce((s, e) => s + e.n, 0);
      return `<div class="tph-range-group"><b>${title}</b> <span class="tph-range-note">${n} showdown${n === 1 ? '' : 's'}${note}</span><div class="tph-range-list">`
        + rows.map((e) => `<span class="tph-range-hand" title="${escapeHtml(e.cls)}: shown ${e.n}×, won ${e.won} of ${e.seen}">`
          + `${escapeHtml(e.cls)}${e.n > 1 ? `<sub>${e.n}</sub>` : ''}</span>`).join('')
        + '</div></div>';
    };

    return `<div class="tph-range-total">${total} showdown${total === 1 ? '' : 's'}`
      + `${total < 8 ? ' — thin sample' : ''}</div>`
      + group('raised', 'Raised preflop', '')
      + group('called', 'Called / limped', '')
      + `<div class="tph-stat-legend">Showdowns only — a floor on their range, not all of it.</div>`;
  }

  function renderPlayerPanel() {
    const p = openPlayerXid ? getPlayer(openPlayerXid) : null;
    const r = p ? computeRates(p) : null;          // raw — what was observed
    const s = p ? computeShrunkRates(p) : null;    // sample-adjusted — drives colour
    renderPanel({
      marker: 'tph-player-panel',
      open: !!openPlayerXid,
      onClose: () => { openPlayerXid = null; renderPlayerPanel(); },
      html: !p ? '' : `
      <span class="tph-close">✕</span>
      <h3>${escapeHtml(p.name)} — ${classify(p)}</h3>
      <div class="tph-tabs">
        <div class="tph-tab ${openPlayerTab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</div>
        <div class="tph-tab ${openPlayerTab === 'range' ? 'active' : ''}" data-tab="range">Range</div>
        <div class="tph-tab ${openPlayerTab === 'report' ? 'active' : ''}" data-tab="report">Report</div>
        <div class="tph-tab ${openPlayerTab === 'history' ? 'active' : ''}" data-tab="history">History</div>
        <div class="tph-tab ${openPlayerTab === 'notes' ? 'active' : ''}" data-tab="notes">Notes</div>
      </div>
      <div class="tph-tab-body"></div>
    `,
      wire: (panel) => renderPlayerPanelBody(panel, p, r, s),
    });
  }

  // Tab content, built inside renderPanel's wire step so pinTextColor still
  // runs after it — the Stats table and the Report <pre> are exactly the
  // elements Torn's own `td`/`pre` rules would otherwise darken.
  function renderPlayerPanelBody(panel, p, r, s) {
    panel.querySelectorAll('.tph-tab').forEach((tab) => {
      tab.addEventListener('click', () => { openPlayerTab = tab.dataset.tab; renderPlayerPanel(); });
    });

    const body = panel.querySelector('.tph-tab-body');
    if (openPlayerTab === 'stats') {
      body.innerHTML = `
        <table class="tph-stats">
          ${(() => {
            // Above the numbers, because a state read changes what you do right
            // now in a way a lifetime average never does.
            const tilt = tiltRead(p);
            const heat = heatRead(p);
            if (!tilt && !heat) return '';
            return '<tr><td colspan="3" class="tph-state-note">'
              + (tilt ? escapeHtml(tiltText(tilt)) : '')
              + (tilt && heat ? '<br>' : '')
              + (heat ? escapeHtml(heatText(heat)) : '')
              + '</td></tr>';
          })()}
          <tr><th>Stat</th><th>Them</th><th>Pool</th></tr>
          <tr><td class="tph-stat-l">Hands</td><td class="tph-stat-v"><b>${p.hands}</b></td><td class="tph-stat-n">${p.hands < STORE.settings.minHands ? '<span class="tph-stat-norm">low</span>' : ''}</td></tr>
          ${statRow('VPIP', r.vpip, s.vpip, 'vpip')}
          ${statRow('PFR', r.pfr, s.pfr, 'pfr')}
          ${statRow('3-Bet', r.threeBet, s.threeBet, 'threeBet')}
          ${statRow('Fold v 3B', r.foldTo3Bet, s.foldTo3Bet, 'foldTo3Bet')}
          ${statRow('C-Bet', r.cbet, s.cbet, 'cbet')}
          ${statRow('Fold v CB', r.foldToCbet, s.foldToCbet, 'foldToCbet')}
          ${statRow('Limp', r.limpShareOfVpip, s.limpShareOfVpip, 'limpShareOfVpip')}
          ${statRow('AFq', r.afq, r.afq, null)}
          ${statRow('WTSD', r.wtsd, r.wtsd, null)}
          <tr><td class="tph-stat-l">Bet size</td><td class="tph-stat-v"><b>${r.avgBetPct != null ? r.avgBetPct.toFixed(0) + '%' : '—'}</b></td><td class="tph-stat-n"><span class="tph-stat-norm">of pot</span></td></tr>
          <tr><td colspan="3" class="tph-stat-legend">Tick = pool average (reference figures, not measured here).</td></tr>
          <tr class="tph-stat-head"><td colspan="3"><b>By street</b> — aggr / fold</td></tr>
          ${POSTFLOP_STREETS.map((st) => `<tr><td class="tph-stat-l">${st[0].toUpperCase() + st.slice(1)}</td>`
            + `<td class="tph-stat-v">${fmtPct(r.byStreet[st].afq)} / ${fmtPct(r.byStreet[st].foldPct)}</td>`
            + `<td class="tph-stat-n"><span class="tph-stat-norm">${r.byStreet[st].actions} acts</span></td></tr>`).join('')}
          <tr class="tph-stat-head"><td colspan="3"><b>Your P/L vs them</b></td></tr>
          <tr>
            <td class="tph-stat-l">Result</td>
            <td class="tph-stat-v" style="color:${pl0(p) >= 0 ? '#7ed957' : '#ff6b6b'} !important">
              <b>${fmtBB(p.plBBEst)}</b></td>
            <td class="tph-stat-n" style="color:${pl0(p) >= 0 ? '#7ed957' : '#ff6b6b'} !important">${fmtSignedMoney(p.plChipsEst)}</td>
          </tr>
          ${!p.plBBEst && p.plChipsEst ? '<tr><td colspan="3" class="tph-stat-legend">'
            + 'bb only tracked since v0.23.0.</td></tr>' : ''}
        </table>
      `;
    } else if (openPlayerTab === 'range') {
      body.innerHTML = buildRangeHtml(p);
    } else if (openPlayerTab === 'report') {
      const text = buildReport(openPlayerXid);
      body.innerHTML = `<pre style="white-space:pre-wrap;color:#f2f4f6 !important;background:transparent !important">`
        + `${escapeHtml(text)}</pre><button class="tph-copy-report">Copy report</button>`;
      body.querySelector('.tph-copy-report').addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(text);
      });
    } else if (openPlayerTab === 'history') {
      const hands = handsInvolving(openPlayerXid);
      if (!hands.length) {
        body.innerHTML = '<i>No hands recorded with this player yet.</i>';
      } else {
        const shown = hands.slice(0, 40);
        // Clipboard stays plain text; only the on-screen rendering is markup.
        const text = shown.map((h) => formatHand(h, openPlayerXid)).join('\n\n');
        body.innerHTML = `<div style="color:#c9d1d9 !important;margin-bottom:8px">${hands.length} hand(s) recorded`
          + `${hands.length > shown.length ? `, showing ${shown.length}` : ''} — `
          + `<span style="${HH.me}">their actions highlighted</span></div>`
          + shown.map((h) => formatHandHtml(h, openPlayerXid)).join('')
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

  // Archetype thresholds hang off POOL_AVG, and POOL_AVG came from a third-party
  // script rather than from anything this HUD measured. Showing both side by
  // side is how that assumption gets checked: if these drift apart over a few
  // hundred hands, POOL_AVG is what needs correcting, and every label with it.
  // P/L sign for colouring. Reads the chip figure, not the bb one: bb only
  // started accruing in 0.23.0, so a player tracked before then has real chip
  // P/L and a zero bb figure, and colouring off bb would show them as flat.
  function pl0(p) { return p.plChipsEst || 0; }

  // Both units, stacked: big blinds lead because they are comparable across
  // stakes, chips underneath because that is what is actually sitting in front
  // of you and what the table shows.
  //
  // plBBEst only began accruing in 0.23.0, so a player tracked before that has
  // real chip P/L and a zero bb figure. Printing "+0.0bb" would read as "flat
  // against them" rather than "not measured yet" — so in that case the chip
  // figure is promoted to the top line and no bb figure is shown at all.
  function plShort(p) {
    const chips = fmtSignedMoney(pl0(p));
    const hasBB = p.plBBEst && Math.abs(p.plBBEst) >= 0.05;
    if (!hasBB) return `<b>${chips}</b>`;
    return `<b>${fmtBB(p.plBBEst)}</b><div class="tph-pl-sub">${chips}</div>`;
  }

  function poolComparisonLine() {
    const obs = observedPoolAverages();
    if (!obs) return '';
    return `<br><b>Pool:</b> yours ${fmtPct(obs.vpip)}/${fmtPct(obs.pfr)} VPIP/PFR `
      + `over ${obs.players} tracked &nbsp;|&nbsp; assumed `
      + `${POOL_AVG.vpip.toFixed(0)}%/${POOL_AVG.pfr.toFixed(0)}%`;
  }

  function renderPlayersList() {
    const all = !playersListOpen ? [] : Object.keys(STORE.players)
      .map((xid) => ({ xid, p: STORE.players[xid] }))
      .filter(({ p }) => !playersFilter || (p.name || '').toLowerCase().includes(playersFilter.toLowerCase()))
      .sort((a, b) => (b.p.hands || 0) - (a.p.hands || 0));

    const rows = all.length
      ? all.map(({ xid, p }) => {
        const r = computeRates(p);
        const s = computeShrunkRates(p);
        // Raw figures shown, sample-adjusted figures colour them — same rule as
        // the Stats tab, so a two-hand player doesn't light up the list.
        const cell = (raw, shrunk, key) => {
          const d = deviation(shrunk, POOL_AVG[key], POOL_SPREAD[key]);
          const c = d ? `tph-dev-${d.level}` : '';
          const a = d && d.level !== 'typical' ? (d.dir === 'up' ? '▲' : '▼') : '';
          return `<span class="${c}">${fmtPct(raw)}${a}</span>`;
        };
        const tilt = tiltRead(p);
        const heat = heatRead(p);
        return `<tr data-xid="${escapeHtml(xid)}" class="tph-prow">
            <td><b>${escapeHtml(p.name)}</b>${tilt ? ' 🤮' : ''}${heat ? ' 🔥' : ''}</td>
            <td>${shortType(classify(p))}</td>
            <td>${p.hands}</td>
            <td>${cell(r.vpip, s.vpip, 'vpip')}/${cell(r.pfr, s.pfr, 'pfr')}</td>
            <td style="color:${pl0(p) >= 0 ? '#7ed957' : '#ff6b6b'}">${plShort(p)}</td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="5"><i>No players tracked yet.</i></td></tr>`;

    const problem = heroProblem();
    renderPanel({
      marker: 'tph-players',
      open: playersListOpen,
      onClose: () => { playersListOpen = false; renderPlayersList(); },
      html: `
      <span class="tph-close">✕</span>
      <h3>Tracked players (${all.length})</h3>
      ${problem ? `<div class="tph-warn">⚠ ${escapeHtml(problem)}</div>` : ''}
      <input class="tph-pfilter" placeholder="Filter by name…" value="${escapeHtml(playersFilter)}" style="width:60%">
      <table class="tph-ptable">
        <tr><th>Name</th><th>Type</th><th>Hands</th><th>VPIP/PFR</th><th>P/L</th></tr>
        <tr class="tph-pool-row"><td colspan="3"><i>Pool average</i></td>
          <td>${POOL_AVG.vpip.toFixed(0)}%/${POOL_AVG.pfr.toFixed(0)}%</td><td>—</td></tr>
        ${rows}
      </table>
      <div style="opacity:.75;margin-top:10px;border-top:1px solid #444;padding-top:8px">
        <b>Session:</b> ${STORE.session.hands} hands, ${fmtSignedMoney(STORE.session.net)}
        ${STORE.session.startedAt ? ' (since ' + new Date(STORE.session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''}<br>
        <b>Lifetime:</b> ${STORE.hero.hands} hands, ${fmtSignedMoney(STORE.hero.netChips)}
        &nbsp;|&nbsp; <b>${fmtBB(STORE.hero.netBB)}</b> ${fmtBB100(STORE.hero.netBB, STORE.hero.bbHands)}
        <br>${(STORE.hands || []).length} hands in history
        ${poolComparisonLine()}
      </div>
    `,
      wire: (panel) => {
        const filterEl = panel.querySelector('.tph-pfilter');
        filterEl.addEventListener('input', (e) => {
          playersFilter = e.target.value;
          renderPlayersList();
          // Re-query: the line above replaced the panel, so `filterEl` is now
          // detached and focusing it would do nothing.
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
      },
    });
  }

  let settingsOpen = false;

  function renderSettingsPanel() {
    renderPanel({
      marker: 'tph-settings',
      open: settingsOpen,
      onClose: () => { settingsOpen = false; renderSettingsPanel(); },
      wire: wireSettingsPanel,
      html: !settingsOpen ? '' : `
      <span class="tph-close">✕</span>
      <h3>Settings</h3>
      <button class="tph-open-players" style="width:100%;padding:9px;margin-bottom:10px">👥 View tracked players &amp; hand history</button>
      <label><b>Your Torn username:</b> <input type="text" class="tph-hero-name" value="${escapeHtml(STORE.settings.heroName)}" placeholder="required for P/L" style="width:55%"></label><br>
      <div style="opacity:.7;margin:2px 0 6px">Needed to attribute profit/loss and work out your position.</div>
      ${heroProblem() ? `<div class="tph-warn">⚠ ${escapeHtml(heroProblem())}</div>` : '<div class="tph-ok">✓ Matched to your seat — profit/loss is being attributed.</div>'}
      <label>Min hands before rating: <input type="number" class="tph-min-hands" value="${STORE.settings.minHands}" style="width:60px"></label><br><br>
      ${bbDisplayModeSuspected ? '<div class="tph-warn">⚠ The blind level read from the log is too small to be a real Torn stake. '
        + 'Torn is probably set to show amounts in big blinds rather than cash — switch it back to cash, or P/L stays unrecorded '
        + 'rather than being written wrong.</div>' : ''}
      ${plausibleBB(lastSeenBB) ? `<div style="opacity:.7;margin:2px 0 8px">Table: ${escapeHtml(tableLabel(lastSeenBB))}</div>` : ''}
      <h4>Seat labels</h4>
      <label><input type="checkbox" class="tph-badge-toggle" ${STORE.settings.showBadges ? 'checked' : ''}> Show tendency labels on seats</label>
      <div style="margin:6px 0">
        <label><input type="radio" name="tph-bm" class="tph-bm" value="session" ${STORE.settings.badgeMode === 'session' ? 'checked' : ''}> Recent form</label>
        &nbsp;<label><input type="radio" name="tph-bm" class="tph-bm" value="lifetime" ${STORE.settings.badgeMode !== 'session' ? 'checked' : ''}> Lifetime</label>
        &nbsp;<label>over <input type="number" class="tph-sw" min="5" max="40" value="${STORE.settings.sessionWindow}" style="width:48px"> hands</label>
      </div>
      <div style="opacity:.7;margin:2px 0 10px">Recent form shows how they are playing NOW and falls back to lifetime
        until enough hands are seen. 🤮 marks a player running ${TILT_VPIP_JUMP}+ points looser than their own norm (${TILT_VPIP_JUMP_AFTER_LOSS}+ if they just lost a ${BIG_LOSS_BB}bb pot). 🔥 marks someone winning a lot of recent pots. Both apply to you too — see the coach panel.</div>
      <div style="opacity:.7;margin:2px 0 10px">Small line under each seat, e.g. <b>STA 15h V74 P12 A16</b>:
        type · window · <b>V</b>PIP (hands played) · <b>P</b>FR (raised preflop) · <b>A</b>Fq (postflop aggression).
        "15h" means V and P cover your last 15 hands; A is always lifetime, since postflop samples are too scarce
        for a short window. Types: NIT, TAG, LAG, MAN(iac), STA(tion), FSH, BAL(anced); "?" = provisional.
        Tap a badge for full stats. Turn off to leave the table completely clear.</div>
      <h4>Your turn</h4>
      <label><input type="checkbox" class="tph-turncue-toggle" ${STORE.settings.turnCues ? 'checked' : ''}> Highlight the screen when it's your turn</label><br>
      <label><input type="checkbox" class="tph-nextcue-toggle" ${STORE.settings.nextToActCue ? 'checked' : ''}> Amber warning when you're next to act</label><br>
      <label><input type="checkbox" class="tph-turnvib-toggle" ${STORE.settings.turnVibrate ? 'checked' : ''}> Also buzz once</label><br>
      <label><input type="checkbox" class="tph-turnsound-toggle" ${STORE.settings.turnSound ? 'checked' : ''}> Also play a chime</label>
      <button class="tph-test-chime">Test</button>
      <div style="opacity:.7;margin:2px 0 10px">A pulsing border plus a green button. It never covers the table's
        controls — the overlay ignores taps entirely. Pre-action buttons ("Check / Fold") don't count as your turn.
        Phones block audio until you've tapped the page, so use Test to check the chime actually plays here.</div>
      <h4>Fold guard</h4>
      <label><input type="checkbox" class="tph-foldguard-toggle" ${STORE.settings.foldGuard ? 'checked' : ''}> Tap Fold twice to confirm</label>
      <div style="opacity:.7;margin:2px 0 10px">Guards against misclicking Fold next to Call. It never folds for you —
        the second tap is your own. If anything goes wrong the tap passes straight through, and missing the
        ${FOLD_ARM_MS / 1000}s window costs nothing, since Torn folds you on timeout anyway.</div>
      <h4>GTO coach</h4>
      <label><input type="checkbox" class="tph-coach-toggle" ${STORE.settings.coachHidden ? '' : 'checked'}> Show coach panel</label><br>
      <label>Full table size: <input type="number" class="tph-table-max" min="2" max="10" value="${STORE.settings.tableMax}" style="width:60px"></label>
      <div style="opacity:.7;margin:2px 0 6px">Equity is always quoted against a full ring of this size, plus the live and heads-up counts.</div>
      <button class="tph-coach-reset">Reset coach position</button><br><br>
      <label><input type="checkbox" class="tph-calib-toggle" ${STORE.settings.calibrationMode ? 'checked' : ''}> Calibration mode</label><br><br>
      <h4>GitHub Gist sync</h4>
      <label>OAuth App Client ID: <input type="text" class="tph-client-id" value="${escapeHtml(STORE.settings.githubClientId)}" style="width:70%"></label><br>
      <button class="tph-connect">${GistSync.status === 'connected' ? 'Re-sync now' : 'Connect'}</button>
      <div class="tph-sync-status">${escapeHtml(syncStatusText())}</div>
      <h4>Backup</h4>
      <textarea class="tph-export" readonly></textarea>
      <button class="tph-copy-export">Copy</button>
      <button class="tph-save-export">${isPDA() ? 'Save / share file' : 'Download file'}</button>
      <textarea class="tph-import" placeholder="Paste JSON to import"></textarea>
      <button class="tph-do-import">Import</button>
      <br><br>
      <button class="tph-reset">Reset all data</button>
    `,
    });
  }

  function wireSettingsPanel(panel) {
    // .value (not innerHTML) so exported JSON — which contains opponent display
    // names — can't break out of the textarea.
    panel.querySelector('.tph-export').value = exportJson();

    panel.querySelector('.tph-open-players').addEventListener('click', () => {
      settingsOpen = false;
      renderSettingsPanel();
      playersListOpen = true;
      renderPlayersList();
    });
    panel.querySelector('.tph-hero-name').addEventListener('change', (e) => {
      STORE.settings.heroName = e.target.value.trim();
      heroXid = null; // force re-resolution against the new name
      saveStore();
    });
    panel.querySelector('.tph-min-hands').addEventListener('change', (e) => {
      STORE.settings.minHands = parseInt(e.target.value, 10) || 20;
      saveStore();
    });
    panel.querySelectorAll('.tph-bm').forEach((el) => {
      el.addEventListener('change', (e) => {
        STORE.settings.badgeMode = e.target.value === 'session' ? 'session' : 'lifetime';
        saveStore();
        renderBadges();
      });
    });
    panel.querySelector('.tph-sw').addEventListener('change', (e) => {
      const n = parseInt(e.target.value, 10);
      STORE.settings.sessionWindow = Math.min(RECENT_MAX, Math.max(5, isNaN(n) ? 15 : n));
      e.target.value = STORE.settings.sessionWindow;
      saveStore();
      renderBadges();
    });
    panel.querySelector('.tph-turncue-toggle').addEventListener('change', (e) => {
      STORE.settings.turnCues = e.target.checked;
      saveStore();
      renderTurnCue(); // clears the glow immediately rather than after the tick
    });
    panel.querySelector('.tph-nextcue-toggle').addEventListener('change', (e) => {
      STORE.settings.nextToActCue = e.target.checked;
      saveStore();
      renderTurnCue();
    });
    panel.querySelector('.tph-turnvib-toggle').addEventListener('change', (e) => {
      STORE.settings.turnVibrate = e.target.checked;
      saveStore();
    });
    panel.querySelector('.tph-turnsound-toggle').addEventListener('change', (e) => {
      STORE.settings.turnSound = e.target.checked;
      saveStore();
      if (e.target.checked) playTurnChime(); // confirm it works at the moment you ask for it
    });
    panel.querySelector('.tph-test-chime').addEventListener('click', (e) => {
      const ok = playTurnChime();
      e.target.textContent = ok ? 'Played' : 'No audio here';
    });
    panel.querySelector('.tph-foldguard-toggle').addEventListener('change', (e) => {
      STORE.settings.foldGuard = e.target.checked;
      saveStore();
      if (!e.target.checked) { foldArmedAt = 0; hideFoldPrompt(); }
    });
    panel.querySelector('.tph-badge-toggle').addEventListener('change', (e) => {
      STORE.settings.showBadges = e.target.checked;
      saveStore();
      renderBadges(); // clears them immediately rather than waiting for the tick
    });
    panel.querySelector('.tph-coach-toggle').addEventListener('change', (e) => {
      setCoachHidden(!e.target.checked);
    });
    panel.querySelector('.tph-table-max').addEventListener('change', (e) => {
      const n = parseInt(e.target.value, 10);
      STORE.settings.tableMax = Math.min(10, Math.max(2, isNaN(n) ? 9 : n));
      e.target.value = STORE.settings.tableMax;
      saveStore();
    });
    // An escape hatch for a panel dragged somewhere unreachable — e.g. parked in
    // a corner that the other screen orientation doesn't have.
    panel.querySelector('.tph-coach-reset').addEventListener('click', () => {
      STORE.settings.coachPos = null;
      STORE.settings.coachPillPos = null; // the pill is draggable too, and can be
                                          // parked out of reach just as easily
      saveStore();
      const coach = document.querySelector('.tph-coach');
      if (coach) coach.remove(); // rebuilt at the default anchor on the next tick
      const pill = document.querySelector('.tph-coach-pill');
      if (pill) pill.remove();
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
    panel.querySelector('.tph-save-export').addEventListener('click', (e) => {
      const stamp = new Date().toISOString().slice(0, 10);
      // exportJson(), not the raw store — it is the single choke point that
      // strips githubToken and anything else in LOCAL_ONLY_SETTINGS.
      const ok = downloadTextFile(exportJson(), `torn-poker-hud-${stamp}.json`, 'application/json');
      e.target.textContent = ok ? 'Sent ✓' : 'Not supported here — use Copy';
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

  // Class bases matching a pattern, regardless of how rare they are.
  //
  // classVocab() sorts by frequency and truncates, which hides exactly the
  // one-off markers that matter most: `self___` appears once (your seat) and
  // `dealer___` once, so both fell below the top-45 cutoff and were missed for
  // many versions while `opponent___(5)` sat in plain sight.
  function classVocabMatching(re) {
    const counts = {};
    document.querySelectorAll('body *').forEach((el) => {
      const cn = typeof el.className === 'string' ? el.className : '';
      cn.split(/\s+/).forEach((tok) => {
        if (!re.test(tok)) return;
        const m = /^(.*?)[_-]{1,3}[A-Za-z0-9]*$/.exec(tok);
        const base = m ? m[1] : tok;
        counts[base] = (counts[base] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
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
    L.push(`=== TORN POKER HUD DEEP SCAN — script v${HUD_VERSION} ===`);
    L.push('url: ' + location.pathname + location.search);
    L.push('logObserver: ' + (logObserver ? (logUsingFallback ? 'ACTIVE (body fallback)' : 'ACTIVE (container)') : 'NOT ATTACHED'));
    // If duplicate hands ever come back, this line says which ingestion path ran.
    // "added-nodes fallback" means logRow matched nothing and the parser cannot
    // tell a re-render from a new event.
    L.push('logIngest: ' + (hasLogRows()
      ? `snapshot diff (${logSnapshot.length} rows, ${logOrientation || 'orientation not yet inferred'})`
      : 'added-nodes fallback — logRow selector matches nothing'));
    L.push('handsRecorded: ' + (STORE.hands || []).length
      + ', withGameId: ' + (STORE.hands || []).filter((h) => h && h.g).length);
    // The two pots should agree mid-hand. A DOM pot with a log pot of 0 means
    // the HUD attached mid-hand; a persistent mismatch means the parser is
    // missing amounts, which silently skews pot odds and MDF.
    const domPot = readDomPot();
    L.push('pot: dom=' + (domPot == null ? 'UNREADABLE' : fmtMoney(domPot))
      + ' log=' + fmtMoney(currentHand ? currentHand.pot : 0)
      + (domPot != null && currentHand && currentHand.pot > 0 && Math.abs(domPot - currentHand.pot) > domPot * 0.02
        ? '  <-- MISMATCH' : ''));
    L.push('heroXid: ' + (heroXid || 'NOT RESOLVED') + ' — ' + (heroProblem() || 'ok'));
    L.push('');

    L.push('--- SELECTOR ALTERNATIVES (each tested separately) ---');
    Object.entries(SELECTORS).forEach(([key, sel]) => {
      selectorAlternatives(sel).forEach((alt) => L.push(`${countSel(alt)}\t${key}\t${alt}`));
    });
    L.push('');

    L.push('--- CSS MODULE CLASS BASES (most common) ---');
    L.push(classVocab(45).join(' '));
    L.push('');

    // Everything below was derived by reading a public reference script rather
    // than from a scan of THIS device. Each line either confirms it holds on
    // Torn PDA's layout or shows what to use instead. Rare markers are listed
    // in full because the frequency-sorted vocabulary above truncates them away.
    L.push('--- IDENTITY / RING MARKERS (unconfirmed on this layout) ---');
    L.push('self/opponent/dealer/position/positioner bases:');
    L.push('  ' + (classVocabMatching(/^(self|opponent|dealer|position|playerPositioner|state|sit)/i).join(' ') || '(none)'));
    const hSeat = heroSeatEl();
    L.push('heroSeat: ' + (hSeat ? elSig(hSeat) : 'NO MATCH')
      + ' -> xid ' + (hSeat ? (resolveXidFromSeat(hSeat) || 'UNRESOLVED') : '—'));
    L.push('dealerXid: ' + (getDealerXid() || 'NOT RESOLVED')
      + '  (dealer el: ' + (document.querySelector(SELECTORS.dealerButton) ? elSig(document.querySelector(SELECTORS.dealerButton)) : 'NO MATCH') + ')');
    const outNow = Array.from(document.querySelectorAll(SELECTORS.seatContainer))
      .filter(isSeatSittingOut).map((s) => s.id);
    L.push('sittingOut: ' + (outNow.length ? outNow.join(', ') : 'none right now'));
    L.push('seatedXids: ' + Array.from(seatedXids()).join(',')
      + '  (incl. sitting out: ' + Array.from(seatedXids({ includeSittingOut: true })).join(',') + ')');
    const btns = findActionButtons();
    L.push('actionButtons by TEXT: ' + btns.length
      + (btns.length ? ' -> ' + btns.map((b) => JSON.stringify(squish(b.textContent, 20))).join(' ') : '')
      + (btns.length ? '' : '  <-- run this scan again ON YOUR TURN'));
    L.push('activeSeat: ' + (activeSeatXid() || 'NO MATCH for ' + SELECTORS.seatActive));
    L.push('seatRing: ' + ((seatRingXids() || []).join(',') || 'UNREADABLE'));
    L.push('isHeroTurn: ' + isHeroTurn() + '  isHeroNextToAct: ' + isHeroNextToAct());
    const stacks = readAllStacks();
    L.push('stacks read: ' + Object.keys(stacks).length + ' -> '
      + (Object.keys(stacks).map((x) => x + '=' + fmtMoney(stacks[x])).join(' ') || '(none)'));
    L.push('isPDA: ' + isPDA() + '  (flutter bridge: ' + (typeof window.flutter_inappwebview !== 'undefined') + ')');
    L.push('table: ' + (tableLabel(lastSeenBB) || 'blind level not read yet')
      + (bbDisplayModeSuspected ? '  <-- BB DISPLAY MODE SUSPECTED, P/L is being withheld' : ''));
    const withShowdowns = Object.keys(STORE.players)
      .filter((x) => STORE.players[x] && Object.keys(STORE.players[x].shownHands || {}).length).length;
    L.push('showdown ranges: ' + withShowdowns + ' player(s) with at least one shown hand');
    L.push('badgeMode: ' + STORE.settings.badgeMode + ' over ' + STORE.settings.sessionWindow + ' hands');
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

    pinTextColor(el);
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

  // Keep a dragged element fully on screen — also re-applied on rotate/resize so
  // it can't end up stranded off the edge in the other orientation.
  // `keepVisiblePx` switches from "keep the whole element on screen" to "keep at
  // least this much of it on screen". Full containment is right for the small
  // gear button, but it pins anything approaching the viewport width: a 366px
  // panel on a 390px screen gets 24px of horizontal travel and reads as broken.
  // Wide panels pass a keep-visible margin and may hang off the edges instead.
  function setFixedPos(el, left, top, keepVisiblePx) {
    const w = el.offsetWidth || 60;
    const h = el.offsetHeight || 44;
    const keep = keepVisiblePx ? Math.min(keepVisiblePx, w, h) : 0;
    const minL = keep ? keep - w : 0;
    const maxL = keep ? window.innerWidth - keep : Math.max(0, window.innerWidth - w);
    // Never allow a negative top: dragging the header above the viewport would
    // put the only drag handle out of reach with no way to get it back.
    const maxT = keep ? window.innerHeight - keep : Math.max(0, window.innerHeight - h);
    const L = Math.min(Math.max(minL, left), Math.max(minL, maxL));
    const T = Math.min(Math.max(0, top), Math.max(0, maxT));
    el.style.left = L + 'px';
    el.style.top = T + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  // `posKey` names the settings field the position persists to, so the gear and
  // the coach panel can each remember where they were put independently.
  function applyStoredPos(el, posKey, keepVisiblePx) {
    const p = STORE.settings[posKey];
    if (p && typeof p.left === 'number' && typeof p.top === 'number') {
      setFixedPos(el, p.left, p.top, keepVisiblePx);
    }
  }

  // Drag to move, tap to open settings. A small movement threshold separates the
  // two, so a slightly-imprecise tap still opens the panel instead of nudging
  // the button and doing nothing.
  const DRAG_THRESHOLD_PX = 6;

  // opts: { onTap, posKey, moveEl, keepVisiblePx }
  // `moveEl` lets a small handle drag a larger element — the coach panel is
  // dragged by its header bar so the advice text underneath stays selectable
  // and an accidental touch on the body doesn't shove the panel across the table.
  // Defaults to the handle itself, which is what the gear button wants.
  function makeDraggable(el, opts) {
    const { onTap, posKey, moveEl, keepVisiblePx } = opts || {};
    const box = moveEl || el;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, pid = null;

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      pid = e.pointerId;
      const rect = box.getBoundingClientRect();
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
      if (!moved) box.classList.add('tph-dragging');
      moved = true;
      setFixedPos(box, originLeft + dx, originTop + dy, keepVisiblePx);
      e.preventDefault();
    });

    const endDrag = (e) => {
      if (!dragging || (e.pointerId != null && e.pointerId !== pid)) return;
      dragging = false;
      box.classList.remove('tph-dragging');
      if (el.releasePointerCapture && pid != null) {
        try { el.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      }
      if (moved) {
        const rect = box.getBoundingClientRect();
        STORE.settings[posKey] = { left: rect.left, top: rect.top };
        saveStore();
      } else if (onTap) {
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
    applyStoredPos(gear, 'gearPos');
    makeDraggable(gear, {
      onTap: () => { settingsOpen = !settingsOpen; renderSettingsPanel(); },
      posKey: 'gearPos',
    });

    window.addEventListener('resize', () => {
      const rect = gear.getBoundingClientRect();
      setFixedPos(gear, rect.left, rect.top);
      const coach = document.querySelector('.tph-coach');
      if (coach && STORE.settings.coachPos) {
        const cr = coach.getBoundingClientRect();
        setFixedPos(coach, cr.left, cr.top, COACH_KEEP_VISIBLE_PX);
      }
      const pill = document.querySelector('.tph-coach-pill');
      if (pill && STORE.settings.coachPillPos) {
        const pr = pill.getBoundingClientRect();
        setFixedPos(pill, pr.left, pr.top, PILL_KEEP_VISIBLE_PX);
      }
    });
  }

  // ===========================================================================
  // TEST SEAM
  // ===========================================================================

  // Every QA harness this repo has used recovered functions by slicing the
  // source with indexOf/eval. That breaks the moment anything is renamed or a
  // const moves — several harnesses broke mid-session for exactly that reason,
  // and one silently reported false passes because a regex matched the wrong
  // chart. Harnesses import this instead: one explicit surface that renames
  // travel through, so a break is a compile error rather than a silent miss.
  //
  // Gated on a flag the harness sets BEFORE loading the file, so the live HUD
  // never carries the global and no user-facing setting exists to get toggled
  // by accident. Production cost is one falsy property read at startup.
  //
  // This is a test surface, not an API: add to it freely, and expect callers in
  // test/ to be updated in the same commit when something here is renamed.
  if (window.__TPH_TEST_HOOKS) {
    window.__TPH_TEST = {
      // --- pure logic: no DOM, no STORE ---
      LOG_PATTERNS,
      LOG_NOISE_RE,
      cleanLogLine,
      cleanName,
      parseAmount,
      RFI_RANGES,
      THREE_BET_RANGES,
      FOUR_BET_RANGE,
      rfiChartFor,
      expandRangeToken,
      preflopBaseline,
      evaluate7,
      estimateEquity,
      rotateToBlinds,
      seatLabel,
      computeRates,
      computeShrunkRates,
      shrunkPct,
      POOL_AVG,
      PRIOR_WEIGHT,
      ARCHETYPE_RULES,
      POOL_SPREAD,
      deviation,
      statRow,
      plShort,
      TORN_STAKES,
      MIN_PLAUSIBLE_BB,
      plausibleBB,
      tableNameForBB,
      stakeTierForBB,
      tableLabel,
      pushRecent,
      sessionRates,
      tiltRead,
      heatRead,
      sessionWinRate,
      handsSinceBigLoss,
      tiltWindowSize,
      tiltText,
      heatText,
      RECENT_MAX,
      RECENT_WON,
      TILT_VPIP_JUMP,
      TILT_VPIP_JUMP_AFTER_LOSS,
      TILT_WINDOW_MAX,
      BIG_LOSS_BB,
      BIG_LOSS_MEMORY_HANDS,
      HEAT_WIN_PCT,
      isFoldControl,
      foldGuardHandler,
      FOLD_ARM_MS,
      FOLD_MIN_GAP_MS,
      get foldArmedAt() { return foldArmedAt; },
      set foldArmedAt(v) { foldArmedAt = v; },
      handClassFromCards,
      noteShowdown,
      shownRange,
      buildRangeHtml,
      exploitDeviation,
      parseCardsFromText,
      classify,
      classifyProvisional,
      shortType,
      ARCHETYPE_SHORT,
      observedPoolAverages,
      ACTION_BTN_RE,
      isPDA,
      fmtMoney,
      fmtSignedMoney,
      fmtBB,
      fmtBB100,
      streetRates,
      ensureHeroShape,
      get lastSeenBB() { return lastSeenBB; },
      set lastSeenBB(v) { lastSeenBB = v; },
      STORE_VERSION,
      migrateStore,
      HUD_VERSION,
      ACTION_BTN_RE,
      PREACTION_BTN_RE,
      findActionButtons,
      findTurnButtons,

      // --- stateful: reads or writes module-level STORE / heroXid ---
      // Exposed as accessors because STORE and heroXid are rebound, not
      // mutated — a plain reference would freeze at whatever loaded first.
      applyHandResults,
      freshHandState,
      handleLogLine,
      getPlayer,
      emptyStore,
      emptyPlayer,

      // --- DOM-touching, exercised against the harness's minimal document ---
      renderPanel,
      get STORE() { return STORE; },
      set STORE(s) { STORE = s; },
      get heroXid() { return heroXid; },
      set heroXid(x) { heroXid = x; },
    };
  }

  // ===========================================================================
  // BOOTSTRAP
  // ===========================================================================

  function init() {
    injectStyles();
    renderGear();
    bootstrapTableWatchers();

    setInterval(renderBadges, 4000);
    setInterval(renderCoachPanel, 1500);
    // Faster than the coach panel: a turn cue that arrives 1.5s late has missed
    // a meaningful slice of the decision clock. Cheap — one button sweep.
    setInterval(renderTurnCue, 400);
    if (STORE.settings.calibrationMode) setInterval(renderCalibrationPanel, 3000);

    // Badges are anchored to seat positions via getBoundingClientRect(), which
    // goes stale on scroll/orientation change well before the 4s interval —
    // recompute on those events (frame-coalesced) instead of waiting.
    window.addEventListener('scroll', scheduleBadgeRender, { passive: true });
    window.addEventListener('resize', scheduleBadgeRender);

    // Capture phase, so the guard sees the tap before Torn's own React handler
    // does and can stop it reaching the game. Everything it does is gated on
    // the setting and wrapped in try/catch — see foldGuardHandler.
    document.addEventListener('click', foldGuardHandler, true);
    // Any tap satisfies the browser's autoplay policy, so the first chime of a
    // session isn't silently dropped. Passive and non-capturing: this must
    // never influence a click.
    document.addEventListener('pointerdown', primeAudio, { passive: true, capture: false });

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
