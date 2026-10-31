// A log swapped for another table's is history, not action (v1.115.0).
//
// Moving tables swaps in the new table's log, already full of lines. Nothing
// in it overlaps the old log, so the diff read every line as new and replayed
// it into the old table's hand: a real backup held a stored "hand" with 18
// players dealt in, three winners and a $1.39B pot, and the names in those
// lines minted `name:` pseudo-records. Driven through the real scanLogRows
// against a stubbed log list.

const { load, runner } = require('./harness');

const t = runner('log-swap');

function setup() {
  const T = load();
  T.STORE = T.emptyStore();
  let rows = [];
  const body = T._sandbox.document.body;
  body.querySelectorAll = (sel) => (/message_/.test(sel)
    ? rows.map((text) => ({ textContent: text, querySelectorAll: () => [] })) : []);
  body.querySelector = (sel) => (/message_/.test(sel) && rows.length ? {} : null);
  return { T, show: (r) => { rows = r.slice(); T.scanLogRows(); } };
}

const OLD = [
  'Game aaaaa1 started', 'Dino posted small blind $500,000', 'Red posted big blind $1,000,000',
  'Dead raised $2,000,000 to $3,000,000',
];
// The new table's log as it arrives: mid-history, at a different stake.
const NEW = [
  'Cat posted big blind $2,500,000', 'Rover folded', 'KBomb folded', 'Winner called $2,500,000',
  'Rukinos raised $10,000,000 to $12,500,000', 'King called $12,500,000', 'Mrin called $11,250,000',
  'Cat raised $82,195,240 to $94,695,240', 'Rukinos called $84,695,240',
];
const names = (T) => Object.keys(T.STORE.players).map((k) => k.replace(/^name:/, ''));

{
  const { T, show } = setup();
  show(OLD.slice(0, 1));                 // page load: primed, not parsed
  show(OLD);                             // the hand plays out
  t.ok('ordinary growth is parsed', names(T).includes('Dead'));
  t.eq('blind read', T.lastSeenBB, 1000000);

  show(NEW);                             // move tables
  t.ok('the swap is recognised', !!T.lastLogSwap);
  t.ok('none of the new table\'s history is parsed',
    !['Rukinos', 'Cat', 'Winner', 'King'].some((n) => names(T).includes(n)));
  t.eq('no pseudo-records minted', Object.keys(T.STORE.players).filter((k) => k.startsWith('name:')
    && ['Rukinos', 'Cat', 'Winner', 'King', 'Mrin', 'Rover', 'KBomb'].includes(k.slice(5))).length, 0);
  t.eq('the old table\'s hand is closed, not left open', T.currentHand.actions.length, 0);
  t.eq('the new table\'s blind replaces the old one', T.lastSeenBB, 2500000);

  // The new table carries on: its next lines are parsed into a hand of their own.
  show(NEW.concat(['Mrin folded', 'Game bbbbb2 started', 'Cat posted small blind $1,250,000',
    'Rover posted big blind $2,500,000', 'KBomb called $2,500,000']));
  t.eq('lines after the swap are parsed', T.currentHand.actions.map((a) => a.a).join(','), 'sb,bb,call');
  const mixed = (T.STORE.hands || []).filter((h) => (h.actions || []).some((a) => a.amt === 3000000)
    && (h.actions || []).some((a) => a.amt === 2500000));
  t.eq('no stored hand mixes the two tables', mixed.length, 0);
}

// A log cleared and refilled at the SAME table starts at a hand's own start
// line and is short: that is still read.
{
  const { T, show } = setup();
  show(OLD.slice(0, 1));
  show(OLD);
  show(['Game ccccc3 started', 'Dino posted small blind $500,000', 'Red posted big blind $1,000,000']);
  t.ok('a cleared log refilled from a hand start is not a swap', !T.lastLogSwap);
  t.eq('and its lines are parsed', T.currentHand.gameId, 'ccccc3');
}

// The rule itself, both directions and the edges.
{
  const { T } = setup();
  const sw = (prevLen, fresh, overlap) => T.logWasSwapped(prevLen, { fresh, overlap });
  t.ok('mid-history with no overlap is a swap', sw(5, ['Rover folded', 'Cat called $1'], 0));
  t.ok('a long burst is a swap even from a hand start',
    sw(5, ['Game ddddd4 started'].concat(Array(8).fill('X folded')), 0));
  t.ok('any overlap is ordinary growth', !sw(5, ['Rover folded'], 2));
  t.ok('an empty previous log is never a swap', !sw(0, ['Rover folded'], 0));
  t.ok('a short refill from a hand start is not a swap', !sw(5, ['Game ddddd4 started', 'A folded'], 0));
}

process.exit(t.report());
