#!/usr/bin/env node
// puritanical — shared configuration resolver
//
// Resolution order for default mode:
//   1. PURITANICAL_DEFAULT_MODE environment variable
//   2. Config file defaultMode field:
//      - $XDG_CONFIG_HOME/puritanical/config.json (any platform, if set)
//      - ~/.config/puritanical/config.json (macOS / Linux fallback)
//      - %APPDATA%\puritanical\config.json (Windows fallback)
//   3. 'full'

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'full';
const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'review'];
const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'];

// The flag and config files sit at predictable paths. O_NOFOLLOW makes the write
// fail instead of following a symlink planted there to clobber another file.
// Windows has no O_NOFOLLOW (and symlinks need privilege there), so it is a plain write.
const NO_FOLLOW_WRITE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC |
  (fs.constants.O_NOFOLLOW || 0);

function writeFileNoFollow(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { encoding: 'utf8', flag: NO_FOLLOW_WRITE });
}

// Rewrites a user-owned file (settings.json, hooks.json) without leaving it
// half-written: the text goes to a temp file beside the real target, then one
// rename replaces it. A symlink is followed so a dotfiles link survives, and the
// old file's UTF-8 BOM and mode carry over.
function replaceFile(file, text) {
  let target = file;
  let mode = null;
  let bom = '';
  try {
    target = fs.realpathSync(file);
    mode = fs.statSync(target).mode & 0o777;
    fs.accessSync(target, fs.constants.W_OK);
    if (fs.readFileSync(target, 'utf8').startsWith('\uFEFF')) bom = '\uFEFF';
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const entry = fs.lstatSync(file, { throwIfNoEntry: false });
    if (entry && entry.isSymbolicLink()) {
      throw new Error(file + ' is a dangling symlink; nothing was changed');
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.' + process.pid + '.tmp';
  let owned = false;
  try {
    const fd = fs.openSync(tmp, 'wx', mode === null ? 0o666 : mode);
    owned = true;
    try {
      fs.writeFileSync(fd, bom + text, 'utf8');
      if (mode !== null) fs.fchmodSync(fd, mode); // the umask may have narrowed it
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } finally {
    if (owned) try { fs.unlinkSync(tmp); } catch (e) { /* renamed */ }
  }
}

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return RUNTIME_MODES.includes(normalized) ? normalized : null;
}

function normalizeConfigMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : null;
}

function normalizePersistedMode(mode) {
  return normalizeMode(mode) || normalizeConfigMode(mode);
}

// "stop puritanical" / "normal mode" turn puritanical off, but only as a standalone
// command. Matching the phrase anywhere in the message turned it off mid-task
// for ordinary requests like "add a normal mode toggle" — so require the whole
// message to be the command, ignoring case and trailing punctuation.
function isDeactivationCommand(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === 'stop puritanical' || t === 'normal mode';
}

// shortcut: only embed the plugin install path in a statusline shell command when
// it's made of ordinary path characters. An allowlist beats escaping every shell's
// metacharacters; a hostile clone path (quotes, &, $, backtick, ;, etc.) falls back
// to manual setup instead. Allows : \ / for normal Windows and POSIX paths. Full
// per-shell escaper only if a real need appears.
function isShellSafe(p) {
  return typeof p === 'string' && /^[A-Za-z0-9 _.\-:/\\~]+$/.test(p);
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'puritanical');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'puritanical'
    );
  }
  return path.join(os.homedir(), '.config', 'puritanical');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getClaudeDir() {
  // CLAUDE_CONFIG_DIR overrides ~/.claude, matching Claude Code.
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getQoderDir() {
  return process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder');
}

function getDefaultMode() {
  // 1. Environment variable (highest priority)
  // A default must be a runtime level (off/lite/full/ultra); review is
  // a session-only mode, never a valid default (#377). Normalize here so values
  // with whitespace or mixed casing still resolve correctly.
  const envMode = normalizeMode(process.env.PURITANICAL_DEFAULT_MODE);
  if (envMode) {
    return envMode;
  }

  // 2. Config file
  try {
    const configPath = getConfigPath();
    // Strip UTF-8 BOM (common on Windows-saved files) so JSON.parse doesn't choke
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    const configMode = normalizeMode(config.defaultMode);
    if (configMode) {
      return configMode;
    }
  } catch (e) {
    // Config file doesn't exist or is invalid — fall through
  }

  // 3. Default
  return DEFAULT_MODE;
}

// Silence the pi "Puritanical loaded" startup toast while keeping puritanical active.
// PURITANICAL_QUIET_STARTUP=1 (or any truthy value; 0/false/empty mean "show it")
// takes precedence, else config.quietStartup === true. Mirrors getHideStatus.
function getQuietStartup() {
  const env = process.env.PURITANICAL_QUIET_STARTUP;
  if (env !== undefined) {
    const v = env.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, ''));
    return config.quietStartup === true;
  } catch (_) {
    return false;
  }
}

// Hide the status-bar indicator while keeping puritanical active (#324).
// PURITANICAL_HIDE_STATUS=1 (or any truthy value; 0/false/empty mean "don't hide")
// takes precedence, else config.hideStatus === true.
function getHideStatus() {
  const env = process.env.PURITANICAL_HIDE_STATUS;
  if (env !== undefined) {
    const v = env.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, ''));
    return config.hideStatus === true;
  } catch (_) {
    return false;
  }
}

function writeDefaultMode(mode) {
  // Only a runtime level can be a default; review is session-only (#377).
  const normalized = normalizeMode(mode);
  if (!normalized) return null;

  const configPath = getConfigPath();
  // "Prove all things; hold fast that which is good." (1 Thessalonians 5:21)
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    // Only a missing file starts empty; anything else would overwrite the user's other keys.
    if (e.code !== 'ENOENT') throw new Error(configPath + ' could not be read as JSON: ' + e.message);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(configPath + ' must contain a JSON object.');
  }
  config.defaultMode = normalized;
  writeFileNoFollow(configPath, JSON.stringify(config, null, 2));
  return normalized;
}

module.exports = {
  DEFAULT_MODE,
  VALID_MODES,
  RUNTIME_MODES,
  getDefaultMode,
  getConfigDir,
  getConfigPath,
  getClaudeDir,
  getQoderDir,
  getHideStatus,
  getQuietStartup,
  isShellSafe,
  normalizeMode,
  normalizeConfigMode,
  normalizePersistedMode,
  isDeactivationCommand,
  writeDefaultMode,
  writeFileNoFollow,
  replaceFile,
};
