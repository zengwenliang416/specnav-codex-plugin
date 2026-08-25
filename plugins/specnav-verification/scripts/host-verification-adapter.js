#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const kernel = require('../kernel');

const SCHEMA = 'specnav.verification.host-adapter.v1';
const PLUGIN = 'specnav-verification';
const APPROVAL_BLOCKERS = new Map([
  ['runtime-setup', 'runtime-approval-required'],
  ['runtime-repair', 'runtime-approval-required'],
  ['repair-recover', 'transition-approval-required'],
  ['repair-rebind', 'transition-approval-required'],
  ['repair-artifact-loss-record', 'artifact-loss-approval-required'],
  ['generation-activate', 'generation-approval-required'],
  ['repair-transition-apply', 'transition-approval-required'],
  ['migrate-apply', 'mutation-approval-required'],
  ['migrate-rollback', 'mutation-approval-required']
]);
const SUPPORTED_ACTIONS = new Set([
  'validate',
  'execute',
  'finalize',
  'aggregate',
  'report',
  'legacy-validate',
  'legacy-aggregate',
  'legacy-report',
  'runtime-status',
  'runtime-setup',
  'runtime-repair',
  'generation-prepare',
  'generation-activate',
  'repair-classify',
  'repair-request',
  'repair-start',
  'repair-complete',
  'repair-recover',
  'repair-rebind',
  'repair-artifact-loss-record',
  'repair-rerun-plan',
  'repair-evaluate',
  'repair-transition-apply',
  'repair-state',
  'rerun',
  'migrate-dry-run',
  'migrate-apply',
  'migrate-rollback'
]);

const SKILLS = Object.freeze([
  ['specnav-verification', 'entry'],
  ['specnav-verification-runtime-status', 'runtime-status'],
  ['specnav-verification-runtime-setup', 'runtime-setup'],
  ['specnav-verify-plan', 'plan'],
  ['specnav-verify-facticity', 'domain'],
  ['specnav-verify-static', 'domain'],
  ['specnav-verify-unit', 'domain'],
  ['specnav-verify-redteam', 'domain'],
  ['specnav-verify-e2e', 'domain'],
  ['specnav-verify-sensory', 'domain'],
  ['specnav-verify-rerun', 'repair'],
  ['specnav-html-report', 'report']
].map(([id, role]) => Object.freeze({ id, role })));

const REPORT_PATHS = Object.freeze({
  overview: 'verify/reports/overview.html',
  case_catalog: 'verify/reports/test-case-catalog.html',
  case_results: 'verify/reports/test-case-results.html',
  report_model: 'verify/v2/report-model.json',
  report_render_manifest: 'verify/v2/report-render-manifest.json',
  legacy_aggregate_json: 'verify/aggregate-report.json',
  legacy_aggregate_html: 'verify/aggregate-report.html',
  legacy_stakeholder_html: 'verify-report.html'
});

const ACTIONS = Object.freeze([
  ['validate', false],
  ['execute', false],
  ['finalize', false],
  ['aggregate', false],
  ['report', false],
  ['legacy-validate', false],
  ['legacy-aggregate', false],
  ['legacy-report', false],
  ['runtime-status', false],
  ['runtime-setup', true],
  ['runtime-repair', true],
  ['generation-prepare', false],
  ['generation-activate', true],
  ['repair-classify', false],
  ['repair-request', false],
  ['repair-start', false],
  ['repair-complete', false],
  ['repair-recover', true],
  ['repair-rebind', true],
  ['repair-artifact-loss-record', true],
  ['repair-rerun-plan', false],
  ['repair-evaluate', false],
  ['repair-transition-apply', true],
  ['repair-state', false],
  ['rerun', false],
  ['migrate-dry-run', false],
  ['migrate-apply', true],
  ['migrate-rollback', true]
].map(([id, approvalRequired]) => Object.freeze({
  id,
  approval_required: approvalRequired
})));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function blockerIds(blockers) {
  if (!Array.isArray(blockers)) return [];
  return uniqueSorted(blockers.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (entry && typeof entry.id === 'string') return [entry.id];
    return [];
  }));
}

