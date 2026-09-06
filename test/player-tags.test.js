// Manual player tags: your own read, asserted by hand.
//
// Every other read in this file is derived from counters. These are the
// opposite, and that is the whole reason they are allowed to exist: each one
// covers something the stats cannot see STRUCTURALLY rather than merely have a
// thin sample of. bluffRate only counts bets that reached a real showdown, so
// a bluff that took the pot is invisible to it; texture.checkMade needs a
// showdown to record a slowplay, so the check-raise that made you fold never
// enters the sample.
//
// The assertion that matters most is the merge one. A counter is rebuilt by
// playing more hands; a manual read is judgement and cannot be. mergeStores
// swaps the whole player record for whichever side has more hands, so before
// this it silently destroyed p.notes too — that half is a bug fix, not a new
// feature, and it is pinned here alongside.

const { load, runner } = require('./harness');

const t = runner('player-tags');

function mk(T, xid, o) {
  return (T.STORE.players[xid] = Object.assign(T.emptyPlayer(xid, xid), o));
}

// --- the vocabulary ---------------------------------------------------------

{
  const T = load();
  t.eq('there are four tags', T.PLAYER_TAGS.length, 4);

  const keys = T.PLAYER_TAGS.map((x) => x.key);
  t.eq('every key is distinct', new Set(keys).size, keys.length);

  const glyphs = T.PLAYER_TAGS.map((x) => x.glyph);
  t.eq('every glyph is distinct', new Set(glyphs).size, glyphs.length);

  // Each has to answer "so what do I DO", or it is a label rather than a read.
  const noAct = T.PLAYER_TAGS.filter((x) => !x.act || x.act.length < 10);
  t.eq(`every tag carries an action${noAct.length ? ' — ' + noAct.map((x) => x.key).join(', ') : ''}`,
    noAct.length, 0);
  const noLabel = T.PLAYER_TAGS.filter((x) => !x.label);
  t.eq('and a label', noLabel.length, 0);
}

{
  // This runs on whatever Safari the phone has. A variation selector (U+FE0F)
  // or a surrogate-pair-plus-modifier sequence is exactly what renders as a
  // hollow box on the one device nobody working on this can test — and the
  // badge is 118px wide, so a glyph that renders double-width costs a read.
  const T = load();
  const bad = [];
  T.PLAYER_TAGS.forEach((x) => {
    if (/️|︎/.test(x.glyph)) bad.push(x.key + ' has a variation selector');
    if (/‍/.test(x.glyph)) bad.push(x.key + ' is a ZWJ sequence');
    // One codepoint — which is two UTF-16 units for anything above the BMP.
    if ([...x.glyph].length !== 1) bad.push(x.key + ' is not a single codepoint');
  });
  t.eq(`every glyph is a bare single codepoint${bad.length ? ' — ' + bad.join(', ') : ''}`,
    bad.length, 0);
}

// --- setting, clearing, and staying sparse ----------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, '999', { hands: 50 });

  t.eq('a fresh record has no tag field at all', 'tag' in p, false);
  t.eq('and reads as untagged', T.playerTag(p), null);

  T.setPlayerTag('999', 'bluff');
  t.eq('setting a tag stores the key', p.tag, 'bluff');
  t.eq('and reads back as the definition', T.playerTag(p).glyph, T.playerTagDef('bluff').glyph);

  T.setPlayerTag('999', 'station');
  t.eq('a second tag REPLACES the first — they are mutually exclusive', p.tag, 'station');

  // Re-tapping the active chip clears it: the same control both ways, so there
  // is no separate "none" chip to hunt for on a phone.
  T.setPlayerTag('999', 'station');
  t.eq('re-setting the active tag clears it', T.playerTag(p), null);
  t.eq('and DELETES the field rather than storing a null',
    'tag' in p, false);
}

{
  const T = load();
  T.STORE = T.emptyStore();
  const p = mk(T, '999', { hands: 50 });
  T.setPlayerTag('999', 'nonsense-key');
  t.eq('an unknown key is refused rather than stored', 'tag' in p, false);

  // A key that stopped existing (a tag removed in a later version) must read
  // as untagged, not throw — the record outlives the vocabulary.
  p.tag = 'retired-tag';
  t.eq('a stale key reads as untagged', T.playerTag(p), null);
  t.eq('and playerTagDef agrees', T.playerTagDef('retired-tag'), null);
  t.eq('as does an empty key', T.playerTagDef(''), null);
}

