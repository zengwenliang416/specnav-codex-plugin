# Requirements: verification-2-0

## Summary

Upgrade SpecNav verification from six independent report entrypoints into one
governed Verification 2.0 lifecycle:

```text
approved cases
  -> managed runtime
  -> execution
  -> immutable evidence
  -> deterministic readings
  -> six-domain aggregation
  -> failure classification
  -> repair
  -> retest and regression
  -> stakeholder reports
  -> release and archive gate
```

Verification 2.0 has no light, compact, or simplified verification lane. A
simple product change may use a compact requirements/development path, but once
it enters verification it follows the same case approval, evidence integrity,
repair-loop, reporting, and archive controls as every other change.

## Users & Actors

- Change author: requests verification and fixes product or test defects.
- Test-case reviewer: reviews the proposed behavior cases before execution.
- Verification operator: installs/repairs the managed runtime and starts runs.
- Quality reviewer: inspects six-domain readings and evidence integrity.
- Stakeholder reviewer: reviews the three-page HTML report without reading raw
  JSON/JSONL first.
- Release owner: accepts or rejects release/archive based on fresh gate
  decisions.
- SpecNav host adapter: exposes the same Verification Kernel to Codex, Claude
  Code, and CodeFree-O.
- Runner adapter: executes deterministic commands, Playwright, or Midscene
  interactions and writes structured output.

## In Scope

### Verification Contract V2

- Versioned schemas for test cases, case approval, case snapshots, runs,
  attempts, readings, evidence, evidence index, failure packets, repair links,
  report models, runtime status, and gate decisions.
- Stable ids and immutable bindings across change, requirement, case, run,
  attempt, step/assertion, code SHA, test SHA, scenario hash, environment hash,
  browser project, and test data snapshot.
- Explicit `not_applicable` status requiring reason, evidence, reviewer, and
  approval timestamp.

### Managed Verification Runtime

- Explicit installer and doctor under
  `~/.specnav/runtime/verification/<version>/`.
- Version-locked `@playwright/test`, `playwright`, Playwright browsers,
  `@midscene/web`, and `ajv`.
- Install receipt, package lock, browser receipt, runtime health, model
  configuration status, and exact blockers.
- No silent install and no writes to a business project's `package.json`.
- No fallback when a required dependency, browser, provider configuration, or
  executable is missing.

### Execution and Evidence

- A unified execution orchestrator with command, Playwright, and Midscene
  adapters.
- Midscene may locate, interact, and interpret UI state, but final PASS requires
  Playwright assertions, API/database facts, structured comparisons, or
  explicit human signoff.
- EvidenceStore with raw append-only JSONL, content-addressed evidence files,
  summary index, and rebuildable cache.
- Evidence integrity checks for file existence, hash, size, producer, freshness,
  and run/case/step/SHA binding.
- Screenshots, video, trace, logs, command output, assertion results, structured
  API facts, and human signoff as typed evidence kinds.

### Six-Domain Evaluation

- Every approved test case maps to facticity, static, unit, redteam, e2e, and
  sensory domains.
- Every domain reaches `passed`, `failed`, `blocked`, or explicitly approved
  `not_applicable`.
- Domain reports are derived from case readings and evidence; an agent cannot
  hand-author a green domain report.
- Empty commands, empty evidence, fake paths, stale evidence, or model-only
  judgments cannot yield green.

### Failure and Repair Loop

- Separate retry, retest, and regression semantics.
- Preserve every failed attempt and its evidence.
- Classify product defect, test defect, environment defect, flaky behavior,
  expected blocker, and requirement ambiguity.
- Verification owns failure evidence and classification.
- Development owns product-code or test-code repair through standard scoped
  task packets and review.
- Core owns lifecycle transitions and repeated-no-progress break-loop handling.
- Passing after unchanged-fingerprint retry is `FLAKY`; passing after repair is
  `PASS AFTER FIX`.

### Freshness, Impact, and Gates

- SHA/fingerprint-based freshness replaces mtime-only freshness.
- Case-level rerun scope replaces domain-only rerun scope.
- CodeGraph impact evidence may narrow affected cases but cannot override
  required verification or invent proof.
- Release and archive require approved cases, terminal readings, intact and
  fresh evidence, completed repair/regression loops, report generation, and a
  green gate.

### Report Center

- Generate `overview.html`, `test-case-catalog.html`, and
  `test-case-results.html`.
- Render green, red, blocked, running, canceled, stale, flaky, and
  pass-after-fix states.
