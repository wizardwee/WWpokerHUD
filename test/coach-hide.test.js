// The coach's Hide sits inside its drag handle (v1.109.0).
//
// Reported: the coach panel stuck open on desktop Chrome. The header is the
// drag handle and took pointer capture on every pointerdown — including one
// on Hide — and Chrome then delivers the click to the capturing header, so
// Hide's own click handler never ran. The handle must leave a press on a
// control inside it alone.

const { load, runner } = require('./harness');

const t = runner('coach-hide');
const T = load();
T.STORE = T.emptyStore();

function handle() {
  const listeners = {};
  let captured = 0;
  const el = {
    listeners,
    classList: { add() {}, remove() {} },
    addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; },
    setPointerCapture() { captured += 1; },
    releasePointerCapture() {},
  };
  return { el, captured: () => captured };
}
const target = (isHide) => ({ closest: (sel) => (isHide && sel === '.tph-coach-hide' ? {} : null) });
const evt = (tg) => ({ pointerId: 1, clientX: 5, clientY: 5, target: tg, preventDefault() {} });

{
  const h = handle();
  T.makeDraggable(h.el, { posKey: 'coachPos', ignore: '.tph-coach-hide' });
  h.el.listeners.pointerdown.forEach((fn) => fn(evt(target(true))));
  t.eq('a press on Hide takes no capture', h.captured(), 0);
  h.el.listeners.pointerdown.forEach((fn) => fn(evt(target(false))));
  t.eq('a press on the rest of the header still drags', h.captured(), 1);
}

const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
t.ok('the coach header passes Hide as ignored',
  /makeDraggable\(head, \{[^}]*ignore: '\.tph-coach-hide'/.test(src));

process.exit(t.report());
