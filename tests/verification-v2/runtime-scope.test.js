'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(
  ROOT,
  'plugins/specnav-verification/scripts/verification-runtime.js'
);
const VERSION = '2.0.0-alpha.2';
const {
  loadProviderEnvironment
} = require('../../plugins/specnav-verification/kernel/runtime/scope-resolver');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runtime-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return {
    root,
    projectRoot,
    home,
    projectRuntimeBase: path.join(
      projectRoot,
      '.specnav/runtime/verification'
    ),
    userRuntimeBase: path.join(home, '.specnav/runtime/verification')
  };
}

function writeProjectScope(fixture, scope) {
  writeJson(path.join(fixture.projectRoot, '.specnav', 'config.json'), {
    verification: {
      runtime_scope: scope
    }
  });
}

function createCandidate(runtimeBase) {
  fs.mkdirSync(path.join(runtimeBase, VERSION), { recursive: true });
}

function runCli(fixture, action, args = [], environment = {}) {
  const run = spawnSync(process.execPath, [
    CLI,
    action,
    '--version',
    VERSION,
    '--project',
    fixture.projectRoot,
    '--json',
    ...args
  ], {
    cwd: fixture.projectRoot,
    env: {
      ...process.env,
      HOME: fixture.home,
      ...environment
    },
    encoding: 'utf8'
  });
  assert.notEqual(run.status, null, run.error?.message);
  assert.doesNotThrow(
    () => JSON.parse(run.stdout),
    `stdout was not JSON:\n${run.stdout}\nstderr:\n${run.stderr}`
  );
  return {
    status: run.status,
    stderr: run.stderr,
    result: JSON.parse(run.stdout)
  };
}

function blockerIds(result) {
  return (result.blockers || []).map((entry) => (
    typeof entry === 'string' ? entry : entry.id
  ));
}

function candidate(result, scope) {
  if (Array.isArray(result.candidates)) {
    return result.candidates.find((entry) => entry.scope === scope);
  }
  return result.candidates?.[scope];
}

function selectedScope(result) {
  return result.selected_scope
    ?? result.runtime_scope
    ?? result.selection?.scope
    ?? null;
}

function selectionSource(result) {
  return result.selection_source
    ?? result.scope_selection_source
    ?? result.selection?.source
    ?? null;
}

test('inspect selects project scope from project configuration', (t) => {
  const fixture = sandbox(t);
  writeProjectScope(fixture, 'project');
  createCandidate(fixture.projectRuntimeBase);
  createCandidate(fixture.userRuntimeBase);

  const { status, result } = runCli(fixture, 'inspect');

  assert.equal(status, 0);
  assert.equal(result.ok, true);
  assert.equal(selectedScope(result), 'project');
  assert.equal(selectionSource(result), 'project-config');
  assert.equal(result.runtime_base, fixture.projectRuntimeBase);
  assert.equal(candidate(result, 'project').exists, true);
  assert.equal(candidate(result, 'user').exists, true);
  assert.equal(result.fallback_used, false);
});

test('inspect selects user scope from project configuration', (t) => {
  const fixture = sandbox(t);
  writeProjectScope(fixture, 'user');
  createCandidate(fixture.projectRuntimeBase);
  createCandidate(fixture.userRuntimeBase);

  const { status, result } = runCli(fixture, 'inspect');

  assert.equal(status, 0);
  assert.equal(result.ok, true);
  assert.equal(selectedScope(result), 'user');
  assert.equal(selectionSource(result), 'project-config');
  assert.equal(result.runtime_base, fixture.userRuntimeBase);
  assert.equal(result.fallback_used, false);
});

test('inspect reports both candidates without selecting when scope is unconfigured', (t) => {
  const fixture = sandbox(t);
  createCandidate(fixture.projectRuntimeBase);
  createCandidate(fixture.userRuntimeBase);

  const { status, result } = runCli(fixture, 'inspect');

  assert.equal(status, 2);
  assert.equal(result.ok, false);
  assert.equal(selectedScope(result), null);
  assert.equal(candidate(result, 'project').exists, true);
  assert.equal(candidate(result, 'user').exists, true);
  assert.deepEqual(blockerIds(result), [
    'verification-runtime:scope-selection-required'
  ]);
  assert.equal(result.runtime_base, null);
  assert.equal(result.fallback_used, false);
});

test('a lone user candidate is never adopted without explicit selection', (t) => {
  const fixture = sandbox(t);
  createCandidate(fixture.userRuntimeBase);

  for (const action of ['inspect', 'doctor', 'install', 'repair']) {
    const { status, result } = runCli(fixture, action);
    assert.equal(status, 2, action);
    assert.equal(result.ok, false, action);
    assert.equal(selectedScope(result), null, action);
    assert.deepEqual(blockerIds(result), [
      'verification-runtime:scope-selection-required'
    ], action);
    assert.equal(result.runtime_base, null, action);
    assert.equal(result.fallback_used, false, action);
  }
});

