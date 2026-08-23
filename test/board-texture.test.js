// Board texture: classifying the board, and splitting a villain's postflop
// actions by it.
//
// Note "texture" already meant HAND strength in this file (p.texture, made vs
// draw, v1.18.0). Everything here is board*/boardTex*, and these tests are one
// of the things keeping the two apart.
//
// The raw material was ALL already being collected before this feature — the
// fourth time that has been true in this repo. hand.board is parsed from the
// log with no hero gate, every action carries its street, and the replayer's
// board-per-street slicing already existed. What was new is the classifier and
// the per-flag counters.

const { load, runner } = require('./harness');

const t = runner('board-texture');

const T = load();
const C = (s) => ({ rank: s[0], suit: s[1] });
const B = (...xs) => xs.map(C);

// --- The classifier ---------------------------------------------------------

{
  t.eq('a board under three cards has no texture at all', T.boardFlags(B('As', 'Kd')).length, 0);
  t.eq('and neither does an empty one', T.boardFlags([]).length, 0);
  t.eq('nor a non-array', T.boardFlags(null).length, 0);
}

{
  // The case that prompted the feature.
  const f = T.boardFlags(B('As', 'Ks', '7s', '2s', '9d'));
  t.ok('four to a flush is flagged', f.includes('fl4'));
  t.ok('and it is not ALSO called a three-flush', !f.includes('fl3'));
  t.ok('and not dry', !f.includes('dry'));
}

{
  const f = T.boardFlags(B('As', 'Ks', '7s', '2d', '9h'));
  t.ok('exactly three of a suit is a three-flush', f.includes('fl3'));
  t.ok('not a four-flush', !f.includes('fl4'));
}

{
  const f = T.boardFlags(B('As', 'Ks', '7s'));
  t.ok('a monotone flop is a three-flush', f.includes('fl3'));
}

{
  t.ok('a paired board is flagged', T.boardFlags(B('9s', '9d', '2c')).includes('pair'));
  t.ok('trips too', T.boardFlags(B('9s', '9d', '9c')).includes('pair'));
  t.ok('and a pair that arrives on the river', T.boardFlags(B('As', 'Kd', '7c', '2h', 'Ad')).includes('pair'));
}

{
  t.ok('four to a straight is flagged', T.boardFlags(B('5s', '6d', '7c', '8h')).includes('str4'));
  t.ok('with a gap inside the five-span too', T.boardFlags(B('5s', '6d', '7c', '9h')).includes('str4'));
  t.ok('the wheel counts — ace plays low', T.boardFlags(B('As', '2d', '3c', '4h')).includes('str4'));
  t.ok('broadway counts', T.boardFlags(B('Ts', 'Jd', 'Qc', 'Kh')).includes('str4'));
  t.ok('a three-card run on a flop is NOT four to a straight',
    !T.boardFlags(B('5s', '6d', '7c')).includes('str4'));
  t.ok('four cards spanning six ranks is not either',
    !T.boardFlags(B('2s', '5d', '8c', 'Kh')).includes('str4'));
}

{
  const f = T.boardFlags(B('As', '8d', '3c'));
  t.eq('a rainbow, unpaired, unconnected flop is exactly dry', f.join(','), 'dry');
}

{
  // Overlap is the whole reason these are flags and not one class per board.
  const f = T.boardFlags(B('9s', '9d', '7s', '2s', '8s'));
  t.ok('a paired four-flush board is flagged as a four-flush', f.includes('fl4'));
  t.ok('AND as paired — neither fact is dropped', f.includes('pair'));
  t.ok('and it is never also dry', !f.includes('dry'));
}

{
  // Every emitted flag must be a declared one, or the Stats tab and the
  // coach tags silently disagree about what exists.
  const declared = T.BOARD_FLAGS.map((f) => f.key);
  const boards = [
    B('As', 'Ks', '7s', '2s', '9d'), B('As', 'Ks', '7s', '2d', '9h'),
    B('9s', '9d', '2c'), B('5s', '6d', '7c', '8h'), B('As', '8d', '3c'),
    B('9s', '9d', '7s', '2s', '8s'), B('As', '2d', '3c', '4h'),
  ];
  const emitted = new Set();
  boards.forEach((b) => T.boardFlags(b).forEach((f) => emitted.add(f)));
  t.ok('the sample boards exercise more than one flag (guards a vacuous check)', emitted.size > 1);
  t.eq('every emitted flag is declared in BOARD_FLAGS',
    [...emitted].filter((f) => declared.indexOf(f) === -1).length, 0);
}

// --- Collection -------------------------------------------------------------

