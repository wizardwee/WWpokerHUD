// Loads the userscript headlessly and hands back its test seam.
//
// Every earlier QA harness in this repo recovered functions by slicing the
// source with indexOf/eval against literal markers — exact indentation, exact
// const names. Those broke whenever anything was renamed or moved, and one
// silently reported false passes because a regex matched the wrong chart. This
// loads the real file instead, so a rename surfaces as an undefined export
// rather than a wrong answer.
//
// The script is an IIFE built for a browser. Everything it touches at module
// scope is stubbed below; `document.readyState = 'loading'` is what keeps
// init() from running, since the file defers it to DOMContentLoaded.
//
// Usage:
//   const { load } = require('./harness');
//   const T = load();            // fresh sandbox + empty storage every call
//   T.fmtMoney(1500000);

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'torn-poker-hud.user.js');

// A deliberately tiny DOM, sufficient for renderPanel and nothing more.
//
// It supports exactly one selector form — a single class, ".foo" — because
// that is all the panel code uses. Anything else returns empty rather than
// silently matching the wrong thing: a stub that guesses is worse than a stub
// that admits it doesn't know, and this repo has already been burned once by a
// harness that reported false passes because a pattern matched the wrong target.
function classDom() {
  const mounted = [];

  const node = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      className: '',
      innerHTML: '',
      textContent: '',
      style: { setProperty() {} },
      dataset: {},
      children: [],
      parent: null,
      listeners: {},
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      remove() {
        if (!el.parent) return;
        const i = el.parent.children.indexOf(el);
        if (i >= 0) el.parent.children.splice(i, 1);
        el.parent = null;
      },
      addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
      // Test helper: fire a listener the way a tap would.
      _fire(ev) { (el.listeners[ev] || []).forEach((fn) => fn({ target: el })); },
      classes() { return String(el.className || '').split(/\s+/).filter(Boolean); },
      setAttribute() {},
      getAttribute: () => null,
      removeAttribute() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      closest: () => null,
      focus() {}, select() {}, setSelectionRange() {},
      // renderPanel sets innerHTML then looks for .tph-close inside it. The
      // stub does not parse HTML, so descendant lookups find nothing — which
      // is fine: these tests assert mounting and teardown, not markup.
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return el;
  };

  const body = node('body');
  const matchAll = (sel) => {
    const m = /^\.([A-Za-z0-9_-]+)$/.exec(sel || '');
    if (!m) return [];
    return body.children.filter((c) => c.classes().includes(m[1]));
  };

  return {
    readyState: 'loading',
    body,
    head: node('head'),
    documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    createElement: (tag) => node(tag),
    createTextNode: () => node('text'),
    querySelector: (sel) => matchAll(sel)[0] || null,
    querySelectorAll: matchAll,
    execCommand: () => false,
    _mounted: mounted,
  };
}

// Minimal DOM node. Selector calls return nothing, which is the honest answer
// for a headless run: no seats, no log rows, no panels.
function stubElement() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    dataset: {},
    children: [],
    textContent: '',
    innerHTML: '',
    className: '',
    id: '',
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    closest: () => null,
    focus() {},
    select() {},
    setSelectionRange() {},
  };
  return el;
}

function stubStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    get length() { return map.size; },
    _map: map, // exposed so a test can assert on what was persisted
  };
}

// opts.storageSeed: raw JSON string to pre-load under the HUD's storage key,
// for testing migrations against a store written by an older version.
function load(opts = {}) {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const localStorage = stubStorage();
  if (opts.storageSeed) localStorage.setItem('tornPokerHUD_v1', opts.storageSeed);

  // opts.dom: 'class' swaps in the class-matching document above, for tests
  // that need mount/teardown to actually happen. Default is the inert stub —
  // cheaper, and the right default for pure-logic tests.
  const document = opts.dom === 'class' ? classDom() : {
    readyState: 'loading', // keeps init() from firing — see file's bootstrap
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubElement(),
    createTextNode: () => stubElement(),
    head: stubElement(),
    body: stubElement(),
    documentElement: stubElement(),
    execCommand: () => false,
  };

  const win = {
    __TPH_TEST_HOOKS: true,
    document,
    localStorage,
    innerWidth: 390,
    innerHeight: 844,
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => { fn(); return 0; },
    cancelAnimationFrame() {},
    navigator: { clipboard: null, userAgent: 'node-harness' },
    location: { pathname: '/page.php', search: '?sid=holdem', href: 'https://www.torn.com/page.php?sid=holdem' },
  };
  win.window = win;
  win.self = win;

  const pendingTimers = [];
  const sandbox = {
    window: win,
    document,
    localStorage,
    navigator: win.navigator,
    location: win.location,
    console,
    // setInterval is a no-op: the file installs several long-lived intervals
    // (badge render, log poll, hero retry) that would keep node alive and fire
    // against a DOM that isn't there.
    //
    // setTimeout is QUEUED rather than dropped, because some behaviour only
    // exists inside one — saveStore debounces its write by 250ms, so a dropped
    // timer means the save never happens and a test of it passes vacuously.
    // Nothing runs until a test calls sandbox.runTimers().
    setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    // Drain the queue. Callbacks may schedule more; that is drained too, with a
    // cap so a self-rescheduling poll can't spin forever.
    runTimers(maxRounds) {
      const cap = maxRounds || 20;
      for (let i = 0; i < cap && pendingTimers.length; i += 1) {
        const due = pendingTimers.splice(0, pendingTimers.length);
        due.forEach((fn) => { try { fn(); } catch (e) { /* surfaced by assertions */ } });
      }
    },
    fetch: () => Promise.reject(new Error('network disabled in harness')),
    // Real browsers/webviews always have these; Node's own vm sandbox does
    // not inherit them from the outer process, unlike the rest of Node's
    // globals. Only downloadTextFile's PDA branch uses btoa, and nothing
    // exercised that branch until test/clipboard-export.test.js — Node 16+
    // has both as real globals, so this just forwards them rather than
    // reimplementing base64.
    btoa,
    atob,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'torn-poker-hud.user.js' });

  const T = sandbox.window.__TPH_TEST;
  if (!T) {
    throw new Error(
      'Script loaded but exposed no __TPH_TEST. Check the TEST SEAM block is '
      + 'still gated on window.__TPH_TEST_HOOKS and runs before bootstrap.'
    );
  }
  T._sandbox = sandbox;
  T._localStorage = localStorage;
  return T;
}

// Tiny assertion helpers — enough to keep the ported harnesses readable
// without pulling in a test framework this repo has no build step for.
function runner(title) {
  let pass = 0;
  const failures = [];
  const ok = (name, cond) => { cond ? pass++ : failures.push(name); };
  const eq = (name, actual, expected) => {
    const good = Object.is(actual, expected);
    ok(name + (good ? '' : ` (got ${actual}, want ${expected})`), good);
  };
  const near = (name, actual, expected, tol = 1e-6) => {
    const good = Math.abs(actual - expected) < tol;
    ok(name + (good ? '' : ` (got ${actual}, want ~${expected})`), good);
  };
  const report = () => {
    failures.forEach((f) => console.log('  FAIL: ' + f));
    console.log(`${title}: ${pass} passed, ${failures.length} failed`);
    return failures.length;
  };
  return { ok, eq, near, report };
}

module.exports = { load, runner, SCRIPT_PATH };
