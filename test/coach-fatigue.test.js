// The coach's live read: what it points AT, and how often it repeats itself.
//
// Reported directly: the coaching advice "seems pretty stale and [...] repeats
// advice too much across player base."
//
// Three separate mechanisms came out of that, and they are separate on
// purpose — each fails differently and each is pinned here:
//
//   1. liveAggressor / streetLeader. hand.lastAggressor is written on every
//      raise and NEVER cleared on a fold, so a villain who bet the flop and
//      folded to hero's raise kept the +1000 aggressor bonus for the rest of
//      the hand, and kept feeding the pot-odds line a bet nobody was making.
//      That is the literal staleness, and it is a bug, not a tuning question.
//   2. The `edge` term. `gain` is a constant per RULE, so a villain two points
//      past the fold-to-c-bet threshold scored exactly the same as one at 80%
//      and whichever rule carried the higher constant won for everybody.
//   3. Tip fatigue. Nothing remembered what it had already said, so the same
//      sentence rendered every 1.5 seconds for a whole session.
//
// THE INVARIANT THAT MATTERS MOST is at the bottom: fatigue is capped BELOW
// EXPLOIT_RELEVANT_BONUS, so rotation can never swap a read that matches the
// spot hero is in for one that does not. Rotation that costs accuracy is not
// worth having, and a cap chosen by feel would drift into exactly that.

const { load, runner } = require('./harness');

const t = runner('coach-fatigue');

function hand(over) {
  return Object.assign({
    gameId: 'abc123',
    street: 'flop',
    board: [],
    playersIn: new Set(['A', 'B', 'HERO']),
    streetContributions: {},
    aggressorByStreet: {},
    lastAggressor: null,
  }, over || {});
}

function setup() {
  const T = load();
  T.STORE = T.emptyStore();
  T.heroXid = 'HERO';
  T.STORE.players.HERO = T.emptyPlayer('HERO', 'Hero');
  return T;
}

// --- streetLeader: who hero is ACTUALLY up against ------------------------

{
  const T = setup();
  const h = hand({ streetContributions: { A: 500, HERO: 100 } });
  const lead = T.streetLeader(h);
  t.eq('the biggest live street contributor is the leader', lead.xid, 'A');
  t.ok('and hero is facing them', lead.facing === true);
}

{
  const T = setup();
  // A bet, hero raised, A folded. A is out of playersIn but still holds
  // lastAggressor — this is the whole reported bug.
  const h = hand({
    playersIn: new Set(['B', 'HERO']),
    streetContributions: { A: 500, B: 0, HERO: 1500 },
    lastAggressor: 'A',
  });
  const lead = T.streetLeader(h);
  t.eq('a folded player is not the street leader', lead.xid, 'B');
  t.ok('and hero is not facing anything', lead.facing === false);
  t.eq('and the folded aggressor is not the live aggressor', T.liveAggressor(h), null);
}

{
  const T = setup();
  const h = hand({ lastAggressor: 'A', streetContributions: { A: 500, HERO: 0 } });
  t.eq('a raiser still in the hand IS the live aggressor', T.liveAggressor(h), 'A');
}

{
  const T = setup();
  t.eq('no raise at all means no aggressor', T.liveAggressor(hand()), null);
}

// The `facing` context token has to agree with the number, or the coach can
// tag a read as relevant to a bet the pot-odds line says is not there.

{
  const T = setup();
  const h = hand({
    playersIn: new Set(['B', 'HERO']),
    streetContributions: { A: 500, B: 0, HERO: 1500 },
    lastAggressor: 'A',
  });
  t.ok('the facing token is not set by a player who folded',
    !T.handContextTokens(h).has('facing'));
}

{
  const T = setup();
  const h = hand({ streetContributions: { A: 500, HERO: 100 } });
  const ctx = T.handContextTokens(h);
  t.ok('but it IS set when a live opponent has bet more than hero', ctx.has('facing'));
  t.ok('and the street token comes through alongside it', ctx.has('flop'));
}

// --- the edge term --------------------------------------------------------

