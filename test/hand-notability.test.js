// Per-player hand notability and the History tab filters — see
// handNotability / filterHandsFor / HISTORY_FILTERS in the userscript.
//
// Reported: "I don't want it to show all hands because that includes hands
// they fold too without any calling or raising ... I want it to highlight
// hands that are interesting or out of blue, like big pots, or highlight
// interesting 3bets or reraise."
//
// The distinction this file exists to protect: isNotableHand asks whether the
// HAND was big (for the storage pin); handNotability asks whether THIS PLAYER
// did anything interesting in it. A huge pot two other players fought over is
// notable for the table and worthless as a read on the seat you are looking
// at, and conflating the two would put every big hand in every player's list.

const { load, runner } = require('./harness');
const fs = require('fs');

const t = runner('hand-notability');

// Minimal stored-hand shape: recordHandHistory persists {t,g,street,pot,
// players,actions,winners,shown,heroCards,board,bb,pinned} and handNotability
// reads only actions/pot/bb/shown/winners.
const hand = (o) => Object.assign({
  t: Date.now(), pot: 1000, bb: 0, players: ['V', 'X'], actions: [],
  winners: [], shown: {}, board: [],
}, o);
const act = (x, a, s, amt) => ({ x, a, s, amt: amt || 0 });

// --- voluntary: the filter the report actually asked for ------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  const folded = hand({ actions: [act('V', 'fold', 'preflop')] });
  t.eq('folding preflop is not voluntary', T.handNotability(folded, 'V', {}).voluntary, false);
  t.eq('but it does count as having acted', T.handNotability(folded, 'V', {}).acted, true);

  // Posting a blind and folding is the exact case named in the report — money
  // went in, but not by choice, so it must not read as playing the hand.
  const blinded = hand({ actions: [act('V', 'post', 'preflop', 50), act('V', 'fold', 'preflop')] });
  t.eq('posting a blind then folding is NOT voluntary', T.handNotability(blinded, 'V', {}).voluntary, false);

  // Checking is declining to invest. A big blind who checks and then folds the
  // flop chose nothing either.
  const checked = hand({ actions: [act('V', 'post', 'preflop', 50), act('V', 'check', 'preflop'), act('V', 'fold', 'flop')] });
  t.eq('checking is not voluntary investment', T.handNotability(checked, 'V', {}).voluntary, false);

  ['call', 'bet', 'raise'].forEach((a) => {
    const h = hand({ actions: [act('V', a, 'preflop', 100)] });
    t.eq(`${a} IS voluntary`, T.handNotability(h, 'V', {}).voluntary, true);
  });

  // Somebody else's aggression is not this player's involvement.
  const other = hand({ actions: [act('X', 'raise', 'preflop', 300), act('V', 'fold', 'preflop')] });
  t.eq('another player raising does not make it voluntary for V',
    T.handNotability(other, 'V', {}).voluntary, false);
  t.eq('a player who never appears in the hand has not acted',
    T.handNotability(other, 'GHOST', {}).acted, false);
}

// --- preflop raise tiers ---------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const keys = (h, x) => T.handNotability(h, x, {}).tags.map((g) => g.key);
  const labels = (h, x) => T.handNotability(h, x, {}).tags.map((g) => g.label);

  const open = hand({ actions: [act('V', 'raise', 'preflop', 300)] });
  t.eq('an opening raise is not tagged — most raises are opens', keys(open, 'V').indexOf('3B'), -1);
  t.eq('and not a 4-bet either', keys(open, 'V').indexOf('4B'), -1);

  const threeBet = hand({ actions: [act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900)] });
  t.ok('the second preflop raiser is tagged 3B', keys(threeBet, 'V').indexOf('3B') !== -1);
  t.eq('and the opener is not', keys(threeBet, 'X').indexOf('3B'), -1);

  const fourBet = hand({
    actions: [act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900), act('X', 'raise', 'preflop', 2700)],
  });
  t.ok('the third preflop raiser is tagged 4B', keys(fourBet, 'X').indexOf('4B') !== -1);
  t.ok('and X, who also opened, shows the HIGHER tier not the first one',
    labels(fourBet, 'X').indexOf('4B') !== -1);

  // THE OFF-BY-ONE. The Nth raise of a street is an (N+1)-bet, because the
  // blind is the first bet: open = 1st raise, 3-bet = 2nd, 4-bet = 3rd,
  // 5-bet = 4th. An earlier draft labelled the 4th raise "4B" and the
  // assertion here was written to match the code rather than to match poker,
  // so both agreed and both were wrong. These now check the arithmetic, not
  // the implementation.
  t.eq('the 2nd preflop raise is labelled 3B', labels(threeBet, 'V')[0], '3B');
  t.eq('the 3rd preflop raise is labelled 4B', labels(fourBet, 'X')[0], '4B');

  const fiveBet = hand({
    actions: [act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900),
      act('X', 'raise', 'preflop', 2700), act('V', 'raise', 'preflop', 8000)],
  });
  t.eq('the 4th preflop raise is labelled 5B, not 4B', labels(fiveBet, 'V')[0], '5B');
  t.ok('but keeps the 4B CSS class, so the rule set stays finite',
    keys(fiveBet, 'V').indexOf('4B') !== -1);

  const sixBet = hand({
    actions: [act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900),
      act('X', 'raise', 'preflop', 2700), act('V', 'raise', 'preflop', 8000),
      act('X', 'raise', 'preflop', 20000)],
  });
  t.eq('and the 5th is 6B', labels(sixBet, 'X')[0], '6B');
}

