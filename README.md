# SpecNav Codex Plugin Suite

SpecNav for Codex is a six-plugin OpenSpec lifecycle suite. Add this repository
as a Codex marketplace, install all six plugins, trust the `specnav-core` hooks
with `/hooks`, then start from `$specnav-workflow` in the target project.

SpecNav governs the full engineering lifecycle:

```text
bootstrap -> spec discovery -> requirements -> prototype -> development -> verification -> operations
```

Codex proposes and edits work. SpecNav keeps the process file-backed through
OpenSpec artifacts, deterministic scripts, lifecycle hooks, and no-fallback
stage gates.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Install Locally

From this repository root:

```bash
codex plugin marketplace add "$PWD"
codex plugin add specnav-core@specnav-marketplace
codex plugin add specnav-requirements@specnav-marketplace
codex plugin add specnav-prototype@specnav-marketplace
codex plugin add specnav-development@specnav-marketplace
codex plugin add specnav-verification@specnav-marketplace
codex plugin add specnav-operations@specnav-marketplace
```

Review and trust plugin hooks:

```text
/hooks
```

Start a new Codex thread after installing or updating plugins, skills, hooks, or
scripts.

## First Run

Use SpecNav from the target project, not from this plugin repository.

```text
1. Run $specnav-doctor
   Confirms all six plugins, hooks, skills, OpenSpec CLI, and installed cache
   are visible.

2. Run $specnav-workflow
   Reads the current affordance table and reports the next legal action.

3. If the project has no OpenSpec state, run $specnav-bootstrap
   This creates openspec/, openspec/.specnav/workflow-state.json, context
   manifests, and the project .specnav.json marker.

4. Run $specnav-status
   Confirms active change, ready actions, blockers, risk tier, and stale
   verification state.

5. Run $specnav-requirements
   If foundation specs are missing, SpecNav routes to repository discovery and
   foundation-spec repair before feature requirements can start.
```

## Workflow Model

| Stage | Skill | Writes | Common blockers | Next |
| --- | --- | --- | --- | --- |
| Bootstrap | `$specnav-bootstrap` | `openspec/`, `.specnav/`, `.specnav.json` | `missing-openspec-cli`, init failure | `$specnav-status` |
| Spec discovery | `$specnav-repository-discovery` | `openspec/.specnav/context/repository-discovery.json` | missing evidence, unresolved questions | `$specnav-foundation-specs` |
| Requirements | `$specnav-requirements` | `requirements.md`, `acceptance.md`, `spec-map.json`, `component-impact-map.json` | missing/invalid foundation specs | `$specnav-prototype` |
| Prototype | `$specnav-prototype` | `prototype/` artifacts, verifier report, handoff | missing context, verifier red, no approval | `$specnav-development-entry` |
| Development | `$specnav-vertical-slices` | `scope.json`, task artifacts, production edits | invalid scope, upstream drift, review failure | `$specnav-verify-plan` |
| Verification | `$specnav-verify-plan` plus six domain skills | six-domain `verify/` evidence, aggregate report, stakeholder HTML report | stale report, red domain, missing evidence | `$specnav-release-plan` |
| Operations | `$specnav-ops-readiness` | `operations/` readiness and release artifacts | verify not green, target ambiguous | archive/writeback |

## Plugin Layout

```text
.agents/plugins/marketplace.json          Local Codex marketplace
plugins/specnav-core/                     Runtime, router, hooks, status, doctor
plugins/specnav-requirements/             Foundation specs and requirements
plugins/specnav-prototype/                Runnable prototype artifacts and handoff
plugins/specnav-development/              Scope lock and vertical-slice implementation
plugins/specnav-verification/             Six-domain verification
plugins/specnav-operations/               Release, deploy, rollback, archive readiness
```

## Public Skills

- Core: `specnav-workflow`, `specnav-bootstrap`, `specnav-route`,
  `specnav-status`, `specnav-doctor`, `specnav-debug`, `specnav-recovery`
- Requirements: `specnav-repository-discovery`, `specnav-foundation-specs`,
  `specnav-requirements`
- Prototype: `specnav-prototype`, `specnav-prototype-verify`,
  `specnav-prototype-handoff`
- Development: `specnav-development-entry`, `specnav-scope-lock`,
  `specnav-vertical-slices`, `specnav-fix`, `specnav-debug`,
  `specnav-break-loop`
- Verification: `specnav-verify-plan`, `specnav-verify-facticity`,
  `specnav-verify-static`, `specnav-verify-unit`, `specnav-verify-redteam`,
  `specnav-verify-e2e`, `specnav-verify-sensory`, `specnav-verify-rerun`
- Operations: `specnav-ops-readiness`, `specnav-release-plan`,
  `specnav-install-verify`, `specnav-update-policy`,
  `specnav-compatibility-matrix`, `specnav-branch-finish`, `specnav-deploy`,
  `specnav-rollback`, `specnav-monitor`, `specnav-postmortem`,
  `specnav-update-spec`

## No Fallback

If a required dependency, plugin, OpenSpec command, artifact, state file,
context manifest, or verification tool is missing or fails, SpecNav reports the
exact blocker and blocks the dependent action.

Allowed while blocked:

- doctor/status;
- bootstrap;
- OpenSpec artifact repair;
- read-only discovery;
- docs-only edits that do not touch production code.

## Useful Checks

```bash
bash tests/run-codex-marketplace-fixtures.sh
bash tests/run-codex-plugin-fixtures.sh
bash tests/run-codex-skill-fixtures.sh
bash tests/run-codex-hook-fixtures.sh
bash tests/run-plugin-suite-resolver-fixtures.sh
bash tests/run-smoke.sh
```

Full suite:

```bash
for test_script in tests/run-*.sh; do
  bash "$test_script"
done
```

## Design Notes

- System design: [docs/design.md](docs/design.md)
- Codex plugin manifests: `plugins/*/.codex-plugin/plugin.json`
- Codex marketplace: [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json)