{
  const T = setup();
  const A = T.POOL_AVG, S = T.POOL_SPREAD;
  t.eq('at the threshold the edge is 0',
    T.spreadEdge(A.vpip + S.vpip, A.vpip, S.vpip), 0);
  t.eq('two spreads past it the edge is 1',
    T.spreadEdge(A.vpip + 3 * S.vpip, A.vpip, S.vpip), 1);
  t.ok('and it is symmetric below the average',
    T.spreadEdge(A.vpip - 3 * S.vpip, A.vpip, S.vpip) === 1);
  t.ok('a wild outlier is clamped, not run away with',
    T.spreadEdge(A.vpip + 40 * S.vpip, A.vpip, S.vpip) === 1);
  // A missing figure must not read as "extreme". Neutral is the only honest
  // answer for a stat that has nothing behind it.
  t.eq('a null value is neutral', T.spreadEdge(null, A.vpip, S.vpip), T.EXPLOIT_EDGE_NEUTRAL);
  t.eq('a zero spread is neutral, not a divide by zero',
    T.spreadEdge(50, 40, 0), T.EXPLOIT_EDGE_NEUTRAL);

  t.eq('thresholdEdge is 0 where the rule starts firing', T.thresholdEdge(60, 60, 90), 0);
  t.eq('and 1 at the far end', T.thresholdEdge(90, 60, 90), 1);
  t.near('and linear between', T.thresholdEdge(75, 60, 90), 0.5);
  t.eq('past the far end it clamps', T.thresholdEdge(200, 60, 90), 1);
  t.eq('below the near end it clamps', T.thresholdEdge(10, 60, 90), 0);
}

// An unannotated rule must sit in the middle of the band — neither promoted
// nor punished. Same defaulting principle as an untagged `when`, and what
// makes the annotation incremental rather than all-or-nothing.

{
  const T = setup();
  t.eq('an entry with no edge scores exactly its gain',
    T.tipBaseScore({ gain: 100 }), 100);
  t.eq('an entry at full edge scores half the span above it',
    T.tipBaseScore({ gain: 100, edge: 1 }), 100 + T.EXPLOIT_EDGE_SPAN / 2);
  t.eq('an entry at the threshold scores half the span below it',
    T.tipBaseScore({ gain: 100, edge: 0 }), 100 - T.EXPLOIT_EDGE_SPAN / 2);
  // The span is a TIEBREAKER, not a re-ranking. The gain ladder encodes a real
  // judgement (postflop reads beat preflop ones against this pool) and a span
  // wide enough to overturn it would be replacing that judgement with an
  // arbitrary one. Tilt (110) must still outrank a maxed-out c-bet read (100).
  t.ok('a maxed-out edge cannot overturn the gain ladder wholesale',
    T.tipBaseScore({ gain: 100, edge: 1 }) < 110 + T.EXPLOIT_EDGE_SPAN / 2);
}

// --- tip fatigue ----------------------------------------------------------

{
  const T = setup();
  t.eq('an unseen read carries no penalty', T.tipFatiguePenalty('A', 'C-bet'), 0);

  T.noteTipShown('A', 'C-bet', 'g1|flop');
  t.eq('one showing is one step', T.tipFatiguePenalty('A', 'C-bet'), T.TIP_FATIGUE_STEP);

  // The panel re-renders every 1.5s. Counting per render rather than per spot
  // would rack up forty showings on a single street and demote the read out of
  // the very spot it is about, before it had been read once.
  T.noteTipShown('A', 'C-bet', 'g1|flop');
  T.noteTipShown('A', 'C-bet', 'g1|flop');
  T.noteTipShown('A', 'C-bet', 'g1|flop');
  t.eq('re-rendering the same spot does not count again',
    T.tipFatiguePenalty('A', 'C-bet'), T.TIP_FATIGUE_STEP);

  T.noteTipShown('A', 'C-bet', 'g1|turn');
  t.eq('a new street does count', T.tipFatiguePenalty('A', 'C-bet'), 2 * T.TIP_FATIGUE_STEP);

  t.eq('a different tag on the same player is tracked separately',
    T.tipFatiguePenalty('A', 'Turn'), 0);
  t.eq('and the same tag on a different player is too',
    T.tipFatiguePenalty('B', 'C-bet'), 0);
}

{
  const T = setup();
  for (let i = 0; i < 40; i++) T.noteTipShown('A', 'C-bet', 'g' + i + '|flop');
  t.eq('the penalty is capped', T.tipFatiguePenalty('A', 'C-bet'), T.TIP_FATIGUE_MAX);
}

// Fatigue is a rotation, not a ban: a read you stopped seeing has to come back.

