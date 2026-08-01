'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const {
  ROOT,
  createOrchestrator,
  midsceneExecutionFixture,
  midsceneRequest
} = require('./test-helpers');
const {
  createMidsceneAdapter
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/adapters/midscene-adapter'
));
const {
  doctorRuntime
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/kernel/runtime/doctor'
));
const {
  currentEnvironment
} = require(path.join(
  ROOT,
  'plugins/specnav-verification/scripts/verification-runtime'
));

const RUNTIME_VERSION = '2.0.0-alpha.1';

function createFixtureServer() {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>SpecNav Midscene Live Verification</title>
          <style>
            body {
              align-items: center;
              background: #f4f4f2;
              display: flex;
              font-family: Arial, sans-serif;
              justify-content: center;
              margin: 0;
              min-height: 100vh;
            }
            main {
              background: #fff;
              border: 1px solid #222;
              padding: 32px;
              width: 420px;
            }
            button {
              background: #111;
              border: 0;
              color: #fff;
              cursor: pointer;
              font-size: 18px;
              margin-top: 20px;
              padding: 12px 20px;
            }
            output {
              display: block;
              font-size: 24px;
              font-weight: 700;
              margin-top: 24px;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>Payroll verification</h1>
            <p>Confirm the approved payroll state.</p>
            <button id="confirm" type="button">Confirm</button>
            <output id="status">Pending</output>
          </main>
          <script>
            document.querySelector('#confirm').addEventListener('click', () => {
              document.querySelector('#status').textContent = 'Ready';
              console.log('payroll-ready');
            });
          </script>
        </body>
      </html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => (
            error ? closeReject(error) : closeResolve()
          ));
        })
      });
    });
  });
}

function safeSummary(result, runtimeStatus, artifactRoot) {
  return {
    schema: 'specnav.verification.midscene-live-proof.v1',
    ok: result.ok === true,
    status: result.status,
    runtime: {
      readiness: runtimeStatus.readiness,
      runtime_version: runtimeStatus.runtime_version,
      provider: runtimeStatus.checks.provider
    },
    run_id: result.run?.id || null,
    attempt_id: result.attempt?.id || null,
    runner: result.attempt?.runner || null,
    prompt: result.prompt,
    model: result.model,
    observation: result.observation,
    oracle: result.oracle,
    assertions: result.assertions,
    screenshots: result.screenshots,
    artifacts: result.artifacts,
    console: result.console,
    network: result.network,
    blockers: result.blockers,
    artifact_root: artifactRoot,
    fallback_used: false
  };
}

async function main() {
  const runtimeStatus = doctorRuntime({
    requestedVersion: RUNTIME_VERSION,
    environment: currentEnvironment(),
    providerEnvironment: process.env,
    requiresMidscene: true,
    runtimeBase: path.join(
      process.env.HOME,
      '.specnav',
      'runtime',
      'verification'
    )
  });
  if (!runtimeStatus.ok) {
    process.stdout.write(`${JSON.stringify({
      schema: 'specnav.verification.midscene-live-proof.v1',
      ok: false,
      status: 'blocked',
      runtime: runtimeStatus,
      fallback_used: false
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const fixtureServer = await createFixtureServer();
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
  const runId = `run-midscene-live-${stamp}`;
  const attemptId = `attempt-midscene-live-${stamp}`;
  const artifactRoot = path.join(
    ROOT,
    'openspec',
    'changes',
    'verification-2-0',
    'development',
    'evidence',
    `${runId}-artifacts`
  );
  const fixture = midsceneExecutionFixture({
    allowedOrigins: [fixtureServer.origin],
    artifactRoot,
    attemptId,
    projectRoot: ROOT,
    prompt: 'Click the button labeled Confirm.',
    runId,
    runtimeStatus,
    startUrl: `${fixtureServer.origin}/`,
    timeoutMs: 180000,
    oracleScenario: async ({ page, assertion }) => {
      const status = await page.locator('#status').textContent();
      assertion.ok('assertion-1', status === 'Ready');
    }
  });
  const orchestrator = createOrchestrator(
    fixture,
    createMidsceneAdapter({ providerEnvironment: process.env })
  );

  try {
    const result = await orchestrator.executeMidscene(
      midsceneRequest(fixture)
    );
    const summary = safeSummary(result, runtimeStatus, artifactRoot);
    if (fs.existsSync(artifactRoot)) {
      fs.writeFileSync(
        path.join(artifactRoot, 'proof.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600
        }
      );
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    const requiredArtifactKinds = new Set([
      'assertion_result',
      'log',
      'screenshot',
      'trace',
      'video'
    ]);
    const actualArtifactKinds = new Set(
      result.artifacts.map((entry) => entry.kind)
    );
    const completeArtifacts = [...requiredArtifactKinds].every(
      (kind) => actualArtifactKinds.has(kind)
    );
    const screenshotExists = result.screenshots.length === 1
      && fs.existsSync(result.screenshots[0].path);
    const deterministicPass = result.oracle?.type === 'deterministic'
      && result.assertions.length === 1
      && result.assertions[0].status === 'passed';

    if (
      result.ok !== true
      || result.status !== 'passed'
      || result.attempt?.runner !== 'midscene'
      || !completeArtifacts
      || !screenshotExists
      || !deterministicPass
      || result.blockers.length !== 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await fixtureServer.close();
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    schema: 'specnav.verification.midscene-live-proof.v1',
    ok: false,
    status: 'blocked',
    error: error instanceof Error ? error.message : String(error),
    fallback_used: false
  }, null, 2)}\n`);
  process.exitCode = 1;
});
