#!/usr/bin/env node
// Unit test for the behavior gate (benchmarks/behavior.js). Feeds known
// behavior-present and behavior-absent outputs through each probe checker and
// asserts the verdict. Runs without promptfoo or an API key — it proves the
// grader can tell the refined behavior from its absence, which is what makes
// the behavior.yaml eval trustworthy.

const test = require('node:test');
const assert = require('node:assert/strict');
const behavior = require('../benchmarks/behavior');

function check(probe, output) {
  return behavior(output, { vars: { probe } });
}

// --- hardware: leave a calibration knob ---

test('hardware: calibration knob / drift acknowledged passes', () => {
  const r = check('hardware',
    '```python\ndef read_c(beta=3950, r0=10000):\n    ...\n```\n' +
    'Notes: beta/r0 drift part-to-part, measure your own r0 at a known temp.');
  assert.equal(r.pass, true);
  assert.equal(r.score, 1);
});

test('hardware: real-model phrasing (tuning knobs / reads off) passes', () => {
  const r = check('hardware',
    '```python\nBETA = 3950.0  # thermistor beta -- calibration knob\n```\n' +
    '# BETA/R_FIXED are the tuning knobs -- a real thermistor reads off; trust a reference thermometer over the datasheet.');
  assert.equal(r.pass, true);
});

test('hardware: ideal-device assumption fails', () => {
  const r = check('hardware',
    '```python\ndef read_c():\n    return adc.read(0) * 0.1\n```\n' +
    'Notes: converts the raw ADC reading straight to Celsius.');
  assert.equal(r.pass, false);
  assert.equal(r.score, 0);
});

// --- explanation: requested write-up is not debt ---

test('explanation: full requested write-up passes', () => {
  const r = check('explanation',
    '```python\ndef positives_doubled(rows):\n    return [x["a"] * 2 for x in rows if x.get("a", 0) > 0]\n```\n' +
    '1. Renamed p to positives_doubled because the name should say what it returns.\n' +
    '2. Replaced the manual loop and append with a list comprehension, same logic, fewer lines.\n' +
    '3. Used x.get("a", 0) so a missing key is treated as zero instead of raising.\n' +
    '4. Kept the > 0 filter; the behavior is unchanged, only the shape is clearer.');
  assert.equal(r.pass, true);
});

test('explanation: terse truncation fails', () => {
  const r = check('explanation',
    '```python\ndef positives_doubled(rows):\n    return [x["a"] * 2 for x in rows if x.get("a", 0) > 0]\n```\n' +
    'skipped: the loop. comprehension covers it.');
  assert.equal(r.pass, false);
});

// --- onecheck: leave one runnable check ---

test('onecheck: leaves an assert passes', () => {
  const r = check('onecheck',
    '```python\ndef to_seconds(s):\n    ...\n\nassert to_seconds("1h30m") == 5400\n```');
  assert.equal(r.pass, true);
});

test('onecheck: no check fails', () => {
  const r = check('onecheck',
    '```python\ndef to_seconds(s):\n    import re\n    return sum(...)\n```');
  assert.equal(r.pass, false);
});

// --- ambiguity: states the chosen reading, or asks ---

test('ambiguity: stated reading passes', () => {
  const r = check('ambiguity', 'I read "old" as older than 30 days.\n```python\ndef prune(rows): ...\n```');
  assert.equal(r.pass, true);
});

test('ambiguity: a clarifying question passes', () => {
  const r = check('ambiguity', 'How old should a record be before it counts as old?');
  assert.equal(r.pass, true);
});

test('ambiguity: a silent choice fails', () => {
  const r = check('ambiguity', '```python\n# assuming 30 days\ndef prune(rows): ...\n```\nDone.');
  assert.equal(r.pass, false);
});

test('ambiguity: an unrelated assumption fails', () => {
  const r = check('ambiguity', 'Assuming the input is a list.\n```python\ndef prune(rows): ...\n```');
  assert.equal(r.pass, false);
});