{
  const T = setup();
  T.noteTipShown('A', 'C-bet', 'g1|flop');
  T.noteTipShown('A', 'C-bet', 'g2|flop');
  t.ok('a read shown twice is warm', T.tipFatiguePenalty('A', 'C-bet') > 0);
  // Age it by hand. Nothing in the file can wind the clock, and a test that
  // waits ten real minutes is a test nobody runs.
  const rec = T.tipFatigue.get('A|C-bet');
  rec.lastAt = Date.now() - T.TIP_FATIGUE_MS - 1000;
  t.eq('a read you stopped seeing goes cold and comes back',
    T.tipFatiguePenalty('A', 'C-bet'), 0);
  // And it restarts from one step rather than resuming its old count — the
  // point of going cold is that it is new to you again.
  T.noteTipShown('A', 'C-bet', 'g9|flop');
  t.eq('and it restarts rather than resuming', T.tipFatiguePenalty('A', 'C-bet'), T.TIP_FATIGUE_STEP);
}

// --- THE INVARIANT: fatigue never beats relevance -------------------------
//
// This is the one to keep. Rotation exists so you are not reading the same
// sentence for an hour — but a rotation that can swap the read matching the
// spot hero is in for one that does not is worse than the repetition it
// cures. The cap is what rules that out, and it is a RELATIONSHIP between two
// constants, not a value either of them can be tuned to independently.

{
  const T = setup();
  t.ok(`fatigue is capped below the relevance bonus (${T.TIP_FATIGUE_MAX} < ${T.EXPLOIT_RELEVANT_BONUS})`,
    T.TIP_FATIGUE_MAX < T.EXPLOIT_RELEVANT_BONUS);
  // Stated as the thing it actually guarantees: between two equally-strong
  // reads, the one matching the spot wins however many times it has been seen.
  const relevantAndStale = 100 + T.EXPLOIT_RELEVANT_BONUS - T.TIP_FATIGUE_MAX;
  const irrelevantAndFresh = 100 - T.EXPLOIT_IRRELEVANT_PENALTY;
  t.ok('a fully fatigued on-spot read still beats a fresh off-spot one',
    relevantAndStale > irrelevantAndFresh);
  // And pinned from the other side, so the cap is not simply raised to "fix" a
  // future complaint about repetition: it has to stay able to rotate at all.
  t.ok('but fatigue is big enough to reorder reads within a tier',
    T.TIP_FATIGUE_MAX > T.EXPLOIT_EDGE_SPAN / 2);
}

// --- the panel asks for two, and they are distinct ------------------------

{
  const T = setup();
  t.eq('the coach panel shows two reads', T.COACH_TIPS_SHOWN, 2);
}

// --- currentExploitTips, end to end ---------------------------------------
//
// The unit pieces above can all be right while the selector still hands you
// the wrong player, so these drive the real function over real player records.

// A villain with several genuine reads, so there is something to rotate
// BETWEEN. One read and rotation is untestable — and pointless.
function villain(T, xid) {
  const p = T.emptyPlayer(xid, xid);
  p.hands = 120;
  p.vpip = 96;                 // 80% — way over pool
  p.pfr = 8;
  p.foldToCbetOpp = 40;
  p.foldToCbetMade = 34;       // 85% — folds flops
  p.foldTo3BetOpp = 20;
  p.foldTo3BetMade = 18;       // 90% — folds 3-bets
  p.wtsd = 60;                 // 50% of hands played — a station
  p.streetActions.flop = { bet: 20, raise: 2, call: 8, check: 6, fold: 4 };
  p.streetActions.turn = { bet: 2, raise: 0, call: 6, check: 10, fold: 24 };
  p.streetActions.river = { bet: 3, raise: 0, call: 5, check: 8, fold: 20 };
  T.STORE.players[xid] = p;
  return p;
}

{
  const T = setup();
  villain(T, 'A');
  villain(T, 'B');
  const plan = T.buildExploitPlan(T.STORE.players.A);
  t.ok('the fixture villain really does have several reads to choose from', plan.length >= 3);
}

// The reported staleness, driven through the selector. A folded raiser must
// not keep the +1000 and go on being the player the coach talks about.