// --- postflop aggression: check-raise beats plain raise, exclusively -------

{
  const T = load();
  T.STORE = T.emptyStore();
  const keys = (h, x) => T.handNotability(h, x, {}).tags.map((g) => g.key);

  const rr = hand({ actions: [act('V', 'raise', 'flop', 500)] });
  t.ok('a postflop raise is tagged RR', keys(rr, 'V').indexOf('RR') !== -1);

  const xr = hand({ actions: [act('V', 'check', 'flop'), act('V', 'raise', 'flop', 500)] });
  t.ok('checking then raising the same street is tagged XR', keys(xr, 'V').indexOf('XR') !== -1);
  t.eq('and NOT also RR — the two are exclusive, not stacked', keys(xr, 'V').indexOf('RR'), -1);

  // A check on the flop and a raise on the TURN is not a check-raise.
  const notXr = hand({ actions: [act('V', 'check', 'flop'), act('V', 'raise', 'turn', 500)] });
  t.eq('a check on one street and a raise on the next is not a check-raise',
    keys(notXr, 'V').indexOf('XR'), -1);
  t.ok('it is still a postflop raise', keys(notXr, 'V').indexOf('RR') !== -1);

  // Raising and THEN checking (impossible in one street, but the data could
  // say so) must not read as a check-raise — order is what makes it one.
  const raiseThenCheck = hand({ actions: [act('V', 'raise', 'flop', 500), act('V', 'check', 'flop')] });
  t.eq('raise-then-check is not a check-raise', keys(raiseThenCheck, 'V').indexOf('XR'), -1);

  // Preflop raises must not leak into the postflop tags.
  const preOnly = hand({ actions: [act('V', 'raise', 'preflop', 300)] });
  t.eq('a preflop raise is not tagged RR', keys(preOnly, 'V').indexOf('RR'), -1);
}

// --- big pots: by blind level when known, by median when not ---------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const keys = (h, x, ctx) => T.handNotability(h, x, ctx).tags.map((g) => g.key);

  // With a stored blind level the threshold is absolute and needs no context.
  const bb = 1000;
  const bigByBB = hand({ bb, pot: bb * (T.BIG_POT_BB + 5), actions: [act('V', 'call', 'preflop', 100)] });
  t.ok(`a pot over ${T.BIG_POT_BB}bb is BIG on its own blind level`,
    keys(bigByBB, 'V', {}).indexOf('BIG') !== -1);
  const smallByBB = hand({ bb, pot: bb * 5, actions: [act('V', 'call', 'preflop', 100)] });
  t.eq('a small pot is not', keys(smallByBB, 'V', {}).indexOf('BIG'), -1);

  // A hand recorded before v1.35.0 has bb: 0 and falls back to the median of
  // whatever is on screen. Unknown must never be treated as small OR as big.
  const noBB = hand({ bb: 0, pot: 10000, actions: [act('V', 'call', 'preflop', 100)] });
  t.ok('with no blind level, a pot far above the median is BIG',
    keys(noBB, 'V', { medianPot: 1000 }).indexOf('BIG') !== -1);
  t.eq('and one near the median is not',
    keys(noBB, 'V', { medianPot: 9000 }).indexOf('BIG'), -1);
  t.eq('with no blind level AND no median context, it cannot claim big',
    keys(noBB, 'V', {}).indexOf('BIG'), -1);

  // An implausible blind (the BB-display-mode hazard) must not be trusted into
  // an absolute threshold — it falls through to the median path instead.
  const badBB = hand({ bb: 0.5, pot: 10000, actions: [act('V', 'call', 'preflop', 100)] });
  t.ok('an implausible blind falls back to the median rather than being believed',
    keys(badBB, 'V', { medianPot: 1000 }).indexOf('BIG') !== -1);
}

// --- showdown and won ------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const n = (h, x) => T.handNotability(h, x, {});

  const sd = hand({ shown: { V: 'AhKh' }, actions: [act('V', 'call', 'preflop', 100)] });
  t.ok('showing cards is tagged SD', n(sd, 'V').tags.map((g) => g.key).indexOf('SD') !== -1);
  t.ok('and SD alone clears the notable bar — it is the only direct range evidence',
    n(sd, 'V').notable);
  t.eq('another player showing does not tag this one',
    n(sd, 'X').tags.map((g) => g.key).indexOf('SD'), -1);

  const won = hand({ winners: [{ xid: 'V', amount: 5000 }], actions: [act('V', 'call', 'preflop', 100)] });
  t.ok('winning is tagged WON', n(won, 'V').tags.map((g) => g.key).indexOf('WON') !== -1);
  // Deliberate: winning a pot nobody contested is most hands, not a read.
  t.eq('but WON alone does NOT clear the notable bar', n(won, 'V').notable, false);
}

