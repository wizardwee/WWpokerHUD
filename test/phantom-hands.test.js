// The one-off removal of hands that never happened (v1.121.0).
//
// Before v1.115.0 a table move could replay the old log into the new hand.
// In a real backup that produced game 29a241df… on 31 Oct: the 00:51:16
// hand's actions (hero lost $166,875,000 at a $2.5M blind) mixed with a
// $15/$30 tournament's lines. Hero's loss was counted a second time and
// priced at $30, which alone put hero.netBB at about -5.56M and
// CunningCat's bb estimate at the same figure.
//
// The fixture mirrors that store's numbers: a real row, the phantom row,
// hero totals that include both, the opponent estimates the phantom moved,
// and the archived session it landed in.

const { load, runner } = require('./harness');

const t = runner('phantom-hands');

const PH = { g: '29a241df2fa710d1c2d71840c9c2fe', d: -166875000, b: 30 };
const REAL = { t: 1793407876613, d: -166875000, b: 2500000, g: 'e07b55e09f9bb359ab3962007b7618' };

function storeWithPhantom(T) {
  T.STORE = T.emptyStore();
  const before = { t: 1793407844080, d: -20000000, b: 2500000, g: 'f17454320fa558f4a3e40a00298b39' };
  const phantom = { t: 1793407917122, ...PH };
  const after = { t: 1793408000000, d: 5000000, b: 2500000, g: 'aaaa' };
  T.STORE.plLedger = [before, REAL, phantom, after];
  const sum = (k) => T.STORE.plLedger.reduce((n, r) => n + (k ? r.d / r.b : r.d), 0);
  T.STORE.hero = { ...T.STORE.hero, xid: '311421', hands: 4, bbHands: 4, netChips: sum(), netBB: sum(true) };
  // What applyHandResults added for the phantom, on top of a real figure.
  const pool = 179375000 + 15;
  const cc = T.emptyPlayer('4390971', 'CunningCat');
  cc.plChipsEst = -800000000 + PH.d * (179375000 / pool);
  cc.plBBEst = -240 + (PH.d / PH.b) * (179375000 / pool);
  const md = T.emptyPlayer('name:MaxDamage', 'MaxDamage');
  md.plChipsEst = PH.d * (15 / pool);
  md.plBBEst = (PH.d / PH.b) * (15 / pool);
  T.STORE.players = { 4390971: cc, 'name:MaxDamage': md };
  T.STORE.sessionHistory = [{
    startedAt: 1793406652414, endedAt: 1793407920295, hands: 28,
    netChips: -466875000, netBB: -466875000 / 30, bb: 30,
  }];
}

{
  const T = load();
  storeWithPhantom(T);
  const res = T.repairPhantomHands();
  const h = T.STORE.hero;
  t.eq('the phantom row is gone', T.STORE.plLedger.some((r) => r.g === PH.g), false);
  t.eq('the real hand it replayed stays', T.STORE.plLedger.some((r) => r.g === REAL.g), true);
  t.eq('three rows left', T.STORE.plLedger.length, 3);
  t.eq('hero chips sum to the ledger again', h.netChips, T.STORE.plLedger.reduce((n, r) => n + r.d, 0));
  t.near('hero bb sum to the ledger again', h.netBB, T.STORE.plLedger.reduce((n, r) => n + r.d / r.b, 0), 1e-6);
  t.eq('one hand fewer', `${h.hands}/${h.bbHands}`, '3/3');
  t.near('CunningCat chips back to the real figure', T.STORE.players['4390971'].plChipsEst, -800000000, 1e-3);
  t.near('CunningCat bb back to the real figure', T.STORE.players['4390971'].plBBEst, -240, 1e-6);
  t.near('MaxDamage share undone', T.STORE.players['name:MaxDamage'].plChipsEst, 0, 1e-6);
  const s = T.STORE.sessionHistory[0];
  t.eq('session net corrected', s.netChips, -300000000);
  t.eq('session blind back to the cash blind', s.bb, 2500000);
  t.eq('session bb from the corrected figures', s.netBB, -120);
  t.eq('session hands', s.hands, 27);
  t.eq('reported', `${res.hands} ${res.chips} ${res.bb}`, '1 166875000 5562500');
  t.eq('runs once', T.repairPhantomHands(), null);
}

// Any store without that exact row is untouched: id, amount AND blind.
for (const [label, change] of [
  ['different amount', (r) => { r.d = -1; }],
  ['different blind', (r) => { r.b = 2500000; }],
  ['different game', (r) => { r.g = 'zzz'; }],
]) {
  const T = load();
  storeWithPhantom(T);
  change(T.STORE.plLedger[2]);
  const before = JSON.stringify([T.STORE.hero, T.STORE.plLedger, T.STORE.players, T.STORE.sessionHistory]);
  const res = T.repairPhantomHands();
  t.eq(`${label}: nothing removed`, res.hands, 0);
  t.eq(`${label}: store unchanged`, JSON.stringify([T.STORE.hero, T.STORE.plLedger, T.STORE.players, T.STORE.sessionHistory]), before);
}

// The ledger change is written, not left to the reconcile.
{
  const T = load();
  storeWithPhantom(T);
  T.flushNow();
  const key = 'tornPokerHUD_v1:L:0';
  const had = JSON.stringify(JSON.parse(T._sandbox.localStorage.getItem(key)));
  T.repairPhantomHands();
  T.flushNow();
  const now = T._sandbox.localStorage.getItem(key);
  t.ok('the ledger chunk on disk changed', !!now && now !== had && now.indexOf(PH.g) < 0);
}

process.exit(t.report());
