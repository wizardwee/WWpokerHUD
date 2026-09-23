// v1.83.0: table AFq in the softness summary, the new-table message, and the
// coach panel and its pill sharing one position.

const { load, runner } = require('./harness');

const t = runner('table-announce');

// --- tableAnnounceKind: when to say something --------------------------------

{
  const T = load();
  const K = T.tableAnnounceKind;
  const a = ['1', '2', '3', '4'];
  t.eq('the first settled table is new', K(null, a, a, false), 'new');
  t.eq('not before two identical sweeps (still rendering)', K(null, ['1', '2'], a, false), null);
  t.eq('no previous sweep, not settled', K(null, null, a, false), null);
  t.eq('fewer than TABLE_ANNOUNCE_MIN opponents says nothing', K(null, ['1'], ['1'], false), null);
  t.eq('the same table says nothing', K(a, a, a, false), null);
  t.eq('one player swapped in says nothing', K(a, ['1', '2', '3', '9'], ['1', '2', '3', '9'], false), null);
  const moved = ['5', '6', '7', '8'];
  t.eq('an entirely different roster is new', K(a, moved, moved, false), 'new');
  const half = ['1', '6', '7', '8'];
  t.eq('mostly replaced in place reads "changed", not new', K(a, half, half, false), 'changed');
  t.eq('a forced change (blind moved) is new even with the same faces', K(a, a, a, true), 'new');
  t.eq('order does not matter', K(null, ['2', '1'], ['1', '2'], false), 'new');
}

// --- noteTableForAnnounce: the flow, and the message --------------------------

{
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  const d = T._sandbox.document;
  const toast = () => d.querySelector('.tph-table-toast');

  t.eq('first sweep: not settled yet', T.noteTableForAnnounce(['A', 'B', 'C']), null);
  t.eq('no message yet', toast(), null);
  t.eq('second identical sweep announces', T.noteTableForAnnounce(['A', 'B', 'C']), 'new');
  t.ok('and a message is on screen', !!toast());
  t.ok('headed as a new table', /New table/.test(toast().innerHTML));
  t.ok('carrying the same summary as the coach line', /none rated yet/.test(toast().innerHTML));
  t.eq('a third identical sweep says nothing more', T.noteTableForAnnounce(['A', 'B', 'C']), null);

  T._sandbox.runTimers();
  t.eq('the message removes itself', toast(), null);

  // A blind change forces the next settled table to be announced.
  T.noteTableChange();
  t.eq('forced: announces on the next settled sweep', T.noteTableForAnnounce(['A', 'B', 'C']), 'new');
  T._sandbox.runTimers();

  // Switched off: still tracked (so switching it back on does not announce a
  // table you have been sitting at for an hour), but no message.
  T.STORE.settings.tableAnnounce = false;
  T.noteTableForAnnounce(['X', 'Y', 'Z']);
  t.eq('with the setting off, a new table is still recognised', T.noteTableForAnnounce(['X', 'Y', 'Z']), 'new');
  t.eq('but no message appears', toast(), null);
  t.eq('the default is on', T.DEFAULT_SETTINGS.tableAnnounce, true);

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
  t.ok('the message never takes a tap (pointer-events: none)',
    /\.tph-table-toast \{[^}]*pointer-events: none/.test(src));
}

// --- Table AFq -------------------------------------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const mk = (xid, bet, call) => {
    const p = T.emptyPlayer(xid, xid);
    p.hands = 400; p.vpip = 160; p.pfr = 40;
    p.streetActions.flop.bet = bet; p.streetActions.flop.call = call;
    T.STORE.players[xid] = p;
  };
  mk('a', 6, 4);   // 60% over 10 actions
  mk('b', 2, 8);   // 20% over 10
  mk('c', 1, 1);   // 50% but only 2 actions: left out
  const s = T.tableSoftness(['a', 'b', 'c']);
  t.eq('table AFq averages players with enough postflop actions', s.avgAfq, 40);
  t.ok('and it is in the summary', /AFq 40%/.test(T.tableSoftnessHtml(['a', 'b', 'c'])));
  T.STORE.players.a.streetActions.flop = { bet: 0, raise: 0, call: 0, check: 0, fold: 0 };
  T.STORE.players.b.streetActions.flop = { bet: 0, raise: 0, call: 0, check: 0, fold: 0 };
  t.eq('no one with enough actions: null, not 0', T.tableSoftness(['a', 'b', 'c']).avgAfq, null);
  t.ok('and the summary leaves it out', !/AFq/.test(T.tableSoftnessHtml(['a', 'b', 'c'])));
}

// --- The coach pill and panel share one position ---------------------------------
//
// Reported: moving the panel did not move the pill. Collapsing now hands the
// panel's corner to the pill, and expanding hands the pill's back. The harness
// cannot finish building the panel (its inner lookups need a real document),
// so the panel element is stood in for with the one thing setCoachHidden
// reads from it: where it is.

{
  const T = load({ dom: 'class' });
  T.STORE = T.emptyStore();
  const d = T._sandbox.document;
  const fakePanel = d.createElement('div');
  fakePanel.className = 'tph-coach';
  fakePanel.getBoundingClientRect = () => ({ left: 37, top: 211, width: 300, height: 200 });
  d.body.appendChild(fakePanel);
  T.setCoachHidden(true);
  t.eq('collapsing stores the panel corner as the shared position',
    JSON.stringify(T.STORE.settings.coachPos), JSON.stringify({ left: 37, top: 211 }));
  const pill = d.querySelector('.tph-coach-pill');
  t.ok('the pill appears', !!pill);
  t.eq('where the panel was (left)', pill.style.left, '37px');
  t.eq('where the panel was (top)', pill.style.top, '211px');

  pill.getBoundingClientRect = () => ({ left: 120, top: 400, width: 90, height: 24 });
  try { T.setCoachHidden(false); } catch (e) { /* panel build needs a real document */ }
  t.eq('expanding hands the pill position back to the panel',
    JSON.stringify(T.STORE.settings.coachPos), JSON.stringify({ left: 120, top: 400 }));

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
  t.ok('nothing reads the retired coachPillPos key', !/settings\.coachPillPos|'coachPillPos'/.test(src));
}

process.exit(t.report());
