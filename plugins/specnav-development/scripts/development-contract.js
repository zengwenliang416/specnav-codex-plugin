#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('./plugin-runtime');
const lib = runtime.requirePluginScript('specnav-core', 'scripts/specnav-lib');
const { validatePrototype } = runtime.requirePluginScript('specnav-prototype', 'scripts/prototype-contract');
const { guard: validateCodeGraph } = runtime.requirePluginScript('specnav-codegraph', 'scripts/codegraph-contract');
const {
  resolveManagedValidationReceiptAuthority
} = require('./development-receipt-authority');
const { isValidTaskId } = require('./task-id');

const CHANGE_ARTIFACTS = ['scope.json', 'tasks.md'];

const DEVELOPMENT_ENTRY_ARTIFACTS = [
  'before-dev-check.json',
  'basis.md',
  'prototype-promotion-map.json',
  'complexity-budget.json',
  'task-graph.json',
  'task-context.jsonl',
  'code-owner-map.json',
  'extraction-map.json'
];

const DEVELOPMENT_HANDOFF_ARTIFACTS = [
  ...DEVELOPMENT_ENTRY_ARTIFACTS,
  'migrations/manifest.json',
  'migrations/README.md',
  'task-ledger.jsonl',
  'drift-check.jsonl',
  'validation-log.jsonl',
  'handoff-to-verify.md'
];

const VALID_MODES = new Set(['entry', 'handoff']);
const DEFAULT_MODE = 'handoff';

const OPERATION_FIELDS = ['create', 'modify', 'delete', 'rename'];

const FOUNDATION_SPEC_PATHS = [
  'openspec/specs/ui-design/design.md',
  'openspec/specs/system-architecture/design.md',
  'openspec/specs/frontend-backend-data-flow/design.md',
  'openspec/specs/component-architecture/design.md'
];

const CHANGE_REQUIREMENT_ARTIFACTS = [
  'requirements.md',
  'acceptance.md',
  'spec-map.json',
  'component-impact-map.json'
];

const PROTOTYPE_DECISION_ARTIFACTS = [
  'prototype/handoff.md',
  'prototype/decision.json'
];

const HANDOFF_REPORT_STATUSES = new Set(['DONE', 'DONE_WITH_CONCERNS']);
const HANDOFF_REVIEW_VERDICTS = new Set(['approved']);
const SCAFFOLD_SENTINELS = [
  ['decision-required', /<decision-required>/i],
  ['replace-scaffold', /\breplace\s+(?:this\s+)?scaffold\b/i],
  ['development-entry-scaffold', /\bdevelopment-entry-scaffold\b/i],
  ['vertical-slice-scaffold', /\bvertical-slice-scaffold\b/i],
  ['pending-vertical-slices', /\bpending-vertical-slices\b/i],
  ['specnav-template-token', /\{\{SPECNAV_[A-Z0-9_]+\}\}/]
];

const BRIEF_HEADINGS = [
  'Goal',
  'Parent Artifacts',
  'Vertical Slice',
  'In Scope',
  'Out Of Scope',
  'Files Allowed',
  'Interfaces / Seams',
  'Components To Create',
  'Components To Reuse',
  'Components To Extract',
  'API / Data Flow Contracts',
  'State / Error / Empty / Loading Behavior',
  'TDD Requirement',
  'Verification Commands',
  'Stop Conditions',
  'Unsafe Assumptions'
];
const BRIEF_CORE_HEADINGS = [
  'Goal',
  'Vertical Slice',
  'In Scope',
  'Files Allowed',
  'Verification Commands',
  'Stop Conditions'
];
const SQL_INTENT_PATTERN = /\b(?:ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|INSERT\s+INTO|UPDATE\s+[a-z0-9_."`]+?\s+SET|DELETE\s+FROM|sys_menu|sys_role_menu|seed\s+sql|(?:add|apply|create|execute|generate|implement|include|provide|requires?|run|write)\s+(?:a\s+|an\s+|the\s+)?(?:database|schema|sql)\s+migrations?|(?:database|schema|sql)\s+migrations?\s+(?:(?:is|are)\s+required|files?)|migrations?\s+(?:sql|ddl|dml|scripts?)|ddl|dml)\b/i;
const SQL_FILE_PATTERN = /\.sql$/i;
const SQL_KIND_PATTERN = /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i;

const HANDOFF_HEADINGS = [
  'Implemented Slices',
  'Files Changed',
  'Requirements Covered',
  'Prototype Decisions Implemented',
  'Components Created / Reused / Extracted',
  'API / Data Flow Changes',
  'Tests Added',
  'Local Validation',
  'Known Risks',
  'Items Requiring Six-Domain Verification'
];

const REPORT_REQUIRED_HEADINGS = [
  'Status',
  'Files Changed',
  'What Changed',
  'TDD Evidence',
  'Verification Commands',
  'Concerns',
  'Scope Deviations',
  'Follow-up Needed'
];

const SPEC_REVIEW_REQUIRED_HEADINGS = [
  'Verdict',
  'Missing Requirements',
  'Extra Behavior',
  'Misunderstood Requirements',
  'Cannot Verify From Diff',
  'Required Fixes'
];

const QUALITY_REVIEW_REQUIRED_HEADINGS = [
  'Verdict',
  'Separation Of Concerns',
  'Component Cohesion / Coupling',
  'Test Quality',
  'Error Handling',
  'Reuse / Duplication',
  'Complexity Delta',
  'Required Fixes'
];

const TASK_ENTRY_FILES = ['brief.md', 'context.json'];
const TASK_HANDOFF_FILES = [...TASK_ENTRY_FILES, 'acceptance.json', 'report.md', 'spec-review.md', 'quality-review.md'];
const TASK_CONTEXT_ARRAYS = [
  'task_items',
  'must_read',
  'allowed_files',
  'non_goals',
  'expected_evidence',
  'unsafe_assumptions'
];
const NON_EMPTY_TASK_CONTEXT_ARRAYS = new Set([
  'task_items',
  'must_read',
  'allowed_files',
  'non_goals',
  'expected_evidence'
]);
const PATH_TASK_CONTEXT_ARRAYS = new Set(['must_read', 'allowed_files']);
const TASK_ITEM_ID_PATTERN = /^[0-9]+(?:\.[0-9]+)+$/;
const REPAIR_TASK_SCHEMA = 'specnav.development.repair-task.v1';
const REPAIR_CLASSIFICATIONS = new Set(['product_defect', 'test_defect']);
const REPAIR_OWNERSHIP = Object.freeze({
  evidence: 'verification',
  closure: 'verification',
  repair: 'development',
  reviews: 'development',
  transitions: 'core',
  break_loop: 'core'
});
const REPAIR_PACKET_ARTIFACTS = new Set([
  'brief.md',
  'context.json',
  'report.md',
  'spec-review.md',
  'quality-review.md'
]);

const LAYER_ONLY_TASKS = new Set([
  'build database',
  'build the database',
  'database',
  'database layer',
  'build api',
  'build the api',
  'api',
  'api layer',
  'build ui',
  'build the ui',
  'ui',
  'ui layer'
]);

const USER_ACTOR_PATTERN = /\b(?:user|users|customer|customers|admin|administrator|administrators|operator|operators|visitor|visitors|employee|employees|hr|director|directors)\b/i;
const USER_ACTION_PATTERN = /\b(?:can|view|views|see|sees|submit|submits|create|creates|update|updates|edit|edits|delete|deletes|open|opens|select|selects|search|searches|filter|filters|download|downloads|upload|uploads|receive|receives|complete|completes|checkout|login|log in|sign in|shows|display|displays|render|renders)\b/i;
const CHINESE_USER_VISIBLE_PATTERN = /(?:用户|客户|管理员|操作员|访客|员工|人力资源|董事).*(?:可以|能够|查看|看到|提交|创建|更新|编辑|删除|打开|选择|搜索|筛选|下载|上传|接收|完成|登录|显示)/i;
const USER_OUTCOME_LABEL_PATTERN = /(?:\buser\s+outcome\b|用户(?:结果|目标|成果|可见结果))\s*[:：]/i;
const TASK_NUMBER_PATTERN = /^([0-9]+(?:\.[0-9]+)+)\b/;

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function codegraphStageGuard(projectRoot, change, stage) {
  if (!change) return null;
  return validateCodeGraph({
    projectRoot,
    change,
    stage,
    requireEvidence: true,
    writeArtifacts: true
  });
}

function codegraphBlockers(result) {
  return result && Array.isArray(result.blockers) ? result.blockers : [];
}

function codegraphWarnings(result) {
  return result && Array.isArray(result.warnings) ? result.warnings : [];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function isCleanRelativePath(value) {
  if (!isCleanString(value)) return false;
  if (path.isAbsolute(value) || value.includes('\\') || value.includes('..')) return false;

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.')) return false;

  return true;
}

function hasInvalidStringArrayMembers(values, pathLike = false) {
  return values.some((item) => (pathLike ? !isCleanRelativePath(item) : !isCleanString(item)));
}

function scaffoldBlockersForText(value, name) {
  const text = String(value || '');
  return SCAFFOLD_SENTINELS
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => `scaffold-placeholder:${name}:${label}`);
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

function readTextFile(file) {
  try {
    return { ok: true, value: fs.readFileSync(file, 'utf8'), status: 'ok' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, value: null, status: 'missing' };
    return { ok: false, value: null, status: 'unreadable' };
  }
}

function statKind(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch {
    return null;
  }
}

function artifactPath(change, name, inDevelopment = false) {
  return path.join('openspec', 'changes', change, ...(inDevelopment ? ['development'] : []), name);
}

function artifactResult(change, name, blockers, inDevelopment = false, extra = {}) {
  return {
    name,
    path: artifactPath(change, name, inDevelopment),
    ok: blockers.length === 0,
    blockers,
    ...extra
  };
}

function realpathSync(file) {
  return (fs.realpathSync.native || fs.realpathSync)(file);
}

function isRealpathContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function stripListMarker(line) {
  return String(line)
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

function normalizeContractText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_()[\]{}:;,.!?/\\|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkdownHeadings(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, length };
      } else if (marker === fence.marker && length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    headings.push({
      index,
      level: heading[1].length,
      label: heading[2].trim(),
      normalized: normalizeContractText(heading[2])
    });
  }

  return { lines, headings };
}

function findHeading(parsed, label) {
  const normalized = normalizeContractText(label);
  return parsed.headings.find((heading) => heading.normalized === normalized) || null;
}

function findAnyHeading(parsed, labels) {
  for (const label of labels) {
    const heading = findHeading(parsed, label);
    if (heading) return heading;
  }
  return null;
}

function headingBodyLines(parsed, heading) {
  let end = parsed.lines.length;
  for (const next of parsed.headings) {
    if (next.index <= heading.index) continue;
    if (next.level <= heading.level) {
      end = next.index;
      break;
    }
  }
  return parsed.lines.slice(heading.index + 1, end);
}

function isPlaceholder(value) {
  const cleaned = stripListMarker(value)
    .toLowerCase()
    .replace(/^[`*_()[\]{}:;,.!?\\|]+|[`*_()[\]{}:;,.!?\\|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^-+$/.test(cleaned)) return true;
  return new Set(['n/a', 'na', 'none', 'not applicable']).has(cleaned);
}

function isSubstantiveLine(line) {
  const value = stripListMarker(line);
  return value !== ''
    && !/^#{1,6}\s+/.test(value)
    && !/^(?:TODO|TBD|unresolved|gap)(?:\s*[:：-].*|)$/i.test(value)
    && !isPlaceholder(value);
}

function hasSubstantiveBody(parsed, heading) {
  return headingBodyLines(parsed, heading).some((line) => isSubstantiveLine(line));
}

function firstSubstantiveValue(parsed, heading) {
  const line = headingBodyLines(parsed, heading).find((item) => isSubstantiveLine(item));
  return line ? stripListMarker(line).replace(/^`+|`+$/g, '').trim() : null;
}

function validateRequiredHeadings(text, headings, blockerPrefix) {
  const parsed = parseMarkdownHeadings(text);
  const blockers = [];

  for (const heading of headings) {
    const match = findHeading(parsed, heading);
    if (!match) {
      blockers.push(`${blockerPrefix}:missing-heading:${heading}`);
      continue;
    }
    if (!hasSubstantiveBody(parsed, match)) blockers.push(`${blockerPrefix}:empty-heading:${heading}`);
  }

  return blockers;
}

function validateOptionalHeadings(text, headings, blockerPrefix) {
  const parsed = parseMarkdownHeadings(text);
  const blockers = [];

  for (const heading of headings) {
    const match = findHeading(parsed, heading);
    if (match && !hasSubstantiveBody(parsed, match)) blockers.push(`${blockerPrefix}:empty-heading:${heading}`);
  }

  return blockers;
}

function requiredSourcePaths(activeChange, approvedSourcePath = null) {
  return [
    ...FOUNDATION_SPEC_PATHS,
    ...CHANGE_REQUIREMENT_ARTIFACTS.map((name) => artifactPath(activeChange, name)),
    ...PROTOTYPE_DECISION_ARTIFACTS.map((name) => artifactPath(activeChange, name)),
    approvedSourcePath
  ].filter(Boolean);
}

function pathReferencesText(text, relativePath) {
  return String(text || '').includes(relativePath);
}

function validateUpstreamContracts(projectRoot, activeChange, prototype, lane = 'standard') {
  const name = 'upstream-contracts';
  const blockers = [];
  const requirements = prototype && prototype.requirements;
  const foundation = requirements && requirements.foundation;
  const foundationRequired = lane !== 'light';

  if (!requirements || requirements.ok !== true) {
    blockers.push('upstream-requirements:not-ok');
  } else {
    if (!requirements.project_root || path.resolve(requirements.project_root) !== projectRoot) {
      blockers.push('upstream-requirements:project-root');
    }
    if (requirements.active_change !== activeChange) {
      blockers.push('upstream-requirements:active_change');
    }

    for (const artifactName of CHANGE_REQUIREMENT_ARTIFACTS) {
      const expectedPath = artifactPath(activeChange, artifactName);
      const artifact = Array.isArray(requirements.artifacts)
        ? requirements.artifacts.find((item) => item && item.path === expectedPath)
        : null;
      if (!artifact || artifact.ok !== true) {
        blockers.push(`upstream-requirements:missing-artifact:${expectedPath}`);
      }
    }
  }

  if (foundationRequired && (!foundation || foundation.ok !== true)) {
    blockers.push('upstream-foundation:not-ok');
  } else if (foundationRequired) {
    if (!foundation.project_root || path.resolve(foundation.project_root) !== projectRoot) {
      blockers.push('upstream-foundation:project-root');
    }
    for (const specPath of FOUNDATION_SPEC_PATHS) {
      const spec = Array.isArray(foundation.specs)
        ? foundation.specs.find((item) => item && item.path === specPath)
        : null;
      if (!spec || spec.ok !== true) {
        blockers.push(`upstream-foundation:missing-spec:${specPath}`);
      }
    }
  }

  return artifactResult(activeChange, name, unique(blockers), false);
}

function validatePrototypeApprovalBinding(projectRoot, activeChange) {
  const name = 'prototype-approval-binding';
  const changeDir = lib.changeDir(projectRoot, activeChange);
  const prototypeDir = path.join(changeDir, 'prototype');
  const blockers = [];
  let manifest = null;
  let decision = null;
  let approvedSourcePath = null;
  let approvedVariant = null;
  let prototypeType = null;

  const manifestParsed = readJsonFile(path.join(prototypeDir, 'prototype-manifest.json'));
  if (!manifestParsed.ok) {
    blockers.push(manifestParsed.status === 'invalid-json' ? 'invalid-json:prototype-manifest.json' : 'missing-prototype-artifact:prototype-manifest.json');
  } else if (!isPlainObject(manifestParsed.value)) {
    blockers.push('invalid-json-shape:prototype-manifest.json');
  } else {
    manifest = manifestParsed.value;
    prototypeType = manifest.type || null;
    if (!isCleanRelativePath(manifest.entry)) {
      blockers.push('invalid-prototype-manifest:entry');
    } else {
      approvedSourcePath = `openspec/changes/${activeChange}/prototype/${manifest.entry}`;
      const prototypeRoot = path.resolve(projectRoot, 'openspec', 'changes', activeChange, 'prototype');
      const candidate = path.resolve(projectRoot, approvedSourcePath);
      const relative = path.relative(prototypeRoot, candidate);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        blockers.push(`prototype-source-escape:${approvedSourcePath}`);
      } else if (!fs.existsSync(candidate)) {
        blockers.push(`missing-approved-prototype-source:${approvedSourcePath}`);
      } else {
        try {
          const prototypeRealpath = realpathSync(prototypeRoot);
          const candidateRealpath = realpathSync(candidate);
          if (!isRealpathContained(prototypeRealpath, candidateRealpath)) {
            blockers.push(`prototype-source-escape:${approvedSourcePath}`);
          }
        } catch {
          blockers.push(`unreadable-approved-prototype-source:${approvedSourcePath}`);
        }
      }
    }
  }

  const decisionParsed = readJsonFile(path.join(prototypeDir, 'decision.json'));
  if (!decisionParsed.ok) {
    blockers.push(decisionParsed.status === 'invalid-json' ? 'invalid-json:decision.json' : 'missing-prototype-artifact:decision.json');
  } else if (!isPlainObject(decisionParsed.value)) {
    blockers.push('invalid-json-shape:decision.json');
  } else {
    decision = decisionParsed.value;
    if (decision.status !== 'approved') blockers.push('invalid-prototype-decision:status');
    if (!isCleanString(decision.approved_variant)) {
      blockers.push('invalid-prototype-decision:approved_variant');
    } else {
      approvedVariant = decision.approved_variant;
    }
  }

  if (prototypeType === 'ui-html' && approvedSourcePath && approvedVariant) {
    const entry = readTextFile(path.resolve(projectRoot, approvedSourcePath));
    if (!entry.ok) {
      blockers.push(`unreadable-approved-prototype-source:${approvedSourcePath}`);
    } else {
      const variantPattern = new RegExp(`data-specnav-variant\\s*=\\s*(["'])${escapeRegExp(approvedVariant)}\\1`);
      if (!variantPattern.test(entry.value)) {
        blockers.push(`approved-prototype-entry:missing-variant:${approvedVariant}`);
      }
    }
  }

  return {
    artifact: artifactResult(activeChange, name, unique(blockers), false, {
      approved_source: approvedSourcePath,
      approved_variant: approvedVariant,
      prototype_type: prototypeType
    }),
    approved_source_path: approvedSourcePath,
    approved_sources: approvedSourcePath ? [approvedSourcePath] : [],
    approved_variant: approvedVariant,
    blockers: unique(blockers)
  };
}

function validateScope(projectRoot, changeDir, activeChange, approvalBinding = null) {
  const name = 'scope.json';
  const parsed = readJsonFile(path.join(changeDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers);
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers);
  }

  const scope = parsed.value;
  if (scope.schema_version !== 1) blockers.push('invalid-scope-contract:schema_version');
  if (scope.change_id !== activeChange) blockers.push('invalid-scope-contract:change_id');
  if (scope.stage !== 'development') blockers.push('invalid-scope-contract:stage');
  if (scope.expires_when !== 'verification_started') blockers.push('invalid-scope-contract:expires_when');

  for (const field of ['allowed_roots', 'prototype_sources']) {
    if (!Array.isArray(scope[field]) || scope[field].length === 0) {
      blockers.push(`invalid-scope-contract:${field}`);
    } else if (hasInvalidStringArrayMembers(scope[field], true)) {
      blockers.push(`invalid-scope-path:${field}`);
    }
  }

  for (const field of ['denied_roots', 'requires_review_on']) {
    if (!Array.isArray(scope[field])) {
      blockers.push(`invalid-scope-contract:${field}`);
    } else if (hasInvalidStringArrayMembers(scope[field], true)) {
      blockers.push(`invalid-scope-path:${field}`);
    }
  }

  if (!isPlainObject(scope.allowed_operations)) {
    blockers.push('invalid-scope-contract:allowed_operations');
  } else {
    for (const field of OPERATION_FIELDS) {
      if (typeof scope.allowed_operations[field] !== 'boolean') {
        blockers.push(`invalid-scope-contract:allowed_operations.${field}`);
      }
    }
  }

  if (Array.isArray(scope.prototype_sources)) {
    const prefix = `openspec/changes/${activeChange}/prototype/`;
    const prototypeRoot = path.resolve(projectRoot, prefix);
    const approvedSources = new Set(approvalBinding && Array.isArray(approvalBinding.approved_sources)
      ? approvalBinding.approved_sources
      : []);
    let prototypeRealpath = null;
    try {
      prototypeRealpath = realpathSync(prototypeRoot);
    } catch {
      blockers.push('unreadable-prototype-source-root');
    }

    if (approvalBinding && approvalBinding.approved_source_path && !scope.prototype_sources.includes(approvalBinding.approved_source_path)) {
      blockers.push(`missing-approved-prototype-source:${approvalBinding.approved_source_path}`);
    }

    for (const source of scope.prototype_sources) {
      if (!isCleanRelativePath(source) || !source.startsWith(prefix) || source === prefix) {
        blockers.push(`invalid-prototype-source:${source || '<empty>'}`);
        continue;
      }

      if (approvedSources.size > 0 && !approvedSources.has(source)) {
        blockers.push(`unapproved-prototype-source:${source}`);
      }

      const candidate = path.resolve(projectRoot, source);
      const relative = path.relative(prototypeRoot, candidate);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        blockers.push(`invalid-prototype-source:${source}`);
        continue;
      }
      if (!fs.existsSync(candidate)) {
        blockers.push(`missing-prototype-source:${source}`);
        continue;
      }
      if (prototypeRealpath) {
        try {
          const candidateRealpath = realpathSync(candidate);
          if (!isRealpathContained(prototypeRealpath, candidateRealpath)) {
            blockers.push(`prototype-source-escape:${source}`);
          }
        } catch {
          blockers.push(`unreadable-prototype-source:${source}`);
        }
      }
    }
  }

  return artifactResult(activeChange, name, unique(blockers), false, {
    allowed_roots: Array.isArray(scope.allowed_roots) ? scope.allowed_roots.length : 0,
    prototype_sources: Array.isArray(scope.prototype_sources) ? scope.prototype_sources.length : 0
  });
}

