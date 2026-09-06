// Who holds the initiative in THIS hand, for the seat badges.
//
// handRoles derives everything from hand.actions rather than tracking a second
// copy of the state, so these tests feed it action lists directly — the same
// shape logAction pushes.

const { load, runner } = require('./harness');

const t = runner('hand-roles');
const T = load();

const A = (x, a, s) => ({ x, a, amt: 0, s });

// --- Preflop: the LAST raiser holds the initiative, not the first -----------

{
  const r = T.handRoles({ actions: [A('1', 'sb', 'preflop'), A('2', 'bb', 'preflop'), A('3', 'raise', 'preflop'), A('1', 'call', 'preflop')] });
  t.eq('a single raiser is the PFR', r.pfr, '3');
  t.eq('and is tagged PFR', r.tag, 'PFR');
}

{
  // The opener raises, someone 3-bets. The 3-bettor is who everyone is now
  // playing against, so they hold `pfr` — but the opener KEEPS a chip. Losing
  // it was the reported bug: a 3-bet un-badged the seat that opened, and a
  // blank seat reads as "never raised" at a glance.
  const r = T.handRoles({ actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'call', 'preflop')] });
  t.eq('the 3-bettor is the preflop aggressor', r.pfr, '5');
  t.eq('and the tag names the level', r.tag, '3B');
  t.eq('the opener keeps a PFR chip through the 3-bet', r.preflop['3'], 'PFR');
  t.eq('and the 3-bettor carries their own tier', r.preflop['5'], '3B');
}

{
  const r = T.handRoles({ actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'raise', 'preflop')] });
  t.eq('a 4-bet returns the initiative to the opener', r.pfr, '3');
  t.eq('and is tagged 4B', r.tag, '4B');
  // Each raiser is tagged at the tier of their OWN last raise, so the opener
  // is promoted off PFR rather than showing two chips or a stale one.
  t.eq('the 4-bettor shows their latest tier, not their first', r.preflop['3'], '4B');
  t.eq('the 3-bettor still shows 3B', r.preflop['5'], '3B');
  t.eq('tag agrees with the last raiser\'s own entry', r.tag, r.preflop[r.pfr]);
}

{
  // Five-bet pot: the ladder keeps climbing and both seats stay chipped.
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'),
      A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop')],
  });
  t.eq('the 5-bettor is tagged 5B', r.preflop['5'], '5B');
  t.eq('the 4-bettor is still tagged 4B', r.preflop['3'], '4B');
}

{
  // A limped pot has nobody in the preflop map at all.
  const r = T.handRoles({ actions: [A('4', 'call', 'preflop'), A('2', 'check', 'preflop')] });
  t.eq('no preflop raiser means no preflop chips', Object.keys(r.preflop).length, 0);
}

{
  // Blinds are posts, not raises. Counting them would make the BB the PFR of
  // every limped pot.
  const r = T.handRoles({ actions: [A('1', 'sb', 'preflop'), A('2', 'bb', 'preflop'), A('4', 'call', 'preflop'), A('2', 'check', 'preflop')] });
  t.eq('a limped pot has no preflop raiser', r.pfr, null);
  t.eq('and no tag', r.tag, null);
}

// --- Postflop: aggression from anyone who was NOT the preflop raiser --------

{
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('7', 'call', 'preflop'), A('7', 'bet', 'flop')],
  });
  t.eq('a non-raiser leading the flop is a donk', r.post['7'], 'DONK');
  t.eq('and the preflop raiser keeps their own tag', r.pfr, '3');
}

{
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('7', 'call', 'preflop'),
      A('3', 'bet', 'flop'), A('7', 'raise', 'flop')],
  });
  t.eq('raising the c-bet reads as RR, not DONK', r.post['7'], 'RR');
}

{
  // The preflop raiser c-betting is exactly what is expected of them — marking
  // it would put a chip on nearly every hand and carry no information.
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('7', 'call', 'preflop'), A('3', 'bet', 'flop')],
  });
  t.eq('the preflop raiser is never given a postflop chip', r.post['3'], undefined);
  t.eq('and keeps their preflop chip on the flop', r.preflop['3'], 'PFR');
}

{
  // The suppression covers the LAST preflop raiser only. An opener who called a
  // 3-bet and then leads the flop is donking into the player who took the
  // betting lead off them — one of the sharpest reads on the table, and NOT an
  // expected c-bet. v1.60.0 suppressed it too, on the grounds that the badge
  // had room for one chip; it has room for two (measured), so both show.
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'call', 'preflop'),
      A('3', 'bet', 'flop')],
  });
  t.eq('an out-tiered preflop raiser leading IS a donk', r.post['3'], 'DONK');
  t.eq('and keeps their preflop chip alongside it', r.preflop['3'], 'PFR');
  // The player who actually took the lead preflop is still c-betting, and that
  // half of the old rule is the half that was right.
  t.eq('the last preflop raiser still gets no postflop chip', r.post['5'], undefined);
  t.eq('and holds the higher tier', r.preflop['5'], '3B');
}

{
  // A raise rather than a bet from an out-tiered raiser is RR, not DONK — the
  // two are separate reads and the distinction must survive the change above.
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'call', 'preflop'),
      A('5', 'bet', 'flop'), A('3', 'raise', 'flop')],
  });
  t.eq('an out-tiered raiser check-raising reads RR', r.post['3'], 'RR');
  t.eq('the c-bettor is still unmarked', r.post['5'], undefined);
}

{
  // In a limped pot nobody was the preflop raiser, so whoever bets the flop is
  // taking an initiative no one held. That is still worth flagging.
  const r = T.handRoles({ actions: [A('4', 'call', 'preflop'), A('4', 'bet', 'flop')] });
  t.eq('a flop bet in a limped pot is flagged', r.post['4'], 'DONK');
}

{
  // Latest action wins, so the chip tracks the live street rather than freezing
  // on whatever they did first.
  const r = T.handRoles({
    actions: [A('3', 'raise', 'preflop'), A('7', 'bet', 'flop'), A('3', 'bet', 'turn'), A('7', 'raise', 'turn')],
  });
  t.eq('the marker follows the most recent street', r.post['7'], 'RR');
}

// --- Degrades rather than throwing -----------------------------------------

{
  const empty = T.handRoles(null);
  t.eq('no hand yields no preflop raiser', empty.pfr, null);
  t.eq('no hand yields an empty postflop map', Object.keys(empty.post).length, 0);
  t.eq('no hand yields an empty preflop map', Object.keys(empty.preflop).length, 0);
  t.eq('a hand with no actions is the same', T.handRoles({ actions: [] }).tag, null);
}

// --- The tooltip explains every tag it can produce --------------------------
//
// A chip on a seat with no legend anywhere is a puzzle, not a read.
['PFR', '3B', '4B', '5B', 'DONK', 'RR'].forEach((tag) => {
  const text = T.roleTagText(tag);
  t.ok(`${tag} has tooltip text`, typeof text === 'string' && text.length > 10);
  t.ok(`${tag}'s tooltip names the tag`, text.startsWith(tag + ' ='));
});

process.exit(t.report());
