#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const discoveryScript = require('./repository-discovery');

const FOUNDATION_SPEC_IDS = new Set([
  'ui-design',
  'system-architecture',
  'frontend-backend-data-flow',
  'component-architecture'
]);

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isCleanString(value) {
  return isNonEmptyString(value) && value === value.trim();
}

function itemId(item, fallback) {
  return isCleanString(item && item.id) ? item.id : fallback;
}

function readJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')), status: 'ok' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, value: null, status: 'missing' };
    if (error instanceof SyntaxError) return { ok: false, value: null, status: 'invalid-json' };
    return { ok: false, value: null, status: 'unreadable' };
  }
}

function realpath(file) {
  return (fs.realpathSync.native || fs.realpathSync)(file);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isCleanRelativePath(value) {
  if (!isCleanString(value)) return false;
  if (path.isAbsolute(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return true;
}

function validateConfidence(item, blockers, id) {
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
    blockers.push(`invalid-confidence:${id}`);
  }
}

function validateFoundationTarget(item, blockers, id) {
  if (!isPlainObject(item.foundation_target) || !isCleanString(item.foundation_target.spec)) {
    blockers.push(`invalid-foundation-target:${id}`);
    return;
  }
  if (!FOUNDATION_SPEC_IDS.has(item.foundation_target.spec)) {
    blockers.push(`unknown-foundation-spec:${id}:${item.foundation_target.spec}`);
  }
}

function validateEvidenceRefs(item, blockers, id, evidenceIds) {
  if (!Array.isArray(item.evidence_refs) || item.evidence_refs.length === 0) {
    blockers.push(`invalid-evidence-refs:${id}`);
    return;
  }
  for (const ref of item.evidence_refs) {
    if (!isCleanString(ref)) {
      blockers.push(`invalid-evidence-refs:${id}`);
      continue;
    }
    if (!evidenceIds.has(ref)) blockers.push(`missing-evidence-ref:${id}:${ref}`);
  }
}

function validateEvidence(projectRoot, evidence) {
  const blockers = [];
  const evidenceIds = new Set();

  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { blockers: ['invalid-evidence'], evidenceIds };
  }

  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const id = itemId(item, `evidence-${index + 1}`);
    if (!isPlainObject(item)) {
      blockers.push(`invalid-evidence-item:${id}`);
      continue;
    }
    if (!isCleanString(item.id)) blockers.push(`invalid-evidence-id:${id}`);
    if (evidenceIds.has(item.id)) blockers.push(`duplicate-evidence-id:${item.id}`);
    if (isCleanString(item.id)) evidenceIds.add(item.id);

    if (!isCleanRelativePath(item.path)) {
      blockers.push(`invalid-evidence-path:${id}`);
      continue;
    }

    const absolutePath = path.resolve(projectRoot, item.path);
    if (!isPathInside(projectRoot, absolutePath)) {
      blockers.push(`invalid-evidence-path:${id}`);
      continue;
    }

    try {
      if (!fs.existsSync(absolutePath)) {
        blockers.push(`missing-evidence-path:${id}`);
        continue;
      }
      if (!isPathInside(realpath(projectRoot), realpath(absolutePath))) {
        blockers.push(`evidence-path-escape:${id}`);
      }
    } catch {
      blockers.push(`unreadable-evidence-path:${id}`);
    }
  }

  return { blockers, evidenceIds };
}

function validateFindingArray(name, values, evidenceIds, options = {}) {
  const blockers = [];
  const requireConflictQuestion = options.requireConflictQuestion === true;
  const requireQuestion = options.requireQuestion === true;
  if (!Array.isArray(values)) return { blockers: [`invalid-${name}`] };

  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    const id = itemId(item, `${name}-${index + 1}`);
    if (!isPlainObject(item)) {
      blockers.push(`invalid-${name}-item:${id}`);
      continue;
    }
    validateConfidence(item, blockers, id);
    validateEvidenceRefs(item, blockers, id, evidenceIds);
    validateFoundationTarget(item, blockers, id);

    if (requireConflictQuestion && !isCleanString(item.question) && !isCleanString(item.open_item)) {
      blockers.push(`missing-conflict-question:${id}`);
    }
    if (requireQuestion && !isCleanString(item.question)) {
      blockers.push(`missing-question:${id}`);
    }
  }

  return { blockers };
}

