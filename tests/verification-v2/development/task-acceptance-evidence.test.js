'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const {
  materialize
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/task-acceptance-evidence'
));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
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
    '001-example'
  );
  writeJson(path.join(changeDir, 'acceptance.json'), {
    assertions: [{
      id: 'AC-01',
      statement: 'The example behavior is verified.'
    }]
  });
  writeJson(path.join(taskDir, 'context.json'), {
    task_id: '001-example',
    goal: 'Deliver the example behavior.',
    acceptance_assertions: ['AC-01'],
    acceptance_primary: ['AC-01'],
    acceptance_subclaims: ['AC-01:focused-behavior'],
    expected_evidence: [
      'Direct evidence for AC-01:focused-behavior'
    ]
  });
  for (const file of ['report.md', 'spec-review.md', 'quality-review.md']) {
    fs.writeFileSync(path.join(taskDir, file), `${file}\n`);
  }
  const evidenceFile = path.join(
    changeDir,
    'development',
    'evidence',
    '001-001-example.log'
  );
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, 'system evidence\n');
  fs.writeFileSync(path.join(
    changeDir,
    'development',
    'validation-log.jsonl'
  ), `${JSON.stringify({
    schema: 'specnav.validationLog.v2',
    task: '001-example',
    command: 'node --test example.test.js',
    status: 'pass',
    ok: true,
    exit_status: 0,
    attestation: 'system-executed',
    recorded_at: '2026-08-09T00:00:00.000Z',
    evidence_log: 'development/evidence/001-001-example.log',
    overturned: false
  })}\n`);
  return { projectRoot, changeDir, taskDir };
}

test('materializer writes task acceptance bound to exact assertions and evidence', () => {
  const current = fixture();
  try {
    const result = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.written.length, 1);
    const acceptance = JSON.parse(fs.readFileSync(
      path.join(current.taskDir, 'acceptance.json'),
      'utf8'
    ));
    assert.equal(acceptance.task_id, '001-example');
    assert.equal(acceptance.status, 'approved');
    assert.equal(acceptance.fallback_used, false);
    assert.deepEqual(
      acceptance.assertions.map((entry) => entry.id),
      ['AC-01', 'AC-01:focused-behavior']
    );
    assert.equal(
      acceptance.assertions.every((entry) => (
        entry.status === 'passing'
        && entry.direct_evidence.includes(
          'development/evidence/001-001-example.log'
        )
      )),
      true
    );
  } finally {
    fs.rmSync(current.projectRoot, { recursive: true, force: true });
  }
});

test('materializer fails closed when a task has no declared assertions', () => {
  const current = fixture();
  try {
    const contextFile = path.join(current.taskDir, 'context.json');
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    context.acceptance_assertions = [];
    context.acceptance_primary = [];
    context.acceptance_subclaims = [];
    writeJson(contextFile, context);
    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change',
        write: false
      }),
      /task-acceptance:no-assertions:001-example/
    );
  } finally {
    fs.rmSync(current.projectRoot, { recursive: true, force: true });
  }
});

test('materializer skips repair loop event directories and counts standard tasks only', () => {
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
      change_id: 'example-change',
      goal: 'Repair test_defect for CASE-03.'
    });

    const result = materialize({
      projectRoot: current.projectRoot,
      changeId: 'example-change',
      write: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.task_count, 1);
    assert.deepEqual(
      result.written.map((entry) => entry.task_id),
      ['001-example']
    );
    assert.equal(
      fs.existsSync(path.join(repairTaskDir, 'acceptance.json')),
      false
    );
  } finally {
    fs.rmSync(current.projectRoot, { recursive: true, force: true });
  }
});

test('materializer fails closed for unknown context schemas', () => {
  const current = fixture();
  try {
    const contextFile = path.join(current.taskDir, 'context.json');
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    context.schema = 'specnav.development.unknown-task.v1';
    writeJson(contextFile, context);

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change',
        write: false
      }),
      /task-acceptance:invalid-context-schema:001-example/
    );
  } finally {
    fs.rmSync(current.projectRoot, { recursive: true, force: true });
  }
});

test('materializer fails closed for invalid standard task ids', () => {
  const current = fixture();
  try {
    const invalidTaskDir = path.join(
      current.changeDir,
      'development',
      'tasks',
      'invalid-task'
    );
    writeJson(path.join(invalidTaskDir, 'context.json'), {
      task_id: 'invalid-task',
      goal: 'This must not be treated as a standard task.',
      acceptance_assertions: ['AC-01']
    });

    assert.throws(
      () => materialize({
        projectRoot: current.projectRoot,
        changeId: 'example-change',
        write: false
      }),
      /task-acceptance:invalid-task-id:invalid-task/
    );
  } finally {
    fs.rmSync(current.projectRoot, { recursive: true, force: true });
  }
});
