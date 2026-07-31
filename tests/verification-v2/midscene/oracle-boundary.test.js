'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createOrchestrator,
  midsceneExecutionFixture,
  midsceneRequest
} = require('./test-helpers');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function observedAdapter(fixture, overrides = {}) {
  return {
    validate() {
      return { ok: true, blockers: [] };
    },
    async interact() {
      fs.mkdirSync(fixture.artifactRoot, { recursive: true });
      const screenshotPath = path.join(fixture.artifactRoot, 'screenshot.png');
      fs.writeFileSync(screenshotPath, 'png');
      const screenshot = {
        kind: 'screenshot',
        path: screenshotPath,
        producer: 'midscene-runner',
        sha256: sha256File(screenshotPath),
        size: fs.statSync(screenshotPath).size
      };
      return {
        status: 'observed',
        observation: {
          description: 'The model says the expected UI is present.'
        },
        prompt: {
          id: 'prompt-midscene',
          hash: '0'.repeat(64),
          text: 'redacted'
        },
        model: {
          name: 'model-a',
          family: 'family-a',
          credential_source: 'MIDSCENE_MODEL_API_KEY',
          secret_values_exposed: false
        },
        screenshots: [screenshot],
        artifacts: [screenshot],
        assertions: [{
          id: 'assertion-1',
          method: 'ok',
          actual: true,
          expected: true,
          status: 'passed'
        }],
        blockers: [],
        timed_out: false,
        canceled: false,
        fallback_used: false,
        ...overrides
      };
    }
  };
}

test('model-only success remains blocked without a worker assertion', async () => {
  const fixture = midsceneExecutionFixture();
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture, { assertions: [] })
  );
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-oracle-assertion-mismatch'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a sandboxed deterministic assertion can authorize PASS', async () => {
  const fixture = midsceneExecutionFixture();
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture)
  );
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.status, 'passed');
    assert.equal(result.attempt.runner, 'midscene');
    assert.equal(result.oracle.type, 'deterministic');
    assert.equal(result.oracle.producer, 'specnav-playwright-worker');
    assert.match(result.oracle.evidence_sha256, /^[a-f0-9]{64}$/);
  } finally {
    fixture.cleanup();
  }
});

test('kernel recomputes assertion status and rejects a forged PASS', async () => {
  const fixture = midsceneExecutionFixture();
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture, {
      assertions: [{
        id: 'assertion-1',
        method: 'ok',
        actual: false,
        expected: true,
        status: 'passed'
      }]
    })
  );
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-oracle-result-forged'
    );
  } finally {
    fixture.cleanup();
  }
});

test('failed deterministic assertion produces a failed terminal attempt', async () => {
  const fixture = midsceneExecutionFixture();
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture, {
      assertions: [{
        id: 'assertion-1',
        method: 'ok',
        actual: false,
        expected: true,
        status: 'failed'
      }]
    })
  );
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-oracle-failed'
    );
  } finally {
    fixture.cleanup();
  }
});

function signoffFor(fixture, reviewerId = 'reviewer-1') {
  const screenshotPath = path.join(fixture.artifactRoot, 'screenshot.png');
  return {
    assertion_ids: ['assertion-1'],
    decision: 'approved',
    reviewer: {
      id: reviewerId,
      kind: 'human',
      display_name: 'Verification reviewer'
    },
    decided_at: '2026-07-31T00:03:00Z',
    reason: 'Reviewed the retained screenshot and interaction trace.',
    change_id: fixture.run.change_id,
    run_id: fixture.run.id,
    case_id: fixture.caseId,
    attempt_id: fixture.attempt.id,
    case_snapshot_hash: fixture.run.case_snapshot_hash,
    screenshot_sha256: sha256File(screenshotPath)
  };
}

test('human signoff passes only when contract and execution identity permit it', async () => {
  for (const allowed of [false, true]) {
    const fixture = midsceneExecutionFixture({
      oracleType: 'human_signoff',
      humanSignoffAllowed: allowed
    });
    const orchestrator = createOrchestrator(
      fixture,
      observedAdapter(fixture, { assertions: [] })
    );
    try {
      fs.mkdirSync(fixture.artifactRoot, { recursive: true });
      fs.writeFileSync(
        path.join(fixture.artifactRoot, 'screenshot.png'),
        'png'
      );
      const request = midsceneRequest(fixture, {
        signoff: signoffFor(fixture)
      });
      const result = await orchestrator.executeMidscene(request);
      assert.equal(result.status, allowed ? 'passed' : 'blocked');
      if (!allowed) {
        assert.equal(
          result.blockers[0].id,
          'verification-execution:midscene-human-signoff-not-allowed'
        );
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test('human signoff can be requested only after the retained screenshot exists', async () => {
  const fixture = midsceneExecutionFixture({
    oracleType: 'human_signoff',
    humanSignoffAllowed: true
  });
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture, { assertions: [] })
  );
  let callbackCount = 0;
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(
      fixture,
      {
        async requestSignoff(packet) {
          callbackCount += 1;
          assert.equal(Object.isFrozen(packet), true);
          assert.equal(fs.existsSync(packet.screenshot.path), true);
          assert.equal(
            sha256File(packet.screenshot.path),
            packet.screenshot.sha256
          );
          return {
            assertion_ids: [...packet.assertion_ids],
            decision: 'approved',
            reviewer: {
              id: 'reviewer-1',
              kind: 'human',
              display_name: 'Verification reviewer'
            },
            decided_at: '2026-07-31T00:03:00Z',
            reason: 'Reviewed the retained screenshot.',
            ...packet.identity,
            screenshot_sha256: packet.screenshot.sha256
          };
        }
      }
    ));
    assert.equal(callbackCount, 1);
    assert.equal(result.status, 'passed');
    assert.equal(result.oracle.type, 'human_signoff');
  } finally {
    fixture.cleanup();
  }
});

test('human signoff cannot approve a screenshot modified during review', async () => {
  const fixture = midsceneExecutionFixture({
    oracleType: 'human_signoff',
    humanSignoffAllowed: true
  });
  const orchestrator = createOrchestrator(
    fixture,
    observedAdapter(fixture, { assertions: [] })
  );
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(
      fixture,
      {
        async requestSignoff(packet) {
          fs.writeFileSync(packet.screenshot.path, 'tampered-during-review');
          return {
            assertion_ids: [...packet.assertion_ids],
            decision: 'approved',
            reviewer: {
              id: 'reviewer-1',
              kind: 'human',
              display_name: 'Verification reviewer'
            },
            decided_at: '2026-07-31T00:03:00Z',
            reason: 'Attempted approval after evidence mutation.',
            ...packet.identity,
            screenshot_sha256: packet.screenshot.sha256
          };
        }
      }
    ));
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:midscene-screenshot-invalid'
    );
  } finally {
    fixture.cleanup();
  }
});

