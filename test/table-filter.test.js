// Hiding low-stake CASH tables in Torn's table list (v1.85.0, rebuilt v1.86.0).
// Rows are recognised by their TEXT, shaped as the user's screenshot of the
// Cash Games list shows them:  name | $sb / $bb | timer | seated/max.
// v1.85.0 was built from the Tournaments tab (one amount per row) and matched
// nothing on the cash list. Driven through the real functions on stand-ins.

const { load, runner } = require('./harness');

const t = runner('table-filter');
const T = load();

// Stand-in element: children, parentElement, textContent from its subtree,
// and closest() for the three exclusions the filter uses.
function node(opts, kids) {
  const n = {
    id: opts.id || '', className: opts.cls || '', ownText: opts.text || '',
    children: [], parentElement: null,
    get textContent() { return n.ownText + n.children.map((c) => c.textContent).join(''); },
    closest(sel) {
      for (let c = n; c; c = c.parentElement) {
        if (/player-/.test(sel) && /^player-/.test(c.id)) return c;
        if (/messagesList_/.test(sel) && /messagesList_/.test(c.className)) return c;
        if (/tph-/.test(sel) && /(^|\s)tph-/.test(c.className)) return c;
      }
      return null;
    },
  };
  (kids || []).forEach((k) => { k.parentElement = n; n.children.push(k); });
  return n;
}
// One cash row, four cells. `split` renders the blinds as three spans instead
// of one text node — both must be read.
function row(name, blinds, seats, split) {
  const cell = split
    ? node({}, blinds.split(/(\s*\/\s*)/).map((p) => node({ text: p })))
    : node({ text: blinds });
  return { el: node({ cls: 'row' }, [node({ text: name }), cell, node({ text: '15' }), node({ text: seats })]), cell };
}
const rows = [
  row('Newbie Corner', '$5 / $10', '9/9'),
  row('Gatling Gun II', '$500 / $1k', '9/9'),
  row('Ballsy', '$12.5k / $25k', '9/9', true),
  row('Periodic', '$50k / $100k', '9/9'),
  row('River Wizard II', '$500k / $1m', '9/9'),
  row('Cat\'s Chance', '$1.25m / $2.5m', '9/9', true),
];
const list = node({ cls: 'list' }, rows.map((r) => r.el));
node({ cls: 'page' }, [list]);

// --- reading the blinds -------------------------------------------------------------

t.eq('big blind of "$5 / $10"', T.tableBlindsBB('$5 / $10'), 10);
t.eq('abbreviated k', T.tableBlindsBB('$12.5k / $25k'), 25000);
t.eq('lowercase m with decimals', T.tableBlindsBB('$1.25m / $2.5m'), 2500000);
t.eq('full figures with commas', T.tableBlindsBB('$500,000 / $1,000,000'), 1000000);
t.eq('a tournament buy-in (one amount) is not a cash row', T.tableBlindsBB('$250,000,000'), null);
t.eq('a small blind above the big is not blinds', T.tableBlindsBB('$10 / $5'), null);
// textContent glues the timer on: "$5 / $10" + "30" reads "$5 / $1030". The
// stake must come from the cell's own text, never the row's.
t.eq('the row text is never parsed as blinds', T.tableBlindsBB(rows[0].el.textContent), null);
t.eq('the blinds cell is found from one text node', T.tableBlindsCell(rows[0].cell), rows[0].cell);
t.eq('...and from a span inside a split cell', T.tableBlindsCell(rows[2].cell.children[0]), rows[2].cell);
t.eq('a split cell reads its big blind', T.tableBlindsBB(rows[2].cell.textContent), 25000);

// --- finding the row from its blinds ---------------------------------------------

t.eq('climbs from the blinds to the row', T.tableRowFor(rows[3].cell), rows[3].el);
t.eq('...from a split cell too', T.tableRowFor(rows[5].cell), rows[5].el);

