# System Architecture & Database Spec

## Overview

Describe the project architecture, runtime boundaries, storage model, and
security model. Requirements work must not proceed by guessing these decisions.

## Application Topology

- Frontend runtime:
- Backend runtime:
- API gateway or edge layer:
- Background workers:
- External services:
- Local development entrypoints:
- Production deployment shape:

## Module Boundaries

List each module. For every module record:

- Responsibility:
- Public contract:
- Owned data:
- Dependencies:
- Forbidden dependencies:
- Extension points:

Module groups:

- UI modules:
- Domain modules:
- Application/service modules:
- Infrastructure modules:
- Shared libraries:

## Frontend Architecture

- Routing:
- Rendering mode:
- State management:
- Form handling:
- Data fetching:
- Error handling:
- Design system source:

## Backend Architecture

- API style:
- Request validation:
- Auth/session model:
- Domain service boundaries:
- Background jobs:
- File/object storage:
- Observability:

## API Surface

| Route or RPC | Owner | Input | Output | Auth | Side Effects |
| --- | --- | --- | --- | --- | --- |
| `<decision-required>` | `<owner>` | `<schema>` | `<schema>` | `<rule>` | `<effect>` |

## Database Model

For every entity record purpose, owner module, fields, relationships, indexes,
constraints, lifecycle, migration notes, and retention/deletion behavior.

| Entity | Purpose | Owner | Fields | Relationships | Indexes | Constraints | Lifecycle | Migration | Retention/Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<decision-required>` | `<purpose>` | `<owner module>` | `<fields>` | `<relations>` | `<indexes>` | `<constraints>` | `<lifecycle>` | `<migration>` | `<retention/deletion>` |

## Permissions & Security

- User roles:
- Permission checks:
- Data isolation:
- Secret handling:
- Audit logging:
- Abuse cases:

## Integration Boundaries

- Third-party APIs:
- Webhooks:
- Queues:
- Email/SMS/push:
- Payments:
- Analytics:

## Operational Constraints

- Performance constraints:
- Availability expectations:
- Migration rules:
- Backup/restore:
- Feature flag rules:
- Rollback constraints:

## Architecture Do's and Don'ts

- Do keep module ownership explicit.
- Do name persistence and side effects before implementation.
- Do update this spec when a feature changes architecture.
- Don't create new APIs, tables, queues, or permissions without recording them here.
- Don't let frontend components bypass declared service or data-flow boundaries.
