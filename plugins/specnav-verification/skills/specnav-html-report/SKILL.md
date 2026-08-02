---
name: specnav-html-report
description: Use this skill when a human stakeholder needs a reviewable HTML verification report, a browser-readable six-domain testing summary, or an audit artifact to share outside the coding session.
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav HTML Report

## Purpose

Generate the stakeholder-facing HTML report for the six-domain verification result.

## Workflow

1. Confirm `SPECNAV_VERIFICATION_ROOT` is resolved.
2. Confirm an active OpenSpec change exists.
3. Validate the exact approved V2 snapshot:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" validate \
     --project "$PWD" \
     --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --json
   ```

4. If validation reports blockers, report the exact blockers and stop.
5. Run the V2 finalizer:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/codex-verification-adapter.js" finalize \
     --project "$PWD" \
     --change "<change-id>" \
     --reviewer-id "<authenticated-human-id>" \
     --json
   ```

6. Report the generated HTML paths and the aggregate verdict.

## Required Outputs

- `openspec/changes/<change>/verify/v2/report-model.json`
- `openspec/changes/<change>/verify/v2/report-render-manifest.json`
- `openspec/changes/<change>/verify/reports/overview.html`
- `openspec/changes/<change>/verify/reports/test-case-catalog.html`
- `openspec/changes/<change>/verify/reports/test-case-results.html`
- The aggregate verdict, blockers, and stale status in chat.

## Stop Conditions

- Active change is missing.
- Any domain report is missing, invalid, stale, or not green.
- The aggregate command exits non-zero.

## Validation

- The report model ID must be valid and bind the current aggregate, release
  gate, readings, evidence index, runtime, and Kernel.
- The render manifest must bind all three exact HTML paths, hashes, sizes, and
  the current report model ID.