function normalizeTaskBullet(value) {
  return normalizeContractText(value).replace(/\bthe\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTaskItems(text) {
  return text
    .split(/\r?\n/)
    .map((line, lineIndex) => {
      const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/);
      if (!match) return null;
      const taskText = stripListMarker(match[2]);
      if (!taskText) return null;
      const taskNumber = taskText.match(TASK_NUMBER_PATTERN);
      return {
        checked: match[1] ? match[1].toLowerCase() === 'x' : null,
        text: taskText,
        task_id: taskNumber ? taskNumber[1] : null,
        line: lineIndex + 1
      };
    })
    .filter(Boolean);
}

function isUserVisibleTask(value) {
  return (USER_ACTOR_PATTERN.test(value) && USER_ACTION_PATTERN.test(value))
    || CHINESE_USER_VISIBLE_PATTERN.test(value);
}

function taskSections(text, taskItems) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = { heading: 'Development Tasks', start: 0, lines: [] };

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current.lines.length > 0 || sections.length > 0) sections.push(current);
      current = { heading: heading[1], start: index + 1, lines: [] };
      continue;
    }
    current.lines.push(lines[index]);
  }
  sections.push(current);

  return sections
    .map((section) => {
      const end = section.start + section.lines.length;
      const items = taskItems.filter((item) => item.line > section.start && item.line <= end);
      const body = section.lines.join('\n');
      return {
        ...section,
        items,
        has_user_outcome: USER_OUTCOME_LABEL_PATTERN.test(body)
          || items.some((item) => isUserVisibleTask(item.text))
      };
    })
    .filter((section) => section.items.length > 0);
}

