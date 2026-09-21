// The Settings panel's sections: their order, their group labels, and the
// walker that turns them into collapsibles.
//
// Nothing rendered this panel in a test until now, and that gap has already
// cost something: reclaimReportHtml shipped calling `plural`, a const scoped
// inside storageSettingsHtml, which is a ReferenceError the instant Settings
// is opened — on the exact panel someone in trouble goes to. Building the
// whole markup string here is the cheapest form of that check, and it runs
// every one of the helpers spliced through it.
//
// The ORDER is a feature, not an accident of the order things were added. The
// panel is fifteen sections on a phone screen; "logical" was the request, and
// a list that drifts back to append-order is the thing to catch.

const { load, runner } = require('./harness');

const t = runner('settings-sections');

const T = load();

// --- The markup builds at all -----------------------------------------------

const html = T.settingsPanelHtml();
t.ok('settingsPanelHtml returns markup', typeof html === 'string' && html.length > 500);
t.ok('no undefined spliced into it', html.indexOf('undefined') === -1);
t.ok('no [object Object] spliced into it', html.indexOf('[object Object]') === -1);

// --- Section order ----------------------------------------------------------

const headings = (html.match(/<h4>([\s\S]*?)<\/h4>/g) || [])
  .map((h) => h.replace(/<\/?h4>/g, '').trim());

const EXPECTED = [
  // At the table — what is on screen while you play.
  'Seat labels',
  'Your turn',
  'Fold guard',
  'Coach',
  // Reading the table — what the HUD works out about the other players.
  'Departure watch',
  'Torn API features',
  'Estimated battle stats',
  // Your data — getting it out, syncing it, what it costs, resetting it.
  'Hand log',
  'P/L ledger',
  'GitHub Gist sync',
  'Storage',
  'Backup &amp; reset',
  // Troubleshooting.
  'Calibration mode',
];

t.eq('the sections are in the intended order', headings.join(' | '), EXPECTED.join(' | '));

// storageSettingsHtml's own comment says it sits immediately above Backup: the
// remedy for every state it can report is "copy a backup", and that should be
// the next thing under your thumb rather than something to go looking for. It
// had drifted to sitting above Hand log instead.
t.eq('Storage is immediately above Backup', headings[headings.indexOf('Storage') + 1], 'Backup &amp; reset');

// --- Group labels -----------------------------------------------------------

const groups = (html.match(/<div class="tph-set-group">([\s\S]*?)<\/div>/g) || [])
  .map((g) => g.replace(/<[^>]+>/g, '').trim());
t.eq('four group labels', groups.length, 4);
t.ok('none of them is empty', groups.every((g) => g.length > 0));

// A group label introduces the sections BELOW it. If a control ever lands
// between a label and its first heading, that control is orphaned: the walker
// hands it to no section, so it renders permanently expanded above a run of
// collapsed ones.
const between = html.split(/<div class="tph-set-group">[\s\S]*?<\/div>/).slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf('<h4>')));
t.eq('every label is followed by its heading', between.length, 4);
t.ok('with nothing but whitespace in between', between.every((c) => /^\s*$/.test(c)));

// --- Calibration is out of Coach --------------------------------------------
//
// The report that prompted this: "the calibration should not be hidden under
// coach tab". It is the one control whose whole purpose is to be found by
// someone who has been asked for a deep scan, and it was the last line of an
// unrelated section.

const calibToggle = html.indexOf('tph-calib-toggle');
t.ok('the calibration toggle is still in the panel', calibToggle > 0);
t.ok('it comes after the Calibration mode heading',
  calibToggle > html.indexOf('<h4>Calibration mode</h4>'));
t.ok('and nowhere near Coach', calibToggle > html.indexOf('<h4>Departure watch</h4>'));

// Every control wireSettingsPanel reaches for unconditionally. A section moved
// by hand that dropped one of these would throw on the first tap of the gear.
[
  'tph-close', 'tph-open-self', 'tph-open-players', 'tph-hero-name', 'tph-min-hands',
  'tph-badge-toggle', 'tph-selfbadge-toggle', 'tph-badgestats-toggle', 'tph-rolebadge-toggle',
  'tph-turncue-toggle', 'tph-foldguard-toggle', 'tph-coach-toggle', 'tph-table-max',
  'tph-equity-iters', 'tph-coach-reset', 'tph-calib-toggle', 'tph-depart-toggle',
  'tph-torn-api-key', 'tph-spy-toggle', 'tph-spy-api-key', 'tph-client-id', 'tph-connect',
  'tph-export', 'tph-copy-export', 'tph-save-export', 'tph-import', 'tph-do-import',
  'tph-reset-pl', 'tph-reset-hero', 'tph-reset',
].forEach((cls) => t.ok('present: .' + cls, html.indexOf(cls) > 0));

