# Foundation Spec Contract

Read this before creating or repairing foundation specs.

SpecNav requirements cannot start until these project-level specs exist:

- `openspec/specs/ui-design/design.md`
- `openspec/specs/system-architecture/design.md`
- `openspec/specs/frontend-backend-data-flow/design.md`
- `openspec/specs/component-architecture/design.md`

## Creation Rule

Use `scripts/create-foundation-specs.js` only to create missing skeletons from
`assets/`. The script must not infer product, architecture, database, API,
interaction, or component decisions. After scaffolding, ask the user for the
missing decisions and record them in the specs.

## UI Design Spec

The UI design spec follows the user's Geist-style `design.md` structure:

- YAML frontmatter first.
- Token roots include `colors`, `typography`, `spacing`, `rounded`, and
  `components`.
- Markdown sections explain how tokens should be used, not just list values.
- The light/dark theme relationship must be named when the project supports both.
- `## Theme & Internationalization` must state whether theme switching exists,
  supported modes (`none`, `light-only`, `dark-only`, `light-dark`, or
  `system`), whether prototypes should show a theme toggle, whether i18n exists,
  supported locales, and the default locale.

If the user supplies a design file, prefer their file over SpecNav's template.
Repair only missing contract sections or malformed token roots.

## System Architecture & Database Spec

This spec defines:

- runtime topology;
- module boundaries;
- frontend and backend architecture;
- API surface;
- database model;
- permissions and security;
- integrations;
- operational constraints.

Do not discuss a feature until the affected modules, persistence model, and
security boundary can be named or explicitly marked as a user decision gap.

## Frontend-Backend Data Flow Spec

This spec defines the complete data path:

- UI event;
- client state;
- request construction;
- API route;
- server validation;
- database read/write;
- async/realtime effect;
- response mapping;
- user-visible loading, empty, error, permission, retry, and optimistic states.

Questions during requirements should target missing flow boundaries, not repeat
facts already present in this spec.

## Component Architecture Spec

This spec is the fourth foundation constraint. It defines high cohesion, low
coupling, shared component extraction rules, public APIs, state ownership, and
testing expectations.

Any implementation plan that duplicates reusable UI/domain behavior, crosses a
declared boundary, or hides shared logic in a page-local component should be
blocked until the component architecture is updated or the task is redesigned.