function validateTasksMarkdown(changeDir, activeChange, mode = DEFAULT_MODE) {
  const name = 'tasks.md';
  const file = path.join(changeDir, name);
  const text = readTextFile(file);
  const blockers = [];

  if (!text.ok) {
    blockers.push(`missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers);
  }
  if (text.value.trim() === '') blockers.push(`empty-development-artifact:${name}`);

  const taskItems = parseTaskItems(text.value);
  const bullets = taskItems.map((item) => item.text);
  const checkboxItems = taskItems.filter((item) => item.checked !== null);
  const completedItems = checkboxItems.filter((item) => item.checked);
  const incompleteItems = checkboxItems.filter((item) => !item.checked);

  if (bullets.length === 0) blockers.push('tasks-md:no-bullets');
  if (bullets.length > 0 && checkboxItems.length === 0) blockers.push('tasks-md:no-checkboxes');
  if (checkboxItems.length > 0 && checkboxItems.length !== bullets.length) blockers.push('tasks-md:mixed-checkboxes');
  if (mode === 'handoff') {
    if (incompleteItems.length > 0) blockers.push('tasks-md:incomplete-checkboxes');
    if (checkboxItems.length > 0 && completedItems.length === 0) blockers.push('tasks-md:no-completed-checkboxes');
  }

  for (const bullet of bullets) {
    const normalized = normalizeTaskBullet(bullet);
    if (LAYER_ONLY_TASKS.has(normalized)) {
      blockers.push(`tasks-md:layer-only:${normalized}`);
    }
  }

  const sections = taskSections(text.value, taskItems);
  for (const section of sections) {
    if (!section.has_user_outcome) {
      blockers.push(`tasks-md:section-missing-user-outcome:${normalizeTaskBullet(section.heading)}`);
    }
  }
  if (sections.length === 0 || sections.every((section) => !section.has_user_outcome)) {
    blockers.push('tasks-md:no-vertical-slice');
  }

  return artifactResult(activeChange, name, unique(blockers), false, {
    bullet_count: bullets.length,
    checkbox_count: checkboxItems.length,
    completed_count: completedItems.length,
    incomplete_count: incompleteItems.length,
    section_count: sections.length
  });
}

function readTaskChangeApproval(developmentDir) {
  const name = 'task-change-approval.json';
  const file = path.join(developmentDir, name);
  if (!fs.existsSync(file)) {
    return { present: false, ok: true, name, approved_task_ids: new Set(), blockers: [] };
  }

  const parsed = readJsonFile(file);
  const blockers = [];
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `invalid-json-shape:${name}`);
    return { present: true, ok: false, name, approved_task_ids: new Set(), blockers };
  }

  const value = parsed.value;
  if (value.schema_version !== 1) blockers.push('invalid-task-change-approval:schema_version');
  if (value.approved_by !== 'user') blockers.push('invalid-task-change-approval:approved_by');
  if (!isCleanString(value.approved_at) || Number.isNaN(Date.parse(value.approved_at))) {
    blockers.push('invalid-task-change-approval:approved_at');
  }
  if (!isCleanString(value.reason)) blockers.push('invalid-task-change-approval:reason');
  if (!Array.isArray(value.removed_task_ids) || value.removed_task_ids.length === 0) {
    blockers.push('invalid-task-change-approval:removed_task_ids');
  } else if (hasInvalidStringArrayMembers(value.removed_task_ids, false)) {
    blockers.push('invalid-task-change-approval:removed_task_ids');
  }

  return {
    present: true,
    ok: blockers.length === 0,
    name,
    approved_task_ids: new Set(Array.isArray(value.removed_task_ids) ? value.removed_task_ids : []),
    blockers: unique(blockers)
  };
}

function validateGitBaseline(projectRoot, changeDir, developmentDir, activeChange) {
  const name = 'git-baseline';
  const blockers = [];
  const head = lib.runCommand('git rev-parse --verify HEAD', { cwd: projectRoot });
  if (!head.ok) {
    blockers.push('git-baseline:missing-head');
    return artifactResult(activeChange, name, blockers, false, {
      baseline_task_count: 0,
      current_task_count: 0
    });
  }

  const tasksFile = path.join(changeDir, 'tasks.md');
  const relativeTasksFile = path.relative(projectRoot, tasksFile).split(path.sep).join('/');
  const baseline = lib.runCommand(`git show ${lib.shellQuote(`HEAD:${relativeTasksFile}`)}`, { cwd: projectRoot });
  if (!baseline.ok) {
    blockers.push('git-baseline:tasks-not-tracked');
    return artifactResult(activeChange, name, blockers, false, {
      head: head.stdout.trim(),
      tasks_path: relativeTasksFile,
      baseline_task_count: 0,
      current_task_count: parseTaskItems(readTextFile(tasksFile).value || '').length
    });
  }

  const baselineTasks = parseTaskItems(baseline.stdout).filter((item) => item.checked !== null);
  const currentText = readTextFile(tasksFile);
  const currentTasks = currentText.ok
    ? parseTaskItems(currentText.value).filter((item) => item.checked !== null)
    : [];
  const currentIds = new Set(currentTasks.map((item) => item.task_id).filter(Boolean));
  const missingIds = baselineTasks
    .map((item) => item.task_id)
    .filter((taskId) => taskId && !currentIds.has(taskId));
  const approval = readTaskChangeApproval(developmentDir);
  blockers.push(...approval.blockers);

  let approvedMissingCount = 0;
  for (const taskId of missingIds) {
    if (approval.ok && approval.approved_task_ids.has(taskId)) {
      approvedMissingCount += 1;
      continue;
    }
    blockers.push(`tasks-md:baseline-task-removed:${taskId}`);
  }

  const unexplainedReduction = baselineTasks.length - currentTasks.length - approvedMissingCount;
  if (unexplainedReduction > 0) {
    blockers.push(`tasks-md:baseline-task-count-reduced:${unexplainedReduction}`);
  }

  return artifactResult(activeChange, name, unique(blockers), false, {
    head: head.stdout.trim(),
    tasks_path: relativeTasksFile,
    baseline_task_count: baselineTasks.length,
    current_task_count: currentTasks.length,
    approved_removal_count: approvedMissingCount,
    approval_file: approval.present ? artifactPath(activeChange, path.join('development', approval.name), true) : null
  });
}

function validatePromotionMap(developmentDir, activeChange) {
  const name = 'prototype-promotion-map.json';
  const parsed = readJsonFile(path.join(developmentDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }

  const value = parsed.value;
  if (value.schema_version !== 1) blockers.push('invalid-promotion-map:schema_version');
  if (value.promotion_policy !== 'reimplement_under_development_gate') {
    blockers.push('invalid-promotion-map:promotion_policy');
  }

  for (const field of ['allowed_to_copy', 'must_reimplement', 'blocked_direct_copies']) {
    if (!Array.isArray(value[field]) || value[field].length === 0 || hasInvalidStringArrayMembers(value[field])) {
      blockers.push(`invalid-promotion-map:${field}`);
    }
  }

  return artifactResult(activeChange, name, unique(blockers), true);
}

function validateBeforeDevCheck(developmentDir, activeChange) {
  const name = 'before-dev-check.json';
  const parsed = readJsonFile(path.join(developmentDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }

  const value = parsed.value;
  const change = value.active_change || value.change_id;
  if (change !== activeChange) blockers.push('invalid-before-dev-check:active_change');

  const passed = value.ok === true
    || value.pass === true
    || ['ok', 'pass', 'passed'].includes(String(value.status || '').toLowerCase());
  if (!passed) blockers.push('invalid-before-dev-check:status');

  return artifactResult(activeChange, name, unique(blockers), true);
}

function validateBasis(developmentDir, activeChange, requiredReferences) {
  const name = 'basis.md';
  const text = readTextFile(path.join(developmentDir, name));
  const blockers = [];

  if (!text.ok) {
    blockers.push(`missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  if (text.value.trim() === '') blockers.push(`empty-development-artifact:${name}`);
  blockers.push(...scaffoldBlockersForText(text.value, name));

  const normalized = normalizeContractText(text.value);
  if (!normalized.includes('requirements')) blockers.push('invalid-basis:requirements-reference');
  if (!normalized.includes('prototype')) blockers.push('invalid-basis:prototype-reference');
  if (!normalized.includes('handoff')) blockers.push('invalid-basis:handoff-reference');
  for (const relativePath of requiredReferences) {
    if (!pathReferencesText(text.value, relativePath)) {
      blockers.push(`invalid-basis:missing-reference:${relativePath}`);
    }
  }

  return artifactResult(activeChange, name, unique(blockers), true);
}

function hasObjectSubstance(value) {
  if (isCleanString(value)) return true;
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (value === true) return true;
  if (Array.isArray(value)) return value.some((item) => hasObjectSubstance(item));
  if (isPlainObject(value)) return Object.values(value).some((item) => hasObjectSubstance(item));
  return false;
}

function validateSubstantiveObjectArtifact(developmentDir, activeChange, name) {
  const parsed = readJsonFile(path.join(developmentDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }

  const payloadKeys = Object.keys(parsed.value).filter((key) => key !== 'schema_version');
  if (payloadKeys.length === 0 || !payloadKeys.some((key) => hasObjectSubstance(parsed.value[key]))) {
    blockers.push(`empty-object-contract:${name}`);
  }

  return artifactResult(activeChange, name, unique(blockers), true);
}

function parseJsonl(file, name) {
  const text = readTextFile(file);
  const blockers = [];
  const entries = [];

  if (!text.ok) {
    blockers.push(`missing-development-artifact:${name}`);
    return { blockers, entries };
  }
  blockers.push(...scaffoldBlockersForText(text.value, name));

  const lines = text.value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (!isPlainObject(entry)) {
        blockers.push(`invalid-jsonl-shape:${name}:${index + 1}`);
      } else {
        entries.push(entry);
      }
    } catch {
      blockers.push(`invalid-jsonl:${name}:${index + 1}`);
    }
  }

  if (entries.length === 0 && blockers.length === 0) blockers.push(`empty-jsonl:${name}`);
  return { blockers, entries };
}

function scanSqlIntent(changeDir) {
  const candidates = [
    'requirements.md',
    'acceptance.md',
    'tasks.md',
    'development/handoff-to-verify.md',
    'verify/traceability-matrix.json',
  ];
  const taskRoot = path.join(changeDir, 'development', 'tasks');
  try {
    for (const taskId of fs.readdirSync(taskRoot)) {
      for (const file of ['brief.md', 'report.md', 'spec-review.md', 'quality-review.md']) {
        candidates.push(path.join('development', 'tasks', taskId, file));
      }
    }
  } catch {
    // Missing task directories are reported by the task validators.
  }

  const hits = [];
  for (const relative of candidates) {
    const text = readTextFile(path.join(changeDir, relative));
    if (text.ok && SQL_INTENT_PATTERN.test(text.value)) hits.push(relative);
  }
  return unique(hits);
}

function validateMigrations(developmentDir, changeDir, activeChange) {
  const manifestName = 'migrations/manifest.json';
  const readmeName = 'migrations/README.md';
  const manifestPath = path.join(developmentDir, manifestName);
  const readmePath = path.join(developmentDir, readmeName);
  const sqlIntentSources = scanSqlIntent(changeDir);
  const artifacts = [];
  const blockers = [];
  const parsed = readJsonFile(manifestPath);
  let manifest = null;

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${manifestName}` : `missing-development-artifact:${manifestName}`);
    artifacts.push(artifactResult(activeChange, manifestName, unique(blockers), true, { sql_intent_sources: sqlIntentSources }));
    artifacts.push(artifactResult(activeChange, readmeName, [`missing-development-artifact:${readmeName}`], true));
    return { artifacts, blockers: unique(blockers), required: sqlIntentSources.length > 0, sql_intent_sources: sqlIntentSources };
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${manifestName}`);
  } else {
    manifest = parsed.value;
    if (manifest.schema_version !== 1) blockers.push('invalid-migrations-manifest:schema_version');
    if (manifest.change_id !== activeChange) blockers.push('invalid-migrations-manifest:change_id');
    if (typeof manifest.required !== 'boolean') blockers.push('invalid-migrations-manifest:required');
    if (!['not_required', 'ready'].includes(manifest.status)) blockers.push('invalid-migrations-manifest:status');
    if (sqlIntentSources.length > 0 && manifest.required !== true) blockers.push('migration-manifest-sql-mentioned-but-not-required');
    if (manifest.required === true && manifest.status !== 'ready') blockers.push('migration-manifest-not-ready');

    const migrations = Array.isArray(manifest.migrations) ? manifest.migrations : null;
    if (!migrations) blockers.push('invalid-migrations-manifest:migrations');
    else if (manifest.required === true && migrations.length === 0) blockers.push('migration-manifest:no-migrations');

    const seenIds = [];
    if (migrations) {
      migrations.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
          blockers.push(`invalid-migration-entry:${index + 1}`);
          return;
        }
        if (!isCleanString(entry.id)) blockers.push(`invalid-migration-entry:id:${index + 1}`);
        else seenIds.push(entry.id);
        if (!['ddl', 'seed', 'data', 'rollback'].includes(entry.kind)) blockers.push(`invalid-migration-entry:kind:${entry.id || index + 1}`);
        if (!Number.isInteger(entry.order) || entry.order < 1) blockers.push(`invalid-migration-entry:order:${entry.id || index + 1}`);
        if (!isCleanRelativePath(entry.path) || !entry.path.startsWith('development/migrations/') || !SQL_FILE_PATTERN.test(entry.path)) {
          blockers.push(`invalid-migration-entry:path:${entry.id || index + 1}`);
          return;
        }
        const sql = readTextFile(path.join(changeDir, entry.path));
        if (!sql.ok) blockers.push(`missing-migration-file:${entry.path}`);
        else {
          if (sql.value.trim() === '') blockers.push(`empty-migration-file:${entry.path}`);
          blockers.push(...scaffoldBlockersForText(sql.value, entry.path));
          if (!SQL_KIND_PATTERN.test(sql.value)) blockers.push(`migration-file-no-sql:${entry.path}`);
        }
      });
    }
    const duplicates = seenIds.filter((id, index) => seenIds.indexOf(id) !== index);
    if (duplicates.length > 0) blockers.push('invalid-migrations-manifest:duplicate-ids');

    if (!isPlainObject(manifest.verification)) blockers.push('invalid-migrations-manifest:verification');
    else {
      for (const field of ['commands', 'evidence']) {
        if (!Array.isArray(manifest.verification[field]) || manifest.verification[field].length === 0) {
          if (manifest.required === true) blockers.push(`invalid-migrations-manifest:verification.${field}`);
        } else if (hasInvalidStringArrayMembers(manifest.verification[field])) {
          blockers.push(`invalid-migrations-manifest:verification.${field}`);
        }
      }
    }

    if (manifest.required === true) {
      const rollback = Array.isArray(manifest.rollback) ? manifest.rollback : [];
      if (rollback.length === 0 && !isCleanString(manifest.rollback_strategy)) {
        blockers.push('migration-manifest:missing-rollback');
      }
    }
  }

  artifacts.push(artifactResult(activeChange, manifestName, unique(blockers), true, {
    required: manifest ? manifest.required === true : sqlIntentSources.length > 0,
    sql_intent_sources: sqlIntentSources
  }));

  const readme = readTextFile(readmePath);
  const readmeBlockers = [];
  if (!readme.ok) readmeBlockers.push(`missing-development-artifact:${readmeName}`);
  else {
    if (readme.value.trim() === '') readmeBlockers.push(`empty-development-artifact:${readmeName}`);
    readmeBlockers.push(...scaffoldBlockersForText(readme.value, readmeName));
    readmeBlockers.push(...validateRequiredHeadings(readme.value, ['Execution Order', 'Validation', 'Rollback'], 'invalid-migrations-readme'));
  }
  artifacts.push(artifactResult(activeChange, readmeName, unique(readmeBlockers), true));
  blockers.push(...readmeBlockers);

  return {
    artifacts,
    blockers: unique(blockers),
    required: !!(manifest && manifest.required === true),
    sql_intent_sources: sqlIntentSources
  };
}

function validateTaskContextLog(developmentDir, activeChange) {
  const name = 'task-context.jsonl';
  const result = parseJsonl(path.join(developmentDir, name), name);
  return artifactResult(activeChange, name, unique(result.blockers), true, { entries: result.entries.length });
}

// D2 consolidation: development/manifest.json replaces the 6 one-shot entry
// planning JSONs with sections in one file. Append-only ledgers stay separate.
const MANIFEST_SECTIONS = {
  before_dev_check: 'before-dev-check.json',
  promotion_map: 'prototype-promotion-map.json',
  complexity_budget: 'complexity-budget.json',
  task_graph: 'task-graph.json',
  code_owner_map: 'code-owner-map.json',
  extraction_map: 'extraction-map.json'
};

function readDevelopmentManifest(developmentDir) {
  const parsed = readJsonFile(path.join(developmentDir, 'manifest.json'));
  if (!parsed.ok) return { present: parsed.status !== 'missing', ok: false, value: null, status: parsed.status };
  if (!isPlainObject(parsed.value)) return { present: true, ok: false, value: null, status: 'invalid-shape' };
  return { present: true, ok: true, value: parsed.value, status: 'ok' };
}

