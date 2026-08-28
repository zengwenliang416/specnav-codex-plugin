#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  materializeHostAuthorityFixture
} = require('../cross-host/host-authority-test-helpers');

const target = process.argv[2];
if (!target) {
  process.stderr.write(
    'Usage: materialize-live-authority.js <authority-root>\n'
  );
  process.exit(2);
}

const root = path.resolve(target);
if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
  process.stderr.write('live-authority:target-not-empty\n');
  process.exit(2);
}

const fixture = materializeHostAuthorityFixture(root, {
  fixtureRoot: path.join(
    __dirname,
    '../../../plugins/specnav-verification/assets/contract-fixtures'
  )
});
process.stdout.write(`${JSON.stringify({
  schema: 'specnav.verification.live-authority-fixture.v1',
  host_lock: fixture.lockFile,
  fixture_root: fixture.fixtureRoot,
  roots: fixture.roots,
  fallback_used: false
}, null, 2)}\n`);
