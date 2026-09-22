// Stored-hand display and keeping (v1.79.0): the ★ favourite, hero's own
// cards on the History card, and the display helpers / board persistence the
// removed replayer (v1.17.0) introduced and History still relies on.
//
// The History tab's DOM isn't driven here — same boundary as every other
// render function (see name-boundary.test.js's header). What's tested is the
// data: what survives a trim or a merge, what the filter returns, and what
// formatHand / formatHandHtml print.

const { load, runner } = require('./harness');

const t = runner('hand-favorites');

// A LIVE hand object, the shape recordHandHistory takes (currentHand-like —
// dealtInXids, not players).
function hand(T, overrides) {
  const h = T.freshHandState();
  h.pot = 4000000;
  h.dealtInXids = new Set(['A', 'B', 'H']);
  h.actions = [];
  h.winners = [];
  return Object.assign(h, overrides);
}

// A STORED hand object, the shape replayStepsFor/replayStepEquity actually
// consume (players, not dealtInXids — that rename happens inside
// recordHandHistory, which these functions run entirely after).
function storedHand(overrides) {
  return Object.assign({
    t: Date.now(),
    g: null,
    street: 'preflop',
    pot: 4000000,
    players: ['A', 'B', 'H'],
    actions: [],
    winners: [],
    shown: {},
    heroCards: null,
    board: [],
    pinned: false,
  }, overrides);
}

// --- cardGlyph / cardsGlyphText: pure display helpers -----------------------

{
  const T = load();
  t.eq('a card renders rank + suit glyph', T.cardGlyph({ rank: 'A', suit: 's' }), 'A♠');
  t.eq('each suit maps to its own glyph', [
    T.cardGlyph({ rank: '9', suit: 'h' }),
    T.cardGlyph({ rank: 'T', suit: 'd' }),
    T.cardGlyph({ rank: '2', suit: 'c' }),
  ].join(' '), '9♥ T♦ 2♣');
  t.eq('a null card renders empty, not a throw', T.cardGlyph(null), '');
  t.eq('two cards join with a space',
    T.cardsGlyphText([{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }]), 'A♠ K♥');
  t.eq('an empty list renders empty', T.cardsGlyphText([]), '');
  t.eq('undefined renders empty, not a throw', T.cardsGlyphText(undefined), '');
}

// --- recordHandHistory: board is now persisted -------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const h = hand(T, {
    actions: [{ x: 'A', a: 'raise', amt: 2000000, s: 'preflop' }],
    board: [{ rank: 'A', suit: 'h' }, { rank: '7', suit: 'd' }, { rank: '2', suit: 'c' }],
  });
  T.recordHandHistory(h);
  t.eq('the stored record carries the board', JSON.stringify(T.STORE.hands[0].board), JSON.stringify(h.board));
}

{
  const T = load();
  T.STORE = T.emptyStore();
  // Simulates a hand recorded before v1.17.0: no board property at all on the
  // stored object, distinct from a genuinely empty (preflop-only) hand.
  const h = hand(T, { actions: [{ x: 'A', a: 'fold', amt: 0, s: 'preflop' }], board: undefined });
  T.recordHandHistory(h);
  t.eq('an absent board records as an empty array, not undefined', JSON.stringify(T.STORE.hands[0].board), '[]');
}

// --- trimHandHistory: a starred hand is never evicted -------------------------

function many(n, extra) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(storedHand(Object.assign({ t: 1e6 - i, g: 'g' + i }, extra ? extra(i) : {})));
  return out;
}

{
  const T = load();
  // Newest-first; the OLDEST hand is starred, which is exactly the one a
  // recency cap would evict first.
  const hands = many(10, (i) => (i === 9 ? { fav: true } : {}));
  const kept = T.trimHandHistory(hands, 3, 500);
  t.ok('the oldest hand survives a trim because it is starred', kept.some((h) => h.g === 'g9'));
  t.eq('and does not use up a place under the limit', kept.filter((h) => !h.fav).length, 3);
  t.eq('order stays newest-first', kept.map((h) => h.g).join(','), 'g0,g1,g2,g9');
}

{
  const T = load();
  // Pinned ceiling: starred hands ride past it too, and are not counted in it.
  const hands = many(10, (i) => (i >= 8 ? { fav: true } : { pinned: true }));
  const kept = T.trimHandHistory(hands, 1, 4);
  t.eq('the pinned ceiling bounds the unstarred hands only', kept.filter((h) => !h.fav).length, 4);
  t.eq('both starred hands survive the ceiling', kept.filter((h) => h.fav).length, 2);
}

{
  const T = load();
  // Unchanged behaviour with no stars — the pinned ceiling still slices the
  // newest `ceiling` hands.
  const hands = many(10, (i) => (i % 2 ? { pinned: true } : {}));
  const kept = T.trimHandHistory(hands, 2, 3);
  t.eq('with no stars the ceiling still keeps the newest three', kept.map((h) => h.g).join(','), 'g0,g1,g2');
}

// --- mergeHands: a star from either side survives --------------------------

{
  const T = load();
  const local = [storedHand({ t: 5, g: 'X' })];
  const remote = [storedHand({ t: 5, g: 'X', fav: true })];
  const merged = T.mergeHands(local, remote, 200);
  t.eq('one hand, not two', merged.length, 1);
  t.eq('the remote star carries onto the kept local copy', merged[0].fav, true);
  t.eq('the caller\'s local object is not mutated', local[0].fav, undefined);
  const back = T.mergeHands(remote, [storedHand({ t: 5, g: 'X' })], 200);
  t.eq('a local star survives an unstarred remote copy', back[0].fav, true);
}

