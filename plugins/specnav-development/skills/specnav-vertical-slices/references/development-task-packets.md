# Development Task Packets

Read this before creating vertical slice tasks.

Each task must be a user-visible vertical slice. Do not create layer-only tasks
such as "build API" or "build database".

## Packet Files

Each task directory under `development/tasks/<task-id>/` contains:

- `brief.md`
- `context.json`
- `report.md`
- `spec-review.md`
- `quality-review.md`

## Required Context

The task context must include:

- `task_id`;
- `goal`;
- `must_read`;
- `allowed_files`;
- `non_goals`;
- `expected_evidence`;
- `unsafe_assumptions`;
- `stop_condition`.

## Component Rule

The brief must say which components are created, reused, or extracted. If the
task repeats UI/state/validation/formatting behavior, it must plan extraction.
