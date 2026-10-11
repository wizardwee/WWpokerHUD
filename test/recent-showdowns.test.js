// Each player's last SD_RECENT_MAX showdowns, highlighted in the Range tab
// (v1.100.0). Recorded live from the same tier/limp-raise the lifetime
// counters use, and seeded once from saved history by re-deriving tiers from
// each stored hand's actions. That re-derivation is a second reading of the
// raise order, so the block below drives random preflop action through the
// real parser and requires the two readings to agree on every hand.

const { load, runner } = require('./harness');

const t = runner('recent-showdowns');
const fmt = (n) => '$' + n.toLocaleString('en-US');
const BB = 2500000;

// --- Live: one hand with an open, a limp-3bet and a call -------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = BB;
  const L = [
    'Game abc001 started',
    `Sbee posted small blind ${fmt(BB / 2)}`,
    `Bbee posted big blind ${fmt(BB)}`,
    `Limper called ${fmt(BB)}`,
    `Opener raised ${fmt(BB * 2)} to ${fmt(BB * 3)}`,
    'Sbee folded',
    'Bbee folded',
    `Limper raised ${fmt(BB * 6)} to ${fmt(BB * 9)}`,
    `Opener called ${fmt(BB * 6)}`,
    'The flop:  2♣, 7♦, K♠',
    'Limper checked',
    'Opener checked',
    'The turn:  9♥',
    'Limper checked',
    'Opener checked',
    'The river:  4♣',
    'Limper checked',
    'Opener checked',
    'Limper reveals [A♠, K♠] (Pair of Kings)',
    'Opener reveals [Q♥, Q♦] (Pair of Queens)',
    `Limper won ${fmt(BB * 19)}`,
    'Game abc002 started',
  ];
  L.forEach((l) => T.handleLogLine(l));
  const limper = T.STORE.players['name:Limper'];
  const opener = T.STORE.players['name:Opener'];
  t.eq('the limp-3bettor is filed as 3-bet + limp-raise', JSON.stringify(limper.sdRecent), '["2LAKs"]');
  t.eq('the opener who called the 3-bet keeps tier 1', JSON.stringify(opener.sdRecent), '["1QQ"]');
  t.eq('a player with no showdown carries no window', T.STORE.players['name:Sbee'].sdRecent, undefined);

  const r = (p, mode, cls) => (T.shownRange(p, mode).find((e) => e.cls === cls) || {}).recent;
  t.eq('recent in its tier group', r(limper, 'threebet', 'AKs'), 1);
  t.eq('recent in the limp-3bet subset', r(limper, 'limpraise', 'AKs'), 1);
  t.eq('not counted as an open', T.shownRange(limper, 'open').length, 0);
  t.eq('parse round-trips', JSON.stringify(T.parseRecentShowdown('2LAKs')), '{"tier":2,"lr":true,"cls":"AKs"}');
  t.eq('a pair parses', JSON.stringify(T.parseRecentShowdown('0TT')), '{"tier":0,"lr":false,"cls":"TT"}');
  t.eq('garbage does not', T.parseRecentShowdown('9AKs'), null);
}

// --- Agreement: live tiers vs re-derived from the stored action list -------
{
  const T = load();
  T.STORE = T.emptyStore();
  T.lastSeenBB = BB;
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const NAMES = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus'];
  const bad = [];
  let tiered = 0;
  let limpRaises = 0;
  for (let g = 0; g < 400; g++) {
    const n = 3 + Math.floor(rnd() * 5);
    const seats = NAMES.slice(0, n);
    T.handleLogLine(`Game ${(0xb00000 + g).toString(16)} started`);
    T.handleLogLine(`${seats[0]} posted small blind ${fmt(BB / 2)}`);
    T.handleLogLine(`${seats[1]} posted big blind ${fmt(BB)}`);
    const order = seats.slice(2).concat(seats.slice(0, 2));
    let bet = BB;
    const street = {};
    street[seats[0]] = BB / 2; street[seats[1]] = BB;
    const live = new Set(seats);
    let toAct = order.slice();
    for (let guard = 0; toAct.length && guard < 40; guard++) {
      const p = toAct.shift();
      if (!live.has(p)) continue;
      const owe = bet - (street[p] || 0);
      const r = rnd();
      if (owe > 0 && r < 0.3) { T.handleLogLine(`${p} folded`); live.delete(p); }
      else if (r < 0.75 || bet >= BB * 60) {
        if (owe > 0) { T.handleLogLine(`${p} called ${fmt(owe)}`); street[p] = bet; }
        else T.handleLogLine(`${p} checked`);
      } else {
        const to = bet * 3;
        T.handleLogLine(`${p} raised ${fmt(to - bet)} to ${fmt(to)}`);
        street[p] = to; bet = to;
        toAct = order.filter((q) => live.has(q) && q !== p);
      }
      if (live.size === 1) break;
    }
    const h = T.currentHand;
    const d = T.preflopTiersFromActions(h.actions);
    const liveTier = JSON.stringify(Object.keys(h.preflopTier).sort().map((x) => [x, h.preflopTier[x]]));
    const derTier = JSON.stringify(Object.keys(d.tier).sort().map((x) => [x, d.tier[x]]));
    const liveLr = JSON.stringify(Array.from(h.limpRaised).sort());
    const derLr = JSON.stringify(Array.from(d.limpRaised).sort());
    if ((liveTier !== derTier || liveLr !== derLr) && bad.length < 3) {
      bad.push(`hand ${g}: tiers ${liveTier} vs ${derTier}; limp-raise ${liveLr} vs ${derLr}`);
    }
    tiered += Object.keys(h.preflopTier).length;
    limpRaises += h.limpRaised.size;
    T.handleLogLine(`${Array.from(live)[0]} won ${fmt(BB * 3)} Did not show hand`);
  }
  t.eq('re-derived tiers and limp-raises match the live ones on every hand', bad.join('\n'), '');
  t.ok('...over a sample that has raises and limp-raises in it', tiered > 200 && limpRaises > 5);
}

