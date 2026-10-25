#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

// Variables that move a config location; each run names its own or gets the default.
const CONFIG_LOCATION_VARS = ['APPDATA', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'QODER_CONFIG_DIR', 'CODEBUDDY_CONFIG_DIR'];

function runUninstall(env) {
  const base = { ...process.env };
  for (const name of CONFIG_LOCATION_VARS) delete base[name];
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'uninstall.js')], {
    env: { ...base, ...env },
    encoding: 'utf8',
  });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'puritanical-uninstall-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

// Stand-ins for the developer's real config locations. A run that inherits
// one of these variables would uninstall from the developer's machine, as the
// home-empty run below once did with APPDATA on Windows.
const inherited = path.join(temp, 'inherited');
const inheritedFiles = [];
for (const [name, file] of [
  ['APPDATA', path.join('puritanical', 'config.json')],
  ['XDG_CONFIG_HOME', path.join('puritanical', 'config.json')],
  ['CLAUDE_CONFIG_DIR', '.puritanical-active'],
  ['QODER_CONFIG_DIR', '.puritanical-active'],
  ['CODEBUDDY_CONFIG_DIR', '.puritanical-active'],
]) {
  process.env[name] = path.join(inherited, name);
  const filePath = path.join(process.env[name], file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'keep');
  inheritedFiles.push(filePath);
}

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

// Running on an already-clean machine must not throw.
result = runUninstall({ HOME: path.join(temp, 'home-empty'), USERPROFILE: path.join(temp, 'home-empty') });
assert.equal(result.status, 0, result.stderr);

for (const filePath of inheritedFiles) {
  assert.equal(fs.existsSync(filePath), true, `uninstall must not touch inherited config: ${filePath}`);
}

console.log('uninstall script checks passed');
