// Stakes ladder, session-window reads, tilt detection and showdown ranges.

const { load, runner } = require('./harness');

const t = runner('reads');
const T = load();
T.STORE = T.emptyStore();

// --- Stakes ladder ----------------------------------------------------------

t.eq('a known level names its table', T.tableNameForBB(2500000), "Cat's Chance");
t.eq('another known level', T.tableNameForBB(1000000), 'River Wizard');
t.eq('an unknown level names nothing', T.tableNameForBB(1234), null);
// $5,000,000 was missing from the ladder entirely until v0.43.0.
t.eq('the $5M level is now on the ladder', T.tableNameForBB(5000000), 'Juan on Juan');

t.eq('tiny stakes are Nano', T.stakeTierForBB(100), 'Nano');
t.eq('mid stakes top out below 1M', T.stakeTierForBB(500000), 'Mid');
// River Wizard (1M) and Cat's Chance (2.5M) — the two tables seen on this
// device — are both High.
t.eq('River Wizard is High', T.stakeTierForBB(1000000), 'High');
t.eq("Cat's Chance is High", T.stakeTierForBB(2500000), 'High');
t.eq('the top of the ladder is Elite', T.stakeTierForBB(100000000), 'Elite');
t.eq('no blind, no tier', T.stakeTierForBB(0), null);

// Every ladder entry must be a real number, or tableLabel prints nonsense.
Object.keys(T.TORN_STAKES).forEach((k) => {
  t.ok(`${k} is a plausible blind`, T.plausibleBB(Number(k)));
});

t.ok('a known table reads well', T.tableLabel(2500000).includes("Cat's Chance"));
t.ok('an unknown level says so rather than guessing', T.tableLabel(1234).includes('Unknown table'));

// --- The BB display-mode guard ---------------------------------------------

// Torn can render amounts as "181.00 BB" instead of "$181,000,000". Every
// figure then parses six orders of magnitude too small, and nothing looks
// broken — the numbers are just tiny. Refusing an implausible blind is what
// stops a whole session of wrong P/L being written.
t.eq('a real blind is accepted', T.plausibleBB(2500000), true);
t.eq('the smallest real stake is accepted', T.plausibleBB(T.MIN_PLAUSIBLE_BB), true);
t.eq('a display-mode "3" is refused', T.plausibleBB(3), false);
t.eq('zero is refused', T.plausibleBB(0), false);
t.eq('a non-number is refused', T.plausibleBB('2500000'), false);
t.eq('Infinity is refused', T.plausibleBB(Infinity), false);
t.eq('an implausible blind produces no table label', T.tableLabel(3), null);

// --- Recent-hands window ----------------------------------------------------

{
  const p = T.emptyPlayer('x', 'Test');
  // 0 = folded, 1 = played, 2 = played and raised.
  [0, 0, 1, 2, 1, 0, 2, 2, 0, 1].forEach((c) => T.pushRecent(p, c));

  const s = T.sessionRates(p, 10);
  t.eq('window length', s.hands, 10);
  t.eq('session VPIP counts played and raised', s.vpip, 60);
  t.eq('session PFR counts only raised', s.pfr, 30);

  // Reading a shorter window takes the NEWEST hands, which is the point.
  const recent4 = T.sessionRates(p, 4);
  t.eq('a short window reads the newest hands', recent4.hands, 4);
  t.eq('and reflects only those', recent4.vpip, 75);

  // Asking for more than exists returns what exists, not padding.
  t.eq('an over-long window is not padded', T.sessionRates(p, 50).hands, 10);
}

{
  // The stored window is capped so the store cannot grow without bound.
  const p = T.emptyPlayer('y', 'Test');
  for (let i = 0; i < T.RECENT_MAX * 3; i++) T.pushRecent(p, i % 3);
  t.eq('the window is capped', p.recent.length, T.RECENT_MAX);
}

t.eq('no history means no session read', T.sessionRates(T.emptyPlayer('z', 'Z'), 15), null);

// --- Tilt: behavioural, not financial --------------------------------------

function tiltPlayer(lifetimeHands, lifetimeVpipPct, recentCodes) {
  const p = T.emptyPlayer('t', 'Tilter');
  p.hands = lifetimeHands;
  p.vpip = Math.round((lifetimeVpipPct / 100) * lifetimeHands);
  recentCodes.forEach((c) => T.pushRecent(p, c));
  return p;
}

const played = (n) => Array(n).fill(1);
const folded = (n) => Array(n).fill(0);

{
  // A nit who has suddenly opened up: lifetime 20% VPIP, last 15 all played.
  const p = tiltPlayer(200, 20, played(15));
  const read = T.tiltRead(p);
  t.ok('a nit playing every hand is flagged', !!read);
  t.ok('the jump is large', read.jump > T.TILT_VPIP_JUMP);
  t.ok('the baseline excludes the recent window', read.baseline < 25);
}

{
  // A station who has always played 70% is NOT tilting — that is just who they
  // are. Flagging them would make the marker meaningless.
  const p = tiltPlayer(200, 70, played(11).concat(folded(4)));
  t.eq('a permanent station is not flagged', T.tiltRead(p), null);
}

{
  // Someone playing their normal game.
  const p = tiltPlayer(200, 50, played(7).concat(folded(8)));
  t.eq('normal play is not flagged', T.tiltRead(p), null);
}

{
  // Not enough lifetime hands to have a baseline to deviate FROM.
  const p = tiltPlayer(12, 20, played(15));
  t.eq('no baseline, no tilt read', T.tiltRead(p), null);
}

