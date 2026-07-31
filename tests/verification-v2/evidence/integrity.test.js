'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  appendStoredEvidence,
  cleanupSandbox,
  clone,
  createChecker,
  createCrossReferenceSpy,
  currentFingerprints,
  makeEvidenceStore,
  sha256
} = require('./integrity-test-helpers');

function assertFactsOnly(result) {
  assert.equal(typeof result, 'object');
  assert.equal(result !== null, true);
  assert.equal(Object.hasOwn(result, 'facts'), true, JSON.stringify(result));
  assert.equal(Array.isArray(result.blockers), true, JSON.stringify(result));
  assert.equal('status' in result, false, JSON.stringify(result));
  assert.equal('decision' in result, false, JSON.stringify(result));
  assert.equal('release' in result, false, JSON.stringify(result));
  assert.equal('release_verdict' in result, false, JSON.stringify(result));
  assert.equal('verdict' in result, false, JSON.stringify(result));
}

function assertHasBlocker(result, id) {
  assert.equal(
    result.blockers.some((blocker) => blocker.id === id),
    true,
    JSON.stringify(result.blockers)
  );
}

function runIntegrityCheck(options = {}) {
  const fixture = options.fixture || appendStoredEvidence();
  const crossReferenceValidator = options.crossReferenceValidator
    || createCrossReferenceSpy();
  const checker = createChecker({
    evidenceStore: options.evidenceStore || fixture.store,
    crossReferenceValidator
  });
  const input = {
    activeChangeId: fixture.graph.activeChangeId,
    caseSnapshot: clone(fixture.graph.caseSnapshot),
    run: clone(fixture.graph.run),
    attempts: clone(fixture.graph.attempts),
    readings: clone(fixture.graph.readings),
    evidence: clone(fixture.graph.evidence),
    currentFingerprints: clone(
      options.currentFingerprints || fixture.currentFingerprints
    )
  };
  const result = checker.checkIntegrity(input);
  return {
    checker,
    crossReferenceValidator,
    fixture,
    input,
    result
  };
}

test('public factory exposes createEvidenceIntegrityChecker with an injected checkIntegrity API', () => {
  const sandbox = makeEvidenceStore();
  const { store } = sandbox;
  const crossReferenceValidator = createCrossReferenceSpy();

  try {
    const checker = createChecker({
      evidenceStore: store,
      crossReferenceValidator
    });
    assert.equal(typeof checker.checkIntegrity, 'function');
  } finally {
    cleanupSandbox(sandbox);
  }
});

test('valid intact and fresh evidence returns facts only and uses the injected collaborators', () => {
  const fixture = appendStoredEvidence();

  try {
    const { crossReferenceValidator, result } = runIntegrityCheck({ fixture });
    assertFactsOnly(result);
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(crossReferenceValidator.calls.length, 1);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.facts.summary.evidence_count, 1);
    assert.equal(result.facts.summary.integrity, 'intact');
    assert.equal(result.facts.summary.freshness, 'fresh');
    assert.equal(result.facts.evidence.length, 1);
    assert.deepEqual(result.facts.evidence[0], {
      evidence_id: fixture.storedEvidence.id,
      integrity: 'intact',
      freshness: 'fresh',
      exists: true,
      hash_match: true,
      size_match: true,
      producer_recognized: true,
      store_record_match: true,
      binding_match: true,
      path_safe: true
    });
  } finally {
    cleanupSandbox(fixture);
  }
});