test('select-scope persists an explicit project selection', (t) => {
  const fixture = sandbox(t);
  createCandidate(fixture.projectRuntimeBase);

  const selected = runCli(fixture, 'select-scope', ['--scope', 'project']);
  assert.equal(selected.status, 0);
  assert.equal(selected.result.ok, true);
  assert.equal(selectedScope(selected.result), 'project');
  assert.equal(selected.result.runtime_base, fixture.projectRuntimeBase);
  assert.equal(selected.result.fallback_used, false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(
      path.join(fixture.projectRoot, '.specnav', 'config.json'),
      'utf8'
    )),
    {
      schema: 'specnav.project-config.v1',
      verification: {
        runtime_scope: 'project'
      }
    }
  );

  const inspected = runCli(fixture, 'inspect');
  assert.equal(inspected.status, 0);
  assert.equal(inspected.result.ok, true);
  assert.equal(selectedScope(inspected.result), 'project');
  assert.equal(selectionSource(inspected.result), 'project-config');
  assert.equal(inspected.result.runtime_base, fixture.projectRuntimeBase);
  assert.equal(inspected.result.fallback_used, false);
});

test('invalid configured and requested scopes fail closed', (t) => {
  const fixture = sandbox(t);
  writeProjectScope(fixture, 'workspace');
  createCandidate(fixture.projectRuntimeBase);
  createCandidate(fixture.userRuntimeBase);

  const configured = runCli(fixture, 'inspect');
  assert.equal(configured.status, 2);
  assert.deepEqual(blockerIds(configured.result), [
    'verification-runtime:project-config-invalid'
  ]);
  assert.equal(selectedScope(configured.result), null);
  assert.equal(configured.result.runtime_base, null);
  assert.equal(configured.result.fallback_used, false);

  const requested = runCli(
    fixture,
    'select-scope',
    ['--scope', 'workspace']
  );
  assert.equal(requested.status, 2);
  assert.deepEqual(blockerIds(requested.result), [
    'verification-runtime:invalid-scope'
  ]);
  assert.equal(requested.result.fallback_used, false);
});

test('public CLI ignores environment runtime overrides and keeps project selection', (t) => {
  const fixture = sandbox(t);
  writeProjectScope(fixture, 'project');
  createCandidate(fixture.projectRuntimeBase);
  createCandidate(fixture.userRuntimeBase);
  const explicitRuntimeBase = path.join(fixture.root, 'explicit-runtime');
  createCandidate(explicitRuntimeBase);

  const { status, result } = runCli(fixture, 'inspect', [], {
    SPECNAV_VERIFICATION_RUNTIME_BASE: explicitRuntimeBase
  });

  assert.equal(status, 0);
  assert.equal(result.ok, true);
  assert.equal(selectedScope(result), 'project');
  assert.equal(selectionSource(result), 'project-config');
  assert.equal(result.runtime_base, fixture.projectRuntimeBase);
  assert.equal(result.fallback_used, false);
});

test('public CLI rejects --root instead of bypassing project selection', (t) => {
  const fixture = sandbox(t);
  const explicitRuntimeBase = path.join(fixture.root, 'explicit-runtime');
  createCandidate(explicitRuntimeBase);

  const { status, result } = runCli(
    fixture,
    'inspect',
    ['--root', explicitRuntimeBase]
  );

  assert.equal(status, 2);
  assert.equal(result.ok, false);
  assert.deepEqual(blockerIds(result), [
    'verification-runtime:runtime-root-override-forbidden'
  ]);
  assert.equal(result.fallback_used, false);
});

test('doctor never falls back from a missing selected project runtime to user scope', (t) => {
  const fixture = sandbox(t);
  writeProjectScope(fixture, 'project');
  createCandidate(fixture.userRuntimeBase);

  const { status, result } = runCli(fixture, 'doctor');

  assert.equal(status, 2);
  assert.equal(result.ok, false);
  assert.equal(selectedScope(result), 'project');
  assert.equal(result.runtime_base, fixture.projectRuntimeBase);
  assert.equal(
    result.runtime_root,
    path.join(fixture.projectRuntimeBase, VERSION)
  );
  assert.equal(
    blockerIds(result).includes('verification-runtime:runtime-missing'),
    true
  );
  assert.equal(result.fallback_used, false);
});

