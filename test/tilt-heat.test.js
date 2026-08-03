// Tilt (🤮) and running hot (🔥).
//
// These are opposite kinds of read and are deliberately measured differently:
//
//   Tilt is RELATIVE — a player is tilting when they play differently from how
//   THEY normally play. Absolute looseness says nothing; a station who has
//   always played 70% is not tilting, that is just who they are.
//
//   Heat is ABSOLUTE — the point is simply that they are scooping pots, and
//   winning 40% of hands is remarkable regardless of anyone's baseline.

const { load, runner } = require('./harness');

const t = runner('tilt-heat');
const T = load();
T.STORE = T.emptyStore();

const PLAY = 1;
const RAISE = 2;
const FOLD = 0;
const WON = T.RECENT_WON;

function player(lifetimeHands, lifetimeVpipPct, codes, extra) {
  const p = T.emptyPlayer('p', 'Test');
  p.hands = lifetimeHands;
  p.vpip = Math.round((lifetimeVpipPct / 100) * lifetimeHands);
  codes.forEach((c) => T.pushRecent(p, c));
  return Object.assign(p, extra || {});
}
const rep = (n, code) => Array(n).fill(code);

// --- The window is capped independently of the badge setting ---------------

// Tilt is a short-lived state. Reading it over more hands blends the tilt
// stretch back into normal play, so the signal fades exactly when it is truest.
T.STORE.settings.sessionWindow = 40;
t.eq('a long badge window does not widen the tilt window', T.tiltWindowSize(), T.TILT_WINDOW_MAX);
t.ok('and the cap is 15 or under', T.TILT_WINDOW_MAX <= 15);

T.STORE.settings.sessionWindow = 10;
t.eq('a shorter badge window is used as-is', T.tiltWindowSize(), 10);
T.STORE.settings.sessionWindow = 15;

// --- Tilt is relative to the player's own baseline -------------------------

{
  const p = player(200, 20, rep(15, PLAY));
  const r = T.tiltRead(p);
  t.ok('a nit suddenly playing everything is flagged', !!r);
  t.ok('the baseline excludes the recent window', r.baseline < 25);
  t.ok('the jump clears the no-corroboration threshold', r.jump >= T.TILT_VPIP_JUMP);
}

{
  // Loose forever is not tilt.
  const p = player(200, 70, rep(11, PLAY).concat(rep(4, FOLD)));
  t.eq('a permanent station is never flagged', T.tiltRead(p), null);
}

{
  const p = player(200, 50, rep(7, PLAY).concat(rep(8, FOLD)));
  t.eq('playing their normal game is not flagged', T.tiltRead(p), null);
}

// --- A big loss lowers the bar; it never flags on its own ------------------

{
  // A modest 14pt jump: under the 20pt bar on its own.
  const codes = rep(6, PLAY).concat(rep(9, FOLD)); // 40% over 15
  const plain = player(300, 26, codes);
  t.eq('a modest jump alone is not tilt', T.tiltRead(plain), null);

  // Same behaviour, but they just lost a big pot. The loss raises the prior
  // that this IS tilt rather than a run of playable cards, so less behavioural
  // evidence is needed for the same confidence.
  const stung = player(300, 26, codes);
  stung.lastBigLossHand = stung.hands - 3;
  const r = T.tiltRead(stung);
  t.ok('the same jump after a big loss IS tilt', !!r);
  t.eq('and the read says how long ago', r.sinceBigLoss, 3);
  t.ok('the lowered bar is genuinely lower', T.TILT_VPIP_JUMP_AFTER_LOSS < T.TILT_VPIP_JUMP);
}

{
  // Losing money is not tilt. Someone who just lost a big pot but is playing
  // exactly as they always do must not be flagged.
  const p = player(300, 26, rep(4, PLAY).concat(rep(11, FOLD)));
  p.lastBigLossHand = p.hands - 1;
  t.eq('a big loss with no behaviour change is not tilt', T.tiltRead(p), null);
}

