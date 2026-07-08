#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIFY="$ROOT/plugins/specnav-verification"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_json() {
  local project="$1"
  local command="$2"
  local output="$3"
  local expected_status="$4"
  local status

  set +e
  PROJECT_DIR="$project" node "$VERIFY/scripts/verify-domains.js" "$command" --json >"$output"
  status=$?
  set -e
  if [[ "$status" != "$expected_status" ]]; then
    echo "expected status $expected_status, got $status for $command in $project" >&2
    cat "$output" >&2
    exit 1
  fi
}

assert_blocker() {
  local output="$1"
  local blocker="$2"

  jq -e --arg blocker "$blocker" '.blockers[] | select(. == $blocker)' "$output" >/dev/null
}

write_base_project() {
  local project="$1"
  local change="add-dashboard"
  local change_dir="$project/openspec/changes/$change"
  local dev="$change_dir/development"
  local task="$dev/tasks/001-dashboard-summary"
  local proto="$change_dir/prototype"

  mkdir -p \
    "$project/openspec/.specnav" \
    "$project/openspec/specs/ui-design" \
    "$project/openspec/specs/system-architecture" \
    "$project/openspec/specs/frontend-backend-data-flow" \
    "$project/openspec/specs/component-architecture" \
    "$dev/migrations" \
    "$proto/artifact" \
    "$task"
  printf '%s\n' "$change" >"$project/openspec/.specnav/active-change"

  cat >"$project/openspec/specs/ui-design/design.md" <<'MD'
---
version: 1.0.0
name: UI Design
description: Product interface standards
colors: {}
typography: {}
spacing: {}
rounded: {}
components: []
---
# UI Design
## Overview
## Colors
## Typography
## Layout
## Elevation & Depth
## Motion
## Shapes
## Components
## Voice & Content
## Theme & Internationalization

- Theme capability: light-only.
- Theme toggle: none.
- Internationalization: none.
- Supported locales: none.
- Default locale: none.
## Do's and Don'ts
MD
  cat >"$project/openspec/specs/system-architecture/design.md" <<'MD'
# System Architecture & Database Spec
## Overview
## Application Topology
## Module Boundaries
## Frontend Architecture
## Backend Architecture
## API Surface
## Database Model
## Permissions & Security
## Integration Boundaries
## Operational Constraints
## Architecture Do's and Don'ts
MD
  cat >"$project/openspec/specs/frontend-backend-data-flow/design.md" <<'MD'
# Frontend-Backend Data Flow Spec
## Overview
## Flow Index
## Boundary Contracts
## State Ownership
## Validation Ownership
## Error & Empty States
## Loading / Optimistic / Retry Behavior
## End-to-End Flow Details
## Async / Realtime Flows
## Flow Do's and Don'ts
MD
  cat >"$project/openspec/specs/component-architecture/design.md" <<'MD'
# Component Architecture & Reuse Spec
## Overview
## Component Taxonomy
## Cohesion Rules
## Coupling Rules
## Shared Component Extraction Rules
## Component Public API Rules
## State Ownership Rules
## Composition Patterns
## File & Naming Conventions
## Testing Expectations
## Refactor Triggers
## Component Do's and Don'ts
MD

  cat >"$change_dir/requirements.md" <<'MD'
# Requirements
- Add dashboard summary view.
MD
  cat >"$change_dir/acceptance.md" <<'MD'
# Acceptance
- Dashboard renders loading, empty, and error states.
MD
  cat >"$change_dir/spec-map.json" <<'JSON'
{
  "touched_specs": ["ui-design", "system-architecture"],
  "ui_rules": ["dashboard-layout"],
  "architecture_modules": ["dashboard-shell"],
  "api_contracts": [],
  "database_entities": [],
  "permissions": [],
  "operational_constraints": [],
  "data_flows": [],
  "theme_modes": ["light-only", "theme-toggle:none"],
  "locale_policy": ["i18n:disabled", "locales:none", "default-locale:none"],
  "unresolved_gaps": []
}
JSON
  cat >"$change_dir/component-impact-map.json" <<'JSON'
{
  "new_components": ["DashboardView"],
  "reused_components": [],
  "extraction_triggers": [],
  "forbidden_dependencies": [],
  "hooks": [],
  "utilities": [],
  "services": [],
  "required_component_tests": ["DashboardView states"],
  "unresolved_gaps": []
}
JSON

  cat >"$proto/question.md" <<'MD'
# Prototype Question
Branch: ui-html
Question: Which dashboard variant should ship?
MD
  cat >"$proto/artifact/index.html" <<'HTML'
<!doctype html>
<html><body><main data-specnav-project-shell="existing-dashboard-shell" data-specnav-screen="dashboard" data-specnav-variant="balanced"><nav data-specnav-component="app-sidebar">Dashboard</nav><section data-specnav-component="dashboard-summary" data-specnav-state="populated">Dashboard</section></main></body></html>
HTML
  cat >"$proto/screen-map.json" <<'JSON'
{
  "screens": [{
    "id": "dashboard",
    "requirements": ["requirements.md#dashboard"],
    "acceptance": ["Dashboard renders loading, empty, and error states."],
    "components": ["DashboardView"],
    "visual_evidence": ["visual-inventory.json#project_shell"],
    "data_flows": ["Dashboard API to view state"],
    "theme_modes": ["light"],
    "locales": ["none"],
    "implementation_files": ["src/dashboard/DashboardView.tsx"]
  }]
}
JSON
  cat >"$proto/visual-inventory.json" <<'JSON'
{
  "schema": "specnav.prototype.visualInventory.v1",
  "version": "1",
  "discovery_status": "complete",
  "source_project": "dashboard-fixture",
  "evidence": {
    "screenshots": ["openspec/specs/ui-design/design.md#Current Screenshots"],
    "routes": ["src/app/routes.tsx"],
    "design_specs": ["openspec/specs/ui-design/design.md"],
    "component_sources": ["openspec/changes/add-dashboard/component-impact-map.json"],
    "codegraph_claims": []
  },
  "project_shell": {
    "source": "src/app/AppShell.tsx",
    "required_elements": ["sidebar navigation", "page title", "primary content region"],
    "omitted_elements": [],
    "theme_policy": "light-only from ui-design spec",
    "i18n_policy": "i18n disabled from ui-design spec"
  },
  "business_surface": {
    "screens": ["dashboard"],
    "fields": ["summary metric", "last updated", "status"],
    "actions": ["refresh summary"],
    "states": ["loading", "empty", "error", "disabled", "permission", "populated"]
  },
  "verification_matrix": {
    "viewports": ["desktop", "mobile"],
    "theme_modes": ["light"],
    "locales": ["none"],
    "states": ["loading", "empty", "error", "disabled", "permission", "populated"]
  },
  "unsupported_capabilities": []
}
JSON
  cat >"$proto/prototype-manifest.json" <<'JSON'
{
  "schema": "specnav.prototype.manifest.v1",
  "version": "1.0.0",
  "type": "ui-html",
  "entry": "artifact/index.html",
  "dependencies": [],
  "mock_strategy": "static mock",
  "touches_real_data": false,
  "referenced_foundation_specs": ["ui-design"],
  "referenced_requirements": ["requirements.md"],
  "may_promote": false,
  "promotion_requirement": "development gate",
  "visual_context": {
    "required_for_ui_html": true,
    "inventory": "visual-inventory.json",
    "project_shell_required": true,
    "generic_shell_allowed": false
  },
  "ui_capabilities": {
    "theme": {
      "support": "light-only",
      "modes": ["light"],
      "toggle_in_prototype": false,
      "source": "openspec/specs/ui-design/design.md#Theme & Internationalization"
    },
    "i18n": {
      "enabled": false,
      "locales": ["none"],
      "default_locale": "none",
      "locale_switch_in_prototype": false,
      "source": "openspec/specs/ui-design/design.md#Theme & Internationalization"
    }
  }
}
JSON
  cat >"$proto/verifier-report.json" <<'JSON'
{
  "schema": "specnav.prototype.verifier.v1",
  "status": "green",
  "checked_entry": "artifact/index.html",
  "project_fidelity": {
    "status": "green",
    "inventory": "visual-inventory.json",
    "shell_checked": true,
    "generic_shell_detected": false,
    "notes": ["project shell anchor and dashboard visual inventory reviewed"]
  },
  "visual_matrix": {
    "viewports": ["desktop", "mobile"],
    "theme_modes": ["light"],
    "locales": ["none"],
    "states": ["loading", "empty", "error", "disabled", "permission", "populated"]
  },
  "checks": ["entry exists"]
}
JSON
  cat >"$proto/handoff.md" <<'MD'
# Prototype Handoff
## Approved branch and variant
- Branch: ui-html
- Variant: balanced
## Screens or flows to implement
- Dashboard screen.
## Components to create
- DashboardView.
## Components to reuse
- Shell.
## Components, hooks, utilities, and services to extract
- Hooks: useDashboardState.
## API contracts
- GET /api/dashboard/summary.
## Data flows
- API response populates dashboard view state.
## State, loading, empty, error, disabled, and permission behavior
- Loading, empty, error, disabled, permission states.
## Theme and locale policy
- Theme support: light-only.
- Theme modes shown in prototype: light.
- Theme toggle: omitted.
- Internationalization: disabled.
- Locales shown in prototype: none.
- Locale switcher: omitted.
## Out-of-scope items
- Export.
## Required tests
- Dashboard states.
## Open risks
- Backend summary fields remain a verification watch item.
MD
  cat >"$proto/decision.json" <<'JSON'
{
  "status": "approved",
  "prototype_code": "required_present",
  "prototype_type": "ui-html",
  "approved_variant": "balanced",
  "promotion": "requires_development_gate",
  "blocked_reasons": []
}
JSON

  cat >"$change_dir/scope.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "stage": "development",
  "allowed_roots": ["src/dashboard/**", "tests/dashboard/**"],
  "denied_roots": [".env*"],
  "allowed_operations": {"create": true, "modify": true, "delete": false, "rename": true},
  "requires_review_on": ["src/shared/**"],
  "prototype_sources": ["openspec/changes/add-dashboard/prototype/artifact/index.html"],
  "expires_when": "verification_started"
}
JSON
  cat >"$change_dir/tasks.md" <<'MD'
