#!/usr/bin/env node
// A synchronous child process with no timeout hangs the whole `node --test`
// run if a hook or script under test blocks (on stdin, say). Every sync call
// in the tests must therefore pass one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SYNC_CALL = /\b(spawnSync|execFileSync|execSync)\(/g;

// The argument text of the call starting at `open`, up to its closing paren.
function callArgs(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

test('every synchronous child process in the tests has a timeout', () => {
  const missing = [];
  for (const name of fs.readdirSync(__dirname).filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    for (const match of source.matchAll(SYNC_CALL)) {
      const args = callArgs(source, match.index + match[0].length - 1);
      if (!/\btimeout\b/.test(args)) {
        const line = source.slice(0, match.index).split('\n').length;
        missing.push(`${name}:${line} ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'add a timeout to these calls');
});
