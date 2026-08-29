// How a stored hand is rendered — see formatHand / formatHandHtml.
//
// Both bugs here came from one reported screenshot of the History tab, and
// both are the same class: the same fact written or shown twice, differently.
//
//   1. TWO FORMATS FOR SHOWN CARDS. `hand.shown` has two writers — the log's
//      reveal line and the seat harvester — and they disagreed. One produced
//      "KH KS", the other "[7♥, J♦]". The screenshot had both inside a single
//      hand, one line apart.
//   2. A BARE "shows" MID-STREET. logAction records 'shows' as an action, so
//      the street list rendered "JonnySince shows" — an action with no amount,
//      reading as truncated — and then the showdown line said the same thing
//      again two lines below, that time with the cards.
//
// formatHand (clipboard/export) and formatHandHtml (screen) are separate
// renderers of one hand, so every assertion below checks BOTH. That split is
// exactly where a fix lands in one and not the other.

const { load, runner } = require('./harness');

const t = runner('hand-render');
const act = (x, a, s, amt) => ({ x, a, s, amt: amt || 0 });

function hand(o) {
  return Object.assign({
    t: Date.now(), pot: 1000, bb: 0, street: 'river',
    players: ['V', 'W'], actions: [], winners: [], shown: {}, board: [],
  }, o);
}

// --- 'shows' never renders as a betting action ---------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.V = T.emptyPlayer('V', 'JonnySince');
  T.STORE.players.W = T.emptyPlayer('W', 'Jaywattsdj');

  const h = hand({
    actions: [
      act('W', 'raise', 'river', 165800000),
      act('V', 'call', 'river', 165800000),
      act('V', 'shows', 'river'),
    ],
    shown: { V: '7♥ J♦' },
  });

  const text = T.formatHand(h, 'W');
  const html = T.formatHandHtml(h, 'W');

  // The river line keeps the real actions...
  t.ok('the plain river line still lists the raise', text.indexOf('raise') !== -1);
  t.ok('and the call', text.indexOf('call') !== -1);
  // ...but not the reveal.
  t.eq('the plain river line does not carry a bare "shows"',
    /river:[^\n]*shows/.test(text), false);
  t.eq('nor does the markup one', /tph-hh-st[^<]*>river<\/span>[^<]*shows/.test(html), false);

  // The showdown line is where a reveal belongs, and it survives.
  t.ok('the showdown line still reports it', text.indexOf('showdown') !== -1);
  t.ok('with the cards', text.indexOf('7♥ J♦') !== -1);
  t.ok('and in the markup too', html.indexOf('7♥ J♦') !== -1);
}

// --- a street whose ONLY action was a reveal is dropped, not left empty ---

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.V = T.emptyPlayer('V', 'HaVoC_HeLL');

  const h = hand({
    actions: [act('V', 'call', 'preflop', 500000), act('V', 'shows', 'river')],
    shown: { V: 'A♠ K♦' },
  });
  const text = T.formatHand(h, null);
  const html = T.formatHandHtml(h, null);

  // The reported screenshot showed exactly this: "RIVER  HaVoC_HeLL shows"
  // as the entire river line.
  t.eq('a street with nothing but a reveal is not rendered at all',
    /river:/.test(text), false);
  t.eq('nor in the markup', />river</.test(html), false);
  t.ok('while a street with real action still is', text.indexOf('preflop:') !== -1);
}

