# Prototype Branches

Read this before choosing a prototype branch.

## Branch Types

Use exactly one primary branch for each prototype.

| Branch | Use When | Required Entry |
| --- | --- | --- |
| `ui-html` | The user needs visual review, interaction review, responsive states, or design-system application. | `artifact/index.html` |
| `logic-state` | The risky part is state transitions, validation rules, reducers, parsers, or domain logic. | `logic/harness.js` |
| `api-contract` | The risky part is request/response shape, examples, error schema, permissions, or backend contract. | `api/examples.json` |
| `data-flow` | The risky part is end-to-end movement across UI, API, state, database, queues, or realtime effects. | `data-flow-map.md` |
| `component-seam` | The risky part is high cohesion, low coupling, extraction boundaries, component public APIs, or reuse. | `component/component-map.md` |

## Selection Rule

Pick the branch that answers the user's current uncertainty with the least
production risk. Do not edit production code during prototype work.

## Output Rule

Every branch still writes `question.md` and `prototype-manifest.json`. The
branch-specific artifact must be present and reviewable.
