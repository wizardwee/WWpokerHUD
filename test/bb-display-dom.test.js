// Stacks and the DOM pot in Torn's BB display mode.
//
// A v1.99.0 deep scan at a table in BB mode read `stacks read: 0` and
// `pot: dom=UNREADABLE` while the log priced fine: both DOM readers accepted
// only "$X", and every seat read "157.45 BB". Driven through the real
// readSeatStack / readDomPot, not a copy of their patterns.

const { load, runner } = require('./harness');

const t = runner('bb-display-dom');

function seatWith(text) {
  const el = { textContent: text };
  return { querySelectorAll: (sel) => (/money_/.test(sel) ? [el] : []) };
}

{
  const T = load();
  T.lastSeenBB = 2500000;
  t.eq('dollar stack still reads', T.readSeatStack(seatWith('$190,866,931')), 190866931);
  t.eq('BB stack is priced with the blind', T.readSeatStack(seatWith('157.45 BB')), 393625000);
  t.eq('BB stack with no space', T.readSeatStack(seatWith('36.25BB')), 90625000);
  t.eq('a username is not a stack', T.readSeatStack(seatWith('Gligar')), null);
  t.eq('a bare number is not a stack', T.readSeatStack(seatWith('1527')), null);

  T.lastSeenBB = 0;
  t.eq('no blind known: unreadable, never tiny', T.readSeatStack(seatWith('157.45 BB')), null);
  t.eq('displayAmount refuses to guess', T.displayAmount('9 BB'), 0);
}

{
  const T = load();
  T.lastSeenBB = 2500000;
  const doc = T._sandbox.document;
  const pot = (text) => {
    doc.querySelector = (sel) => (/totalPotWrap_/.test(sel) ? { textContent: text } : null);
    return T.readDomPot();
  };
  t.eq('dollar pot still reads', pot('POT:$6,300,000'), 6300000);
  t.eq('BB pot is priced', pot('POT:2.5 BB'), 6250000);
  t.eq('side pots: the largest BB figure', pot('POT:12 BB2 BB'), 30000000);
  t.eq('nothing readable stays null', pot('POT:'), null);
}

process.exit(t.report());