test('provider configuration follows the selected scope without cross-scope fallback', (t) => {
  const fixture = sandbox(t);
  const projectFile = path.join(
    fixture.projectRoot,
    '.specnav/secrets/verification.env'
  );
  const userFile = path.join(
    fixture.home,
    '.specnav/secrets/verification.env'
  );
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(projectFile, [
    'MIDSCENE_MODEL_NAME=project-model',
    'MIDSCENE_MODEL_FAMILY=openai',
    'MIDSCENE_MODEL_API_KEY=project-secret',
    'MIDSCENE_MODEL_BASE_URL=https://project.example.invalid/v1',
    ''
  ].join('\n'), { mode: 0o600 });
  fs.writeFileSync(userFile, [
    'MIDSCENE_MODEL_NAME=user-model',
    'MIDSCENE_MODEL_FAMILY=openai',
    'MIDSCENE_MODEL_API_KEY=user-secret',
    'MIDSCENE_MODEL_BASE_URL=https://user.example.invalid/v1',
    ''
  ].join('\n'), { mode: 0o600 });

  const project = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });
  const user = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'user'
  });

  assert.equal(project.ok, true);
  assert.equal(project.file, projectFile);
  assert.equal(project.environment.MIDSCENE_MODEL_NAME, 'project-model');
  assert.equal(user.ok, true);
  assert.equal(user.file, userFile);
  assert.equal(user.environment.MIDSCENE_MODEL_NAME, 'user-model');

  fs.unlinkSync(projectFile);
  const missingProject = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });
  assert.equal(missingProject.ok, true);
  assert.deepEqual(missingProject.environment, {});
  assert.equal(missingProject.file, projectFile);
});

test('provider scope files reject unsafe permissions, unsupported keys, and duplicates', (t) => {
  const fixture = sandbox(t);
  const file = path.join(
    fixture.projectRoot,
    '.specnav/secrets/verification.env'
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'MIDSCENE_MODEL_NAME=model\n', { mode: 0o644 });

  const unsafe = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });
  assert.equal(unsafe.ok, false);
  assert.deepEqual(blockerIds(unsafe), [
    'verification-runtime:provider-config-invalid'
  ]);

  fs.writeFileSync(file, 'UNSUPPORTED_SECRET=value\n');
  fs.chmodSync(file, 0o600);
  const unsupported = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });
  assert.equal(unsupported.ok, false);

  fs.writeFileSync(file, [
    'MIDSCENE_MODEL_NAME=first',
    'MIDSCENE_MODEL_NAME=second',
    ''
  ].join('\n'));
  fs.chmodSync(file, 0o600);
  const duplicate = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });
  assert.equal(duplicate.ok, false);
});

test('project scope rejects symlinked .specnav paths', (t) => {
  const fixture = sandbox(t);
  const external = path.join(fixture.root, 'external-specnav');
  fs.mkdirSync(external, { recursive: true });
  fs.symlinkSync(external, path.join(fixture.projectRoot, '.specnav'));

  const inspected = runCli(fixture, 'inspect');
  assert.equal(inspected.status, 2);
  assert.deepEqual(blockerIds(inspected.result), [
    'verification-runtime:project-config-invalid'
  ]);

  const selected = runCli(
    fixture,
    'select-scope',
    ['--scope', 'project']
  );
  assert.equal(selected.status, 2);
  assert.deepEqual(blockerIds(selected.result), [
    'verification-runtime:project-config-invalid'
  ]);
  assert.equal(fs.existsSync(path.join(external, 'config.json')), false);
});

test('provider configuration rejects a symlinked secrets directory', (t) => {
  const fixture = sandbox(t);
  const specnavRoot = path.join(fixture.projectRoot, '.specnav');
  const external = path.join(fixture.root, 'external-secrets');
  fs.mkdirSync(specnavRoot, { recursive: true });
  fs.mkdirSync(external, { recursive: true });
  fs.symlinkSync(external, path.join(specnavRoot, 'secrets'));
  fs.writeFileSync(path.join(external, 'verification.env'), [
    'MIDSCENE_MODEL_NAME=model',
    'MIDSCENE_MODEL_FAMILY=openai',
    'MIDSCENE_MODEL_API_KEY=secret',
    'MIDSCENE_MODEL_BASE_URL=https://example.invalid/v1',
    ''
  ].join('\n'), { mode: 0o600 });

  const result = loadProviderEnvironment({
    projectRoot: fixture.projectRoot,
    homeDirectory: fixture.home,
    scope: 'project'
  });

  assert.equal(result.ok, false);
  assert.deepEqual(blockerIds(result), [
    'verification-runtime:provider-config-invalid'
  ]);
  assert.deepEqual(result.environment, {});
});

test('scope selection rejects a symlinked project ignore file', (t) => {
  const fixture = sandbox(t);
  const specnavRoot = path.join(fixture.projectRoot, '.specnav');
  const external = path.join(fixture.root, 'external-ignore');
  fs.mkdirSync(specnavRoot, { recursive: true });
  fs.writeFileSync(external, 'preserve\n');
  fs.symlinkSync(external, path.join(specnavRoot, '.gitignore'));

  const selected = runCli(
    fixture,
    'select-scope',
    ['--scope', 'project']
  );

  assert.equal(selected.status, 2);
  assert.deepEqual(blockerIds(selected.result), [
    'verification-runtime:scope-path-unsafe'
  ]);
  assert.equal(fs.readFileSync(external, 'utf8'), 'preserve\n');
});
