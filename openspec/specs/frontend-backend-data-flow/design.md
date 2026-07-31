# Frontend-Backend Data Flow Spec

## Overview

SpecNav Verification 2.0 is a CLI and file-artifact pipeline. User actions enter
through a host-agent skill or direct command, are validated against lifecycle
state, execute through a managed verification runtime, and produce immutable
case, run, attempt, reading, evidence, report, and gate artifacts.

## Flow Index

| Flow ID | Trigger | Entry UI | API/Service | Persistence | User Result |
| --- | --- | --- | --- | --- | --- |
| `FLOW-VERIFY-PLAN` | user starts verification planning | agent skill/CLI | case contract planner | `verify/cases/*`, plan and signoff files | reviewable six-domain case catalog |
| `FLOW-CASE-APPROVAL` | user approves or rejects cases | agent review prompt | case approval service | immutable case snapshot and signoff | exact approved execution scope |
| `FLOW-RUNTIME-SETUP` | user explicitly installs runtime | setup skill/CLI | managed runtime installer | `~/.specnav/runtime/verification/<version>/` receipt and lock | Playwright/Midscene readiness or exact blocker |
| `FLOW-VERIFY-RUN` | approved verification begins | agent skill/CLI | execution orchestrator and runner adapters | run, attempt, reading, log, trace, screenshot, video artifacts | live progress and terminal run state |
| `FLOW-EVIDENCE-INGEST` | runner emits evidence | runner adapter | EvidenceStore | raw JSONL, content files, summary index | evidence linked to run/case/step/SHA |
| `FLOW-FAILURE-REPAIR` | an assertion fails | verification result | classifier then development repair bridge | failure packet and repair task reference | retry, product fix, test fix, environment fix, or blocked decision |
| `FLOW-RETEST-REGRESSION` | code/test/environment changes after failure | repair completion | rerun scope and execution orchestrator | new run/attempts preserving previous failure | pass-after-fix and regression verdict |
| `FLOW-REPORT` | terminal or blocked state changes | report command | aggregate model and renderer | overview, case catalog, case results HTML | stakeholder-ready green/red/blocked report |
| `FLOW-RELEASE-GATE` | release or archive requested | operations skill/CLI | lifecycle DecisionEngine | gate decision and operations artifacts | pass or exact blockers |

## Boundary Contracts

- UI event contract: a skill/command names the active change and legal action;
  no newest-change fallback.
- Client state contract: host-agent conversational state is advisory only;
  durable workflow state is read from OpenSpec artifacts.
- Request schema: versioned JSON input with project root, active change, stage,
  case selection, policy, and runtime version.
- Response schema: versioned JSON containing `ok`, verdict, blockers, warnings,
  artifacts, and next legal actions.
- Error schema: stable blocker ids plus human-readable context and affected
  paths.
- Permission contract: user approval is required for case signoff,
  `not_applicable`, managed runtime installation, prototype approval, and
  release/archive.

## State Ownership

- URL state: report filters and selected case/run only.
- Local component state: table sorting, disclosure panels, and transient report
  navigation.
- Shared client cache: none.
- Server state: process-local orchestration state during one command.
- Database state: none.
- File state: OpenSpec and Verification Runtime artifacts are authoritative.
- Derived state: domain summaries, report models, freshness, impact scope, and
  gate decisions are rebuildable from raw contracts and evidence.

## Validation Ownership

- Client-side validation: report filter values and static navigation only.
- Server-side validation: CLI input, lifecycle state, case approval, runtime
  readiness, evidence integrity, and gate policies.
- Database constraints: replaced by JSON Schema, path containment, immutable
  identity, checksum, and reference validation.
- Cross-field or cross-entity rules: run/case/attempt/SHA binding, retry
  fingerprint equality, deterministic oracle requirements, and approved
  `not_applicable`.
- Error copy source: stable blocker registry owned by the Verification Kernel.

## Error & Empty States

- Empty state: no approved cases, no runs, or no evidence is shown explicitly
  and blocks completion.
- Permission denied: missing user approval produces an approval blocker and no
  execution.
- Validation error: malformed schemas list exact file and field blockers.
- Network error: Midscene/provider failures are execution failures, never PASS.
- Server error: runner/process failures preserve logs and attempt state.
- Conflict/stale data: code SHA, test SHA, environment hash, case snapshot, or
  evidence hash mismatch marks affected readings stale and blocks required
  gates.

