# System Architecture & Database Spec

## Overview

SpecNav is a multi-plugin lifecycle control system for coding agents. The Codex
repository is the control implementation for Verification 2.0 and publishes
host-specific plugin packages while preserving host-neutral lifecycle,
verification, evidence, and reporting contracts.

The project does not use an application database. Durable state is stored as
versioned Markdown, JSON, JSONL, HTML, logs, screenshots, traces, and other
evidence files under `openspec/`.

## Application Topology

- Frontend runtime: static generated HTML report pages opened locally or served
  by any static file server.
- Backend runtime: Node.js 22 command-line scripts and host-agent skills.
- API gateway or edge layer: none.
- Background workers: none in the plugin; test runners may spawn browser and
  model-backed worker processes for a bounded verification run.
- External services: OpenSpec CLI, optional CodeGraph CLI/MCP, Playwright
  browsers, and Midscene model providers configured by the user.
- Local development entrypoints: `npm test`, individual
  `tests/run-*.sh` fixtures, and plugin scripts under `plugins/*/scripts/`.
- Production deployment shape: a GitHub-hosted Codex marketplace containing
  multiple installable SpecNav plugins. Claude Code and CodeFree-O repositories
  consume the same host-neutral verification contract through host adapters.

## Module Boundaries

### `specnav-core`

- Responsibility: bootstrap, routing, workflow state, hooks, suite resolution,
  task normalization, and shared lifecycle utilities.
- Public contract: scripts named in `plugins/specnav-core/specnav-stage.json`.
- Owned data: `openspec/.specnav/*`.
- Dependencies: OpenSpec CLI and Node.js standard library.
- Forbidden dependencies: stage-specific implementation details.
- Extension points: stage manifests and host-specific hook adapters.

### `specnav-requirements`

- Responsibility: repository discovery, four foundation specs, requirements,
  acceptance, and impact maps.
- Public contract: foundation and requirements validators.
- Owned data: project foundation specs and change requirements artifacts.
- Dependencies: `specnav-core`.
- Forbidden dependencies: prototype, implementation, or verification result
  mutation.
- Extension points: optional project-level specs.

### `specnav-prototype`

- Responsibility: isolated runnable prototypes, direct verifier evidence,
  explicit approval, and development handoff.
- Public contract: prototype manifest and prototype validator.
- Owned data: `openspec/changes/<change>/prototype/*`.
- Dependencies: requirements contracts.
- Forbidden dependencies: production source edits.
- Extension points: branch adapters for UI, logic, API, data flow, and component
  seams.

### `specnav-development`

- Responsibility: scope lock, development entry, vertical-slice task packets,
  review, repair implementation, and verification handoff.
- Public contract: development entry and handoff validators.
- Owned data: `scope.json`, `tasks.md`, and `development/*`.
- Dependencies: core, requirements, prototype, and CodeGraph evidence policy.
- Forbidden dependencies: self-approval of failed verification or release
  decisions.
- Extension points: task packet generators and host execution adapters.

### `specnav-verification`

- Responsibility: Verification Contract V2, managed runtime status, six-domain
  execution, evidence integrity, failure classification, retest/regression,
  aggregation, and stakeholder reports.
- Public contract: schemas, runner adapters, verification state machine,
  validators, gates, and report renderer.
- Owned data: `openspec/changes/<change>/verify/*`.
- Dependencies: development handoff, managed Verification Runtime, optional
  CodeGraph evidence, and explicit user case approval.
- Forbidden dependencies: declaring PASS from prose, Midscene interpretation
  alone, missing evidence, or manual domain summaries.
- Extension points: runner adapters, evidence kinds, domain evaluators, report
  pages, and host adapters.

### `specnav-codegraph`

- Responsibility: policy resolution, code evidence acquisition, claim mapping,
  freshness, drift, and impact analysis.
