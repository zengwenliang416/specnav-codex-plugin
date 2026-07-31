# Component Architecture & Reuse Spec

## Overview

SpecNav requires high cohesion, low coupling, and one host-neutral Verification
Kernel. Codex, Claude Code, and CodeFree-O may differ in plugin manifests,
skills, hooks, configuration, and command invocation, but they must not fork
verification schemas, state transitions, evidence rules, aggregation, or report
semantics.

## Component Taxonomy

- Page/screen components: report overview, test-case catalog, and test-case
  results pages.
- Layout components: report shell, navigation, print header, summary rail, and
  responsive table region.
- Domain components: case row, domain verdict, attempt timeline, repair
  timeline, evidence item, freshness indicator, and gate decision.
- Form components: report filters, case/domain/status selectors, and evidence
  search.
- Data display components: metrics, tables, blocker panels, integrity details,
  command logs, and artifact references.
- Feedback components: loading, empty, red, blocked, stale, canceled, and
  partial-run states.
- Headless hooks/modules: filtering, artifact-link resolution, evidence
  disclosure, and print model.
- Domain utilities/services: schema validation, runtime doctor, case snapshot,
  runner orchestration, EvidenceStore, integrity checker, classifier, rerun
  scope, aggregator, DecisionEngine, and report model builder.
- Host adapters: Codex, Claude Code, and CodeFree-O plugin surfaces.

## Cohesion Rules

- A module has one clear lifecycle responsibility and one authoritative output.
- Runtime installation, execution, evidence capture, evaluation, aggregation,
  reporting, and gate enforcement remain separate modules.
- Runner adapters execute and capture; they do not aggregate release verdicts.
- Midscene adapters interact and interpret; they do not own deterministic
  oracles.
- Report renderers consume a validated report model; they do not repair or
  reinterpret source evidence.
- Host adapters translate invocation and configuration only.

## Coupling Rules

- Host plugins depend on the Verification Kernel's public API and schemas.
- The Verification Kernel must not import host plugin modules or user-interface
  globals.
- Report components depend on report-model types, not raw runner output.
- Evidence consumers reference evidence ids through EvidenceStore APIs, not
  arbitrary file paths.
- Development repair tasks reference failure packets but do not mutate
  verification attempts.
- Operations reads gate decisions and report summaries but does not recompute
  case readings.

## Shared Component Extraction Rules

Extract a component, hook, utility, service, schema, or fixture when any of
these are true:

- The same verification behavior appears in two host repositories.
- The same status, blocker, schema, artifact path, or state transition is
  implemented twice.
- The same HTML component appears on two report pages.
- The same runner lifecycle or evidence normalization is used by two runner
  adapters.
- The same case, run, attempt, reading, evidence, or failure validation is
  repeated.
- A host-specific module starts interpreting domain verdicts.
- A report page starts reading raw JSONL independently.

## Component Public API Rules

- Kernel APIs use versioned structured inputs and outputs.
- Public functions return stable `ok`, status/verdict, blockers, warnings,
  artifacts, and version metadata.
- Schemas are the primary public data contract.
- Events name lifecycle intent such as `approveCases`, `startRun`,
  `classifyFailure`, `requestRepair`, and `renderReport`.
- Host adapters may add display metadata but may not remove required fields.
- Evidence references use ids plus validated relative paths and hashes.

## State Ownership Rules

- Local state: report filtering and disclosure only.
- Shared UI state: report navigation model.
- Server/cache state: managed runtime package cache and rebuildable evidence
  summary index.
- Form state: pending report filters; no optimistic approvals.
- URL state: selected report page, case, run, and filters.
- Derived state: domain aggregation, freshness, impact scope, and gate verdict.
- Authoritative state: OpenSpec case/run/evidence/failure/gate artifacts.

## Composition Patterns

- Preferred composition patterns: dependency injection for adapters,
  pure validation/aggregation functions, append-only raw stores, deterministic
  render models, and small host shims.
- Forbidden composition patterns: host conditionals inside kernel logic,
  renderer reads from arbitrary raw files, agent prose as oracle, and
  cross-stage mutation.
- Approved provider/context boundaries: runtime provider configuration enters
  only through runtime setup/doctor and is redacted from artifacts.
- Approved headless hook patterns: pure selectors over validated report models.

## File & Naming Conventions

- Kernel module naming: domain-purpose modules such as
  `evidence-store.js`, `verification-state-machine.js`, and
  `report-model.js`.
- Schema naming: `<entity>.schema.json` with explicit schema version.
- Adapter naming: `<surface>-adapter.js`.
- Test naming: fixture shell for integration contracts and `.test.js` or
  `.spec.js` for focused unit/browser tests.
- Story/prototype naming: stable `data-specnav-*` review anchors.
- Barrel/export rules: one explicit kernel entry module; avoid implicit wildcard
  exports.

## Testing Expectations

- Shared component tests: report components render green, red, blocked, stale,
  flaky, and pass-after-fix states.
- Kernel unit tests: schemas, state transitions, identity binding, integrity,
  aggregation, freshness, and gate policies.
- Adapter contract tests: Playwright, Midscene, CLI, and host adapters against
  the same shared fixtures.
- Integration tests: real browser execution writes valid run/attempt/evidence
  artifacts and all three reports.
- Accessibility checks: keyboard, semantic tables, labels, contrast, and print.
- Visual/prototype review: desktop/mobile report pages using the approved light
  design system.
- Negative fixtures: forged hashes, missing files, stale SHA, empty evidence,
  manual green reports, model-only PASS, overwritten attempts, and invalid
  `not_applicable`.

## Refactor Triggers

- Duplicate logic detected across Codex, Claude Code, or CodeFree-O.
- Cross-boundary import detected between kernel and host implementations.
- Props or function inputs become tied to one host's runtime objects.
- A module performs execution, evaluation, and reporting together.
- Test setup requires unrelated stage plugins.
- Raw evidence and summary index disagree.
- A new runner or evidence kind requires edits in more than one host adapter.

## Required Shared Families

- Contract family: case, approval, run, attempt, reading, evidence, failure,
  report, runtime, and gate schemas.
- Runtime family: installer, lock resolver, browser manager, doctor, and
  redacted configuration reader.
- Execution family: orchestrator, runner adapter interface, Playwright adapter,
  Midscene adapter, and command adapter.
- Evidence family: writer, raw store, summary index, hash verifier, freshness
  evaluator, and artifact resolver.
- Evaluation family: deterministic oracle boundary, six-domain mapper,
  aggregator, and DecisionEngine.
- Repair family: failure classifier, failure packet, repair bridge, retest
  planner, regression planner, and loop guard.
- Reporting family: report model and three page renderers sharing components.
- Host family: Codex, Claude Code, and CodeFree-O invocation/configuration
  adapters.

## Component Do's and Don'ts

- Do extract host-neutral logic before adding the same capability to a second
  repository.
- Do maintain one schema and one fixture corpus for all hosts.
- Do keep every report page on the shared report model and component library.
- Do make runner and model dependencies replaceable through explicit adapters.
- Don't duplicate Verification Kernel files across host repositories.
- Don't let Midscene, a host agent, or a report renderer own final PASS.
- Don't hide shared logic in a skill prose file or page-local script.
- Don't create a light or bypass verification component family.