function validateManifestSections(developmentDir, activeChange, manifest) {
  const name = 'manifest.json';
  const blockers = [];
  if (!manifest.ok) {
    blockers.push(manifest.status === 'invalid-json' ? `invalid-json:${name}` : `invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  const value = manifest.value;
  if (value.schema_version !== 1) blockers.push('invalid-development-manifest:schema_version');
  for (const [section, legacyName] of Object.entries(MANIFEST_SECTIONS)) {
    const body = value[section];
    if (!isPlainObject(body)) {
      blockers.push(`invalid-development-manifest:missing-section:${section}`);
      continue;
    }
    if (section === 'before_dev_check') {
      const passed = body.ok === true || body.pass === true
        || ['ok', 'pass', 'passed'].includes(String(body.status || '').toLowerCase());
      if (!passed) blockers.push('invalid-before-dev-check:status');
      continue;
    }
    if (section === 'promotion_map') {
      if (body.promotion_policy !== 'reimplement_under_development_gate') blockers.push('invalid-promotion-map:promotion_policy');
      continue;
    }
    if (!hasObjectSubstance(body)) blockers.push(`empty-object-contract:${legacyName}`);
  }
  return artifactResult(activeChange, name, unique(blockers), true);
}

function validateLaneEscalation(projectRoot, changeDir) {
  // Anti-gaming: a light-lane change whose cumulative production diff grows
  // beyond escalation_threshold files must re-classify. Splitting a big
  // change into "small" light-lane slices does not dodge the standard lane.
  const laneInfo = lib.readLane(changeDir);
  if (laneInfo.lane !== 'light') return [];
  const diff = lib.runCommand('git diff --name-only HEAD && git ls-files --others --exclude-standard', {
    cwd: projectRoot,
    timeoutMs: 30000
  });
  if (!diff.ok) return [];
  const files = Array.from(new Set(
    diff.stdout.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((file) => file && !file.startsWith('openspec/'))
  ));
  if (files.length > laneInfo.escalation_threshold) {
    return [`lane-escalation-required:${files.length}-files-exceeds-${laneInfo.escalation_threshold}`];
  }
  return [];
}

function validateLightAcceptanceCompletion(changeDir, activeChange, mode) {
  const base = validateAcceptanceAssertions(changeDir, activeChange);

  if (!base) {
    return artifactResult(activeChange, 'acceptance.json', ['missing-requirements-artifact:acceptance.json'], false, {
      assertions: 0,
      passing: 0
    });
  }
  const acceptance = lib.readAcceptanceAssertions(changeDir);
  const blockers = [...base.blockers];
  if (mode === 'handoff' && acceptance.ok) {
    for (const assertion of acceptance.assertions) {
      if (assertion.status !== 'passing') blockers.push(`acceptance:non-passing:${assertion.id}`);
      if (!(typeof assertion.evidence_ref === 'string' && assertion.evidence_ref.trim())) {
        blockers.push(`acceptance:missing-evidence:${assertion.id}`);
      }
    }
  }

  return artifactResult(activeChange, 'acceptance.json', unique(blockers), false, {
    assertions: base.assertions,
    passing: base.passing
  });
}

function validateLightGate(changeDir, activeChange) {
  const name = 'light-gate.json';
  const parsed = readJsonFile(path.join(changeDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-change-artifact:${name}`);
    return artifactResult(activeChange, name, blockers);
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return artifactResult(activeChange, name, blockers);
  }

  const gate = parsed.value;
  if (gate.schema_version !== 1) blockers.push('invalid-light-gate:schema_version');
  if (gate.gate !== 'specnav.light.compactGate.v1') blockers.push('invalid-light-gate:gate');
  if (gate.change_id !== activeChange) blockers.push('invalid-light-gate:change_id');
  if (gate.lane !== 'light') blockers.push('invalid-light-gate:lane');

  if (!isPlainObject(gate.entry)) {
    blockers.push('invalid-light-gate:entry');
  } else {
    if (gate.entry.status !== 'ready') blockers.push('light-entry:not-ready');
    if (!isCleanString(gate.entry.intent)) blockers.push('invalid-light-gate:entry.intent');
    if (!Array.isArray(gate.entry.editable_paths) || gate.entry.editable_paths.length === 0) {
      blockers.push('light-entry:paths-missing');
    } else if (hasInvalidStringArrayMembers(gate.entry.editable_paths, true)) {
      blockers.push('light-entry:invalid-paths');
    }
    if (gate.entry.scope !== 'scope.json') blockers.push('invalid-light-gate:entry.scope');
    if (gate.entry.tasks !== 'tasks.md') blockers.push('invalid-light-gate:entry.tasks');
    if (!Array.isArray(gate.entry.acceptance_refs) || gate.entry.acceptance_refs.length === 0) {
      blockers.push('invalid-light-gate:entry.acceptance_refs');
    }
  }

  if (!isPlainObject(gate.test)) {
    blockers.push('invalid-light-gate:test');
  } else {
    if (!Array.isArray(gate.test.required_domains)) {
      blockers.push('invalid-light-gate:test.required_domains');
    } else {
      for (const domain of ['static', 'unit']) {
        if (!gate.test.required_domains.includes(domain)) blockers.push(`light-test:missing-domain:${domain}`);
      }
    }
    if (gate.test.cases !== 'verify/user-test-cases.json') blockers.push('invalid-light-gate:test.cases');
    if (gate.test.signoff !== 'verify/user-test-case-signoff.json') blockers.push('invalid-light-gate:test.signoff');
    if (gate.test.domain_matrix !== 'verify/domain-case-matrix.json') blockers.push('invalid-light-gate:test.domain_matrix');
  }

  if (!isPlainObject(gate.archive)) {
    blockers.push('invalid-light-gate:archive');
  } else if (!Array.isArray(gate.archive.requires) || gate.archive.requires.length === 0) {
    blockers.push('invalid-light-gate:archive.requires');
  }

  return artifactResult(activeChange, name, unique(blockers), false);
}

function validateAcceptanceAssertions(changeDir, activeChange) {
  const name = 'acceptance.json';
  const acceptance = lib.readAcceptanceAssertions(changeDir);
  if (!acceptance.present) return null;
  const blockers = [...acceptance.blockers];

  // Freeze contract: the assertion identity digest is pinned on first
  // development-contract run. Adding, removing, or rewording assertions
  // during implementation is tampering; only status/evidence may change.
  const freezeFile = path.join(changeDir, 'development', 'acceptance-freeze.json');
  if (acceptance.ok) {
    const digest = lib.acceptanceAssertionsDigest(acceptance.assertions);
    const freeze = lib.readJson(freezeFile, null);
    if (!freeze || typeof freeze.digest !== 'string') {
      lib.writeJson(freezeFile, {
        schema_version: 1,
        change_id: activeChange,
        digest,
        assertion_count: acceptance.assertions.length,
        frozen_at: new Date().toISOString()
      });
    } else if (freeze.digest !== digest) {
      blockers.push('acceptance:assertions-mutated');
    }
  }

  return artifactResult(activeChange, name, unique(blockers), false, {
    assertions: acceptance.assertions.length,
    passing: acceptance.assertions.filter((assertion) => assertion.status === 'passing').length
  });
}

// Light lane v2: the single light-change.json IS the contract. Entry needs a
// ready gate; handoff needs every task done and every assertion passing with
// evidence. The v1 14-artifact packet path below remains for in-flight changes.
function validateLightChangeV2(projectRoot, mode, prototype, activeChange, changeDir, developmentDir, lightChange) {
  const blockers = [...lightChange.blockers];
  const value = lightChange.value || {};
  if (value.change_id && value.change_id !== activeChange) blockers.push('light-change:change-mismatch');

  if (mode === 'handoff' && !blockers.length) {
    for (const task of value.tasks || []) {
      if (task && task.done !== true) blockers.push(`light-change:task-incomplete:${task.id || task.text || 'unknown'}`);
    }
    for (const assertion of value.acceptance || []) {
      if (!assertion) continue;
      if (assertion.status !== 'passing') blockers.push(`acceptance:non-passing:${assertion.id || 'unknown'}`);
      if (!(typeof assertion.evidence_ref === 'string' && assertion.evidence_ref.trim())) {
        blockers.push(`acceptance:missing-evidence:${assertion.id || 'unknown'}`);
      }
    }
  }
  blockers.push(...validateLaneEscalation(projectRoot, changeDir));

  const codegraph = codegraphStageGuard(projectRoot, activeChange, 'development');
  blockers.push(...codegraphBlockers(codegraph));

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    mode,
    lane: 'light',
    light_format: 'v2',
    active_change: activeChange,
    change_dir: changeDir,
    development_dir: developmentDir,
    blockers: unique(blockers),
    warnings: unique(codegraphWarnings(codegraph)),
    loops: [],
    codegraph,
    prototype,
    artifacts: [artifactResult(activeChange, 'light-change.json', unique(blockers))],
    tasks: []
  };
}

function validateLightDevelopment(projectRoot, mode, prototype, activeChange, changeDir, developmentDir) {
  const lightChange = lib.readLightChange(changeDir);
  if (lightChange.present) {
    return validateLightChangeV2(projectRoot, mode, prototype, activeChange, changeDir, developmentDir, lightChange);
  }
  const artifacts = [];
  const blockers = [];
  const tasks = [];

  artifacts.push(validateUpstreamContracts(projectRoot, activeChange, prototype, 'light'));
  artifacts.push(validateLightGate(changeDir, activeChange));
  artifacts.push(validateScope(projectRoot, changeDir, activeChange, null));
  artifacts.push(validateTasksMarkdown(changeDir, activeChange, mode));
  artifacts.push(validateLightAcceptanceCompletion(changeDir, activeChange, mode));
  blockers.push(...validateLaneEscalation(projectRoot, changeDir));

  for (const artifact of artifacts) blockers.push(...artifact.blockers);

  const codegraph = codegraphStageGuard(projectRoot, activeChange, 'development');
  blockers.push(...codegraphBlockers(codegraph));
  const warnings = unique(codegraphWarnings(codegraph));

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    mode,
    lane: 'light',
    active_change: activeChange,
    change_dir: changeDir,
    development_dir: developmentDir,
    blockers: unique(blockers),
    warnings,
    loops: [],
    codegraph,
    prototype,
    artifacts,
    tasks
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const LOOP_DETECTION_THRESHOLD = positiveInteger(
  process.env.SPECNAV_LOOP_THRESHOLD,
  3
);
const LOOP_ATTEMPT_BUDGET = positiveInteger(
  process.env.SPECNAV_LOOP_ATTEMPT_BUDGET,
  5
);
const LEDGER_FAILURE_STATUSES = new Set([
  'spec_review_failed',
  'quality_review_failed',
  'fix_failed',
  'debug_failed',
  'blocked',
  'failed'
]);
const LEDGER_ESCALATION_STATUSES = new Set(['escalated', 'break_loop', 'replanned', 'split']);
const LEDGER_COMPLETION_STATUSES = new Set(['complete', 'completed', 'closed', 'done', 'passed']);

function normalizedBlockerValue(value) {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }
  if (Array.isArray(value)) {
    return value
      .map(normalizedBlockerValue)
      .filter((entry) => entry !== '' && entry !== null)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizedBlockerValue(value[key])])
    );
  }
  if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
  return '';
}

function ledgerBlockerDigest(entry) {
  if (
    typeof entry.blocker_digest === 'string'
    && /^[a-f0-9]{64}$/i.test(entry.blocker_digest.trim())
  ) {
    return entry.blocker_digest.trim().toLowerCase();
  }
  const blockerSource = Array.isArray(entry.blockers) && entry.blockers.length > 0
    ? entry.blockers
    : typeof entry.blocker === 'string' && entry.blocker.trim()
      ? entry.blocker
      : entry.status;
  return crypto.createHash('sha256')
    .update(JSON.stringify(normalizedBlockerValue(blockerSource)))
    .digest('hex');
}

function detectTaskLoops(developmentDir) {
  // The breaker resets only after completion or an explicit escalation. This
  // prevents superficial progress entries from hiding repeated failed work.
  const result = parseJsonl(path.join(developmentDir, 'task-ledger.jsonl'), 'task-ledger.jsonl');
  const states = new Map();
  const tripped = new Map();

  for (const entry of result.entries) {
    const taskId = entry.task || entry.task_id;
    if (!taskId || typeof entry.status !== 'string') continue;
    const status = entry.status;
    if (LEDGER_ESCALATION_STATUSES.has(status)) {
      states.delete(taskId);
      tripped.delete(taskId);
      continue;
    }
    if (LEDGER_COMPLETION_STATUSES.has(status)) {
      states.delete(taskId);
      tripped.delete(taskId);
      continue;
    }
    if (LEDGER_FAILURE_STATUSES.has(status)) {
      const blockerDigest = ledgerBlockerDigest(entry);
      const current = states.get(taskId) || {
        blocker_digest: null,
        consecutive_failures: 0,
        attempt_count: 0
      };
      const next = {
        blocker_digest: blockerDigest,
        consecutive_failures: current.blocker_digest === blockerDigest
          ? current.consecutive_failures + 1
          : 1,
        attempt_count: current.attempt_count + 1
      };
      states.set(taskId, next);
      const triggers = [];
      if (next.consecutive_failures >= LOOP_DETECTION_THRESHOLD) {
        triggers.push('same-blocker');
      }
      if (next.attempt_count >= LOOP_ATTEMPT_BUDGET) {
        triggers.push('attempt-budget');
      }
      if (triggers.length > 0) {
        tripped.set(taskId, {
          ...next,
          triggers,
          next_action: 'specnav-break-loop'
        });
      }
      continue;
    }
    // started/progress/review entries are not evidence that the blocker was
    // resolved, so they cannot reset either breaker.
  }

  return Array.from(tripped.entries()).map(([taskId, loop]) => ({
    task_id: taskId,
    blocker_digest: loop.blocker_digest,
    consecutive_failures: loop.consecutive_failures,
    attempt_count: loop.attempt_count,
    thresholds: {
      consecutive_failures: LOOP_DETECTION_THRESHOLD,
      attempt_budget: LOOP_ATTEMPT_BUDGET
    },
    triggers: loop.triggers,
    next_action: loop.next_action
  }));
}

function validateTaskLedger(developmentDir, activeChange, taskIds) {
  const name = 'task-ledger.jsonl';
  const result = parseJsonl(path.join(developmentDir, name), name);
  const blockers = [...result.blockers];

  for (const taskId of taskIds) {
    const statuses = new Set(
      result.entries
        .filter((entry) => entry.task === taskId || entry.task_id === taskId)
        .map((entry) => entry.status)
        .filter((status) => typeof status === 'string')
    );

    for (const required of ['spec_review_passed', 'quality_review_passed', 'complete']) {
      if (!statuses.has(required)) blockers.push(`task-ledger-missing-status:${taskId}:${required}`);
    }
  }

  return artifactResult(activeChange, name, unique(blockers), true, { entries: result.entries.length });
}

function validateDriftCheck(developmentDir, activeChange) {
  const name = 'drift-check.jsonl';
  const result = parseJsonl(path.join(developmentDir, name), name);
  const blockers = [...result.blockers];

  result.entries.forEach((entry, index) => {
    if (entry.blocking === true) {
      blockers.push(`blocking-drift:${entry.task || entry.task_id || index + 1}`);
    }
  });

  return artifactResult(activeChange, name, unique(blockers), true, { entries: result.entries.length });
}

