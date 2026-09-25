// v1.84.0: hide a seat's tag while something of Torn's (the table-selection
// screen, any window) is drawn over it. seatCovered is driven with stand-in
// elements and a stand-in hit test: the real one is document.elementsFromPoint,
// which the harness does not have.

const { load, runner } = require('./harness');

const t = runner('seat-cover');
const T = load();

// Minimal element: a parent link, a class, contains() and closest('[class*="tph-"]').
function el(cls, parent) {
  const e = {
    className: cls || '', parent: parent || null,
    contains(o) { for (let c = o; c; c = c.parent) if (c === e) return true; return false; },
    closest(sel) {
      if (!/tph-/.test(sel)) return null;
      for (let c = e; c; c = c.parent) if (/(^|\s)tph-/.test(c.className)) return c;
      return null;
    },
  };
  return e;
}

const page = el('page');
const table = el('table', page);
const seat = el('seat', table);
const avatar = el('avatar', seat);
const overlay = el('tableSelect___x', page);
const chip = el('chips', table);
const badge = el('tph-badge', page);
const rect = { left: 100, top: 100, width: 80, height: 60 };
const VW = 400;
const VH = 800;

// A hit test returning, for every point, the given stack (top first).
const everywhere = (...stack) => () => stack;

t.eq('the seat itself on top: visible', T.seatCovered(seat, rect, everywhere(avatar, seat, table), VW, VH), false);
t.eq('an overlay on top at every point: covered', T.seatCovered(seat, rect, everywhere(overlay, seat, table), VW, VH), true);
t.eq('the table (an ancestor) on top: visible', T.seatCovered(seat, rect, everywhere(table, page), VW, VH), false);
t.eq('our own badge on top is looked through', T.seatCovered(seat, rect, everywhere(badge, avatar, seat), VW, VH), false);
t.eq('our own badge over the overlay does not hide the overlay', T.seatCovered(seat, rect, everywhere(badge, overlay), VW, VH), true);

// A chip stack over the centre only: one clear point keeps the tag.
let n = 0;
const centreOnly = () => (n++ === 0 ? [chip, table] : [avatar, seat]);
t.eq('something over the centre alone does not hide the tag', T.seatCovered(seat, rect, centreOnly, VW, VH), false);

// Fails open.
t.eq('no hit test available: visible', T.seatCovered(seat, rect, null, VW, VH), false);
t.eq('a hit test that throws: visible', T.seatCovered(seat, rect, () => { throw new Error('x'); }, VW, VH), false);
t.eq('nothing but HUD at every point: visible', T.seatCovered(seat, rect, everywhere(badge), VW, VH), false);
t.eq('a seat entirely off screen says nothing: visible',
  T.seatCovered(seat, { left: -500, top: -500, width: 80, height: 60 }, everywhere(overlay), VW, VH), false);

t.ok('isHudElement recognises our classes', T.isHudElement(badge) && !T.isHudElement(overlay));

// The 1s watcher only redraws when the covered set changes, and the deep scan
// carries a table-select section so the next paste can confirm it on the device.
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('renderBadges skips covered seats', /const covered = coveredSeatKeys\(candidates,/.test(src));
t.ok('a 1s watcher compares the covered set before redrawing', /seatCoverSignature\(\) !== lastCoverSig\) renderBadges\(\)/.test(src));
t.ok('the deep scan has a table-select section', /--- TABLE SELECT/.test(src));

// Hero's seat follows the table, not its own hit test. It sits below the felt
// with Torn's own pieces drawn over it, so its hit test read "covered" at a
// live table in plain view and hero's tag vanished.
{
  const E = (key, isSelf) => ({ key, isSelf });
  const cov = (set) => (e) => set.includes(e.key);
  t.eq('hero reading covered while opponents show: hero keeps the tag',
    T.coveredSeatKeys([E('1', false), E('2', false), E('me', true)], cov(['me'])).join(','), '');
  t.eq('the table list open (no opponent laid out): hero hidden',
    T.coveredSeatKeys([E('me', true)], cov(['me'])).join(','), 'me');
  t.eq('every opponent covered: hero hidden with them',
    T.coveredSeatKeys([E('1', false), E('2', false), E('me', true)], cov(['1', '2', 'me'])).join(','), '1,2,me');
  t.eq('one opponent still showing: hero stays',
    T.coveredSeatKeys([E('1', false), E('2', false), E('me', true)], cov(['1', 'me'])).join(','), '1');
  t.eq('hero not covered at all: never hidden',
    T.coveredSeatKeys([E('me', true)], cov([])).join(','), '');
  t.eq('opponents are still judged on their own hit test',
    T.coveredSeatKeys([E('1', false), E('2', false)], cov(['2'])).join(','), '2');
}

// The table list sits over the middle of the felt, leaving edge seats with a
// sliver showing. Most points covered hides the tag; a minority does not.
{
  let k = 0;
  const threeOfFive = () => ((k++ % 5) < 3 ? [overlay, page] : [avatar, seat]);
  t.eq('three of five points under the list: hidden', T.seatCovered(seat, rect, threeOfFive, VW, VH), true);
  k = 0;
  const twoOfFive = () => ((k++ % 5) < 2 ? [overlay, page] : [avatar, seat]);
  t.eq('two of five: still visible', T.seatCovered(seat, rect, twoOfFive, VW, VH), false);
}

process.exit(t.report());
