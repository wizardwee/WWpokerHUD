// Torn's ALL-IN raise line has no "to": "raised $93,000,000", where the figure
// is what the shove ADDED, not the street total (confirmed by the user,
// v1.117.0). Read as a total, every shove was short by the chips already in,
// and a shove for less than the bet faced showed as a raise to LESS than the
// last raise.
//
// The hand below is the one reported from History (Nov 1, 05:51 PM): its pot,
// $1.4B, and its two winners, $1.1B and $287.8M, only add up with the
// added-amount reading. Money is fuzzed in settlement-fuzz.test.js; this pins
// what the fuzz cannot see — that a shove for less is a CALL, so it is not
// credited as a raise to anyone's PFR/3-bet.

const { load, runner } = require('./harness');

const t = runner('allin-raise');
const M = 1000000;

const T = load();
T.STORE = T.emptyStore();
T.lastSeenBB = 0;
[
  'Game 5e5e5e started',
  'CunningCat posted small blind $1,250,000',
  'Pete posted big blind $2,500,000',
  'Wonkawee folded',
  'dx1iamxb called $2,500,000',
  'WinnerWinnerMO raised $7,500,000 to $10,000,000',
  'Daddy-Cthulhu folded',
  'CunningCat folded',
  'Pete raised $23,800,000 to $33,800,000',
  'dx1iamxb raised $93,000,000',
  'WinnerWinnerMO called $85,500,000',
  'Pete raised $741,300,000',
  'WinnerWinnerMO raised $426,800,000',
].forEach((l) => T.handleLogLine(l));

const h = T.currentHand;
const C = (n) => h.contributions['name:' + n] || 0;
const act = (n) => h.actions.filter((a) => a.x === 'name:' + n).map((a) => a.a + ' ' + a.amt);

t.eq('a shove adds its figure on top of what was already in', C('dx1iamxb'), 95500000);
t.eq('the call after it squares with the shove\'s total', C('WinnerWinnerMO'), 522300000);
t.eq('a re-shove is a raise to in + added', C('Pete'), 775100000);
t.eq('the pot is what the winners were paid', Math.round(h.pot / 1e5), Math.round((1.25 + 95.5 * 3 + (775.1 - 95.5) + (522.3 - 95.5)) * 10));
t.eq('History shows the shove\'s total', act('dx1iamxb').pop(), 'raise 95500000');
t.eq('a shove for less than the bet faced is a call for the amount added', act('WinnerWinnerMO').pop(), 'call 426800000');
t.eq('and it does not count as a raise', h.preflopRaiseEvents, 4);

// A bare "raises to $X" (no first figure) is still a total, not an increment.
{
  const U = load();
  U.STORE = U.emptyStore();
  ['Game 6f6f6f started', 'A posted small blind $1,000,000', 'B posted big blind $2,000,000', 'A raises to $6,000,000']
    .forEach((l) => U.handleLogLine(l));
  t.eq('"raises to $X" is still read as a total', U.currentHand.contributions['name:A'], 6 * M);
}

process.exit(t.report());
