#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('root npm test covers bundled subprojects', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.match(packageJson.scripts.test, /npm test --prefix pi-extension/);
});

test('publishing gates OIDC access on tests and pins executable dependencies', () => {
  const publish = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8').replace(/\r\n/g, '\n');
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(ci, /^  workflow_call:$/m);
  assert.doesNotMatch(ci, /^    tags:/m, 'tag tests are run by the publishing workflow');
  assert.match(publish, /^  test:\n    uses: \.\/\.github\/workflows\/test\.yml$/m);
  assert.match(publish, /^  publish:\n    needs: test$/m);
  assert.match(publish, /^permissions:\n  contents: read\n\n/m);
  assert.match(publish, /^    permissions:\n      contents: read\n      id-token: write$/m);
  // The second grant only lets the called test.yml start: its codecov job
  // requests id-token but never runs in a publish run, whose event is
  // workflow_dispatch alone.
  assert.equal((publish.match(/^\s*id-token:/gm) || []).length, 2);
  assert.match(publish, /^on:\n  workflow_dispatch:\n\n/m);
  // Test code never holds an OIDC token: only the separate codecov job
  // requests one, after the tests, on pushes and same-repository pull requests.
  const codecov = ci.match(/^  codecov:\n(?: {4}.*\n|\n)*/m);
  assert.ok(codecov, 'test.yml has a codecov job');
  assert.equal((ci.match(/id-token:/g) || []).length, 1);
  assert.match(codecov[0], /^      id-token: write /m);
  assert.match(codecov[0], /^    needs: test\n    if: github\.event_name == 'push' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\n/m);
  assert.match(publish, /npm install -g npm@\d+\.\d+\.\d+(?:\r?\n|$)/);

  for (const workflow of [publish, ci]) {
    for (const action of workflow.matchAll(/^\s+- uses: (.+)$/gm)) {
      assert.match(action[1], /^(?:actions\/[\w-]+|codecov\/codecov-action)@[a-f0-9]{40} # v\d+\.\d+\.\d+\r?$/);
    }
  }
});