{
  // The sting wears off.
  const codes = rep(6, PLAY).concat(rep(9, FOLD));
  const p = player(300, 26, codes);
  p.lastBigLossHand = p.hands - (T.BIG_LOSS_MEMORY_HANDS + 5);
  t.eq('an old big loss no longer corroborates', T.handsSinceBigLoss(p), null);
  t.eq('so the modest jump is not flagged', T.tiltRead(p), null);
}

// --- Gates ------------------------------------------------------------------

t.eq('no baseline, no tilt read', T.tiltRead(player(12, 20, rep(15, PLAY))), null);
t.eq('too thin a window, no tilt read', T.tiltRead(player(200, 20, rep(4, PLAY))), null);
t.eq('no player, no read', T.tiltRead(null), null);

// --- Running hot ------------------------------------------------------------

{
  // Won 6 of the last 12 — far above the ~11-17% a seat count makes likely.
  const p = player(200, 40, rep(6, PLAY | WON).concat(rep(6, PLAY)));
  const h = T.heatRead(p);
  t.ok('winning half the recent hands is hot', !!h);
  t.eq('it counts the wins', h.won, 6);
  t.eq('and reports the rate', h.winPct, 50);
}

{
  // A normal share of wins is not heat.
  const p = player(200, 40, rep(1, PLAY | WON).concat(rep(11, PLAY)));
  t.eq('winning one of twelve is not hot', T.heatRead(p), null);
}

{
  // Too few hands to say anything.
  const p = player(200, 40, rep(3, PLAY | WON));
  t.eq('a three-hand window is not enough', T.heatRead(p), null);
}

// Heat is absolute, not relative: a player who always runs well still reads hot
// while they are winning, because the read is "they are scooping pots".
{
  const p = player(200, 40, rep(5, PLAY | WON).concat(rep(5, FOLD)));
  t.ok('heat does not care about their baseline', !!T.heatRead(p));
}

// --- The win bit does not disturb the play states --------------------------

// Old stored values are 0-2 with no win bit, so they must still read correctly
// as "played, did not win" — no migration needed.
{
  const legacy = T.emptyPlayer('L', 'Legacy');
  [0, 1, 2, 1, 2, 0, 1, 2, 1, 0].forEach((c) => T.pushRecent(legacy, c));
  const s = T.sessionRates(legacy, 10);
  t.eq('legacy VPIP still reads', s.vpip, 70);
  t.eq('legacy PFR still reads', s.pfr, 30);
  t.eq('legacy hands won reads as none', T.sessionWinRate(legacy, 10).won, 0);
}

{
  // With the win bit set, the play state must be unchanged.
  const p = T.emptyPlayer('W', 'Winner');
  [RAISE | WON, PLAY | WON, FOLD | WON, RAISE, PLAY, FOLD].forEach((c) => T.pushRecent(p, c));
  const s = T.sessionRates(p, 6);
  t.eq('raises still counted with the win bit set', s.pfr, (100 * 2) / 6);
  t.eq('plays still counted with the win bit set', s.vpip, (100 * 4) / 6);
  t.eq('wins counted independently', T.sessionWinRate(p, 6).won, 3);
}

// --- Both states can be true at once ---------------------------------------

// A player can be steaming AND getting there — they are different questions,
// so the badge must be able to show both.
{
  const p = player(200, 20, rep(15, PLAY | WON));
  t.ok('tilting', !!T.tiltRead(p));
  t.ok('and hot', !!T.heatRead(p));
}

// --- Wording ----------------------------------------------------------------

{
  const p = player(200, 20, rep(15, PLAY));
  p.lastBigLossHand = p.hands - 2;
  const text = T.tiltText(T.tiltRead(p));
  t.ok('tilt text uses the sick emoji', text.includes('🤮'));
  t.ok('tilt text is not the fire emoji', !text.includes('🔥'));
  t.ok('tilt text mentions the big pot', /big pot/.test(text));

  const hot = T.heatText(T.heatRead(player(200, 40, rep(6, PLAY | WON).concat(rep(6, PLAY)))));
  t.ok('heat text uses the fire emoji', hot.includes('🔥'));
  t.ok('heat text is not the sick emoji', !hot.includes('🤮'));
}

process.exit(t.report());
