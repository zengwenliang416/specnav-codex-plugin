#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$ROOT/plugins/specnav-development"
PROJECT="$ROOT/tests/fixtures/simple-project"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_json() {
  local project="$1"
  local output="$2"
  local expected_status="$3"
  local mode="${4:-}"
  local status
  local command=(node "$DEV/scripts/development-contract.js" --json --verbose)

  if [[ -n "$mode" ]]; then
    command+=(--mode "$mode")
  fi

  set +e
  PROJECT_DIR="$project" "${command[@]}" >"$output"
  status=$?
  set -e
  if [[ "$status" != "$expected_status" ]]; then
    echo "expected status $expected_status, got $status for $project" >&2
    cat "$output" >&2
    exit 1
  fi
}

assert_blocker() {
  local output="$1"
  local blocker="$2"

  jq -e --arg blocker "$blocker" '.blockers[] | select(. == $blocker)' "$output" >/dev/null
}

init_git_baseline() {
  local project="$1"

  git -C "$project" init -q
  git -C "$project" config user.name "SpecNav Fixture"
  git -C "$project" config user.email "specnav-fixture@example.com"
  git -C "$project" add .
  git -C "$project" commit -qm "test: establish development baseline"
}

write_requirements_project() {
  local project="$1"
  local change="add-dashboard"

  mkdir -p \
    "$project/openspec/.specnav" \
    "$project/openspec/specs/ui-design" \
    "$project/openspec/specs/system-architecture" \
    "$project/openspec/specs/frontend-backend-data-flow" \
    "$project/openspec/specs/component-architecture" \
    "$project/openspec/changes/$change"

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

  cat >"$project/openspec/changes/$change/requirements.md" <<'MD'
# Requirements

- Add a dashboard view backed by the existing application shell.
MD

  cat >"$project/openspec/changes/$change/acceptance.md" <<'MD'
# Acceptance

- Dashboard renders with loading, empty, and error states covered.
MD

  cat >"$project/openspec/changes/$change/spec-map.json" <<'JSON'
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

  cat >"$project/openspec/changes/$change/component-impact-map.json" <<'JSON'
{
  "new_components": ["DashboardView"],
  "reused_components": [],
  "extraction_triggers": [],
  "forbidden_dependencies": [],
  "hooks": [],
  "utilities": [],
  "services": [],
  "required_component_tests": ["DashboardView renders loading empty error states"],
  "unresolved_gaps": []
}
JSON
}

write_ui_prototype() {
  local project="$1"
  local prototype="$project/openspec/changes/add-dashboard/prototype"

  mkdir -p "$prototype/artifact"

  cat >"$prototype/question.md" <<'MD'
# Prototype Question

Branch: ui-html

Question: Which dashboard layout should be approved before implementation?
MD

  cat >"$prototype/artifact/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Dashboard Prototype</title>
  </head>
  <body>
    <main data-specnav-project-shell="existing-dashboard-shell" data-specnav-screen="dashboard" data-specnav-variant="balanced">
      <nav data-specnav-component="app-sidebar">Dashboard</nav>
      <section data-specnav-component="dashboard-summary" data-specnav-state="populated">Dashboard summary</section>
    </main>
  </body>
</html>
HTML

  cat >"$prototype/screen-map.json" <<'JSON'
{
  "screens": [
    {
      "id": "dashboard",
      "requirements": ["requirements.md#dashboard-view"],
      "acceptance": ["Dashboard renders with loading, empty, and error states covered."],
      "components": ["DashboardView", "DashboardSummary"],
      "visual_evidence": ["visual-inventory.json#project_shell"],
      "data_flows": ["Dashboard summary API response populates dashboard view state"],
      "theme_modes": ["light"],
      "locales": ["none"],
      "implementation_files": ["src/dashboard/DashboardView.tsx", "src/dashboard/useDashboardState.ts"]
    }
  ]
}
JSON

  cat >"$prototype/visual-inventory.json" <<'JSON'
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

  cat >"$prototype/prototype-manifest.json" <<'JSON'
{
  "schema": "specnav.prototype.manifest.v1",
  "version": "1.0.0",
  "type": "ui-html",
  "entry": "artifact/index.html",
  "dependencies": [],
  "mock_strategy": "Static HTML uses mock dashboard counts only.",
  "touches_real_data": false,
  "referenced_foundation_specs": ["ui-design", "system-architecture"],
  "referenced_requirements": ["requirements.md", "acceptance.md"],
  "may_promote": false,
  "promotion_requirement": "Prototype decisions must enter development through scope.json and tasks.md.",
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

  cat >"$prototype/verifier-report.json" <<'JSON'
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
  "checks": ["entry exists", "desktop viewport reviewed", "mobile viewport reviewed"]
}
JSON

  cat >"$prototype/handoff.md" <<'MD'
# Prototype Handoff

## Approved branch and variant

- Branch: ui-html
- Variant: balanced

## Screens or flows to implement

- Dashboard screen with summary metrics and reviewable states.

## Components to create

- DashboardView.

## Components to reuse

- Existing application shell and summary card primitives.

## Components, hooks, utilities, and services to extract

- Components: DashboardSummary.
- Hooks: useDashboardState.
- Utilities: formatDashboardMetric.
- Services: dashboardSummaryService.

## API contracts

- GET /api/dashboard/summary returns metric counts and permission flags for the dashboard.

## Data flows

- DashboardView loads the summary API response into local view state before rendering metrics.

## State, loading, empty, error, disabled, and permission behavior

- Required states cover loading, empty, error, disabled refresh, and permission denied views.

## Theme and locale policy

- Theme support: light-only.
- Theme modes shown in prototype: light.
- Theme toggle: omitted because the project does not require one for this prototype.
- Internationalization: disabled.
- Locales shown in prototype: none.
- Locale switcher: omitted.

## Out-of-scope items

- Live analytics filtering and export workflows stay outside this prototype handoff.

## Required tests

- DashboardView covers loading, empty, error, disabled, and permission behavior.

## Open risks

- Backend summary fields may need final naming during development.
MD

  cat >"$prototype/decision.json" <<'JSON'
{
  "status": "approved",
  "prototype_code": "required_present",
  "prototype_type": "ui-html",
  "approved_variant": "balanced",
  "promotion": "requires_development_gate",
  "blocked_reasons": []
}
JSON
}

write_development_artifacts() {
  local project="$1"
  local change="add-dashboard"
  local change_dir="$project/openspec/changes/$change"
  local development="$change_dir/development"
  local task="$development/tasks/001-dashboard-summary"

  mkdir -p "$task" "$development/migrations" "$development/evidence"

  cat >"$change_dir/scope.json" <<'JSON'
{
  "schema_version": 1,
  "change_id": "add-dashboard",
  "stage": "development",
  "allowed_roots": ["src/dashboard/**", "tests/dashboard/**"],
  "denied_roots": [".env*", "scripts/deploy/**"],
  "allowed_operations": {
    "create": true,
    "modify": true,
    "delete": false,
    "rename": true
  },
  "requires_review_on": ["src/shared/**", "package.json"],
  "prototype_sources": ["openspec/changes/add-dashboard/prototype/artifact/index.html"],
  "expires_when": "verification_started"
}
JSON

  cat >"$change_dir/tasks.md" <<'MD'
# Development Tasks

- [x] user can view dashboard summary with loading empty and error states
MD

  cat >"$development/before-dev-check.json" <<'JSON'
{
  "schema_version": 1,
  "active_change": "add-dashboard",
  "status": "passed",
  "ok": true
}
JSON

  cat >"$development/basis.md" <<'MD'
# Development Basis

Development is based on the approved requirements, acceptance criteria, prototype decision, and prototype handoff for add-dashboard.

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

  cat >"$development/prototype-promotion-map.json" <<'JSON'
{
  "schema_version": 1,
  "promotion_policy": "reimplement_under_development_gate",
  "allowed_to_copy": ["approved copy text", "token names", "state names"],
  "must_reimplement": ["component structure", "state management", "API calls"],
  "blocked_direct_copies": ["inline prototype JS", "mock data", "prototype CSS reset"]
}
JSON

  cat >"$development/complexity-budget.json" <<'JSON'
{
  "schema_version": 1,
  "budgets": [
    {
      "task": "001-dashboard-summary",
      "max_files": 4,
      "max_components": 2
    }
  ]
}
JSON

  cat >"$development/task-graph.json" <<'JSON'
{
  "schema_version": 1,
  "nodes": ["001-dashboard-summary"],
  "edges": []
}
JSON

  cat >"$development/code-owner-map.json" <<'JSON'
{
  "schema_version": 1,
  "owners": [
    {
      "path": "src/dashboard/**",
      "owner": "dashboard-team"
    }
  ]
}
JSON

  cat >"$development/extraction-map.json" <<'JSON'
{
  "schema_version": 1,
  "components": ["DashboardSummary"],
  "hooks": ["useDashboardState"]
}
JSON

  cat >"$development/task-context.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","source":"context.json","status":"ready"}
