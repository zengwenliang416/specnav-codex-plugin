'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  trustedCoreScript,
  trustedVerificationRoot
} = require('../../../plugins/specnav-operations/scripts/verification-v2-trusted-runtime');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createPlugin(root, pluginName, manifestKind) {
  const manifest = manifestKind === 'claude'
    ? '.claude-plugin/plugin.json'
    : '.codex-plugin/plugin.json';
  writeJson(path.join(root, manifest), {
    name: pluginName,
    version: '0.7.0'
  });
  if (pluginName === 'specnav-core') {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts/specnav-lib.js'),
      "'use strict';\nmodule.exports = {};\n"
    );
  }
  if (pluginName === 'specnav-verification') {
    fs.mkdirSync(path.join(root, 'kernel/repair'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'kernel/index.js'),
      "'use strict';\nmodule.exports = {};\n"
    );
    fs.writeFileSync(
      path.join(root, 'kernel/repair/index.js'),
      "'use strict';\nmodule.exports = {};\n"
    );
  }
}

test('trusted runtime resolves versioned sibling plugins in an installed cache', (t) => {
  const marketplaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-installed-cache-')
  );
  t.after(() => fs.rmSync(
    marketplaceRoot,
    { recursive: true, force: true }
  ));
  const operationsRoot = path.join(
    marketplaceRoot,
    'specnav-operations',
    '0.7.0'
  );
  createPlugin(operationsRoot, 'specnav-operations', 'claude');
  const coreRoot = path.join(
    marketplaceRoot,
    'specnav-core',
    '0.7.0'
  );
  const verificationRoot = path.join(
    marketplaceRoot,
    'specnav-verification',
    '0.7.0'
  );
  createPlugin(coreRoot, 'specnav-core', 'claude');
  createPlugin(verificationRoot, 'specnav-verification', 'claude');

  assert.equal(
    trustedVerificationRoot(marketplaceRoot, {
      operationsRoot,
      env: {}
    }),
    fs.realpathSync(verificationRoot)
  );
  assert.equal(
    trustedCoreScript(marketplaceRoot, {
      operationsRoot,
      env: {}
    }),
    fs.realpathSync(path.join(coreRoot, 'scripts/specnav-lib.js'))
  );
});

test('trusted local source roots take precedence over an environment override', (t) => {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-source-root-')
  );
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-untrusted-root-')
  );
  t.after(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const localVerification = path.join(
    repositoryRoot,
    'plugins/specnav-verification'
  );
  createPlugin(localVerification, 'specnav-verification', 'codex');
  createPlugin(outside, 'specnav-verification', 'codex');

  assert.equal(
    trustedVerificationRoot(repositoryRoot, {
      operationsRoot: path.join(
        repositoryRoot,
        'plugins/specnav-operations'
      ),
      env: {
        SPECNAV_VERIFICATION_ROOT: outside
      }
    }),
    fs.realpathSync(localVerification)
  );
});

test('installed runtime rejects an explicit root outside the discovered marketplace', (t) => {
  const marketplaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-installed-cache-')
  );
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-untrusted-root-')
  );
  t.after(() => {
    fs.rmSync(marketplaceRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const operationsRoot = path.join(
    marketplaceRoot,
    'specnav-operations',
    '0.7.0'
  );
  createPlugin(operationsRoot, 'specnav-operations', 'claude');
  createPlugin(
    path.join(marketplaceRoot, 'specnav-verification/0.7.0'),
    'specnav-verification',
    'claude'
  );
  createPlugin(outside, 'specnav-verification', 'claude');

  assert.throws(
    () => trustedVerificationRoot(marketplaceRoot, {
      operationsRoot,
      env: {
        SPECNAV_VERIFICATION_ROOT: outside
      }
    }),
    /verification-operations:trusted-verification-root-invalid/
  );
});
