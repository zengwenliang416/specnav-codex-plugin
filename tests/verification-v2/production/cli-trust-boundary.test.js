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
  pathsFor,
  run,
  summarizeCliResult
} = require('../../../plugins/specnav-verification/scripts/verification-v2-run');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../contracts/fixtures/positive'
);

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cliProjectFixture() {
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-cli-finalize-'
  ));
  const changeId = 'change-v2';
  const changeRoot = path.join(projectRoot, 'openspec', 'changes', changeId);
  const v2Root = path.join(changeRoot, 'verify', 'v2');
  fs.mkdirSync(path.join(projectRoot, 'openspec', '.specnav'), {
    recursive: true
  });
  fs.writeFileSync(
    path.join(projectRoot, 'openspec', '.specnav', 'active-change'),
    `${changeId}\n`
  );
  for (const name of [
    'case-snapshot.json',
    'case-approval.json',
    'runtime-status.json'
  ]) {
    fs.mkdirSync(v2Root, { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_ROOT, name), path.join(v2Root, name));
  }
  writeJson(path.join(v2Root, 'requirements-source.json'), [{
    id: 'REQ-1',
    statement: 'The contract is validated.'
  }]);
  writeJson(path.join(v2Root, 'acceptance-source.json'), [{
    id: 'AC-13',
    statement: 'The approved case remains verifiable.'
  }]);
  return { projectRoot, changeId };
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

test('production CLI summarizes persisted execution data without embedding logs', () => {
  const result = summarizeCliResult({
    ok: false,
    status: 'blocked',
    cases: [{
      ok: false,
      status: 'failed',
      run: {
        id: 'run-1',
        case_ids: ['CASE-01']
      },
      attempt: {
        id: 'attempt-1',
        case_id: 'CASE-01'
      },
      execution: {
        logs: {
          stdout: 'x'.repeat(20 * 1024 * 1024),
          stderr: ''
        }
      },
      evidence: [{ id: 'evidence-1' }],
      readings: [{ id: 'reading-1' }],
      failure_packet: { id: 'failure-1' },
      blockers: [{
        id: 'verification-execution:command-exit-nonzero',
        artifact: 'command',
        detail: '1'
      }],
      fallback_used: false
    }],
    blockers: [{
      id: 'verification-execution:command-exit-nonzero',
      artifact: 'command',
      detail: '1'
    }],
    fallback_used: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallback_used, false);
  assert.equal(result.cases[0].case_id, 'CASE-01');
  assert.equal(result.cases[0].evidence_count, 1);
  assert.equal(result.cases[0].reading_count, 1);
  assert.equal(result.cases[0].failure_id, 'failure-1');
  assert.equal(JSON.stringify(result).includes('"logs"'), false);
  assert.ok(JSON.stringify(result).length < 16 * 1024);
  assert.ok(result.artifacts.some((entry) => (
    entry.path === 'verify/runs/run-1/attempts/attempt-1/execution.json'
  )));
});

test('production CLI summarizes standalone finalize output without embedding reports', () => {
  const result = summarizeCliResult({
    ok: false,
    status: 'blocked',
    aggregate: {
      status: 'pass',
      domains: 'x'.repeat(20 * 1024 * 1024)
    },
    release_gate: { id: 'gate-release-1' },
    archive_gate: { id: 'gate-archive-1' },
    report_model: {
      id: 'report-model-1',
      results: 'x'.repeat(20 * 1024 * 1024)
    },
    report_manifest: {
      reports: [{
        name: 'overview.html',
        path: 'verify/reports/overview.html'
      }]
    },
    blockers: [{
      id: 'verification-decision:open-failures',
      artifact: 'failure-1',
      detail: null
    }],
    fallback_used: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.aggregate_status, 'pass');
  assert.equal(result.release_gate_id, 'gate-release-1');
  assert.equal(result.archive_gate_id, 'gate-archive-1');
  assert.equal(result.report_model_id, 'report-model-1');
  assert.deepEqual(result.cases, []);
  assert.equal(JSON.stringify(result).includes('"results"'), false);
  assert.equal(JSON.stringify(result).includes('"domains"'), false);
  assert.ok(JSON.stringify(result).length < 16 * 1024);
  assert.ok(result.artifacts.some((entry) => (
    entry.path === 'verify/reports/overview.html'
  )));
});

test('full production run injects the live trusted authority into automatic finalize', async () => {
  const source = cliProjectFixture();
  const schemaRegistry = readySchemaRegistry();
  let receivedAuthority = null;
  const result = await run([
    'run',
    '--project',
    source.projectRoot,
    '--change',
    source.changeId,
    '--reviewer-id',
    'reviewer-1'
  ], {
    createSchemaRegistry: () => schemaRegistry,
    createCaseApprovalValidator: () => ({
      evaluate: () => ({ ok: true, blockers: [] })
    }),
    fingerprints: () => ({
      codeSha: '1'.repeat(40),
      testSha: '2'.repeat(64),
      environmentHash: '3'.repeat(64)
    }),
    runtimeAuthority: {
      resolve(runtimeStatus) {
        return {
          ok: true,
          runtimeRoot: runtimeStatus.runtime_root,
          runtimeStatus,
          authority: {
            schema: 'specnav.verification.runtime-authority.v1',
            digest: '4'.repeat(64)
          },
          signingKey: Buffer.alloc(32, 31),
          blockers: []
        };
      }
    },
    createProductionVerificationRunner: () => ({
      approvalState: { ok: true, blockers: [] },
      async executeCase(caseId) {
        return {
          ok: true,
          status: 'passed',
          run: { id: 'run-cli', case_ids: [caseId] },
          attempt: { id: 'attempt-cli', case_id: caseId },
          evidence: [],
          readings: [],
          blockers: [],
          fallback_used: false
        };
      }
    }),
    createVerificationArtifactPipeline(options) {
      receivedAuthority = options.trustedFactAuthority;
      return {
        build() {
          return {
            ok: true,
            status: 'pass',
            aggregate: { status: 'pass' },
            release_gate: { id: 'gate-release-cli' },
            archive_gate: { id: 'gate-archive-cli' },
            report_model: { id: 'report-cli' },
            report_manifest: { reports: [] },
            blockers: [],
            fallback_used: false
          };
        }
      };
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(typeof receivedAuthority?.seal, 'function');
  assert.equal(typeof receivedAuthority?.verify, 'function');
});