function artifactPaths(result) {
  const fromArtifacts = Array.isArray(result && result.artifacts)
    ? result.artifacts.flatMap((entry) => (
        entry && typeof entry.path === 'string' ? [entry.path] : []
      ))
    : [];
  const fromBlockers = Array.isArray(result && result.blockers)
    ? result.blockers.flatMap((entry) => (
        entry && typeof entry === 'object' && typeof entry.artifact === 'string'
          ? [entry.artifact]
          : []
      ))
    : [];
  return uniqueSorted([...fromArtifacts, ...fromBlockers]);
}

function nextSkills(ids) {
  const skills = [];
  if (ids.some((id) => id.startsWith('verification-runtime:'))) {
    skills.push('specnav-verification-runtime-status');
  }
  if (ids.some((id) => (
    id.includes('user-test-case')
    || id.includes('case-snapshot')
    || id.includes('case-approval')
    || id.includes('traceability')
  ))) {
    skills.push('specnav-verify-plan');
  }
  if (ids.some((id) => id.includes('stale') || id.includes('rerun'))) {
    skills.push('specnav-verify-rerun');
  }
  if (ids.some((id) => id.startsWith('verification-repair'))) {
    skills.push('specnav-verify-rerun');
  }
  const domainSkills = new Map([
    ['facticity', 'specnav-verify-facticity'],
    ['static', 'specnav-verify-static'],
    ['unit', 'specnav-verify-unit'],
    ['redteam', 'specnav-verify-redteam'],
    ['e2e', 'specnav-verify-e2e'],
    ['sensory', 'specnav-verify-sensory']
  ]);
  for (const [domain, skill] of domainSkills) {
    if (ids.some((id) => id.includes(`${domain}/`) || id.includes(`:${domain}`))) {
      skills.push(skill);
    }
  }
  return [...new Set(skills)];
}

function blocked(host, action, id, artifact = 'host-adapter', detail = null) {
  const result = {
    ok: false,
    status: 'blocked',
    host,
    action,
    exit_status: 2,
    signal: null,
    result: {
      ok: false,
      blockers: [{ id, artifact, detail }]
    },
    blocker_ids: [id],
    artifact_paths: artifact ? [artifact] : [],
    next_skills: [],
    fallback_used: false
  };
  return deepFreeze(result);
}

function blockedSource(host, action, execution, id) {
  const source = structuredClone(execution.result);
  return deepFreeze({
    ok: false,
    status: 'blocked',
    host,
    action,
    exit_status: 2,
    signal: execution.signal || null,
    result: source,
    blocker_ids: [id],
    artifact_paths: artifactPaths(source),
    next_skills: [],
    fallback_used: source.fallback_used === true
  });
}

function isFullGateRequest(request) {
  const mode = String(
    request.mode || request.verification_mode || 'full'
  ).toLowerCase();
  const requiredDomains = request.required_domains;
  return (
    mode === 'full'
    && request.fallback !== true
    && request.fallback_used !== true
    && request.manual_green !== true
    && request.override_green !== true
    && (
      requiredDomains === undefined
      || (
        Array.isArray(requiredDomains)
        && requiredDomains.length === kernel.SIX_DOMAINS.length
        && kernel.SIX_DOMAINS.every((domain) => requiredDomains.includes(domain))
      )
    )
  );
}

function description(host) {
  return deepFreeze({
    schema: SCHEMA,
    host,
    plugin: PLUGIN,
    kernel: { ...kernel.metadata },
    required_domains: [...kernel.SIX_DOMAINS],
    verification_mode: 'full',
    light_mode_supported: false,
    fallback_supported: false,
    manual_green_supported: false,
    skills: SKILLS.map((entry) => ({ ...entry })),
    actions: ACTIONS.map((entry) => ({ ...entry })),
    report_paths: { ...REPORT_PATHS }
  });
}

