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

for (const f of files) {
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'pipe' }));
  } catch (e) {
    process.stdout.write((e.stdout || '').toString());
    process.stdout.write((e.stderr || '').toString());
    failed++;
  }
}

console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