{
  const X = load();
  const p = X.getPlayer('V');
  const board = B('As', 'Ks', '7s', '2s', '9d'); // fl4 by the river

  // A flop action must be read against the FLOP, not the finished board: the
  // first three cards here are a three-flush, not a four-flush.
  X.noteBoardTexture(p, 'bet', 'flop', board);
  t.eq('a flop bet is filed under the flop texture', p.boardTex.fl3.b, 1);
  t.eq('and not under the final board texture', p.boardTex.fl4, undefined);

  X.noteBoardTexture(p, 'bet', 'river', board);
  t.eq('a river bet is filed under the river texture', p.boardTex.fl4.b, 1);
}

{
  const X = load();
  const p = X.getPlayer('V');
  X.noteBoardTexture(p, 'check', 'flop', B('As', '8d', '3c'));
  X.noteBoardTexture(p, 'fold', 'flop', B('As', '8d', '3c'));
  X.noteBoardTexture(p, 'raise', 'flop', B('As', '8d', '3c'));
  t.eq('checks are counted', p.boardTex.dry.k, 1);
  t.eq('folds are counted', p.boardTex.dry.f, 1);
  t.eq('raises are counted separately from bets', p.boardTex.dry.r, 1);
  t.eq('and a bet is still zero', p.boardTex.dry.b, 0);
}

{
  const X = load();
  const p = X.getPlayer('V');
  X.noteBoardTexture(p, 'bet', 'preflop', B('As', '8d', '3c'));
  t.eq('preflop has no board, so nothing is recorded', Object.keys(p.boardTex).length, 0);

  // A board that has not been fully parsed for the street would misclassify —
  // a turn read against two known cards could call a three-flush board dry.
  X.noteBoardTexture(p, 'bet', 'river', B('As', 'Ks', '7s'));
  t.eq('a short board for the street is skipped, not guessed at',
    Object.keys(p.boardTex).length, 0);
}

{
  // Overlap must double-count ACROSS flags — that is the point — while each
  // flag's own counters stay a clean tally of that flag.
  //
  // Note this needs a TURN board: three cards can't be both paired and a
  // three-flush, since the pair itself consumes two different suits.
  const X = load();
  const p = X.getPlayer('V');
  X.noteBoardTexture(p, 'bet', 'turn', B('9s', '9d', '7s', '2s'));
  t.eq('the paired flag saw the bet', p.boardTex.pair.b, 1);
  t.eq('the three-flush flag saw the same bet', p.boardTex.fl3.b, 1);
}

// --- The two rates use different denominators -------------------------------

{
  // Postflop, check/bet are only reachable when nobody has bet yet, and
  // call/fold/raise only when facing one. Mixing them would average two
  // unrelated situations.
  const r = T.boardTexRates({ b: 3, k: 7, c: 2, f: 6, r: 2 });
  t.eq('lead is bets over bet+check', Math.round(r.lead), 30);
  t.eq('and reports that denominator', r.leadN, 10);
  t.eq('fold-to-bet is folds over call+fold+raise', Math.round(r.foldToBet), 60);
  t.eq('and reports that denominator', r.facedN, 10);
  t.eq('raise-when-bet-into shares the faced denominator', Math.round(r.raiseWhenBet), 20);
}

{
  // Withhold rather than claim 0%: never having been given the chance is not
  // evidence that they never do it.
  const r = T.boardTexRates({ b: 0, k: 0, c: 4, f: 1, r: 0 });
  t.eq('no lead opportunity means no lead figure, not 0%', r.lead, null);
  t.ok('while the faced figure is still reported', r.foldToBet != null);

  const r2 = T.boardTexRates({ b: 2, k: 3, c: 0, f: 0, r: 0 });
  t.eq('never faced a bet means no fold figure, not 0%', r2.foldToBet, null);

  const r3 = T.boardTexRates(null);
  t.eq('a missing cell yields nothing', r3.lead, null);
  t.eq('and no counts', r3.leadN, 0);
}

// --- Pool baseline ----------------------------------------------------------

{
  const X = load();
  const a = X.getPlayer('A');
  const b = X.getPlayer('B');
  X.noteBoardTexture(a, 'bet', 'flop', B('As', '8d', '3c'));
  X.noteBoardTexture(b, 'check', 'flop', B('As', '8d', '3c'));
  X.noteBoardTexture(b, 'check', 'flop', B('Kh', '8d', '3c'));

  const pool = X.poolBoardTexture();
  t.eq('the pool sums bets across every tracked player', pool.dry.b, 1);
  t.eq('and checks', pool.dry.k, 2);
  t.eq('so the pool lead rate is over the combined sample',
    Math.round(X.boardTexRates(pool.dry).lead), 33);
}

// --- Backfill ---------------------------------------------------------------

