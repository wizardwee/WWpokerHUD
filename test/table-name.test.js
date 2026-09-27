// v1.92.0: the blind names the STAKE, not the table. Reported sitting at Slow
// Cooker and announced as "Juan on Juan" — both are $2.5m / $5m. The table is
// named from the Cash Games row you tapped, while its blind is the one read.

const { load, runner } = require('./harness');

const t = runner('table-name');
const T = load();
T.STORE = T.emptyStore();

function node(opts, kids) {
  const n = {
    ownText: opts.text || '', children: [], parentElement: null,
    get textContent() { return n.ownText + n.children.map((c) => c.textContent).join(''); },
  };
  (kids || []).forEach((k) => { k.parentElement = n; n.children.push(k); });
  return n;
}
function row(name, blinds, seats) {
  const nameCell = node({ text: name });
  const el = node({}, [nameCell, node({ text: blinds }), node({ text: '30' }), node({ text: seats })]);
  return { el, nameCell, bb: T.tableBlindsBB(blinds) };
}
const slow = row('Slow Cooker', '$2.5m / $5m', '5/9');
const juan = row('Juan on Juan', '$2.5m / $5m', '0/2');
const cats = row("Cat's Chance II", '$1.25m / $2.5m', '0/9');
node({}, [slow.el, juan.el, cats.el]);
const entries = [slow, juan, cats].map((r) => ({ row: r.el, bb: r.bb }));

t.eq('the name is read off the row text', T.tableRowName(slow.el), 'Slow Cooker');
t.eq('...with an apostrophe', T.tableRowName(cats.el), "Cat's Chance II");
t.eq('no "$" in the row: no name', T.tableRowName(node({ text: 'Slow Cooker' })), null);

const now = Date.now();
t.eq('before any tap, $5M names no table', T.tableNameForBB(5000000), null);
T.rememberTappedRow(slow.nameCell, entries, now);
t.eq('tapping the Slow Cooker row names it', T.tableNameForBB(5000000), 'Slow Cooker');
t.ok('...and the label says so', T.tableLabel(5000000).indexOf('Slow Cooker') === 0);
t.eq('another stake is not named by it', T.tableNameForBB(2500000), null);
t.eq('stake groupings never take the tapped name', T.stakeName(5000000), null);

T.rememberTappedRow(juan.el.children[3], entries, now);
t.eq('a later tap on another row replaces it', T.tableNameForBB(5000000), 'Juan on Juan');

t.eq('a tap outside any row changes nothing', T.rememberTappedRow(node({}), entries, now), null);
t.eq('...still Juan on Juan', T.tableNameForBB(5000000), 'Juan on Juan');

t.eq('lapses after Torn\'s 2-hour same-table window',
  T.joinedTableName(5000000, now + 3 * 3600000), null);
t.eq('...but holds inside it', T.joinedTableName(5000000, now + 3600000), 'Juan on Juan');

// Reading a hand at that stake keeps it alive.
T.STORE.joinedTable.at = now - 2 * 3600000;
T.noteBlindLevel({}, 5000000);
t.ok('a blind read at that stake refreshes it', Date.now() - T.STORE.joinedTable.at < 5000);

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('the tap listener is passive capture', /addEventListener\('click', noteTableRowTap, \{ capture: true, passive: true \}\)/.test(src));
t.ok('the deep scan reports the tapped row', /tapped row: /.test(src));

process.exit(t.report());