# Development Tasks
- [x] user can view dashboard summary with loading empty and error states
MD
  cat >"$dev/before-dev-check.json" <<'JSON'
{"schema_version":1,"active_change":"add-dashboard","status":"passed","ok":true}
JSON
  cat >"$dev/basis.md" <<'MD'
# Development Basis
Development is based on requirements, prototype, and handoff.
- openspec/specs/ui-design/design.md
- openspec/specs/system-architecture/design.md
- openspec/specs/frontend-backend-data-flow/design.md
- openspec/specs/component-architecture/design.md
- openspec/changes/add-dashboard/requirements.md
- openspec/changes/add-dashboard/acceptance.md
- openspec/changes/add-dashboard/spec-map.json
- openspec/changes/add-dashboard/component-impact-map.json
- openspec/changes/add-dashboard/prototype/handoff.md
- openspec/changes/add-dashboard/prototype/decision.json
- openspec/changes/add-dashboard/prototype/artifact/index.html
MD
  cat >"$dev/prototype-promotion-map.json" <<'JSON'
{"schema_version":1,"promotion_policy":"reimplement_under_development_gate","allowed_to_copy":["copy"],"must_reimplement":["state"],"blocked_direct_copies":["mock data"]}
JSON
  cat >"$dev/complexity-budget.json" <<'JSON'
{"schema_version":1,"budgets":[{"task":"001-dashboard-summary","max_files":2}]}
JSON
  cat >"$dev/task-graph.json" <<'JSON'
{"schema_version":1,"nodes":["001-dashboard-summary"],"edges":[]}
JSON
  cat >"$dev/code-owner-map.json" <<'JSON'
{"schema_version":1,"owners":[{"path":"src/dashboard/**","owner":"dashboard"}]}
JSON
  cat >"$dev/extraction-map.json" <<'JSON'
{"schema_version":1,"components":["DashboardView"]}
JSON
  cat >"$dev/task-context.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","status":"ready"}