// The big blind is never a limper (maybeCountLimp's rule). Real hands never
// reach it — the BB checks an unraised pot — so the fuzz above cannot pin it.
{
  const T = load();
  const d = T.preflopTiersFromActions([
    { x: 'bb', a: 'bb', s: 'preflop' },
    { x: 'bb', a: 'call', s: 'preflop' },
    { x: 'sb', a: 'call', s: 'preflop' },
    { x: 'bb', a: 'raise', s: 'preflop' },
    { x: 'sb', a: 'raise', s: 'preflop' },
  ]);
  t.eq('a big-blind "call" before any raise is not a limp', d.limpRaised.has('bb'), false);
  t.eq('...a small-blind completion is', d.limpRaised.has('sb'), true);
  t.eq('...and tiers count in order', JSON.stringify(d.tier), '{"bb":1,"sb":2}');
}

// --- Backfill from saved history --------------------------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  const S = T.STORE;
  S.players.a = T.emptyPlayer('a', 'Ann');
  S.players.b = T.emptyPlayer('b', 'Bob');
  S.players.c = T.emptyPlayer('c', 'Cat');
  S.players.c.sdRecent = ['0T9s']; // already has a window: must not be appended to
  const hand = (shown, actions) => ({ t: 1, shown, actions: actions || [] });
  // STORE.hands is newest first.
  S.hands = [
    hand({ a: 'K♠ K♦', b: 'garbage' }, [
      { x: 'z', a: 'bb', s: 'preflop' },
      { x: 'a', a: 'raise', s: 'preflop' },
      { x: 'b', a: 'raise', s: 'preflop' },
      { x: 'a', a: 'raise', s: 'preflop' },
    ]),
    hand({ a: 'A♥ 5♥', c: '7♣ 2♦', gone: 'Q♠ Q♣' }, [
      { x: 'z', a: 'bb', s: 'preflop' },
      { x: 'a', a: 'call', s: 'preflop' },
      { x: 'c', a: 'raise', s: 'preflop' },
      { x: 'a', a: 'raise', s: 'preflop' },
    ]),
    hand({ b: '9♦ 8♦' }, [{ x: 'b', a: 'bb', s: 'preflop' }, { x: 'b', a: 'raise', s: 'flop' }]),
  ];
  const filled = T.backfillRecentShowdowns();
  t.eq('oldest first, with the tier each hand gave', JSON.stringify(S.players.a.sdRecent), '["2LA5s","3KK"]');
  t.eq('the big blind\'s check-through is a call, and an unparsed reveal is skipped', JSON.stringify(S.players.b.sdRecent), '["098s"]');
  t.eq('a window already filled is left alone', JSON.stringify(S.players.c.sdRecent), '["0T9s"]');
  t.eq('a pruned player creates nothing', S.players.gone, undefined);
  t.eq('reports the players it filled', filled, 2);
  t.ok('sets its flag', S.sdRecentBackfilled === true);
  S.players.a.sdRecent = [];
  t.eq('runs once', T.backfillRecentShowdowns(), 0);
  t.eq('...and the second call wrote nothing', S.players.a.sdRecent.length, 0);
}

// --- Cap, and the cap against the lifetime count ----------------------------
{
  const T = load();
  T.STORE = T.emptyStore();
  const card = (r, su) => ({ rank: r, suit: su });
  const hand = { preflopTier: {}, limpRaised: new Set(), countedPfr: new Set(), winners: [] };
  T.noteShowdown('x', [card('2', '♠'), card('3', '♥')], hand);
  for (let i = 0; i < 60; i++) T.noteShowdown('x', [card('A', '♠'), card('A', '♥')], hand);
  const p = T.STORE.players.x;
  t.eq(`capped at ${T.SD_RECENT_MAX}`, p.sdRecent.length, T.SD_RECENT_MAX);
  t.ok('the oldest falls off first', p.sdRecent.indexOf('032o') < 0);
  t.eq('the dropped class is no longer recent', T.shownRange(p, 'all').find((e) => e.cls === '32o').recent, 0);
  t.eq('the kept one counts its recent showdowns', T.shownRange(p, 'all').find((e) => e.cls === 'AA').recent, 50);
  p.sdRecent = ['0KK', '0KK', '0KK'];
  p.shownHands.KK = { seen: 1, raised: 0, won: 0 };
  t.eq('recent never exceeds the lifetime count', T.shownRange(p, 'called').find((e) => e.cls === 'KK').recent, 1);
}

// --- Rendering ---------------------------------------------------------------
{
  const T = load();
  const p = {
    shownHands: { AKs: { seen: 3, raised: 3, won: 2 }, '72o': { seen: 2, raised: 0, won: 0 } },
    sdRecent: ['1AKs'],
  };
  const html = T.buildRangeHtml(p);
  t.ok('a recent class is highlighted', /tph-range-hand tph-range-recent"[^>]*>AKs/.test(html));
  t.ok('an old one is not', /class="tph-range-hand" title="72o/.test(html));
  t.ok('the key names the window', html.indexOf(`in their last ${T.SD_RECENT_MAX}`) > 0);
  t.ok('the group says how many are recent', html.indexOf('3 showdowns · 1 recent') > 0);
  t.ok('the tooltip says it too', html.indexOf('(1 recent)') > 0);
  t.ok('no window: no key', T.buildRangeHtml({ shownHands: p.shownHands }).indexOf('tph-range-recent') < 0);
}

process.exit(t.report());
