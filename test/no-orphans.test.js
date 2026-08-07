// Structural lint: nothing may be DECLARED and read by NOTHING.
//
// This is not a style rule, it is the repo's most-repeated bug. Three times now
// a selector has sat in SELECTORS — the one obvious place to edit after a Torn
// redeploy — while the code that needed it used a hardcoded copy:
//
//   seatName      declared at 0.4.0, read by nothing until 0.16.0. Every player
//                 record was stored as "#3722665" for twelve versions.
//   dealerButton  declared, referenced nowhere, and written up in CLAUDE.md as
//                 "a red herring" — because nothing read it, so it never worked.
//   potDisplay    declared at 0.18.0 while readDomPot() carried its own copy of
//                 the same two selectors. Fixed at 0.42.1.
//
// Every one of these fails silently and looks like a data bug somewhere else,
// which is why they survived so long. A grep is cheaper than a fourth live scan.
//
// Reads the source as TEXT rather than through the seam: the property being
// asserted is about the source, not about runtime behaviour.

const fs = require('fs');
const { SCRIPT_PATH, runner } = require('./harness');

const t = runner('no-orphans');
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

// The test seam is a list of exports, not uses: a name appearing only there is
// still unused by the HUD itself, so it is cut out. Only the seam though — the
// BOOTSTRAP section sits AFTER it and is where init() calls injectStyles() and
// renderGear(), so slicing everything past the seam would report those three as
// dead. (It did, on the first run of this file.)
const seamAt = src.indexOf('window.__TPH_TEST = {');
const bootAt = src.indexOf('// BOOTSTRAP', seamAt);
const prod = seamAt === -1 ? src : src.slice(0, seamAt) + src.slice(bootAt);

function keysOf(name) {
  const m = new RegExp(`const ${name} = \\{(.*?)\\n  \\};`, 's').exec(src);
  if (!m) return null;
  return { keys: [...m[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]), from: m.index, to: m.index + m[0].length };
}

// --- SELECTORS ---------------------------------------------------------------

{
  const block = keysOf('SELECTORS');
  t.ok('the SELECTORS block is findable', !!block);
  // Outside its own declaration: a key that only appears in the object literal
  // is one nothing reads.
  const outside = prod.slice(0, block.from) + prod.slice(Math.min(block.to, prod.length));
  const orphans = block.keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(outside));
  t.eq(`every SELECTORS entry is read somewhere${orphans.length ? ' — orphans: ' + orphans.join(', ') : ''}`,
    orphans.length, 0);
  t.ok('and there are selectors to check at all', block.keys.length > 10);
}

// --- DEFAULT_SETTINGS --------------------------------------------------------
//
// Same failure, louder: a setting rendered in the Settings panel that no code
// path reads is a control that visibly does nothing.

{
  const block = keysOf('DEFAULT_SETTINGS');
  t.ok('the DEFAULT_SETTINGS block is findable', !!block);
  const outside = prod.slice(0, block.from) + prod.slice(Math.min(block.to, prod.length));
  const orphans = block.keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(outside));
  t.eq(`every setting is read somewhere${orphans.length ? ' — orphans: ' + orphans.join(', ') : ''}`,
    orphans.length, 0);
}

// --- Uncalled top-level functions --------------------------------------------
//
// Bounded to the functions the HUD declares for itself. `init` is called by the
// bootstrap through a readyState branch, and the seam re-exports several, so
// both are allowed for.

{
  const declared = [...src.matchAll(/^ {2}(?:async )?function (\w+)/gm)].map((m) => m[1]);
  const ALLOWED = new Set(['init']); // wired up by the readyState bootstrap
  const uncalled = declared.filter((n) => {
    if (ALLOWED.has(n)) return false;
    return (prod.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length <= 1;
  });
  t.eq(`no top-level function is declared and never called${uncalled.length ? ' — ' + uncalled.join(', ') : ''}`,
    uncalled.length, 0);
  t.ok('and the scan actually found the functions', declared.length > 150);
}

// --- The test is not vacuous -------------------------------------------------
//
// Checked against the bug it was written for: potDisplay was an orphan until
// 0.42.1, so the SELECTORS assertion above must be capable of failing.

{
  const fake = 'const SELECTORS = {\n    used: \'a\',\n    orphan: \'b\',\n  };\nconst x = SELECTORS.used;';
  const m = /const SELECTORS = \{(.*?)\n  \};/s.exec(fake);
  const keys = [...m[1].matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]);
  const outside = fake.slice(0, m.index) + fake.slice(m.index + m[0].length);
  const orphans = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(outside));
  t.eq('the same check catches a planted orphan', orphans.join(','), 'orphan');
}

process.exit(t.report());
