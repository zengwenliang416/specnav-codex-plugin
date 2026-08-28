'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const {
  ROOT,
  browserExecutionFixture,
  playwrightRequest
} = require('./test-helpers');

function createOrchestrator(fixture, playwrightAdapter) {
  const { createExecutionOrchestrator } = require(
    `${ROOT}/plugins/specnav-verification/kernel/execution`
  );
  return createExecutionOrchestrator({
    approvalValidator: fixture.approvalValidator,
    schemaRegistry: fixture.schemaRegistry,
    commandAdapter: {
      validate() {
        return { ok: true, blockers: [] };
      },
      async execute() {
        throw new Error('command adapter must not execute');
      }
    },
    playwrightAdapter,
    crossReferenceValidator: fixture.crossReferenceValidator,
    projectRoot: fixture.projectRoot,
    clock: fixture.clock
  });
}

async function localPage(t) {
  const server = http.createServer((request, response) => {
    if (request.url === '/api/status') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'ready' }));
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
      <html>
        <body>
          <button id="load">Load</button>
          <output id="status">idle</output>
          <script>
            console.log('fixture-console');
            document.querySelector('#load').addEventListener('click', async () => {
              const value = await fetch('/api/status').then((item) => item.json());
              document.querySelector('#status').textContent = value.status;
            });
          </script>
        </body>
      </html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('playwright case schema requires scenario, browser, and access identity', () => {
  const { readySchemaRegistry, sampleCase } = require('../cases/test-helpers');
  const registry = readySchemaRegistry();
  const result = registry.validate('test-case', sampleCase({
    runner: {
      kind: 'playwright',
      timeout_ms: 1000,
      requires_midscene: false
    }
  }));

  assert.equal(result.ok, false);
  const requiredFields = new Set(result.blockers.map((entry) => entry.field));
  assert.deepEqual(
    [...requiredFields].filter((field) => [
      '/runner/scenario_id',
      '/runner/scenario_hash',
      '/runner/browser_project',
      '/runner/allowed_origins'
    ].includes(field)).sort(),
    [
      '/runner/allowed_origins',
      '/runner/browser_project',
      '/runner/scenario_hash',
      '/runner/scenario_id'
    ]
  );
});

test('kernel exports the Playwright adapter and unified execution method', () => {
  const kernel = require(`${ROOT}/plugins/specnav-verification`);
  const fixture = browserExecutionFixture();

  try {
    assert.equal(typeof kernel.createPlaywrightAdapter, 'function');
    const orchestrator = createOrchestrator(fixture, {
      validate() {
        return { ok: true, blockers: [] };
      },
      async execute() {
        throw new Error('not executed');
      }
    });
    assert.equal(typeof orchestrator.executePlaywright, 'function');
  } finally {
    fixture.cleanup();
  }
});

test('playwright preflight rejects scenario and browser mismatches before launch', async () => {
  const fixture = browserExecutionFixture();
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });

  try {
    for (const [field, value, blocker] of [
      [
        'scenario_id',
        'unapproved-scenario',
        'verification-execution:playwright-scenario-mismatch'
      ],
      [
        'browser_project',
        'webkit',
        'verification-execution:playwright-browser-project-mismatch'
      ]
    ]) {
      const request = playwrightRequest(fixture, async () => {});
      request.playwright[field] = value;
      const result = await orchestrator.executePlaywright(request);
      assert.equal(result.status, 'blocked');
      assert.equal(result.attempt, null);
      assert.equal(result.blockers[0].id, blocker);
    }
    assert.equal(executeCalls, 0);
  } finally {
    fixture.cleanup();
  }
});

