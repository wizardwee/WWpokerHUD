// Watching a table is not playing at it (v1.118.0).
//
// Reported with a screenshot: History printed "Wonkawee shows A♠ K♠" in a
// hand the user was not seated in - the winner's cards. readHeroCards fell
// back to every face-up card on the page when there was no seat of yours,
// so a showdown on someone else's seat read as hero's hand; settlement then
// banked it as hero's showdown (v1.103.0's rule needs only "someone else
// revealed and hero never folded", which a hand hero never sat in meets).

const { load, runner } = require('./harness');

const t = runner('spectated-hand');

const HERO = '311421';
const A = '1000001';
const B = '1000002';
const AK = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }];

function cardEl(label, owner) {
  return {
    tagName: 'DIV', className: 'x',
    getAttribute: (k) => (k === 'aria-label' ? label : null),
    closest: () => owner || null,
  };
}

// --- readHeroCards: no seat of yours, no cards ------------------------------
{
  const T = load();
  const doc = T._sandbox.document;
  const villainSeat = { id: 'player-' + A };
  const revealed = [cardEl('Ace of spades', villainSeat), cardEl('King of spades', villainSeat)];
  doc.querySelector = () => null;               // no self_ seat: watching
  doc.querySelectorAll = () => revealed;
  t.eq('watching: a revealed opponent hand is not yours', T.readHeroCards().length, 0);

  // Seated, cards rendered outside your seat: the fallback still finds them,
  // but never ones inside another player's seat.
  const mySeat = { id: 'player-' + HERO, querySelectorAll: () => [] };
  doc.querySelector = () => mySeat;
  doc.querySelectorAll = () => revealed.concat([cardEl('9 of hearts', null), cardEl('7 of clubs', mySeat)]);
  const cards = T.readHeroCards();
  t.eq('seated fallback reads only cards outside other seats', cards.length, 2);
  t.eq('and they are yours', T.handClassFromCards(cards), '97o');
}

// A three-way pot hero watched: two opponents dealt in, both reveal.
function watchedHand(T) {
  const h = T.freshHandState();
  h.dealtInXids = new Set([A, B]);
  h.contributions = { [A]: 10, [B]: 10 };
  h.pot = 20;
  h.actions = [
    { x: A, a: 'bet', amt: 10, s: 'river' },
    { x: B, a: 'call', amt: 10, s: 'river' },
  ];
  h.winners = [{ xid: A, amount: 20 }];
  h.heroCards = AK;                             // what the old read produced
  h.shownCards[A] = AK; h.shown[A] = 'A♠ K♠';
  h.shownCards[B] = [{ rank: 'A', suit: 'c' }, { rank: '5', suit: 'c' }]; h.shown[B] = 'A♣ 5♣';
  return h;
}

// --- Settlement banks nothing for hero, and History stores no hero cards ----
{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = HERO;
  T.STORE.players[HERO] = T.emptyPlayer(HERO);
  const h = watchedHand(T);
  T.applyHandResults(h);
  T.recordHandHistory(h);
  const p = T.STORE.players[HERO];
  t.eq('no hero showdown banked', Object.keys(p.shownHands || {}).length, 0);
  t.eq('no hero WTSD', p.wtsd || 0, 0);
  t.eq('stored without hero cards', T.STORE.hands[0].heroCards, null);
  t.eq('History prints no hero line', T.heroCardsPlacement(T.STORE.hands[0]), null);
}

// --- An old record still carrying them is not printed -----------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = HERO;
  const old = { players: [A, B], actions: [{ x: A, a: 'bet', s: 'river' }], shown: { [A]: 'A♠ K♠' }, heroCards: AK };
  t.eq('watched hand: no "you show" line', T.heroCardsPlacement(old), null);
  t.eq('played hand still prints', T.heroCardsPlacement({ ...old, players: [A, B, HERO] }).where, 'showdown');
}

// --- The one-off repair -----------------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = HERO;
  T.STORE.hero.xid = HERO;
  const p = T.emptyPlayer(HERO);
  p.hands = 500;
  p.wtsd = 9;                                    // 1 real + 8 from watching
  p.shownHands = { AKs: { seen: 9, raised: 0, won: 8 } };
  p.sdRecent = ['0AKs'];
  T.STORE.players[HERO] = p;
  const watched = (i) => ({
    t: 1000 + i, players: [A, B], actions: [{ x: A, a: 'bet', s: 'river' }, { x: B, a: 'call', s: 'river' }],
    winners: [{ xid: A, amount: 20 }], shown: { [A]: 'A♠ K♠', [B]: 'A♣ 5♣' }, heroCards: AK, board: [],
  });
  const played = {
    t: 5000, players: [HERO, B],
    actions: [{ x: HERO, a: 'raise', s: 'preflop', amt: 3 }, { x: B, a: 'call', s: 'preflop', amt: 3 },
      { x: HERO, a: 'bet', s: 'river' }, { x: B, a: 'call', s: 'river' }],
    winners: [{ xid: B, amount: 20 }], shown: { [B]: 'Q♥ Q♦' },
    heroCards: [{ rank: 'J', suit: 'h' }, { rank: 'J', suit: 'd' }], board: [],
  };
  const folded = { t: 6000, players: [HERO, B], actions: [{ x: HERO, a: 'fold', s: 'preflop' }], winners: [{ xid: B, amount: 3 }], shown: {}, heroCards: AK, board: [] };
  T.STORE.hands = [folded, played].concat(Array.from({ length: 8 }, (_, i) => watched(i)));
  const r = T.repairSpectatedHeroCards();
  t.eq('eight watched hands found', r.hands, 8);
  t.ok('their cards removed', T.STORE.hands.slice(2).every((h) => h.heroCards === null));
  t.ok('played hands keep theirs', T.STORE.hands[0].heroCards && T.STORE.hands[1].heroCards);
  t.eq('hero showdowns rebuilt from played hands only', p.wtsd, 1);
  t.eq('as the real hand', Object.keys(p.shownHands).join(), 'JJ');
  t.eq('a loss', p.shownHands.JJ.won, 0);
  t.eq('raised preflop', p.shownHands.JJ.raised, 1);
  t.eq('recent window rebuilt', p.sdRecent.join(), '1JJ');
  t.eq('WTSD reads over the stored hands hero was dealt', p.hands - p.sdSince, 2);
  t.eq('runs once', T.repairSpectatedHeroCards(), null);
}

// --- Clean store: untouched --------------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hero.xid = HERO;
  const p = T.emptyPlayer(HERO);
  p.wtsd = 5; p.shownHands = { AKs: { seen: 5, raised: 0, won: 3 } };
  T.STORE.players[HERO] = p;
  T.STORE.hands = [{ t: 1, players: [HERO], actions: [], shown: {}, heroCards: AK }];
  t.eq('nothing found', T.repairSpectatedHeroCards().hands, 0);
  t.eq('hero record left alone', p.wtsd, 5);
}

process.exit(t.report());