function sourceStatus(result) {
  if (result.ok === true) {
    if (result.verdict === 'green' || result.status === 'pass') return 'pass';
    return 'ready';
  }
  if (result.status === 'running') return 'running';
  if (result.status === 'canceled') return 'canceled';
  return 'blocked';
}

function createVerificationHostAdapter(options = {}) {
  const host = typeof options.host === 'string' ? options.host.trim() : '';
  const blockerPrefix = typeof options.blockerPrefix === 'string'
    ? options.blockerPrefix.trim()
    : '';
  if (!host) {
    throw new Error('verification-host-adapter:host-required');
  }
  if (!blockerPrefix) {
    throw new Error('verification-host-adapter:blocker-prefix-required');
  }
  if (typeof options.execute !== 'function') {
    throw new Error(`${blockerPrefix}:executor-required`);
  }
  const blocker = (suffix) => `${blockerPrefix}:${suffix}`;

  function invoke(request = {}) {
    const action = typeof request.action === 'string'
      ? request.action
      : '';
    if (!SUPPORTED_ACTIONS.has(action)) {
      return blocked(
        host,
        action || '<missing>',
        blocker(`unsupported-action:${action || '<missing>'}`)
      );
    }
    if (!isFullGateRequest(request)) {
      return blocked(
        host,
        action,
        blocker('full-gate-required'),
        'verification-policy'
      );
    }
    const approvalSuffix = APPROVAL_BLOCKERS.get(action);
    if (approvalSuffix && request.approved !== true) {
      return blocked(
        host,
        action,
        blocker(approvalSuffix),
        action.startsWith('runtime-')
          ? 'verification-runtime'
          : 'verification-migration'
      );
    }
    if (
      typeof request.project_root !== 'string'
      || request.project_root.trim() === ''
    ) {
      return blocked(
        host,
        action,
        blocker('project-root-required'),
        'project-root'
      );
    }

    let execution;
    try {
      const {
        action: _action,
        project_root: _projectRoot,
        mode: _mode,
        verification_mode: _verificationMode,
        fallback: _fallback,
        fallback_used: _fallbackUsed,
        manual_green: _manualGreen,
        override_green: _overrideGreen,
        required_domains: _requiredDomains,
        approved: _approved,
        ...commandOptions
      } = request;
      execution = options.execute({
        action,
        project_root: request.project_root,
        options: {
          ...commandOptions,
          approved: request.approved === true
        }
      });
    } catch (error) {
      return blocked(
        host,
        action,
        blocker('source-command-failed'),
        'source-command',
        error instanceof Error ? error.message : String(error)
      );
    }
    if (
      !execution
      || !Number.isInteger(execution.exit_status)
      || !execution.result
      || typeof execution.result !== 'object'
      || Array.isArray(execution.result)
    ) {
      return blocked(
        host,
        action,
        blocker('invalid-source-result'),
        'source-command'
      );
    }
    if (execution.result.fallback_used !== false) {
      return blockedSource(
        host,
        action,
        execution,
        execution.result.fallback_used === true
          ? blocker('source-fallback-forbidden')
          : blocker('source-fallback-undisclosed')
      );
    }

    const ids = blockerIds(execution.result.blockers);
    return deepFreeze({
      ok: execution.result.ok === true && execution.exit_status === 0,
      status: sourceStatus(execution.result),
      host,
      action,
      exit_status: execution.exit_status,
      signal: execution.signal || null,
      result: structuredClone(execution.result),
      blocker_ids: ids,
      artifact_paths: artifactPaths(execution.result),
      next_skills: nextSkills(ids),
      fallback_used: false
    });
  }

  return Object.freeze({
    describe: () => description(host),
    invoke
  });
}

function argValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function optionArgs(options, names) {
  const args = [];
  for (const [optionName, cliName] of names) {
    const value = options[optionName];
    if (typeof value === 'string' && value !== '') {
      args.push(cliName, value);
    }
  }
  return args;
}

function commandFor(pluginRoot, request) {
  const scripts = path.join(pluginRoot, 'scripts');
  const options = request.options || {};
  if (request.action === 'validate') {
    return [
      path.join(scripts, 'verification-v2-run.js'),
      'preflight',
      '--project',
      request.project_root,
      ...optionArgs(options, [
        ['change', '--change'],
        ['reviewer_id', '--reviewer-id'],
        ['case_snapshot', '--snapshot'],
        ['case_approval', '--approval'],
        ['requirements_source', '--requirements'],
        ['acceptance_source', '--acceptance'],
        ['runtime_status', '--runtime-status']
      ]),
      '--json'
    ];
  }
  if (request.action === 'execute' || request.action === 'finalize') {
    return [
      path.join(scripts, 'verification-v2-run.js'),
      request.action === 'execute' ? 'run' : 'finalize',
      '--project',
      request.project_root,
      ...optionArgs(options, [
        ['change', '--change'],
        ['reviewer_id', '--reviewer-id'],
        ['case', '--case'],
        ['attempt_kind', '--attempt-kind'],
        ['parent_attempt', '--parent-attempt'],
        ['failure_id', '--failure-id'],
        ['case_snapshot', '--snapshot'],
        ['case_approval', '--approval'],
        ['requirements_source', '--requirements'],
        ['acceptance_source', '--acceptance'],
        ['runtime_status', '--runtime-status'],
        ['scenario_registry', '--scenario-registry']
      ]),
      '--json'
    ];
  }
  if (
    request.action === 'generation-prepare'
    || request.action === 'generation-activate'
  ) {
    return [
      path.join(scripts, 'verification-v2-run.js'),
      request.action,
      '--project',
      request.project_root,
      ...optionArgs(options, [
        ['change', '--change'],
        ['reviewer_id', '--reviewer-id'],
        ['generation_review', '--generation-review'],
        ['case_snapshot', '--snapshot'],
        ['case_approval', '--approval'],
        ['requirements_source', '--requirements'],
        ['acceptance_source', '--acceptance'],
        ['runtime_status', '--runtime-status']
      ]),
      ...(options.approved === true ? ['--approved'] : []),
      '--json'
    ];
  }
  if (request.action === 'aggregate' || request.action === 'report') {
    return [
      path.join(scripts, 'verification-v2-run.js'),
      'finalize',
      '--project',
      request.project_root,
      ...optionArgs(options, [
        ['change', '--change'],
        ['reviewer_id', '--reviewer-id'],
        ['case_snapshot', '--snapshot'],
        ['case_approval', '--approval'],
        ['requirements_source', '--requirements'],
        ['acceptance_source', '--acceptance'],
        ['runtime_status', '--runtime-status']
      ]),
      '--json'
    ];
  }
  if (request.action.startsWith('legacy-')) {
    const legacyAction = request.action === 'legacy-validate'
      ? 'validate'
      : 'aggregate';
    return [
      path.join(scripts, 'verify-domains.js'),
      legacyAction,
      '--json',
      ...(request.action === 'legacy-report' || options.render === true
        ? ['--render']
        : [])
    ];
  }
  if (request.action.startsWith('runtime-')) {
    const runtimeAction = {
      'runtime-status': 'doctor',
      'runtime-setup': 'install',
      'runtime-repair': 'repair'
    }[request.action];
    return [
      path.join(scripts, 'verification-runtime.js'),
      runtimeAction,
      '--project',
      request.project_root,
      ...(options.version ? ['--version', options.version] : []),
      ...(options.runtime_root ? ['--root', options.runtime_root] : []),
      ...(options.requires_midscene ? ['--requires-midscene'] : []),
      '--json'
    ];
  }
  if (request.action === 'rerun') {
    return [
      path.join(scripts, 'rerun-scope.js'),
      ...optionArgs(options, [
        ['change', '--change'],
        ['base', '--base'],
        ['files', '--files'],
        ['repaired', '--repaired'],
        ['reviewer_id', '--reviewer-id'],
        ['case_snapshot', '--case-snapshot'],
        ['case_approval', '--case-approval'],
        ['requirements_source', '--requirements-source'],
        ['acceptance_source', '--acceptance-source'],
        ['freshness', '--freshness'],
        ['policy', '--policy'],
        ['traceability', '--traceability'],
        ['codegraph_impact', '--codegraph-impact']
      ]),
      '--json'
    ];
  }
  if (request.action.startsWith('repair-')) {
    const repairAction = {
      'repair-classify': 'classify',
      'repair-request': 'repair-request',
      'repair-start': 'repair-start',
      'repair-complete': 'repair-complete',
      'repair-recover': 'repair-recover',
      'repair-rebind': 'repair-rebind',
      'repair-artifact-loss-record': 'artifact-loss-record',
      'repair-rerun-plan': 'rerun-plan',
      'repair-evaluate': 'evaluate',
      'repair-transition-apply': 'transition-apply',
      'repair-state': 'state'
    }[request.action];
    return [
      path.join(scripts, 'verification-v2-repair-loop.js'),
      repairAction,
      '--project',
      request.project_root,
      ...optionArgs(options, [
        ['change', '--change'],
        ['reviewer_id', '--reviewer-id'],
        ['failure_id', '--failure-id'],
        ['root_cause_check', '--root-cause-check'],
        ['no_progress', '--no-progress'],
        ['scope', '--scope'],
        ['recovery_review', '--recovery-review'],
        ['rebind_review', '--rebind-review'],
        ['artifact_loss_review', '--artifact-loss-review'],
        ['spec_review', '--spec-review'],
        ['quality_review', '--quality-review'],
        ['proposal_id', '--proposal-id'],
        ['idempotency_key', '--idempotency-key'],
        ['case_snapshot', '--snapshot'],
        ['case_approval', '--approval'],
        ['requirements_source', '--requirements'],
        ['acceptance_source', '--acceptance'],
        ['runtime_status', '--runtime-status']
      ]),
      '--json'
    ];
  }
  const migrationAction = {
    'migrate-dry-run': 'dry-run',
    'migrate-apply': 'apply',
    'migrate-rollback': 'rollback'
  }[request.action];
  return [
    path.join(scripts, 'verification-migrate.js'),
    migrationAction,
    ...(options.request ? ['--request', options.request] : [])
  ];
}