{
  const T = setup();
  villain(T, 'A');
  villain(T, 'B');
  T.currentHand = hand({
    playersIn: new Set(['B', 'HERO']),
    streetContributions: { A: 500, B: 0, HERO: 1500 },
    lastAggressor: 'A',
  });
  const tips = T.currentExploitTips(2);
  t.ok('a read is still produced', tips.length > 0);
  t.ok('but never about the player who folded', tips.every((x) => x.xid !== 'A'));
}

{
  const T = setup();
  villain(T, 'A');
  villain(T, 'B');
  T.currentHand = hand({ lastAggressor: 'A', streetContributions: { A: 500, HERO: 0 } });
  t.eq('a raiser still in the hand does lead the read', T.currentExploitTips(1)[0].xid, 'A');
}

// Two reads, and they must not be two phrasings of one.

{
  const T = setup();
  villain(T, 'A');
  villain(T, 'B');
  T.currentHand = hand({ lastAggressor: 'A', streetContributions: { A: 500, HERO: 0 } });
  const tips = T.currentExploitTips(2);
  t.eq('two reads are returned', tips.length, 2);
  const keys = tips.map((x) => x.xid + '|' + x.entry.tag);
  t.ok('and they are distinct reads, not one said twice', keys[0] !== keys[1]);
  t.ok('the runner-up has a short form for the second line',
    typeof tips[1].entry.short === 'string' && tips[1].entry.short.length > 0);
}

// Rotation, end to end: the same villain in the same spot on successive
// streets should not produce the same sentence forever.

{
  const T = setup();
  villain(T, 'A');
  const base = { lastAggressor: 'A', playersIn: new Set(['A', 'HERO']), streetContributions: { A: 500, HERO: 0 } };
  const seen = [];
  ['flop', 'turn', 'river'].forEach((street) => {
    T.currentHand = hand(Object.assign({ street }, base));
    // Twice per street, as the 1.5s panel would.
    T.currentExploitTips(1);
    seen.push(T.currentExploitTips(1)[0].entry.tag);
  });
  t.ok('the lead read changes across streets rather than repeating',
    new Set(seen).size > 1);
}

// ...and the same spot, re-rendered, does NOT change under you mid-decision.
// A panel whose advice reshuffles while you are reading it is worse than one
// that repeats.

{
  const T = setup();
  villain(T, 'A');
  T.currentHand = hand({ lastAggressor: 'A', playersIn: new Set(['A', 'HERO']), streetContributions: { A: 500, HERO: 0 } });
  const first = T.currentExploitTips(1)[0].entry.tag;
  const again = [0, 1, 2, 3, 4].map(() => T.currentExploitTips(1)[0].entry.tag);
  t.ok('re-rendering the same spot gives the same read every time',
    again.every((x) => x === first));
}

// --- the pool diagnostic --------------------------------------------------
//
// It exists so the NEXT tuning pass is measured rather than guessed, which is
// exactly how POOL_AVG got corrected in v1.11.0. It has to rank the way the
// live coach ranks, or it is a report about something nobody sees.

{
  const T = setup();
  ['A', 'B', 'C', 'D'].forEach((x) => villain(T, x));
  const sp = T.computePoolTipSpread();
  t.ok('a spread is reported once there are enough players', !!sp);
  t.eq('every qualifying player is counted', sp.withRead, 4);
  t.ok('the rows sum to the players with a read',
    sp.rows.reduce((a, r) => a + r.n, 0) === sp.withRead);
  t.ok('and they are ordered busiest first',
    sp.rows.every((r, i) => i === 0 || sp.rows[i - 1].n >= r.n));
}

{
  const T = setup();
  villain(T, 'A');
  t.eq('under three players it withholds rather than reporting noise',
    T.computePoolTipSpread(), null);
}

// It is memoised behind a TTL, because buildExploitPlan over hundreds of
// records is not something to run between keystrokes in the filter box.
// Asserted through the CACHED entry point, so a future change that drops the
// cache without meaning to shows up here rather than as a laggy panel on a
// phone nobody working on this can test.

{
  const T = setup();
  ['A', 'B', 'C', 'D'].forEach((x) => villain(T, x));
  const first = T.poolTipSpread();
  t.ok('the cached call returns a spread', !!first);
  ['E', 'F', 'G'].forEach((x) => villain(T, x));
  t.eq('a second call inside the TTL does not re-walk the store',
    T.poolTipSpread().withRead, first.withRead);
  t.eq('while the uncached one sees the new players immediately',
    T.computePoolTipSpread().withRead, 7);
}

process.exit(t.report());