{
  const X = load();
  X.getPlayer('V');
  X.STORE.hands = [{
    board: B('As', 'Ks', '7s', '2s', '9d'),
    actions: [
      { x: 'V', a: 'bet', s: 'flop' },
      { x: 'V', a: 'fold', s: 'river' },
      { x: 'V', a: 'call', s: 'preflop' }, // no board — must be ignored
    ],
  }];

  const seeded = X.backfillBoardTexture();
  t.eq('only the postflop actions are seeded', seeded, 2);
  t.eq('the flop bet landed on the flop texture', X.STORE.players.V.boardTex.fl3.b, 1);
  t.eq('the river fold landed on the river texture', X.STORE.players.V.boardTex.fl4.f, 1);

  // It ADDS to counters, so re-running would double-count every hand. The
  // store flag is what makes it safe, not the operation being idempotent.
  const again = X.backfillBoardTexture();
  t.eq('a second run does nothing', again, 0);
  t.eq('and does not double-count', X.STORE.players.V.boardTex.fl3.b, 1);
}

{
  // A player pruned since the hand was recorded has nothing to attribute to.
  const X = load();
  X.STORE.hands = [{ board: B('As', '8d', '3c'), actions: [{ x: 'GONE', a: 'bet', s: 'flop' }] }];
  const seeded = X.backfillBoardTexture();
  t.eq('an action by an untracked player is skipped', seeded, 0);
  t.eq('and no record is conjured for them', X.STORE.players.GONE, undefined);
}

// --- Context tokens ---------------------------------------------------------

{
  // A texture read must only surface on the texture it describes — "they fold
  // four-flush boards" is noise on a rainbow flop. Tags are generated from
  // BOARD_FLAGS, so a typo'd token (which entryRelevance would demote to -1
  // forever, silently) is structurally impossible.
  const X = load();
  const h = X.freshHandState();
  h.street = 'river';
  h.board = B('As', 'Ks', '7s', '2s', '9d');
  const ctx = X.handContextTokens(h);
  t.ok('the board texture is emitted as context', ctx.has('board:fl4'));
  t.ok('alongside the street', ctx.has('river'));
  t.ok('and postflop', ctx.has('postflop'));
  t.ok('a texture NOT on this board is absent', !ctx.has('board:dry'));

  t.eq('an entry tagged for this board is relevant',
    X.entryRelevance({ when: ['board:fl4'] }, ctx) > 0, true);
  t.eq('an entry tagged for another texture is demoted',
    X.entryRelevance({ when: ['board:dry'] }, ctx), -1);
}

{
  // The board is the board whether or not hero has been identified — the flag
  // must be emitted before handContextTokens' hero check bails out.
  const X = load();
  X.heroXid = null;
  const h = X.freshHandState();
  h.street = 'flop';
  h.board = B('9s', '9d', '2c');
  const ctx = X.handContextTokens(h);
  t.ok('texture is still emitted with hero unresolved', ctx.has('board:pair'));
  t.ok('while the hero-dependent tokens are correctly absent', !ctx.has('facing'));
}



// --- Narrow-screen layout ---------------------------------------------------
//
// Reported from a Galaxy Fold cover screen: the pool figures overlapped the
// stat labels to their left. Root cause was structural, not cosmetic — the
// Stats table is `table-layout: fixed` with .tph-stat-v pinned to 26% AND
// `white-space: nowrap`, so four figures crammed into that one cell could not
// wrap and spilled straight out of the column. Every other row puts a single
// figure there and the pool reference in the 44% note column (see statRow);
// this row now follows that same split.

{
  const css = T.CSS;
  t.ok('the value column is still fixed-width and nowrap (the constraint this must respect)',
    /\.tph-stat-v\s*\{[^}]*white-space:\s*nowrap/.test(css));
  t.ok('a wrap modifier exists for note cells carrying a phrase',
    /\.tph-stat-wrap\s*\{[^}]*white-space:\s*normal/.test(css));
  // Declared AFTER .tph-stat-n, or the override loses on equal specificity.
  t.ok('the wrap modifier is declared after .tph-stat-n so it wins',
    css.indexOf('.tph-stat-wrap') > css.indexOf('.tph-stat-n {'));
}

{
  // The real invariant: the value cell holds ONE figure per situation, not the
  // villain's and the pool's side by side. Anything that puts a pool reference
  // back into .tph-stat-v reintroduces the overflow.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
  const row = src.slice(src.indexOf('const rows = BOARD_FLAGS.map'),
    src.indexOf('}).filter(Boolean).join(\'\')'));
  t.ok('the board-texture block was located (guards a vacuous scan)', row.length > 200);
  const valueCell = row.slice(row.indexOf('tph-stat-v'), row.indexOf('tph-stat-n'));
  t.ok('the value cell carries only the villain figures, not the pool ones',
    !/\bpr\./.test(valueCell));
  t.ok('the pool figure lives in the note cell instead',
    /tph-stat-n[^]*\bpr\.|poolTxt/.test(row));
  t.ok('the note cell is marked wrappable', /tph-stat-n tph-stat-wrap/.test(row));
}

process.exit(t.report());
