// Torn can show amounts in big blinds instead of dollars, and switching
// rewrites every log row in place. Reported from a live History: one hand
// stored with "$9" bets and a "$252" win beside $2.5M blinds, and the same
// hand stored again at $22.5M — 2.5M times larger, figure for figure.
//
// Two faults, both driven here through the real functions:
//   1. "9 BB" parsed as the bare number 9.
//   2. The rewrite shared no text with the previous snapshot, so the diff took
//      the whole visible log as new and replayed it into the live hand.

const { load, runner } = require('./harness');

const t = runner('bb-display');
const BB = 2500000;

// --- parseAmount ------------------------------------------------------------

{
  const T = load();
  t.eq('dollar amount with commas', T.parseAmount('2,500,000'), 2500000);
  t.eq('dollar sign tolerated', T.parseAmount('$2,500,000'), 2500000);
  t.eq('abbreviated millions', T.parseAmount('$22.5M'), 22500000);
  t.eq('abbreviated thousands', T.parseAmount('500k'), 500000);
  t.eq('BB amount priced by the blind', T.parseAmount('9 BB', BB), 22500000);
  t.eq('decimal BB amount', T.parseAmount('22.50 BB', 1000000), 22500000);
  t.eq('BB with no space', T.parseAmount('9BB', BB), 22500000);
  t.eq('BB with no blind known is unknown, not tiny', T.parseAmount('9 BB', 0), 0);
  t.eq('BB with an implausible blind is unknown', T.parseAmount('9 BB', 1), 0);
}

// --- the patterns capture the whole amount token -----------------------------

{
  const T = load();
  const cap = (line) => {
    for (const p of T.LOG_PATTERNS) {
      const m = p.re.exec(line);
      if (m) return { type: p.type, amt: m[2] };
    }
    return null;
  };
  const r = cap('Xelphina raised 6.50 BB to 9 BB');
  t.eq('BB raise matches the increment-to-total shape', r && r.type, 'raise');
  t.eq('and captures the TOTAL with its unit', r && r.amt, '9 BB');
  t.eq('BB call keeps its unit', cap('Wonkawee called 9 BB').amt, '9 BB');
  t.eq('BB win keeps its unit', cap('Wonkawee won 234 BB').amt, '234 BB');
  t.eq('BB blind keeps its unit', cap('Wonkawee posted big blind 1 BB').amt, '1 BB');
  // The winner line that once fell to `shows` must still read its figure,
  // and "Did" must not be taken as a unit.
  const w = cap('Bauderix won $28,500,000 Did not show hand');
  t.eq('no-showdown win still a win', w && w.type, 'wins');
  t.eq('its amount is untouched', T.parseAmount(w.amt, BB), 28500000);
}

// --- a hand read in BB mode records chips ------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = 0;
  [
    'Game 5a5a5a started',
    'KingOfClowns posted small blind $1,250,000',
    'Wonkawee posted big blind $2,500,000',
    'Xelphina raised 6.50 BB to 9 BB',
    'Wonkawee called 9 BB',
  ].forEach((l) => T.handleLogLine(l));
  const c = T.currentHand.contributions;
  const x = T.currentHand.actions.find((a) => a.a === 'raise');
  t.eq('a BB raise is recorded in chips', x && x.amt, 22500000);
  const hero = Object.keys(c).find((k) => /Wonkawee/.test(k));
  t.eq('blind plus a BB call sums in chips', c[hero], 2500000 + 22500000);
  t.ok('a priced BB amount does not flag display mode', !T.bbDisplayModeSuspected);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = 0;
  T.bbDisplayModeSuspected = false;
  ['Game 6b6b6b started', 'Xelphina raised 6.50 BB to 9 BB'].forEach((l) => T.handleLogLine(l));
  const x = T.currentHand.actions.find((a) => a.a === 'raise');
  t.eq('with no blind known, the amount is withheld', x && x.amt, 0);
  t.ok('and BB display mode is flagged', T.bbDisplayModeSuspected);
}

// --- the diff treats a unit switch as a re-render ----------------------------

{
  const T = load();
  const dollars = [
    'Game 5a5a5a started',
    'KingOfClowns posted small blind $1,250,000',
    'Wonkawee posted big blind $2,500,000',
    'Xelphina raised $16,250,000 to $22,500,000',
    'Wonkawee called $22,500,000',
  ];
  const bbs = [
    'Game 5a5a5a started',
    'KingOfClowns posted small blind 0.50 BB',
    'Wonkawee posted big blind 1 BB',
    'Xelphina raised 6.50 BB to 9 BB',
    'Wonkawee called 9 BB',
  ];

  let d = T.diffLogRows(dollars, bbs, 'append');
  t.eq('switching units replays nothing', d.fresh.length, 0);
  t.eq('and keeps the latched orientation', d.orientation, 'append');

  d = T.diffLogRows(bbs, dollars, 'append');
  t.eq('switching back replays nothing either', d.fresh.length, 0);

  const withNew = bbs.concat(['9INE called 9 BB']);
  d = T.diffLogRows(dollars, withNew, 'append');
  t.eq('a line arriving with the switch is the only new one', d.fresh.join('|'), '9INE called 9 BB');

  // Rows rewritten a few at a time, a scan landing half-way through.
  const half = bbs.slice(0, 2).concat(dollars.slice(2));
  d = T.diffLogRows(dollars, half, 'append');
  t.eq('a half-rewritten log replays nothing', d.fresh.length, 0);
  d = T.diffLogRows(half, bbs, 'append');
  t.eq('nor does finishing the rewrite', d.fresh.length, 0);

  // Newest-first lists get the same treatment.
  const rev = (a) => a.slice().reverse();
  d = T.diffLogRows(rev(dollars), rev(withNew), 'prepend');
  t.eq('newest-first: only the new line', d.fresh.join('|'), '9INE called 9 BB');

  // Ordinary growth is unchanged.
  d = T.diffLogRows(dollars, dollars.concat(['9INE folded']), null);
  t.eq('plain append still found', d.fresh.join('|'), '9INE folded');
  t.eq('and latches append', d.orientation, 'append');

  // A genuinely different log is still all new.
  const other = ['Game 7c7c7c started', 'Zed posted small blind $500,000', 'Ann posted big blind $1,000,000'];
  d = T.diffLogRows(dollars, other, 'append');
  t.eq('a replaced log is read in full', d.fresh.length, other.length);
}

// Game markers anchor the diff, so two hands' markers must not read alike.
{
  const T = load();
  t.ok('different game ids keep different keys',
    T.logLineKey('Game 1a2b3c started') !== T.logLineKey('Game 9a8b7c started'));
  t.eq('amounts blank to one key', T.logLineKey('A called $22,500,000'), T.logLineKey('A called 9 BB'));
}

process.exit(t.report());
