'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createEvidenceStore
} = require('../../../plugins/specnav-verification/kernel/evidence');
const {
  writeAll
} = require('../../../plugins/specnav-verification/kernel/evidence/raw-store');
const {
  readySchemaRegistry
} = require('../contracts/cross-reference/test-helpers');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeSandbox() {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-store-')
  );
  const changeRoot = path.join(
    projectRoot,
    'openspec',
    'changes',
    'verification-2-0'
  );
  const sourceRoot = path.join(projectRoot, 'artifacts');
  const storeRoot = path.join(changeRoot, 'verify', 'evidence');
  fs.mkdirSync(changeRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  return { projectRoot, changeRoot, sourceRoot, storeRoot };
}

function makeRegistry() {
  return {
    validate(entityType, value) {
      const expectedSchema = entityType === 'evidence'
        ? 'specnav.verification.evidence.v1'
        : 'specnav.verification.evidence-index.v1';
      const required = entityType === 'evidence'
        ? [
            'id',
            'kind',
            'path',
            'sha256',
            'size',
            'producer',
            'captured_at',
            'change_id',
            'run_id',
            'case_id',
            'attempt_id',
            'code_sha',
            'test_sha',
            'environment_hash',
            'runtime_version',
            'kernel_version',
            'redaction'
          ]
        : [
            'index_version',
            'change_id',
            'generated_at',
            'source_raw',
            'source_digest',
            'record_count',
            'entries'
          ];
      const missing = required.filter((field) => value?.[field] === undefined);
      const ok = value?.schema === expectedSchema && missing.length === 0;
      return {
        ok,
        value: ok ? structuredClone(value) : null,
        blockers: ok ? [] : [{
          id: 'verification-contract:schema-invalid',
          artifact_path: `memory://${entityType}`,
          entity_type: entityType,
          field: missing[0] || '/schema'
        }]
      };
    }
  };
}

function baseEvidence(overrides = {}) {
  return {
    kind: 'assertion_result',
    producer: 'playwright-runner',
    captured_at: '2026-07-31T17:40:00.000Z',
    change_id: 'verification-2-0',
    run_id: 'run-1',
    case_id: 'case-1',
    attempt_id: 'attempt-1',
    assertion_id: 'assertion-1',
    code_sha: 'a'.repeat(40),
    test_sha: 'b'.repeat(40),
    environment_hash: 'c'.repeat(64),
    runtime_version: '2.0.0-alpha.1',
    kernel_version: '2.0.0-alpha.1',
    redaction: {
      status: 'not_required',
      redacted_fields: []
    },
    result: 'fail',
    content_type: 'application/json',
    ...overrides
  };
}

function makeStore(options = {}) {
  const sandbox = options.sandbox || makeSandbox();
  const store = createEvidenceStore({
    root: sandbox.storeRoot,
    changeRoot: sandbox.changeRoot,
    changeId: 'verification-2-0',
    sourceRoot: sandbox.sourceRoot,
    schemaRegistry: options.schemaRegistry || makeRegistry(),
    clock: options.clock || (() => '2026-07-31T17:41:00.000Z')
  });
  return { ...sandbox, store };
}

test('append writes one immutable raw record, content object, index, and cache metadata', () => {
  const { storeRoot, store } = makeStore();
  const bytes = Buffer.from('{"actual":false,"expected":true}\n');

  const result = store.append({
    evidence: baseEvidence(),
    content: bytes
  });

  assert.equal(result.ok, true);
  assert.match(result.evidence.id, /^evidence-[a-f0-9]{64}$/);
  assert.equal(result.evidence.sha256, sha256(bytes));
  assert.equal(result.evidence.size, bytes.length);
  assert.equal(
    result.evidence.path,
    `objects/${result.evidence.sha256}.json`
  );

  const objectFile = path.join(storeRoot, result.evidence.path);
  assert.deepEqual(fs.readFileSync(objectFile), bytes);

  const rawFile = path.join(storeRoot, 'raw.jsonl');
  const rawLines = fs.readFileSync(rawFile, 'utf8').trim().split('\n');
  assert.equal(rawLines.length, 1);
  assert.deepEqual(JSON.parse(rawLines[0]), result.evidence);

  const index = JSON.parse(
    fs.readFileSync(path.join(storeRoot, 'index.json'), 'utf8')
  );
  assert.equal(index.record_count, 1);
  assert.deepEqual(index.entries, [result.evidence]);
  assert.equal(index.source_digest, sha256(fs.readFileSync(rawFile)));

  const cache = JSON.parse(
    fs.readFileSync(path.join(storeRoot, 'cache', 'index-meta.json'), 'utf8')
  );
  assert.equal(cache.source_digest, index.source_digest);
  assert.equal(cache.record_count, 1);

  const lookup = store.getById(result.evidence.id);
  assert.equal(lookup.ok, true);
  assert.deepEqual(lookup.evidence, result.evidence);

  const resolved = store.resolve(result.evidence.id);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.path, objectFile);
});

