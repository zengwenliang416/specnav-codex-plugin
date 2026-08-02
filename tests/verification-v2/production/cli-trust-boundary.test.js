'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertSelectedChange,
  loadScenarioRegistry,
  pathsFor
} = require('../../../plugins/specnav-verification/scripts/verification-v2-run');

function git(root, args) {
  const result = childProcess.spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
}

function initializeRepository(root) {
  git(root, ['init']);
  git(root, ['config', 'user.email', 'specnav@example.test']);
  git(root, ['config', 'user.name', 'SpecNav Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
}

test('change evidence overrides cannot escape the selected change root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-cli-paths-'));
  assert.throws(
    () => pathsFor(root, 'change-safe', [
      '--snapshot',
      path.join(root, 'outside.json')
    ]),
    /verification-production:snapshot-outside-change/
  );
});

test('explicit change must be registered and match the active change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-change-'));
  const specnav = path.join(root, 'openspec', '.specnav');
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'change-active'), {
    recursive: true
  });
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'change-other'), {
    recursive: true
  });
  fs.mkdirSync(specnav, { recursive: true });
  fs.writeFileSync(path.join(specnav, 'active-change'), 'change-active\n');

  assert.equal(
    assertSelectedChange(root, 'change-active'),
    'change-active'
  );
  assert.throws(
    () => assertSelectedChange(root, 'change-other'),
    /verification-production:change-not-active/
  );
  assert.throws(
    () => assertSelectedChange(root, '../change-active'),
    /verification-production:change-invalid/
  );
  assert.throws(
    () => assertSelectedChange(root, 'change-missing'),
    /verification-production:change-not-registered/
  );
});

test('scenario registry top-level code runs only in a no-write isolated process', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-scenarios-'));
  const registryDir = path.join(root, 'tests', 'specnav');
  const sentinel = path.join(root, 'sentinel.txt');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}\n');
  fs.writeFileSync(path.join(registryDir, 'registry.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
    'module.exports = { scenarios: {} };',
    ''
  ].join('\n'));
  initializeRepository(root);

  assert.throws(
    () => loadScenarioRegistry(root, 'tests/specnav/registry.js'),
    /verification-production:scenario-registry-isolation-failed/
  );
  assert.equal(fs.existsSync(sentinel), false);
});

test('approved scenario registry restores pure scenario functions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-scenarios-'));
  const registryDir = path.join(root, 'tests', 'specnav');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}\n');
  fs.writeFileSync(path.join(registryDir, 'registry.cjs'), [
    "'use strict';",
    'module.exports = {',
    '  scenarios: {',
    "    'scenario-ready': {",
    "      url: 'https://example.test',",
    "      evaluate: (value) => value === 'ready',",
    '      project: { viewport: { width: 1280, height: 720 } }',
    '    }',
    '  }',
    '};',
    ''
  ].join('\n'));
  initializeRepository(root);

  const registry = loadScenarioRegistry(
    root,
    'tests/specnav/registry.cjs'
  );
  const scenario = registry.resolve('scenario-ready');

  assert.equal(scenario.url, 'https://example.test');
  assert.equal(scenario.evaluate('ready'), true);
  assert.equal(scenario.evaluate('blocked'), false);
  assert.deepEqual(
    scenario.project,
    { viewport: { width: 1280, height: 720 } }
  );
});
