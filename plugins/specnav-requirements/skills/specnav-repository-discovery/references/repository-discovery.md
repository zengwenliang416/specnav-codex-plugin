# Repository Discovery

Repository discovery is a read-only evidence pass. It should answer "what does
this repo appear to contain?" without silently deciding architecture or product
requirements.

## Evidence To Scan

- `package.json` scripts and dependencies.
- `tsconfig.json`, `jsconfig.json`, `vite.config.*`, and `next.config.*`.
- Source directories for app/page/routes/API/components/hooks/services/utils.
- Test directories such as `tests`, `test`, `__tests__`, `e2e`, `cypress`, and
  `playwright`.
- `.github/workflows/*.yml` and `.github/workflows/*.yaml`.

## Ignore Rules

Ignore `.git`, `.next`, `.turbo`, `node_modules`, `dist`, `build`, and
`coverage` during recursive directory sampling.

## Evidence Rules

Every finding must cite repository evidence by ID through `evidence_refs`.
Evidence paths are relative to `project_root`. Do not include absolute paths,
`..` segments, or symlink escapes.

## Output Rule

The discovery script is read-only by default. It writes only when `--write` is
passed, and the only write target is
`openspec/.specnav/context/repository-discovery.json`.