JSONL

  cat >"$development/task-ledger.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","status":"started","base":"abc1234","time":"2026-06-23T10:00:00Z"}
{"task":"001-dashboard-summary","status":"spec_review_passed","head":"def5678"}
{"task":"001-dashboard-summary","status":"quality_review_passed","head":"def5678"}
{"task":"001-dashboard-summary","status":"complete","tests":"npm test dashboard-summary.test.tsx"}
JSONL

  cat >"$development/drift-check.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","against":["requirements.md","prototype/handoff.md","spec-map.json","component-impact-map.json"],"drift":"none","blocking":false,"notes":["matches approved dashboard summary behavior"]}
JSONL

  cat >"$development/validation-log.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx","status":"passed","ok":true}
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx","status":"pass","ok":true,"exit_status":0,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:00:00.000Z","evidence_log":"development/evidence/001-dashboard-summary.log"}
JSONL
  printf '%s\n' "dashboard summary focused validation passed" >"$development/evidence/001-dashboard-summary.log"

  cat >"$development/migrations/manifest.json" <<'JSON'
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

  cat >"$development/migrations/README.md" <<'MD'
# Migration Notes

## Execution Order

No database migration is required for this dashboard-only change.

## Validation

Confirm requirements, task report, and handoff do not describe SQL, seed, DDL, or DML changes.

## Rollback

No migration rollback is required.
MD

  cat >"$task/brief.md" <<'MD'
# Task 001: Dashboard Summary Slice

## Goal

Implement the dashboard summary slice for the approved dashboard view.

## Parent Artifacts

Read requirements.md, acceptance.md, spec-map.json, component-impact-map.json, and prototype/handoff.md.

## Vertical Slice

User can view dashboard summary metrics with loading, empty, and error states.

## In Scope

Dashboard summary UI, state hook, service adapter, and focused tests are in scope.

## Out Of Scope

Live analytics filtering and export workflows stay outside this slice.

## Files Allowed

src/dashboard/DashboardView.tsx and tests/dashboard/dashboard-summary.test.tsx are allowed.

## Interfaces / Seams

The slice uses dashboardSummaryService and keeps data loading behind useDashboardState.

## Components To Create

Create DashboardView.

## Components To Reuse

Reuse the existing application shell and summary card primitive.

## Components To Extract

Extract DashboardSummary only if duplication appears during implementation.

## API / Data Flow Contracts

GET /api/dashboard/summary returns metric counts and permission flags.

## State / Error / Empty / Loading Behavior

Render loading, empty, error, disabled refresh, and permission denied states.

## TDD Requirement

Write a failing dashboard summary test before production implementation.

## Verification Commands

Run npm test dashboard-summary.test.tsx after implementation.

## Stop Conditions

Stop if scope changes, API fields conflict with requirements, or prototype decisions are insufficient.

## Unsafe Assumptions

No unsafe assumptions are accepted without controller review.
MD

  cat >"$task/context.json" <<'JSON'
{
  "task_id": "001-dashboard-summary",
  "goal": "Implement dashboard summary slice",
  "stop_condition": "slice implemented, reviews approved, validation recorded",
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
  "allowed_files": [
    "src/dashboard/DashboardView.tsx",
    "tests/dashboard/dashboard-summary.test.tsx"
  ],
  "non_goals": [
    "analytics export",
    "database persistence"
  ],
  "expected_evidence": [
    "RED test output",
    "GREEN test output",
    "focused validation command"
  ],
  "unsafe_assumptions": []
}
JSON

  cat >"$task/acceptance.json" <<'JSON'
{
  "schema": "specnav.task-acceptance-evidence.v1",
  "task_id": "001-dashboard-summary",
  "recorded_at": "2026-07-03T00:00:00.000Z",
  "status": "approved",
  "assertions": [
    {
      "id": "TASK-01",
      "parent_id": "AC-01",
      "status": "passing",
      "direct_evidence": [
        "development/evidence/001-dashboard-summary.log",
        "openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md"
      ],
      "reused_evidence": [],
      "claim": "The dashboard summary slice is implemented and validated."
    }
  ],
  "fallback_used": false
}
JSON

  cat >"$task/report.md" <<'MD'
# Implementation Report

## Status

DONE_WITH_CONCERNS

## Files Changed

- src/dashboard/DashboardView.tsx
- tests/dashboard/dashboard-summary.test.tsx

## What Changed

Implemented the summary view and connected the state hook to the service seam.

## TDD Evidence

### RED

Initial dashboard summary test failed before implementation.

### GREEN

Dashboard summary test passed after implementation.

### REFACTOR

No behavior-changing refactor was needed.

## Verification Commands

- npm test dashboard-summary.test.tsx

## Concerns

Backend naming remains a review watch item.

## Adjudication

Controller reviewed the backend naming concern and accepted it for verification handoff because it is tracked as a non-blocking follow-up with no behavior impact on the dashboard summary slice.

## Scope Deviations

No scope deviations were made.

## Follow-up Needed

Verification should exercise the states in the browser.
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

Browser state coverage remains for verification.

## Required Fixes

No required fixes remain.

## Acceptance Assertions Verified

- `TASK-01`: task-level implementation and focused validation evidence were reviewed.
MD

  cat >"$task/quality-review.md" <<'MD'
# Quality Review

## Verdict

approved

## Separation Of Concerns

View, hook, and service responsibilities remain separated.

## Component Cohesion / Coupling

The dashboard summary component is cohesive.

## Test Quality

Tests cover the focused slice states.

## Error Handling

Error state rendering is covered.

## Reuse / Duplication

Existing summary card primitives are reused.

## Complexity Delta

Complexity stays within the recorded budget.

## Required Fixes

No required fixes remain.
MD

  cat >"$development/handoff-to-verify.md" <<'MD'
# Handoff To Verification

## Implemented Slices

Dashboard summary view slice is implemented.

## Files Changed

Dashboard view and focused dashboard summary tests changed.

## Requirements Covered

Requirements for dashboard loading, empty, and error states are covered.

## Prototype Decisions Implemented

Approved balanced dashboard variant decisions are implemented.

## Components Created / Reused / Extracted

DashboardView was created, shell primitives were reused, and DashboardSummary remains an extraction candidate.

## API / Data Flow Changes

Dashboard summary data flows through dashboardSummaryService into useDashboardState.

## Tests Added

Focused dashboard summary tests were added.

## Local Validation

npm test dashboard-summary.test.tsx passed locally.

## Known Risks

Backend field naming remains a verification watch item.

## Items Requiring Six-Domain Verification

Six-domain verification must check user-visible states, data flow, and component boundaries.
MD

  init_git_baseline "$project"
}

test -f "$DEV/scripts/development-contract.js"
test -f "$DEV/skills/specnav-development-entry/SKILL.md"
test -f "$DEV/skills/specnav-scope-lock/SKILL.md"
test -f "$DEV/skills/specnav-vertical-slices/SKILL.md"
test -f "$DEV/skills/specnav-fix/SKILL.md"
test -f "$DEV/skills/specnav-debug/SKILL.md"
test -f "$DEV/skills/specnav-break-loop/SKILL.md"
grep -Fq "runtime.requirePluginScript('specnav-prototype', 'scripts/prototype-contract')" "$DEV/scripts/development-contract.js"
! grep -Fq '../../specnav-prototype/scripts/prototype-contract' "$DEV/scripts/development-contract.js"
! grep -Fq '../../specnav-core/scripts/specnav-lib' "$DEV/scripts/development-contract.js"
! grep -Fq 'plugins/specnav-core/scripts/contracts' "$DEV/scripts/development-contract.js"
! grep -Fq '../../specnav-core/scripts/contracts' "$DEV/scripts/development-contract.js"

for skill in specnav-development-entry specnav-scope-lock specnav-vertical-slices; do
  grep -Fq 'node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode entry --json' "$DEV/skills/$skill/SKILL.md"
  grep -Fiq 'fallback' "$DEV/skills/$skill/SKILL.md"
done
grep -Fq 'node "$SPECNAV_DEVELOPMENT_ROOT/scripts/development-contract.js" --mode handoff --json' "$DEV/skills/specnav-vertical-slices/SKILL.md"

jq -e '.contracts.development == "scripts/development-contract.js"' "$DEV/specnav-stage.json" >/dev/null
jq -e 'has("planned_contracts") | not' "$DEV/specnav-stage.json" >/dev/null

run_json "$PROJECT" "$TMP_DIR/simple-project.json" 2
jq -e '.ok == false' "$TMP_DIR/simple-project.json" >/dev/null
assert_blocker "$TMP_DIR/simple-project.json" 'prototype-blocked'