// --- filterHandsFor: the three modes ---------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();

  const hands = [
    hand({ actions: [act('V', 'fold', 'preflop')] }),                                  // not played
    hand({ actions: [act('V', 'post', 'preflop', 50), act('V', 'fold', 'preflop')] }), // not played
    hand({ actions: [act('V', 'call', 'preflop', 100)] }),                             // played, not notable
    hand({ actions: [act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900)] }), // 3B
  ];

  t.eq('All returns everything', T.filterHandsFor(hands, 'V', 'all', {}).length, 4);
  t.eq('Played drops the two folds', T.filterHandsFor(hands, 'V', 'played', {}).length, 2);
  t.eq('Notable keeps only the 3-bet', T.filterHandsFor(hands, 'V', 'notable', {}).length, 1);

  // Notable is a subset of Played: a hand cannot be interesting for a player
  // who never voluntarily put money in it.
  const played = T.filterHandsFor(hands, 'V', 'played', {});
  const notable = T.filterHandsFor(hands, 'V', 'notable', {});
  notable.forEach((h) => {
    t.ok('every notable hand is also a played hand', played.indexOf(h) !== -1);
  });

  t.eq('an unknown mode is treated as Played rather than showing nothing',
    T.filterHandsFor(hands, 'V', 'nonsense', {}).length, 2);
}

// --- the tag keys all have CSS, and nothing emits an undeclared one --------
//
// This is the assertion that earns test/no-orphans.test.js's exemption for the
// `tph-hh-tag-` prefix. The class is built as `tph-hh-tag-${key}`, so a key
// with no rule renders an unstyled grey chip and throws nothing — invisible
// exactly the way CLAUDE.md records for a typo'd coach relevance token. Same
// split BOARD_FLAGS already uses: generated tags, covered by their own test.

{
  const T = load();
  const src = fs.readFileSync(require('./harness').SCRIPT_PATH, 'utf8');

  t.ok('there are tag keys to check at all', T.HAND_TAG_KEYS.length >= 5);
  T.HAND_TAG_KEYS.forEach((key) => {
    t.ok(`.tph-hh-tag-${key} has a CSS rule`,
      new RegExp(`\\.tph-hh-tag-${key}\\b`).test(src));
  });

  // And the reverse: drive every branch and confirm nothing emits a key that
  // isn't declared. A new tag added without extending HAND_TAG_KEYS would slip
  // past the loop above, which only checks what the constant already lists.
  T.STORE = T.emptyStore();
  const everything = hand({
    bb: 1000,
    pot: 1000 * (T.BIG_POT_BB + 5),
    actions: [
      act('X', 'raise', 'preflop', 300), act('V', 'raise', 'preflop', 900),
      act('V', 'check', 'flop'), act('V', 'raise', 'flop', 2000),
    ],
    shown: { V: 'AhKh' },
    winners: [{ xid: 'V', amount: 50000 }],
  });
  const emitted = T.handNotability(everything, 'V', {}).tags.map((g) => g.key);
  t.ok(`a hand hitting every branch emits several tags (${emitted.join(',')})`, emitted.length >= 4);
  emitted.forEach((k) => {
    t.ok(`emitted key ${k} is declared in HAND_TAG_KEYS`, T.HAND_TAG_KEYS.indexOf(k) !== -1);
  });

  // Every tag carries a title — it is the only place the marker is explained,
  // and an unexplained two-letter chip is noise.
  T.handNotability(everything, 'V', {}).tags.forEach((g) => {
    t.ok(`tag ${g.key} carries an explanatory title`, !!g.title && g.title.length > 5);
    t.ok(`tag ${g.key} carries a label`, !!g.label);
  });
}

// --- HISTORY_FILTERS is complete and self-describing -----------------------

{
  const T = load();
  const keys = Object.keys(T.HISTORY_FILTERS);
  t.ok('all three filter modes exist',
    keys.indexOf('all') !== -1 && keys.indexOf('played') !== -1 && keys.indexOf('notable') !== -1);
  keys.forEach((k) => {
    t.ok(`${k} has a button label`, !!T.HISTORY_FILTERS[k].label);
    // The chips are two words at most; the title is where the rule is stated,
    // and without it "Played" is a guess about what got hidden.
    t.ok(`${k} explains itself in a title`, !!T.HISTORY_FILTERS[k].title
      && T.HISTORY_FILTERS[k].title.length > 20);
  });
}

process.exit(t.report());
