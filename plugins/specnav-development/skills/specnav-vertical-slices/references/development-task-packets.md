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

`brief.md` must always include these core headings with substantive content:

- `Goal`
- `Vertical Slice`
- `In Scope`
- `Files Allowed`
- `Verification Commands`
- `Stop Conditions`

Other brief headings may be included when useful, but an empty optional heading
is still invalid. Do not pad optional sections just to satisfy a template.

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

## Migration Rule

If any requirement, task, report, or handoff mentions SQL, DDL, DML, seed data,
menus, permissions, or migrations, development must write
`development/migrations/manifest.json`, `development/migrations/README.md`, and
the executable `.sql` files. The manifest must be `required=true`, list every
SQL file, include validation evidence, and include rollback SQL or a concrete
rollback strategy.
