// The two version numbers must agree.
//
// There are two, and only one of them is the one anybody notices:
//
//   @version      in the userscript metadata — what Torn PDA and every other
//                 userscript manager compares to decide an update exists.
//   HUD_VERSION   a JS constant, printed at the top of every deep scan.
//
// HUD_VERSION sat at 0.19.0 through releases 0.20.0, 0.21.0, 0.22.0 and 0.23.0.
// A live deep scan therefore reported "script v0.19.0" while running v0.23.0
// code, which sent a debugging session looking for a stale install that wasn't
// stale. The scan header is the first line read when something is wrong, so it
// being a lie is expensive.
//
// The file header already said HUD_VERSION "must be bumped alongside @version".
// A written rule was not enough; this makes it a failing test.

const fs = require('fs');
const { load, runner, SCRIPT_PATH } = require('./harness');

const t = runner('version');
const T = load();

const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
const meta = /^\/\/ @version\s+(\S+)\s*$/m.exec(src);

t.ok('the metadata block declares @version', !!meta);

if (meta) {
  const metaVersion = meta[1];
  t.ok(`@version looks like a version (${metaVersion})`, /^\d+\.\d+\.\d+$/.test(metaVersion));
  t.eq('HUD_VERSION matches @version', T.HUD_VERSION, metaVersion);

  // The changelog is what a future session reads to understand a release, and
  // an entry missing for the current version means the release is undocumented.
  const hasEntry = new RegExp('^\\s*\\*\\s+' + metaVersion.replace(/\./g, '\\.') + '\\s+-', 'm').test(src);
  t.ok(`the changelog has an entry for ${metaVersion}`, hasEntry);
}

// --- Action button classification ------------------------------------------

// Labels observed on a live table. Pre-action controls are shown while WAITING
// for someone else to act, so counting them as turn buttons made isHeroTurn
// true for most of the hand.
const isAction = (s) => T.ACTION_BTN_RE.test(s);
const isPre = (s) => T.PREACTION_BTN_RE.test(s);

[['Check', false], ['Fold', false], ['Call $2,500,000', false], ['Raise', false],
  ['Check / Fold', true], ['Call Any / Check', true]].forEach(([label, pre]) => {
  t.ok(`"${label}" is recognised as an action control`, isAction(label));
  t.eq(`"${label}" pre-action = ${pre}`, isPre(label), pre);
});

// Not action controls at all.
['Sit out', 'Leave table', 'Settings', ''].forEach((label) => {
  t.ok(`"${label}" is not an action control`, !isAction(label));
});

process.exit(t.report());
