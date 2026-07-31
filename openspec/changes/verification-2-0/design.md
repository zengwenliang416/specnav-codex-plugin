## Context

SpecNav verification currently has useful stage skills for facticity, static,
unit, redteam, E2E, sensory, rerun, and HTML output. The implementation remains
artifact-oriented, but several facts are not strongly connected:

- approved user test cases;
- domain reports;
- runtime evidence references;
- evidence index entries;
- code/test/environment identity;
- rerun scope;
- HTML rendering;
- release and archive decisions.

The existing validator can accept domain reports with weak or empty evidence,
checks evidence references more strongly than referenced content, uses mtime for
freshness, and computes rerun scope at domain level. The three host repositories
also carry duplicated verification scripts, which creates drift risk.

Verification 2.0 is therefore a governance and architecture upgrade, not a
renderer enhancement.

Stakeholders are change authors, test-case reviewers, verification operators,
quality reviewers, release owners, and maintainers of the Codex, Claude Code,
and CodeFree-O plugin editions.

Constraints:

- no verification light mode;
- no fallback;
- no silent dependency installation;
- no business-project `package.json` mutation;
- no model-only PASS;
- no failed-evidence overwrite;
- no host-specific fork of kernel semantics;
- all outputs remain local, file-backed, auditable, and Git-compatible.

## Goals / Non-Goals

**Goals:**

- Build a complete case-approval-to-archive verification lifecycle.
- Make every PASS traceable to deterministic readings and intact evidence.
- Install and diagnose Playwright and Midscene through a managed runtime.
- Preserve retry, failure, repair, retest, and regression history.
- Derive six-domain and release verdicts from case-level facts.
- Produce useful reports for green, red, blocked, running, stale, flaky, and
  pass-after-fix states.
- Deliver identical contracts across Codex, Claude Code, and CodeFree-O.
- Migrate existing V1 changes without creating fake green states.

**Non-Goals:**

- Replace OpenSpec, CodeGraph, existing product test frameworks, or CI.
- Host reports remotely.
- Store verification data in a database.
- Install model credentials or mutate global agent configuration silently.
- Add dark mode, runtime i18n, or a locale switch to the initial report center.
- Allow an escape hatch that bypasses Verification 2.0.

## Architecture

```text
Requirements + Acceptance + Development Handoff
                         |
                         v
                 Case Contract Planner
                         |
                         v
                 User Case Approval
                         |
                         v
       Managed Runtime Doctor + Case Snapshot
                         |
                         v
              Execution Orchestrator
          /              |               \
    Command          Playwright         Midscene
     Adapter           Adapter           Adapter
          \              |               /
                         v
                    EvidenceStore
              raw JSONL + files + index
                         |
                         v
              Deterministic Readings
                         |
                         v
               Six-Domain Aggregator
                         |
            +------------+-------------+
            |                          |
          PASS                       FAIL/BLOCK
            |                          |
      Report + Gate             Failure Classifier
                                       |
                                       v
                             Development Repair Task
                                       |
                                       v
                            Retest + Regression Run
```

The architecture has three layers:

1. **Verification Kernel**: host-neutral schemas, state machines, integrity,
   aggregation, freshness, report model, migration, and deterministic CLI.
2. **Stage integration**: SpecNav lifecycle bridges for requirements,
   development, verification, CodeGraph, operations, and archive.
3. **Host adapters**: Codex, Claude Code, and CodeFree-O manifests, skills,
   hooks, configuration lookup, and command invocation.

## Decisions

### 1. One host-neutral Verification Kernel

All behavior that can change a verification verdict belongs to one kernel.
Host repositories consume it through a versioned local package or generated
release artifact with checksum verification.

Rationale:

- schemas and blockers must not drift;
- fixes should be implemented once;
- fixtures must exercise the same code;
- release evidence needs a single kernel version.

Alternative considered: keep copied scripts in every host repository. Rejected
because the current identical checksums already prove shared logic is being
manually duplicated, and future changes would require synchronized edits.

### 2. File-backed source of truth

The authoritative model is:

```text
verify/
  contracts/
  cases/
  approvals/
  snapshots/
  runs/
  evidence/
  failures/
  reports/
  gates/
```

Raw records are append-only JSONL or immutable JSON files. Summary indexes and
HTML are derived and rebuildable.

Rationale:

- fits OpenSpec and Git review;
- supports local/offline workflows;
- preserves audit history;
- avoids operating a new database.

Alternative considered: SQLite in each change. Rejected for the first version
because binary state complicates review, merge, and archive portability.

### 3. Versioned contracts before runner work

The first implementation phase defines JSON Schemas and positive/negative
fixtures for:

- `test-case`;
- `case-approval`;
- `case-snapshot`;
- `verification-run`;
- `attempt`;
- `reading`;
- `evidence`;
- `evidence-index`;
- `failure-packet`;
- `repair-link`;
- `runtime-status`;
- `report-model`;
- `gate-decision`;
- `migration-receipt`.

