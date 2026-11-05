// Opening by position, steal, fold to steal (v1.119.0).
//
// Positions are read from the preflop action order alone, so they work for
// every opponent and while spectating. These pin the order rules, the
// "folded to them" condition, the steal and fold-to-steal spots, and that the
// live settlement and the backfill count the same way.

const { load, runner } = require('./harness');

const t = runner('position-stats');
const T = load();

const pre = (x, a) => ({ x, a, s: 'preflop' });
// Seats in preflop order after the blinds: UTG, MP, CO, BTN; then SB, BB.
const six = (rest) => [pre('SB', 'sb'), pre('BB', 'bb')].concat(rest);
const byX = (arr) => Object.fromEntries(arr.map((o) => [o.xid, o]));

// --- Folded to the cutoff, who steals; blinds face it ----------------------
{
  const ev = T.positionEventsFor(six([
    pre('U', 'fold'), pre('M', 'fold'), pre('C', 'raise'), pre('B', 'fold'),
    pre('SB', 'fold'), pre('BB', 'call'),
  ]));
  const o = byX(ev.opens);
  t.eq('UTG had the chance, early', o.U && o.U.b, 'E');
  t.ok('and did not open', !o.U.open);
  t.eq('MP is middle', o.M && o.M.b, 'M');
  t.eq('CO is late', o.C && o.C.b, 'L');
  t.ok('and opened', o.C.open);
  t.ok('BTN faced a raise: no open spot', !o.B);
  t.ok('blinds have no open spot after a raise', !o.SB && !o.BB);
  const f = byX(ev.fts);
  t.ok('SB faced the steal and folded', f.SB && f.SB.folded);
  t.ok('BB faced it and defended', f.BB && !f.BB.folded);
}

// --- A limp ends the "folded to" spot --------------------------------------
{
  const ev = T.positionEventsFor(six([
    pre('U', 'call'), pre('M', 'raise'), pre('C', 'fold'), pre('B', 'fold'),
    pre('SB', 'fold'), pre('BB', 'fold'), pre('U', 'fold'),
  ]));
  const o = byX(ev.opens);
  t.ok('the limper had the spot', o.U && !o.U.open);
  t.ok('an iso-raise after a limp is not an open', !o.M);
  t.eq('and an MP raise is no steal', ev.fts.length, 0);
}

// --- SB steal: BB faces it --------------------------------------------------
{
  const ev = T.positionEventsFor(six([
    pre('U', 'fold'), pre('M', 'fold'), pre('C', 'fold'), pre('B', 'fold'),
    pre('SB', 'raise'), pre('BB', 'fold'),
  ]));
  const o = byX(ev.opens);
  t.eq('SB folded to is its own bucket', o.SB && o.SB.b, 'S');
  t.ok('and opened', o.SB.open);
  t.eq('BB folds to the SB steal', JSON.stringify(ev.fts), JSON.stringify([{ xid: 'BB', folded: true }]));
}

// --- A 3-bet before the blind acts: not a fold-to-steal spot -----------------
{
  const ev = T.positionEventsFor(six([
    pre('U', 'fold'), pre('M', 'fold'), pre('C', 'fold'), pre('B', 'raise'),
    pre('SB', 'raise'), pre('BB', 'fold'), pre('B', 'fold'),
  ]));
  const f = byX(ev.fts);
  t.ok('SB faced the steal', f.SB && !f.SB.folded);
  t.ok('BB faced a 3-bet, not a steal', !f.BB);
}

// --- Labels at nine-handed ---------------------------------------------------
{
  const seats = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const ev = T.positionEventsFor([pre('SB', 'sb'), pre('BB', 'bb')]
    .concat(seats.map((x) => pre(x, 'fold'))).concat([pre('SB', 'fold')]));
  t.eq('nine-handed buckets, UTG to BTN', ev.opens.map((o) => o.b).join(''), 'EEEMMLLS');
}

// --- Unplaceable hands are skipped -------------------------------------------
t.eq('no blind lines', T.positionEventsFor([pre('U', 'raise'), pre('M', 'fold')]), null);
t.eq('a blind acting before a seat that precedes it', T.positionEventsFor(six([
  pre('U', 'fold'), pre('SB', 'call'), pre('M', 'raise'),
])), null);
t.ok('postflop actions do not move positions', !!T.positionEventsFor(six([
  pre('U', 'raise'), pre('SB', 'fold'), pre('BB', 'call'), { x: 'BB', a: 'bet', s: 'flop' },
])));

// --- Live settlement and the backfill agree, and the backfill runs once -----
{
  const L = ['Game a00001f started', 'S posted small blind $1,000,000', 'Bb posted big blind $2,000,000',
    'Uu folded', 'Cc raised $4,000,000 to $5,000,000', 'S folded', 'Bb folded',
    'Cc won $8,000,000 Did not show hand', 'Game a00002f started'];
  const A = load(); A.STORE = A.emptyStore(); A.heroXid = null;
  L.forEach((l) => A.handleLogLine(l));
  const r = (T2, n) => T2.computeRates(T2.STORE.players['name:' + n]);
  t.eq('live: BTN steal counted', r(A, 'Cc').steal, 100);
  t.eq('live: four-handed, the first seat is the cutoff', r(A, 'Uu').openL, 0);
  t.eq('live: BB folded to the steal', r(A, 'Bb').foldToSteal, 100);

  const B = load(); B.STORE = A.emptyStore(); B.heroXid = null;
  L.forEach((l) => B.handleLogLine(l));
  Object.values(B.STORE.players).forEach((p) => { delete p.pos; });
  B.STORE.posBackfilled = false;
  t.eq('backfill reads the stored hand', B.backfillPositions(), 1);
  t.eq('backfill: same steal', r(B, 'Cc').stealOpp, r(A, 'Cc').stealOpp);
  t.eq('backfill: same fold to steal', r(B, 'Bb').foldToStealOpp, 1);
  t.eq('runs once', B.backfillPositions(), 0);
  t.eq('no double count', r(B, 'Cc').stealOpp, 1);

  const html = A.positionRowsHtml(r(A, 'Cc'));
  t.ok('Stats rows render', /Open E\/M\/L/.test(html) && /Steal/.test(html) && /Fold v steal/.test(html));
}

process.exit(t.report());
