#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function runUninstall(env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'uninstall.js')], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

delete process.env.CLAUDE_CONFIG_DIR;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-uninstall-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

const home = path.join(temp, 'home');
const claudeDir = path.join(home, '.claude');
fs.mkdirSync(claudeDir, { recursive: true });

const flagPath = path.join(claudeDir, '.puritanical-active');
fs.writeFileSync(flagPath, 'full');

// Qoder keeps its flag in ~/.qoder (hooks/puritanical-runtime.js), and since
// #676 it holds "off", so a leftover would start a reinstall switched off.
const qoderFlagPath = path.join(home, '.qoder', '.puritanical-active');
fs.mkdirSync(path.dirname(qoderFlagPath), { recursive: true });
fs.writeFileSync(qoderFlagPath, 'ultra');
const qoderCustomDir = path.join(temp, 'qoder-custom-config');
const qoderCustomFlagPath = path.join(qoderCustomDir, '.puritanical-active');
fs.mkdirSync(qoderCustomDir, { recursive: true });
fs.writeFileSync(qoderCustomFlagPath, 'lite');

// OpenCode keeps its flag beside its own config; a leftover "off" would start a
// reinstall switched off.
const opencodeFlagPath = path.join(temp, 'config-home', 'opencode', '.puritanical-active');
fs.mkdirSync(path.dirname(opencodeFlagPath), { recursive: true });
fs.writeFileSync(opencodeFlagPath, 'off');

const nudgeFlagPath = path.join(claudeDir, '.puritanical-statusline-nudged');
fs.writeFileSync(nudgeFlagPath, '');

const configDir = path.join(temp, 'config-home', 'puritanical');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'ultra' }));

// #1032: the statusline script copy kept in the config dir.
const statuslineCopyPath = path.join(claudeDir, 'puritanical-statusline.sh');
fs.writeFileSync(statuslineCopyPath, '#!/usr/bin/env bash\n');
const statuslinePs1CopyPath = path.join(claudeDir, 'puritanical-statusline.ps1');
fs.writeFileSync(statuslinePs1CopyPath, '');

const settingsPath = path.join(claudeDir, 'settings.json');
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash /some/path/puritanical-statusline.sh' },
}));

// Cursor (#817): the Cursor mode flag goes too, and ~/.cursor/hooks.json loses
// only puritanical's entries; the user's other hooks stay.
const cursorDir = path.join(home, '.cursor');
fs.mkdirSync(cursorDir, { recursive: true });
const cursorFlagPath = path.join(cursorDir, '.puritanical-active');
fs.writeFileSync(cursorFlagPath, 'lite');
const cursorHooksPath = path.join(cursorDir, 'hooks.json');
fs.writeFileSync(cursorHooksPath, JSON.stringify({
  version: 1,
  hooks: {
    sessionStart: [
      { command: './hooks/mine.sh' },
      { command: 'node "/p/puritanical/hooks/puritanical-activate.js"', timeout: 5 },
    ],
    beforeSubmitPrompt: [{ command: 'node "/p/puritanical/hooks/puritanical-mode-tracker.js"', timeout: 5 }],
  },
}));

const env = {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(temp, 'config-home'),
};

let result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(flagPath), false, 'mode flag must be removed');
assert.equal(fs.existsSync(qoderFlagPath), false, 'Qoder mode flag must be removed');
assert.equal(fs.existsSync(opencodeFlagPath), false, 'OpenCode mode flag must be removed');
assert.equal(fs.existsSync(qoderCustomFlagPath), true, 'default Qoder uninstall must not touch a separate custom config');
assert.equal(fs.existsSync(nudgeFlagPath), false, 'statusline nudge flag must be removed');
assert.equal(fs.existsSync(configPath), false, 'config file must be removed');
assert.equal(fs.existsSync(cursorFlagPath), false, 'Cursor mode flag must be removed');
assert.equal(fs.existsSync(statuslineCopyPath), false, 'statusline script copy must be removed (#1032)');
assert.equal(fs.existsSync(statuslinePs1CopyPath), false, 'statusline .ps1 copy must be removed (#1032)');
assert.deepEqual(
  JSON.parse(fs.readFileSync(cursorHooksPath, 'utf8')),
  { version: 1, hooks: { sessionStart: [{ command: './hooks/mine.sh' }] } },
  "only puritanical's entries may leave ~/.cursor/hooks.json",
);

const settingsAfter = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter.statusLine,
  undefined,
  'puritanical statusLine entry must be removed',
);

// A user's own, unrelated statusLine must survive untouched.
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash ~/my-custom-statusline.sh' },
}));

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
const settingsAfter2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter2.statusLine.command,
  'bash ~/my-custom-statusline.sh',
  "a user's own statusLine must not be touched",
);

