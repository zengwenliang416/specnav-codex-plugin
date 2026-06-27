# Prototype Verification

Read this before writing `prototype/verifier-report.json`.

## Evidence

Verification must use direct evidence:

- opened UI artifact or executed harness;
- screenshots, logs, command output, or inspected schemas;
- manifest entry path and declared branch;
- state labels and review maps.

## Branch Checks

- `ui-html`: open `artifact/index.html`, inspect desktop and mobile, and check
  default, loading, empty, error, disabled, and permission states when relevant.
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
