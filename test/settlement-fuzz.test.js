// Random legal hands through the real parser, checked against each hand's own
// arithmetic.
//
// This is how the v1.91.1 bugs were found — a raise charged its whole "to"
// figure on top of chips already in, and an empty placeholder hand settled on
// the first marker. Every hand-written test fed hands where nobody raised twice
// on a street, which is the only shape the first one shows in. Worked examples
// pin the cases someone thought of; this covers the ones nobody did.
//
// Torn's wording, confirmed by the user (v1.92.1):
//   - "called $X" is the amount ADDED, not the street total.
//   - "raised $X to $Y": $Y is the street total. There is no separate all-in
//     line — a shove is just a raise to the player's stack, so it is generated
//     here the same way, at stack-sized amounts.
//
// What this does NOT cover: the phantom placeholder hand. Its dealt-in list
// is a seat snapshot and the harness has no seats, so the placeholder here
// holds nobody — reverting that fix passes this file. contributions.test.js
// pins it by building the placeholder directly. Reverting the raise fix fails
// seven assertions here.
//
// Deterministic (seeded), so a failure reproduces. Names resolve to
// "name:<username>" pseudo-ids because the harness has no seats; they key
// consistently, and hero is bound to the pseudo-id so settlement runs.

const { load, runner } = require('./harness');

const t = runner('settlement-fuzz');

const NAMES = ['Wonkawee', 'Bauderix', 'GhostNote', 'Xelphina', 'ImEx', 'Rollo', 'Tamsin', 'Quade', 'Fennick'];
const HERO = 'Wonkawee';
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
// Torn's BB display mode, as the v1.99.0 scan shows it: "14.5 BB", "0.5 BB",
// "1 BB" — up to two decimals, trailing zeros dropped. Every generated amount
// is a whole number of half-blinds, so nothing here is lost to that rounding.
const inBB = (bb) => (n) => (Math.round((n / bb) * 100) / 100) + ' BB';

// One hand of generated log lines, plus what it should do to hero.
function genHand(g, rnd, BB = 2500000, fmt = usd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const deck = [];
  SUITS.forEach((s) => RANKS.forEach((r) => deck.push(r + s)));
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }

  const n = 3 + Math.floor(rnd() * 7);
  const btn = Math.floor(rnd() * n);
  const seats = NAMES.slice(0, n);
  const order = seats.map((_, i) => seats[(btn + 1 + i) % n]); // SB first
  const L = [`Game ${(0xa00000 + g).toString(16)}f started`];
  const contrib = {};
  order.forEach((p) => { contrib[p] = 0; });
  const inHand = new Set(order);
  L.push(`${order[0]} posted small blind ${fmt(BB / 2)}`); contrib[order[0]] = BB / 2;
  L.push(`${order[1]} posted big blind ${fmt(BB)}`); contrib[order[1]] = BB;

  const board = [];
  let done = false;
  for (let si = 0; si < 4 && !done; si++) {
    if (si === 1) { board.push(deck.pop(), deck.pop(), deck.pop()); L.push(`The flop:  ${board.join(', ')}`); }
    if (si === 2) { board.push(deck.pop()); L.push(`The turn:  ${board[3]}`); }
    if (si === 3) { board.push(deck.pop()); L.push(`The river:  ${board[4]}`); }
    let bet = si === 0 ? BB : 0;
    const street = {};
    order.forEach((p) => { street[p] = 0; });
    if (si === 0) { street[order[0]] = BB / 2; street[order[1]] = BB; }
    const actOrder = si === 0 ? order.slice(2).concat(order.slice(0, 2)) : order.slice();
    let toAct = actOrder.filter((p) => inHand.has(p));
    let raises = 0;
    const raiseTo = (p, to) => {
      L.push(`${p} raised ${fmt(to - bet)} to ${fmt(to)}`);
      contrib[p] += to - street[p]; street[p] = to; bet = to; raises++;
      toAct = actOrder.filter((q) => inHand.has(q) && q !== p);
    };
    for (let guard = 0; toAct.length && guard < 60; guard++) {
      const p = toAct.shift();
      if (!inHand.has(p)) continue;
      const owe = bet - street[p];
      const r = rnd();
      if (owe > 0) {
        if (r < 0.35) { L.push(`${p} folded`); inHand.delete(p); }
        else if (r < 0.82 || raises >= 3) { L.push(`${p} called ${fmt(owe)}`); street[p] += owe; contrib[p] += owe; }
        else if (r < 0.95) raiseTo(p, bet * 3);
        else raiseTo(p, bet + BB * (20 + Math.floor(rnd() * 60))); // a shove: still a raise line
      } else if (r < 0.6) {
        L.push(`${p} checked`);
      } else if (si === 0) {
        raiseTo(p, BB * 3);
      } else {
        const amt = BB * 2;
        L.push(`${p} bet ${fmt(amt)}`); contrib[p] += amt; street[p] = amt; bet = amt; raises++;
        toAct = actOrder.filter((q) => inHand.has(q) && q !== p);
      }
      if (inHand.size === 1) { done = true; break; }
    }
  }

  const pot = Object.values(contrib).reduce((a, b) => a + b, 0);
  const live = Array.from(inHand);
  const won = {};
  if (live.length === 1) {
    won[live[0]] = pot;
    L.push(`${live[0]} won ${fmt(pot)} Did not show hand`);
  } else {
    live.forEach((p) => L.push(`${p} reveals [${deck.pop()}, ${deck.pop()}] (High Card)`));
    const a = pick(live);
    if (rnd() < 0.25) { // split pot
      const b = live.find((x) => x !== a);
      won[a] = Math.floor(pot / 2); won[b] = pot - won[a];
      L.push(`${a} won ${fmt(won[a])}`, `${b} won ${fmt(won[b])}`);
    } else {
      won[a] = pot;
      L.push(`${a} won ${fmt(pot)}`);
    }
  }
  const heroIn = contrib[HERO] != null;
  return { L, pot, contrib, heroIn, heroDelta: heroIn ? (won[HERO] || 0) - contrib[HERO] : 0 };
}

