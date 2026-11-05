#!/usr/bin/env node
// Copyright 2026 Ryan Duguid
// SPDX-License-Identifier: FSL-1.1-ALv2

// A config file that cannot supply settings must read as no settings, whatever is in it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDefaultMode, getHideStatus, getQuietStartup, readJsonFile } = require('../hooks/puritanical-config');

const SETTINGS = ['PURITANICAL_DEFAULT_MODE', 'PURITANICAL_HIDE_STATUS', 'PURITANICAL_QUIET_STARTUP'];

function withConfig(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-config-read-'));
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const name of SETTINGS) delete process.env[name];
  process.env.XDG_CONFIG_HOME = dir;
  fs.mkdirSync(path.join(dir, 'puritanical'));
  const file = path.join(dir, 'puritanical', 'config.json');
  if (content !== null) fs.writeFileSync(file, content);
  return file;
}

for (const [name, content] of [
  ['missing', null], ['malformed', '{ "hideStatus": true,'], ['null', 'null'], ['false', 'false'], ['a number', '5'],
]) {
  test(`a ${name} config file gives the defaults`, (t) => {
    withConfig(t, content);
    assert.equal(getDefaultMode(), 'full');
    assert.equal(getHideStatus(), false);
    assert.equal(getQuietStartup(), false);
  });
}

test('settings are read through a UTF-8 BOM', (t) => {
  withConfig(t, '\uFEFF{ "defaultMode": "lite", "hideStatus": true, "quietStartup": true }');
  assert.equal(getDefaultMode(), 'lite');
  assert.equal(getHideStatus(), true);
  assert.equal(getQuietStartup(), true);
});

test('readJsonFile keeps a missing file and malformed JSON apart for its callers', (t) => {
  const file = withConfig(t, '{ broken');
  assert.throws(() => readJsonFile(file), SyntaxError);
  fs.rmSync(file);
  assert.throws(() => readJsonFile(file), { code: 'ENOENT' });
});