test('persisted evidence and index pass the managed AJV schema registry', () => {
  const schemaRegistry = readySchemaRegistry();
  const { storeRoot, store } = makeStore({ schemaRegistry });
  const appended = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('managed schema validation')
  });

  assert.equal(appended.ok, true, JSON.stringify(appended.blockers));
  const evidenceValidation = schemaRegistry.validate(
    'evidence',
    appended.evidence
  );
  const index = JSON.parse(fs.readFileSync(
    path.join(storeRoot, 'index.json'),
    'utf8'
  ));
  const indexValidation = schemaRegistry.validate('evidence-index', index);
  assert.equal(evidenceValidation.ok, true, JSON.stringify(evidenceValidation.blockers));
  assert.equal(indexValidation.ok, true, JSON.stringify(indexValidation.blockers));
});

test('append does not mutate caller-owned evidence or content', () => {
  const { store } = makeStore();
  const evidence = baseEvidence();
  const content = Buffer.from('caller-owned bytes');
  const evidenceBefore = structuredClone(evidence);
  const contentBefore = Buffer.from(content);

  const result = store.append({ evidence, content });

  assert.equal(result.ok, true);
  assert.deepEqual(evidence, evidenceBefore);
  assert.deepEqual(content, contentBefore);
  assert.equal(Object.isFrozen(evidence), false);
});

test('failed evidence remains after a later passing attempt and cache deletion', () => {
  const { storeRoot, store } = makeStore();
  const failed = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('failed assertion')
  });
  const passed = store.append({
    evidence: baseEvidence({
      attempt_id: 'attempt-2',
      captured_at: '2026-07-31T17:42:00.000Z',
      result: 'pass'
    }),
    content: Buffer.from('passing assertion')
  });

  assert.equal(failed.ok, true);
  assert.equal(passed.ok, true);
  fs.rmSync(path.join(storeRoot, 'index.json'), { recursive: true, force: true });
  fs.rmSync(path.join(storeRoot, 'cache'), { recursive: true, force: true });

  const rebuilt = store.rebuildIndex();

  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.index.record_count, 2);
  assert.deepEqual(
    rebuilt.index.entries.map((entry) => [entry.attempt_id, entry.result]),
    [['attempt-1', 'fail'], ['attempt-2', 'pass']]
  );
  assert.equal(
    fs.readFileSync(path.join(storeRoot, 'raw.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .length,
    2
  );
});

test('index bytes are deterministic across rebuild and ignore mtime changes', () => {
  const { storeRoot, store } = makeStore();
  assert.equal(store.append({
    evidence: baseEvidence(),
    content: Buffer.from('deterministic index')
  }).ok, true);
  const rawFile = path.join(storeRoot, 'raw.jsonl');
  const indexFile = path.join(storeRoot, 'index.json');
  const firstIndex = fs.readFileSync(indexFile);
  const future = new Date('2030-01-01T00:00:00.000Z');
  fs.utimesSync(rawFile, future, future);

  const rebuilt = store.rebuildIndex();

  assert.equal(rebuilt.ok, true);
  assert.deepEqual(fs.readFileSync(indexFile), firstIndex);
});

test('an exact duplicate append is idempotent and adds no raw record', () => {
  const { storeRoot, store } = makeStore();
  const request = {
    evidence: baseEvidence(),
    content: Buffer.from('same evidence')
  };

  assert.equal(store.append(request).ok, true);
  const duplicate = store.append(request);

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  const rawLines = fs.readFileSync(
    path.join(storeRoot, 'raw.jsonl'),
    'utf8'
  ).trim().split('\n');
  assert.equal(rawLines.length, 1);
});