HAPPY_PROJECT="$TMP_DIR/happy-project"
write_requirements_project "$HAPPY_PROJECT"
write_ui_prototype "$HAPPY_PROJECT"
write_development_artifacts "$HAPPY_PROJECT"
run_json "$HAPPY_PROJECT" "$TMP_DIR/happy-development.json" 0
jq -e '.ok == true' "$TMP_DIR/happy-development.json" >/dev/null
jq -e '.mode == "handoff"' "$TMP_DIR/happy-development.json" >/dev/null
jq -e '.active_change == "add-dashboard"' "$TMP_DIR/happy-development.json" >/dev/null
jq -e '.prototype.ok == true' "$TMP_DIR/happy-development.json" >/dev/null
jq -e '.tasks[] | select(.task_id == "001-dashboard-summary" and .ok == true)' "$TMP_DIR/happy-development.json" >/dev/null
run_json "$HAPPY_PROJECT" "$TMP_DIR/happy-entry.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/happy-entry.json" >/dev/null

MISSING_TASK_ACCEPTANCE_PROJECT="$TMP_DIR/missing-task-acceptance-project"
cp -R "$HAPPY_PROJECT" "$MISSING_TASK_ACCEPTANCE_PROJECT"
rm "$MISSING_TASK_ACCEPTANCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json"
run_json "$MISSING_TASK_ACCEPTANCE_PROJECT" "$TMP_DIR/missing-task-acceptance-entry.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/missing-task-acceptance-entry.json" >/dev/null
run_json "$MISSING_TASK_ACCEPTANCE_PROJECT" "$TMP_DIR/missing-task-acceptance-handoff.json" 2 handoff
assert_blocker "$TMP_DIR/missing-task-acceptance-handoff.json" 'missing-task-artifact:acceptance.json'

EMPTY_TASK_ACCEPTANCE_PROJECT="$TMP_DIR/empty-task-acceptance-project"
cp -R "$HAPPY_PROJECT" "$EMPTY_TASK_ACCEPTANCE_PROJECT"
jq '.assertions = []' \
  "$EMPTY_TASK_ACCEPTANCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json" \
  >"$TMP_DIR/empty-task-acceptance.json.tmp"
mv "$TMP_DIR/empty-task-acceptance.json.tmp" \
  "$EMPTY_TASK_ACCEPTANCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json"
run_json "$EMPTY_TASK_ACCEPTANCE_PROJECT" "$TMP_DIR/empty-task-acceptance.json" 2
assert_blocker "$TMP_DIR/empty-task-acceptance.json" 'invalid-task-acceptance:assertions'

INVALID_TASK_ACCEPTANCE_PROJECT="$TMP_DIR/invalid-task-acceptance-project"
cp -R "$HAPPY_PROJECT" "$INVALID_TASK_ACCEPTANCE_PROJECT"
cat >"$INVALID_TASK_ACCEPTANCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json" <<'JSON'
{
  "schema": "specnav.task-acceptance-evidence.v0",
  "task_id": "999-wrong-task",
  "status": "pending",
  "assertions": [
    {
      "id": "TASK-01",
      "status": "failing",
      "direct_evidence": [],
      "reused_evidence": []
    },
    {
      "id": "TASK-01",
      "status": "passing",
      "direct_evidence": ["../outside.log"],
      "reused_evidence": "development/evidence/001-dashboard-summary.log"
    },
    {
      "id": "TASK-02",
      "status": "passing",
      "direct_evidence": ["development/evidence/missing.log"],
      "reused_evidence": []
    }
  ],
  "fallback_used": true
}
JSON
run_json "$INVALID_TASK_ACCEPTANCE_PROJECT" "$TMP_DIR/invalid-task-acceptance.json" 2
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'invalid-task-acceptance:schema'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'invalid-task-acceptance:task_id'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'invalid-task-acceptance:status'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'invalid-task-acceptance:fallback_used'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'task-acceptance:duplicate-assertion-id:TASK-01'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'task-acceptance:non-passing:TASK-01'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'task-acceptance:missing-evidence:TASK-01'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'invalid-task-acceptance:TASK-01:reused_evidence'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'task-acceptance:invalid-evidence-path:TASK-01:../outside.log'
assert_blocker "$TMP_DIR/invalid-task-acceptance.json" 'task-acceptance:missing-evidence-path:TASK-02:development/evidence/missing.log'

INVALID_TASK_ASSERTION_ID_PROJECT="$TMP_DIR/invalid-task-assertion-id-project"
cp -R "$HAPPY_PROJECT" "$INVALID_TASK_ASSERTION_ID_PROJECT"
jq '.assertions[0].id = " "' \
  "$INVALID_TASK_ASSERTION_ID_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json" \
  >"$TMP_DIR/invalid-task-assertion-id.json.tmp"
mv "$TMP_DIR/invalid-task-assertion-id.json.tmp" \
  "$INVALID_TASK_ASSERTION_ID_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json"
run_json "$INVALID_TASK_ASSERTION_ID_PROJECT" "$TMP_DIR/invalid-task-assertion-id.json" 2
assert_blocker "$TMP_DIR/invalid-task-assertion-id.json" 'invalid-task-acceptance:assertion-id'

ASSERTION_REFERENCE_PROJECT="$TMP_DIR/assertion-reference-project"
cp -R "$HAPPY_PROJECT" "$ASSERTION_REFERENCE_PROJECT"
cat >"$ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/acceptance.json" <<'JSON'
{
  "schema_version": 2,
  "change_id": "add-dashboard",
  "assertions": [
    {
      "id": "PARENT-01",
      "statement": "The dashboard summary remains reviewable.",
      "verify_via": "static",
      "status": "passing",
      "evidence_ref": "development/evidence/001-dashboard-summary.log"
    }
  ]
}
JSON
perl -0pi -e 's/task-level implementation and focused validation evidence were reviewed/task-level implementation and SHA-256 fixture identity were reviewed/' \
  "$ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md"
run_json "$ASSERTION_REFERENCE_PROJECT" "$TMP_DIR/assertion-reference.json" 0
jq -e '.ok == true' "$TMP_DIR/assertion-reference.json" >/dev/null
if jq -e '.blockers[] | select(. == "review:invalid-reference:SHA-256")' "$TMP_DIR/assertion-reference.json" >/dev/null; then
  echo "technical SHA-256 text was misclassified as an acceptance assertion id" >&2
  exit 1
fi

TASK_SUBCLAIM_REFERENCE_PROJECT="$TMP_DIR/task-subclaim-reference-project"
cp -R "$ASSERTION_REFERENCE_PROJECT" "$TASK_SUBCLAIM_REFERENCE_PROJECT"
jq '.assertions[0].id = "PARENT-01:dashboard-summary"' \
  "$TASK_SUBCLAIM_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json" \
  >"$TMP_DIR/task-subclaim-reference.json.tmp"
mv "$TMP_DIR/task-subclaim-reference.json.tmp" \
  "$TASK_SUBCLAIM_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/acceptance.json"
sed -i.bak 's/`TASK-01`/`PARENT-01:dashboard-summary`/' \
  "$TASK_SUBCLAIM_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md"
rm "$TASK_SUBCLAIM_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md.bak"
run_json "$TASK_SUBCLAIM_REFERENCE_PROJECT" "$TMP_DIR/task-subclaim-reference.json" 0
jq -e '.ok == true' "$TMP_DIR/task-subclaim-reference.json" >/dev/null

INVALID_ASSERTION_REFERENCE_PROJECT="$TMP_DIR/invalid-assertion-reference-project"
cp -R "$ASSERTION_REFERENCE_PROJECT" "$INVALID_ASSERTION_REFERENCE_PROJECT"
sed -i.bak 's/`TASK-01`/`TASK-99`/' \
  "$INVALID_ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md"
rm "$INVALID_ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md.bak"
run_json "$INVALID_ASSERTION_REFERENCE_PROJECT" "$TMP_DIR/invalid-assertion-reference.json" 2
assert_blocker "$TMP_DIR/invalid-assertion-reference.json" 'review:invalid-reference:TASK-99'
assert_blocker "$TMP_DIR/invalid-assertion-reference.json" 'review:unsupported-verdict'

PARENT_ONLY_ASSERTION_REFERENCE_PROJECT="$TMP_DIR/parent-only-assertion-reference-project"
cp -R "$ASSERTION_REFERENCE_PROJECT" "$PARENT_ONLY_ASSERTION_REFERENCE_PROJECT"
sed -i.bak 's/`TASK-01`/`PARENT-01`/' \
  "$PARENT_ONLY_ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md"
rm "$PARENT_ONLY_ASSERTION_REFERENCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md.bak"
run_json "$PARENT_ONLY_ASSERTION_REFERENCE_PROJECT" "$TMP_DIR/parent-only-assertion-reference.json" 2
assert_blocker "$TMP_DIR/parent-only-assertion-reference.json" 'review:unsupported-verdict'

HIERARCHICAL_TASK_PROJECT="$TMP_DIR/hierarchical-task-project"
cp -R "$HAPPY_PROJECT" "$HIERARCHICAL_TASK_PROJECT"
cat >"$HIERARCHICAL_TASK_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

## 1. Dashboard Summary

**User outcome:** An administrator can inspect the dashboard summary and understand
loading, empty, and failure states.

