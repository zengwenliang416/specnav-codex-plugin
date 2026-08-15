#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  createCaseApprovalValidator,
  createCasePlanner,
  createCaseSnapshotWriter
} = require('../../../kernel/cases');
const {
  createSchemaRegistry
} = require('../../../kernel/contracts/schema-registry');
const { doctorRuntime } = require('../../../kernel/runtime/doctor');
const {
  resolveSelectedRuntimeBase
} = require('../../../kernel/runtime/scope-resolver');
const { loadRuntimeLock } = require('../../../kernel/runtime/lock-manifest');
const { currentEnvironment } = require('../../../scripts/verification-runtime');

function argValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : null;
  return value && !value.startsWith('--') ? value : null;
}

function readJson(file, blockerId) {
  if (!file) throw new Error(blockerId);
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new Error(`${blockerId}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(file, value) {
  if (!file) throw new Error('verification-cases:output-missing');
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  let descriptor = null;
  let created = false;
  try {
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    created = true;
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    if (created) fs.rmSync(resolved, { force: true });
    if (error && error.code === 'EEXIST') {
      throw new Error('verification-cases:output-exists');
    }
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readySchemaRegistry() {
  const lock = loadRuntimeLock();
  const runtimeSelection = resolveSelectedRuntimeBase({
    projectRoot: process.cwd(),
    runtimeVersion: lock.runtime_version
  });
  const runtimeStatus = doctorRuntime({
    requestedVersion: lock.runtime_version,
    environment: currentEnvironment(),
    providerEnvironment: {},
    requiresMidscene: false,
    runtimeBase: runtimeSelection.runtime_base
  });
  if (!runtimeStatus.ok) {
    const error = new Error('verification-cases:runtime-not-ready');
    error.blockers = [{
      id: 'verification-cases:runtime-not-ready',
      artifact: 'verification-runtime',
      field: '/'
    }, ...runtimeStatus.blockers];
    throw error;
  }
  return createSchemaRegistry({
    runtimeStatus,
    runtimeRoot: runtimeStatus.runtime_root
  });
}

function run(args = process.argv.slice(2)) {
  const action = args[0];
  if (!['snapshot', 'check'].includes(action)) {
    return {
      ok: false,
      execution_allowed: false,
      blockers: [{
        id: `verification-cases:unsupported-action:${action || '<missing>'}`,
        artifact: 'case-contract-cli',
        field: '/action'
      }]
    };
  }
  if (action === 'snapshot') {
    const request = readJson(
      argValue(args, '--input'),
      'verification-cases:snapshot-input-invalid'
    );
    const output = argValue(args, '--output');
    if (!output) throw new Error('verification-cases:output-missing');
    const schemaRegistry = readySchemaRegistry();
    const plan = createCasePlanner({ schemaRegistry }).plan(request);
    const result = createCaseSnapshotWriter({ schemaRegistry }).create({
      plan,
      createdAt: request.createdAt,
      createdBy: request.createdBy
    });
    if (result.ok) {
      writeJson(output, result.snapshot);
    }
    return result;
  }
  const snapshot = readJson(
    argValue(args, '--snapshot'),
    'verification-cases:snapshot-invalid'
  );
  const approval = readJson(
    argValue(args, '--approval'),
    'verification-cases:approval-invalid'
  );
  const currentRequirements = readJson(
    argValue(args, '--requirements'),
    'verification-cases:requirements-invalid'
  );
  const currentAcceptance = readJson(
    argValue(args, '--acceptance'),
    'verification-cases:acceptance-invalid'
  );
  const schemaRegistry = readySchemaRegistry();
  return createCaseApprovalValidator({ schemaRegistry }).evaluate({
    snapshot,
    approval,
    currentRequirements,
    currentAcceptance,
    expectedReviewerId: argValue(args, '--reviewer-id')
  });
}

function main() {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    const result = {
      ok: false,
      execution_allowed: false,
      blockers: Array.isArray(error.blockers)
        ? error.blockers
        : [{
            id: error instanceof Error ? error.message : String(error),
            artifact: 'case-contract-cli',
            field: '/'
          }]
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = {
  argValue,
  main,
  readJson,
  readySchemaRegistry,
  run,
  writeJson
};