JSONL
  cat >"$dev/task-ledger.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","status":"spec_review_passed"}
{"task":"001-dashboard-summary","status":"quality_review_passed"}
{"task":"001-dashboard-summary","status":"complete"}
JSONL
  cat >"$dev/drift-check.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","blocking":false}
JSONL
  cat >"$dev/validation-log.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","command":"npm test","status":"passed","ok":true}
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test","status":"pass","ok":true,"exit_status":0,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:00:00.000Z","evidence_log":"development/evidence/001-dashboard-summary.log"}
JSONL
  cat >"$dev/migrations/manifest.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "required": false,
  "status": "not_required",
  "migrations": [],
  "verification": {
    "commands": ["No database migration required for this change."],
    "evidence": ["requirements.md and development handoff do not describe SQL or schema changes."]
  },
  "rollback": [],
  "rollback_strategy": "No migration rollback required because no database changes are included."
}
JSON
  cat >"$dev/migrations/README.md" <<'MD'
# Migration Notes
## Execution Order
No database migration is required for this dashboard-only change.
## Validation
Confirm requirements, task report, and handoff do not describe SQL, seed, DDL, or DML changes.
## Rollback
No migration rollback is required.
MD
  cat >"$task/brief.md" <<'MD'
# Task 001
## Goal
Implement dashboard summary.
## Parent Artifacts
Read approved artifacts.
## Vertical Slice
User can view dashboard summary.
## In Scope
Dashboard summary.
## Out Of Scope
Export.
## Files Allowed
src/dashboard/DashboardView.tsx.
## Interfaces / Seams
Service seam.
## Components To Create
DashboardView.
## Components To Reuse
Shell.
## Components To Extract
No extraction is required for this narrow dashboard summary slice.
## API / Data Flow Contracts
GET /api/dashboard/summary.
## State / Error / Empty / Loading Behavior
All states.
## TDD Requirement
Red and green tests.
## Verification Commands
npm test.
## Stop Conditions
Scope drift.
## Unsafe Assumptions
No unsafe assumptions are accepted without controller review.
MD
  cat >"$task/context.json" <<'JSON'
{
  "task_id": "001-dashboard-summary",
  "goal": "Implement dashboard summary",
  "stop_condition": "complete",
  "must_read": [
    "openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/brief.md",
    "openspec/specs/ui-design/design.md",
    "openspec/specs/system-architecture/design.md",
    "openspec/specs/frontend-backend-data-flow/design.md",
    "openspec/specs/component-architecture/design.md",
    "openspec/changes/add-dashboard/requirements.md",
    "openspec/changes/add-dashboard/acceptance.md",
    "openspec/changes/add-dashboard/spec-map.json",
    "openspec/changes/add-dashboard/component-impact-map.json",
    "openspec/changes/add-dashboard/prototype/handoff.md",
    "openspec/changes/add-dashboard/prototype/decision.json",
    "openspec/changes/add-dashboard/prototype/artifact/index.html"
  ],
  "allowed_files": ["src/dashboard/DashboardView.tsx"],
  "non_goals": ["export"],
  "expected_evidence": ["test output"],
  "unsafe_assumptions": []
}
JSON
  cat >"$task/report.md" <<'MD'
