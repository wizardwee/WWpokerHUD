// Times every setInterval job the HUD registers, in real Chromium, against a
// Torn-shaped table and a ~900-player store. Not part of `node test/run.js`:
// it needs a browser, and its output is a measurement, not a pass/fail.
//
//   node tools/profile-ticks.js                  # ms per call and per second, each job
//   node tools/profile-ticks.js --stake          # with the table-list filter on
//   CPUPROF="renderCoachPanel" node tools/profile-ticks.js
//                                                # CPU profile of one job, by caller
//
// Needs Playwright on NODE_PATH (e.g. NODE_PATH=$(npm root -g)). Set
// CHROMIUM=/path/to/chrome if Playwright's own browser is not installed.
//
// How it works: setInterval is replaced BEFORE the script loads, so every
// job is captured instead of scheduled and can be called on demand. The pot
// text is changed before each call so the layout is dirty, as it is at a
// live table. Measured v1.91.0: about 3.7ms of main thread per second in
// total, the coach panel (2.6ms per 1.5s) and turn cue (0.6ms per 400ms)
// the largest — mostly DOM queries, not the HUD's own arithmetic.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRIPT = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'torn-poker-hud.user.js');
const STAKE = process.argv.includes('--stake');
const src = fs.readFileSync(SCRIPT, 'utf8');

const NAMES = ['Wonkawee', 'Bauderix', 'GhostNote', 'Xelphina', 'ImEx', 'Rollo', 'Tamsin', 'Quade', 'Fennick'];
const XIDS = ['311421', '1000001', '1000002', '1000003', '1000004', '1000005', '1000006', '1000007', '1000008'];

function seatHtml(i) {
  const self = i === 0 ? ' self___TGTz' : ' opponent___q1';
  const pos = i === 0 ? '' : ` class="playerPositioner-${i}___ab"`;
  const seat = `<div id="player-${XIDS[i]}" class="default___x1${self}" style="position:absolute;left:${50 + 300 * Math.cos(i * 0.7)}px;top:${300 + 200 * Math.sin(i * 0.7)}px;width:90px;height:60px">
    <p class="name___n1">${NAMES[i]}</p>
    <div class="detailsItem___d1"><p>$${(40 + i)},000,000</p></div>
    <div class="hand___h1"><div class="flipperWrap___f"><div class="flipper___f"><div class="front___f"><div role="img" aria-label="card face down"></div></div></div></div></div>
  </div>`;
  return i === 0 ? seat : `<div${pos}>${seat}</div>`;
}

function filler(n) {
  let s = '<div class="sidebar___s">';
  for (let i = 0; i < n; i++) s += `<div class="item___${i % 7}"><span>Item ${i}</span><a href="#">link</a></div>`;
  return s + '</div>';
}

