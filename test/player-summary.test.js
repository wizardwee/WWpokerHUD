// The player summary, and the reads added to feed it (v1.110.0).
//
// Asked for after a hand-written analysis of real opponents was preferred to
// the HUD's own output. Comparing the two found reads the HUD had the data
// for and no rule to say, bars that fired for most of the pool, and report
// lines that argued with themselves. The fixtures here are two real
// opponents' counters from that comparison, trimmed to what the rules read.

const fs = require('fs');
const path = require('path');
const { load, runner } = require('./harness');

const t = runner('player-summary');
const src = fs.readFileSync(path.join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');

function fresh() {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = '311421';
  return T;
}

// bzimor: passive preflop, calls flops, folds turns, stabs rivers, rarely traps.
function bzimor(T) {
  return Object.assign(T.emptyPlayer('2658357', 'bzimor'), {
    hands: 328, vpip: 129, pfr: 34, limpMade: 52, threeBetMade: 4,
    foldTo3BetMade: 23, foldTo3BetOpp: 48, cbetMade: 43, cbetOpp: 79,
    foldToCbetMade: 33, foldToCbetOpp: 64, wtsd: 35,
    streetActions: {
      flop: { bet: 22, raise: 10, call: 32, check: 66, fold: 32 },
      turn: { bet: 33, raise: 6, call: 12, check: 37, fold: 30 },
      river: { bet: 24, raise: 1, call: 9, check: 12, fold: 8 },
    },
    texture: { drawBets: 1, drawSizes: [50], madeBets: 31, madeSizes: Array(25).fill(75),
      bluffBets: 4, bluffSizes: [50, 50, 110, 8], checkMade: 4 },
  });
}

// Sarkov: folds to bets, traps, 3-bets light.
function sarkov(T) {
  return Object.assign(T.emptyPlayer('1618610', 'Sarkov'), {
    hands: 615, vpip: 226, pfr: 112, limpMade: 55, threeBetMade: 17,
    foldTo3BetMade: 19, foldTo3BetOpp: 33, cbetMade: 70, cbetOpp: 203,
    foldToCbetMade: 43, foldToCbetOpp: 93, wtsd: 70,
    streetActions: {
      flop: { bet: 57, raise: 5, call: 22, check: 123, fold: 81 },
      turn: { bet: 26, raise: 6, call: 13, check: 80, fold: 40 },
      river: { bet: 16, raise: 5, call: 7, check: 50, fold: 18 },
    },
    texture: { drawBets: 3, madeBets: 4, checkMade: 10, bluffBets: 0, drawSizes: [], madeSizes: [], bluffSizes: [] },
    shownHands: {
      44: { seen: 2, raised: 1, won: 2, r3: 1 }, 88: { seen: 1, raised: 1, won: 0, r3: 1 },
      A9s: { seen: 3, raised: 1, won: 1, r3: 1 }, '53s': { seen: 2, raised: 1, won: 1, r3: 1 },
      '85s': { seen: 1, raised: 1, won: 1, r3: 1 }, Q8s: { seen: 3, raised: 1, won: 0, r3: 1 },
      A6s: { seen: 1, raised: 1, won: 0, r3: 1 }, KK: { seen: 1, raised: 1, won: 1 },
    },
  });
}

const has = (plan, tag, short) => plan.some((e) => e.tag === tag && e.short === short);

// --- The reads that were missing ---------------------------------------------
{
  const T = fresh();
  const plan = T.buildExploitPlan(bzimor(T));
  t.ok('calls flops, folds turns: "bet the turn, not the flop"', has(plan, 'Turn', 'bet the turn, not the flop'));
  t.ok('bets 67% of unbet rivers: "call their river stab"', has(plan, 'Stab', 'call their river stab'));
  t.ok('raises 14% of flop bets vs a 7% pool', has(plan, 'Re-raise', 'they raise flop bets'));
  t.ok('slowplays 11% vs a 50% pool: "their check = weak"', has(plan, 'Trap', 'their check = weak'));
  t.ok('no "barrel more" off a normal showdown rate', !plan.some((e) => e.tag === 'Showdown'));
}
{
  const T = fresh();
  const plan = T.buildExploitPlan(sarkov(T));
  t.ok('7 of 7 3-bet showdowns outside the chart: "their 3-bet is light"', has(plan, 'Range', 'their 3-bet is light'));
  t.ok('turn fold 68% vs a 50% pool fires (a flat 70 missed it)', has(plan, 'Fold', 'barrel the turn'));
  t.ok('the plain 3-bet list is replaced, not repeated', !has(plan, 'Range', 'their 3-bet range'));
  t.ok('no "barrel more" at the pool showdown rate', !plan.some((e) => e.tag === 'Showdown'));
}

// --- Each new read is suppressed where something better already says it ------
{
  const T = fresh();
  const p = bzimor(T);
  p.barrel = { m: 0, o: 0, fm: 9, fo: 12 }; // the exact fold-to-barrel stat, 75%
  t.ok('the exact fold-to-barrel read replaces the flop/turn approximation',
    !has(T.buildExploitPlan(p), 'Turn', 'bet the turn, not the flop'));
}
{
  const T = fresh();
  const p = bzimor(T);
  p.streetActions.turn.raise = 40; // whole-hand raise rate now > 18%
  const plan = T.buildExploitPlan(p);
  t.ok('a whole-hand re-raise read fires', has(plan, 'Re-raise', 'they raise bets'));
  t.ok('and the per-street raise read stands down', !has(plan, 'Re-raise', 'they raise flop bets'));
}
{
  const T = fresh();
  const p = bzimor(T);
  p.streetActions.river = { bet: 1, raise: 1, call: 9, check: 30, fold: 8 }; // 3% of 31 unbet
  t.ok('a river stab rate under the pool reads "their river bet = real"',
    has(T.buildExploitPlan(p), 'Stab', 'their river bet = real'));
}

// --- The 3-bet range read ------------------------------------------------------
{
  const T = fresh();
  const sr = (o) => Object.keys(o).map((cls) => ({ cls, n: o[cls] }));
  t.eq('value: AA-JJ and AK', T.threeBetRangeRead(sr({ AA: 2, KK: 1, JJ: 1, AKo: 3 })).kind, 'value');
  t.eq('light: small pairs and suited junk', T.threeBetRangeRead(sr({ 44: 1, '53s': 1, Q8s: 1, AA: 1 })).kind, 'light');
  t.eq('mixed: no verdict', T.threeBetRangeRead(sr({ AA: 1, KK: 1, '53s': 1, Q8s: 1, JJ: 1, '44': 1, QQ: 1 })), null);
  t.eq('under 4 shown: no verdict', T.threeBetRangeRead(sr({ 44: 1, '53s': 1, Q8s: 1 })), null);
}

// --- The bars are measured. Pinned against literals --------------------------
t.eq('WTSD per hand played: high', T0().WTSD_PLAYED_HIGH, 41);
t.eq('WTSD per hand played: low', T0().WTSD_PLAYED_LOW, 21);
t.eq('slowplay: high', T0().TRAP_HIGH, 67);
t.eq('slowplay: low', T0().TRAP_LOW, 33);
t.eq('VPIP-PFR gap: high', T0().PASSIVE_GAP_HIGH, 57);
function T0() { return T0.T || (T0.T = load()); }
{
  const T = fresh();
  const r = T.computeRates(bzimor(T));
  t.near('WTSD per hand played is showdowns over VPIP', r.wtsdPlayed, (100 * 35) / 129);
  // A nit seeing showdown in a normal share of the hands they play is not
  // "giving up" — the per-hand-dealt figure said so for most of the pool.
  const nit = Object.assign(T.emptyPlayer('n', 'nit'), { hands: 400, vpip: 80, wtsd: 26 });
  t.ok('a tight player at the pool showdown rate gets no Showdown read',
    !T.buildExploitPlan(nit).some((e) => e.tag === 'Showdown'));
  // 35% of hands dealt read as normal under the old bar (40); it is 47% of
  // the hands they play, which is a station.
  const loose = Object.assign(T.emptyPlayer('l', 'loose'), { hands: 400, vpip: 300, wtsd: 140 });
  t.ok('a loose player reaching showdown in 47% of hands played reads as a station',
    T.buildExploitPlan(loose).some((e) => e.tag === 'Showdown' && e.short === 'three-street value'));
  // 47% slowplay is the pool's middle; the old >40 bar called it a trapper.
  const mid = Object.assign(T.emptyPlayer('m', 'mid'), { hands: 400,
    texture: { checkMade: 47, madeBets: 53, drawBets: 0, bluffBets: 0, drawSizes: [], madeSizes: [], bluffSizes: [] } });
  t.ok('a 47% slowplay rate gets no Trap read', !T.buildExploitPlan(mid).some((e) => e.tag === 'Trap'));
  // Turn aggression: pool 58, SD 19. A flat 55 fired for over half the pool.
  const turnAgg = (bet) => Object.assign(T.emptyPlayer('a', 'agg'), { hands: 400,
    streetActions: { flop: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 },
      turn: { bet, raise: 0, call: 100 - bet, check: 0, fold: 0 }, river: { bet: 0, raise: 0, call: 0, check: 0, fold: 0 } } });
  t.ok('70% turn aggression is not "turn bets are real"', !has(T.buildExploitPlan(turnAgg(70)), 'Turn', 'turn bets are real'));
  t.ok('85% is', has(T.buildExploitPlan(turnAgg(85)), 'Turn', 'turn bets are real'));
}