- [x] 1.1 Introduce a typed dashboard summary response model.
- [x] 1.2 Add deterministic state transition tests.
- [x] 1.3 Refactor the service adapter behind the existing view contract.
MD
run_json "$HIERARCHICAL_TASK_PROJECT" "$TMP_DIR/hierarchical-task.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/hierarchical-task.json" >/dev/null

TECHNICAL_ONLY_TASK_PROJECT="$TMP_DIR/technical-only-task-project"
cp -R "$HAPPY_PROJECT" "$TECHNICAL_ONLY_TASK_PROJECT"
cat >"$TECHNICAL_ONLY_TASK_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

## 1. Parser Work

- [x] 1.1 Update the dashboard parser.
- [x] 1.2 Create parser regression tests.
MD
run_json "$TECHNICAL_ONLY_TASK_PROJECT" "$TMP_DIR/technical-only-task.json" 2 entry
assert_blocker "$TMP_DIR/technical-only-task.json" 'tasks-md:section-missing-user-outcome:1 parser work'
assert_blocker "$TMP_DIR/technical-only-task.json" 'tasks-md:no-vertical-slice'

TASK_REMOVAL_PROJECT="$TMP_DIR/task-removal-project"
cp -R "$HAPPY_PROJECT" "$TASK_REMOVAL_PROJECT"
cat >"$TASK_REMOVAL_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

## 1. Dashboard Summary

**User outcome:** A user can view the dashboard summary.

- [x] 1.1 User can view dashboard summary with loading empty and error states.
- [x] 1.2 Contributor can verify deterministic dashboard state transitions.
MD
git -C "$TASK_REMOVAL_PROJECT" add openspec/changes/add-dashboard/tasks.md
git -C "$TASK_REMOVAL_PROJECT" commit -qm "test: record complete task baseline"
cat >"$TASK_REMOVAL_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

## 1. Dashboard Summary

**User outcome:** A user can view the dashboard summary.

- [x] 1.1 User can view dashboard summary with loading empty and error states.
MD
run_json "$TASK_REMOVAL_PROJECT" "$TMP_DIR/task-removal.json" 2 entry
assert_blocker "$TMP_DIR/task-removal.json" 'tasks-md:baseline-task-removed:1.2'

cat >"$TASK_REMOVAL_PROJECT/openspec/changes/add-dashboard/development/task-change-approval.json" <<'JSON'
{
  "schema_version": 1,
  "approved_by": "user",
  "approved_at": "2026-07-30T00:00:00Z",
  "reason": "The user explicitly removed the duplicate verification task.",
  "removed_task_ids": ["1.2"]
}
JSON
run_json "$TASK_REMOVAL_PROJECT" "$TMP_DIR/task-removal-approved.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/task-removal-approved.json" >/dev/null

NO_GIT_BASELINE_PROJECT="$TMP_DIR/no-git-baseline-project"
cp -R "$HAPPY_PROJECT" "$NO_GIT_BASELINE_PROJECT"
rm -rf "$NO_GIT_BASELINE_PROJECT/.git"
run_json "$NO_GIT_BASELINE_PROJECT" "$TMP_DIR/no-git-baseline.json" 2 entry
assert_blocker "$TMP_DIR/no-git-baseline.json" 'git-baseline:missing-head'

SLICE_SCRIPT_PROJECT="$TMP_DIR/slice-script-project"
cp -R "$HAPPY_PROJECT" "$SLICE_SCRIPT_PROJECT"
cat >"$SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl" <<'JSONL'
{"status":"pending-vertical-slices","source":"development-entry-scaffold","note":"No task is planned until specnav-vertical-slices creates task packets."}
JSONL
PROJECT_DIR="$SLICE_SCRIPT_PROJECT" node "$DEV/skills/specnav-vertical-slices/scripts/create-vertical-slice.js" --task-id=002-dashboard-detail --json >"$TMP_DIR/slice-script.json"
jq -e '.ok == true' "$TMP_DIR/slice-script.json" >/dev/null
grep -Fq '"task_id":"002-dashboard-detail"' "$SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl"
grep -Fq '"status":"task-ready"' "$SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl"
if grep -Fq 'development-entry-scaffold' "$SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl"; then
  echo "create-vertical-slice left development-entry-scaffold in task-context.jsonl" >&2
  exit 1
fi
if grep -Fq 'pending-vertical-slices' "$SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl"; then
  echo "create-vertical-slice left pending-vertical-slices in task-context.jsonl" >&2
  exit 1
fi
run_json "$SLICE_SCRIPT_PROJECT" "$TMP_DIR/slice-script-entry.json" 2 entry
if jq -e '.blockers[] | select(. == "scaffold-placeholder:task-context.jsonl:development-entry-scaffold" or . == "scaffold-placeholder:task-context.jsonl:pending-vertical-slices")' "$TMP_DIR/slice-script-entry.json" >/dev/null; then
  echo "entry contract still reports task-context scaffold blockers after create-vertical-slice" >&2
  cat "$TMP_DIR/slice-script-entry.json" >&2
  exit 1
fi
assert_blocker "$TMP_DIR/slice-script-entry.json" 'scaffold-placeholder:brief.md:decision-required'

INVALID_SLICE_SCRIPT_PROJECT="$TMP_DIR/invalid-slice-script-project"
cp -R "$HAPPY_PROJECT" "$INVALID_SLICE_SCRIPT_PROJECT"
set +e
PROJECT_DIR="$INVALID_SLICE_SCRIPT_PROJECT" node "$DEV/skills/specnav-vertical-slices/scripts/create-vertical-slice.js" --task-id=dashboard-detail --json >"$TMP_DIR/invalid-slice-script.json"
INVALID_SLICE_STATUS=$?
set -e
if [[ "$INVALID_SLICE_STATUS" != "2" ]]; then
  echo "expected invalid task id status 2, got $INVALID_SLICE_STATUS" >&2
  cat "$TMP_DIR/invalid-slice-script.json" >&2
  exit 1
fi
assert_blocker "$TMP_DIR/invalid-slice-script.json" 'invalid-task-id'
if [[ -e "$INVALID_SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/tasks/dashboard-detail" ]]; then
  echo "invalid task id created a partial task packet" >&2
  exit 1
fi
if grep -Fq '"task_id":"dashboard-detail"' "$INVALID_SLICE_SCRIPT_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl"; then
  echo "invalid task id left task-context evidence" >&2
  exit 1
fi

ENTRY_ONLY_PROJECT="$TMP_DIR/entry-only-project"
cp -R "$HAPPY_PROJECT" "$ENTRY_ONLY_PROJECT"
rm \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/quality-review.md" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/task-ledger.jsonl" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/drift-check.jsonl" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" \
  "$ENTRY_ONLY_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md"
run_json "$ENTRY_ONLY_PROJECT" "$TMP_DIR/entry-only-entry.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/entry-only-entry.json" >/dev/null
run_json "$ENTRY_ONLY_PROJECT" "$TMP_DIR/entry-only-default.json" 2
jq -e '.ok == false and .mode == "handoff"' "$TMP_DIR/entry-only-default.json" >/dev/null
assert_blocker "$TMP_DIR/entry-only-default.json" 'missing-task-artifact:report.md'
assert_blocker "$TMP_DIR/entry-only-default.json" 'missing-development-artifact:validation-log.jsonl'
run_json "$ENTRY_ONLY_PROJECT" "$TMP_DIR/entry-only-handoff.json" 2 handoff
assert_blocker "$TMP_DIR/entry-only-handoff.json" 'missing-task-artifact:spec-review.md'
assert_blocker "$TMP_DIR/entry-only-handoff.json" 'missing-development-artifact:handoff-to-verify.md'

TASK_CONTEXT_SCAFFOLD_PROJECT="$TMP_DIR/task-context-scaffold-project"
cp -R "$HAPPY_PROJECT" "$TASK_CONTEXT_SCAFFOLD_PROJECT"
cat >"$TASK_CONTEXT_SCAFFOLD_PROJECT/openspec/changes/add-dashboard/development/task-context.jsonl" <<'JSONL'
{"status":"pending-vertical-slices","source":"development-entry-scaffold","note":"No task is planned until specnav-vertical-slices creates task packets."}
JSONL
run_json "$TASK_CONTEXT_SCAFFOLD_PROJECT" "$TMP_DIR/task-context-scaffold.json" 2 entry
assert_blocker "$TMP_DIR/task-context-scaffold.json" 'scaffold-placeholder:task-context.jsonl:development-entry-scaffold'
assert_blocker "$TMP_DIR/task-context-scaffold.json" 'scaffold-placeholder:task-context.jsonl:pending-vertical-slices'

REPORT_SCAFFOLD_PROJECT="$TMP_DIR/report-scaffold-project"
cp -R "$HAPPY_PROJECT" "$REPORT_SCAFFOLD_PROJECT"
cat >"$REPORT_SCAFFOLD_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md" <<'MD'
# Task Report: 001-dashboard-summary

## Status

DONE_WITH_CONCERNS