# Implementation Report
## Status
DONE
## Files Changed
- src/dashboard/DashboardView.tsx
## What Changed
Dashboard summary.
## TDD Evidence
Red and green.
## Verification Commands
- npm test
## Concerns
Backend field naming remains a verification watch item.
## Scope Deviations
No scope deviations were made.
## Follow-up Needed
Six-domain verification must confirm the user-visible states.
MD
  cat >"$task/spec-review.md" <<'MD'
# Spec Review
## Verdict
approved
## Missing Requirements
No missing requirements were found.
## Extra Behavior
No extra behavior was introduced.
## Misunderstood Requirements
No misunderstood requirements were found.
## Cannot Verify From Diff
Browser-level state coverage remains for verification.
## Required Fixes
No required fixes remain.
MD
  cat >"$task/quality-review.md" <<'MD'
# Quality Review
## Verdict
approved
## Separation Of Concerns
Good.
## Component Cohesion / Coupling
Good.
## Test Quality
Good.
## Error Handling
Good.
## Reuse / Duplication
Good.
## Complexity Delta
Low.
## Required Fixes
No required fixes remain.
MD
  cat >"$dev/handoff-to-verify.md" <<'MD'
# Handoff
## Implemented Slices
Dashboard summary.
## Files Changed
src/dashboard/DashboardView.tsx.
## Requirements Covered
Dashboard states.
## Prototype Decisions Implemented
Balanced variant.
## Components Created / Reused / Extracted
DashboardView created.
## API / Data Flow Changes
Summary API flow.
## Tests Added
Dashboard tests.
## Local Validation
npm test passed.
## Known Risks
Backend field naming remains a verification watch item.
## Items Requiring Six-Domain Verification
All six domains.
MD
}

write_verify_artifacts() {
  local project="$1"
  local verify="$project/openspec/changes/add-dashboard/verify"
  mkdir -p "$verify"/{behavior-evals/transcripts,facticity,static,unit,redteam,e2e,sensory}

  cat >"$verify/plan.md" <<'MD'
# Verification Plan
## Verification Scope
Dashboard summary.
## Required Domains
All six domains.
## Evidence Plan
Commands and artifacts.
MD
  cat >"$verify/plan.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "risk_tier": "medium",
  "required_domains": ["facticity", "static", "unit", "redteam", "e2e", "sensory"],
  "inputs": ["requirements.md", "acceptance.md", "prototype/handoff.md", "development/handoff-to-verify.md", "spec-map.json", "component-impact-map.json"],
  "user_test_case_gate": {
    "required": true,
    "cases": "verify/user-test-cases.json",
    "signoff": "verify/user-test-case-signoff.json",
    "domain_matrix": "verify/domain-case-matrix.json"
  },
  "runtime_evidence_gate": {
    "required": true,
    "evidence": "verify/runtime-evidence.json",
    "required_surfaces": ["runtime", "browser"]
  },
  "changed_files": ["src/dashboard/DashboardView.tsx"],
  "commands": ["npm test"],
  "manual_reviews": ["sensory"]
}
JSON
  cat >"$verify/user-test-cases.md" <<'MD'
# User Test Cases
## User Test Case Scope
Dashboard summary.
## Aligned Test Cases
utc-dashboard-summary.
## User Signoff
Approved.
## Domain Mapping
All six domains.
MD
  cat >"$verify/user-test-cases.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "status": "approved",
  "cases": [{
    "id": "utc-dashboard-summary",
    "title": "User can view dashboard summary with loading empty and error states",
    "actor": "dashboard user",
    "user_goal": "View dashboard summary",
    "preconditions": ["dashboard access exists"],
    "steps": ["open dashboard", "wait for summary"],
    "expected_results": ["summary, loading, empty, and error states are handled"],
    "boundary_cases": ["empty state", "error state"],
    "acceptance_refs": ["acceptance.md#dashboard"],
    "source_refs": ["requirements.md", "prototype/handoff.md", "development/handoff-to-verify.md"]
  }]
}
JSON
  cat >"$verify/user-test-case-signoff.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "status": "approved",
  "user_decision": "Approved dashboard summary test case coverage.",
  "approved_case_ids": ["utc-dashboard-summary"],
  "rejected_case_ids": [],
  "notes": []
}
JSON
  cat >"$verify/domain-case-matrix.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "cases": [{
    "case_id": "utc-dashboard-summary",
    "domains": {
      "facticity": ["trace to requirements and handoff"],
      "static": ["validate static dashboard contracts"],
      "unit": ["cover dashboard state behavior"],
      "redteam": ["probe invalid summary states"],
      "e2e": ["execute dashboard user flow"],
      "sensory": ["review dashboard user experience"]
    }
  }]
}
JSON
  cat >"$verify/evidence-index.jsonl" <<'JSONL'
{"id":"ev-static","kind":"command","domain":"static","result":"pass"}
{"id":"ev-unit","kind":"command","domain":"unit","result":"pass"}
{"id":"ev-runtime","kind":"command","domain":"e2e","result":"pass","path":"verify/runtime-evidence.json"}
JSONL
  cat >"$verify/runtime-evidence.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "status": "green",
  "surfaces": [
    {
      "surface": "runtime",
      "required": true,
      "status": "pass",
      "command": "npm run dev -- --host 127.0.0.1",
      "evidence_refs": ["verify/e2e/runtime-server.log"]
    },
    {
      "surface": "browser",
      "required": true,
      "status": "pass",
      "command": "npx playwright test tests/dashboard.spec.ts",
      "evidence_refs": ["verify/e2e/playwright-report.json"],
      "artifact_refs": ["verify/e2e/screenshots/dashboard-summary.png"]
    }
  ]
}
JSON
  cat >"$verify/traceability-matrix.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "entries": [{
    "changed_file": "src/dashboard/DashboardView.tsx",
    "change_reason": "dashboard summary",
    "requirement_refs": ["requirements.md#dashboard"],
    "task_refs": ["development/tasks/001-dashboard-summary/brief.md"],
    "prototype_refs": ["prototype/handoff.md#dashboard"],
    "foundation_spec_refs": ["openspec/specs/ui-design/design.md"],
    "verification_domains": ["facticity", "static", "unit", "e2e", "sensory"],
    "impact_notes": "bounded"
  }],
  "unmapped_changes": []
}
JSON
  : >"$verify/blocker-classification.jsonl"
  : >"$verify/root-cause-checks.jsonl"
  cat >"$verify/receipt.md" <<'MD'
