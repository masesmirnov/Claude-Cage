import test from 'node:test';
import assert from 'node:assert/strict';
import { runIssueSystemLabels, systemLabelsFromBody } from './issue-system-labels.mjs';

test('reads the host and guest dropdowns of the issue forms', () => {
  const body = '### Problem and actual behavior\n\nAlso seen on Windows, not tried on Linux\n\n### Host system\n\nmacOS\n\n### Host version and architecture\n\nmacOS 26.4 arm64\n\n### Guest system\n\nLinux\n\n### Guest version and architecture\n\nUbuntu 24.04 arm64\n\n### Steps to reproduce\n\nOpen a Windows guest';
  assert.deepEqual(systemLabelsFromBody(body), ['macOS host', 'Linux guest']);
});

test('reads multi-select answers and ignores sides that do not apply', () => {
  const body = '### Host systems involved\n\nmacOS, Windows, Linux\n\n### Guest systems involved\n\nNot involved or not sure\n';
  assert.deepEqual(systemLabelsFromBody(body), ['macOS host', 'Windows host', 'Linux host']);
});

test('reads free-text fields, including a field shared by both sides', () => {
  assert.deepEqual(
    systemLabelsFromBody('### Host and guest systems\r\n\r\nHost: Windows 11 24H2 x64\r\nGuest: Debian 13\r\nBoth have a macOS-style theme installed\r\n'),
    ['Windows host', 'Linux guest'],
  );
  assert.deepEqual(systemLabelsFromBody('### Host system and architecture\n\nAll platforms\n\n### Guest system and architecture\n\n_No response_'), ['macOS host', 'Windows host', 'Linux host']);
  assert.deepEqual(systemLabelsFromBody('Body without form headings that mentions a macOS host'), []);
  assert.deepEqual(systemLabelsFromBody(null), []);
});

function setup(issue) {
  const calls = [];
  const request = async (method, path, token, body) => {
    calls.push({ method, path, token, body });
    return method === 'GET' ? { status: 200, data: issue } : { status: 200, data: [] };
  };
  return { calls, options: { repository: 'owner/project', number: 42, token: 'issue-token', request } };
}

test('adds only the system labels the issue does not have yet', async () => {
  const { calls, options } = setup({ body: '### Host system\n\nmacOS\n\n### Guest system\n\nLinux', labels: [{ name: 'bug' }, { name: 'macOS host' }] });
  assert.deepEqual(await runIssueSystemLabels(options), { status: 'labeled', labels: ['Linux guest'] });
  assert.deepEqual(calls[1], { method: 'POST', path: '/repos/owner/project/issues/42/labels', token: 'issue-token', body: { labels: ['Linux guest'] } });
});

test('leaves issues without a recognised system and pull requests untouched', async () => {
  const plain = setup({ body: '### Documentation location\n\nREADME.md', labels: [] });
  assert.deepEqual(await runIssueSystemLabels(plain.options), { status: 'unchanged', labels: [] });
  const pull = setup({ body: '### Host system\n\nmacOS', labels: [], pull_request: {} });
  assert.deepEqual(await runIssueSystemLabels(pull.options), { status: 'skipped', labels: [] });
  assert.equal(plain.calls.length + pull.calls.length, 2);
});

test('rejects invalid input and failed requests', async () => {
  const { options } = setup({ body: '', labels: [] });
  await assert.rejects(runIssueSystemLabels({ ...options, number: '1/../2' }), /positive integer/);
  await assert.rejects(runIssueSystemLabels({ ...options, token: '' }), /GITHUB_TOKEN/);
  await assert.rejects(runIssueSystemLabels({ ...options, request: async () => ({ status: 404 }) }), /HTTP 404/);
});
