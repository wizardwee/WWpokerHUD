// v1.82.0 reads: turn barrels, won at showdown, table softness, P/L by stake.
//
// Everything here is driven through the real exported functions. The barrel
// stat is one pure function over a hand's action list (barrelEventsFor), used
// both live at settlement and for the one-time backfill, so most of its
// behaviour is pinned directly on action lists shaped like stored hands.

const { load, runner } = require('./harness');

const t = runner('new-reads');

const A = (x, a, s, amt) => ({ x, a, s, amt: amt || 0 });
// P raises preflop, bets the flop, V calls. The turn is supplied per case.
const base = [
  A('V', 'call', 'preflop', 1), A('P', 'raise', 'preflop', 3), A('V', 'call', 'preflop', 2),
  A('V', 'check', 'flop'), A('P', 'bet', 'flop', 5), A('V', 'call', 'flop', 5),
];
const withTurn = (...turn) => base.concat(turn);

// --- barrelEventsFor ----------------------------------------------------------

{
  const T = load();
  const barrel = T.barrelEventsFor(withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'fold', 'turn')));
  t.eq('the flop c-bettor who bets the turn made a barrel', barrel && barrel.made, true);
  t.eq('it is credited to the preflop raiser', barrel.xid, 'P');
  t.eq('the flop caller faced it and folded', JSON.stringify(barrel.facers), JSON.stringify([{ xid: 'V', folded: true }]));

  const called = T.barrelEventsFor(withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'call', 'turn', 10)));
  t.eq('a call of the barrel is faced, not folded', called.facers[0].folded, false);

  const gaveUp = T.barrelEventsFor(withTurn(A('V', 'check', 'turn'), A('P', 'check', 'turn')));
  t.eq('checking the turn is an opportunity not taken', gaveUp && gaveUp.made, false);
  t.eq('and nobody faced a barrel', gaveUp.facers.length, 0);

  // Raising the lead is aggression, but not a barrel: they were facing a bet,
  // not choosing to fire again. (A call would be rejected anyway, so the raise
  // is the case that actually exercises the "led into" check.)
  t.eq('a lead into them on the turn is NOT a barrel spot, even if they raise it',
    T.barrelEventsFor(withTurn(A('V', 'bet', 'turn', 10), A('P', 'raise', 'turn', 30))), null);

  const raised = base.slice(0, 5).concat([A('V', 'raise', 'flop', 15), A('P', 'call', 'flop', 10),
    A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10)]);
  t.eq('a raised flop c-bet is not a barrel spot', T.barrelEventsFor(raised), null);

  const donk = [A('P', 'raise', 'preflop', 3), A('V', 'call', 'preflop', 2),
    A('V', 'bet', 'flop', 5), A('P', 'call', 'flop', 5), A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10)];
  t.eq('no spot when someone else bet the flop first', T.barrelEventsFor(donk), null);

  const limped = [A('V', 'call', 'preflop', 1), A('P', 'check', 'preflop'),
    A('P', 'bet', 'flop', 2), A('V', 'call', 'flop', 2), A('V', 'check', 'turn'), A('P', 'bet', 'turn', 4)];
  t.eq('no preflop raiser, no barrel spot', T.barrelEventsFor(limped), null);

  t.eq('no turn played, no spot', T.barrelEventsFor(base.concat([])), null);
  t.eq('an empty action list is not a throw', T.barrelEventsFor(undefined), null);

  // Three-way: W check-raises the barrel before V acts. V then faces more than
  // the barrel, so V is not counted as facing it.
  const threeWay = [A('P', 'raise', 'preflop', 3), A('V', 'call', 'preflop', 2), A('W', 'call', 'preflop', 2),
    A('P', 'bet', 'flop', 5), A('V', 'call', 'flop', 5), A('W', 'call', 'flop', 5),
    A('P', 'bet', 'turn', 10), A('W', 'raise', 'turn', 30), A('V', 'fold', 'turn')];
  const tw = T.barrelEventsFor(threeWay);
  t.eq('with a raise between, only the raiser counts as facing the barrel',
    JSON.stringify(tw.facers), JSON.stringify([{ xid: 'W', folded: false }]));

  // An all-in turn bet from the c-bettor counts as a barrel (open finding #3).
  t.eq('an all-in turn bet counts as a barrel',
    T.barrelEventsFor(withTurn(A('V', 'check', 'turn'), A('P', 'all-in', 'turn', 50))).made, true);
}

