---
name: specnav-promote-check
description: Use this skill when SpecNav operations learning from a postmortem or bad case should become a reusable deterministic check (Act -> capability promotion), including distilling a candidate, running a dry-run, and classifying it candidate/admitted/declined.
disable-model-invocation: true
---

## Runtime Paths

Resolve every `SPECNAV_*_ROOT` variable with the owning SpecNav Codex plugin resolver before running Bash. Codex plugin code must use `PLUGIN_ROOT` and explicit `SPECNAV_*_ROOT` overrides. If a required installed plugin root cannot be resolved, report the exact blocker and stop.

# SpecNav Promote Check

## Purpose

Turn a resolved bad case into a reusable deterministic check so the next
occurrence is caught automatically instead of re-investigated. This is optional;
skip it when a case yields no reusable check.

## Workflow

1. Read `operations/postmortem.md` and identify the recurring failure mode worth a check.
2. Read `references/promote-check.md` before distilling.
3. Draft a rule file at `openspec/knowledge/promoted-checks/<id>.json` from `assets/promoted-check.json`. Prune one-off tokens: replace concrete UIDs/order-ids/session-ids with the business variable they stand for.
4. Add a `promoted_checks[]` entry to `operations/update-spec.json` with `status: "candidate"`, `verify_via`, `candidate_artifact` (the rule path), and `evidence_ref`.
5. Run the dry-run: `node "$SPECNAV_OPERATIONS_ROOT/scripts/promotion-dry-run.js" --id <id> --json`. It writes `operations/promotion/<id>/dry-run.json` and emits `promotion.candidate` + `promotion.dry-run` events. It never blocks.
6. Classify:
   - Keep `status: "candidate"` (advisory) when unsure — it never gates.
   - Move to `status: "admitted"` only when the dry-run passed, the statement is generalized, and a human signs off. Admitted requires `dry_run_ref` set to the dry-run.json path.
   - Use `status: "declined"` when the check is rejected; keep it for the record.
7. Admitted rules are enforced by the guard only when the rule declares `enforcement: "gate"` — a deliberate per-project opt-in.

## Required Outputs

- Rule file: `openspec/knowledge/promoted-checks/<id>.json` (shell: `assets/promoted-check.json`).
- Dry-run report: `operations/promotion/<id>/dry-run.json`.
- `promoted_checks[]` entry in `operations/update-spec.json`.

## Stop Conditions

- The statement still names a one-off token (not generalized).
- The dry-run result is `fail`.
- Admission lacks a `dry_run_ref` or human signoff.

## Validation

- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/promotion-dry-run.js" --id <id> --json` and require `result: "pass"` and `generalized: true` before admitting.
- Run `node "$SPECNAV_OPERATIONS_ROOT/scripts/operations-gate.js" --json` and require ok or exact blockers.
