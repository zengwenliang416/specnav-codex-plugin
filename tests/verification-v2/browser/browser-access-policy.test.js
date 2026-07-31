'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBrowserAccessPolicy
} = require(
  '../../../plugins/specnav-verification/kernel/execution/browser-access-policy'
);

test('browser access policy allows only exact approved HTTP origins', () => {
  const policy = createBrowserAccessPolicy([
    'https://example.test',
    'http://127.0.0.1:48123'
  ]);

  assert.equal(policy.allows('https://example.test/dashboard'), true);
  assert.equal(policy.allows('http://127.0.0.1:48123/api/status'), true);
  assert.equal(policy.allows('https://example.test.evil.invalid/'), false);
  assert.equal(policy.allows('http://127.0.0.1:48124/'), false);
  assert.equal(policy.allows('file:///tmp/host-secret.txt'), false);
});

test('browser access policy rejects malformed or unsafe approved origins', () => {
  for (const origins of [
    [],
    ['file:///tmp'],
    ['https://example.test/path'],
    ['https://user@example.test'],
    ['https://example.test#fragment'],
    ['https://example.test', 'https://example.test']
  ]) {
    assert.throws(
      () => createBrowserAccessPolicy(origins),
      /approved browser origins/
    );
  }
});
