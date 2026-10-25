const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replaceFile } = require('../hooks/puritanical-config');

test('an existing temp file belongs to someone else and survives a collision', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'settings.json');
  const tmp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(target, 'original');
  fs.writeFileSync(tmp, 'foreign temp');
  assert.throws(() => replaceFile(target, 'new'), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  assert.equal(fs.readFileSync(tmp, 'utf8'), 'foreign temp');
});

test('a failed rename preserves the original and cleans up the owned temp', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'settings.json');
  fs.writeFileSync(target, 'original');
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); });
  assert.throws(() => replaceFile(target, 'new'), { code: 'EACCES' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});
