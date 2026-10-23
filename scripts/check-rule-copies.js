#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { render } = require('./sync-rules');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n').trim();
}

let failed = false;

// Every copy is generated from skills/ by scripts/sync-rules.js; compare them all.
for (const [relPath, expected] of Object.entries(render())) {
  if (!fs.existsSync(path.join(root, relPath)) || read(relPath) !== expected.trim()) {
    console.error(`${relPath} drifted from skills/ (run node scripts/sync-rules.js)`);
    failed = true;
  }
}

// The load-bearing rules must survive any rewording of the core skill. Changing
// one of these phrases is a deliberate policy change: update this list with it.
const INVARIANTS = [
  "in this codebase",
  "inspect their callers",
  "Complete explicit requirements",
  "with a `shortcut:` comment",
  "semantics, failure modes",
  "There is no one-test ceiling",
  "validation at trust boundaries",
  "prevents data loss",
  "security",
  "accessibility",
  "fails without the fix",
  "not run",
];

const skill = read('skills/puritanical/SKILL.md');
for (const phrase of INVARIANTS) {
  if (!skill.includes(phrase)) {
    console.error(`skills/puritanical/SKILL.md is missing rule invariant: "${phrase}"`);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log(`All rule copies match skills/; ${INVARIANTS.length} rule invariants present.`);
