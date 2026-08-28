'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins/specnav-verification');
const kernel = require(PLUGIN_ROOT);
const {
  createCodexVerificationAdapter
} = require(path.join(
  PLUGIN_ROOT,
  'scripts/codex-verification-adapter'
));

function blockedSourceResult() {
  return {
    ok: false,
    verdict: 'blocked',
    fallback_used: false,
    blockers: [
      'verify:user-test-cases-unapproved',
      {
        id: 'verification-runtime:not-ready',
        artifact: 'verify/runtime-evidence.json',
        detail: 'browser-missing'
      }
    ],
    artifacts: [
      {
        name: 'runtime-evidence.json',
        path: 'verify/runtime-evidence.json',
        ok: false
      }
    ]
  };
}

test('Codex describes the full Verification 2.0 contract from one Kernel', () => {
  const adapter = createCodexVerificationAdapter({
    execute() {
      throw new Error('describe-must-not-execute');
    }
  });
  const description = adapter.describe();

  assert.equal(description.schema, 'specnav.verification.host-adapter.v1');
  assert.equal(description.host, 'codex');
  assert.equal(description.plugin, 'specnav-verification');
  assert.deepEqual(description.kernel, kernel.metadata);
  assert.deepEqual(description.required_domains, kernel.SIX_DOMAINS);
  assert.equal(description.verification_mode, 'full');
  assert.equal(description.light_mode_supported, false);
  assert.equal(description.fallback_supported, false);
  assert.equal(description.manual_green_supported, false);
  assert.deepEqual(description.report_paths, {
    overview: 'verify/reports/overview.html',
    case_catalog: 'verify/reports/test-case-catalog.html',
    case_results: 'verify/reports/test-case-results.html',
    report_model: 'verify/v2/report-model.json',
    report_render_manifest: 'verify/v2/report-render-manifest.json',
    legacy_aggregate_json: 'verify/aggregate-report.json',
    legacy_aggregate_html: 'verify/aggregate-report.html',
    legacy_stakeholder_html: 'verify-report.html'
  });
  assert.deepEqual(
    description.skills.map((entry) => entry.id),
    [
      'specnav-verification',
      'specnav-verification-runtime-status',
      'specnav-verification-runtime-setup',
      'specnav-verify-plan',
      'specnav-verify-facticity',
      'specnav-verify-static',
      'specnav-verify-unit',
      'specnav-verify-redteam',
      'specnav-verify-e2e',
      'specnav-verify-sensory',
      'specnav-verify-rerun',
      'specnav-html-report'
    ]
  );
  assert.equal(
    description.actions.find((entry) => entry.id === 'runtime-setup')
      .approval_required,
    true
  );
  assert.equal(
    description.actions.find(
      (entry) => entry.id === 'repair-transition-apply'
    ).approval_required,
    true
  );
  assert.equal(
    description.actions.find(
      (entry) => entry.id === 'repair-artifact-loss-record'
    ).approval_required,
    true
  );
  assert.equal(Object.isFrozen(description), true);
});

test('Codex invokes the shared command surface and preserves blockers', () => {
  const calls = [];
  const source = blockedSourceResult();
  const adapter = createCodexVerificationAdapter({
    execute(request) {
      calls.push(structuredClone(request));
      return {
        exit_status: 2,
        signal: null,
        result: source
      };
    }
  });

  const response = adapter.invoke({
    action: 'validate',
    project_root: '/tmp/specnav-codex-project'
  });

  assert.deepEqual(calls, [{
    action: 'validate',
    project_root: '/tmp/specnav-codex-project',
    options: {
      approved: false
    }
  }]);
  assert.equal(response.ok, false);
  assert.equal(response.status, 'blocked');
  assert.equal(response.host, 'codex');
  assert.equal(response.action, 'validate');
  assert.equal(response.exit_status, 2);
  assert.deepEqual(response.result, source);
  assert.deepEqual(response.blocker_ids, [
    'verification-runtime:not-ready',
    'verify:user-test-cases-unapproved'
  ]);
  assert.deepEqual(response.artifact_paths, [
    'verify/runtime-evidence.json'
  ]);
  assert.deepEqual(response.next_skills, [
    'specnav-verification-runtime-status',
    'specnav-verify-plan'
  ]);
});

test('Codex adapter blocks simplified, fallback, and manual-green requests', () => {
  let calls = 0;
  const adapter = createCodexVerificationAdapter({
    execute() {
      calls += 1;
      return { exit_status: 0, signal: null, result: { ok: true } };
    }
  });
  const requests = [
    { action: 'validate', project_root: '/tmp/project', mode: 'light' },
    { action: 'aggregate', project_root: '/tmp/project', fallback: true },
    { action: 'report', project_root: '/tmp/project', manual_green: true },
    {
      action: 'validate',
      project_root: '/tmp/project',
      required_domains: ['unit']
    }
  ];

  for (const request of requests) {
    const result = adapter.invoke(request);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.exit_status, 2);
    assert.deepEqual(result.blocker_ids, [
      'codex-verification:full-gate-required'
    ]);
    assert.equal(result.fallback_used, false);
  }
  assert.equal(calls, 0);
});

