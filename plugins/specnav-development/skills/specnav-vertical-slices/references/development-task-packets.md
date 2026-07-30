# Development Task Packets

Read this before creating vertical slice tasks.

Each milestone must describe a user-visible vertical slice. Put a substantive
`User outcome:` or `用户结果：` statement in the milestone section, then preserve
the complete engineering checkbox checklist beneath it. Engineering subtasks
may describe models, parsers, APIs, tests, migrations, refactors, or documentation;
do not delete them merely because each line is not independently user-facing.

Do not create vague layer-only tasks such as "build API" or "build database".

## Task Preservation

Standard-lane development uses the committed Git `HEAD` version of `tasks.md` as
the task baseline.

- Adding tasks and rewording tasks without changing their numbered identity are
  allowed.
- Removing, merging, or renumbering a baseline task is blocked.
- Explicitly approved removal requires
  `development/task-change-approval.json`:

```json
{
  "schema_version": 1,
  "approved_by": "user",
  "approved_at": "2026-07-30T00:00:00Z",
  "reason": "The user explicitly approved this scope reduction.",
  "removed_task_ids": ["2.4"]
}
```

Task packet directories always use `NNN-kebab-case`, for example
`001-dashboard-summary`. The generator and development contract enforce the
same format before any scaffold is written.

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