## Loading / Optimistic / Retry Behavior

- Initial loading: CLI emits a run id before starting child processes; reports
  can render the running state.
- Partial loading: completed cases remain visible while other cases run.
- Optimistic update: forbidden for verdicts, approvals, evidence, and gates.
- Retry rule: retry is allowed only without product/test changes and with the
  same code SHA, test SHA, scenario hash, environment hash, browser project,
  and test data snapshot.
- Cancellation rule: cancellation writes a terminal canceled attempt and
  preserves captured evidence.
- Idempotency rule: artifact writers use stable ids and refuse accidental
  overwrite of immutable attempts or evidence.
- Rollback: a failed repair restores production code through the development
  rollback plan; verification artifacts remain append-only and are never rolled
  back or erased.

## End-to-End Flow Details

### `FLOW-VERIFY-PLAN`

1. User requests verification.
2. Core resolves the exact active change and development handoff.
3. Verification reads requirements, acceptance, task evidence, prototype
   decisions, CodeGraph impact, and project test surfaces.
4. Planner creates behavior-facing cases with steps, assertions, six-domain
   mappings, runners, and evidence policy.
5. Schema validation runs.
6. User receives a catalog and approval request.
7. No case executes before approval.
8. Re-running planning is idempotent for unchanged input fingerprints.
9. A changed plan invalidates prior approval and requires re-signoff.
10. The planning event is appended to the audit journal.

### `FLOW-VERIFY-RUN`

1. User starts an approved run.
2. Orchestrator checks runtime doctor, browser availability, model
   configuration when needed, and case snapshot integrity.
3. A run manifest binds code SHA, test SHA, environment hash, and case snapshot.
4. Runner adapters execute deterministic static/unit/API/browser commands.
5. Midscene may locate, interact, and describe UI state but cannot decide PASS.
6. Playwright assertions, API/DB facts, structured comparisons, or human
   signoff produce final readings.
7. EvidenceStore writes content and raw index records.
8. Retry is classified separately from retest and regression.
9. Failures freeze evidence and create failure packets.
10. Every process and adapter writes structured logs and exit state.

### `FLOW-FAILURE-REPAIR`

1. A failed reading enters classification.
2. The system distinguishes product defect, test defect, environment defect,
   flaky behavior, expected blocker, and requirement ambiguity.
3. Product-code repairs become standard development task packets.
4. Development changes code under scope lock and runs its own reviews.
5. Verification computes exact retest and regression case scope.
6. A new run/attempt is created; old failure evidence is retained.
7. Passing after code repair is labeled `PASS AFTER FIX`.
8. Passing only after same-fingerprint retry is labeled `FLAKY`.
9. Regression failures reopen the repair loop.
10. Repeated no-progress loops invoke the existing break-loop governance.

### `FLOW-REPORT`

1. Any terminal, partial, or blocked state can trigger rendering.
2. Renderer reads validated aggregate data, never hand-authored green prose.
3. `overview.html` summarizes release readiness and six-domain state.
4. `test-case-catalog.html` lists approved cases, steps, domains, and evidence
   policy.
5. `test-case-results.html` lists runs, attempts, readings, evidence, freshness,
   and repair history.
6. All links resolve to existing evidence or show a broken-evidence blocker.
7. Filter state affects presentation only.
8. Re-rendering does not alter source evidence.
9. Report generation failure does not erase JSON/JSONL truth.
10. Render events and renderer version are recorded.

## Async / Realtime Flows

- Queue/event source: bounded child process output and append-only run events.
- Subscriber: execution orchestrator and report progress model.
- Retry/dead-letter behavior: no hidden queue; terminal process failures become
  explicit attempts and blockers.
- Realtime update channel: stdout/stderr JSONL event stream.
- Consistency expectation: append-only raw events with deterministic terminal
  summary generation.

## Flow Do's and Don'ts

- Do bind every requirement and acceptance criterion to approved cases.
- Do bind every reading to one run, case, attempt, step/assertion, code SHA,
  test SHA, and evidence set.
- Do keep retry, retest, and regression as separate transitions.
- Do render blocked and failed reports with complete diagnostic context.
- Don't execute unapproved cases.
- Don't overwrite failed evidence after a repair.
- Don't treat Midscene interpretation, a screenshot path, or a manual domain
  summary as sufficient PASS evidence.
- Don't use a simplified verification path.
