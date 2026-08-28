// dropStaleHeroGhost — removing a `name:<username>` record for HERO left over
// from before hero was bound to a seat.
//
// WHY IT IS SAFE TO DELETE RATHER THAN MERGE. Two live scans a session apart
// showed the ghost frozen at 7 hands while hero's real record moved from 8911
// to 8924. It no longer grows — v1.38.0 closed the leak by binding hero before
// parsing any log line. What remains is orphaned residue that still skews
// observedPoolAverages and occupies a prune slot.
//
// Merging is the option NOT taken, deliberately: hands and dealtInXids were
// always counted through the seat path, so folding the ghost into the real
// record would double-count them. mergePseudoPlayer already bails when the
// real record exists for exactly this reason.

const { load, runner } = require('./harness');

const t = runner('hero-ghost-cleanup');

function setup(opts) {
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.heroName = opts.heroName;
  T.heroXid = opts.heroXid;
  (opts.players || []).forEach(([key, hands]) => {
    T.STORE.players[key] = T.emptyPlayer(key, key);
    T.STORE.players[key].hands = hands;
  });
  return T;
}

// --- the normal case ------------------------------------------------------

{
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: '311421',
    players: [['311421', 8924], ['name:Wonkawee', 7]],
  });

  t.eq('the ghost is dropped', T.dropStaleHeroGhost(), true);
  t.eq('and is gone from the store', T.STORE.players['name:Wonkawee'], undefined);
  t.ok('while the real record is untouched', !!T.STORE.players['311421']);
  t.eq('with its hand count intact', T.STORE.players['311421'].hands, 8924);

  // Idempotent: the watcher calls this every 3s forever.
  t.eq('a second call finds nothing to do', T.dropStaleHeroGhost(), false);
}

// --- it must never delete the only copy of hero's data --------------------

{
  // heroXid resolved, ghost present, but NO real record yet. Dropping here
  // would discard hero's only data.
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: '311421',
    players: [['name:Wonkawee', 7]],
  });
  t.eq('with no real record, nothing is dropped', T.dropStaleHeroGhost(), false);
  t.ok('and the ghost survives as the only copy', !!T.STORE.players['name:Wonkawee']);
}

// --- hero unresolved: the pseudo-id may still be the live record ----------

{
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: null,
    players: [['311421', 8924], ['name:Wonkawee', 7]],
  });
  t.eq('with hero unresolved, nothing is dropped', T.dropStaleHeroGhost(), false);
  t.ok('the ghost survives', !!T.STORE.players['name:Wonkawee']);
}

{
  // heroUnresolved() is true for the PSEUDO-ID too, not just null — that is
  // the v0.20.0 lesson, and the guard has to honour it or this would delete
  // the very record hero is currently being tracked under.
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: 'name:Wonkawee',
    players: [['311421', 8924], ['name:Wonkawee', 7]],
  });
  t.eq('a pseudo-id heroXid counts as unresolved, so nothing is dropped',
    T.dropStaleHeroGhost(), false);
  t.ok('and the record it points at survives', !!T.STORE.players['name:Wonkawee']);
}

// --- no username configured ----------------------------------------------

{
  const T = setup({ heroName: '', heroXid: '311421', players: [['311421', 10]] });
  t.eq('with no username set there is nothing to match', T.dropStaleHeroGhost(), false);
}

// --- only HERO's ghost, never anyone else's ------------------------------

{
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: '311421',
    players: [['311421', 8924], ['name:Wonkawee', 7], ['name:SomeoneElse', 40]],
  });
  T.dropStaleHeroGhost();
  t.eq('hero\'s ghost goes', T.STORE.players['name:Wonkawee'], undefined);
  // Another player's pseudo-record is a genuine tracked opponent this HUD has
  // simply never matched to a seat. It is not residue and must survive.
  t.ok('another player\'s pseudo-record is left alone', !!T.STORE.players['name:SomeoneElse']);
  t.eq('with its hands intact', T.STORE.players['name:SomeoneElse'].hands, 40);
}

// --- case-insensitive, because the key comes from log text ---------------

{
  const T = setup({
    heroName: 'Wonkawee',
    heroXid: '311421',
    players: [['311421', 8924], ['name:wonkawee', 7]],
  });
  t.eq('a differently-cased ghost key is still matched', T.dropStaleHeroGhost(), true);
  t.eq('and removed', T.STORE.players['name:wonkawee'], undefined);
}

process.exit(t.report());
