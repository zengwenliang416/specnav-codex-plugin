---
name: specnav-verification-runtime-status
description: Use this skill when a user asks to inspect or select the project/user Verification Runtime scope, or diagnose locked Runtime readiness without exposing sensitive configuration.
---

# SpecNav Verification Runtime Status

## Purpose

Inspect the project and user managed Runtime candidates, require an explicit
scope selection, and run a read-only doctor against one exact version in the
selected base. Scope selection is the only permitted mutation and must follow
the user's explicit `project` or `user` choice.

## Workflow

1. Resolve `SPECNAV_VERIFICATION_ROOT` with the owning plugin resolver.
2. Inspect both default candidates:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" inspect \
     --project "$PWD" \
     --json
   ```

3. Report `<project>/.specnav/runtime/verification` and
   `~/.specnav/runtime/verification`. Recommend `project`, but do not select it
   automatically.
4. If `<project>/.specnav/config.json` has no explicit selection, report
   `BLOCKED`, ask the user to choose `project` or `user`, and do not run doctor.
5. After the user explicitly chooses, persist exactly that choice:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" select-scope \
     --scope "<project-or-user>" \
     --project "$PWD" \
     --json
   ```

6. Run doctor only after selection:

   ```bash
   node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" doctor \
     --version "<version>" \
     --project "$PWD" \
     --json
   ```

7. Doctor must use the selected base. Never pass or infer another base as a
   fallback.
8. Add `--requires-midscene` only when an approved selected case requires
   Midscene.
9. Resolve provider configuration from the same selected scope only:
   `<project>/.specnav/secrets/verification.env` for `project`, or
   `~/.specnav/secrets/verification.env` for `user`. Require mode `0600`.
10. Report `readiness`, every exact blocker, warning, affected artifact, and
   explicit action.
11. Never install, repair, mutate, or select another Runtime during doctor.
12. When doctor returns a `repair` action, present the exact command and require
   an explicit user action before invoking it. Repair preserves the prior
   Runtime under the selected base and restores it if replacement fails.

## Provider Privacy

- Report sensitive provider and proxy configuration only as presence.
- Never print names, identifiers, environment variable names, model details,
  API keys, base URLs, endpoints, init JSON, proxy values, or configured values.

## Stop Conditions

- Scope inspection fails, or no explicit project/user selection is persisted.
- Lock, runtime, receipt, package lock, package load, browser marker,
  executable, browser probe, or permission check fails.
- A selected Midscene case requires provider configuration and the redacted
  provider probe is incomplete.
- Any suggested path would use a non-selected base, another Runtime version, or
  globally installed Playwright, Midscene, or browsers as the managed Runtime.

## Validation

- Confirm `<project>/.specnav/config.json` records the user's explicit scope.
- Run inspect again and confirm it reports the same selected base.
- Run doctor again with the same Runtime version and project root.
- Confirm it reports `fallback_used: false`, exact Kernel identity, and either
  `ok: true` or stable blocker ids with explicit repair actions.
