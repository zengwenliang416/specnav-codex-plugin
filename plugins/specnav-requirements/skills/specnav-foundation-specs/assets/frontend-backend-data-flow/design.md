# Frontend-Backend Data Flow Spec

## Overview

Describe how user actions move through UI, state, API, backend validation,
persistence, and response rendering.

## Flow Index

Give every flow a stable id of the form `FLOW-<NAME>` (for example `FLOW-LOGIN`).

| Flow ID | Trigger | Entry UI | API/Service | Persistence | User Result |
| --- | --- | --- | --- | --- | --- |
| `FLOW-<decision-required>` | `<event>` | `<screen>` | `<route/service>` | `<entity/effect>` | `<visible result>` |

## Boundary Contracts

- UI event contract:
- Client state contract:
- Request schema:
- Response schema:
- Error schema:
- Permission contract:

## State Ownership

- URL state:
- Local component state:
- Shared client cache:
- Server state:
- Database state:
- Derived state:

## Validation Ownership

- Client-side validation:
- Server-side validation:
- Database constraints:
- Cross-field or cross-entity rules:
- Error copy source:

## Error & Empty States

- Empty state:
- Permission denied:
- Validation error:
- Network error:
- Server error:
- Conflict/stale data:

## Loading / Optimistic / Retry Behavior

- Initial loading:
- Partial loading:
- Optimistic update:
- Retry rule:
- Cancellation rule:
- Idempotency rule:

## End-to-End Flow Details

For each flow, record:

1. User action.
2. UI state transition.
3. Request payload.
4. Backend validation.
5. Database read/write.
6. Response payload.
7. UI render result.
8. Retry/idempotency behavior.
9. Rollback behavior on failure.
10. Logging/metrics/audit event.

## Async / Realtime Flows

- Queue/event source:
- Subscriber:
- Retry/dead-letter behavior:
- Realtime update channel:
- Consistency expectation:

## Flow Do's and Don'ts

- Do keep every feature requirement traceable to a named flow.
- Do record loading, empty, error, disabled, and permission states.
- Do include database and integration side effects.
- Don't let frontend and backend disagree on validation ownership.
- Don't introduce implicit data transformations that are not documented here.