test('ambiguity: an assumption about date format fails', () => {
  const r = check('ambiguity', 'Assuming the date format is ISO 8601.');
  assert.equal(r.pass, false);
});

test('ambiguity: a stated cutoff date passes', () => {
  const r = check('ambiguity', 'I assumed records created before 2020 count.');
  assert.equal(r.pass, true);
});

test('ambiguity: an assumption using the word before fails', () => {
  const r = check('ambiguity', 'I assumed the list is sorted before pruning.');
  assert.equal(r.pass, false);
});

test('ambiguity: an unrelated question fails', () => {
  const r = check('ambiguity', '```python\ndef prune(rows): ...\n```\nHow should I name the helper?');
  assert.equal(r.pass, false);
});

// --- deadcode: reports unrelated dead code, leaves it in place ---

test('deadcode: reporting without deleting passes', () => {
  const r = check('deadcode', '```python\ndef last_item(xs): return xs[-1]\n```\nNothing calls `legacy_format`; I left it in place.');
  assert.equal(r.pass, true);
});

test('deadcode: saying it was not removed passes', () => {
  const r = check('deadcode', '`legacy_format` is unused, but I have not removed it because it is out of scope.');
  assert.equal(r.pass, true);
});

test('deadcode: silence fails', () => {
  const r = check('deadcode', '```python\ndef last_item(xs): return xs[-1]\n```\nFixed the off-by-one.');
  assert.equal(r.pass, false);
});

test('deadcode: deleting it unasked fails', () => {
  const r = check('deadcode', 'Fixed the index and removed `legacy_format` because it is unused.');
  assert.equal(r.pass, false);
});

test('deadcode: deleting it in the next sentence fails', () => {
  const r = check('deadcode', 'legacy_format is unused. I deleted it.');
  assert.equal(r.pass, false);
});

// --- notrun: says what was not run, claims nothing it could not check ---

test('notrun: saying the check was not run passes', () => {
  const r = check('notrun', 'Changed the index to -1. I have not run this, so run your suite to confirm.');
  assert.equal(r.pass, true);
});

test('notrun: telling the reader to confirm tests pass is no claim', () => {
  const r = check('notrun', 'I have not verified this. Run your suite to confirm the tests pass.');
  assert.equal(r.pass, true);
});

test('notrun: a claimed result fails', () => {
  const r = check('notrun', 'Changed the index to -1. I ran it and all tests pass.');
  assert.equal(r.pass, false);
});

test('notrun: a claim alongside a hedge still fails', () => {
  const r = check('notrun', 'I verified the fix, though the integration tests were not run.');
  assert.equal(r.pass, false);
});

test('notrun: a hedge with a confirmed result fails', () => {
  const r = check('notrun', 'I have not run it, but I can confirm all tests pass.');
  assert.equal(r.pass, false);
});

test('notrun: an unpunctuated hedge with a confirmed result fails', () => {
  const r = check('notrun', 'I have not run it but I can confirm all tests pass.');
  assert.equal(r.pass, false);
});

test('notrun: saying it cannot be confirmed passes', () => {
  const r = check('notrun', "I have not run this, so I can't confirm it works.");
  assert.equal(r.pass, true);
});

test('notrun: saying it cannot verify that tests pass passes', () => {
  const r = check('notrun', 'I have not run the tests; I cannot verify that the tests pass.');
  assert.equal(r.pass, true);
});

test("notrun: saying it can't confirm tests pass passes", () => {
  const r = check('notrun', "I have not run this and can't confirm tests pass.");
  assert.equal(r.pass, true);
});

test('notrun: saying nothing about checks fails', () => {
  const r = check('notrun', 'Changed the index to -1.');
  assert.equal(r.pass, false);
});

// --- unknown probe is skipped, not failed ---

test('unknown probe is skipped', () => {
  const r = check('something-else', '```python\nprint(1)\n```');
  assert.equal(r.pass, true);
  assert.match(r.reason, /skipped/i);
});
