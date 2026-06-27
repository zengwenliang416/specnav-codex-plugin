# Component Architecture & Reuse Spec

## Overview

Define component boundaries before implementation. This spec is mandatory
because SpecNav requires high cohesion, low coupling, and explicit extraction rules.

## Component Taxonomy

- Page/screen components:
- Layout components:
- Domain components:
- Form components:
- Data display components:
- Feedback components:
- Headless hooks:
- Domain utilities/services:

## Cohesion Rules

- A component should have one clear reason to change.
- UI-only rendering, domain transformation, data fetching, and side effects must
  not be mixed unless this spec explicitly allows it.
- Keep component props aligned with user-visible behavior, not database internals.

## Coupling Rules

- Page components may compose shared components.
- Shared components must not import page-specific modules.
- Domain components may depend on domain types, but not on routing globals unless
  declared here.
- Infrastructure, API clients, and database code must not leak into presentational
  components.

## Shared Component Extraction Rules

Extract a component, hook, utility, or service when any of these are true:

- The same UI behavior appears in two or more screens.
- The same state machine is repeated.
- The same validation or formatting rule is repeated.
- A page-local component exceeds a single user-facing responsibility.
- A proposed implementation would duplicate a design-system control.

## Component Public API Rules

- Props must be stable, minimal, and behavior-facing.
- Do not expose raw database entities unless the component is explicitly a data
  boundary component.
- Events should name domain/user intent, not DOM implementation details.
- Slots/children are allowed only when they reduce coupling.

## State Ownership Rules

- Local state:
- Shared UI state:
- Server/cache state:
- Form state:
- URL state:
- Derived state:

## Composition Patterns

- Preferred composition patterns:
- Forbidden composition patterns:
- Approved provider/context boundaries:
- Approved headless hook patterns:

## File & Naming Conventions

- Component file naming:
- Hook naming:
- Test naming:
- Story/prototype naming:
- Barrel/export rules:

## Testing Expectations

- Shared component tests:
- Hook tests:
- Integration tests:
- Accessibility checks:
- Visual/prototype review:

## Refactor Triggers

- Duplicate logic detected:
- Cross-boundary import detected:
- Props become data-source-specific:
- Component grows multiple responsibilities:
- Test setup requires unrelated modules:

## Component Do's and Don'ts

- Do extract reusable UI, hooks, and domain utilities when the extraction rules trigger.
- Do keep shared components independent of page-specific state and routes.
- Do update this spec before adding a new shared component family.
- Don't copy/paste component logic across pages.
- Don't make low-level components know about API clients, database rows, or auth globals.
