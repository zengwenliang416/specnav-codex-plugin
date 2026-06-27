# Scope Lock

Read this before writing `scope.json`.

The scope lock is the production edit boundary for an active change. It must be
explicit, path-safe, and tied to the approved prototype source.

## Required Decisions

- allowed roots;
- denied roots;
- paths that require extra review;
- allowed operations;
- prototype sources;
- expiration rule.

## Component Rule

Scope must include shared component, hook, utility, or service roots when the
component architecture spec requires extraction. Do not force reusable behavior
into a page root just because it is the only allowed root.
