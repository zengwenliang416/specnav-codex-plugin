'use strict';

const {
  SNAPSHOT_SCHEMA
} = require('./compatibility-snapshot');

function blocker(id, artifact, detail = null) {
  return Object.freeze({ id, artifact, detail });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareSchemas(reference, candidate, blockers) {
  const names = [...new Set([
    ...Object.keys(reference.schemas),
    ...Object.keys(candidate.schemas)
  ])].sort();
  for (const name of names) {
    if (reference.schemas[name] !== candidate.schemas[name]) {
      blockers.push(blocker(
        `verification-drift:schema-mismatch:${candidate.host}:${name}`,
        name,
        {
          expected: reference.schemas[name] || null,
          actual: candidate.schemas[name] || null
        }
      ));
    }
  }
}

function compareCandidate(reference, candidate, blockers) {
  const artifact = `host:${candidate.host}`;
  if (
    candidate.schema !== SNAPSHOT_SCHEMA
    || reference.schema !== SNAPSHOT_SCHEMA
  ) {
    blockers.push(blocker(
      `verification-drift:snapshot-contract-mismatch:${candidate.host}`,
      artifact
    ));
    return;
  }
  for (const reason of candidate.manifest.blockers) {
    blockers.push(blocker(
      `verification-drift:${reason}:${candidate.host}`,
      artifact
    ));
  }
  const kernelIdentityMismatch = !sameValue(
    reference.kernel,
    candidate.kernel
  );
  if (kernelIdentityMismatch) {
    blockers.push(blocker(
      `verification-drift:kernel-identity-mismatch:${candidate.host}`,
      artifact,
      {
        expected: reference.kernel,
        actual: candidate.kernel
      }
    ));
  }
  compareSchemas(reference, candidate, blockers);
  const blockerRegistryMismatch = (
    reference.blocker_registry.digest
    !== candidate.blocker_registry.digest
  );
  if (blockerRegistryMismatch) {
    blockers.push(blocker(
      `verification-drift:blocker-registry-mismatch:${candidate.host}`,
      artifact,
      {
        expected: reference.blocker_registry.digest,
        actual: candidate.blocker_registry.digest
      }
    ));
  }
  const fixtureOutputMismatch = (
    reference.fixtures.digest !== candidate.fixtures.digest
  );
  if (fixtureOutputMismatch) {
    blockers.push(blocker(
      `verification-drift:fixture-output-mismatch:${candidate.host}`,
      artifact,
      {
        expected: reference.fixtures.digest,
        actual: candidate.fixtures.digest
      }
    ));
  }
  const reportModelMismatch = (
    reference.report_model.digest
    !== candidate.report_model.digest
  );
  if (reportModelMismatch) {
    blockers.push(blocker(
      `verification-drift:report-model-mismatch:${candidate.host}`,
      artifact,
      {
        expected: reference.report_model.digest,
        actual: candidate.report_model.digest
      }
    ));
  }
  const kernelSourceMismatch = (
    reference.kernel_source.digest
    !== candidate.kernel_source.digest
  );
  if (
    kernelSourceMismatch
    && !kernelIdentityMismatch
    && !blockerRegistryMismatch
    && !fixtureOutputMismatch
    && !reportModelMismatch
  ) {
    blockers.push(blocker(
      `verification-drift:kernel-source-mismatch:${candidate.host}`,
      artifact,
      {
        expected: reference.kernel_source.digest,
        actual: candidate.kernel_source.digest
      }
    ));
  }
  const architectureViolations = new Map();
  for (const violation of candidate.architecture.violations) {
    const rules = architectureViolations.get(violation.file) || [];
    rules.push(violation.rule);
    architectureViolations.set(violation.file, rules);
  }
  for (const [file, rules] of architectureViolations) {
    blockers.push(blocker(
      `verification-drift:architecture-boundary-violation:${candidate.host}:${file}`,
      file,
      rules.sort()
    ));
  }
}

function compareCompatibilitySnapshots(reference, candidates) {
  if (
    !reference
    || reference.schema !== SNAPSHOT_SCHEMA
    || !Array.isArray(candidates)
  ) {
    throw new Error('verification-drift:comparison-input-invalid');
  }
  const blockers = [];
  const sorted = [...candidates].sort((left, right) => (
    String(left?.host).localeCompare(String(right?.host))
  ));
  for (const candidate of sorted) {
    compareCandidate(reference, candidate, blockers);
  }
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    ok: blockers.length === 0,
    schema: 'specnav.verification.cross-host-drift-result.v1',
    reference_host: reference.host,
    hosts: Object.freeze(sorted.map((entry) => entry.host)),
    fallback_used: false,
    blockers: Object.freeze(blockers)
  });
}

module.exports = {
  compareCompatibilitySnapshots
};
