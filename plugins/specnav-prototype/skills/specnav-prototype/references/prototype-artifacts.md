# Prototype Artifact Contract

Read this before writing prototype files.

All prototype files live under:

`openspec/changes/<active-change>/prototype/`

## Core Files

- `question.md`: the exact design or behavior question.
- `prototype-manifest.json`: branch type, entry, dependencies, requirements, and
  promotion policy.
- branch code or harness: the concrete artifact the user can inspect.
- branch maps: screen map, component tree, data-flow map, or API examples.

## UI HTML Rule

UI prototypes must be runnable by opening `artifact/index.html`. They should
include:

- desktop and mobile layout behavior;
- loading, empty, error, disabled, and permission states when relevant;
- stable review anchors so feedback maps back to the prototype;
- no production code edits.

### Review Anchors (`data-specnav-*`)

UI HTML prototypes must expose stable review anchors as project-local
attributes:

- `data-specnav-screen` on the screen root (required);
- `data-specnav-component` on major components;
- `data-specnav-state` on reviewable stateful regions;
- `data-specnav-variant` where variants apply.

The contract requires at least one `data-specnav-screen` anchor in
`artifact/index.html`; absence reports `missing-review-anchors:artifact/index.html`.

## Review Rule

The prototype is not development approval. Promotion requires verifier evidence,
explicit user approval, and a handoff that names the approved branch, variant,
components, flows, risks, and required tests.
