// Runs every *.test.js in this directory, plus a syntax check on the script.
//
//   node test/run.js
//
// No framework and no package.json on purpose: the userscript has no build step
// and is installed by fetching the single file whole. Tests live here, never
// ship, and depend on nothing but node.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SCRIPT_PATH } = require('./harness');

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let failed = 0;

// A syntax error would otherwise surface as an unhelpful harness load failure.
try {
  execFileSync(process.execPath, ['--check', SCRIPT_PATH], { stdio: 'pipe' });
  console.log('syntax: OK');
} catch (e) {
  console.log('syntax: FAILED\n' + (e.stderr || '').toString());
  process.exit(1);
}

// Every test file ends with `process.exit(t.report())`, which prints a
// "<name>: N passed, M failed" line. A file that exits 0 WITHOUT that line
// never reached its own report — an async test whose await never settles dies
// silently when node's event loop empties, and exits 0 while having asserted
// nothing. That was found by a mutation that a passing suite scored as clean,
// so the absence of the line is treated as a failure in its own right.
const REPORT_RE = /^[\w-]+: \d+ passed, \d+ failed$/m;

for (const f of files) {
  let out = '';
  let ok = true;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'pipe' }).toString();
  } catch (e) {
    out = (e.stdout || '').toString() + (e.stderr || '').toString();
    ok = false;
  }
  process.stdout.write(out);
  if (ok && !REPORT_RE.test(out)) {
    console.log(`  FAIL: ${f} exited without reporting — it never reached `
      + 'process.exit(t.report()). An unsettled await or an unhandled rejection '
      + 'ends the process quietly with status 0.');
    ok = false;
  }
  if (!ok) failed++;
}

console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
