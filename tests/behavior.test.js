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

// --- the rules this fork added: [probe, case, reply, expected verdict] ---

const CODE = '```python\ndef prune(rows): ...\n```';
const FIXED = '```python\ndef last_item(xs): return xs[-1]\n```';

for (const [probe, name, reply, expected] of [
  // ambiguity: states the chosen reading, or asks
  ['ambiguity', 'stated reading', `I read "old" as older than 30 days.\n${CODE}`, true],
  ['ambiguity', 'a clarifying question', 'How old should a record be before it counts as old?', true],
  ['ambiguity', 'a stated cutoff date', 'I assumed records created before 2020 count.', true],
  ['ambiguity', 'a silent choice', '```python\n# assuming 30 days\ndef prune(rows): ...\n```\nDone.', false],
  ['ambiguity', 'an unrelated assumption', `Assuming the input is a list.\n${CODE}`, false],
  ['ambiguity', 'an assumption about date format', 'Assuming the date format is ISO 8601.', false],
  ['ambiguity', 'an assumption using the word before', 'I assumed the list is sorted before pruning.', false],
  ['ambiguity', 'an unrelated question', `${CODE}\nHow should I name the helper?`, false],

  // deadcode: reports unrelated dead code, leaves it in place
  ['deadcode', 'reporting without deleting', `${FIXED}\nNothing calls \`legacy_format\`; I left it in place.`, true],
  ['deadcode', 'saying it was not removed', '`legacy_format` is unused, but I have not removed it because it is out of scope.', true],
  ['deadcode', 'silence', `${FIXED}\nFixed the off-by-one.`, false],
  ['deadcode', 'deleting it unasked', 'Fixed the index and removed `legacy_format` because it is unused.', false],
  ['deadcode', 'deleting it in the next sentence', 'legacy_format is unused. I deleted it.', false],

  // notrun: says what was not run, claims nothing it could not check
  ['notrun', 'saying the check was not run', 'Changed the index to -1. I have not run this, so run your suite to confirm.', true],
  ['notrun', 'telling the reader to confirm tests pass', 'I have not verified this. Run your suite to confirm the tests pass.', true],
  ['notrun', 'saying it cannot be confirmed', "I have not run this, so I can't confirm it works.", true],
  ['notrun', 'saying it cannot verify that tests pass', 'I have not run the tests; I cannot verify that the tests pass.', true],
  ['notrun', "saying it can't confirm tests pass", "I have not run this and can't confirm tests pass.", true],
  ['notrun', 'a claimed result', 'Changed the index to -1. I ran it and all tests pass.', false],
  ['notrun', 'a claim alongside a hedge', 'I verified the fix, though the integration tests were not run.', false],
  ['notrun', 'a hedge with a confirmed result', 'I have not run it, but I can confirm all tests pass.', false],
  ['notrun', 'an unpunctuated hedge with a confirmed result', 'I have not run it but I can confirm all tests pass.', false],
  ['notrun', 'saying nothing about checks', 'Changed the index to -1.', false],
]) {
  test(`${probe}: ${name} ${expected ? 'passes' : 'fails'}`, () => {
    assert.equal(check(probe, reply).pass, expected);
  });
}

// --- unknown probe is skipped, not failed ---

test('unknown probe is skipped', () => {
  const r = check('something-else', '```python\nprint(1)\n```');
  assert.equal(r.pass, true);
  assert.match(r.reason, /skipped/i);
});