## Files Changed

- `<decision-required>`

## What Changed

- `<decision-required>`

## TDD Evidence

- `<decision-required>`

## Verification Commands

- `<decision-required>`

## Concerns

- Replace this scaffold before handoff.

## Scope Deviations

- None recorded.

## Follow-up Needed

- Replace this scaffold before handoff.

## Adjudication

Controller must adjudicate scaffold concerns before verification handoff.
MD
run_json "$REPORT_SCAFFOLD_PROJECT" "$TMP_DIR/report-scaffold.json" 2
assert_blocker "$TMP_DIR/report-scaffold.json" 'scaffold-placeholder:report.md:decision-required'
assert_blocker "$TMP_DIR/report-scaffold.json" 'scaffold-placeholder:report.md:replace-scaffold'

VALIDATION_SCAFFOLD_PROJECT="$TMP_DIR/validation-scaffold-project"
cp -R "$HAPPY_PROJECT" "$VALIDATION_SCAFFOLD_PROJECT"
cat >"$VALIDATION_SCAFFOLD_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"task_id":"001-dashboard-summary","status":"blocked","command":"<decision-required>","reason":"Replace scaffold with actual validation before handoff."}
JSONL
run_json "$VALIDATION_SCAFFOLD_PROJECT" "$TMP_DIR/validation-scaffold.json" 2
assert_blocker "$TMP_DIR/validation-scaffold.json" 'scaffold-placeholder:validation-log.jsonl:decision-required'
assert_blocker "$TMP_DIR/validation-scaffold.json" 'scaffold-placeholder:validation-log.jsonl:replace-scaffold'
assert_blocker "$TMP_DIR/validation-scaffold.json" 'validation-log:no-pass'

ENTRY_REVIEW_FIX_PROJECT="$TMP_DIR/entry-review-fix-project"
cp -R "$HAPPY_PROJECT" "$ENTRY_REVIEW_FIX_PROJECT"
cat >"$ENTRY_REVIEW_FIX_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md" <<'MD'
# Spec Review

## Verdict

needs-fix

## Missing Requirements

One required browser state still needs a fix.

## Extra Behavior

No extra behavior was introduced.

## Misunderstood Requirements

No misunderstood requirements were found.

## Cannot Verify From Diff

Browser state coverage remains for verification.

## Required Fixes

Add the missing browser state coverage.
MD
run_json "$ENTRY_REVIEW_FIX_PROJECT" "$TMP_DIR/entry-review-fix-entry.json" 0 entry
run_json "$ENTRY_REVIEW_FIX_PROJECT" "$TMP_DIR/entry-review-fix-handoff.json" 2 handoff
assert_blocker "$TMP_DIR/entry-review-fix-handoff.json" 'invalid-spec-review:verdict'

MISSING_BEFORE_DEV_PROJECT="$TMP_DIR/missing-before-dev-project"
cp -R "$HAPPY_PROJECT" "$MISSING_BEFORE_DEV_PROJECT"
rm "$MISSING_BEFORE_DEV_PROJECT/openspec/changes/add-dashboard/development/before-dev-check.json"
run_json "$MISSING_BEFORE_DEV_PROJECT" "$TMP_DIR/missing-before-dev.json" 2 entry
assert_blocker "$TMP_DIR/missing-before-dev.json" 'missing-development-artifact:before-dev-check.json'

BAD_BEFORE_DEV_PROJECT="$TMP_DIR/bad-before-dev-project"
cp -R "$HAPPY_PROJECT" "$BAD_BEFORE_DEV_PROJECT"
jq '.status = "blocked" | .ok = false' \
  "$BAD_BEFORE_DEV_PROJECT/openspec/changes/add-dashboard/development/before-dev-check.json" \
  >"$TMP_DIR/bad-before-dev.json.tmp"
mv "$TMP_DIR/bad-before-dev.json.tmp" "$BAD_BEFORE_DEV_PROJECT/openspec/changes/add-dashboard/development/before-dev-check.json"
run_json "$BAD_BEFORE_DEV_PROJECT" "$TMP_DIR/bad-before-dev.json" 2 entry
assert_blocker "$TMP_DIR/bad-before-dev.json" 'invalid-before-dev-check:status'

BASIS_FOUNDATION_PROJECT="$TMP_DIR/basis-foundation-project"
cp -R "$HAPPY_PROJECT" "$BASIS_FOUNDATION_PROJECT"
cat >"$BASIS_FOUNDATION_PROJECT/openspec/changes/add-dashboard/development/basis.md" <<'MD'
# Development Basis

Development is based on the approved requirements, acceptance criteria, prototype decision, and prototype handoff for add-dashboard.

- openspec/changes/add-dashboard/requirements.md
- openspec/changes/add-dashboard/acceptance.md
- openspec/changes/add-dashboard/spec-map.json
- openspec/changes/add-dashboard/component-impact-map.json
- openspec/changes/add-dashboard/prototype/handoff.md
- openspec/changes/add-dashboard/prototype/decision.json
- openspec/changes/add-dashboard/prototype/artifact/index.html
MD
run_json "$BASIS_FOUNDATION_PROJECT" "$TMP_DIR/basis-foundation.json" 2 entry
assert_blocker "$TMP_DIR/basis-foundation.json" 'invalid-basis:missing-reference:openspec/specs/ui-design/design.md'

TASK_CONTEXT_SOURCE_PROJECT="$TMP_DIR/task-context-source-project"
cp -R "$HAPPY_PROJECT" "$TASK_CONTEXT_SOURCE_PROJECT"
jq '.must_read = [
  "openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/brief.md",
  "openspec/changes/add-dashboard/requirements.md",
  "openspec/changes/add-dashboard/acceptance.md",
  "openspec/changes/add-dashboard/spec-map.json",
  "openspec/changes/add-dashboard/component-impact-map.json",
  "openspec/changes/add-dashboard/prototype/handoff.md"
]' \
  "$TASK_CONTEXT_SOURCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/context.json" \
  >"$TMP_DIR/task-context-source.json.tmp"
mv "$TMP_DIR/task-context-source.json.tmp" "$TASK_CONTEXT_SOURCE_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/context.json"
run_json "$TASK_CONTEXT_SOURCE_PROJECT" "$TMP_DIR/task-context-source.json" 2 entry
assert_blocker "$TMP_DIR/task-context-source.json" 'invalid-task-context:must_read-missing:openspec/specs/ui-design/design.md'
assert_blocker "$TMP_DIR/task-context-source.json" 'invalid-task-context:must_read-missing:openspec/changes/add-dashboard/prototype/decision.json'
assert_blocker "$TMP_DIR/task-context-source.json" 'invalid-task-context:must_read-missing:openspec/changes/add-dashboard/prototype/artifact/index.html'

TASK_CONTEXT_BRIEF_PROJECT="$TMP_DIR/task-context-brief-project"
cp -R "$HAPPY_PROJECT" "$TASK_CONTEXT_BRIEF_PROJECT"
jq 'del(.must_read[] | select(. == "openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/brief.md"))' \
  "$TASK_CONTEXT_BRIEF_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/context.json" \
  >"$TMP_DIR/task-context-brief.json.tmp"
mv "$TMP_DIR/task-context-brief.json.tmp" "$TASK_CONTEXT_BRIEF_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/context.json"
run_json "$TASK_CONTEXT_BRIEF_PROJECT" "$TMP_DIR/task-context-brief.json" 2 entry
assert_blocker "$TMP_DIR/task-context-brief.json" 'invalid-task-context:must_read-missing:openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/brief.md'

SCOPE_UNAPPROVED_SOURCE_PROJECT="$TMP_DIR/scope-unapproved-source-project"
cp -R "$HAPPY_PROJECT" "$SCOPE_UNAPPROVED_SOURCE_PROJECT"
jq '.prototype_sources = [
  "openspec/changes/add-dashboard/prototype/artifact/index.html",
  "openspec/changes/add-dashboard/prototype/handoff.md"
]' \
  "$SCOPE_UNAPPROVED_SOURCE_PROJECT/openspec/changes/add-dashboard/scope.json" \
  >"$TMP_DIR/scope-unapproved-source.json.tmp"
mv "$TMP_DIR/scope-unapproved-source.json.tmp" "$SCOPE_UNAPPROVED_SOURCE_PROJECT/openspec/changes/add-dashboard/scope.json"
run_json "$SCOPE_UNAPPROVED_SOURCE_PROJECT" "$TMP_DIR/scope-unapproved-source.json" 2 entry
assert_blocker "$TMP_DIR/scope-unapproved-source.json" 'unapproved-prototype-source:openspec/changes/add-dashboard/prototype/handoff.md'

SPEC_REVIEW_MINIMAL_PROJECT="$TMP_DIR/spec-review-minimal-project"
cp -R "$HAPPY_PROJECT" "$SPEC_REVIEW_MINIMAL_PROJECT"
cat >"$SPEC_REVIEW_MINIMAL_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md" <<'MD'
# Spec Review