test('missing evidence file reports a broken-evidence fact instead of a verdict', () => {
  const fixture = appendStoredEvidence();
  fs.rmSync(fixture.objectPath, { force: true });

  try {
    const { result } = runIntegrityCheck({ fixture });
    assertFactsOnly(result);
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-missing');
    assert.equal(result.facts.evidence[0].integrity, 'missing');
    assert.equal(result.facts.evidence[0].exists, false);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('tampered evidence bytes block integrity when hash no longer matches', () => {
  const fixture = appendStoredEvidence({
    content: Buffer.from('original-json-payload\n')
  });
  const tampered = Buffer.from('modified-json-payload\n');
  assert.equal(tampered.length, fixture.content.length);
  fs.writeFileSync(fixture.objectPath, tampered);

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-hash-mismatch');
    assert.equal(result.facts.evidence[0].hash_match, false);
    assert.equal(result.facts.evidence[0].size_match, true);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('size mismatch blocks integrity even when the file still exists', () => {
  const fixture = appendStoredEvidence();
  fs.writeFileSync(fixture.objectPath, Buffer.from('different-size-payload'));

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-size-mismatch');
    assert.equal(result.facts.evidence[0].size_match, false);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('an unrecognized producer remains blocked even when bytes are intact', () => {
  const fixture = appendStoredEvidence({
    evidenceOverrides: {
      producer: 'unknown-runner'
    }
  });

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-producer-unrecognized');
    assert.equal(result.facts.evidence[0].producer_recognized, false);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('record mismatch blocks when the graph evidence no longer matches the stored record', () => {
  const fixture = appendStoredEvidence();
  fixture.graph.evidence[0].sha256 = 'f'.repeat(64);

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-record-mismatch');
    assert.equal(result.facts.evidence[0].store_record_match, false);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('binding mismatch is surfaced from the injected cross-reference validator', () => {
  const fixture = appendStoredEvidence();
  const crossReferenceValidator = createCrossReferenceSpy({
    ok: false,
    blockers: [{
      id: 'verification-contract:cross-reference-invalid',
      entity_type: 'reading',
      entity_id: fixture.graph.readings[0].id,
      field: '/evidence_ids',
      related_entity_type: 'evidence',
      related_entity_id: fixture.storedEvidence.id
    }]
  });

  try {
    const { result } = runIntegrityCheck({
      fixture,
      crossReferenceValidator
    });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-contract:cross-reference-invalid');
    assert.equal(result.facts.evidence[0].binding_match, false);
    assert.equal(result.facts.evidence[0].integrity, 'broken');
    assert.equal(result.facts.summary.integrity, 'broken');
  } finally {
    cleanupSandbox(fixture);
  }
});

test('empty evidence blocks green-driving facts before any downstream reading verdict exists', () => {
  const fixture = appendStoredEvidence();
  fixture.graph.evidence = [];
  fixture.graph.readings[0].evidence_ids = [];

  try {
    const { result } = runIntegrityCheck({ fixture });
    assertFactsOnly(result);
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-empty');
    assert.equal(result.facts.summary.evidence_count, 0);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('stale current fingerprints block freshness with SHA-based comparison instead of mtime', () => {
  const fixture = appendStoredEvidence();
  const fingerprints = currentFingerprints(fixture.graph);
  fingerprints.code_sha = '9'.repeat(40);

  try {
    const { result } = runIntegrityCheck({
      fixture,
      currentFingerprints: fingerprints
    });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-stale');
    assert.equal(result.facts.evidence[0].freshness, 'stale');
  } finally {
    cleanupSandbox(fixture);
  }
});

for (const field of [
  'case_snapshot_hash',
  'code_sha',
  'test_sha',
  'environment_hash',
  'runtime_version',
  'kernel_version'
]) {
  test(`changed ${field} blocks the complete execution fingerprint`, () => {
    const fixture = appendStoredEvidence();
    const fingerprints = currentFingerprints(fixture.graph);
    fingerprints[field] = field.endsWith('_hash')
      ? '8'.repeat(64)
      : '9.9.9';

    try {
      const { result } = runIntegrityCheck({
        fixture,
        currentFingerprints: fingerprints
      });
      assert.equal(result.ok, false);
      assertHasBlocker(result, 'verification-integrity:evidence-stale');
      assert.equal(result.facts.evidence[0].freshness, 'stale');
    } finally {
      cleanupSandbox(fixture);
    }
  });
}

test('missing current fingerprints return blockers and facts without throwing', () => {
  const fixture = appendStoredEvidence();

  try {
    assert.doesNotThrow(() => {
      const { result } = runIntegrityCheck({
        fixture,
        currentFingerprints: {
          code_sha: fixture.graph.run.code_sha
        }
      });
      assert.equal(result.ok, false);
      assertHasBlocker(result, 'verification-integrity:current-fingerprints-missing');
      assert.equal(result.facts.summary.freshness, 'unknown');
    });
  } finally {
    cleanupSandbox(fixture);
  }
});

test('missing object and missing store record preserve distinct blocker identities', () => {
  const fixture = appendStoredEvidence();
  const missingRecordStore = {
    getById() {
      return {
        ok: false,
        blockers: [{
          id: 'verification-evidence:evidence-not-found',
          artifact: 'evidence_id',
          detail: fixture.storedEvidence.id
        }]
      };
    },
    resolve() {
      throw new Error('resolve must not run without a stored record');
    }
  };

  try {
    const { result } = runIntegrityCheck({
      fixture,
      evidenceStore: missingRecordStore
    });
    assertHasBlocker(result, 'verification-integrity:evidence-record-missing');
    assert.equal(
      result.blockers.some((blocker) => (
        blocker.id === 'verification-integrity:evidence-missing'
      )),
      false
    );
  } finally {
    cleanupSandbox(fixture);
  }
});

test('stored identity mismatch remains distinct from graph record mismatch', () => {
  const fixture = appendStoredEvidence();
  const identityMismatchStore = {
    getById(id) {
      const found = fixture.store.getById(id);
      return {
        ...found,
        evidence: {
          ...found.evidence,
          captured_at: '2026-07-31T00:00:00Z'
        }
      };
    },
    resolve(id) {
      return fixture.store.resolve(id);
    }
  };

  try {
    const { result } = runIntegrityCheck({
      fixture,
      evidenceStore: identityMismatchStore
    });
    assertHasBlocker(result, 'verification-integrity:evidence-identity-mismatch');
    assertHasBlocker(result, 'verification-integrity:evidence-record-mismatch');
  } finally {
    cleanupSandbox(fixture);
  }
});

test('mtime changes alone are ignored when bytes and fingerprints still match', () => {
  const fixture = appendStoredEvidence();
  const future = new Date('2030-01-01T00:00:00.000Z');
  fs.utimesSync(fixture.objectPath, future, future);

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.facts.evidence[0].freshness, 'fresh');
    assert.equal(result.facts.evidence[0].hash_match, true);
    assert.equal(result.facts.evidence[0].size_match, true);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('unsafe symlink evidence paths are blocked before bytes are trusted', () => {
  const fixture = appendStoredEvidence();
  fs.rmSync(fixture.objectPath, { force: true });
  fs.symlinkSync('/etc/hosts', fixture.objectPath);

  try {
    const { result } = runIntegrityCheck({ fixture });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-path-unsafe');
    assert.equal(result.facts.evidence[0].exists, false);
    assert.equal(result.facts.evidence[0].hash_match, false);
    assert.equal(result.facts.evidence[0].size_match, false);
    assert.equal(result.facts.evidence[0].path_safe, false);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('an unsafe object read cannot emit positive existence or match facts', () => {
  const fixture = appendStoredEvidence();
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-integrity-object-link-')
  );
  const externalFile = path.join(externalRoot, 'outside.json');
  const unsafePath = path.join(externalRoot, 'linked.json');
  fs.writeFileSync(externalFile, fixture.content);
  fs.symlinkSync(externalFile, unsafePath);
  const unsafeStore = {
    getById(id) {
      return fixture.store.getById(id);
    },
    resolve(id) {
      const found = fixture.store.getById(id);
      return found.ok
        ? {
            ok: true,
            evidence: found.evidence,
            path: unsafePath,
            blockers: []
          }
        : found;
    }
  };

  try {
    const { result } = runIntegrityCheck({
      fixture,
      evidenceStore: unsafeStore
    });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-path-unsafe');
    assert.equal(result.facts.evidence[0].exists, false);
    assert.equal(result.facts.evidence[0].hash_match, false);
    assert.equal(result.facts.evidence[0].size_match, false);
    assert.equal(result.facts.evidence[0].path_safe, false);
  } finally {
    fs.rmSync(externalRoot, { recursive: true, force: true });
    cleanupSandbox(fixture);
  }
});

test('an object ancestor swapped after resolve cannot produce trusted facts', () => {
  const fixture = appendStoredEvidence();
  const objectsDir = path.join(fixture.storeRoot, 'objects');
  const originalObjectsDir = path.join(
    fixture.storeRoot,
    'objects-before-race'
  );
  const externalRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'specnav-integrity-object-race-')
  );
  const externalObjectsDir = path.join(externalRoot, 'objects');
  fs.mkdirSync(externalObjectsDir);
  fs.writeFileSync(
    path.join(externalObjectsDir, path.basename(fixture.objectPath)),
    fixture.content
  );
  let swapped = false;
  const racingStore = {
    getById(id) {
      return fixture.store.getById(id);
    },
    resolve(id) {
      const resolved = fixture.store.resolve(id);
      if (resolved.ok && !swapped) {
        fs.renameSync(objectsDir, originalObjectsDir);
        fs.symlinkSync(externalObjectsDir, objectsDir);
        swapped = true;
      }
      return resolved;
    }
  };

  try {
    const { result } = runIntegrityCheck({
      fixture,
      evidenceStore: racingStore
    });
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:evidence-path-unsafe');
    assert.equal(result.facts.evidence[0].exists, false);
    assert.equal(result.facts.evidence[0].hash_match, false);
    assert.equal(result.facts.evidence[0].size_match, false);
    assert.equal(result.facts.evidence[0].path_safe, false);
  } finally {
    if (swapped) {
      fs.rmSync(objectsDir, { force: true });
      fs.renameSync(originalObjectsDir, objectsDir);
    }
    fs.rmSync(externalRoot, { recursive: true, force: true });
    cleanupSandbox(fixture);
  }
});

test('integrity checks never mutate caller graph, evidence, or fingerprint input', () => {
  const fixture = appendStoredEvidence();
  const graphBefore = clone(fixture.graph);
  const fingerprintsBefore = clone(fixture.currentFingerprints);

  try {
    const { input } = runIntegrityCheck({ fixture });
    assert.deepEqual(input.caseSnapshot, graphBefore.caseSnapshot);
    assert.deepEqual(input.run, graphBefore.run);
    assert.deepEqual(input.attempts, graphBefore.attempts);
    assert.deepEqual(input.readings, graphBefore.readings);
    assert.deepEqual(input.evidence, graphBefore.evidence);
    assert.deepEqual(input.currentFingerprints, fingerprintsBefore);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('hostile proxy input fails closed without escaping or reaching collaborators', () => {
  const fixture = appendStoredEvidence();
  const crossReferenceValidator = createCrossReferenceSpy();
  const checker = createChecker({
    evidenceStore: fixture.store,
    crossReferenceValidator
  });
  const hostileEvidence = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'length') throw new Error('hostile length trap');
      return Reflect.get(target, property, receiver);
    }
  });

  try {
    let result;
    assert.doesNotThrow(() => {
      result = checker.checkIntegrity({
        activeChangeId: fixture.graph.activeChangeId,
        caseSnapshot: fixture.graph.caseSnapshot,
        run: fixture.graph.run,
        attempts: fixture.graph.attempts,
        readings: fixture.graph.readings,
        evidence: hostileEvidence,
        currentFingerprints: fixture.currentFingerprints
      });
    });
    assertFactsOnly(result);
    assert.equal(result.ok, false);
    assertHasBlocker(result, 'verification-integrity:request-invalid');
    assert.equal(crossReferenceValidator.calls.length, 0);
  } finally {
    cleanupSandbox(fixture);
  }
});

test('hostile cross-reference result fails closed without escaping', () => {
  const fixture = appendStoredEvidence();
  const hostileResult = new Proxy({}, {
    get() {
      throw new Error('hostile validator result');
    }
  });
  const checker = createChecker({
    evidenceStore: fixture.store,
    crossReferenceValidator: {
      validateCrossReferences() {
        return hostileResult;
      }
    }
  });

  try {
    let result;
    assert.doesNotThrow(() => {
      result = checker.checkIntegrity({
        activeChangeId: fixture.graph.activeChangeId,
        caseSnapshot: fixture.graph.caseSnapshot,
        run: fixture.graph.run,
        attempts: fixture.graph.attempts,
        readings: fixture.graph.readings,
        evidence: fixture.graph.evidence,
        currentFingerprints: fixture.currentFingerprints
      });
    });
    assertFactsOnly(result);
    assert.equal(result.ok, false);
    assertHasBlocker(
      result,
      'verification-contract:cross-reference-check-failed'
    );
  } finally {
    cleanupSandbox(fixture);
  }
});

for (const inconsistentResult of [
  { ok: false, blockers: [] },
  {
    ok: true,
    blockers: [{
      id: 'verification-contract:cross-reference-invalid',
      related_entity_type: 'evidence',
      related_entity_id: 'untrusted-evidence'
    }]
  }
]) {
  test(`inconsistent cross-reference result ${JSON.stringify(
    inconsistentResult
  )} fails closed`, () => {
    const fixture = appendStoredEvidence();
    const crossReferenceValidator = createCrossReferenceSpy(
      inconsistentResult
    );

    try {
      const { result } = runIntegrityCheck({
        fixture,
        crossReferenceValidator
      });
      assertFactsOnly(result);
      assert.equal(result.ok, false);
      assertHasBlocker(
        result,
        'verification-contract:cross-reference-check-failed'
      );
      assert.equal(result.facts.evidence[0].binding_match, false);
      assert.equal(result.facts.evidence[0].integrity, 'broken');
    } finally {
      cleanupSandbox(fixture);
    }
  });
}
