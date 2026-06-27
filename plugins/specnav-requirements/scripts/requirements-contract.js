#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const foundationSpecs = require('./foundation-specs');

const REQUIRED_ARTIFACTS = [
  'requirements.md',
  'acceptance.md',
  'spec-map.json',
  'component-impact-map.json'
];

const SPEC_MAP_FIELDS = [
  'touched_specs',
  'ui_rules',
  'architecture_modules',
  'api_contracts',
  'database_entities',
  'permissions',
  'operational_constraints',
  'data_flows'
];

const COMPONENT_IMPACT_MAP_FIELDS = [
  'new_components',
  'reused_components',
  'extraction_triggers',
  'forbidden_dependencies',
  'hooks',
  'utilities',
  'services',
  'required_component_tests'
];

const FOUNDATION_SPEC_IDS = new Set([
  'ui-design',
  'system-architecture',
  'frontend-backend-data-flow',
  'component-architecture'
]);

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function artifactPath(change, name) {
  return change ? path.join('openspec', 'changes', change, name) : path.join('openspec', 'changes', '<active-change>', name);
}

function readJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, status: 'missing', value: null };
    if (error instanceof SyntaxError) return { ok: false, status: 'invalid-json', value: null };
    return { ok: false, status: 'unreadable', value: null };
  }
}

function readTextFile(file) {
  try {
    return { ok: true, value: fs.readFileSync(file, 'utf8') };
  } catch (_error) {
    return { ok: false, status: 'unreadable', value: null };
  }
}

function strictActiveChange(projectRoot) {
  return lib.activeChange(projectRoot);
}

function changeDirExists(dir) {
  if (!dir) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_error) {
    return false;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasInvalidArrayMembers(values) {
  return values.some((item) => typeof item !== 'string' || item.length === 0 || item !== item.trim());
}

function validateArrayFieldContract(value, fields, blocker) {
  let hasNonEmptyArray = false;
  let invalidField = false;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      invalidField = true;
      continue;
    }
    if (!Array.isArray(value[field])) {
      invalidField = true;
      continue;
    }
    if (hasInvalidArrayMembers(value[field])) invalidField = true;
    if (value[field].length > 0) hasNonEmptyArray = true;
  }

  return invalidField || !hasNonEmptyArray ? [blocker] : [];
}

function validateSpecMapContract(value) {
  const blocker = 'invalid-spec-map-contract:spec-map.json';
  let invalidField = false;

  for (const field of SPEC_MAP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      invalidField = true;
      continue;
    }
    if (!Array.isArray(value[field])) {
      invalidField = true;
      continue;
    }
    if (hasInvalidArrayMembers(value[field])) invalidField = true;
  }

  const touchedSpecs = value.touched_specs;
  const hasTouchedSpecs = Array.isArray(touchedSpecs) && touchedSpecs.length > 0;
  const hasUnknownTouchedSpecs = Array.isArray(touchedSpecs) && touchedSpecs.some((id) => typeof id !== 'string' || !FOUNDATION_SPEC_IDS.has(id));

  return invalidField || !hasTouchedSpecs || hasUnknownTouchedSpecs ? [blocker] : [];
}

function validateUnresolvedGapsContract(name, value) {
  if (!Object.prototype.hasOwnProperty.call(value, 'unresolved_gaps') || !Array.isArray(value.unresolved_gaps)) {
    return [`invalid-unresolved-gaps:${name}`];
  }
  if (value.unresolved_gaps.length > 0) {
    return [`unresolved-gaps:${name}`];
  }
  return [];
}

function validateJsonArtifactContract(name, value) {
  const blockers = [];
  if (name === 'spec-map.json') {
    blockers.push(...validateSpecMapContract(value));
    blockers.push(...validateUnresolvedGapsContract(name, value));
    return blockers;
  }
  if (name === 'component-impact-map.json') {
    blockers.push(...validateArrayFieldContract(value, COMPONENT_IMPACT_MAP_FIELDS, 'invalid-component-impact-map-contract:component-impact-map.json'));
    blockers.push(...validateUnresolvedGapsContract(name, value));
    return blockers;
  }
  return blockers;
}

function validateArtifact(dir, change, name) {
  const relativePath = artifactPath(change, name);
  const file = dir ? path.join(dir, name) : null;
  const blockers = [];

  if (!file || !fs.existsSync(file)) {
    blockers.push(`missing-requirements-artifact:${name}`);
    return {
      name,
      path: relativePath,
      ok: false,
      blockers
    };
  }

  if (!name.endsWith('.json')) {
    const text = readTextFile(file);
    if (!text.ok) {
      blockers.push(`unreadable-requirements-artifact:${name}`);
    } else if (text.value.trim().length === 0) {
      blockers.push(`empty-requirements-artifact:${name}`);
    }
    return {
      name,
      path: relativePath,
      ok: blockers.length === 0,
      blockers
    };
  }

  const parsed = readJsonFile(file);
  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `unreadable-requirements-artifact:${name}`);
  } else if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
  } else {
    blockers.push(...validateJsonArtifactContract(name, parsed.value));
  }

  return {
    name,
    path: relativePath,
    ok: blockers.length === 0,
    blockers
  };
}

function validateRequirements(root = lib.projectRoot()) {
  const projectRoot = path.resolve(root);
  const foundation = foundationSpecs.validateFoundationSpecs(projectRoot);
  const change = strictActiveChange(projectRoot);
  const dir = change ? lib.changeDir(projectRoot, change) : null;
  const activeChangeOk = changeDirExists(dir);
  const blockers = [];

  if (!foundation.ok) blockers.push(...foundation.blockers);
  if (!activeChangeOk) blockers.push('active-change');

  const artifacts = activeChangeOk ? REQUIRED_ARTIFACTS.map((name) => validateArtifact(dir, change, name)) : [];
  blockers.push(...artifacts.flatMap((artifact) => artifact.blockers));

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    active_change: activeChangeOk ? change : null,
    blockers: unique(blockers),
    foundation,
    artifacts
  };
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Requirements Contract');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- active change: \`${result.active_change || 'none'}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  lines.push('');
  lines.push('| Artifact | Status | Blockers |');
  lines.push('| --- | --- | --- |');
  for (const artifact of result.artifacts) {
    lines.push(`| ${artifact.name} | ${artifact.ok ? 'pass' : 'blocked'} | ${artifact.blockers.join('<br>') || '-'} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const result = validateRequirements();
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : markdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { validateRequirements };