## Verdict

approved
MD
run_json "$SPEC_REVIEW_MINIMAL_PROJECT" "$TMP_DIR/spec-review-minimal.json" 2
assert_blocker "$TMP_DIR/spec-review-minimal.json" 'invalid-spec-review:missing-heading:Missing Requirements'

QUALITY_REVIEW_MINIMAL_PROJECT="$TMP_DIR/quality-review-minimal-project"
cp -R "$HAPPY_PROJECT" "$QUALITY_REVIEW_MINIMAL_PROJECT"
cat >"$QUALITY_REVIEW_MINIMAL_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/quality-review.md" <<'MD'
# Quality Review

## Verdict

approved
MD
run_json "$QUALITY_REVIEW_MINIMAL_PROJECT" "$TMP_DIR/quality-review-minimal.json" 2
assert_blocker "$TMP_DIR/quality-review-minimal.json" 'invalid-quality-review:missing-heading:Separation Of Concerns'

REPORT_MINIMAL_PROJECT="$TMP_DIR/report-minimal-project"
cp -R "$HAPPY_PROJECT" "$REPORT_MINIMAL_PROJECT"
cat >"$REPORT_MINIMAL_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md" <<'MD'
# Implementation Report

## Status

DONE

## TDD Evidence

- RED and GREEN evidence recorded.

## Verification Commands

- npm test dashboard-summary.test.tsx
MD
run_json "$REPORT_MINIMAL_PROJECT" "$TMP_DIR/report-minimal.json" 2
assert_blocker "$TMP_DIR/report-minimal.json" 'invalid-task-report:missing-heading:Files Changed'

REPORT_CONCERNS_PROJECT="$TMP_DIR/report-concerns-project"
cp -R "$HAPPY_PROJECT" "$REPORT_CONCERNS_PROJECT"
cat >"$REPORT_CONCERNS_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md" <<'MD'
# Implementation Report

## Status

DONE_WITH_CONCERNS

## Files Changed

- src/dashboard/DashboardView.tsx
- tests/dashboard/dashboard-summary.test.tsx

## What Changed

Implemented the summary view and connected the state hook to the service seam.

## TDD Evidence

- RED and GREEN evidence recorded.

## Verification Commands

- npm test dashboard-summary.test.tsx

## Concerns

Backend naming still needs controller review.

## Scope Deviations

No scope deviations were made.

## Follow-up Needed

Verification should exercise the states in the browser.
MD
run_json "$REPORT_CONCERNS_PROJECT" "$TMP_DIR/report-concerns.json" 2
assert_blocker "$TMP_DIR/report-concerns.json" 'invalid-task-report:concerns-adjudication'

PROTOTYPE_BLOCKED_PROJECT="$TMP_DIR/prototype-blocked-project"
cp -R "$HAPPY_PROJECT" "$PROTOTYPE_BLOCKED_PROJECT"
jq 'del(.approved_variant)' \
  "$PROTOTYPE_BLOCKED_PROJECT/openspec/changes/add-dashboard/prototype/decision.json" \
  >"$TMP_DIR/prototype-blocked-decision.json"
mv "$TMP_DIR/prototype-blocked-decision.json" "$PROTOTYPE_BLOCKED_PROJECT/openspec/changes/add-dashboard/prototype/decision.json"
run_json "$PROTOTYPE_BLOCKED_PROJECT" "$TMP_DIR/prototype-blocked.json" 2
assert_blocker "$TMP_DIR/prototype-blocked.json" 'prototype-blocked'
assert_blocker "$TMP_DIR/prototype-blocked.json" 'prototype:invalid-prototype-decision:approved_variant'

SCOPE_PATH_PROJECT="$TMP_DIR/scope-path-project"
cp -R "$HAPPY_PROJECT" "$SCOPE_PATH_PROJECT"
jq '.allowed_roots = ["/tmp/escape"]' \
  "$SCOPE_PATH_PROJECT/openspec/changes/add-dashboard/scope.json" \
  >"$TMP_DIR/scope-path.json.tmp"
mv "$TMP_DIR/scope-path.json.tmp" "$SCOPE_PATH_PROJECT/openspec/changes/add-dashboard/scope.json"
run_json "$SCOPE_PATH_PROJECT" "$TMP_DIR/scope-path.json" 2
assert_blocker "$TMP_DIR/scope-path.json" 'invalid-scope-path:allowed_roots'

SCOPE_CHANGE_PROJECT="$TMP_DIR/scope-change-project"
cp -R "$HAPPY_PROJECT" "$SCOPE_CHANGE_PROJECT"
jq '.change_id = "other-change"' \
  "$SCOPE_CHANGE_PROJECT/openspec/changes/add-dashboard/scope.json" \
  >"$TMP_DIR/scope-change.json.tmp"
mv "$TMP_DIR/scope-change.json.tmp" "$SCOPE_CHANGE_PROJECT/openspec/changes/add-dashboard/scope.json"
run_json "$SCOPE_CHANGE_PROJECT" "$TMP_DIR/scope-change.json" 2
assert_blocker "$TMP_DIR/scope-change.json" 'invalid-scope-contract:change_id'

LAYER_TASK_PROJECT="$TMP_DIR/layer-task-project"
cp -R "$HAPPY_PROJECT" "$LAYER_TASK_PROJECT"
cat >"$LAYER_TASK_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- [x] build api
MD
run_json "$LAYER_TASK_PROJECT" "$TMP_DIR/layer-task.json" 2
assert_blocker "$TMP_DIR/layer-task.json" 'tasks-md:layer-only:build api'
assert_blocker "$TMP_DIR/layer-task.json" 'tasks-md:no-vertical-slice'

NO_CHECKBOX_TASK_PROJECT="$TMP_DIR/no-checkbox-task-project"
cp -R "$HAPPY_PROJECT" "$NO_CHECKBOX_TASK_PROJECT"
cat >"$NO_CHECKBOX_TASK_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- user can view dashboard summary with loading empty and error states
MD
run_json "$NO_CHECKBOX_TASK_PROJECT" "$TMP_DIR/no-checkbox-task.json" 2
assert_blocker "$TMP_DIR/no-checkbox-task.json" 'tasks-md:no-checkboxes'

INCOMPLETE_TASK_PROJECT="$TMP_DIR/incomplete-task-project"
cp -R "$HAPPY_PROJECT" "$INCOMPLETE_TASK_PROJECT"
cat >"$INCOMPLETE_TASK_PROJECT/openspec/changes/add-dashboard/tasks.md" <<'MD'
# Development Tasks

- [ ] user can view dashboard summary with loading empty and error states
MD
run_json "$INCOMPLETE_TASK_PROJECT" "$TMP_DIR/incomplete-task-entry.json" 0 entry
jq -e '.ok == true and .mode == "entry"' "$TMP_DIR/incomplete-task-entry.json" >/dev/null
run_json "$INCOMPLETE_TASK_PROJECT" "$TMP_DIR/incomplete-task.json" 2
assert_blocker "$TMP_DIR/incomplete-task.json" 'tasks-md:incomplete-checkboxes'
assert_blocker "$TMP_DIR/incomplete-task.json" 'tasks-md:no-completed-checkboxes'

MISSING_PROMOTION_PROJECT="$TMP_DIR/missing-promotion-project"
cp -R "$HAPPY_PROJECT" "$MISSING_PROMOTION_PROJECT"
rm "$MISSING_PROMOTION_PROJECT/openspec/changes/add-dashboard/development/prototype-promotion-map.json"
run_json "$MISSING_PROMOTION_PROJECT" "$TMP_DIR/missing-promotion.json" 2
assert_blocker "$TMP_DIR/missing-promotion.json" 'missing-development-artifact:prototype-promotion-map.json'

INVALID_PROMOTION_PROJECT="$TMP_DIR/invalid-promotion-project"
cp -R "$HAPPY_PROJECT" "$INVALID_PROMOTION_PROJECT"
jq '.allowed_to_copy = [" padded"]' \
  "$INVALID_PROMOTION_PROJECT/openspec/changes/add-dashboard/development/prototype-promotion-map.json" \
  >"$TMP_DIR/invalid-promotion.json.tmp"
mv "$TMP_DIR/invalid-promotion.json.tmp" "$INVALID_PROMOTION_PROJECT/openspec/changes/add-dashboard/development/prototype-promotion-map.json"
run_json "$INVALID_PROMOTION_PROJECT" "$TMP_DIR/invalid-promotion.json" 2
assert_blocker "$TMP_DIR/invalid-promotion.json" 'invalid-promotion-map:allowed_to_copy'

BAD_BRIEF_PROJECT="$TMP_DIR/bad-brief-project"
cp -R "$HAPPY_PROJECT" "$BAD_BRIEF_PROJECT"
cat >"$BAD_BRIEF_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/brief.md" <<'MD'
# Task 001: Dashboard Summary Slice

## Goal

