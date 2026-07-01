# SpecNav Codex Plugin System Design

Version: 0.1.6

This repository is the Codex-native edition of SpecNav. It keeps the lifecycle
logic of the existing SpecNav plugin suite, but it does not reuse the old plugin
surface. Codex is the primary runtime, so the system is designed around Codex
plugin manifests, Codex marketplace layout, Codex skills, and Codex plugin
hooks.

## 1. Design Goal

SpecNav for Codex turns AI coding from an open-ended chat into a governed
software delivery flow:

1. Discover or initialize OpenSpec.
2. Establish project-level foundation specs before discussing feature work.
3. Ask requirements only after required specs are present.
4. Produce runnable prototype artifacts before development.
5. Implement through scoped vertical slices.
6. Verify with six explicit testing domains.
7. Prepare operations, release, rollback, and archive evidence.

The Codex edition must be installable as one marketplace that exposes multiple
plugins. The split is intentional: each stage can be installed, updated, tested,
and reasoned about independently, while `specnav-core` provides shared routing,
state, hooks, and cross-plugin discovery.

## 2. Official Codex Surface

The implementation follows the Codex plugin surface documented by OpenAI:

- plugin manifest: `.codex-plugin/plugin.json`
- marketplace manifest: `.agents/plugins/marketplace.json`
- plugin-bundled hooks: `hooks/hooks.json`
- hook runtime root: `PLUGIN_ROOT`
- hooks are inactive until the user trusts them

No runtime script may depend on legacy plugin directories or compatibility
environment variables. If a required manifest, skill, hook, OpenSpec directory,
or stage artifact is missing, SpecNav must report the blocker directly. There is
no fallback path.

## 3. Repository Layout

```text
specnav-codex-plugin/
  .agents/plugins/marketplace.json
  plugins/
    specnav-core/
      .codex-plugin/plugin.json
      hooks/hooks.json
      skills/
      scripts/
      specnav-stage.json
    specnav-requirements/
      .codex-plugin/plugin.json
      skills/
      scripts/
      specnav-stage.json
    specnav-prototype/
      .codex-plugin/plugin.json
      skills/
      scripts/
      specnav-stage.json
    specnav-development/
      .codex-plugin/plugin.json
      skills/
      scripts/
      specnav-stage.json
    specnav-verification/
      .codex-plugin/plugin.json
      skills/
      scripts/
      specnav-stage.json
    specnav-operations/
      .codex-plugin/plugin.json
      skills/
      scripts/
      specnav-stage.json
  tests/
  docs/
```

## 4. Marketplace Model

The marketplace is a single repo-level file:

```text
.agents/plugins/marketplace.json
```

It advertises six installable plugins:

| Plugin | Responsibility |
| --- | --- |
| `specnav-core` | Runtime, hooks, routing, bootstrap, status, doctor, recovery |
| `specnav-requirements` | Foundation specs, repository discovery, requirements questioning |
| `specnav-prototype` | Runnable prototype code and prototype handoff |
| `specnav-development` | Scope lock, implementation entry, vertical slices, fix loop |
| `specnav-verification` | Six-domain verification and stakeholder HTML reports |
| `specnav-operations` | Release plan, readiness, rollback, archive gate, archive action |

Each marketplace entry uses a local source path:

```json
{
  "name": "specnav-core",
  "source": {
    "source": "local",
    "path": "./plugins/specnav-core"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  }
}
```

## 5. Plugin Manifest Contract

Every plugin owns:

```text
plugins/<plugin>/.codex-plugin/plugin.json
```

The required manifest fields are:

- `name`
- `version`
- `description`
- `skills`
- `interface.displayName`
- `interface.shortDescription`
- `interface.capabilities`

Only `specnav-core` ships hooks:

```json
{
  "skills": "./skills/"
}
```

The hook file lives at the Codex default plugin hook path:

```text
plugins/specnav-core/hooks/hooks.json
```

`plugin.json` intentionally omits a top-level `hooks` field so the manifest also
passes the stricter `plugin-creator` validation contract. Stage plugins do not
ship hooks. They provide skills and scripts only. This keeps lifecycle
enforcement centralized and avoids conflicting hook behavior across plugins.

## 6. Skill Entry Model

Codex does not use the legacy command files as the primary surface. Public
entries are skills:

| Stage | Main Skills |
| --- | --- |
| Core | `specnav-bootstrap`, `specnav-status`, `specnav-doctor`, `specnav-route`, `specnav-workflow`, `specnav-debug` |
| Requirements | `specnav-repository-discovery`, `specnav-foundation-specs`, `specnav-requirements` |
| Prototype | `specnav-prototype` |
| Development | `specnav-development-entry`, `specnav-scope-lock`, `specnav-vertical-slices`, `specnav-fix` |
| Verification | `specnav-verify-plan`, `specnav-verify-facticity`, `specnav-verify-static`, `specnav-verify-unit`, `specnav-verify-redteam`, `specnav-verify-e2e`, `specnav-verify-sensory`, `specnav-verify-rerun`, `specnav-html-report` |
| Operations | `specnav-release-plan`, `specnav-ops-readiness`, `specnav-rollback`, `specnav-branch-finish` |

Skills may call colocated scripts and reuse assets/templates. A skill should not
be only a thin prose page when a repeatable validation, scaffold, or report can
be backed by a script.

## 7. Hook Design

`specnav-core` owns all hooks:

| Hook | Purpose |
| --- | --- |
| `SessionStart` | Surface current SpecNav/OpenSpec state at the start of a session |
| `UserPromptSubmit` | Inject the legal next actions and blockers for each user request |
| `PreToolUse` | Block unsafe writes when OpenSpec or stage gates are missing |
| `PostToolUse` | Mark verification reports stale after relevant edits |

Hook commands must use `PLUGIN_ROOT`:

```json
{
  "command": "node \"${PLUGIN_ROOT}/scripts/specnav-session-start.js\""
}
```

The hook behavior is strict:

- If `openspec/` is missing, only bootstrap, status, doctor, and read-only
  discovery are legal.
- If foundation specs are missing, requirements questioning is blocked until
  the user creates the required specs.
- If scope lock is missing, implementation writes are blocked.
- If verification is stale or red, release and archive are blocked.

## 8. Foundation Spec Gate

Requirements cannot start from feature questions alone. SpecNav must first check
whether these foundation specs exist:

1. UI design spec
2. Frontend/backend architecture and database design spec
3. Frontend/backend interaction and data-flow spec
4. Component architecture constraint spec

If any are missing, `specnav-foundation-specs` must guide the user to create
them using the required format. Only after these specs are present may
`specnav-requirements` begin detailed questioning.

The UI design spec must also record project UI capabilities before feature
requirements start:

- supported theme modes: `none`, `light-only`, `dark-only`, `light-dark`, or
  `system`;
- whether a theme toggle exists, must be added, or must be omitted;
- whether i18n exists;
- supported locales and default locale;
- whether prototypes must show theme and locale controls.

The fourth spec enforces high cohesion and low coupling:

- repeated UI or logic must be extracted when it forms a stable reusable unit;
- shared components must have clear props, ownership, and state boundaries;
- feature modules must not reach through unrelated modules for convenience;
- cross-layer dependencies must be explicit and documented.

## 9. Requirements Questioning Philosophy

Requirements questioning follows three principles:

1. Ask from evidence first: read existing specs, repo structure, runtime
   behavior, and prior decisions before asking the user.
2. Ask in decision units: each question should unlock a concrete artifact,
   constraint, or acceptance criterion.
3. Ask without fallback: if a required foundation artifact is missing, stop and
   request that artifact instead of inventing assumptions.

Questions should converge on:

- user goal and non-goals;
- affected users and workflows;
- data inputs, outputs, and ownership;
- UI states and interaction contracts;
- theme mode and locale coverage, including projects that have i18n but no
  dark/light switch;
- backend contracts and persistence rules;
- edge cases, permissions, safety, and rollback;
- acceptance criteria and test evidence.

## 10. Prototype Stage

Prototype work must produce runnable artifacts, not just prose.

Required outputs:

- prototype source under the active OpenSpec change;
- interaction/state notes;
- limitations and unresolved decisions;
- handoff notes for development;
- visual review evidence where UI is involved.

The prototype is a decision artifact. It must be useful for user review before
development begins.

UI prototypes must bind to the approved theme and locale policy. If a project
does not support dark mode, the prototype must not invent a dark/light switch.
If a project supports i18n, the prototype manifest and screen map must name the
language list, default locale, and whether the review artifact includes a locale
switcher.

