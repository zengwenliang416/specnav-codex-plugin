# Development Migrations: {{SPECNAV_CHANGE}}

## Execution Order

- No migration is required unless `manifest.json` sets `required` to `true`.

## Validation

- When migrations are required, record exact database or migration commands in
  `manifest.json`.

## Rollback

- When migrations are required, provide rollback SQL files or a concrete
  rollback strategy in `manifest.json`.