- Public contract: CodeGraph schemas and DecisionEngine result.
- Owned data: `openspec/changes/<change>/codegraph/*`.
- Dependencies: explicit CodeGraph CLI or MCP surface.
- Forbidden dependencies: silent installation, silent indexing, or invented
  code evidence.
- Extension points: MCP and CLI adapters.

### `specnav-operations`

- Responsibility: release readiness, install verification, compatibility,
  rollback, monitoring, archive gate, and archive action.
- Public contract: operations and archive validators.
- Owned data: `openspec/changes/<change>/operations/*`.
- Dependencies: green and fresh verification, plus explicit release policy.
- Forbidden dependencies: bypassing red, blocked, stale, or incomplete
  verification.
- Extension points: host-specific release and installation checks.

### Verification Kernel

- Responsibility: host-neutral schemas, state machines, evidence store,
  integrity checks, aggregation, freshness, report data model, and runtime
  installer logic.
- Public contract: versioned JavaScript modules, JSON schemas, and deterministic
  CLI interfaces.
- Owned data: no business-project state; it writes only through declared
  artifact writers.
- Dependencies: Node.js standard library and version-locked runtime packages.
- Forbidden dependencies: Codex, Claude, or CodeFree-O UI/runtime globals.
- Extension points: host adapters and runner adapters.

## Frontend Architecture

- Routing: three static report entry files with ordinary relative links.
- Rendering mode: deterministic server-side file generation; optional
  client-side filtering without changing source facts.
- State management: URL query parameters and local in-page filter state only.
- Form handling: filters and evidence disclosures; no business data mutation.
- Data fetching: embedded or colocated JSON generated from validated artifacts.
- Error handling: red and blocked report pages render complete diagnostic data.
- Design system source: `openspec/specs/ui-design/design.md`.

## Backend Architecture

- API style: command-line interfaces with JSON output and stable exit codes.
- Request validation: JSON Schema plus explicit path and lifecycle validation.
- Auth/session model: none; external model/provider credentials remain outside
  repository artifacts.
- Domain service boundaries: runtime management, case contract, execution,
  evidence, evaluation, repair coordination, reporting, and gates.
- Background jobs: bounded child processes for browser/test execution.
- File/object storage: project-local `openspec/` artifacts and managed runtime
  under `~/.specnav/runtime/verification/<version>/`.
- Observability: run manifests, structured logs, attempt records, checksums,
  environment fingerprints, and exact blockers.

## API Surface

| Route or RPC | Owner | Input | Output | Auth | Side Effects |
| --- | --- | --- | --- | --- | --- |
| `verification-runtime install` | Verification Kernel | runtime version and browser policy | install receipt JSON | local user permission | writes managed runtime only |
| `verification-runtime doctor` | Verification Kernel | project and runtime paths | status/blocker JSON | none | read-only |
| `verification plan` | `specnav-verification` | active change artifacts | case catalog and execution plan | none | writes `verify/` plan artifacts |
| `verification run` | `specnav-verification` | approved case ids and run policy | run, attempt, reading, and evidence artifacts | provider credentials when Midscene is used | runs tests and writes evidence |
| `verification repair` | verification/development bridge | classified failure packet | development repair task reference | none | writes failure and handoff artifacts |
| `verification aggregate` | Verification Kernel | validated case readings and evidence index | six-domain and release verdict | none | writes reports and summary artifacts |
| `verification report` | report renderer | aggregate model | three HTML pages | none | writes report site |
| `verification gate` | core/operations | aggregate verdict and freshness | pass/warn/block decision | none | updates lifecycle state |

## Database Model

There is no relational or document database. The file artifact store is the
authoritative persistence model.

