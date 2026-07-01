# Prototype Verification

Read this before writing `prototype/verifier-report.json`.

## Evidence

Verification must use direct evidence:

- opened UI artifact or executed harness;
- `visual-inventory.json` for `ui-html`;
- screenshots, logs, command output, or inspected schemas;
- manifest entry path and declared branch;
- state labels and review maps.
- viewport, theme, locale, and state matrix for `ui-html`.

## Branch Checks

- `ui-html`: open `artifact/index.html`, inspect desktop and mobile, confirm
  `data-specnav-project-shell`, compare against `visual-inventory.json`, and
  check default, loading, empty, error, disabled, permission, and populated
  states when relevant. Theme modes and locales must match the manifest; do not
  invent dark mode or locale controls when the project does not support them.
- `logic-state`: run the harness or inspect transitions and edge cases.
- `api-contract`: inspect examples, status codes, auth, validation, and error
  shape.
- `data-flow`: confirm each boundary from UI event to persistence and response.
- `component-seam`: confirm cohesion, coupling, extraction boundaries, and public
  APIs.

## Status

Use `green` only when direct evidence exists. Use `blocked` when execution or
inspection cannot be completed. Use `red` when the prototype contradicts
requirements or cannot answer the review question.

## UI Fidelity Gate

For `ui-html`, `green` requires all of these:

- the HTML contains a project shell anchor;
- the shell, navigation, labels, density, theme, i18n behavior, and business
  surface are traceable to `visual-inventory.json`;
- desktop and mobile screenshots or equivalent inspected viewport evidence are
  named in the report;
- loading, empty, error, disabled, permission, and populated states are either
  verified or explicitly marked not applicable with a reason.
