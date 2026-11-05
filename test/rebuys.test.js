// Rebuys inferred from stacks (v1.120.0). Torn logs no rebuy, so a stack
// rise that no win and no returned bet explains is counted, one sweep late.

const { load, runner } = require('./harness');

const t = runner('rebuys');
const BB = 2000000;
const M = (bb) => bb * BB;
const MIN = 60 * 1000;

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.currentHand = T.freshHandState();
  return T;
}
const reb = (T, x) => T.STORE.players[x].rebuys || [];

// --- A top-up between hands counts, after one confirming sweep -------------
{
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(60) }, BB, now);
  t.eq('first sight is a baseline', reb(T, 'A').length, 0);
  T.noteRebuys({ A: M(100) }, BB, now += 3000);
  t.eq('a rise waits a sweep', reb(T, 'A').length, 0);
  T.noteRebuys({ A: M(100) }, BB, now += 3000);
  t.eq('then counts', reb(T, 'A').length, 1);
  t.eq('at its size in bb', reb(T, 'A')[0][1], 40);
  T.noteRebuys({ A: M(100) }, BB, now += 3000);
  t.eq('and only once', reb(T, 'A').length, 1);
  t.eq('within 4h', T.recentRebuys(T.STORE.players.A, now).n, 1);
  t.eq('gone after 4h', T.recentRebuys(T.STORE.players.A, now + 4 * 60 * MIN + 1).n, 0);
}

// --- A pot won is not a rebuy, even if the win line lands a sweep late -----
{
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(60) }, BB, now);
  T.noteRebuys({ A: M(140) }, BB, now += 3000);          // DOM shows the win first
  T.currentHand.winners = [{ xid: 'A', amount: M(80) }];  // then the log line
  T.noteRebuys({ A: M(140) }, BB, now += 3000);
  t.eq('a win is explained', reb(T, 'A').length, 0);
}
{
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(60) }, BB, now);
  const h = T.freshHandState();
  h.winners = [{ xid: 'A', amount: M(80) }];
  h.contributions = { A: M(20), B: M(20) };
  T.noteRebuySettlement(h);                                // hand settled, reset
  T.noteRebuys({ A: M(140) }, BB, now += 3000);
  T.noteRebuys({ A: M(140) }, BB, now += 3000);
  t.eq('a win in the hand just settled is explained', reb(T, 'A').length, 0);
}

// --- An uncalled excess coming back to a loser is not a rebuy --------------
{
  t.eq('excess is the top contributor over the second', JSON.stringify(T0().uncalledExcess({ A: 100, B: 40, C: 10 })), JSON.stringify({ A: 60 }));
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(100) }, BB, now);                    // shoves all 100bb
  const h = T.freshHandState();
  h.contributions = { A: M(100), B: M(40) };
  h.winners = [{ xid: 'B', amount: M(80) }];
  T.noteRebuySettlement(h);
  T.noteRebuys({ A: M(60) }, BB, now += 3000);             // 60bb back uncalled
  T.noteRebuys({ A: M(60) }, BB, now += 3000);
  t.eq('a returned bet is explained', reb(T, 'A').length, 0);
}
function T0() { return load(); }

// --- Bust and rebuy the same amount: measured from zero ---------------------
{
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(100) }, BB, now);                    // last read before the shove
  const h = T.freshHandState();
  h.contributions = { A: M(100), B: M(100) };
  h.winners = [{ xid: 'B', amount: M(200) }];
  T.noteRebuySettlement(h);                                // A's seat shows no stack
  T.noteRebuys({ A: M(100) }, BB, now += 3000);
  T.noteRebuys({ A: M(100) }, BB, now += 3000);
  t.eq('the rebuy after a bust counts', reb(T, 'A').length, 1);
  t.eq('at the full buy-in', reb(T, 'A')[0][1], 100);
}

// --- Not rebuys -------------------------------------------------------------
{
  const T = fresh();
  let now = 1e12;
  T.noteRebuys({ A: M(60) }, BB, now);
  T.noteRebuys({ A: M(65) }, BB, now += 3000);
  T.noteRebuys({ A: M(65) }, BB, now += 3000);
  t.eq('a rise under the bar is ignored', reb(T, 'A').length, 0);
  T.noteRebuys({ A: M(200) }, BB, now += 3 * 60 * 60 * 1000);
  T.noteRebuys({ A: M(200) }, BB, now += 3000);
  t.eq('a return after the session gap is a new baseline', reb(T, 'A').length, 0);
  T.noteRebuys({ A: M(200) }, BB * 2, now += 3000);
  T.noteRebuys({ A: M(400) }, BB * 2, now += 3000);
  T.noteRebuys({ A: M(400) }, BB * 2, now += 3000);
  t.eq('a different stake restarts the baseline', reb(T, 'A').length, 1);
  t.eq('no blind, no judgement', T.noteRebuys({ A: 1 }, 0, now), false);
}

// --- Stats row renders, and only when there is something -------------------
{
  const T = fresh();
  const p = T.emptyPlayer('A');
  t.eq('no row without rebuys', T.rebuyRowHtml(p), '');
  p.rebuys = [[Date.now(), 100]];
  t.ok('row shows count and size', /Rebuys 4h/.test(T.rebuyRowHtml(p)) && /100bb added/.test(T.rebuyRowHtml(p)));
}

process.exit(t.report());