Implement the dashboard summary slice.
MD
run_json "$BAD_BRIEF_PROJECT" "$TMP_DIR/bad-brief.json" 2
assert_blocker "$TMP_DIR/bad-brief.json" 'invalid-task-brief:missing-heading:Vertical Slice'

ARTIFACT_MIGRATION_PROJECT="$TMP_DIR/artifact-migration-project"
cp -R "$HAPPY_PROJECT" "$ARTIFACT_MIGRATION_PROJECT"
cat >>"$ARTIFACT_MIGRATION_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/report.md" <<'MD'

## Artifact Migration Note

- Distinguish legacy V1 artifact migration from database migration and migrate
  the verification artifacts without changing application storage.
- Keep the migration file surface separate from business database changes.
MD
cat >>"$ARTIFACT_MIGRATION_PROJECT/openspec/changes/add-dashboard/development/task-ledger.jsonl" <<'JSONL'
{"task_id":"001-dashboard-summary","status":"policy_note","result":"Explicit database migration files still require a ready manifest; this artifact-only task does not create them."}
JSONL
run_json "$ARTIFACT_MIGRATION_PROJECT" "$TMP_DIR/artifact-migration.json" 0
jq -e '.ok == true' "$TMP_DIR/artifact-migration.json" >/dev/null

DATABASE_MIGRATION_FILES_FAIL_PROJECT="$TMP_DIR/database-migration-files-fail-project"
cp -R "$HAPPY_PROJECT" "$DATABASE_MIGRATION_FILES_FAIL_PROJECT"
cat >>"$DATABASE_MIGRATION_FILES_FAIL_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md" <<'MD'

## Storage Change

- Database migration files are required for the dashboard review timestamp.
MD
run_json "$DATABASE_MIGRATION_FILES_FAIL_PROJECT" "$TMP_DIR/database-migration-files-fail.json" 2
assert_blocker "$TMP_DIR/database-migration-files-fail.json" 'migration-manifest-sql-mentioned-but-not-required'

DATABASE_MIGRATION_FAIL_PROJECT="$TMP_DIR/database-migration-fail-project"
cp -R "$HAPPY_PROJECT" "$DATABASE_MIGRATION_FAIL_PROJECT"
cat >>"$DATABASE_MIGRATION_FAIL_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md" <<'MD'

## Storage Change

- Create a database migration for the dashboard review timestamp.
MD
run_json "$DATABASE_MIGRATION_FAIL_PROJECT" "$TMP_DIR/database-migration-fail.json" 2
assert_blocker "$TMP_DIR/database-migration-fail.json" 'migration-manifest-sql-mentioned-but-not-required'

SQL_MIGRATION_FAIL_PROJECT="$TMP_DIR/sql-migration-fail-project"
cp -R "$HAPPY_PROJECT" "$SQL_MIGRATION_FAIL_PROJECT"
cat >>"$SQL_MIGRATION_FAIL_PROJECT/openspec/changes/add-dashboard/development/handoff-to-verify.md" <<'MD'

## Database Changes

ALTER TABLE dashboard_summary ADD COLUMN reviewed_at TIMESTAMP NULL.
MD
run_json "$SQL_MIGRATION_FAIL_PROJECT" "$TMP_DIR/sql-migration-fail.json" 2
assert_blocker "$TMP_DIR/sql-migration-fail.json" 'migration-manifest-sql-mentioned-but-not-required'

SQL_MIGRATION_OK_PROJECT="$TMP_DIR/sql-migration-ok-project"
cp -R "$SQL_MIGRATION_FAIL_PROJECT" "$SQL_MIGRATION_OK_PROJECT"
cat >"$SQL_MIGRATION_OK_PROJECT/openspec/changes/add-dashboard/development/migrations/manifest.json" <<'JSON'
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
    "evidence": ["psql schema query confirms reviewed_at exists"]
  },
  "rollback": [{
    "id": "001-schema-rollback",
    "path": "development/migrations/001-schema-rollback.sql"
  }],
  "rollback_strategy": "Run rollback SQL before reverting application code."
}
JSON
cat >"$SQL_MIGRATION_OK_PROJECT/openspec/changes/add-dashboard/development/migrations/README.md" <<'MD'
# Migration Notes

## Execution Order

Run `001-schema.sql` before deploying application code that reads `reviewed_at`.

## Validation

Run a schema query to confirm `dashboard_summary.reviewed_at` exists.

## Rollback

Run `001-schema-rollback.sql`, then revert application code.
MD
cat >"$SQL_MIGRATION_OK_PROJECT/openspec/changes/add-dashboard/development/migrations/001-schema.sql" <<'SQL'
ALTER TABLE dashboard_summary ADD COLUMN reviewed_at TIMESTAMP NULL;
SQL
cat >"$SQL_MIGRATION_OK_PROJECT/openspec/changes/add-dashboard/development/migrations/001-schema-rollback.sql" <<'SQL'
ALTER TABLE dashboard_summary DROP COLUMN reviewed_at;
SQL
run_json "$SQL_MIGRATION_OK_PROJECT" "$TMP_DIR/sql-migration-ok.json" 0
jq -e '.ok == true' "$TMP_DIR/sql-migration-ok.json" >/dev/null

SUBSTANTIVE_GAP_PROJECT="$TMP_DIR/substantive-gap-project"
cp -R "$HAPPY_PROJECT" "$SUBSTANTIVE_GAP_PROJECT"
cat >"$SUBSTANTIVE_GAP_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md" <<'MD'
# Spec Review

## Verdict

approved

## Missing Requirements

No requirement gap remains after the reviewed implementation and tests.

## Extra Behavior

No extra behavior was introduced.

## Misunderstood Requirements

No misunderstood requirements were found.

## Cannot Verify From Diff

Browser state coverage remains for verification.

## Required Fixes

No required fixes remain.

## Acceptance Assertions Verified

- `TASK-01`: task-level implementation and focused validation evidence were reviewed.
MD
run_json "$SUBSTANTIVE_GAP_PROJECT" "$TMP_DIR/substantive-gap.json" 0
jq -e '.ok == true' "$TMP_DIR/substantive-gap.json" >/dev/null

PLACEHOLDER_GAP_PROJECT="$TMP_DIR/placeholder-gap-project"
cp -R "$HAPPY_PROJECT" "$PLACEHOLDER_GAP_PROJECT"
perl -0pi -e 's/No missing requirements were found\./Gap: controller decision required./' \
  "$PLACEHOLDER_GAP_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md"
run_json "$PLACEHOLDER_GAP_PROJECT" "$TMP_DIR/placeholder-gap.json" 2
assert_blocker "$TMP_DIR/placeholder-gap.json" 'invalid-spec-review:empty-heading:Missing Requirements'

SPEC_REVIEW_PROJECT="$TMP_DIR/spec-review-project"
cp -R "$HAPPY_PROJECT" "$SPEC_REVIEW_PROJECT"
cat >"$SPEC_REVIEW_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/spec-review.md" <<'MD'
# Spec Review

## Verdict

needs-fix
MD
run_json "$SPEC_REVIEW_PROJECT" "$TMP_DIR/spec-review.json" 2
assert_blocker "$TMP_DIR/spec-review.json" 'invalid-spec-review:verdict'

QUALITY_REVIEW_PROJECT="$TMP_DIR/quality-review-project"
cp -R "$HAPPY_PROJECT" "$QUALITY_REVIEW_PROJECT"
cat >"$QUALITY_REVIEW_PROJECT/openspec/changes/add-dashboard/development/tasks/001-dashboard-summary/quality-review.md" <<'MD'
# Quality Review

## Verdict

blocked
MD
run_json "$QUALITY_REVIEW_PROJECT" "$TMP_DIR/quality-review.json" 2
assert_blocker "$TMP_DIR/quality-review.json" 'invalid-quality-review:verdict'

DRIFT_PROJECT="$TMP_DIR/drift-project"
cp -R "$HAPPY_PROJECT" "$DRIFT_PROJECT"
cat >"$DRIFT_PROJECT/openspec/changes/add-dashboard/development/drift-check.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","blocking":true,"drift":"scope changed without approval"}
JSONL
run_json "$DRIFT_PROJECT" "$TMP_DIR/drift.json" 2
assert_blocker "$TMP_DIR/drift.json" 'blocking-drift:001-dashboard-summary'

INVALID_JSONL_PROJECT="$TMP_DIR/invalid-jsonl-project"
cp -R "$HAPPY_PROJECT" "$INVALID_JSONL_PROJECT"
cat >"$INVALID_JSONL_PROJECT/openspec/changes/add-dashboard/development/task-ledger.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","status":"started"
JSONL
run_json "$INVALID_JSONL_PROJECT" "$TMP_DIR/invalid-jsonl.json" 2
assert_blocker "$TMP_DIR/invalid-jsonl.json" 'invalid-jsonl:task-ledger.jsonl:1'