# Receipt
## Covered Scope
Dashboard summary.
## Uncovered Scope
None.
## Residual Risk
None.
## Confidence
A.
MD
  cat >"$verify/receipt.json" <<'JSON'
{"schema_version":1,"change_id":"add-dashboard","evidence_action":"ran six-domain verification","result":"green","covered_scope":["dashboard summary"],"uncovered_scope":[],"residual_risk":[],"confidence":"A"}
JSON
  cat >"$verify/behavior-evals/scenarios.json" <<'JSON'
{"schema_version":1,"scenarios":[{"id":"verify-runs-six-domains","prompt":"/specnav-verify","expected":["write aggregate report"]}]}
JSON
  cat >"$verify/behavior-evals/report.md" <<'MD'
# Behavior Evals
## Scenarios
verify-runs-six-domains.
## Transcripts
Recorded.
## Result
green.
MD
  cat >"$verify/behavior-evals/report.json" <<'JSON'
{"schema_version":1,"status":"green","scenarios":["verify-runs-six-domains"]}
JSON
  cat >"$verify/behavior-evals/transcripts/verify-runs-six-domains.md" <<'MD'
# Clean Session Transcript

Prompt: /specnav-verify

Observed:
- Loaded active change.
- Generated plan.
- Ran or blocked all six domains.
- Wrote aggregate report.
MD

  for domain in facticity static unit redteam e2e sensory; do
    cat >"$verify/$domain/report.md" <<MD
# Verification Domain Report
## Domain
$domain
## Verdict
green
## Inputs Reviewed
Plan and handoff.
## Evidence
Evidence index.
## Commands Run
Recorded.
## Findings
None.
## Required Fixes
None.
## Residual Risk
None.
## Follow-up Domain Routing
None.
MD
    cat >"$verify/$domain/report.json" <<JSON
{"schema_version":1,"domain":"$domain","verdict":"green","required":true,"evidence":[],"commands":[],"blocker_class":null,"findings":[],"required_fixes":[],"residual_risk":[]}
JSON
  done
  cat >"$verify/unit/test-quality-rubric.json" <<'JSON'
{"schema_version":1,"checks":{"behavior_facing":true,"public_interface_only":true,"survives_refactor":true,"one_logical_assertion_per_test":true,"no_internal_mock_coupling":true,"critical_paths_covered":true,"edge_cases_covered":true},"findings":[]}
JSON
  cat >"$verify/sensory/reviewer-independence.md" <<'MD'
# Reviewer Independence
## Inputs Allowed
Files and evidence.
## Inputs Excluded
Controller claims.
## Controller Claims Ignored
All unevidenced claims.
## Files Reviewed
DashboardView.
## Evidence References
Evidence index.
## Cannot Verify From Provided Evidence
None.
MD
}

test -f "$VERIFY/scripts/verify-domains.js"
test -f "$VERIFY/skills/specnav-verify-plan/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-facticity/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-static/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-unit/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-redteam/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-e2e/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-sensory/SKILL.md"
test -f "$VERIFY/skills/specnav-verify-rerun/SKILL.md"
jq -e '.contracts.verification == "scripts/verify-domains.js"' "$VERIFY/specnav-stage.json" >/dev/null
jq -e 'has("planned_contracts") | not' "$VERIFY/specnav-stage.json" >/dev/null
grep -Fq -- '--marketplace-root "$SPECNAV_MARKETPLACE_ROOT"' "$VERIFY/commands/specnav-verify.md"
grep -Fq 'node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json' "$VERIFY/commands/specnav-verify.md"
grep -Fq 'node "$SPECNAV_VERIFICATION_ROOT/scripts/verify-domains.js" aggregate --json' "$VERIFY/commands/specnav-verify.md"

