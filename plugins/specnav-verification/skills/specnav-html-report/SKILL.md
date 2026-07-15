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
3. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" validate --json`.
4. If validation reports blockers, report the exact blockers and stop.
5. Run `node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" aggregate --json --render` (md/html renders are only written with `--render`).
6. Report the generated HTML paths and the aggregate verdict.

## Required Outputs

- `openspec/changes/<change>/verify/aggregate-report.html`
- `openspec/changes/<change>/verify-report.html`
- The aggregate verdict, blockers, and stale status in chat.

## Stop Conditions

- Active change is missing.
- Any domain report is missing, invalid, stale, or not green.
- The aggregate command exits non-zero.

## Validation

- The aggregate JSON must include `html_report`.
- The generated HTML files must exist and be non-empty.