test('an idempotent append restores deleted derived and object files', () => {
  const { storeRoot, store } = makeStore();
  const request = {
    evidence: baseEvidence(),
    content: Buffer.from('recoverable evidence')
  };
  const first = store.append(request);
  assert.equal(first.ok, true);
  fs.rmSync(path.join(storeRoot, first.evidence.path));
  fs.rmSync(path.join(storeRoot, 'index.json'), { recursive: true, force: true });
  fs.rmSync(path.join(storeRoot, 'cache'), { recursive: true, force: true });

  const replay = store.append(request);

  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(fs.existsSync(path.join(storeRoot, replay.evidence.path)), true);
  assert.equal(
    fs.existsSync(path.join(storeRoot, 'index.json')),
    true
  );
  assert.equal(
    fs.readFileSync(path.join(storeRoot, 'raw.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .length,
    1
  );
});

test('the same bytes under different attempts reuse the object but keep distinct records', () => {
  const { storeRoot, store } = makeStore();
  const content = Buffer.from('shared screenshot bytes');
  const first = store.append({
    evidence: baseEvidence(),
    content
  });
  const second = store.append({
    evidence: baseEvidence({
      attempt_id: 'attempt-2',
      captured_at: '2026-07-31T17:43:00.000Z'
    }),
    content
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.evidence.id, second.evidence.id);
  assert.equal(first.evidence.path, second.evidence.path);
  const objectDir = path.dirname(path.join(storeRoot, first.evidence.path));
  assert.deepEqual(fs.readdirSync(objectDir), [`${first.evidence.sha256}.json`]);
});

test('store rejects caller-supplied managed identity and object fields', () => {
  const { store } = makeStore();
  const result = store.append({
    evidence: baseEvidence({
      id: 'forged-id',
      path: 'forged/path',
      sha256: 'd'.repeat(64),
      size: 10
    }),
    content: Buffer.from('forged')
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:managed-field-supplied']
  );
});

test('source files must resolve inside the approved source root', () => {
  const sandbox = makeSandbox();
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-external-')
  );
  const externalFile = path.join(externalRoot, 'secret.txt');
  const linkFile = path.join(sandbox.sourceRoot, 'linked.txt');
  fs.writeFileSync(externalFile, 'outside');
  fs.symlinkSync(externalFile, linkFile);
  const { store } = makeStore({ sandbox });

  const outside = store.append({
    evidence: baseEvidence(),
    source_path: externalFile
  });
  const symlink = store.append({
    evidence: baseEvidence({ attempt_id: 'attempt-2' }),
    source_path: linkFile
  });

  assert.deepEqual(
    outside.blockers.map((blocker) => blocker.id),
    ['verification-evidence:source-path-outside-root']
  );
  assert.deepEqual(
    symlink.blockers.map((blocker) => blocker.id),
    ['verification-evidence:source-path-symlink']
  );
});

test('a raw JSONL symlink cannot redirect append outside the store', () => {
  const { storeRoot, store } = makeStore();
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-raw-link-')
  );
  const externalFile = path.join(externalRoot, 'outside.jsonl');
  fs.writeFileSync(externalFile, 'outside\n');
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.symlinkSync(externalFile, path.join(storeRoot, 'raw.jsonl'));

  const result = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('must not escape')
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:raw-path-unsafe']
  );
  assert.equal(fs.readFileSync(externalFile, 'utf8'), 'outside\n');
});

test('corrupt raw JSON blocks rebuild and preserves the last valid index', () => {
  const { storeRoot, store } = makeStore();
  const first = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('valid')
  });
  assert.equal(first.ok, true);
  const indexFile = path.join(storeRoot, 'index.json');
  const previousIndex = fs.readFileSync(indexFile);
  fs.appendFileSync(
    path.join(storeRoot, 'raw.jsonl'),
    '{"schema":"broken"\n'
  );

  const rebuilt = store.rebuildIndex();

  assert.equal(rebuilt.ok, false);
  assert.deepEqual(
    rebuilt.blockers.map((blocker) => blocker.id),
    ['verification-evidence:raw-json-invalid']
  );
  assert.deepEqual(fs.readFileSync(indexFile), previousIndex);
});

test('duplicate raw ids block rebuild and ID lookup', () => {
  const { storeRoot, store } = makeStore();
  const first = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('valid duplicate source')
  });
  assert.equal(first.ok, true);
  const rawFile = path.join(storeRoot, 'raw.jsonl');
  const line = fs.readFileSync(rawFile, 'utf8').trim();
  fs.appendFileSync(rawFile, `${line}\n`);

  const rebuilt = store.rebuildIndex();
  const lookup = store.getById(first.evidence.id);

  assert.equal(rebuilt.ok, false);
  assert.equal(lookup.ok, false);
  assert.deepEqual(
    rebuilt.blockers.map((blocker) => blocker.id),
    ['verification-evidence:duplicate-raw-id']
  );
  assert.deepEqual(
    lookup.blockers.map((blocker) => blocker.id),
    ['verification-evidence:duplicate-raw-id']
  );
});

