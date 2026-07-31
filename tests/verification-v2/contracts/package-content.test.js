'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const PACKAGE_ROOT = path.join(ROOT, 'plugins/specnav-verification');

test('published kernel package includes the public entry, registry, and schemas', () => {
  const destination = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-verification-pack-')
  );
  try {
    const result = spawnSync(
      'npm',
      ['pack', PACKAGE_ROOT, '--pack-destination', destination, '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env
      }
    );
    assert.equal(
      result.status,
      0,
      `npm pack failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const packed = JSON.parse(result.stdout);
    assert.equal(Array.isArray(packed), true);
    assert.equal(packed.length, 1);
    const files = new Set(packed[0].files.map((entry) => entry.path));

    for (const requiredPath of [
      'kernel/index.js',
      'kernel/contracts/schema-registry.js',
      'schemas/common.schema.json',
      'schemas/test-case.schema.json',
      'schemas/evidence.schema.json',
      'schemas/gate-decision.schema.json',
      'schemas/migration-receipt.schema.json'
    ]) {
      assert.equal(files.has(requiredPath), true, requiredPath);
    }

    assert.equal(
      [...files].some((file) => file.startsWith('node_modules/')),
      false
    );
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
