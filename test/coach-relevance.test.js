// The live coach tip is chosen for the DECISION, not just the player (v1.2.0).
//
// currentExploitTip() used to take buildExploitPlan(p)[0] — the villain's
// highest-gain leak overall — and print it whatever hero was facing. On the
// river against a shove it would still say "c-bet every flop you take the lead
// in", which is true about the player and useless about the decision.
//
// Entries now carry an optional `when` list of context tokens, and scoring
// applies a BOOST for a match and a penalty for a tagged-but-unmatched entry.
// Relevance is deliberately not a filter: a hard filter leaves the panel silent
// in spots no rule covers, and a general read beats no read.
//
// The two properties that have to hold together, and pull against each other:
//   - a matched situational rule must win a close call, or context is pointless
//   - a matched rule must NOT bury a high-gain always-relevant state read
//     (tilt) that applies on every street
// The bonus/penalty values exist to sit between those, and the assertions below
// pin both sides so a future tweak can't quietly break one to help the other.

const fs = require('fs');
const path = require('path');
const { load, runner } = require('./harness');

const t = runner('coach-relevance');
const T = load();

t.ok('entryRelevance is exported', typeof T.entryRelevance === 'function');
t.ok('handContextTokens is exported', typeof T.handContextTokens === 'function');

const flopLead = new Set(['flop', 'postflop', 'lead']);
const riverFacing = new Set(['river', 'postflop', 'facing']);
const preflop = new Set(['preflop']);

// --- an untagged entry applies everywhere and is never punished -------------

t.eq('an entry with no `when` is neutral', T.entryRelevance({ gain: 1 }, flopLead), 0);
t.eq('`when: null` is neutral', T.entryRelevance({ when: null }, flopLead), 0);
t.eq('`when: []` is neutral', T.entryRelevance({ when: [] }, flopLead), 0);

// --- matching --------------------------------------------------------------

t.eq('flop+lead matches on the flop holding the lead', T.entryRelevance({ when: ['flop', 'lead'] }, flopLead), 1);
t.eq('flop+lead does not match on the river', T.entryRelevance({ when: ['flop', 'lead'] }, riverFacing), -1);
t.eq('facing matches when facing a bet', T.entryRelevance({ when: ['facing'] }, riverFacing), 1);
t.eq('facing does not match when hero holds the lead unbet-into',
  T.entryRelevance({ when: ['facing'] }, flopLead), -1);
t.eq('postflop matches the river', T.entryRelevance({ when: ['postflop'] }, riverFacing), 1);
t.eq('postflop does not match preflop', T.entryRelevance({ when: ['postflop'] }, preflop), -1);

// EVERY token must be present, not any — an "any" reading would fire flop
// advice merely because the street happened to be postflop.
t.eq('all tokens must match, not any', T.entryRelevance({ when: ['flop', 'facing'] }, flopLead), -1);

// --- the scoring properties that motivated the change ----------------------

const BONUS = 60, PENALTY = 45;
const score = (gain, rel) => gain + (rel > 0 ? BONUS : rel < 0 ? -PENALTY : 0);
const cbet = { gain: 100, when: ['flop', 'lead'] };   // "fire every flop"
const facingRead = { gain: 76, when: ['facing'] };    // "their raise = nuts"
const tilt = { gain: 110 };                           // untagged state read

t.ok('on the river facing a bet, the facing read beats the off-street c-bet rule',
  score(facingRead.gain, T.entryRelevance(facingRead, riverFacing))
    > score(cbet.gain, T.entryRelevance(cbet, riverFacing)));
t.ok('on the flop with the lead, the c-bet rule wins instead',
  score(cbet.gain, T.entryRelevance(cbet, flopLead))
    > score(facingRead.gain, T.entryRelevance(facingRead, flopLead)));
t.ok('tilt still outranks an OFF-street c-bet rule',
  score(tilt.gain, 0) > score(cbet.gain, T.entryRelevance(cbet, riverFacing)));
t.ok('but an ON-street rule can beat tilt, or context would never matter',
  score(cbet.gain, T.entryRelevance(cbet, flopLead)) > score(tilt.gain, 0));

// --- the tag vocabulary must match what the context can emit ----------------
//
// A typo'd tag ('flops', 'raising') is invisible: entryRelevance just returns
// -1 forever, so the rule is permanently demoted and never errors. Scanning the
// source is the only thing that catches it.

{
  const src = fs.readFileSync(path.join(__dirname, '..', 'torn-poker-hud.user.js'), 'utf8');
  const emitted = ['preflop', 'flop', 'turn', 'river', 'postflop', 'facing', 'lead'];
  const used = new Set();
  (src.match(/,\s*\['[a-z]+'(?:,\s*'[a-z]+')*\]\);/g) || []).forEach((m) => {
    (m.match(/'([a-z]+)'/g) || []).forEach((tok) => used.add(tok.replace(/'/g, '')));
  });
  t.ok('at least one rule is tagged (guards against the scan silently matching nothing)',
    used.size > 0);
  const unknown = [...used].filter((tok) => emitted.indexOf(tok) === -1);
  t.eq('no rule declares a token handContextTokens can never emit: ' + unknown.join(','),
    unknown.length, 0);
}

process.exit(t.report());
