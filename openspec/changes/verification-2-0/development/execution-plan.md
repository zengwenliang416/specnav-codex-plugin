# Verification 2.0 Development Execution Plan

## Purpose

This plan turns the approved Verification 2.0 design into an executable,
dependency-safe task system. It covers the shared Verification Kernel and the
Codex, Claude Code, and CodeFree-O integration repositories.

This is a development-entry plan. It does not mark any task complete and does
not install or modify a managed verification runtime.

## Non-Negotiable Policies

- Verification has no light, compact, simplified, bypass, or fallback mode.
- Every task remains unchecked until implementation, focused tests, task
  report, spec review, and quality review all contain direct evidence.
- HTML reports are projections of validated JSON and JSONL artifacts. They are
  never the verdict source.
- Midscene may interact with or describe a UI, but it cannot independently
  declare PASS.
- Playwright, browser binaries, Midscene, and AJV are installed only through
  the explicit managed-runtime setup task.
- The managed runtime lives outside business repositories under
  `~/.specnav/runtime/verification/<version>/`.
- Missing runtime, browser, provider configuration, evidence, approval, or
  integrity data returns an exact blocker. Nothing silently degrades.
- Failed attempts and evidence are append-only and remain available after a
  repair passes.
- Codex, Claude Code, and CodeFree-O consume one host-neutral Verification
  Kernel. Host adapters do not copy verdict logic.

## Authoritative Inputs

- `openspec/changes/verification-2-0/requirements.md`
- `openspec/changes/verification-2-0/acceptance.md`
- `openspec/changes/verification-2-0/design.md`
- `openspec/changes/verification-2-0/tasks.md`
- `openspec/changes/verification-2-0/scope.json`
- `openspec/changes/verification-2-0/development/task-graph.json`
- `openspec/changes/verification-2-0/development/task-context.jsonl`
- `openspec/changes/verification-2-0/development/tasks/<task-id>/`

`tasks.md` groups user-visible capabilities. It is not a sequential schedule.
`task-graph.json` and the waves below define execution order. This distinction
is important because Task 020 closes the repair loop only after Task 022 can
compute concrete impacted reruns and mandatory baselines.

## Execution Waves

| Wave | Tasks | Exit evidence |
| --- | --- | --- |
| 1 | 001 baseline fake-green fixtures | Every known false-positive path fails under a focused V2 fixture. |
| 2 | 002 kernel package boundary | Public kernel entry, ownership boundary, and adapter/service contracts are tested. |
| 3 | 006 runtime lock | Exact package, browser, Node, platform, and kernel compatibility is committed. |
| 4 | 007 runtime installer | The locked runtime is installed side-by-side outside the business repository. |
| 5 | 008 runtime doctor | Installed packages, browser binaries, provider status, permissions, and compatibility are probed with exact blockers. |
| 6 | 003 contract schemas | Versioned schemas execute through the doctor-approved managed AJV runtime. |
| 7 | 004 cross-references | Immutable identity and cross-entity references pass. |
| 8 | 005 case approval | The immutable approved case snapshot is proven. |
| 9 | 009 command runner | Structured command attempts, logs, exits, and evidence bindings pass. |
| 10 | 010 Playwright runner; 012 EvidenceStore | Real browser assertions and append-only evidence storage pass independently. |
| 11 | 011 Midscene runner; 013 integrity; 014 redaction | AI interaction remains oracle-bounded; tampering and secret leakage fail. |
| 12 | 015 reading model; 021 freshness | Assertion readings and SHA/fingerprint freshness are deterministic. |
| 13 | 016 six-domain aggregation; 022 case rerun impact | Verdicts derive from readings; impacted case plus baseline rerun scope is concrete. |
| 14 | 017 not-applicable approval; 018 failure classification; 027 migration | Domain exemptions are auditable, failures are classified, and V1 migration is reversible. |
| 15 | 019 development repair bridge; 023 report model | Frozen failures create scoped repair work; all report states share one validated model. |
| 16 | 020 retest/regression loop; 024 overview report | Retry, retest, and regression close correctly; overview renders every lifecycle state. |
| 17 | 025 case report pages | Catalog and immutable result pages render from the shared report model. |
| 18 | 026 report security/accessibility; 028 Codex integration | Reports pass browser, print, keyboard, mobile, and escaping checks; Codex consumes the kernel. |
| 19 | 029 Claude Code integration; 030 CodeFree-O integration | Both downstream hosts consume the same kernel and preserve pre-existing worktree changes. |
| 20 | 031 cross-host drift CI; 032 bilingual docs | Canonical fixtures and architecture checks agree across hosts; English and Chinese instructions match. |
| 21 | 033 release and archive proof | Clean GitHub installs produce six-domain evidence, all reports, release proof, rollback proof, and archive readiness. |