test('playwright preflight binds source and attempt hashes to the approved scenario', async () => {
  const fixture = browserExecutionFixture();
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });
  const approvedScenario = async ({ assertion }) => {
    assertion.ok('assertion-1', true);
  };

  try {
    const replacedSource = playwrightRequest(fixture, approvedScenario);
    replacedSource.playwright.scenario = async ({ assertion }) => {
      assertion.ok('assertion-1', false);
    };
    const sourceResult = await orchestrator.executePlaywright(replacedSource);
    assert.equal(sourceResult.status, 'blocked');
    assert.equal(sourceResult.attempt, null);
    assert.equal(
      sourceResult.blockers[0].id,
      'verification-execution:playwright-scenario-hash-mismatch'
    );

    const forgedAttempt = playwrightRequest(fixture, approvedScenario);
    forgedAttempt.attempt.scenario_hash = 'a'.repeat(64);
    const attemptResult = await orchestrator.executePlaywright(forgedAttempt);
    assert.equal(attemptResult.status, 'blocked');
    assert.equal(attemptResult.attempt, null);
    assert.equal(
      attemptResult.blockers[0].id,
      'verification-execution:playwright-attempt-scenario-hash-mismatch'
    );

    const forgedOrigins = playwrightRequest(fixture, approvedScenario);
    forgedOrigins.playwright.allowed_origins = ['https://forged.invalid'];
    const originsResult = await orchestrator.executePlaywright(forgedOrigins);
    assert.equal(originsResult.status, 'blocked');
    assert.equal(originsResult.attempt, null);
    assert.equal(
      originsResult.blockers[0].id,
      'verification-execution:playwright-allowed-origins-mismatch'
    );
    assert.equal(executeCalls, 0);
  } finally {
    fixture.cleanup();
  }
});

test('playwright adapter independently verifies the approved scenario hash', async () => {
  const fixture = browserExecutionFixture();
  const scenario = async ({ assertion }) => {
    assertion.ok('assertion-1', true);
  };
  const request = playwrightRequest(fixture, scenario);
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );

  try {
    const result = await createPlaywrightAdapter().execute(
      request.playwright,
      {
        runtimeStatus: fixture.runtimeStatus,
        projectRoot: fixture.projectRoot,
        timeoutMs: fixture.testCase.runner.timeout_ms,
        assertionContracts: fixture.testCase.assertions,
        expectedScenarioHash: 'a'.repeat(64),
        allowedOrigins: request.playwright.allowed_origins
      }
    );
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:playwright-scenario-hash-mismatch'
    );
    assert.equal(fs.existsSync(fixture.artifactRoot), false);
  } finally {
    fixture.cleanup();
  }
});

test('real managed Playwright run captures deterministic browser artifacts', async (t) => {
  const baseUrl = await localPage(t);
  const fixture = browserExecutionFixture();
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, assertion, data }) => {
        await page.goto(data.baseUrl);
        await page.locator('#load').click();
        await page.waitForFunction(() => (
          document.querySelector('#status')?.textContent === 'ready'
        ));
        const actual = await page.locator('#status').textContent();
        assertion.equal('assertion-1', actual, 'ready');
      },
      { scenarioData: { baseUrl } }
    ));

    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.status, 'passed');
    assert.equal(result.attempt.runner, 'playwright');
    assert.equal(result.attempt.browser_project, 'chromium');
    assert.equal(result.browser.project, 'chromium');
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].status, 'passed');
    assert.equal(
      result.console.some((entry) => entry.text === 'fixture-console'),
      true
    );
    assert.equal(
      result.network.some((entry) => entry.url.endsWith('/api/status')),
      true
    );
    for (const kind of [
      'screenshot',
      'video',
      'trace',
      'log',
      'assertion_result'
    ]) {
      const artifact = result.artifacts.find((entry) => entry.kind === kind);
      assert.ok(artifact, `${kind}: ${JSON.stringify(result.artifacts)}`);
      assert.equal(fs.statSync(artifact.path).size > 0, true);
      assert.equal(
        path.relative(fixture.artifactRoot, artifact.path).startsWith('..'),
        false
      );
    }
    const reviewArtifact = result.artifacts.find((entry) => (
      entry.path.endsWith('/human-review.json')
    ));
    assert.ok(reviewArtifact, JSON.stringify(result.artifacts));
    const reviewTimeline = JSON.parse(fs.readFileSync(
      reviewArtifact.path,
      'utf8'
    ));
    assert.equal(reviewTimeline.length >= 4, true);
    assert.equal(
      reviewTimeline.some((entry) => (
        entry.kind === 'action'
        && entry.title.includes('Click')
      )),
      true,
      JSON.stringify(reviewTimeline)
    );
    assert.equal(
      reviewTimeline.some((entry) => (
        entry.kind === 'assertion'
        && entry.status === 'passed'
        && entry.title.includes('assertion-1')
      )),
      true,
      JSON.stringify(reviewTimeline)
    );
    assert.deepEqual(
      reviewTimeline.map((entry) => entry.sequence),
      reviewTimeline.map((_entry, index) => index + 1)
    );
    assert.deepEqual(
      result.events.slice(-2).map((entry) => entry.type),
      ['attempt.terminal', 'run.terminal']
    );
  } finally {
    fixture.cleanup();
  }
});

