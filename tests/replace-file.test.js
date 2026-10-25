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

for (const method of ['writeFileSync', 'renameSync']) {
  test(`a failed ${method} preserves the original and cleans up the owned temp`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = path.join(dir, 'settings.json');
    fs.writeFileSync(target, 'original');
    t.mock.method(fs, method, () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); });
    assert.throws(() => replaceFile(target, 'new'), { code: 'EACCES' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  });
}

test('a dangling settings symlink is rejected without replacing the link', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'settings.json');
  const missing = path.join(dir, 'missing.json');
  try { fs.symlinkSync(missing, target); } catch (e) {
    if (e.code !== 'EPERM') throw e;
    t.skip('symlink creation is not permitted');
    return;
  }
  assert.throws(() => replaceFile(target, 'new'), /dangling symlink/);
  assert.ok(fs.lstatSync(target).isSymbolicLink());
  assert.equal(fs.existsSync(missing), false);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('a rejected write permission leaves the original intact', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'settings.json');
  fs.writeFileSync(target, 'original');
  t.mock.method(fs, 'accessSync', () => { throw Object.assign(new Error('read only'), { code: 'EACCES' }); });
  assert.throws(() => replaceFile(target, 'new'), { code: 'EACCES' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('a POSIX read-only file stays unchanged', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-replace-'));
  t.after(() => { fs.chmodSync(target, 0o600); fs.rmSync(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'settings.json');
  fs.writeFileSync(target, 'original', { mode: 0o444 });
  assert.throws(() => replaceFile(target, 'new'), { code: 'EACCES' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
});
