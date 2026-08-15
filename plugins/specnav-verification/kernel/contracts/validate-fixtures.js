#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const metadata = require('../metadata');
const { doctorRuntime } = require('../runtime/doctor');
const { loadRuntimeLock } = require('../runtime/lock-manifest');
const {
  resolveSelectedRuntimeBase
} = require('../runtime/scope-resolver');
const { createSchemaRegistry } = require('./schema-registry');

function fixtureRoot(projectRoot) {
  return path.join(
    projectRoot,
    'tests/verification-v2/contracts/fixtures'
  );
}

function currentEnvironment() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: {
      name: metadata.name,
      version: metadata.version,
      apiVersion: metadata.apiVersion,
      contractVersion: metadata.contractVersion,
      contractDigest: metadata.contractDigest
    }
  };
}

function validateFixtures(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const root = path.resolve(options.fixtureRoot || fixtureRoot(projectRoot));
  const schemaRoot = path.join(
    projectRoot,
    'plugins/specnav-verification/schemas'
  );
  const lock = loadRuntimeLock();
  const runtimeSelection = resolveSelectedRuntimeBase({
    projectRoot,
    runtimeVersion: lock.runtime_version,
    runtimeBase: options.runtimeBase
  });
  const runtimeStatus = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: currentEnvironment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeSelection.runtime_base
  });
  if (!runtimeStatus.ok) {
    return {
      ok: false,
      blockers: runtimeStatus.blockers,
      runtime_status: runtimeStatus,
      positive: [],
      negative: []
    };
  }
  const registry = createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root,
    schemaRoot
  });
  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'manifest.json'),
    'utf8'
  ));
  const positive = manifest.positive.map((fixture) => ({
    ...fixture,
    result: registry.validateFile(
      fixture.entity_type,
      path.join(root, fixture.file)
    )
  }));
  const negative = manifest.negative.map((fixture) => ({
    ...fixture,
    result: registry.validateFile(
      fixture.entity_type,
      path.join(root, fixture.file)
    )
  }));
  const blockers = [];
  for (const fixture of positive) {
    if (!fixture.result.ok) {
      blockers.push(`positive-fixture-failed:${fixture.file}`);
    }
  }
  for (const fixture of negative) {
    if (fixture.result.ok) {
      blockers.push(`negative-fixture-passed:${fixture.file}`);
      continue;
    }
    if (!fixture.result.blockers.some((item) => (
      item.field === fixture.expected_field
    ))) {
      blockers.push(`negative-fixture-wrong-field:${fixture.file}`);
    }
  }
  return {
    ok: blockers.length === 0,
    blockers,
    runtime_version: runtimeStatus.runtime_version,
    positive: positive.map((fixture) => ({
      entity_type: fixture.entity_type,
      file: fixture.file,
      ok: fixture.result.ok
    })),
    negative: negative.map((fixture) => ({
      entity_type: fixture.entity_type,
      file: fixture.file,
      ok: !fixture.result.ok,
      expected_field: fixture.expected_field
    })),
    fallback_used: false
  };
}

function main() {
  const result = validateFixtures();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  currentEnvironment,
  fixtureRoot,
  validateFixtures
};