// --- both writers of `shown` agree on one format -------------------------
//
// The screenshot's tell was two styles one line apart. There is no DOM here to
// drive the seat harvester, so this pins the RENDERER contract instead: what
// goes into `shown` is what comes out, so as long as both writers use
// cardsGlyphText the two can no longer diverge.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.V = T.emptyPlayer('V', 'JonnySince');
  T.STORE.players.W = T.emptyPlayer('W', 'Jaywattsdj');

  // cardsGlyphText is the shared renderer both writers now use.
  const c = (rank, suit) => ({ rank, suit });
  const viaSeat = T.cardsGlyphText([c('K', 'h'), c('K', 's')]);
  const viaLog = T.cardsGlyphText([c('7', 'h'), c('J', 'd')]);

  t.eq('the seat path no longer produces "KH KS"', viaSeat.indexOf('KH'), -1);
  t.ok(`it produces glyphs (${viaSeat})`, /[♠♥♦♣]/.test(viaSeat));
  t.ok(`and so does the log path (${viaLog})`, /[♠♥♦♣]/.test(viaLog));
  t.eq('both use the same separator', viaSeat.indexOf(' ') !== -1 && viaLog.indexOf(' ') !== -1, true);
  // No brackets or commas: the raw log text "[7♥, J♦]" was the other half of
  // the mismatch, and it is only kept now when the cards fail to parse.
  t.eq('and neither carries the log text\'s brackets', /[[\],]/.test(viaSeat + viaLog), false);

  const h = hand({ shown: { V: viaLog, W: viaSeat } });
  const text = T.formatHand(h, null);
  t.ok('both players render in the same style',
    text.indexOf(viaLog) !== -1 && text.indexOf(viaSeat) !== -1);
}

// --- reveals survive the round trip into stored history ------------------
//
// Reported: villains' revealed hands missing from History. Two independent
// sources write them (the seat poll and the log's reveals line) and they fail
// differently — the poll can miss a fast deal, the log can omit the line —
// so `shownVia` records which one caught each, and recordHandHistory has to
// carry it through or a scan cannot say where the gap is.

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.V = T.emptyPlayer('V', 'JonnySince');
  T.STORE.players.W = T.emptyPlayer('W', 'Jaywattsdj');

  // freshHandState must declare both fields, or the writers create them ad hoc
  // on some paths and not others.
  const fresh = T.freshHandState();
  t.ok('a fresh hand has a shown map', !!fresh.shown && typeof fresh.shown === 'object');
  t.ok('and a shownVia map', !!fresh.shownVia && typeof fresh.shownVia === 'object');

  fresh.actions.push({ x: 'V', a: 'call', s: 'river', amt: 100 });
  fresh.shown.V = '7♥ J♦';
  fresh.shownVia.V = 'log';
  fresh.shown.W = 'K♥ K♠';
  fresh.shownVia.W = 'seat';
  fresh.winners.push({ xid: 'W', amount: 1000 });

  T.recordHandHistory(fresh);
  const rec = T.STORE.hands[0];
  t.ok('the hand was recorded', !!rec);
  t.eq('BOTH reveals are stored, not just one', Object.keys(rec.shown).length, 2);
  t.eq('the log-caught one survives', rec.shown.V, '7♥ J♦');
  t.eq('the seat-caught one survives', rec.shown.W, 'K♥ K♠');
  // The path is what makes a missing reveal diagnosable rather than just
  // absent — without it a scan can only say "one reveal", not which source
  // failed to produce the other.
  // Read defensively so a MISSING shownVia fails this assertion cleanly
  // rather than crashing the file — a crash reports nothing useful about
  // which assertion caught it.
  t.eq('and so does which path caught each', (rec.shownVia || {}).V, 'log');
  t.eq('for both of them', (rec.shownVia || {}).W, 'seat');

  // And both render.
  const text = T.formatHand(rec, null);
  t.ok('both villains appear in the rendered hand',
    text.indexOf('7♥ J♦') !== -1 && text.indexOf('K♥ K♠') !== -1);
}

// --- an older hand with no shownVia must not throw ------------------------

{
  const T = load();
  T.STORE = T.emptyStore();
  T.STORE.players.V = T.emptyPlayer('V', 'Someone');
  // Every hand recorded before v1.45.0 has shown but no shownVia. The scan and
  // the renderer both have to treat that as unknown, not as an error.
  const old = { t: Date.now(), pot: 1, street: 'river', players: ['V'], actions: [],
    winners: [], board: [], shown: { V: 'A♠ K♦' } };
  let threw = false;
  try { T.formatHand(old, null); T.formatHandHtml(old, null); } catch (e) { threw = true; }
  t.eq('a pre-shownVia hand still renders', threw, false);
  t.ok('and still shows its reveal', T.formatHand(old, null).indexOf('A♠ K♦') !== -1);
}

process.exit(t.report());
