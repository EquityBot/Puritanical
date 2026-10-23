#!/usr/bin/env node
// A symlink planted at a predictable flag path must not redirect the write.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
