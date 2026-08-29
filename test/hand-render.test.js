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

process.exit(t.report());