function validateDiscoveryDocument(value, expectedProjectRoot) {
  const blockers = [];
  if (!isPlainObject(value)) {
    return { ok: false, projectRoot: expectedProjectRoot, blockers: ['invalid-discovery-shape'] };
  }

  if (value.schema !== discoveryScript.SCHEMA) blockers.push('invalid-schema');
  if (!isCleanString(value.project_root) || !path.isAbsolute(value.project_root)) {
    blockers.push('invalid-project-root');
  } else if (path.resolve(value.project_root) !== expectedProjectRoot) {
    blockers.push('project-root-mismatch');
  }

  const projectRoot = isCleanString(value.project_root) && path.isAbsolute(value.project_root)
    ? path.resolve(value.project_root)
    : expectedProjectRoot;

  const evidence = validateEvidence(projectRoot, value.evidence);
  blockers.push(...evidence.blockers);

  const findings = validateFindingArray('findings', value.findings, evidence.evidenceIds);
  blockers.push(...findings.blockers);

  const conflicts = Object.prototype.hasOwnProperty.call(value, 'conflicts')
    ? validateFindingArray('conflicts', value.conflicts, evidence.evidenceIds, { requireConflictQuestion: true })
    : { blockers: ['invalid-conflicts'] };
  blockers.push(...conflicts.blockers);

  const openItems = Object.prototype.hasOwnProperty.call(value, 'open_items')
    ? validateFindingArray('open-items', value.open_items, evidence.evidenceIds, { requireQuestion: true })
    : { blockers: ['invalid-open-items'] };
  blockers.push(...openItems.blockers);

  return {
    ok: blockers.length === 0,
    projectRoot,
    blockers: unique(blockers)
  };
}

function parseArgs(argv) {
  let file = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--file') {
      file = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
    }
  }
  return {
    json: argv.includes('--json'),
    file
  };
}

function validateRepositoryDiscovery(root = lib.projectRoot(), explicitFile = null) {
  const expectedProjectRoot = path.resolve(root);
  const file = explicitFile || path.join(expectedProjectRoot, discoveryScript.DISCOVERY_PATH);
  const parsed = readJsonFile(file);
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'missing'
      ? 'missing-discovery-file'
      : parsed.status === 'invalid-json'
        ? 'invalid-json'
        : 'unreadable-discovery-file');
    return {
      ok: false,
      project_root: expectedProjectRoot,
      file,
      blockers,
      discovery: null
    };
  }

  const validation = validateDiscoveryDocument(parsed.value, expectedProjectRoot);
  blockers.push(...validation.blockers);

  return {
    ok: blockers.length === 0,
    project_root: expectedProjectRoot,
    file,
    blockers: unique(blockers),
    discovery: isPlainObject(parsed.value) ? {
      schema: parsed.value.schema || null,
      evidence_count: Array.isArray(parsed.value.evidence) ? parsed.value.evidence.length : 0,
      findings_count: Array.isArray(parsed.value.findings) ? parsed.value.findings.length : 0,
      conflicts_count: Array.isArray(parsed.value.conflicts) ? parsed.value.conflicts.length : 0,
      open_items_count: Array.isArray(parsed.value.open_items) ? parsed.value.open_items.length : 0
    } : null
  };
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Repository Discovery Contract');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- file: \`${result.file}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  if (result.discovery) {
    lines.push(`- evidence: ${result.discovery.evidence_count}`);
    lines.push(`- findings: ${result.discovery.findings_count}`);
    lines.push(`- conflicts: ${result.discovery.conflicts_count}`);
    lines.push(`- open items: ${result.discovery.open_items_count}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validateRepositoryDiscovery(lib.projectRoot(), args.file);
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : markdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { validateRepositoryDiscovery, validateDiscoveryDocument, markdown };