function validateValidationLog(
  projectRoot,
  developmentDir,
  activeChange,
  receiptAuthority
) {
  const name = 'validation-log.jsonl';
  const result = parseJsonl(path.join(developmentDir, name), name);
  const blockers = [...result.blockers];
  const changeDir = path.dirname(developmentDir);
  const isPass = (entry) => {
    const status = String(entry.status || '').toLowerCase();
    return entry.ok === true || status === 'pass' || status === 'passed';
  };
  const taskIdOf = (entry) => entry.task || entry.task_id || 'unknown';
  const isTrustedBoundV2Pass = (entry) => {
    if (
      entry.schema !== 'specnav.validationLog.v2'
      || entry.attestation !== 'system-executed'
      || entry.status !== 'pass'
      || entry.ok !== true
      || entry.exit_status !== 0
      || entry.overturned === true
      || !receiptAuthority
      || typeof receiptAuthority.verify !== 'function'
      || !receiptAuthority.verify(entry)
    ) {
      return false;
    }
    const evidence = resolveTaskEvidence(projectRoot, changeDir, entry.evidence_log);
    return (
      evidence !== null
      && entry.evidence_log_sha256 === evidence.sha256
      && entry.evidence_log_size === evidence.size
    );
  };
  const indexedEntries = result.entries.map((entry, index) => ({ entry, index }));
  const executed = indexedEntries.filter(({ entry }) => entry.attestation === 'system-executed');
  const selfReported = result.entries.filter((entry) => entry.attestation !== 'system-executed');
  const hasPass = result.entries.some(isPass);
  const hasExecutedPass = executed.some(({ entry }) => isPass(entry));
  const executedFailures = executed.filter(({ entry }) => !isPass(entry));
  const evidenceLogGroups = new Map();
  for (const record of executed) {
    const evidenceLog = typeof record.entry.evidence_log === 'string'
      ? record.entry.evidence_log.trim()
      : '';
    if (!evidenceLog) continue;
    if (!evidenceLogGroups.has(evidenceLog)) evidenceLogGroups.set(evidenceLog, []);
    evidenceLogGroups.get(evidenceLog).push(record);
  }
  for (const records of evidenceLogGroups.values()) {
    if (records.length <= 1) continue;
    const taskIds = new Set(records.map(({ entry }) => (
      entry.task || entry.task_id || 'unknown'
    )));
    for (const taskId of taskIds) {
      blockers.push(`validation-log:duplicate-evidence-log:${taskId}`);
    }
  }
  const uniqueExecuted = [...evidenceLogGroups.entries()]
    .filter(([, records]) => records.length === 1)
    .map(([evidenceLog, records]) => [evidenceLog, records[0]]);
  const executedByEvidenceLog = new Map(uniqueExecuted);
  const failureByEvidenceLog = new Map(
    uniqueExecuted.filter(([, record]) => !isPass(record.entry))
  );
  const passByEvidenceLog = new Map(
    uniqueExecuted.filter(([, record]) => isPass(record.entry))
  );
  const adjudicatedFailures = new Set();
  const supersededPasses = new Set();
  const digestEntry = (entry) => (
    crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex')
  );
  const adjudications = indexedEntries
    .filter(({ entry }) => String(entry.status || '').toLowerCase() === 'overturned')
    .map(({ entry, index }) => {
    const taskId = entry.task || entry.task_id || 'unknown';
    const target = typeof entry.target_evidence_log === 'string'
      ? entry.target_evidence_log.trim()
      : '';
    const supersedingTarget = typeof entry.superseding_evidence_log === 'string'
      ? entry.superseding_evidence_log.trim()
      : '';
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const targetRecord = target ? executedByEvidenceLog.get(target) : null;
    const targetEntry = targetRecord && targetRecord.entry;
    if (
      !targetEntry
      || (targetEntry.task || targetEntry.task_id || 'unknown') !== taskId
    ) {
      return {
        entry,
        index,
        taskId,
        target,
        digest: digestEntry(entry),
        valid: false,
        blocker: `validation-log:invalid-overturn-target:${taskId}`
      };
    }
    if (!reason) {
      return {
        entry,
        index,
        taskId,
        target,
        digest: digestEntry(entry),
        valid: false,
        blocker: `validation-log:overturn-reason-missing:${taskId}`
      };
    }
    const passRecord = supersedingTarget ? passByEvidenceLog.get(supersedingTarget) : null;
    const pass = passRecord && passRecord.entry;
    if (
      !pass
      || (pass.task || pass.task_id || 'unknown') !== taskId
      || passRecord.index <= targetRecord.index
      || passRecord.index >= index
    ) {
      return {
        entry,
        index,
        taskId,
        target,
        digest: digestEntry(entry),
        valid: false,
        blocker: `validation-log:invalid-overturn-successor:${taskId}`
      };
    }
    return {
      entry,
      index,
      taskId,
      target,
      digest: digestEntry(entry),
      valid: true,
      blocker: null
    };
  });
  const adjudicationByDigest = new Map(
    adjudications.map((record) => [record.digest, record])
  );
  const correctedAdjudications = new Set();

  for (const { entry, index } of indexedEntries) {
    if (
      entry.schema !== 'specnav.validationAdjudicationCorrection.v1'
      || String(entry.status || '').toLowerCase() !== 'corrected'
    ) {
      continue;
    }
    const taskId = entry.task || entry.task_id || 'unknown';
    const invalidDigest = typeof entry.invalid_adjudication_digest === 'string'
      ? entry.invalid_adjudication_digest.trim()
      : '';
    const replacementDigest = typeof entry.replacement_adjudication_digest === 'string'
      ? entry.replacement_adjudication_digest.trim()
      : '';
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const invalid = adjudicationByDigest.get(invalidDigest);
    const replacement = adjudicationByDigest.get(replacementDigest);
    if (
      !reason
      || !invalid
      || invalid.valid
      || invalid.taskId !== taskId
      || !replacement
      || !replacement.valid
      || replacement.taskId !== taskId
      || replacement.target !== invalid.target
      || invalid.index >= replacement.index
      || replacement.index >= index
    ) {
      blockers.push(`validation-log:invalid-adjudication-correction:${taskId}`);
      continue;
    }
    correctedAdjudications.add(invalidDigest);
  }

  for (const adjudication of adjudications) {
    if (!adjudication.valid) {
      if (!correctedAdjudications.has(adjudication.digest)) {
        blockers.push(adjudication.blocker);
      }
      continue;
    }
    if (failureByEvidenceLog.has(adjudication.target)) {
      adjudicatedFailures.add(adjudication.target);
    } else {
      supersededPasses.add(adjudication.target);
    }
  }

  const legacyFailuresSuperseded = new Set();
  for (const failure of executedFailures) {
    const evidenceLog = typeof failure.entry.evidence_log === 'string'
      ? failure.entry.evidence_log.trim()
      : '';
    if (
      failure.entry.schema === 'specnav.validationLog.v2'
      || evidenceLog
    ) {
      continue;
    }
    const taskId = taskIdOf(failure.entry);
    const trustedSuccessor = executed.some((candidate) => (
      candidate.index > failure.index
      && taskIdOf(candidate.entry) === taskId
      && isTrustedBoundV2Pass(candidate.entry)
      && !supersededPasses.has(candidate.entry.evidence_log)
    ));
    if (trustedSuccessor) legacyFailuresSuperseded.add(failure.index);
  }

  if (!hasPass) blockers.push('validation-log:no-pass');
  // Handoff requires at least one Development-owned system-executed pass when
  // any entry is replayable. Formal Verification is a later lifecycle stage.
  const hasReplayable = selfReported.some((entry) =>
    entry.replayable !== false && typeof entry.command === 'string' && entry.command.trim());
  if (hasReplayable && !hasExecutedPass) blockers.push('validation-log:no-executed-evidence');
  // Executed evidence outranks claims: a system-executed failure blocks even
  // when a self-reported pass exists for the same work. Historical receipts
  // remain append-only. A later adjudication may correct an earlier incomplete
  // adjudication for the same target, but it must name an exact later
  // system-executed PASS before it can retire a failure or supersede stale
  // green evidence.
  for (const { entry, index } of executedFailures) {
    if (legacyFailuresSuperseded.has(index)) continue;
    if (adjudicatedFailures.has(entry.evidence_log)) continue;
    blockers.push(`validation-log:executed-evidence-failed:${taskIdOf(entry)}`);
  }
  // Non-replayable self-reported entries must carry a caveat explaining why
  // the evidence cannot be executed by the runner.
  for (const entry of selfReported) {
    if (entry.replayable === false && !(typeof entry.caveat === 'string' && entry.caveat.trim())) {
      blockers.push(`validation-log:non-replayable-missing-caveat:${entry.task || entry.task_id || 'unknown'}`);
    }
  }

  return artifactResult(activeChange, name, unique(blockers), true, {
    entries: result.entries.length,
    executed_entries: executed.length,
    executed_pass: hasExecutedPass,
    adjudicated_failures: adjudicatedFailures.size,
    superseded_passes: supersededPasses.size,
    corrected_adjudications: correctedAdjudications.size,
    legacy_failures_superseded: legacyFailuresSuperseded.size,
    attestation: hasExecutedPass ? 'system-executed' : 'self-reported-only'
  });
}

function validateHandoffToVerify(developmentDir, activeChange) {
  const name = 'handoff-to-verify.md';
  const text = readTextFile(path.join(developmentDir, name));
  const blockers = [];

  if (!text.ok) {
    blockers.push(`missing-development-artifact:${name}`);
    return artifactResult(activeChange, name, blockers, true);
  }
  if (text.value.trim() === '') blockers.push(`empty-development-artifact:${name}`);
  blockers.push(...scaffoldBlockersForText(text.value, name));
  blockers.push(...validateRequiredHeadings(text.value, HANDOFF_HEADINGS, 'invalid-handoff-to-verify'));

  return artifactResult(activeChange, name, unique(blockers), true);
}

function validateTaskBrief(taskDir, relativeTaskPath) {
  const name = 'brief.md';
  const text = readTextFile(path.join(taskDir, name));
  const blockers = [];

  if (!text.ok) {
    blockers.push(`missing-task-artifact:${name}`);
    return { name, path: path.join(relativeTaskPath, name), ok: false, blockers };
  }
  if (text.value.trim() === '') blockers.push(`empty-task-artifact:${name}`);
  blockers.push(...scaffoldBlockersForText(text.value, name));
  blockers.push(...validateRequiredHeadings(text.value, BRIEF_CORE_HEADINGS, 'invalid-task-brief'));
  blockers.push(...validateOptionalHeadings(text.value, BRIEF_HEADINGS.filter((heading) => !BRIEF_CORE_HEADINGS.includes(heading)), 'invalid-task-brief'));

  return { name, path: path.join(relativeTaskPath, name), ok: blockers.length === 0, blockers: unique(blockers) };
}

