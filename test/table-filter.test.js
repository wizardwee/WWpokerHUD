// v1.85.0: hiding low-stake rows in Torn's table list. The list's markup was
// never scanned by class; rows are recognised by their TEXT, shaped exactly as
// the user's screenshot shows them:  name | $amount | speed | seated/max.
// Driven through the real exported functions on stand-in nodes.

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
// One list row, four cells — the money cell is what the walker starts from.
function row(name, amount, seats) {
  const money = node({ text: amount });
  return { el: node({ cls: 'row' }, [node({ text: name }), node({}, [money]), node({ text: 'regular' }), node({ text: seats })]), money };
}
const rows = [
  row('Cut the Cord', '$250,000,000', '4/6'),
  row('Spilled Milk', '$10,000', '0/6'),
  row('Dive Bar', '$100,000', '0/6'),
  row('Lost at Sea', '$1,000,000', '0/6'),
  row('Jaded', '$10,000,000', '0/6'),
  row('Bloody Hell', '$10,000,000,000', '0/6'),
];
const list = node({ cls: 'list' }, rows.map((r) => r.el));
node({ cls: 'page' }, [list]);

// --- reading the text -----------------------------------------------------------

t.eq('amounts parse with commas, up to billions',
  JSON.stringify(T.moneyAmounts('Bloody Hell$10,000,000,000regular0/6')), JSON.stringify([10000000000]));
t.eq('a row reads its one stake', T.tableRowStake(rows[2].el), 100000);
// textContent has no separators between cells — the row reads "Dive Bar$100,000regular0/6".
t.eq('the seat count is found glued to the word before it', T.tableRowStake(node({ text: 'Dive Bar$100,000regular0/6' })), 100000);
t.eq('a date-like 12/25/2026 is not a seat count', T.tableRowStake(node({ text: 'x$5 on 12/25/2026' })), null);
t.eq('the whole list is not a row (many amounts)', T.tableRowStake(list), null);
t.eq('the money cell alone is not a row (no seat count)', T.tableRowStake(rows[2].money), null);

// --- finding the row from its amount ---------------------------------------------

t.eq('climbs from the amount to the row', T.tableRowFor(rows[3].money), rows[3].el);

// A seat shows bare money too (its stack). Built so that EVERYTHING but the
// seat exclusion would accept it — readable amount, a seat-count-like figure,
// and three seats alike beside it — so only the exclusion can stop it.
const mkSeat = (id, stackText) => {
  const money = node({ text: stackText });
  return { money, el: node({ id, cls: 'opponent___x' }, [node({ text: 'Call ' }), money, node({ text: ' 2/6' })]) };
};
const seats = [mkSeat('player-1', '$168,410,083'), mkSeat('player-2', '$590,625,000'), mkSeat('player-3', '$101,380,074')];
node({ cls: 'ring' }, seats.map((x) => x.el));
t.eq('the fixture reads like a row to everything but the exclusion', T.tableRowStake(seats[0].el), 168410083);
t.eq('a seat is never taken for a row', T.tableRowFor(seats[0].money), null);

// Same for the game log: three lines alike, each with an amount and an n/m.
const mkLine = (amt) => {
  const money = node({ text: amt });
  return { money, el: node({ cls: 'message___x' }, [node({ text: 'Luki2202 called ' }), money, node({ text: ' 1/2' })]) };
};
const lines = [mkLine('$2,500,000'), mkLine('$5,000,000'), mkLine('$1,250,000')];
node({}, [node({ cls: 'messagesList___S3XYg' }, lines.map((x) => x.el))]);
t.eq('a log line is never taken for a row', T.tableRowFor(lines[0].money), null);

// A lone block that reads exactly like a row but has no siblings like it.
const loneMoney = node({ text: '$500,000' });
const lone = node({}, [node({ text: 'Somewhere' }), loneMoney, node({ text: 'regular' }), node({ text: '3/9' })]);
node({}, [lone, node({ text: 'unrelated' })]);
t.eq('the lone fixture reads like a row on its own', T.tableRowStake(lone), 500000);
t.eq('fewer than 3 rows like it: not a list, left alone', T.tableRowFor(loneMoney), null);

// --- what gets hidden ---------------------------------------------------------------

const all = rows.map((r) => r.el);
const names = (els) => els.map((e) => e.children[0].ownText).join(',');
t.eq('a $500k minimum hides the two below it', names(T.tableRowsToHide(all, 500000)), 'Spilled Milk,Dive Bar');
t.eq('the minimum itself is kept (below, not at)', names(T.tableRowsToHide(all, 1000000)), 'Spilled Milk,Dive Bar');
t.eq('0 hides nothing', T.tableRowsToHide(all, 0).length, 0);
t.eq('the default is 0 (off)', T.DEFAULT_SETTINGS.minTableStake, 0);

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('hidden rows are marked so turning it off restores exactly those', /data-tph-hid/.test(src) && /removeAttribute\('data-tph-hid'\)/.test(src));
t.ok('the deep scan reports the rows it finds', /table rows found: /.test(src));

process.exit(t.report());