## 11. Development Stage

Development starts only after:

- OpenSpec exists;
- active change exists;
- proposal/design/tasks are present;
- scope lock exists;
- relevant foundation specs exist.

Implementation proceeds through vertical slices. Each slice must declare:

- files allowed to change;
- behavior to deliver;
- tests or verification to run;
- rollback notes if the change is risky.

`tasks.md` is task evidence, not loose notes. Every task item must use checkbox
syntax: `- [ ]` before implementation and `- [x]` only after direct
implementation and validation evidence exists. Plain bullets must be normalized
with `scripts/tasks-md.js normalize` into standard OpenSpec checkbox syntax;
archive readiness remains blocked until the normalized tasks have explicit
`- [x]` completion evidence.

Shared component extraction is mandatory when duplication forms a reusable
component or stable domain utility. The system should prefer high cohesion,
low coupling, and explicit contracts over quick local patching.

## 12. Verification Stage

Verification is six-domain, with one entry skill per domain:

1. Facticity / authenticity audit
2. Static analysis / linting
3. Unit testing
4. Red teaming / destructive testing
5. End-to-end testing
6. Sensory / user-experience audit

`specnav-verify-plan` coordinates the aggregate verification plan. Each domain
skill produces domain-specific evidence. `specnav-html-report` generates a
reviewable HTML report for human stakeholders using the required editorial
style.

The report must make pass/fail/blocker status obvious, link evidence to
artifacts, and avoid placeholder success.

## 13. Operations Stage

Operations begins after verification is green and fresh.

Required outputs:

- release plan;
- readiness checklist;
- rollback plan;
- monitoring notes;
- archive gate;
- archive receipt.

High-risk changes require explicit human signoff before release/archive.
Archive also requires `tasks.md` to contain completed checkbox tasks; the gate
must run `scripts/tasks-md.js normalize` first and must not treat plain bullets
as completed task evidence. The archive action then runs `openspec validate`,
`openspec archive`, updates `openspec/.specnav/change-registry.json`, rewrites
archived verification evidence paths, and writes
`operations/archive-receipt.json` inside the archived change.

## 14. Runtime Discovery

Shared scripts must resolve plugins in both source and installed forms:

Source repo:

```text
specnav-codex-plugin/plugins/<plugin>
```

Installed Codex cache:

```text
~/.codex/plugins/cache/specnav-marketplace/<plugin>/<version>
```

Resolution priority:

1. explicit `SPECNAV_<PLUGIN>_ROOT`;
2. current plugin root;
3. source sibling plugins;
4. installed Codex cache.

If resolution fails, scripts return `missing-plugin:<name>`.

## 15. Testing Contract

The repository owns fixture tests for the plugin system:

- marketplace shape;
- plugin manifests;
- skill frontmatter and entry names;
- core hooks;
- runtime plugin discovery;
- smoke scan for legacy primary surfaces.

The smoke suite must fail if primary runtime code depends on legacy plugin
directories, legacy root environment variables, or legacy command entry points.

## 16. Installation

Local source install:

```bash
git clone https://github.com/zengwenliang416/specnav-codex-plugin.git
cd specnav-codex-plugin
codex plugin marketplace add "$PWD"
codex plugin add specnav-core@specnav-marketplace
codex plugin add specnav-requirements@specnav-marketplace
codex plugin add specnav-prototype@specnav-marketplace
codex plugin add specnav-development@specnav-marketplace
codex plugin add specnav-verification@specnav-marketplace
codex plugin add specnav-operations@specnav-marketplace
```

After install, trust the hooks with Codex's hook trust flow before relying on
automatic guardrails.

## 17. Completion Definition

This Codex version is complete for the first usable release when:

- all six plugins install from one marketplace;
- `specnav-core` hooks load from `PLUGIN_ROOT`;
- skills are visible as Codex skills;
- `specnav-doctor` can report installed plugin state;
- no script depends on legacy plugin paths;
- OpenSpec bootstrap and missing-spec guidance work in a clean project;
- verification can produce a six-domain aggregate report and HTML report;
- operations archive can move a completed change through `openspec archive` and
  leave a SpecNav archive receipt;
- the smoke test suite passes.
