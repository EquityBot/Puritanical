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
  assert.match(ci, /^permissions:\n  contents: read\n\n/m);
  assert.match(publish, /^on:\n  workflow_dispatch:\n\n/m);

  // Each job's own permissions, comments dropped; null when it declares none.
  const jobPermissions = (workflow) => {
    const jobs = {};
    const body = workflow.slice(workflow.indexOf('\njobs:\n'));
    for (const job of body.matchAll(/^  ([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)) {
      const block = job[2].match(/^    permissions:\n((?: {6}.*\n)*)/m);
      jobs[job[1]] = block ? block[1].split('\n').map((line) => line.replace(/#.*/, '').trim()).filter(Boolean) : null;
    }
    return jobs;
  };
  const oidc = ['contents: read', 'id-token: write'];
  // publish needs OIDC for npm. The test caller's grant only lets the called
  // test.yml start: its codecov job requests id-token but skips a publish run,
  // whose event is workflow_dispatch alone.
  assert.deepEqual(jobPermissions(publish), { test: oidc, publish: oidc });
  // Test code never holds an OIDC token: every job declares its own
  // permissions, and only codecov, after the tests, on pushes and
  // same-repository pull requests, requests id-token.
  const ciJobs = jobPermissions(ci);
  assert.deepEqual(Object.keys(ciJobs).sort(), ['codecov', 'test']);
  for (const [name, permissions] of Object.entries(ciJobs)) {
    assert.deepEqual(permissions, name === 'codecov' ? oidc : ['contents: read'], `test.yml job ${name}`);
  }
  const codecov = ci.match(/^  codecov:\n(?: {4}.*\n|\n)*/m);
  assert.match(codecov[0], /^    needs: test\n    if: github\.event_name == 'push' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\n/m);
  assert.match(publish, /npm install -g npm@\d+\.\d+\.\d+(?:\r?\n|$)/);

  for (const workflow of [publish, ci]) {
    for (const action of workflow.matchAll(/^\s+- uses: (.+)$/gm)) {
      assert.match(action[1], /^(?:actions\/[\w-]+|codecov\/codecov-action)@[a-f0-9]{40} # v\d+\.\d+\.\d+\r?$/);
    }
  }
});