test('Playwright cannot pass without a deterministic assertion', async (t) => {
  const baseUrl = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-no-assertion'
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, data }) => {
        await page.goto(data.baseUrl);
      },
      { scenarioData: { baseUrl } }
    ));

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(
      result.blockers.some((entry) => (
        entry.id === 'verification-execution:playwright-assertion-missing'
      )),
      true,
      JSON.stringify(result.blockers)
    );
    assert.equal(result.artifacts.length > 0, true);
  } finally {
    fixture.cleanup();
  }
});

test('Playwright assertion failure is terminal failed and retains artifacts', async (t) => {
  const baseUrl = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-failed-assertion'
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, assertion, data }) => {
        await page.goto(data.baseUrl);
        assertion.equal('assertion-1', 'actual', 'expected');
      },
      { scenarioData: { baseUrl } }
    ));

    assert.equal(result.status, 'failed');
    assert.equal(result.attempt.status, 'failed');
    assert.equal(result.assertions[0].status, 'failed');
    assert.equal(result.artifacts.length > 0, true);
    assert.equal(
      result.blockers[0].id,
      'verification-execution:playwright-assertion-failed'
    );
  } finally {
    fixture.cleanup();
  }
});

test('Playwright artifact root must remain inside the project', async () => {
  const fixture = browserExecutionFixture();
  let executeCalls = 0;
  const orchestrator = createOrchestrator(fixture, {
    validate() {
      return { ok: true, blockers: [] };
    },
    async execute() {
      executeCalls += 1;
      throw new Error('must not execute');
    }
  });

  try {
    const request = playwrightRequest(fixture, async () => {});
    request.playwright.artifact_root = path.dirname(fixture.projectRoot);
    const result = await orchestrator.executePlaywright(request);
    assert.equal(result.status, 'blocked');
    assert.equal(executeCalls, 0);
    assert.equal(
      result.blockers[0].id,
      'verification-execution:playwright-artifact-root-outside-project'
    );
  } finally {
    fixture.cleanup();
  }
});