Every schema includes its own version and rejects unknown identity-breaking
states.

Rationale: execution and reports cannot be trustworthy if their data contracts
remain implicit.

### 4. Explicit managed runtime

The runtime lives at:

```text
~/.specnav/runtime/verification/<runtime-version>/
```

It contains:

- `package.json`;
- lockfile;
- installed Node packages;
- Playwright browser binaries or a verified pointer to them;
- runtime manifest;
- install receipt;
- doctor report;
- provider configuration status without secrets.

Public commands:

```text
verification-runtime install --version <version>
verification-runtime doctor --version <version> --json
verification-runtime path --version <version> --json
```

Installation is explicit. A stage that requires a missing runtime blocks and
names the exact setup command. Runtime versions install side by side.

Rationale: modifying every business project package manifest creates dependency
conflicts and makes verification behavior project-dependent.

Alternative considered: `npx` on every run. Rejected because it is not
reproducible and may download moving versions.

### 5. Runner adapter and oracle boundary

Runner interface:

```text
prepare(context) -> preparation result
execute(case, context) -> event stream
collect(attempt) -> raw evidence
cancel(attempt) -> terminal cancellation
diagnose(failure) -> structured diagnostics
```

Adapters:

- command adapter for static/unit/API commands;
- Playwright adapter for browser execution, assertions, traces, screenshots,
  video, console, and network facts;
- Midscene adapter for AI-assisted UI location, interaction, and description.

Midscene output is evidence or execution assistance. Final PASS requires one of:

- Playwright assertion;
- structured API/database fact;
- deterministic comparison;
- explicit human signoff allowed by the case contract.

Rationale: model interpretation is probabilistic and cannot be the sole release
oracle.

### 6. Immutable run identity

Each run binds:

```text
change_id
case_snapshot_hash
code_sha
test_sha
environment_hash
runtime_version
kernel_version
```

Each attempt additionally binds:

```text
case_id
attempt_id
attempt_kind
scenario_hash
browser_project
test_data_snapshot
```

`attempt_kind` is one of `initial`, `retry`, `retest`, or `regression`.

Retry requires identical fingerprints. If code, tests, environment, case
snapshot, browser project, or test data changes, the action becomes retest or a
new run.

### 7. EvidenceStore with integrity and summary index

EvidenceStore writes:

```text
evidence/raw.jsonl
evidence/objects/<content-hash>.<ext>
evidence/index.json
evidence/cache/
```

Every evidence record includes:

- stable evidence id;
- kind and producer;
- validated relative path;
- SHA-256 and byte size;
- captured timestamp;
- change/run/case/attempt/step/assertion references;
- code/test SHA;
- environment/runtime/kernel version;
- redaction status.

Integrity validation checks:

- target exists;
- path stays inside allowed roots;
- size and hash match;
- referenced run/case/attempt/step exists;
- producer is registered;
- source fingerprints match the reading;
- evidence is fresh for the gate.

`index.json` is derived from raw evidence. If missing or stale, it is rebuilt;
raw evidence is never inferred from the index.

### 8. Reading-first six-domain aggregation

The hierarchy is:

```text
Case
  -> Step/Assertion
    -> Attempt
      -> Reading
        -> Evidence
```

Domain evaluators consume readings. They do not consume an agent-authored
summary as proof.

Every case maps to all six domains:

- `required`;
- or `not_applicable` with reason, evidence, reviewer, approval timestamp, and
  policy permission.

Aggregate rules:

- failed required reading -> domain failed;
- blocked required reading -> domain blocked;
- stale or invalid evidence -> domain blocked;
- flaky P0 -> release blocked by default;
- open repair/regression -> release blocked;
- all required readings pass and all N/A decisions are approved -> domain pass.

### 9. Repair loop as a state machine

Failure classification:

```text
product_defect
test_defect
environment_defect
flaky
expected_blocker
requirement_ambiguity
```

State flow:

```text
failed
  -> classified
  -> repair_required | retry_allowed | blocked_for_decision
  -> development_repair
  -> repair_reviewed
  -> retest
  -> regression
  -> closed | reopened | break_loop
```

Verification owns the failure packet and closure decision. Development owns
code changes and standard task review. Core owns stage transitions and
break-loop governance.

Failed attempts and evidence remain immutable after closure.

### 10. Case-level freshness and rerun scope

Freshness compares:

- code SHA and changed files;
- test SHA and changed test files;
- case snapshot hash;
- environment hash;
- runtime/kernel versions;
- evidence source fingerprints.

Rerun scope returns:

```json
{
  "required_cases": [],
  "baseline_cases": [],
  "reasons_by_case": {},
  "codegraph_refs": [],
  "policy_refs": []
}
```

CodeGraph may provide impact evidence. It cannot reduce scope below explicit
policy baselines or replace test evidence.

### 11. Three-page report center

One report model feeds:

- `overview.html`;
- `test-case-catalog.html`;
- `test-case-results.html`.

