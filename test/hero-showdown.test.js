// Hero's own showdowns are banked from hero's cards, won or lost (v1.103.0).
//
// Before this, hero's showdown record came only from the log's reveal line,
// which on this layout named hero only in pots hero LOST (29 of 29 in a real
// backup). W$SD read 1% over 856 showdowns for a winning player, and the leak
// plan told them to fold more rivers. The seat poll never reads hero, so
// nothing else could fill the gap.

const { load, runner } = require('./harness');

const t = runner('hero-showdown');

const HERO = '311421';
const VILLAIN = '4390971';

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = HERO;
  return T;
}

// A two-player hand to the river. `heroWins` decides the winner line; the
// villain's cards are revealed (the seat poll does that for opponents).
function riverHand(T, heroWins, extra) {
  const h = T.freshHandState();
  h.dealtInXids = new Set([HERO, VILLAIN]);
  h.contributions = { [HERO]: 10, [VILLAIN]: 10 };
  h.pot = 20;
  h.actions = [
    { x: HERO, a: 'bet', amt: 10, s: 'river' },
    { x: VILLAIN, a: 'call', amt: 10, s: 'river' },
  ];
  h.winners = [{ xid: heroWins ? HERO : VILLAIN, amount: 20 }];
  h.heroCards = [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }];
  h.shownCards[VILLAIN] = [{ rank: '9', suit: 'h' }, { rank: '7', suit: 'c' }];
  h.shown[VILLAIN] = '9♥ 7♣';
  return Object.assign(h, extra || {});
}

const heroSd = (T) => {
  const sh = (T.STORE.players[HERO] || {}).shownHands || {};
  return Object.keys(sh).reduce((acc, k) => ({
    seen: acc.seen + (sh[k].seen || 0), won: acc.won + (sh[k].won || 0),
  }), { seen: 0, won: 0 });
};

// --- A won showdown is banked — the case that was missing ------------------
{
  const T = fresh();
  T.applyHandResults(riverHand(T, true));
  t.eq('won showdown is seen', heroSd(T).seen, 1);
  t.eq('and scored as a win', heroSd(T).won, 1);
  t.eq('hero gets the WTSD', T.STORE.players[HERO].wtsd, 1);
  t.ok('as AKs', !!T.STORE.players[HERO].shownHands.AKs);
}

// --- A lost one is banked the same way --------------------------------------
{
  const T = fresh();
  T.applyHandResults(riverHand(T, false));
  t.eq('lost showdown is seen', heroSd(T).seen, 1);
  t.eq('and scored as a loss', heroSd(T).won, 0);
}

// --- Over a mixed run, W$SD is the real win rate ---------------------------
{
  const T = fresh();
  for (let i = 0; i < 10; i++) T.applyHandResults(riverHand(T, i < 6));
  t.near('six of ten won reads 60%', T.computeRates(T.STORE.players[HERO]).wsd, 60);
}

// --- Not a showdown: hero folded, or nobody else revealed ------------------
{
  const T = fresh();
  const h = riverHand(T, false);
  h.actions.push({ x: HERO, a: 'fold', amt: 0, s: 'river' });
  T.applyHandResults(h);
  t.eq('a fold is not a showdown', heroSd(T).seen, 0);
  t.eq('and earns no WTSD', (T.STORE.players[HERO] || {}).wtsd || 0, 0);
}
{
  const T = fresh();
  const h = riverHand(T, true);
  h.shownCards = {};
  h.shown = {};
  T.applyHandResults(h);
  t.eq('an uncontested win is not a showdown', heroSd(T).seen, 0);
}

// --- The log reveal and this path cannot both count ------------------------
{
  const T = fresh();
  const h = riverHand(T, false);
  h.shownCards[HERO] = h.heroCards;           // the log named hero this time
  h.shown[HERO] = 'A♠ K♠';
  h.countedShowdown.add(HERO);
  T.STORE.players[HERO] = T.STORE.players[HERO] || T.emptyPlayer(HERO);
  T.STORE.players[HERO].wtsd = 1;             // ...and counted it
  T.applyHandResults(h);
  t.eq('banked once', heroSd(T).seen, 1);
  t.eq('WTSD counted once', T.STORE.players[HERO].wtsd, 1);
}

