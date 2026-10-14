// v1.102.0: 4-bet+ and fold to flop c-bet in a 3-bet+ pot. Driven through the
// real handleLogLine with Torn's confirmed wording, read back through the real
// computeRates. Names resolve to "name:<username>" pseudo-ids (no seats here).

const { load, runner } = require('./harness');

const t = runner('four-bet-fcb3');

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = 0;
  return T;
}
const feed = (T, lines) => lines.forEach((l) => T.handleLogLine(l));
const R = (T, name) => T.computeRates(T.STORE.players['name:' + name]);
const P = (T, name) => T.STORE.players['name:' + name];
const blinds = ['Alice posted small blind $1,250,000', 'Bob posted big blind $2,500,000'];

// --- a 3-bet pot: the opener folds to the 3-bettor's flop c-bet ---------------
{
  const T = fresh();
  feed(T, ['Game a1a1a1 started', ...blinds,
    'Carol raised $5,000,000 to $7,500,000',
    'Alice folded',
    'Bob raised $15,000,000 to $22,500,000',
    'Carol called $15,000,000',
    'The flop:  5♣, 7♦, A♦',
    'Bob bet $20,000,000',
    'Carol folded',
    'Game b2b2b2 started']);
  t.eq('the opener faced a flop c-bet in a 3-bet pot', R(T, 'Carol').foldToCbet3Opp, 1);
  t.eq('...and folded it', R(T, 'Carol').foldToCbet3, 100);
  t.eq('the c-bettor has no spot of their own', R(T, 'Bob').foldToCbet3Opp, 0);
  t.eq('the opener faced a 3-bet: one 4-bet spot', R(T, 'Carol').fourBetOpp, 1);
  t.eq('...and did not 4-bet', R(T, 'Carol').fourBet, 0);
  t.eq('the 3-bettor never faced a re-raise', R(T, 'Bob').fourBetOpp, 0);
}

// --- a single-raised pot does not count toward the 3-bet-pot stat -------------
{
  const T = fresh();
  feed(T, ['Game c3c3c3 started', ...blinds,
    'Carol raised $5,000,000 to $7,500,000',
    'Alice folded',
    'Bob called $5,000,000',
    'The flop:  5♣, 7♦, A♦',
    'Bob checked',
    'Carol bet $10,000,000',
    'Bob folded',
    'Game d4d4d4 started']);
  t.eq('a single-raised flop c-bet is not a 3-bet-pot spot', R(T, 'Bob').foldToCbet3Opp, 0);
  t.eq('...but still counts toward ordinary fold to c-bet', P(T, 'Bob').foldToCbetMade, 1);
  t.eq('no re-raise, no 4-bet spot for anyone', R(T, 'Bob').fourBetOpp, 0);
}

// --- the turn of a 3-bet pot is not the flop --------------------------------
{
  const T = fresh();
  feed(T, ['Game e5e5e5 started', ...blinds,
    'Carol raised $5,000,000 to $7,500,000',
    'Alice folded',
    'Bob raised $15,000,000 to $22,500,000',
    'Carol called $15,000,000',
    'The flop:  5♣, 7♦, A♦',
    'Bob bet $20,000,000',
    'Carol called $20,000,000',
    'The turn:  2♠',
    'Bob bet $40,000,000',
    'Carol folded',
    'Game f6f6f6 started']);
  t.eq('called the flop: one spot, no fold', R(T, 'Carol').foldToCbet3, 0);
  t.eq('...the turn fold does not add a spot', R(T, 'Carol').foldToCbet3Opp, 1);
}

// --- 4-bet and 5-bet: once per player per hand ------------------------------
{
  const T = fresh();
  feed(T, ['Game 0a0a0a started', ...blinds,
    'Carol raised $5,000,000 to $7,500,000',
    'Alice folded',
    'Bob raised $15,000,000 to $22,500,000',
    'Carol raised $37,500,000 to $60,000,000',   // 4-bet
    'Bob raised $90,000,000 to $150,000,000',    // 5-bet
    'Carol raised $100,000,000 to $250,000,000', // 6-bet
    'Bob called $100,000,000',
    'Game 1b1b1b started']);
  t.eq('the opener: one spot, however long the war', R(T, 'Carol').fourBetOpp, 1);
  t.eq('...and one make', P(T, 'Carol').fourBet.m, 1);
  t.eq('the 3-bettor faced the 4-bet: one spot', R(T, 'Bob').fourBetOpp, 1);
  t.eq('...and 5-bet it, which counts as 4-bet+', R(T, 'Bob').fourBet, 100);
  t.eq('the folded small blind faced nothing', R(T, 'Alice').fourBetOpp, 0);
}

// --- a cold 4-bettor never reads more makes than spots ----------------------
{
  const T = fresh();
  feed(T, ['Game 2c2c2c started', ...blinds,
    'Carol raised $5,000,000 to $7,500,000',
    'Dave raised $15,000,000 to $22,500,000',
    'Erin raised $37,500,000 to $60,000,000',  // Erin first seen here
    'Alice folded',
    'Bob folded',
    'Carol folded',
    'Dave folded',
    'Game 3d3d3d started']);
  t.eq('a first-seen cold 4-bettor still has the spot', R(T, 'Erin').fourBetOpp, 1);
  t.eq('...at 100%, not over it', R(T, 'Erin').fourBet, 100);
}

// --- sparse: an untouched record carries neither field ----------------------
{
  const T = fresh();
  const p = T.emptyPlayer('x', 'X');
  t.ok('a fresh record has no fourBet field', !('fourBet' in p));
  t.ok('...nor fcb3', !('fcb3' in p));
  const r = T.computeRates(p);
  t.eq('...and both rates read as absent, not 0%', [r.fourBet, r.foldToCbet3].join(), [null, null].join());
}

// --- the Stats tab renders both rows ----------------------------------------
{
  const T = fresh();
  const p = Object.assign(T.getPlayer('x'), { hands: 50, fourBet: { m: 2, o: 5 }, fcb3: { m: 6, o: 9 } });
  const body = { innerHTML: '', querySelectorAll: () => [] };
  const panel = { querySelectorAll: () => [], querySelector: () => body };
  T.renderPlayerPanelBody(panel, p, T.computeRates(p), T.computeShrunkRates(p), false);
  t.ok('4-Bet+ row: 40%, 5 spots, low', /4-Bet\+[\s\S]*?40%[\s\S]*?5 spots, low/.test(body.innerHTML));
  t.ok('Fold v CB 3B+ row: 67%, 9 spots', /Fold v CB 3B\+[\s\S]*?67%[\s\S]*?9 spots</.test(body.innerHTML));
}

process.exit(t.report());