| Entity | Purpose | Owner | Fields | Relationships | Indexes | Constraints | Lifecycle | Migration | Retention/Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Change | lifecycle root | core | change id, status, stage | owns requirements, prototype, development, verify, operations | change registry | one active focus for writes | create to archive | explicit V1-to-V2 migration | archived with evidence |
| TestCase | approved behavior contract | verification | id, priority, goal, steps, assertions, domains, runner, evidence policy | belongs to change and case snapshot | case catalog | immutable within a run snapshot | draft to approved to retired | versioned schema migration | retained with change |
| VerificationRun | execution batch | verification | run id, code SHA, test SHA, environment hash, timestamps | owns attempts | run index | immutable identity fields | planned to running to terminal | additive schema migration | retained with release evidence |
| Attempt | one case execution | verification | attempt id, kind, status, timestamps, fingerprints | belongs to run and case | run/case index | retry fingerprints must match | started to terminal | additive schema migration | retained, never overwritten |
| Reading | evaluated assertion/domain result | verification | oracle, expected, actual, verdict, evidence refs | belongs to attempt and case | case/domain index | no PASS without deterministic oracle | pending to terminal | additive schema migration | retained |
| Evidence | immutable proof object | evidence store | id, kind, path, hash, size, producer, run/case/step refs | referenced by readings and reports | evidence index | target exists and hash matches | captured to stale/superseded | reindex raw JSONL | raw retained; derived cache rebuildable |
| FailurePacket | repair handoff | verification | classification, root cause, failed assertions, evidence, owner | links failed attempt to development task | failure index | failure evidence frozen before repair | open to fixed to verified | additive schema migration | retained |
| GateDecision | lifecycle enforcement | core/operations | stage, verdict, blockers, warnings, source refs | derived from aggregate and policy | current decision index | deterministic and auditable | recalculated on change | rebuildable | retained in archive |

## Permissions & Security

- User roles: project operator, reviewer/approver, and release owner.
- Permission checks: explicit user approval for test cases, prototype handoff,
  optional `not_applicable`, runtime installation, and release/archive actions.
- Data isolation: every artifact path is contained within the active project or
  managed runtime root.
- Secret handling: provider tokens, MCP credentials, and CI secrets are never
  copied into OpenSpec artifacts or reports.
- Audit logging: record commands, exit codes, hashes, code/test SHA, environment
  fingerprints, user decisions, and generated file paths.
- Abuse cases: path traversal, forged evidence, overwritten failed attempts,
  self-approved test cases, prompt injection in logs, HTML injection, stale
  screenshots, and model-only PASS claims.

## Integration Boundaries

- Third-party APIs: Midscene-compatible model providers are optional execution
  dependencies and require explicit user configuration.
- Webhooks: none.
- Queues: none.
- Email/SMS/push: none.
- Payments: none.
- Analytics: no remote telemetry by default.
- CodeGraph: explicit MCP or CLI evidence surface governed by project policy.
- Playwright: version-locked managed runner and browser installation.

## Operational Constraints

- Performance constraints: case-level indexing and report generation must avoid
  replaying all raw evidence when a valid summary index exists.
- Availability expectations: no fallback; unavailable required dependencies
  produce exact blockers and complete blocked reports.
- Migration rules: V1 artifacts are never silently treated as V2; migration is
  explicit, versioned, testable, and reversible before archive.
- Backup/restore: OpenSpec artifacts are Git-tracked; managed runtime is
  rebuildable from lock and receipt files.
- Feature flag rules: no verification light mode. Optional capabilities are
  explicit policy fields, not hidden fallbacks.
- Rollback constraints: runtime versions are side-by-side; report and schema
  writers identify their version; failed attempts are immutable.
- Compatibility: kernel contracts must pass in Codex, Claude Code, and
  CodeFree-O repositories before release.

## Architecture Do's and Don'ts

- Do keep host-neutral verification logic in the Verification Kernel.
- Do install Playwright, Midscene, browsers, and schema validators only through
  the explicit managed runtime workflow.
- Do derive six-domain results from approved case readings and verified
  evidence.
- Do preserve every failed attempt before repair and retest.
- Don't modify a business project's `package.json` to install verification
  runtime dependencies.
- Don't add a simplified verification lane.
- Don't let host adapters fork schemas, state machines, or gate semantics.
- Don't let Midscene or an agent narrative independently declare PASS.