test('Playwright timeout and cancellation produce terminal attempts', async (t) => {
  const baseUrl = await localPage(t);
  for (const mode of ['timeout', 'canceled']) {
    await t.test(mode, async () => {
      const fixture = browserExecutionFixture({
        attemptId: `attempt-${mode}`,
        timeoutMs: mode === 'timeout' ? 50 : 5000
      });
      const { createPlaywrightAdapter } = require(
        `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
      );
      const orchestrator = createOrchestrator(
        fixture,
        createPlaywrightAdapter()
      );
      const controller = new AbortController();
      if (mode === 'canceled') {
        setTimeout(() => controller.abort(), 50);
      }

      try {
        const result = await orchestrator.executePlaywright(playwrightRequest(
          fixture,
          async ({ page, data }) => {
            await page.goto(data.baseUrl);
            await new Promise(() => {});
          },
          {
            scenarioData: { baseUrl },
            signal: controller.signal
          }
        ));

        assert.equal(result.status, mode === 'timeout' ? 'failed' : 'canceled');
        assert.equal(result.attempt.status, result.status);
        assert.equal(
          result.blockers[0].id,
          `verification-execution:playwright-${mode}`
        );
        assert.equal(result.artifacts.length > 0, true);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test('Playwright preserves the first stop cause', async (t) => {
  const baseUrl = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-timeout-before-cancel',
    timeoutMs: 30
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );
  const controller = new AbortController();
  const cancelTimer = setTimeout(() => controller.abort(), 5000);
  cancelTimer.unref();

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, data }) => {
        await page.goto(data.baseUrl);
        await new Promise(() => {});
      },
      {
        scenarioData: { baseUrl },
        signal: controller.signal
      }
    ));

    assert.equal(result.status, 'failed');
    assert.equal(result.blockers[0].id, 'verification-execution:playwright-timeout');
    assert.equal(result.attempt.status, 'failed');
  } finally {
    clearTimeout(cancelTimer);
    fixture.cleanup();
  }
});

test('Playwright rejects symlink escapes and nonempty artifact roots', async () => {
  const externalRoot = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'specnav-browser-external-')
  );
  const fixture = browserExecutionFixture();
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const symlinkRoot = path.join(fixture.projectRoot, 'artifact-link');
    fs.symlinkSync(externalRoot, symlinkRoot);
    const escaped = playwrightRequest(fixture, async () => {});
    escaped.playwright.artifact_root = symlinkRoot;
    const escapedResult = await orchestrator.executePlaywright(escaped);
    assert.equal(escapedResult.status, 'blocked');
    assert.equal(escapedResult.attempt, null);
    assert.equal(
      escapedResult.blockers[0].id,
      'verification-execution:playwright-artifact-root-outside-project'
    );

    const nonemptyRoot = path.join(fixture.projectRoot, 'nonempty-artifacts');
    fs.mkdirSync(nonemptyRoot);
    fs.writeFileSync(path.join(nonemptyRoot, 'existing.txt'), 'existing');
    const nonempty = playwrightRequest(fixture, async () => {});
    nonempty.playwright.artifact_root = nonemptyRoot;
    const nonemptyResult = await orchestrator.executePlaywright(nonempty);
    assert.equal(nonemptyResult.status, 'blocked');
    assert.equal(nonemptyResult.attempt, null);
    assert.equal(
      nonemptyResult.blockers[0].id,
      'verification-execution:playwright-artifact-root-nonempty'
    );
  } finally {
    fixture.cleanup();
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('adapter-owned staging prevents runtime artifact-root symlink escape', async () => {
  const externalRoot = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'specnav-browser-runtime-escape-')
  );
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-runtime-symlink-escape'
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, assertion, artifact_root }) => {
        await page.setContent('<main>contained</main>');
        if (artifact_root) {
          fs.rmSync(artifact_root, { recursive: true, force: true });
          fs.symlinkSync(externalRoot, artifact_root);
        }
        assertion.ok('assertion-1', true);
      }
    ));

    assert.equal(result.status, 'passed', JSON.stringify(result.blockers));
    assert.deepEqual(fs.readdirSync(externalRoot), []);
    for (const artifact of result.artifacts) {
      assert.equal(
        path.relative(fixture.artifactRoot, artifact.path).startsWith('..'),
        false,
        artifact.path
      );
    }
  } finally {
    fixture.cleanup();
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('cancellation stops scenario side effects before terminal return', async () => {
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-cancel-stops-scenario',
    timeoutMs: 5000
  });
  const marker = path.join(fixture.projectRoot, 'late-side-effect.txt');
  const controller = new AbortController();
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, assertion }) => {
        await page.setContent('<main>cancel</main>');
        assertion.ok('assertion-1', true);
        setTimeout(() => {
          fs.writeFileSync(marker, 'late');
        }, 700);
        await new Promise(() => {});
      },
      {
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'browser.assertion') controller.abort();
        }
      }
    ));

    assert.equal(result.status, 'canceled');
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fixture.cleanup();
  }
});

test('process confinement blocks host reads, writes, network, and detached children', async (t) => {
  const baseUrl = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-process-confinement'
  });
  const marker = path.join(fixture.projectRoot, 'sandbox-escape.txt');
  const orphanMarker = path.join(fixture.projectRoot, 'orphan-escape.txt');
  const secret = path.join(fixture.projectRoot, 'host-secret.txt');
  fs.writeFileSync(secret, 'host-secret');
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ page, assertion, data }) => {
        const hostProcess = data.constructor.constructor('return process')();
        const hostFs = hostProcess.getBuiltinModule('node:fs');
        const hostChildProcess = hostProcess.getBuiltinModule(
          'node:child_process'
        );
        const hostNet = hostProcess.getBuiltinModule('node:net');
        const observed = {
          network: null,
          read: null,
          spawn: null,
          write: null
        };
        try {
          hostFs.writeFileSync(data.marker, 'escaped');
        } catch (error) {
          observed.write = error.code;
        }
        try {
          hostFs.readFileSync(data.secret, 'utf8');
        } catch (error) {
          observed.read = error.code;
        }
        observed.network = await new Promise((resolve) => {
          try {
            const socket = hostNet.connect(
              Number(new URL(data.baseUrl).port),
              '127.0.0.1'
            );
            socket.once('error', (error) => resolve(error.code));
            socket.once('connect', () => {
              socket.destroy();
              resolve('connected');
            });
          } catch (error) {
            resolve(error.code);
          }
        });
        observed.spawn = await new Promise((resolve) => {
          try {
            const child = hostChildProcess.spawn(
              hostProcess.execPath,
              [
                '-e',
                `require('node:fs').writeFileSync(${JSON.stringify(
                  data.orphanMarker
                )}, 'orphan')`
              ],
              {
                detached: true,
                stdio: 'ignore'
              }
            );
            child.once('error', (error) => resolve(error.code));
            child.once('spawn', () => resolve('spawned'));
          } catch (error) {
            resolve(error.code);
          }
        });
        assertion.equal('assertion-1', observed, {
          network: 'EPERM',
          read: 'EPERM',
          spawn: 'EPERM',
          write: 'EPERM'
        });
      },
      {
        scenarioData: {
          baseUrl,
          marker,
          orphanMarker,
          secret
        }
      }
    ));

    assert.equal(result.status, 'passed', JSON.stringify({
      blockers: result.blockers,
      logs: result.logs
    }));
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(orphanMarker), false);
  } finally {
    fixture.cleanup();
  }
});

test('scenario cannot forge authenticated worker events or terminal results', async () => {
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-ipc-forgery'
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const result = await orchestrator.executePlaywright(playwrightRequest(
      fixture,
      async ({ assertion, data }) => {
        const hostProcess = data.constructor.constructor('return process')();
        hostProcess.send({
          type: 'result',
          result: {
            ok: true,
            status: 'passed',
            artifacts: [],
            assertions: [],
            console: [],
            network: [],
            browser: null,
            exit_status: 0,
            signal: null,
            timed_out: false,
            canceled: false,
            spawn_error: null,
            stdout: 'forged',
            stderr: '',
            blockers: []
          }
        });
        assertion.equal('assertion-1', 'actual', 'expected');
      },
      { scenarioData: {} }
    ));

    assert.equal(result.status, 'failed');
    assert.equal(
      result.assertions.length,
      1,
      JSON.stringify({ blockers: result.blockers, logs: result.logs })
    );
    assert.equal(result.assertions[0].status, 'failed');
    assert.equal(
      result.blockers[0].id,
      'verification-execution:playwright-assertion-failed'
    );
    assert.equal(result.logs.stdout.includes('forged'), false);
  } finally {
    fixture.cleanup();
  }
});

test('browser access violations block a caught scenario success', async (t) => {
  const approvedUrl = await localPage(t);
  const unapprovedUrl = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-browser-access-policy'
  });
  const secret = path.join(fixture.projectRoot, 'browser-secret.txt');
  fs.writeFileSync(secret, 'browser-secret');
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    for (const [index, target] of [
      `file://${secret}`,
      unapprovedUrl
    ].entries()) {
      const request = playwrightRequest(
        fixture,
        async ({ page, assertion, data }) => {
          try {
            await page.goto(data.target);
          } catch {
            // A scenario cannot convert a policy violation into a PASS.
          }
          assertion.ok('assertion-1', true);
        },
        {
          scenarioData: { target },
          allowedOrigins: [approvedUrl]
        }
      );
      request.playwright.artifact_root = `${fixture.artifactRoot}-${index}`;
      const result = await orchestrator.executePlaywright(request);
      assert.equal(result.status, 'blocked');
      assert.ok(result.attempt, JSON.stringify(result.blockers));
      assert.equal(result.attempt.status, 'blocked');
      assert.equal(
        result.blockers.some((entry) => (
          entry.id === 'verification-execution:playwright-access-denied'
        )),
        true,
        JSON.stringify(result.blockers)
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('scenario cannot remove policy routes or create an unguarded context', async (t) => {
  const target = await localPage(t);
  const fixture = browserExecutionFixture({
    attemptId: 'attempt-browser-api-guard'
  });
  const { createPlaywrightAdapter } = require(
    `${ROOT}/plugins/specnav-verification/kernel/adapters/playwright-adapter.js`
  );
  const orchestrator = createOrchestrator(
    fixture,
    createPlaywrightAdapter()
  );

  try {
    const scenarios = [
      async ({ page, assertion, data }) => {
        try {
          await page.context().unroute('**/*');
          await page.goto(data.target);
        } catch {
          // The guard violation remains terminal even when caught.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ browser, assertion, data }) => {
        try {
          const context = await browser.newContext();
          const page = await context.newPage();
          await page.goto(data.target);
        } catch {
          // The guard violation remains terminal even when caught.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, assertion, data }) => {
        try {
          const popupPromise = page.waitForEvent('popup');
          await page.evaluate(() => window.open('about:blank'));
          const popup = await popupPromise;
          await popup.context().unroute('**/*');
          await popup.goto(data.target);
        } catch {
          // Returned and event-delivered pages remain guarded.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, assertion }) => {
        try {
          await page._browserContext.unroute('**/*');
        } catch {
          // Private Playwright handles are not scenario capabilities.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, assertion, data }) => {
        try {
          await new Promise((resolve) => {
            page.once('popup', async function onPopup(popup) {
              try {
                await this.context().unroute('**/*');
                await popup.goto(data.target);
              } catch {
                // Callback this and arguments are guarded capabilities.
              } finally {
                resolve();
              }
            });
            page.evaluate(() => window.open('about:blank'));
          });
        } catch {
          // The recorded guard violation remains terminal.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, assertion, data }) => {
        try {
          const prototype = Object.getPrototypeOf(page.context());
          await prototype.unroute.call(page.context(), '**/*');
          await page.goto(data.target);
        } catch {
          // Prototype reflection cannot recover raw Playwright methods.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, assertion }) => {
        try {
          page.goto.constructor('return process')();
        } catch {
          // Method constructors are not executable scenario capabilities.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ context, assertion }) => {
        try {
          await new Promise((resolve) => {
            context.once('page', async function onPage(newPage) {
              try {
                await this.newCDPSession(newPage);
              } catch {
                // Callback this keeps the BrowserContext capability policy.
              } finally {
                resolve();
              }
            });
            context.newPage();
          });
        } catch {
          // The recorded guard violation remains terminal.
        }
        assertion.ok('assertion-1', true);
      },
      async ({ page, context, assertion, data }) => {
        try {
          await context.exposeBinding(
            'specnavEscape',
            async ({ page: bindingPage }) => {
              await bindingPage.context().unroute('**/*');
            }
          );
          await page.setContent('<script>window.specnavEscape()</script>');
          await page.waitForTimeout(50);
          await page.goto(data.target);
        } catch {
          // Binding source containers cannot leak raw Playwright objects.
        }
        assertion.ok('assertion-1', true);
      }
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const request = playwrightRequest(fixture, scenario, {
        scenarioData: { target },
        allowedOrigins: ['https://approved.invalid']
      });
      request.playwright.artifact_root = `${fixture.artifactRoot}-guard-${index}`;
      const result = await orchestrator.executePlaywright(request);
      assert.equal(
        result.status,
        'blocked',
        JSON.stringify({ index, blockers: result.blockers })
      );
      assert.equal(
        result.blockers.some((entry) => (
          entry.id === 'verification-execution:playwright-access-denied'
        )),
        true,
        JSON.stringify(result.blockers)
      );
    }
  } finally {
    fixture.cleanup();
  }
});