{
  // Not enough recent hands for the window to mean anything.
  const p = tiltPlayer(200, 20, played(4));
  t.eq('too thin a window, no tilt read', T.tiltRead(p), null);
}

// --- Showdown ranges --------------------------------------------------------

const cards = (s) => T.parseCardsFromText(s);

t.eq('a pair', T.handClassFromCards(cards('[9♥, 9♠]')), '99');
t.eq('suited, high card first', T.handClassFromCards(cards('[K♦, A♦]')), 'AKs');
t.eq('offsuit', T.handClassFromCards(cards('[A♣, K♦]')), 'AKo');
t.eq('order does not matter', T.handClassFromCards(cards('[7♠, 9♥]')), '97o');
t.eq('ten parses', T.handClassFromCards(cards('[10♠, J♠]')), 'JTs');
t.eq('one card is not a hand', T.handClassFromCards(cards('[A♣]')), null);
t.eq('nothing is not a hand', T.handClassFromCards([]), null);

// Torn appends its own description of the made hand; it must not be parsed as
// more cards.
t.eq('the hand description is ignored',
  T.handClassFromCards(cards('[9♥, 7♠] (Two Pairs: Nines and Sevens)')), '97o');

// --- Card parsing must never invent a hand ---------------------------------
//
// The old pattern had no word boundaries and ran case-insensitively, so it read
// letters INSIDE ordinary words as cards: "9 of hearts, 7 of spades" came out
// as "ATo". A confidently wrong holding is worse than no holding, and Torn's
// own hand descriptions are full of these traps.
[
  '(Two Pairs: Aces and Eights)',
  '(Pair: Aces)',
  '(Straight to the Ace)',
  '(Full House: Aces over Kings)',
  'spades and clubs',
  'Alice called $2,500,000',
].forEach((prose) => {
  t.eq(`no cards invented from "${prose.slice(0, 28)}"`, cards(prose).length, 0);
});

// Both shapes Torn uses. Spelled-out names come from aria-labels, which
// readLogRows appends — the only way a reveal renders when the cards are drawn
// as elements rather than text.
t.eq('glyph form', T.handClassFromCards(cards('[9♥, 7♠]')), '97o');
t.eq('spelled-out form', T.handClassFromCards(cards('9 of hearts, 7 of spades')), '97o');
t.eq('spelled-out with rank words', T.handClassFromCards(cards('ace of spades king of clubs')), 'AKo');
t.eq('spelled-out ten', T.handClassFromCards(cards('ten of spades jack of spades')), 'JTs');
// Description first, cards after — the order aria-labels arrive in.
t.eq('cards found after a description',
  T.handClassFromCards(cards('(Two Pairs: Aces and Eights) 9 of hearts 7 of spades')), '97o');

// Every reveal verb Torn might use. A missed one costs a showdown silently:
// the line still parses as something, it just carries no cards.
['reveals', 'revealed', 'shows', 'showed', 'turns over', 'flips over'].forEach((verb) => {
  const line = `Bob ${verb} [9♥, 7♠]`;
  const pat = T.LOG_PATTERNS.find((p) => p.re.test(T.cleanLogLine(line)));
  t.eq(`"${verb}" is a showdown`, pat && pat.type, 'shows');
  const m = pat ? pat.re.exec(T.cleanLogLine(line)) : null;
  t.eq(`"${verb}" yields the hand`, T.handClassFromCards(cards(m ? m[2] : '')), '97o');
});

// The board still reads, since the same parser serves it.
t.eq('a three-card flop still parses', cards('The flop:  5♣, 7♦, A♦').length, 3);

{
  const R = load();
  R.STORE = R.emptyStore();
  const hand = (raised, won) => ({
    countedPfr: new Set(raised ? ['v'] : []),
    winners: won ? [{ xid: 'v', amount: 100 }] : [],
  });

  R.noteShowdown('v', cards('[A♣, K♦]'), hand(true, true));
  R.noteShowdown('v', cards('[A♠, K♥]'), hand(true, false));
  R.noteShowdown('v', cards('[7♠, 2♦]'), hand(false, false));

  const p = R.STORE.players.v;
  t.eq('the same class merges across showdowns', p.shownHands.AKo.seen, 2);
  t.eq('wins are counted', p.shownHands.AKo.won, 1);
  t.eq('raised showdowns are counted', p.shownHands.AKo.raised, 2);
  t.eq('a called showdown is stored separately', p.shownHands['72o'].seen, 1);
  t.eq('and not counted as raised', p.shownHands['72o'].raised, 0);

  // Splitting by preflop action is the point: "what they raise with" and "what
  // they call with" are different ranges and averaging them describes neither.
  t.eq('the raising range holds only raised hands', R.shownRange(p, 'raised').length, 1);
  t.eq('and names the right one', R.shownRange(p, 'raised')[0].cls, 'AKo');
  t.eq('the calling range holds the rest', R.shownRange(p, 'called')[0].cls, '72o');
  t.eq('everything appears in the combined view', R.shownRange(p, 'all').length, 2);

  // Most-shown first, so the top of the list is the strongest evidence.
  t.eq('sorted by how often it was shown', R.shownRange(p, 'all')[0].cls, 'AKo');

  const html = R.buildRangeHtml(p);
  t.ok('the range renders', html.includes('AKo'));
  t.ok('it splits by preflop action', html.includes('Raised preflop'));
  t.ok('it says showdowns are a floor, not the whole range', html.includes('floor on their range'));
  t.ok('a thin sample says so', html.includes('thin sample'));
}

t.ok('no showdowns explains itself rather than showing an empty box',
  T.buildRangeHtml(T.emptyPlayer('n', 'New')).includes('No showdowns yet'));

process.exit(t.report());