function validateTaskContext(taskDir, relativeTaskPath, taskId, requiredMustRead) {
  const name = 'context.json';
  const parsed = readJsonFile(path.join(taskDir, name));
  const blockers = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-task-artifact:${name}`);
    return { name, path: path.join(relativeTaskPath, name), ok: false, blockers };
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return { name, path: path.join(relativeTaskPath, name), ok: false, blockers };
  }

  const value = parsed.value;
  if (!isCleanString(value.task_id) || value.task_id !== taskId) blockers.push('invalid-task-context:task_id');
  if (!isCleanString(value.goal)) blockers.push('invalid-task-context:goal');
  if (!isCleanString(value.stop_condition)) blockers.push('invalid-task-context:stop_condition');

  for (const field of TASK_CONTEXT_ARRAYS) {
    if (!Array.isArray(value[field])) {
      blockers.push(`invalid-task-context:${field}`);
      continue;
    }
    if (NON_EMPTY_TASK_CONTEXT_ARRAYS.has(field) && value[field].length === 0) {
      blockers.push(`invalid-task-context:${field}`);
      continue;
    }
    if (hasInvalidStringArrayMembers(value[field], PATH_TASK_CONTEXT_ARRAYS.has(field))) {
      blockers.push(`invalid-task-context:${field}`);
    }
  }
  if (Array.isArray(value.task_items)) {
    if (new Set(value.task_items).size !== value.task_items.length) {
      blockers.push('invalid-task-context:task_items-duplicate');
    }
    for (const taskItem of value.task_items) {
      if (!TASK_ITEM_ID_PATTERN.test(String(taskItem))) {
        blockers.push(`invalid-task-context:task_items-id:${String(taskItem)}`);
      }
    }
  }

  if (Array.isArray(value.must_read)) {
    for (const relativePath of requiredMustRead) {
      if (!value.must_read.includes(relativePath)) {
        blockers.push(`invalid-task-context:must_read-missing:${relativePath}`);
      }
    }
  }

  return { name, path: path.join(relativeTaskPath, name), ok: blockers.length === 0, blockers: unique(blockers) };
}

function validateReport(taskDir, relativeTaskPath) {
  const name = 'report.md';
  const text = readTextFile(path.join(taskDir, name));
  const blockers = [];

  if (!text.ok) {
    blockers.push(`missing-task-artifact:${name}`);
    return { name, path: path.join(relativeTaskPath, name), ok: false, blockers };
  }
  if (text.value.trim() === '') blockers.push(`empty-task-artifact:${name}`);
  blockers.push(...scaffoldBlockersForText(text.value, name));

  const parsed = parseMarkdownHeadings(text.value);
  blockers.push(...validateRequiredHeadings(text.value, REPORT_REQUIRED_HEADINGS, 'invalid-task-report'));

  const statusHeading = findHeading(parsed, 'Status');
  if (!statusHeading) {
    blockers.push('invalid-task-report:missing-status');
  } else {
    const status = firstSubstantiveValue(parsed, statusHeading);
    if (!HANDOFF_REPORT_STATUSES.has(status)) {
      blockers.push('invalid-task-report:status');
    }
    if (status === 'DONE_WITH_CONCERNS') {
      const adjudicationHeading = findAnyHeading(parsed, ['Adjudication', 'Controller Adjudication']);
      if (!adjudicationHeading || !hasSubstantiveBody(parsed, adjudicationHeading)) {
        blockers.push('invalid-task-report:concerns-adjudication');
      }
    }
  }

  return { name, path: path.join(relativeTaskPath, name), ok: blockers.length === 0, blockers: unique(blockers) };
}

function taskEvidencePathExists(projectRoot, changeDir, relativePath) {
  if (!isCleanRelativePath(relativePath)) return false;

  const projectRealpath = realpathSync(projectRoot);
  const candidates = unique([
    path.resolve(projectRoot, relativePath),
    path.resolve(changeDir, relativePath)
  ]);

  for (const candidate of candidates) {
    if (!isRealpathContained(projectRoot, candidate) || statKind(candidate) !== 'file') continue;
    try {
      if (isRealpathContained(projectRealpath, realpathSync(candidate))) return true;
    } catch {
      // A disappearing or unreadable evidence file cannot satisfy handoff.
    }
  }
  return false;
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactObjectKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(required);
}

function developmentGit(projectRoot, args) {
  try {
    return execFileSync('git', ['-C', projectRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

function developmentLifecyclePath(relativePath, activeChange) {
  const normalized = String(relativePath).split(path.sep).join('/');
  const changePrefix = `openspec/changes/${activeChange}/`;
  return (
    normalized.startsWith('openspec/.specnav/')
    ||
    ['development/', 'verify/', 'codegraph/', 'operations/']
      .some((directory) => normalized.startsWith(`${changePrefix}${directory}`))
    || normalized.startsWith(`${changePrefix}verify-report.`)
    || normalized === `openspec/changes/${activeChange}/tasks.md`
  );
}

function developmentGlobPattern(pattern) {
  let result = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      result += '.*';
      index += 1;
    } else if (char === '*') {
      result += '[^/]*';
    } else if (char === '?') {
      result += '[^/]';
    } else {
      result += escapeRegExp(char);
    }
  }
  return new RegExp(`${result}$`);
}

function taskAcceptanceAssertionIds(context) {
  const scoped = unique([
    ...(Array.isArray(context.acceptance_primary) ? context.acceptance_primary : []),
    ...(Array.isArray(context.acceptance_subclaims) ? context.acceptance_subclaims : [])
  ]);
  if (scoped.length > 0) return scoped;
  const declared = unique(
    Array.isArray(context.acceptance_assertions)
      ? context.acceptance_assertions
      : []
  );
  if (declared.length > 0) return declared;
  return unique([
    ...(Array.isArray(context.acceptance_contributes) ? context.acceptance_contributes : []),
    ...(Array.isArray(context.contributes_to) ? context.contributes_to : [])
  ]);
}

function implementationScopeAtRef(
  projectRoot,
  activeChange,
  context,
  reviewedGitHead
) {
  const patterns = unique(
    Array.isArray(context.allowed_files) ? context.allowed_files : []
  )
    .map((entry) => String(entry).split(path.sep).join('/'))
    .filter((entry) => !developmentLifecyclePath(entry, activeChange))
    .sort();
  if (patterns.length === 0) return null;
  const output = developmentGit(projectRoot, [
    'ls-tree',
    '-r',
    '--full-tree',
    reviewedGitHead
  ]);
  if (output === null) return null;
  const matchers = patterns.map(developmentGlobPattern);
  const entries = output === '' ? [] : output.split(/\r?\n/).map((line) => {
    const [metadata, relativePath] = line.split('\t');
    const [mode, type, objectId] = metadata.split(' ');
    return {
      path: String(relativePath).split(path.sep).join('/'),
      mode,
      type,
      object_id: objectId
    };
  }).filter((entry) => matchers.some((matcher) => matcher.test(entry.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length === 0) return null;
  return {
    included_patterns: patterns,
    entries,
    sha256: sha256Value(JSON.stringify(canonicalAcceptanceScope({
      patterns,
      entries
    })))
  };
}

function safeDevelopmentRegularFile(root, candidate) {
  try {
    const rootReal = fs.realpathSync(root);
    const status = fs.lstatSync(candidate);
    const candidateReal = fs.realpathSync(candidate);
    const relative = path.relative(rootReal, candidateReal);
    return (
      !status.isSymbolicLink()
      && status.isFile()
      && relative !== ''
      && !relative.startsWith('..')
      && !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}

function resolveTaskEvidence(projectRoot, changeDir, relativePath) {
  if (!isCleanRelativePath(relativePath)) return null;
  const changeRelativePrefixes = [
    'codegraph/',
    'development/',
    'operations/',
    'prototype/',
    'verify/'
  ];
  const root = changeRelativePrefixes.some((prefix) => relativePath.startsWith(prefix))
    ? changeDir
    : projectRoot;
  const candidate = path.resolve(root, relativePath);
  if (!safeDevelopmentRegularFile(root, candidate)) return null;
  return {
    path: relativePath,
    sha256: sha256Value(fs.readFileSync(candidate)),
    size: fs.statSync(candidate).size
  };
}

function sameEvidenceBinding(expected, actual) {
  return (
    isPlainObject(actual)
    && exactObjectKeys(actual, ['path', 'sha256', 'size'])
    && expected !== null
    && actual.path === expected.path
    && actual.sha256 === expected.sha256
    && actual.size === expected.size
  );
}

function canonicalAcceptanceScope(value) {
  if (Array.isArray(value)) return value.map(canonicalAcceptanceScope);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalAcceptanceScope(value[key])])
  );
}

function validateTaskAcceptance(
  projectRoot,
  changeDir,
  taskDir,
  relativeTaskPath,
  taskId,
  receiptAuthority
) {
  const name = 'acceptance.json';
  const parsed = readJsonFile(path.join(taskDir, name));
  const blockers = [];
  const assertionIds = [];

  if (!parsed.ok) {
    blockers.push(parsed.status === 'invalid-json' ? `invalid-json:${name}` : `missing-task-artifact:${name}`);
    return {
      name,
      path: path.join(relativeTaskPath, name),
      ok: false,
      blockers,
      assertion_ids: assertionIds
    };
  }
  if (!isPlainObject(parsed.value)) {
    blockers.push(`invalid-json-shape:${name}`);
    return {
      name,
      path: path.join(relativeTaskPath, name),
      ok: false,
      blockers,
      assertion_ids: assertionIds
    };
  }

  const value = parsed.value;
  const topLevelKeys = [
    'schema',
    'generated_by',
    'task_id',
    'generated_at',
    'recorded_at',
    'status',
    'reviewed_git_head',
    'reviewed_git_tree',
    'implementation_scope',
    'artifacts',
    'test_runs',
    'assertions',
    'fallback_used'
  ];
  if (!exactObjectKeys(value, topLevelKeys)) {
    blockers.push('invalid-task-acceptance:closed-schema');
  }
  if (value.schema !== 'specnav.task-acceptance-evidence.v2') blockers.push('invalid-task-acceptance:schema');
  if (value.generated_by !== 'specnav-development/task-acceptance-evidence') {
    blockers.push('invalid-task-acceptance:generated_by');
  }
  if (value.task_id !== taskId) blockers.push('invalid-task-acceptance:task_id');
  if (value.status !== 'approved') blockers.push('invalid-task-acceptance:status');
  if (value.fallback_used !== false) blockers.push('invalid-task-acceptance:fallback_used');
  for (const field of ['generated_at', 'recorded_at']) {
    if (!isCleanString(value[field]) || Number.isNaN(Date.parse(value[field]))) {
      blockers.push(`invalid-task-acceptance:${field}`);
    }
  }

  const gitObjectPattern = /^[0-9a-f]{40}$/;
  if (!gitObjectPattern.test(String(value.reviewed_git_head))) {
    blockers.push('invalid-task-acceptance:reviewed_git_head');
  }
  if (!gitObjectPattern.test(String(value.reviewed_git_tree))) {
    blockers.push('invalid-task-acceptance:reviewed_git_tree');
  }
  const reviewedTree = gitObjectPattern.test(String(value.reviewed_git_head))
    ? developmentGit(projectRoot, ['rev-parse', `${value.reviewed_git_head}^{tree}`])
    : null;
  if (reviewedTree !== value.reviewed_git_tree) {
    blockers.push('task-acceptance:reviewed-tree-mismatch');
  }
  const currentHead = developmentGit(projectRoot, ['rev-parse', 'HEAD']);
  if (
    currentHead === null
    || developmentGit(projectRoot, [
      'merge-base',
      '--is-ancestor',
      value.reviewed_git_head,
      currentHead
    ]) === null
  ) {
    blockers.push('task-acceptance:reviewed-head-not-ancestor');
  }
  if (currentHead !== null && gitObjectPattern.test(String(value.reviewed_git_head))) {
    const committedChanges = developmentGit(projectRoot, [
      'diff',
      '--name-only',
      `${value.reviewed_git_head}..${currentHead}`,
      '--'
    ]);
    if (committedChanges === null) {
      blockers.push('task-acceptance:git-diff-unavailable');
    } else {
      for (const relativePath of committedChanges.split(/\r?\n/).filter(Boolean)) {
        if (!developmentLifecyclePath(relativePath, path.basename(changeDir))) {
          blockers.push(`task-acceptance:implementation-changed-after-review:${relativePath}`);
        }
      }
    }
  }
  const dirtyPaths = unique([
    ...(developmentGit(projectRoot, ['diff', '--name-only', 'HEAD', '--']) || '').split(/\r?\n/),
    ...(developmentGit(projectRoot, ['ls-files', '--others', '--exclude-standard']) || '').split(/\r?\n/)
  ]).filter(Boolean);
  for (const relativePath of dirtyPaths) {
    if (!developmentLifecyclePath(relativePath, path.basename(changeDir))) {
      blockers.push(`task-acceptance:dirty-implementation-scope:${relativePath}`);
    }
  }

  const contextParsed = readJsonFile(path.join(taskDir, 'context.json'));
  const context = contextParsed.ok && isPlainObject(contextParsed.value)
    ? contextParsed.value
    : null;
  const expectedScope = context && gitObjectPattern.test(String(value.reviewed_git_head))
    ? implementationScopeAtRef(
      projectRoot,
      path.basename(changeDir),
      context,
      value.reviewed_git_head
    )
    : null;
  if (
    expectedScope === null
    || !isPlainObject(value.implementation_scope)
    || JSON.stringify(canonicalAcceptanceScope(value.implementation_scope))
      !== JSON.stringify(canonicalAcceptanceScope(expectedScope))
  ) {
    blockers.push('task-acceptance:implementation-scope-mismatch');
  }

  const taskPrefix = `development/tasks/${taskId}`;
  const artifactDefinitions = {
    context: { path: `${taskPrefix}/context.json`, heading: null, expected: null },
    report: { path: `${taskPrefix}/report.md`, heading: 'Status', expected: 'DONE' },
    spec_review: {
      path: `${taskPrefix}/spec-review.md`,
      heading: 'Verdict',
      expected: 'approved'
    },
    quality_review: {
      path: `${taskPrefix}/quality-review.md`,
      heading: 'Verdict',
      expected: 'approved'
    }
  };
  if (
    !exactObjectKeys(value.artifacts, Object.keys(artifactDefinitions))
  ) {
    blockers.push('invalid-task-acceptance:artifacts');
  } else {
    for (const [field, definition] of Object.entries(artifactDefinitions)) {
      const binding = value.artifacts[field];
      const expectedKeys = definition.heading
        ? ['path', 'sha256', definition.heading.toLowerCase()]
        : ['path', 'sha256'];
      if (
        !exactObjectKeys(binding, expectedKeys)
        || binding.path !== definition.path
      ) {
        blockers.push(`invalid-task-acceptance:artifact:${field}`);
        continue;
      }
      const file = path.join(changeDir, definition.path);
      if (statKind(file) !== 'file') {
        blockers.push(`task-acceptance:missing-artifact:${field}`);
        continue;
      }
      const content = fs.readFileSync(file);
      if (binding.sha256 !== sha256Value(content)) {
        blockers.push(`task-acceptance:artifact-digest-mismatch:${field}`);
      }
      if (definition.heading) {
        const text = content.toString('utf8');
        const parsedHeadings = parseMarkdownHeadings(text);
        const heading = findHeading(parsedHeadings, definition.heading);
        const actual = heading ? firstSubstantiveValue(parsedHeadings, heading) : null;
        if (actual !== definition.expected || binding[definition.heading.toLowerCase()] !== actual) {
          blockers.push(`task-acceptance:artifact-verdict-mismatch:${field}`);
        }
      }
    }
  }

  const validationLog = readTextFile(path.join(
    changeDir,
    'development',
    'validation-log.jsonl'
  ));
  const validationReceipts = new Map();
  if (!validationLog.ok) {
    blockers.push('task-acceptance:validation-log-missing');
  } else {
    validationLog.value.split(/\r?\n/).forEach((raw, index) => {
      if (!raw.trim()) return;
      try {
        const entry = JSON.parse(raw);
        if (isCleanString(entry.receipt_id)) {
          if (validationReceipts.has(entry.receipt_id)) {
            blockers.push(`task-acceptance:duplicate-receipt-id:${entry.receipt_id}`);
          } else {
            validationReceipts.set(entry.receipt_id, {
              entry,
              raw,
              line: index + 1
            });
          }
        }
      } catch {
        blockers.push(`task-acceptance:invalid-validation-log:${index + 1}`);
      }
    });
  }

  const declaredAssertionIds = context ? taskAcceptanceAssertionIds(context) : [];
  const declaredAssertionSet = new Set(declaredAssertionIds);
  const testRuns = new Map();
  if (!Array.isArray(value.test_runs) || value.test_runs.length === 0) {
    blockers.push('invalid-task-acceptance:test_runs');
  } else {
    for (const testRun of value.test_runs) {
      if (
        !exactObjectKeys(testRun, [
          'id',
          'command',
          'assertion_ids',
          'recorded_at',
          'validation_receipt_sha256',
          'evidence_log'
        ])
        || !isCleanString(testRun.id)
      ) {
        blockers.push('invalid-task-acceptance:test-run');
        continue;
      }
      if (testRuns.has(testRun.id)) {
        blockers.push(`task-acceptance:duplicate-test-run-id:${testRun.id}`);
        continue;
      }
      testRuns.set(testRun.id, testRun);
      const receipt = validationReceipts.get(testRun.id);
      if (!receipt) {
        blockers.push(`task-acceptance:missing-validation-receipt:${testRun.id}`);
        continue;
      }
      const entry = receipt.entry;
      const trustedReceipt = receiptAuthority
        && typeof receiptAuthority.verify === 'function'
        && receiptAuthority.verify(entry);
      const normalizedAssertions = Array.isArray(testRun.assertion_ids)
        ? unique(testRun.assertion_ids)
        : [];
      if (
        !trustedReceipt
        || entry.task !== taskId
        || entry.command !== testRun.command
        || entry.status !== 'pass'
        || entry.ok !== true
        || entry.exit_status !== 0
        || entry.attestation !== 'system-executed'
        || entry.overturned === true
        || entry.reviewed_git_head !== value.reviewed_git_head
        || entry.reviewed_git_tree !== value.reviewed_git_tree
        || entry.recorded_at !== testRun.recorded_at
        || JSON.stringify(entry.assertion_ids) !== JSON.stringify(testRun.assertion_ids)
        || normalizedAssertions.length !== testRun.assertion_ids.length
        || normalizedAssertions.some((id) => !declaredAssertionSet.has(id))
      ) {
        blockers.push(`task-acceptance:validation-receipt-mismatch:${testRun.id}`);
      }
      if (testRun.validation_receipt_sha256 !== sha256Value(Buffer.from(receipt.raw))) {
        blockers.push(`task-acceptance:validation-receipt-digest-mismatch:${testRun.id}`);
      }
      const expectedEvidence = resolveTaskEvidence(
        projectRoot,
        changeDir,
        entry.evidence_log
      );
      if (
        expectedEvidence === null
        || entry.evidence_log_sha256 !== expectedEvidence.sha256
        || entry.evidence_log_size !== expectedEvidence.size
      ) {
        blockers.push(`task-acceptance:signed-evidence-mismatch:${testRun.id}`);
      }
      if (!sameEvidenceBinding(expectedEvidence, testRun.evidence_log)) {
        blockers.push(`task-acceptance:test-run-evidence-mismatch:${testRun.id}`);
      }
    }
  }

  if (!Array.isArray(value.assertions) || value.assertions.length === 0) {
    blockers.push('invalid-task-acceptance:assertions');
  } else {
    const seenIds = new Set();
    const referencedTestRuns = new Set();
    for (const assertion of value.assertions) {
      if (
        !exactObjectKeys(assertion, [
          'id',
          'parent_id',
          'status',
          'test_run_ids',
          'direct_evidence',
          'reused_evidence',
          'claim'
        ])
        || !isCleanString(assertion.id)
      ) {
        blockers.push('invalid-task-acceptance:assertion-id');
        continue;
      }

      const assertionId = assertion.id;
      assertionIds.push(assertionId);
      if (seenIds.has(assertionId)) {
        blockers.push(`task-acceptance:duplicate-assertion-id:${assertionId}`);
      }
      seenIds.add(assertionId);

      if (assertion.status !== 'passing') {
        blockers.push(`task-acceptance:non-passing:${assertionId}`);
      }
      if (assertion.parent_id !== assertionId.split(':', 1)[0]) {
        blockers.push(`invalid-task-acceptance:${assertionId}:parent_id`);
      }
      if (!isCleanString(assertion.claim)) {
        blockers.push(`invalid-task-acceptance:${assertionId}:claim`);
      }
      if (
        !Array.isArray(assertion.test_run_ids)
        || assertion.test_run_ids.length === 0
        || unique(assertion.test_run_ids).length !== assertion.test_run_ids.length
      ) {
        blockers.push(`invalid-task-acceptance:${assertionId}:test_run_ids`);
      } else {
        for (const testRunId of assertion.test_run_ids) {
          referencedTestRuns.add(testRunId);
          const testRun = testRuns.get(testRunId);
          if (
            !testRun
            || !Array.isArray(testRun.assertion_ids)
            || !testRun.assertion_ids.includes(assertionId)
          ) {
            blockers.push(
              `task-acceptance:test-run-assertion-mismatch:${assertionId}:${testRunId}`
            );
          }
        }
      }
      for (const field of ['direct_evidence', 'reused_evidence']) {
        if (!Array.isArray(assertion[field])) {
          blockers.push(`invalid-task-acceptance:${assertionId}:${field}`);
        }
      }
      for (const evidence of Array.isArray(assertion.direct_evidence)
        ? assertion.direct_evidence
        : []) {
        const expected = isPlainObject(evidence)
          ? resolveTaskEvidence(projectRoot, changeDir, evidence.path)
          : null;
        if (!sameEvidenceBinding(expected, evidence)) {
          blockers.push(`task-acceptance:direct-evidence-mismatch:${assertionId}`);
        }
      }
      for (const evidence of Array.isArray(assertion.reused_evidence)
        ? assertion.reused_evidence
        : []) {
        if (
          !isPlainObject(evidence)
          || !isValidTaskId(evidence.task_id)
          || !sameEvidenceBinding(
            resolveTaskEvidence(projectRoot, changeDir, evidence.path),
            {
              path: evidence.path,
              sha256: evidence.sha256,
              size: evidence.size
            }
          )
        ) {
          blockers.push(`task-acceptance:reused-evidence-mismatch:${assertionId}`);
        }
      }
    }
    const actualAssertionIds = [...seenIds].sort();
    const expectedAssertionIds = [...declaredAssertionSet].sort();
    if (JSON.stringify(actualAssertionIds) !== JSON.stringify(expectedAssertionIds)) {
      blockers.push('task-acceptance:assertion-set-mismatch');
    }
    for (const testRunId of testRuns.keys()) {
      if (!referencedTestRuns.has(testRunId)) {
        blockers.push(`task-acceptance:unreferenced-test-run:${testRunId}`);
      }
    }
  }

  return {
    name,
    path: path.join(relativeTaskPath, name),
    ok: blockers.length === 0,
    blockers: unique(blockers),
    assertion_ids: unique(assertionIds)
  };
}

function validateVerdictFile(taskDir, relativeTaskPath, name, acceptanceIds) {
  const text = readTextFile(path.join(taskDir, name));
  const blockers = [];
  const type = name === 'spec-review.md' ? 'spec-review' : 'quality-review';

  if (!text.ok) {
    blockers.push(`missing-task-artifact:${name}`);
    return { name, path: path.join(relativeTaskPath, name), ok: false, blockers };
  }
  if (text.value.trim() === '') blockers.push(`empty-task-artifact:${name}`);
  blockers.push(...scaffoldBlockersForText(text.value, name));

  const parsed = parseMarkdownHeadings(text.value);
  const requiredHeadings = type === 'spec-review'
    ? SPEC_REVIEW_REQUIRED_HEADINGS
    : QUALITY_REVIEW_REQUIRED_HEADINGS;
  blockers.push(...validateRequiredHeadings(text.value, requiredHeadings, `invalid-${type}`));

  const verdictHeading = findHeading(parsed, 'Verdict');
  let verdict = null;
  if (!verdictHeading) {
    blockers.push(`invalid-${type}:missing-verdict`);
  } else {
    verdict = firstSubstantiveValue(parsed, verdictHeading);
    if (!HANDOFF_REVIEW_VERDICTS.has(verdict)) blockers.push(`invalid-${type}:verdict`);
  }

  // Both independent reviews must cover the exact task-level assertion set.
  // Parent acceptance, partial citation, and an unbound quality verdict cannot
  // approve a task handoff.
  if (acceptanceIds && acceptanceIds.size > 0 && verdict === 'approved') {
    const assertionsHeading = findHeading(parsed, 'Acceptance Assertions Verified');
    if (!assertionsHeading) {
      blockers.push('review:unsupported-verdict');
    } else {
      const body = headingBodyLines(parsed, assertionsHeading).join('\n');
      const assertionPrefixes = new Set(
        [...acceptanceIds]
          .map((id) => String(id).replace(/\d+$/, ''))
          .filter(Boolean)
      );
      const assertionIdPattern = /\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+|[A-Z][A-Z0-9]*\d+)(?::[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?\b/g;
      const cited = Array.from(new Set(
        (body.match(assertionIdPattern) || [])
          .filter((id) => assertionPrefixes.has(id.replace(/\d+$/, '')))
      ));
      for (const id of cited) {
        if (!acceptanceIds.has(id)) blockers.push(`review:invalid-reference:${id}`);
      }
      const expected = [...acceptanceIds].sort();
      const actual = cited.filter((id) => acceptanceIds.has(id)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        blockers.push('review:assertion-coverage-mismatch');
      }
    }
  }

  return { name, path: path.join(relativeTaskPath, name), ok: blockers.length === 0, blockers: unique(blockers) };
}

function validateTaskDir(
  projectRoot,
  changeDir,
  developmentDir,
  activeChange,
  dirName,
  mode,
  requiredMustRead,
  receiptAuthority
) {
  const taskDir = path.join(developmentDir, 'tasks', dirName);
  const relativeTaskPath = artifactPath(activeChange, path.join('tasks', dirName), true);
  const requiredBriefPath = artifactPath(activeChange, path.join('tasks', dirName, 'brief.md'), true);
  const taskRequiredMustRead = unique([requiredBriefPath, ...requiredMustRead]);
  const blockers = [];
  const artifacts = [];

  if (!isValidTaskId(dirName)) {
    blockers.push(`invalid-task-dir-name:${dirName}`);
  }

  const validators = [
    () => validateTaskBrief(taskDir, relativeTaskPath),
    () => validateTaskContext(taskDir, relativeTaskPath, dirName, taskRequiredMustRead)
  ];

  if (mode === 'handoff') {
    const acceptance = validateTaskAcceptance(
      projectRoot,
      changeDir,
      taskDir,
      relativeTaskPath,
      dirName,
      receiptAuthority
    );
    const acceptanceIds = new Set(acceptance.assertion_ids);
    artifacts.push(acceptance);
    blockers.push(...acceptance.blockers);
    validators.push(
      () => validateReport(taskDir, relativeTaskPath),
      () => validateVerdictFile(taskDir, relativeTaskPath, 'spec-review.md', acceptanceIds),
      () => validateVerdictFile(taskDir, relativeTaskPath, 'quality-review.md', acceptanceIds)
    );
  }

  for (const validate of validators) {
    const result = validate();
    artifacts.push(result);
    blockers.push(...result.blockers);
  }

  const requiredTaskFiles = mode === 'entry' ? TASK_ENTRY_FILES : TASK_HANDOFF_FILES;
  for (const file of requiredTaskFiles) {
    if (!artifacts.some((artifact) => artifact.name === file)) {
      blockers.push(`missing-task-artifact:${file}`);
    }
  }

  return {
    task_id: dirName,
    path: relativeTaskPath,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    artifacts
  };
}

function listTaskDirs(developmentDir) {
  const tasksDir = path.join(developmentDir, 'tasks');
  try {
    return fs.readdirSync(tasksDir)
      .filter((name) => statKind(path.join(tasksDir, name)) === 'directory')
      .sort();
  } catch {
    return null;
  }
}

function taskGraphNodeIds(graph) {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return null;
  }

  const ids = [];
  for (const node of graph.nodes) {
    const id = typeof node === 'string'
      ? node
      : (isPlainObject(node) ? node.id : null);
    if (!isCleanString(id) || !isValidTaskId(id)) return null;
    ids.push(id);
  }
  return unique(ids);
}

function normalizedTaskItemIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => (
    typeof entry === 'string' ? entry.trim() : ''
  ));
  if (
    ids.length === 0
    || ids.some((entry) => !TASK_ITEM_ID_PATTERN.test(entry))
    || new Set(ids).size !== ids.length
  ) {
    return null;
  }
  return [...ids].sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true
  }));
}

function sameTaskItemIds(left, right) {
  const normalizedLeft = normalizedTaskItemIds(left);
  const normalizedRight = normalizedTaskItemIds(right);
  return normalizedLeft !== null
    && normalizedRight !== null
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function validateTaskItemOwnership(
  changeDir,
  developmentDir,
  activeChange,
  taskIds,
  manifest
) {
  const name = 'task-item-ownership';
  const blockers = [];
  const tasksText = readTextFile(path.join(changeDir, 'tasks.md'));
  const checklistItems = tasksText.ok ? parseTaskItems(tasksText.value) : [];
  const checklistIds = [];
  for (const item of checklistItems) {
    if (!item.task_id) {
      blockers.push(`task-item-ownership:checklist-id-missing:line-${item.line}`);
      continue;
    }
    if (!TASK_ITEM_ID_PATTERN.test(item.task_id)) {
      blockers.push(`task-item-ownership:checklist-id-invalid:${item.task_id}`);
      continue;
    }
    checklistIds.push(item.task_id);
  }
  for (const duplicate of checklistIds.filter(
    (id, index) => checklistIds.indexOf(id) !== index
  )) {
    blockers.push(`task-item-ownership:checklist-id-duplicate:${duplicate}`);
  }

  const graph = manifest.present && manifest.ok
    ? manifest.value.task_graph
    : readJsonFile(path.join(developmentDir, 'task-graph.json')).value;
  const graphNodes = isPlainObject(graph) && Array.isArray(graph.nodes)
    ? graph.nodes
    : [];
  if (graphNodes.length === 0) {
    blockers.push('task-item-ownership:task-graph-unavailable');
  }

  const contextLog = parseJsonl(
    path.join(developmentDir, 'task-context.jsonl'),
    'task-context.jsonl'
  );
  blockers.push(...contextLog.blockers.map(
    (blocker) => `task-item-ownership:${blocker}`
  ));
  const contextRows = new Map();
  for (const row of contextLog.entries) {
    if (!isCleanString(row.task_id)) continue;
    if (contextRows.has(row.task_id)) {
      blockers.push(`task-item-ownership:duplicate-context-row:${row.task_id}`);
      continue;
    }
    contextRows.set(row.task_id, row);
  }

  const formalTasks = new Set(taskIds);
  const graphTaskIds = new Set();
  const owners = new Map();
  for (const node of graphNodes) {
    if (!isPlainObject(node) || !isCleanString(node.id)) {
      blockers.push('task-item-ownership:invalid-graph-node');
      continue;
    }
    const taskId = node.id;
    graphTaskIds.add(taskId);
    if (!formalTasks.has(taskId)) {
      blockers.push(`task-item-ownership:graph-task-not-formal:${taskId}`);
    }
    const graphItems = normalizedTaskItemIds(node.task_items);
    if (graphItems === null) {
      blockers.push(`task-item-ownership:invalid-graph-task-items:${taskId}`);
      continue;
    }

    const contextFile = readJsonFile(path.join(
      developmentDir,
      'tasks',
      taskId,
      'context.json'
    ));
    if (
      !contextFile.ok
      || !isPlainObject(contextFile.value)
      || !sameTaskItemIds(graphItems, contextFile.value.task_items)
    ) {
      blockers.push(`task-item-ownership:context-mismatch:${taskId}`);
    }

    const contextRow = contextRows.get(taskId);
    if (!contextRow || !sameTaskItemIds(graphItems, contextRow.task_items)) {
      blockers.push(`task-item-ownership:context-log-mismatch:${taskId}`);
    }

    for (const itemId of graphItems) {
      if (!owners.has(itemId)) owners.set(itemId, []);
      owners.get(itemId).push(taskId);
    }
  }

  for (const taskId of formalTasks) {
    if (!graphTaskIds.has(taskId)) {
      blockers.push(`task-item-ownership:formal-task-missing-from-graph:${taskId}`);
    }
    if (!contextRows.has(taskId)) {
      blockers.push(`task-item-ownership:formal-task-missing-context-row:${taskId}`);
    }
  }
  for (const taskId of contextRows.keys()) {
    if (!formalTasks.has(taskId)) {
      blockers.push(`task-item-ownership:orphan-context-row:${taskId}`);
    }
  }

  const checklistSet = new Set(checklistIds);
  for (const itemId of checklistSet) {
    const itemOwners = owners.get(itemId) || [];
    if (itemOwners.length === 0) {
      blockers.push(`task-item-ownership:unowned-checklist-item:${itemId}`);
    } else if (itemOwners.length > 1) {
      blockers.push(
        `task-item-ownership:multiple-primary-owners:${itemId}:${itemOwners.join(',')}`
      );
    }
  }
  for (const [itemId, itemOwners] of owners) {
    if (!checklistSet.has(itemId)) {
      blockers.push(
        `task-item-ownership:unknown-owned-item:${itemId}:${itemOwners.join(',')}`
      );
    }
  }

  return artifactResult(activeChange, name, unique(blockers), true, {
    checkbox_count: checklistSet.size,
    formal_task_count: formalTasks.size,
    owned_item_count: owners.size,
    context_row_count: contextRows.size
  });
}

function plannedTaskIds(developmentDir, manifest) {
  if (manifest.present) {
    if (!manifest.ok) return null;
    return taskGraphNodeIds(manifest.value.task_graph);
  }

  const parsed = readJsonFile(path.join(developmentDir, 'task-graph.json'));
  if (!parsed.ok) return null;
  return taskGraphNodeIds(parsed.value);
}

function validateRepairIncident(changeDir, activeChange, dirName, context) {
  const relativeTaskPath = artifactPath(activeChange, path.join('tasks', dirName), true);
  const blockers = [];
  const value = context.value;

  if (!context.ok || !isPlainObject(value)) {
    blockers.push(`invalid-repair-incident-context:${dirName}:${context.status}`);
  } else {
    if (value.schema !== REPAIR_TASK_SCHEMA) blockers.push(`invalid-repair-incident:${dirName}:schema`);
    if (value.id !== dirName) blockers.push(`invalid-repair-incident:${dirName}:id`);
    if (value.change_id !== activeChange) blockers.push(`invalid-repair-incident:${dirName}:change_id`);
    if (!REPAIR_CLASSIFICATIONS.has(value.classification)) {
      blockers.push(`invalid-repair-incident:${dirName}:classification`);
    }
    if (value.owner !== 'development') blockers.push(`invalid-repair-incident:${dirName}:owner`);
    if (value.packet_path !== `development/tasks/${dirName}`) {
      blockers.push(`invalid-repair-incident:${dirName}:packet_path`);
    }
    if (
      !Array.isArray(value.packet_artifacts)
      || value.packet_artifacts.length !== REPAIR_PACKET_ARTIFACTS.size
      || new Set(value.packet_artifacts).size !== REPAIR_PACKET_ARTIFACTS.size
      || value.packet_artifacts.some((name) => !REPAIR_PACKET_ARTIFACTS.has(name))
    ) {
      blockers.push(`invalid-repair-incident:${dirName}:packet_artifacts`);
    }
    if (
      !Array.isArray(value.required_reviews)
      || value.required_reviews.length !== 2
      || new Set(value.required_reviews).size !== 2
      || !value.required_reviews.includes('spec-review')
      || !value.required_reviews.includes('quality-review')
    ) {
      blockers.push(`invalid-repair-incident:${dirName}:required_reviews`);
    }
    if (
      !isPlainObject(value.ownership)
      || Object.entries(REPAIR_OWNERSHIP).some(([field, owner]) => value.ownership[field] !== owner)
    ) {
      blockers.push(`invalid-repair-incident:${dirName}:ownership`);
    }
    if (
      !isPlainObject(value.frozen_failure)
      || !isCleanString(value.frozen_failure.failure_packet_id)
      || !isCleanString(value.frozen_failure.run_id)
      || !isCleanString(value.frozen_failure.case_id)
      || !isCleanString(value.frozen_failure.attempt_id)
    ) {
      blockers.push(`invalid-repair-incident:${dirName}:frozen_failure`);
    }
  }

  const failureId = isPlainObject(value?.frozen_failure)
    && isCleanString(value.frozen_failure.failure_packet_id)
    ? value.frozen_failure.failure_packet_id
    : null;
  const repairStatePath = failureId
    ? path.join(changeDir, 'verify', 'repairs', failureId, 'repair-state.json')
    : null;
  const repairState = repairStatePath ? readJsonFile(repairStatePath) : null;
  const lifecycleStatus = repairState?.ok && isPlainObject(repairState.value)
    ? repairState.value.status || 'unknown'
    : 'missing';

  return {
    task_id: dirName,
    kind: 'verification_repair_incident',
    schema: value?.schema || null,
    path: relativeTaskPath,
    ok: blockers.length === 0,
    blockers: unique(blockers),
    classification: value?.classification || null,
    owner: value?.owner || null,
    incident_status: value?.status || null,
    failure_id: failureId,
    lifecycle_status: lifecycleStatus,
    open: lifecycleStatus !== 'closed',
    governed_by: 'verification-repair-loop'
  };
}

function classifyTaskDirs(changeDir, developmentDir, activeChange, taskDirs, plannedIds) {
  const planned = new Set(plannedIds || []);
  const present = new Set(taskDirs || []);
  const tasks = [];
  const repairIncidents = [];
  const blockers = [];

  for (const taskId of planned) {
    if (!present.has(taskId)) blockers.push(`missing-planned-development-task:${taskId}`);
  }

  for (const dirName of taskDirs || []) {
    if (planned.has(dirName)) {
      tasks.push(dirName);
      continue;
    }

    const context = readJsonFile(path.join(developmentDir, 'tasks', dirName, 'context.json'));
    if (context.ok && isPlainObject(context.value) && context.value.schema === REPAIR_TASK_SCHEMA) {
      const incident = validateRepairIncident(changeDir, activeChange, dirName, context);
      repairIncidents.push(incident);
      blockers.push(...incident.blockers);
      continue;
    }

    blockers.push(`unplanned-development-task-dir:${dirName}`);
  }

  return {
    tasks,
    repair_incidents: repairIncidents,
    blockers: unique(blockers)
  };
}

function validateDevelopment(root = lib.projectRoot(), options = {}) {
  const projectRoot = path.resolve(root);
  const mode = VALID_MODES.has(options.mode) ? options.mode : DEFAULT_MODE;
  const prototype = validatePrototype(projectRoot);

  if (!prototype.ok) {
    const activeChange = prototype.active_change || null;
    const changeDir = activeChange ? lib.changeDir(projectRoot, activeChange) : null;
    return {
      ok: false,
      project_root: projectRoot,
      mode,
      active_change: activeChange,
      change_dir: changeDir,
      development_dir: changeDir ? path.join(changeDir, 'development') : null,
      blockers: unique(['prototype-blocked', ...(prototype.blockers || []).map((blocker) => `prototype:${blocker}`)]),
      warnings: [],
      codegraph: null,
      prototype,
      artifacts: [],
      tasks: [],
      repair_incidents: []
    };
  }

  const activeChange = prototype.active_change;
  const changeDir = lib.changeDir(projectRoot, activeChange);
  const developmentDir = path.join(changeDir, 'development');
  const lane = lib.readLane(changeDir).lane;
  if (lane === 'light') {
    return validateLightDevelopment(projectRoot, mode, prototype, activeChange, changeDir, developmentDir);
  }

  const artifacts = [];
  const tasks = [];
  const repairIncidents = [];
  const blockers = [];
  let receiptAuthority = options.receiptAuthority || null;
  if (mode === 'handoff' && !receiptAuthority) {
    try {
      receiptAuthority = resolveManagedValidationReceiptAuthority({
        projectRoot,
        changeDir
      });
    } catch (error) {
      blockers.push(
        `task-acceptance:receipt-authority-unavailable:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const approvalBinding = validatePrototypeApprovalBinding(projectRoot, activeChange);
  const requiredReferences = requiredSourcePaths(activeChange, approvalBinding.approved_source_path);

  artifacts.push(validateUpstreamContracts(projectRoot, activeChange, prototype));
  artifacts.push(approvalBinding.artifact);
  artifacts.push(validateScope(projectRoot, changeDir, activeChange, approvalBinding));
  artifacts.push(validateTasksMarkdown(changeDir, activeChange, mode));
  artifacts.push(validateGitBaseline(projectRoot, changeDir, developmentDir, activeChange));

  // development/manifest.json may carry the entry planning sections
  // (before_dev_check, promotion_map, complexity_budget, task_graph,
  // code_owner_map, extraction_map) in ONE file; the legacy per-file set
  // remains accepted for in-flight changes.
  const manifest = readDevelopmentManifest(developmentDir);
  if (manifest.present) {
    artifacts.push(validateManifestSections(developmentDir, activeChange, manifest));
    artifacts.push(validateBasis(developmentDir, activeChange, requiredReferences));
  } else {
    artifacts.push(validateBeforeDevCheck(developmentDir, activeChange));
    artifacts.push(validateBasis(developmentDir, activeChange, requiredReferences));
    artifacts.push(validatePromotionMap(developmentDir, activeChange));

    for (const name of ['complexity-budget.json', 'task-graph.json', 'code-owner-map.json', 'extraction-map.json']) {
      artifacts.push(validateSubstantiveObjectArtifact(developmentDir, activeChange, name));
    }
  }

  const taskDirs = listTaskDirs(developmentDir);
  if (taskDirs === null) {
    blockers.push('missing-development-tasks-dir');
  } else if (taskDirs.length === 0) {
    blockers.push('missing-development-task-dir');
  } else {
    const plannedIds = plannedTaskIds(developmentDir, manifest);
    if (plannedIds === null) {
      blockers.push('development-task-ownership:task-graph-unavailable');
    }
    const classified = classifyTaskDirs(
      changeDir,
      developmentDir,
      activeChange,
      taskDirs,
      plannedIds
    );
    blockers.push(...classified.blockers);
    repairIncidents.push(...classified.repair_incidents);
    for (const dirName of classified.tasks) {
      tasks.push(validateTaskDir(
        projectRoot,
        changeDir,
        developmentDir,
        activeChange,
        dirName,
        mode,
        requiredReferences,
        receiptAuthority
      ));
    }
  }

  const taskIds = tasks.map((task) => task.task_id);
  artifacts.push(validateTaskItemOwnership(
    changeDir,
    developmentDir,
    activeChange,
    taskIds,
    manifest
  ));
  artifacts.push(validateTaskContextLog(developmentDir, activeChange));
  const acceptanceArtifact = validateAcceptanceAssertions(changeDir, activeChange);
  if (acceptanceArtifact) artifacts.push(acceptanceArtifact);
  blockers.push(...validateLaneEscalation(projectRoot, changeDir));
  const loops = detectTaskLoops(developmentDir);
  for (const loop of loops) {
    if (loop.triggers.includes('same-blocker')) {
      blockers.push(`loop-detected:${loop.task_id}`);
    }
    if (loop.triggers.includes('attempt-budget')) {
      blockers.push(`attempt-budget-exhausted:${loop.task_id}`);
    }
  }
  if (mode === 'handoff') {
    const migrations = validateMigrations(developmentDir, changeDir, activeChange);
    artifacts.push(...migrations.artifacts);
    artifacts.push(validateTaskLedger(developmentDir, activeChange, taskIds));
    artifacts.push(validateDriftCheck(developmentDir, activeChange));
    artifacts.push(validateValidationLog(
      projectRoot,
      developmentDir,
      activeChange,
      receiptAuthority
    ));
    artifacts.push(validateHandoffToVerify(developmentDir, activeChange));
  }

  for (const name of CHANGE_ARTIFACTS) {
    if (!artifacts.some((artifact) => artifact.name === name)) {
      artifacts.push(artifactResult(activeChange, name, [`missing-development-artifact:${name}`]));
    }
  }
  // manifest.json subsumes the per-file entry planning set.
  const manifestCovered = manifest.present ? new Set(Object.values(MANIFEST_SECTIONS)) : new Set();
  const requiredDevelopmentArtifacts = (mode === 'entry' ? DEVELOPMENT_ENTRY_ARTIFACTS : DEVELOPMENT_HANDOFF_ARTIFACTS)
    .filter((name) => !manifestCovered.has(name));
  for (const name of requiredDevelopmentArtifacts) {
    if (!artifacts.some((artifact) => artifact.name === name)) {
      artifacts.push(artifactResult(activeChange, name, [`missing-development-artifact:${name}`], true));
    }
  }

  blockers.push(...artifacts.flatMap((artifact) => artifact.blockers));
  blockers.push(...tasks.flatMap((task) => task.blockers));
  const codegraph = codegraphStageGuard(projectRoot, activeChange, 'development');
  blockers.push(...codegraphBlockers(codegraph));
  const warnings = unique(codegraphWarnings(codegraph));

  return {
    ok: blockers.length === 0,
    project_root: projectRoot,
    mode,
    active_change: activeChange,
    change_dir: changeDir,
    development_dir: developmentDir,
    blockers: unique(blockers),
    warnings,
    loops,
    codegraph,
    prototype,
    artifacts,
    tasks,
    repair_incidents: repairIncidents
  };
}