// --- The walker -------------------------------------------------------------
//
// collapseSettingsSections gives each <h4> a body holding everything up to the
// next heading. A group label has to stop that walk too, or it is collected
// into the body of the section ABOVE it and disappears whenever that section
// is closed — which is exactly when you need it to find your way around.
//
// Driven against a linked-list stand-in rather than the harness's class DOM,
// which has no nextSibling/insertBefore. document.createElement is pointed at
// the same stand-in so the body div the walker creates is one of these too,
// and its appendChild actually MOVES a node the way the real one does.

function fakeDom() {
  const mk = (tag) => {
    const el = {
      // The walk tests nodeType before tagName — a text node between two
      // headings is content, not a boundary — so the stand-in must carry it or
      // nothing stops the walk and every assertion below passes vacuously.
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      kids: [],
      parentNode: null,
      attrs: {},
      listeners: {},
      get nextSibling() {
        if (!el.parentNode) return null;
        const i = el.parentNode.kids.indexOf(el);
        return i < 0 ? null : (el.parentNode.kids[i + 1] || null);
      },
      appendChild(c) {
        if (c.parentNode) c.parentNode.kids.splice(c.parentNode.kids.indexOf(c), 1);
        c.parentNode = el; el.kids.push(c); return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.kids.splice(c.parentNode.kids.indexOf(c), 1);
        c.parentNode = el;
        const i = ref ? el.kids.indexOf(ref) : -1;
        if (i < 0) el.kids.push(c); else el.kids.splice(i, 0, c);
        return c;
      },
      setAttribute(k, v) { el.attrs[k] = v; },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
      _fire(ev) { (el.listeners[ev] || []).forEach((fn) => fn({ target: el })); },
      querySelectorAll(sel) {
        if (sel !== 'h4') return [];
        return el.kids.filter((k) => k.tagName === 'H4');
      },
    };
    return el;
  };
  return mk;
}

{
  const mk = fakeDom();
  const doc = T._sandbox.document;
  const realCreate = doc.createElement;
  doc.createElement = (tag) => mk(tag);

  const panel = mk('div');
  const add = (tag, text, cls) => {
    const el = mk(tag);
    el.textContent = text || '';
    if (cls) el.className = cls;
    panel.appendChild(el);
    return el;
  };

  const g1 = add('div', 'At the table', 'tph-set-group');
  const hA = add('h4', 'Alpha');
  const a1 = add('div', 'a1');
  const a2 = add('div', 'a2');
  const g2 = add('div', 'Your data', 'tph-set-group');
  const hB = add('h4', 'Beta');
  const b1 = add('div', 'b1');

  T.collapseSettingsSections(panel);
  doc.createElement = realCreate;

  const bodyOf = (h) => h.nextSibling;
  t.ok('Alpha got a body', bodyOf(hA) && bodyOf(hA).className === 'tph-set-body');
  t.eq('holding only its own content', bodyOf(hA).kids.map((k) => k.textContent).join(','), 'a1,a2');
  t.ok('Beta got a body', bodyOf(hB) && bodyOf(hB).className === 'tph-set-body');
  t.eq('holding only its own content', bodyOf(hB).kids.map((k) => k.textContent).join(','), 'b1');

  // The assertion the walk's stop condition exists for. Without it g2 ends up
  // inside Alpha's body — the label for the sections below it, filed under the
  // section above it, and hidden whenever that one is closed.
  t.eq('the group label is still a direct child of the panel', g2.parentNode, panel);
  t.eq('so is the first one', g1.parentNode, panel);
  t.ok('and neither was collected into a body',
    bodyOf(hA).kids.indexOf(g2) === -1 && bodyOf(hA).kids.indexOf(g1) === -1);
  t.ok('headings are not treated as group labels either', bodyOf(hA).kids.indexOf(hB) === -1);

  // Closed by default, and a tap opens.
  t.eq('sections start closed', bodyOf(hA).style.display, 'none');
  hA._fire('click');
  t.eq('a tap opens it', bodyOf(hA).style.display, '');
  hA._fire('click');
  t.eq('and another closes it', bodyOf(hA).style.display, 'none');

  // Unused bindings kept readable above; referenced so lint-style scans and
  // future edits see they are part of the fixture.
  t.ok('content nodes were re-parented, not copied', a1.parentNode === bodyOf(hA) && b1.parentNode === bodyOf(hB));
  t.ok('the second body follows its own heading', bodyOf(hB) !== bodyOf(hA) && a2.parentNode === bodyOf(hA));
}

process.exit(t.report());