function createProcessExecutor(
  pluginRoot = path.resolve(__dirname, '..'),
  blockerPrefix = 'verification-host'
) {
  return function execute(request) {
    const projectRoot = path.resolve(request.project_root);
    let stat;
    try {
      stat = fs.statSync(projectRoot);
    } catch {
      return {
        exit_status: 2,
        signal: null,
        result: {
          ok: false,
          blockers: [{
            id: `${blockerPrefix}:project-root-missing:${projectRoot}`,
            artifact: 'project-root',
            detail: null
          }]
        }
      };
    }
    if (!stat.isDirectory()) {
      return {
        exit_status: 2,
        signal: null,
        result: {
          ok: false,
          blockers: [{
            id: `${blockerPrefix}:project-root-not-directory:${projectRoot}`,
            artifact: 'project-root',
            detail: null
          }]
        }
      };
    }
    const [script, ...args] = commandFor(pluginRoot, {
      ...request,
      project_root: projectRoot
    });
    const child = spawnSync(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PROJECT_DIR: projectRoot,
        SPECNAV_VERIFICATION_ROOT: pluginRoot
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    if (child.error) {
      throw child.error;
    }
    let result;
    try {
      result = JSON.parse(child.stdout);
    } catch {
      return {
        exit_status: Number.isInteger(child.status) ? child.status : 2,
        signal: child.signal || null,
        result: {
          ok: false,
          blockers: [{
            id: `${blockerPrefix}:source-output-invalid`,
            artifact: path.basename(script),
            detail: null
          }]
        }
      };
    }
    return {
      exit_status: Number.isInteger(child.status) ? child.status : 2,
      signal: child.signal || null,
      result
    };
  };
}

function parseCli(args) {
  const action = args.find((entry) => !entry.startsWith('--')) || 'describe';
  return {
    action,
    project_root: path.resolve(argValue(args, '--project', process.cwd())),
    mode: argValue(args, '--mode', 'full'),
    fallback: args.includes('--fallback'),
    manual_green: args.includes('--manual-green'),
    approved: args.includes('--approved'),
    version: argValue(args, '--version'),
    runtime_root: argValue(args, '--runtime-root'),
    request: argValue(args, '--request'),
    change: argValue(args, '--change'),
    base: argValue(args, '--base'),
    files: argValue(args, '--files'),
    repaired: argValue(args, '--repaired'),
    reviewer_id: argValue(args, '--reviewer-id'),
    case: argValue(args, '--case'),
    attempt_kind: argValue(args, '--attempt-kind'),
    parent_attempt: argValue(args, '--parent-attempt'),
    failure_id: argValue(args, '--failure-id'),
    root_cause_check: argValue(args, '--root-cause-check'),
    no_progress: argValue(args, '--no-progress'),
    scope: argValue(args, '--scope'),
    recovery_review: argValue(args, '--recovery-review'),
    rebind_review: argValue(args, '--rebind-review'),
    artifact_loss_review: argValue(args, '--artifact-loss-review'),
    spec_review: argValue(args, '--spec-review'),
    quality_review: argValue(args, '--quality-review'),
    proposal_id: argValue(args, '--proposal-id'),
    idempotency_key: argValue(args, '--idempotency-key'),
    case_snapshot: argValue(args, '--case-snapshot'),
    case_approval: argValue(args, '--case-approval'),
    requirements_source: argValue(args, '--requirements-source'),
    acceptance_source: argValue(args, '--acceptance-source'),
    freshness: argValue(args, '--freshness'),
    policy: argValue(args, '--policy'),
    traceability: argValue(args, '--traceability'),
    codegraph_impact: argValue(args, '--codegraph-impact'),
    runtime_status: argValue(args, '--runtime-status'),
    generation_review: argValue(args, '--generation-review'),
    scenario_registry: argValue(args, '--scenario-registry'),
    render: args.includes('--render'),
    requires_midscene: args.includes('--requires-midscene'),
    json: args.includes('--json')
  };
}

function runHostCli(options = {}) {
  const argv = Array.isArray(options.argv)
    ? options.argv
    : process.argv.slice(2);
  const cli = parseCli(argv);
  const blockerPrefix = options.blockerPrefix;
  const adapter = createVerificationHostAdapter({
    host: options.host,
    blockerPrefix,
    execute: options.execute || createProcessExecutor(
      options.pluginRoot || path.resolve(__dirname, '..'),
      blockerPrefix
    )
  });
  const output = cli.action === 'describe'
    ? {
        ok: true,
        description: adapter.describe(),
        blocker_ids: [],
        fallback_used: false
      }
    : adapter.invoke(cli);
  process.stdout.write(`${JSON.stringify(output, null, cli.json ? 2 : 0)}\n`);
  return {
    output,
    exitStatus: output.ok ? 0 : 2
  };
}

module.exports = {
  REPORT_PATHS,
  SCHEMA,
  commandFor,
  createVerificationHostAdapter,
  createProcessExecutor,
  parseCli,
  runHostCli
};