test('an existing content-addressed object with different bytes blocks append', () => {
  const { storeRoot, store } = makeStore();
  const bytes = Buffer.from('expected bytes');
  const digest = sha256(bytes);
  const objectFile = path.join(
    storeRoot,
    'objects',
    `${digest}.json`
  );
  fs.mkdirSync(path.dirname(objectFile), { recursive: true });
  fs.writeFileSync(objectFile, 'tampered bytes');

  const result = store.append({
    evidence: baseEvidence(),
    content: bytes
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:object-conflict']
  );
  assert.equal(
    fs.existsSync(path.join(storeRoot, 'raw.jsonl')),
    false
  );
});

test('content object publication failure returns an exact blocker without throwing', () => {
  const { storeRoot, store } = makeStore();
  const originalCopyFileSync = fs.copyFileSync;
  fs.copyFileSync = () => {
    const error = new Error('publish denied');
    error.code = 'EPERM';
    throw error;
  };
  try {
    let result;
    assert.doesNotThrow(() => {
      result = store.append({
        evidence: baseEvidence(),
        content: Buffer.from('must fail closed')
      });
    });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.blockers.map((blocker) => blocker.id),
      ['verification-evidence:object-write-failed']
    );
    assert.match(result.blockers[0].detail, /EPERM: publish denied/);
    assert.equal(fs.existsSync(path.join(storeRoot, 'raw.jsonl')), false);
  } finally {
    fs.copyFileSync = originalCopyFileSync;
  }
});

test('resolve refuses a content object replaced by a symlink', () => {
  const { storeRoot, store } = makeStore();
  const appended = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('replaceable object')
  });
  assert.equal(appended.ok, true);
  const objectFile = path.join(storeRoot, appended.evidence.path);
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-object-link-')
  );
  const externalFile = path.join(externalRoot, 'outside.bin');
  fs.writeFileSync(externalFile, 'outside object');
  fs.rmSync(objectFile);
  fs.symlinkSync(externalFile, objectFile);

  const result = store.resolve(appended.evidence.id);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:object-path-unsafe']
  );
});

test('lookup rejects a store root replaced by an external symlink', () => {
  const sandbox = makeStore();
  const appended = sandbox.store.append({
    evidence: baseEvidence(),
    content: Buffer.from('must remain under the change root')
  });
  assert.equal(appended.ok, true);
  const externalBase = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-store-swap-')
  );
  const externalStore = path.join(externalBase, 'evidence');
  fs.renameSync(sandbox.storeRoot, externalStore);
  fs.symlinkSync(externalStore, sandbox.storeRoot);

  try {
    const result = sandbox.store.getById(appended.evidence.id);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.blockers.map((blocker) => blocker.id),
      ['verification-evidence:store-root-symlink']
    );
  } finally {
    fs.rmSync(sandbox.storeRoot, { force: true });
    fs.rmSync(externalBase, { recursive: true, force: true });
    fs.rmSync(sandbox.projectRoot, { recursive: true, force: true });
  }
});

test('schema rejection blocks raw append and index publication', () => {
  const rejectingRegistry = {
    validate(entityType) {
      return {
        ok: false,
        value: null,
        blockers: [{
          id: 'verification-contract:schema-invalid',
          artifact_path: `memory://${entityType}`
        }]
      };
    }
  };
  const { storeRoot, store } = makeStore({
    schemaRegistry: rejectingRegistry
  });

  const result = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('invalid metadata')
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockers[0].id,
    'verification-contract:schema-invalid'
  );
  assert.equal(fs.existsSync(path.join(storeRoot, 'raw')), false);
});

test('store root must remain inside the approved change root', () => {
  const sandbox = makeSandbox();
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-store-outside-')
  );
  const store = createEvidenceStore({
    root: externalRoot,
    changeRoot: sandbox.changeRoot,
    changeId: 'verification-2-0',
    sourceRoot: sandbox.sourceRoot,
    schemaRegistry: makeRegistry(),
    clock: () => '2026-07-31T17:44:00.000Z'
  });

  const result = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('outside root')
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:store-root-outside-change']
  );
});

test('a symlinked change root cannot redirect the complete store', () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-change-link-')
  );
  const externalChange = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-evidence-change-target-')
  );
  const changesRoot = path.join(projectRoot, 'openspec', 'changes');
  const changeRoot = path.join(changesRoot, 'verification-2-0');
  const sourceRoot = path.join(projectRoot, 'artifacts');
  fs.mkdirSync(changesRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.symlinkSync(externalChange, changeRoot);
  const store = createEvidenceStore({
    root: path.join(changeRoot, 'verify', 'evidence'),
    changeRoot,
    changeId: 'verification-2-0',
    sourceRoot,
    schemaRegistry: makeRegistry(),
    clock: () => '2026-07-31T17:56:00.000Z'
  });

  const result = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('must remain inside lexical change root')
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:store-root-symlink']
  );
  assert.equal(fs.existsSync(path.join(externalChange, 'verify')), false);
});