Tasks in the same wave may run in parallel only when their allowed file sets do
not overlap at execution time. A shared kernel, schema, blocker registry,
fixture, report model, migration, or gate change has a single owner.

## Critical Path

The runtime-before-schema correction makes managed AJV an explicit prerequisite
instead of an implicit fallback. The critical prefix is:

```text
001 -> 002 -> 006 -> 007 -> 008 -> 003 -> 004
```

The remaining graph then proceeds through execution, evidence, evaluation,
reports, hosts, drift, and release. No task may use global or cached AJV to
shorten this path.

## Managed Runtime Plan

Planning does not install Playwright or Midscene. Installation is production
work owned by Tasks 006 through 008:

1. Task 006 commits the exact runtime lock manifest, supported Node versions,
   browser policy, kernel compatibility, and package checksums.
2. Task 007 installs locked Playwright, browser binaries, Midscene, and AJV
   under the managed runtime root after explicit user approval.
3. Task 007 writes an immutable installation receipt and proves that business
   project manifests did not change.
4. Task 008 probes the installed files and executes readiness checks.
5. Tasks 010 and 011 remain blocked until Task 008 proves the required browser
   and provider surface is ready.

An installed npm package is not readiness evidence. Browser launch, executable
location, provider configuration status, permissions, and lock compatibility
must be observed by the doctor.

## Task Completion Contract

A task may change from `- [ ]` to `- [x]` only when all of the following exist:

1. Its dependencies are complete.
2. Its `context.json` still matches the active requirements, prototype, scope,
   and CodeGraph policy.
3. A focused failing test or negative fixture exists before the production fix.
4. Implementation remains inside `allowed_files` and `scope.json`.
5. Every listed verification command was executed successfully.
6. `report.md` records changed files, commands, results, and direct acceptance
   evidence.
7. `spec-review.md` approves behavior against the linked capability spec.
8. `quality-review.md` approves architecture, security, maintainability, and
   regression risk.
9. Task ledger, validation log, drift check, and acceptance references are
   updated.
10. No scaffold marker, fallback, invented evidence, or unrelated worktree
    change is included.

## Cross-Repository Handoff

The control repository remains:

```text
/Volumes/zwl/AI/ai-coding/specnav-codex-plugin
```

Task 029 targets:

```text
/Volumes/zwl/AI/ai-coding/specnav-claude-plugin
```

Task 030 targets:

```text
/Volumes/zwl/AI/ai-coding/specnav-codefree-o-plugin
```

Before either downstream task starts, run a separate Git status and scope
check in that repository. Preserve unrelated and pre-existing changes. The
CodeFree-O repository currently has known local README and discovery-test
changes, so Task 030 must work with them rather than overwrite them.

Downstream adapters may add discovery, command, hook, and host configuration
surfaces. They may not add a second copy of schemas, evidence semantics,
failure state machines, report verdict logic, or release gates.

## Final Development Exit

Development handoff to six-domain verification requires:

- all 33 checkboxes complete with direct evidence;
- all 40 acceptance criteria mapped to one or more task packets;
- zero unresolved task, spec-review, quality-review, drift, or migration
  blockers;
- managed runtime doctor green for every required execution surface;
- canonical V2 fixture suite green in Codex, Claude Code, and CodeFree-O;
- all three HTML reports generated for green, red, blocked, flaky, and
  pass-after-fix states;
- cross-host checksum and architecture-boundary checks green;
- release and archive gates reading validated V2 artifacts rather than HTML or
  agent narrative;
- `development-contract.js --mode handoff --json` returning `ok: true`.

Until those conditions are met, Verification 2.0 is planned or in development,
not complete and not archive-ready.