// --- noteBarrels: sparse storage, and computeRates reads it -------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  t.eq('a fresh record carries no barrel field (sparse)', 'barrel' in T.emptyPlayer('Z', 'z'), false);
  const hands = [
    withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'fold', 'turn')),
    withTurn(A('V', 'check', 'turn'), A('P', 'check', 'turn')),
    withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'call', 'turn', 10)),
  ];
  hands.forEach((acts) => T.noteBarrels(acts, (x) => T.getPlayer(x)));
  const rp = T.computeRates(T.STORE.players.P);
  const rv = T.computeRates(T.STORE.players.V);
  t.eq('barrel rate = bets / opportunities', Math.round(rp.barrel), 67);
  t.eq('with the opportunity count alongside', rp.barrelOpp, 3);
  t.eq('fold to barrel = folds / barrels faced', rv.foldToBarrel, 50);
  t.eq('faced count', rv.foldToBarrelOpp, 2);
  t.eq('a player never in a spot reads null, not 0', T.computeRates(T.emptyPlayer('Q', 'q')).barrel, null);
}

// --- Live: counted at settlement ----------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = null;
  const h = T.freshHandState();
  h.dealtInXids = new Set(['P', 'V']);
  h.actions = withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'fold', 'turn'));
  h.winners = [{ xid: 'P', amount: 20 }];
  h.pot = 20;
  T.applyHandResults(h);
  t.eq('a settled hand records the barrel', (T.STORE.players.P && T.STORE.players.P.barrel || {}).m, 1);
  t.eq('and the fold to it', (T.STORE.players.V && T.STORE.players.V.barrel || {}).fm, 1);
}

// --- backfillBarrels: once, from stored history --------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.P = T.emptyPlayer('P', 'p');
  T.STORE.players.V = T.emptyPlayer('V', 'v');
  T.STORE.hands = [
    { t: 2, actions: withTurn(A('V', 'check', 'turn'), A('P', 'bet', 'turn', 10), A('V', 'fold', 'turn')) },
    { t: 1, actions: withTurn(A('V', 'check', 'turn'), A('P', 'check', 'turn')) },
    // A player pruned since: skipped, not recreated.
    { t: 0, actions: [A('X', 'raise', 'preflop', 3), A('P', 'call', 'preflop', 2), A('X', 'bet', 'flop', 5),
      A('P', 'call', 'flop', 5), A('P', 'check', 'turn'), A('X', 'bet', 'turn', 9)] },
  ];
  t.eq('backfill finds the three spots', T.backfillBarrels(), 3);
  t.eq('seeding the opportunities', T.STORE.players.P.barrel.o, 2);
  t.eq('a pruned player is not recreated', T.STORE.players.X, undefined);
  t.eq('the flag is set', T.STORE.barrelBackfilled, true);
  t.eq('a second run adds nothing', T.backfillBarrels(), 0);
  t.eq('and does not double-count', T.STORE.players.P.barrel.o, 2);
}

// --- Won at showdown ------------------------------------------------------------

{
  const T = load();
  const p = T.emptyPlayer('S', 's');
  t.eq('no showdowns seen reads null', T.computeRates(p).wsd, null);
  p.shownHands = { AA: { seen: 3, raised: 3, won: 3 }, '72o': { seen: 7, raised: 0, won: 1 } };
  const r = T.computeRates(p);
  t.eq('won / seen across every hand class', r.wsd, 40);
  t.eq('sample is the showdowns seen', r.wsdSample, 10);
}

// --- Exploit reads: fire on the sample, replace the approximate turn read ------

function playerWith(T, fields) {
  const p = T.emptyPlayer('E', 'e');
  p.hands = 200;
  return Object.assign(p, fields);
}
const tags = (plan) => plan.map((e) => e.tag + ':' + e.short);

