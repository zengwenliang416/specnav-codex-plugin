---
name: specnav-verification
description: Use this skill when a Codex user starts, resumes, or reviews the complete SpecNav Verification 2.0 lifecycle, including runtime readiness, approved cases, six-domain execution, repair loops, gates, and reports.
---

## Runtime Paths

Resolve `SPECNAV_VERIFICATION_ROOT` with the owning Codex plugin resolver. If
the plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Verification 2.0

## Purpose

Run the complete evidence-backed verification lifecycle through the shared
Verification Kernel. Verification 2.0 has no light, compact, or simplified lane.

## Workflow

1. Inspect the Codex adapter contract:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" describe --json
   ```

2. Validate the current verification state:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" validate \
     --project "$PWD" \
     --json
   ```

3. If the locked runtime is not ready, use
   `specnav-verification-runtime-status`. Invoke
   `specnav-verification-runtime-setup` only after the user explicitly approves
   runtime installation.
4. Use `specnav-verify-plan` to create the complete case contract and obtain
   explicit approval for the current immutable case snapshot.
5. Use all six domain skills to audit the approved case coverage:
   `specnav-verify-facticity`,
   `specnav-verify-static`, `specnav-verify-unit`,
   `specnav-verify-redteam`, `specnav-verify-e2e`, and
   `specnav-verify-sensory`.
6. Execute the approved snapshot through the V2 adapter:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" execute \
     --project "$PWD" \
     --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --json
   ```

   Add `--scenario-registry "<project-relative-module>"` only when an approved
   Playwright or Midscene case requires project-owned scenario code.
7. On failure, preserve the failed attempt and use `specnav-verify-rerun`.
   Repair, retest, and regression evidence must remain separate.
8. Re-run adapter validation. Do not infer green from agent prose, a
   screenshot path, or HTML.
9. Generate stakeholder reports only through `specnav-html-report` after the
   machine gate passes.

## Required Outputs

- Approved case snapshot and signoff.
- Six-domain readings and content-addressed evidence.
- Runtime, freshness, integrity, repair-loop, and gate artifacts.
- `verify/v2/report-model.json` as the machine report authority.
- `verify/v2/report-render-manifest.json` binding all rendered pages.
- `verify/reports/overview.html`.
- `verify/reports/test-case-catalog.html`.
- `verify/reports/test-case-results.html`.

## Stop Conditions

- Development handoff is blocked.
- Runtime, browser, provider, case approval, evidence, or deterministic oracle
  is missing.
- Any request asks for fallback, manual green, or fewer than all six domains.
- A failed, stale, blocked, running, or canceled attempt is presented as PASS.
- A report is treated as gate authority.

## Validation

- Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" validate --project "$PWD" --change "<change-id>" --reviewer-id "<authenticated-human-id>" --json`.
- Confirm the adapter reports `verification_mode: "full"`, all six required domains, `fallback_used: false`, and exact blockers or machine-authoritative artifacts.