// --- toggleHandFavorite: toggles, marks the shard, respects the cap --------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hands = many(3);
  T.dirtyHands = false;
  t.eq('starring returns true', T.toggleHandFavorite(T.STORE.hands[1]), true);
  t.eq('the record is starred in place', T.STORE.hands[1].fav, true);
  t.eq('the hands shard is marked dirty so the star is written', T.dirtyHands, true);
  t.eq('the count sees it', T.favoriteHandCount(), 1);
  t.eq('tapping again unstars', T.toggleHandFavorite(T.STORE.hands[1]), true);
  t.eq('unstarred leaves no field behind', 'fav' in T.STORE.hands[1], false);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hands = many(T.FAVORITE_HANDS_MAX + 1, (i) => (i < T.FAVORITE_HANDS_MAX ? { fav: true } : {}));
  const last = T.STORE.hands[T.FAVORITE_HANDS_MAX];
  t.eq('starring past the cap is refused', T.toggleHandFavorite(last), false);
  t.eq('and leaves the hand unstarred', !!last.fav, false);
  t.eq('unstarring at the cap still works', T.toggleHandFavorite(T.STORE.hands[0]), true);
}

// --- filterHandsFor: the Saved mode ----------------------------------------

{
  const T = load();
  t.ok('Saved is one of the History modes', !!T.HISTORY_FILTERS.saved);
  const hands = [
    // A starred hand with no aggression and V only folding: Played, Notable
    // and the aggression exclusion would all drop it. Saved must not.
    storedHand({ g: 'a', fav: true, actions: [{ x: 'V', a: 'fold', amt: 0, s: 'preflop' }] }),
    storedHand({ g: 'b', actions: [{ x: 'V', a: 'raise', amt: 5, s: 'preflop' }] }),
  ];
  const saved = T.filterHandsFor(hands, 'V', 'saved', {});
  t.eq('Saved returns only the starred hand, whatever else the filters think of it',
    saved.map((h) => h.g).join(','), 'a');
  t.eq('Played still drops that same hand', T.filterHandsFor(hands, 'V', 'played', {}).some((h) => h.g === 'a'), false);
}

// --- hero's cards on the History card ---------------------------------------
//
// The reported bug: hero bet three streets to a showdown, the opponent's reveal
// printed and hero's cards did not, because h.shown is never filled for hero by
// the seat poll. Shape taken from the screenshot.

const Q9 = [{ rank: 'Q', suit: 's' }, { rank: '9', suit: 's' }];
const AK = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }];

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  T.STORE.players.H = T.emptyPlayer('H', 'Wonkawee');
  T.STORE.players.S = T.emptyPlayer('S', 'Sylaar');
  const h = storedHand({
    street: 'river',
    players: ['H', 'S'],
    actions: [
      { x: 'S', a: 'check', amt: 0, s: 'river' },
      { x: 'H', a: 'bet', amt: 80, s: 'river' },
      { x: 'S', a: 'call', amt: 80, s: 'river' },
    ],
    shown: { S: 'Q♠ 9♠' },
    winners: [{ xid: 'H', amount: 320 }],
    heroCards: AK,
  });
  const text = T.formatHand(h, 'H');
  const html = T.formatHandHtml(h, 'H');
  t.ok('hero\'s cards print among the showdown lines (text)', text.includes('showdown: Wonkawee shows A♠ K♠'));
  t.ok('and in the History card markup', html.includes('Wonkawee shows A♠ K♠'));
  t.ok('the opponent reveal is still there', text.includes('Sylaar shows Q♠ 9♠'));
  t.ok('not ALSO as a separate your-cards line', !text.includes('your cards'));

  // Log reveal already named hero: print once, not twice.
  const logged = Object.assign({}, h, { shown: { S: 'Q♠ 9♠', H: 'A♠ K♠' } });
  t.eq('a hand whose log reveal named hero prints hero once',
    T.formatHand(logged, 'H').split('A♠ K♠').length - 1, 1);

  // Folded: a plain line, never a claim that hero showed.
  const folded = Object.assign({}, h, {
    actions: [{ x: 'H', a: 'fold', amt: 0, s: 'flop' }],
  });
  const ft = T.formatHand(folded, 'H');
  t.ok('a folded hero gets a "your cards" line', ft.includes('your cards: A♠ K♠'));
  t.ok('and is not listed as showing', !ft.includes('Wonkawee shows'));

  // Won uncontested (no reveals): the line, not a showdown.
  const noSd = Object.assign({}, h, { shown: {} });
  t.ok('no showdown -> "your cards" line', T.formatHand(noSd, 'H').includes('your cards: A♠ K♠'));
  t.ok('and the HTML card agrees', T.formatHandHtml(noSd, 'H').includes('your cards: <b>A♠ K♠</b>'));

  // Not captured: nothing, rather than a guess.
  t.eq('no captured cards -> nothing added', T.heroCardsPlacement(Object.assign({}, h, { heroCards: null })), null);

  // Hero identity unknown: still show them, as a plain line.
  T.heroXid = null;
  t.eq('unresolved hero still gets the plain line', T.heroCardsPlacement(h).where, 'line');
}

// --- star marker in both renderings ------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const h = storedHand({ fav: true, actions: [{ x: 'A', a: 'raise', amt: 5, s: 'preflop' }] });
  t.ok('the text rendering marks a starred hand', T.formatHand(h).split('\n')[0].includes('★'));
  t.ok('and so does the card', T.formatHandHtml(h).includes('★'));
  t.ok('an unstarred hand carries no star', !T.formatHand(storedHand({ actions: h.actions })).includes('★'));
}

process.exit(t.report());