// `stakes` is the sequence of tables played: [{ bb, hands, mode, tap }].
// mode 'bb' writes the log in BB display mode; tap(T) runs before the stake's
// first hand, standing in for the Cash Games row tap that joined it.
function run(seed, hands, stakes) {
  let s = seed * 7919 + 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.heroName = HERO;
  T.heroXid = 'name:' + HERO;
  T.lastSeenBB = 0;
  const plan = [];
  (stakes || [{ bb: 2500000, hands, mode: 'usd' }]).forEach((st) => {
    for (let i = 0; i < st.hands; i++) plan.push({ ...st, first: i === 0 });
  });

  const bad = [];
  let expNet = 0;
  let expHands = 0;
  let prev = null;
  for (let g = 0; g < plan.length; g++) {
    const st = plan[g];
    if (st.first && st.tap) st.tap(T);
    const h = genHand(g, rnd, st.bb, st.mode === 'bb' ? inBB(st.bb) : usd);
    h.L.forEach((line, i) => {
      T.handleLogLine(line);
      // Replayed marker for the previous hand, as a re-rendered log produces.
      if (i === 3 && g > 0 && rnd() < 0.1) T.handleLogLine(`Game ${(0xa00000 + g - 1).toString(16)}f started`);
    });
    // The pot as the parser summed it, checked against the hand's own sum.
    if (Math.abs(T.currentHand.pot - h.pot) > 1 && bad.length < 5) {
      bad.push(`seed ${seed} hand ${g}: log pot ${T.currentHand.pot} vs ${h.pot}\n    ${h.L.join('\n    ')}`);
    }
    if (h.heroIn) { expNet += h.heroDelta; expHands += 1; }
    prev = h;
  }
  T.handleLogLine('Game fffffff started'); // settles the last hand
  return { T, bad, expNet, expHands, prev };
}

// A Cash Games row and the tap that joins it — the same shape
// table-name.test.js drives rememberTappedRow with.
function tapRow(T, name, blinds) {
  const node = (text, kids) => {
    const n = { ownText: text || '', children: [], parentElement: null,
      get textContent() { return n.ownText + n.children.map((c) => c.textContent).join(''); } };
    (kids || []).forEach((k) => { k.parentElement = n; n.children.push(k); });
    return n;
  };
  const nameCell = node(name);
  const el = node('', [nameCell, node(blinds), node('30'), node('3/9')]);
  node('', [el]);
  T.rememberTappedRow(nameCell, [{ row: el, bb: T.tableBlindsBB(blinds) }], Date.now());
}