function markdown(result) {
  const lines = [];
  lines.push('# SpecNav Development Contract');
  lines.push('');
  lines.push(`- project: \`${result.project_root}\``);
  lines.push(`- mode: \`${result.mode || DEFAULT_MODE}\``);
  lines.push(`- active change: \`${result.active_change || 'none'}\``);
  lines.push(`- change dir: \`${result.change_dir || 'none'}\``);
  lines.push(`- development dir: \`${result.development_dir || 'none'}\``);
  lines.push(`- ok: ${result.ok}`);
  if (result.blockers.length) lines.push(`- blockers: ${result.blockers.join(', ')}`);
  if (Array.isArray(result.warnings) && result.warnings.length) lines.push(`- warnings: ${result.warnings.join(', ')}`);
  lines.push('');
  lines.push('| Artifact | Status | Blockers |');
  lines.push('| --- | --- | --- |');
  for (const artifact of result.artifacts) {
    lines.push(`| ${artifact.name} | ${artifact.ok ? 'pass' : 'blocked'} | ${artifact.blockers.join('<br>') || '-'} |`);
  }
  lines.push('');
  lines.push('| Task | Status | Blockers |');
  lines.push('| --- | --- | --- |');
  for (const task of result.tasks) {
    lines.push(`| ${task.task_id} | ${task.ok ? 'pass' : 'blocked'} | ${task.blockers.join('<br>') || '-'} |`);
  }
  if (Array.isArray(result.repair_incidents) && result.repair_incidents.length > 0) {
    lines.push('');
    lines.push('| Repair Incident | Classification | Lifecycle | Owner | Contract |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const incident of result.repair_incidents) {
      lines.push(`| ${incident.task_id} | ${incident.classification || '-'} | ${incident.lifecycle_status} | ${incident.governed_by} | ${incident.ok ? 'valid' : incident.blockers.join('<br>')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// Context is a budget: default output is the decision (ok/blockers), the full
// artifact table stays behind --verbose. Blockers are already self-locating
// (`invalid-x:file:detail`), so the compact form loses no repair information.
function toCompact(result) {
  return {
    ok: result.ok,
    mode: result.mode,
    lane: result.lane || 'standard',
    ...(result.light_format ? { light_format: result.light_format } : {}),
    active_change: result.active_change,
    blockers: result.blockers,
    warnings: result.warnings || [],
    loops: Array.isArray(result.loops) ? result.loops : [],
    task_count: Array.isArray(result.tasks) ? result.tasks.length : 0,
    repair_incidents: Array.isArray(result.repair_incidents)
      ? result.repair_incidents.map((incident) => ({
        task_id: incident.task_id,
        classification: incident.classification,
        lifecycle_status: incident.lifecycle_status,
        open: incident.open,
        governed_by: incident.governed_by
      }))
      : []
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = { json: args.includes('--json'), verbose: args.includes('--verbose'), mode: DEFAULT_MODE, error: null };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode') {
      const value = args[index + 1];
      if (!VALID_MODES.has(value)) {
        parsed.error = `invalid-mode:${value || '<missing>'}`;
        return parsed;
      }
      parsed.mode = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!VALID_MODES.has(value)) {
        parsed.error = `invalid-mode:${value || '<missing>'}`;
        return parsed;
      }
      parsed.mode = value;
    }
  }

  return parsed;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    const result = {
      ok: false,
      mode: args.mode,
      project_root: path.resolve(lib.projectRoot()),
      active_change: null,
      change_dir: null,
      development_dir: null,
      blockers: [args.error],
      warnings: [],
      codegraph: null,
      prototype: null,
      artifacts: [],
      tasks: [],
      repair_incidents: []
    };
    process.stdout.write(args.json
      ? (args.verbose ? `${JSON.stringify(result, null, 2)}\n` : `${JSON.stringify(toCompact(result))}\n`)
      : markdown(result));
    process.exit(2);
  }

  const result = validateDevelopment(lib.projectRoot(), { mode: args.mode });
  process.stdout.write(args.json
    ? (args.verbose ? `${JSON.stringify(result, null, 2)}\n` : `${JSON.stringify(toCompact(result))}\n`)
    : markdown(result));
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { detectTaskLoops, validateDevelopment };
