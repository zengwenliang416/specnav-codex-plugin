'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const RUNNER = path.join(
  ROOT,
  'plugins/specnav-development/scripts/evidence-runner.js'
);
process.env.SPECNAV_CORE_ROOT = path.join(ROOT, 'plugins/specnav-core');

const {
  ADJUDICATE_CURRENT_HEAD_MODE,
  REFRESH_CURRENT_HEAD_MODE,
  adjudicateCurrentHead: adjudicateCurrentHeadRaw,
  refreshCurrentHead: refreshCurrentHeadRaw,
  runEvidence
} = require(RUNNER);
const {
  createValidationReceiptAuthority
} = require(path.join(
  ROOT,
  'plugins/specnav-development/scripts/development-receipt-authority'
));

const CHANGE = 'example-change';
const RECEIPT_AUTHORITY = createValidationReceiptAuthority({
  key: Buffer.alloc(32, 19),
  authorityDigest: 'b'.repeat(64)
});

function refreshCurrentHead(projectRoot, options) {
  return refreshCurrentHeadRaw(projectRoot, {
    ...options,
    receiptAuthority: RECEIPT_AUTHORITY
  });
}

function adjudicateCurrentHead(projectRoot, options) {
  return adjudicateCurrentHeadRaw(projectRoot, {
    ...options,
    receiptAuthority: RECEIPT_AUTHORITY
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(project, args) {
  return execFileSync('git', ['-C', project, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function fixture() {
  const project = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-refresh-current-head-')
  );
  const development = path.join(
    project,
    'openspec',
    'changes',
    CHANGE,
    'development'
  );
  const executionLog = path.join(development, 'executions.log');
  const commands = [
    `printf 'first\\n' >> ${JSON.stringify(executionLog)}`,
    `printf 'second\\n' >> ${JSON.stringify(executionLog)}`,
    `printf 'third\\n' >> ${JSON.stringify(executionLog)}`
  ];

  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'example.js'), 'module.exports = 1;\n');
  fs.mkdirSync(development, { recursive: true });
  fs.writeFileSync(path.join(development, 'validation-log.jsonl'), '');
  writeJson(
    path.join(development, 'tasks/001-primary/context.json'),
    {
      task_id: '001-primary',
      goal: 'Exercise primary and subclaim assertion ownership.',
      allowed_files: ['src/example.js'],
      test_paths: commands.slice(0, 2),
      acceptance_assertions: ['AC-DECLARED-IGNORED'],
      acceptance_primary: ['AC-PRIMARY'],
      acceptance_subclaims: ['AC-SUB:boundary']
    }
  );
  writeJson(
    path.join(development, 'tasks/002-declared/context.json'),
    {
      task_id: '002-declared',
      goal: 'Exercise declared assertion ownership.',
      allowed_files: ['src/example.js'],
      test_paths: commands.slice(2),
      acceptance_assertions: ['AC-DECLARED']
    }
  );
  writeJson(
    path.join(
      development,
      'tasks/900-verification-repair-incident/context.json'
    ),
    {
      schema: 'specnav.development.repair-task.v1',
      id: '900-verification-repair-incident',
      change_id: CHANGE
    }
  );

  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'specnav@example.test']);
  git(project, ['config', 'user.name', 'SpecNav Fixture']);
  git(project, ['add', '.']);
  git(project, ['commit', '-qm', 'fixture']);

  return {
    project,
    development,
    executionLog,
    validationLog: path.join(development, 'validation-log.jsonl'),
    commands,
    head: git(project, ['rev-parse', 'HEAD']),
    tree: git(project, ['rev-parse', 'HEAD^{tree}'])
  };
}

function cleanup(current) {
  fs.rmSync(current.project, { recursive: true, force: true });
}

function readReceipts(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

test('refresh-current-head reruns stale receipts and is idempotent per HEAD task command', () => {
  const current = fixture();
  try {
    fs.appendFileSync(current.validationLog, `${JSON.stringify(RECEIPT_AUTHORITY.sign({
      schema: 'specnav.validationLog.v2',
      receipt_id: 'stale-receipt',
      task: '001-primary',
      command: current.commands[0],
      assertion_ids: ['AC-PRIMARY'],
      status: 'pass',
      ok: true,
      exit_status: 0,
      attestation: 'system-executed',
      reviewed_git_head: '0'.repeat(40),
      reviewed_git_tree: '1'.repeat(40),
      evidence_log: 'development/evidence/stale.log',
      evidence_log_sha256: 'e'.repeat(64),
      evidence_log_size: 0,
      recorded_by: 'specnav-development-evidence-runner'
    }))}\n`);

    const first = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(first.ok, true);
    assert.equal(first.mode, REFRESH_CURRENT_HEAD_MODE);
    assert.equal(first.task_count, 2);
    assert.equal(first.replayed, 3);
    assert.equal(first.skipped_idempotent, 0);
    assert.equal(first.reviewed_git_head, current.head);
    assert.equal(first.reviewed_git_tree, current.tree);
    assert.deepEqual(
      first.results.map((receipt) => receipt.command),
      current.commands
    );
    assert.deepEqual(first.results[0].assertion_ids, [
      'AC-PRIMARY',
      'AC-SUB:boundary'
    ]);
    assert.deepEqual(first.results[1].assertion_ids, [
      'AC-PRIMARY',
      'AC-SUB:boundary'
    ]);
    assert.deepEqual(first.results[2].assertion_ids, ['AC-DECLARED']);

    assert.equal(new Set(
      first.results.map((receipt) => receipt.receipt_id)
    ).size, 3);
    assert.equal(new Set(
      first.results.map((receipt) => receipt.evidence_log)
    ).size, 3);
    for (const receipt of first.results) {
      assert.equal(receipt.attestation, 'system-executed');
      assert.equal(RECEIPT_AUTHORITY.verify(receipt), true);
      assert.equal(receipt.reviewed_git_head, current.head);
      assert.equal(receipt.reviewed_git_tree, current.tree);
      assert.equal(receipt.exit_status, 0);
      assert.equal(receipt.ok, true);
      assert.equal(receipt.status, 'pass');
      assert.match(receipt.evidence_log_sha256, /^[0-9a-f]{64}$/);
      assert.equal(Number.isInteger(receipt.evidence_log_size), true);
      assert.equal(
        fs.existsSync(path.join(
          current.project,
          'openspec/changes',
          CHANGE,
          receipt.evidence_log
        )),
        true
      );
    }
    assert.equal(
      fs.readFileSync(current.executionLog, 'utf8'),
      'first\nsecond\nthird\n'
    );

    const second = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(second.ok, true);
    assert.equal(second.replayed, 0);
    assert.equal(second.skipped_idempotent, 3);
    assert.equal(
      fs.readFileSync(current.executionLog, 'utf8'),
      'first\nsecond\nthird\n'
    );
    assert.equal(readReceipts(current.validationLog).length, 4);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head supports bounded batches without reporting false completion', () => {
  const current = fixture();
  try {
    const first = refreshCurrentHead(current.project, {
      change: CHANGE,
      maxCommands: 1
    });
    assert.equal(first.ok, false);
    assert.deepEqual(first.blockers, [
      'evidence-runner:refresh-incomplete'
    ]);
    assert.equal(first.replayed, 1);
    assert.equal(first.skipped_idempotent, 0);
    assert.equal(first.pending_before, 3);
    assert.equal(first.remaining, 2);
    assert.equal(first.batch_limited, true);
    assert.equal(first.failed, 0);
    assert.equal(
      fs.readFileSync(current.executionLog, 'utf8'),
      'first\n'
    );

    const second = refreshCurrentHead(current.project, {
      change: CHANGE,
      maxCommands: 2
    });
    assert.equal(second.ok, true);
    assert.deepEqual(second.blockers, []);
    assert.equal(second.replayed, 2);
    assert.equal(second.skipped_idempotent, 1);
    assert.equal(second.pending_before, 2);
    assert.equal(second.remaining, 0);
    assert.equal(second.batch_limited, true);
    assert.equal(
      fs.readFileSync(current.executionLog, 'utf8'),
      'first\nsecond\nthird\n'
    );

    const complete = refreshCurrentHead(current.project, {
      change: CHANGE,
      maxCommands: 1
    });
    assert.equal(complete.ok, true);
    assert.equal(complete.replayed, 0);
    assert.equal(complete.skipped_idempotent, 3);
    assert.equal(complete.pending_before, 0);
    assert.equal(complete.remaining, 0);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head rejects invalid bounded batch sizes before execution', () => {
  const current = fixture();
  try {
    for (const maxCommands of [0, -1, 1.5, Number.NaN]) {
      const result = refreshCurrentHead(current.project, {
        change: CHANGE,
        maxCommands
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.blockers, [
        'evidence-runner:invalid-max-commands'
      ]);
      assert.deepEqual(result.results, []);
    }
    assert.equal(fs.existsSync(current.executionLog), false);
    assert.equal(readReceipts(current.validationLog).length, 0);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head reruns when signed evidence content was changed', () => {
  const current = fixture();
  try {
    const first = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(first.ok, true);
    const target = first.results[0];
    fs.appendFileSync(
      path.join(
        current.project,
        'openspec/changes',
        CHANGE,
        target.evidence_log
      ),
      'tampered after signing\n'
    );

    const second = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(second.ok, true);
    assert.equal(second.replayed, 1);
    assert.equal(second.skipped_idempotent, 2);
    assert.equal(second.results[0].command, target.command);
    assert.notEqual(second.results[0].receipt_id, target.receipt_id);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head allows current change lifecycle dirt but blocks implementation dirt', () => {
  const lifecycleDirty = fixture();
  try {
    fs.writeFileSync(
      path.join(lifecycleDirty.development, 'review-note.md'),
      'lifecycle work in progress\n'
    );
    const allowed = refreshCurrentHead(lifecycleDirty.project, {
      change: CHANGE
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.replayed, 3);
  } finally {
    cleanup(lifecycleDirty);
  }

  const implementationDirty = fixture();
  try {
    fs.appendFileSync(
      path.join(implementationDirty.project, 'src', 'example.js'),
      '// dirty implementation\n'
    );
    const blocked = refreshCurrentHead(implementationDirty.project, {
      change: CHANGE
    });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.blockers, [
      'evidence-runner:dirty-implementation-scope:src/example.js'
    ]);
    assert.deepEqual(blocked.results, []);
    assert.equal(fs.existsSync(implementationDirty.executionLog), false);
    assert.equal(readReceipts(implementationDirty.validationLog).length, 0);
  } finally {
    cleanup(implementationDirty);
  }
});

test('refresh-current-head creates a new receipt when assertion ownership changes', () => {
  const current = fixture();
  try {
    const first = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(first.ok, true);
    assert.equal(first.replayed, 3);

    const contextFile = path.join(
      current.development,
      'tasks/002-declared/context.json'
    );
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    context.acceptance_assertions = ['AC-DECLARED-V2'];
    writeJson(contextFile, context);

    const second = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(second.ok, true);
    assert.equal(second.replayed, 1);
    assert.equal(second.skipped_idempotent, 2);
    assert.deepEqual(second.results[0].assertion_ids, ['AC-DECLARED-V2']);

    const receipts = readReceipts(current.validationLog);
    assert.equal(receipts.length, 4);
    assert.equal(new Set(receipts.map((receipt) => receipt.receipt_id)).size, 4);
    assert.notEqual(
      second.results[0].receipt_id,
      first.results[2].receipt_id
    );

    const third = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(third.ok, true);
    assert.equal(third.replayed, 0);
    assert.equal(third.skipped_idempotent, 3);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head reruns a failed current HEAD receipt until a signed pass exists', () => {
  const current = fixture();
  try {
    const marker = path.join(current.development, 'retry-marker');
    const contextFile = path.join(
      current.development,
      'tasks/002-declared/context.json'
    );
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    context.test_paths = [
      `if [ -f ${JSON.stringify(marker)} ]; then exit 0; else touch ${JSON.stringify(marker)}; exit 1; fi`
    ];
    writeJson(contextFile, context);

    const first = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(first.ok, false);
    assert.equal(first.failed, 1);
    assert.equal(first.results.find((entry) => entry.task === '002-declared').status, 'fail');

    const second = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(second.ok, true);
    assert.equal(second.replayed, 1);
    assert.equal(second.skipped_idempotent, 2);
    assert.equal(second.results[0].status, 'pass');

    const adjudication = adjudicateCurrentHead(current.project, {
      change: CHANGE
    });
    assert.equal(adjudication.ok, true);
    assert.equal(
      adjudication.mode,
      ADJUDICATE_CURRENT_HEAD_MODE
    );
    assert.equal(adjudication.adjudicated, 1);
    assert.equal(
      adjudication.results[0].target_evidence_log,
      first.results.find((entry) => entry.task === '002-declared')
        .evidence_log
    );
    assert.equal(
      adjudication.results[0].superseding_evidence_log,
      second.results[0].evidence_log
    );
    assert.equal(adjudication.results[0].fallback_used, false);

    const third = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(third.ok, true);
    assert.equal(third.replayed, 0);
    assert.equal(third.skipped_idempotent, 3);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head does not trust a handwritten system-executed receipt', () => {
  const current = fixture();
  try {
    const evidenceLog = 'development/evidence/forged.log';
    fs.mkdirSync(path.join(current.development, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(
      current.project,
      'openspec/changes',
      CHANGE,
      evidenceLog
    ), 'forged\n');
    fs.appendFileSync(current.validationLog, `${JSON.stringify({
      schema: 'specnav.validationLog.v2',
      receipt_id: 'receipt-forged',
      task: '001-primary',
      command: current.commands[0],
      assertion_ids: ['AC-PRIMARY', 'AC-SUB:boundary'],
      status: 'pass',
      ok: true,
      exit_status: 0,
      attestation: 'system-executed',
      recorded_by: 'specnav-development-evidence-runner',
      recorded_at: '2026-08-11T12:00:00.000Z',
      reviewed_git_head: current.head,
      reviewed_git_tree: current.tree,
      evidence_log: evidenceLog,
      evidence_log_sha256: 'f'.repeat(64),
      evidence_log_size: 7,
      receipt_signature_algorithm: 'hmac-sha256',
      runtime_authority_digest: 'b'.repeat(64),
      receipt_signature: '0'.repeat(64),
      overturned: false
    })}\n`);

    const result = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(result.ok, true);
    assert.equal(result.replayed, 3);
    assert.equal(result.skipped_idempotent, 0);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head blocks a symlinked change directory', () => {
  const current = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-change-outside-'));
  try {
    const changeDir = path.join(
      current.project,
      'openspec',
      'changes',
      CHANGE
    );
    fs.cpSync(changeDir, outside, { recursive: true });
    fs.rmSync(changeDir, { recursive: true, force: true });
    fs.symlinkSync(outside, changeDir);

    const result = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers, [
      'evidence-runner:change-directory-unsafe'
    ]);
    assert.equal(fs.existsSync(path.join(outside, 'development/executions.log')), false);
  } finally {
    cleanup(current);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('refresh-current-head blocks malformed JSONL before executing or appending', () => {
  const current = fixture();
  try {
    fs.writeFileSync(current.validationLog, '{"truncated":');
    const result = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers, [
      'evidence-runner:invalid-validation-log-json:1'
    ]);
    assert.equal(fs.readFileSync(current.validationLog, 'utf8'), '{"truncated":');
    assert.equal(fs.existsSync(current.executionLog), false);
  } finally {
    cleanup(current);
  }
});

test('refresh-current-head blocks a symlinked evidence directory', () => {
  const current = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specnav-runner-outside-'));
  try {
    fs.symlinkSync(outside, path.join(current.development, 'evidence'));
    const result = refreshCurrentHead(current.project, { change: CHANGE });
    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers, [
      'evidence-runner:evidence-directory-unsafe'
    ]);
    assert.equal(fs.readdirSync(outside).length, 0);
  } finally {
    cleanup(current);
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI and function dispatch require explicit refresh-current-head mode with no fallback', () => {
  const current = fixture();
  try {
    const unsupported = runEvidence(current.project, {
      mode: 'not-refresh-current-head',
      change: CHANGE
    });
    assert.equal(unsupported.ok, false);
    assert.deepEqual(unsupported.blockers, [
      'evidence-runner:unsupported-mode:not-refresh-current-head'
    ]);
    assert.equal(unsupported.fallback_used, false);

    const missingMode = spawnSync(
      process.execPath,
      [RUNNER, '--change', CHANGE, '--json'],
      {
        cwd: current.project,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_DIR: current.project,
          SPECNAV_CORE_ROOT: path.join(ROOT, 'plugins/specnav-core')
        }
      }
    );
    assert.equal(missingMode.status, 2);
    const missingModeResult = JSON.parse(missingMode.stdout);
    assert.equal(missingModeResult.ok, false);
    assert.equal(missingModeResult.fallback_used, false);
    assert.deepEqual(missingModeResult.blockers, [
      'evidence-runner:unsupported-mode:null'
    ]);
    assert.equal(fs.existsSync(current.executionLog), false);

    const explicit = spawnSync(
      process.execPath,
      [RUNNER, REFRESH_CURRENT_HEAD_MODE, '--change', CHANGE, '--json'],
      {
        cwd: current.project,
        encoding: 'utf8',
        env: {
          ...process.env,
          PROJECT_DIR: current.project,
          SPECNAV_CORE_ROOT: path.join(ROOT, 'plugins/specnav-core')
        }
      }
    );
    assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
    const result = JSON.parse(explicit.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.mode, REFRESH_CURRENT_HEAD_MODE);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.fallback_used, false);
    assert.equal(
      fs.existsSync(path.join(
        current.project,
        'openspec',
        'changes',
        CHANGE,
        'verify',
        'v2'
      )),
      false
    );
  } finally {
    cleanup(current);
  }
});