test('Midscene result retains every published artifact and execution channel', async () => {
  const fixture = midsceneExecutionFixture();
  const adapter = observedAdapter(fixture);
  const originalInteract = adapter.interact;
  adapter.interact = async () => {
    const result = await originalInteract();
    return {
      ...result,
      artifacts: [
        ...result.artifacts,
        {
          kind: 'trace',
          path: result.screenshots[0].path,
          producer: 'midscene-runner',
          sha256: result.screenshots[0].sha256,
          size: result.screenshots[0].size
        }
      ],
      console: [{ type: 'log', text: 'ready' }],
      network: [{ phase: 'response', status: 200 }]
    };
  };
  const orchestrator = createOrchestrator(fixture, adapter);
  try {
    const result = await orchestrator.executeMidscene(midsceneRequest(fixture));
    assert.equal(result.status, 'passed');
    assert.equal(result.artifacts.length, 2);
    assert.equal(result.assertions.length, 1);
    assert.equal(result.console.length, 1);
    assert.equal(result.network.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('human signoff reviewer and evidence hash must match the approved execution', async () => {
  for (const mutate of [
    (signoff) => {
      signoff.reviewer.id = 'another-reviewer';
    },
    (signoff) => {
      signoff.screenshot_sha256 = '0'.repeat(64);
    },
    (signoff) => {
      signoff.attempt_id = 'another-attempt';
    }
  ]) {
    const fixture = midsceneExecutionFixture({
      oracleType: 'human_signoff',
      humanSignoffAllowed: true
    });
    const orchestrator = createOrchestrator(
      fixture,
      observedAdapter(fixture, { assertions: [] })
    );
    try {
      fs.mkdirSync(fixture.artifactRoot, { recursive: true });
      fs.writeFileSync(
        path.join(fixture.artifactRoot, 'screenshot.png'),
        'png'
      );
      const signoff = signoffFor(fixture);
      mutate(signoff);
      const result = await orchestrator.executeMidscene(midsceneRequest(
        fixture,
        { signoff }
      ));
      assert.equal(result.status, 'blocked');
      assert.equal(
        result.blockers[0].id,
        'verification-execution:midscene-human-signoff-invalid'
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test('missing, forged, or tampered screenshots block before oracle evaluation', async () => {
  const cases = [
    { screenshots: [] },
    {
      screenshots: [{
        kind: 'screenshot',
        path: '/tmp/nonexistent-midscene.png',
        producer: 'midscene-runner',
        sha256: '0'.repeat(64),
        size: 3
      }]
    },
    {
      mutateAfterReturn: true
    }
  ];
  for (const item of cases) {
    const fixture = midsceneExecutionFixture();
    const base = observedAdapter(fixture, item.screenshots
      ? { screenshots: item.screenshots }
      : {});
    const adapter = item.mutateAfterReturn
      ? {
        validate: base.validate,
        async interact() {
          const result = await base.interact();
          fs.writeFileSync(result.screenshots[0].path, 'tampered');
          return result;
        }
      }
      : base;
    const orchestrator = createOrchestrator(fixture, adapter);
    try {
      const result = await orchestrator.executeMidscene(
        midsceneRequest(fixture)
      );
      assert.equal(result.status, 'blocked');
      assert.equal(
        result.blockers[0].id,
        'verification-execution:midscene-screenshot-invalid'
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test('malformed and hostile adapter results fail closed', async () => {
  for (const value of [
    null,
    new Proxy({}, {
      getPrototypeOf() {
        throw new Error('hostile');
      }
    })
  ]) {
    const fixture = midsceneExecutionFixture();
    const orchestrator = createOrchestrator(fixture, {
      validate() {
        return { ok: true, blockers: [] };
      },
      async interact() {
        return value;
      }
    });
    try {
      const result = await orchestrator.executeMidscene(
        midsceneRequest(fixture)
      );
      assert.equal(result.status, 'blocked');
      assert.equal(
        result.blockers[0].id,
        'verification-execution:midscene-adapter-result-invalid'
      );
    } finally {
      fixture.cleanup();
    }
  }
});