test('cache publication failure restores the previous index and preserves raw truth', () => {
  const { storeRoot, store } = makeStore();
  const first = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('first record')
  });
  assert.equal(first.ok, true);
  const indexFile = path.join(storeRoot, 'index.json');
  const previousIndex = fs.readFileSync(indexFile);
  fs.rmSync(path.join(storeRoot, 'cache'), { recursive: true, force: true });
  fs.writeFileSync(path.join(storeRoot, 'cache'), 'not a directory');

  const second = store.append({
    evidence: baseEvidence({
      attempt_id: 'attempt-2',
      captured_at: '2026-07-31T17:57:00.000Z'
    }),
    content: Buffer.from('second record')
  });

  assert.equal(second.ok, false);
  assert.equal(second.blockers[0].detail.length > 0, true);
  assert.deepEqual(fs.readFileSync(indexFile), previousIndex);
  assert.equal(
    fs.readFileSync(path.join(storeRoot, 'raw.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .length,
    2
  );

  fs.rmSync(path.join(storeRoot, 'cache'), { force: true });
  const rebuilt = store.rebuildIndex();
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.index.record_count, 2);
});

test('raw writer completes short writes instead of committing a partial line', () => {
  const source = Buffer.from('0123456789abcdef');
  const chunks = [];
  const written = writeAll(1, source, (fd, bytes, offset, length) => {
    assert.equal(fd, 1);
    const count = Math.min(3, length);
    chunks.push(Buffer.from(bytes.subarray(offset, offset + count)));
    return count;
  });

  assert.equal(written, source.length);
  assert.deepEqual(Buffer.concat(chunks), source);
});

test('an occupied raw lock fails closed without creating a raw claim', () => {
  const { storeRoot, store } = makeStore();
  const lockFile = path.join(storeRoot, '.append.lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, 'held');

  const result = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('orphaned object is not a raw claim')
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.id),
    ['verification-evidence:raw-lock-held']
  );
  assert.equal(
    fs.existsSync(path.join(storeRoot, 'raw.jsonl')),
    false
  );
  assert.match(result.orphan_object, /^objects\/[a-f0-9]{64}\.json$/);
});

test('lookup requires a valid summary index and never scans raw as fallback', () => {
  const { storeRoot, store } = makeStore();
  const appended = store.append({
    evidence: baseEvidence(),
    content: Buffer.from('indexed evidence')
  });
  assert.equal(appended.ok, true);

  fs.rmSync(path.join(storeRoot, 'index.json'));
  const missing = store.getById(appended.evidence.id);
  assert.equal(missing.ok, false);
  assert.deepEqual(
    missing.blockers.map((blocker) => blocker.id),
    ['verification-evidence:index-missing']
  );

  assert.equal(store.rebuildIndex().ok, true);
  fs.appendFileSync(
    path.join(storeRoot, 'raw.jsonl'),
    `${JSON.stringify({
      ...appended.evidence,
      id: `evidence-${'f'.repeat(64)}`,
      attempt_id: 'attempt-2'
    })}\n`
  );
  const stale = store.getById(appended.evidence.id);
  assert.equal(stale.ok, false);
  assert.deepEqual(
    stale.blockers.map((blocker) => blocker.id),
    ['verification-evidence:index-source-digest-mismatch']
  );
});

test('non-JSON evidence candidates return a blocker instead of throwing', () => {
  const cases = [
    baseEvidence({ nested: { callback() {} } }),
    baseEvidence({ count: 1n }),
    baseEvidence({ symbol: Symbol('invalid') }),
    Object.assign(new Date(), baseEvidence())
  ];
  const circular = baseEvidence();
  circular.self = circular;
  cases.push(circular);
  const throwingAccessor = baseEvidence();
  Object.defineProperty(throwingAccessor, 'secret', {
    enumerable: true,
    get() {
      throw new Error('must not escape');
    }
  });
  cases.push(throwingAccessor);
  const proxyTarget = baseEvidence();
  const revocable = Proxy.revocable(proxyTarget, {});
  revocable.revoke();
  cases.push(revocable.proxy);

  for (const evidence of cases) {
    const { store } = makeStore();
    assert.doesNotThrow(() => {
      const result = store.append({
        evidence,
        content: Buffer.from('invalid candidate')
      });
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.blockers.map((blocker) => blocker.id),
        ['verification-evidence:candidate-invalid']
      );
    });
  }
});
