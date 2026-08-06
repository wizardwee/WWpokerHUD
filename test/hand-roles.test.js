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
  // playing against — tagging the opener would name the wrong seat.
  const r = T.handRoles({ actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'call', 'preflop')] });
  t.eq('the 3-bettor is the preflop aggressor', r.pfr, '5');
  t.eq('and the tag names the level', r.tag, '3B');
}

{
  const r = T.handRoles({ actions: [A('3', 'raise', 'preflop'), A('5', 'raise', 'preflop'), A('3', 'raise', 'preflop')] });
  t.eq('a 4-bet returns the initiative to the opener', r.pfr, '3');
  t.eq('and is tagged 4B', r.tag, '4B');
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
