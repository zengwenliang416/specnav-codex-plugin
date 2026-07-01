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

- `visual-inventory.json` with direct project visual evidence;
- the current project's real shell structure, not a generic review canvas;
- the current project's business labels, actions, fields, density, and chrome;
- desktop and mobile layout behavior;
- loading, empty, error, disabled, and permission states when relevant;
- the exact theme modes and locales approved by requirements;
- a theme toggle only when `prototype-manifest.json` sets
  `ui_capabilities.theme.toggle_in_prototype` to `true`;
- a locale switcher only when `prototype-manifest.json` sets
  `ui_capabilities.i18n.locale_switch_in_prototype` to `true`;
- stable review anchors so feedback maps back to the prototype;
- no production code edits.

### Review Anchors (`data-specnav-*`)

UI HTML prototypes must expose stable review anchors as project-local
attributes:

- `data-specnav-screen` on the screen root (required);
- `data-specnav-project-shell` on the project shell root (required);
- `data-specnav-component` on major components;
- `data-specnav-state` on reviewable stateful regions;
- `data-specnav-variant` where variants apply.
- `data-specnav-theme-control` on the theme toggle when the prototype includes
  one.
- `data-specnav-locale-control` on the locale switcher when the prototype
  includes one.

The contract requires at least one `data-specnav-screen` anchor in
`artifact/index.html`; absence reports `missing-review-anchors:artifact/index.html`.
The contract also requires at least one `data-specnav-project-shell` anchor in
`artifact/index.html`; absence reports `missing-project-shell-anchor:artifact/index.html`.

## Review Rule

The prototype is not development approval. Promotion requires verifier evidence,
explicit user approval, and a handoff that names the approved branch, variant,
components, flows, risks, and required tests.