// A user command that merely contains puritanical's script name must also survive.
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash ~/my-puritanical-statusline.sh' },
}));

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
const settingsAfterSimilarName = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfterSimilarName.statusLine.command,
  'bash ~/my-puritanical-statusline.sh',
  "a similarly named user statusLine must not be touched",
);

// #374: a combined statusline (another plugin && puritanical) must keep the other
// plugin's part — uninstall must not nuke the whole command or leave a husk.
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash ~/caveman-statusline.sh && bash /p/puritanical-statusline.sh' },
}));

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
const settingsAfter3 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter3.statusLine.command,
  'bash ~/caveman-statusline.sh',
  'a combined statusLine must keep the non-puritanical command',
);

result = runUninstall({ ...env, QODER_CONFIG_DIR: qoderCustomDir });
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(qoderCustomFlagPath), false, 'Qoder custom config mode flag must be removed');

// #434: a malformed settings.json must not crash the script mid-cleanup. It
// can't be safely edited, so uninstall warns and leaves the file byte-for-byte
// intact instead of throwing a SyntaxError after other state was already removed.
const malformedSettings = '{ "statusLine": { "command": "puritanical-statusline.sh", broken';
fs.writeFileSync(settingsPath, malformedSettings);

result = runUninstall(env);
assert.equal(
  result.status,
  0,
  `expected exit 0 on malformed settings.json, got:\n${result.stdout}${result.stderr}`,
);
assert.ok(
  /malformed/i.test(result.stdout + result.stderr),
  'must warn that the statusLine entry could not be removed',
);
assert.equal(
  fs.readFileSync(settingsPath, 'utf8'),
  malformedSettings,
  'malformed settings.json must be left unchanged',
);

// A malformed ~/.cursor/hooks.json must not crash the script either (#817).
const malformedHooks = '{ "version": 1, "hooks": { broken';
fs.writeFileSync(cursorHooksPath, malformedHooks);

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.ok(
  /hooks\.json is malformed/.test(result.stdout + result.stderr),
  'must warn that the Cursor hook entries could not be removed',
);
assert.equal(
  fs.readFileSync(cursorHooksPath, 'utf8'),
  malformedHooks,
  'malformed hooks.json must be left unchanged',
);

// Rewrites replace the file in one rename and keep what the user's editor wrote:
// a UTF-8 BOM, the file mode, and a symlink to a dotfiles checkout.
const BOM = '\uFEFF';
fs.writeFileSync(settingsPath, BOM + JSON.stringify({
  model: 'opus',
  statusLine: { type: 'command', command: 'bash /p/puritanical-statusline.sh' },
}));
fs.writeFileSync(cursorHooksPath, BOM + JSON.stringify({
  version: 1,
  hooks: { stop: [{ command: './mine.sh' }, { command: 'node "/p/puritanical/hooks/puritanical-activate.js"' }] },
}));
if (process.platform !== 'win32') fs.chmodSync(settingsPath, 0o600);
result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
for (const [file, expected] of [
  [settingsPath, { model: 'opus' }],
  [cursorHooksPath, { version: 1, hooks: { stop: [{ command: './mine.sh' }] } }],
]) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith(BOM), `${path.basename(file)} must keep its BOM`);
  assert.deepEqual(JSON.parse(text.slice(1)), expected);
}
if (process.platform !== 'win32') {
  assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600, 'settings.json must keep its mode');
}
for (const dir of [claudeDir, cursorDir]) {
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), [], `no temp file may be left in ${dir}`);
}

const dotfiles = path.join(temp, 'dotfiles');
fs.mkdirSync(dotfiles);
const realSettings = path.join(dotfiles, 'settings.json');
fs.writeFileSync(realSettings, JSON.stringify({ statusLine: { type: 'command', command: 'bash /p/puritanical-statusline.sh' } }));
fs.rmSync(settingsPath);
let linked = true;
try { fs.symlinkSync(realSettings, settingsPath); } catch (e) { linked = false; } // Windows without symlink rights
if (linked) {
  result = runUninstall(env);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.lstatSync(settingsPath).isSymbolicLink(), 'a symlinked settings.json must stay a symlink');
  assert.deepEqual(JSON.parse(fs.readFileSync(realSettings, 'utf8')), {}, 'the link target must be updated');
}

// Running on an already-clean machine must not throw.
result = runUninstall({ HOME: path.join(temp, 'home-empty'), USERPROFILE: path.join(temp, 'home-empty') });
assert.equal(result.status, 0, result.stderr);

console.log('uninstall script checks passed');
