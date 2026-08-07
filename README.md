# Torn Poker HUD

Opponent-tendency HUD for Torn's holdem room, built for **Torn PDA**'s custom
script runtime (mobile — no `GM_xmlhttpRequest`, no IndexedDB).

Per-player stats (VPIP/PFR/AFq/3-bet/fold-to-3-bet/C-bet/WTSD), archetype tags
on seat badges, a Monte Carlo equity engine (range-weighted once the pot's
been raised, not just "vs random hands"), a ranked exploit plan per opponent,
plain-language tendency reports, per-opponent P/L, showdown ranges, session
and tilt tracking, bet-sizing tells, hand history with file export, and an
advisory coach panel — all reading Torn's own DOM, nothing else.

**Advisory only.** The coach panel never clicks anything or acts for you — it
prints reads and suggestions. Every decision, and every tap, is yours. The one
exception is an opt-in fold-misclick guard, which still never acts on its own:
it only requires a second real tap to confirm Fold.

## Install

In Torn PDA: **Settings → Advanced Browser Settings → Custom Scripts → Add by
URL**, and paste:

```
https://raw.githubusercontent.com/wizardwee/WWpokerHUD/main/torn-poker-hud.user.js
```

Add it **by URL**, not by pasting the file's contents — the script carries an
`@updateURL`, so adding it by URL lets Torn PDA pull new versions
automatically. Pasting the raw text in means updates have to be repasted by
hand every time.

It activates on `torn.com/page.php?sid=holdem`. A red **HUD** button appears
over the table; tap it for settings.

**Set your Torn username in Settings first.** Without it, the HUD can't tell
which seat is yours, and per-opponent P/L and position both stay silent.

## What it's built on

Selectors are calibrated against real deep scans from a live table, not
guesswork — the app has no way to log into Torn or inspect the DOM directly,
so if Torn changes its page layout and things go quiet, there's a built-in
**Calibration mode** (gear icon → Calibration) that reports exactly what
matched and what didn't, for diagnosing against a fresh scan.

Everything the HUD reads is already visible on your own screen — seat
positions, the action log, revealed showdown hands. It doesn't call any
Torn API and doesn't need one for its core features.

## Optional: GitHub Gist sync

Lets tracked stats follow you across devices/reinstalls. Skip this if
on-device tracking is enough — everything else works without it.

1. On github.com (a normal browser, not inside PDA): **Settings → Developer
   settings → OAuth Apps → New OAuth App**. Any name/homepage works; the
   callback URL can be anything, since Device Flow doesn't use it.
2. Open the new app's settings and enable **"Enable Device Flow"**.
3. Copy the **Client ID** (not a secret) into the HUD's Settings → GitHub
   Gist sync → Client ID.
4. Tap **Connect**. It shows a code and a URL (`github.com/login/device`) —
   open that in your phone's regular browser, not the PDA webview, and enter
   the code.
5. Once authorized, the HUD syncs to a secret Gist and merges by keeping
   whichever side has more observed hands per player, so switching devices
   doesn't lose data.

**Settings → Backup → Copy/Import** is a manual alternative — plain JSON,
no GitHub account needed.

## What's an estimate, and said so in the app

- **Coach guidance is heuristic, not a solver.** Preflop ranges are static
  reference charts calibrated to published opening frequencies, labelled
  "Baseline" rather than "GTO" for exactly that reason. Postflop leans on
  minimum-defense-frequency math and the specific opponent's tracked stats.
- **Equity is Monte Carlo**, vs a random hand for an unraised pot, or a proxy
  range once the pot's been raised — not a true range-vs-range solve.
- **Per-opponent P/L in multiway pots is a proportional estimate.** With
  three or more players, the true number can't be known — only who won and
  lost overall — so it's split by each player's net result. Labelled as an
  estimate in the UI.
- **Pool-average comparisons are borrowed, not measured on Torn**, and the
  UI says which figures those are.

## Issues / feedback

Either works — a [GitHub Issue](https://github.com/wizardwee/WWpokerHUD/issues)
on this repo, or a comment on the GreasyFork listing. If something's misreading
the table, **Settings → Calibration mode → run a deep scan → copy the report**
and paste it into whichever one you use — that's the fastest way to get a fix,
since nobody maintaining this can log into Torn and see your table directly.

## License

MIT — see [LICENSE](LICENSE).