PROJECT="$TMP_DIR/verify-project"
write_base_project "$PROJECT"

run_json "$PROJECT" validate "$TMP_DIR/missing-verify.json" 2
assert_blocker "$TMP_DIR/missing-verify.json" 'missing-verify-artifact:plan.json'

write_verify_artifacts "$PROJECT"
run_json "$PROJECT" validate "$TMP_DIR/valid-verify.json" 0
jq -e '.ok == true' "$TMP_DIR/valid-verify.json" >/dev/null
jq -e '.artifacts[] | select(.name == "user-test-case-signoff.json" and .ok == true)' "$TMP_DIR/valid-verify.json" >/dev/null
jq -e '.artifacts[] | select(.name == "domain-case-matrix.json" and .ok == true)' "$TMP_DIR/valid-verify.json" >/dev/null
jq -e '.artifacts[] | select(.name == "runtime-evidence.json" and .ok == true)' "$TMP_DIR/valid-verify.json" >/dev/null
jq -e '.artifacts[] | select(.name == "diff-traceability" and .ok == true)' "$TMP_DIR/valid-verify.json" >/dev/null
jq -e '.artifacts[] | select(.name == "facticity/report.json" and .ok == true)' "$TMP_DIR/valid-verify.json" >/dev/null
run_json "$PROJECT" aggregate "$TMP_DIR/aggregate-green.json" 0
jq -e '.verdict == "green"' "$TMP_DIR/aggregate-green.json" >/dev/null
jq -e '.html_report == "verify/aggregate-report.html"' "$TMP_DIR/aggregate-green.json" >/dev/null
jq -e '.review_style == "claude-warm-editorial"' "$TMP_DIR/aggregate-green.json" >/dev/null
jq -e '.status == "green"' "$PROJECT/openspec/changes/add-dashboard/verify-report.json" >/dev/null
jq -e '.html_report == "verify-report.html"' "$PROJECT/openspec/changes/add-dashboard/verify-report.json" >/dev/null
test -f "$PROJECT/openspec/changes/add-dashboard/verify/aggregate-report.json"
test -f "$PROJECT/openspec/changes/add-dashboard/verify/aggregate-report.html"
test -f "$PROJECT/openspec/changes/add-dashboard/verify-report.html"
grep -Fq '#faf9f5' "$PROJECT/openspec/changes/add-dashboard/verify-report.html"
grep -Fq '#cc785c' "$PROJECT/openspec/changes/add-dashboard/verify-report.html"
grep -Fq 'Six-domain verification' "$PROJECT/openspec/changes/add-dashboard/verify-report.html"
grep -Fq 'CodeGraph Evidence' "$PROJECT/openspec/changes/add-dashboard/verify-report.html"
grep -Fq 'codegraph/guard-report.json' "$PROJECT/openspec/changes/add-dashboard/verify-report.html"

# Stale marker unresolved: a production edit after green verification (domain reports predate the marker)
# must block validation and force the aggregate red without re-running domains.
STALE_PROJECT="$TMP_DIR/stale-project"
cp -R "$PROJECT" "$STALE_PROJECT"
STALE_DIR="$STALE_PROJECT/openspec/changes/add-dashboard"
for d in facticity static unit redteam e2e sensory; do
  touch -t 202601010000 "$STALE_DIR/verify/$d/report.json"
done
printf 'edited\n' >"$STALE_DIR/verify-report.stale"
run_json "$STALE_PROJECT" validate "$TMP_DIR/stale-validate.json" 2
assert_blocker "$TMP_DIR/stale-validate.json" 'stale-verify-report'
run_json "$STALE_PROJECT" aggregate "$TMP_DIR/stale-aggregate.json" 2
jq -e '.verdict == "red"' "$TMP_DIR/stale-aggregate.json" >/dev/null
jq -e '.stale == true' "$TMP_DIR/stale-aggregate.json" >/dev/null
test -f "$STALE_DIR/verify-report.stale"

# Stale marker resolved: re-running domain verification (domain reports newer than the marker)
# lets the aggregate go green again and clears the marker. Guards against a stale-deadlock.
FRESH_PROJECT="$TMP_DIR/fresh-after-stale-project"
cp -R "$PROJECT" "$FRESH_PROJECT"
FRESH_DIR="$FRESH_PROJECT/openspec/changes/add-dashboard"
touch -t 202601010000 "$FRESH_DIR/verify-report.stale"
for d in facticity static unit redteam e2e sensory; do
  touch "$FRESH_DIR/verify/$d/report.json"
done
run_json "$FRESH_PROJECT" aggregate "$TMP_DIR/fresh-aggregate.json" 0
jq -e '.verdict == "green"' "$TMP_DIR/fresh-aggregate.json" >/dev/null
test ! -f "$FRESH_DIR/verify-report.stale"

