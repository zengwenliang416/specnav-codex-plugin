'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const {
  ACCEPTANCE_SCHEMA,
  INPUT_SCHEMA,
  materialize: materializeRaw,
  sha256
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/task-acceptance-evidence'
));
const {
  createValidationReceiptAuthority
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/development-receipt-authority'
));
const SCHEMA_FILE = path.join(
  ROOT,
  'plugins/specnav-development/schemas/task-acceptance-evidence.schema.json'
);
const FIXED_NOW = '2026-08-11T12:00:00.000Z';
const RECEIPT_AUTHORITY = createValidationReceiptAuthority({
  key: Buffer.alloc(32, 17),
  authorityDigest: 'a'.repeat(64)
});

function materialize(options) {
  return materializeRaw({
    ...options,
    receiptAuthority: RECEIPT_AUTHORITY
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(projectRoot, args) {
  return execFileSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf8'
  }).trim();
}

function review(title, taskId) {
  return [
    `# ${title}: ${taskId}`,
    '',
    '## Verdict',
    '',
    'approved',
    '',
    '## Required Fixes',
    '',
    '- None.',
    ''
  ].join('\n');
}

function report(taskId) {
  return [
    `# Task Report: ${taskId}`,
    '',
    '## Status',
    '',
    'DONE',
    '',
    '## Files Changed',
    '',
    '- `src/example.js`',
    '- `tests/example.test.js`',
    ''
  ].join('\n');
}

function validationEntry(options) {
  return RECEIPT_AUTHORITY.sign({
    schema: 'specnav.validationLog.v2',
    receipt_id: options.receiptId,
    task: options.taskId,
    command: options.command,
    assertion_ids: options.assertionIds,
    status: 'pass',
    ok: true,
    exit_status: 0,
    attestation: 'system-executed',
    recorded_by: 'specnav-development-evidence-runner',
    recorded_at: options.recordedAt,
    reviewed_git_head: options.head,
    reviewed_git_tree: options.tree,
    evidence_log: options.evidenceLog,
    evidence_log_sha256: options.evidenceSha256,
    evidence_log_size: options.evidenceSize,
    overturned: false
  });
}

function resignReceipt(entry) {
  const unsigned = { ...entry };
  delete unsigned.receipt_signature;
  delete unsigned.receipt_signature_algorithm;
  delete unsigned.runtime_authority_digest;
  return RECEIPT_AUTHORITY.sign(unsigned);
}

function fixture(options = {}) {
  const taskId = options.taskId || '001-example';
  const assertions = options.assertions || [
    'AC-01',
    'AC-01:focused-behavior'
  ];
  const projectRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'specnav-task-acceptance-'
  ));
  const changeDir = path.join(
    projectRoot,
    'openspec',
    'changes',
    'example-change'
  );
  const taskDir = path.join(
    changeDir,
    'development',
    'tasks',
    taskId
  );
  const context = {
    task_id: taskId,
    goal: 'Deliver the example behavior.',
    allowed_files: [
      'src/example.js',
      'tests/*.test.js',
      `openspec/changes/example-change/development/tasks/${taskId}/**`,
      'openspec/changes/example-change/development/evidence/**'
    ],
    acceptance_assertions: assertions,
    expected_evidence: assertions.map((id) => `Direct evidence for ${id}`)
  };
  if (assertions.some((id) => id.includes(':'))) {
    context.acceptance_primary = assertions.filter((id) => !id.includes(':'));
    context.acceptance_subclaims = assertions.filter((id) => id.includes(':'));
  }

  execFileSync('git', ['init', '-q', projectRoot]);
  git(projectRoot, ['config', 'user.name', 'SpecNav Test']);
  git(projectRoot, ['config', 'user.email', 'specnav@example.test']);
  writeJson(path.join(changeDir, 'acceptance.json'), {
    assertions: assertions.map((id) => ({
      id: id.split(':', 1)[0],
      statement: `The example behavior is verified for ${id}.`
    }))
  });
  writeJson(path.join(taskDir, 'context.json'), context);
  fs.writeFileSync(path.join(taskDir, 'report.md'), report(taskId));
  fs.writeFileSync(
    path.join(taskDir, 'spec-review.md'),
    review('Spec Review', taskId)
  );
  fs.writeFileSync(
    path.join(taskDir, 'quality-review.md'),
    review('Quality Review', taskId)
  );
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'example.js'), 'module.exports = 1;\n');
  fs.writeFileSync(
    path.join(projectRoot, 'tests', 'example.test.js'),
    "'use strict';\n"
  );
  if (options.shadowProjectEvidence === true) {
    fs.mkdirSync(path.join(changeDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'src', 'example.js'),
      'shadow evidence must not win\n'
    );
  }
  const reusedFile = path.join(
    changeDir,
    'development',
    'evidence',
    'reused-016-six-domain-aggregation-report.md'
  );
  fs.mkdirSync(path.dirname(reusedFile), { recursive: true });
  fs.writeFileSync(reusedFile, '# Reused task report\n');
  git(projectRoot, ['add', '.']);
  git(projectRoot, ['commit', '-qm', 'fixture source']);

  const head = git(projectRoot, ['rev-parse', 'HEAD']);
  const tree = git(projectRoot, ['rev-parse', 'HEAD^{tree}']);
  const validationEntries = assertions.map((id, index) => {
    const sequence = String(index + 1).padStart(3, '0');
    const evidenceLog = `development/evidence/${sequence}-${taskId}.log`;
    const evidenceFile = path.join(changeDir, evidenceLog);
    const evidenceContent = `system evidence for ${id}\n`;
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, evidenceContent);
    return validationEntry({
      receiptId: `receipt-${sequence}`,
      taskId,
      command: `node --test tests/${sequence}.test.js`,
      assertionIds: [id],
      recordedAt: `2026-08-11T10:0${index}:00.000Z`,
      head,
      tree,
      evidenceLog,
      evidenceSha256: sha256(Buffer.from(evidenceContent)),
      evidenceSize: Buffer.byteLength(evidenceContent)
    });
  });
  fs.writeFileSync(
    path.join(changeDir, 'development', 'validation-log.jsonl'),
    `${validationEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );

  return {
    projectRoot,
    changeDir,
    taskDir,
    taskId,
    assertions,
    head,
    tree,
    validationEntries,
    reusedFile
  };
}

function readAcceptance(current) {
  return JSON.parse(fs.readFileSync(
    path.join(current.taskDir, 'acceptance.json'),
    'utf8'
  ));
}

function cleanup(current) {
  fs.rmSync(current.projectRoot, { recursive: true, force: true });
}

test('materializer writes v2 bound to Git, implementation scope, reviews, receipts and logs', () => {
  const current = fixture();
  try {
    const result = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true,
      now: () => new Date(FIXED_NOW)
    });
    const acceptance = readAcceptance(current);

    assert.equal(result.ok, true);
    assert.equal(result.written.length, 1);
    assert.equal(acceptance.schema, ACCEPTANCE_SCHEMA);
    assert.equal(acceptance.generated_at, FIXED_NOW);
    assert.equal(acceptance.reviewed_git_head, current.head);
    assert.equal(acceptance.reviewed_git_tree, current.tree);
    assert.equal(acceptance.fallback_used, false);
    assert.deepEqual(
      acceptance.implementation_scope.included_patterns,
      ['src/example.js', 'tests/*.test.js']
    );
    assert.deepEqual(
      acceptance.implementation_scope.entries.map((entry) => entry.path),
      ['src/example.js', 'tests/example.test.js']
    );
    assert.match(acceptance.implementation_scope.sha256, /^[0-9a-f]{64}$/);
    assert.equal(
      acceptance.artifacts.context.sha256,
      sha256(fs.readFileSync(path.join(current.taskDir, 'context.json')))
    );
    assert.equal(acceptance.artifacts.report.status, 'DONE');
    assert.equal(acceptance.artifacts.spec_review.verdict, 'approved');
    assert.equal(acceptance.artifacts.quality_review.verdict, 'approved');
    assert.deepEqual(
      acceptance.assertions.map((entry) => entry.test_run_ids),
      [['receipt-001'], ['receipt-002']]
    );
    assert.equal(acceptance.test_runs.length, 2);
    assert.match(
      acceptance.test_runs[0].validation_receipt_sha256,
      /^[0-9a-f]{64}$/
    );
    assert.equal(
      acceptance.test_runs[0].evidence_log.size,
      Buffer.byteLength('system evidence for AC-01\n')
    );
    assert.equal(
      acceptance.test_runs[0].evidence_log.sha256,
      sha256(Buffer.from('system evidence for AC-01\n'))
    );
  } finally {
    cleanup(current);
  }
});

test('materializer rejects v1 unless force performs a complete v2 regeneration', () => {
  const current = fixture();
  try {
    writeJson(path.join(current.taskDir, 'acceptance.json'), {
      schema: 'specnav.task-acceptance-evidence.v1',
      task_id: current.taskId,
      status: 'approved',
      fallback_used: false
    });
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:v1-rejected:001-example/
    );

    materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true,
      force: true,
      now: () => new Date(FIXED_NOW)
    });
    assert.equal(readAcceptance(current).schema, ACCEPTANCE_SCHEMA);
  } finally {
    cleanup(current);
  }
});

test('structured input regenerates Task 033 through the same generator path', () => {
  const current = fixture({
    taskId: '033-release-archive-proof',
    assertions: ['AC-03'],
    shadowProjectEvidence: true
  });
  try {
    writeJson(path.join(current.taskDir, 'acceptance.json'), {
      schema: 'specnav.task-acceptance-evidence.v1',
      task_id: current.taskId,
      reused_task_range: ['016-six-domain-aggregation'],
      fallback_used: false
    });
    const input = {
      schema: INPUT_SCHEMA,
      task_id: current.taskId,
      assertions: {
        'AC-03': {
          test_run_ids: ['receipt-001'],
          direct_evidence: ['src/example.js'],
          reused_evidence: [{
            task_id: '016-six-domain-aggregation',
            path: 'development/evidence/reused-016-six-domain-aggregation-report.md'
          }]
        }
      }
    };
    materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true,
      force: true,
      taskEvidenceInputs: {
        [current.taskId]: input
      },
      now: () => new Date(FIXED_NOW)
    });
    const acceptance = readAcceptance(current);
    assert.equal(acceptance.generated_by, 'specnav-development/task-acceptance-evidence');
    assert.equal(Object.hasOwn(acceptance, 'reused_task_range'), false);
    assert.deepEqual(acceptance.assertions[0].test_run_ids, ['receipt-001']);
    assert.equal(acceptance.assertions[0].direct_evidence[0].path, 'src/example.js');
    assert.equal(
      acceptance.assertions[0].direct_evidence[0].sha256,
      sha256(fs.readFileSync(path.join(current.projectRoot, 'src/example.js')))
    );
    assert.equal(
      acceptance.assertions[0].reused_evidence[0].task_id,
      '016-six-domain-aggregation'
    );
    assert.match(
      acceptance.assertions[0].reused_evidence[0].sha256,
      /^[0-9a-f]{64}$/
    );
  } finally {
    cleanup(current);
  }
});

test('structured input is closed and never fills missing evidence arrays', () => {
  const current = fixture({
    taskId: '033-release-archive-proof',
    assertions: ['AC-03']
  });
  try {
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change',
        taskEvidenceInputs: {
          [current.taskId]: {
            schema: INPUT_SCHEMA,
            task_id: current.taskId,
            assertions: {
              'AC-03': {
                test_run_ids: ['receipt-001'],
                direct_evidence: []
              }
            }
          }
        }
      }),
      /task-acceptance:invalid-assertion-input:033-release-archive-proof:AC-03/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer fails closed when a receipt is not bound to reviewed Git', () => {
  const current = fixture();
  try {
    const file = path.join(
      current.changeDir,
      'development',
      'validation-log.jsonl'
    );
    const entries = fs.readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    entries[0].reviewed_git_tree = '0'.repeat(40);
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:invalid-validation-receipt:001-example:1/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer rejects a forged system-executed receipt', () => {
  const current = fixture();
  try {
    const file = path.join(
      current.changeDir,
      'development',
      'validation-log.jsonl'
    );
    const entries = fs.readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    entries[0].receipt_signature = '0'.repeat(64);
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:invalid-validation-receipt:001-example:1/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer rejects evidence content changed after receipt signing', () => {
  const current = fixture();
  try {
    fs.appendFileSync(
      path.join(current.changeDir, current.validationEntries[0].evidence_log),
      'tampered after signing\n'
    );
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:evidence-log-binding-mismatch:001-example:receipt-001/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer rejects non-object validation log records', () => {
  const current = fixture();
  try {
    const file = path.join(
      current.changeDir,
      'development',
      'validation-log.jsonl'
    );
    fs.writeFileSync(file, `42\n${fs.readFileSync(file, 'utf8')}`);
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:invalid-validation-log-json:1/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer ignores append-only receipts from older Git snapshots', () => {
  const current = fixture();
  try {
    const file = path.join(
      current.changeDir,
      'development',
      'validation-log.jsonl'
    );
    const stale = {
      ...current.validationEntries[0],
      receipt_id: 'receipt-stale',
      reviewed_git_head: '0'.repeat(40),
      reviewed_git_tree: '1'.repeat(40)
    };
    fs.writeFileSync(
      file,
      `${JSON.stringify(stale)}\n${fs.readFileSync(file, 'utf8')}`
    );

    const result = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true,
      now: () => new Date(FIXED_NOW)
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      readAcceptance(current).test_runs.map((run) => run.id),
      ['receipt-001', 'receipt-002']
    );
  } finally {
    cleanup(current);
  }
});

test('materializer requires an explicit assertion to test run mapping', () => {
  const current = fixture();
  try {
    const file = path.join(
      current.changeDir,
      'development',
      'validation-log.jsonl'
    );
    const entries = fs.readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    entries[1].assertion_ids = ['AC-01'];
    entries[1] = resignReceipt(entries[1]);
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:missing-explicit-test-run:001-example:AC-01:focused-behavior/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer fails closed for dirty implementation files but ignores lifecycle evidence', () => {
  const current = fixture();
  try {
    fs.writeFileSync(
      path.join(current.changeDir, 'development', 'review-note.md'),
      'additional lifecycle review evidence\n'
    );
    const planned = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      now: () => new Date(FIXED_NOW)
    });
    assert.equal(planned.ok, true);

    fs.appendFileSync(path.join(current.projectRoot, 'src', 'example.js'), '// dirty\n');
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:dirty-implementation-scope:src\/example\.js/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer rejects evidence files that escape through symlinks', () => {
  const current = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-evidence-outside-'));
  try {
    const target = path.join(outside, 'forged.log');
    fs.writeFileSync(target, 'forged evidence\n');
    const evidenceFile = path.join(
      current.changeDir,
      current.validationEntries[0].evidence_log
    );
    fs.rmSync(evidenceFile);
    fs.symlinkSync(target, evidenceFile);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:missing-evidence-path:001-example/
    );
  } finally {
    cleanup(current);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('materializer validates an existing v2 artifact instead of trusting its schema label', () => {
  const current = fixture();
  try {
    materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true,
      now: () => new Date(FIXED_NOW)
    });
    const incomplete = readAcceptance(current);
    delete incomplete.test_runs;
    writeJson(path.join(current.taskDir, 'acceptance.json'), incomplete);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change',
        now: () => new Date(FIXED_NOW)
      }),
      /task-acceptance:invalid-existing-v2:001-example/
    );
  } finally {
    cleanup(current);
  }
});

test('materializer skips repair incidents and rejects invalid standard task ids', () => {
  const current = fixture();
  try {
    const repairTaskDir = path.join(
      current.changeDir,
      'development',
      'tasks',
      '900-verification-repair-example'
    );
    writeJson(path.join(repairTaskDir, 'context.json'), {
      schema: 'specnav.development.repair-task.v1',
      id: '900-verification-repair-example',
      change_id: 'example-change'
    });
    const result = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      now: () => new Date(FIXED_NOW)
    });
    assert.equal(result.task_count, 1);

    const invalidTaskDir = path.join(
      current.changeDir,
      'development',
      'tasks',
      'invalid-task'
    );
    writeJson(path.join(invalidTaskDir, 'context.json'), {
      task_id: 'invalid-task',
      goal: 'Invalid task.',
      allowed_files: ['src/example.js'],
      acceptance_assertions: ['AC-01']
    });
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change'
      }),
      /task-acceptance:invalid-task-id:invalid-task/
    );
  } finally {
    cleanup(current);
  }
});

test('published schema is v2-only and closes unknown fields', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  assert.equal(schema.properties.schema.const, ACCEPTANCE_SCHEMA);
  assert.equal(schema.additionalProperties, false);
  assert.equal(
    schema.properties.fallback_used.const,
    false
  );
  assert.equal(
    schema.properties.reviewed_git_head.$ref,
    '#/$defs/gitObject'
  );
  assert.equal(
    schema.properties.artifacts.properties.report.additionalProperties,
    false
  );
  assert.deepEqual(
    schema.properties.assertions.items.required.includes('test_run_ids'),
    true
  );
  assert.equal(
    schema.properties.assertions.items.properties.reused_evidence
      .items.additionalProperties,
    false
  );
});