const SCENARIOS = [
  { seed: 1, label: 'dollars' },
  { seed: 2, label: 'dollars' },
  { seed: 3, label: 'dollars' },
  // A reload at a BB-mode table: no dollar figure is ever logged, so the
  // tapped row is the only thing that knows the blind. Before v1.99.2 every
  // hand here settled at $0.
  { seed: 4, label: 'BB mode, priced by the tapped row',
    stakes: [{ bb: 2500000, hands: 250, mode: 'bb', tap: (T) => tapRow(T, "Cat's Chance II", '$1.25m / $2.5m') }] },
  // A move between stakes inside one page session, in BB mode throughout.
  // Before v1.99.2 the $1M table was priced at the $2.5M blind: every chip
  // figure 2.5x too large while every BB figure looked right.
  { seed: 5, label: 'BB mode across a stake move',
    stakes: [
      { bb: 2500000, hands: 120, mode: 'bb', tap: (T) => tapRow(T, "Cat's Chance", '$1.25m / $2.5m') },
      { bb: 1000000, hands: 130, mode: 'bb', tap: (T) => tapRow(T, 'River Wizard', '$500k / $1m') },
    ] },
  // Switching the display mode mid-session at one table.
  { seed: 6, label: 'dollars, then BB mode',
    stakes: [{ bb: 2500000, hands: 120, mode: 'usd' }, { bb: 2500000, hands: 130, mode: 'bb' }] },
];

for (const sc of SCENARIOS) {
  const seed = sc.seed;
  const { T, bad, expNet, expHands } = run(seed, 250, sc.stakes);
  if (sc.stakes) t.ok(`seed ${seed} (${sc.label}): the blind was priced`, !T.bbDisplayModeSuspected && T.STORE.hero.bbHands === T.STORE.hero.hands);
  const S = T.STORE;
  t.eq(`seed ${seed}: every log pot matches the hand's own sum`, bad.join('\n'), '');
  t.eq(`seed ${seed}: hero's net is the sum of hero's hand results`, S.hero.netChips, expNet);
  t.eq(`seed ${seed}: hero is credited exactly the hands hero was in`, S.hero.hands, expHands);
  t.ok(`seed ${seed}: bbHands never exceeds hands`, S.hero.bbHands <= S.hero.hands);

  // Attribution splits hero's delta across opponents; it must sum back.
  let pl = 0;
  const broken = [];
  Object.values(S.players).forEach((p) => {
    if (p.xid === T.heroXid) return;
    pl += p.plChipsEst || 0;
    [['vpip', 'hands'], ['pfr', 'vpip'], ['cbetMade', 'cbetOpp'], ['foldToCbetMade', 'foldToCbetOpp'],
      ['foldTo3BetMade', 'foldTo3BetOpp'], ['wtsd', 'hands'], ['limpMade', 'vpip'], ['threeBetMade', 'pfr']]
      .forEach(([a, b]) => { if ((p[a] || 0) > (p[b] || 0)) broken.push(`${p.name} ${a} ${p[a]} > ${b} ${p[b]}`); });
  });
  t.ok(`seed ${seed}: per-opponent P/L sums to hero's net`, Math.abs(pl - S.hero.netChips) < 10);
  t.eq(`seed ${seed}: no counter exceeds its opportunity count`, broken.join('; '), '');

  let nonFinite = '';
  const walk = (o, path) => {
    if (o && typeof o === 'object') { Object.keys(o).forEach((k) => walk(o[k], path + '.' + k)); return; }
    if (typeof o === 'number' && !isFinite(o) && !nonFinite) nonFinite = path;
  };
  walk(S, 'STORE');
  t.eq(`seed ${seed}: nothing in the store is NaN or Infinity`, nonFinite, '');

  const ids = S.hands.map((h) => h.g).filter(Boolean);
  t.eq(`seed ${seed}: no hand is filed twice`, new Set(ids).size, ids.length);
}

process.exit(t.report());