// --- Every rule names its summary line ----------------------------------------
{
  const T = fresh();
  const keys = T.PLAN_LINES.map((l) => l.key).concat(['none']);
  const body = src.slice(src.indexOf('function buildTendencyEntries('), src.indexOf('function buildExploitPlan('));
  const calls = body.match(/\badd\('[^']*', \d+, '/g) || [];
  const bare = body.match(/\badd\(\d+, '/g) || [];
  t.ok('the scan finds the rules (' + calls.length + ')', calls.length >= 50);
  t.eq('no rule without a summary line', bare.length, 0);
  const bad = calls.map((c) => /'([^']*)'/.exec(c)[1]).filter((k) => keys.indexOf(k) < 0);
  t.eq('every summary line named exists', bad.join(','), '');
}

// --- The summary --------------------------------------------------------------
{
  const T = fresh();
  T.STORE.players['2658357'] = bzimor(T);
  T.STORE.players['1618610'] = sarkov(T);
  const s = T.buildPlayerSummary('2658357');
  t.ok('a summary is built', !!s && s.lines.length >= 3);
  const plan = T.buildExploitPlan(T.STORE.players['2658357']);
  const all = s.lines.reduce((a, l) => a.concat(l.items), []);
  t.ok('every item is a read from the Exploit plan', all.every((x) => plan.some((e) => e.short === x)));
  t.ok('"none" reads stay out of it', !all.includes('seen at showdown'));
  t.ok('at most three per line', s.lines.every((l) => l.items.length <= 3));
  const order = T.PLAN_LINES.map((l) => l.label);
  t.ok('lines keep their order', s.lines.every((l, i) => i === 0 || order.indexOf(s.lines[i - 1].label) < order.indexOf(l.label)));
  const bet = s.lines.find((l) => l.label === 'Bet into them');
  t.eq('strongest first within a line', bet.items[0], 'bet the turn, not the flop');
  t.ok('the head names the type and hands', /Balanced|Fish|Station|Nit|TAG|LAG|Maniac/.test(s.head) && /328 hands/.test(s.head));
  t.eq("hero's own record has no summary", T.buildPlayerSummary('311421'), null);

  const rep = T.buildReport('2658357');
  t.ok('the report leads with the summary', rep.indexOf('SUMMARY') >= 0 && rep.indexOf('SUMMARY') < rep.indexOf('PREFLOP'));
  t.ok('and renders on screen', /tph-rep-h">Summary</.test(T.buildReportHtml('2658357')));
}

// --- The report no longer argues with itself -----------------------------------
{
  const T = fresh();
  T.STORE.players['1618610'] = sarkov(T);
  const rep = T.buildReport('1618610');
  // 37% against this fixture's 42.5% global anchor is inside half a spread.
  t.ok('37% under the pool is not "very wide"', !/very wide/.test(rep) && /about as many hands as the pool/.test(rep));
  t.ok('18 of 37 is not "often just calls"', !/just calls/.test(rep));
  t.ok('pool figures are rounded', !/pool \d+\.\d{3,}/.test(rep));
  t.ok('no empty sizing line', !/sizes — of pot/.test(rep));
  t.ok('the 3-bet line says what the range means', /Light — most of it is outside/.test(rep));
}

// --- The coach's expandable plan line --------------------------------------------
{
  const T = fresh();
  T.STORE.players['2658357'] = bzimor(T);
  const closed = T.coachPlanHtml('2658357');
  t.ok('closed: one line naming the player', /▸ Plan vs bzimor/.test(closed) && !/tph-coach-plan-l/.test(closed));
  T.STORE.settings.coachPlanOpen = true;
  const open = T.coachPlanHtml('2658357');
  t.ok('open: the summary lines', /▾ Plan vs bzimor/.test(open) && /Bet into them:/.test(open));
  t.eq('no player, no line', T.coachPlanHtml(null), '');
  t.eq('closed by default', T.emptyStore().settings.coachPlanOpen, false);
  // buildCoachAdvice needs hero's cards off the DOM, which the harness has
  // none of, so the hand-off from the lead read to the plan line is scanned.
  t.ok('the lead read names the plan line\'s player', /if \(i === 0\) coachPlanXid = tip\.xid;/.test(src));
  t.ok('and the panel renders it under the advice', /coachPlanHtml\(coachPlanXid\)/.test(src));
  t.ok('the toggle is wired on the body, which survives re-render',
    /querySelector\('\.tph-coach-body'\)\.addEventListener\('click'/.test(src));
  ['tph-coach-plan', 'tph-coach-plan-toggle', 'tph-coach-plan-l', 'tph-coach-plan-k'].forEach((c) => {
    t.ok(c + ' declares its colour', new RegExp('\\.' + c + ' \\{[^}]*color:').test(src));
  });
}

// --- Pool figures in the reads are rounded (v1.112.0) -------------------------
// A stake-blended anchor printed "vs a 48.21206434316353% pool" on the coach.
{
  const T = fresh();
  const p = Object.assign(T.emptyPlayer('b', 'Blaze'), { hands: 2242, vpip: 648, pfr: 146,
    foldTo3BetMade: 84, foldTo3BetOpp: 95, cbetMade: 200, cbetOpp: 300, foldToCbetMade: 100, foldToCbetOpp: 120,
    tables: { 10000000: 1587, 25000000: 622, 2500000: 23 } });
  const text = T.buildExploitPlan(p).map((e) => e.text).join(' ');
  t.ok('a 3-bet read fires on the fixture', /3-bets/.test(text));
  t.ok('no long decimals in any read', !/\d\.\d{3,}/.test(text));
}

process.exit(t.report());
