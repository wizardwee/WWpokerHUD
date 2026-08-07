// The coach panel's idle line (v0.42.2), and the bug it replaces.
//
// buildCoachAdvice() returns null for two situations it has no way to tell
// apart: no hand in progress at all, and hero being OUT of the current hand —
// folded, so the hole cards it reads off the seat are gone and there is
// nothing left to decide. The panel used to read that null as "between hands"
// and said so ("Waiting for the next hand"), which is wrong on every hand hero
// folds early — the majority of them. The fix is the wording, not the logic:
// the idle line has to be true in BOTH cases, which means it cannot name a
// cause it cannot verify.
//
// This locks down the property the wording depends on: buildCoachAdvice()
// returning null is NOT equivalent to "no hand in progress".

const { load, runner } = require('./harness');

const t = runner('coach-idle');

// --- No hand at all -----------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  T.currentHand = null;
  t.eq('with no hand, advice is null', T.buildCoachAdvice(), null);
}

// --- A hand IS in progress, but there is still nothing to advise on -----
//
// The harness's default DOM is inert (every selector matches nothing), so
// readHeroCards() finds no cards and isHeroTurn() finds no active seat or
// action buttons — exactly what the live page looks like once hero's hand is
// face-down after a fold, mid-hand, with two more streets still to come for
// the players left in.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  T.currentHand = T.freshHandState();
  T.currentHand.playersIn = new Set(['H', 'V1', 'V2']);

  const advice = T.buildCoachAdvice();
  t.eq('a truthy currentHand can STILL produce no advice', advice, null);
  t.ok('so "no advice" cannot be read as "no hand" by itself',
    T.currentHand !== null && advice === null);
}

// --- The rendered idle line does not claim a cause it cannot verify -----
//
// Read as source text rather than through the DOM harness: renderCoachPanel
// touches document.body directly and the panel/idle wiring is exercised by
// test/panel.test.js's class-DOM mode. What matters here is just the STRING —
// it must not assert "next hand", which is the specific claim that was wrong.

{
  const fs = require('fs');
  const { SCRIPT_PATH } = require('./harness');
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  t.ok('the idle line no longer promises a next hand is coming',
    !/tph-coach-idle">Waiting for the next hand/.test(src));
  t.ok('and the idle line still exists, just reworded',
    /tph-coach-idle">[^<]+<\/div>/.test(src));
}

process.exit(t.report());
