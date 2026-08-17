---
description: Run the test suite, bump @version/HUD_VERSION together, update both changelogs, commit, and push — the repo's release ritual, in the order CLAUDE.md requires.
argument-hint: [version] [summary of the change]
---

Ship the current working-tree changes in `torn-poker-hud.user.js` (and anything
else changed) as a new version, following the sequence CLAUDE.md pins down as a
hard rule: **verify → bump version → commit → push**, version bumped in the
same commit as the behaviour change, never after.

Arguments (optional, `$ARGUMENTS`): an explicit version number and/or a summary
of what changed, if the user wants to hand those in rather than have you infer
them.

Steps:

1. **Check there's something to ship.** Run `git status` and `git diff`. If
   there are no uncommitted changes, say so and stop — there's nothing to do.

2. **Verify first, unconditionally.** Run `node test/run.js`. If it fails, stop
   and report the failure with enough detail to act on it. Do not bump the
   version or commit on a failing suite — this is the one step CLAUDE.md calls
   out by name ("Verify before pushing").

3. **Work out the version bump.** Current version is on the `@version` line
   near the top of `torn-poker-hud.user.js` and must exactly match the
   `HUD_VERSION` constant a little further down (search for
   `const HUD_VERSION`) — CLAUDE.md is explicit that these two are read
   together and must never drift. Use `$ARGUMENTS` if it names a version.
   Otherwise infer from the diff, following the pattern already visible in
   `CHANGELOG.md`'s history: patch bump (x.y.Z) for a fix with no behaviour
   change beyond correcting something broken, minor bump (x.Y.0) for new
   functionality or a real behavioural change. If it's genuinely ambiguous
   which this is, ask rather than guess.

4. **Write one changelog entry, in both places.** Read the actual diff — don't
   invent behaviour that isn't there. Match the existing voice: what broke or
   was missing (ideally citing what was reported, if this follows a live
   report), root cause, what changed, and why — not a bare list of edits. Put
   the full version in:
   - `CHANGELOG.md`, as a new `## x.y.z` section inserted directly under the
     "Newest first" line at the top (above the current newest entry).
   - The inline `CHANGELOG (newest first)` comment block at the top of
     `torn-poker-hud.user.js`, as the new first entry. That block keeps only
     the **three** most recent entries — after adding the new one, drop
     whichever entry now falls off the end, keeping the
     "Earlier versions: CHANGELOG.md" line intact.

5. **Bump both version fields** (`@version` and `HUD_VERSION`) to the new
   version, in the same edit pass as step 4 — CLAUDE.md's rule is that the
   bump and the change it describes land in one commit, not two.

6. **Re-run `node test/run.js`** after the edits, since the changelog edit
   touches the file the suite syntax-checks. Confirm it still passes.

7. **Commit.** Stage the changed files by name (never `git add -A`/`.`).
   Message names what changed for the user, in the repo's existing style
   (see recent `git log` for tone), not a diff summary. Include the
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer per
   standing instructions.

8. **Push.** This repo's CLAUDE.md explicitly authorizes pushing immediately
   as standing policy ("Commit and push immediately, every time") — don't stop
   to ask first.

9. **Report back** in 1-2 sentences: the new version number and what shipped.