// --- Unresolved hero banks nothing -----------------------------------------
{
  const T = fresh();
  T.heroXid = 'name:Wonkawee';
  T.applyHandResults(riverHand(T, true));
  t.ok('a pseudo-id gets no showdown', !T.STORE.players['name:Wonkawee']
    || !Object.keys(T.STORE.players['name:Wonkawee'].shownHands || {}).length);
}

// --- History placement and banking share one rule --------------------------
{
  const T = fresh();
  const h = { shown: { [VILLAIN]: '9♥ 7♣' }, actions: [], heroCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }] };
  t.ok('reachedShowdown: someone else revealed, hero still in', T.reachedShowdown(h, HERO));
  t.eq('History prints hero among the reveals', T.heroCardsPlacement(h).where, 'showdown');
  h.actions.push({ x: HERO, a: 'fold', s: 'turn' });
  t.ok('folded: no showdown', !T.reachedShowdown(h, HERO));
  t.eq('and History agrees', T.heroCardsPlacement(h).where, 'line');
  t.ok('a player\'s own reveal alone is not a showdown', !T.reachedShowdown({ shown: { [HERO]: 'x' } }, HERO));
}

// --- The one-off repair of the biased record --------------------------------
{
  const T = fresh();
  const p = T.emptyPlayer(HERO);
  p.hands = 11781;
  p.wtsd = 862;
  p.shownHands = { AKo: { seen: 856, raised: 300, won: 12 } };
  p.sdRecent = ['0AKo'];
  p.texture.bluffBets = 27;
  T.STORE.players[HERO] = p;
  T.STORE.hero.xid = HERO;
  const opp = T.emptyPlayer(VILLAIN);
  opp.hands = 1654; opp.wtsd = 181; opp.shownHands = { AKo: { seen: 10, raised: 8, won: 5 } };
  T.STORE.players[VILLAIN] = opp;

  t.ok('repair runs', T.repairHeroShowdowns());
  const r = T.computeRates(T.STORE.players[HERO]);
  t.eq('hero showdowns cleared', r.wsdSample, 0);
  t.eq('W$SD withheld rather than 1%', r.wsd, null);
  t.eq('WTSD withheld until hands accrue', r.wtsd, null);
  t.eq('recent window cleared', T.STORE.players[HERO].sdRecent.length, 0);
  t.eq('texture cleared', T.STORE.players[HERO].texture.bluffBets, 0);
  t.eq('other stats kept', T.STORE.players[HERO].hands, 11781);
  t.eq('opponents untouched', T.STORE.players[VILLAIN].shownHands.AKo.seen, 10);
  t.near('opponent WTSD unchanged', T.computeRates(T.STORE.players[VILLAIN]).wtsd, (100 * 181) / 1654);
  t.ok('and runs once only', !T.repairHeroShowdowns());

  // WTSD after the restart is over the hands since it, not over a lifetime.
  T.STORE.players[HERO].hands += 40;
  T.STORE.players[HERO].wtsd = 10;
  const r2 = T.computeRates(T.STORE.players[HERO]);
  t.near('WTSD over hands since the restart', r2.wtsd, 25);
  t.eq('its sample is those hands', r2.wtsdSample, 40);
  // The "reaches showdown only" leak must not fire off a lifetime gate.
  T.STORE.players[HERO].hands = 11781 + 5;
  T.STORE.players[HERO].wtsd = 0;
  const leaks = T.buildLeakPlan(T.STORE.players[HERO]);
  t.ok('no WTSD read off 5 hands', !leaks.some((e) => e.tag === 'Showdown'));
}

process.exit(t.report());