function logRows(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<li class="message___m1 old___o"><span>${NAMES[i % 9]}</span> <span>called $2,500,000</span></li>`;
  return s;
}

const html = `<!doctype html><html><body>
${filler(1500)}
<div class="table___t" style="position:relative;width:700px;height:600px">
${NAMES.map((_, i) => seatHtml(i)).join('\n')}
<div class="communityCards___c"></div>
<div class="potsWrapper___p"><div class="totalPotWrap___tp">$10,000,000</div></div>
</div>
<ul class="messagesList___ml">${logRows(60)}</ul>
<div><button>Fold</button><button>Call $2.5M</button><button>Raise to $5M</button></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const initFn = () => {
    window.__TPH_TEST_HOOKS = true;
    window.__intervals = [];
    const realSI = window.setInterval;
    window.setInterval = (fn, ms) => { window.__intervals.push({ fn, ms, src: String(fn).slice(0, 80) }); return 0; };
    window.__realSI = realSI;
  };
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.route('https://www.torn.com/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://www.torn.com/page.php?sid=holdem');
  await page.evaluate(initFn);
  await page.addScriptTag({ content: src });
  await page.evaluate(({ NAMES, XIDS, STAKE }) => {
    const T = window.__TPH_TEST;
    T.STORE.settings.heroName = 'Wonkawee';
    if (STAKE) T.STORE.settings.minTableStake = 1000000;
    // 900 synthetic players
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const now = Date.now();
    for (let i = 0; i < 900; i++) {
      const xid = String(2000000 + i);
      const p = T.emptyPlayer(xid, 'Player' + i);
      const h = Math.max(1, Math.round(Math.exp(rnd() * 6)));
      p.hands = h; p.vpip = Math.round(h * (0.2 + rnd() * 0.5)); p.pfr = Math.round(p.vpip * rnd() * 0.5);
      p.threeBetMade = Math.round(h * 0.02); p.cbetOpp = Math.round(h * 0.1); p.cbetMade = Math.round(p.cbetOpp * rnd());
      p.foldToCbetOpp = Math.round(h * 0.1); p.foldToCbetMade = Math.round(p.foldToCbetOpp * rnd());
      ['flop', 'turn', 'river'].forEach((s) => { const a = p.streetActions[s]; a.bet = Math.round(h * rnd() * 0.2); a.call = Math.round(h * rnd() * 0.2); a.check = Math.round(h * rnd() * 0.2); a.fold = Math.round(h * rnd() * 0.2); a.raise = Math.round(h * rnd() * 0.05); });
      p.recent = Array.from({ length: Math.min(h, 15) }, () => Math.floor(rnd() * 3));
      p.tables = { 2500000: h }; p.lastSeen = now - rnd() * 1e9; p.plChipsEst = (rnd() - 0.5) * 1e8;
      T.STORE.players[xid] = p;
    }
    // seated players, with a real history
    const bb = 2500000;
    for (let g = 0; g < 250; g++) {
      const hex = (0x100000 + g).toString(16) + 'abc';
      const L = [`Game ${hex} started`, `${NAMES[(g + 1) % 9]} posted small blind $1,250,000`, `${NAMES[(g + 2) % 9]} posted big blind $2,500,000`];
      for (let k = 3; k < 9; k++) L.push(`${NAMES[(g + k) % 9]} ${k % 3 === 0 ? 'called $2,500,000' : k % 3 === 1 ? 'folded' : 'raised $2,500,000 to $7,500,000'}`);
      L.push('The flop:  5♣, 7♦, A♦');
      L.push(`${NAMES[(g + 3) % 9]} bet $5,000,000`, `${NAMES[(g + 5) % 9]} called $5,000,000`);
      L.push('The turn:  K♠');
      L.push(`${NAMES[(g + 3) % 9]} checked`, `${NAMES[(g + 5) % 9]} bet $10,000,000`, `${NAMES[(g + 3) % 9]} folded`);
      L.push(`${NAMES[(g + 5) % 9]} won $40,000,000 Did not show hand`);
      L.forEach((l) => T.handleLogLine(l));
    }
    T.handleLogLine(`Game ffffffabc started`);
    T.handleLogLine(`${NAMES[1]} posted small blind $1,250,000`);
    T.handleLogLine(`${NAMES[2]} posted big blind $2,500,000`);
    T.handleLogLine(`${NAMES[3]} raised $2,500,000 to $7,500,000`);
  }, { NAMES, XIDS, STAKE });
  // let init() run (boot fires 500ms after load)
  await page.waitForTimeout(1500);
  if (process.env.CPUPROF) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
    await cdp.send('Profiler.start');
    await page.evaluate(async (pat) => {
      const it = window.__intervals.find((x) => x.src.indexOf(pat) >= 0);
      for (let i = 0; i < 300; i++) { window.__TPH_TEST.invalidateSeatCache(); document.querySelector('.totalPotWrap___tp').textContent = '$' + i; it.fn(); }
    }, process.env.CPUPROF);
    const { profile } = await cdp.send('Profiler.stop');
    const self = {}; const dt = profile.timeDeltas; const byId = {}; profile.nodes.forEach((n) => byId[n.id] = n);
    profile.samples.forEach((id, i) => { const n = byId[id]; const k = n.callFrame.functionName + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dt[i] || 0); });
    Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log((v / 1000).toFixed(1) + 'ms', k));
    const parent = {}; profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent[c] = n.id));
    const nat = {};
    profile.samples.forEach((id, i) => { const n = byId[id]; if (n.callFrame.url) return; if (!/^(getBoundingClientRect|querySelector|querySelectorAll|elementsFromPoint|closest)$/.test(n.callFrame.functionName)) return;
      let chain = []; let q = parent[id]; while (q && chain.length < 3) { chain.push(byId[q].callFrame.functionName + ':' + byId[q].callFrame.lineNumber); q = parent[q]; }
      const k = n.callFrame.functionName + ' <- ' + chain.join(' <- '); nat[k] = (nat[k] || 0) + (dt[i] || 0); });
    console.log('--- native DOM by caller');
    Object.entries(nat).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => console.log((v / 1000).toFixed(1) + 'ms', k));
    await browser.close(); return;
  }
  const res = await page.evaluate(async () => {
    const T = window.__TPH_TEST;
    const out = [];
    const list = window.__intervals;
    for (const it of list) {
      // warm
      for (let i = 0; i < 5; i++) { try { T.invalidateSeatCache(); it.fn(); } catch (e) { out.push({ err: String(e), src: it.src }); } }
      const N = 60; const times = [];
      for (let i = 0; i < N; i++) {
        T.invalidateSeatCache();
        // dirty the layout the way a live table does between ticks
        document.querySelector('.totalPotWrap___tp').textContent = '$' + (10 + i) + ',000,000';
        const t0 = performance.now();
        try { it.fn(); } catch (e) { }
        times.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 0));
      }
      times.sort((a, b) => a - b);
      out.push({ ms: it.ms, median: +times[N >> 1].toFixed(3), p90: +times[Math.floor(N * 0.9)].toFixed(3), perSec: +(times[N >> 1] * 1000 / it.ms).toFixed(2), src: it.src.replace(/\s+/g, ' ') });
    }
    return { out, players: Object.keys(T.STORE.players).length, hands: T.STORE.hands.length, hero: T.heroXid };
  });
  console.log('players', res.players, 'hands', res.hands, 'hero', res.hero);
  res.out.forEach((r) => console.log(JSON.stringify(r)));
  await browser.close();
})();