{
  const T = load();
  T.STORE = T.emptyStore();
  // Per-street aggression that ALSO triggers the old approximate "collapses
  // on the turn" read, so the test can see which of the two fires.
  const streets = { flop: { bet: 8, raise: 0, call: 2, check: 0, fold: 0 },
    turn: { bet: 1, raise: 0, call: 6, check: 3, fold: 2 }, river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 } };
  const thin = playerWith(T, { streetActions: JSON.parse(JSON.stringify(streets)), barrel: { m: 1, o: 4 } });
  t.ok('under the sample, the old turn read still fires',
    tags(T.buildExploitPlan(thin)).includes('Turn:float, stab turn')
    && T.buildExploitPlan(thin).find((e) => e.tag === 'Turn').text.startsWith('Aggression collapses'));

  const read = playerWith(T, { streetActions: JSON.parse(JSON.stringify(streets)), barrel: { m: 2, o: 12 } });
  const turns = T.buildExploitPlan(read).filter((e) => e.tag === 'Turn');
  t.eq('with the sample, exactly one turn read fires', turns.length, 1);
  t.ok('and it is the exact barrel read', /bets the turn again only 17%/.test(turns[0].text));
  t.ok('the leak voice says it about you',
    /you bet the turn again only 17%/i.test(T.buildLeakPlan(read).find((e) => e.tag === 'Turn').text));

  const folder = playerWith(T, { barrel: { fm: 7, fo: 10 } });
  t.ok('folds to 70% of barrels fires "bet the turn again"', tags(T.buildExploitPlan(folder)).includes('Barrel:bet the turn again'));
  const sticky = playerWith(T, { barrel: { fm: 1, fo: 10 } });
  t.ok('folds to 10% fires "no turn bluffs"', tags(T.buildExploitPlan(sticky)).includes('Barrel:no turn bluffs'));
  const thinFold = playerWith(T, { barrel: { fm: 5, fo: 5 } });
  t.ok('under FOLD_BARREL_MIN nothing fires', !T.buildExploitPlan(thinFold).some((e) => e.tag === 'Barrel'));

  const loser = playerWith(T, { shownHands: { '72o': { seen: 10, raised: 0, won: 3 } } });
  t.ok('W$SD 30% over 10 seen fires the value read',
    tags(T.buildExploitPlan(loser)).includes('Won SD:value bet thinner'));
  const winner = playerWith(T, { shownHands: { AA: { seen: 10, raised: 10, won: 8 } } });
  t.ok('W$SD 80% fires the respect read', tags(T.buildExploitPlan(winner)).includes('Won SD:respect river bets'));
  const few = playerWith(T, { shownHands: { AA: { seen: 4, raised: 4, won: 4 } } });
  t.ok('under 10 seen, nothing fires', !T.buildExploitPlan(few).some((e) => e.tag === 'Won SD'));
}

// --- Table softness -------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const min = T.STORE.settings.minHands;
  // Shape real rates so classify lands where each case needs it.
  const mk = (xid, vpip, pfr) => {
    const p = T.emptyPlayer(xid, xid);
    p.hands = 400; p.vpip = Math.round(4 * vpip); p.pfr = Math.round(4 * pfr);
    T.STORE.players[xid] = p;
    return T.classify(p);
  };
  const fish = ['f1', 'f2', 'f3'].map((x) => mk(x, 80, 3));
  t.ok('test setup: these classify as a soft type', fish.every((l) => l === 'Fish' || l === 'Station'));
  const nit = mk('n1', 8, 1);
  t.eq('test setup: this classifies as Nit', nit, 'Nit');

  const soft = T.tableSoftness(['f1', 'f2', 'f3', 'n1']);
  t.eq('3 soft of 4 rated is soft', soft.verdict, 'soft');
  t.eq('rated count', soft.rated, 4);
  t.ok('average VPIP is reported', soft.avgVpip != null);

  ['n2', 'n3', 'n4', 'n5'].forEach((x) => mk(x, 8, 1));
  t.eq('no soft players among 4 rated is tough', T.tableSoftness(['n1', 'n2', 'n3', 'n4']).verdict, 'tough');
  t.eq('1 soft of 3 rated is mixed', T.tableSoftness(['f1', 'n1', 'n2']).verdict, 'mixed');

  const p = T.emptyPlayer('new', 'new'); p.hands = min - 1; T.STORE.players.new = p;
  const withNew = T.tableSoftness(['f1', 'n1', 'new', 'unknown']);
  t.eq('under minHands and unknown seats count as new, not rated', withNew.fresh, 2);
  t.eq('fewer than SOFT_MIN_RATED rated gives no verdict', withNew.verdict, null);
  t.eq('and SOFT_MIN_RATED is 3', T.SOFT_MIN_RATED, 3);

  // The rendered line, as the coach panel shows it.
  const line = T.tableSoftnessHtml(['f1', 'f2', 'f3', 'n1', 'new']);
  t.ok('the coach line names the verdict', /tph-table-soft">soft/.test(line));
  t.ok('lists the mix, soft types first', /Table: .*soft<\/b> · 3 (FSH|STA).* 1 NIT/.test(line));
  t.ok('counts the new player', /1 new/.test(line));
  t.ok('and compares VPIP with the usual figure', /VPIP \d+% vs \d+% usual/.test(line));
  t.eq('no seats, no line', T.tableSoftnessHtml([]), '');
  t.ok('only new players: says so rather than guessing', /none rated yet/.test(T.tableSoftnessHtml(['new'])));

  // Each verdict class is built by concatenation, so no-orphans cannot see it.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
  ['soft', 'mixed', 'tough'].forEach((v) => {
    t.ok(`.tph-table-${v} has a CSS rule with its own colour`, new RegExp(`\\.tph-table-${v} \\{ color:`).test(src));
  });
}