VALIDATION_FAIL_PROJECT="$TMP_DIR/validation-fail-project"
cp -R "$HAPPY_PROJECT" "$VALIDATION_FAIL_PROJECT"
cat >"$VALIDATION_FAIL_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx","status":"fail","ok":false}
JSONL
run_json "$VALIDATION_FAIL_PROJECT" "$TMP_DIR/validation-fail.json" 2
assert_blocker "$TMP_DIR/validation-fail.json" 'validation-log:no-pass'

EXECUTED_FAILURE_PROJECT="$TMP_DIR/executed-failure-project"
cp -R "$HAPPY_PROJECT" "$EXECUTED_FAILURE_PROJECT"
cat >>"$EXECUTED_FAILURE_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # unresolved-red","status":"fail","ok":false,"exit_status":1,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:01:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":false}
JSONL
run_json "$EXECUTED_FAILURE_PROJECT" "$TMP_DIR/executed-failure.json" 2
assert_blocker "$TMP_DIR/executed-failure.json" 'validation-log:executed-evidence-failed:001-dashboard-summary'

OVERTURNED_FAILURE_PROJECT="$TMP_DIR/overturned-failure-project"
cp -R "$HAPPY_PROJECT" "$OVERTURNED_FAILURE_PROJECT"
cat >>"$OVERTURNED_FAILURE_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # preserved-red","status":"fail","ok":false,"exit_status":1,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:01:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":true}
JSONL
run_json "$OVERTURNED_FAILURE_PROJECT" "$TMP_DIR/overturned-failure.json" 2
assert_blocker "$TMP_DIR/overturned-failure.json" 'validation-log:executed-evidence-failed:001-dashboard-summary'

ADJUDICATED_FAILURE_PROJECT="$TMP_DIR/adjudicated-failure-project"
cp -R "$HAPPY_PROJECT" "$ADJUDICATED_FAILURE_PROJECT"
cat >>"$ADJUDICATED_FAILURE_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # preserved-red","status":"fail","ok":false,"exit_status":1,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:01:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":false}
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # repaired-green","status":"pass","ok":true,"exit_status":0,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:02:00.000Z","evidence_log":"development/evidence/003-dashboard-summary.log","overturned":false}
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/002-dashboard-summary.log","superseding_evidence_log":"development/evidence/003-dashboard-summary.log","reason":"A later system-executed repair run and approved reviews supersede this preserved RED attempt.","recorded_at":"2026-07-03T00:03:00.000Z"}
JSONL
run_json "$ADJUDICATED_FAILURE_PROJECT" "$TMP_DIR/adjudicated-failure.json" 0

INVALID_ADJUDICATION_PROJECT="$TMP_DIR/invalid-adjudication-project"
cp -R "$HAPPY_PROJECT" "$INVALID_ADJUDICATION_PROJECT"
cat >>"$INVALID_ADJUDICATION_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/missing.log","superseding_evidence_log":"development/evidence/001-dashboard-summary.log","reason":"This target does not exist.","recorded_at":"2026-07-03T00:02:00.000Z"}
JSONL
run_json "$INVALID_ADJUDICATION_PROJECT" "$TMP_DIR/invalid-adjudication.json" 2
assert_blocker "$TMP_DIR/invalid-adjudication.json" 'validation-log:invalid-overturn-target:001-dashboard-summary'

INVALID_ADJUDICATION_SUCCESSOR_PROJECT="$TMP_DIR/invalid-adjudication-successor-project"
cp -R "$HAPPY_PROJECT" "$INVALID_ADJUDICATION_SUCCESSOR_PROJECT"
cat >>"$INVALID_ADJUDICATION_SUCCESSOR_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # preserved-red","status":"fail","ok":false,"exit_status":1,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:01:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":false}
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/002-dashboard-summary.log","superseding_evidence_log":"development/evidence/001-dashboard-summary.log","reason":"The referenced pass predates the preserved RED attempt.","recorded_at":"2026-07-03T00:02:00.000Z"}
JSONL
run_json "$INVALID_ADJUDICATION_SUCCESSOR_PROJECT" "$TMP_DIR/invalid-adjudication-successor.json" 2
assert_blocker "$TMP_DIR/invalid-adjudication-successor.json" 'validation-log:invalid-overturn-successor:001-dashboard-summary'

PASS_SUPERSESSION_PROJECT="$TMP_DIR/pass-supersession-project"
cp -R "$HAPPY_PROJECT" "$PASS_SUPERSESSION_PROJECT"
cat >>"$PASS_SUPERSESSION_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/001-dashboard-summary.log","superseding_evidence_log":null,"reason":"An independent review invalidated this otherwise green receipt before a corrected run existed.","recorded_at":"2026-07-03T00:01:00.000Z"}
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # current-green","status":"pass","ok":true,"exit_status":0,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:02:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":false}
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/001-dashboard-summary.log","superseding_evidence_log":"development/evidence/002-dashboard-summary.log","reason":"The later system-executed run repairs the earlier incomplete adjudication without rewriting append-only history.","recorded_at":"2026-07-03T00:03:00.000Z"}
JSONL
node - "$PASS_SUPERSESSION_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'NODE'
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const file = process.argv[2];
const entries = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const adjudications = entries.filter((entry) => entry.schema === 'specnav.validationAdjudication.v1');
const digest = (entry) => crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
fs.appendFileSync(file, `${JSON.stringify({
  schema: 'specnav.validationAdjudicationCorrection.v1',
  task: '001-dashboard-summary',
  status: 'corrected',
  invalid_adjudication_digest: digest(adjudications[0]),
  replacement_adjudication_digest: digest(adjudications[1]),
  reason: 'The exact invalid adjudication is retained and explicitly corrected by the exact later valid adjudication.',
  recorded_at: '2026-07-03T00:04:00.000Z'
})}\n`);
NODE
run_json "$PASS_SUPERSESSION_PROJECT" "$TMP_DIR/pass-supersession.json" 0

UNCORRECTED_ADJUDICATION_PROJECT="$TMP_DIR/uncorrected-adjudication-project"
cp -R "$HAPPY_PROJECT" "$UNCORRECTED_ADJUDICATION_PROJECT"
cat >>"$UNCORRECTED_ADJUDICATION_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/001-dashboard-summary.log","superseding_evidence_log":null,"reason":"This incomplete adjudication must remain visible even when a later valid adjudication exists.","recorded_at":"2026-07-03T00:01:00.000Z"}
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # current-green","status":"pass","ok":true,"exit_status":0,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:02:00.000Z","evidence_log":"development/evidence/002-dashboard-summary.log","overturned":false}
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/001-dashboard-summary.log","superseding_evidence_log":"development/evidence/002-dashboard-summary.log","reason":"This valid replacement must not silently hide the earlier invalid record.","recorded_at":"2026-07-03T00:03:00.000Z"}
JSONL
run_json "$UNCORRECTED_ADJUDICATION_PROJECT" "$TMP_DIR/uncorrected-adjudication.json" 2
assert_blocker "$TMP_DIR/uncorrected-adjudication.json" 'validation-log:invalid-overturn-successor:001-dashboard-summary'

UNRESOLVED_PASS_SUPERSESSION_PROJECT="$TMP_DIR/unresolved-pass-supersession-project"
cp -R "$HAPPY_PROJECT" "$UNRESOLVED_PASS_SUPERSESSION_PROJECT"
cat >>"$UNRESOLVED_PASS_SUPERSESSION_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationAdjudication.v1","task":"001-dashboard-summary","status":"overturned","target_evidence_log":"development/evidence/001-dashboard-summary.log","superseding_evidence_log":null,"reason":"A green receipt cannot be invalidated without a later system-executed replacement.","recorded_at":"2026-07-03T00:01:00.000Z"}
JSONL
run_json "$UNRESOLVED_PASS_SUPERSESSION_PROJECT" "$TMP_DIR/unresolved-pass-supersession.json" 2
assert_blocker "$TMP_DIR/unresolved-pass-supersession.json" 'validation-log:invalid-overturn-successor:001-dashboard-summary'

DUPLICATE_EVIDENCE_LOG_PROJECT="$TMP_DIR/duplicate-evidence-log-project"
cp -R "$HAPPY_PROJECT" "$DUPLICATE_EVIDENCE_LOG_PROJECT"
cat >>"$DUPLICATE_EVIDENCE_LOG_PROJECT/openspec/changes/add-dashboard/development/validation-log.jsonl" <<'JSONL'
{"schema":"specnav.validationLog.v2","task":"001-dashboard-summary","command":"npm test dashboard-summary.test.tsx # forged-red","status":"fail","ok":false,"exit_status":1,"attestation":"system-executed","recorded_by":"specnav-evidence-runner","recorded_at":"2026-07-03T00:01:00.000Z","evidence_log":"development/evidence/001-dashboard-summary.log","overturned":false}
JSONL
run_json "$DUPLICATE_EVIDENCE_LOG_PROJECT" "$TMP_DIR/duplicate-evidence-log.json" 2
assert_blocker "$TMP_DIR/duplicate-evidence-log.json" 'validation-log:duplicate-evidence-log:001-dashboard-summary'

echo "specnav development plugin fixtures ok"
