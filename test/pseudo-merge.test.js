// Folding `name:` pseudo-records into the real record (v1.115.0).
//
// A pseudo-record is minted when a log line's name matches no seat. For an
// opponent it holds actions counted nowhere else, and mostly hands too (in a
// real backup the real id was dealt into the same hand for only 21% of
// pseudo hands), so the two are SUMMED, not picked between. 431 of 1,666
// records in that backup were pseudo-ids.

const fs = require('fs');
const path = require('path');
const { load, runner } = require('./harness');

const t = runner('pseudo-merge');
const src = fs.readFileSync(path.join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');

// Every player field has a stated merge rule. A field nobody classified would
// fall through silently, so a new one must fail here until it gets a rule.
{
  const T = load();
  const M = T.PSEUDO_MERGE;
  const named = new Set([].concat(M.add, M.window, M.latest, M.manual, M.real));
  const fields = new Set(Object.keys(T.emptyPlayer('1', 'x')));
  // Sparse counters, added on first use rather than in emptyPlayer.
  (src.match(/bumpSparse\([a-zA-Z.]+, '([a-zA-Z0-9]+)'/g) || [])
    .forEach((m) => fields.add(m.match(/'([a-zA-Z0-9]+)'/)[1]));
  ['barrel', 'sdRecent', 'tag', 'sdSince', 'betSizePctSum'].forEach((f) => fields.add(f));
  t.ok('the field scan found the sparse counters (else it proves nothing)', fields.has('fcb3') && fields.has('fourBet'));
  const missing = Array.from(fields).filter((f) => !named.has(f));
  t.eq('every player field has a merge rule', missing.join(','), '');
}

function rec(T, xid, over) {
  return Object.assign(T.emptyPlayer(xid, over && over.name), over || {});
}

// The fold itself, through the runtime path: the seat names a player who
// already has both records.
{
  const T = load();
  T.STORE = T.emptyStore();
  const real = rec(T, '777', {
    name: 'Rukinos', hands: 100, vpip: 30, pfr: 18, plChipsEst: -50, lastSeen: 2000,
    tables: { 2500000: 60, 10000000: 40 }, betSizes: Array(38).fill(75), notes: 'mine',
    shownHands: { AA: { seen: 2, raised: 2, won: 1 } }, barrel: { o: 4, m: 2 },
    stack: { now: 5 }, factionId: 9,
  });
  real.streetActions.flop.bet = 10;
  const pseudo = rec(T, 'name:Rukinos', {
    name: '#name:Rukinos', hands: 20, vpip: 9, pfr: 6, plChipsEst: -10, lastSeen: 3000,
    tables: { 10000000: 20 }, betSizes: [300, 333, 400], notes: 'theirs', tag: 'bluff',
    shownHands: { AA: { seen: 1, raised: 1, won: 0, r3: 1 }, '88': { seen: 2, raised: 0, won: 0 } },
    barrel: { o: 1, fo: 2 }, fcb3: { m: 1, o: 2 }, stack: { now: 1 }, factionId: 0,
  });
  pseudo.streetActions.flop.bet = 3;
  T.STORE.players = { 777: real, 'name:Rukinos': pseudo };

  T.mergePseudoPlayer('777', 'Rukinos');
  const p = T.STORE.players['777'];
  t.ok('the pseudo-record is gone', !T.STORE.players['name:Rukinos']);
  t.eq('hands are summed', p.hands, 120);
  t.eq('so are actions', `${p.vpip}/${p.pfr}`, '39/24');
  t.eq('and P/L', p.plChipsEst, -60);
  t.eq('nested counters by key', JSON.stringify(p.tables), JSON.stringify({ 2500000: 60, 10000000: 60 }));
  t.eq('per-street counts', p.streetActions.flop.bet, 13);
  t.eq('showdowns per class', `${p.shownHands.AA.seen}/${p.shownHands.AA.won}/${p.shownHands.AA.r3}/${p.shownHands['88'].seen}`, '3/1/1/2');
  t.eq('sparse counters, including ones only the pseudo had', JSON.stringify([p.barrel, p.fcb3]),
    JSON.stringify([{ o: 5, m: 2, fo: 2 }, { m: 1, o: 2 }]));
  t.eq('a window stays at its cap', p.betSizes.length, 40);
  t.eq('the newer record\'s entries survive the cap', p.betSizes.slice(-3).join(','), '300,333,400');
  t.eq('last seen is the later', p.lastSeen, 3000);
  t.eq('the real name is kept, not the placeholder', p.name, 'Rukinos');
  t.eq('your note on the real record wins', p.notes, 'mine');
  t.eq('a tag only the pseudo had comes across', p.tag, 'bluff');
  t.eq('live state stays the real record\'s', p.stack.now, 5);
  t.eq('identity stays the real record\'s', p.factionId, 9);
}

// Hero's ghost is never merged: its hands double what the seat path counted.
{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = '311421';
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.players = { 311421: rec(T, '311421', { name: 'Wonkawee', hands: 50 }), 'name:Wonkawee': rec(T, 'name:Wonkawee', { hands: 40 }) };
  T.mergePseudoPlayer('311421', 'Wonkawee');
  t.eq('hero\'s record is untouched', T.STORE.players['311421'].hands, 50);
}

// The one-off over an existing store.
{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.hero.xid = '311421';
  T.STORE.settings.heroName = 'Wonkawee';
  T.STORE.players = {
    1: rec(T, '1', { name: 'Ann', hands: 10, vpip: 2 }),
    'name:Ann': rec(T, 'name:Ann', { hands: 5, vpip: 3 }),
    2: rec(T, '2', { name: 'Dup', hands: 1 }), 3: rec(T, '3', { name: 'Dup', hands: 1 }),
    'name:Dup': rec(T, 'name:Dup', { hands: 4 }),
    'name:Ghost': rec(T, 'name:Ghost', { hands: 2 }),
    311421: rec(T, '311421', { name: 'Wonkawee', hands: 50 }),
    'name:Wonkawee': rec(T, 'name:Wonkawee', { hands: 40 }),
  };
  const hand = {
    t: 1, g: 'g1', players: ['1', 'name:Ann', '9'], board: [],
    actions: [{ x: 'name:Ann', a: 'raise', amt: 5, s: 'preflop' }, { x: '9', a: 'fold', amt: 0, s: 'preflop' }],
    winners: [{ xid: 'name:Ann', amount: 10 }], shown: { 'name:Ann': 'A♠ A♦' }, shownVia: { 'name:Ann': 'seat' },
  };
  const untouched = { t: 2, g: 'g2', players: ['9'], actions: [], winners: [], shown: {}, board: [] };
  T.STORE.hands = [hand, untouched];
  const res = T.mergeExistingPseudoRecords();
  t.eq('one name with exactly one real record is merged', res.players, 1);
  t.eq('into it', `${T.STORE.players['1'].hands}/${T.STORE.players['1'].vpip}`, '15/5');
  t.ok('a name two records share is left alone', !!T.STORE.players['name:Dup']);
  t.ok('a name with no real record is left alone', !!T.STORE.players['name:Ghost']);
  t.ok('hero\'s ghost is left for dropStaleHeroGhost', !!T.STORE.players['name:Wonkawee']);
  const h = T.STORE.hands[0];
  t.eq('stored hands are re-keyed', JSON.stringify([h.players, h.actions[0].x, h.winners[0].xid, Object.keys(h.shown)]),
    JSON.stringify([['1', '9'], '1', '1', ['1']]));
  t.ok('as a new object, so the saved copy is rewritten', h !== hand);
  t.ok('a hand with no pseudo-id is the same object', T.STORE.hands[1] === untouched);
  t.eq('runs once', T.mergeExistingPseudoRecords(), null);
}

process.exit(t.report());