set +e
PROJECT_DIR="$PROJECT" node "$ROOT/plugins/specnav-core/scripts/verify.js" >"$TMP_DIR/core-verify.txt"
CORE_VERIFY_STATUS=$?
set -e
[[ "$CORE_VERIFY_STATUS" == "1" ]]
jq -e '.status == "red"' "$PROJECT/openspec/changes/add-dashboard/verify-report.json" >/dev/null

TRACE_FAIL_PROJECT="$TMP_DIR/trace-fail-project"
cp -R "$PROJECT" "$TRACE_FAIL_PROJECT"
jq '.unmapped_changes = ["src/unmapped.ts"]' \
  "$TRACE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/traceability-matrix.json" \
  >"$TMP_DIR/trace-fail.json.tmp"
mv "$TMP_DIR/trace-fail.json.tmp" "$TRACE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/traceability-matrix.json"
run_json "$TRACE_FAIL_PROJECT" validate "$TMP_DIR/trace-fail.json" 2
assert_blocker "$TMP_DIR/trace-fail.json" 'traceability-unmapped-changes'

DIFF_TRACE_FAIL_PROJECT="$TMP_DIR/diff-trace-fail-project"
cp -R "$PROJECT" "$DIFF_TRACE_FAIL_PROJECT"
jq '.changed_files = ["src/dashboard/DashboardView.tsx", "src/dashboard/DashboardService.ts"]' \
  "$DIFF_TRACE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/plan.json" \
  >"$TMP_DIR/diff-trace-fail.json.tmp"
mv "$TMP_DIR/diff-trace-fail.json.tmp" "$DIFF_TRACE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/plan.json"
run_json "$DIFF_TRACE_FAIL_PROJECT" validate "$TMP_DIR/diff-trace-fail.json" 2
assert_blocker "$TMP_DIR/diff-trace-fail.json" 'diff-traceability:unmapped:src/dashboard/DashboardService.ts'

RUNTIME_FAIL_PROJECT="$TMP_DIR/runtime-fail-project"
cp -R "$PROJECT" "$RUNTIME_FAIL_PROJECT"
jq '.status = "blocked" | .surfaces[] |= if .surface == "browser" then (.status = "blocked") else . end' \
  "$RUNTIME_FAIL_PROJECT/openspec/changes/add-dashboard/verify/runtime-evidence.json" \
  >"$TMP_DIR/runtime-fail.json.tmp"
mv "$TMP_DIR/runtime-fail.json.tmp" "$RUNTIME_FAIL_PROJECT/openspec/changes/add-dashboard/verify/runtime-evidence.json"
run_json "$RUNTIME_FAIL_PROJECT" validate "$TMP_DIR/runtime-fail.json" 2
assert_blocker "$TMP_DIR/runtime-fail.json" 'runtime-evidence-not-green'
assert_blocker "$TMP_DIR/runtime-fail.json" 'runtime-evidence-surface-not-pass:browser'

SQL_MIGRATION_FAIL_PROJECT="$TMP_DIR/sql-migration-fail-project"
cp -R "$PROJECT" "$SQL_MIGRATION_FAIL_PROJECT"
cat >>"$SQL_MIGRATION_FAIL_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md" <<'MD'

## Database Changes
ALTER TABLE dashboard_summary ADD COLUMN reviewed_at TIMESTAMP NULL.
MD
run_json "$SQL_MIGRATION_FAIL_PROJECT" validate "$TMP_DIR/sql-migration-fail.json" 2
assert_blocker "$TMP_DIR/sql-migration-fail.json" 'development:migration-manifest-sql-mentioned-but-not-required'

SQL_DATABASE_EVIDENCE_FAIL_PROJECT="$TMP_DIR/sql-database-evidence-fail-project"
cp -R "$PROJECT" "$SQL_DATABASE_EVIDENCE_FAIL_PROJECT"
cat >"$SQL_DATABASE_EVIDENCE_FAIL_PROJECT/openspec/changes/add-dashboard/development/migrations/manifest.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "required": true,
  "status": "ready",
  "migrations": [{
    "id": "001-schema",
    "kind": "ddl",
    "order": 1,
    "path": "development/migrations/001-schema.sql"
  }],
  "verification": {
    "commands": ["psql -f openspec/changes/add-dashboard/development/migrations/001-schema.sql"],
    "evidence": ["verify/runtime-evidence.json"]
  },
  "rollback": [{
    "id": "001-schema-rollback",
    "path": "development/migrations/001-schema-rollback.sql"
  }],
  "rollback_strategy": "Run the rollback SQL before reverting application code."
}
JSON
cat >"$SQL_DATABASE_EVIDENCE_FAIL_PROJECT/openspec/changes/add-dashboard/development/migrations/001-schema.sql" <<'SQL'
ALTER TABLE dashboard_summary ADD COLUMN reviewed_at TIMESTAMP NULL;
SQL
cat >"$SQL_DATABASE_EVIDENCE_FAIL_PROJECT/openspec/changes/add-dashboard/development/migrations/001-schema-rollback.sql" <<'SQL'
ALTER TABLE dashboard_summary DROP COLUMN reviewed_at;
SQL
run_json "$SQL_DATABASE_EVIDENCE_FAIL_PROJECT" validate "$TMP_DIR/sql-database-evidence-fail.json" 2
assert_blocker "$TMP_DIR/sql-database-evidence-fail.json" 'runtime-evidence-missing-surface:database'

