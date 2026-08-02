'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const kernel = require('../../../plugins/specnav-verification');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function makeSandbox(prefix = 'specnav-migration-') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    'change-v2'
  );
  fs.mkdirSync(changeRoot, { recursive: true });
  return { projectRoot, changeRoot };
}

function cleanup(sandbox) {
  fs.rmSync(sandbox.projectRoot, { recursive: true, force: true });
}

function legacyReading(overrides = {}) {
  return {
    schema: 'specnav.verification.legacy-reading.v1',
    id: 'legacy-static-1',
    change_id: 'change-v2',
    run_id: 'run-legacy',
    case_id: 'case-legacy',
    attempt_id: 'attempt-legacy',
    step_id: 'step-1',
    domain: 'static',
    expected: { exit_status: 0 },
    actual: { exit_status: 1 },
    oracle: {
      type: 'command_result',
      owner: 'legacy-runner',
      deterministic: true
    },
    evidence_ids: [],
    verdict: 'fail',
    recorded_at: '2026-08-02T00:00:00Z',
    code_sha: '1111111111111111111111111111111111111111',
    test_sha: '2222222222222222222222222222222222222222',
    ...overrides
  };
}

function writeLegacy(changeRoot, relativePath, value) {
  const file = path.join(changeRoot, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(file, bytes);
  return { file, bytes, sha256: sha256(bytes) };
}

function fakeSchemaRegistry(options = {}) {
  return {
    validate(entityType, value) {
      if (
        entityType === 'migration-receipt'
        && options.rejectReceipt === true
      ) {
        return {
          ok: false,
          blockers: [{
            id: 'verification-contract:schema-invalid',
            artifact: 'migration-receipt'
          }]
        };
      }
      if (entityType === 'reading') {
        const ok = value?.schema === 'specnav.verification.reading.v1'
          && ['pass', 'fail', 'blocked'].includes(value?.verdict)
          && typeof value?.id === 'string'
          && typeof value?.change_id === 'string';
        return {
          ok,
          value: ok ? structuredClone(value) : null,
          blockers: ok ? [] : [{
            id: 'verification-contract:schema-invalid',
            artifact: 'reading'
          }]
        };
      }
      if (entityType === 'migration-receipt') {
        const ok = value?.schema
            === 'specnav.verification.migration-receipt.v1'
          && value?.fallback_used === false
          && typeof value?.backup_ref?.path === 'string'
          && Array.isArray(value?.transformed_artifacts)
          && typeof value?.validation?.ok === 'boolean';
        return {
          ok,
          value: ok ? structuredClone(value) : null,
          blockers: ok ? [] : [{
            id: 'verification-contract:schema-invalid',
            artifact: 'migration-receipt'
          }]
        };
      }
      throw new Error(`unexpected-entity-type:${entityType}`);
    }
  };
}

function integrityChecker(result) {
  return {
    calls: [],
    checkIntegrity(request) {
      this.calls.push(structuredClone(request));
      if (result instanceof Error) throw result;
      return structuredClone(result);
    }
  };
}

function intactEvidenceResult() {
  return {
    ok: true,
    facts: {
      summary: {
        evidence_count: 1,
        integrity: 'intact',
        freshness: 'fresh'
      },
      evidence: []
    },
    blockers: []
  };
}

function brokenEvidenceResult(freshness = 'unknown') {
  return {
    ok: false,
    facts: {
      summary: {
        evidence_count: 0,
        integrity: 'broken',
        freshness
      },
      evidence: []
    },
    blockers: [{
      id: 'verification-integrity:evidence-missing',
      artifact: 'legacy-evidence'
    }]
  };
}

function createMigrator(options = {}) {
  return kernel.createV1ToV2Migrator({
    integrityChecker: options.integrityChecker
      || integrityChecker(intactEvidenceResult()),
    schemaRegistry: options.schemaRegistry || fakeSchemaRegistry(),
    clock: options.clock || (() => '2026-08-02T00:00:01Z')
  });
}

function migrationRequest(sandbox, overrides = {}) {
  return {
    mode: 'dry_run',
    change_root: sandbox.changeRoot,
    change_id: 'change-v2',
    migration_id: 'migration-001',
    artifacts: [{ path: 'verify-v1/static.json' }],
    ...overrides
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  brokenEvidenceResult,
  cleanup,
  createMigrator,
  fakeSchemaRegistry,
  intactEvidenceResult,
  integrityChecker,
  legacyReading,
  makeSandbox,
  migrationRequest,
  readJson,
  readJsonl,
  sha256,
  writeLegacy
};
