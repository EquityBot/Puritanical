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

test('Puritanical is not published to npm', () => {
  // INSTALL.md says so; installs come from this repository.
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.private, true);
  assert.equal(fs.existsSync(path.join(root, '.github', 'workflows', 'publish.yml')), false);
});

test('CI keeps OIDC out of test code and pins its actions', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(ci, /^permissions:\n {2}contents: read\n\n/m);

  // Each job's own permissions, comments dropped; null when it declares none.
  const jobPermissions = (workflow) => {
    const jobs = {};
    const body = workflow.slice(workflow.indexOf('\njobs:\n'));
    for (const job of body.matchAll(/^ {2}([\w-]+):\n((?:(?: {4}.*)?\n)*)/gm)) {
      const block = job[2].match(/^ {4}permissions:\n((?: {6}.*\n)*)/m);
      jobs[job[1]] = block ? block[1].split('\n').map((line) => line.replace(/#.*/, '').trim()).filter(Boolean) : null;
    }
    return jobs;
  };
  const oidc = ['contents: read', 'id-token: write'];
  // Test code never holds an OIDC token: every job declares its own
  // permissions, and only codecov, after the tests, on pushes and
  // same-repository pull requests, requests id-token.
  const ciJobs = jobPermissions(ci);
  assert.deepEqual(Object.keys(ciJobs).sort(), ['codecov', 'test']);
  for (const [name, permissions] of Object.entries(ciJobs)) {
    assert.deepEqual(permissions, name === 'codecov' ? oidc : ['contents: read'], `test.yml job ${name}`);
  }
  const codecov = ci.match(/^ {2}codecov:\n(?: {4}.*\n|\n)*/m);
  assert.match(codecov[0], /^ {4}needs: test\n {4}if: github\.event_name == 'push' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\n/m);
  for (const action of ci.matchAll(/^\s+- uses: (.+)$/gm)) {
    assert.match(action[1], /^(?:actions\/[\w-]+|codecov\/codecov-action)@[a-f0-9]{40} # v\d+\.\d+\.\d+\r?$/);
  }
});