UNIT_FAIL_PROJECT="$TMP_DIR/unit-fail-project"
cp -R "$PROJECT" "$UNIT_FAIL_PROJECT"
jq '.checks.public_interface_only = false' \
  "$UNIT_FAIL_PROJECT/openspec/changes/add-dashboard/verify/unit/test-quality-rubric.json" \
  >"$TMP_DIR/unit-fail.json.tmp"
mv "$TMP_DIR/unit-fail.json.tmp" "$UNIT_FAIL_PROJECT/openspec/changes/add-dashboard/verify/unit/test-quality-rubric.json"
run_json "$UNIT_FAIL_PROJECT" validate "$TMP_DIR/unit-fail.json" 2
assert_blocker "$TMP_DIR/unit-fail.json" 'unit-test-quality-blocking:public_interface_only'

DOMAIN_FAIL_PROJECT="$TMP_DIR/domain-fail-project"
cp -R "$PROJECT" "$DOMAIN_FAIL_PROJECT"
jq '.verdict = "red"' \
  "$DOMAIN_FAIL_PROJECT/openspec/changes/add-dashboard/verify/static/report.json" \
  >"$TMP_DIR/domain-fail.json.tmp"
mv "$TMP_DIR/domain-fail.json.tmp" "$DOMAIN_FAIL_PROJECT/openspec/changes/add-dashboard/verify/static/report.json"
run_json "$DOMAIN_FAIL_PROJECT" validate "$TMP_DIR/domain-fail.json" 2
assert_blocker "$TMP_DIR/domain-fail.json" 'static-not-green'

BEHAVIOR_FAIL_PROJECT="$TMP_DIR/behavior-fail-project"
cp -R "$PROJECT" "$BEHAVIOR_FAIL_PROJECT"
rm "$BEHAVIOR_FAIL_PROJECT/openspec/changes/add-dashboard/verify/behavior-evals/transcripts/verify-runs-six-domains.md"
run_json "$BEHAVIOR_FAIL_PROJECT" validate "$TMP_DIR/behavior-fail.json" 2
assert_blocker "$TMP_DIR/behavior-fail.json" 'missing-behavior-eval-transcript:verify-runs-six-domains'

USER_CASE_FAIL_PROJECT="$TMP_DIR/user-case-fail-project"
cp -R "$PROJECT" "$USER_CASE_FAIL_PROJECT"
jq '.status = "pending" | .approved_case_ids = [] | .user_decision = "<decision-required>"' \
  "$USER_CASE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/user-test-case-signoff.json" \
  >"$TMP_DIR/user-case-fail.json.tmp"
mv "$TMP_DIR/user-case-fail.json.tmp" "$USER_CASE_FAIL_PROJECT/openspec/changes/add-dashboard/verify/user-test-case-signoff.json"
run_json "$USER_CASE_FAIL_PROJECT" validate "$TMP_DIR/user-case-fail.json" 2
assert_blocker "$TMP_DIR/user-case-fail.json" 'verify:user-test-cases-unapproved'

USER_DECISION_FAIL_PROJECT="$TMP_DIR/user-decision-fail-project"
cp -R "$PROJECT" "$USER_DECISION_FAIL_PROJECT"
jq '.user_decision = "<decision-required>"' \
  "$USER_DECISION_FAIL_PROJECT/openspec/changes/add-dashboard/verify/user-test-case-signoff.json" \
  >"$TMP_DIR/user-decision-fail.json.tmp"
mv "$TMP_DIR/user-decision-fail.json.tmp" "$USER_DECISION_FAIL_PROJECT/openspec/changes/add-dashboard/verify/user-test-case-signoff.json"
run_json "$USER_DECISION_FAIL_PROJECT" validate "$TMP_DIR/user-decision-fail.json" 2
assert_blocker "$TMP_DIR/user-decision-fail.json" 'invalid-user-test-case-signoff:user_decision'

SENSORY_FAIL_PROJECT="$TMP_DIR/sensory-fail-project"
cp -R "$PROJECT" "$SENSORY_FAIL_PROJECT"
cat >"$SENSORY_FAIL_PROJECT/openspec/changes/add-dashboard/verify/sensory/reviewer-independence.md" <<'MD'
# Reviewer Independence
## Inputs Allowed
Files.
MD
run_json "$SENSORY_FAIL_PROJECT" validate "$TMP_DIR/sensory-fail.json" 2
assert_blocker "$TMP_DIR/sensory-fail.json" 'invalid-reviewer-independence:missing-heading:Inputs Excluded'

DEVELOPMENT_FAIL_PROJECT="$TMP_DIR/development-fail-project"
cp -R "$PROJECT" "$DEVELOPMENT_FAIL_PROJECT"
rm "$DEVELOPMENT_FAIL_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md"
run_json "$DEVELOPMENT_FAIL_PROJECT" validate "$TMP_DIR/development-fail.json" 2
assert_blocker "$TMP_DIR/development-fail.json" 'development-blocked'

echo "specnav verification plugin fixtures ok"