test('Codex adapter requires explicit approval for runtime mutation', () => {
  let calls = 0;
  const adapter = createCodexVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });

  const blocked = adapter.invoke({
    action: 'runtime-setup',
    project_root: '/tmp/project',
    version: '1.0.0'
  });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blocker_ids, [
    'codex-verification:runtime-approval-required'
  ]);
  assert.equal(calls, 0);

  const approved = adapter.invoke({
    action: 'runtime-setup',
    project_root: '/tmp/project',
    version: '1.0.0',
    approved: true
  });
  assert.equal(approved.ok, true);
  assert.equal(calls, 1);
});

test('Codex adapter requires explicit approval for migration writes', () => {
  let calls = 0;
  const adapter = createCodexVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });

  for (const action of ['migrate-apply', 'migrate-rollback']) {
    const blocked = adapter.invoke({
      action,
      project_root: '/tmp/project',
      request: '/tmp/migration-request.json'
    });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.blocker_ids, [
      'codex-verification:mutation-approval-required'
    ]);
  }
  assert.equal(calls, 0);
});

test('Codex adapter requires explicit approval for Core repair transitions', () => {
  let calls = 0;
  const adapter = createCodexVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });
  const request = {
    action: 'repair-transition-apply',
    project_root: '/tmp/project',
    failure_id: 'failure-open',
    proposal_id: 'transition-close',
    idempotency_key: 'apply-close-failure'
  };

  const blocked = adapter.invoke(request);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blocker_ids, [
    'codex-verification:transition-approval-required'
  ]);
  assert.equal(calls, 0);

  const approved = adapter.invoke({ ...request, approved: true });
  assert.equal(approved.ok, true);
  assert.equal(calls, 1);
});

test('Codex adapter requires explicit approval for artifact-loss authority', () => {
  let calls = 0;
  const adapter = createCodexVerificationAdapter({
    execute() {
      calls += 1;
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, fallback_used: false }
      };
    }
  });
  const request = {
    action: 'repair-artifact-loss-record',
    project_root: '/tmp/project',
    failure_id: 'failure-open',
    artifact_loss_review: 'verify/artifact-loss-review.json'
  };

  const blocked = adapter.invoke(request);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blocker_ids, [
    'codex-verification:artifact-loss-approval-required'
  ]);
  assert.equal(calls, 0);

  const approved = adapter.invoke({ ...request, approved: true });
  assert.equal(approved.ok, true);
  assert.equal(calls, 1);
});

test('Codex adapter exposes and blocks downstream fallback signals', () => {
  const adapter = createCodexVerificationAdapter({
    execute() {
      return {
        exit_status: 0,
        signal: null,
        result: {
          ok: true,
          verdict: 'green',
          fallback_used: true,
          blockers: []
        }
      };
    }
  });

  const result = adapter.invoke({
    action: 'validate',
    project_root: '/tmp/project'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.fallback_used, true);
  assert.deepEqual(result.blocker_ids, [
    'codex-verification:source-fallback-forbidden'
  ]);
  assert.equal(result.result.fallback_used, true);
});

test('Codex adapter blocks a source that does not attest no fallback', () => {
  const adapter = createCodexVerificationAdapter({
    execute() {
      return {
        exit_status: 0,
        signal: null,
        result: { ok: true, blockers: [] }
      };
    }
  });

  const result = adapter.invoke({
    action: 'validate',
    project_root: '/tmp/project'
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blocker_ids, [
    'codex-verification:source-fallback-undisclosed'
  ]);
});

test('Codex adapter fails closed for unsupported actions and invalid results', () => {
  const unsupported = createCodexVerificationAdapter({
    execute() {
      throw new Error('unsupported-must-not-execute');
    }
  }).invoke({
    action: 'green',
    project_root: '/tmp/project'
  });
  assert.deepEqual(unsupported.blocker_ids, [
    'codex-verification:unsupported-action:green'
  ]);

  const invalid = createCodexVerificationAdapter({
    execute() {
      return { exit_status: 0, signal: null, result: null };
    }
  }).invoke({
    action: 'validate',
    project_root: '/tmp/project'
  });
  assert.deepEqual(invalid.blocker_ids, [
    'codex-verification:invalid-source-result'
  ]);
});

test('Codex source contains invocation only, not verdict implementation', () => {
  const source = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'scripts/codex-verification-adapter.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /createSixDomainAggregator/);
  assert.doesNotMatch(source, /createDecisionEngine/);
  assert.doesNotMatch(source, /createReadingEvaluator/);
  assert.doesNotMatch(source, /domain_results\s*=/);
  assert.doesNotMatch(source, /release\.status\s*=/);
});
