#!/usr/bin/env node
// Copyright 2026 Ryan Duguid
// SPDX-License-Identifier: FSL-1.1-ALv2

// A symlink planted at a predictable flag path must not redirect the write.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeFileNoFollow } = require('../hooks/puritanical-config');

test('flag writes refuse to follow a planted symlink', { skip: !fs.constants.O_NOFOLLOW }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-symlink-'));
  try {
    const victim = path.join(dir, 'victim');
    const flag = path.join(dir, '.puritanical-active');
    fs.writeFileSync(victim, 'SECRET');
    fs.symlinkSync(victim, flag);
    assert.throws(() => writeFileNoFollow(flag, 'full'), { code: 'ELOOP' });
    assert.equal(fs.readFileSync(victim, 'utf8'), 'SECRET');

    const clean = path.join(dir, 'nested', '.puritanical-active');
    writeFileNoFollow(clean, 'ultra');
    writeFileNoFollow(clean, 'lite');
    assert.equal(fs.readFileSync(clean, 'utf8'), 'lite');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the statusline nudge flag refuses to follow a planted symlink', { skip: !fs.constants.O_NOFOLLOW }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-symlink-'));
  try {
    const victim = path.join(dir, 'victim');
    fs.writeFileSync(victim, 'SECRET');
    const stale = path.join(dir, 'gone', 'puritanical-statusline.sh');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { command: 'bash "' + stale + '"' } }));
    fs.symlinkSync(victim, path.join(dir, '.puritanical-statusline-nudged'));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PROJECT_DIR: '' };
    for (const name of ['PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'CURSOR_VERSION', 'QODER_PROJECT_DIR', 'CODEBUDDY_PLUGIN_ROOT', 'PURITANICAL_DEFAULT_MODE']) delete env[name];
    const hook = path.join(__dirname, '..', 'hooks', 'puritanical-activate.js');
    const result = spawnSync(process.execPath, [hook], { env, input: '', encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /STATUSLINE BROKEN/);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'SECRET');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