// A seat with blinds-like text, three alike, so that ONLY the seat exclusion
// can stop it.
const mkSeat = (id) => {
  const cell = node({ text: '$5 / $10' });
  return { cell, el: node({ id, cls: 'opponent___x' }, [node({ text: 'Mob' }), cell]) };
};
const seats = [mkSeat('player-1'), mkSeat('player-2'), mkSeat('player-3')];
node({ cls: 'ring' }, seats.map((x) => x.el));
t.eq('the seat fixture has readable blinds', T.tableBlindsBB(seats[0].cell.textContent), 10);
t.eq('a seat is never taken for a row', T.tableRowFor(seats[0].cell), null);

// Same for the game log.
const mkLine = () => {
  const cell = node({ text: '$5 / $10' });
  return { cell, el: node({ cls: 'message___x' }, [node({ text: 'Luki2202 said ' }), cell]) };
};
const lines = [mkLine(), mkLine(), mkLine()];
node({}, [node({ cls: 'messagesList___S3XYg' }, lines.map((x) => x.el))]);
t.eq('a log line is never taken for a row', T.tableRowFor(lines[0].cell), null);

// A lone block that reads exactly like a row but has no siblings like it.
const loneCell = node({ text: '$50k / $100k' });
const lone = node({}, [node({ text: 'Somewhere' }), loneCell, node({ text: '15' }), node({ text: '3/9' })]);
node({}, [lone, node({ text: 'unrelated' })]);
t.eq('the lone fixture has readable blinds', T.tableBlindsBB(loneCell.textContent), 100000);
t.eq('fewer than 3 rows like it: not a list, left alone', T.tableRowFor(loneCell), null);

// A block holding TWO tables is never taken for one row, even among three
// single-table blocks — hiding it would hide both tables for one's stake.
{
  const pairCell = node({ text: '$5 / $10' });
  const two = node({ cls: 'two' }, [
    node({}, [node({ text: 'A' }), pairCell]),
    node({}, [node({ text: 'B' }), node({ text: '$50k / $100k' })]),
  ]);
  const one = () => node({}, [node({ text: 'C' }), node({ text: '$1m / $2m' })]);
  node({}, [two, one(), one(), one()]);
  t.eq('a block of two tables is not a row', T.tableRowFor(pairCell), null);
}

// --- what gets hidden ---------------------------------------------------------------

const entries = rows.map((r) => ({ row: r.el, bb: T.tableBlindsBB(r.cell.textContent) }));
const names = (els) => els.map((e) => e.children[0].ownText).join(',');
t.eq('a $1M minimum hides every big blind below $1M',
  names(T.tableRowsToHide(entries, 1000000)), 'Newbie Corner,Gatling Gun II,Ballsy,Periodic');
t.eq('the minimum itself is kept (below, not at)',
  names(T.tableRowsToHide(entries, 2500000)), 'Newbie Corner,Gatling Gun II,Ballsy,Periodic,River Wizard II');
t.eq('0 hides nothing', T.tableRowsToHide(entries, 0).length, 0);
t.eq('the default is 0 (off)', T.DEFAULT_SETTINGS.minTableStake, 0);

// --- the settings box ----------------------------------------------------------------

t.eq('"1m" is a million', T.parseAmount('1m'), 1000000);
t.eq('"2.5m" is $2.5M', T.parseAmount('2.5m'), 2500000);
t.eq('"500k" is $500k', T.parseAmount('500k'), 500000);
t.eq('the box shows it back exactly', T.minStakeInputText(1250000), '1.25m');
t.eq('...never rounded', T.minStakeInputText(T.parseAmount(T.minStakeInputText(1250000))), '1.25m');
t.eq('off reads blank', T.minStakeInputText(0), '');
t.eq('small figures stay plain', T.minStakeInputText(500), '500');

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('hidden rows are marked so turning it off restores exactly those', /data-tph-hid/.test(src) && /removeAttribute\('data-tph-hid'\)/.test(src));
t.ok('the deep scan reports the rows it finds', /cash table rows found: /.test(src));

process.exit(t.report());