// --- P/L by stake ---------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.plLedger = [
    { t: 1, d: 5000000, b: 1000000, g: 'a' },
    { t: 2, d: -2000000, b: 1000000, g: 'b' },
    { t: 3, d: 10000000, b: 2500000, g: 'c' },
    { t: 4, d: 700, b: 0, g: 'd' },
    { t: 5, d: 300, b: 5, g: 'e' }, // implausible blind: grouped as unknown
  ];
  const rows = T.plByStake();
  const at = (bb) => rows.find((r) => r.bb === bb);
  t.eq('three groups', rows.length, 3);
  t.eq('most-played first', rows[0].hands, 2);
  t.eq('$1M: net chips', at(1000000).chips, 3000000);
  t.eq('$1M: net in big blinds', at(1000000).bbNet, 3);
  t.eq('$2.5M: net in big blinds', at(2500000).bbNet, 4);
  t.eq('unreadable blinds land in one chips-only group', at(0).chips, 1000);
  t.eq('and never produce a bb figure', at(0).bbNet, 0);
  t.eq('the groups sum to the ledger', rows.reduce((a, r) => a + r.chips, 0),
    T.STORE.plLedger.reduce((a, r) => a + r.d, 0));
  T.STORE.plLedger = [];
  t.eq('an empty ledger gives no rows', T.plByStake().length, 0);
}

// --- The Stats tab actually renders all of it ----------------------------------
//
// "A panel that renders no test's DOM is untested" (CLAUDE.md, v1.72.0). The
// harness cannot drive renderPlayerPanel's nested lookups, so the body is
// rendered directly against a stand-in panel that hands back one element for
// .tph-tab-body — enough to build the whole Stats string, which is where a
// scoping mistake in a template would throw.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'H';
  const stub = () => ({ innerHTML: '', querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, dataset: {} });
  const render = (xid, isSelf) => {
    const body = stub();
    const panel = { querySelectorAll: () => [], querySelector: (sel) => (sel === '.tph-tab-body' ? body : null) };
    T.openPlayerXid = xid;
    const p = T.getPlayer(xid);
    let threw = null;
    try { T.renderPlayerPanelBody(panel, p, T.computeRates(p), T.computeShrunkRates(p), isSelf); } catch (e) { threw = e; }
    return { html: body.innerHTML, threw };
  };

  T.STORE.plLedger = [{ t: 1, d: 5000000, b: 1000000 }, { t: 2, d: -1000000, b: 0 }];
  const self = render('H', true);
  t.eq('your own Stats tab renders without throwing', self.threw, null);
  t.ok('with the by-stake breakdown', /By stake/.test(self.html) && /River Wizard|\$1M BB/.test(self.html));
  t.ok('including the unreadable-blind group', /Blind unknown/.test(self.html));

  const opp = T.getPlayer('V');
  opp.hands = 40;
  opp.barrel = { m: 3, o: 4, fm: 1, fo: 2 };
  opp.shownHands = { AA: { seen: 2, raised: 2, won: 1 } };
  const other = render('V', false);
  t.eq("an opponent's Stats tab renders without throwing", other.threw, null);
  t.ok('with the turn-barrel rows', /Turn barrel/.test(other.html) && /Fold v barrel/.test(other.html));
  t.ok('and won at showdown', /Won SD/.test(other.html) && /2 seen, low/.test(other.html));
  t.ok('and no by-stake block on an opponent', !/By stake/.test(other.html));
}

process.exit(t.report());
