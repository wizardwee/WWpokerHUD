// v1.88.0: the coach reads how often a player c-bets and how often they 3-bet.
// Both were collected and shown in the Stats tab, and no exploit rule read
// either. Driven through the real buildExploitPlan / buildLeakPlan.

const { load, runner } = require('./harness');

const t = runner('cbet-3bet-reads');
const T = load();
T.STORE = T.emptyStore();
T.STORE.settings.minHands = 20;

const base = (o) => Object.assign(T.emptyPlayer('x', 'X'), { hands: 100, vpip: 40, pfr: 10 }, o);
const entry = (p, tag, voice) => (voice === 'leak' ? T.buildLeakPlan(p) : T.buildExploitPlan(p)).filter((e) => e.tag === tag);

// --- c-bet frequency -----------------------------------------------------------
{
  const hi = base({ cbetMade: 32, cbetOpp: 40 }); // 80% vs ~39
  const e = entry(hi, 'C-bettor');
  t.eq('a heavy c-bettor gets one read', e.length, 1);
  t.ok('...telling you to float or raise', /Float in position/.test(e[0].text));
  t.ok('...when their bet is in front of you', (e[0].when || []).includes('facing'));
  t.ok('the leak voice says the same thing to you', /You c-bet 80%/.test(entry(hi, 'C-bettor', 'leak')[0].text));

  const lo = base({ cbetMade: 4, cbetOpp: 40 }); // 10%
  const l = entry(lo, 'C-bettor');
  t.eq('a rare c-bettor gets one read', l.length, 1);
  t.ok('...their bet is a hand', /it is a hand/.test(l[0].text));

  t.eq('a pool-average c-bettor gets none', entry(base({ cbetMade: 16, cbetOpp: 40 }), 'C-bettor').length, 0);
  t.eq('under 8 spots: none', entry(base({ cbetMade: 7, cbetOpp: 7 }), 'C-bettor').length, 0);
}

// --- 3-bet frequency -------------------------------------------------------------
{
  const hi = base({ threeBetMade: 8 }); // 8% of 100 hands vs 1.5
  const e = entry(hi, '3-bettor');
  t.eq('a heavy 3-bettor gets one read', e.length, 1);
  t.ok('...telling you not to fold good opens', /Don't fold your good opens/.test(e[0].text));

  const nit = base({ hands: 150, threeBetMade: 0 });
  const n = entry(nit, '3-bettor');
  t.eq('no 3-bet in 150 hands: one read', n.length, 1);
  t.ok('...their 3-bet is premiums', /top of their range/.test(n[0].text));
  t.eq('no 3-bet in 60 hands is not yet a read', entry(base({ hands: 60, threeBetMade: 0 }), '3-bettor').length, 0);
  t.eq('one 3-bet in 150 hands: not a nit', entry(base({ hands: 150, threeBetMade: 1 }), '3-bettor').length, 0);
  t.eq('under 30 hands the frequency read waits', entry(base({ hands: 20, threeBetMade: 5 }), '3-bettor').length, 0);
}

// --- per-street folding now counts as folding to aggression for the red box ---
{
  const streets = { flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
    turn: { bet: 1, raise: 0, call: 3, check: 2, fold: 12 },
    river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 } };
  const p = base({ streetActions: streets });
  const plan = T.buildExploitPlan(p);
  t.ok('folding 60%+ of turns fires the Fold read', plan.some((e) => e.tag === 'Fold'));
  t.ok('...and is marked as folding', plan.some((e) => e.tag === 'Fold' && e.folds));
  t.eq('...so it draws the dashed box', T.exploitTargetKind(p), 'bluff');
}

process.exit(t.report());