// --- the merge must never destroy a manual read -----------------------------

{
  // The exact shape that was already losing notes: the OTHER device has seen
  // this player more, so its record wins the swap and everything typed here
  // goes with it.
  const T = load();
  const local = T.emptyStore();
  local.players['999'] = Object.assign(T.emptyPlayer('999', 'Villain'),
    { hands: 40, tag: 'bluff', notes: 'shoves rivers' });
  const remote = T.emptyStore();
  remote.players['999'] = Object.assign(T.emptyPlayer('999', 'Villain'), { hands: 900 });

  const m = T.mergeStores(local, remote);
  t.eq('the record with more hands still wins', m.players['999'].hands, 900);
  t.eq('but the local TAG survives it', m.players['999'].tag, 'bluff');
  t.eq('and so does the local note', m.players['999'].notes, 'shoves rivers');
}

{
  // And the reverse: local has more hands but no read, remote carries one.
  const T = load();
  const local = T.emptyStore();
  local.players['999'] = Object.assign(T.emptyPlayer('999', 'V'), { hands: 900 });
  const remote = T.emptyStore();
  remote.players['999'] = Object.assign(T.emptyPlayer('999', 'V'),
    { hands: 40, tag: 'trap', notes: 'check-raised me twice' });

  const m = T.mergeStores(local, remote);
  t.eq('the local record is still kept', m.players['999'].hands, 900);
  t.eq('and adopts the remote tag it did not have', m.players['999'].tag, 'trap');
  t.eq('and the remote note', m.players['999'].notes, 'check-raised me twice');
}

{
  // Both tagged, differently. Local wins — there is no timestamp to order them
  // by, and the alternative overwrites what you can see on the device you are
  // sitting at with something you cannot.
  const T = load();
  const local = T.emptyStore();
  local.players['999'] = Object.assign(T.emptyPlayer('999', 'V'), { hands: 10, tag: 'station' });
  const remote = T.emptyStore();
  remote.players['999'] = Object.assign(T.emptyPlayer('999', 'V'), { hands: 900, tag: 'folds' });

  const m = T.mergeStores(local, remote);
  t.eq('local wins a genuine disagreement', m.players['999'].tag, 'station');
  t.eq('while the counters still come from the fuller record', m.players['999'].hands, 900);
}

{
  // The merge must not write through to either input. remote is the caller's
  // freshly parsed gist; editing it would corrupt an object they still hold.
  const T = load();
  const local = T.emptyStore();
  local.players['999'] = Object.assign(T.emptyPlayer('999', 'V'), { hands: 40, tag: 'bluff' });
  const remote = T.emptyStore();
  remote.players['999'] = Object.assign(T.emptyPlayer('999', 'V'), { hands: 900 });

  T.mergeStores(local, remote);
  t.eq('the remote record is not mutated', 'tag' in remote.players['999'], false);
  t.eq('and the local record is left alone too', local.players['999'].hands, 40);
}

{
  // A player only the remote knows about still arrives with their tag.
  const T = load();
  const local = T.emptyStore();
  const remote = T.emptyStore();
  remote.players['777'] = Object.assign(T.emptyPlayer('777', 'New'), { hands: 30, tag: 'folds' });
  const m = T.mergeStores(local, remote);
  t.eq('a remote-only player keeps their tag', m.players['777'].tag, 'folds');
}

// --- it reaches the written report -----------------------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.settings.minHands = 20;
  mk(T, '999', { hands: 200, vpip: 60, pfr: 20 });
  T.setPlayerTag('999', 'bluff');

  const text = T.buildReport('999');
  const def = T.playerTagDef('bluff');
  t.ok('the report names the tag', text.indexOf(def.label) !== -1);
  t.ok('and carries its action', text.indexOf(def.act) !== -1);
  // A reader who cannot tell an asserted line from a measured one has no way
  // to weigh it against the rest of the report.
  t.ok('and says outright that it is yours, not a measurement',
    /by you/i.test(text) && /not a measurement/i.test(text));

  T.setPlayerTag('999', 'bluff'); // clear
  t.ok('an untagged player says nothing about tags',
    T.buildReport('999').indexOf(def.label) === -1);
}

process.exit(t.report());