Overview:

- lifecycle and release verdict;
- six-domain summary;
- case/run/evidence totals;
- integrity and freshness;
- open blockers and repairs;
- environment/runtime/kernel versions.

Catalog:

- case goal, actor, priority, preconditions, steps, assertions;
- domain mapping;
- runner and evidence policy;
- approval and snapshot identity.

Results:

- runs and attempts;
- retry/retest/regression labels;
- expected/actual readings;
- commands and exit codes;
- screenshots, traces, video, logs, and structured facts;
- integrity/freshness;
- failure and repair history.

Reports generate for partial, red, and blocked states. HTML is escaped and never
becomes the source of truth.

### 12. Cross-host integration

Each host adapter owns:

- plugin manifest and discovery;
- skill wording and invocation;
- hook wiring;
- runtime configuration lookup;
- presentation of next actions.

Each host adapter must call the same kernel CLI/API and pass the same fixtures.
A drift test compares kernel version, schemas, blockers, and fixture results.

CodeFree-O local changes unrelated to Verification 2.0 must be preserved during
integration.

### 13. V1-to-V2 migration is explicit

Migration phases:

1. scan V1 artifacts;
2. emit dry-run findings and blockers;
3. back up source paths;
4. transform only provable data;
5. mark unverifiable legacy claims blocked;
6. validate all V2 schemas and identities;
7. write migration receipt;
8. allow rollback before archive.

No migration rule converts an absent evidence file or empty evidence list into a
passing reading.

## Planned Repository Structure

```text
plugins/specnav-verification/
  kernel/
    index.js
    contracts/
    runtime/
    execution/
    evidence/
    evaluation/
    repair/
    reporting/
    gates/
    migration/
  adapters/
    codex/
  scripts/
  skills/
  schemas/
  assets/
    report/
    fixtures/
tests/
  verification-v2/
    contracts/
    negative/
    runtime/
    browser/
    repair-loop/
    reports/
    migration/
    cross-host/
```

The exact packaging mechanism may move the kernel into a dedicated repository
or package during implementation, but the public contract and ownership remain
the same. The initial task is to decide and record the packaging boundary before
production modules are added.

## Delivery Phases

1. Baseline and fake-green negative fixtures.
2. Contract V2 schemas and kernel package boundary.
3. Managed runtime installer and doctor.
4. Execution adapters and EvidenceStore.
5. Reading model and six-domain aggregation.
6. Failure/repair/retest/regression state machine.
7. Case-level freshness, CodeGraph impact, and gates.
8. Three-page report center and browser/accessibility tests.
9. V1 migration.
10. Codex integration.
11. Claude Code and CodeFree-O integration.
12. CI, documentation, clean installation, release, and archive proof.

## Risks / Trade-offs

- [Runtime installation is large] -> Use explicit side-by-side versions,
  receipts, browser policies, and cleanup documentation.
- [Midscene requires provider configuration] -> Doctor reports readiness;
  cases requiring Midscene block when configuration is absent.
- [Strict evidence binding increases artifact volume] -> Keep raw evidence
  append-only and use a compact summary index for reports and gates.
- [Cross-host integration can drift] -> One kernel artifact, shared fixtures,
  checksums, and release-time drift checks.
- [Migration may expose many legacy gaps] -> Preserve V1, block unverifiable
  claims, and require explicit rerun instead of manufacturing evidence.
- [Case-level impact can miss indirect regressions] -> Add policy baseline cases
  and let CodeGraph narrow only above the mandatory baseline.
- [Full verification costs more for simple changes] -> Keep case generation
  proportional to behavior while retaining the same approval, evidence,
  reporting, and archive gates.
- [HTML may appear authoritative] -> Every page identifies source artifacts,
  renderer version, integrity, and freshness; gates read JSON/JSONL only.

## Migration Plan

1. Freeze V1 fixtures and record current accepted false-positive examples.
2. Add V2 contracts and kernel in parallel without changing V1 behavior.
3. Add runtime setup/doctor and prove a clean installation.
4. Add V2 execution/evidence/aggregation behind an explicit V2 change marker.
5. Run V1 and V2 fixture suites together during development.
6. Add migration dry run and migrate repository fixtures.
7. Switch verification skills and gates to V2.
8. Remove the verification light bypass and prevent V1 green from satisfying
   release/archive.
9. Integrate the same kernel release into Claude Code and CodeFree-O.
10. Update README, diagrams, troubleshooting, and installation checks.
11. Release only after clean host installation and full six-domain proof.

Rollback:

- restore the pre-switch plugin release;
- keep V2 artifacts untouched for diagnosis;
- restore V1 artifacts from migration backup if transformation failed;
- do not archive a partially migrated change;
- reinstall the previous side-by-side runtime version when runtime rollback is
  required.

## Open Questions

None for planning. Kernel packaging is an implementation task with explicit
acceptance criteria, not an unresolved product decision.
