---
name: specnav-verification-runtime-setup
description: Use this skill when the user explicitly asks to select a project/user Runtime scope and install or repair the locked SpecNav Verification Runtime in that selected base.
---

# SpecNav Verification Runtime Setup

## Purpose

Install or repair one exact Verification Runtime version in the explicitly
selected project or user base. This is the only Verification skill allowed to
create or mutate the managed Runtime.

## Workflow

1. Resolve `SPECNAV_VERIFICATION_ROOT` with the owning plugin resolver.
2. Confirm the requested Runtime version is explicit.
3. Inspect both candidates:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" inspect \
     --project "$PWD" \
     --json
   ```

4. The candidates are `<project>/.specnav/runtime/verification` and
   `~/.specnav/runtime/verification`. Recommend `project`, but never select it
   automatically or adopt the user base because it already contains a Runtime.
5. If `<project>/.specnav/config.json` has no explicit selection, report
   `BLOCKED` and ask the user to choose `project` or `user`. Do not install or
   repair anything.
6. After the user explicitly chooses, persist exactly that choice:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" select-scope \
     --scope "<project-or-user>" \
     --project "$PWD" \
     --json
   ```

7. Run install or repair only after selection:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" install \
     --version "<version>" \
     --project "$PWD" \
     --json
   ```

8. The operation must use the selected base. Do not pass another base, search
   for an alternative, or fall back to the user base.
9. Provider configuration must use the selected scope's
   `.specnav/secrets/verification.env` file with mode `0600`; never read another
   scope or a shell startup file.
10. Report the exact Runtime root, package versions, browser revisions, and
   receipt path.
11. If installation blocks, report the returned blocker and failed-attempt
   directory. Globally installed Playwright, Midscene, and browsers may be
   reported as diagnostics only; they cannot satisfy, seed, replace, or repair
   the managed Runtime.

## Required Output

- `<selected-base>/<version>/install-receipt.json`
- Locked package tree and package lock.
- Locked browser directories with `INSTALLATION_COMPLETE` markers.
- Preserved `.failed-*` directory and failure receipt for every failed attempt.

## Stop Conditions

- Scope inspection fails, or no explicit project/user selection is persisted.
- Runtime version is missing or unsupported.
- Node, platform, or Kernel identity does not match the lock.
- The target runtime version directory already exists.
- A package or browser fails integrity validation.
- The business repository manifest or lockfile changes.
- A command would use a non-selected base or any fallback.

## Validation

- Confirm `<project>/.specnav/config.json` records the user's explicit scope and
  inspect reports the same selected base.
- Run `specnav-verification-runtime-status` against the installed version.
- Confirm the install receipt, package lock, browser markers, executable probes,
  Kernel identity, and unchanged business-project manifests all pass with
  `fallback_used: false`.