- Use one shared report model and component family.
- Link every displayed result to existing evidence and show integrity/freshness
  state.
- Follow the light-only warm editorial design system in the foundation spec.

### Cross-Host Delivery

- Extract a host-neutral Verification Kernel before duplicating new behavior.
- Integrate the same schemas, blockers, state machine, fixtures, and report
  semantics into Codex, Claude Code, and CodeFree-O.
- Keep host-specific plugin manifests, skills, hooks, configuration, and
  invocation in thin adapters.
- Validate installation/discovery and runtime behavior in all three hosts.

### Migration and Productization

- Explicit V1-to-V2 migration with dry run, backup, validation, and rollback.
- Negative fixtures for fake-green and evidence-tampering scenarios.
- Real browser integration tests for Playwright and report pages.
- CI, installation docs, bilingual README updates, workflow diagrams, runtime
  troubleshooting, and release/archive checks.

## Out of Scope

- Replacing OpenSpec or the SpecNav lifecycle.
- Modifying a business application's product code as part of the runtime
  installer.
- Silently installing model providers, credentials, MCP configuration, or
  CodeGraph indexes.
- Letting Midscene or any LLM independently declare a final PASS.
- Building a hosted report server, cloud evidence store, or remote telemetry
  service.
- Supporting a verification light mode.
- Supporting dark mode or a runtime locale switch in the initial report center.
- Treating CodeGraph as a substitute for tests, browser execution, or evidence
  integrity.

## UI Design Impact

- Foundation spec: `openspec/specs/ui-design/design.md`
- Build one shared light-only report shell and component family for all three
  pages.
- Preserve compact engineering density, warm editorial surfaces, semantic
  statuses, accessible tables, keyboard navigation, and print output.
- Render identical information architecture for green, red, and blocked states.
- No theme switch and no locale switch.

## Theme & Locale Capability Impact

- Theme support: `light-only`.
- Theme toggle policy: explicitly omit.
- Internationalization: `disabled` at runtime.
- Supported locales: `none` at runtime.
- Default locale: `none`.
- Prototype coverage: light report theme on desktop and mobile; no theme or
  locale control. README documentation remains separate English and Simplified
  Chinese files.

## Architecture & Database Impact

- Foundation spec: `openspec/specs/system-architecture/design.md`
- Add a host-neutral Verification Kernel and thin host adapters.
- Add a managed runtime outside business repositories.
- Replace hand-authored/loosely validated verification artifacts with versioned
  contracts and deterministic aggregation.
- Persistence remains file-based under `openspec/`; no database is added.
- Runtime dependencies are installed only into
  `~/.specnav/runtime/verification/<version>/`.

## Frontend-Backend Data Flow Impact

- Foundation spec:
  `openspec/specs/frontend-backend-data-flow/design.md`
- Implement the complete flows `FLOW-VERIFY-PLAN`, `FLOW-CASE-APPROVAL`,
  `FLOW-RUNTIME-SETUP`, `FLOW-VERIFY-RUN`, `FLOW-EVIDENCE-INGEST`,
  `FLOW-FAILURE-REPAIR`, `FLOW-RETEST-REGRESSION`, `FLOW-REPORT`, and
  `FLOW-RELEASE-GATE`.
- Durable artifacts, not conversational state, control execution and gates.
- Every failed, blocked, canceled, flaky, retested, and regressed state remains
  visible and auditable.

## Component Architecture Impact

- Foundation spec: `openspec/specs/component-architecture/design.md`
- Cohesion/coupling impact: separate runtime, execution, evidence, evaluation,
  repair, reporting, gate, and host-adapter modules.
- Shared extraction requirement: extract one Verification Kernel, schema set,
  fixture corpus, report model, and report component family before host
  integration.
- Existing duplicated `verify-domains.js`, `evidence-runner.js`, and
  `rerun-scope.js` behavior must converge on shared kernel APIs.

## Non-Functional Requirements

- Determinism: the same validated input artifacts produce the same aggregate
  and report model.
- Integrity: evidence tampering or broken references block green.
- Auditability: every gate decision identifies its source cases, readings,
  evidence, policy, and kernel version.
- Compatibility: Node.js 22 and macOS/Linux local execution.
- Security: secrets are redacted; HTML and logs are escaped before rendering.
- Performance: report generation reads summary indexes first and can rebuild
  them from raw evidence.
- Recoverability: managed runtime is side-by-side and rebuildable; V1 artifacts
  are preserved until migration succeeds.

## Unresolved Gaps

- None. Product and architecture decisions for the planning phase are closed.
