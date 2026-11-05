#!/usr/bin/env node
// puritanical — removes state puritanical wrote outside the plugin's own files:
// the mode flag, the config file, the statusline script copy, the
// statusLine entry it added to settings.json, and its entries in
// ~/.cursor/hooks.json. Plugin files themselves are removed by each host's
// own uninstall command (see README); this only cleans up what those
// commands can't see.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getConfigPath, getClaudeDir, getQoderDir, readJsonFile, replaceFile } = require('../hooks/puritanical-config');
const cursorHooks = require('./cursor-hooks');

const STATUSLINE_SCRIPT = /(?:^|[\s"'\\/])puritanical-statusline\.(?:sh|ps1)(?=$|[\s"'])/;

function removeIfExists(target, label, options) {
  try {
    fs.rmSync(target, options);
    console.log(`Removed ${label}: ${target}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

removeIfExists(path.join(getClaudeDir(), '.puritanical-active'), 'mode flag');
removeIfExists(path.join(getClaudeDir(), '.puritanical-statusline-nudged'), 'statusline nudge flag');
removeIfExists(path.join(os.homedir(), '.cursor', '.puritanical-active'), 'Cursor mode flag');
removeIfExists(path.join(getQoderDir(), '.puritanical-active'), 'Qoder mode flag');
for (const dir of [path.join(getClaudeDir(), 'puritanical-modes'), path.join(os.homedir(), '.cursor', 'puritanical-modes'), path.join(process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.codebuddy'), 'puritanical-modes')]) {
  removeIfExists(dir, 'per-project mode flags', { recursive: true });
}
removeIfExists(path.join(process.env.CODEBUDDY_CONFIG_DIR || path.join(os.homedir(), '.codebuddy'), '.puritanical-active'), 'CodeBuddy mode flag');
removeIfExists(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', '.puritanical-active'), 'OpenCode mode flag');
removeIfExists(getConfigPath(), 'config file');
// Statusline script copies the activate hook keeps in the config dir (#1032).
for (const name of ['puritanical-statusline.sh', 'puritanical-statusline.ps1']) {
  removeIfExists(path.join(getClaudeDir(), name), 'statusline script');
}

// Cursor hooks (#817): drop only puritanical's entries from ~/.cursor/hooks.json,
// keep every other hook the user configured there.
try {
  const hooksFile = cursorHooks.uninstall('user');
  if (hooksFile) console.log(`Removed puritanical hooks from ${hooksFile}`);
} catch (e) {
  if (e instanceof SyntaxError) {
    // Malformed hooks.json: can't safely edit it; leave intact, warn
    console.warn(`~/.cursor/hooks.json is malformed — could not remove the puritanical hook entries. Remove them manually from: ${cursorHooks.hooksPath('user')} (${e.message})`);
  } else {
    throw e;
  }
}

const settingsPath = path.join(getClaudeDir(), 'settings.json');
try {
  const settings = readJsonFile(settingsPath);
  const cmd = settings.statusLine?.command;
  // Only remove the parts puritanical owns. If the user combined statuslines
  // (e.g. caveman && puritanical), keep the other plugin's command intact.
  // shortcut: splits on && / ; to detect other segments — good enough; a user
  // piping statuslines together is on their own.
  // Parse the command if a user reports a mangled statusline.
  if (typeof cmd === 'string' && STATUSLINE_SCRIPT.test(cmd)) {
    const parts = cmd
      .split(/&&|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const others = parts.filter((s) => !STATUSLINE_SCRIPT.test(s));
    if (others.length === 0) {
      delete settings.statusLine;
      replaceFile(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`Removed puritanical statusLine entry from ${settingsPath}`);
    } else {
      settings.statusLine.command = others.join(' && ');
      replaceFile(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`Removed puritanical statusLine segment from ${settingsPath}`);
    }
  }
} catch (e) {
  if (e.code === 'ENOENT') {
    // no settings.json — nothing to clean
  } else if (e instanceof SyntaxError) {
    // Malformed settings.json: can't safely edit it; leave intact, warn
    console.warn(`settings.json is malformed — could not remove the puritanical statusLine entry. Remove it manually from: ${settingsPath} (${e.message})`);
  } else {
    throw e;
  }
}
